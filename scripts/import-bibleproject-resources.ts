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
import { fuzzyMatch, significantWords, titleKeys } from "../src/core/resources/episode-title.js";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceManifestV1,
  TrustedResourceMatchBasis,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const HOST = "bibleproject.com";
const SITEMAP = `https://${HOST}/en/sitemap.xml`;
/* Two shows, not one. The main podcast is the one anybody means by
   "BibleProject", but Tim Mackie's older teaching show is where the remastered
   Jonah, Hebrews and Heaven-and-Hell episodes come from, and its 122 episodes
   are otherwise pages we can link and never play. Same audio host, so it costs
   no new permission. */
const FEEDS = [
  "https://feeds.simplecast.com/3NVmUWZO", // BibleProject
  "https://feeds.simplecast.com/zovPCGLI", // Exploring My Strange Bible
];
/* Where their audio actually is. Not bibleproject.com — every one of the 534
   enclosures is an audio/mpeg on Simplecast's CDN, so linking and playing are
   two different permissions here in a way they were not for Naked Bible. */
const MEDIA_HOST = "afp-597195-injected.calisto.simplecastaudio.com";
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const target = resolveManifestPath("bibleproject");
const outPath = arg("out") ?? target.path;
const packetDir = arg("packet") ?? join(ROOT, "enrichment", "bibleproject");
const feedSources = arg("feed")?.split(",").map((one) => one.trim()).filter(Boolean) ?? FEEDS;
const limit = Number(arg("limit") ?? "0") || 0;
const concurrency = Math.max(1, Number(arg("concurrency") ?? "6"));
/* Re-derive records from the last crawl instead of crawling again. */
const fromPacket = process.argv.includes("--from-packet");

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



/* ── the episodes the publisher publishes ────────────────────────────────── */

console.log(`Importing from ${HOST}`);

const sitemap = fromPacket ? "" : await get(SITEMAP);
const episodeUrls = [...new Set(
  [...sitemap.matchAll(/<loc>(https:\/\/bibleproject\.com\/podcasts\/[a-z0-9-]+\/?)<\/loc>/g)]
    .map((match) => match[1]!)
    /* /podcasts/shows/… and /podcasts/series/… are indexes, not episodes; the
       single-segment shape is the episode. */
    .filter((url) => new URL(url).pathname.split("/").filter(Boolean).length === 2),
)];
const wanted = limit ? episodeUrls.slice(0, limit) : episodeUrls;
if (!fromPacket) console.log(`  sitemap: ${episodeUrls.length} episode pages${limit ? `, taking ${wanted.length}` : ""}`);

/* ── the feed, for what only it holds ────────────────────────────────────── */

const feedItems: string[] = [];
for (const source of feedSources) {
  const xml = /^https?:/.test(source) ? await get(source) : readFileSync(source, "utf8");
  feedItems.push(...(xml.match(/<item>[\s\S]*?<\/item>/g) ?? []));
}

/** "<li>Intro (0:00-1:23)</li>" — the publisher's own segmentation. */
const CHAPTER = /<li>\s*([\s\S]*?)\s*\(\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*<\/li>/g;

type FeedFacts = {
  feedTitle: string;
  publishedAt?: string;
  durationMinutes?: number;
  summary: string;
  chapters: Array<{ label: string; start: string; end: string }>;
};
const byTitle = new Map<string, FeedFacts>();
const ambiguous = new Set<string>();
const feedCandidates: Array<{ words: Set<string>; facts: FeedFacts }> = [];

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
    feedTitle: title,
    ...(date && !Number.isNaN(date.getTime()) ? { publishedAt: date.toISOString().slice(0, 10) } : {}),
    ...(minutes > 0 ? { durationMinutes: minutes } : {}),
    summary: prose.split(/\bCHAPTERS\b/)[0]?.slice(0, 600).trim() ?? "",
    chapters,
  };
  /* First writer wins, and a key two episodes both answer to answers for
     neither. Loosening the match is how the join grew; poisoning what it made
     ambiguous is what stops it attaching one episode's audio to another. A
     missing duration is a blank on a card. Wrong audio is a card that lies. */
  for (const key of titleKeys(title)) {
    if (byTitle.has(key)) { if (byTitle.get(key) !== facts) ambiguous.add(key); continue; }
    byTitle.set(key, facts);
  }
  feedCandidates.push({ words: significantWords(title), facts });
}
for (const key of ambiguous) byTitle.delete(key);
console.log(`  feeds:   ${feedSources.length} shows, ${feedItems.length} episodes indexed, ${ambiguous.size} name(s) too ambiguous to join on`);

/* ── pages ───────────────────────────────────────────────────────────────── */

/** One tagged anchor per passage, which is the publisher stating a coordinate. */
const REFERENCE = /data-testid="podcast-episode-scripture-reference"[^>]*>([^<]+)</g;
const OG_TITLE = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/;
/* Where the publisher tagged nothing, they often still say it plainly: "In this
   message, Tim teaches from Jonah 2". Their own words about their own episode,
   but prose rather than a tag — so it is read only when the tag block is empty,
   and it is recorded as the weaker claim it is. */
