import { execFileSyncInterruptible } from "./exec-sync.js";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { threadId } from "node:worker_threads";
import type { RevisionAppend } from "../core/interfaces.js";

export class RevisionAppendConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevisionAppendConflictError";
  }
}

export class RevisionAppendBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevisionAppendBusyError";
  }
}

export type RevisionAppendResult = {
  path: string;
  alreadyApplied: boolean;
  eventId: string;
  commandId: string;
  commandFingerprint: string;
  createdAt: string;
  entityId?: string;
};

type CommandEnvelope = {
  eventId: string;
  commandId: string;
  commandFingerprint: string;
  createdAt: string;
  entityId?: string;
};

type CommandIndex = {
  path: string;
  byteLength: number;
  modifiedMs: number;
  commands: Map<string, CommandEnvelope>;
};

type IntentOwner = {
  pid: number;
  threadId: number;
  processStartIdentity: string | null;
  token: string;
  createdAtMs: number;
};

type CandidateIntent = {
  version: 1;
  token: string;
  owner: IntentOwner;
  append: RevisionAppend;
  contentSha256: string;
};

type PreparedProof = {
  version: 1;
  token: string;
  baseByteLength: number;
  baseSha256: string;
};

type PreparedIntent = CandidateIntent & {
  proof: PreparedProof;
};

type CandidateClaim = {
  path: string;
  ticket: number;
  intent: CandidateIntent;
};

type TicketState =
  | { kind: "candidate"; claim: CandidateClaim }
  | { kind: "prepared"; claim: CandidateClaim; prepared: PreparedIntent }
  | { kind: "terminal"; path: string; ticket: number; owner?: IntentOwner };

const INVALID_CANDIDATE_STALE_MS = 30_000;
const MAX_REVISION_APPEND_BYTES = 512 * 1_024;
const MAX_TICKET_ALLOCATION_ATTEMPTS = 10_000;
const CANDIDATE_FILE = "candidate.json";
const TICKET_PATTERN = /^ticket-([0-9]{16})-([0-9a-f-]{36})$/;
const PREPARED_MARKER_PATTERN = /^prepared-([0-9a-f-]{36})\.json$/;
const COMMITTED_MARKER_PATTERN = /^committed-([0-9a-f-]{36})\.json$/;
const ABORTED_MARKER_PATTERN = /^aborted-(?:[0-9a-f-]{36}|corrupt-[0-9a-f-]{36})\.json$/;
const LEGACY_LEASE_PATTERN = /^p([1-9][0-9]*)-[0-9a-f-]{36}\.lease$/;
const ACTIVE_INTENT_TOKENS = new Set<string>();

let cachedDefaultCurrentProcessIdentity: string | null | undefined;

export type RevisionAppendFaultHooks = {
  /** Test/fault harness: constrain target writes so short-write recovery is exercised. */
  maxWriteChunkBytes?: number;
  /** Test/fault harness: may throw after a real target chunk has landed; same-call recovery follows. */
  afterWriteChunk?: (totalBytesWritten: number) => void;
  /** Test/fault harness: may throw immediately before the initial target fsync; same-call recovery follows. */
  beforeInitialFsync?: () => void;
  /** Test/fault harness: throwing here models death after a durable candidate, which must never be applied. */
  afterCandidateDurable?: () => void;
  /** Test/fault harness: runs after choosing a ticket number but before its atomic staging rename. */
  afterTicketNumberChosenBeforeRename?: (ticket: number) => void;
  /** Test/fault harness: throwing here leaves a durable prepared intent with an untouched target. */
  afterIntentPrepared?: () => void;
  /** Test/fault harness: throwing here leaves a prepared intent and the exact target prefix already written. */
  afterTargetWriteChunkWithoutRecovery?: (totalBytesWritten: number) => void;
  /** Test/fault harness: observes the required target-parent fsync before the committed transition. */
  afterTargetParentFsync?: () => void;
  /** Test/fault harness: throwing here leaves a full, durable target under a prepared intent. */
  beforeCommittedMarker?: () => void;
  /** Test/fault harness: runs after terminal rename but before its directory fsync. */
  afterTerminalMarkerRenameBeforeFsync?: () => void;
  /** Test/fault harness: throwing here leaves a harmless terminal directory behind. */
  beforeTerminalCleanup?: () => void;
  /** Bounded/injectable process-start identity. Null means this platform cannot distinguish PID reuse. */
  processStartIdentity?: (pid: number) => string | null;
};

/**
 * Per-RevisionStore append coordinator.
 *
 * Cross-process exclusion is a tiny prepared-intent journal rather than a
 * best-effort lockfile. The lowest immutable nonterminal ticket is the sole
 * writer/recoverer. It may become recoverable only through an fsynced atomic
 * prepared-marker rename,
 * and a prepared intent becomes terminal only after the target file and its
 * parent directory are durable. No recovery path truncates or overwrites the
 * append-only JSONL target; it can write only the exact missing suffix.
 */
export class RevisionAppendCoordinator {
  private index: CommandIndex | null = null;

  constructor(private readonly faultHooks: RevisionAppendFaultHooks = {}) {}

