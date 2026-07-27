/**
 * Build a trusted-resource manifest from BibleProject's own scripture tags.
 *
 * BibleProject is the hardest of our publishers to link, and for a reason worth
 * stating: the show is organised by theme, not by text. "The Spirit of Life and
 * Death" and "9th Commandment: Do Not Bear False Witness" are about Scripture
 * without naming it, and only 13 of 534 titles carry a reference at all. Running
 * a title parser over that catalogue produces roughly ninety confident lies —
 * `Is` reads as Isaiah, `E18` reads as Revelation 18 — so titles are never
 * parsed here.
 *
 * They did the work themselves instead. Every episode page carries a "Scripture
 * References" block, one tagged anchor per passage, which is the publisher
 * stating the coordinates of their own episode. That is the strongest evidence
 * any of our sources offer, and it is simply sitting there:
 *
 *   Exodus 16 · Deuteronomy 12-26 · Proverbs 10-22 · Exodus 20:1-2 · Acts 15
 *
 * The feed cannot supply this. Its <link> is the bare homepage on every one of
 * the 534 episodes, so it names no page to link to, and its show notes state a
 * passage for only a fifth of them. So the sitemap names the episodes, the
 * pages state the passages, and the feed is joined in afterwards for the
 * catalogue facts it alone holds — duration, publication date, and the
 * publisher's own chapter markers.
 *
 * Two things are emitted from one run:
 *
 *   1. the manifest, holding every episode whose page states a passage;
 *   2. an episode packet under enrichment/, carrying each episode's summary and
 *      chapter list — the substrate for reviewing whatever is left, since
 *      chapter labels are thematic too (4 of 1,252 name a passage) and no
 *      parser will ever get them.
 *
 * Offline, by hand, catalogue metadata only. See docs/trusted-resource-permissions.
 *
 * Usage:
 *   node --import tsx scripts/import-bibleproject-resources.ts
 *        [--out <path>] [--feed <path|url>] [--packet <dir>]
 *        [--limit N] [--concurrency N]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { extractStatedReferences } from "../src/core/resources/scripture-scan.js";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceManifestV1,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const HOST = "bibleproject.com";
const SITEMAP = `https://${HOST}/en/sitemap.xml`;
const FEED = "https://feeds.simplecast.com/3NVmUWZO";
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const target = resolveManifestPath("bibleproject");
const outPath = arg("out") ?? target.path;
const packetDir = arg("packet") ?? join(ROOT, "enrichment", "bibleproject");
const feedSource = arg("feed") ?? FEED;
const limit = Number(arg("limit") ?? "0") || 0;
const concurrency = Math.max(1, Number(arg("concurrency") ?? "6"));

const backbone = JSON.parse(readFileSync(join(ROOT, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(ROOT, "data/scripture/book-names-en.json"), "utf8")) as BookNameMap;

const decode = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
    .trim();

const tagOf = (block: string, tag: string): string => {
  const match = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(block);
  return match?.[1]?.trim() ?? "";
};

async function get(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

/** Titles are compared, never displayed, so punctuation and case are noise. */
const fold = (value: string): string =>
  value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The two catalogues name the same episode differently, and the difference is
 * systematic: the feed appends the series and its number — "A Cup of Wrath? –
 * Character of God E8" — where the page is titled "A Cup of Wrath?". Indexing
 * the feed under both forms is what lets the join find anything at all; on the
 * full title alone it matched 81 episodes of 535.
 */
function titleKeys(title: string): string[] {
  const keys = [fold(title)];
  const trimmed = title.replace(/\s+[–—-]\s+[^–—]*\bE\d+\s*$/i, "").trim();
  if (trimmed && trimmed !== title) keys.push(fold(trimmed));
  return keys;
}

/* ── the episodes the publisher publishes ────────────────────────────────── */

console.log(`Importing from ${HOST}`);

