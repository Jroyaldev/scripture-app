/**
 * Does the top-scoring window actually contain the passage being discussed?
 *
 *   node --import tsx scripts/probe-passage-localization.ts [--episodes 60]
 *
 * The scoring probe answered "does this episode discuss P" and centring took it
 * to AUC 0.94. It could not answer the question the product actually asks,
 * which is WHERE — and it wrongly condemned margin and dwell, both of which
 * were designed for this question rather than that one.
 *
 * There are no location labels, so this uses a proxy that needs none: when a
 * speaker discusses a passage, they tend to name its book somewhere nearby. If
 * the window we rank first for "Genesis 22" contains the word Genesis far more
 * often than a window picked at random from the same episode, the ranking is
 * finding something real. The proxy is weak on its own — a passage can be
 * discussed for minutes without its name being said — so it is used only to
 * COMPARE scoring methods against each other, where the same weakness applies
 * equally to all of them and cancels.
 *
 * Deliberately not used as a signal in the ranking itself. A ranking scored on
 * a proxy it also consumes measures nothing.
 */
import { existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const VECTORS = "/Volumes/External/Transcripts/vectors.bin";
const TEXT = join(REPO, "data/scripture/text/web");
const NAMES = join(REPO, "data/scripture/book-names-en.json");
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const EPISODES = Number(arg("episodes", "60"));
const DIM = 768;

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

interface Passage { bref: string; book: string; label: string; text: string }
const chapterCache = new Map<string, Array<{ verse: number; text: string }>>();
function chapterVerses(book: string, chapter: number): Array<{ verse: number; text: string }> {
  const key = `${book}.${chapter}`;
  const hit = chapterCache.get(key);
  if (hit) return hit;
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
  const same = !endBook || (endBook === book && Number(endChapterRaw) === chapter);
  const end = same && endRaw ? Number(endRaw) : start;
  const verses = chapterVerses(book!, chapter);
  if (verses.length === 0) return null;
  const picked = verses.filter((v) => v.verse >= start && v.verse <= Math.max(end, start));
  if (picked.length === 0) return null;
  const label = end > start ? `${bookLabel(book!)} ${chapter}:${start}-${end}` : `${bookLabel(book!)} ${chapter}:${start}`;
  return { bref, book: book!, label, text: picked.map((v) => v.text).join(" ").replace(/\s+/g, " ").trim() };
}

const buildQuery = (p: Passage): string => `A discussion of ${p.label}: ${p.text}`;

interface Meta { srcId: string; dim: number; offset: number; start: number }
const byEpisode = new Map<string, Meta[]>();
for (const line of readFileSync(`${VECTORS}.jsonl`, "utf-8").split("\n")) {
  if (!line) continue;
  let meta: Meta;
  try { meta = JSON.parse(line) as Meta; } catch { continue; }
  const cut = meta.srcId.lastIndexOf("#");
  meta.start = Number(meta.srcId.slice(cut + 1));
  const recordId = meta.srcId.slice(0, cut);
  const list = byEpisode.get(recordId) ?? [];
  list.push(meta);
  byEpisode.set(recordId, list);
}
for (const list of byEpisode.values()) list.sort((a, b) => a.start - b.start);

const fd = openSync(VECTORS, "r");
const readVector = (meta: Meta): Float32Array => {
  const bytes = Buffer.allocUnsafe(meta.dim * 4);
  readSync(fd, bytes, 0, bytes.length, meta.offset);
  return new Float32Array(bytes.buffer, bytes.byteOffset, meta.dim);
};

const centre = new Float32Array(DIM);
let counted = 0;
for (const list of byEpisode.values()) {
  for (const meta of list.filter((_, i) => i % 4 === 0)) {
    const v = readVector(meta);
    for (let i = 0; i < DIM; i += 1) centre[i]! += v[i]!;
    counted += 1;
  }
}
for (let i = 0; i < DIM; i += 1) centre[i]! /= counted;

function centred(v: Float32Array): Float32Array {
  const out = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) { out[i] = v[i]! - centre[i]!; norm += out[i]! * out[i]!; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i += 1) out[i]! /= norm;
  return out;
}
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
}