  append(libraryPath: string, append: RevisionAppend): RevisionAppendResult {
    const relativePath = normalizeRelativeJsonlPath(append.path);
    validateAppendMetadata(append);
    const requested = validateSingleJsonlEvent(
      append.content,
      append.commandId,
      append.commandFingerprint,
    );
    const normalizedAppend: RevisionAppend = { ...append, path: relativePath };
    const leaseDir = ensureIntentJournal(libraryPath);
    const currentOwner = createIntentOwner(this.faultHooks);
    const intent = createCandidateIntent(currentOwner, normalizedAppend);
    ACTIVE_INTENT_TOKENS.add(intent.token);

    let claim: CandidateClaim | null = null;
    let preparedTicketPath: string | null = null;
    let leaveCandidateAsCrashEvidence = false;
    try {
      claim = createCandidate(leaseDir, intent, this.faultHooks);
      try {
        this.faultHooks.afterCandidateDurable?.();
      } catch (error) {
        // A candidate is an explicit command attempt but not authorization to
        // mutate its target. Leaving it behind models process death safely.
        leaveCandidateAsCrashEvidence = true;
        throw error;
      }

      claim = claimCandidateTurn(
        libraryPath,
        leaseDir,
        claim,
        currentOwner,
        this.faultHooks,
      );

      const absolutePath = join(libraryPath, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      this.refreshIndex(absolutePath);
      const existing = this.index?.commands.get(append.commandId);
      if (existing) {
        if (existing.commandFingerprint !== append.commandFingerprint) {
          throw new RevisionAppendConflictError(
            `Revision command ${append.commandId} was reused for different content in ${relativePath}.`,
          );
        }
        confirmFileDurability(absolutePath);
        retireCandidate(leaseDir, claim, this.faultHooks);
        claim = null;
        return resultFromEnvelope(relativePath, true, existing);
      }

      const base = existsSync(absolutePath) ? readFileSyncInterruptible(absolutePath) : Buffer.alloc(0);
      if (base.length !== append.expectedByteLength) {
        throw new RevisionAppendConflictError(
          `Revision append conflict for ${relativePath}: expected ${append.expectedByteLength} bytes, found ${base.length}.`,
        );
      }

      writePreparedProof(claim.path, intent, base);
      preparedTicketPath = claim.path;
      claim = null;
      this.faultHooks.afterIntentPrepared?.();

      const prepared = loadPreparedIntent(preparedTicketPath);
      completePreparedTarget(libraryPath, prepared, this.faultHooks);
      this.faultHooks.beforeCommittedMarker?.();
      publishTerminalMarker(
        leaseDir,
        preparedTicketPath,
        "committed",
        intent.token,
        this.faultHooks,
      );
      cleanupTerminalTickets(leaseDir, this.faultHooks);
      preparedTicketPath = null;

      const stat = statSync(absolutePath);
      const commands = this.index?.commands ?? new Map<string, CommandEnvelope>();
      commands.set(append.commandId, requested);
      this.index = {
        path: absolutePath,
        byteLength: stat.size,
        modifiedMs: stat.mtimeMs,
        commands,
      };
      return resultFromEnvelope(relativePath, false, requested);
    } finally {
      ACTIVE_INTENT_TOKENS.delete(intent.token);
      if (claim && !leaveCandidateAsCrashEvidence) {
        try {
          retireCandidate(leaseDir, claim, this.faultHooks);
        } catch {
          // The active candidate record includes this process/thread/token.
          // A later same-process call recognizes it as inactive, so even a
          // failed terminal transition cannot self-lock the store.
        }
      }
      // A prepared path is deliberately never deleted on failure. It is the
      // durable authorization needed to finish or confirm exactly once.
      void preparedTicketPath;
    }
  }

  private refreshIndex(absolutePath: string): void {
    const stat = existsSync(absolutePath) ? statSync(absolutePath) : null;
    if (
      this.index?.path === absolutePath
      && this.index.byteLength === (stat?.size ?? 0)
      && this.index.modifiedMs === (stat?.mtimeMs ?? 0)
    ) {
      return;
    }

    const content = stat ? readFileSyncInterruptible(absolutePath, "utf8") : "";
    if (content.length > 0 && !content.endsWith("\n")) {
      throw new RevisionAppendConflictError(
        `Existing JSONL ${absolutePath} ends with an incomplete event and requires repair before another append.`,
      );
    }
    const commands = new Map<string, CommandEnvelope>();
    for (const line of content.split("\n")) {
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new RevisionAppendConflictError(
          `Existing JSONL ${absolutePath} contains an invalid event and cannot be appended safely.`,
        );
      }
      const envelope = commandEnvelopeFromParsed(parsed);
      if (!envelope) continue;
      const existing = commands.get(envelope.commandId);
      if (
        existing
        && (
          existing.commandFingerprint !== envelope.commandFingerprint
          || existing.eventId !== envelope.eventId
        )
      ) {
        throw new RevisionAppendConflictError(
          `Existing JSONL ${absolutePath} contains more than one event for command ${envelope.commandId}.`,
        );
      }
      if (!existing) commands.set(envelope.commandId, envelope);
    }
    this.index = {
      path: absolutePath,
      byteLength: stat?.size ?? 0,
      modifiedMs: stat?.mtimeMs ?? 0,
      commands,
    };
  }
}

/** Convenience entry point for isolated callers and focused tests. */
export function appendRevisionJsonl(
  libraryPath: string,
  append: RevisionAppend,
): RevisionAppendResult {
  return new RevisionAppendCoordinator().append(libraryPath, append);
}

