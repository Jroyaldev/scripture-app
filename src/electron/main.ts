/**
 * Electron main process — wires the M1 core behind real file I/O.
 * No core logic here; only window management and IPC bridge.
 */

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import ElectronStore from "electron-store";

// electron-store v11 is pure ESM. Under Electron 35 (Node 22 require(esm))
// esbuild's CJS interop wraps the namespace so `.default` is the namespace,
// not the class — unwrap whichever shape arrives (fails loudly otherwise).
const Store = ((ElectronStore as unknown as { default?: unknown }).default ??
  ElectronStore) as typeof ElectronStore;

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
import { CodexExecAIProvider, createCodexProvider } from "../host/codex-provider.js";
import { RendererEmbeddingProvider } from "./renderer-embeddings.js";
import { loadEnvFile } from "../host/env.js";
import { embedAllNotes } from "../host/embeddings-sync.js";
import { enrichAllNotes, type EnrichTier } from "../host/enrichment-sync.js";
import type { ThemeEntry } from "../core/ai/note-enrichment.js";
import { healSuggestionOrder, inferredRefKey } from "../core/ai/note-enrichment.js";
import type { AIProvider, EmbeddingProvider } from "../core/interfaces.js";
import type { HighlightRecord } from "../core/indexer/types.js";
import { JobQueue } from "../host/job-queue.js";
import { assembleMargin } from "../core/margin/index.js";
import { runSemanticMargin } from "../host/semantic-margin-host.js";
import { importObsidianVault } from "../core/importer/obsidian.js";
import { TokenPackageLoader } from "../host/token-package-loader.js";
import { SyntaxTreeLoader } from "../host/syntax-tree-loader.js";
import { getSharedStepMorphIndex, getSharedTipnrIndex } from "../core/language/index.js";
import type { CrossRefData, MarginQuery } from "../core/margin/types.js";
import {
  isHighlightOverlap,
  subtractHighlightRange,
  type HighlightRange,
} from "../core/events/highlightOverlap.js";

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
  readingSize: "s" | "m" | "l";
  readingWidth: "narrow" | "medium" | "wide";
  verseNumbers: "always" | "faint" | "hover";
  sidebarStyle: "original" | "compact" | "rail";
  recentPassages: Array<{
    book: string;
    chapter: number;
    verse?: number;
    packageId: string;
    visitedAt: number;
  }>;
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
    readingSize: "m",
    readingWidth: "medium",
    verseNumbers: "always",
    sidebarStyle: "original",
    recentPassages: [],
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
let codexProvider: CodexExecAIProvider | null = null;
let themes: ThemeEntry[] = [];
let embeddingProvider: EmbeddingProvider | null = null;
let jobQueue: JobQueue | null = null;
/** Original-language packages (MACULA Greek, later OSHB Hebrew). */
let tokenPackages: TokenPackageLoader | null = null;
/** MACULA syntax trees (syntax art). */
let syntaxTrees: SyntaxTreeLoader | null = null;

interface HighlightChangeSnapshot {
  before: HighlightRecord[];
  after: HighlightRecord[];
}

// Undo tokens are intentionally process-local and short-lived in product
// terms: they back the five-second toast, not durable history. The append-only
// event log remains the durable source of truth.
const highlightChanges = new Map<string, HighlightChangeSnapshot>();
const MAX_HIGHLIGHT_CHANGES = 50;

function rememberHighlightChange(before: HighlightRecord[], after: HighlightRecord[]): string {
  const changeId = `hlchg_${ulid()}`;
  highlightChanges.set(changeId, {
    before: before.map((record) => ({ ...record, deleted: 0 })),
    after: after.map((record) => ({ ...record, deleted: 0 })),
  });
  while (highlightChanges.size > MAX_HIGHLIGHT_CHANGES) {
    const oldest = highlightChanges.keys().next().value as string | undefined;
    if (!oldest) break;
    highlightChanges.delete(oldest);
  }
  return changeId;
}

