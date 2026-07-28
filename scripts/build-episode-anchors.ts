/**
 * Turns the passage -> moments index into per-episode anchors the dock can draw.
 *
 *   node --import tsx scripts/build-episode-anchors.ts [--dry-run]
 *
 * TIERS, AND WHY THERE ARE THREE
 *
 * Semantic similarity localizes well but does not, on its own, support the
 * claim that a passage is discussed somewhere nobody named it. Measured: a
 * moment on a passage the publisher tagged names the book 84.3% of the time,
 * one on an untagged passage 51.9%, and the gap does not close as the score
 * rises. So score alone earns a moment a place in the file and not on screen.
 *
 *   A   the passage is one the publisher named, and a window scores well.
 *       Semantic evidence is being used for WHERE, which is what it is good
 *       at, while what is discussed at all comes from elsewhere.
 *
 *   B   nobody tagged it, but two independent things agree: the score is high
 *       AND the talk around that moment names the book. Neither signal depends
 *       on the other, which is the whole reason two are required.
 *
 *   C   score only. Written, marked, never drawn. These are the candidates a
 *       future signal — a spoken reference, a matched quotation — could
 *       promote, and throwing them away would mean re-running everything to
 *       get them back.
 *
 * Publisher tags are used here as ONE tier's evidence, not as the candidate
 * gate: tier B exists precisely so a publisher who tags nothing still gets
 * anchors, and a corpus with no tags at all degrades to B and C rather than to
 * nothing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const INDEX = "/Volumes/External/Transcripts/passage-moments.json";
const TRANSCRIPTS = join(LIBRARY, ".artifacts/transcripts");
const OUT_DIR = join(LIBRARY, ".artifacts/anchors");
const NAMES = join(REPO, "data/scripture/book-names-en.json");

/** Where the two tiers cut. Both chosen from the measured curves rather than
    picked: below 0.30 tagged moments stop being reliably about the passage,
    and untagged ones need the higher bar because their floor is lower. */
const TIER_A_MIN = 0.30;
const TIER_B_MIN = 0.40;
/** A speaker names a book once and then talks about it for minutes. */
const HALO_SECONDS = 90;
/** Anchors per episode. A dock listing thirty passages has told nobody
    anything; the strongest few are the answer. */
const MAX_PER_EPISODE = 8;

const dryRun = process.argv.includes("--dry-run");

const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, unknown>;
function aliases(code: string): string[] {
  const entry = bookNames[code];
  if (Array.isArray(entry)) return entry.filter((x): x is string => typeof x === "string");
  if (typeof entry === "string") return [entry];
  return [code];
}

