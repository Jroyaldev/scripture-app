/**
 * Electron preload script — exposes typed IPC bridge to renderer.
 * contextIsolation: true, nodeIntegration: false.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { CanonicalRef } from "../core/reference/types.js";
import type { MarginQuery, MarginResult } from "../core/margin/types.js";

const api = {
  getLibraryInfo: () => ipcRenderer.invoke("get-library-info"),
  resolveReference: (input: string) => ipcRenderer.invoke("resolve-reference", input),
  formatBref: (ref: CanonicalRef) => ipcRenderer.invoke("format-bref", ref),
  formatDisplay: (ref: CanonicalRef) => ipcRenderer.invoke("format-display", ref),
  getMargin: (query: MarginQuery): Promise<MarginResult> => ipcRenderer.invoke("get-margin", query),
  searchNotes: (query: string) => ipcRenderer.invoke("search-notes", query),
  createNote: (opts: { title: string; body: string; anchorRef?: CanonicalRef; tags?: string[] }) =>
    ipcRenderer.invoke("create-note", opts),
  getAllNotes: () => ipcRenderer.invoke("get-all-notes"),
  getNote: (id: string) => ipcRenderer.invoke("get-note", id),
  getBackbone: () => ipcRenderer.invoke("get-backbone"),
  getBookNames: () => ipcRenderer.invoke("get-book-names"),
  importObsidianVault: (path: string) => ipcRenderer.invoke("import-obsidian-vault", path),
  readScriptureText: (opts: { book: string; chapter: number; package: string }) =>
    ipcRenderer.invoke("read-scripture-text", opts),
  createHighlight: (opts: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    color: string;
    package: string;
  }) => ipcRenderer.invoke("create-highlight", opts),
  rebuildSqlite: () => ipcRenderer.invoke("rebuild-sqlite"),
};

contextBridge.exposeInMainWorld("electronAPI", api);

export type ElectronAPI = typeof api;
