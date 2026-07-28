/**
 * Library engine — Node host layer.
 * Orchestrates the pure core modules with real file I/O and SQLite.
 */

import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { basename, join } from "node:path";
import { ulid } from "ulid";

/** Quote a scalar for the small double-quoted YAML subset written below. */
function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Generate a deterministic anchor ID from source data.
 * Anchors are Derived (part of the materialized view), so their IDs
 * must be deterministic to ensure rebuild_hash consistency (INV-2, INV-10).
 */
function deterministicAnchorId(
  srcKind: string,
  srcId: string,
  book: string,
  startCh: number,
  startV: number,
  endCh: number,
  endV: number,
): string {
  const input = `anchor:${srcKind}:${srcId}:${book}.${startCh}.${startV}-${endCh}.${endV}`;
  return "anc_" + createHash("sha256").update(input).digest("hex").slice(0, 24);
}
function deterministicConnectionAnchorId(
  connectionId: string,
  ordinal: number,
  formatVersion: number,
  canonicalIdentity: string,
): string {
  const input = `anchor:annotation:${connectionId}:v${formatVersion}:${ordinal}:${canonicalIdentity}`;
  return "anc_" + createHash("sha256").update(input).digest("hex").slice(0, 24);
}
import type { BackboneData, BookNameMap } from "../core/reference/types.js";
import type { LibraryEvent } from "../core/events/types.js";
import type {
  ConnectionAnchor,
  ConnectionAnchorV1,
  ConnectionContent,
  ConnectionContentV2,
  ConnectionEventPayload,
  ConnectionEventPayloadV2,
  ConnectionRecord,
  ConnectionRecordV2,
  CreateConnectionInput,
} from "../core/annotations/types.js";
import {
  CONNECTION_FORMAT_VERSION_V1,
  CONNECTION_FORMAT_VERSION_V2,
  validateConnectionRecord,
  validateNewConnectionRecord,
} from "../core/annotations/index.js";
import {
  backboneTokenAnchorKey,
} from "../core/annotations/backbone-token-anchor.js";
import type {
  BackboneTokenCatalog,
} from "../core/annotations/backbone-token-anchor.js";
import type {
  LibraryManifest,
  RevisionAppend,
  RevisionAppendReceipt,
} from "../core/interfaces.js";
import type { ParsedNote } from "../core/notes/types.js";
import type {
  AnchorRecord,
  EdgeRecord,
  HighlightRecord,
  FactRecord,
  NoteRecord,
  PdfLocator,
  SourceChunkRecord,
  SourceRecord,
} from "../core/indexer/types.js";
import { parseNote } from "../core/notes/parser.js";
import { parseScriptureRefs } from "../core/notes/parser.js";
import { foldEvents } from "../core/events/fold.js";

import { canonicalize } from "../core/indexer/hash.js";
import type { LogicalState } from "../core/indexer/hash.js";
import { SQLiteMaterializer } from "./sqlite.js";
import {
  checkMigration,
  CURRENT_APP_SCHEMA_VERSION,
  CURRENT_EVENT_SCHEMA_VERSION,
} from "../core/migration/index.js";
import type { MigrationResult } from "../core/migration/index.js";
import type {
  ImportedSource,
  SourceChunk,
  SourceMetadata,
  SourceRights,
  SourceSyncPolicy,
} from "../core/sources/types.js";
import { extractPdfChunks } from "./pdf-source.js";

const CONNECTION_LOG_RELATIVE_PATH = "annotations/connections.jsonl";
const CONNECTION_PROJECTION_META_KEY = "connections_projection_v2";
const CONNECTION_PROJECTION_SCHEMA_META_KEY = "connections_projection_schema";
const CONNECTION_PROJECTION_SCHEMA_VERSION = 2;
const LIBRARY_MANIFEST_RELATIVE_PATH = "config/library-manifest.json";

export type ConnectionCommandIdentity = {
  commandId: string;
  commandFingerprint: string;
};

/** A new authored command was based on a connection version that is no longer active. */
export class ConnectionVersionConflictError extends Error {
  readonly code = "connection-version-conflict" as const;

  constructor(
    readonly connectionId: string,
    readonly expectedBaseEventId: string,
    readonly activeEventId: string | null,
  ) {
    super(
      activeEventId
        ? `Connection ${connectionId} changed elsewhere. Reload it before saving this change.`
        : `Connection ${connectionId} was removed elsewhere. Reload before continuing.`,
    );
    this.name = "ConnectionVersionConflictError";
  }
}

type ActiveConnectionState = {
  activeEventId: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
};

type ConnectionEventCache = {
  byteLength: number;
  modifiedMs: number;
  events: LibraryEvent[];
  eventsById: Map<string, LibraryEvent>;
  eventIds: Set<string>;
  commandIndex: Map<string, LibraryEvent>;
  activeByEntity: Map<string, ActiveConnectionState>;
};

export type PlannedConnectionMutation =
  | {
      action: "upsert";
      connection: ConnectionRecord;
      /** The replayed command event may predate the returned current head. */
      event: LibraryEvent;
      append: RevisionAppend;
      replayed: boolean;
    }
  | {
      action: "delete";
      connectionId: string;
      /** The replayed command event may predate the current tombstone. */
      event: LibraryEvent;
      append: RevisionAppend;
      replayed: boolean;
    };

export class LibraryEngine {
  readonly rootPath: string;
  private backbone: BackboneData;
  private bookNames: BookNameMap;
  private tokenCatalog: BackboneTokenCatalog | null;
  private deviceId: string;
  private seqCounter: number;
  private connectionEventCache: ConnectionEventCache | null = null;
  private pendingInitializationManifest: LibraryManifest | null = null;

  constructor(
    rootPath: string,
    backbone: BackboneData,
    bookNames: BookNameMap,
    tokenCatalog?: BackboneTokenCatalog | null,
  ) {
    this.rootPath = rootPath;
    this.backbone = backbone;
    this.bookNames = bookNames;
    this.tokenCatalog = tokenCatalog ?? null;
    this.deviceId = "dev-" + ulid();
    this.seqCounter = 0;
  }

  /**
   * Initialize a new Library folder with the §4.3 layout.
   */
  initLibrary(commitManifest = true): void {
    const dirs = [
      "notes",
      "annotations",
      "sources",
      "plugins/settings",
      "config",
      ".artifacts/scripture/packages/web",
      ".artifacts/scripture/packages/kjv",
      ".artifacts/scripture/versification",
      ".artifacts/plugins",
      ".artifacts/themes",
      ".system/cache",
      ".system/logs",
      ".history",
    ];

    for (const dir of dirs) {
      mkdirSync(join(this.rootPath, dir), { recursive: true });
    }

    // Write default library.json
    writeFileSync(
      join(this.rootPath, "config/library.json"),
      JSON.stringify({ canonProfile: "protestant", defaultPackage: "bsb" }, null, 2),
    );

    // Write default budget-envelope.json
    writeFileSync(
      join(this.rootPath, "config/budget-envelope.json"),
      JSON.stringify({ backgroundAI: "off", networkBackground: false }, null, 2),
    );

    // Write empty annotation files
    for (const file of ["highlights.jsonl", "connections.jsonl", "pinned-facts.jsonl", "threads.jsonl", "note-change-log.jsonl"]) {
      writeFileSync(join(this.rootPath, "annotations", file), "");
    }

    // Write empty plugin list
    writeFileSync(
      join(this.rootPath, "plugins/installed.json"),
      JSON.stringify([], null, 2),
    );

    // Write .gitignore
    writeFileSync(
      join(this.rootPath, ".gitignore"),
      ".system/\n.artifacts/\nsources/**/original.*\n",
    );

    this.pendingInitializationManifest ??= this.createLibraryManifest();
    if (commitManifest) this.commitLibraryManifest();
  }

  /**
   * Atomically publish the manifest as the final initialization commit marker.
   * A crash before rename leaves no valid-looking partial Library (INV-17).
   */
  commitLibraryManifest(): void {
    const manifest = this.pendingInitializationManifest ?? this.createLibraryManifest();
    this.publishLibraryManifest(manifest);
    this.pendingInitializationManifest = null;
  }

  private createLibraryManifest(): LibraryManifest {
    return {
      libraryId: ulid(),
      createdAt: new Date().toISOString(),
      appSchemaVersion: CURRENT_APP_SCHEMA_VERSION,
      eventSchemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
      referenceFormatVersion: "bref:v1",
      pluginApiVersion: "1",
    };
  }

  /**
   * Explicitly migrate and atomically publish only the versioned manifest.
   * Authored event logs are outside this write boundary and remain byte-for-byte
   * untouched. The caller still owns registering the published path with its
   * RevisionStore (INV-12).
   */
  migrateLibraryManifest(): MigrationResult {
    const manifestPath = join(this.rootPath, LIBRARY_MANIFEST_RELATIVE_PATH);
    if (!existsSync(manifestPath)) {
      return {
        status: "error",
        message: "No library-manifest.json found. Initialize the library before migrating it.",
      };
    }

    const sourceBytes = readFileSyncInterruptible(manifestPath);
    const sourceManifest = JSON.parse(sourceBytes.toString("utf8")) as LibraryManifest;
    const result = checkMigration(sourceManifest, false);
    if (result.status !== "migrated") return result;

    const migratedManifest = result.manifest;
    if (
      migratedManifest.libraryId !== sourceManifest.libraryId
      || migratedManifest.createdAt !== sourceManifest.createdAt
      || migratedManifest.eventSchemaVersion !== sourceManifest.eventSchemaVersion
      || migratedManifest.referenceFormatVersion !== sourceManifest.referenceFormatVersion
      || migratedManifest.pluginApiVersion !== sourceManifest.pluginApiVersion
    ) {
      throw new Error("Manifest migration attempted to alter library identity or an unrelated durable format.");
    }

    this.publishLibraryManifest(migratedManifest, sourceBytes);
    return result;
  }