/** Stable logical receipt id for retry/restart-safe authored commands. */
export function revisionReceiptId(commandId: string): string {
  return `rev_${createHash("sha256").update(commandId).digest("hex").slice(0, 32)}`;
}

function createCandidateIntent(owner: IntentOwner, append: RevisionAppend): CandidateIntent {
  return {
    version: 1,
    token: owner.token,
    owner,
    append,
    contentSha256: sha256(Buffer.from(append.content, "utf8")),
  };
}

function ensureIntentJournal(libraryPath: string): string {
  const historyDir = join(libraryPath, ".history");
  const leaseDir = join(historyDir, "revision-append-leases");
  mkdirSync(historyDir, { recursive: true });
  mkdirSync(leaseDir, { recursive: true });
  fsyncDirectory(historyDir);
  fsyncDirectory(leaseDir);
  return leaseDir;
}

function createCandidate(
  leaseDir: string,
  intent: CandidateIntent,
  faultHooks: RevisionAppendFaultHooks,
): CandidateClaim {
  let stagingPath = createCandidateStaging(leaseDir, intent);

  for (let attempt = 0; attempt < MAX_TICKET_ALLOCATION_ATTEMPTS; attempt += 1) {
    const ticket = highestTicket(leaseDir) + 1;
    if (!Number.isSafeInteger(ticket)) {
      throw new RevisionAppendBusyError("The authored-change journal exhausted its safe ticket range.");
    }
    const candidatePath = join(leaseDir, ticketName(ticket, intent.token));
    try {
      faultHooks.afterTicketNumberChosenBeforeRename?.(ticket);
      renameSync(stagingPath, candidatePath);
      fsyncDirectory(leaseDir);
      const claim = { path: candidatePath, ticket, intent };
      // A delayed allocator may publish below a newer ticket after an older
      // terminal with the same number was compacted. Unique token-bearing
      // paths prevent ABA; this post-publish floor check prevents the delayed
      // candidate from entering election beneath the newer live writer.
      if (highestTicket(leaseDir) > ticket) {
        retireCandidate(leaseDir, claim, faultHooks);
        stagingPath = createCandidateStaging(leaseDir, intent);
        continue;
      }
      return claim;
    } catch (error) {
      if (existsSync(candidatePath)) continue;
      throw error;
    }
  }
  throw new RevisionAppendBusyError(
    "The authored-change journal has too many active candidates. Retry after the other commands finish.",
  );
}

function createCandidateStaging(leaseDir: string, intent: CandidateIntent): string {
  const stagingPath = join(leaseDir, `.creating-${intent.token}`);
  mkdirSync(stagingPath, { mode: 0o700 });
  writeDurableJson(join(stagingPath, CANDIDATE_FILE), intent);
  fsyncDirectory(stagingPath);
  return stagingPath;
}

function claimCandidateTurn(
  libraryPath: string,
  leaseDir: string,
  initialClaim: CandidateClaim,
  currentOwner: IntentOwner,
  faultHooks: RevisionAppendFaultHooks,
): CandidateClaim {
  for (let attempt = 0; attempt < MAX_TICKET_ALLOCATION_ATTEMPTS; attempt += 1) {
    assertNoActiveLegacyLease(leaseDir, currentOwner);
    cleanupCreatingEntries(leaseDir, currentOwner, faultHooks);
    const states = inspectTicketStates(leaseDir);
    const current = states.find((state) => (
      state.kind === "candidate" && state.claim.intent.token === initialClaim.intent.token
    ));
    if (!current || current.kind !== "candidate") {
      throw new RevisionAppendBusyError(
        "This authored-change candidate lost its journal claim. Retry the command.",
      );
    }
    const first = states.find((state) => state.kind !== "terminal");
    if (!first) continue;
    if (first.kind === "candidate") {
      if (first.claim.intent.token === initialClaim.intent.token) {
        // The ticket path and token are immutable. Re-read immediately before
        // returning so a corrupted/malformed marker cannot be mistaken for a
        // live claim between election and prepared publication.
        const revalidated = inspectTicketState(first.claim.path, first.claim.ticket);
        if (
          revalidated.kind === "candidate"
          && revalidated.claim.intent.token === initialClaim.intent.token
        ) {
          return revalidated.claim;
        }
        continue;
      }
      if (ownerIsActive(first.claim.intent.owner, currentOwner, faultHooks)) {
        retireCandidate(leaseDir, current.claim, faultHooks);
        throw new RevisionAppendBusyError(
          "Another Scripture Library process is committing an authored change. Retry this command once it finishes.",
        );
      }
      retireCandidate(leaseDir, first.claim, faultHooks);
      continue;
    }
    if (ownerIsActive(first.prepared.owner, currentOwner, faultHooks)) {
      retireCandidate(leaseDir, current.claim, faultHooks);
      throw new RevisionAppendBusyError(
        "Another Scripture Library process has a prepared authored change. Retry this command once it finishes.",
      );
    }
    completePreparedTarget(libraryPath, first.prepared, {});
    publishTerminalMarker(
      leaseDir,
      first.claim.path,
      "committed",
      first.prepared.token,
      faultHooks,
    );
    cleanupTerminalTickets(leaseDir, faultHooks);
  }
  retireCandidate(leaseDir, initialClaim, faultHooks);
  throw new RevisionAppendBusyError("The authored-change journal could not elect a writer. Retry the command.");
}

