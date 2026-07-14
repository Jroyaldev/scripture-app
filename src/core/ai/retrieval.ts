/**
 * Semantic margin retrieval — pure platform-agnostic (INV-18).
 * Task B3.5: the decision layer that separates signal from noise.
 *
 * Pipeline (SOTA-grounded, see tasks/B3.5-margin-retrieval-quality.md):
 *   paragraph chunking → hybrid candidates (dense + BM25 + reference signal)
 *   → RRF fusion (k=60) → calibrated floor + score-gap admission
 *   → MMR diversity → at most N results, possibly zero.
 *
 * "Show nothing rather than something mediocre" is the core mechanic:
 * EmbeddingGemma's cosine floor for UNRELATED text is ~0.5 (measured
 * 2026-07-02, scripts/audit-similarity.ts), so admission requires either a
 * calibrated dense score or deterministic reference evidence — never
 * "top-5 of whatever exists".
 */

import type { BookNameMap } from "../reference/types.js";
import type { MarginQuery } from "../margin/types.js";
import type { SemanticNote, SemanticNoteReason } from "./types.js";
import { cosineSimilarity, type EmbeddingRow } from "./similarity.js";

// --- Paragraph chunking (deterministic) ---

export type NoteChunk = { index: number; text: string };

export const CHUNK_MAX_CHARS = 1200; // ~300 tokens, inside EmbeddingGemma's window
export const CHUNK_MIN_CHARS = 200; // fragments below this merge forward

/**
 * Split a note body into deterministic paragraph chunks.
 * Blank-line-separated paragraphs are greedily packed up to CHUNK_MAX_CHARS;
 * oversized paragraphs split on sentence boundaries. Same input, same chunks,
 * always — chunk identity (`noteId#index`) must be stable for incremental
 * re-embedding (INV-2 spirit: derived, regenerable).
 */
export function chunkNoteBody(body: string): NoteChunk[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= CHUNK_MAX_CHARS) {
      pieces.push(para);
      continue;
    }
    // Oversized paragraph: split on sentence boundaries, hard-wrap as last resort.
    let current = "";
    for (const sentence of para.split(/(?<=[.!?])\s+/)) {
      if (current.length > 0 && current.length + sentence.length + 1 > CHUNK_MAX_CHARS) {
        pieces.push(current);
        current = sentence;
      } else {
        current = current.length > 0 ? `${current} ${sentence}` : sentence;
      }
      while (current.length > CHUNK_MAX_CHARS) {
        pieces.push(current.slice(0, CHUNK_MAX_CHARS));
        current = current.slice(CHUNK_MAX_CHARS);
      }
    }
    if (current.length > 0) pieces.push(current);
  }

  // Merge only tiny fragments forward — substantial paragraphs stay separate
  // chunks (paragraph-level precision is the point; packing everything that
  // fits under the max would recreate the whole-note dilution problem).
  const merged: string[] = [];
  let acc = "";
  for (const piece of pieces) {
    if (acc.length === 0) {
      acc = piece;
    } else if (acc.length < CHUNK_MIN_CHARS && acc.length + piece.length + 2 <= CHUNK_MAX_CHARS) {
      acc = `${acc}\n\n${piece}`;
    } else {
      merged.push(acc);
      acc = piece;
    }
  }
  if (acc.length > 0) {
    // A tiny trailing chunk merges back into its predecessor when possible.
    const prev = merged[merged.length - 1];
    if (acc.length < CHUNK_MIN_CHARS && prev !== undefined && prev.length + acc.length + 2 <= CHUNK_MAX_CHARS * 1.2) {
      merged[merged.length - 1] = `${prev}\n\n${acc}`;
    } else {
      merged.push(acc);
    }
  }

  return merged.map((text, index) => ({ index, text }));
}

/** The text actually embedded for a chunk: title gives every chunk its note context. */
export function composeChunkEmbedText(title: string, chunkText: string): string {
  return title.length > 0 ? `${title}\n${chunkText}` : chunkText;
}

/** Chunk src_id convention: `${noteId}#${index}`. */
export function chunkSrcId(noteId: string, index: number): string {
  return `${noteId}#${index}`;
}

/**
 * Reserved chunk index for the AI-derived enrichment expansion (B3.6 E3).
 * Expansion chunks participate in dense retrieval (they close the idiom gap
 * for quick notes) but are AI text — snippets and reasons must stay honest
 * about that, so the index is recognizable.
 */
export const EXPANSION_CHUNK_INDEX = 9999;

