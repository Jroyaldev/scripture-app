/**
 * Builds the passage -> moments index: for every chapter of the Bible, where in
 * the corpus it is actually discussed.
 *
 *   node --import tsx scripts/build-passage-moments.ts [--limit N] [--top 12]
 *
 * PUBLISHER-AGNOSTIC BY CONSTRUCTION
 *
 * The candidates are the 1,189 chapters of scripture, not a publisher's tags.
 * Nothing here reads a bref. That matters for three reasons: a publisher's tags
 * are a curated highlight list rather than an index, they carry no weight so a
 * passing cross-reference looks identical to the episode's subject, and the
 * next publisher will not supply them at all. Tags become what they should
 * always have been — a way to check this index rather than a way to build it.
 *
 * SCORING, AND WHY IT IS THE SIMPLE ONE
 *
 * Mean-centred cosine, best window. Four richer schemes were measured against
 * a proxy that asks whether the top-ranked window actually names the book, and
 * all four lost:
 *
 *   centred max            70.1%      <- this
 *   all-but-the-top k=1    68.6%
 *   dwell (3-window run)   52.4%
 *   margin over rivals     46.6%
 *   window background-norm 57.1%
 *   random window          21.9%      <- chance
 *
 * Centring is not optional: the corpus mean vector has norm 0.80, so four
 * fifths of every embedding is the shared direction of "theological podcast
 * conversation", which contributes equally to every comparison and separates
 * nothing. Removing it moved episode-level discrimination from AUC 0.86 to
 * 0.94. Dwell smears a peak that is genuinely sharper than the run around it,
 * and the margin scheme subtracts rivals that are usually adjacent verses of
 * the same passage — co-discussed rather than competing.
 */
import { existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const VECTORS = "/Volumes/External/Transcripts/vectors.bin";
const TEXT = join(REPO, "data/scripture/text/web");
const NAMES = join(REPO, "data/scripture/book-names-en.json");
const CHAPTER_VECTORS = "/Volumes/External/Transcripts/chapters.bin";
const OUT = "/Volumes/External/Transcripts/passage-moments.json";
const DIM = 768;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LIMIT = Number(arg("limit", "0"));
const TOP = Number(arg("top", "12"));
/**
 * Search windows only inside the N episodes that best match the passage.
 *
 * The two questions are answered with very different confidence: "does this
 * episode discuss P" separates at AUC 0.941, while "is this the moment"
 * measured 51.9% on passages nobody tagged. Letting the strong answer constrain
 * the weak one costs nothing and removes a whole class of failure — a
 * charismatic forty-five seconds in an unrelated episode can no longer win, no
 * matter how theologically it phrases itself.
 *
 * An episode's vector is the mean of its centred windows, which is a fair
 * summary of an hour of talk in a way that a mean of five adjacent windows is
 * not. That distinction is why this is not the "dwell" idea that failed twice:
 * aggregation is meaningful at the scale where the thing being aggregated has
 * one subject.
 *
 * 0 disables the gate, which is how the two are compared.
 */
const GATE = Number(arg("gate", "0"));

const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, unknown>;
function bookLabel(code: string): string {
  const entry = bookNames[code];
  /* The names file maps a code to its aliases longest-first —
     GEN -> ["Genesis","Gen","Ge","Gn"] — and the first is the one a speaker
     actually says. Missing this case silently produced queries reading
     "A discussion of GEN 1", throwing away the proper noun the label exists
     to carry. */
  if (Array.isArray(entry)) return typeof entry[0] === "string" ? entry[0] : code;
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const r = entry as Record<string, unknown>;
    for (const k of ["name", "en", "long", "label"]) if (typeof r[k] === "string") return r[k] as string;
  }
  return code;
}

// --- the candidate set: every chapter -----------------------------------------

interface Chapter { book: string; chapter: number; label: string; bref: string; text: string }
const chapters: Chapter[] = [];
for (const book of readdirSync(TEXT)) {
  const dir = join(TEXT, book);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const chapter = Number(file.replace(".json", ""));
    const verses = (JSON.parse(readFileSync(join(dir, file), "utf-8")) as
      { verses: Array<{ verse: number; text: string }> }).verses;
    if (verses.length === 0) continue;
    const label = `${bookLabel(book)} ${chapter}`;
    chapters.push({
      book, chapter, label,
      bref: `bref:v1/${book}.${chapter}.1-${book}.${chapter}.${verses[verses.length - 1]!.verse}`,
      /* Capped: a very long chapter otherwise becomes a query about everything,
         and the embedding of a thousand words is the embedding of an average. */
      text: verses.map((v) => v.text).join(" ").replace(/\s+/g, " ").slice(0, 4000),
    });
  }
}
chapters.sort((a, b) => a.book.localeCompare(b.book) || a.chapter - b.chapter);
console.log(`${chapters.length} chapters as candidates`);

