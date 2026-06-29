/**
 * Electron preload script.
 * Exposes a safe contextBridge API to the renderer.
 * No direct Node access in the renderer (contextIsolation: true).
 */

import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Library
  library: {
    getPath: () => ipcRenderer.invoke("library:getPath"),
    init: (path: string) => ipcRenderer.invoke("library:init", path),
    rebuild: () => ipcRenderer.invoke("library:rebuild"),
    getSummary: () => ipcRenderer.invoke("library:getSummary"),
    readAllNotes: () => ipcRenderer.invoke("library:readAllNotes"),
    createNote: (title: string, body: string, opts?: { type?: string; tags?: string[] }) =>
      ipcRenderer.invoke("library:createNote", title, body, opts),
    queryVerse: (book: string, chapter: number, verse: number) =>
      ipcRenderer.invoke("library:queryVerse", book, chapter, verse),
    queryRange: (startBook: string, startCh: number, startV: number, endBook: string, endCh: number, endV: number) =>
      ipcRenderer.invoke("library:queryRange", startBook, startCh, startV, endBook, endCh, endV),
    createHighlight: (book: string, chapter: number, verseStart: number, verseEnd: number, color: string, packageId: string) =>
      ipcRenderer.invoke("library:createHighlight", book, chapter, verseStart, verseEnd, color, packageId),
    deleteHighlight: (entityId: string, baseEventId: string) =>
      ipcRenderer.invoke("library:deleteHighlight", entityId, baseEventId),
    search: (query: string) => ipcRenderer.invoke("library:search", query),
    doctor: () => ipcRenderer.invoke("library:doctor"),
    migrate: (dryRun: boolean) => ipcRenderer.invoke("library:migrate", dryRun),
    importVault: (vaultPath: string) => ipcRenderer.invoke("library:importVault", vaultPath),
  },

  // Reference engine
  ref: {
    resolve: (humanRef: string) => ipcRenderer.invoke("ref:resolve", humanRef),
    parseBref: (bref: string) => ipcRenderer.invoke("ref:parseBref", bref),
    toBref: (ref: unknown) => ipcRenderer.invoke("ref:toBref", ref),
    toDisplay: (ref: unknown) => ipcRenderer.invoke("ref:toDisplay", ref),
  },

  // Scripture
  scripture: {
    getBackbone: () => ipcRenderer.invoke("scripture:getBackbone"),
    getBookNames: () => ipcRenderer.invoke("scripture:getBookNames"),
    getChapterText: (packageId: string, book: string, chapter: number) =>
      ipcRenderer.invoke("scripture:getChapterText", packageId, book, chapter),
    getCrossRefs: (book: string, chapter: number, verse: number) =>
      ipcRenderer.invoke("scripture:getCrossRefs", book, chapter, verse),
  },

  // Dialog
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ScriptureAPI = typeof api;