export function parseChunkSrcId(srcId: string): { noteId: string; index: number } | null {
  const hash = srcId.lastIndexOf("#");
  if (hash <= 0) return null;
  const index = Number(srcId.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { noteId: srcId.slice(0, hash), index };
}

// --- Lexical keyword extraction (for FTS5/BM25 candidates) ---

const STOPWORDS = new Set(
  (
    "the and for that with this from they them their there was were are is be been being not but had has have him his her she " +
    "you your our out who whom when what which will would can could shall should all any into upon also more most very much " +
    "then than these those such some other same own about after before again against because between both down during each " +
    "few further here how off over under until while himself herself itself themselves myself yourself did does doing done " +
    "unto thee thou thy thine hath thereof wherefore whosoever saith yea nay let say said says one two now come came went " +
    "may might must many made make man men day days way where whether even ever every"
  ).split(/\s+/),
);

/**
 * Extract distinctive keywords from passage text for a BM25 OR-query.
 * Deterministic: frequency-ranked, alphabetical tie-break.
 */
export function extractKeywords(text: string, max = 24): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([word]) => word);
}

// --- Reciprocal Rank Fusion ---

export const RRF_K = 60;

/**
 * Fuse multiple ranked id lists into a single score map.
 * score(id) = Σ over lists: 1 / (k + rank), rank 1-based. Rank-only fusion
 * sidesteps incomparable score scales (cosine vs BM25 vs reference counts).
 */
export function rrfFuse(lists: readonly (readonly string[])[], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const [i, id] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return scores;
}

// --- Scripture-reference signal (the domain's strongest relevance evidence) ---

export type VersePoint = { book: string; chapter: number; verse: number };

export type ReferenceHit = {
  noteId: string;
  /** Deterministic, user-verifiable label, e.g. `Cites Acts 8:17 — a cross-reference of this passage`. */
  label: string;
  /**
   * Evidence strength classes: crossref/chapter/inferred admit outright;
   * "theme" is corroborating only (requires dense ≥ themeFloor — a shared
   * theme plus a merely-random embedding would admit noise).
   */
  kind: "crossref" | "chapter" | "inferred" | "theme";
};

export type AnchorRange = {
  srcKind: string;
  srcId: string;
  book: string;
  startCh: number;
  startV: number;
  endCh: number;
  endV: number;
};

function displayVerse(v: VersePoint, bookNames: BookNameMap): string {
  const name = bookNames[v.book]?.[0] ?? v.book;
  return `${name} ${v.chapter}:${v.verse}`;
}

/**
 * Compute deterministic reference evidence for candidate notes:
 *  - "crossref": the note is anchored to a verse that is a public-domain
 *    (TSK) cross-reference target of the queried passage;
 *  - "chapter": the note is anchored elsewhere in the queried chapter(s)
 *    (only meaningful for sub-chapter queries — chapter-wide queries have
 *    already surfaced those notes deterministically).
 */
export function computeReferenceHits(args: {
  query: MarginQuery;
  crossRefTargets: VersePoint[];
  queryAnchorsAtVerse: (book: string, chapter: number, verse: number) => { srcKind: string; srcId: string }[];
  chapterAnchors: AnchorRange[];
  excludeNoteIds: Set<string>;
  bookNames: BookNameMap;
}): ReferenceHit[] {
  const { query, crossRefTargets, queryAnchorsAtVerse, chapterAnchors, excludeNoteIds, bookNames } = args;
  const hits: ReferenceHit[] = [];
  const seen = new Set<string>(); // `${noteId}|${label}` dedupe

  for (const target of crossRefTargets) {
    for (const anchor of queryAnchorsAtVerse(target.book, target.chapter, target.verse)) {
      if (anchor.srcKind !== "note" || excludeNoteIds.has(anchor.srcId)) continue;
      const label = `Cites ${displayVerse(target, bookNames)} — a cross-reference of this passage`;
      const key = `${anchor.srcId}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ noteId: anchor.srcId, label, kind: "crossref" });
    }
  }

  for (const anchor of chapterAnchors) {
    if (anchor.srcKind !== "note" || excludeNoteIds.has(anchor.srcId)) continue;
    if (anchor.book !== query.book) continue;
    // Skip anchors overlapping the queried range itself — those notes are
    // (or should be) in the deterministic margin already.
    const overlapsQuery =
      !(anchor.endCh < query.startChapter || (anchor.endCh === query.startChapter && anchor.endV < query.startVerse)) &&
      !(anchor.startCh > query.endChapter || (anchor.startCh === query.endChapter && anchor.startV > query.endVerse));
    if (overlapsQuery) continue;
    const point: VersePoint = { book: anchor.book, chapter: anchor.startCh, verse: anchor.startV };
    const label = `Notes on ${displayVerse(point, bookNames)}, in this chapter`;
    const key = `${anchor.srcId}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ noteId: anchor.srcId, label, kind: "chapter" });
  }

  return hits;
}

