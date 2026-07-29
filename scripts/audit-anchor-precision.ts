/**
 * Precision of every displayed anchor, against a strict proxy.
 *
 *   node --import tsx scripts/audit-anchor-precision.ts [--show 20]
 *
 * The earlier proxy asked whether the book was named near the anchor. That is
 * weak: an episode about Genesis says "Genesis" constantly, so a Genesis anchor
 * scores a hit wherever it lands in that episode. It measures the episode, not
 * the moment.
 *
 * This one asks whether the CHAPTER is named — the book together with its
 * number, within a couple of minutes, in any of the ways it is actually said
 * aloud: "Genesis 22", "Genesis chapter 22", "the twenty-second chapter". That
 * cannot be satisfied by an episode's general subject, so a hit is evidence
 * about the moment.
 *
 * It remains a proxy and it is one-sided: passages are discussed at length
 * without being numbered aloud, so a miss is not a wrong anchor. Only the hit
 * rate is informative, and only in comparison — against anchors of the same
 * tier, against the rate anywhere else in the same episode, and against what a
 * randomly chosen moment would score.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const ANCHORS = join(LIBRARY, ".artifacts/anchors");
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");
const NAMES = join(REPO, "data/scripture/book-names-en.json");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SHOW = Number(arg("show", "12"));
const HALO = 120;

const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, unknown>;
function aliases(code: string): string[] {
  const e = bookNames[code];
  if (Array.isArray(e)) return e.filter((x): x is string => typeof x === "string");
  if (typeof e === "string") return [e];
  return [code];
}

const ORDINALS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
/** The ways a chapter number is actually said. */
function numberForms(n: number): string[] {
  const forms = [String(n)];
  if (n <= 20) forms.push(ORDINALS[n]!);
  else if (n < 100) {
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"][Math.floor(n / 10)]!;
    const unit = n % 10;
    forms.push(unit === 0 ? tens : `${tens}[ -]?${ORDINALS[unit]}`);
  }
  return forms;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namesChapter(text: string, book: string, chapter: number): boolean {
  const nums = numberForms(chapter).join("|");
  return aliases(book).some((alias) => {
    const b = escape(alias.toLowerCase());
    /* "Genesis 22", "Genesis chapter 22", "Genesis, chapter twenty-two" —
       allowing a few filler words between the name and the number, because
       speech puts them there. */
    return new RegExp(`(^|[^a-z])${b}[,]?\\s*(chapter\\s+)?(${nums})([^0-9a-z]|$)`).test(text);
  });
}

const segCache = new Map<string, Array<{ t: string; s: number }>>();
function segmentsOf(recordId: string): Array<{ t: string; s: number }> {
  const hit = segCache.get(recordId);
  if (hit) return hit;
  const p = join(TRANSCRIPTS, `${recordId.replace(/:/g, "__").replace(/\//g, "_")}.json`);
  const segs = existsSync(p)
    ? (JSON.parse(readFileSync(p, "utf-8")) as { segments: Array<{ t: string; s: number }> }).segments : [];
  segCache.set(recordId, segs);
  return segs;
}
function textAround(recordId: string, at: number, halo = HALO): string {
  return segmentsOf(recordId).filter((s) => s.s >= at - halo && s.s <= at + halo)
    .map((s) => s.t).join(" ").toLowerCase();
}

interface Row { id: string; title: string; start: number; book: string; chapter: number; tier: string; score: number; hit: boolean; elsewhere: boolean }
const rows: Row[] = [];

for (const file of readdirSync(ANCHORS).filter((f) => f.endsWith(".json"))) {
  const set = JSON.parse(readFileSync(join(ANCHORS, file), "utf-8")) as {
    id: string; anchors: Array<{ start: number; bref: string; title: string; tier: string; score: number }> };
  const segs = segmentsOf(set.id);
  if (segs.length === 0) continue;
  const whole = segs.map((s) => s.t).join(" ").toLowerCase();

  for (const a of set.anchors) {
    const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)/.exec(a.bref);
    if (!m) continue;
    const book = m[1]!;
    const chapter = Number(m[2]);
    rows.push({
      id: set.id, title: a.title, start: a.start, book, chapter, tier: a.tier, score: a.score,
      hit: namesChapter(textAround(set.id, a.start), book, chapter),
      /* Is the chapter named ANYWHERE in this episode? If it is named somewhere
         else but not here, the anchor found the wrong moment in a right
         episode — a different and milder failure than finding the wrong
         passage entirely, and worth counting separately. */
      elsewhere: namesChapter(whole, book, chapter),
    });
  }
}

/* What a randomly placed anchor would score, using the same anchors moved to a
   random point in their own episode. Any lift over this is localization. */
let shuffled = 0;
rows.forEach((r, i) => {
  const segs = segmentsOf(r.id);
  const span = segs.length > 0 ? segs[segs.length - 1]!.s : 0;
  const at = ((i * 7919) % Math.max(1, Math.floor(span))) || 1;
  if (namesChapter(textAround(r.id, at), r.book, r.chapter)) shuffled += 1;
});

const rate = (xs: Row[]): string => `${((xs.filter((r) => r.hit).length / (xs.length || 1)) * 100).toFixed(1)}%`;
const A = rows.filter((r) => r.tier === "A");
const B = rows.filter((r) => r.tier === "B");

console.log(`${rows.length} displayed anchors across ${new Set(rows.map((r) => r.id)).size} episodes\n`);
console.log(`  the CHAPTER is named within ${HALO}s of the anchor:`);
console.log(`    all anchors        ${rate(rows)}   (n=${rows.length})`);
console.log(`    tier A             ${rate(A)}   (n=${A.length})`);
console.log(`    tier B             ${rate(B)}   (n=${B.length})`);
console.log(`    same anchors, moved to a random point in their own episode:  ${((shuffled / rows.length) * 100).toFixed(1)}%   <- chance`);

const named = rows.filter((r) => r.elsewhere);
const namedHit = named.filter((r) => r.hit);
console.log(`\n  of the ${named.length} anchors whose chapter IS named somewhere in the episode,`);
console.log(`  ${namedHit.length} (${((namedHit.length / (named.length || 1)) * 100).toFixed(1)}%) are pointing at a place where it is named.`);
console.log(`  That is the localization question with the recall problem removed.`);

console.log(`\n  by score`);
for (const [lo, hi] of [[0.30, 0.35], [0.35, 0.40], [0.40, 0.45], [0.45, 0.50], [0.50, 1]] as const) {
  const band = rows.filter((r) => r.score >= lo && r.score < hi);
  if (band.length < 15) continue;
  console.log(`    ${lo.toFixed(2)}-${hi === 1 ? " +  " : hi.toFixed(2)}   ${rate(band).padStart(6)}  (n=${band.length})`);
}

const misses = rows.filter((r) => !r.hit && r.elsewhere).sort((a, b) => b.score - a.score);
if (misses.length > 0) {
  console.log(`\n  highest-scoring anchors that missed a chapter named elsewhere in the episode:`);
  for (const r of misses.slice(0, SHOW)) {
    console.log(`    ${r.score.toFixed(3)}  ${String(Math.floor(r.start / 60))}:${String(Math.round(r.start % 60)).padStart(2, "0")}  ${r.title.padEnd(20)} ${r.id.replace("bibleproject:podcast:", "").slice(0, 34)}`);
  }
}
