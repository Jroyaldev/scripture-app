/**
 * Git RevisionStore adapter (§4.11).
 * Debounces commits: batches Substrate changes into one commit on idle (~10s)
 * or every ~50 changes or on explicit flush.
 * Never commits binaries (INV-13). User never sees Git directly.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import type { RevisionStore, RevisionReceipt, RevisionTxn } from "../core/interfaces.js";

const DEBOUNCE_IDLE_MS = 10_000;
const DEBOUNCE_MAX_CHANGES = 50;

export class GitRevisionStore implements RevisionStore {
  private libraryPath: string;
  private pendingFiles: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private changeCount = 0;
  private initialized = false;

  constructor(libraryPath: string) {
    this.libraryPath = libraryPath;
  }

  /**
   * Initialize git repo if not already done.
   */
  init(): void {
    if (this.initialized) return;
    const gitDir = join(this.libraryPath, ".git");
    if (!existsSync(gitDir)) {
      this.git("init");
      this.git("config", "user.email", "library@scripture-app.local");
      this.git("config", "user.name", "Scripture Library");
      // Set up gitignore per §4.3
      const gitignorePath = join(this.libraryPath, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, ".system/\n.artifacts/\nsources/**/original.*\n");
      }
      this.git("add", ".gitignore");
      this.git("commit", "-m", "Initialize library repository");
    }
    this.initialized = true;
  }

  async beginTransaction(label: string): Promise<RevisionTxn> {
    this.init();
    return {
      id: ulid(),
      label,
      files: [],
    };
  }

  async commit(txn: RevisionTxn): Promise<RevisionReceipt> {
    this.init();
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
    this.pendingFiles.push(filePath);
    this.changeCount++;
  }

  /**
   * Flush pending changes immediately (called on window blur/close).
   */
  async flush(label?: string): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingFiles.length === 0) return;

    this.init();

    // Stage only non-binary files (INV-13)
    for (const file of this.pendingFiles) {
      const fullPath = join(this.libraryPath, file);
      if (existsSync(fullPath) && !isBinary(fullPath)) {
        try {
          this.git("add", file);
        } catch {
          // File may have been deleted
          try {
            this.git("rm", "--cached", file);
          } catch {
            // Ignore
          }
        }
      }
    }

    // Check if there's anything to commit
    const status = this.git("status", "--porcelain");
    if (status.trim()) {
      const msg = label ?? `Auto-save: ${this.changeCount} change(s)`;
      this.git("commit", "-m", msg);
    }

    this.pendingFiles = [];
    this.changeCount = 0;
  }

  private scheduleDebouncedCommit(label: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.flush(label);
    }, DEBOUNCE_IDLE_MS);
  }

  private git(...args: string[]): string {
    const result = execSync(`git ${args.map(shellEscape).join(" ")}`, {
      cwd: this.libraryPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result;
  }
}

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function isBinary(filePath: string): boolean {
  try {
    const buffer = readFileSync(filePath);
    // Check first 8KB for null bytes (binary indicator)
    const checkLength = Math.min(buffer.length, 8192);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}