const META_DESCRIPTION = /<meta[^>]+name="description"[^>]+content="([^"]*)"/;
/**
 * The publisher's own download button, and the end of a long detour.
 *
 * Audio used to be joined from the feed by matching titles, which meant every
 * loosening of that match risked handing one episode another's recording — and
 * three times it did. None of that was necessary: the episode's page carries
 * its own file. A page cannot be wrong about which recording is its own, so the
 * whole class of mistake stops existing rather than being defended against.
 *
 * The feed is still read, for the date, the duration and the chapter markers it
 * alone holds. Being wrong about those is a blemish on a card, not a lie about
 * what a reader is listening to.
 */
const DOWNLOAD = /<a\b[^>]*data-testid="podcast-episode-download"[^>]*>/;

type Episode = {
  id: string;
  title: string;
  url: string;
  stated: string[];
  brefs: string[];
  basis: TrustedResourceMatchBasis;
  audioUrl?: string;
} & Partial<FeedFacts>;

const episodes: Episode[] = [];
const failures: string[] = [];
let done = 0;

/**
 * Some pages fall back to the SEO title, which carries the site name: "What
 * Does the Number 7 Mean in the Bible? | BibleProject™". That is not part of
 * the episode's name. It would be printed on the card, and it breaks every
 * comparison against a feed that never says it.
 */
function episodeTitle(raw: string, slug: string): string {
  return raw.replace(/\s*[|–—-]\s*BibleProject\b.*$/i, "").trim() || slug;
}

async function pull(url: string): Promise<void> {
  let html: string;
  try { html = await get(url); } catch (error) { failures.push(`${url}: ${(error as Error).message}`); return; }

  const slug = new URL(url).pathname.split("/").filter(Boolean)[1] ?? "";
  const title = episodeTitle(decode(OG_TITLE.exec(html)?.[1] ?? ""), slug);
  const stated = [...html.matchAll(REFERENCE)].map((match) => decode(match[1]!)).filter(Boolean);

  const anchor = DOWNLOAD.exec(html)?.[0] ?? "";
  const href = decode(/href="([^"]+)"/.exec(anchor)?.[1] ?? "");
  let mediaHost = ""; try { mediaHost = new URL(href).hostname; } catch { mediaHost = ""; }
  const audioUrl = mediaHost === MEDIA_HOST ? href : undefined;
  /* Each tag is parsed on its own. A publisher's list is not a sentence, and
     joining it into one would let a stray number bridge two entries. */
  let brefs = [...new Set(stated.flatMap((one) => extractStatedReferences(one, bookNames, backbone)))];
  let basis: TrustedResourceMatchBasis = "publisher-scripture-tag";
  if (brefs.length === 0) {
    const described = decode(META_DESCRIPTION.exec(html)?.[1] ?? "");
    const fromProse = extractStatedReferences(described, bookNames, backbone);
    if (fromProse.length > 0) { brefs = fromProse; basis = "publisher-catalog"; }
  }

  episodes.push({
    id: `bibleproject:podcast:${slug}`,
    title: title.slice(0, 300),
    url,
    stated,
    brefs,
    basis,
    ...(audioUrl ? { audioUrl } : {}),
    ...(titleKeys(title).filter((key) => !ambiguous.has(key)).map((key) => byTitle.get(key)).find(Boolean)
      ?? fuzzyMatch(title, feedCandidates) ?? {}),
  });
  done += 1;
  if (done % 25 === 0) process.stdout.write(`\r  pages:   ${done}/${wanted.length}`);
}

/* Rebuilding from the packet re-reads pages we already read. The join has been
   revised several times and each revision used to mean 652 more requests at the
   publisher; their server started refusing, which was fair. The packet already
   holds every title and every reference, so the only thing a re-crawl adds is
   load on somebody else's machine. */
const packetPath = join(packetDir, "episodes.jsonl");
if (fromPacket) {
  const cached = readFileSync(packetPath, "utf8").trim().split("\n").filter(Boolean);
  for (const line of cached) {
    const saved = JSON.parse(line) as Episode;
    const title = episodeTitle(saved.title, saved.id.split(":").pop() ?? saved.title);
    episodes.push({
      ...saved,
      title,
      ...(titleKeys(title).filter((key) => !ambiguous.has(key)).map((key) => byTitle.get(key)).find(Boolean)
        ?? fuzzyMatch(title, feedCandidates) ?? {}),
    });
  }
  done = episodes.length;
  console.log(`  pages:   ${done} replayed from ${packetPath} (no requests made)`);
}

const queue = fromPacket ? [] : [...wanted];
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) await pull(next);
}));
if (!fromPacket) process.stdout.write(`\r  pages:   ${done}/${wanted.length}\n`);

/* A page that lists scripture references is an episode page, and every episode
   page this publisher serves carries a download button — 528 of 531 of them do.
   So references without audio is not a fact about the publisher, it is a fact
   about one request: three pages came back that way in a single crawl and were
   fine on every retry. Left alone it is invisible, because a silent record and
   a record whose publisher offers no audio look identical from here.

   Only the anomalies are asked for again, once, unhurried. */
