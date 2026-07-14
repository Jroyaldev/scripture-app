/**
 * Semantic-margin host runner — Node host layer (Task B3.5).
 * One shared implementation of "assemble the AI layer of the Living Margin
 * for this passage", used by the Electron `semantic-margin` IPC handler,
 * the eval harness (eval-margin.ts), and smoke scripts — so what ships,
 * what is evaluated, and what is smoked are the same code path.
 */

import type { EmbeddingProvider } from "../core/interfaces.js";
import type { BookNameMap } from "../core/reference/types.js";
import { parseBref } from "../core/reference/parser.js";
import { assembleMargin, type CrossRefData } from "../core/margin/index.js";
import {
  assembleSemanticMargin,
  type SemanticMarginResult,
} from "../core/ai/semantic-margin.js";
import type { RetrievalOptions, VersePoint } from "../core/ai/retrieval.js";
import type { SQLiteMaterializer } from "./sqlite.js";
import type { EmbeddingsStore } from "./embeddings-store.js";
import { sweepStaleClaims } from "./claims-sync.js";

export type SemanticMarginRequest = {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  passageText: string;
};

/**
 * Passage text cap for the query embedding: attention cost grows
 * quadratically and a full chapter (~1600 tokens) is minutes on CPU;
 * ~1500 chars (~375 tokens) keeps interactive latency bounded.
 */
export const QUERY_TEXT_CAP = 1500;

export async function runSemanticMargin(deps: {
  db: SQLiteMaterializer;
  embeddingsStore: EmbeddingsStore;
  provider: EmbeddingProvider;
  crossRefData: CrossRefData | null;
  bookNames: BookNameMap;
  request: SemanticMarginRequest;
  /** Theme vocabulary (labels for theme-evidence display). */
  themes?: { id: string; label: string; gloss: string }[];
  retrievalOptions?: Partial<RetrievalOptions>;
}): Promise<Pick<SemanticMarginResult, "semanticNotes" | "threads" | "claims" | "overlays" | "suggestedCrossRefs">> {
  const { db, embeddingsStore, provider, crossRefData, bookNames, request } = deps;

  // Query embedding (asymmetric "query" role). If the local model is
  // unavailable (e.g. first-run download failed), degrade to a zero vector:
  // dense admission goes empty but reference/lexical evidence still works.
  let queryEmbedding: Float32Array;
  try {
    const vecs = await provider.embed([request.passageText.slice(0, QUERY_TEXT_CAP)], "query");
    queryEmbedding = vecs[0] ?? new Float32Array(provider.dim);
  } catch (err) {
    console.error("semantic-margin: query embedding failed:", err);
    queryEmbedding = new Float32Array(provider.dim);
  }

  const query = {
    book: request.book,
    startChapter: request.startChapter,
    startVerse: request.startVerse,
    endChapter: request.endChapter,
    endVerse: request.endVerse,
  };

  // Deterministic margin first: which notes are already surfaced, and what
  // are the passage's public-domain cross-reference targets.
  const detMargin = assembleMargin(query, db, crossRefData, bookNames);
  const alreadySurfaced = new Set(detMargin.notes.map((n) => n.noteId));

  const crossRefTargets: VersePoint[] = [];
  for (const xref of detMargin.crossRefs) {
    const parsed = parseBref(xref.targetBref);
    if (parsed.ok) {
      crossRefTargets.push({
        book: parsed.value.start.book,
        chapter: parsed.value.start.chapter,
        verse: parsed.value.start.verse,
      });
    }
  }

  const allEmbeddings = embeddingsStore.getAllEmbeddings(provider.modelId);

  // B-1: never show a claim whose source note was edited or deleted since
  // extraction (claims live in the persistent AI-derived store and survive
  // library.sqlite rebuilds — this sweep is their precise invalidation).
  sweepStaleClaims(embeddingsStore, (id) => {
    const n = db.queryNoteById(id);
    return n ? { title: n.title, body_text: n.body_text } : undefined;
  });

  return assembleSemanticMargin(
    query,
    queryEmbedding,
    request.passageText,
    crossRefTargets,
    {
      getAllEmbeddings: () => allEmbeddings,
      queryNoteById: (id) => {
        const n = db.queryNoteById(id);
        return n ? { id: n.id, title: n.title, body_text: n.body_text } : undefined;
      },
      searchNotesLexical: (keywords) => {
        if (keywords.length === 0) return [];
        // Keywords are lowercase [a-z]{3,} tokens (extractKeywords), safe
        // to join into an FTS5 OR-query without further escaping.
        return db.searchNotes(keywords.join(" OR "), 20).map((n) => n.id);
      },
      queryAnchorsAtVerse: (book, chapter, verse) =>
        db.queryAnchorsForRange(book, chapter, verse, chapter, verse).map((a) => ({
          srcKind: a.src_kind,
          srcId: a.src_id,
        })),
      queryChapterAnchors: (book, startCh, endCh) =>
        db.queryAnchorsForRange(book, startCh, 1, endCh, 999).map((a) => ({
          srcKind: a.src_kind,
          srcId: a.src_id,
          book: a.book,
          startCh: a.start_ch,
          startV: a.start_v,
          endCh: a.end_ch,
          endV: a.end_v,
        })),
      queryAnchorsForNote: (noteId) =>
        db.queryAnchorsBySrcId(noteId).map((a) => ({
          srcKind: a.src_kind,
          srcId: a.src_id,
          book: a.book,
          startCh: a.start_ch,
          startV: a.start_v,
          endCh: a.end_ch,
          endV: a.end_v,
        })),
      queryClaimsForRange: (b, sc, sv, ec, ev) => embeddingsStore.queryClaimsForRange(b, sc, sv, ec, ev),
      queryClaimAnchors: (cid) => embeddingsStore.queryClaimAnchors(cid),
      queryClaimSources: (cid) =>
        embeddingsStore.queryClaimSources(cid).map((s) => ({ kind: s.kind, ref: s.ref, quote: s.quote })),
      queryOverlaysForRange: (b, sc, sv, ec, ev) => db.queryOverlaysForRange(b, sc, sv, ec, ev),
      getAllThreads: () => embeddingsStore.getAllThreads(),
      getAllEnrichments: () =>
        embeddingsStore
          .getAllEnrichments()
          .filter((e) => !e.noScriptureIntent)
          .map((e) => ({ noteId: e.noteId, inferredRefs: e.inferredRefs, themes: e.themes })),
      getThemeLabels: () => new Map((deps.themes ?? []).map((t) => [t.id, t.label])),
      getDismissedRefKeys: () =>
        new Set(
          embeddingsStore
            .getAllEnrichmentFeedback()
            .filter((f) => f.action === "dismissed")
            .map((f) => `${f.noteId}|${f.refKey}`),
        ),
    },
    alreadySurfaced,
    bookNames,
    deps.retrievalOptions,
  );
}
