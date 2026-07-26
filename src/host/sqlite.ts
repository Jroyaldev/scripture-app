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
import type {
  ConnectionAnchorV1,
  ConnectionAnchorV2,
  ConnectionKind,
  ConnectionRecord,
  ConnectionRecordV1,
  ConnectionRecordV2,
} from "../core/annotations/types.js";
import {
  CONNECTION_FORMAT_VERSION_V1,
  CONNECTION_FORMAT_VERSION_V2,
  MAX_CONNECTION_ANCHORS,
  isBinaryConnectionKind,
  isConnectionKind,
} from "../core/annotations/index.js";
import {
  BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR,
} from "../core/annotations/backbone-token-anchor.js";
import { migrateRetiredV2AnchorFields } from "../core/annotations/retired-anchor-fields.js";
import { isValidBookCode } from "../core/reference/backbone.js";
import { compareConnectionsCanonical } from "../core/annotations/connection-order.js";

type ConnectionRow = {
  id: string;
  format_version: number;
  kind: string;
  label: string;
  observation: string | null;
  active_event_id: string;
  created_at: string;
  updated_at: string;
};

type ConnectionAnchorRow = {
  connection_id: string;
  ordinal: number;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  package: string | null;
  char_start: number | null;
  char_end: number | null;
  quote: string | null;
  anchor_json: string | null;
};

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

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  format_version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  observation TEXT,
  active_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connection_anchors (
  connection_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end INTEGER NOT NULL,
  package TEXT,
  char_start INTEGER,
  char_end INTEGER,
  quote TEXT,
  anchor_json TEXT NOT NULL,
  PRIMARY KEY (connection_id, ordinal),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS connection_anchors_loc
  ON connection_anchors(book, chapter, verse_start, verse_end);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY, book TEXT, chapter INTEGER, verse_start INTEGER, verse_end INTEGER,
  package TEXT, char_start INTEGER, char_end INTEGER, color TEXT, kind TEXT, note_id TEXT, deleted INTEGER
);

CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, assertion TEXT, claim_type TEXT, confidence REAL,
                     extractor TEXT, created TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS claim_anchors (claim_id TEXT, book TEXT, chapter INTEGER, verse INTEGER);
