/**
 * Semantic margin assembly — pure platform-agnostic (INV-18).
 * Extends the deterministic margin with AI-derived content:
 * semantic notes, threads, claims, and suggested cross-references.
 *
 * Task B3.5: retrieval goes through the hybrid decision layer in
 * retrieval.ts (chunked dense + BM25 + reference evidence, calibrated
 * quality bar, MMR) instead of a raw cosine threshold; threads are scoped
 * to the passage; suggested cross-refs are derived from what the surfaced
 * notes actually cite — never an echo of the queried range.
 */

import type { BookNameMap } from "../reference/types.js";
import type { MarginQuery, MarginResult } from "../margin/types.js";
import type { SemanticNote, Thread, Claim, SuggestedCrossRef, Overlay } from "./types.js";
import type { EmbeddingRow } from "./similarity.js";
import {
  DEFAULT_RETRIEVAL_OPTIONS,
  chunkNoteBody,
  computeInferredHits,
  computeReferenceHits,
  computeThemeHits,
  extractKeywords,
  selectRelatedNotes,
  type AnchorRange,
  type InferredRefLike,
  type RetrievalOptions,
  type VersePoint,
} from "./retrieval.js";

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

export type ClaimSourceRow = {
  kind: string;
  ref: string;
  quote?: string | null;
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
  queryNoteById(id: string): NoteRow | undefined;
  /** Note ids ranked by BM25 for the given keywords (best first). */
  searchNotesLexical(keywords: string[]): string[];
  /** Anchors that touch a single verse (reference-evidence lookup). */
  queryAnchorsAtVerse(book: string, chapter: number, verse: number): { srcKind: string; srcId: string }[];
  /** All anchors within the queried chapter(s) (proximity evidence). */
  queryChapterAnchors(book: string, startCh: number, endCh: number): AnchorRange[];
  /** All anchors belonging to one note (drives suggested cross-refs). */
  queryAnchorsForNote(noteId: string): AnchorRange[];
  queryClaimsForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): ClaimRow[];
  queryClaimAnchors(claimId: string): ClaimAnchorRow[];
  queryClaimSources(claimId: string): ClaimSourceRow[];
  queryOverlaysForRange(book: string, startCh: number, startV: number, endCh: number, endV: number): OverlayRow[];
  getAllThreads(): Thread[];
  /** Capture-time note enrichments (B3.6 E3); empty array when none exist. */
  getAllEnrichments(): { noteId: string; inferredRefs: InferredRefLike[]; themes: string[] }[];
  /** `${noteId}|${refKey}` entries the user dismissed (sticky, A-1). */
  getDismissedRefKeys(): Set<string>;
  /** Theme vocabulary labels for evidence display (id → label). */
  getThemeLabels(): Map<string, string>;
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
 * Requires a query embedding (from the active passage text), the passage
 * text itself (for lexical candidates), the passage's public-domain
 * cross-reference targets (for reference evidence), and injected data access.
 */
