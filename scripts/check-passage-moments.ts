/**
 * Is the passage -> moments index any good?
 *
 *   node --import tsx scripts/check-passage-moments.ts [--show "Matthew 5"]
 *
 * The index was built without reading a single publisher tag. That makes the
 * tags a genuine held-out check rather than a circular one: if the open-world
 * ranking independently rediscovers what people who made the show said their
 * episodes were about, it is finding something real.
 *
 * Agreement is the measure, not accuracy. The tags are a curated highlight list
 * — measured earlier at ~18 per episode against a corpus that plainly discusses
 * more than that — so disagreement in either direction is expected and only
 * the RATE is informative. Compared against a chance floor computed the same
 * way with the chapters shuffled.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const INDEX = "/Volumes/External/Transcripts/passage-moments.json";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const index = JSON.parse(readFileSync(INDEX, "utf-8")) as {
  index: Array<{ bref: string; label: string; book: string; chapter: number;
    moments: Array<{ id: string; at: number; score: number }> }>;
};

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; title: string; brefs?: string[] }> };
const titles = new Map(manifest.records.map((r) => [r.id, r.title]));

/* Which book+chapter pairs the publisher tagged, per episode. */
const tagged = new Map<string, Set<string>>();
for (const record of manifest.records) {
  const set = new Set<string>();
  for (const bref of record.brefs ?? []) {
    const m = /^bref:v1\/([A-Z0-9]+)\.(\d+)/.exec(bref);
    if (m) set.add(`${m[1]}.${m[2]}`);
  }
  tagged.set(record.id, set);
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// --- a look at specific chapters -------------------------------------------------

const show = arg("show");
const wanted = show ? [show] : ["Genesis 1", "Matthew 5", "Romans 8", "1 Corinthians 13", "Exodus 20"];
for (const label of wanted) {
  const entry = index.index.find((c) => c.label.toLowerCase() === label.toLowerCase());
  if (!entry) { console.log(`\n${label}: not found`); continue; }
  console.log(`\n${entry.label}`);
  for (const moment of entry.moments.slice(0, 5)) {
    const key = `${entry.book}.${entry.chapter}`;
    const mark = tagged.get(moment.id)?.has(key) ? "tagged" : "      ";
    console.log(`  ${moment.score.toFixed(3)}  ${clock(moment.at).padStart(6)}  ${mark}  ${(titles.get(moment.id) ?? moment.id).slice(0, 52)}`);
  }
}

// --- agreement ------------------------------------------------------------------

/* Per episode: the chapters this index ranks it highest for, versus the ones
   the publisher tagged. */
const bestPerEpisode = new Map<string, Array<{ key: string; score: number }>>();
for (const entry of index.index) {
  for (const moment of entry.moments) {
    const list = bestPerEpisode.get(moment.id) ?? [];
    list.push({ key: `${entry.book}.${entry.chapter}`, score: moment.score });
    bestPerEpisode.set(moment.id, list);
  }
}

const allKeys = [...new Set(index.index.map((c) => `${c.book}.${c.chapter}`))];
let hitAt5 = 0; let hitAt10 = 0; let episodes = 0; let chanceHits = 0;

for (const [id, list] of bestPerEpisode) {
  const truth = tagged.get(id);
  if (!truth || truth.size === 0) continue;
  episodes += 1;
  const ranked = list.sort((a, b) => b.score - a.score).map((x) => x.key);
  const top5 = new Set(ranked.slice(0, 5));
  const top10 = new Set(ranked.slice(0, 10));
  if ([...truth].some((k) => top5.has(k))) hitAt5 += 1;
  if ([...truth].some((k) => top10.has(k))) hitAt10 += 1;

  /* Chance: five chapters drawn from the same pool, deterministically. */
  const draw = new Set<string>();
  for (let i = 0; draw.size < 5 && i < allKeys.length; i += 1) {
    draw.add(allKeys[(i * 7919 + id.length * 131) % allKeys.length]!);
  }
  if ([...truth].some((k) => draw.has(k))) chanceHits += 1;
}

const pct = (n: number): string => `${((n / (episodes || 1)) * 100).toFixed(1)}%`;
console.log(`\n\nagreement with publisher tags, over ${episodes} episodes`);
console.log(`  a tagged chapter is in the episode's top 5:   ${pct(hitAt5)}`);
console.log(`  ... top 10:                                   ${pct(hitAt10)}`);
console.log(`  same test with chapters drawn at random:      ${pct(chanceHits)}   <- chance`);
console.log(`\n  The index never read a tag. Agreement above chance means it is`);
console.log(`  independently finding what the show is about.`);
