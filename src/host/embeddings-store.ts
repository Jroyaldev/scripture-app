/**
 * AI-derived store — Node host layer.
 * Manages embeddings.sqlite as the persistent home for ALL AI-derived data:
 * vectors (§4.4), threads, claims, and job logs. Unlike library.sqlite (a
 * materialized view that is deleted and rebuilt on every substrate change),
 * this store persists across rebuilds — AI outputs are expensive; they are
 * invalidated precisely (content hashes) rather than wiped wholesale.
 * Excluded from rebuild_hash (INV-10); fully regenerable (INV-2).
 */

import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS embeddings (
  src_kind TEXT,
  src_id TEXT,
  dim INTEGER,
  vector BLOB,
  model TEXT,
  content_hash TEXT,
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

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  assertion TEXT,
  claim_type TEXT,
  confidence REAL,
  extractor TEXT,
  created TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS claim_anchors (
  claim_id TEXT,
  book TEXT,
  chapter INTEGER,
  verse INTEGER
);

CREATE TABLE IF NOT EXISTS claim_sources (
  claim_id TEXT,
  kind TEXT,
  ref TEXT,
  quote TEXT,
  source_hash TEXT
);

CREATE TABLE IF NOT EXISTS enrichments (
  note_id TEXT PRIMARY KEY,
  content_hash TEXT,
  extractor TEXT,
  no_scripture_intent INTEGER,
  inferred_refs TEXT,
  themes TEXT,
  expansion TEXT,
  created TEXT
);

CREATE TABLE IF NOT EXISTS enrichment_feedback (
  note_id TEXT,
  ref_key TEXT,
  action TEXT,
  created TEXT,
  PRIMARY KEY (note_id, ref_key)
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

export type EnrichmentRecord = {
  noteId: string;
  contentHash: string;
  extractor: string;
  noScriptureIntent: boolean;
  inferredRefs: { book: string; chapter: number; verseStart?: number; verseEnd?: number }[];
  themes: string[];
  expansion: string;
  created: string;
};

export type EnrichmentFeedback = {
  noteId: string;
  /** "BOOK.chapter" or "BOOK.chapter.start-end" — matches InferredRef identity. */
  refKey: string;
  action: "confirmed" | "dismissed";
  created: string;
};

export type ClaimRecord = {
  id: string;
  assertion: string;
  claim_type: string;
  confidence: number;
  extractor: string;
  created: string;
  status: string;
};

export type ClaimSourceRecord = {
  claim_id: string;
  kind: string;
  ref: string;
  quote: string | null;
  source_hash: string | null;
};

export class EmbeddingsStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrateIfNeeded();
    this.db.exec(SCHEMA);
  }

  /**
   * Embeddings are Derived data (INV-2, INV-10): if an older table shape is
   * found (pre-Gate-2, no model/content_hash columns), drop and start over
   * rather than migrating rows — they'd be invalidated anyway.
   */
  private migrateIfNeeded(): void {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'")
      .get() as { name: string } | undefined;
    if (!table) return;
    const columns = this.db.prepare("PRAGMA table_info(embeddings)").all() as { name: string }[];
    const names = new Set(columns.map((c) => c.name));
    if (!names.has("model") || !names.has("content_hash")) {
      this.db.exec("DROP TABLE embeddings");
    }
  }

  upsertEmbedding(
    srcKind: string,
    srcId: string,
    vector: Float32Array,
    model = "unknown",
    contentHash = "",
  ): void {
    const dim = vector.length;
    const blob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    const created = new Date().toISOString();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO embeddings (src_kind, src_id, dim, vector, model, content_hash, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(srcKind, srcId, dim, blob, model, contentHash, created);
  }

  /**
   * True when a stored vector already exists for this source with the same
   * model and content hash — i.e. re-embedding would be a no-op.
   */
  isCurrent(srcKind: string, srcId: string, model: string, contentHash: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM embeddings WHERE src_kind = ? AND src_id = ? AND model = ? AND content_hash = ?",
      )
      .get(srcKind, srcId, model, contentHash);
    return row !== undefined;
  }

  /** Remove vectors produced by any other model (model switch invalidation). */
  pruneOtherModels(model: string): number {
    const result = this.db.prepare("DELETE FROM embeddings WHERE model != ?").run(model);
    return result.changes;
  }

  getEmbedding(srcKind: string, srcId: string): { srcKind: string; srcId: string; vector: Float32Array } | undefined {
    const row = this.db
      .prepare("SELECT src_kind, src_id, dim, vector FROM embeddings WHERE src_kind = ? AND src_id = ?")
      .get(srcKind, srcId) as { src_kind: string; src_id: string; dim: number; vector: Uint8Array } | undefined;
    if (!row) return undefined;
    const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim);
    return { srcKind: row.src_kind, srcId: row.src_id, vector };
  }

  getAllEmbeddings(model?: string): { srcKind: string; srcId: string; vector: Float32Array }[] {
    const rows = (
      model
        ? this.db.prepare("SELECT src_kind, src_id, dim, vector FROM embeddings WHERE model = ?").all(model)
        : this.db.prepare("SELECT src_kind, src_id, dim, vector FROM embeddings").all()
    ) as { src_kind: string; src_id: string; dim: number; vector: Uint8Array }[];
    return rows.map((row) => ({
      srcKind: row.src_kind,
      srcId: row.src_id,
      vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim),
    }));
  }

  /** Lightweight id listing (no vector decode) — used by the sync sweep. */
  listEmbeddings(): { srcKind: string; srcId: string }[] {
    const rows = this.db
      .prepare("SELECT src_kind, src_id FROM embeddings")
      .all() as { src_kind: string; src_id: string }[];
    return rows.map((row) => ({ srcKind: row.src_kind, srcId: row.src_id }));
  }

  deleteEmbedding(srcKind: string, srcId: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE src_kind = ? AND src_id = ?").run(srcKind, srcId);
  }

  clear(): void {
    this.db.exec("DELETE FROM embeddings");
    this.db.exec("DELETE FROM threads");
    this.db.exec("DELETE FROM claims");
    this.db.exec("DELETE FROM claim_anchors");
    this.db.exec("DELETE FROM claim_sources");
    this.db.exec("DELETE FROM enrichments");
    this.db.exec("DELETE FROM enrichment_feedback");
    this.db.exec("DELETE FROM ai_jobs");
  }

  // --- Claims (B3.6 B-1: persistent across library.sqlite rebuilds) ---

  insertClaim(c: ClaimRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO claims (id, assertion, claim_type, confidence, extractor, created, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(c.id, c.assertion, c.claim_type, c.confidence, c.extractor, c.created, c.status);
  }

  insertClaimAnchor(a: { claim_id: string; book: string; chapter: number; verse: number }): void {
    this.db
      .prepare("INSERT INTO claim_anchors (claim_id, book, chapter, verse) VALUES (?, ?, ?, ?)")
      .run(a.claim_id, a.book, a.chapter, a.verse);
  }

  insertClaimSource(s: { claim_id: string; kind: string; ref: string; quote?: string; source_hash?: string }): void {
    this.db
      .prepare("INSERT INTO claim_sources (claim_id, kind, ref, quote, source_hash) VALUES (?, ?, ?, ?, ?)")
      .run(s.claim_id, s.kind, s.ref, s.quote ?? null, s.source_hash ?? null);
  }

  queryClaimsForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): ClaimRecord[] {
    return this.db
      .prepare(
        `SELECT DISTINCT c.* FROM claims c
         JOIN claim_anchors ca ON c.id = ca.claim_id
         WHERE ca.book = ? AND (
           (ca.chapter < ? OR (ca.chapter = ? AND ca.verse <= ?)) AND
           (ca.chapter > ? OR (ca.chapter = ? AND ca.verse >= ?))
         ) AND c.status = 'active'`,
      )
      .all(book, endCh, endCh, endV, startCh, startCh, startV) as ClaimRecord[];
  }

  queryClaimAnchors(claimId: string): { claim_id: string; book: string; chapter: number; verse: number }[] {
    return this.db
      .prepare("SELECT * FROM claim_anchors WHERE claim_id = ?")
      .all(claimId) as { claim_id: string; book: string; chapter: number; verse: number }[];
  }

  queryClaimSources(claimId: string): ClaimSourceRecord[] {
    return this.db
      .prepare("SELECT * FROM claim_sources WHERE claim_id = ?")
      .all(claimId) as ClaimSourceRecord[];
  }

  getAllClaims(): ClaimRecord[] {
    return this.db.prepare("SELECT * FROM claims").all() as ClaimRecord[];
  }

  deleteClaim(claimId: string): void {
    this.db.prepare("DELETE FROM claim_anchors WHERE claim_id = ?").run(claimId);
    this.db.prepare("DELETE FROM claim_sources WHERE claim_id = ?").run(claimId);
    this.db.prepare("DELETE FROM claims WHERE id = ?").run(claimId);
  }

  /** Idempotent extraction re-runs replace their own prior output wholesale. */
  deleteClaimsByExtractor(extractor: string): number {
    this.db
      .prepare("DELETE FROM claim_anchors WHERE claim_id IN (SELECT id FROM claims WHERE extractor = ?)")
      .run(extractor);
    this.db
      .prepare("DELETE FROM claim_sources WHERE claim_id IN (SELECT id FROM claims WHERE extractor = ?)")
      .run(extractor);
    return this.db.prepare("DELETE FROM claims WHERE extractor = ?").run(extractor).changes;
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

  // --- Enrichments (B3.6: capture-time note interpretation, Derived) ---

  upsertEnrichment(e: EnrichmentRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO enrichments
         (note_id, content_hash, extractor, no_scripture_intent, inferred_refs, themes, expansion, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.noteId,
        e.contentHash,
        e.extractor,
        e.noScriptureIntent ? 1 : 0,
        JSON.stringify(e.inferredRefs),
        JSON.stringify(e.themes),
        e.expansion,
        e.created,
      );
  }

  getEnrichment(noteId: string): EnrichmentRecord | undefined {
    const row = this.db.prepare("SELECT * FROM enrichments WHERE note_id = ?").get(noteId) as
      | {
          note_id: string;
          content_hash: string;
          extractor: string;
          no_scripture_intent: number;
          inferred_refs: string;
          themes: string;
          expansion: string;
          created: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      noteId: row.note_id,
      contentHash: row.content_hash,
      extractor: row.extractor,
      noScriptureIntent: row.no_scripture_intent === 1,
      inferredRefs: JSON.parse(row.inferred_refs) as EnrichmentRecord["inferredRefs"],
      themes: JSON.parse(row.themes) as string[],
      expansion: row.expansion,
      created: row.created,
    };
  }

  getAllEnrichments(): EnrichmentRecord[] {
    const ids = this.db.prepare("SELECT note_id FROM enrichments").all() as { note_id: string }[];
    return ids.map((r) => this.getEnrichment(r.note_id)!).filter(Boolean);
  }

  isEnrichmentCurrent(noteId: string, contentHash: string, extractor: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM enrichments WHERE note_id = ? AND content_hash = ? AND extractor = ?")
      .get(noteId, contentHash, extractor);
    return row !== undefined;
  }

  deleteEnrichment(noteId: string): void {
    this.db.prepare("DELETE FROM enrichments WHERE note_id = ?").run(noteId);
  }

  /**
   * Feedback keys on (noteId, refKey) — NOT content hash — so dismissals
   * survive note edits (magic-breaker A-1: zombie suggestions).
   */
  setEnrichmentFeedback(f: EnrichmentFeedback): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO enrichment_feedback (note_id, ref_key, action, created) VALUES (?, ?, ?, ?)",
      )
      .run(f.noteId, f.refKey, f.action, f.created);
  }

  deleteEnrichmentFeedback(noteId: string, refKey: string): void {
    this.db.prepare("DELETE FROM enrichment_feedback WHERE note_id = ? AND ref_key = ?").run(noteId, refKey);
  }

  getEnrichmentFeedback(noteId: string): EnrichmentFeedback[] {
    const rows = this.db
      .prepare("SELECT * FROM enrichment_feedback WHERE note_id = ?")
      .all(noteId) as { note_id: string; ref_key: string; action: string; created: string }[];
    return rows.map((r) => ({
      noteId: r.note_id,
      refKey: r.ref_key,
      action: r.action as "confirmed" | "dismissed",
      created: r.created,
    }));
  }

  getAllEnrichmentFeedback(): EnrichmentFeedback[] {
    const rows = this.db.prepare("SELECT * FROM enrichment_feedback").all() as {
      note_id: string;
      ref_key: string;
      action: string;
      created: string;
    }[];
    return rows.map((r) => ({
      noteId: r.note_id,
      refKey: r.ref_key,
      action: r.action as "confirmed" | "dismissed",
      created: r.created,
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
