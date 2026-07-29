/**
 * Splits the extracted reference catalogue into per-episode files the app reads.
 *
 *   node --import tsx scripts/install-references.ts [--dry-run]
 *
 * One file per episode, keyed the way transcripts and anchors are, so the
 * loader can find them from a record id without an index.
 *
 * Two shaping decisions, both about what a reader should see rather than what
 * the extractor found:
 *
 *   The same passage discussed at several separate points is several entries,
 *   and that is right in the data — but a list that says "Genesis 22" four
 *   times has told a reader one thing four times. The longest treatment wins
 *   and the rest are folded into a count, so the entry can say it came up more
 *   than once without spending four rows saying so.
 *
 *   Relations are kept, not flattened. "This episode works through Genesis 19"
 *   and "Genesis 19 comes up at 39:15" are different claims, the second is the
 *   one no other tool offers, and collapsing them would throw away the
 *   distinction that makes the list worth reading.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
/* Which extraction to install. Per-episode files are keyed by record id, so
   installing a second publisher adds files rather than replacing any — and
   running this against a job still in flight installs whatever has landed,
   because the extractor writes after each episode rather than at the end. */
const SOURCE = process.argv.includes("--from")
  ? process.argv[process.argv.indexOf("--from") + 1]!
  : "/Volumes/External/Transcripts/codex-refs-all.jsonl";
const OUT_DIR = join(LIBRARY, ".artifacts/references");
const NAMES = join(REPO, "data/scripture/book-names-en.json");

const dryRun = process.argv.includes("--dry-run");

/* How many verses each chapter holds, so a range covering all of them can be
   recognised for what it is. Genesis 1 has 31 verses, so "1-31" and "the whole
   chapter" are the same claim written two ways — and left unnormalised they
   landed in different sections purely because of how a reference happened to
   be recorded. */
const chapterLengths = new Map<string, number>();
try {
  const textRoot = join(REPO, "data/scripture/text/web");
  for (const book of readdirSync(textRoot)) {
    for (const file of readdirSync(join(textRoot, book))) {
      if (!file.endsWith(".json")) continue;
      const verses = (JSON.parse(readFileSync(join(textRoot, book, file), "utf-8")) as
        { verses: Array<{ verse: number }> }).verses;
      if (verses.length > 0) {
        chapterLengths.set(`${book}.${Number(file.replace(".json", ""))}`, verses[verses.length - 1]!.verse);
      }
    }
  }
} catch { /* without the text the ranges simply stay as spoken */ }

/** A range covering the chapter IS the chapter. */
function normaliseVerses(book: string, chapter: number, verses: string | null): string | null {
  const span = verseSpan(verses);
  const length = chapterLengths.get(`${book}.${chapter}`);
  if (!span || !length) return verses;
  return span.from <= 1 && span.to >= length ? null : verses;
}

const bookNames = JSON.parse(readFileSync(NAMES, "utf-8")) as Record<string, string[] | string>;
const label = (code: string): string => {
  const e = bookNames[code];
  return Array.isArray(e) && typeof e[0] === "string" ? e[0] : code;
};

interface Raw {
  recordId: string; book: string; chapter: number; verses: string | null;
  at: number; until: number; seconds: number;
  relation: string; named: boolean; confidence: string; evidence: string;
}

const rows = readFileSync(SOURCE, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as Raw);

/* Enough of each episode for a moment to be pressed rather than merely read.
   Carried into the index at build time rather than looked up in the renderer:
   the alternative is the margin holding every publisher's catalogue in memory
   to resolve a title, which is a lot of machinery to avoid copying four
   fields. */
