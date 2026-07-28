/**
 * Two refinements to centred cosine, tested against the same proxy.
 *
 *   node --import tsx scripts/probe-passage-normalization.ts [--episodes 60]
 *
 * Centred max is at 70.1% against a 21.9% floor. Dwell and margin both made it
 * worse. Two ideas remain worth testing before calling the scorer done.
 *
 *   ALL-BUT-THE-TOP   subtracting the mean removes one shared direction. There
 *                     may be several: the top principal components of an
 *                     embedding set are routinely dominated by frequency and
 *                     register rather than by meaning. Removing k of them is
 *                     the standard stronger form of what centring does once.
 *
 *   WINDOW BACKGROUND the earlier margin test asked "does this passage beat its
 *                     rivals", and its rivals were other passages the same
 *                     episode discusses — often adjacent verses of the same
 *                     text, which are co-discussed rather than competing. That
 *                     was the wrong denominator. The right question is about
 *                     the WINDOW: some windows are generically scripture-shaped
 *                     and score well against everything. Standardising each
 *                     window against a fixed background of unrelated passages
 *                     asks how unusual this match is for this window, which is
 *                     the correction the first attempt was reaching for.
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
const DIM = 768;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const EPISODES = Number(arg("episodes", "60"));

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

interface Passage { bref: string; book: string; label: string; text: string }
const chapterCache = new Map<string, Array<{ verse: number; text: string }>>();
function chapterVerses(book: string, chapter: number): Array<{ verse: number; text: string }> {
  const key = `${book}.${chapter}`;
  const hit = chapterCache.get(key);
  if (hit) return hit;
  const path = join(TEXT, book, `${chapter}.json`);
  const verses = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as { verses: Array<{ verse: number; text: string }> }).verses : [];
  chapterCache.set(key, verses);
  return verses;
}
function passageOf(bref: string): Passage | null {
  const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)\.(\d+)(?:-([A-Z0-9]+)\.(\d+)\.(\d+))?/.exec(bref);
  if (!m) return null;
  const [, book, cRaw, sRaw, eBook, ecRaw, eRaw] = m;
  const chapter = Number(cRaw); const start = Number(sRaw);
  const same = !eBook || (eBook === book && Number(ecRaw) === chapter);
  const end = same && eRaw ? Number(eRaw) : start;
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
  const id = meta.srcId.slice(0, cut);
  const list = byEpisode.get(id) ?? []; list.push(meta); byEpisode.set(id, list);
}
for (const list of byEpisode.values()) list.sort((a, b) => a.start - b.start);

const fd = openSync(VECTORS, "r");
const readVector = (m: Meta): Float32Array => {
  const b = Buffer.allocUnsafe(m.dim * 4);
  readSync(fd, b, 0, b.length, m.offset);
  return new Float32Array(b.buffer, b.byteOffset, m.dim);
};

const sample: Float32Array[] = [];
for (const list of byEpisode.values()) for (const m of list.filter((_, i) => i % 6 === 0)) sample.push(readVector(m));

const centre = new Float32Array(DIM);
for (const v of sample) for (let i = 0; i < DIM; i += 1) centre[i]! += v[i]!;
for (let i = 0; i < DIM; i += 1) centre[i]! /= sample.length;

/** Top principal components of the centred sample, by power iteration —
    enough for k=3 and far cheaper than a full decomposition. */
function topComponents(k: number): Float32Array[] {
  const centredSample = sample.map((v) => {
    const o = new Float32Array(DIM);
    for (let i = 0; i < DIM; i += 1) o[i] = v[i]! - centre[i]!;
    return o;
  });
  const comps: Float32Array[] = [];
  for (let c = 0; c < k; c += 1) {
    let u = new Float32Array(DIM).map((_, i) => Math.sin(i * (c + 1) * 0.7));
    for (let iter = 0; iter < 24; iter += 1) {
      const next = new Float32Array(DIM);
      for (const v of centredSample) {
        let p = 0;
        for (let i = 0; i < DIM; i += 1) p += v[i]! * u[i]!;
        for (let i = 0; i < DIM; i += 1) next[i]! += p * v[i]!;
      }
      for (const prev of comps) {
        let p = 0;
        for (let i = 0; i < DIM; i += 1) p += next[i]! * prev[i]!;
        for (let i = 0; i < DIM; i += 1) next[i]! -= p * prev[i]!;
      }
      let n = Math.sqrt(next.reduce((s, x) => s + x * x, 0)) || 1;
      for (let i = 0; i < DIM; i += 1) next[i]! /= n;
      u = next;
    }
    comps.push(u);
  }
  return comps;
}
const PCS = topComponents(3);

function project(v: Float32Array, k: number): Float32Array {
  const o = new Float32Array(DIM);
  for (let i = 0; i < DIM; i += 1) o[i] = v[i]! - centre[i]!;
  for (let c = 0; c < k; c += 1) {
    const pc = PCS[c]!;
    let p = 0;
    for (let i = 0; i < DIM; i += 1) p += o[i]! * pc[i]!;
    for (let i = 0; i < DIM; i += 1) o[i]! -= p * pc[i]!;
  }
  let n = Math.sqrt(o.reduce((s, x) => s + x * x, 0)) || 1;
  for (let i = 0; i < DIM; i += 1) o[i]! /= n;
  return o;
}
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!; return s;
}

