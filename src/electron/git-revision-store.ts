/**
 * Git RevisionStore adapter — §4.11.
 * Desktop-only; debounces commits; never commits binaries (INV-13).
 * The user never sees Git.
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEBOUNCE_MS = 10_000;
const MAX_CHANGES_BEFORE_COMMIT = 50;

export class GitRevisionStore {
  private rootPath: string;
  private pendingLabel: string | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private changeCount = 0;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  private git(args: string): string {
    return execSync(`git ${args}`, {
      cwd: this.rootPath,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  ensureInit(): void {
    const gitDir = join(this.rootPath, ".git");
    if (!existsSync(gitDir)) {
      this.git("init");
      this.git('config user.email "library@scripture-app.local"');
      this.git('config user.name "Scripture Library"');

      // Ensure .gitignore is correct per §4.3
      const gitignorePath = join(this.rootPath, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, ".system/\n.artifacts/\nsources/**/original.*\n");
      }

      // Initial commit
      this.git("add -A");
      try {
        this.git('commit -m "Initialize library"');
      } catch {
        // Nothing to commit on fresh library
      }
    }
  }

  scheduleCommit(label: string): void {
    this.pendingLabel = label;
    this.changeCount++;

    if (this.changeCount >= MAX_CHANGES_BEFORE_COMMIT) {
      this.flushCommit();
      return;
    }

    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
    }

    this.pendingTimeout = setTimeout(() => {
      this.flushCommit();
    }, DEBOUNCE_MS);
  }

  flushCommit(): void {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }

    if (!this.pendingLabel) return;

    try {
      this.git("add -A");
      const status = this.git("status --porcelain").trim();
      if (status) {
        const label = this.pendingLabel.replace(/"/g, '\\"');
        this.git(`commit -m "${label}"`);
      }
    } catch {
      // Silently handle git errors — user never sees git
    }

    this.pendingLabel = null;
    this.changeCount = 0;
  }

  async history(_entityId?: string): Promise<Array<{ id: string; message: string; date: string }>> {
    try {
      const log = this.git("log --oneline --format='%H|%s|%aI' -20");
      return log.trim().split("\n").filter(Boolean).map((line) => {
        const [id, message, date] = line.split("|") as [string, string, string];
        return { id, message, date };
      });
    } catch {
      return [];
    }
  }

  runGc(): void {
    try {
      this.git("gc --auto --quiet");
    } catch {
      // Non-critical
    }
  }
}