CREATE TABLE IF NOT EXISTS claim_sources (claim_id TEXT, kind TEXT, ref TEXT, quote TEXT);

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
    try {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      this.initSchema();
    } catch (error) {
      // A constructor failure must not retain a native handle to a corrupt
      // Derived file; LibraryEngine may safely quarantine and replace it.
      try { this.db.close(); } catch { /* preserve the initialization error */ }
      throw error;
    }
  }

  private initSchema(): void {
    this.db.exec(SCHEMA);
    this.db.exec(FTS_SCHEMA);
    // claims-v2 (B3.5): evidence quotes on claim sources. This is Derived
    // data (INV-9, drop-and-rebuild at will) — an in-place ALTER just spares
    // pre-existing DBs a full rebuild before the next insert.
    const cols = this.db.prepare("PRAGMA table_info(claim_sources)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "quote")) {
      this.db.exec("ALTER TABLE claim_sources ADD COLUMN quote TEXT");
    }
    const connectionCols = this.db
      .prepare("PRAGMA table_info(connections)")
      .all() as { name: string }[];
    let invalidatedConnectionProjection = false;
    if (!connectionCols.some((column) => column.name === "active_event_id")) {
      // Connections are disposable Derived state. Preserve schema readability
      // long enough for startup to notice the invalidated marker and rebuild
      // every row from the authoritative event log.
      this.db.exec("ALTER TABLE connections ADD COLUMN active_event_id TEXT NOT NULL DEFAULT ''");
      invalidatedConnectionProjection = true;
    }
    if (!connectionCols.some((column) => column.name === "observation")) {
      this.db.exec("ALTER TABLE connections ADD COLUMN observation TEXT");
      invalidatedConnectionProjection = true;
    }
    if (!connectionCols.some((column) => column.name === "created_at")) {
      this.db.exec("ALTER TABLE connections ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
      invalidatedConnectionProjection = true;
    }
    if (!connectionCols.some((column) => column.name === "updated_at")) {
      this.db.exec("ALTER TABLE connections ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
      invalidatedConnectionProjection = true;
    }
    const connectionAnchorCols = this.db
      .prepare("PRAGMA table_info(connection_anchors)")
      .all() as { name: string }[];
    if (!connectionAnchorCols.some((column) => column.name === "anchor_json")) {
      // Old rows are intentionally unreadable until a deterministic rebuild;
      // the passage/locator columns remain solely for v1 compatibility/query.
      this.db.exec("ALTER TABLE connection_anchors ADD COLUMN anchor_json TEXT");
      invalidatedConnectionProjection = true;
    }
    if (invalidatedConnectionProjection) {
      this.db.prepare("DELETE FROM meta WHERE key IN (?, ?, ?)").run(
        "connections_projection_v1",
        "connections_projection_v2",
        "connections_projection_schema",
      );
    }
  }

  clear(): void {
    const tables = [
      "events_applied", "notes", "note_tags", "anchors", "edges",
      "connection_anchors", "connections",
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

  /**
   * Serialize a complete Derived publication against every other SQLite
   * writer. WAL readers retain their prior snapshot until this commits, so a
   * rebuild is observed as old-or-new rather than as a removed or half-filled
   * database.
   */
  runImmediateTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation).immediate();
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

  /**
   * Atomically replace one Derived connection projection. Each member keeps a
   * lossless, format-discriminated JSON copy while passage columns stay
   * directly queryable and legacy locator columns remain available to v1.
   */
  upsertConnectionWithAnchors(
    connection: ConnectionRecord,
    derivedAnchors: AnchorRecord[],
  ): void {
    const upsertConnection = this.db.prepare(
      `INSERT INTO connections (
         id, format_version, kind, label, observation,
         active_event_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         format_version = excluded.format_version,
         kind = excluded.kind,
         label = excluded.label,
         observation = excluded.observation,
         active_event_id = excluded.active_event_id,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
    );
    const deleteConnectionAnchors = this.db.prepare(
      "DELETE FROM connection_anchors WHERE connection_id = ?",
    );
    const insertConnectionAnchor = this.db.prepare(
      `INSERT INTO connection_anchors (
         connection_id, ordinal, book, chapter, verse_start, verse_end,
         package, char_start, char_end, quote, anchor_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const deleteDerivedAnchors = this.db.prepare(
      "DELETE FROM anchors WHERE src_kind = 'annotation' AND src_id = ?",
    );
    const insertDerivedAnchor = this.db.prepare(
      `INSERT INTO anchors (
         id, src_kind, src_id, corpus, book, start_ch, start_v, end_ch, end_v, provenance
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const write = this.db.transaction(() => {
      upsertConnection.run(
        connection.id,
        connection.format_version,
        connection.kind,
        connection.label,
        connection.format_version === CONNECTION_FORMAT_VERSION_V2
          ? connection.observation
          : null,
        connection.activeEventId,
        connection.createdAt,
        connection.updatedAt,
      );
      deleteConnectionAnchors.run(connection.id);
      for (let ordinal = 0; ordinal < connection.anchors.length; ordinal++) {
        const anchor = connection.anchors[ordinal]!;
        const locator = connection.format_version === CONNECTION_FORMAT_VERSION_V1
          ? connection.anchors[ordinal]!.render_locator
          : undefined;
        insertConnectionAnchor.run(
          connection.id,
          ordinal,
          anchor.book,
          anchor.chapter,
          anchor.verse_start,
          anchor.verse_end,
          locator?.package ?? null,
          locator?.char_start ?? null,
          locator?.char_end ?? null,
          locator?.quote ?? null,
          JSON.stringify(anchor),
        );
      }

      deleteDerivedAnchors.run(connection.id);
      for (const anchor of derivedAnchors) {
        insertDerivedAnchor.run(
          anchor.id,
          anchor.src_kind,
          anchor.src_id,
          anchor.corpus,
          anchor.book,
          anchor.start_ch,
          anchor.start_v,
          anchor.end_ch,
          anchor.end_v,
          anchor.provenance,
        );
      }
    });
    write();
  }

  /** Remove only the disposable projection; authored JSONL remains untouched. */
  deleteConnection(connectionId: string): void {
    const remove = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM anchors WHERE src_kind = 'annotation' AND src_id = ?")
        .run(connectionId);
      this.db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
    });
    remove();
  }

  queryConnectionById(connectionId: string): ConnectionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, format_version, kind, label, observation,
                active_event_id, created_at, updated_at
         FROM connections WHERE id = ?`,
      )
      .get(connectionId) as ConnectionRow | undefined;
    return row ? this.hydrateConnection(row) : undefined;
  }

  getAllConnections(): ConnectionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, format_version, kind, label, observation,
                active_event_id, created_at, updated_at
         FROM connections ORDER BY id`,
      )
      .all() as ConnectionRow[];
    return rows.map((row) => this.hydrateConnection(row)).sort(compareConnectionsCanonical);
  }

  queryConnectionsForVerse(book: string, chapter: number, verse: number): ConnectionRecord[] {
    return this.queryConnectionsForRange(book, chapter, verse, verse);
  }

  queryConnectionsForRange(
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd: number,
  ): ConnectionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.id, c.format_version, c.kind, c.label, c.observation,
                         c.active_event_id, c.created_at, c.updated_at
         FROM connections c
         JOIN connection_anchors ca ON ca.connection_id = c.id
         WHERE ca.book = ? AND ca.chapter = ?
           AND ca.verse_start <= ? AND ca.verse_end >= ?
         ORDER BY c.id`,
      )
      .all(book, chapter, verseEnd, verseStart) as ConnectionRow[];
    return rows.map((row) => this.hydrateConnection(row)).sort((left, right) => (
      compareConnectionsCanonical(left, right, { book, chapter, verseStart, verseEnd })
    ));
  }

  private hydrateConnection(row: ConnectionRow): ConnectionRecord {
    if (!row.active_event_id) {
      throw new Error(`Derived connection ${row.id} is missing its active event version and must be rebuilt.`);
    }
    const createdAt = requireIsoTimestamp(row.created_at, `Derived connection ${row.id} created_at`);
    const updatedAt = requireIsoTimestamp(row.updated_at, `Derived connection ${row.id} updated_at`);
    if (!isConnectionKind(row.kind)) {
      throw new Error(`Derived connection ${row.id} has unknown kind ${row.kind}.`);
    }
    const anchorRows = this.db
      .prepare(
        `SELECT connection_id, ordinal, book, chapter, verse_start, verse_end,
                package, char_start, char_end, quote, anchor_json
         FROM connection_anchors
         WHERE connection_id = ?
         ORDER BY ordinal`,
      )
      .all(row.id) as ConnectionAnchorRow[];
    validateAnchorCount(row.id, row.kind, anchorRows.length);

    switch (row.format_version) {
      case CONNECTION_FORMAT_VERSION_V1: {
        if (row.observation !== null) {
          throw new Error(`Derived legacy connection ${row.id} unexpectedly contains observation text.`);
        }
        const anchors: ConnectionAnchorV1[] = anchorRows.map((anchorRow) => (
          hydrateLegacyConnectionAnchor(row.id, anchorRow)
        ));
        const connection: ConnectionRecordV1 = {
          id: row.id,
          format_version: CONNECTION_FORMAT_VERSION_V1,
          kind: row.kind,
          label: row.label,
          anchors,
          activeEventId: row.active_event_id,
          createdAt,
          updatedAt,
        };
        return connection;
      }
      case CONNECTION_FORMAT_VERSION_V2: {
        if (row.observation === null) {
          throw new Error(`Derived v2 connection ${row.id} is missing its observation field.`);
        }
        const anchors: ConnectionAnchorV2[] = anchorRows.map((anchorRow) => (
          hydrateExactConnectionAnchor(row.id, anchorRow)
        ));
        const connection: ConnectionRecordV2 = {
          id: row.id,
          format_version: CONNECTION_FORMAT_VERSION_V2,
          kind: row.kind,
          label: row.label,
          observation: row.observation,
          anchors,
          activeEventId: row.active_event_id,
          createdAt,
          updatedAt,
        };
        return connection;
      }
      default:
        throw new Error(
          `Derived connection ${row.id} uses unsupported format_version ${row.format_version}; rebuild with a compatible app.`,
        );
    }
  }

  insertHighlight(h: HighlightRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO highlights (id, book, chapter, verse_start, verse_end, package, char_start, char_end, color, kind, note_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(h.id, h.book, h.chapter, h.verse_start, h.verse_end, h.package, h.char_start, h.char_end, h.color, h.kind, h.note_id, h.deleted);
  }

  /** Incrementally mark a highlight as deleted without rebuilding the DB (INV-9). */
  deleteHighlightIncremental(entityId: string): void {
    this.db
      .prepare("UPDATE highlights SET deleted = 1 WHERE id = ?")
      .run(entityId);
  }

  /** Incrementally insert a highlight without rebuilding the DB (INV-9). */
  insertHighlightIncremental(h: HighlightRecord): void {
    this.insertHighlight(h);
  }

  /** Query active highlights for a specific book/chapter/package (for overlap detection). */
  queryHighlightsForChapter(book: string, chapter: number, pkg: string): HighlightRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM highlights WHERE book = ? AND chapter = ? AND package = ? AND deleted = 0",
      )
      .all(book, chapter, pkg) as HighlightRecord[];
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

  insertClaimSource(cs: { claim_id: string; kind: string; ref: string; quote?: string }): void {
    this.db
      .prepare("INSERT INTO claim_sources (claim_id, kind, ref, quote) VALUES (?, ?, ?, ?)")
      .run(cs.claim_id, cs.kind, cs.ref, cs.quote ?? null);
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

  queryClaimSources(claimId: string): { claim_id: string; kind: string; ref: string; quote: string | null }[] {
    return this.db
      .prepare("SELECT * FROM claim_sources WHERE claim_id = ?")
      .all(claimId) as { claim_id: string; kind: string; ref: string; quote: string | null }[];
  }

  /** All anchors belonging to one source (e.g. a note's cited references). */
  queryAnchorsBySrcId(srcId: string): AnchorRecord[] {
    return this.db
      .prepare("SELECT * FROM anchors WHERE src_id = ?")
      .all(srcId) as AnchorRecord[];
  }

  /**
   * Remove all claims produced by a given extractor (plus their anchors and
   * sources). Claims are Derived data — extraction jobs replace their own
   * prior output wholesale for idempotent re-runs.
   */
  deleteClaimsByExtractor(extractor: string): number {
    this.db
      .prepare("DELETE FROM claim_anchors WHERE claim_id IN (SELECT id FROM claims WHERE extractor = ?)")
      .run(extractor);
    this.db
      .prepare("DELETE FROM claim_sources WHERE claim_id IN (SELECT id FROM claims WHERE extractor = ?)")
      .run(extractor);
    const result = this.db.prepare("DELETE FROM claims WHERE extractor = ?").run(extractor);
    return result.changes;
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

function hydrateLegacyConnectionAnchor(
  connectionId: string,
  row: ConnectionAnchorRow,
): ConnectionAnchorV1 {
  const passage = validatedAnchorPassage(connectionId, row);
  const columnLocator = legacyLocatorFromColumns(connectionId, row);
  if (row.anchor_json === null) {
    // Compatibility reader for pre-v2 Derived rows. Such databases have their
    // projection marker invalidated and normally rebuild before this path.
    return {
      ...passage,
      ...(columnLocator ? { render_locator: columnLocator } : {}),
    };
  }

  const parsed = parseAnchorJson(connectionId, row);
  const keys = Object.keys(parsed);
  if (
    !keys.every((key) => [
      "book", "chapter", "verse_start", "verse_end", "render_locator",
    ].includes(key))
    || !["book", "chapter", "verse_start", "verse_end"].every((key) => (
      Object.prototype.hasOwnProperty.call(parsed, key)
    ))
  ) {
    throw new Error(`Derived legacy connection ${connectionId} anchor ${row.ordinal} has a mixed or open JSON shape.`);
  }
  assertJsonPassageMatchesColumns(connectionId, row, parsed);

  const rawLocator = parsed["render_locator"];
  if (rawLocator === undefined) {
    if (columnLocator) {
      throw new Error(`Derived legacy connection ${connectionId} anchor ${row.ordinal} lost its locator JSON.`);
    }
    return passage;
  }
  if (!isRecord(rawLocator) || !hasExactKeys(rawLocator, [
    "package", "char_start", "char_end", "quote",
  ])) {
    throw new Error(`Derived legacy connection ${connectionId} anchor ${row.ordinal} has malformed locator JSON.`);
  }
  if (
    typeof rawLocator["package"] !== "string"
    || !isNonNegativeSafeInteger(rawLocator["char_start"])
    || !isNonNegativeSafeInteger(rawLocator["char_end"])
    || (rawLocator["char_end"] as number) < (rawLocator["char_start"] as number)
    || typeof rawLocator["quote"] !== "string"
  ) {
    throw new Error(`Derived legacy connection ${connectionId} anchor ${row.ordinal} has invalid locator values.`);
  }
  const renderLocator = {
    package: rawLocator["package"],
    char_start: rawLocator["char_start"] as number,
    char_end: rawLocator["char_end"] as number,
    quote: rawLocator["quote"],
  };
  if (!columnLocator || JSON.stringify(renderLocator) !== JSON.stringify(columnLocator)) {
    throw new Error(`Derived legacy connection ${connectionId} anchor ${row.ordinal} locator columns disagree with JSON.`);
  }
  return { ...passage, render_locator: renderLocator };
}

function hydrateExactConnectionAnchor(
  connectionId: string,
  row: ConnectionAnchorRow,
): ConnectionAnchorV2 {
  const passage = validatedAnchorPassage(connectionId, row);
  if (
    row.package !== null
    || row.char_start !== null
    || row.char_end !== null
    || row.quote !== null
  ) {
    throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} contains a legacy package locator.`);
  }
  if (row.anchor_json === null) {
    throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} is missing lossless anchor JSON.`);
  }
  // The projection stores each anchor's lossless JSON verbatim, so a row
  // derived from history written by an older build still carries the retired
  // `selection_shape` sidecar and would fail the closed shape check below.
  // This is the SECOND read path for that field — the annotations reader
  // (validateConnectionRecord) is the first — and both share the one named
  // enumeration in ../core/annotations/retired-anchor-fields.js so the set of
  // retired fields cannot drift between them. The check below stays closed:
  // only enumerated fields are removed, and any other unknown key still fails.
  const stored = parseAnchorJson(connectionId, row);
  const migrated = migrateRetiredV2AnchorFields(stored);
  const parsed = isRecord(migrated) ? migrated : stored;
  if (!hasExactKeys(parsed, ["book", "chapter", "verse_start", "verse_end", "exact"])) {
    throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} has a mixed or open JSON shape.`);
  }
  assertJsonPassageMatchesColumns(connectionId, row, parsed);
  const rawExact = parsed["exact"];
  if (!isRecord(rawExact) || !hasExactKeys(rawExact, [
    "format_version", "layer", "occurrences",
  ])) {
    throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} has malformed exact-selector JSON.`);
  }
  if (
    rawExact["format_version"] !== BACKBONE_TOKEN_EXACT_FORMAT_VERSION
    || rawExact["layer"] !== BACKBONE_TOKEN_LAYER
  ) {
    throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} uses an unsupported exact selector.`);
  }
  const rawOccurrences = rawExact["occurrences"];
  if (
    !Array.isArray(rawOccurrences)
    || rawOccurrences.length === 0
    || rawOccurrences.length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR
  ) {
    throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} has an invalid occurrence count.`);
  }
  const occurrences: ConnectionAnchorV2["exact"]["occurrences"] = [];
  let previousVerse = 0;
  let previousPosition = 0;
  for (let index = 0; index < rawOccurrences.length; index++) {
    const occurrence = rawOccurrences[index];
    if (
      !isRecord(occurrence)
      || !hasExactKeys(occurrence, ["verse", "position"])
      || !isPositiveSafeInteger(occurrence["verse"])
      || !isPositiveSafeInteger(occurrence["position"])
    ) {
      throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} occurrence ${index} is malformed.`);
    }
    const verse = occurrence["verse"] as number;
    const position = occurrence["position"] as number;
    if (verse < passage.verse_start || verse > passage.verse_end) {
      throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} occurrence ${index} is outside its passage.`);
    }
    if (
      index > 0
      && (verse < previousVerse || (verse === previousVerse && position <= previousPosition))
    ) {
      throw new Error(`Derived v2 connection ${connectionId} anchor ${row.ordinal} occurrences are not strictly ordered.`);
    }
    occurrences.push({ verse, position });
    previousVerse = verse;
    previousPosition = position;
  }
  return {
    ...passage,
    exact: {
      format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences,
    },
  };
}