function inspectTicketStates(leaseDir: string): TicketState[] {
  const states: TicketState[] = [];
  for (const entry of readdirSync(leaseDir)) {
    const match = TICKET_PATTERN.exec(entry);
    if (!match) continue;
    const ticket = Number(match[1]);
    if (!Number.isSafeInteger(ticket)) continue;
    const path = join(leaseDir, entry);
    try {
      states.push(inspectTicketState(path, ticket));
    } catch (error) {
      try {
        if (readdirSync(path).some((candidate) => (
          PREPARED_MARKER_PATTERN.test(candidate)
          || COMMITTED_MARKER_PATTERN.test(candidate)
          || ABORTED_MARKER_PATTERN.test(candidate)
        ))) {
          throw new RevisionAppendConflictError(
            `Revision intent ticket ${entry} has an invalid state marker and cannot be recovered safely: ${errorMessage(error)}`,
          );
        }
      } catch (inspectionError) {
        if (inspectionError instanceof RevisionAppendConflictError) throw inspectionError;
      }
      if (!candidateIsOld(path)) {
        throw new RevisionAppendBusyError(
          "Another Scripture Library process is publishing an authored-change candidate. Retry shortly.",
        );
      }
      publishCorruptAbortMarker(leaseDir, path);
      states.push({ kind: "terminal", path, ticket });
    }
  }
  return states.sort(compareTicketStates);
}

function inspectTicketState(path: string, ticket: number): TicketState {
  const entries = readdirSync(path);
  const committedMarkers = entries.filter((entry) => COMMITTED_MARKER_PATTERN.test(entry));
  const abortedMarkers = entries.filter((entry) => ABORTED_MARKER_PATTERN.test(entry));
  if (committedMarkers.length > 1) throw new Error("ticket has conflicting committed markers");
  if (committedMarkers.length === 1) {
    validateTerminalMarker(path, committedMarkers[0]!, "committed");
    return terminalTicketState(path, ticket);
  }
  const preparedMarkers = entries.filter((entry) => PREPARED_MARKER_PATTERN.test(entry));
  if (preparedMarkers.length > 1) throw new Error("ticket has conflicting prepared markers");
  if (preparedMarkers.length === 1) {
    const claim: CandidateClaim = { path, ticket, intent: loadCandidateIntent(path) };
    return { kind: "prepared", claim, prepared: loadPreparedIntent(path) };
  }
  if (abortedMarkers.length > 0) {
    for (const marker of abortedMarkers) validateTerminalMarker(path, marker, "aborted");
    return terminalTicketState(path, ticket);
  }
  return { kind: "candidate", claim: { path, ticket, intent: loadCandidateIntent(path) } };
}

function terminalTicketState(path: string, ticket: number): TicketState {
  try {
    return { kind: "terminal", path, ticket, owner: loadCandidateIntent(path).owner };
  } catch {
    return { kind: "terminal", path, ticket };
  }
}

function validateTerminalMarker(
  ticketPath: string,
  markerName: string,
  expectedState: "aborted" | "committed",
): void {
  const parsed = readJson(join(ticketPath, markerName));
  if (!isRecord(parsed) || parsed["version"] !== 1) throw new Error("terminal marker is invalid");
  if (expectedState === "committed") {
    const match = COMMITTED_MARKER_PATTERN.exec(markerName);
    if (!match || parsed["state"] !== "committed" || parsed["token"] !== match[1]) {
      throw new Error("committed marker is invalid");
    }
    return;
  }
  if (markerName.startsWith("aborted-corrupt-")) {
    if (parsed["state"] !== "aborted-corrupt") throw new Error("corrupt-abort marker is invalid");
    return;
  }
  const match = /^aborted-([0-9a-f-]{36})\.json$/.exec(markerName);
  if (!match || parsed["state"] !== "aborted" || parsed["token"] !== match[1]) {
    throw new Error("aborted marker is invalid");
  }
}

function ticketOf(state: TicketState): number {
  return state.kind === "terminal" ? state.ticket : state.claim.ticket;
}

function compareTicketStates(left: TicketState, right: TicketState): number {
  const byNumber = ticketOf(left) - ticketOf(right);
  return byNumber !== 0 ? byNumber : pathOf(left).localeCompare(pathOf(right));
}

function pathOf(state: TicketState): string {
  return state.kind === "terminal" ? state.path : state.claim.path;
}

function highestTicket(leaseDir: string): number {
  let highest = -1;
  for (const entry of readdirSync(leaseDir)) {
    const match = TICKET_PATTERN.exec(entry);
    if (!match) continue;
    const ticket = Number(match[1]);
    if (Number.isSafeInteger(ticket)) highest = Math.max(highest, ticket);
  }
  return highest;
}