  /**
   * Read the library manifest.
   */
  readManifest(): LibraryManifest | null {
    const manifestPath = join(this.rootPath, LIBRARY_MANIFEST_RELATIVE_PATH);
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSyncInterruptible(manifestPath, "utf-8")) as LibraryManifest;
  }

  private publishLibraryManifest(manifest: LibraryManifest, expectedSource?: Buffer): void {
    const configPath = join(this.rootPath, "config");
    const manifestPath = join(this.rootPath, LIBRARY_MANIFEST_RELATIVE_PATH);
    const temporaryPath = join(
      configPath,
      `.library-manifest.${process.pid}.${ulid()}.tmp`,
    );
    mkdirSync(configPath, { recursive: true });

    try {
      writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const temporaryFd = openSync(temporaryPath, "r");
      try {
        fsyncSync(temporaryFd);
      } finally {
        closeSync(temporaryFd);
      }

      if (expectedSource !== undefined) {
        const currentSource = existsSync(manifestPath) ? readFileSyncInterruptible(manifestPath) : null;
        if (!currentSource?.equals(expectedSource)) {
          throw new Error("Library manifest changed while its migration was being prepared.");
        }
      }

      renameSync(temporaryPath, manifestPath);
      fsyncDirectory(configPath);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }

  /**
   * Copy backbone and versification data into .artifacts.
   */
  installBackboneData(backbonePath: string, versificationDir: string): void {
    const targetBackbone = join(this.rootPath, ".artifacts/scripture/backbone.json");
    writeFileSync(targetBackbone, readFileSyncInterruptible(backbonePath, "utf-8"));

    const targetVersDir = join(this.rootPath, ".artifacts/scripture/versification");
    mkdirSync(targetVersDir, { recursive: true });
    for (const file of readdirSync(versificationDir)) {
      writeFileSync(
        join(targetVersDir, file),
        readFileSyncInterruptible(join(versificationDir, file), "utf-8"),
      );
    }
  }

  /**
   * Install a scripture package manifest into .artifacts.
   */
  installPackageManifest(packageId: string, manifest: object): void {
    const dir = join(this.rootPath, ".artifacts/scripture/packages", packageId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  /**
   * Create a note file.
   */
  createNote(id: string, title: string, body: string, opts?: { type?: string; tags?: string[] }): string {
    const now = new Date().toISOString();
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const filename = `${id}--${slug}.md`;

    let frontmatter = `---\nid: ${id}\ntitle: ${yamlQuote(title)}\ncreated: ${now}\nmodified: ${now}\n`;
    if (opts?.type) frontmatter += `type: ${opts.type}\n`;
    if (opts?.tags && opts.tags.length > 0) frontmatter += `tags: [${opts.tags.join(", ")}]\n`;
    frontmatter += "---\n";

    const content = frontmatter + body;
    const notePath = join(this.rootPath, "notes", filename);
    writeFileSync(notePath, content);
    return notePath;
  }

  private findNotePath(id: string): string | null {
    const notesPath = join(this.rootPath, "notes");
    if (!existsSync(notesPath)) return null;
    const filename = readdirSync(notesPath).find(
      (entry) => entry.startsWith(`${id}--`) && entry.endsWith(".md"),
    );
    return filename ? join(notesPath, filename) : null;
  }

  /** Update a note in place while preserving its durable identity and type. */
  updateNote(id: string, title: string, body: string, opts?: { tags?: string[] }): string | null {
    const notePath = this.findNotePath(id);
    if (!notePath) return null;
    const existing = parseNote(readFileSyncInterruptible(notePath, "utf-8"), this.bookNames, this.backbone);
    const now = new Date().toISOString();
    const tags = opts?.tags ?? existing.frontmatter.tags;

    let frontmatter = `---\nid: ${id}\ntitle: ${yamlQuote(title)}\ncreated: ${existing.frontmatter.created || now}\nmodified: ${now}\n`;
    if (existing.frontmatter.type) frontmatter += `type: ${existing.frontmatter.type}\n`;
    if (tags && tags.length > 0) frontmatter += `tags: [${tags.join(", ")}]\n`;
    frontmatter += "---\n";

    writeFileSync(notePath, frontmatter + body);
    return notePath;
  }

  /** Remove a note and return its exact bytes for the explicit Undo path. */
  deleteNote(id: string): { filename: string; content: string } | null {
    const notePath = this.findNotePath(id);
    if (!notePath) return null;
    const content = readFileSyncInterruptible(notePath, "utf-8");
    rmSync(notePath);
    return { filename: basename(notePath), content };
  }

  /** Restore an explicitly deleted note without overwriting another note. */
  restoreNote(filename: string, content: string): string | null {
    if (!/^[A-Za-z0-9]+--[^/\\]+\.md$/.test(filename)) return null;
    const notePath = join(this.rootPath, "notes", filename);
    if (existsSync(notePath)) return null;
    writeFileSync(notePath, content, { flag: "wx" });
    return notePath;
  }

  /**
   * Append a LibraryEvent to the appropriate JSONL log.
   */
  appendEvent(event: LibraryEvent): void {
    const fileMap: Record<string, string> = {
      highlight: "highlights.jsonl",
      annotation: "connections.jsonl",
      fact: "pinned-facts.jsonl",
      thread: "threads.jsonl",
      noteMeta: "note-change-log.jsonl",
    };
    const filename = fileMap[event.entityType];
    if (!filename) {
      throw new Error(`No annotation log is configured for entity type ${event.entityType}.`);
    }
    const logPath = join(this.rootPath, "annotations", filename);
    const line = JSON.stringify(event) + "\n";
    writeFileSync(logPath, line, { flag: "a" });
  }

  /**
   * Create a library event with proper envelope.
   */
  createEvent<T>(
    entityType: LibraryEvent["entityType"],
    entityId: string,
    op: LibraryEvent["op"],
    payload: T,
    baseEventId?: string,
  ): LibraryEvent<T> {
    this.seqCounter++;
    return {
      eventId: ulid(),
      schemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
      entityType,
      entityId,
      op,
      actor: { kind: "user" },
      deviceId: this.deviceId,
      seq: this.seqCounter,
      createdAt: new Date().toISOString(),
      baseEventId,
      payload,
    };
  }

  /**
   * Read all events from annotation JSONL files.
   */
  readAllEvents(): {
    highlights: LibraryEvent[];
    connections: LibraryEvent[];
    pinnedFacts: LibraryEvent[];
    threads: LibraryEvent[];
    noteChangeLogs: LibraryEvent[];
  } {
    return {
      highlights: this.readJsonlEvents("highlights.jsonl"),
      connections: [...this.readConnectionEvents()],
      pinnedFacts: this.readJsonlEvents("pinned-facts.jsonl"),
      threads: this.readJsonlEvents("threads.jsonl"),
      noteChangeLogs: this.readJsonlEvents("note-change-log.jsonl"),
    };
  }

  private readJsonlEvents(filename: string): LibraryEvent[] {
    const filePath = join(this.rootPath, "annotations", filename);
    if (!existsSync(filePath)) return [];
    const content = readFileSyncInterruptible(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LibraryEvent);
  }

  /**
   * Connection commands are planned on the Electron main thread. Cache their
   * append-only parse by file signature so repeated mutations do not rescan
   * every annotation log or retain a fresh second copy per command.
   */
  private readConnectionEvents(): LibraryEvent[] {
    const filePath = join(this.rootPath, CONNECTION_LOG_RELATIVE_PATH);
    const stat = existsSync(filePath) ? statSync(filePath) : null;
    if (
      this.connectionEventCache
      && this.connectionEventCache.byteLength === (stat?.size ?? 0)
      && this.connectionEventCache.modifiedMs === (stat?.mtimeMs ?? 0)
    ) {
      return this.connectionEventCache.events;
    }
    const events = stat
      ? readFileSyncInterruptible(filePath, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as LibraryEvent)
      : [];
    this.connectionEventCache = this.buildConnectionEventCache(
      events,
      stat?.size ?? 0,
      stat?.mtimeMs ?? 0,
    );
    return events;
  }

  private buildConnectionEventCache(
    events: LibraryEvent[],
    byteLength: number,
    modifiedMs: number,
  ): ConnectionEventCache {
    const commandIndex = new Map<string, LibraryEvent>();
    const eventsById = new Map<string, LibraryEvent>();
    for (const event of events) {
      assertConnectionEventEnvelope(event);
      // INV-17 applies to the complete append-only history, not only the
      // currently folded head. A tombstoned or superseded future payload must
      // never hide behind folding and become readable after a later merge.
      if (event.op !== "delete") {
        this.requireConnectionContent(event.entityId, event.payload);
      }
      const duplicateEvent = eventsById.get(event.eventId);
      if (duplicateEvent && JSON.stringify(duplicateEvent) !== JSON.stringify(event)) {
        throw new Error(`Connection event ${event.eventId} appears with conflicting bytes.`);
      }
      eventsById.set(event.eventId, event);
      if (!event.commandId) continue;
      const existing = commandIndex.get(event.commandId);
      if (existing && existing.eventId !== event.eventId) {
        throw new Error(`Authored command ${event.commandId} appears more than once in connections.jsonl.`);
      }
      commandIndex.set(event.commandId, event);
    }
    const activeByEntity = new Map<string, ActiveConnectionState>();
    for (const entity of foldEvents(events).entities) {
      if (entity.entityType !== "annotation") continue;
      const timestamps = connectionRecordTimestamps(
        entity.entityId,
        entity.activeEventId,
        eventsById,
      );
      activeByEntity.set(entity.entityId, {
        activeEventId: entity.activeEventId,
        payload: entity.payload,
        createdAt: timestamps.createdAt,
        updatedAt: timestamps.updatedAt,
      });
    }
    return {
      byteLength,
      modifiedMs,
      events,
      eventsById,
      eventIds: new Set(events.map((event) => event.eventId)),
      commandIndex,
      activeByEntity,
    };
  }

  /** Advance the hot append-only cache without reparsing the full log. */
  private acceptCommittedConnectionEvent(event: LibraryEvent): void {
    assertConnectionEventEnvelope(event);
    const filePath = join(this.rootPath, CONNECTION_LOG_RELATIVE_PATH);
    const stat = statSync(filePath);
    const cache = this.connectionEventCache;
    if (!cache) {
      this.readConnectionEvents();
      return;
    }
    if (cache.eventIds.has(event.eventId)) {
      if (cache.byteLength !== stat.size || cache.modifiedMs !== stat.mtimeMs) {
        // The command was already cached, but the file advanced elsewhere.
        // Never bless the new size without parsing those intervening bytes.
        this.connectionEventCache = null;
        this.readConnectionEvents();
      }
      return;
    }
    const appendedLine = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
    const appendedBytes = appendedLine.byteLength;
    const active = cache.activeByEntity.get(event.entityId);
    const linear = event.op === "create"
      ? active === undefined
      : active?.activeEventId === event.baseEventId;
    if (
      stat.size !== cache.byteLength + appendedBytes
      || !linear
      || !fileSliceEquals(filePath, cache.byteLength, appendedLine)
    ) {
      // External/sync writes or a contested causal branch require one honest
      // full fold; normal serialized local commands stay O(1).
      this.connectionEventCache = null;
      this.readConnectionEvents();
      return;
    }
    cache.events.push(event);
    cache.eventsById.set(event.eventId, event);
    cache.eventIds.add(event.eventId);
    if (event.commandId) cache.commandIndex.set(event.commandId, event);
    if (event.op === "delete") {
      cache.activeByEntity.delete(event.entityId);
    } else {
      const createdAt = event.op === "create"
        ? requireIsoTimestamp(event.createdAt, `Connection ${event.entityId} create event`)
        : active?.createdAt;
      if (!createdAt) {
        throw new Error(`Connection ${event.entityId} has no causal create event.`);
      }
      cache.activeByEntity.set(event.entityId, {
        activeEventId: event.eventId,
        payload: event.payload,
        createdAt,
        updatedAt: requireIsoTimestamp(
          event.createdAt,
          `Connection ${event.entityId} active event`,
        ),
      });
    }
    cache.byteLength = stat.size;
    cache.modifiedMs = stat.mtimeMs;
  }

  /**
   * Read and parse all notes.
   */
  readAllNotes(): ParsedNote[] {
    const notesDir = join(this.rootPath, "notes");
    if (!existsSync(notesDir)) return [];
    const files = readdirSync(notesDir).filter((f) => f.endsWith(".md"));
    return files.map((file) => {
      const content = readFileSyncInterruptible(join(notesDir, file), "utf-8");
      return parseNote(content, this.bookNames, this.backbone);
    });
  }

  /**
   * Build (or rebuild) the .system/library.sqlite materialized view.
   * Returns the rebuild_hash.
   */
  buildSqlite(): string {
    // A new candidate runtime builds Derived state before the manifest's
    // atomic final rename. Only the engine that staged initLibrary(false)
    // owns this in-memory manifest; ordinary reads still require publication.
    const manifest = this.requireReadableManifest(true);
    const systemDir = join(this.rootPath, ".system");
    mkdirSync(systemDir, { recursive: true });
    const dbPath = join(systemDir, "library.sqlite");

    const opened = openMaterializerForRebuild(dbPath, systemDir);
    const materializer = opened.materializer;
    const rebuild = (): string => {
      // Clear and repopulate the existing WAL database under one immediate
      // transaction. Existing readers keep the old snapshot until the exact
      // folded state and its projection marker commit together.
      materializer.clear();
      // 1. Read and index notes
      const notes = this.readAllNotes();
      const noteRecords: NoteRecord[] = [];
      const allAnchors: AnchorRecord[] = [];
      const allEdges: EdgeRecord[] = [];

      for (const note of notes) {
        const noteRecord: NoteRecord = {
          id: note.frontmatter.id,
          title: note.frontmatter.title,
          type: note.frontmatter.type ?? "",
          path: "",
          created: note.frontmatter.created,
          modified: note.frontmatter.modified,
          body_text: note.body,
        };
        noteRecords.push(noteRecord);
        materializer.insertNote(noteRecord);

        if (note.frontmatter.tags) {
          materializer.insertNoteTags(
            note.frontmatter.tags.map((tag) => ({
              note_id: note.frontmatter.id,
              tag,
            })),
          );
        }

        // Create anchors for scripture refs
        for (const sr of note.scriptureRefs) {
          const anchorId = deterministicAnchorId(
            "note", note.frontmatter.id,
            sr.ref.start.book, sr.ref.start.chapter, sr.ref.start.verse,
            sr.ref.end.chapter, sr.ref.end.verse,
          );
          const anchor: AnchorRecord = {
            id: anchorId,
            src_kind: "note",
            src_id: note.frontmatter.id,
            corpus: "protestant",
            book: sr.ref.start.book,
            start_ch: sr.ref.start.chapter,
            start_v: sr.ref.start.verse,
            end_ch: sr.ref.end.chapter,
            end_v: sr.ref.end.verse,
            provenance: "user",
          };
          allAnchors.push(anchor);
          materializer.insertAnchor(anchor);
        }

        // Create edges for note links
        for (const link of note.noteLinks) {
          const edge: EdgeRecord = {
            src_id: `note:${note.frontmatter.id}`,
            dst_id: `note:${link.targetId}`,
            kind: "note-link",
            provenance: "user",
          };
          allEdges.push(edge);
          materializer.insertEdge(edge);
        }
      }

      // 2. Fold events and materialize highlights/facts
      const events = this.readAllEvents();
      this.assertConnectionEventsMatchManifest(manifest, events.connections);
      const builtConnectionProjectionSignature = connectionProjectionSignatureFor(
        this.connectionEventCache?.byteLength ?? 0,
        events.connections.length,
        events.connections.at(-1)?.eventId,
      );
      const allEvents = [
        ...events.highlights,
        ...events.connections,
        ...events.pinnedFacts,
        ...events.threads,
        ...events.noteChangeLogs,
      ];

      const foldResult = foldEvents(allEvents);

      const allHighlights: HighlightRecord[] = [];
      const allFacts: FactRecord[] = [];

      for (const entity of foldResult.entities) {
        if (entity.entityType === "highlight") {
          const payload = entity.payload as Record<string, unknown>;
          const highlight: HighlightRecord = {
            id: entity.entityId,
            book: String(payload["book"] ?? ""),
            chapter: Number(payload["chapter"] ?? 0),
            verse_start: Number(payload["verse_start"] ?? 0),
            verse_end: Number(payload["verse_end"] ?? payload["verse_start"] ?? 0),
            package: String(payload["package"] ?? ""),
            char_start: payload["char_start"] != null ? Number(payload["char_start"]) : null,
            char_end: payload["char_end"] != null ? Number(payload["char_end"]) : null,
            color: String(payload["color"] ?? "yellow"),
            kind: String(payload["kind"] ?? "highlight"),
            note_id: payload["note_id"] != null ? String(payload["note_id"]) : null,
            deleted: 0,
          };
          allHighlights.push(highlight);
          materializer.insertHighlight(highlight);

          // Create an anchor for the highlight
          const hlAnchorId = deterministicAnchorId(
            "highlight", entity.entityId,
            highlight.book, highlight.chapter, highlight.verse_start,
            highlight.chapter, highlight.verse_end,
          );
          const anchor: AnchorRecord = {
            id: hlAnchorId,
            src_kind: "highlight",
            src_id: entity.entityId,
            corpus: "protestant",
            book: highlight.book,
            start_ch: highlight.chapter,
            start_v: highlight.verse_start,
            end_ch: highlight.chapter,
            end_v: highlight.verse_end,
            provenance: "user",
          };
          allAnchors.push(anchor);
          materializer.insertAnchor(anchor);
        }

        if (entity.entityType === "fact") {
          const payload = entity.payload as Record<string, unknown>;
          const fact: FactRecord = {
            id: entity.entityId,
            assertion: String(payload["assertion"] ?? ""),
            from_claim: payload["from_claim"] != null ? String(payload["from_claim"]) : null,
            user_note: payload["user_note"] != null ? String(payload["user_note"]) : null,
            deleted: 0,
          };
          allFacts.push(fact);
          materializer.insertFact(fact);
        }

        if (entity.entityType === "annotation") {
          const active = this.connectionEventCache?.activeByEntity.get(entity.entityId);
          if (!active || active.activeEventId !== entity.activeEventId) {
            throw new Error(
              `Connection ${entity.entityId} active event metadata could not be derived from Substrate.`,
            );
          }
          const connection = this.requireConnectionRecord(
            entity.entityId,
            entity.payload,
            entity.activeEventId,
            active.createdAt,
            active.updatedAt,
          );
          const derivedAnchors = this.deriveConnectionAnchors(connection);
          allAnchors.push(...derivedAnchors);
          materializer.upsertConnectionWithAnchors(connection, derivedAnchors);
        }
      }

      // 3. Record applied events
      for (const [_eventId, appliedEvent] of foldResult.appliedIndex) {
        materializer.insertAppliedEvent(appliedEvent);
      }

      // 4. Compute rebuild_hash
      const logicalState: LogicalState = {
        entities: foldResult.entities,
        notes: noteRecords,
        anchors: allAnchors,
        edges: allEdges,
        highlights: allHighlights,
        facts: allFacts,
      };

      const canonical = canonicalize(logicalState);
      const hash = createHash("sha256").update(canonical).digest("hex");

      // 5. Store metadata
      materializer.setMeta("schema_version", String(CURRENT_APP_SCHEMA_VERSION));
      materializer.setMeta("rebuild_hash", hash);
      materializer.setMeta(
        CONNECTION_PROJECTION_SCHEMA_META_KEY,
        String(CONNECTION_PROJECTION_SCHEMA_VERSION),
      );
      // Bind the marker to the exact event snapshot folded above. If another
      // process appends during a rebuild, startup reconciliation will see the
      // older marker and rebuild again instead of blessing unseen bytes.
      materializer.setMeta(CONNECTION_PROJECTION_META_KEY, builtConnectionProjectionSignature);
      materializer.setMeta("built_at", new Date().toISOString());
      materializer.setMeta("app_version", "0.1.0");

      return hash;
    };
    try {
      const hash = materializer.runImmediateTransaction(rebuild);
      if (opened.replacedCorruptDerived) fsyncDirectory(systemDir);
      return hash;
    } finally {
      materializer.close();
    }
  }

  /**
   * Cheap startup reconciliation for the authored connection log.
   * A crash after event fsync but before incremental projection leaves this
   * marker behind, forcing a deterministic Derived rebuild on next launch.
   */
  isConnectionProjectionCurrent(): boolean {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return false;
    let materializer: SQLiteMaterializer | null = null;
    try {
      const manifest = this.requireReadableManifest(true);
      const events = this.readConnectionEvents();
      this.assertConnectionEventsMatchManifest(manifest, events);
      this.assertActiveConnectionRecordsReadable();
      const signature = this.connectionProjectionSignature();
      materializer = new SQLiteMaterializer(dbPath);
      if (
        materializer.getMeta(CONNECTION_PROJECTION_SCHEMA_META_KEY)
        !== String(CONNECTION_PROJECTION_SCHEMA_VERSION)
      ) return false;
      if (materializer.getMeta(CONNECTION_PROJECTION_META_KEY) !== signature) return false;
      return this.connectionProjectionSignature() === signature;
    } catch {
      return false;
    } finally {
      materializer?.close();
    }
  }

  /**
   * Query everything anchored to a specific verse.
   */
  queryVerse(book: string, chapter: number, verse: number): {
    anchors: AnchorRecord[];
    highlights: HighlightRecord[];
    connections: ConnectionRecord[];
    notes: NoteRecord[];
  } {
    const manifest = this.requireReadableManifest();
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);

    try {
      const anchors = materializer.queryAnchorsForVerse(book, chapter, verse);
      const highlights = materializer.queryHighlightsForVerse(book, chapter, verse);
      const connections = materializer
        .queryConnectionsForVerse(book, chapter, verse)
        .map((connection) => this.requireProjectedConnectionRecord(connection));
      this.assertProjectedConnectionsMatchManifest(manifest, connections);

      // Resolve note IDs from anchors
      const noteIds = new Set<string>();
      for (const anchor of anchors) {
        if (anchor.src_kind === "note") {
          noteIds.add(anchor.src_id);
        }
      }

      const notes: NoteRecord[] = [];
      for (const noteId of noteIds) {
        const note = materializer.queryNoteById(noteId);
        if (note) notes.push(note);
      }

      materializer.close();
      return { anchors, highlights, connections, notes };
    } catch (err) {
      materializer.close();
      throw err;
    }
  }

  /**
   * Delete the .system/ directory (to test rebuild determinism).
   */
  deleteSystemDir(): void {
    const systemDir = join(this.rootPath, ".system");
    if (existsSync(systemDir)) {
      rmSync(systemDir, { recursive: true });
    }
  }

  /**
   * Get summary stats from the materialized view.
   */
  getSummary(): {
    notesFound: number;
    anchorsFound: number;
    highlightsFound: number;
    factsFound: number;
    unresolvedRefs: number;
    errors: string[];
  } {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);

    try {
      const notes = materializer.getAllNotes();
      const anchors = materializer.getAllAnchors();
      const highlights = materializer.getAllHighlights();
      const facts = materializer.getAllFacts();

      materializer.close();

      return {
        notesFound: notes.length,
        anchorsFound: anchors.length,
        highlightsFound: highlights.filter((h) => h.deleted === 0).length,
        factsFound: facts.filter((f) => f.deleted === 0).length,
        unresolvedRefs: 0,
        errors: [],
      };
    } catch (err) {
      materializer.close();
      throw err;
    }
  }

  // --- M3: Claims, Overlays, FactCards ---

  /**
   * Insert a derived Claim into the materialized view.
   * Claims are Derived data — disposable, regenerable.
   */
  insertClaim(claim: {
    id: string;
    assertion: string;
    claimType: string;
    confidence: number;
    extractor: string;
    created: string;
    status: string;
    anchors: { book: string; chapter: number; verse: number }[];
    sources: { kind: string; ref: string }[];
  }): void {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertClaim({
        id: claim.id,
        assertion: claim.assertion,
        claim_type: claim.claimType,
        confidence: claim.confidence,
        extractor: claim.extractor,
        created: claim.created,
        status: claim.status,
      });
      for (const anchor of claim.anchors) {
        materializer.insertClaimAnchor({
          claim_id: claim.id,
          book: anchor.book,
          chapter: anchor.chapter,
          verse: anchor.verse,
        });
      }
      for (const source of claim.sources) {
        materializer.insertClaimSource({
          claim_id: claim.id,
          kind: source.kind,
          ref: source.ref,
        });
      }
    } finally {
      materializer.close();
    }
  }

  /**
   * Insert a derived Overlay into the materialized view.
   * Overlays are Derived data — disposable, regenerable.
   */
  insertOverlay(overlay: {
    id: string;
    book: string;
    chapter: number;
    verse: number;
    charStart: number;
    charEnd: number;
    reason: string;
    extractor: string;
  }): void {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertOverlay({
        id: overlay.id,
        book: overlay.book,
        chapter: overlay.chapter,
        verse: overlay.verse,
        char_start: overlay.charStart,
        char_end: overlay.charEnd,
        reason: overlay.reason,
        extractor: overlay.extractor,
      });
    } finally {
      materializer.close();
    }
  }

  /**
   * Pin a Claim → FactCard.
   * This is a Substrate write (INV-1): appends a `pin` event to pinned-facts.jsonl
   * and copies the claim's assertion into Substrate.
   * The FactCard survives a .system/ wipe because it's in the event log.
   */
  pinClaim(claimId: string, assertion: string, userNote?: string): string {
    const factId = "fact_" + ulid();
    const event = this.createEvent("fact", factId, "pin", {
      assertion,
      fromClaim: claimId,
      userNote: userNote ?? null,
    });
    this.appendEvent(event);

    // Also write the fact to the materialized view immediately
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertFact({
        id: factId,
        assertion,
        from_claim: claimId,
        user_note: userNote ?? null,
        deleted: 0,
      });
    } finally {
      materializer.close();
    }

    return factId;
  }

  /**
   * Promote an Overlay → real Highlight event.
   * This is a Substrate write (INV-1): appends a `create` event to highlights.jsonl.
   */
  promoteOverlay(overlayId: string, book: string, chapter: number, verseStart: number, verseEnd: number, color: string): string {
    const hlId = "hl_" + ulid() + "_" + overlayId.slice(0, 8);
    const event = this.createEvent("highlight", hlId, "create", {
      book,
      chapter,
      verse_start: verseStart,
      verse_end: verseEnd,
      package: "web",
      color,
      kind: "highlight",
    });
    this.appendEvent(event);
    return hlId;
  }

  /**
   * Get the path to the embeddings database.
   */
  getEmbeddingsDbPath(): string {
    return join(this.rootPath, ".system/embeddings.sqlite");
  }

  /**
   * Get all facts (FactCards) from the materialized view.
   */
  getAllFacts(): { id: string; assertion: string; from_claim: string | null; user_note: string | null; deleted: number }[] {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      return materializer.getAllFacts();
    } finally {
      materializer.close();
    }
  }

  /**
   * Incrementally apply a highlight creation to SQLite without full rebuild (INV-9).
   * Also appends the event to the JSONL log (INV-7).
   * Returns the new highlight entity ID.
   */
  applyHighlightCreate(
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd: number,
    color: string,
    pkg: string,
    charStart: number | null = null,
    charEnd: number | null = null,
  ): string {
    const entityId = "hl_" + ulid();
    const event = this.createEvent("highlight", entityId, "create", {
      book,
      chapter,
      verse_start: verseStart,
      verse_end: verseEnd,
      package: pkg,
      char_start: charStart,
      char_end: charEnd,
      color,
      kind: "highlight",
    });
    this.appendEvent(event);

    // Incremental SQLite update
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertHighlightIncremental({
        id: entityId,
        book,
        chapter,
        verse_start: verseStart,
        verse_end: verseEnd,
        package: pkg,
        char_start: charStart,
        char_end: charEnd,
        color,
        kind: "highlight",
        note_id: null,
        deleted: 0,
      });
    } finally {
      materializer.close();
    }

    return entityId;
  }

  /**
   * Incrementally apply a highlight update (e.g. trimming an edge to make
   * room for a newly created overlapping highlight) without a full rebuild
   * (INV-9). Uses an `update` event (whole-payload LWW — see fold.ts and
   * tests/fold-highlight.test.ts) rather than delete+create specifically so
   * the highlight keeps its id across the edit: undo-toast closures and the
   * Living Margin's pinned-highlight lookup both key off `highlight.id`, and
   * a delete+recreate would silently mint a new one, orphaning both. Also
   * appends the event to the JSONL log (INV-7).
   */
  applyHighlightUpdate(
    entityId: string,
    next: {
      book: string;
      chapter: number;
      verseStart: number;
      verseEnd: number;
      package: string;
      color: string;
      charStart: number | null;
      charEnd: number | null;
    },
  ): void {
    const event = this.createEvent("highlight", entityId, "update", {
      book: next.book,
      chapter: next.chapter,
      verse_start: next.verseStart,
      verse_end: next.verseEnd,
      package: next.package,
      char_start: next.charStart,
      char_end: next.charEnd,
      color: next.color,
      kind: "highlight",
    });
    this.appendEvent(event);

    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertHighlightIncremental({
        id: entityId,
        book: next.book,
        chapter: next.chapter,
        verse_start: next.verseStart,
        verse_end: next.verseEnd,
        package: next.package,
        char_start: next.charStart,
        char_end: next.charEnd,
        color: next.color,
        kind: "highlight",
        note_id: null,
        deleted: 0,
      });
    } finally {
      materializer.close();
    }
  }

  /**
   * Incrementally mark a highlight as deleted in SQLite without full rebuild (INV-9).
   * Also appends a delete event to the JSONL log (INV-7).
   */
  applyHighlightDelete(entityId: string, baseEventId?: string): void {
    const event = this.createEvent("highlight", entityId, "delete", {}, baseEventId);
    this.appendEvent(event);

    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.deleteHighlightIncremental(entityId);
    } finally {
      materializer.close();
    }
  }

  /**
   * Restore a tombstoned highlight without minting a new entity id. The event
   * fold already retains the last active payload across a delete; `restore`
   * makes that payload active again, while the explicit snapshot repopulates
   * the derived SQLite row immediately (INV-7 / INV-9).
   */
  applyHighlightRestore(highlight: HighlightRecord): void {
    const event = this.createEvent("highlight", highlight.id, "restore", {});
    this.appendEvent(event);

    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertHighlightIncremental({ ...highlight, deleted: 0 });
    } finally {
      materializer.close();
    }
  }

  /**
   * Query active highlights for a specific book/chapter/package (for overlap detection).
   */
  queryHighlightsForChapter(book: string, chapter: number, pkg: string): HighlightRecord[] {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      return materializer.queryHighlightsForChapter(book, chapter, pkg);
    } finally {
      materializer.close();
    }
  }

  // --- User-authored relationship annotations ---

  /**
   * Validate and plan a relationship create without touching Substrate or
   * Derived state. Only UserMutationBroker may commit this append (INV-12).
   */
  planConnectionCreate(
    input: CreateConnectionInput,
    command: ConnectionCommandIdentity,
  ): PlannedConnectionMutation {
    const replay = this.replayConnectionCommand(command, "create");
    if (replay) {
      if (replay.action !== "upsert" || replay.connection.format_version !== CONNECTION_FORMAT_VERSION_V2) {
        throw new Error("A new connection command cannot replay a legacy v1 payload.");
      }
      this.ensureConnectionV2ManifestBoundary();
      return replay;
    }
    const connectionId = "conn_" + ulid();
    const content = this.requireNewConnectionContent(connectionId, {
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind: input.kind,
      label: input.label,
      observation: input.observation,
      anchors: input.anchors,
    });
    // The manifest rename is one atomic publication, ordered before the
    // append-only event. These two files cannot share a filesystem transaction:
    // interruption may therefore leave a safe schema-v2 manifest with the old
    // authored log, never a v2 event under a schema-v1 manifest. Retry resumes
    // at the idempotent JSONL append boundary.
    this.ensureConnectionV2ManifestBoundary();
    const payload: ConnectionEventPayloadV2 = {
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind: content.kind,
      label: content.label,
      observation: content.observation,
      anchors: content.anchors,
    };
    const event: LibraryEvent<ConnectionEventPayloadV2> = {
      ...this.createEvent("annotation", content.id, "create", payload),
      ...command,
    };
    const createdAt = requireIsoTimestamp(event.createdAt, `Connection ${content.id} create event`);
    const connection: ConnectionRecordV2 = {
      ...content,
      activeEventId: event.eventId,
      createdAt,
      updatedAt: createdAt,
    };
    return {
      action: "upsert",
      connection,
      event,
      append: this.planConnectionAppend(event),
      replayed: false,
    };
  }

  /**
   * Plan a causally based replacement. The active base is read while the
   * broker owns its serialization lane, so concurrent commands cannot plan
   * two sibling updates from the same event.
   */
  planConnectionUpdate(
    connectionId: string,
    input: CreateConnectionInput,
    command: ConnectionCommandIdentity,
    expectedBaseEventId: string,
  ): PlannedConnectionMutation {
    const replay = this.replayConnectionCommand(command, "update");
    if (replay) {
      if (replay.action !== "upsert" || replay.connection.format_version !== CONNECTION_FORMAT_VERSION_V2) {
        throw new Error("A current connection update cannot replay a legacy v1 payload.");
      }
      this.ensureConnectionV2ManifestBoundary();
      return replay;
    }
    const events = this.readConnectionEvents();
    const active = this.connectionEventCache?.activeByEntity.get(connectionId);
    if (!active) {
      if (events.some((event) => event.entityId === connectionId)) {
        throw new ConnectionVersionConflictError(connectionId, expectedBaseEventId, null);
      }
      throw new Error(`Connection ${connectionId} was not found.`);
    }
    if (active.activeEventId !== expectedBaseEventId) {
      throw new ConnectionVersionConflictError(
        connectionId,
        expectedBaseEventId,
        active.activeEventId,
      );
    }

    const content = this.requireNewConnectionContent(connectionId, {
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind: input.kind,
      label: input.label,
      observation: input.observation,
      anchors: input.anchors,
    });
    this.ensureConnectionV2ManifestBoundary();
    const payload: ConnectionEventPayloadV2 = {
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind: content.kind,
      label: content.label,
      observation: content.observation,
      anchors: content.anchors,
    };
    const event: LibraryEvent<ConnectionEventPayloadV2> = {
      ...this.createEvent(
        "annotation",
        content.id,
        "update",
        payload,
        active.activeEventId,
      ),
      ...command,
    };
    const connection: ConnectionRecordV2 = {
      ...content,
      activeEventId: event.eventId,
      createdAt: active.createdAt,
      updatedAt: requireIsoTimestamp(
        event.createdAt,
        `Connection ${connectionId} active event`,
      ),
    };
    return {
      action: "upsert",
      connection,
      event,
      append: this.planConnectionAppend(event),
      replayed: false,
    };
  }

  /** Plan a causally based tombstone without writing it. */
  planConnectionDelete(
    connectionId: string,
    command: ConnectionCommandIdentity,
    expectedBaseEventId: string,
  ): PlannedConnectionMutation {
    const replay = this.replayConnectionCommand(command, "delete");
    if (replay) return replay;
    const events = this.readConnectionEvents();
    const active = this.connectionEventCache?.activeByEntity.get(connectionId);
    if (!active) {
      if (events.some((event) => event.entityId === connectionId)) {
        throw new ConnectionVersionConflictError(connectionId, expectedBaseEventId, null);
      }
      throw new Error(`Connection ${connectionId} was not found.`);
    }
    if (active.activeEventId !== expectedBaseEventId) {
      throw new ConnectionVersionConflictError(
        connectionId,
        expectedBaseEventId,
        active.activeEventId,
      );
    }
    const event: LibraryEvent<Record<string, never>> = {
      ...this.createEvent(
        "annotation",
        connectionId,
        "delete",
        {} as Record<string, never>,
        active.activeEventId,
      ),
      ...command,
    };
    return {
      action: "delete",
      connectionId,
      event,
      append: this.planConnectionAppend(event),
      replayed: false,
    };
  }

  /**
   * Resolve the event that actually won RevisionStore's compare-and-append.
   * Independent planners can mint different provisional ids for the same
   * command; only the receipt/disk event is safe to return or project.
   */
  resolveCommittedConnectionMutation(
    provisional: PlannedConnectionMutation,
    receipt: RevisionAppendReceipt,
  ): PlannedConnectionMutation {
    const commandId = provisional.event.commandId;
    const commandFingerprint = provisional.event.commandFingerprint;
    if (
      !commandId
      || !commandFingerprint
      || receipt.commandId !== commandId
      || receipt.commandFingerprint !== commandFingerprint
    ) {
      throw new Error("RevisionStore returned a mismatched authored-command receipt.");
    }

    if (!receipt.alreadyApplied && receipt.eventId === provisional.event.eventId) {
      this.acceptCommittedConnectionEvent(provisional.event);
    } else {
      // A different planner won, or this is a restart retry. Force one disk
      // parse rather than letting provisional state enter the hot cache.
      this.connectionEventCache = null;
      this.readConnectionEvents();
    }

    const event = this.connectionEventCache?.commandIndex.get(commandId);
    if (!event || event.eventId !== receipt.eventId) {
      throw new Error(`Committed connection event ${receipt.eventId} could not be resolved from Substrate.`);
    }
    if (event.commandFingerprint !== commandFingerprint) {
      throw new Error(`Committed command ${commandId} has a conflicting fingerprint.`);
    }
    if (event.entityType !== "annotation" || event.op !== provisional.event.op) {
      throw new Error(`Committed command ${commandId} resolved to a different action.`);
    }

    const current = this.connectionEventCache?.activeByEntity.get(event.entityId);
    if (!current) {
      return {
        action: "delete",
        connectionId: event.entityId,
        event,
        append: this.planConnectionAppend(event),
        replayed: receipt.alreadyApplied,
      };
    }
    // A retried historical command is still a success, but its response must
    // describe the current folded head. Returning the old payload here could
    // resurrect a later tombstone when the renderer's post-write query fails.
    const connection = this.requireConnectionRecord(
      event.entityId,
      current.payload,
      current.activeEventId,
      current.createdAt,
      current.updatedAt,
    );
    return {
      action: "upsert",
      connection,
      event,
      append: this.planConnectionAppend(event),
      replayed: receipt.alreadyApplied,
    };
  }

  /**
   * Refresh only disposable Derived state after RevisionStore confirms the
   * authoritative append. Projection failure is recoverable by rebuild and
   * must never invite a second authored append (INV-2, INV-9).
   */
  projectCommittedConnectionMutation(plan: PlannedConnectionMutation): void {
    this.acceptCommittedConnectionEvent(plan.event);
    this.readConnectionEvents();
    const committed = this.connectionEventCache?.eventIds.has(plan.event.eventId) ?? false;
    if (!committed) {
      throw new Error(`Connection event ${plan.event.eventId} is not committed.`);
    }
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) {
      throw new Error("Derived connection index is missing and must be rebuilt.");
    }
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.runImmediateTransaction(() => {
        if (plan.replayed) {
          throw new Error("A replayed authored command requires a full Derived reconciliation.");
        }
        const events = this.connectionEventCache?.events ?? [];
        const lastEvent = events.at(-1);
        if (lastEvent?.eventId !== plan.event.eventId) {
          throw new Error("Intervening authored events require a full Derived reconciliation.");
        }
        const foldedActive = this.connectionEventCache?.activeByEntity.get(plan.event.entityId);
        const eventMatchesFoldedState = plan.action === "upsert"
          ? foldedActive?.activeEventId === plan.event.eventId
          : foldedActive === undefined;
        if (!eventMatchesFoldedState) {
          throw new Error(
            "The physically last connection event is not the folded active state and requires a full Derived reconciliation.",
          );
        }
        const previousSignature = connectionProjectionSignatureFor(
          (this.connectionEventCache?.byteLength ?? 0)
            - Buffer.byteLength(`${JSON.stringify(plan.event)}\n`, "utf8"),
          Math.max(0, events.length - 1),
          events.at(-2)?.eventId,
        );
        if (materializer.getMeta(CONNECTION_PROJECTION_META_KEY) !== previousSignature) {
          throw new Error("Derived connection index does not match the pre-append Substrate state.");
        }
        if (
          materializer.getMeta(CONNECTION_PROJECTION_SCHEMA_META_KEY)
          !== String(CONNECTION_PROJECTION_SCHEMA_VERSION)
        ) {
          throw new Error("Derived connection index uses an older projection schema and must be rebuilt.");
        }
        const committedSignature = connectionProjectionSignatureFor(
          this.connectionEventCache?.byteLength ?? 0,
          events.length,
          plan.event.eventId,
        );
        if (plan.action === "upsert") {
          materializer.upsertConnectionWithAnchors(
            plan.connection,
            this.deriveConnectionAnchors(plan.connection),
          );
        } else {
          materializer.deleteConnection(plan.connectionId);
        }
        materializer.setMeta(CONNECTION_PROJECTION_META_KEY, committedSignature);
      });
    } finally {
      materializer.close();
    }
  }

  queryConnectionById(connectionId: string): ConnectionRecord | undefined {
    const manifest = this.requireReadableManifest();
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      const connection = materializer.queryConnectionById(connectionId);
      if (!connection) return undefined;
      const validated = this.requireProjectedConnectionRecord(connection);
      this.assertProjectedConnectionsMatchManifest(manifest, [validated]);
      return validated;
    } finally {
      materializer.close();
    }
  }

  /**
   * Batch-read authoritative folded Substrate heads. Package projection uses
   * this path so a lagging SQLite materialization can never lend stale word
   * geometry to a newer visible event version.
   */
  queryAuthoredConnectionHeads(connectionIds: readonly string[]): ConnectionRecord[] {
    const manifest = this.requireReadableManifest();
    const events = this.readConnectionEvents();
    this.assertConnectionEventsMatchManifest(manifest, events);
    const active = this.connectionEventCache?.activeByEntity;
    if (!active) return [];
    const records: ConnectionRecord[] = [];
    for (const connectionId of connectionIds) {
      const head = active.get(connectionId);
      if (!head) continue;
      records.push(this.requireConnectionRecord(
        connectionId,
        head.payload,
        head.activeEventId,
        head.createdAt,
        head.updatedAt,
      ));
    }
    this.assertProjectedConnectionsMatchManifest(manifest, records);
    return records;
  }

  getAllConnections(): ConnectionRecord[] {
    const manifest = this.requireReadableManifest();
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      const connections = materializer
        .getAllConnections()
        .map((connection) => this.requireProjectedConnectionRecord(connection));
      this.assertProjectedConnectionsMatchManifest(manifest, connections);
      return connections;
    } finally {
      materializer.close();
    }
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
    const manifest = this.requireReadableManifest();
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      const connections = materializer
        .queryConnectionsForRange(book, chapter, verseStart, verseEnd)
        .map((connection) => this.requireProjectedConnectionRecord(connection));
      this.assertProjectedConnectionsMatchManifest(manifest, connections);
      return connections;
    } finally {
      materializer.close();
    }
  }

  /**
   * Validate the durable library-version boundary without mutating it. Schema
   * v1 remains readable for legacy v1 events; a future manifest is refused.
   */
  private requireReadableManifest(allowPendingInitialization = false): LibraryManifest {
    const manifest = this.readManifest()
      ?? (allowPendingInitialization ? this.pendingInitializationManifest : null);
    if (!manifest) {
      throw new Error("Library manifest is missing; initialize the library before reading authored connections.");
    }
    const migration = checkMigration(manifest, true);
    if (migration.status === "refused" || migration.status === "error") {
      throw new Error(migration.message);
    }
    return manifest;
  }

  /**
   * A v2 append is legal only after the atomically-published schema-v2
   * manifest exists. This is called solely from explicit v2 mutation plans;
   * startup, rebuild, query, and legacy delete paths never migrate a library.
   */
  private ensureConnectionV2ManifestBoundary(): void {
    if (!this.tokenCatalog) {
      throw new Error("Canonical token catalog backbone-token:v1 is required for v2 connections.");
    }
    const manifest = this.requireReadableManifest();
    if (manifest.appSchemaVersion === CURRENT_APP_SCHEMA_VERSION) return;
    const result = this.migrateLibraryManifest();
    if (result.status !== "migrated" && result.status !== "current") {
      throw new Error(result.message);
    }
    const published = this.readManifest();
    if (!published || published.appSchemaVersion !== CURRENT_APP_SCHEMA_VERSION) {
      throw new Error("Schema-v2 manifest publication did not complete; no v2 connection event may be appended.");
    }
  }

  private assertConnectionEventsMatchManifest(
    manifest: LibraryManifest,
    events: LibraryEvent[],
  ): void {
    if (manifest.appSchemaVersion >= 2) return;
    const v2Event = events.find((event) => {
      if (event.op === "delete") return false;
      if (!isRecord(event.payload)) return false;
      return event.payload["format_version"] === CONNECTION_FORMAT_VERSION_V2;
    });
    if (v2Event) {
      throw new Error(
        `Connection event ${v2Event.eventId} uses format_version 2 under a schema-v${manifest.appSchemaVersion} manifest; explicitly migrate before reading it.`,
      );
    }
  }

  private assertProjectedConnectionsMatchManifest(
    manifest: LibraryManifest,
    connections: readonly ConnectionRecord[],
  ): void {
    if (
      manifest.appSchemaVersion < 2
      && connections.some((connection) => (
        connection.format_version === CONNECTION_FORMAT_VERSION_V2
      ))
    ) {
      throw new Error(
        `A schema-v${manifest.appSchemaVersion} library cannot expose format_version 2 connection projections.`,
      );
    }
  }

  private assertActiveConnectionRecordsReadable(): void {
    for (const [connectionId, active] of this.connectionEventCache?.activeByEntity ?? []) {
      this.requireConnectionRecord(
        connectionId,
        active.payload,
        active.activeEventId,
        active.createdAt,
        active.updatedAt,
      );
    }
  }

  private requireConnectionContent(connectionId: string, payload: unknown): ConnectionContent {
    const recordPayload = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const validated = validateConnectionRecord(
      { ...recordPayload, id: connectionId },
      this.backbone,
      this.tokenCatalog,
    );
    if (!validated.ok) {
      const error = new Error(validated.error.message);
      error.name = `ConnectionValidationError:${validated.error.code}`;
      throw error;
    }
    return validated.value;
  }

  private requireNewConnectionContent(connectionId: string, payload: unknown): ConnectionContentV2 {
    const recordPayload = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const validated = validateNewConnectionRecord(
      { ...recordPayload, id: connectionId },
      this.backbone,
      this.tokenCatalog,
    );
    if (!validated.ok) {
      const error = new Error(validated.error.message);
      error.name = `ConnectionValidationError:${validated.error.code}`;
      throw error;
    }
    return validated.value;
  }

  private requireConnectionRecord(
    connectionId: string,
    payload: unknown,
    activeEventId: string,
    createdAt: string,
    updatedAt: string,
  ): ConnectionRecord {
    if (
      typeof activeEventId !== "string"
      || activeEventId.length === 0
      || activeEventId.length > 128
    ) {
      throw new Error(`Connection ${connectionId} has an invalid active event version.`);
    }
    return {
      ...this.requireConnectionContent(connectionId, payload),
      activeEventId,
      createdAt: requireIsoTimestamp(createdAt, `Connection ${connectionId} create event`),
      updatedAt: requireIsoTimestamp(updatedAt, `Connection ${connectionId} active event`),
    };
  }

  private requireProjectedConnectionRecord(connection: ConnectionRecord): ConnectionRecord {
    return this.requireConnectionRecord(
      connection.id,
      connectionPayloadFromRecord(connection),
      connection.activeEventId,
      connection.createdAt,
      connection.updatedAt,
    );
  }

  private planConnectionAppend(event: LibraryEvent): RevisionAppend {
    const path = join(this.rootPath, CONNECTION_LOG_RELATIVE_PATH);
    if (!event.commandId || !event.commandFingerprint) {
      throw new Error("Authored connection events require durable command identity.");
    }
    const expectedByteLength = existsSync(path) ? statSync(path).size : 0;
    return {
      kind: "append-jsonl",
      path: CONNECTION_LOG_RELATIVE_PATH,
      content: `${JSON.stringify(event)}\n`,
      expectedByteLength,
      commandId: event.commandId,
      commandFingerprint: event.commandFingerprint,
    };
  }

  private connectionProjectionSignature(): string {
    const events = this.readConnectionEvents();
    return connectionProjectionSignatureFor(
      this.connectionEventCache?.byteLength ?? 0,
      events.length,
      events.at(-1)?.eventId,
    );
  }

  private replayConnectionCommand(
    command: ConnectionCommandIdentity,
    expectedOp: "create" | "update" | "delete",
  ): PlannedConnectionMutation | null {
    this.readConnectionEvents();
    const event = this.connectionEventCache?.commandIndex.get(command.commandId);
    if (!event) return null;
    if (event.commandFingerprint !== command.commandFingerprint) {
      throw new Error(`User mutation command ${command.commandId} was reused for different content.`);
    }
    if (event.entityType !== "annotation" || event.op !== expectedOp) {
      throw new Error(`User mutation command ${command.commandId} was reused for a different action.`);
    }
    if (expectedOp === "delete") {
      const deleteEvent = event as LibraryEvent<Record<string, never>>;
      return {
        action: "delete",
        connectionId: event.entityId,
        event: deleteEvent,
        append: this.planConnectionAppend(deleteEvent),
        replayed: true,
      };
    }
    const timestamps = connectionRecordTimestamps(
      event.entityId,
      event.eventId,
      this.connectionEventCache?.eventsById ?? new Map([[event.eventId, event]]),
    );
    const connection = this.requireConnectionRecord(
      event.entityId,
      event.payload,
      event.eventId,
      timestamps.createdAt,
      timestamps.updatedAt,
    );
    const upsertEvent = event as LibraryEvent<ConnectionEventPayload>;
    return {
      action: "upsert",
      connection,
      event: upsertEvent,
      append: this.planConnectionAppend(upsertEvent),
      replayed: true,
    };
  }

  private deriveConnectionAnchors(connection: ConnectionRecord): AnchorRecord[] {
    if (connection.format_version === CONNECTION_FORMAT_VERSION_V2) {
      return connection.anchors.map((anchor, ordinal) => this.deriveConnectionAnchor(
        connection.id,
        CONNECTION_FORMAT_VERSION_V2,
        anchor,
        ordinal,
        backboneTokenAnchorKey(anchor),
      ));
    }
    return connection.anchors.map((anchor, ordinal) => this.deriveConnectionAnchor(
      connection.id,
      CONNECTION_FORMAT_VERSION_V1,
      anchor,
      ordinal,
      canonicalLegacyConnectionAnchorIdentity(anchor),
    ));
  }

  private deriveConnectionAnchor(
    connectionId: string,
    formatVersion: typeof CONNECTION_FORMAT_VERSION_V1 | typeof CONNECTION_FORMAT_VERSION_V2,
    anchor: ConnectionAnchor,
    ordinal: number,
    canonicalIdentity: string,
  ): AnchorRecord {
      const identityDigest = createHash("sha256")
        .update(canonicalIdentity)
        .digest("hex");
      return {
        id: deterministicConnectionAnchorId(
          connectionId,
          ordinal,
          formatVersion,
          canonicalIdentity,
        ),
        src_kind: "annotation",
        src_id: connectionId,
        corpus: "protestant",
        book: anchor.book,
        start_ch: anchor.chapter,
        start_v: anchor.verse_start,
        end_ch: anchor.chapter,
        end_v: anchor.verse_end,
        provenance: [
          "user",
          `connection-v${formatVersion}`,
          `ordinal-${ordinal}`,
          `identity-sha256-${identityDigest}`,
        ].join(":"),
      };
  }

  // --- M4: Source ingestion ---

  async importPdfSource(pdfPath: string, opts: {
    title: string;
    rights: SourceRights;
    syncPolicy: SourceSyncPolicy;
  }): Promise<ImportedSource> {
    const sourceId = "src_" + ulid();
    const sourceDir = join(this.rootPath, "sources", sourceId);
    mkdirSync(sourceDir, { recursive: true });

    const originalPath = join(sourceDir, "original.pdf");
    copyFileSync(pdfPath, originalPath);
    const originalBytes = readFileSyncInterruptible(originalPath);
    const imported = new Date().toISOString();
    const metadata: SourceMetadata = {
      schemaVersion: 1,
      id: sourceId,
      title: opts.title,
      kind: "pdf",
      imported,
      originalFilename: basename(pdfPath),
      originalSha256: createHash("sha256").update(originalBytes).digest("hex"),
      rights: opts.rights,
      syncPolicy: opts.syncPolicy,
    };
    writeFileSync(join(sourceDir, "metadata.json"), JSON.stringify(metadata, null, 2));

    const chunks = await extractPdfChunks(sourceId, toUint8Array(originalBytes));
    this.materializeSource(metadata, chunks);

    return {
      source: sourceRecordFromMetadata(metadata),
      chunks,
    };
  }

  async rechunkSource(sourceId: string): Promise<SourceChunk[]> {
    const metadata = this.readSourceMetadata(sourceId);
    const originalPath = join(this.rootPath, "sources", sourceId, "original.pdf");
    const originalBytes = readFileSyncInterruptible(originalPath);
    const chunks = await extractPdfChunks(sourceId, toUint8Array(originalBytes));
    this.materializeSource(metadata, chunks);
    return chunks;
  }

  pinSourceChunkToNote(chunkId: string, opts: { title: string; quote?: string }): { noteId: string; notePath: string } {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      const chunk = materializer.querySourceChunkById(chunkId);
      if (!chunk) throw new Error(`Source chunk not found: ${chunkId}`);
      const source = materializer.querySourceById(chunk.source_id);
      if (!source) throw new Error(`Source not found for chunk: ${chunkId}`);
      const locator = parsePdfLocator(chunk.locator_json);
      if (!locator) throw new Error(`Invalid source chunk locator: ${chunkId}`);

      const noteId = ulid();
      const quote = (opts.quote ?? chunk.text).trim();
      const body = [
        `> ${quote}`,
        "",
        "Citation:",
        `- source: ${source.id}`,
        `- sourceTitle: ${source.title}`,
        `- chunk: ${chunk.id}`,
        `- page: ${locator.page}`,
        `- locator: ${JSON.stringify(locator)}`,
        "",
      ].join("\n");
      const notePath = this.createNote(noteId, opts.title, body, { type: "source-citation", tags: ["source"] });
      return { noteId, notePath };
    } finally {
      materializer.close();
    }
  }

  private materializeSource(metadata: SourceMetadata, chunks: SourceChunk[]): void {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      materializer.insertSource(sourceRecordFromMetadata(metadata));
      materializer.deleteSourceChunks(metadata.id);
      for (const chunk of chunks) {
        materializer.insertSourceChunk(sourceChunkRecordFromChunk(chunk));
        for (const scriptureRef of parseScriptureRefs(chunk.text, this.bookNames, this.backbone)) {
          materializer.insertAnchor({
            id: deterministicAnchorId(
              "sourceChunk",
              chunk.id,
              scriptureRef.ref.start.book,
              scriptureRef.ref.start.chapter,
              scriptureRef.ref.start.verse,
              scriptureRef.ref.end.chapter,
              scriptureRef.ref.end.verse,
            ),
            src_kind: "sourceChunk",
            src_id: chunk.id,
            corpus: "scripture",
            book: scriptureRef.ref.start.book,
            start_ch: scriptureRef.ref.start.chapter,
            start_v: scriptureRef.ref.start.verse,
            end_ch: scriptureRef.ref.end.chapter,
            end_v: scriptureRef.ref.end.verse,
            provenance: "user",
          });
        }
      }
    } finally {
      materializer.close();
    }
  }

  private readSourceMetadata(sourceId: string): SourceMetadata {
    const metadataPath = join(this.rootPath, "sources", sourceId, "metadata.json");
    const parsed = JSON.parse(readFileSyncInterruptible(metadataPath, "utf-8")) as unknown;
    if (!isRecord(parsed) || parsed["schemaVersion"] !== 1 || parsed["id"] !== sourceId || parsed["kind"] !== "pdf") {
      throw new Error(`Invalid source metadata: ${sourceId}`);
    }
    return parsed as SourceMetadata;
  }
}

