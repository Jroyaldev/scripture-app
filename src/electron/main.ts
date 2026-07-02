/**
 * Electron main process — wires the M1 core behind real file I/O.
 * No core logic here; only window management and IPC bridge.
 */

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import Store from "electron-store";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { ulid } from "ulid";
import type { BackboneData, BookNameMap, CanonicalRef } from "../core/reference/types.js";
import { parseBref, toBref, toDisplayString, parseHumanRef } from "../core/reference/parser.js";
import { validateBackboneData } from "../core/reference/backbone.js";
import { LibraryEngine } from "../host/library.js";
import { GitRevisionStore } from "../host/git-revision-store.js";
import { SQLiteMaterializer } from "../host/sqlite.js";
import { EmbeddingsStore } from "../host/embeddings-store.js";
import { BudgetManager } from "../host/budget-manager.js";
import { MockAIProvider, MockEmbeddingProvider, createDeepSeekProvider, OpenAICompatibleAIProvider } from "../host/ai-provider.js";
import { loadEnvFile } from "../host/env.js";
import type { AIProvider } from "../core/interfaces.js";
import { JobQueue } from "../host/job-queue.js";
import { assembleMargin } from "../core/margin/index.js";
import { assembleSemanticMargin } from "../core/ai/semantic-margin.js";
import { deterministicEmbedding } from "../core/ai/similarity.js";
import { importObsidianVault } from "../core/importer/obsidian.js";
import type { CrossRefData, MarginQuery } from "../core/margin/types.js";
import { isHighlightOverlap } from "../core/events/highlightOverlap.js";

const DATA_DIR = resolve(__dirname, "../../data/scripture");
const CROSS_REF_DIR = resolve(__dirname, "../../data/cross-references");

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

interface AppSettingsSchema {
  theme: "light" | "dark";
  accentColor: "blue" | "green" | "plum";
  sidebarCollapsed: boolean;
  marginVisible: boolean;
  windowBounds: WindowBounds | null;
  /** The library location the user last confirmed (Welcome screen or Switch
   * Library), if any. null means no choice has ever been confirmed — the
   * signal used at startup to decide whether to show the Welcome screen. */
  libraryPath: string | null;
}

const store = new Store<AppSettingsSchema>({
  defaults: {
    theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    accentColor: "blue",
    sidebarCollapsed: false,
    marginVisible: true,
    windowBounds: null,
    libraryPath: null,
  },
});

let mainWindow: BrowserWindow | null = null;
let engine: LibraryEngine | null = null;
let revisionStore: GitRevisionStore | null = null;
let backbone: BackboneData | null = null;
let bookNames: BookNameMap | null = null;
let crossRefData: CrossRefData | null = null;
let embeddingsStore: EmbeddingsStore | null = null;
let budgetManager: BudgetManager | null = null;
let aiProvider: AIProvider | null = null;
let embeddingProvider: MockEmbeddingProvider | null = null;
let jobQueue: JobQueue | null = null;

function loadBackbone(): BackboneData {
  const backbonePath = join(DATA_DIR, "backbone.json");
  const data = JSON.parse(readFileSync(backbonePath, "utf-8")) as BackboneData;
  const validation = validateBackboneData(data);
  if (!validation.ok) {
    throw new Error(`Backbone validation failed: ${validation.error}`);
  }
  return data;
}

function loadBookNames(): BookNameMap {
  const namesPath = join(DATA_DIR, "book-names-en.json");
  return JSON.parse(readFileSync(namesPath, "utf-8")) as BookNameMap;
}

function loadCrossRefs(): CrossRefData | null {
  const tskPath = join(CROSS_REF_DIR, "tsk.json");
  if (!existsSync(tskPath)) return null;
  return JSON.parse(readFileSync(tskPath, "utf-8")) as CrossRefData;
}

function getLibraryPath(libraryPath?: string): string {
  return libraryPath ?? store.get("libraryPath") ?? process.env["LIBRARY_PATH"] ?? resolve(app.getPath("documents"), "ScriptureLibrary");
}

