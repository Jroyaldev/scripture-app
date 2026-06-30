/**
 * SQLite materializer — Node host layer.
 * Implements the §4.4 schema as a materialized view (INV-9).
 * This file is allowed to import Node/better-sqlite3.
 */

import Database from "better-sqlite3";
import type {
  NoteRecord,
  NoteTagRecord,
  AnchorRecord,
  EdgeRecord,
  HighlightRecord,
  FactRecord,
  SourceRecord,
  SourceChunkRecord,
} from "../core/indexer/types.js";
import type { AppliedEvent } from "../core/events/types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events_applied (
  event_id TEXT PRIMARY KEY,
  entity_type TEXT, entity_id TEXT,
  device_id TEXT, seq INTEGER, applied_at TEXT,
  status TEXT,
  superseded_by TEXT,
  field_contested TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, title TEXT, type TEXT, path TEXT,
  created TEXT, modified TEXT, body_text TEXT
);
CREATE TABLE IF NOT EXISTS note_tags (note_id TEXT, tag TEXT);

CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  src_kind TEXT,
  src_id TEXT,
  corpus TEXT, book TEXT, start_ch INTEGER, start_v INTEGER, end_ch INTEGER, end_v INTEGER,
  provenance TEXT
);
CREATE INDEX IF NOT EXISTS anchors_loc ON anchors(book, start_ch, start_v);

CREATE TABLE IF NOT EXISTS edges (src_id TEXT, dst_id TEXT, kind TEXT, provenance TEXT);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY, book TEXT, chapter INTEGER, verse_start INTEGER, verse_end INTEGER,
  package TEXT, char_start INTEGER, char_end INTEGER, color TEXT, kind TEXT, note_id TEXT, deleted INTEGER
);

CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, assertion TEXT, claim_type TEXT, confidence REAL,
                     extractor TEXT, created TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS claim_anchors (claim_id TEXT, book TEXT, chapter INTEGER, verse INTEGER);
CREATE TABLE IF NOT EXISTS claim_sources (claim_id TEXT, kind TEXT, ref TEXT);

CREATE TABLE IF NOT EXISTS overlays (id TEXT PRIMARY KEY, book TEXT, chapter INTEGER, verse INTEGER,
                       char_start INTEGER, char_end INTEGER, reason TEXT, extractor TEXT);

CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY, assertion TEXT, from_claim TEXT, user_note TEXT, deleted INTEGER);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, title TEXT, kind TEXT, imported TEXT);
CREATE TABLE IF NOT EXISTS source_chunks (id TEXT PRIMARY KEY, source_id TEXT, ordinal INTEGER, text TEXT, locator_json TEXT);
CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, version TEXT, enabled INTEGER, manifest_json TEXT);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, plugin_id TEXT, kind TEXT, status TEXT, created TEXT, finished TEXT);
`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(body_text, content='notes', content_rowid='rowid');
`;

