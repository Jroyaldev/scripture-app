/**
 * Living Margin types — platform-agnostic (INV-18).
 * Deterministic resurfacing: notes, highlights, cross-references for a passage.
 */

export type MarginItem =
  | MarginNote
  | MarginHighlight
  | MarginCrossRef
  | MarginBacklink
  | MarginSourceChunk;

export type MarginNote = {
  kind: "note";
  provenance: "user";
  noteId: string;
  title: string;
  snippet: string;
};

export type MarginHighlight = {
  kind: "highlight";
  provenance: "user";
  highlightId: string;
  color: string;
  verseStart: number;
  verseEnd: number;
};

export type MarginCrossRef = {
  kind: "cross-ref";
  provenance: "source";
  sourceId: string;
  sourceName: string;
  targetBref: string;
  targetDisplay: string;
};

export type MarginBacklink = {
  kind: "backlink";
  provenance: "user";
  noteId: string;
  title: string;
  snippet: string;
};

export type MarginSourceChunk = {
  kind: "source-chunk";
  provenance: "source";
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  snippet: string;
  locator: import("../indexer/types.js").PdfLocator;
};

export type MarginQuery = {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

export type MarginResult = {
  notes: MarginNote[];
  highlights: MarginHighlight[];
  crossRefs: MarginCrossRef[];
  backlinks: MarginBacklink[];
  sourceChunks: MarginSourceChunk[];
  semanticNotes?: import("../ai/types.js").SemanticNote[];
  threads?: import("../ai/types.js").Thread[];
  claims?: import("../ai/types.js").Claim[];
  overlays?: import("../ai/types.js").Overlay[];
  suggestedCrossRefs?: import("../ai/types.js").SuggestedCrossRef[];
};

export type CrossRefData = {
  meta: {
    id: string;
    name: string;
    source: string;
    license: string;
  };
  refs: Record<string, string[]>;
};