function createWindow(): void {
  const savedBounds = store.get("windowBounds");
  const hasSaneBounds =
    savedBounds != null && savedBounds.width > 0 && savedBounds.height > 0;

  mainWindow = new BrowserWindow({
    width: hasSaneBounds ? savedBounds.width : 1400,
    height: hasSaneBounds ? savedBounds.height : 900,
    ...(hasSaneBounds && savedBounds.x != null && savedBounds.y != null
      ? { x: savedBounds.x, y: savedBounds.y }
      : {}),
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    title: "Scripture Library",
  });

  if (process.env["ELECTRON_DEV_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_DEV_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Open DevTools in development or when debugging
  if (process.env["SCRIPTURE_DEBUG"] === "1") {
    mainWindow.webContents.openDevTools();
  }

  let boundsSaveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (mainWindow) {
        store.set("windowBounds", mainWindow.getBounds());
      }
    }, 500);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.on("close", () => {
    // Flush pending git commits on close
    if (revisionStore) {
      void revisionStore.flush("Session close");
    }
  });
}

function initializeEngine(libraryPathArg?: string, autoCreateIfMissing: boolean = true): void {
  backbone = loadBackbone();
  bookNames = loadBookNames();
  crossRefData = loadCrossRefs();

  const libraryPath = getLibraryPath(libraryPathArg);
  engine = new LibraryEngine(libraryPath, backbone, bookNames);
  revisionStore = new GitRevisionStore(libraryPath);

  // Ensure library is initialized
  const manifestExists = existsSync(join(libraryPath, "config/library-manifest.json"));
  if (autoCreateIfMissing || manifestExists) {
    if (!existsSync(join(libraryPath, "config/library-manifest.json"))) {
      engine.initLibrary();
      engine.installBackboneData(
        join(DATA_DIR, "backbone.json"),
        join(DATA_DIR, "versification"),
      );
      revisionStore.init();
    }

    // Build SQLite if not present
    const dbPath = join(libraryPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) {
      engine.buildSqlite();
    }

    // M3: Initialize semantic layer. Deliberately inside this gate — these
    // eagerly open sqlite files under libraryPath/.system/, which this block
    // is what creates in the first place (via initLibrary/buildSqlite above).
    // Constructing them when the library doesn't exist yet (first-run, before
    // the user has confirmed a location) would throw SQLITE_CANTOPEN.
    const embDbPath = join(libraryPath, ".system/embeddings.sqlite");
    embeddingsStore = new EmbeddingsStore(embDbPath);
    budgetManager = new BudgetManager(join(libraryPath, "config"));
    embeddingProvider = new MockEmbeddingProvider();
    // B3 Gate 1: real LLM provider when a key is configured (.env at the repo
    // root in dev, or the process environment), deterministic mock otherwise.
    loadEnvFile(resolve(__dirname, "../../.env"));
    aiProvider = createDeepSeekProvider(process.env) ?? new MockAIProvider();
    jobQueue = new JobQueue(budgetManager, embeddingsStore);
  }
}

// --- IPC Handlers ---