type OpenedRebuildMaterializer = {
  materializer: SQLiteMaterializer;
  replacedCorruptDerived: boolean;
};

/**
 * A malformed SQLite file is disposable Derived state (INV-2, INV-9), but it
 * is still quarantined rather than deleted. Healthy databases never take this
 * path and continue to rebuild in-place so existing WAL readers remain valid.
 */
function openMaterializerForRebuild(
  dbPath: string,
  systemDir: string,
): OpenedRebuildMaterializer {
  try {
    return {
      materializer: new SQLiteMaterializer(dbPath),
      replacedCorruptDerived: false,
    };
  } catch (error) {
    if (!existsSync(dbPath) || !isCorruptDerivedDatabaseError(error)) throw error;

    const quarantineBase = uniqueDerivedQuarantineBase(dbPath);
    for (const [candidate, destination] of [
      [dbPath, quarantineBase],
      [`${dbPath}-wal`, `${quarantineBase}-wal`],
      [`${dbPath}-shm`, `${quarantineBase}-shm`],
      [`${dbPath}-journal`, `${quarantineBase}-journal`],
    ] as const) {
      if (existsSync(candidate)) renameSync(candidate, destination);
    }
    // Persist the quarantine rename before a fresh Derived inode is created.
    fsyncDirectory(systemDir);
    const materializer = new SQLiteMaterializer(dbPath);
    try {
      // Persist the replacement directory entry as well; the transaction below
      // separately owns the schema rows and exact projection marker.
      fsyncDirectory(systemDir);
    } catch (error) {
      materializer.close();
      throw error;
    }
    return { materializer, replacedCorruptDerived: true };
  }
}