// --- window vectors ------------------------------------------------------------

interface Meta { srcId: string; dim: number; offset: number; start: number }
const byEpisode = new Map<string, Meta[]>();
for (const line of readFileSync(`${VECTORS}.jsonl`, "utf-8").split("\n")) {
  if (!line) continue;
  let meta: Meta;
  try { meta = JSON.parse(line) as Meta; } catch { continue; }
  const cut = meta.srcId.lastIndexOf("#");
  meta.start = Number(meta.srcId.slice(cut + 1));
  const id = meta.srcId.slice(0, cut);
  const list = byEpisode.get(id) ?? []; list.push(meta); byEpisode.set(id, list);
}
for (const list of byEpisode.values()) list.sort((a, b) => a.start - b.start);
console.log(`${byEpisode.size} episodes indexed`);

const fd = openSync(VECTORS, "r");
const readVector = (m: Meta): Float32Array => {
  const b = Buffer.allocUnsafe(m.dim * 4);
  readSync(fd, b, 0, b.length, m.offset);
  return new Float32Array(b.buffer, b.byteOffset, m.dim);
};

const sampleVectors: Float32Array[] = [];
for (const list of byEpisode.values()) {
  for (const m of list.filter((_, i) => i % 6 === 0)) sampleVectors.push(readVector(m));
}
const centre = new Float32Array(DIM);
for (const v of sampleVectors) for (let i = 0; i < DIM; i += 1) centre[i]! += v[i]!;
for (let i = 0; i < DIM; i += 1) centre[i]! /= sampleVectors.length;
console.log(`corpus centre from ${sampleVectors.length} windows, |mean| = ${Math.sqrt(centre.reduce((s, x) => s + x * x, 0)).toFixed(4)}`);

function centred(v: Float32Array): Float32Array {
  const o = new Float32Array(DIM);
  let n = 0;
  for (let i = 0; i < DIM; i += 1) { o[i] = v[i]! - centre[i]!; n += o[i]! * o[i]!; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i += 1) o[i]! /= n;
  return o;
}

// --- chapter vectors, cached ---------------------------------------------------

const provider = new LocalEmbeddingProvider({});
let chapterRaw: Float32Array[];

if (existsSync(CHAPTER_VECTORS) && !process.argv.includes("--rebuild")) {
  const buf = readFileSync(CHAPTER_VECTORS);
  chapterRaw = chapters.map((_, i) =>
    new Float32Array(buf.buffer, buf.byteOffset + i * DIM * 4, DIM));
  console.log(`chapter vectors: reused ${CHAPTER_VECTORS}`);
} else {
  console.log(`embedding ${chapters.length} chapters...`);
  chapterRaw = [];
  const started = Date.now();
  for (let i = 0; i < chapters.length; i += 16) {
    const batch = chapters.slice(i, i + 16);
    /* Same framing that won the query-form test: naming the passage as well as
       quoting it beats quoting it alone, because the label carries proper nouns
       a discussion is far more likely to echo than the prose is. */
    chapterRaw.push(...await provider.embed(
      batch.map((c) => `A discussion of ${c.label}: ${c.text}`), "query",
    ));
    if (i % 320 === 0 && i > 0) {
      const rate = i / ((Date.now() - started) / 1000);
      console.log(`  ${i}/${chapters.length}  ${rate.toFixed(1)}/s`);
    }
  }
  const out = Buffer.allocUnsafe(chapters.length * DIM * 4);
  chapterRaw.forEach((v, i) => Buffer.from(v.buffer, v.byteOffset, DIM * 4).copy(out, i * DIM * 4));
  mkdirSync(dirname(CHAPTER_VECTORS), { recursive: true });
  writeFileSync(CHAPTER_VECTORS, out);
  console.log(`chapter vectors written to ${CHAPTER_VECTORS}`);
}
const chapterVecs = chapterRaw.map(centred);

// --- score every window against every chapter -----------------------------------

interface Moment { recordId: string; start: number; score: number }
const perChapter: Moment[][] = chapters.map(() => []);

const episodes = [...byEpisode.entries()];
const chosen = LIMIT > 0 ? episodes.slice(0, LIMIT) : episodes;
const started = Date.now();
let windowsDone = 0;