function registerIpcHandlers(): void {
  ipcMain.handle("get-library-path", () => {
    return engine?.rootPath ?? getLibraryPath();
  });

  ipcMain.handle("get-library-info", () => {
    if (!engine) return null;
    return {
      path: engine.rootPath,
      hasLibrary: existsSync(join(engine.rootPath, "config/library-manifest.json")),
    };
  });

  ipcMain.handle("reveal-in-finder", () => {
    if (!engine) return { ok: false, error: "Not initialized" };
    shell.showItemInFolder(engine.rootPath);
    return { ok: true };
  });

  ipcMain.handle("get-library-summary", () => {
    if (!engine) return null;
    return engine.getSummary();
  });

  ipcMain.handle("read-all-notes", () => {
    if (!engine) return [];
    return engine.readAllNotes();
  });

  ipcMain.handle("init-library", (_event, libraryPath: string) => {
    if (!libraryPath.trim()) return { ok: false, error: "Library path is required" };
    try {
      initializeEngine(libraryPath);
      // Remember this as the confirmed library location so the next launch
      // resolves back to it (via getLibraryPath) instead of reverting to the
      // hardcoded default and re-showing the Welcome screen.
      store.set("libraryPath", libraryPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle("resolve-reference", (_event, input: string) => {
    if (!backbone || !bookNames) return { ok: false, error: "Not initialized" };
    if (typeof input !== "string" || !input) return { ok: false, error: "Reference is required" };
    if (input.startsWith("bref:")) {
      return parseBref(input);
    }
    return parseHumanRef(input, bookNames, backbone);
  });

  ipcMain.handle("format-bref", (_event, ref: CanonicalRef) => {
    return toBref(ref);
  });

  ipcMain.handle("format-display", (_event, ref: CanonicalRef) => {
    if (!bookNames) return "";
    return toDisplayString(ref, bookNames);
  });

  ipcMain.handle("get-margin", (_event, query: MarginQuery) => {
    if (!engine || !bookNames) return { notes: [], highlights: [], crossRefs: [], backlinks: [] };
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return { notes: [], highlights: [], crossRefs: [], backlinks: [] };

    const db = new SQLiteMaterializer(dbPath);
    try {
      const result = assembleMargin(query, db, crossRefData, bookNames);
      return result;
    } finally {
      db.close();
    }
  });

  ipcMain.handle("query-verse", (_event, book: string, chapter: number, verse: number) => {
    if (!engine) return { anchors: [], highlights: [], notes: [] };
    return engine.queryVerse(book, chapter, verse);
  });

  ipcMain.handle("query-range", (
    _event,
    startBook: string,
    startCh: number,
    startV: number,
    endBook: string,
    endCh: number,
    endV: number,
  ) => {
    if (!engine || startBook !== endBook) return { anchors: [], highlights: [], notes: [] };
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return { anchors: [], highlights: [], notes: [] };

    const db = new SQLiteMaterializer(dbPath);
    try {
      const anchors = db.queryAnchorsForRange(startBook, startCh, startV, endCh, endV);
      const highlights = db.queryHighlightsForRange(startBook, startCh, startV, endCh, endV);
      const noteIds = new Set<string>();
      for (const anchor of anchors) {
        if (anchor.src_kind === "note") noteIds.add(anchor.src_id);
      }
      const notes = [...noteIds]
        .map((noteId) => db.queryNoteById(noteId))
        .filter((note) => note != null);

      return { anchors, highlights, notes };
    } finally {
      db.close();
    }
  });

  ipcMain.handle("search-notes", (_event, query: string) => {
    if (!engine) return [];
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return [];
    const db = new SQLiteMaterializer(dbPath);
    try {
      return db.searchNotes(query);
    } finally {
      db.close();
    }
  });

  ipcMain.handle("create-note", async (_event, opts: { title: string; body: string; anchorRef?: CanonicalRef; tags?: string[] }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const id = ulid();
    const notePath = engine.createNote(id, opts.title, opts.body, {
      type: "user",
      tags: opts.tags,
    });

    // Track change for git
    const relPath = notePath.replace(engine.rootPath + "/", "");
    const txn = await revisionStore.beginTransaction(`Create note: ${opts.title}`);
    txn.files.push(relPath);
    await revisionStore.commit(txn);

    // Rebuild SQLite
    engine.buildSqlite();

    return { ok: true, noteId: id };
  });

  ipcMain.handle("get-all-notes", () => {
    if (!engine) return [];
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return [];
    const db = new SQLiteMaterializer(dbPath);
    try {
      return db.getAllNotes();
    } finally {
      db.close();
    }
  });

  ipcMain.handle("get-note", (_event, id: string) => {
    if (!engine) return null;
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return null;
    const db = new SQLiteMaterializer(dbPath);
    try {
      return db.queryNoteById(id);
    } finally {
      db.close();
    }
  });

  ipcMain.handle("get-backbone", () => {
    return backbone;
  });

  ipcMain.handle("get-book-names", () => {
    return bookNames;
  });

  ipcMain.handle("import-obsidian-vault", async (_event, vaultPath: string) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    if (!existsSync(vaultPath)) return { ok: false, error: "Vault path does not exist" };

    // Read all .md files from the vault
    const files: Array<{ path: string; content: string }> = [];
    function readDir(dir: string, prefix: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          readDir(full, rel);
        } else if (entry.name.endsWith(".md")) {
          files.push({ path: rel, content: readFileSync(full, "utf-8") });
        }
      }
    }
    readDir(vaultPath, "");

    const result = importObsidianVault(files, ulid);

    // Write imported notes to the library
    const writtenPaths: string[] = [];
    for (const note of result.notes) {
      const notePath = engine.createNote(note.id, note.title, note.body, { tags: note.tags });
      writtenPaths.push(notePath.replace(engine.rootPath + "/", ""));
    }

    // Track in git
    const txn = await revisionStore.beginTransaction(`Import Obsidian vault: ${result.stats.imported} notes`);
    txn.files.push(...writtenPaths);
    await revisionStore.commit(txn);

    // Rebuild
    engine.buildSqlite();

    return { ok: true, stats: result.stats };
  });

  ipcMain.handle("read-scripture-text", (_event, opts: { book: string; chapter: number; package: string }) => {
    if (!engine) return null;
    const textPath = join(
      engine.rootPath,
      ".artifacts/scripture/packages",
      opts.package,
      "text",
      opts.book,
      `${opts.chapter}.json`,
    );
    if (!existsSync(textPath)) {
      // Try data dir fallback
      const dataTextPath = join(DATA_DIR, "text", opts.package, opts.book, `${opts.chapter}.json`);
      if (existsSync(dataTextPath)) {
        return JSON.parse(readFileSync(dataTextPath, "utf-8"));
      }
      return null;
    }
    return JSON.parse(readFileSync(textPath, "utf-8"));
  });

  ipcMain.handle("get-cross-refs", (_event, opts: { book: string; chapter: number; verse: number }) => {
    if (!bookNames) return [];
    const result = assembleMargin(
      {
        book: opts.book,
        startChapter: opts.chapter,
        startVerse: opts.verse,
        endChapter: opts.chapter,
        endVerse: opts.verse,
      },
      {
        queryAnchorsForRange: () => [],
        queryHighlightsForRange: () => [],
        queryNoteById: () => undefined,
        queryEdgesByTarget: () => [],
        querySourceChunkById: () => undefined,
        querySourceById: () => undefined,
      },
      crossRefData,
      bookNames,
    );
    return result.crossRefs.map((ref) => ref.targetDisplay);
  });

  // Batched cross-refs for an entire chapter (reduces 7+ IPC calls to 1)
  ipcMain.handle("get-cross-refs-for-chapter", (_event, opts: { book: string; chapter: number; verseCount: number }) => {
    if (!bookNames) return [];
    const verses = Math.min(opts.verseCount, 7);
    // Different verses in the same chapter can share a cross-reference
    // target (e.g. two nearby verses both pointing at the same passage) —
    // dedupe by target text, keeping first-encountered order.
    const seen = new Set<string>();
    const allRefs: string[] = [];
    for (let v = 1; v <= verses; v++) {
      const result = assembleMargin(
        { book: opts.book, startChapter: opts.chapter, startVerse: v, endChapter: opts.chapter, endVerse: v },
        {
          queryAnchorsForRange: () => [],
          queryHighlightsForRange: () => [],
          queryNoteById: () => undefined,
          queryEdgesByTarget: () => [],
          querySourceChunkById: () => undefined,
          querySourceById: () => undefined,
        },
        crossRefData,
        bookNames,
      );
      for (const ref of result.crossRefs) {
        if (seen.has(ref.targetDisplay)) continue;
        seen.add(ref.targetDisplay);
        allRefs.push(ref.targetDisplay);
      }
    }
    return allRefs;
  });

  ipcMain.handle("create-highlight", async (_event, opts: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    color: string;
    package: string;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };

    // Replace-on-overlap: find and delete existing overlapping highlights
    const existing = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package);
    const overlapping = existing.filter((h) =>
      isHighlightOverlap(h, { verseStart: opts.verseStart, verseEnd: opts.verseEnd }),
    );
    for (const h of overlapping) {
      engine.applyHighlightDelete(h.id);
    }

    // Create the new highlight with incremental SQLite update
    const entityId = engine.applyHighlightCreate(
      opts.book, opts.chapter, opts.verseStart, opts.verseEnd, opts.color, opts.package,
    );

    // Track in git
    const txn = await revisionStore.beginTransaction("Create highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);

    return { ok: true, highlightId: entityId };
  });

  ipcMain.handle("delete-highlight", async (_event, opts: { entityId: string; baseEventId: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };

    engine.applyHighlightDelete(opts.entityId, opts.baseEventId);

    const txn = await revisionStore.beginTransaction("Delete highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);

    return { ok: true };
  });

  ipcMain.handle("rebuild-sqlite", () => {
    if (!engine) return null;
    return engine.buildSqlite();
  });

  ipcMain.handle("settings:get", () => store.store);

  ipcMain.handle("settings:set", (_event, partial: Partial<AppSettingsSchema>) => {
    store.set({ ...store.store, ...partial });
    return store.store;
  });

  ipcMain.handle("dialog-open-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // --- M3: Semantic Intelligence ---

  ipcMain.handle("embed-notes", async () => {
    if (!engine || !embeddingsStore || !embeddingProvider) return { ok: false, error: "Not initialized" };
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    const db = new SQLiteMaterializer(dbPath);
    try {
      const notes = db.getAllNotes();
      for (const note of notes) {
        const text = `${note.title} ${note.body_text}`;
        const vec = await embeddingProvider.embed([text]);
        embeddingsStore.upsertEmbedding("note", note.id, vec[0]!);
      }
      return { ok: true, count: notes.length };
    } finally {
      db.close();
    }
  });

  ipcMain.handle("semantic-margin", async (_event, opts: {
    book: string;
    startChapter: number;
    startVerse: number;
    endChapter: number;
    endVerse: number;
    passageText: string;
  }) => {
    if (!engine || !embeddingsStore || !bookNames) return null;
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    const db = new SQLiteMaterializer(dbPath);
    try {
      const queryEmbedding = deterministicEmbedding(opts.passageText, 256);

      // Get deterministic margin first to know which notes are already surfaced
      const detMargin = assembleMargin(
        {
          book: opts.book,
          startChapter: opts.startChapter,
          startVerse: opts.startVerse,
          endChapter: opts.endChapter,
          endVerse: opts.endVerse,
        },
        db,
        crossRefData,
        bookNames,
      );

      const alreadySurfaced = new Set(detMargin.notes.map((n) => n.noteId));

      const allEmbeddings = embeddingsStore.getAllEmbeddings().map((e) => ({
        srcKind: e.srcKind,
        srcId: e.srcId,
        vector: e.vector,
      }));

      const semantic = assembleSemanticMargin(
        {
          book: opts.book,
          startChapter: opts.startChapter,
          startVerse: opts.startVerse,
          endChapter: opts.endChapter,
          endVerse: opts.endVerse,
        },
        queryEmbedding,
        {
          getAllEmbeddings: () => allEmbeddings,
          getEmbedding: (kind, id) => allEmbeddings.find((e) => e.srcKind === kind && e.srcId === id),
          queryNoteById: (id) => {
            const n = db.queryNoteById(id);
            return n ? { id: n.id, title: n.title, body_text: n.body_text } : undefined;
          },
          queryClaimsForRange: (b, sc, sv, ec, ev) => db.queryClaimsForRange(b, sc, sv, ec, ev),
          queryClaimAnchors: (cid) => db.queryClaimAnchors(cid),
          queryOverlaysForRange: (b, sc, sv, ec, ev) => db.queryOverlaysForRange(b, sc, sv, ec, ev),
          getAllThreads: () => embeddingsStore!.getAllThreads(),
        },
        alreadySurfaced,
        bookNames,
      );

      return semantic;
    } finally {
      db.close();
    }
  });

  ipcMain.handle("pin-claim", async (_event, opts: { claimId: string; assertion: string; userNote?: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const factId = engine.pinClaim(opts.claimId, opts.assertion, opts.userNote);
    const txn = await revisionStore.beginTransaction("Pin claim → FactCard");
    txn.files.push("annotations/pinned-facts.jsonl");
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true, factId };
  });

  ipcMain.handle("promote-overlay", async (_event, opts: {
    overlayId: string;
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    color: string;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const hlId = engine.promoteOverlay(opts.overlayId, opts.book, opts.chapter, opts.verseStart, opts.verseEnd, opts.color);
    const txn = await revisionStore.beginTransaction("Promote overlay → highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true, highlightId: hlId };
  });

  ipcMain.handle("insert-claim", (_event, opts: {
    id: string;
    assertion: string;
    claimType: string;
    confidence: number;
    extractor: string;
    anchors: { book: string; chapter: number; verse: number }[];
    sources: { kind: string; ref: string }[];
  }) => {
    if (!engine) return { ok: false, error: "Not initialized" };
    engine.insertClaim({
      id: opts.id,
      assertion: opts.assertion,
      claimType: opts.claimType,
      confidence: opts.confidence,
      extractor: opts.extractor,
      created: new Date().toISOString(),
      status: "active",
      anchors: opts.anchors,
      sources: opts.sources,
    });
    return { ok: true };
  });

  ipcMain.handle("insert-overlay", (_event, opts: {
    id: string;
    book: string;
    chapter: number;
    verse: number;
    charStart: number;
    charEnd: number;
    reason: string;
    extractor: string;
  }) => {
    if (!engine) return { ok: false, error: "Not initialized" };
    engine.insertOverlay(opts);
    return { ok: true };
  });

  ipcMain.handle("get-budget-envelope", () => {
    if (!budgetManager) return null;
    return { envelope: budgetManager.get(), usage: budgetManager.getUsage() };
  });

  ipcMain.handle("set-budget-envelope", (_event, opts: { backgroundAI: string; networkBackground: boolean; dailyTokenCeiling?: number }) => {
    if (!budgetManager) return { ok: false, error: "Not initialized" };
    budgetManager.update({
      backgroundAI: opts.backgroundAI as "off" | "local-only" | "cloud",
      networkBackground: opts.networkBackground,
      dailyTokenCeiling: opts.dailyTokenCeiling,
    });
    return { ok: true };
  });

  ipcMain.handle("get-ai-jobs", () => {
    if (!embeddingsStore) return [];
    return embeddingsStore.getRecentJobs();
  });

  ipcMain.handle("get-all-facts", () => {
    if (!engine) return [];
    return engine.getAllFacts();
  });

  ipcMain.handle("ai-invoke", async (_event, opts: { prompt: string; context?: string }) => {
    if (!aiProvider || !budgetManager) return { ok: false, error: "AI not initialized" };
    if (!budgetManager.canSpend(1000)) return { ok: false, error: "Budget exceeded" };
    const resp = await aiProvider.invoke({ prompt: opts.prompt, context: opts.context });
    budgetManager.recordSpend(resp.tokensUsed);
    return { ok: true, text: resp.text, tokensUsed: resp.tokensUsed };
  });

  ipcMain.handle("get-ai-status", () => {
    if (!budgetManager) return null;
    const isReal = aiProvider instanceof OpenAICompatibleAIProvider;
    return {
      aiAllowed: budgetManager.isAIAllowed(),
      networkAllowed: budgetManager.isNetworkAllowed(),
      usage: budgetManager.getUsage(),
      provider: isReal ? "deepseek" : "mock",
      model: isReal ? (aiProvider as OpenAICompatibleAIProvider).model : null,
    };
  });

  ipcMain.handle("enqueue-ai-job", (_event, opts: { kind: string }) => {
    if (!jobQueue || !aiProvider) return { ok: false, error: "Not initialized" };
    const jobId = jobQueue.enqueue(opts.kind as "embed-notes" | "semantic-resurface" | "extract-claims" | "suggest-xrefs" | "generate-thread", async () => {
      const resp = await aiProvider!.invoke({ prompt: `Job: ${opts.kind}` });
      return { tokensUsed: resp.tokensUsed, error: null };
    });
    return { ok: true, jobId };
  });
}

/**
 * Native module ABI guard (Task A1).
 *
 * `better-sqlite3` is a native addon whose binary is compiled for one
 * Node/Electron ABI at a time. Electron 35 uses ABI 133; Node 24 uses ABI 137.
 * If the binary was rebuilt for Node-side verification, launching Electron
 * crashes deep inside `initializeEngine` with an opaque ERR_DLOPEN_FAILED.
 * This probe surfaces the failure as a visible dialog with an actionable
 * command before any library work begins.
 */
async function probeNativeModule(): Promise<boolean> {
  try {
    const require_ = createRequire(import.meta.url);
    const Database = require_("better-sqlite3") as new (path: string) => { exec: (s: string) => void; close: () => void };
    const db = new Database(":memory:");
    db.exec("CREATE TABLE preflight_probe (x INTEGER)");
    db.close();
    return true;
  } catch (err) {
    const detail = String((err as Error)?.message ?? err).split("\n").slice(0, 4).join("\n");
    dialog.showErrorBox(
      "Native module ABI mismatch",
      "better-sqlite3 could not be loaded by this Electron runtime.\n\n" +
        "This usually means the native binary was rebuilt for Node-side\n" +
        "verification (ABI 137) instead of Electron (ABI 133).\n\n" +
        "Fix: run  npm run rebuild:electron\n" +
        "Then re-launch the app.\n\n" +
        "Underlying error:\n" + detail,
    );
    app.quit();
    return false;
  }
}

app.whenReady().then(async () => {
  if (!(await probeNativeModule())) return;
  try {
    // Only skip auto-create (and let the renderer show the Welcome screen)
    // on a genuinely first-ever launch — once the user has confirmed ANY
    // location (default or custom), store.get("libraryPath") is set and we
    // treat that as "already onboarded", auto-creating there if its files
    // were somehow removed rather than reverting to first-run.
    initializeEngine(undefined, store.get("libraryPath") != null);
  } catch (err) {
    const detail = String((err as Error)?.message ?? err);
    dialog.showErrorBox(
      "Failed to initialize library",
      "The library engine could not start.\n\n" +
        "Underlying error:\n" + detail,
    );
    app.quit();
    return;
  }
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