function validatedAnchorPassage(
  connectionId: string,
  row: ConnectionAnchorRow,
): Pick<ConnectionAnchorV1, "book" | "chapter" | "verse_start" | "verse_end"> {
  if (
    row.connection_id !== connectionId
    || !Number.isSafeInteger(row.ordinal)
    || row.ordinal < 0
    || !isValidBookCode(row.book)
    || !isPositiveSafeInteger(row.chapter)
    || !isPositiveSafeInteger(row.verse_start)
    || !isPositiveSafeInteger(row.verse_end)
    || row.verse_end < row.verse_start
  ) {
    throw new Error(`Derived connection ${connectionId} anchor ${row.ordinal} has invalid passage columns.`);
  }
  return {
    book: row.book,
    chapter: row.chapter,
    verse_start: row.verse_start,
    verse_end: row.verse_end,
  };
}

function legacyLocatorFromColumns(
  connectionId: string,
  row: ConnectionAnchorRow,
): ConnectionAnchorV1["render_locator"] {
  const values = [row.package, row.char_start, row.char_end, row.quote];
  if (values.every((value) => value === null)) return undefined;
  if (
    typeof row.package !== "string"
    || row.package.length === 0
    || !isNonNegativeSafeInteger(row.char_start)
    || !isNonNegativeSafeInteger(row.char_end)
    || row.char_end < row.char_start
    || typeof row.quote !== "string"
  ) {
    throw new Error(`Derived legacy connection ${connectionId} anchor ${row.ordinal} has partial locator columns.`);
  }
  return {
    package: row.package,
    char_start: row.char_start,
    char_end: row.char_end,
    quote: row.quote,
  };
}