if (!fromPacket) {
  const suspect = episodes.filter((episode) => episode.stated.length > 0 && !episode.audioUrl);
  if (suspect.length > 0) {
    console.log(`  retry:   ${suspect.length} page(s) listed references but no audio`);
    let recovered = 0;
    for (const episode of suspect) {
      await new Promise((wake) => setTimeout(wake, 500));
      try {
        const html = await get(episode.url);
        const anchor = DOWNLOAD.exec(html)?.[0] ?? "";
        const href = decode(/href="([^"]+)"/.exec(anchor)?.[1] ?? "");
        let host = ""; try { host = new URL(href).hostname; } catch { host = ""; }
        if (host === MEDIA_HOST) { episode.audioUrl = href; recovered += 1; }
      } catch { /* reported below by the count that did not move */ }
    }
    console.log(`           ${recovered} recovered, ${suspect.length - recovered} genuinely carry none`);
  }
}
if (failures.length > 0) console.log(`  ! ${failures.length} page(s) could not be read`);

/* ── manifest ────────────────────────────────────────────────────────────── */

episodes.sort((left, right) => left.id.localeCompare(right.id));
/**
 * Every join rule here is a loosening, and a loosening is how one episode ends
 * up playing another's recording. Two have slipped through already: a generic
 * key gave "Numbers: Question and Response" the Holy Spirit episode's audio,
 * and a fuzzy pass gave a Redemption episode's audio to a page about the number
 * seven. Both were caught by eye, in the app, by the maintainer.
 *
 * So the last word does not belong to any rule. Whatever route a page took to a
 * feed episode, it must end up somewhere that still looks like the same episode
 * — and only where two pages claim one recording, because that is the shape
 * every one of these errors has taken. Genuine re-releases pass: they name the
 * same episode twice, so both sides score well.
 */
/* An absolute score cannot decide this. "What Does the Number 7 Mean in the
   Bible?" agrees 0.80 with "What Does Redemption Mean in the Bible?", because
   formulaic titles share everything but their subject — while the genuine
   re-release "God as the Generous Host" agrees only 0.67 with its own feed
   entry. Any cutoff that rejects the first accepts the second.

   What separates them is the company they keep. Where a recording is contested,
   the rightful claimant is not merely good but clearly better than the rival:
   the Redemption page agrees 1.00 against the number-seven page's 0.80, while
   two names for one re-release sit close together. So the margin decides, and a
   near-tie is left alone, because a near-tie is what a re-release looks like. */
const MIN_MARGIN_TO_DISOWN = 0.15;
const agreement = (episode: Episode): number => {
  const mine = significantWords(episode.title);
  const theirs = significantWords(episode.feedTitle ?? "");
  if (mine.size === 0 || theirs.size === 0) return 1;
  let shared = 0;
  for (const word of mine) if (theirs.has(word)) shared += 1;
  return shared / Math.max(mine.size, theirs.size);
};

const claimants = new Map<string, Episode[]>();
for (const episode of episodes) {
  if (!episode.feedTitle) continue;
  claimants.set(episode.feedTitle, [...(claimants.get(episode.feedTitle) ?? []), episode]);
}
let disowned = 0;
for (const contested of claimants.values()) {
  if (contested.length < 2) continue;
  const best = Math.max(...contested.map(agreement));
  for (const episode of contested) {
    if (best - agreement(episode) < MIN_MARGIN_TO_DISOWN) continue;
    delete episode.audioUrl; delete episode.durationMinutes; delete episode.publishedAt;
    disowned += 1;
  }
}

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
       their claim, not our reading of a headline. */
    matchBasis: episode.basis,
    ...(episode.audioUrl ? { audioUrl: episode.audioUrl } : {}),
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
    /* Declared so the audio may be played at all, and declared separately
       from the link host because it is a separate grant. Permission to link
       has never been permission to fetch. */
    mediaHosts: [MEDIA_HOST],
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
if (!fromPacket) writeFileSync(
  packetPath,
  `${episodes.map((episode) => JSON.stringify(episode)).join("\n")}\n`,
);

const chapterCount = episodes.reduce((total, episode) => total + (episode.chapters?.length ?? 0), 0);
const withChapters = episodes.filter((episode) => (episode.chapters?.length ?? 0) > 0).length;
const joined = episodes.filter((episode) => episode.durationMinutes != null).length;

const tagged = records.filter((record) => record.matchBasis === "publisher-scripture-tag").length;
console.log(`\n  linked:    ${records.length} episodes, ${records.reduce((n, r) => n + r.brefs.length, 0)} references`);
console.log(`             ${tagged} from the publisher's scripture tags, ${records.length - tagged} from their prose`);
console.log(`  unlinked:  ${episodes.length - records.length} left for review`);
console.log(`  joined:    ${joined} matched a feed episode for date and duration`);
console.log(`  disowned:  ${disowned} contested feed match(es) refused (date and duration only)`);
console.log(`  chapters:  ${chapterCount} across ${withChapters} episodes`);
console.log(`  written:   ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
console.log(`  packet:    ${join(packetDir, "episodes.jsonl")}`);
