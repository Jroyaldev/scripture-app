/**
 * Electron main process.
 * Wires the M1 core engine behind real file I/O + the Git RevisionStore adapter.
 * Surfaces the renderer via IPC (contextBridge/preload).
 */

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync, mkdirSync, cpSync } from "node:fs";
import { LibraryEngine } from "../host/library.js";
import { SQLiteMaterializer } from "../host/sqlite.js";
import { GitRevisionStore } from "./git-revision-store.js";
import { parseBref, parseHumanRef, toBref, toDisplayString } from "../core/reference/parser.js";
import { checkMigration } from "../core/migration/index.js";
import { runDoctor } from "../core/doctor/index.js";
import type { BackboneData, BookNameMap } from "../core/reference/types.js";
import { ulid } from "ulid";

let mainWindow: BrowserWindow | null = null;
let engine: LibraryEngine | null = null;
let revisionStore: GitRevisionStore | null = null;
let backbone: BackboneData | null = null;
let bookNames: BookNameMap | null = null;

const DATA_DIR = join(app.isPackaged ? process.resourcesPath : process.cwd(), "data");

function getDefaultLibraryPath(): string {
  return join(app.getPath("documents"), "ScriptureLibrary");
}

function loadStaticData(): void {
  backbone = JSON.parse(
    readFileSync(join(DATA_DIR, "scripture", "backbone.json"), "utf-8"),
  ) as BackboneData;
  bookNames = JSON.parse(
    readFileSync(join(DATA_DIR, "scripture", "book-names-en.json"), "utf-8"),
  ) as BookNameMap;
}

function initEngine(libraryPath: string): void {
  if (!backbone || !bookNames) loadStaticData();
  engine = new LibraryEngine(libraryPath, backbone!, bookNames!);

  if (!existsSync(libraryPath)) {
    engine.initLibrary();
    // Install backbone + versification into .artifacts
    engine.installBackboneData(
      join(DATA_DIR, "scripture", "backbone.json"),
      join(DATA_DIR, "scripture", "versification"),
    );
    // Install cross-references if available
    const xrefPath = join(DATA_DIR, "cross-references", "tsk-xrefs.json");
    if (existsSync(xrefPath)) {
      const destDir = join(libraryPath, ".artifacts", "scripture", "cross-references");
      mkdirSync(destDir, { recursive: true });
      cpSync(xrefPath, join(destDir, "tsk-xrefs.json"));
    }
  }

  // Initialize Git RevisionStore adapter (§4.11)
  revisionStore = new GitRevisionStore(libraryPath);
  revisionStore.ensureInit();

  // Build SQLite if not present
  const sqlitePath = join(libraryPath, ".system", "library.sqlite");
  if (!existsSync(sqlitePath)) {
    engine.buildSqlite();
  }
}

function createWindow(): void {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Scripture Library",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
}

// --- IPC Handlers ---

