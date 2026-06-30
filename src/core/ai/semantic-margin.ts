/**
 * Semantic margin assembly — pure platform-agnostic (INV-18).
 * Extends the deterministic margin with AI-derived content:
 * semantic notes, threads, claims, and AI-suggested cross-references.
 */

import type { BookNameMap } from "../reference/types.js";
import type { MarginQuery, MarginResult } from "../margin/types.js";
import type { SemanticNote, Thread, Claim, SuggestedCrossRef, Overlay } from "./types.js";
import type { EmbeddingRow } from "./similarity.js";
import { findRelatedNotes } from "./similarity.js";

export type ClaimRow = {
  id: string;
  assertion: string;
  claim_type: string;
  confidence: number;
  extractor: string;
  created: string;
  status: string;
};

export type ClaimAnchorRow = {
  claim_id: string;
  book: string;
  chapter: number;
  verse: number;
};

export type OverlayRow = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  char_start: number;
  char_end: number;
  reason: string;
  extractor: string;
};

export type NoteRow = {
  id: string;
  title: string;
  body_text: string;
};

export interface SemanticDataAccess {
  getAllEmbeddings(): EmbeddingRow[];
  getEmbedding(srcKind: string, srcId: string): EmbeddingRow | undefined;
  queryNoteById(id: string): NoteRow | undefined;
  queryClaimsForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): ClaimRow[];
  queryClaimAnchors(claimId: string): ClaimAnchorRow[];
  queryOverlaysForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): OverlayRow[];
  getAllThreads(): Thread[];
}

export type SemanticMarginResult = MarginResult & {
  semanticNotes: SemanticNote[];
  threads: Thread[];
  claims: Claim[];
  overlays: Overlay[];
  suggestedCrossRefs: SuggestedCrossRef[];
};

/**
 * Assemble the semantic layer of the Living Margin.
 * Requires a query embedding (from the active passage text) and injected data access.
 */
export function assembleSemanticMargin(
  query: MarginQuery,
  queryEmbedding: Float32Array,
  dataAccess: SemanticDataAccess,
  alreadySurfacedNoteIds: Set<string>,
  _bookNames: BookNameMap,
): Pick<SemanticMarginResult, "semanticNotes" | "threads" | "claims" | "overlays" | "suggestedCrossRefs"> {
  // 1. Semantic resurfacing: find notes related by embedding similarity
  const allEmbeddings = dataAccess.getAllEmbeddings();
  const semanticNotes = findRelatedNotes(
    queryEmbedding,
    allEmbeddings,
    alreadySurfacedNoteIds,
    0.3,
    5,
  );

  // Fill in titles and snippets from the database
  for (const sn of semanticNotes) {
    const note = dataAccess.queryNoteById(sn.noteId);
    if (note) {
      sn.title = note.title;
      sn.snippet = truncateSnippet(note.body_text, 120);
    }
  }

  // 2. Threads
  const threads = dataAccess.getAllThreads();

  // 3. Claims anchored to this range
  const claimRows = dataAccess.queryClaimsForRange(
    query.book,
    query.startChapter,
    query.startVerse,
    query.endChapter,
    query.endVerse,
  );

  const claims: Claim[] = claimRows.map((row) => ({
    id: row.id,
    assertion: row.assertion,
    claimType: row.claim_type,
    confidence: row.confidence,
    extractor: row.extractor,
    created: row.created,
    status: row.status as "active" | "dismissed",
    anchors: dataAccess.queryClaimAnchors(row.id).map((a) => ({
      book: a.book,
      chapter: a.chapter,
      verse: a.verse,
    })),
    sources: [],
  }));

  // 4. Overlays on this range
  const overlayRows = dataAccess.queryOverlaysForRange(
    query.book,
    query.startChapter,
    query.startVerse,
    query.endChapter,
    query.endVerse,
  );

  const overlays: Overlay[] = overlayRows.map((row) => ({
    id: row.id,
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    charStart: row.char_start,
    charEnd: row.char_end,
    reason: row.reason,
    extractor: row.extractor,
  }));

  // 5. Suggested cross-references (AI) — derived from claims and threads
  const suggestedCrossRefs: SuggestedCrossRef[] = [];
  for (const claim of claims) {
    for (const anchor of claim.anchors) {
      const bref = `bref:v1/${anchor.book}.${anchor.chapter}.${anchor.verse}`;
      suggestedCrossRefs.push({
        targetBref: bref,
        targetDisplay: `${anchor.book} ${anchor.chapter}:${anchor.verse}`,
        reason: `Related claim: ${claim.assertion.slice(0, 60)}`,
        confidence: claim.confidence,
      });
    }
  }

  return { semanticNotes, threads, claims, overlays, suggestedCrossRefs };
}

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