/* Episode summaries, and which episodes each chapter is allowed to draw from.
   Built up front because the gate has to be known before any window is scored,
   and one pass over the corpus is cheap next to the scoring itself. */
const allowed: Array<Set<number>> = chapters.map(() => new Set<number>());
if (GATE > 0) {
  const summaries = chosen.map(([, metas]) => {
    const mean = new Float32Array(DIM);
    for (const meta of metas) {
      const v = centred(readVector(meta));
      for (let i = 0; i < DIM; i += 1) mean[i]! += v[i]!;
    }
    let n = Math.sqrt(mean.reduce((s, x) => s + x * x, 0)) || 1;
    for (let i = 0; i < DIM; i += 1) mean[i]! /= n;
    return mean;
  });
  for (let c = 0; c < chapterVecs.length; c += 1) {
    const vec = chapterVecs[c]!;
    const ranked = summaries
      .map((summary, e) => {
        let s = 0;
        for (let i = 0; i < DIM; i += 1) s += summary[i]! * vec[i]!;
        return { e, s };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, GATE);
    for (const { e } of ranked) allowed[c]!.add(e);
  }
  console.log(`episode gate: each chapter may draw from its ${GATE} best-matching episodes`);
}

for (const [n, [recordId, metas]] of chosen.entries()) {
  const windows = metas.map(readVector).map(centred);
  for (let w = 0; w < windows.length; w += 1) {
    const window = windows[w]!;
    for (let c = 0; c < chapterVecs.length; c += 1) {
      if (GATE > 0 && !allowed[c]!.has(n)) continue;
      const vec = chapterVecs[c]!;
      let s = 0;
      for (let i = 0; i < DIM; i += 1) s += window[i]! * vec[i]!;
      /* Kept only if it would make this chapter's shortlist. Holding all 56M
         scores is neither possible nor useful — the index is the tail-end of
         each chapter's distribution, not the distribution. */
      const list = perChapter[c]!;
      if (list.length < TOP * 4) list.push({ recordId, start: metas[w]!.start, score: s });
      else {
        let worst = 0;
        for (let j = 1; j < list.length; j += 1) if (list[j]!.score < list[worst]!.score) worst = j;
        if (s > list[worst]!.score) list[worst] = { recordId, start: metas[w]!.start, score: s };
      }
    }
  }
  windowsDone += windows.length;
  if ((n + 1) % 25 === 0) {
    const elapsed = (Date.now() - started) / 1000;
    console.log(`  ${n + 1}/${chosen.length} episodes, ${windowsDone} windows, `
      + `${Math.round(windowsDone / elapsed)} win/s, ~${Math.ceil((chosen.length - n - 1) * (elapsed / (n + 1)) / 60)}m left`);
  }
}

// --- emit -----------------------------------------------------------------------

const index = chapters.map((chapter, c) => {
  const moments = perChapter[c]!.sort((a, b) => b.score - a.score);
  /* One moment per episode: several windows of the same discussion are the same
     answer, and a chapter whose top ten are all one episode has told the reader
     about one episode. */
  const seen = new Set<string>();
  const best: Moment[] = [];
  for (const moment of moments) {
    if (seen.has(moment.recordId)) continue;
    seen.add(moment.recordId);
    best.push(moment);
    if (best.length >= TOP) break;
  }
  return {
    bref: chapter.bref,
    label: chapter.label,
    book: chapter.book,
    chapter: chapter.chapter,
    moments: best.map((m) => ({ id: m.recordId, at: Math.round(m.start), score: Number(m.score.toFixed(4)) })),
  };
});

writeFileSync(OUT, `${JSON.stringify({
  schema: "passage-moments/v1",
  built: "centred-cosine-best-window",
  model: "onnx-community/embeddinggemma-300m-ONNX",
  chapters: index.length,
  episodes: chosen.length,
  index,
}, null, 1)}\n`);

const scores = index.flatMap((c) => c.moments.map((m) => m.score)).sort((a, b) => a - b);
console.log(`\nwrote ${OUT}`);
console.log(`  chapters:       ${index.length}`);
console.log(`  moments:        ${scores.length}`);
console.log(`  score spread:   min ${scores[0]?.toFixed(3)}  median ${scores[scores.length >> 1]?.toFixed(3)}  max ${scores[scores.length - 1]?.toFixed(3)}`);
console.log(`  took            ${Math.round((Date.now() - started) / 1000 / 60)}m`);
