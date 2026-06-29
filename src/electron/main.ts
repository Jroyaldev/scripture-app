/**
 * Electron main process — wires the M1 core behind real file I/O.
 * No core logic here; only window management and IPC bridge.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ulid } from "ulid";
import type { BackboneData, BookNameMap, CanonicalRef } from "../core/reference/types.js";
import { parseBref, toBref, toDisplayString, parseHumanRef } from "../core/reference/parser.js";
import { validateBackboneData } from "../core/reference/backbone.js";
import { LibraryEngine } from "../host/library.js";
import { GitRevisionStore } from "../host/git-revision-store.js";
import { SQLiteMaterializer } from "../host/sqlite.js";
import { assembleMargin } from "../core/margin/index.js";
import { importObsidianVault } from "../core/importer/obsidian.js";
import type { CrossRefData, MarginQuery } from "../core/margin/types.js";

const DATA_DIR = resolve(__dirname, "../../data/scripture");
const CROSS_REF_DIR = resolve(__dirname, "../../data/cross-references");

let mainWindow: BrowserWindow | null = null;
let engine: LibraryEngine | null = null;
let revisionStore: GitRevisionStore | null = null;
let backbone: BackboneData | null = null;
let bookNames: BookNameMap | null = null;
let crossRefData: CrossRefData | null = null;

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

function getLibraryPath(): string {
  return process.env["LIBRARY_PATH"] ?? resolve(app.getPath("documents"), "ScriptureLibrary");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
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

  mainWindow.on("close", () => {
    // Flush pending git commits on close
    if (revisionStore) {
      void revisionStore.flush("Session close");
    }
  });
}

function initializeEngine(): void {
  backbone = loadBackbone();
  bookNames = loadBookNames();
  crossRefData = loadCrossRefs();

  const libraryPath = getLibraryPath();
  engine = new LibraryEngine(libraryPath, backbone, bookNames);
  revisionStore = new GitRevisionStore(libraryPath);

  // Ensure library is initialized
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
}

// --- IPC Handlers ---

function registerIpcHandlers(): void {
  ipcMain.handle("get-library-info", () => {
    if (!engine) return null;
    return {
      path: engine.rootPath,
      hasLibrary: existsSync(join(engine.rootPath, "config/library-manifest.json")),
    };
  });

  ipcMain.handle("resolve-reference", (_event, input: string) => {
    if (!backbone || !bookNames) return { ok: false, error: "Not initialized" };
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

  ipcMain.handle("create-highlight", async (_event, opts: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    color: string;
    package: string;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };

    const entityId = "hl_" + ulid();
    const event = engine.createEvent("highlight", entityId, "create", {
      book: opts.book,
      chapter: opts.chapter,
      verse_start: opts.verseStart,
      verse_end: opts.verseEnd,
      package: opts.package,
      color: opts.color,
      kind: "highlight",
    });
    engine.appendEvent(event);

    // Track in git
    const txn = await revisionStore.beginTransaction("Create highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);

    // Rebuild
    engine.buildSqlite();
    return { ok: true, highlightId: entityId };
  });

  ipcMain.handle("rebuild-sqlite", () => {
    if (!engine) return null;
    return engine.buildSqlite();
  });
}

app.whenReady().then(() => {
  initializeEngine();
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
