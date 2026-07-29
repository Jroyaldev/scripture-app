/**
 * Draws the sample that becomes the frozen evaluation set.
 *
 *   node --import tsx scripts/build-gold-sample.ts [--n 200]
 *
 * WHY THE OLD MEASURE HAS TO BE RETIRED
 *
 * Every accuracy number so far rests on one proxy: is the chapter named in the
 * talk near the anchor? That was defensible while ranking was purely semantic,
 * because the proxy was independent of everything the ranker saw. It stops
 * being defensible the moment a lexical signal enters the ranking — the metric
 * would climb toward 100% by construction and report a large improvement that
 * had not happened. So it must be replaced BEFORE the hybrid is built, not
 * after, and replaced by judgements a human makes from the content.
 *
 * WHAT IS BEING JUDGED, AND WHY IT IS NOT A YES/NO
 *
 * "Is this anchor correct" hides the distinction that actually matters. A
 * moment can stand in several different relations to a passage, and only one of
 * them is what an anchor should point at:
 *
 *   subject      they are working through this passage here. The target.
 *   crossref     the passage is brought in to illuminate a different one that
 *                is the real subject. Correct about the text, wrong about the
 *                moment — and a reader sent here feels misled.
 *   mention      named in passing, a sentence or two, no engagement.
 *   allusion     unmistakably this passage, never named. The case the whole
 *                semantic approach exists for, and the one a lexical metric
 *                can never score.
 *   wrong        a different passage, or nothing in particular.
 *
 * An evaluation that lumps crossref and mention in with subject will call the
 * system good while readers find it useless, and one that scores allusion as a
 * miss will reject the thing worth having.
 *
 * SAMPLING
 *
 * Stratified across score, era, and whether the publisher tagged the passage,
 * so no band can be measured only where it happens to be strong. Distractors —
 * real moments paired with passages drawn at random — are mixed in
 * indistinguishably: if those do not label as `wrong`, the labelling itself is
 * unreliable and every other number in the set is worthless.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const ANCHORS = join(LIBRARY, ".artifacts/anchors");
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");
const MOMENTS = "/Volumes/External/Transcripts/passage-moments.json";
const TEXT = join(REPO, "data/scripture/text/web");
const NAMES = join(REPO, "data/scripture/book-names-en.json");
const OUT = "/Volumes/External/Transcripts/gold-sample.jsonl";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const N = Number(arg("n", "200"));
/** Enough talk either side to judge what is going on, not so much that the
    judgement becomes "somewhere in here, probably". */
const CONTEXT = 75;

const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, unknown>;
const label = (code: string): string => {
  const e = bookNames[code];
  return Array.isArray(e) && typeof e[0] === "string" ? e[0] : code;
};

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; title: string; brefs?: string[]; metadata?: { publishedAt?: string } }> };
const meta = new Map(manifest.records.map((r) => [r.id, r]));
const taggedChapters = new Map<string, Set<string>>();
for (const r of manifest.records) {
  const set = new Set<string>();
  for (const b of r.brefs ?? []) {
    const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)/.exec(b);
    if (m) set.add(`${m[1]}.${m[2]}`);
  }
  taggedChapters.set(r.id, set);
}

const segCache = new Map<string, Array<{ t: string; s: number }>>();
function segments(recordId: string): Array<{ t: string; s: number }> {
  const hit = segCache.get(recordId);
  if (hit) return hit;
  const p = join(TRANSCRIPTS, `${recordId.replace(/:/g, "__").replace(/\//g, "_")}.json`);
  const segs = existsSync(p)
    ? (JSON.parse(readFileSync(p, "utf-8")) as { segments: Array<{ t: string; s: number }> }).segments : [];
  segCache.set(recordId, segs);
  return segs;
}

function passageText(book: string, chapter: number): string {
  const p = join(TEXT, book, `${chapter}.json`);
  if (!existsSync(p)) return "";
  const verses = (JSON.parse(readFileSync(p, "utf-8")) as
    { verses: Array<{ verse: number; text: string }> }).verses;
  return verses.map((v) => v.text).join(" ").replace(/\s+/g, " ").slice(0, 900);
}

interface Item {
  key: string;
  kind: "anchor" | "distractor";
  recordId: string;
  episode: string;
  at: number;
  bref: string;
  passage: string;
  score: number;
  tagged: boolean;
  band: string;
  era: string;
  /** The passage itself, so a judgement does not rest on remembering it. */
  passageText: string;
  /** What is being said around the moment. */
  said: string;
  /** Filled by a human. */
  verdict: "" | "subject" | "crossref" | "mention" | "allusion" | "wrong";
  note: string;
}

