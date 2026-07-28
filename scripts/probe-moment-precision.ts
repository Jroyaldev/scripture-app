/**
 * Are the moments the publisher never tagged any good, and above what score?
 *
 *   node --import tsx scripts/probe-moment-precision.ts
 *
 * Agreement with publisher tags reached 93%, but that number can only speak
 * about moments the publisher happened to tag. The moments it did NOT tag are
 * both the reason for building an open-world index and the place trust would be
 * lost, and nothing so far has said whether they are real.
 *
 * The check is the same proxy used to choose the scorer, applied to a different
 * question: does the transcript around the moment name the book? It is weak
 * per-moment — a passage can be discussed at length without its name being
 * said — but across thousands of moments the RATE is meaningful, and it is
 * independent of the tags, which is what makes it usable here.
 *
 * The output that matters is the score threshold: the point below which
 * untagged moments stop looking like real ones. That is the number a display
 * rule needs, and it cannot be guessed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const INDEX = "/Volumes/External/Transcripts/passage-moments.json";
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");
const NAMES = join(REPO, "data/scripture/book-names-en.json");

const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, unknown>;
function aliases(code: string): string[] {
  const entry = bookNames[code];
  if (Array.isArray(entry)) return entry.filter((x): x is string => typeof x === "string");
  if (typeof entry === "string") return [entry];
  return [code];
}

const index = JSON.parse(readFileSync(INDEX, "utf-8")) as {
  index: Array<{ book: string; chapter: number; label: string;
    moments: Array<{ id: string; at: number; score: number }> }>;
};

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; brefs?: string[] }> };

const tagged = new Map<string, Set<string>>();
for (const record of manifest.records) {
  const set = new Set<string>();
  for (const bref of record.brefs ?? []) {
    const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)/.exec(bref);
    if (m) set.add(`${m[1]}.${m[2]}`);
  }
  tagged.set(record.id, set);
}

/* Transcript text, cached — every episode is read once however many moments
   land in it. */
const textCache = new Map<string, Array<{ t: string; s: number }>>();
function segmentsOf(recordId: string): Array<{ t: string; s: number }> {
  const hit = textCache.get(recordId);
  if (hit) return hit;
  const path = join(TRANSCRIPTS, `${recordId.replace(/:/g, "__").replace(/\//g, "_")}.json`);
  const segments = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as { segments: Array<{ t: string; s: number }> }).segments
    : [];
  textCache.set(recordId, segments);
  return segments;
}

/** Does the talk around this moment name the book? A generous window, because
    a speaker names a book once and then discusses it for minutes. */
const HALO = 90;
function namesBook(recordId: string, at: number, book: string): boolean {
  const segments = segmentsOf(recordId);
  if (segments.length === 0) return false;
  const near = segments.filter((s) => s.s >= at - HALO && s.s <= at + HALO)
    .map((s) => s.t).join(" ").toLowerCase();
  if (near.length === 0) return false;
  return aliases(book).some((alias) => {
    /* Word-boundary matched: "Ge" must not fire inside "get", and the short
       aliases are exactly the ones that would. */
    const needle = alias.toLowerCase();
    return new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(near);
  });
}

interface Row { score: number; tagged: boolean; named: boolean }
const rows: Row[] = [];
for (const entry of index.index) {
  for (const moment of entry.moments) {
    const key = `${entry.book}.${entry.chapter}`;
    rows.push({
      score: moment.score,
      tagged: tagged.get(moment.id)?.has(key) ?? false,
      named: namesBook(moment.id, moment.at, entry.book),
    });
  }
}

const rate = (xs: Row[]): string => `${((xs.filter((r) => r.named).length / (xs.length || 1)) * 100).toFixed(1)}%`;
const T = rows.filter((r) => r.tagged);
const U = rows.filter((r) => !r.tagged);

console.log(`${rows.length} moments — ${T.length} tagged, ${U.length} untagged\n`);
console.log(`  the talk near the moment names the book:`);
console.log(`    tagged moments      ${rate(T)}`);
console.log(`    untagged moments    ${rate(U)}`);

/* The comparison that matters: an untagged moment scoring 0.45 should look
   like a tagged moment scoring 0.45 if the score means the same thing for
   both. Where the two curves diverge is where the untagged ones stop being
   trustworthy. */
console.log(`\n  score      tagged            untagged`);
const bands = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
for (let i = 0; i < bands.length; i += 1) {
  const lo = bands[i]!;
  const hi = bands[i + 1] ?? 1;
  const t = T.filter((r) => r.score >= lo && r.score < hi);
  const u = U.filter((r) => r.score >= lo && r.score < hi);
  if (t.length + u.length < 20) continue;
  console.log(
    `  ${lo.toFixed(2)}-${hi === 1 ? "  + " : hi.toFixed(2)}  `
    + `${rate(t).padStart(6)} (n=${String(t.length).padStart(4)})   `
    + `${rate(u).padStart(6)} (n=${String(u.length).padStart(4)})`,
  );
}

/* What a display rule would cost and buy at each cut. */
console.log(`\n  cutoff   moments kept   of those, untagged   names the book`);
for (const cut of [0.30, 0.35, 0.40, 0.45, 0.50]) {
  const kept = rows.filter((r) => r.score >= cut);
  const keptU = kept.filter((r) => !r.tagged);
  console.log(
    `  ${cut.toFixed(2)}     ${String(kept.length).padStart(6)}        `
    + `${String(keptU.length).padStart(6)} (${((keptU.length / (kept.length || 1)) * 100).toFixed(0)}%)          ${rate(kept)}`,
  );
}
