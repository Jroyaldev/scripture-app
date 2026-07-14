import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHUNK_MAX_CHARS,
  chunkNoteBody,
  chunkSrcId,
  composeChunkEmbedText,
  computeReferenceHits,
  extractKeywords,
  mmrSelect,
  parseChunkSrcId,
  rrfFuse,
  selectRelatedNotes,
} from "../src/core/ai/retrieval.js";
import type { EmbeddingRow } from "../src/core/ai/similarity.js";

// --- Chunking ---

test("chunkNoteBody: single short paragraph is one chunk", () => {
  const chunks = chunkNoteBody("A short study note about baptism.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.index, 0);
});

test("chunkNoteBody is deterministic and stable", () => {
  const body = "Para one about the Spirit.\n\nPara two about baptism.\n\nPara three about hands.";
  const a = chunkNoteBody(body);
  const b = chunkNoteBody(body);
  assert.deepEqual(a, b);
});

test("chunkNoteBody: distinct large paragraphs become separate chunks", () => {
  const p1 = "Resurrection theology. ".repeat(40).trim(); // ~900 chars
  const p2 = "Committee logistics and budget. ".repeat(30).trim(); // ~950 chars
  const chunks = chunkNoteBody(`${p1}\n\n${p2}`);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0]!.text.includes("Resurrection"));
  assert.ok(chunks[1]!.text.includes("Committee"));
});

test("chunkNoteBody: tiny paragraphs merge, none exceed max", () => {
  const body = Array.from({ length: 20 }, (_, i) => `Point ${i}.`).join("\n\n");
  const chunks = chunkNoteBody(body);
  assert.equal(chunks.length, 1, "tiny fragments pack together");
  const big = "word ".repeat(600); // 3000 chars, no sentence breaks
  for (const c of chunkNoteBody(big)) {
    assert.ok(c.text.length <= CHUNK_MAX_CHARS, `chunk of ${c.text.length} exceeds max`);
  }
});

test("chunk src ids round-trip, including note ids containing '#'", () => {
  assert.deepEqual(parseChunkSrcId(chunkSrcId("note-1", 3)), { noteId: "note-1", index: 3 });
  assert.equal(parseChunkSrcId("no-hash"), null);
  assert.equal(parseChunkSrcId("bad#x"), null);
});

test("composeChunkEmbedText prepends the note title as context", () => {
  assert.equal(composeChunkEmbedText("Title", "body"), "Title\nbody");
  assert.equal(composeChunkEmbedText("", "body"), "body");
});

// --- Keywords ---

test("extractKeywords drops stopwords/archaisms and ranks by frequency", () => {
  const kws = extractKeywords(
    "And the disciples were baptized, and Paul laid his hands upon them, and the Holy Spirit came on them; baptized unto repentance.",
  );
  assert.ok(kws.includes("baptized"));
  assert.ok(kws.includes("spirit"));
  assert.ok(!kws.includes("the"));
  assert.ok(!kws.includes("unto"));
  assert.equal(kws[0], "baptized", "most frequent keyword first");
});

test("extractKeywords is deterministic", () => {
  const text = "spirit water baptism spirit renewal";
  assert.deepEqual(extractKeywords(text), extractKeywords(text));
});

// --- RRF ---

test("rrfFuse: agreement across lists beats a single first place", () => {
  const scores = rrfFuse([
    ["a", "b", "c"],
    ["b", "a"],
    ["b", "c"],
  ]);
  assert.ok(scores.get("b")! > scores.get("a")!, "b ranks in all three lists");
  assert.ok(scores.get("a")! > scores.get("c")!);
});

// --- MMR ---

test("mmrSelect penalizes near-duplicates", () => {
  const v = (x: number, y: number) => new Float32Array([x, y]);
  const items = [
    { id: "dup1", vec: v(1, 0), rel: 1.0 },
    { id: "dup2", vec: v(0.999, 0.01), rel: 0.98 },
    { id: "diverse", vec: v(0, 1), rel: 0.7 },
  ];
  const picked = mmrSelect(items, (i) => i.vec, (i) => i.rel, 0.5, 2);
  assert.deepEqual(picked.map((p) => p.id), ["dup1", "diverse"], "second pick is the diverse item");
});

// --- Reference hits ---

const bookNames = { ACT: ["Acts"], JHN: ["John"] };

test("computeReferenceHits: crossref + chapter evidence with verifiable labels", () => {
  const hits = computeReferenceHits({
    query: { book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7 },
    crossRefTargets: [{ book: "ACT", chapter: 8, verse: 17 }],
    queryAnchorsAtVerse: (b, c, v) =>
      b === "ACT" && c === 8 && v === 17 ? [{ srcKind: "note", srcId: "samaria" }] : [],
    chapterAnchors: [
      { srcKind: "note", srcId: "later", book: "ACT", startCh: 19, startV: 23, endCh: 19, endV: 41 },
      { srcKind: "note", srcId: "inrange", book: "ACT", startCh: 19, startV: 2, endCh: 19, endV: 2 },
      { srcKind: "highlight", srcId: "hl", book: "ACT", startCh: 19, startV: 30, endCh: 19, endV: 30 },
    ],
    excludeNoteIds: new Set(),
    bookNames,
  });
  assert.deepEqual(
    hits.map((h) => ({ noteId: h.noteId, kind: h.kind })),
    [
      { noteId: "samaria", kind: "crossref" },
      { noteId: "later", kind: "chapter" },
    ],
    "in-range anchors and non-note anchors never produce hits",
  );
  assert.match(hits[0]!.label, /Acts 8:17/);
  assert.match(hits[0]!.label, /cross-reference/);
});