interface EpisodeFacts { episode: string; sourceId: string; sourceName: string; audioUrl: string; officialUrl: string; kind: string }
const episodeFacts = new Map<string, EpisodeFacts>();
for (const sourceId of ["bibleproject", "naked-bible"]) {
  try {
    const m = JSON.parse(readFileSync(
      join(LIBRARY, ".artifacts/resources", sourceId, "manifest.json"), "utf-8",
    )) as { source: { name: string }; records: Array<Record<string, string>> };
    for (const r of m.records) {
      if (!r["audioUrl"]) continue;
      episodeFacts.set(r["id"]!, {
        episode: r["title"] ?? r["id"]!, sourceId, sourceName: m.source.name,
        audioUrl: r["audioUrl"], officialUrl: r["officialUrl"] ?? "", kind: r["kind"] ?? "podcast",
      });
    }
  } catch { /* a source with no installed manifest simply contributes none */ }
}

const RELATIONS = new Set(["subject", "crossref", "mention", "allusion"]);

/** First and last verse a range touches — "8-9,16-17" spans 8 to 17. */
export function verseSpan(verses: string | null): { from: number; to: number } | null {
  if (!verses) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const part of verses.split(",")) {
    const [a, b] = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (!Number.isFinite(a)) continue;
    from = Math.min(from, a!);
    to = Math.max(to, Number.isFinite(b) ? b! : a!);
  }
  return Number.isFinite(from) ? { from, to } : null;
}

function brefFor(book: string, chapter: number, verses: string | null): string {
  const span = verseSpan(verses);
  if (!span) return `bref:v1/${book}.${chapter}.1`;
  return span.from === span.to
    ? `bref:v1/${book}.${chapter}.${span.from}`
    : `bref:v1/${book}.${chapter}.${span.from}-${book}.${chapter}.${span.to}`;
}
const byEpisode = new Map<string, Raw[]>();
let refused = 0;
for (const row of rows) {
  /* The same shape check the loader will apply, run here so a bad row is
     dropped once at install rather than every time an episode is opened. */
  if (!RELATIONS.has(row.relation) || !Number.isFinite(row.at) || !Number.isFinite(row.chapter)) {
    refused += 1;
    continue;
  }
  const list = byEpisode.get(row.recordId) ?? [];
  list.push(row);
  byEpisode.set(row.recordId, list);
}

let written = 0;
let entries = 0;
const relationCounts = new Map<string, number>();

if (!dryRun) mkdirSync(OUT_DIR, { recursive: true });

for (const [recordId, raws] of byEpisode) {
  /* Fold repeats of one passage into their longest treatment. */
  const best = new Map<string, Raw & { times: number }>();
  for (const row of raws) {
    const key = `${row.book}.${row.chapter}`;
    const held = best.get(key);
    if (!held) { best.set(key, { ...row, times: 1 }); continue; }
    held.times += 1;
    if (row.seconds > held.seconds) {
      /* Keep the count, take the longer treatment's position and relation. */
      const times = held.times;
      best.set(key, { ...row, times });
    }
  }

  const references = [...best.values()]
    .map((row) => ({
      /* The bref names the verses actually discussed, not the top of the
         chapter. Pinning every reference to verse 1 rendered correctly — the
         range survived in the title — while making the record unreasonable
         about and sending a press to the wrong line. */
      bref: brefFor(row.book, row.chapter, normaliseVerses(row.book, row.chapter, row.verses)),
      book: row.book,
      chapter: row.chapter,
      verses: normaliseVerses(row.book, row.chapter, row.verses),
      title: `${label(row.book)} ${row.chapter}${row.verses ? `:${row.verses}` : ""}`,
      at: Math.round(row.at),
      seconds: Math.max(0, Math.round(row.seconds)),
      relation: row.relation,
      named: row.named === true,
      times: row.times,
      /* The one field carrying the publisher's own words. Kept because a
         reader who can see why a claim was made can correct it in a glance,
         and withheld from the panel itself — it belongs on demand, not in the
         way. */
      evidence: String(row.evidence ?? "").slice(0, 160),
    }))
    /* Ordered by time. The dock finds the active span by scanning for the last
       start at or before the playhead and does not sort first. */
    .sort((a, b) => a.at - b.at);

  for (const r of references) relationCounts.set(r.relation, (relationCounts.get(r.relation) ?? 0) + 1);
  entries += references.length;

  if (!dryRun) {
    writeFileSync(
      join(OUT_DIR, `${recordId.replace(/:/g, "__").replace(/\//g, "_")}.json`),
      `${JSON.stringify({
        schema: "references/v1",
        generated: true,
        method: "transcript-read",
        id: recordId,
        references,
      })}\n`,
    );
    written += 1;
  }
}