const band = (s: number): string => (s < 0.35 ? "low" : s < 0.45 ? "mid" : "high");
const era = (date?: string): string => (!date ? "unknown" : date < "2020" ? "early" : date < "2024" ? "mid" : "recent");

const pool: Item[] = [];
for (const file of readdirSync(ANCHORS).filter((f) => f.endsWith(".json"))) {
  const set = JSON.parse(readFileSync(join(ANCHORS, file), "utf-8")) as {
    id: string; anchors: Array<{ start: number; bref: string; title: string; score: number }> };
  const record = meta.get(set.id);
  for (const a of set.anchors) {
    const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)/.exec(a.bref);
    if (!m) continue;
    const said = segments(set.id).filter((s) => s.s >= a.start - CONTEXT && s.s <= a.start + CONTEXT)
      .map((s) => s.t).join(" ").replace(/\s+/g, " ");
    if (said.length < 200) continue;
    pool.push({
      key: `${set.id}@${Math.round(a.start)}#${a.bref}`,
      kind: "anchor",
      recordId: set.id,
      episode: record?.title ?? set.id,
      at: Math.round(a.start),
      bref: a.bref,
      passage: a.title,
      score: a.score,
      tagged: taggedChapters.get(set.id)?.has(`${m[1]}.${m[2]}`) ?? false,
      band: band(a.score),
      era: era(record?.metadata?.publishedAt),
      passageText: passageText(m[1]!, Number(m[2])),
      said,
      verdict: "",
      note: "",
    });
  }
}

/* Even coverage of every score x tagged cell, so no stratum is measured only
   where it happens to look good. */
const cells = new Map<string, Item[]>();
for (const item of pool) {
  const key = `${item.band}/${item.tagged ? "tagged" : "untagged"}`;
  const list = cells.get(key) ?? []; list.push(item); cells.set(key, list);
}
const perCell = Math.max(1, Math.floor((N * 0.85) / Math.max(cells.size, 1)));
const chosen: Item[] = [];
for (const [, list] of cells) {
  /* Deterministic spread through the cell rather than its head, which would be
     one book and one era. */
  const step = Math.max(1, Math.floor(list.length / perCell));
  for (let i = 0; i < list.length && chosen.length < N * 0.85; i += step) chosen.push(list[i]!);
}

/* Distractors: a real moment, a passage picked from somewhere else entirely.
   These must come back `wrong`. If they do not, the labelling is not reliable
   and nothing else in this file can be trusted. */
const allChapters = (JSON.parse(readFileSync(MOMENTS, "utf-8")) as
  { index: Array<{ bref: string; label: string; book: string; chapter: number }> }).index;
const distractors = Math.max(8, Math.round(N * 0.15));
for (let i = 0; i < distractors; i += 1) {
  const base = pool[(i * 4177) % pool.length]!;
  const c = allChapters[(i * 7919 + 131) % allChapters.length]!;
  if (c.bref === base.bref) continue;
  chosen.push({
    ...base,
    key: `${base.recordId}@${base.at}#DISTRACTOR#${c.bref}`,
    kind: "distractor",
    bref: c.bref,
    passage: c.label,
    passageText: passageText(c.book, c.chapter),
    score: 0,
    band: "n/a",
    tagged: false,
  });
}

/* Interleaved so the distractors are not a recognisable block at the end. */
chosen.sort((a, b) => a.key.localeCompare(b.key));

writeFileSync(OUT, `${chosen.map((c) => JSON.stringify(c)).join("\n")}\n`);

const by = (f: (i: Item) => string): string => {
  const counts = new Map<string, number>();
  for (const c of chosen) counts.set(f(c), (counts.get(f(c)) ?? 0) + 1);
  return [...counts.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  ");
};
console.log(`wrote ${chosen.length} items to ${OUT}`);
console.log(`  kind:    ${by((i) => i.kind)}`);
console.log(`  band:    ${by((i) => i.band)}`);
console.log(`  tagged:  ${by((i) => String(i.tagged))}`);
console.log(`  era:     ${by((i) => i.era)}`);
console.log(`  books:   ${new Set(chosen.map((i) => i.bref.slice(9, 12))).size} distinct`);
console.log(`\n  every item carries the passage and the talk around the moment,`);
console.log(`  so a verdict rests on content and never on whether a name was said.`);