export type InferredRefLike = {
  book: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
};

/** Stable identity for feedback keys — must mirror inferredRefKey in note-enrichment. */
function inferredKey(r: InferredRefLike): string {
  return r.verseStart !== undefined
    ? `${r.book}.${r.chapter}.${r.verseStart}-${r.verseEnd ?? r.verseStart}`
    : `${r.book}.${r.chapter}`;
}

/**
 * AI-inferred reference evidence (B3.6 E3): a note's enrichment says it is
 * probably about a passage overlapping the queried range. Clearly labeled as
 * inferred; dismissed suggestions never fire again (A-1, keyed on note+ref).
 */
export function computeInferredHits(args: {
  query: MarginQuery;
  enrichments: { noteId: string; inferredRefs: InferredRefLike[] }[];
  /** TSK cross-reference targets of the queried passage (same bridge user anchors get). */
  crossRefTargets: VersePoint[];
  /** `${noteId}|${refKey}` entries the user dismissed. */
  dismissedKeys: Set<string>;
  excludeNoteIds: Set<string>;
  bookNames: BookNameMap;
}): ReferenceHit[] {
  const { query, enrichments, crossRefTargets, dismissedKeys, excludeNoteIds, bookNames } = args;
  const hits: ReferenceHit[] = [];

  const display = (ref: InferredRefLike): string => {
    const name = bookNames[ref.book]?.[0] ?? ref.book;
    return ref.verseStart !== undefined
      ? `${name} ${ref.chapter}:${ref.verseStart}${ref.verseEnd && ref.verseEnd !== ref.verseStart ? `–${ref.verseEnd}` : ""}`
      : `${name} ${ref.chapter}`;
  };
  const covers = (ref: InferredRefLike, v: VersePoint): boolean => {
    if (ref.book !== v.book || ref.chapter !== v.chapter) return false;
    if (ref.verseStart === undefined) return true; // whole chapter
    return v.verse >= ref.verseStart && v.verse <= (ref.verseEnd ?? ref.verseStart);
  };

  for (const e of enrichments) {
    if (excludeNoteIds.has(e.noteId)) continue;
    for (const ref of e.inferredRefs) {
      if (dismissedKeys.has(`${e.noteId}|${inferredKey(ref)}`)) continue;

      // Direct overlap with the queried range.
      const refStart = ref.verseStart ?? 1;
      const refEnd = ref.verseEnd ?? ref.verseStart ?? Number.MAX_SAFE_INTEGER;
      const overlaps =
        ref.book === query.book &&
        ref.chapter >= query.startChapter &&
        ref.chapter <= query.endChapter &&
        !(ref.chapter === query.startChapter && refEnd < query.startVerse) &&
        !(ref.chapter === query.endChapter && refStart > query.endVerse);
      if (overlaps) {
        hits.push({ noteId: e.noteId, label: `Possibly about ${display(ref)} (AI-inferred)`, kind: "inferred" });
        break;
      }

      // Bridge through the passage's public-domain cross-references — the
      // same evidence rule user-typed anchors get (crossref hits).
      const bridged = crossRefTargets.find((t) => covers(ref, t));
      if (bridged) {
        hits.push({
          noteId: e.noteId,
          label: `Possibly about ${display(ref)} — a cross-reference of this passage (AI-inferred)`,
          kind: "inferred",
        });
        break;
      }
    }
  }
  return hits;
}

/**
 * Theme evidence (B3.6 E3, fully local): the passage's query embedding is
 * ranked against the ~120 theme-gloss embeddings; notes whose enrichment
 * themes intersect the passage's top themes get a corroborating hit
 * ("Shared theme: Waiting on God"). This is the channel that connects
 * "Waiting on God isn't wasted" to Psalm 13 — no refs, no shared wording,
 * pure theme identity. Corroborating only (see ReferenceHit.kind).
 */
