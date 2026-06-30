/**
 * Embeddings store — Node host layer.
 * Manages embeddings.sqlite as a vector store (§4.4).
 * Uses a simple table with cosine similarity computed in JS.
 * Excluded from rebuild_hash (INV-10).
 */

import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS embeddings (
  src_kind TEXT,
  src_id TEXT,
  dim INTEGER,
  vector BLOB,
  created TEXT,
  PRIMARY KEY (src_kind, src_id)
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  label TEXT,
  note_ids TEXT,
  summary TEXT,
  extractor TEXT,
  created TEXT
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT,
  status TEXT,
  created TEXT,
  finished TEXT,
  tokens_used INTEGER DEFAULT 0,
  error TEXT
);
`;

export class EmbeddingsStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  upsertEmbedding(srcKind: string, srcId: string, vector: Float32Array): void {
    const dim = vector.length;
    const blob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    const created = new Date().toISOString();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO embeddings (src_kind, src_id, dim, vector, created) VALUES (?, ?, ?, ?, ?)",
      )
      .run(srcKind, srcId, dim, blob, created);
  }

  getEmbedding(srcKind: string, srcId: string): { srcKind: string; srcId: string; vector: Float32Array } | undefined {
    const row = this.db
      .prepare("SELECT src_kind, src_id, dim, vector FROM embeddings WHERE src_kind = ? AND src_id = ?")
      .get(srcKind, srcId) as { src_kind: string; src_id: string; dim: number; vector: Uint8Array } | undefined;
    if (!row) return undefined;
    const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim);
    return { srcKind: row.src_kind, srcId: row.src_id, vector };
  }

  getAllEmbeddings(): { srcKind: string; srcId: string; vector: Float32Array }[] {
    const rows = this.db
      .prepare("SELECT src_kind, src_id, dim, vector FROM embeddings")
      .all() as { src_kind: string; src_id: string; dim: number; vector: Uint8Array }[];
    return rows.map((row) => ({
      srcKind: row.src_kind,
      srcId: row.src_id,
      vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim),
    }));
  }

  deleteEmbedding(srcKind: string, srcId: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE src_kind = ? AND src_id = ?").run(srcKind, srcId);
  }

  clear(): void {
    this.db.exec("DELETE FROM embeddings");
    this.db.exec("DELETE FROM threads");
    this.db.exec("DELETE FROM ai_jobs");
  }

  // Thread storage
  insertThread(t: { id: string; label: string; noteIds: string[]; summary: string; extractor: string; created: string }): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO threads (id, label, note_ids, summary, extractor, created) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(t.id, t.label, JSON.stringify(t.noteIds), t.summary, t.extractor, t.created);
  }

  getAllThreads(): { id: string; label: string; noteIds: string[]; summary: string; extractor: string; created: string }[] {
    const rows = this.db
      .prepare("SELECT * FROM threads")
      .all() as { id: string; label: string; note_ids: string; summary: string; extractor: string; created: string }[];
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      noteIds: JSON.parse(row.note_ids) as string[],
      summary: row.summary,
      extractor: row.extractor,
      created: row.created,
    }));
  }

  // AI job log
  insertJob(job: { id: string; kind: string; status: string; created: string; finished: string | null; tokensUsed: number; error: string | null }): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ai_jobs (id, kind, status, created, finished, tokens_used, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(job.id, job.kind, job.status, job.created, job.finished, job.tokensUsed, job.error);
  }

  getRecentJobs(limit = 20): { id: string; kind: string; status: string; created: string; finished: string | null; tokensUsed: number; error: string | null }[] {
    const rows = this.db
      .prepare("SELECT * FROM ai_jobs ORDER BY created DESC LIMIT ?")
      .all(limit) as { id: string; kind: string; status: string; created: string; finished: string | null; tokens_used: number; error: string | null }[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      created: row.created,
      finished: row.finished,
      tokensUsed: row.tokens_used,
      error: row.error,
    }));
  }

  close(): void {
    this.db.close();
  }
}