function windowTexts(recordId: string, metas: Meta[]): string[] {
  const key = recordId.replace(/:/g, "__").replace(/\//g, "_");
  const path = join(TRANSCRIPTS, `${key}.json`);
  if (!existsSync(path)) return metas.map(() => "");
  const t = JSON.parse(readFileSync(path, "utf-8")) as { segments: Array<{ t: string; s: number }> };
  return metas.map((meta, i) => {
    const end = i + 1 < metas.length ? metas[i + 1]!.start + 12 : Infinity;
    return t.segments.filter((s) => s.s >= meta.start - 1 && s.s < end).map((s) => s.t).join(" ");
  });
}

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; brefs?: string[] }> };
const allBrefs = [...new Set(manifest.records.flatMap((r) => r.brefs ?? []))];

const provider = new LocalEmbeddingProvider({});

/* A fixed background of unrelated passages, embedded once. Standardising a
   window against these asks how unusual a match is FOR THAT WINDOW. */
const background: Passage[] = [];
for (let i = 0; background.length < 24 && i < allBrefs.length; i += 1) {
  const p = passageOf(allBrefs[(i * 1531) % allBrefs.length]!);
  if (p) background.push(p);
}
const bgVectors0 = await provider.embed(background.map(buildQuery), "query");

const usable = manifest.records
  .filter((r) => r.kind === "podcast" && (r.brefs?.length ?? 0) >= 3 && byEpisode.has(r.id))
  .filter((_, i) => i % 4 === 0).slice(0, EPISODES);

const METHODS = ["centred(k=0)", "abtt k=1", "abtt k=2", "abtt k=3", "centred+bgnorm", "abtt1+bgnorm"] as const;
const hits = new Map<string, { hit: number; n: number }>(METHODS.map((m) => [m, { hit: 0, n: 0 }]));
let floor = { hit: 0, n: 0 };

for (const [n, record] of usable.entries()) {
  const metas = byEpisode.get(record.id) ?? [];
  if (metas.length < 10) continue;
  const raw = metas.map(readVector);
  const texts = windowTexts(record.id, metas);
  if (texts.every((t) => t.length === 0)) continue;

  const passages = [...new Set(record.brefs ?? [])]
    .map(passageOf).filter((p): p is Passage => p !== null).slice(0, 8);
  if (passages.length < 2) continue;
  const q0 = await provider.embed(passages.map(buildQuery), "query");

  for (const [label, k] of [["centred(k=0)", 0], ["abtt k=1", 1], ["abtt k=2", 2], ["abtt k=3", 3]] as const) {
    const W = raw.map((v) => project(v, k));
    const Q = q0.map((v) => project(v, k));
    passages.forEach((passage, i) => {
      const name = bookLabel(passage.book).toLowerCase();
      const mentions = texts.map((t) => t.toLowerCase().includes(name));
      if (!mentions.some(Boolean)) return;
      const sims = W.map((w) => dot(Q[i]!, w));
      const top = sims.reduce((best, v, idx) => (v > sims[best]! ? idx : best), 0);
      const bucket = hits.get(label)!;
      bucket.n += 1;
      if (mentions[top]) bucket.hit += 1;
      if (k === 0) { floor.n += 1; floor.hit += mentions.filter(Boolean).length / mentions.length; }
    });
  }

  for (const [label, k] of [["centred+bgnorm", 0], ["abtt1+bgnorm", 1]] as const) {
    const W = raw.map((v) => project(v, k));
    const Q = q0.map((v) => project(v, k));
    const BG = bgVectors0.map((v) => project(v, k));
    /* Per-window mean and spread over the background set. */
    const stats = W.map((w) => {
      const xs = BG.map((b) => dot(b, w));
      const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length) || 1e-6;
      return { mu, sd };
    });
    passages.forEach((passage, i) => {
      const name = bookLabel(passage.book).toLowerCase();
      const mentions = texts.map((t) => t.toLowerCase().includes(name));
      if (!mentions.some(Boolean)) return;
      const sims = W.map((w, wi) => (dot(Q[i]!, w) - stats[wi]!.mu) / stats[wi]!.sd);
      const top = sims.reduce((best, v, idx) => (v > sims[best]! ? idx : best), 0);
      const bucket = hits.get(label)!;
      bucket.n += 1;
      if (mentions[top]) bucket.hit += 1;
    });
  }

  if ((n + 1) % 15 === 0) console.log(`  ${n + 1}/${usable.length} episodes`);
}

console.log(`\n  method             top window names the book`);
for (const m of METHODS) {
  const b = hits.get(m)!;
  console.log(`  ${m.padEnd(18)} ${((b.hit / (b.n || 1)) * 100).toFixed(1)}%   (n=${b.n})`);
}
console.log(`  ${"[random window]".padEnd(18)} ${((floor.hit / (floor.n || 1)) * 100).toFixed(1)}%   <- chance`);
