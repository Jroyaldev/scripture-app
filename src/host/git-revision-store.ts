/**
 * Git RevisionStore adapter (§4.11).
 * Debounces commits: batches Substrate changes into one commit on idle (~10s)
 * or every ~50 changes or on explicit flush.
 * Never commits binaries (INV-13). User never sees Git directly.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import type {
  RevisionAppend,
  RevisionAppendReceipt,
  RevisionStore,
  RevisionReceipt,
  RevisionTxn,
} from "../core/interfaces.js";
import {
  RevisionAppendCoordinator,
  revisionReceiptId,
} from "./revision-append.js";

const DEBOUNCE_IDLE_MS = 10_000;
const DEBOUNCE_MAX_CHANGES = 50;
const GIT_COMMAND_TIMEOUT_MS = 1_500;

export class GitRevisionStore implements RevisionStore {
  private libraryPath: string;
  private pendingFiles = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private changeCount = 0;
  private initialized = false;
  private appendTail: Promise<void> = Promise.resolve();
  private appendCoordinator = new RevisionAppendCoordinator();
  private issuedTransactions = new WeakSet<RevisionTxn>();
  private appendTransactions = new WeakMap<RevisionTxn, string>();

  constructor(libraryPath: string) {
    this.libraryPath = libraryPath;
  }

  /**
   * Initialize git repo if not already done.
   */
  init(commandTimeoutMs = GIT_COMMAND_TIMEOUT_MS): void {
    if (this.initialized) return;
    const gitDir = join(this.libraryPath, ".git");
    if (!existsSync(gitDir)) {
      const git = (...args: string[]) => this.gitWithTimeout(commandTimeoutMs, ...args);
      git("init");
      git("config", "user.email", "library@pericope.local");
      git("config", "user.name", "Pericope");
      // Set up gitignore per §4.3
      const gitignorePath = join(this.libraryPath, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, ".system/\n.artifacts/\nsources/**/original.*\n");
      }
      git("add", ".gitignore");
      git("commit", "-m", "Initialize library repository");
    }
    this.initialized = true;
  }

  async beginTransaction(label: string): Promise<RevisionTxn> {
    const txn = {
      id: ulid(),
      label,
      files: [],
    };
    this.issuedTransactions.add(txn);
    return txn;
  }

  async commit(txn: RevisionTxn): Promise<RevisionReceipt> {
    for (const file of txn.files) {
      this.trackChange(file);
    }

    // If enough changes accumulated, flush immediately
    if (this.changeCount >= DEBOUNCE_MAX_CHANGES) {
      await this.flush(txn.label);
    } else {
      this.scheduleDebouncedCommit(txn.label);
    }

    return {
      id: txn.id,
      label: txn.label,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Own the authoritative append before returning its logical revision
   * receipt. Git remains a debounced desktop adapter; a Git subprocess can no
   * longer turn an already-appended event into an ambiguous failed mutation.
   */
  async commitAppend(txn: RevisionTxn, append: RevisionAppend): Promise<RevisionAppendReceipt> {
    return this.serializeAppend(() => {
      this.claimAppendTransaction(txn, append);
      const applied = this.appendCoordinator.append(this.libraryPath, append);
      if (!applied.alreadyApplied) {
        if (!txn.files.includes(applied.path)) txn.files.push(applied.path);
        this.trackChange(applied.path);
        // Never run Git synchronously after the authoritative append. A zero-
        // delay checkpoint bounds sustained traffic without making a Git
        // subprocess part of the user mutation's success boundary.
        this.scheduleCommit(
          txn.label,
          this.changeCount >= DEBOUNCE_MAX_CHANGES ? 0 : DEBOUNCE_IDLE_MS,
        );
      }
      return {
        id: revisionReceiptId(applied.commandId),
        label: txn.label,
        timestamp: applied.createdAt || new Date().toISOString(),
        entityId: applied.entityId,
        path: applied.path,
        alreadyApplied: applied.alreadyApplied,
        eventId: applied.eventId,
        commandId: applied.commandId,
        commandFingerprint: applied.commandFingerprint,
      };
    });
  }

  async history(entityId?: string): Promise<RevisionReceipt[]> {
    this.init();
    try {
      const logArgs = entityId
        ? ["log", "--oneline", "--", entityId]
        : ["log", "--oneline", "-20"];
      const output = this.git(...logArgs);
      const lines = output.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const spaceIdx = line.indexOf(" ");
        const hash = line.slice(0, spaceIdx);
        const label = line.slice(spaceIdx + 1);
        return {
          id: hash,
          label,
          timestamp: "",
          entityId,
        };
      });
    } catch {
      return [];
    }
  }

  async restore(receiptId: string): Promise<void> {
    this.init();
    this.git("checkout", receiptId, "--", ".");
  }

  /**
   * Track a file change for debounced commit.
   */
  trackChange(filePath: string): void {
    this.pendingFiles.add(filePath);
    this.changeCount++;
  }

  /**
   * Flush pending changes immediately (called on window blur/close).
   */
  async flush(label?: string, commandTimeoutMs = GIT_COMMAND_TIMEOUT_MS): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingFiles.size === 0) return;

    const filesAtStart = [...this.pendingFiles];
    try {
      this.init(commandTimeoutMs);

      // Stage all eligible paths in one bounded subprocess. Deleted tracked
      // files are included, while existing binary files stay excluded
      // (INV-13). This also prevents quit time from growing per changed file.
      const git = (...args: string[]) => this.gitWithTimeout(commandTimeoutMs, ...args);
      const tracked = new Set(
        git("ls-files", "-z", "--", ...filesAtStart)
          .split("\0")
          .filter(Boolean),
      );
      const stageable = filesAtStart.filter((file) => {
        const fullPath = join(this.libraryPath, file);
        return existsSync(fullPath) ? !isBinary(fullPath) : tracked.has(file);
      });
      if (stageable.length > 0) git("add", "-A", "--", ...stageable);

      const status = git("status", "--porcelain");
      if (status.trim()) {
        const msg = label ?? `Auto-save: ${this.changeCount} change(s)`;
        git("commit", "-m", msg);
      }

      this.pendingFiles.clear();
      this.changeCount = 0;
    } catch (error) {
      // A failed explicit flush must not strand authored changes after its
      // debounce timer was cleared. Preserve the queue and schedule a retry.
      if (this.pendingFiles.size > 0) {
        this.scheduleDebouncedCommit(label ?? "Retry auto-save");
      }
      throw error;
    }
  }

  private scheduleDebouncedCommit(label: string): void {
    this.scheduleCommit(label, DEBOUNCE_IDLE_MS);
  }

  private scheduleCommit(label: string, delayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.flush(label).catch(() => undefined);
    }, delayMs);
    this.debounceTimer.unref?.();
  }

  private git(...args: string[]): string {
    return this.gitWithTimeout(GIT_COMMAND_TIMEOUT_MS, ...args);
  }

  private gitWithTimeout(timeoutMs: number, ...args: string[]): string {
    const result = execFileSync("git", args, {
      cwd: this.libraryPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: Math.max(10, Math.min(GIT_COMMAND_TIMEOUT_MS, timeoutMs)),
    });
    return result;
  }

  private serializeAppend<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.appendTail.then(operation);
    this.appendTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private claimAppendTransaction(txn: RevisionTxn, append: RevisionAppend): void {
    if (!this.issuedTransactions.has(txn)) {
      throw new Error(`Revision transaction ${txn.id} was not issued by this store.`);
    }
    const identity = createHash("sha256").update(JSON.stringify(append)).digest("hex");
    const existing = this.appendTransactions.get(txn);
    if (existing && existing !== identity) {
      throw new Error(`Revision transaction ${txn.id} was reused for a different append.`);
    }
    if (!existing) this.appendTransactions.set(txn, identity);
  }
}

function isBinary(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(8192);
    const checkLength = readSync(fd, buffer, 0, buffer.length, 0);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // The read result is still usable; a close failure must not crash the
        // revision timer or turn a text file into a process-level exception.
      }
    }
  }
}