export class SQLiteMaterializer {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(SCHEMA);
    this.db.exec(FTS_SCHEMA);
  }

  clear(): void {
    const tables = [
      "events_applied", "notes", "note_tags", "anchors", "edges",
      "highlights", "claims", "claim_anchors", "claim_sources",
      "overlays", "facts", "sources", "source_chunks", "plugins", "jobs",
    ];
    for (const table of tables) {
      this.db.exec(`DELETE FROM ${table}`);
    }
    this.db.exec("DELETE FROM meta");
    // Rebuild FTS
    this.db.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  insertNote(note: NoteRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO notes (id, title, type, path, created, modified, body_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(note.id, note.title, note.type, note.path, note.created, note.modified, note.body_text);
    // Update FTS
    this.db
      .prepare("INSERT OR REPLACE INTO notes_fts (rowid, body_text) SELECT rowid, body_text FROM notes WHERE id = ?")
      .run(note.id);
  }

  insertNoteTags(tags: NoteTagRecord[]): void {
    const stmt = this.db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)");
    for (const tag of tags) {
      stmt.run(tag.note_id, tag.tag);
    }
  }

  insertAnchor(anchor: AnchorRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO anchors (id, src_kind, src_id, corpus, book, start_ch, start_v, end_ch, end_v, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        anchor.id, anchor.src_kind, anchor.src_id, anchor.corpus,
        anchor.book, anchor.start_ch, anchor.start_v, anchor.end_ch, anchor.end_v,
        anchor.provenance,
      );
  }

  insertEdge(edge: EdgeRecord): void {
    this.db
      .prepare("INSERT INTO edges (src_id, dst_id, kind, provenance) VALUES (?, ?, ?, ?)")
      .run(edge.src_id, edge.dst_id, edge.kind, edge.provenance);
  }

  insertHighlight(h: HighlightRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO highlights (id, book, chapter, verse_start, verse_end, package, char_start, char_end, color, kind, note_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(h.id, h.book, h.chapter, h.verse_start, h.verse_end, h.package, h.char_start, h.char_end, h.color, h.kind, h.note_id, h.deleted);
  }

  insertFact(f: FactRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO facts (id, assertion, from_claim, user_note, deleted) VALUES (?, ?, ?, ?, ?)",
      )
      .run(f.id, f.assertion, f.from_claim, f.user_note, f.deleted);
  }

  insertAppliedEvent(e: AppliedEvent): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO events_applied (event_id, entity_type, entity_id, device_id, seq, applied_at, status, superseded_by, field_contested) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        e.event_id, e.entity_type, e.entity_id, e.device_id, e.seq,
        e.applied_at, e.status, e.superseded_by, e.field_contested,
      );
  }

  queryAnchorsForVerse(book: string, chapter: number, verse: number): AnchorRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM anchors WHERE book = ? AND (
          (start_ch < ? OR (start_ch = ? AND start_v <= ?)) AND
          (end_ch > ? OR (end_ch = ? AND end_v >= ?))
        )`,
      )
      .all(book, chapter, chapter, verse, chapter, chapter, verse) as AnchorRecord[];
  }

  queryHighlightsForVerse(book: string, chapter: number, verse: number): HighlightRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM highlights WHERE book = ? AND chapter = ? AND verse_start <= ? AND verse_end >= ? AND deleted = 0",
      )
      .all(book, chapter, verse, verse) as HighlightRecord[];
  }

  queryNoteById(id: string): NoteRecord | undefined {
    return this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRecord | undefined;
  }

  getAllNotes(): NoteRecord[] {
    return this.db.prepare("SELECT * FROM notes").all() as NoteRecord[];
  }

  getAllAnchors(): AnchorRecord[] {
    return this.db.prepare("SELECT * FROM anchors").all() as AnchorRecord[];
  }

  getAllEdges(): EdgeRecord[] {
    return this.db.prepare("SELECT * FROM edges").all() as EdgeRecord[];
  }

  getAllHighlights(): HighlightRecord[] {
    return this.db.prepare("SELECT * FROM highlights").all() as HighlightRecord[];
  }

  getAllFacts(): FactRecord[] {
    return this.db.prepare("SELECT * FROM facts").all() as FactRecord[];
  }

  insertSource(source: SourceRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO sources (id, title, kind, imported) VALUES (?, ?, ?, ?)")
      .run(source.id, source.title, source.kind, source.imported);
  }

  insertSourceChunk(chunk: SourceChunkRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO source_chunks (id, source_id, ordinal, text, locator_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(chunk.id, chunk.source_id, chunk.ordinal, chunk.text, chunk.locator_json);
  }

  deleteSourceChunks(sourceId: string): void {
    this.db.prepare("DELETE FROM source_chunks WHERE source_id = ?").run(sourceId);
    this.db.prepare("DELETE FROM anchors WHERE src_kind = 'sourceChunk' AND src_id NOT IN (SELECT id FROM source_chunks)").run();
  }

  querySourceById(id: string): SourceRecord | undefined {
    return this.db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRecord | undefined;
  }

  querySourceChunkById(id: string): SourceChunkRecord | undefined {
    return this.db.prepare("SELECT * FROM source_chunks WHERE id = ?").get(id) as SourceChunkRecord | undefined;
  }

  querySourceChunksBySource(sourceId: string): SourceChunkRecord[] {
    return this.db
      .prepare("SELECT * FROM source_chunks WHERE source_id = ? ORDER BY ordinal")
      .all(sourceId) as SourceChunkRecord[];
  }

  getAllSources(): SourceRecord[] {
    return this.db.prepare("SELECT * FROM sources").all() as SourceRecord[];
  }

  getAllSourceChunks(): SourceChunkRecord[] {
    return this.db.prepare("SELECT * FROM source_chunks").all() as SourceChunkRecord[];
  }

  getAllAppliedEvents(): AppliedEvent[] {
    return this.db.prepare("SELECT * FROM events_applied").all() as AppliedEvent[];
  }

  /**
   * Full-text search over notes (FTS5).
   */
  searchNotes(query: string, limit = 20): NoteRecord[] {
    if (!query.trim()) return [];
    return this.db
      .prepare(
        `SELECT notes.* FROM notes_fts
         JOIN notes ON notes.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as NoteRecord[];
  }

  /**
   * Query all anchors overlapping a given range.
   */
  queryAnchorsForRange(
    book: string,
    startCh: number,
    startV: number,
    endCh: number,
    endV: number,
  ): AnchorRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM anchors WHERE book = ? AND
          NOT (end_ch < ? OR (end_ch = ? AND end_v < ?)) AND
          NOT (start_ch > ? OR (start_ch = ? AND start_v > ?))`,
      )
      .all(book, startCh, startCh, startV, endCh, endCh, endV) as AnchorRecord[];
  }

  /**
   * Query highlights overlapping a given range.
   */
  queryHighlightsForRange(
    book: string,
    startCh: number,
    startV: number,
    endCh: number,
    endV: number,
  ): HighlightRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM highlights WHERE book = ? AND chapter >= ? AND chapter <= ?
          AND verse_start <= ? AND verse_end >= ? AND deleted = 0`,
      )
      .all(book, startCh, endCh, endV, startV) as HighlightRecord[];
  }

  /**
   * Query edges by target (for backlink resolution).
   */
  queryEdgesByTarget(targetId: string): EdgeRecord[] {
    return this.db
      .prepare("SELECT * FROM edges WHERE dst_id = ?")
      .all(targetId) as EdgeRecord[];
  }

  close(): void {
    this.db.close();
  }

  // --- M3: Claims ---

  insertClaim(c: { id: string; assertion: string; claim_type: string; confidence: number; extractor: string; created: string; status: string }): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO claims (id, assertion, claim_type, confidence, extractor, created, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(c.id, c.assertion, c.claim_type, c.confidence, c.extractor, c.created, c.status);
  }

  insertClaimAnchor(ca: { claim_id: string; book: string; chapter: number; verse: number }): void {
    this.db
      .prepare("INSERT INTO claim_anchors (claim_id, book, chapter, verse) VALUES (?, ?, ?, ?)")
      .run(ca.claim_id, ca.book, ca.chapter, ca.verse);
  }

  insertClaimSource(cs: { claim_id: string; kind: string; ref: string }): void {
    this.db
      .prepare("INSERT INTO claim_sources (claim_id, kind, ref) VALUES (?, ?, ?)")
      .run(cs.claim_id, cs.kind, cs.ref);
  }

  queryClaimsForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): { id: string; assertion: string; claim_type: string; confidence: number; extractor: string; created: string; status: string }[] {
    return this.db
      .prepare(
        `SELECT DISTINCT c.* FROM claims c
         JOIN claim_anchors ca ON c.id = ca.claim_id
         WHERE ca.book = ? AND (
           (ca.chapter < ? OR (ca.chapter = ? AND ca.verse <= ?)) AND
           (ca.chapter > ? OR (ca.chapter = ? AND ca.verse >= ?))
         ) AND c.status = 'active'`,
      )
      .all(book, endCh, endCh, endV, startCh, startCh, startV) as { id: string; assertion: string; claim_type: string; confidence: number; extractor: string; created: string; status: string }[];
  }

  queryClaimAnchors(claimId: string): { claim_id: string; book: string; chapter: number; verse: number }[] {
    return this.db
      .prepare("SELECT * FROM claim_anchors WHERE claim_id = ?")
      .all(claimId) as { claim_id: string; book: string; chapter: number; verse: number }[];
  }

  // --- M3: Overlays ---

  insertOverlay(o: { id: string; book: string; chapter: number; verse: number; char_start: number; char_end: number; reason: string; extractor: string }): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO overlays (id, book, chapter, verse, char_start, char_end, reason, extractor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(o.id, o.book, o.chapter, o.verse, o.char_start, o.char_end, o.reason, o.extractor);
  }

  queryOverlaysForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): { id: string; book: string; chapter: number; verse: number; char_start: number; char_end: number; reason: string; extractor: string }[] {
    return this.db
      .prepare(
        `SELECT * FROM overlays WHERE book = ? AND
          chapter >= ? AND chapter <= ? AND
          verse >= ? AND verse <= ?`,
      )
      .all(book, startCh, endCh, startV, endV) as { id: string; book: string; chapter: number; verse: number; char_start: number; char_end: number; reason: string; extractor: string }[];
  }
}