export function assembleSemanticMargin(
  query: MarginQuery,
  queryEmbedding: Float32Array,
  passageText: string,
  crossRefTargets: VersePoint[],
  dataAccess: SemanticDataAccess,
  alreadySurfacedNoteIds: Set<string>,
  bookNames: BookNameMap,
  retrievalOptions?: Partial<RetrievalOptions>,
): Pick<SemanticMarginResult, "semanticNotes" | "threads" | "claims" | "overlays" | "suggestedCrossRefs"> {
  // 1. Related notes through the hybrid decision layer.
  const keywords = extractKeywords(passageText);
  const lexicalRankedNoteIds = keywords.length > 0 ? dataAccess.searchNotesLexical(keywords) : [];

  const referenceHits = computeReferenceHits({
    query,
    crossRefTargets,
    queryAnchorsAtVerse: (b, c, v) => dataAccess.queryAnchorsAtVerse(b, c, v),
    chapterAnchors: dataAccess.queryChapterAnchors(query.book, query.startChapter, query.endChapter),
    excludeNoteIds: alreadySurfacedNoteIds,
    bookNames,
  });

  // AI-inferred reference evidence (clearly labeled; dismissals are sticky).
  const enrichments = dataAccess.getAllEnrichments();
  referenceHits.push(
    ...computeInferredHits({
      query,
      enrichments,
      crossRefTargets,
      dismissedKeys: dataAccess.getDismissedRefKeys(),
      excludeNoteIds: alreadySurfacedNoteIds,
      bookNames,
    }),
  );

  // Theme evidence: passage's top themes (query embedding vs theme-gloss
  // vectors, fully local) ∩ each note's enrichment themes.
  const themeLabels = dataAccess.getThemeLabels();
  const themeVectors = dataAccess
    .getAllEmbeddings()
    .filter((e) => e.srcKind === "theme")
    .map((e) => ({ id: e.srcId, label: themeLabels.get(e.srcId) ?? e.srcId, vector: e.vector }));
  referenceHits.push(
    ...computeThemeHits({
      queryEmbedding,
      themeVectors,
      noteThemes: enrichments.map((e) => ({ noteId: e.noteId, themes: e.themes })),
      excludeNoteIds: alreadySurfacedNoteIds,
      topK: retrievalOptions?.themeTopK ?? DEFAULT_RETRIEVAL_OPTIONS.themeTopK,
    }),
  );

  const chunkTextCache = new Map<string, string[]>();
  const getChunkText = (noteId: string, index: number): string | undefined => {
    let chunks = chunkTextCache.get(noteId);
    if (!chunks) {
      const note = dataAccess.queryNoteById(noteId);
      chunks = note ? chunkNoteBody(note.body_text).map((c) => c.text) : [];
      chunkTextCache.set(noteId, chunks);
    }
    return chunks[index];
  };

  const semanticNotes = selectRelatedNotes({
    queryEmbedding,
    embeddings: dataAccess.getAllEmbeddings(),
    excludeNoteIds: alreadySurfacedNoteIds,
    lexicalRankedNoteIds,
    referenceHits,
    getChunkText,
    options: retrievalOptions,
  });

  for (const sn of semanticNotes) {
    const note = dataAccess.queryNoteById(sn.noteId);
    if (note) {
      sn.title = note.title;
      if (sn.snippet.length === 0) sn.snippet = truncateSnippet(note.body_text, 160);
    }
  }

  // 2. Threads — only those involving notes visible for this passage.
  const passageNoteIds = new Set<string>([
    ...alreadySurfacedNoteIds,
    ...semanticNotes.map((n) => n.noteId),
  ]);
  const threads = dataAccess
    .getAllThreads()
    .filter((t) => t.noteIds.some((id) => passageNoteIds.has(id)));

  // 3. Claims anchored to this range.
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
    sources: dataAccess.queryClaimSources(row.id).map((s) => ({
      kind: s.kind as "note" | "source" | "scripture",
      ref: s.ref,
      ...(s.quote ? { quote: s.quote } : {}),
    })),
  }));

  // 4. Overlays on this range.
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

  // 5. Suggested cross-references: verses the surfaced related notes cite
  //    that are NOT already covered by the passage or its public-domain
  //    cross-reference list. Deterministic and non-circular by construction.
  const suggestedCrossRefs = deriveSuggestedCrossRefs(
    query,
    crossRefTargets,
    semanticNotes,
    dataAccess,
    bookNames,
  );

  return { semanticNotes, threads, claims, overlays, suggestedCrossRefs };
}

function deriveSuggestedCrossRefs(
  query: MarginQuery,
  crossRefTargets: VersePoint[],
  semanticNotes: SemanticNote[],
  dataAccess: SemanticDataAccess,
  bookNames: BookNameMap,
): SuggestedCrossRef[] {
  const known = new Set(crossRefTargets.map((t) => `${t.book}.${t.chapter}.${t.verse}`));
  const results: SuggestedCrossRef[] = [];
  const seen = new Set<string>();

  for (const sn of semanticNotes) {
    for (const anchor of dataAccess.queryAnchorsForNote(sn.noteId)) {
      const key = `${anchor.book}.${anchor.startCh}.${anchor.startV}`;
      if (seen.has(key) || known.has(key)) continue;
      // Never suggest the passage back to itself.
      if (
        anchor.book === query.book &&
        anchor.startCh >= query.startChapter &&
        anchor.startCh <= query.endChapter
      ) {
        continue;
      }
      seen.add(key);
      const bookName = bookNames[anchor.book]?.[0] ?? anchor.book;
      results.push({
        targetBref: `bref:v1/${anchor.book}.${anchor.startCh}.${anchor.startV}`,
        targetDisplay: `${bookName} ${anchor.startCh}:${anchor.startV}`,
        reason: `Cited in your note "${sn.title}"`,
        confidence: sn.similarity,
      });
      if (results.length >= 10) return results;
    }
  }
  return results;
}

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
