/**
 * Electron preload script — exposes typed IPC bridge to renderer.
 * contextIsolation: true, nodeIntegration: false.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { CanonicalRef } from "../core/reference/types.js";
import type { ParseResult } from "../core/reference/parser.js";
import type { ConnectionAnchorV2, ConnectionKind } from "../core/annotations/types.js";
import type { OccurrenceSelectionPiece } from "../core/annotations/occurrence-alignment.js";
import type { ConnectionPaintProjectionRequest } from "../renderer/utils/connectionPaint.js";
import type { TrustedResourceQuery } from "../core/resources/trusted-resources.js";

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
    updateNote: (id: string, title: string, body: string) =>
      ipcRenderer.invoke("update-note", { id, title, body }),
    deleteNote: (id: string) => ipcRenderer.invoke("delete-note", { id }),
    restoreNote: (filename: string, content: string) =>
      ipcRenderer.invoke("restore-note", { filename, content }),
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
    createConnection: (kind: ConnectionKind, label: string, observation: string, anchors: ConnectionAnchorV2[], commandId: string) =>
      ipcRenderer.invoke("create-connection", { kind, label, observation, anchors, commandId }),
    updateConnection: (connectionId: string, kind: ConnectionKind, label: string, observation: string, anchors: ConnectionAnchorV2[], commandId: string, expectedBaseEventId: string) =>
      ipcRenderer.invoke("update-connection", {
        connectionId,
        input: { kind, label, observation, anchors },
        commandId,
        expectedBaseEventId,
      }),
    deleteConnection: (connectionId: string, commandId: string, expectedBaseEventId: string) =>
      ipcRenderer.invoke("delete-connection", { connectionId, commandId, expectedBaseEventId }),
    captureConnectionSelection: (
      packageId: string,
      selections: readonly OccurrenceSelectionPiece[],
    ) => ipcRenderer.invoke("capture-connection-selection", { packageId, selections }),
    projectConnections: (packageId: string, connections: readonly ConnectionPaintProjectionRequest[]) =>
      ipcRenderer.invoke("project-connections", { packageId, connections }),
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
    search: (
      packageId: string,
      query: string,
      limit?: number,
      context?: { book?: string; chapter?: number },
    ) => ipcRenderer.invoke("search-scripture-text", {
      packageId,
      query,
      limit,
      currentBook: context?.book,
      currentChapter: context?.chapter,
    }),
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
  transcripts: {
    load: (recordId: string) => ipcRenderer.invoke("transcript-load", { recordId }),
  },
  references: {
    load: (recordId: string) => ipcRenderer.invoke("references-load", { recordId }),
  },
  passages: {
    moments: (book: string, chapter: number) => ipcRenderer.invoke("passage-moments", { book, chapter }),
  },
  trustedResources: {
    query: (query: TrustedResourceQuery) => ipcRenderer.invoke("trusted-resources-query", query),
    catalogue: () => ipcRenderer.invoke("trusted-resources-catalogue"),
    openOfficial: (sourceId: string, resourceId: string, url: string) =>
      ipcRenderer.invoke("trusted-resource-open", { sourceId, resourceId, url }),
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
    searchEntities: (query: string, limit?: number) =>
      ipcRenderer.invoke("language-search-entities", { query, limit }),
    getEntityResearch: (entityId: string) =>
      ipcRenderer.invoke("language-entity-research", entityId),
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
  system: {
    openExternalResearchUrl: (url: string) => ipcRenderer.invoke("open-external-research-url", url),
  },
  appWindow: {
    onCloseRequested: (listener: (request: { requestId: string; source: "window" | "quit" }) => void) => {
      const handler = (_event: unknown, request: unknown) => {
        if (!request || typeof request !== "object") return;
        const candidate = request as Record<string, unknown>;
        if (
          typeof candidate["requestId"] !== "string"
          || (candidate["source"] !== "window" && candidate["source"] !== "quit")
        ) return;
        listener({
          requestId: candidate["requestId"],
          source: candidate["source"],
        });
      };
      ipcRenderer.on("app-window-close-requested", handler);
      ipcRenderer.send("app-window-close-guard-ready");
      return () => ipcRenderer.removeListener("app-window-close-requested", handler);
    },
    requestClose: () => ipcRenderer.send("app-window-request-close"),
    resolveCloseRequest: (requestId: string, proceed: boolean) => {
      ipcRenderer.send("app-window-close-response", requestId, proceed);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke("settings:set", partial),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronAPI = typeof api;