function completePreparedTarget(
  libraryPath: string,
  prepared: PreparedIntent,
  faultHooks: RevisionAppendFaultHooks,
  permitSameCallRecovery = true,
): void {
  const relativePath = prepared.append.path;
  const absolutePath = join(libraryPath, relativePath);
  const content = Buffer.from(prepared.append.content, "utf8");
  const state = inspectPreparedTarget(absolutePath, prepared, content);
  if (state.missing.length > 0) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    try {
      appendTargetSuffix(absolutePath, state.missing, state.appliedBytes, faultHooks);
    } catch (error) {
      if (error instanceof AbandonPreparedIntentError) throw error.original;
      if (!permitSameCallRecovery) throw error;
      try {
        completePreparedTarget(libraryPath, prepared, {}, false);
        return;
      } catch (recoveryError) {
        throw new Error(
          `Revision append could not be confirmed after a storage error: ${errorMessage(error)}; recovery: ${errorMessage(recoveryError)}`,
          { cause: error },
        );
      }
    }
  } else {
    confirmFileDurability(absolutePath);
  }

  // Re-read after the append/confirmation so a terminal marker can never
  // bless a divergent or incomplete target.
  const confirmed = inspectPreparedTarget(absolutePath, prepared, content);
  if (confirmed.missing.length !== 0) {
    throw preparedTargetConflict(prepared, relativePath);
  }
  confirmFileDurability(absolutePath);
  fsyncDirectory(dirname(absolutePath));
  faultHooks.afterTargetParentFsync?.();
}

function inspectPreparedTarget(
  absolutePath: string,
  prepared: PreparedIntent,
  content: Buffer,
): { missing: Buffer; appliedBytes: number } {
  const target = existsSync(absolutePath) ? readFileSyncInterruptible(absolutePath) : Buffer.alloc(0);
  const expected = prepared.append.expectedByteLength;
  if (target.length < expected) {
    throw preparedTargetConflict(prepared, prepared.append.path);
  }
  if (sha256(target.subarray(0, expected)) !== prepared.proof.baseSha256) {
    throw preparedTargetConflict(prepared, prepared.append.path);
  }
  const suffix = target.subarray(expected);
  if (suffix.length > content.length || !content.subarray(0, suffix.length).equals(suffix)) {
    throw preparedTargetConflict(prepared, prepared.append.path);
  }
  return {
    missing: content.subarray(suffix.length),
    appliedBytes: suffix.length,
  };
}

function preparedTargetConflict(prepared: PreparedIntent, relativePath: string): RevisionAppendConflictError {
  return new RevisionAppendConflictError(
    `Prepared revision intent ${prepared.token} does not match target ${relativePath}; refusing to alter existing bytes.`,
  );
}

function appendTargetSuffix(
  absolutePath: string,
  missing: Buffer,
  alreadyAppliedBytes: number,
  faultHooks: RevisionAppendFaultHooks,
): void {
  let fd: number | null = null;
  let primaryError: unknown = null;
  try {
    fd = openSync(absolutePath, "a", 0o600);
    writeAll(fd, missing, {
      maxWriteChunkBytes: faultHooks.maxWriteChunkBytes,
      afterWriteChunk: (written) => {
        const total = alreadyAppliedBytes + written;
        faultHooks.afterWriteChunk?.(total);
        if (faultHooks.afterTargetWriteChunkWithoutRecovery) {
          try {
            faultHooks.afterTargetWriteChunkWithoutRecovery(total);
          } catch (error) {
            throw new AbandonPreparedIntentError(error);
          }
        }
      },
    });
    faultHooks.beforeInitialFsync?.();
    fsyncSync(fd);
  } catch (error) {
    primaryError = error;
  }
  if (fd !== null) {
    try {
      closeSync(fd);
    } catch (error) {
      primaryError ??= error;
      try { closeSync(fd); } catch { /* target validation below is authoritative */ }
    }
  }
  if (primaryError !== null) throw primaryError;
}

class AbandonPreparedIntentError extends Error {
  constructor(readonly original: unknown) {
    super(errorMessage(original));
    this.name = "AbandonPreparedIntentError";
  }
}

function writePreparedProof(candidatePath: string, intent: CandidateIntent, base: Buffer): void {
  const proof: PreparedProof = {
    version: 1,
    token: intent.token,
    baseByteLength: base.length,
    baseSha256: sha256(base),
  };
  publishAtomicMarker(candidatePath, `prepared-${intent.token}.json`, proof);
  fsyncDirectory(dirname(candidatePath));
}

function retireCandidate(
  leaseDir: string,
  claim: CandidateClaim,
  faultHooks: RevisionAppendFaultHooks,
): void {
  if (!existsSync(claim.path)) return;
  const current = inspectTicketState(claim.path, claim.ticket);
  if (current.kind !== "candidate" || current.claim.intent.token !== claim.intent.token) return;
  publishTerminalMarker(leaseDir, claim.path, "aborted", claim.intent.token, faultHooks);
  cleanupTerminalTickets(leaseDir, faultHooks);
}

function publishCorruptAbortMarker(leaseDir: string, ticketPath: string): void {
  if (!existsSync(ticketPath)) return;
  publishAtomicMarker(
    ticketPath,
    `aborted-corrupt-${randomUUID()}.json`,
    { version: 1, state: "aborted-corrupt" },
  );
  fsyncDirectory(leaseDir);
}

function publishTerminalMarker(
  leaseDir: string,
  ticketPath: string,
  state: "aborted" | "committed",
  token: string,
  faultHooks: RevisionAppendFaultHooks,
): void {
  const markerName = `${state}-${token}.json`;
  if (!existsSync(join(ticketPath, markerName))) {
    publishAtomicMarker(
      ticketPath,
      markerName,
      { version: 1, state, token },
      state === "committed" ? faultHooks.afterTerminalMarkerRenameBeforeFsync : undefined,
    );
  }
  fsyncDirectory(ticketPath);
  fsyncDirectory(leaseDir);
}

