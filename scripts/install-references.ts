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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const SOURCE = "/Volumes/External/Transcripts/codex-refs-all.jsonl";
const OUT_DIR = join(LIBRARY, ".artifacts/references");
const NAMES = join(REPO, "data/scripture/book-names-en.json");

const dryRun = process.argv.includes("--dry-run");

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

const RELATIONS = new Set(["subject", "crossref", "mention", "allusion"]);
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
      bref: `bref:v1/${row.book}.${row.chapter}.1`,
      book: row.book,
      chapter: row.chapter,
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

console.log(`${rows.length} extracted -> ${entries} entries across ${byEpisode.size} episodes`);
console.log(`  folded repeats:  ${rows.length - entries - refused}`);
console.log(`  refused:         ${refused}`);
console.log(`  per episode:     ${(entries / byEpisode.size).toFixed(1)}`);
console.log(`  relations:       ${[...relationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(dryRun ? `\n  (dry run)` : `\nwrote ${written} files to ${OUT_DIR}`);
