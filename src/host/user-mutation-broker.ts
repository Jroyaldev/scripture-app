import { createHash } from "node:crypto";
import type { RevisionReceipt, RevisionStore } from "../core/interfaces.js";
import type {
  ConnectionAnchorV2,
  ConnectionRecord,
  CreateConnectionInput,
} from "../core/annotations/types.js";
import {
  CONNECTION_FORMAT_VERSION_V2,
  CONNECTION_KINDS,
  MAX_CONNECTION_ANCHORS,
  MAX_CONNECTION_LABEL_LENGTH,
  MAX_CONNECTION_OBSERVATION_LENGTH,
} from "../core/annotations/types.js";
import {
  BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR,
} from "../core/annotations/backbone-token-anchor.js";
import type { LibraryEngine, PlannedConnectionMutation } from "./library.js";

export type UserConnectionMutationAction =
  | "connection:create"
  | "connection:update"
  | "connection:delete";

/** Minted only by first-party IPC handlers after an explicit user command. */
export type ExplicitUserMutationIntent = {
  source: "first-party-ui";
  commandId: string;
  action: UserConnectionMutationAction;
};

export type ConnectionMutationCommit = {
  receipt: RevisionReceipt;
  connection?: ConnectionRecord;
  projection: "current" | "rebuilt" | "pending";
  projectionError?: string;
};

type CommandEntry = {
  fingerprint: string;
  promise: Promise<ConnectionMutationCommit>;
  retainedBytes: number;
  settled: boolean;
};

const MAX_RECENT_COMMANDS = 512;
const MAX_PENDING_COMMANDS = 64;
const MAX_SETTLED_COMMAND_BYTES = 2 * 1_024 * 1_024;
const COMMAND_ENTRY_OVERHEAD_BYTES = 4 * 1_024;
/**
 * Keep authored connection events comfortably below RevisionAppendCoordinator's
 * 512 KiB single-line ceiling. The 128 KiB reserve covers the event envelope,
 * command identity, format metadata, and future compatible envelope growth.
 */
const MAX_CONNECTION_CANONICAL_INPUT_BYTES = 384 * 1_024;
const MAX_CONNECTION_BOOK_CODE_LENGTH = 8;
const MAX_CONNECTION_TOKEN_LAYER_LENGTH = 128;

const CONNECTION_INPUT_KEYS = ["kind", "label", "observation", "anchors"] as const;
const EXACT_ANCHOR_KEYS = ["book", "chapter", "verse_start", "verse_end", "exact"] as const;
const EXACT_SELECTOR_KEYS = ["format_version", "layer", "occurrences"] as const;
const EXACT_OCCURRENCE_KEYS = ["verse", "position"] as const;
const CONNECTION_KIND_SET: ReadonlySet<string> = new Set(CONNECTION_KINDS);
const BINARY_CONNECTION_KIND_SET: ReadonlySet<string> = new Set([
  "link:contrast",
  "mirror",
  "hinge",
]);

type BoundedConnectionInput = {
  value: CreateConnectionInput;
  retainedBytes: number;
};

/**
 * First-party authored-mutation boundary.
 *
 * This broker is deliberately separate from CapabilityBroker: plugins never
 * receive an instance or a `write:substrate` capability. It serializes plans,
 * deduplicates a retried UI command, delegates the authoritative append to
 * RevisionStore, and only then refreshes disposable Derived state.
 */
export class UserMutationBroker {
  private mutationTail: Promise<void> = Promise.resolve();
  private commands = new Map<string, CommandEntry>();
  private pendingCommandCount = 0;
  private settledCommandBytes = 0;

  constructor(
    private readonly engine: LibraryEngine,
    private readonly revisionStore: RevisionStore,
  ) {}