function highlightRecordMatches(a: HighlightRecord | undefined, b: HighlightRecord): boolean {
  return !!a &&
    a.id === b.id &&
    a.book === b.book &&
    a.chapter === b.chapter &&
    a.verse_start === b.verse_start &&
    a.verse_end === b.verse_end &&
    a.package === b.package &&
    a.char_start === b.char_start &&
    a.char_end === b.char_end &&
    a.color === b.color &&
    a.deleted === 0;
}

function rangeRecord(
  id: string,
  source: HighlightRecord,
  range: HighlightRange,
): HighlightRecord {
  return {
    ...source,
    id,
    verse_start: range.verseStart,
    verse_end: range.verseEnd,
    char_start: range.charStart,
    char_end: range.charEnd,
    deleted: 0,
  };
}

function validateHighlightRange(range: HighlightRange): string | null {
  if (!Number.isInteger(range.verseStart) || !Number.isInteger(range.verseEnd) || range.verseStart < 1 || range.verseEnd < range.verseStart) {
    return "Invalid highlight verse range";
  }
  if (range.charStart != null && (!Number.isInteger(range.charStart) || range.charStart < 0)) {
    return "Invalid highlight start offset";
  }
  if (range.charEnd != null && (!Number.isInteger(range.charEnd) || range.charEnd < 0)) {
    return "Invalid highlight end offset";
  }
  if (
    range.verseStart === range.verseEnd &&
    range.charStart != null &&
    range.charEnd != null &&
    range.charEnd <= range.charStart
  ) {
    return "Highlight selection is empty";
  }
  return null;
}

function applyHighlightRecordUpdate(target: LibraryEngine, record: HighlightRecord): void {
  target.applyHighlightUpdate(record.id, {
    book: record.book,
    chapter: record.chapter,
    verseStart: record.verse_start,
    verseEnd: record.verse_end,
    package: record.package,
    color: record.color,
    charStart: record.char_start,
    charEnd: record.char_end,
  });
}

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