function registerIpcHandlers(): void {
  ipcMain.handle("library:getPath", () => {
    return engine?.rootPath ?? getDefaultLibraryPath();
  });

  ipcMain.handle("library:init", (_event, libraryPath: string) => {
    initEngine(libraryPath);
    return { ok: true };
  });

  ipcMain.handle("library:rebuild", () => {
    if (!engine) return { ok: false, error: "No library loaded" };
    const hash = engine.buildSqlite();
    return { ok: true, hash };
  });

  ipcMain.handle("library:getSummary", () => {
    if (!engine) return null;
    return engine.getSummary();
  });

  ipcMain.handle("library:readAllNotes", () => {
    if (!engine) return [];
    return engine.readAllNotes();
  });

  ipcMain.handle("library:createNote", (_event, title: string, body: string, opts?: { type?: string; tags?: string[] }) => {
    if (!engine) return { ok: false, error: "No library loaded" };
    const id = ulid();
    const path = engine.createNote(id, title, body, opts);
    engine.buildSqlite();
    if (revisionStore) {
      revisionStore.scheduleCommit("Create note: " + title);
    }
    return { ok: true, id, path };
  });

  ipcMain.handle("library:queryVerse", (_event, book: string, chapter: number, verse: number) => {
    if (!engine) return { anchors: [], highlights: [], notes: [] };
    return engine.queryVerse(book, chapter, verse);
  });

  ipcMain.handle("library:queryRange", (_event, startBook: string, startCh: number, startV: number, _endBook: string, _endCh: number, endV: number) => {
    if (!engine) return { anchors: [], highlights: [], notes: [] };
    // Query all verses in the range and merge results
    const allAnchors = new Map<string, unknown>();
    const allHighlights = new Map<string, unknown>();
    const allNotes = new Map<string, unknown>();

    for (let v = startV; v <= endV; v++) {
      const result = engine.queryVerse(startBook, startCh, v);
      for (const a of result.anchors) allAnchors.set(a.id, a);
      for (const h of result.highlights) allHighlights.set(h.id, h);
      for (const n of result.notes) allNotes.set(n.id, n);
    }

    return {
      anchors: Array.from(allAnchors.values()),
      highlights: Array.from(allHighlights.values()),
      notes: Array.from(allNotes.values()),
    };
  });

  ipcMain.handle("library:createHighlight", (_event, book: string, chapter: number, verseStart: number, verseEnd: number, color: string, packageId: string) => {
    if (!engine) return { ok: false, error: "No library loaded" };
    const entityId = "hl_" + ulid();
    const event = engine.createEvent("highlight", entityId, "create", {
      book, chapter, verse_start: verseStart, verse_end: verseEnd,
      package: packageId, color, kind: "highlight",
    });
    engine.appendEvent(event);
    engine.buildSqlite();
    if (revisionStore) {
      revisionStore.scheduleCommit(`Highlight ${book} ${chapter}:${verseStart}-${verseEnd}`);
    }
    return { ok: true, entityId };
  });

  ipcMain.handle("library:deleteHighlight", (_event, entityId: string, baseEventId: string) => {
    if (!engine) return { ok: false, error: "No library loaded" };
    const event = engine.createEvent("highlight", entityId, "delete", {}, baseEventId);
    engine.appendEvent(event);
    engine.buildSqlite();
    if (revisionStore) {
      revisionStore.scheduleCommit("Delete highlight");
    }
    return { ok: true };
  });

  ipcMain.handle("library:search", (_event, query: string) => {
    if (!engine) return [];
    const dbPath = join(engine.rootPath, ".system", "library.sqlite");
    const mat = new SQLiteMaterializer(dbPath);
    try {
      const results = mat.searchNotes(query);
      mat.close();
      return results;
    } catch {
      mat.close();
      return [];
    }
  });

  ipcMain.handle("library:doctor", async () => {
    if (!engine || !backbone || !bookNames) return null;
    const notes = engine.readAllNotes();
    const events = engine.readAllEvents();
    const manifest = engine.readManifest();
    const dbPath = join(engine.rootPath, ".system", "library.sqlite");
    let rebuildHash: string | null = null;
    let expectedRebuildHash: string | null = null;
    if (existsSync(dbPath)) {
      const mat = new SQLiteMaterializer(dbPath);
      rebuildHash = mat.getMeta("rebuild_hash") ?? null;
      mat.close();
      const freshHash = engine.buildSqlite();
      expectedRebuildHash = freshHash;
    }
    return runDoctor({
      notes,
      events,
      manifest,
      backbone: backbone!,
      rebuildHash,
      expectedRebuildHash,
      packageManifests: [],
      sourceDirs: [],
      installedArtifactPaths: [],
    });
  });

  ipcMain.handle("library:migrate", (_event, dryRun: boolean) => {
    if (!engine) return { status: "error", message: "No library loaded" };
    const manifest = engine.readManifest();
    if (!manifest) return { status: "error", message: "No manifest found" };
    return checkMigration(manifest, dryRun);
  });

  // Reference engine
  ipcMain.handle("ref:resolve", (_event, humanRef: string) => {
    if (!backbone || !bookNames) loadStaticData();
    return parseHumanRef(humanRef, bookNames!, backbone!);
  });

  ipcMain.handle("ref:parseBref", (_event, bref: string) => {
    return parseBref(bref);
  });

  ipcMain.handle("ref:toBref", (_event, ref: unknown) => {
    return toBref(ref as any);
  });

  ipcMain.handle("ref:toDisplay", (_event, ref: unknown) => {
    if (!bookNames) loadStaticData();
    return toDisplayString(ref as any, bookNames!);
  });

  // Scripture text loading
  ipcMain.handle("scripture:getBackbone", () => {
    if (!backbone) loadStaticData();
    return backbone;
  });

  ipcMain.handle("scripture:getBookNames", () => {
    if (!bookNames) loadStaticData();
    return bookNames;
  });

  ipcMain.handle("scripture:getChapterText", (_event, _packageId: string, book: string, chapter: number) => {
    // For M2, return verse numbers with placeholder text (actual text loading from packages is M2+ polish)
    // The WEB text would be loaded from .artifacts/scripture/packages/web/ when available
    if (!backbone) loadStaticData();
    const bookData = backbone!.books[book];
    if (!bookData) return null;
    const chapterIdx = chapter - 1;
    if (chapterIdx < 0 || chapterIdx >= bookData.chapters.length) return null;
    const verseCount = bookData.chapters[chapterIdx]!;

    const verses: Array<{ verse: number; text: string }> = [];
    for (let v = 1; v <= verseCount; v++) {
      verses.push({ verse: v, text: `[${book} ${chapter}:${v} — text will load from WEB/KJV package]` });
    }
    return { book, chapter, verses, verseCount };
  });

  ipcMain.handle("scripture:getCrossRefs", (_event, book: string, chapter: number, verse: number) => {
    if (!engine) return [];
    const xrefPath = join(engine.rootPath, ".artifacts", "scripture", "cross-references", "tsk-xrefs.json");
    if (!existsSync(xrefPath)) return [];
    try {
      const xrefs = JSON.parse(readFileSync(xrefPath, "utf-8")) as Record<string, string[]>;
      const key = `${book}.${chapter}.${verse}`;
      return xrefs[key] ?? [];
    } catch {
      return [];
    }
  });

  // Vault importer
  ipcMain.handle("library:importVault", async (_event, vaultPath: string) => {
    if (!engine || !backbone || !bookNames) return { ok: false, error: "No library loaded" };
    const { importObsidianVault } = await import("./vault-importer.js");
    const result = importObsidianVault(vaultPath, engine, backbone, bookNames);
    engine.buildSqlite();
    if (revisionStore) {
      revisionStore.scheduleCommit("Import Obsidian vault");
    }
    return result;
  });

  ipcMain.handle("dialog:openDirectory", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

app.whenReady().then(() => {
  loadStaticData();
  registerIpcHandlers();

  // Initialize default library
  const libPath = getDefaultLibraryPath();
  initEngine(libPath);

  createWindow();
});

app.on("window-all-closed", () => {
  // Flush pending git commits before quitting
  if (revisionStore) {
    revisionStore.flushCommit();
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