function cleanupTerminalTickets(
  leaseDir: string,
  faultHooks: RevisionAppendFaultHooks,
): void {
  try {
    faultHooks.beforeTerminalCleanup?.();
    // A staging allocator may already have chosen max+1 and be delayed before
    // its atomic rename. Removing that terminal pathname here would let the
    // delayed allocator reuse a lower ticket beneath a newer live writer.
    if (readdirSync(leaseDir).some((entry) => entry.startsWith(".creating-"))) return;
    const states = inspectTicketStates(leaseDir);
    const maximum = states.at(-1);
    if (!maximum) return;
    let removedDirectory = false;
    for (const state of states) {
      if (state.kind !== "terminal") continue;
      if (state.owner && persistedOwnerIsActive(state.owner, faultHooks)) continue;
      if (compareTicketStates(state, maximum) < 0) {
        rmSync(state.path, { recursive: true, force: true });
        removedDirectory = true;
        continue;
      }
      // The greatest ticket directory is the durable high-water tombstone.
      // Reclaim its potentially large intent while retaining its immutable
      // terminal marker and pathname so allocation can never reuse a number.
      for (const entry of readdirSync(state.path)) {
        if (COMMITTED_MARKER_PATTERN.test(entry) || ABORTED_MARKER_PATTERN.test(entry)) continue;
        rmSync(join(state.path, entry), { recursive: true, force: true });
      }
      fsyncDirectory(state.path);
    }
    if (removedDirectory) fsyncDirectory(leaseDir);
  } catch {
    // Terminal cleanup is bounded storage reclamation only. At least the
    // greatest observed terminal ticket remains the durable allocation floor.
  }
}

function cleanupCreatingEntries(
  leaseDir: string,
  currentOwner: IntentOwner,
  faultHooks: RevisionAppendFaultHooks,
): void {
  for (const entry of readdirSync(leaseDir)) {
    if (!entry.startsWith(".creating-")) continue;
    const path = join(leaseDir, entry);
    let shouldRemove = candidateIsOld(path);
    try {
      const intent = loadCandidateIntent(path);
      shouldRemove = !ownerIsActive(intent.owner, currentOwner, faultHooks);
    } catch {
      // A live creator may not have published candidate.json yet. It never
      // participates in election or recovery; only an old one is reclaimed.
    }
    if (!shouldRemove) continue;
    try {
      rmSync(path, { recursive: true, force: true });
      fsyncDirectory(leaseDir);
    } catch {
      // Unique staging names are never election/recovery inputs.
    }
  }
}

function loadCandidateIntent(stagePath: string): CandidateIntent {
  const parsed = readJson(join(stagePath, CANDIDATE_FILE));
  if (!isRecord(parsed) || parsed["version"] !== 1) throw new Error("candidate version is invalid");
  const token = parsed["token"];
  const owner = parsed["owner"];
  const rawAppend = parsed["append"];
  const contentSha256 = parsed["contentSha256"];
  if (!isUuid(token) || !isRecord(owner) || !isRecord(rawAppend)) {
    throw new Error("candidate envelope is invalid");
  }
  const validatedOwner = validateIntentOwner(owner, token);
  const append = revisionAppendFromRecord(rawAppend);
  if (typeof contentSha256 !== "string" || contentSha256 !== sha256(Buffer.from(append.content, "utf8"))) {
    throw new Error("candidate content digest is invalid");
  }
  return { version: 1, token, owner: validatedOwner, append, contentSha256 };
}

function loadPreparedIntent(preparedPath: string): PreparedIntent {
  const candidate = loadCandidateIntent(preparedPath);
  const markers = readdirSync(preparedPath).filter((entry) => PREPARED_MARKER_PATTERN.test(entry));
  if (markers.length !== 1) throw new Error("prepared marker count is invalid");
  const parsed = readJson(join(preparedPath, markers[0]!));
  if (!isRecord(parsed) || parsed["version"] !== 1 || parsed["token"] !== candidate.token) {
    throw new Error("prepared proof is invalid");
  }
  const baseByteLength = parsed["baseByteLength"];
  const baseSha256 = parsed["baseSha256"];
  if (
    !Number.isSafeInteger(baseByteLength)
    || baseByteLength !== candidate.append.expectedByteLength
    || typeof baseSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(baseSha256)
  ) {
    throw new Error("prepared base proof is invalid");
  }
  return {
    ...candidate,
    proof: { version: 1, token: candidate.token, baseByteLength, baseSha256 },
  };
}

function revisionAppendFromRecord(raw: Record<string, unknown>): RevisionAppend {
  const path = raw["path"];
  const append: RevisionAppend = {
    kind: raw["kind"] as RevisionAppend["kind"],
    path: typeof path === "string" ? path : "",
    content: typeof raw["content"] === "string" ? raw["content"] : "",
    expectedByteLength: raw["expectedByteLength"] as number,
    commandId: typeof raw["commandId"] === "string" ? raw["commandId"] : "",
    commandFingerprint: typeof raw["commandFingerprint"] === "string"
      ? raw["commandFingerprint"]
      : "",
  };
  validateAppendMetadata(append);
  const normalized = normalizeRelativeJsonlPath(append.path);
  if (normalized !== append.path) throw new Error("candidate path is not canonical");
  validateSingleJsonlEvent(append.content, append.commandId, append.commandFingerprint);
  return append;
}

