/**
 * AI layer types — platform-agnostic (INV-18).
 * Claims, Overlays, Threads, and semantic resurfacing types.
 */

export type Claim = {
  id: string;
  assertion: string;
  claimType: string;
  confidence: number;
  extractor: string;
  created: string;
  status: "active" | "dismissed";
  anchors: ClaimAnchor[];
  sources: ClaimSource[];
};

export type ClaimAnchor = {
  book: string;
  chapter: number;
  verse: number;
};

export type ClaimSource = {
  kind: "note" | "source" | "scripture";
  ref: string;
};

export type Overlay = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  charStart: number;
  charEnd: number;
  reason: string;
  extractor: string;
};

export type Thread = {
  id: string;
  label: string;
  noteIds: string[];
  summary: string;
  extractor: string;
  created: string;
};

export type SemanticNote = {
  noteId: string;
  title: string;
  snippet: string;
  similarity: number;
};

export type SuggestedCrossRef = {
  targetBref: string;
  targetDisplay: string;
  reason: string;
  confidence: number;
};

export type AIJob = {
  id: string;
  kind: string;
  status: "pending" | "running" | "done" | "failed";
  created: string;
  finished: string | null;
  tokensUsed: number;
  error: string | null;
};