/** Transcript text per window span, for the book-name proxy. */
function windowTexts(recordId: string, metas: Meta[]): string[] {
  const key = recordId.replace(/:/g, "__").replace(/\//g, "_");
  const path = join(TRANSCRIPTS, `${key}.json`);
  if (!existsSync(path)) return metas.map(() => "");
  const t = JSON.parse(readFileSync(path, "utf-8")) as { segments: Array<{ t: string; s: number; e: number }> };
  return metas.map((meta, i) => {
    const end = i + 1 < metas.length ? metas[i + 1]!.start + 12 : Infinity;
    return t.segments.filter((s) => s.s >= meta.start - 1 && s.s < end).map((s) => s.t).join(" ");
  });
}

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; brefs?: string[] }> };

const usable = manifest.records
  .filter((r) => r.kind === "podcast" && (r.brefs?.length ?? 0) >= 3 && byEpisode.has(r.id))
  .filter((_, i) => i % 4 === 0)
  .slice(0, EPISODES);

const provider = new LocalEmbeddingProvider({});

const METHODS = ["best", "dwell3", "dwell5", "margin", "margin+dwell3"] as const;
const hits = new Map<string, { hit: number; n: number }>(METHODS.map((m) => [m, { hit: 0, n: 0 }]));
let baseline = { hit: 0, n: 0 };

function runMean(sims: number[], k: number): number[] {
  if (sims.length < k) return sims;
  const out = new Array<number>(sims.length).fill(-Infinity);
  let running = 0;
  for (let i = 0; i < sims.length; i += 1) {
    running += sims[i]!;
    if (i >= k) running -= sims[i - k]!;
    if (i >= k - 1) {
      const value = running / k;
      /* Credit the run's centre, since that is the moment being pointed at. */
      out[i - Math.floor(k / 2)] = value;
    }
  }
  return out;
}

for (const [n, record] of usable.entries()) {
  const metas = byEpisode.get(record.id) ?? [];
  if (metas.length < 10) continue;
  const windows = metas.map(readVector).map(centred);
  const texts = windowTexts(record.id, metas);
  if (texts.every((t) => t.length === 0)) continue;

  const passages = [...new Set(record.brefs ?? [])]
    .map(passageOf).filter((p): p is Passage => p !== null).slice(0, 8);
  if (passages.length < 2) continue;

  const queries = (await provider.embed(passages.map(buildQuery), "query")).map(centred);
  const sims = queries.map((q) => windows.map((w) => dot(q, w)));

  const margins = sims.map((mine, i) => mine.map((value, w) => {
    let rival = -Infinity;
    for (let j = 0; j < sims.length; j += 1) if (j !== i) rival = Math.max(rival, sims[j]![w]!);
    return value - rival;
  }));

  passages.forEach((passage, i) => {
    const name = bookLabel(passage.book).toLowerCase();
    /* Only scoreable where the name is said at all — otherwise every method
       fails identically and the comparison learns nothing. */
    const mentions = texts.map((t) => t.toLowerCase().includes(name));
    if (!mentions.some(Boolean)) return;

    const pick = (scored: number[]): number => scored.reduce((best, v, idx) => (v > scored[best]! ? idx : best), 0);
    const record_ = (method: string, index: number): void => {
      const bucket = hits.get(method)!;
      bucket.n += 1;
      if (mentions[index]) bucket.hit += 1;
    };
    record_("best", pick(sims[i]!));
    record_("dwell3", pick(runMean(sims[i]!, 3)));
    record_("dwell5", pick(runMean(sims[i]!, 5)));
    record_("margin", pick(margins[i]!));
    record_("margin+dwell3", pick(runMean(margins[i]!, 3)));

    /* What a coin flip looks like: the rate at which ANY window mentions the
       book. Every method must beat this or it is not localizing. */
    baseline.n += 1;
    baseline.hit += mentions.filter(Boolean).length / mentions.length;
  });

  if ((n + 1) % 15 === 0) console.log(`  ${n + 1}/${usable.length} episodes`);
}

console.log(`\n  method            top window names the book`);
for (const method of METHODS) {
  const b = hits.get(method)!;
  console.log(`  ${method.padEnd(16)} ${((b.hit / (b.n || 1)) * 100).toFixed(1)}%   (n=${b.n})`);
}
console.log(`  ${"[random window]".padEnd(16)} ${((baseline.hit / (baseline.n || 1)) * 100).toFixed(1)}%   <- chance`);
