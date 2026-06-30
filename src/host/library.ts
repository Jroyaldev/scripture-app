/**
 * Library engine — Node host layer.
 * Orchestrates the pure core modules with real file I/O and SQLite.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { ulid } from "ulid";

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
import type { BackboneData, BookNameMap } from "../core/reference/types.js";
import type { LibraryEvent } from "../core/events/types.js";
import type { LibraryManifest } from "../core/interfaces.js";
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
import { CURRENT_APP_SCHEMA_VERSION, CURRENT_EVENT_SCHEMA_VERSION } from "../core/migration/index.js";
import type {
  ImportedSource,
  SourceChunk,
  SourceMetadata,
  SourceRights,
  SourceSyncPolicy,
} from "../core/sources/types.js";
import { extractPdfChunks } from "./pdf-source.js";

export class LibraryEngine {
  readonly rootPath: string;
  private backbone: BackboneData;
  private bookNames: BookNameMap;
  private deviceId: string;
  private seqCounter: number;

  constructor(rootPath: string, backbone: BackboneData, bookNames: BookNameMap) {
    this.rootPath = rootPath;
    this.backbone = backbone;
    this.bookNames = bookNames;
    this.deviceId = "dev-" + ulid();
    this.seqCounter = 0;
  }

  /**
   * Initialize a new Library folder with the §4.3 layout.
   */
  initLibrary(): void {
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

    // Write library-manifest.json
    const manifest: LibraryManifest = {
      libraryId: ulid(),
      createdAt: new Date().toISOString(),
      appSchemaVersion: CURRENT_APP_SCHEMA_VERSION,
      eventSchemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
      referenceFormatVersion: "bref:v1",
      pluginApiVersion: "1",
    };
    writeFileSync(
      join(this.rootPath, "config/library-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    // Write default library.json
    writeFileSync(
      join(this.rootPath, "config/library.json"),
      JSON.stringify({ canonProfile: "protestant", defaultPackage: "web" }, null, 2),
    );

    // Write default budget-envelope.json
    writeFileSync(
      join(this.rootPath, "config/budget-envelope.json"),
      JSON.stringify({ backgroundAI: "off", networkBackground: false }, null, 2),
    );

    // Write empty annotation files
    for (const file of ["highlights.jsonl", "pinned-facts.jsonl", "threads.jsonl", "note-change-log.jsonl"]) {
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
  }

  /**
   * Read the library manifest.
   */
  readManifest(): LibraryManifest | null {
    const manifestPath = join(this.rootPath, "config/library-manifest.json");
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as LibraryManifest;
  }

  /**
   * Copy backbone and versification data into .artifacts.
   */
  installBackboneData(backbonePath: string, versificationDir: string): void {
    const targetBackbone = join(this.rootPath, ".artifacts/scripture/backbone.json");
    writeFileSync(targetBackbone, readFileSync(backbonePath, "utf-8"));

    const targetVersDir = join(this.rootPath, ".artifacts/scripture/versification");
    mkdirSync(targetVersDir, { recursive: true });
    for (const file of readdirSync(versificationDir)) {
      writeFileSync(
        join(targetVersDir, file),
        readFileSync(join(versificationDir, file), "utf-8"),
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

    let frontmatter = `---\nid: ${id}\ntitle: "${title}"\ncreated: ${now}\nmodified: ${now}\n`;
    if (opts?.type) frontmatter += `type: ${opts.type}\n`;
    if (opts?.tags && opts.tags.length > 0) frontmatter += `tags: [${opts.tags.join(", ")}]\n`;
    frontmatter += "---\n";

    const content = frontmatter + body;
    const notePath = join(this.rootPath, "notes", filename);
    writeFileSync(notePath, content);
    return notePath;
  }

  /**
   * Append a LibraryEvent to the appropriate JSONL log.
   */
  appendEvent(event: LibraryEvent): void {
    const fileMap: Record<string, string> = {
      highlight: "highlights.jsonl",
      fact: "pinned-facts.jsonl",
      thread: "threads.jsonl",
      noteMeta: "note-change-log.jsonl",
    };
    const filename = fileMap[event.entityType] ?? "highlights.jsonl";
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
    pinnedFacts: LibraryEvent[];
    threads: LibraryEvent[];
    noteChangeLogs: LibraryEvent[];
  } {
    return {
      highlights: this.readJsonlEvents("highlights.jsonl"),
      pinnedFacts: this.readJsonlEvents("pinned-facts.jsonl"),
      threads: this.readJsonlEvents("threads.jsonl"),
      noteChangeLogs: this.readJsonlEvents("note-change-log.jsonl"),
    };
  }

  private readJsonlEvents(filename: string): LibraryEvent[] {
    const filePath = join(this.rootPath, "annotations", filename);
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LibraryEvent);
  }

  /**
   * Read and parse all notes.
   */
  readAllNotes(): ParsedNote[] {
    const notesDir = join(this.rootPath, "notes");
    if (!existsSync(notesDir)) return [];
    const files = readdirSync(notesDir).filter((f) => f.endsWith(".md"));
    return files.map((file) => {
      const content = readFileSync(join(notesDir, file), "utf-8");
      return parseNote(content, this.bookNames, this.backbone);
    });
  }

  /**
   * Build (or rebuild) the .system/library.sqlite materialized view.
   * Returns the rebuild_hash.
   */
  buildSqlite(): string {
    const systemDir = join(this.rootPath, ".system");
    mkdirSync(systemDir, { recursive: true });
    const dbPath = join(systemDir, "library.sqlite");

    // If exists, remove and rebuild (INV-9: safe to delete and rebuild at any moment)
    if (existsSync(dbPath)) {
      rmSync(dbPath);
    }

    const materializer = new SQLiteMaterializer(dbPath);

    try {
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
      const allEvents = [
        ...events.highlights,
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
      materializer.setMeta("built_at", new Date().toISOString());
      materializer.setMeta("app_version", "0.1.0");

      materializer.close();
      return hash;
    } catch (err) {
      materializer.close();
      throw err;
    }
  }

  /**
   * Query everything anchored to a specific verse.
   */
  queryVerse(book: string, chapter: number, verse: number): {
    anchors: AnchorRecord[];
    highlights: HighlightRecord[];
    notes: NoteRecord[];
  } {
    const dbPath = join(this.rootPath, ".system/library.sqlite");
    const materializer = new SQLiteMaterializer(dbPath);

    try {
      const anchors = materializer.queryAnchorsForVerse(book, chapter, verse);
      const highlights = materializer.queryHighlightsForVerse(book, chapter, verse);

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
      return { anchors, highlights, notes };
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
    const originalBytes = readFileSync(originalPath);
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
    const originalBytes = readFileSync(originalPath);
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
    const parsed = JSON.parse(readFileSync(metadataPath, "utf-8")) as unknown;
    if (!isRecord(parsed) || parsed["schemaVersion"] !== 1 || parsed["id"] !== sourceId || parsed["kind"] !== "pdf") {
      throw new Error(`Invalid source metadata: ${sourceId}`);
    }
    return parsed as SourceMetadata;
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
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}