const sitemap = await get(SITEMAP);
const episodeUrls = [...new Set(
  [...sitemap.matchAll(/<loc>(https:\/\/bibleproject\.com\/podcasts\/[a-z0-9-]+\/?)<\/loc>/g)]
    .map((match) => match[1]!)
    /* /podcasts/shows/… and /podcasts/series/… are indexes, not episodes; the
       single-segment shape is the episode. */
    .filter((url) => new URL(url).pathname.split("/").filter(Boolean).length === 2),
)];
const wanted = limit ? episodeUrls.slice(0, limit) : episodeUrls;
console.log(`  sitemap: ${episodeUrls.length} episode pages${limit ? `, taking ${wanted.length}` : ""}`);

/* ── the feed, for what only it holds ────────────────────────────────────── */

const feedXml = /^https?:/.test(feedSource) ? await get(feedSource) : readFileSync(feedSource, "utf8");
const feedItems = feedXml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

/** "<li>Intro (0:00-1:23)</li>" — the publisher's own segmentation. */
const CHAPTER = /<li>\s*([\s\S]*?)\s*\(\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*<\/li>/g;

type FeedFacts = {
  publishedAt?: string;
  durationMinutes?: number;
  summary: string;
  chapters: Array<{ label: string; start: string; end: string }>;
};
const byTitle = new Map<string, FeedFacts>();

for (const block of feedItems) {
  const title = decode(tagOf(block, "title"));
  if (!title) continue;
  const notesHtml = tagOf(block, "content:encoded") || tagOf(block, "description");

  const chapters: Array<{ label: string; start: string; end: string }> = [];
  for (const match of notesHtml.matchAll(CHAPTER)) {
    const label = decode(match[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (label) chapters.push({ label, start: match[2]!, end: match[3]! });
  }
  const prose = decode(notesHtml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

  const rawDate = tagOf(block, "pubDate");
  const date = rawDate ? new Date(rawDate) : null;
  const parts = tagOf(block, "itunes:duration").split(":").map(Number);
  const minutes = parts.length > 0 && parts.every((part) => Number.isFinite(part))
    ? Math.round(parts.reduce((total, part) => total * 60 + part, 0) / 60)
    : 0;

  const facts: FeedFacts = {
    ...(date && !Number.isNaN(date.getTime()) ? { publishedAt: date.toISOString().slice(0, 10) } : {}),
    ...(minutes > 0 ? { durationMinutes: minutes } : {}),
    summary: prose.split(/\bCHAPTERS\b/)[0]?.slice(0, 600).trim() ?? "",
    chapters,
  };
  /* First writer wins: the full title is the exact name and is registered
     first, so a suffix-stripped key can never displace a real match. */
  for (const key of titleKeys(title)) if (!byTitle.has(key)) byTitle.set(key, facts);
}
console.log(`  feed:    ${feedItems.length} episodes joined on title`);

/* ── pages ───────────────────────────────────────────────────────────────── */

/** One tagged anchor per passage, which is the publisher stating a coordinate. */
const REFERENCE = /data-testid="podcast-episode-scripture-reference"[^>]*>([^<]+)</g;
const OG_TITLE = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/;

type Episode = {
  id: string;
  title: string;
  url: string;
  stated: string[];
  brefs: string[];
} & Partial<FeedFacts>;

const episodes: Episode[] = [];
const failures: string[] = [];
let done = 0;

async function pull(url: string): Promise<void> {
  let html: string;
  try { html = await get(url); } catch (error) { failures.push(`${url}: ${(error as Error).message}`); return; }

  const slug = new URL(url).pathname.split("/").filter(Boolean)[1] ?? "";
  const title = decode(OG_TITLE.exec(html)?.[1] ?? "") || slug;
  const stated = [...html.matchAll(REFERENCE)].map((match) => decode(match[1]!)).filter(Boolean);
  /* Each tag is parsed on its own. A publisher's list is not a sentence, and
     joining it into one would let a stray number bridge two entries. */
  const brefs = [...new Set(stated.flatMap((one) => extractStatedReferences(one, bookNames, backbone)))];

  episodes.push({
    id: `bibleproject:podcast:${slug}`,
    title: title.slice(0, 300),
    url,
    stated,
    brefs,
    ...(byTitle.get(fold(title)) ?? {}),
  });
  done += 1;
  if (done % 25 === 0) process.stdout.write(`\r  pages:   ${done}/${wanted.length}`);
}

const queue = [...wanted];
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) await pull(next);
}));
process.stdout.write(`\r  pages:   ${done}/${wanted.length}\n`);
if (failures.length > 0) console.log(`  ! ${failures.length} page(s) could not be read`);