function loadThemes(): ThemeEntry[] {
  const themesPath = resolve(__dirname, "../../data/themes/themes-seed-en.json");
  if (!existsSync(themesPath)) return [];
  return (JSON.parse(readFileSync(themesPath, "utf-8")) as { themes: ThemeEntry[] }).themes;
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

function languagePackageRoots(libraryPath: string): string[] {
  return [
    join(libraryPath, ".artifacts/scripture/packages"),
    join(DATA_DIR, "packages"),
  ];
}

let stepMorphLoaded = false;

/** Load STEPBible TEGMC/TEHMC once into the shared index (CC BY). */
function loadStepMorphTablesOnce(): void {
  const index = getSharedStepMorphIndex();
  // Retry if a previous attempt left the index empty (missing files, race).
  if (stepMorphLoaded && index.size > 0) return;
  const morphDir = join(DATA_DIR, "morph");
  const greekPath = join(morphDir, "TEGMC-STEPBible-CC-BY.txt");
  const hebrewPath = join(morphDir, "TEHMC-STEPBible-CC-BY.txt");
  try {
    if (existsSync(greekPath)) {
      index.loadTable(readFileSync(greekPath, "utf8"), "STEPBible TEGMC");
    }
    if (existsSync(hebrewPath)) {
      index.loadTable(readFileSync(hebrewPath, "utf8"), "STEPBible TEHMC");
    }
    stepMorphLoaded = index.size > 0;
    console.log(
      `STEP morph overlay: ${index.size} codes` +
        ` (TEGMC ${existsSync(greekPath) ? "ok" : "MISSING"}, TEHMC ${existsSync(hebrewPath) ? "ok" : "MISSING"})` +
        ` dir=${morphDir}`,
    );
  } catch (err) {
    console.warn("STEP morph tables not loaded:", err);
    stepMorphLoaded = false;
  }
}

let tipnrLoaded = false;

/** Load compact TIPNR people/places index (CC BY). */
function loadTipnrIndexOnce(): void {
  const index = getSharedTipnrIndex();
  if (tipnrLoaded && index.loaded) return;
  const path = join(DATA_DIR, "names/tipnr-index.json");
  try {
    if (!existsSync(path)) {
      console.warn(`TIPNR index missing: ${path} (run npx tsx scripts/import-tipnr.ts)`);
      tipnrLoaded = false;
      return;
    }
    const n = index.loadJson(readFileSync(path, "utf8"));
    tipnrLoaded = n > 0;
    console.log(`TIPNR names index: ${n} entities (${path})`);
  } catch (err) {
    console.warn("TIPNR index not loaded:", err);
    tipnrLoaded = false;
  }
}

function initializeEngine(libraryPathArg?: string, autoCreateIfMissing: boolean = true): void {
  highlightChanges.clear();
  backbone = loadBackbone();
  bookNames = loadBookNames();
  crossRefData = loadCrossRefs();

  const libraryPath = getLibraryPath(libraryPathArg);
  engine = new LibraryEngine(libraryPath, backbone, bookNames);
  revisionStore = new GitRevisionStore(libraryPath);
  const hebrewGlossPath = join(DATA_DIR, "lexicons/strongs-hebrew-gloss.json");
  const hebrewGlossJson = existsSync(hebrewGlossPath)
    ? readFileSync(hebrewGlossPath, "utf8")
    : undefined;

  // STEP morph overlay (Approach A) — load before any card request.
  loadStepMorphTablesOnce();
  loadTipnrIndexOnce();

  if (!tokenPackages) {
    tokenPackages = new TokenPackageLoader(languagePackageRoots(libraryPath), {
      hebrewGlossJson,
      ensureStepMorph: loadStepMorphTablesOnce,
    });
  } else {
    tokenPackages.setRoots(languagePackageRoots(libraryPath));
    if (hebrewGlossJson) tokenPackages.loadHebrewGlossJson(hebrewGlossJson);
  }

  const syntaxRoots = [join(DATA_DIR, "syntax")];
  if (!syntaxTrees) {
    syntaxTrees = new SyntaxTreeLoader(syntaxRoots);
  } else {
    syntaxTrees.setRoots(syntaxRoots);
  }

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
    // B3 Gate 1: real LLM provider when a key is configured (.env at the repo
    // root in dev, or the process environment), deterministic mock otherwise.
    loadEnvFile(resolve(__dirname, "../../.env"));
    aiProvider = createDeepSeekProvider(process.env) ?? new MockAIProvider();
    // B3.6: enrichment tier stack — Codex subscription (DEEP) leads when the
    // user has codex installed + signed in; DeepSeek (FAST) is the fallback.
    codexProvider = createCodexProvider(process.env);
    themes = loadThemes();
    // B3 Gate 2: local on-device embeddings (EmbeddingGemma) in a hidden
    // renderer running onnxruntime-web/WASM. Every Node-side option (main
    // thread, worker_threads, utilityProcess, run-as-node) either livelocks
    // the UI or SIGTRAPs under Electron's V8 memory cage — see
    // renderer-embeddings.ts. Lazy: constructing this spawns nothing.
    // EMBEDDING_MODEL env can override; "mock" forces the test provider.
    embeddingProvider =
      process.env["EMBEDDING_MODEL"] === "mock"
        ? new MockEmbeddingProvider()
        : new RendererEmbeddingProvider({
            htmlPath: join(__dirname, "../embedding-host/index.html"),
            preloadPath: join(__dirname, "embed-preload.cjs"),
          });
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

  // --- Original-language token packages (data-first language layer) ---

  ipcMain.handle("language-list-packages", () => {
    return tokenPackages?.listPackages() ?? [];
  });

  ipcMain.handle("language-load-package", (_event, packageId: string) => {
    if (!tokenPackages) return { ok: false, error: "Loader not ready" };
    const ok = tokenPackages.load(packageId);
    return ok
      ? { ok: true, packageId, loaded: true }
      : { ok: false, error: `Package not found or empty: ${packageId}` };
  });

  ipcMain.handle(
    "language-verse-tokens",
    (
      _event,
      opts: { packageId: string; book: string; chapter: number; verse: number },
    ) => {
      if (!tokenPackages) return null;
      return tokenPackages.getVerseTokens(
        opts.packageId,
        opts.book,
        opts.chapter,
        opts.verse,
      );
    },
  );

  ipcMain.handle(
    "language-get-token",
    (_event, opts: { packageId: string; tokenId: string }) => {
      if (!tokenPackages) return null;
      return tokenPackages.getToken(opts.packageId, opts.tokenId);
    },
  );

  ipcMain.handle(
    "language-token-card",
    (_event, opts: { packageId: string; tokenId: string }) => {
      if (!tokenPackages) return null;
      return tokenPackages.getTokenCard(opts.packageId, opts.tokenId);
    },
  );

  ipcMain.handle(
    "language-lemma-in-book",
    (_event, opts: { packageId: string; book: string; lemma: string }) => {
      if (!tokenPackages) return null;
      return tokenPackages.getLemmaInBook(opts.packageId, opts.book, opts.lemma);
    },
  );

  ipcMain.handle(
    "language-verse-marks",
    (
      _event,
      opts: { packageId: string; book: string; chapter: number; verse: number },
    ) => {
      if (!tokenPackages) return null;
      return tokenPackages.getMarksForVerse(
        opts.packageId,
        opts.book,
        opts.chapter,
        opts.verse,
      );
    },
  );

  ipcMain.handle(
    "language-syntax-for-token",
    (
      _event,
      opts: { packageId: string; book: string; tokenId: string },
    ) => {
      if (!syntaxTrees) return null;
      return syntaxTrees.getForToken(opts.packageId, opts.book, opts.tokenId);
    },
  );

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
    charStart?: number | null;
    charEnd?: number | null;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };

    const incoming: HighlightRange = {
      verseStart: opts.verseStart,
      verseEnd: opts.verseEnd,
      charStart: opts.charStart ?? null,
      charEnd: opts.charEnd ?? null,
    };
    const rangeError = validateHighlightRange(incoming);
    if (rangeError) return { ok: false, error: rangeError };

    const existing = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package);
    const before = existing.filter((highlight) => isHighlightOverlap(highlight, incoming));
    const after: HighlightRecord[] = [];

    // Subtract the incoming range from every highlight underneath it. The
    // first remainder keeps the original entity id; a second remainder gets a
    // fresh id. This preserves untouched outer verses/characters for every
    // single- and multi-verse overlap shape.
    for (const h of before) {
      const remainders = subtractHighlightRange(h, incoming);
      if (remainders.length === 0) {
        engine.applyHighlightDelete(h.id);
        continue;
      }

      const first = rangeRecord(h.id, h, remainders[0]!);
      applyHighlightRecordUpdate(engine, first);
      after.push(first);
      for (const remainder of remainders.slice(1)) {
        const remainderId = engine.applyHighlightCreate(
          h.book,
          h.chapter,
          remainder.verseStart,
          remainder.verseEnd,
          h.color,
          h.package,
          remainder.charStart,
          remainder.charEnd,
        );
        after.push(rangeRecord(remainderId, h, remainder));
      }
    }

    const entityId = engine.applyHighlightCreate(
      opts.book, opts.chapter, opts.verseStart, opts.verseEnd, opts.color, opts.package,
      incoming.charStart, incoming.charEnd,
    );
    after.push({
      id: entityId,
      book: opts.book,
      chapter: opts.chapter,
      verse_start: opts.verseStart,
      verse_end: opts.verseEnd,
      package: opts.package,
      char_start: incoming.charStart,
      char_end: incoming.charEnd,
      color: opts.color,
      kind: "highlight",
      note_id: null,
      deleted: 0,
    });
    const changeId = rememberHighlightChange(before, after);

    const txn = await revisionStore.beginTransaction("Create highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);

    return { ok: true, highlightId: entityId, changeId };
  });

  ipcMain.handle("erase-highlight-range", async (_event, opts: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    package: string;
    charStart?: number | null;
    charEnd?: number | null;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const incoming: HighlightRange = {
      verseStart: opts.verseStart,
      verseEnd: opts.verseEnd,
      charStart: opts.charStart ?? null,
      charEnd: opts.charEnd ?? null,
    };
    const rangeError = validateHighlightRange(incoming);
    if (rangeError) return { ok: false, error: rangeError };

    const existing = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package);
    const before = existing.filter((highlight) => isHighlightOverlap(highlight, incoming));
    if (before.length === 0) return { ok: true };
    const after: HighlightRecord[] = [];

    for (const h of before) {
      const remainders = subtractHighlightRange(h, incoming);
      if (remainders.length === 0) {
        engine.applyHighlightDelete(h.id);
        continue;
      }
      const first = rangeRecord(h.id, h, remainders[0]!);
      applyHighlightRecordUpdate(engine, first);
      after.push(first);
      for (const remainder of remainders.slice(1)) {
        const id = engine.applyHighlightCreate(
          h.book,
          h.chapter,
          remainder.verseStart,
          remainder.verseEnd,
          h.color,
          h.package,
          remainder.charStart,
          remainder.charEnd,
        );
        after.push(rangeRecord(id, h, remainder));
      }
    }

    const changeId = rememberHighlightChange(before, after);
    const txn = await revisionStore.beginTransaction("Erase highlight range");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true, changeId };
  });

  ipcMain.handle("recolor-highlights", async (_event, opts: {
    book: string;
    chapter: number;
    package: string;
    entityIds: string[];
    color: string;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const ids = new Set(opts.entityIds);
    const before = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package)
      .filter((highlight) => ids.has(highlight.id));
    if (before.length === 0) return { ok: false, error: "Highlights no longer exist" };

    const after = before.map((highlight) => ({ ...highlight, color: opts.color, deleted: 0 }));
    for (const highlight of after) applyHighlightRecordUpdate(engine, highlight);
    const changeId = rememberHighlightChange(before, after);
    const txn = await revisionStore.beginTransaction("Recolor highlights");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true, changeId };
  });

  ipcMain.handle("delete-highlights", async (_event, opts: {
    book: string;
    chapter: number;
    package: string;
    entityIds: string[];
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const ids = new Set(opts.entityIds);
    const before = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package)
      .filter((highlight) => ids.has(highlight.id));
    if (before.length === 0) return { ok: false, error: "Highlights no longer exist" };
    for (const highlight of before) engine.applyHighlightDelete(highlight.id);
    const changeId = rememberHighlightChange(before, []);
    const txn = await revisionStore.beginTransaction("Delete highlights");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true, changeId };
  });

  ipcMain.handle("undo-highlight-change", async (_event, changeId: string) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const change = highlightChanges.get(changeId);
    if (!change) return { ok: false, error: "This highlight change can no longer be undone" };

    const relevant = [...change.before, ...change.after];
    const currentById = new Map<string, HighlightRecord>();
    const queried = new Set<string>();
    for (const record of relevant) {
      const key = `${record.book}\u0000${record.chapter}\u0000${record.package}`;
      if (queried.has(key)) continue;
      queried.add(key);
      for (const current of engine.queryHighlightsForChapter(record.book, record.chapter, record.package)) {
        currentById.set(current.id, current);
      }
    }

    const afterIds = new Set(change.after.map((record) => record.id));
    const beforeIds = new Set(change.before.map((record) => record.id));
    const afterStillCurrent = change.after.every((record) => highlightRecordMatches(currentById.get(record.id), record));
    const deletedBeforeStillAbsent = change.before
      .filter((record) => !afterIds.has(record.id))
      .every((record) => !currentById.has(record.id));
    if (!afterStillCurrent || !deletedBeforeStillAbsent) {
      return { ok: false, error: "That highlight changed again, so the older Undo was not applied" };
    }

    for (const record of change.after) {
      if (!beforeIds.has(record.id)) engine.applyHighlightDelete(record.id);
    }
    for (const record of change.before) {
      if (afterIds.has(record.id)) applyHighlightRecordUpdate(engine, record);
      else engine.applyHighlightRestore(record);
    }

    highlightChanges.delete(changeId);
    const txn = await revisionStore.beginTransaction("Undo highlight change");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true };
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
      const result = await embedAllNotes(db, embeddingsStore, embeddingProvider, themes);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  // --- B3.6: capture-time note enrichment ---

  /** Enrichment tier stack honoring the budget envelope (INV-16). */
  function enrichmentTiers(): EnrichTier[] {
    if (!budgetManager || budgetManager.get().backgroundAI !== "cloud") return [];
    const tiers: EnrichTier[] = [];
    if (codexProvider) tiers.push({ provider: codexProvider, modelId: `codex-${codexProvider.model}` });
    if (aiProvider && aiProvider instanceof OpenAICompatibleAIProvider) {
      tiers.push({ provider: aiProvider, modelId: aiProvider.model });
    }
    return tiers;
  }

  ipcMain.handle("enrich-note", async (_event, opts: { noteId: string }) => {
    if (!engine || !embeddingsStore || !backbone || !bookNames || !embeddingProvider) {
      return { ok: false, error: "Not initialized" };
    }
    const tiers = enrichmentTiers();
    if (tiers.length === 0) {
      return { ok: false, error: "background AI is off (budget envelope) or no provider configured" };
    }
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    const db = new SQLiteMaterializer(dbPath);
    try {
      const note = db.queryNoteById(opts.noteId);
      if (!note) return { ok: false, error: "note not found" };
      await enrichAllNotes({
        notes: [{ id: note.id, title: note.title, body_text: note.body_text }],
        store: embeddingsStore,
        backbone,
        themes,
        tiers,
      });
      // Re-embed so the expansion chunk participates in retrieval immediately.
      await embedAllNotes(db, embeddingsStore, embeddingProvider, themes);
      return { ok: true, ...getEnrichmentSuggestions(opts.noteId) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  /** Suggestions = inferred refs minus feedback, healed by prior confirms, display-ready. */
  function getEnrichmentSuggestions(noteId: string): {
    enriched: boolean;
    noScriptureIntent: boolean;
    suggestions: { refKey: string; display: string; bref: string; healed: boolean }[];
  } {
    const enrichment = embeddingsStore?.getEnrichment(noteId);
    if (!enrichment || !bookNames) return { enriched: false, noScriptureIntent: false, suggestions: [] };
    const feedback = new Set(embeddingsStore!.getEnrichmentFeedback(noteId).map((f) => f.refKey));

    // E5 healing: passages the user confirmed on theme-sharing notes lead.
    const allEnrichments = embeddingsStore!.getAllEnrichments();
    const { suggestions: ordered, healedKeys } = healSuggestionOrder({
      noteThemes: enrichment.themes,
      suggestions: enrichment.inferredRefs.filter((r) => !feedback.has(inferredRefKey(r))),
      confirmations: embeddingsStore!
        .getAllEnrichmentFeedback()
        .filter((f) => f.action === "confirmed" && f.noteId !== noteId)
        .map((f) => ({ noteId: f.noteId, refKey: f.refKey })),
      themesByNote: new Map(allEnrichments.map((e) => [e.noteId, e.themes])),
    });

    const suggestions = ordered.map((r) => {
      const name = bookNames![r.book]?.[0] ?? r.book;
      const display =
        r.verseStart !== undefined
          ? `${name} ${r.chapter}:${r.verseStart}${r.verseEnd && r.verseEnd !== r.verseStart ? `–${r.verseEnd}` : ""}`
          : `${name} ${r.chapter}`;
      const bref =
        r.verseStart !== undefined
          ? `bref:v1/${r.book}.${r.chapter}.${r.verseStart}`
          : `bref:v1/${r.book}.${r.chapter}.1`;
      return { refKey: inferredRefKey(r), display, bref, healed: healedKeys.has(inferredRefKey(r)) };
    });
    return { enriched: true, noScriptureIntent: enrichment.noScriptureIntent, suggestions };
  }

  ipcMain.handle("get-enrichment", (_event, opts: { noteId: string }) => {
    if (!embeddingsStore) return { enriched: false, noScriptureIntent: false, suggestions: [] };
    return getEnrichmentSuggestions(opts.noteId);
  });

  ipcMain.handle(
    "enrichment-feedback",
    async (_event, opts: { noteId: string; refKey: string; action: "confirmed" | "dismissed"; refDisplay?: string }) => {
      if (!engine || !embeddingsStore || !revisionStore) return { ok: false, error: "Not initialized" };
      embeddingsStore.setEnrichmentFeedback({
        noteId: opts.noteId,
        refKey: opts.refKey,
        action: opts.action,
        created: new Date().toISOString(),
      });
      if (opts.action === "confirmed" && opts.refDisplay) {
        // Confirmation is a USER action: the ref is appended to the note
        // body (the file is authoritative, INV-11) and becomes a real,
        // full-strength anchor on the next index pass. INV-1 satisfied:
        // the write happens only on this explicit user action.
        const parsed = engine.readAllNotes().find((n) => n.frontmatter.id === opts.noteId);
        if (!parsed) return { ok: false, error: "note not found" };
        const newBody = `${parsed.body.trimEnd()}\n\nRelated: ${opts.refDisplay}\n`;
        const notePath = engine.createNote(opts.noteId, parsed.frontmatter.title, newBody, {
          type: parsed.frontmatter.type ?? "user",
          tags: parsed.frontmatter.tags,
        });
        const relPath = notePath.replace(engine.rootPath + "/", "");
        const txn = await revisionStore.beginTransaction(`Anchor note to ${opts.refDisplay}`);
        txn.files.push(relPath);
        await revisionStore.commit(txn);
        engine.buildSqlite();
      }
      return { ok: true };
    },
  );

  // A-5: unanchor is one tap, symmetrical with anchor. Removes the appended
  // "Related: <ref>" line and clears the feedback record (the suggestion may
  // return; the user changed their mind, they didn't dismiss the idea).
  ipcMain.handle(
    "unanchor-note-ref",
    async (_event, opts: { noteId: string; refKey: string; refDisplay: string }) => {
      if (!engine || !embeddingsStore || !revisionStore) return { ok: false, error: "Not initialized" };
      const parsed = engine.readAllNotes().find((n) => n.frontmatter.id === opts.noteId);
      if (!parsed) return { ok: false, error: "note not found" };
      const line = `Related: ${opts.refDisplay}`;
      const newBody = parsed.body
        .split("\n")
        .filter((l) => l.trim() !== line)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");
      const notePath = engine.createNote(opts.noteId, parsed.frontmatter.title, newBody, {
        type: parsed.frontmatter.type ?? "user",
        tags: parsed.frontmatter.tags,
      });
      const relPath = notePath.replace(engine.rootPath + "/", "");
      const txn = await revisionStore.beginTransaction(`Unanchor note from ${opts.refDisplay}`);
      txn.files.push(relPath);
      await revisionStore.commit(txn);
      engine.buildSqlite();
      embeddingsStore.deleteEnrichmentFeedback(opts.noteId, opts.refKey);
      return { ok: true };
    },
  );

  ipcMain.handle("semantic-margin", async (_event, opts: {
    book: string;
    startChapter: number;
    startVerse: number;
    endChapter: number;
    endVerse: number;
    passageText: string;
  }) => {
    if (!engine || !embeddingsStore || !bookNames || !embeddingProvider) return null;
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    const db = new SQLiteMaterializer(dbPath);
    try {
      // B3.5: one shared code path (host runner) for the IPC handler, the
      // eval harness, and smoke scripts — hybrid retrieval with the
      // calibrated quality bar lives in core, wiring lives in the runner.
      return await runSemanticMargin({
        db,
        embeddingsStore,
        provider: embeddingProvider,
        crossRefData,
        bookNames,
        themes,
        request: opts,
      });
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
    if (!embeddingsStore) return { ok: false, error: "Not initialized" };
    // B-1: claims live in the persistent AI-derived store (embeddings.sqlite),
    // not library.sqlite — the materialized view is wiped on every note save.
    embeddingsStore.insertClaim({
      id: opts.id,
      assertion: opts.assertion,
      claim_type: opts.claimType,
      confidence: opts.confidence,
      extractor: opts.extractor,
      created: new Date().toISOString(),
      status: "active",
    });
    for (const a of opts.anchors) {
      embeddingsStore.insertClaimAnchor({ claim_id: opts.id, book: a.book, chapter: a.chapter, verse: a.verse });
    }
    for (const s of opts.sources) {
      embeddingsStore.insertClaimSource({ claim_id: opts.id, kind: s.kind, ref: s.ref });
    }
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
      embeddingModel: embeddingProvider?.modelId ?? null,
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
