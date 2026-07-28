/**
 * How should a passage be scored against an episode's windows?
 *
 *   node --import tsx scripts/probe-passage-scoring.ts [--episodes 40]
 *
 * The first probe established that passages retrieve their own episodes at all
 * (AUC ~0.83 raw). This one asks how much better it gets, because 0.83 is not
 * a number you build a precision-first feature on.
 *
 * Three ideas, tested separately and together:
 *
 *   CENTERING   every window in this corpus is theological conversation, so
 *               they share a large common component that contributes to every
 *               similarity equally and discriminates nothing. Subtracting the
 *               corpus mean removes it. Cosine on centred vectors measures how
 *               a window differs from the average window, which is the only
 *               part that can carry a passage's identity.
 *
 *   MARGIN      similarity to a passage is not evidence on its own — a window
 *               about creation sits near Genesis 1, John 1 and Colossians 1
 *               simultaneously. What distinguishes aboutness from theme is how
 *               far the passage beats its rivals. Score P minus the best
 *               competing passage, which is TF-IDF logic in embedding space.
 *
 *   DWELL       one high window is a mention. A run of them is a subject. Mean
 *               of the top-k consecutive windows rather than the single best.
 *
 * Measured as AUC: the probability that a passage the episode really discusses
 * outscores one it never mentions. 0.5 is a coin flip.
 */
import { existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const VECTORS = "/Volumes/External/Transcripts/vectors.bin";
const TEXT = join(REPO, "data/scripture/text/web");
const NAMES = join(REPO, "data/scripture/book-names-en.json");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const EPISODES = Number(arg("episodes", "40"));
const TOPK = Number(arg("topk", "3"));

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
    const record = entry as Record<string, unknown>;
    for (const key of ["name", "en", "long", "label"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return code;
}

interface Passage { bref: string; label: string; text: string }
const chapterCache = new Map<string, Array<{ verse: number; text: string }>>();
function chapterVerses(book: string, chapter: number): Array<{ verse: number; text: string }> {
  const key = `${book}.${chapter}`;
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const path = join(TEXT, book, `${chapter}.json`);
  const verses = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as { verses: Array<{ verse: number; text: string }> }).verses
    : [];
  chapterCache.set(key, verses);
  return verses;
}

function passageOf(bref: string): Passage | null {
  const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)\.(\d+)(?:-([A-Z0-9]+)\.(\d+)\.(\d+))?/.exec(bref);
  if (!m) return null;
  const [, book, chapterRaw, startRaw, endBook, endChapterRaw, endRaw] = m;
  const chapter = Number(chapterRaw);
  const start = Number(startRaw);
  const sameChapter = !endBook || (endBook === book && Number(endChapterRaw) === chapter);
  const end = sameChapter && endRaw ? Number(endRaw) : start;
  const verses = chapterVerses(book!, chapter);
  if (verses.length === 0) return null;
  const picked = verses.filter((v) => v.verse >= start && v.verse <= Math.max(end, start));
  if (picked.length === 0) return null;
  const label = end > start
    ? `${bookLabel(book!)} ${chapter}:${start}-${end}`
    : `${bookLabel(book!)} ${chapter}:${start}`;
  return { bref, label, text: picked.map((v) => v.text).join(" ").replace(/\s+/g, " ").trim() };
}

/** The winner of the first probe. */
const buildQuery = (p: Passage): string => `A discussion of ${p.label}: ${p.text}`;

interface Meta { srcId: string; dim: number; offset: number }
const metaByEpisode = new Map<string, Meta[]>();
for (const line of readFileSync(`${VECTORS}.jsonl`, "utf-8").split("\n")) {
  if (!line) continue;
  let meta: Meta;
  try { meta = JSON.parse(line) as Meta; } catch { continue; }
  const recordId = meta.srcId.slice(0, meta.srcId.lastIndexOf("#"));
  const list = metaByEpisode.get(recordId) ?? [];
  list.push(meta);
  metaByEpisode.set(recordId, list);
}
/* Windows are emitted in time order and must stay that way: DWELL depends on
   adjacency meaning adjacency in the episode. */
for (const list of metaByEpisode.values()) {
  list.sort((a, b) => Number(a.srcId.slice(a.srcId.lastIndexOf("#") + 1))
    - Number(b.srcId.slice(b.srcId.lastIndexOf("#") + 1)));
}

const fd = openSync(VECTORS, "r");
function readVector(meta: Meta): Float32Array {
  const bytes = Buffer.allocUnsafe(meta.dim * 4);
  readSync(fd, bytes, 0, bytes.length, meta.offset);
  return new Float32Array(bytes.buffer, bytes.byteOffset, meta.dim);
}

const DIM = 768;

/* The corpus mean, over a broad sample rather than everything: the common
   direction is a property of the whole corpus and converges long before 47,496
   vectors. */
