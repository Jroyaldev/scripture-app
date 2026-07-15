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
    getInfo: () => ipcRenderer.invoke("get-library-info"),
    revealInFinder: () => ipcRenderer.invoke("reveal-in-finder"),
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
      charStart?: number | null,
      charEnd?: number | null,
    ) => ipcRenderer.invoke("create-highlight", {
      book, chapter, verseStart, verseEnd, color, package: packageId,
      charStart: charStart ?? null, charEnd: charEnd ?? null,
    }),
    eraseHighlightRange: (
      book: string,
      chapter: number,
      verseStart: number,
      verseEnd: number,
      packageId: string,
      charStart?: number | null,
      charEnd?: number | null,
    ) => ipcRenderer.invoke("erase-highlight-range", {
      book, chapter, verseStart, verseEnd, package: packageId,
      charStart: charStart ?? null, charEnd: charEnd ?? null,
    }),
    recolorHighlights: (book: string, chapter: number, packageId: string, entityIds: string[], color: string) =>
      ipcRenderer.invoke("recolor-highlights", { book, chapter, package: packageId, entityIds, color }),
    deleteHighlights: (book: string, chapter: number, packageId: string, entityIds: string[]) =>
      ipcRenderer.invoke("delete-highlights", { book, chapter, package: packageId, entityIds }),
    undoHighlightChange: (changeId: string) => ipcRenderer.invoke("undo-highlight-change", changeId),
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
    getCrossRefsForPassage: (
      book: string,
      chapter: number,
      startVerse: number,
      endVerse: number,
      packageId: string,
    ) => ipcRenderer.invoke("get-cross-refs-for-passage", {
      book, chapter, startVerse, endVerse, packageId,
    }),
  },
  language: {
    listPackages: () => ipcRenderer.invoke("language-list-packages"),
    loadPackage: (packageId: string) =>
      ipcRenderer.invoke("language-load-package", packageId),
    getVerseTokens: (packageId: string, book: string, chapter: number, verse: number) =>
      ipcRenderer.invoke("language-verse-tokens", { packageId, book, chapter, verse }),
    getToken: (packageId: string, tokenId: string) =>
      ipcRenderer.invoke("language-get-token", { packageId, tokenId }),
    getTokenCard: (packageId: string, tokenId: string, readingPackageId?: string) =>
      ipcRenderer.invoke("language-token-card", { packageId, tokenId, readingPackageId }),
    getEntitiesForRange: (book: string, chapter: number, startVerse: number, endVerse: number) =>
      ipcRenderer.invoke("language-entities-for-range", { book, chapter, startVerse, endVerse }),
    hasReverseIndex: (readingPackageId: string) =>
      ipcRenderer.invoke("language-has-reverse-index", readingPackageId),
    getLemmaInBook: (packageId: string, book: string, lemma: string) =>
      ipcRenderer.invoke("language-lemma-in-book", { packageId, book, lemma }),
    getVerseMarks: (packageId: string, book: string, chapter: number, verse: number) =>
      ipcRenderer.invoke("language-verse-marks", { packageId, book, chapter, verse }),
    getSyntaxForToken: (packageId: string, book: string, tokenId: string) =>
      ipcRenderer.invoke("language-syntax-for-token", { packageId, book, tokenId }),
  },
  ai: {
    embedNotes: () => ipcRenderer.invoke("embed-notes"),
    enrichNote: (noteId: string) => ipcRenderer.invoke("enrich-note", { noteId }),
    getEnrichment: (noteId: string) => ipcRenderer.invoke("get-enrichment", { noteId }),
    enrichmentFeedback: (opts: { noteId: string; refKey: string; action: "confirmed" | "dismissed"; refDisplay?: string }) =>
      ipcRenderer.invoke("enrichment-feedback", opts),
    unanchorRef: (opts: { noteId: string; refKey: string; refDisplay: string }) =>
      ipcRenderer.invoke("unanchor-note-ref", opts),
    semanticMargin: (opts: {
      book: string;
      startChapter: number;
      startVerse: number;
      endChapter: number;
      endVerse: number;
      passageText: string;
    }) => ipcRenderer.invoke("semantic-margin", opts),
    pinClaim: (claimId: string, assertion: string, userNote?: string) =>
      ipcRenderer.invoke("pin-claim", { claimId, assertion, userNote }),
    promoteOverlay: (opts: {
      overlayId: string;
      book: string;
      chapter: number;
      verseStart: number;
      verseEnd: number;
      color: string;
    }) => ipcRenderer.invoke("promote-overlay", opts),
    insertClaim: (opts: {
      id: string;
      assertion: string;
      claimType: string;
      confidence: number;
      extractor: string;
      anchors: { book: string; chapter: number; verse: number }[];
      sources: { kind: string; ref: string }[];
    }) => ipcRenderer.invoke("insert-claim", opts),
    insertOverlay: (opts: {
      id: string;
      book: string;
      chapter: number;
      verse: number;
      charStart: number;
      charEnd: number;
      reason: string;
      extractor: string;
    }) => ipcRenderer.invoke("insert-overlay", opts),
    getBudgetEnvelope: () => ipcRenderer.invoke("get-budget-envelope"),
    setBudgetEnvelope: (opts: {
      backgroundAI: string;
      networkBackground: boolean;
      dailyTokenCeiling?: number;
    }) => ipcRenderer.invoke("set-budget-envelope", opts),
    getJobs: () => ipcRenderer.invoke("get-ai-jobs"),
    getFacts: () => ipcRenderer.invoke("get-all-facts"),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog-open-directory"),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke("settings:set", partial),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronAPI = typeof api;