function uniqueDerivedQuarantineBase(dbPath: string): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${dbPath}.corrupt-${ulid()}`;
    if ([candidate, `${candidate}-wal`, `${candidate}-shm`, `${candidate}-journal`]
      .every((path) => !existsSync(path))) {
      return candidate;
    }
  }
  throw new Error("Could not reserve a unique quarantine name for corrupt Derived SQLite state.");
}

function isCorruptDerivedDatabaseError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = error["code"];
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") return true;
  const message = error["message"];
  return typeof message === "string" && (
    /file is not a database/i.test(message)
    || /database disk image is malformed/i.test(message)
    || /malformed database schema/i.test(message)
  );
}

function fsyncDirectory(directoryPath: string): void {
  const fd = openSync(directoryPath, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function connectionProjectionSignatureFor(
  byteLength: number,
  eventCount: number,
  lastEventId: string | undefined,
): string {
  return `v2:${byteLength}:${eventCount}:${lastEventId ?? "-"}`;
}

function assertConnectionEventEnvelope(event: LibraryEvent): void {
  if (!isRecord(event)) {
    throw new Error("Connection event must be an object.");
  }
  if (
    typeof event.eventId !== "string"
    || event.eventId.length === 0
    || typeof event.entityId !== "string"
    || event.entityId.length === 0
  ) {
    throw new Error("Connection event requires non-empty event and entity ids.");
  }
  if (event.schemaVersion !== CURRENT_EVENT_SCHEMA_VERSION) {
    throw new Error(
      `Connection event ${event.eventId} uses unsupported event schema version ${String(event.schemaVersion)}.`,
    );
  }
  if (event.entityType !== "annotation") {
    throw new Error(`Connection event ${event.eventId} has entity type ${String(event.entityType)}.`);
  }
  if (!["create", "update", "delete"].includes(event.op)) {
    throw new Error(`Connection event ${event.eventId} uses unsupported operation ${String(event.op)}.`);
  }
  if (event.op === "create" && event.baseEventId !== undefined) {
    throw new Error(`Connection create event ${event.eventId} must not have a causal base.`);
  }
  if (
    (event.op === "update" || event.op === "delete")
    && (typeof event.baseEventId !== "string" || event.baseEventId.length === 0)
  ) {
    throw new Error(`Connection ${event.op} event ${event.eventId} requires a causal base.`);
  }
  requireIsoTimestamp(event.createdAt, `Connection event ${event.eventId}`);
}

function connectionRecordTimestamps(
  connectionId: string,
  activeEventId: string,
  eventsById: ReadonlyMap<string, LibraryEvent>,
): { createdAt: string; updatedAt: string } {
  const active = eventsById.get(activeEventId);
  if (!active || active.entityId !== connectionId) {
    throw new Error(`Connection ${connectionId} is missing active event ${activeEventId}.`);
  }
  const updatedAt = requireIsoTimestamp(
    active.createdAt,
    `Connection ${connectionId} active event ${active.eventId}`,
  );
  let cursor: LibraryEvent | undefined = active;
  const visited = new Set<string>();
  while (cursor) {
    if (visited.has(cursor.eventId)) {
      throw new Error(`Connection ${connectionId} has a causal event cycle at ${cursor.eventId}.`);
    }
    visited.add(cursor.eventId);
    if (cursor.entityId !== connectionId) {
      throw new Error(`Connection ${connectionId} causal chain crosses entity ${cursor.entityId}.`);
    }
    if (cursor.op === "create") {
      return {
        createdAt: requireIsoTimestamp(
          cursor.createdAt,
          `Connection ${connectionId} create event ${cursor.eventId}`,
        ),
        updatedAt,
      };
    }
    if (!cursor.baseEventId) break;
    cursor = eventsById.get(cursor.baseEventId);
  }
  throw new Error(`Connection ${connectionId} active event ${activeEventId} has no causal create event.`);
}

function requireIsoTimestamp(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} timestamp must be an ISO-8601 string.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${context} timestamp ${value} is not a canonical ISO-8601 instant.`);
  }
  return value;
}

