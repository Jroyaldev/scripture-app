/**
 * Non-Git RevisionStore adapter for platforms without Git.
 *
 * Event logs are already append-only history. Markdown notes need content
 * snapshots so restore can recover a prior body without assuming Git exists.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { ulid } from "ulid";
import type { RevisionReceipt, RevisionStore, RevisionTxn } from "../core/interfaces.js";
import { parseFrontmatter } from "../core/notes/parser.js";

const REVISION_LOG = ".history/revisions.jsonl";

type SnapshotKind = "note" | "event-log" | "file";

type SnapshotFile = {
  path: string;
  kind: SnapshotKind;
  sha256?: string;
  entityId?: string;
  snapshotPath?: string;
};

type SnapshotRecord = RevisionReceipt & {
  files: SnapshotFile[];
  restoredFrom?: string;
};

export class SnapshotRevisionStore implements RevisionStore {
  constructor(private readonly libraryPath: string) {}

  async beginTransaction(label: string): Promise<RevisionTxn> {
    this.ensureHistoryDir();
    return {
      id: ulid(),
      label,
      files: [],
    };
  }

  async commit(txn: RevisionTxn): Promise<RevisionReceipt> {
    this.ensureHistoryDir();
    const record: SnapshotRecord = {
      id: txn.id,
      label: txn.label,
      timestamp: new Date().toISOString(),
      files: txn.files.map((file) => this.snapshotFile(txn.id, file)),
    };
    this.appendRecord(record);
    return toReceipt(record);
  }

  async history(entityId?: string): Promise<RevisionReceipt[]> {
    return this.readRecords()
      .filter((record) => {
        if (!entityId) return true;
        return record.files.some((file) => file.entityId === entityId || file.path === entityId);
      })
      .map(toReceipt);
  }

  async restore(receiptId: string): Promise<void> {
    const record = this.readRecords().find((candidate) => candidate.id === receiptId);
    if (!record) {
      throw new Error(`Revision receipt not found: ${receiptId}`);
    }

    const restoreId = ulid();
    const restoredFiles: SnapshotFile[] = [];
    for (const file of record.files) {
      if (file.kind !== "note" || !file.snapshotPath) continue;
      const target = this.absolutePath(file.path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(this.absolutePath(file.snapshotPath), target);
      restoredFiles.push(this.snapshotFile(restoreId, file.path));
    }

    this.appendRecord({
      id: restoreId,
      label: `Restore: ${record.label}`,
      timestamp: new Date().toISOString(),
      files: restoredFiles,
      restoredFrom: record.id,
    });
  }

  private snapshotFile(receiptId: string, filePath: string): SnapshotFile {
    const relativePath = normalizeRelativePath(filePath);
    const absolutePath = this.absolutePath(relativePath);
    const kind = classifyPath(relativePath);
    if (!existsSync(absolutePath)) {
      return { path: relativePath, kind };
    }

    const content = readFileSync(absolutePath);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (kind !== "note") {
      return {
        path: relativePath,
        kind,
        sha256,
        entityId: kind === "event-log" ? relativePath : undefined,
      };
    }

    const text = content.toString("utf-8");
    const entityId = parseFrontmatter(text).frontmatter.id || relativePath;
    const snapshotPath = join(".history", "notes", sanitizeSegment(entityId), `${receiptId}.md`);
    const absoluteSnapshotPath = this.absolutePath(snapshotPath);
    mkdirSync(dirname(absoluteSnapshotPath), { recursive: true });
    writeFileSync(absoluteSnapshotPath, content);

    return {
      path: relativePath,
      kind,
      sha256,
      entityId,
      snapshotPath,
    };
  }

  private appendRecord(record: SnapshotRecord): void {
    this.ensureHistoryDir();
    const logPath = this.absolutePath(REVISION_LOG);
    const previous = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
    writeFileSync(logPath, `${previous}${JSON.stringify(record)}\n`);
  }

  private readRecords(): SnapshotRecord[] {
    const logPath = this.absolutePath(REVISION_LOG);
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SnapshotRecord);
  }

  private ensureHistoryDir(): void {
    mkdirSync(this.absolutePath(".history"), { recursive: true });
  }

  private absolutePath(relativePath: string): string {
    return join(this.libraryPath, normalizeRelativePath(relativePath));
  }
}

function toReceipt(record: SnapshotRecord): RevisionReceipt {
  const firstEntityId = record.files.find((file) => file.entityId)?.entityId;
  return {
    id: record.id,
    label: record.label,
    timestamp: record.timestamp,
    entityId: firstEntityId,
  };
}

function normalizeRelativePath(filePath: string): string {
  const normalized = normalize(filePath);
  if (normalized.startsWith("..") || normalized.startsWith(sep) || normalized === ".") {
    throw new Error(`Revision path must be relative to the library: ${filePath}`);
  }
  return normalized;
}

function classifyPath(filePath: string): SnapshotKind {
  if (filePath.startsWith(`notes${sep}`) && filePath.endsWith(".md")) return "note";
  if (filePath.startsWith(`annotations${sep}`) && filePath.endsWith(".jsonl")) return "event-log";
  return "file";
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