  createConnection(
    intent: ExplicitUserMutationIntent,
    input: CreateConnectionInput,
  ): Promise<ConnectionMutationCommit> {
    validateIntent(intent, "connection:create");
    let bounded: BoundedConnectionInput;
    try {
      bounded = boundedConnectionInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    const boundedInput = bounded.value;
    return this.run(
      intent,
      commandFingerprint([
        "connection:create",
        CONNECTION_FORMAT_VERSION_V2,
        boundedInput,
      ]),
      bounded.retainedBytes,
      `Create ${boundedInput.kind} connection`,
      () => validateCurrentConnectionInput(boundedInput),
      (fingerprint) => this.engine.planConnectionCreate(boundedInput, {
        commandId: intent.commandId,
        commandFingerprint: fingerprint,
      }),
    );
  }

  updateConnection(
    intent: ExplicitUserMutationIntent,
    connectionId: string,
    input: CreateConnectionInput,
    expectedBaseEventId: string,
  ): Promise<ConnectionMutationCommit> {
    validateIntent(intent, "connection:update");
    let boundedConnectionId: string;
    let boundedExpectedBaseEventId: string;
    let bounded: BoundedConnectionInput;
    try {
      boundedConnectionId = boundedEntityId(connectionId);
      boundedExpectedBaseEventId = boundedEventId(expectedBaseEventId);
      bounded = boundedConnectionInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    const boundedInput = bounded.value;
    return this.run(
      intent,
      commandFingerprint([
        "connection:update",
        CONNECTION_FORMAT_VERSION_V2,
        boundedConnectionId,
        boundedExpectedBaseEventId,
        boundedInput,
      ]),
      bounded.retainedBytes
        + Buffer.byteLength(boundedConnectionId, "utf8")
        + Buffer.byteLength(boundedExpectedBaseEventId, "utf8"),
      `Update ${boundedInput.kind} connection`,
      () => validateCurrentConnectionInput(boundedInput),
      (fingerprint) => this.engine.planConnectionUpdate(boundedConnectionId, boundedInput, {
        commandId: intent.commandId,
        commandFingerprint: fingerprint,
      }, boundedExpectedBaseEventId),
    );
  }

  deleteConnection(
    intent: ExplicitUserMutationIntent,
    connectionId: string,
    expectedBaseEventId: string,
  ): Promise<ConnectionMutationCommit> {
    validateIntent(intent, "connection:delete");
    let boundedConnectionId: string;
    let boundedExpectedBaseEventId: string;
    try {
      boundedConnectionId = boundedEntityId(connectionId);
      boundedExpectedBaseEventId = boundedEventId(expectedBaseEventId);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.run(
      intent,
      commandFingerprint([
        "connection:delete",
        boundedConnectionId,
        boundedExpectedBaseEventId,
      ]),
      COMMAND_ENTRY_OVERHEAD_BYTES
        + Buffer.byteLength(boundedConnectionId, "utf8")
        + Buffer.byteLength(boundedExpectedBaseEventId, "utf8"),
      "Delete connection",
      undefined,
      (fingerprint) => this.engine.planConnectionDelete(boundedConnectionId, {
        commandId: intent.commandId,
        commandFingerprint: fingerprint,
      }, boundedExpectedBaseEventId),
    );
  }

  private run(
    intent: ExplicitUserMutationIntent,
    fingerprint: string,
    retainedBytes: number,
    label: string,
    preflight: (() => void) | undefined,
    plan: (fingerprint: string) => PlannedConnectionMutation,
  ): Promise<ConnectionMutationCommit> {
    const existing = this.commands.get(intent.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new Error(
          `User mutation command ${intent.commandId} was reused for different content.`,
        ));
      }
      if (!existing.settled) return existing.promise;
      // A later command may have updated or tombstoned this entity. Re-enter
      // the durable replay path so the response is resolved against the
      // current folded Substrate head instead of returning a cached historical
      // ConnectionRecord that a failed renderer refresh could resurrect.
      this.commands.delete(intent.commandId);
      this.settledCommandBytes -= existing.retainedBytes;
    }
    try {
      preflight?.();
    } catch (validationError) {
      // A hot entry may have been evicted (including the deliberate
      // projection-pending eviction). Probe the engine's durable command index
      // before returning a semantic refusal so a changed layer/version still
      // collides with the original command across restart. Planning is
      // side-effect-free until validation succeeds and no append/cache entry is
      // created on this refusal path.
      try {
        plan(fingerprint);
      } catch (planError) {
        if (isCommandReuseError(planError)) return Promise.reject(planError);
      }
      return Promise.reject(validationError);
    }
    if (this.pendingCommandCount >= MAX_PENDING_COMMANDS) {
      return Promise.reject(new Error(
        "Too many authored changes are already waiting. Let the current save finish, then retry.",
      ));
    }

    const entry: CommandEntry = {
      fingerprint,
      retainedBytes,
      settled: false,
      promise: Promise.resolve(null as never),
    };
    const promise = this.serialize(async () => {
      const planned = plan(fingerprint);
      const txn = await this.revisionStore.beginTransaction(label);
      const receipt = await this.revisionStore.commitAppend(txn, planned.append);
      const authoritative = this.engine.resolveCommittedConnectionMutation(planned, receipt);
      const projection = this.projectWithOneRecovery(authoritative);
      return {
        receipt,
        ...(authoritative.action === "upsert" ? { connection: authoritative.connection } : {}),
        ...projection,
      };
    });
    entry.promise = promise;
    this.commands.set(intent.commandId, entry);
    this.pendingCommandCount++;
    void promise.then(
      (result) => {
        this.pendingCommandCount--;
        if (result.projection === "pending") {
          // A same-id explicit Retry must be able to rerun Derived recovery;
          // the authoritative append remains an idempotent no-op.
          if (this.commands.get(intent.commandId) === entry) {
            this.commands.delete(intent.commandId);
          }
          return;
        }
        entry.retainedBytes = committedResultRetainedBytes(result);
        entry.settled = true;
        this.settledCommandBytes += entry.retainedBytes;
        this.pruneCommands();
      },
      () => {
        this.pendingCommandCount--;
        if (this.commands.get(intent.commandId) === entry) {
          this.commands.delete(intent.commandId);
        }
      },
    );
    return promise;
  }

  private projectWithOneRecovery(
    plan: PlannedConnectionMutation,
  ): Pick<ConnectionMutationCommit, "projection" | "projectionError"> {
    try {
      this.engine.projectCommittedConnectionMutation(plan);
      return { projection: "current" };
    } catch (error) {
      const projectionError = errorMessage(error);
      try {
        this.engine.buildSqlite();
        if (!this.engine.isConnectionProjectionCurrent()) {
          throw new Error(
            "Connection Substrate changed during the bounded Derived rebuild.",
          );
        }
        return { projection: "rebuilt", projectionError };
      } catch (rebuildError) {
        return {
          projection: "pending",
          projectionError: `${projectionError}; rebuild failed: ${errorMessage(rebuildError)}`,
        };
      }
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private pruneCommands(): void {
    if (
      this.commands.size <= MAX_RECENT_COMMANDS
      && this.settledCommandBytes <= MAX_SETTLED_COMMAND_BYTES
    ) return;
    for (const [commandId, entry] of this.commands) {
      if (!entry.settled) continue;
      this.commands.delete(commandId);
      this.settledCommandBytes -= entry.retainedBytes;
      if (
        this.commands.size <= MAX_RECENT_COMMANDS
        && this.settledCommandBytes <= MAX_SETTLED_COMMAND_BYTES
      ) return;
    }
  }
}

function validateIntent(
  intent: ExplicitUserMutationIntent,
  expectedAction: UserConnectionMutationAction,
): void {
  if (intent.source !== "first-party-ui") {
    throw new Error("Authored connection mutations require a first-party user intent.");
  }
  if (intent.action !== expectedAction) {
    throw new Error(`User mutation intent ${intent.action} cannot perform ${expectedAction}.`);
  }
  if (
    typeof intent.commandId !== "string"
    || intent.commandId.length < 8
    || intent.commandId.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(intent.commandId)
  ) {
    throw new Error("User mutation commandId is invalid.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCommandReuseError(error: unknown): boolean {
  return error instanceof Error
    && /User mutation command .* was reused for different content\./.test(error.message);
}

function commandFingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function committedResultRetainedBytes(result: ConnectionMutationCommit): number {
  return Buffer.byteLength(stableStringify(result), "utf8")
    + COMMAND_ENTRY_OVERHEAD_BYTES;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return candidate;
    }
    const source = candidate as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = source[key];
    return sorted;
  });
}

function boundedEntityId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error("Connection id is invalid.");
  }
  return value;
}

