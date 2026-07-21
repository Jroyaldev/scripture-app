/**
 * Non-Git RevisionStore adapter for platforms without Git.
 *
 * Event logs are already append-only history. Markdown notes need content
 * snapshots so restore can recover a prior body without assuming Git exists.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { ulid } from "ulid";
import type {
  RevisionAppend,
  RevisionAppendReceipt,
  RevisionReceipt,
  RevisionStore,
  RevisionTxn,
} from "../core/interfaces.js";
import { parseFrontmatter } from "../core/notes/parser.js";
import {
  RevisionAppendCoordinator,
  revisionReceiptId,
} from "./revision-append.js";

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
  commandId?: string;
  commandFingerprint?: string;
  eventId?: string;
};

export class SnapshotRevisionStore implements RevisionStore {
  private appendTail: Promise<void> = Promise.resolve();
  private pendingEventReceipts = new Map<string, SnapshotRecord>();
  private appendCoordinator = new RevisionAppendCoordinator();
  private recordIndex: Map<string, SnapshotRecord> | null = null;
  private recordIndexSignature = "";
  private issuedTransactions = new WeakSet<RevisionTxn>();
  private appendTransactions = new WeakMap<RevisionTxn, string>();

  constructor(private readonly libraryPath: string) {}

  async beginTransaction(label: string): Promise<RevisionTxn> {
    this.ensureHistoryDir();
    const txn = {
      id: ulid(),
      label,
      files: [],
    };
    this.issuedTransactions.add(txn);
    return txn;
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

  async commitAppend(txn: RevisionTxn, append: RevisionAppend): Promise<RevisionAppendReceipt> {
    return this.serializeAppend(() => {
      this.ensureHistoryDir();
      this.claimAppendTransaction(txn, append);
      const applied = this.appendCoordinator.append(this.libraryPath, append);
      if (!txn.files.includes(applied.path)) txn.files.push(applied.path);
      const record: SnapshotRecord = {
        id: revisionReceiptId(applied.commandId),
        label: txn.label,
        timestamp: applied.createdAt || new Date().toISOString(),
        files: [{
          path: applied.path,
          kind: "event-log",
          entityId: applied.entityId ?? applied.path,
        }],
        commandId: applied.commandId,
        commandFingerprint: applied.commandFingerprint,
        eventId: applied.eventId,
      };
      // The JSONL event is itself the authoritative non-Git history. Once its
      // fsynced append succeeds, an auxiliary receipt-index failure must never
      // turn the user command into an ambiguous failure. Keep one bounded
      // in-process repair record and retry it on the next history operation.
      if (!this.recordById(record.id)) {
        try {
          this.appendRecord(record);
        } catch {
          this.rememberPendingEventReceipt(record);
        }
      }
      return {
        ...toReceipt(record),
        path: applied.path,
        alreadyApplied: applied.alreadyApplied,
        eventId: applied.eventId,
        commandId: applied.commandId,
        commandFingerprint: applied.commandFingerprint,
      };
    });
  }

  async history(entityId?: string): Promise<RevisionReceipt[]> {
    this.flushPendingEventReceipts();
    const records = new Map(
      this.readRecords()
        .map((record) => this.authoritativeHistoryRecord(record))
        .filter((record): record is SnapshotRecord => record !== null)
        .map((record) => [record.id, record]),
    );
    for (const record of this.synthesizeConnectionReceipts()) {
      // The authored event log is authoritative. A malformed or forged
      // auxiliary row with the same deterministic id must never shadow it.
      records.set(record.id, record);
    }
    return [...records.values()]
      .filter((record) => {
        if (!entityId) return true;
        return record.files.some((file) => file.entityId === entityId || file.path === entityId);
      })
      .map(toReceipt);
  }

  /**
   * Event-log receipt rows are an auxiliary index over append-only Substrate,
   * never evidence that an event committed by themselves. Command receipts
   * are admitted only when their sole declared log contains the exact tuple.
   * Legacy note/file snapshots remain usable, but unauthenticated event-log
   * files are removed from mixed legacy records and cannot surface entities.
   */
  private authoritativeHistoryRecord(record: SnapshotRecord): SnapshotRecord | null {
    const eventLogFiles = record.files.filter((file) => file.kind === "event-log");
    if (!record.commandId) {
      if (eventLogFiles.length === 0) return record;
      const snapshotFiles = record.files.filter((file) => file.kind !== "event-log");
      return snapshotFiles.length > 0 ? { ...record, files: snapshotFiles } : null;
    }
    if (record.files.length !== 1 || eventLogFiles.length !== 1) return null;
    const file = record.files[0];
    if (!file || !file.entityId || !record.commandFingerprint || !record.eventId) return null;
    let content = "";
    try {
      const logPath = this.absolutePath(file.path);
      if (!existsSync(logPath)) return null;
      content = readFileSync(logPath, "utf8");
    } catch {
      return null;
    }
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line) as unknown;
        if (!isRecord(event)) continue;
        const eventEntityId = typeof event["entityId"] === "string"
          ? event["entityId"]
          : file.path;
        if (
          event["commandId"] === record.commandId
          && event["commandFingerprint"] === record.commandFingerprint
          && event["eventId"] === record.eventId
          && eventEntityId === file.entityId
        ) return record;
      } catch {
        // A malformed line cannot authenticate an auxiliary command receipt.
      }
    }
    return null;
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
    if (existsSync(logPath)) {
      const existing = readFileSync(logPath);
      if (existing.byteLength > 0 && existing[existing.byteLength - 1] !== 0x0a) {
        // Preserve a corrupt/partial auxiliary receipt line, but terminate it
        // so the new valid record cannot be concatenated into the same line.
        writeFileSync(logPath, "\n", { flag: "a" });
      }
    }
    writeFileSync(logPath, `${JSON.stringify(record)}\n`, { flag: "a" });
    this.recordIndex?.set(record.id, record);
    this.recordIndexSignature = fileSignature(logPath);
  }

  private flushPendingEventReceipts(): void {
    if (this.pendingEventReceipts.size === 0) return;
    for (const [recordId, record] of this.pendingEventReceipts) {
      if (!this.recordById(recordId)) {
        try {
          this.appendRecord(record);
        } catch {
          return;
        }
      }
      this.pendingEventReceipts.delete(recordId);
    }
  }

  private rememberPendingEventReceipt(record: SnapshotRecord): void {
    this.pendingEventReceipts.set(record.id, record);
    if (this.pendingEventReceipts.size <= 512) return;
    const oldest = this.pendingEventReceipts.keys().next().value as string | undefined;
    if (oldest) this.pendingEventReceipts.delete(oldest);
  }

  private readRecords(): SnapshotRecord[] {
    const logPath = this.absolutePath(REVISION_LOG);
    const signature = fileSignature(logPath);
    if (this.recordIndex && signature === this.recordIndexSignature) {
      return [...this.recordIndex.values()];
    }
    const records = new Map<string, SnapshotRecord>();
    let content = "";
    try {
      content = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
    } catch {
      this.recordIndex = records;
      this.recordIndexSignature = signature;
      return [];
    }
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isSnapshotRecord(parsed)) {
          if (!records.has(parsed.id)) records.set(parsed.id, parsed);
        }
      } catch {
        // Receipt history is an auxiliary index. A malformed record cannot
        // invalidate an already committed event or the remaining valid rows.
      }
    }
    this.recordIndex = records;
    this.recordIndexSignature = signature;
    return [...records.values()];
  }

  private recordById(recordId: string): SnapshotRecord | undefined {
    this.readRecords();
    return this.recordIndex?.get(recordId);
  }

  /**
   * Event logs are authoritative non-Git history. Reconstruct missing receipt
   * rows after restart or receipt-index failure so volatile repair state is
   * never required for a committed authored command.
   */
  private synthesizeConnectionReceipts(): SnapshotRecord[] {
    const relativePath = "annotations/connections.jsonl";
    const logPath = this.absolutePath(relativePath);
    if (!existsSync(logPath)) return [];
    let content = "";
    try {
      content = readFileSync(logPath, "utf8");
    } catch {
      return [];
    }
    const records: SnapshotRecord[] = [];
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const commandId = event["commandId"];
        const commandFingerprint = event["commandFingerprint"];
        const eventId = event["eventId"];
        if (
          typeof commandId !== "string"
          || commandId.length < 8
          || commandId.length > 128
          || !/^[A-Za-z0-9._:-]+$/.test(commandId)
          || typeof commandFingerprint !== "string"
          || !/^[a-f0-9]{64}$/.test(commandFingerprint)
          || typeof eventId !== "string"
        ) continue;
        const entityId = typeof event["entityId"] === "string" ? event["entityId"] : relativePath;
        const op = typeof event["op"] === "string" ? event["op"] : "change";
        records.push({
          id: revisionReceiptId(commandId),
          label: `${op[0]?.toUpperCase() ?? "C"}${op.slice(1)} connection`,
          timestamp: typeof event["createdAt"] === "string" ? event["createdAt"] : "",
          files: [{ path: relativePath, kind: "event-log", entityId }],
          commandId,
          commandFingerprint,
          eventId,
        });
      } catch {
        // Invalid authored logs are diagnosed elsewhere; history remains
        // available for every complete event that can still be parsed.
      }
    }
    return records;
  }

  private ensureHistoryDir(): void {
    mkdirSync(this.absolutePath(".history"), { recursive: true });
  }

  private absolutePath(relativePath: string): string {
    return join(this.libraryPath, normalizeRelativePath(relativePath));
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

function fileSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
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

function isSnapshotRecord(value: unknown): value is SnapshotRecord {
  if (!isRecord(value)) return false;
  if (
    typeof value["id"] !== "string"
    || typeof value["label"] !== "string"
    || typeof value["timestamp"] !== "string"
    || !Array.isArray(value["files"])
    || !value["files"].every(isSnapshotFile)
  ) return false;
  const commandFields = [
    value["commandId"],
    value["commandFingerprint"],
    value["eventId"],
  ];
  const hasCommandField = commandFields.some((field) => field !== undefined);
  if (!hasCommandField) return true;
  const commandId = commandFields[0];
  return isValidReceiptCommandId(commandId)
    && value["id"] === revisionReceiptId(commandId)
    && typeof commandFields[1] === "string"
    && /^[a-f0-9]{64}$/.test(commandFields[1])
    && isValidReceiptEventId(commandFields[2]);
}

function isValidReceiptCommandId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isValidReceiptEventId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isSnapshotFile(value: unknown): value is SnapshotFile {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  return typeof value["path"] === "string"
    && (kind === "note" || kind === "event-log" || kind === "file")
    && (value["sha256"] === undefined || typeof value["sha256"] === "string")
    && (value["entityId"] === undefined || typeof value["entityId"] === "string")
    && (value["snapshotPath"] === undefined || typeof value["snapshotPath"] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