function parseAnchorJson(
  connectionId: string,
  row: ConnectionAnchorRow,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.anchor_json ?? "");
  } catch {
    throw new Error(`Derived connection ${connectionId} anchor ${row.ordinal} has invalid anchor JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Derived connection ${connectionId} anchor ${row.ordinal} JSON must be an object.`);
  }
  return parsed;
}

function assertJsonPassageMatchesColumns(
  connectionId: string,
  row: ConnectionAnchorRow,
  parsed: Record<string, unknown>,
): void {
  if (
    parsed["book"] !== row.book
    || parsed["chapter"] !== row.chapter
    || parsed["verse_start"] !== row.verse_start
    || parsed["verse_end"] !== row.verse_end
  ) {
    throw new Error(`Derived connection ${connectionId} anchor ${row.ordinal} passage columns disagree with JSON.`);
  }
}

function validateAnchorCount(connectionId: string, kind: ConnectionKind, count: number): void {
  if (
    count < 2
    || count > MAX_CONNECTION_ANCHORS
    || (isBinaryConnectionKind(kind) && count !== 2)
  ) {
    throw new Error(`Derived connection ${connectionId} has an invalid anchor count for ${kind}.`);
  }
}

function requireIsoTimestamp(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be an ISO-8601 string.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${context} is not a canonical ISO-8601 instant.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => (
    Object.prototype.hasOwnProperty.call(value, key)
  ));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