function boundedEventId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error("Connection expectedBaseEventId is invalid.");
  }
  return value;
}

/**
 * Copy only the closed durable shape before hashing it. Besides enforcing
 * byte bounds, this prevents arbitrary IPC-only extra fields from being
 * retained in fingerprints or command caches.
 */
function boundedConnectionInput(value: unknown): BoundedConnectionInput {
  if (!isRecord(value) || !hasOnlyKeys(value, CONNECTION_INPUT_KEYS)) {
    throw new Error("Connection input must contain only kind, label, observation, and anchors.");
  }
  const kind = value["kind"];
  const label = value["label"];
  const observation = value["observation"];
  const rawAnchors = value["anchors"];
  if (typeof kind !== "string" || kind.length === 0 || kind.length > 64) {
    throw new Error("Connection kind is invalid.");
  }
  if (
    typeof label !== "string"
    || label.length === 0
    || label.length > MAX_CONNECTION_LABEL_LENGTH
  ) {
    throw new Error(`Connection label must be no longer than ${MAX_CONNECTION_LABEL_LENGTH} characters.`);
  }
  // Length is checked first so an untrusted multi-megabyte whitespace label
  // cannot force a trim scan before the cheap bound rejects it.
  if (label.trim().length === 0) {
    throw new Error(`Connection label must be no longer than ${MAX_CONNECTION_LABEL_LENGTH} characters.`);
  }
  if (
    typeof observation !== "string"
    || observation.length > MAX_CONNECTION_OBSERVATION_LENGTH
  ) {
    throw new Error(
      `Connection observation must be no longer than ${MAX_CONNECTION_OBSERVATION_LENGTH} characters.`,
    );
  }
  if (
    !Array.isArray(rawAnchors)
    || rawAnchors.length < 2
    || rawAnchors.length > MAX_CONNECTION_ANCHORS
  ) {
    throw new Error(`Connection requires 2 to ${MAX_CONNECTION_ANCHORS} anchors.`);
  }

  const anchors: ConnectionAnchorV2[] = [];
  let aggregateAnchorBytes = 0;
  for (let index = 0; index < rawAnchors.length; index++) {
    const rawAnchor = rawAnchors[index];
    if (!isRecord(rawAnchor) || !hasOnlyKeys(rawAnchor, EXACT_ANCHOR_KEYS)) {
      throw new Error(
        `Connection anchor ${index} must contain only its passage and exact selector.`,
      );
    }
    const book = rawAnchor["book"];
    const chapter = rawAnchor["chapter"];
    const verseStart = rawAnchor["verse_start"];
    const verseEnd = rawAnchor["verse_end"];
    if (
      typeof book !== "string"
      || book.length === 0
      || book.length > MAX_CONNECTION_BOOK_CODE_LENGTH
      || !isPositiveSafeInteger(chapter)
      || !isPositiveSafeInteger(verseStart)
      || !isPositiveSafeInteger(verseEnd)
      || verseEnd < verseStart
    ) {
      throw new Error(`Connection anchor ${index} has invalid coordinates.`);
    }

    const rawExact = rawAnchor["exact"];
    if (!isRecord(rawExact) || !hasOnlyKeys(rawExact, EXACT_SELECTOR_KEYS)) {
      throw new Error(
        `Connection anchor ${index} exact selector must contain only format_version, layer, and occurrences.`,
      );
    }
    const formatVersion = rawExact["format_version"];
    const layer = rawExact["layer"];
    const rawOccurrences = rawExact["occurrences"];
    if (
      !Number.isSafeInteger(formatVersion)
      || typeof layer !== "string"
      || layer.length === 0
      || layer.length > MAX_CONNECTION_TOKEN_LAYER_LENGTH
    ) {
      throw new Error(`Connection anchor ${index} exact selector is invalid.`);
    }
    if (
      !Array.isArray(rawOccurrences)
      || rawOccurrences.length === 0
      || rawOccurrences.length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR
    ) {
      throw new Error(
        `Connection anchor ${index} requires 1 to ${MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR} occurrences.`,
      );
    }

    const occurrences = rawOccurrences.map((rawOccurrence, occurrenceIndex) => {
      if (!isRecord(rawOccurrence) || !hasOnlyKeys(rawOccurrence, EXACT_OCCURRENCE_KEYS)) {
        throw new Error(
          `Connection anchor ${index} occurrence ${occurrenceIndex} must contain only verse and position.`,
        );
      }
      const verse = rawOccurrence["verse"];
      const position = rawOccurrence["position"];
      if (!isPositiveSafeInteger(verse) || !isPositiveSafeInteger(position)) {
        throw new Error(
          `Connection anchor ${index} occurrence ${occurrenceIndex} is invalid.`,
        );
      }
      return { verse, position };
    });

    const anchor: ConnectionAnchorV2 = {
      book: book as ConnectionAnchorV2["book"],
      chapter,
      verse_start: verseStart,
      verse_end: verseEnd,
      exact: {
        format_version: formatVersion as ConnectionAnchorV2["exact"]["format_version"],
        layer: layer as ConnectionAnchorV2["exact"]["layer"],
        occurrences,
      },
    };
    aggregateAnchorBytes += Buffer.byteLength(stableStringify(anchor), "utf8");
    if (aggregateAnchorBytes > MAX_CONNECTION_CANONICAL_INPUT_BYTES) {
      throw new Error(
        `Connection serialized input exceeds ${MAX_CONNECTION_CANONICAL_INPUT_BYTES} bytes.`,
      );
    }
    anchors.push(anchor);
  }

  const bounded: CreateConnectionInput = {
    kind: kind as CreateConnectionInput["kind"],
    label,
    observation,
    anchors,
  };
  const canonicalBytes = Buffer.byteLength(stableStringify(bounded), "utf8");
  if (canonicalBytes > MAX_CONNECTION_CANONICAL_INPUT_BYTES) {
    throw new Error(
      `Connection serialized input exceeds ${MAX_CONNECTION_CANONICAL_INPUT_BYTES} bytes.`,
    );
  }
  return {
    value: bounded,
    // While queued, the operation retains this closed input. On settlement the
    // entry is re-weighed from the actual resolved commit before cache pruning.
    retainedBytes: canonicalBytes + COMMAND_ENTRY_OVERHEAD_BYTES,
  };
}

