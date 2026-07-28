/**
 * Structural QA over transcripts, run before any of them are trusted.
 *
 * None of these checks needs a reference transcript or a human listening, which
 * is what makes them worth running on all 528 rather than on a sample. They do
 * not measure whether the words are RIGHT — that needs the official transcripts
 * and is a separate pass. They measure whether the timing is USABLE, which is
 * the property the transcript-following feature actually rests on.
 *
 * The checks, and what each one catches:
 *
 *   coverage      the last word should land near the end of the audio. A
 *                 transcript whose words stop at 40 minutes of a 56-minute
 *                 episode failed, and this says so for free. Catches
 *                 truncation, early stopping, and gross drift.
 *   monotonic     word starts must not go backwards. The player picks a span by
 *                 scanning for the last start at or before the playhead and
 *                 does not sort first, so a single inversion silently selects
 *                 the wrong line.
 *   well-formed   end > start for every word. Real aligners have been measured
 *                 emitting inversions; a negative-length word is a bug that
 *                 renders as a highlight that never clears.
 *   density       words per minute, against conversational speech at roughly
 *                 130-190. Far below suggests dropped audio; far above suggests
 *                 a repetition loop, which is the classic long-audio failure.
 *   gaps          a silence longer than the threshold is usually real (music, a
 *                 pause), but a very long one can mean a chunk was dropped at a
 *                 boundary. Reported, not failed.
 *
 *   node check_transcripts.mjs [--dir <path>] [--inventory <path>]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_DIR = "/Volumes/External/Transcripts/raw";
const DEFAULT_INVENTORY = "/Volumes/External/Transcripts/inventory.json";

/* Words may legitimately end after the last one starts, and an episode often
   ends with music or an outro, so "near the end" is generous on purpose. The
   point is to catch transcripts that stop MUCH too early, not to police the
   final few seconds. */
const COVERAGE_FLOOR = 0.9;
const WPM_LOW = 90;
const WPM_HIGH = 220;
const GAP_SECONDS = 45;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = resolve(arg("dir", DEFAULT_DIR));
const inventory = JSON.parse(readFileSync(resolve(arg("inventory", DEFAULT_INVENTORY)), "utf-8"));
const durations = new Map(inventory.episodes.map((e) => [e.id, e.durationSeconds]));

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.log(`no transcripts in ${dir}`);
  process.exit(0);
}

const rows = [];
for (const file of files) {
  const t = JSON.parse(readFileSync(join(dir, file), "utf-8"));
  const words = t.words ?? [];
  const audio = durations.get(t.id) ?? t.audioSeconds ?? null;

  let inversions = 0;
  let backwards = 0;
  let longestGap = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].e < words[i].s) inversions += 1;
    if (i > 0) {
      if (words[i].s < words[i - 1].s) backwards += 1;
      const gap = words[i].s - words[i - 1].e;
      if (gap > longestGap) longestGap = gap;
    }
  }

  const lastEnd = words.length > 0 ? words[words.length - 1].e : 0;
  const coverage = audio ? lastEnd / audio : null;
  const wpm = audio && audio > 0 ? (words.length / (audio / 60)) : null;

  const problems = [];
  if (words.length === 0) problems.push("EMPTY");
  if (coverage !== null && coverage < COVERAGE_FLOOR) {
    problems.push(`SHORT ${(coverage * 100).toFixed(0)}%`);
  }
  if (backwards > 0) problems.push(`NON-MONOTONIC ${backwards}`);
  if (inversions > 0) problems.push(`INVERTED ${inversions}`);
  if (wpm !== null && wpm < WPM_LOW) problems.push(`SPARSE ${wpm.toFixed(0)}wpm`);
  if (wpm !== null && wpm > WPM_HIGH) problems.push(`DENSE ${wpm.toFixed(0)}wpm`);

  rows.push({
    id: t.id, generated: t.generated === true, model: t.model,
    words: words.length, audio, coverage, wpm, longestGap, problems,
  });
}

rows.sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0));

const bad = rows.filter((r) => r.problems.length > 0);
const gappy = rows.filter((r) => r.longestGap > GAP_SECONDS && r.problems.length === 0);
/* Provenance is a contract, not decoration: a transcript that does not declare
   itself machine-generated could be rendered as though a person wrote it. */
const unlabelled = rows.filter((r) => !r.generated || !r.model);

console.log(`checked ${rows.length} transcripts in ${dir}\n`);
console.log(`  clean:              ${rows.length - bad.length}`);
console.log(`  with problems:      ${bad.length}`);
console.log(`  unlabelled:         ${unlabelled.length}`);
const cov = rows.filter((r) => r.coverage !== null).map((r) => r.coverage);
if (cov.length > 0) {
  const mean = cov.reduce((a, b) => a + b, 0) / cov.length;
  console.log(`  coverage:           min ${(Math.min(...cov) * 100).toFixed(1)}%  mean ${(mean * 100).toFixed(1)}%`);
}
const wpms = rows.filter((r) => r.wpm !== null).map((r) => r.wpm);
if (wpms.length > 0) {
  wpms.sort((a, b) => a - b);
  console.log(`  words/min:          min ${wpms[0].toFixed(0)}  median ${wpms[Math.floor(wpms.length / 2)].toFixed(0)}  max ${wpms[wpms.length - 1].toFixed(0)}`);
}

if (bad.length > 0) {
  console.log(`\nPROBLEMS`);
  for (const r of bad) {
    console.log(`  ${r.id.replace("bibleproject:podcast:", "")}`);
    console.log(`    ${r.problems.join("  ")}   words=${r.words} audio=${r.audio ? `${(r.audio / 60).toFixed(1)}m` : "?"}`);
  }
}
if (gappy.length > 0) {
  console.log(`\nlong silences (informational, not failures)`);
  for (const r of gappy.slice(0, 10)) {
    console.log(`  ${r.longestGap.toFixed(0)}s  ${r.id.replace("bibleproject:podcast:", "")}`);
  }
}
if (unlabelled.length > 0) {
  console.log(`\nMISSING PROVENANCE — must not ship`);
  for (const r of unlabelled) console.log(`  ${r.id}`);
}

process.exitCode = bad.length > 0 || unlabelled.length > 0 ? 1 : 0;