function connectionPayloadFromRecord(connection: ConnectionRecord): ConnectionEventPayload {
  if (connection.format_version === CONNECTION_FORMAT_VERSION_V2) {
    return {
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind: connection.kind,
      label: connection.label,
      observation: connection.observation,
      anchors: connection.anchors,
    };
  }
  return {
    format_version: CONNECTION_FORMAT_VERSION_V1,
    kind: connection.kind,
    label: connection.label,
    anchors: connection.anchors,
  };
}

function canonicalLegacyConnectionAnchorIdentity(anchor: ConnectionAnchorV1): string {
  return JSON.stringify({
    book: anchor.book,
    chapter: anchor.chapter,
    verse_start: anchor.verse_start,
    verse_end: anchor.verse_end,
    ...(anchor.render_locator
      ? {
          render_locator: {
            package: anchor.render_locator.package,
            char_start: anchor.render_locator.char_start,
            char_end: anchor.render_locator.char_end,
            quote: anchor.render_locator.quote,
          },
        }
      : {}),
  });
}

function fileSliceEquals(path: string, offset: number, expected: Buffer): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const actual = Buffer.allocUnsafe(expected.byteLength);
    let bytesRead = 0;
    while (bytesRead < actual.byteLength) {
      const count = readSync(
        fd,
        actual,
        bytesRead,
        actual.byteLength - bytesRead,
        offset + bytesRead,
      );
      if (count <= 0) return false;
      bytesRead += count;
    }
    return actual.equals(expected);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* comparison already has its answer */ }
    }
  }
}