/* The inverse index: for each chapter, which episodes teach it and where.
 *
 * This is the read that matters. Episode -> passages is a footnote list on
 * something a reader already chose; passage -> moments answers the question
 * they actually arrive with — I am reading Romans 8, who has taught this.
 *
 * Ranked by SECONDS, and by nothing else. Two publishers with opposite formats
 * were measured: share of episode and relation counts both swing wildly between
 * them (a "subject" runs 102 seconds on one and 435 on the other), while the
 * duration distributions sit almost on top of each other — median 36s against
 * 30s. Seconds is the one quantity that means the same thing in both, so it is
 * the only one safe to rank across publishers on.
 *
 * Relation rides along as a label. It says what KIND of engagement a moment is,
 * which is worth showing; it just cannot order anything, because what a
 * publisher calls a subject depends on how that publisher makes episodes.
 */
const inverse = new Map<string, Array<Record<string, unknown>>>();
for (const [recordId, raws] of byEpisode) {
  const best = new Map<string, Raw>();
  for (const row of raws) {
    const key = `${row.book}.${row.chapter}`;
    const held = best.get(key);
    if (!held || row.seconds > held.seconds) best.set(key, row);
  }
  for (const [key, row] of best) {
    const list = inverse.get(key) ?? [];
    const facts = episodeFacts.get(recordId);
    if (!facts) continue;
    list.push({
      id: recordId,
      ...facts,
      at: Math.round(row.at),
      seconds: Math.max(0, Math.round(row.seconds)),
      relation: row.relation,
      /* The verse range, kept as data rather than only as display text.
         Three quarters of references carry one, and discarding it made every
         moment look chapter-wide — so a reader on Romans 8:28 was shown the
         same list as a reader on 8:1, which is most of what a passage index is
         supposed to tell apart. */
      verses: normaliseVerses(row.book, row.chapter, row.verses),
      title: `${label(row.book)} ${row.chapter}${normaliseVerses(row.book, row.chapter, row.verses) ? `:${row.verses}` : ""}`,
    });
    inverse.set(key, list);
  }
}

const index = [...inverse.entries()]
  .map(([key, moments]) => {
    const [book, chapter] = key.split(".");
    return {
      bref: `bref:v1/${book}.${chapter}.1`,
      book,
      chapter: Number(chapter),
      /* Longest first, and no cut — a reader asking who teaches a passage is
         better served by a short honest list than a padded one, and the
         shortest entries are still true. */
      moments: moments.sort((a, b) => Number(b["seconds"]) - Number(a["seconds"])),
    };
  })
  .sort((a, b) => a.book.localeCompare(b.book) || a.chapter - b.chapter);

if (!dryRun) {
  writeFileSync(join(LIBRARY, ".artifacts", "passage-index.json"), `${JSON.stringify({
    schema: "passage-index/v1",
    generated: true,
    ranking: "seconds",
    chapters: index.length,
    index,
  })}\n`);
}

console.log(`${rows.length} extracted -> ${entries} entries across ${byEpisode.size} episodes`);
console.log(`  inverse index:   ${index.length} chapters, ${index.reduce((n, c) => n + c.moments.length, 0)} moments`);
console.log(`  folded repeats:  ${rows.length - entries - refused}`);
console.log(`  refused:         ${refused}`);
console.log(`  per episode:     ${(entries / byEpisode.size).toFixed(1)}`);
console.log(`  relations:       ${[...relationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(dryRun ? `\n  (dry run)` : `\nwrote ${written} files to ${OUT_DIR}`);