const index = JSON.parse(readFileSync(INDEX, "utf-8")) as {
  index: Array<{ bref: string; label: string; book: string; chapter: number;
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

const segmentCache = new Map<string, Array<{ t: string; s: number }>>();
function segmentsOf(recordId: string): Array<{ t: string; s: number }> {
  const hit = segmentCache.get(recordId);
  if (hit) return hit;
  const path = join(TRANSCRIPTS, `${recordId.replace(/:/g, "__").replace(/\//g, "_")}.json`);
  const segments = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as { segments: Array<{ t: string; s: number }> }).segments
    : [];
  segmentCache.set(recordId, segments);
  return segments;
}

function namesBook(recordId: string, at: number, book: string): boolean {
  const near = segmentsOf(recordId)
    .filter((s) => s.s >= at - HALO_SECONDS && s.s <= at + HALO_SECONDS)
    .map((s) => s.t).join(" ").toLowerCase();
  if (near.length === 0) return false;
  return aliases(book).some((alias) => {
    /* Word-boundary matched: the short aliases ("Ge", "Am", "Is") would
       otherwise fire inside ordinary words and manufacture exactly the
       confident-but-wrong anchor this whole design exists to avoid. */
    const needle = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`).test(near);
  });
}

interface Anchor {
  start: number;
  bref: string;
  title: string;
  tier: "A" | "B" | "C";
  score: number;
  /** Set when this anchor absorbed a neighbouring chapter. */
  spanEnd?: Anchor;
}

/** Two chapters are one discussion if they peak this close together. */
const MERGE_SECONDS = 120;

const brefParts = (a: Anchor): { book: string; chapter: number } => {
  const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)/.exec(a.bref);
  return { book: m?.[1] ?? "", chapter: Number(m?.[2] ?? 0) };
};
const bookOf = (a: Anchor): string => brefParts(a).book;
const chapterOf = (a: Anchor): number => brefParts(a).chapter;
const bookLabelOf = (a: Anchor): string => a.title.replace(/\s+[\d-]+$/, "");
/** A span from the first anchor's start to the last one's end. */
const spanBref = (from: Anchor, to: Anchor): string => {
  const start = /^bref:v1\/([A-Z0-9]+\.\d+\.\d+)/.exec(from.bref)?.[1];
  const end = /-([A-Z0-9]+\.\d+\.\d+)$/.exec(to.bref)?.[1];
  return start && end ? `bref:v1/${start}-${end}` : from.bref;
};

const byEpisode = new Map<string, Anchor[]>();
for (const entry of index.index) {
  for (const moment of entry.moments) {
    const isTagged = tagged.get(moment.id)?.has(`${entry.book}.${entry.chapter}`) ?? false;
    let tier: Anchor["tier"] = "C";
    if (isTagged && moment.score >= TIER_A_MIN) tier = "A";
    else if (!isTagged && moment.score >= TIER_B_MIN && namesBook(moment.id, moment.at, entry.book)) tier = "B";

    const list = byEpisode.get(moment.id) ?? [];
    list.push({ start: moment.at, bref: entry.bref, title: entry.label, tier, score: moment.score });
    byEpisode.set(moment.id, list);
  }
}

let written = 0;
const counts = { A: 0, B: 0, C: 0 };
let displayed = 0;

if (!dryRun) mkdirSync(OUT_DIR, { recursive: true });

for (const [recordId, anchors] of byEpisode) {
  for (const anchor of anchors) counts[anchor.tier] += 1;

  /* One anchor per passage: the same chapter can peak in several windows of
     one discussion, and three entries for Matthew 5 is three ways of saying
     the same thing. */
  const best = new Map<string, Anchor>();
  for (const anchor of anchors.filter((a) => a.tier !== "C")) {
    const held = best.get(anchor.bref);
    if (!held || anchor.score > held.score) best.set(anchor.bref, anchor);
  }

  /* Adjacent chapters peaking at the same moment are one discussion, not
     several: a talk that ranges over Deuteronomy 28-30 scores all three at the
     same window, and drawing three rows at 41:39 says the same thing three
     times while crowding out the rest of the episode. Runs of neighbouring
     chapters in one book, close in time, collapse into the span they actually
     are. */
  const merged: Anchor[] = [];
  for (const anchor of [...best.values()].sort((a, b) => a.start - b.start || chapterOf(a) - chapterOf(b))) {
    const prev = merged[merged.length - 1];
    if (
      prev
      && bookOf(prev) === bookOf(anchor)
      && Math.abs(anchor.start - prev.start) <= MERGE_SECONDS
      && chapterOf(anchor) - chapterOf(prev.spanEnd ?? prev) === 1
    ) {
      prev.spanEnd = anchor;
      prev.bref = spanBref(prev, anchor);
      prev.title = `${bookLabelOf(prev)} ${chapterOf(prev)}-${chapterOf(anchor)}`;
      /* The span keeps its strongest evidence rather than its last. */
      prev.score = Math.max(prev.score, anchor.score);
      if (anchor.tier < prev.tier) prev.tier = anchor.tier;
      continue;
    }
    merged.push({ ...anchor });
  }

  const shown = merged
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_EPISODE)
    /* Sorted by time on the way out. The dock finds the active span by scanning
       for the last start at or before the playhead and does not sort first, so
       an unordered list silently selects the wrong one. */
    .sort((a, b) => a.start - b.start);
  displayed += shown.length;

  if (!dryRun && shown.length > 0) {
    writeFileSync(
      join(OUT_DIR, `${recordId.replace(/:/g, "__").replace(/\//g, "_")}.json`),
      `${JSON.stringify({
        schema: "anchors/v1",
        generated: true,
        method: "centred-cosine-best-window",
        id: recordId,
        anchors: shown,
      })}\n`,
    );
    written += 1;
  }
}

console.log(`${byEpisode.size} episodes scored`);
console.log(`  tier A (tagged + score):        ${counts.A}`);
console.log(`  tier B (score + book named):    ${counts.B}`);
console.log(`  tier C (score only, not shown): ${counts.C}`);
console.log(`  anchors drawn:                  ${displayed}  across ${written || byEpisode.size} episodes`);
console.log(`  mean per episode:               ${(displayed / (byEpisode.size || 1)).toFixed(1)}`);
if (dryRun) console.log(`\n  (dry run — nothing written)`);
else console.log(`\nwrote ${written} files to ${OUT_DIR}`);
