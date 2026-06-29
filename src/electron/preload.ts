/**
 * Electron preload script — exposes typed IPC bridge to renderer.
 * contextIsolation: true, nodeIntegration: false.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { CanonicalRef } from "../core/reference/types.js";
import type { ParseResult } from "../core/reference/parser.js";

async function toRendererRefResult(result: ParseResult<CanonicalRef>): Promise<{ ok: boolean; bref?: string; display?: string; error?: string }> {
  if (!result.ok) return result;
  const [bref, display] = await Promise.all([
    ipcRenderer.invoke("format-bref", result.value),
    ipcRenderer.invoke("format-display", result.value),
  ]);
  return { ok: true, bref, display };
}

const api = {
  library: {
    getPath: () => ipcRenderer.invoke("get-library-path"),
    init: (path: string) => ipcRenderer.invoke("init-library", path),
    rebuild: async () => {
      const hash = await ipcRenderer.invoke("rebuild-sqlite");
      return hash ? { ok: true, hash } : { ok: false, error: "Not initialized" };
    },
    getSummary: () => ipcRenderer.invoke("get-library-summary"),
    readAllNotes: () => ipcRenderer.invoke("read-all-notes"),
    createNote: (title: string, body: string, opts?: { type?: string; tags?: string[] }) =>
      ipcRenderer.invoke("create-note", { title, body, tags: opts?.tags }),
    queryVerse: (book: string, chapter: number, verse: number) =>
      ipcRenderer.invoke("query-verse", book, chapter, verse),
    queryRange: (
      startBook: string,
      startCh: number,
      startV: number,
      endBook: string,
      endCh: number,
      endV: number,
    ) => ipcRenderer.invoke("query-range", startBook, startCh, startV, endBook, endCh, endV),
    createHighlight: (
      book: string,
      chapter: number,
      verseStart: number,
      verseEnd: number,
      color: string,
      packageId: string,
    ) => ipcRenderer.invoke("create-highlight", { book, chapter, verseStart, verseEnd, color, package: packageId }),
    deleteHighlight: (entityId: string, baseEventId: string) =>
      ipcRenderer.invoke("delete-highlight", { entityId, baseEventId }),
    search: (query: string) => ipcRenderer.invoke("search-notes", query),
    importVault: async (vaultPath: string) => {
      const result = await ipcRenderer.invoke("import-obsidian-vault", vaultPath);
      return result?.stats ? { ok: true, ...result.stats } : result;
    },
  },
  ref: {
    resolve: async (humanRef: string) => toRendererRefResult(await ipcRenderer.invoke("resolve-reference", humanRef)),
    parseBref: async (bref: string) => toRendererRefResult(await ipcRenderer.invoke("resolve-reference", bref)),
    toBref: (ref: CanonicalRef) => ipcRenderer.invoke("format-bref", ref),
    toDisplay: (ref: CanonicalRef) => ipcRenderer.invoke("format-display", ref),
  },
  scripture: {
    getBackbone: () => ipcRenderer.invoke("get-backbone"),
    getBookNames: () => ipcRenderer.invoke("get-book-names"),
    getChapterText: (packageId: string, book: string, chapter: number) =>
      ipcRenderer.invoke("read-scripture-text", { book, chapter, package: packageId }),
    getCrossRefs: (book: string, chapter: number, verse: number) =>
      ipcRenderer.invoke("get-cross-refs", { book, chapter, verse }),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog-open-directory"),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronAPI = typeof api;