export function computeThemeHits(args: {
  queryEmbedding: Float32Array;
  themeVectors: { id: string; label: string; vector: Float32Array }[];
  noteThemes: { noteId: string; themes: string[] }[];
  excludeNoteIds: Set<string>;
  topK: number;
}): ReferenceHit[] {
  const { queryEmbedding, themeVectors, noteThemes, excludeNoteIds, topK } = args;
  if (themeVectors.length === 0) return [];
  const ranked = themeVectors
    .map((t) => ({ ...t, sim: cosineSimilarity(queryEmbedding, t.vector) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK);
  const topIds = new Map(ranked.map((t) => [t.id, t.label]));

  const hits: ReferenceHit[] = [];
  for (const n of noteThemes) {
    if (excludeNoteIds.has(n.noteId)) continue;
    const shared = n.themes.find((t) => topIds.has(t));
    if (shared) {
      hits.push({ noteId: n.noteId, label: `Shared theme: ${topIds.get(shared)}`, kind: "theme" });
    }
  }
  return hits;
}

// --- MMR diversity ---

/**
 * Maximal Marginal Relevance ordering: greedily pick the item maximizing
 * λ·relevance − (1−λ)·max-similarity-to-already-picked. Prevents the margin
 * being five near-duplicates of one idea.
 */
export function mmrSelect<T>(
  items: T[],
  getVector: (item: T) => Float32Array,
  getRelevance: (item: T) => number,
  lambda: number,
  limit: number,
): T[] {
  const remaining = [...items];
  const picked: T[] = [];
  while (picked.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (const [i, item] of remaining.entries()) {
      let maxSim = 0;
      for (const p of picked) {
        const sim = cosineSimilarity(getVector(item), getVector(p));
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * getRelevance(item) - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return picked;
}

// --- Decision layer ---

export type RetrievalOptions = {
  /**
   * Calibrated dense admission floor. Measured on EmbeddingGemma-300m
   * (2026-07-02): unrelated passage↔note cosine tops out ~0.65; genuinely
   * related content starts ~0.66. Recalibrate via scripts/calibrate-margin.ts
   * when the model changes.
   */
  denseFloor: number;
  /** Softer floor for notes that ALSO rank in the lexical top-5 (independent evidence). */
  softFloor: number;
  /** Floor for theme-corroborated admits (shared top theme + this much dense signal). */
  themeFloor: number;
  /** How many top passage themes count for theme evidence. */
  themeTopK: number;
  /** Notes admitted purely semantically must be within this gap of the top admitted score. */
  scoreGap: number;
  maxResults: number;
  mmrLambda: number;
  rrfK: number;
  lexicalTopN: number;
};

export const DEFAULT_RETRIEVAL_OPTIONS: RetrievalOptions = {
  denseFloor: 0.66,
  // 0.60 admitted mediocre lexical-corroborated cards (measured 2026-07-02:
  // "Justification by faith" at 0.606 for PSA 23); 0.62 trims them while
  // keeping defensible topical matches (e.g. Romans 6 at 0.637 for ACT 19).
  softFloor: 0.62,
  // Theme identity is strong corroboration (both sides passed through a
  // controlled vocabulary), so its floor sits lower — measured 2026-07-02:
  // "Waiting on God" vs PSA 13 = 0.549 with shared theme "waiting".
  themeFloor: 0.54,
  themeTopK: 4,
  scoreGap: 0.08,
  maxResults: 5,
  mmrLambda: 0.5,
  rrfK: RRF_K,
  lexicalTopN: 5,
};

export type RelatedNotesInput = {
  queryEmbedding: Float32Array;
  /** Chunk-level embeddings (src_kind "note_chunk", src_id `${noteId}#${i}`). */
  embeddings: EmbeddingRow[];
  excludeNoteIds: Set<string>;
  /** Note ids ranked by BM25 (best first). */
  lexicalRankedNoteIds: string[];
  referenceHits: ReferenceHit[];
  /** Chunk text lookup for snippets (re-chunked deterministically by the caller). */
  getChunkText: (noteId: string, index: number) => string | undefined;
  options?: Partial<RetrievalOptions>;
};

type Candidate = {
  noteId: string;
  similarity: number;
  bestChunkIndex: number;
  vector: Float32Array;
  refHits: ReferenceHit[];
  lexicalRank: number; // 0-based, Infinity if absent
  fused: number;
};

/**
 * The B3.5 related-notes selector. Returns at most `maxResults` notes —
 * and, by design, often returns none.
 */
export function selectRelatedNotes(input: RelatedNotesInput): SemanticNote[] {
  const opts: RetrievalOptions = { ...DEFAULT_RETRIEVAL_OPTIONS, ...input.options };

  // 1. Dense scores: best chunk per note.
  const byNote = new Map<string, { similarity: number; index: number; vector: Float32Array }>();
  for (const row of input.embeddings) {
    if (row.srcKind !== "note_chunk") continue;
    const parsed = parseChunkSrcId(row.srcId);
    if (!parsed || input.excludeNoteIds.has(parsed.noteId)) continue;
    const sim = cosineSimilarity(input.queryEmbedding, row.vector);
    const prev = byNote.get(parsed.noteId);
    if (!prev || sim > prev.similarity) {
      byNote.set(parsed.noteId, { similarity: sim, index: parsed.index, vector: row.vector });
    }
  }

  const refByNote = new Map<string, ReferenceHit[]>();
  for (const hit of input.referenceHits) {
    if (input.excludeNoteIds.has(hit.noteId)) continue;
    const list = refByNote.get(hit.noteId) ?? [];
    list.push(hit);
    refByNote.set(hit.noteId, list);
  }

  const lexicalRank = new Map<string, number>();
  for (const [i, id] of input.lexicalRankedNoteIds.entries()) {
    if (!lexicalRank.has(id)) lexicalRank.set(id, i);
  }

  // 2. Admission: deterministic reference evidence, calibrated dense floor,
  //    lexical corroboration at a softer floor, or theme corroboration at
  //    the theme floor. No evidence → no card.
  const candidates: Candidate[] = [];
  for (const [noteId, dense] of byNote) {
    const refHits = refByNote.get(noteId) ?? [];
    const strongRef = refHits.some((h) => h.kind !== "theme");
    const themeRef = refHits.some((h) => h.kind === "theme");
    const lex = lexicalRank.get(noteId) ?? Infinity;
    const admitted =
      strongRef ||
      dense.similarity >= opts.denseFloor ||
      (lex < opts.lexicalTopN && dense.similarity >= opts.softFloor) ||
      (themeRef && dense.similarity >= opts.themeFloor);
    if (!admitted) continue;
    candidates.push({
      noteId,
      similarity: dense.similarity,
      bestChunkIndex: dense.index,
      vector: dense.vector,
      refHits,
      lexicalRank: lex,
      fused: 0,
    });
  }
  if (candidates.length === 0) return [];

  // 3. Score-gap cutoff for purely-semantic admits: they must be near the top.
  const topSim = Math.max(...candidates.map((c) => c.similarity));
  const gated = candidates.filter(
    (c) =>
      c.refHits.length > 0 ||
      c.lexicalRank < opts.lexicalTopN ||
      c.similarity >= topSim - opts.scoreGap,
  );

  // 4. RRF fusion across the three evidence channels.
  const denseList = [...byNote.entries()].sort((a, b) => b[1].similarity - a[1].similarity).map(([id]) => id);
  const refList = [...refByNote.entries()]
    .sort((a, b) => {
      const aCross = a[1].filter((h) => h.kind === "crossref").length;
      const bCross = b[1].filter((h) => h.kind === "crossref").length;
      return bCross - aCross || b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1);
    })
    .map(([id]) => id);
  const fusedScores = rrfFuse([denseList, input.lexicalRankedNoteIds, refList], opts.rrfK);
  for (const c of gated) c.fused = fusedScores.get(c.noteId) ?? 0;
  gated.sort((a, b) => b.fused - a.fused);

  // 5. MMR diversity over best-chunk vectors, then map to SemanticNotes.
  const maxFused = gated[0]?.fused ?? 1;
  const picked = mmrSelect(
    gated,
    (c) => c.vector,
    (c) => (maxFused > 0 ? c.fused / maxFused : 0),
    opts.mmrLambda,
    opts.maxResults,
  );

  return picked.map((c) => {
    const reasons: SemanticNoteReason[] = [];
    for (const hit of c.refHits.slice(0, 2)) {
      reasons.push({ kind: hit.kind === "theme" ? "theme" : "reference", label: hit.label });
    }
    if (c.lexicalRank < opts.lexicalTopN) {
      reasons.push({ kind: "phrase", label: "Strong wording overlap with this passage" });
    }
    if (c.similarity >= opts.denseFloor) {
      reasons.push({
        kind: "semantic",
        label:
          c.bestChunkIndex === EXPANSION_CHUNK_INDEX
            ? "Matches the AI reading of this note (inferred)"
            : "Closely related theme",
      });
    }
    return {
      noteId: c.noteId,
      title: "",
      snippet: truncate(input.getChunkText(c.noteId, c.bestChunkIndex) ?? "", 160),
      similarity: c.similarity,
      reasons,
    };
  });
}

function truncate(text: string, maxLen: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, maxLen - 3) + "...";
}