/**
 * Reject known-invalid current-format commands before they consume the
 * serialized append lane. This runs after a hot command-id collision check so
 * changed exact identity is still reported as command reuse, not reinterpreted
 * as a new mutation.
 */
function validateCurrentConnectionInput(value: CreateConnectionInput): void {
  if (!CONNECTION_KIND_SET.has(value.kind)) {
    throw new Error(`Connection kind ${value.kind} is unsupported.`);
  }
  if (BINARY_CONNECTION_KIND_SET.has(value.kind) && value.anchors.length !== 2) {
    throw new Error(`Connection kind ${value.kind} requires exactly two anchors.`);
  }

  for (let anchorIndex = 0; anchorIndex < value.anchors.length; anchorIndex++) {
    const anchor = value.anchors[anchorIndex]!;
    if (!/^[A-Z0-9]{3}$/.test(anchor.book)) {
      throw new Error(`Connection anchor ${anchorIndex} book code is invalid.`);
    }
    if (anchor.exact.format_version !== BACKBONE_TOKEN_EXACT_FORMAT_VERSION) {
      throw new Error(
        `Connection anchor ${anchorIndex} exact format_version is unsupported.`,
      );
    }
    if (anchor.exact.layer !== BACKBONE_TOKEN_LAYER) {
      throw new Error(`Connection anchor ${anchorIndex} token layer is unsupported.`);
    }

    let previousVerse = 0;
    let previousPosition = 0;
    for (
      let occurrenceIndex = 0;
      occurrenceIndex < anchor.exact.occurrences.length;
      occurrenceIndex++
    ) {
      const occurrence = anchor.exact.occurrences[occurrenceIndex]!;
      if (
        occurrence.verse < anchor.verse_start
        || occurrence.verse > anchor.verse_end
      ) {
        throw new Error(
          `Connection anchor ${anchorIndex} occurrence ${occurrenceIndex} is outside its passage.`,
        );
      }
      if (
        occurrence.verse < previousVerse
        || (
          occurrence.verse === previousVerse
          && occurrence.position <= previousPosition
        )
      ) {
        throw new Error(
          `Connection anchor ${anchorIndex} occurrences must be unique and strictly ordered.`,
        );
      }
      previousVerse = occurrence.verse;
      previousPosition = occurrence.position;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