function sourceRecordFromMetadata(metadata: SourceMetadata): SourceRecord {
  return {
    id: metadata.id,
    title: metadata.title,
    kind: metadata.kind,
    imported: metadata.imported,
  };
}

function sourceChunkRecordFromChunk(chunk: SourceChunk): SourceChunkRecord {
  return {
    id: chunk.id,
    source_id: chunk.source_id,
    ordinal: chunk.ordinal,
    text: chunk.text,
    locator_json: JSON.stringify(chunk.locator),
  };
}

function toUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function parsePdfLocator(json: string): PdfLocator | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["kind"] !== "pdf") return null;
  const bbox = parsed["bbox"];
  if (!isRecord(bbox)) return null;
  const page = toFiniteNumber(parsed["page"]);
  const x = toFiniteNumber(bbox["x"]);
  const y = toFiniteNumber(bbox["y"]);
  const width = toFiniteNumber(bbox["width"]);
  const height = toFiniteNumber(bbox["height"]);
  const textStart = toFiniteNumber(parsed["textStart"]);
  const textEnd = toFiniteNumber(parsed["textEnd"]);
  if (page == null || x == null || y == null || width == null || height == null || textStart == null || textEnd == null) {
    return null;
  }
  return { kind: "pdf", page, bbox: { x, y, width, height }, textStart, textEnd };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}