function validateIntentOwner(raw: Record<string, unknown>, token: string): IntentOwner {
  const pid = raw["pid"];
  const ownerThreadId = raw["threadId"];
  const processStartIdentity = raw["processStartIdentity"];
  const createdAtMs = raw["createdAtMs"];
  if (
    !Number.isSafeInteger(pid)
    || (pid as number) <= 0
    || !Number.isSafeInteger(ownerThreadId)
    || (ownerThreadId as number) < 0
    || (processStartIdentity !== null && (
      typeof processStartIdentity !== "string"
      || processStartIdentity.length > 512
    ))
    || raw["token"] !== token
    || typeof createdAtMs !== "number"
    || !Number.isFinite(createdAtMs)
  ) {
    throw new Error("candidate owner is invalid");
  }
  return {
    pid: pid as number,
    threadId: ownerThreadId as number,
    processStartIdentity,
    token,
    createdAtMs,
  };
}

function createIntentOwner(faultHooks: RevisionAppendFaultHooks): IntentOwner {
  const token = randomUUID();
  return {
    pid: process.pid,
    threadId,
    processStartIdentity: inspectProcessStartIdentity(process.pid, faultHooks),
    token,
    createdAtMs: Date.now(),
  };
}

function ownerIsActive(
  owner: IntentOwner,
  currentOwner: IntentOwner,
  faultHooks: RevisionAppendFaultHooks,
): boolean {
  if (
    owner.pid === currentOwner.pid
    && owner.threadId === currentOwner.threadId
    && owner.processStartIdentity === currentOwner.processStartIdentity
  ) {
    return ACTIVE_INTENT_TOKENS.has(owner.token);
  }
  if (!processIsAlive(owner.pid)) return false;
  if (owner.processStartIdentity !== null) {
    const currentIdentity = inspectProcessStartIdentity(owner.pid, faultHooks);
    if (currentIdentity !== null && currentIdentity !== owner.processStartIdentity) return false;
  }
  return true;
}

function persistedOwnerIsActive(
  owner: IntentOwner,
  faultHooks: RevisionAppendFaultHooks,
): boolean {
  const currentStartIdentity = inspectProcessStartIdentity(process.pid, faultHooks);
  if (
    owner.pid === process.pid
    && owner.threadId === threadId
    && owner.processStartIdentity === currentStartIdentity
  ) {
    return ACTIVE_INTENT_TOKENS.has(owner.token);
  }
  if (!processIsAlive(owner.pid)) return false;
  if (owner.processStartIdentity !== null) {
    const observedIdentity = inspectProcessStartIdentity(owner.pid, faultHooks);
    if (observedIdentity !== null && observedIdentity !== owner.processStartIdentity) return false;
  }
  return true;
}

function assertNoActiveLegacyLease(leaseDir: string, currentOwner: IntentOwner): void {
  for (const entry of readdirSync(leaseDir)) {
    const match = LEGACY_LEASE_PATTERN.exec(entry);
    if (!match) continue;
    const path = join(leaseDir, entry);
    const pid = Number(match[1]);
    // A legacy lease cannot prove a process-start generation. A same-process
    // entry is necessarily from an already-returned synchronous append and is
    // safe to retire; this also prevents old cleanup failures self-locking the
    // upgraded process. Other live PIDs remain a migration-time exclusion.
    if (pid !== currentOwner.pid && Number.isSafeInteger(pid) && processIsAlive(pid)) {
      throw new RevisionAppendBusyError(
        "Another Scripture Library process is committing an authored change. Retry this command once it finishes.",
      );
    }
    try { rmSync(path, { force: true }); } catch { /* a legacy owner may be exiting */ }
  }
}

function inspectProcessStartIdentity(pid: number, faultHooks: RevisionAppendFaultHooks): string | null {
  try {
    if (faultHooks.processStartIdentity) return boundedIdentity(faultHooks.processStartIdentity(pid));
    if (pid === process.pid && cachedDefaultCurrentProcessIdentity !== undefined) {
      return cachedDefaultCurrentProcessIdentity;
    }
    const identity = defaultProcessStartIdentity(pid);
    if (pid === process.pid) cachedDefaultCurrentProcessIdentity = identity;
    return identity;
  } catch {
    return null;
  }
}

function defaultProcessStartIdentity(pid: number): string | null {
  if (process.platform === "linux") {
    const stat = readFileSyncInterruptible(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return null;
    const fieldsAfterCommand = stat.slice(closeParen + 1).trim().split(/\s+/);
    const startTicks = fieldsAfterCommand[19];
    return startTicks ? `linux:${startTicks}` : null;
  }
  if (process.platform === "darwin") {
    const output = execFileSyncInterruptible("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      maxBuffer: 4_096,
      timeout: 250,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output ? `darwin:${output}` : null;
  }
  return null;
}

function boundedIdentity(value: string | null): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcessError(error);
  }
}

function candidateIsOld(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs >= INVALID_CANDIDATE_STALE_MS;
  } catch (error) {
    return !isMissingError(error);
  }
}

function ticketName(ticket: number, token: string): string {
  return `ticket-${String(ticket).padStart(16, "0")}-${token}`;
}

