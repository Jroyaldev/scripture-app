/**
 * Does a Bible passage retrieve the conversation about it?
 *
 *   node --import tsx scripts/probe-passage-retrieval.ts [--episodes 30]
 *
 * THE QUESTION THIS ANSWERS BEFORE ANYTHING IS BUILT ON IT
 *
 * The plan is to find where in an episode a passage is discussed by scoring the
 * passage against the episode's embedded windows. That assumes ancient
 * narrative prose lands near modern conversational analysis of it in embedding
 * space, and there is no reason in principle it should: one is the text, the
 * other is people talking around it, and a model trained on general text was
 * never asked to relate them. This is asymmetric retrieval, and when it fails
 * it fails quietly — returning confidently ranked noise.
 *
 * The test needs no knowledge of WHERE a passage is discussed, which is
 * fortunate because we have none. It only needs to know that an episode does
 * discuss it, which the publisher's own tags supply. So: score an episode's
 * tagged passages against its windows, score passages it never mentions against
 * the same windows, and see whether the two populations separate. If they do
 * not, the whole approach is unsound and this cost twenty minutes.
 *
 * Four query representations are compared, because if the raw text fails the
 * interesting question is immediately whether a different framing succeeds.
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
const EPISODES = Number(arg("episodes", "30"));

// --- passage text -------------------------------------------------------------

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

/** Reads a bref into the words it names. Multi-chapter spans are truncated to
    the first chapter: a query built from twenty chapters is not a passage, it
    is a book, and it would tell us nothing about whether passages retrieve. */
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

/** The four framings under test. */
const FORMS: Array<{ name: string; build: (p: Passage) => string }> = [
  { name: "text", build: (p) => p.text },
  { name: "label+text", build: (p) => `${p.label}. ${p.text}` },
  { name: "label", build: (p) => p.label },
  { name: "about", build: (p) => `A discussion of ${p.label}: ${p.text}` },
];

// --- window vectors -----------------------------------------------------------

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

const fd = openSync(VECTORS, "r");
function vectorsFor(recordId: string): Float32Array[] {
  const metas = metaByEpisode.get(recordId) ?? [];
  return metas.map((meta) => {
    const bytes = Buffer.allocUnsafe(meta.dim * 4);
    readSync(fd, bytes, 0, bytes.length, meta.offset);
    return new Float32Array(bytes.buffer, bytes.byteOffset, meta.dim);
  });
}

/** Vectors are unit length on both sides, so a dot product is the cosine. */
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

// --- episodes and their tags --------------------------------------------------

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; title: string; brefs?: string[] }> };

const usable = manifest.records
  .filter((r) => r.kind === "podcast" && (r.brefs?.length ?? 0) >= 4 && metaByEpisode.has(r.id))
  /* Deterministic spread rather than the head of the list, which is sorted and
     would sample one corner of the catalogue. */
  .filter((_, i) => i % 7 === 0)
  .slice(0, EPISODES);

console.log(`${usable.length} episodes, ${metaByEpisode.size} indexed\n`);

const provider = new LocalEmbeddingProvider({});
const allBrefs = [...new Set(manifest.records.flatMap((r) => r.brefs ?? []))];

interface Row { form: string; positive: number[]; negative: number[] }
const rows = new Map<string, Row>(FORMS.map((f) => [f.name, { form: f.name, positive: [], negative: [] }]));

for (const [n, record] of usable.entries()) {
  const windows = vectorsFor(record.id);
  if (windows.length === 0) continue;

  const tagged = new Set(record.brefs ?? []);
  const positives = [...tagged].map(passageOf).filter((p): p is Passage => p !== null).slice(0, 6);
  /* Negatives drawn from other episodes' tags rather than at random from the
     canon: they are real passages someone discusses somewhere, which is a far
     harder negative than an arbitrary verse and closer to the discrimination
     the ranking will actually have to make. */
  const negatives: Passage[] = [];
  for (let i = 0; negatives.length < 6 && i < allBrefs.length; i += 1) {
    const candidate = allBrefs[(i * 977 + n * 131) % allBrefs.length]!;
    if (tagged.has(candidate)) continue;
    const passage = passageOf(candidate);
    if (passage) negatives.push(passage);
  }
  if (positives.length === 0 || negatives.length === 0) continue;

  for (const form of FORMS) {
    const queries = [...positives, ...negatives].map(form.build);
    const embedded = await provider.embed(queries, "query");
    embedded.forEach((query, i) => {
      /* Max over the episode's windows: the claim under test is "this passage
         is discussed somewhere in here", so the best-matching moment is the
         evidence, not the average. */
      let best = -1;
      for (const window of windows) best = Math.max(best, dot(query, window));
      const row = rows.get(form.name)!;
      (i < positives.length ? row.positive : row.negative).push(best);
    });
  }
  if ((n + 1) % 5 === 0) console.log(`  ${n + 1}/${usable.length} episodes`);
}

// --- report -------------------------------------------------------------------

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** Probability a random positive outscores a random negative. 0.5 is chance. */
function auc(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length || 1);
}

console.log(`\n  form          n     pos    neg    gap     AUC`);
for (const form of FORMS) {
  const row = rows.get(form.name)!;
  const p = mean(row.positive);
  const q = mean(row.negative);
  console.log(
    `  ${form.name.padEnd(12)} ${String(row.positive.length).padStart(4)}  `
    + `${p.toFixed(3)}  ${q.toFixed(3)}  ${(p - q).toFixed(3)}   ${auc(row.positive, row.negative).toFixed(3)}`,
  );
}
console.log(`\n  AUC 0.5 = the passage tells you nothing about which episode discusses it.`);
