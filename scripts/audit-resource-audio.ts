/**
 * Which cards will draw no play button, and why.
 *
 * A record that links but cannot play is invisible from here and obvious in the
 * app — it is the reader who finds it, one card at a time, which is how the
 * last several were found. This turns that into one command.
 *
 * Every silent record is put in exactly one bucket, because the buckets are
 * different kinds of work:
 *
 *   no-media-host    the source may not carry audio at all — a permission
 *                    question, not a data one
 *   absent           the episode is in no feed we read; nothing to join to
 *   ambiguous        its title is too generic to match on safely, and matching
 *                    it anyway is how a card ends up playing another episode
 *   reachable        a feed episode matches it well and we are simply missing
 *                    it — a bug, and the only bucket that is one
 *
 * Usage:
 *   node --import tsx scripts/audit-resource-audio.ts [--source bibleproject]
 *        [--feed <path|url>,…] [--list] [--json]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveManifestPath } from "./resource-import-target.js";
import { significantWords } from "../src/core/resources/episode-title.js";
import type { TrustedResourceManifestV1 } from "../src/core/resources/trusted-resources.js";

const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";
/** Where a publisher's episode audio is catalogued, when it is not on their pages. */
const KNOWN_FEEDS: Record<string, string[]> = {
  bibleproject: [
    "https://feeds.simplecast.com/3NVmUWZO",
    "https://feeds.simplecast.com/zovPCGLI",
  ],
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sourceId = arg("source") ?? "bibleproject";
const feedSources = arg("feed")?.split(",").map((one) => one.trim()).filter(Boolean)
  ?? KNOWN_FEEDS[sourceId] ?? [];
const listAll = process.argv.includes("--list");
const asJson = process.argv.includes("--json");

const manifestPath = arg("manifest") ?? resolveManifestPath(sourceId).path;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TrustedResourceManifestV1;

const decode = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .trim();

async function feedTitles(source: string): Promise<string[]> {
  const xml = /^https?:/.test(source)
    ? await (async () => {
        const response = await fetch(source, { headers: { "user-agent": USER_AGENT } });
        if (!response.ok) throw new Error(`${source} -> ${response.status}`);
        return response.text();
      })()
    : readFileSync(source, "utf8");
  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? [])
    .map((item) => /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(item)?.[1] ?? "")
    .map((title) => decode(title.trim()))
    .filter(Boolean);
}

const catalogue: string[] = [];
for (const source of feedSources) {
  try { catalogue.push(...(await feedTitles(source))); }
  catch (error) { console.error(`  ! could not read ${source}: ${(error as Error).message}`); }
}

/* The same measure the importer joins on, so a record called reachable here is
   one the importer could actually have taken. A private copy would drift. */
const MIN_WORDS = 3;
const REACHABLE = 0.8;

type Bucket = "no-media-host" | "absent" | "ambiguous" | "reachable";
const findings: Array<{ bucket: Bucket; title: string; nearest?: string; score?: number }> = [];

const declaresMedia = (manifest.source.mediaHosts?.length ?? 0) > 0;
const silent = manifest.records.filter((record) => !record.audioUrl);

for (const record of silent) {
  if (!declaresMedia) { findings.push({ bucket: "no-media-host", title: record.title }); continue; }
  const mine = significantWords(record.title);
  if (mine.size < MIN_WORDS) { findings.push({ bucket: "ambiguous", title: record.title }); continue; }
  let best = 0;
  let nearest = "";
  for (const candidate of catalogue) {
    const theirs = significantWords(candidate);
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared += 1;
    const score = shared / mine.size;
    if (score > best) { best = score; nearest = candidate; }
  }
  findings.push(best >= REACHABLE
    ? { bucket: "reachable", title: record.title, nearest, score: Number(best.toFixed(2)) }
    : { bucket: "absent", title: record.title });
}

const counted = (bucket: Bucket): number => findings.filter((one) => one.bucket === bucket).length;

if (asJson) {
  console.log(JSON.stringify({ sourceId, records: manifest.records.length, silent: silent.length, findings }, null, 2));
} else {
  console.log(`${manifest.source.name}: ${manifest.records.length} records, ${manifest.records.length - silent.length} playable`);
  console.log(`  silent: ${silent.length}`);
  console.log(`     reachable      ${String(counted("reachable")).padStart(4)}   <- bugs; a feed episode matches`);
  console.log(`     ambiguous      ${String(counted("ambiguous")).padStart(4)}   title too generic to join on safely`);
  console.log(`     absent         ${String(counted("absent")).padStart(4)}   in none of the ${feedSources.length} feed(s) read`);
  if (!declaresMedia) console.log(`     no-media-host  ${String(counted("no-media-host")).padStart(4)}   source declares no mediaHosts`);

  const shown = listAll ? findings : findings.filter((one) => one.bucket === "reachable");
  if (shown.length > 0) {
    console.log(`\n  ${listAll ? "all silent records" : "reachable — fix these"}:`);
    for (const one of shown) {
      const tail = one.nearest ? `  ~ ${one.nearest.slice(0, 46)} (${one.score})` : "";
      console.log(`    ${one.bucket.padEnd(14)} ${one.title.slice(0, 46).padEnd(48)}${tail}`);
    }
  }
}

process.exit(counted("reachable") > 0 ? 1 : 0);