function publishAtomicMarker(
  directory: string,
  markerName: string,
  value: unknown,
  afterRenameBeforeFsync?: () => void,
): void {
  const markerPath = join(directory, markerName);
  if (existsSync(markerPath)) return;
  const stagingPath = join(directory, `.${markerName}.${randomUUID()}.tmp`);
  writeDurableJson(stagingPath, value);
  fsyncDirectory(directory);
  try {
    if (!existsSync(markerPath)) {
      renameSync(stagingPath, markerPath);
      afterRenameBeforeFsync?.();
    }
  } finally {
    if (existsSync(stagingPath)) rmSync(stagingPath, { force: true });
  }
  fsyncDirectory(directory);
}

function writeDurableJson(path: string, value: unknown): void {
  const fd = openSync(path, "wx", 0o600);
  let wroteAndSynced = false;
  try {
    writeAll(fd, Buffer.from(JSON.stringify(value), "utf8"));
    fsyncSync(fd);
    wroteAndSynced = true;
  } finally {
    try {
      closeSync(fd);
    } catch (error) {
      if (!wroteAndSynced) throw error;
    }
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSyncInterruptible(path, "utf8")) as unknown;
}

function writeAll(
  fd: number,
  content: Buffer,
  options: Pick<RevisionAppendFaultHooks, "maxWriteChunkBytes" | "afterWriteChunk"> = {},
): void {
  let offset = 0;
  while (offset < content.length) {
    const remaining = content.length - offset;
    const requested = options.maxWriteChunkBytes == null
      ? remaining
      : Math.min(remaining, Math.max(1, options.maxWriteChunkBytes));
    const written = writeSync(fd, content, offset, requested, null);
    if (written <= 0) throw new Error("Revision append made no write progress.");
    offset += written;
    options.afterWriteChunk?.(offset);
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  let synced = false;
  try {
    fsyncSync(fd);
    synced = true;
  } finally {
    try {
      closeSync(fd);
    } catch (error) {
      if (!synced) throw error;
    }
  }
}

function confirmFileDurability(absolutePath: string): void {
  const fd = openSync(absolutePath, "r");
  let synced = false;
  try {
    fsyncSync(fd);
    synced = true;
  } finally {
    try {
      closeSync(fd);
    } catch (error) {
      if (!synced) throw error;
    }
  }
}

function validateAppendMetadata(append: RevisionAppend): void {
  if (append.kind !== "append-jsonl") {
    throw new Error(`Unsupported revision append kind: ${String(append.kind)}`);
  }
  if (!Number.isSafeInteger(append.expectedByteLength) || append.expectedByteLength < 0) {
    throw new Error("Revision append expectedByteLength must be a non-negative safe integer.");
  }
  if (!isValidCommandId(append.commandId)) {
    throw new Error("Revision append commandId is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(append.commandFingerprint)) {
    throw new Error("Revision append commandFingerprint must be a lowercase SHA-256 digest.");
  }
  if (Buffer.byteLength(append.content, "utf8") > MAX_REVISION_APPEND_BYTES) {
    throw new Error(`Revision append content exceeds ${MAX_REVISION_APPEND_BYTES} bytes.`);
  }
}

function normalizeRelativeJsonlPath(filePath: string): string {
  const normalized = normalize(filePath);
  if (
    !filePath.trim()
    || isAbsolute(normalized)
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
    || !normalized.endsWith(".jsonl")
  ) {
    throw new Error(`Revision append path must be a relative JSONL file: ${filePath}`);
  }
  return normalized;
}

function validateSingleJsonlEvent(
  content: string,
  commandId: string,
  commandFingerprint: string,
): CommandEnvelope {
  if (!content.endsWith("\n") || content.slice(0, -1).includes("\n")) {
    throw new Error("Revision append content must be exactly one newline-terminated JSONL event.");
  }
  const line = content.slice(0, -1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Revision append content must contain valid JSON.");
  }
  const envelope = commandEnvelopeFromParsed(parsed);
  if (!envelope || envelope.commandId !== commandId) {
    throw new Error("Revision append commandId must equal the event envelope commandId.");
  }
  if (envelope.commandFingerprint !== commandFingerprint) {
    throw new Error("Revision append commandFingerprint must equal the event envelope fingerprint.");
  }
  return envelope;
}

function commandEnvelopeFromParsed(parsed: unknown): CommandEnvelope | null {
  if (!isRecord(parsed)) return null;
  const eventId = parsed["eventId"];
  const commandId = parsed["commandId"];
  const commandFingerprint = parsed["commandFingerprint"];
  const createdAt = parsed["createdAt"];
  if (
    typeof eventId !== "string"
    || !isValidCommandId(commandId)
    || typeof commandFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(commandFingerprint)
  ) {
    return null;
  }
  return {
    eventId,
    commandId,
    commandFingerprint,
    createdAt: typeof createdAt === "string" ? createdAt : "",
    ...(typeof parsed["entityId"] === "string" ? { entityId: parsed["entityId"] } : {}),
  };
}

function resultFromEnvelope(
  path: string,
  alreadyApplied: boolean,
  envelope: CommandEnvelope,
): RevisionAppendResult {
  return {
    path,
    alreadyApplied,
    eventId: envelope.eventId,
    commandId: envelope.commandId,
    commandFingerprint: envelope.commandFingerprint,
    createdAt: envelope.createdAt,
    ...(envelope.entityId ? { entityId: envelope.entityId } : {}),
  };
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isValidCommandId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error["code"] === "string" ? error["code"] : undefined;
}

function isMissingError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isNoSuchProcessError(error: unknown): boolean {
  return errorCode(error) === "ESRCH";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