/* ── manifest ────────────────────────────────────────────────────────────── */

episodes.sort((left, right) => left.id.localeCompare(right.id));
const records: TrustedResourceRecordV1[] = [];
for (const episode of episodes) {
  if (episode.brefs.length === 0) continue;
  records.push({
    id: episode.id,
    sourceId: "bibleproject",
    kind: "podcast",
    title: episode.title,
    officialUrl: episode.url,
    brefs: episode.brefs,
    /* The publisher tagged their own episode with these coordinates. That is
       their claim, not our reading of a headline. Audio is deliberately absent:
       it is served from a Simplecast CDN this source has not declared, and
       permission to link has never been permission to fetch. */
    matchBasis: "publisher-scripture-tag",
    metadata: {
      ...(episode.publishedAt ? { publishedAt: episode.publishedAt } : {}),
      ...(episode.durationMinutes ? { durationMinutes: episode.durationMinutes } : {}),
      language: "en",
    },
  });
}

const manifest: TrustedResourceManifestV1 = {
  schema: "pericope.trusted-resource-manifest",
  version: 1,
  source: {
    id: "bibleproject",
    name: "BibleProject",
    homepageUrl: `https://${HOST}/`,
    officialHosts: [HOST],
  },
  provenance: {
    publisher: "BibleProject",
    reviewedAt: new Date().toISOString().slice(0, 10),
    coverage: "reviewed-sample",
    permissions: "outbound-link-only",
    note: `Imported from the publisher's public catalogue. Coordinates are the publisher's own Scripture References, read one tag at a time; titles are never parsed, because this show is titled by theme. Episodes tagging no passage are omitted and left to review. ${records.length} records.`,
  },
  capabilities: ["outbound-link"],
  records,
};

const validated = validateTrustedResourceManifest(manifest, backbone);
if (!validated.ok) {
  console.error(`\nFAIL: the built manifest does not validate: ${validated.error}`);
  process.exit(1);
}

/* An import that linked nothing is an import that went wrong — a moved selector
   reads exactly like a publisher who stopped tagging. Writing the empty result
   over a good manifest turns that into silent data loss, so it is refused. */
if (records.length === 0) {
  console.error(`\nFAIL: no episode yielded a passage. Refusing to overwrite ${outPath}.`);
  console.error(`      ${episodes.length} pages were read; check the Scripture References selector.`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(validated.value, null, 2)}\n`);

/* The packet is every episode, linked or not, with what a reviewer needs to
   judge it: the publisher's summary and their own segmentation. Chapters are
   not in the manifest — nothing renders them yet, and the schema should grow
   when there is something to show, not in advance of it. */
mkdirSync(packetDir, { recursive: true });
writeFileSync(
  join(packetDir, "episodes.jsonl"),
  `${episodes.map((episode) => JSON.stringify(episode)).join("\n")}\n`,
);

const chapterCount = episodes.reduce((total, episode) => total + (episode.chapters?.length ?? 0), 0);
const withChapters = episodes.filter((episode) => (episode.chapters?.length ?? 0) > 0).length;
const joined = episodes.filter((episode) => episode.durationMinutes != null).length;

console.log(`\n  linked:    ${records.length} episodes, ${records.reduce((n, r) => n + r.brefs.length, 0)} references`);
console.log(`  unlinked:  ${episodes.length - records.length} left for review`);
console.log(`  joined:    ${joined} matched a feed episode for date and duration`);
console.log(`  chapters:  ${chapterCount} across ${withChapters} episodes`);
console.log(`  written:   ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
console.log(`  packet:    ${join(packetDir, "episodes.jsonl")}`);