test("computeReferenceHits respects exclusions", () => {
  const hits = computeReferenceHits({
    query: { book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7 },
    crossRefTargets: [{ book: "ACT", chapter: 8, verse: 17 }],
    queryAnchorsAtVerse: () => [{ srcKind: "note", srcId: "excluded" }],
    chapterAnchors: [],
    excludeNoteIds: new Set(["excluded"]),
    bookNames,
  });
  assert.equal(hits.length, 0);
});

// --- Decision layer (the magic gate in unit form) ---

// Orthogonal-ish vectors with controlled cosine against the query [1, 0, 0].
function vec(cos: number, tilt = 0): Float32Array {
  const y = Math.sqrt(Math.max(0, 1 - cos * cos));
  const v = new Float32Array([cos, y * Math.cos(tilt), y * Math.sin(tilt)]);
  return v;
}

function rows(entries: [string, Float32Array][]): EmbeddingRow[] {
  return entries.map(([srcId, vector]) => ({ srcKind: "note_chunk", srcId, vector }));
}

const QUERY = new Float32Array([1, 0, 0]);
const getChunkText = () => "chunk text";

test("M1 silence: nothing admitted when every note is ambient noise", () => {
  // Measured EmbeddingGemma noise band: 0.5-0.65 for unrelated content.
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([
      ["n1#0", vec(0.63)],
      ["n2#0", vec(0.58, 1)],
      ["n3#0", vec(0.52, 2)],
    ]),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: [],
    referenceHits: [],
    getChunkText,
  });
  assert.equal(result.length, 0, "the margin must prefer silence over filler");
});

test("dense admission: notes above the calibrated floor surface, noise does not", () => {
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([
      ["hit#0", vec(0.8)],
      ["hit2#0", vec(0.74, 1)],
      ["noise#0", vec(0.6, 2)],
    ]),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: [],
    referenceHits: [],
    getChunkText,
  });
  assert.deepEqual(result.map((r) => r.noteId).sort(), ["hit", "hit2"]);
  assert.ok(result.every((r) => r.reasons.some((x) => x.kind === "semantic")));
});

test("score-gap cutoff: a floor-passing but distant semantic-only note is dropped", () => {
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([
      ["top#0", vec(0.85)],
      ["far#0", vec(0.665, 1)], // above floor 0.66 but > 0.08 below top
    ]),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: [],
    referenceHits: [],
    getChunkText,
  });
  assert.deepEqual(result.map((r) => r.noteId), ["top"]);
});

test("reference evidence admits a below-floor note, with the reason attached", () => {
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([
      ["cited#0", vec(0.6)],
      ["noise#0", vec(0.6, 1)],
    ]),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: [],
    referenceHits: [{ noteId: "cited", label: "Cites Acts 8:17 — a cross-reference of this passage", kind: "crossref" }],
    getChunkText,
  });
  assert.deepEqual(result.map((r) => r.noteId), ["cited"]);
  assert.equal(result[0]!.reasons[0]!.kind, "reference");
});

test("lexical corroboration admits at the soft floor only", () => {
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([
      ["lex#0", vec(0.63)],
      ["lexweak#0", vec(0.58, 1)],
    ]),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: ["lex", "lexweak"],
    referenceHits: [],
    getChunkText,
  });
  assert.deepEqual(result.map((r) => r.noteId), ["lex"], "0.58 stays below the soft floor even with BM25 support");
  assert.ok(result[0]!.reasons.some((r) => r.kind === "phrase"));
});

test("excluded (already-surfaced) notes never reappear semantically", () => {
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([["anchored#0", vec(0.9)]]),
    excludeNoteIds: new Set(["anchored"]),
    lexicalRankedNoteIds: ["anchored"],
    referenceHits: [{ noteId: "anchored", label: "x", kind: "crossref" }],
    getChunkText,
  });
  assert.equal(result.length, 0);
});

test("best chunk wins per note and provides the snippet", () => {
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows([
      ["multi#0", vec(0.4)],
      ["multi#1", vec(0.82)],
      ["multi#2", vec(0.5, 1)],
    ]),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: [],
    referenceHits: [],
    getChunkText: (noteId, index) => `${noteId} chunk ${index}`,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.snippet, "multi chunk 1", "snippet comes from the best-matching paragraph");
});

test("maxResults caps output after MMR", () => {
  const entries: [string, Float32Array][] = [];
  for (let i = 0; i < 9; i++) entries.push([`n${i}#0`, vec(0.8 - i * 0.005, i * 0.3)]);
  const result = selectRelatedNotes({
    queryEmbedding: QUERY,
    embeddings: rows(entries),
    excludeNoteIds: new Set(),
    lexicalRankedNoteIds: [],
    referenceHits: [],
    getChunkText,
  });
  assert.equal(result.length, 5);
});