const centre = new Float32Array(DIM);
let counted = 0;
for (const list of metaByEpisode.values()) {
  for (const meta of list.filter((_, i) => i % 4 === 0)) {
    const v = readVector(meta);
    for (let i = 0; i < DIM; i += 1) centre[i]! += v[i]!;
    counted += 1;
  }
}
for (let i = 0; i < DIM; i += 1) centre[i]! /= counted;
const centreNorm = Math.sqrt(centre.reduce((s, x) => s + x * x, 0));
console.log(`corpus centre over ${counted} windows, |mean| = ${centreNorm.toFixed(4)}`);
console.log(`  (a large norm means the vectors share a strong common direction)\n`);

function centred(v: Float32Array): Float32Array {
  const out = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) { out[i] = v[i]! - centre[i]!; norm += out[i]! * out[i]!; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i += 1) out[i]! /= norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

/** Best single window, or the best run of TOPK consecutive ones. */
function score(sims: number[], dwell: boolean): number {
  if (!dwell || sims.length < TOPK) return Math.max(...sims);
  let best = -Infinity;
  let running = 0;
  for (let i = 0; i < sims.length; i += 1) {
    running += sims[i]!;
    if (i >= TOPK) running -= sims[i - TOPK]!;
    if (i >= TOPK - 1) best = Math.max(best, running / TOPK);
  }
  return best;
}

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; brefs?: string[] }> };

const usable = manifest.records
  .filter((r) => r.kind === "podcast" && (r.brefs?.length ?? 0) >= 4 && metaByEpisode.has(r.id))
  .filter((_, i) => i % 5 === 0)
  .slice(0, EPISODES);

const provider = new LocalEmbeddingProvider({});
const allBrefs = [...new Set(manifest.records.flatMap((r) => r.brefs ?? []))];

const VARIANTS = ["raw", "raw+dwell", "centred", "centred+dwell", "centred+margin", "centred+margin+dwell"] as const;
const results = new Map<string, { pos: number[]; neg: number[] }>(
  VARIANTS.map((v) => [v, { pos: [], neg: [] }]),
);

for (const [n, record] of usable.entries()) {
  const metas = metaByEpisode.get(record.id) ?? [];
  if (metas.length < 8) continue;
  const rawWindows = metas.map(readVector);
  const cenWindows = rawWindows.map(centred);

  const tagged = new Set(record.brefs ?? []);
  const positives = [...tagged].map(passageOf).filter((p): p is Passage => p !== null).slice(0, 6);
  const negatives: Passage[] = [];
  for (let i = 0; negatives.length < 6 && i < allBrefs.length; i += 1) {
    const candidate = allBrefs[(i * 977 + n * 131) % allBrefs.length]!;
    if (tagged.has(candidate)) continue;
    const p = passageOf(candidate);
    if (p) negatives.push(p);
  }
  if (positives.length === 0 || negatives.length === 0) continue;

  const all = [...positives, ...negatives];
  const queries = await provider.embed(all.map(buildQuery), "query");
  const cenQueries = queries.map(centred);

  const rawSims = queries.map((q) => rawWindows.map((w) => dot(q, w)));
  const cenSims = cenQueries.map((q) => cenWindows.map((w) => dot(q, w)));

  /* MARGIN: how far this passage beats the best OTHER candidate on the same
     window. Computed against the pooled candidate set, which is what the real
     system would have — a set of plausible passages competing for the same
     moment. */
  const marginSims = cenSims.map((mine, i) => mine.map((value, w) => {
    let rival = -Infinity;
    for (let j = 0; j < cenSims.length; j += 1) {
      if (j !== i) rival = Math.max(rival, cenSims[j]![w]!);
    }
    return value - rival;
  }));

  all.forEach((_, i) => {
    const bucket = i < positives.length ? "pos" : "neg";
    results.get("raw")![bucket].push(score(rawSims[i]!, false));
    results.get("raw+dwell")![bucket].push(score(rawSims[i]!, true));
    results.get("centred")![bucket].push(score(cenSims[i]!, false));
    results.get("centred+dwell")![bucket].push(score(cenSims[i]!, true));
    results.get("centred+margin")![bucket].push(score(marginSims[i]!, false));
    results.get("centred+margin+dwell")![bucket].push(score(marginSims[i]!, true));
  });

  if ((n + 1) % 10 === 0) console.log(`  ${n + 1}/${usable.length} episodes`);
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function auc(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length || 1);
}

console.log(`\n  variant                  pos     neg     gap      AUC`);
for (const variant of VARIANTS) {
  const r = results.get(variant)!;
  const p = mean(r.pos);
  const q = mean(r.neg);
  console.log(
    `  ${variant.padEnd(22)} ${p.toFixed(3).padStart(6)}  ${q.toFixed(3).padStart(6)}  `
    + `${(p - q).toFixed(3).padStart(6)}   ${auc(r.pos, r.neg).toFixed(3)}`,
  );
}
console.log(`\n  n = ${results.get("raw")!.pos.length} positive, ${results.get("raw")!.neg.length} negative`);
