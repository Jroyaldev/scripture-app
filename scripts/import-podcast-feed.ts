/**
 * Build a trusted-resource manifest and an episode catalogue from a podcast's
 * RSS feed.
 *
 * One script, one registry, six shows. It replaced a bespoke importer per
 * publisher once the fifth arrived and the differences turned out to be four
 * strings and a title grammar — the feed shape, the two-file output and the
 * coordinate reader are the same every time.
 *
 *   node --import tsx scripts/import-podcast-feed.ts --source <id>
 *   node --import tsx scripts/import-podcast-feed.ts --all
 *
 * TWO FILES, NOT ONE
 *
 * A manifest record must state a passage — the validator requires `brefs` —
 * because a card that claims nothing has nothing to rank on. But an episode
 * that names no passage still has speech in it, and the reference extraction
 * hears passages a title never mentions. So:
 *
 *   manifest.json   episodes whose title states a passage — the card catalogue
 *   episodes.json   every episode with audio — the transcription catalogue
 *
 * Conflating those two lists means "did the publisher's title name a passage"
 * silently decides "does this episode have speech in it", which for these six
 * shows would discard roughly a third of everything.
 *
 * MEDIA HOSTS ARE ROUTERS
 *
 * The host in an enclosure URL is frequently not the host that serves the file:
 * `traffic.megaphone.fm` 302s to `dcs-spotify` or `dcs-cached`, podtrac and
 * adbarker wrap libsyn, podbean shards across numbered subdomains, substack
 * hands off to its CDN. The renderer's CSP re-checks the redirect target, so
 * `deliveryHosts` below records where each one actually lands. Getting this
 * wrong does not fail at import — it fails much later, as a player saying it
 * could not reach the episode.
 *
 * Offline, by hand, catalogue metadata only. See docs/trusted-resource-permissions.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { toBref, validateRef } from "../src/core/reference/parser.js";
import { createPassageReader } from "../src/core/resources/podcast-titles.js";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceManifestV1,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

interface Show {
  id: string;
  name: string;
  homepageUrl: string;
  feed: string;
  /** Hosts whose episode pages a reader may be sent to. */
  pageHosts: string[];
  /** The host in the enclosure URL — what a record may store. */
  mediaHost: string;
  /** Where that host actually redirects, measured. For the renderer's policy. */
  deliveryHosts: string[];
}

export const SHOWS: readonly Show[] = [
  {
    id: "spoken-gospel",
    name: "Spoken Gospel",
    homepageUrl: "https://www.spokengospel.com/",
    feed: "https://feeds.megaphone.fm/SPG9627743817",
    /* The show moved domains part-way through and the older links were never
       rewritten, so refusing either would drop thirty-one episodes' cards. */
    pageHosts: ["www.spokengospel.com", "www.spokengospelpodcast.com"],
    mediaHost: "traffic.megaphone.fm",
    deliveryHosts: ["dcs-spotify.megaphone.fm", "dcs-cached.megaphone.fm"],
  },
  {
    id: "ask-nt-wright",
    name: "Ask N.T. Wright Anything",
    homepageUrl: "https://askntwrightanything.podbean.com/",
    feed: "https://feeds.megaphone.fm/NSR7466770103",
    pageHosts: ["askntwrightanything.podbean.com"],
    mediaHost: "traffic.megaphone.fm",
    deliveryHosts: ["dcs-spotify.megaphone.fm", "dcs-cached.megaphone.fm"],
  },
  {
    id: "five-minutes-church-history",
    name: "5 Minutes in Church History",
    homepageUrl: "https://www.5minutesinchurchhistory.com/",
    feed: "https://rss.libsyn.com/shows/116817/destinations/668749.xml",
    pageHosts: ["www.5minutesinchurchhistory.com", "5minutesinchurchhistory.libsyn.com", "ligonier.org"],
    mediaHost: "dts.podtrac.com",
    deliveryHosts: ["traffic.libsyn.com", "content.libsyn.com"],
  },
  {
    id: "forty-minutes-ot",
    name: "40 Minutes in the Old Testament",
    homepageUrl: "https://40minot.libsyn.com/",
    feed: "https://rss.libsyn.com/shows/62612/destinations/245197.xml",
    pageHosts: ["40minot.libsyn.com"],
    mediaHost: "adbarker.com",
    deliveryHosts: ["traffic.libsyn.com", "content.libsyn.com"],
  },
  {
    id: "listeners-commentary",
    name: "The Listener’s Bible Commentary",
    homepageUrl: "https://listenerscommentary.podbean.com/",
    feed: "https://feed.podbean.com/listenerscommentary/feed.xml",
    pageHosts: ["listenerscommentary.podbean.com"],
    mediaHost: "mcdn.podbean.com",
    /* Numbered shards — s328, s332, s381 in four sampled episodes. There is no
       enumerating these; the policy takes the domain. */
    deliveryHosts: ["*.podbean.com"],
  },
  {
    id: "thirty-minutes-nt",
    name: "30 Minutes in the New Testament",
    homepageUrl: "https://30minnt.libsyn.com/",
    /* The slug feed — feeds.libsyn.com/88659/rss serves the show's HTML page,
       measured 2026-08-01; only the slug form returns XML. */
    feed: "https://feeds.libsyn.com/88659/30minnt",
    pageHosts: ["30minnt.libsyn.com"],
    mediaHost: "adbarker.com",
    deliveryHosts: ["traffic.libsyn.com", "content.libsyn.com"],
  },
  {
    id: "bema",
    name: "The BEMA Podcast",
    homepageUrl: "https://www.bemadiscipleship.com/",
    feed: "https://www.bemadiscipleship.com/rss",
    pageHosts: ["www.bemadiscipleship.com"],
    mediaHost: "aphid.fireside.fm",
    /* media24 in the two sampled episodes; numbered shards, the podbean
       situation again — the policy takes the domain. */
    deliveryHosts: ["*.fireside.fm"],
  },
  {
    id: "radically-christian",
    name: "Radically Christian",
    homepageUrl: "https://www.radicallychristian.com/",
    feed: "https://api.substack.com/feed/podcast/2966200.rss",
    pageHosts: ["www.radicallychristian.com"],
    mediaHost: "api.substack.com",
    deliveryHosts: ["substackcdn.com"],
  },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const backbone = JSON.parse(readFileSync(join(ROOT, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(ROOT, "data/scripture/book-names-en.json"), "utf8")) as BookNameMap;
const statedPassage = createPassageReader(bookNames, backbone);

const decode = (value: string): string =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…")
    /* Ampersand last, so "&amp;lt;" cannot become a tag. */
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, name: string): string {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? decode(match[1]!) : "";
}

/** "4560", "43:54" and "1:00:13" all mean seconds. */
function durationSeconds(value: string): number | null {
  if (!value) return null;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Math.trunc(part), 0);
  return seconds > 0 ? seconds : null;
}

interface Episode {
  id: string;
  title: string;
  audioUrl: string;
  officialUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  summary?: string;
}

/**
 * The publisher's own line, out of whatever HTML they put in their feed.
 *
 * Feeds carry markup in these — links, lists, whole sponsor blocks — and the
 * room draws one plain line. So the tags come out HERE, at import, rather than
 * being carried into a catalogue and stripped again at every draw.
 *
 * `itunes:summary` is preferred where both exist, because that is the field
 * publishers write for listeners; `description` is more often the one carrying
 * the affiliate links.
 *
 * Trimmed to 300: a row shows one line, and keeping four paragraphs to render
 * forty characters is four paragraphs over an IPC for nothing.
 */
function summaryOf(block: string): string | undefined {
  const raw = tag(block, "itunes:summary") || tag(block, "description");
  if (!raw) return undefined;
  const text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 300) : undefined;
}

async function importShow(show: Show): Promise<void> {
  const target = resolveManifestPath(show.id);
  const outPath = arg("out") ?? target.path;
  const episodesPath = arg("episodes") ?? join(dirname(target.path), "episodes.json");

  const source = arg("feed") ?? show.feed;
  const xml = /^https?:/.test(source)
    ? await (async (): Promise<string> => {
      const response = await fetch(source, {
        headers: { accept: "application/rss+xml", "user-agent": USER_AGENT },
      });
      if (!response.ok) throw new Error(`${source} -> ${response.status}`);
      return response.text();
    })()
    : readFileSync(source, "utf8");

  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  if (blocks.length === 0) throw new Error(`${show.id}: feed contained no items`);

  const episodes: Episode[] = [];
  const records: TrustedResourceRecordV1[] = [];
  const seen = new Set<string>();
  const skipped = { noAudio: 0, offHost: 0, duplicate: 0 };
  const noPassage: string[] = [];
  let noPage = 0;

  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue;

    const enclosure = /<enclosure[^>]*\burl="([^"]+)"/.exec(block);
    const audioUrl = enclosure ? decode(enclosure[1]!) : "";
    if (!audioUrl) { skipped.noAudio += 1; continue; }
    let audioHost = "";
    try { audioHost = new URL(audioUrl).hostname; } catch { audioHost = ""; }
    if (audioHost !== show.mediaHost) { skipped.offHost += 1; continue; }

    /* The publisher's own identifier where there is one. Some feeds omit guid
       or repeat it; the enclosure URL is unique per episode in all six and is
       the fallback, hashed to keep record ids short and path-safe. */
    const guid = tag(block, "guid") || audioUrl;
    const id = `${show.id}:podcast:${slug(guid)}`;
    if (seen.has(id)) { skipped.duplicate += 1; continue; }
    seen.add(id);

    const link = tag(block, "link");
    let pageHost = "";
    try { pageHost = new URL(link).hostname; } catch { pageHost = ""; }
    const officialUrl = show.pageHosts.includes(pageHost) ? link : null;
    if (!officialUrl) noPage += 1;

    const seconds = durationSeconds(tag(block, "itunes:duration"));
    const published = tag(block, "pubDate");
    const date = published ? new Date(published) : null;
    const publishedAt = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;

    const said = summaryOf(block);
    episodes.push({
      id, title, audioUrl, officialUrl, durationSeconds: seconds, publishedAt,
      ...(said ? { summary: said } : {}),
    });

    /* A card needs both halves: somewhere to send a reader, and a passage to
       rank on. An episode missing either is still transcribed — it is in the
       catalogue above — it simply has no card. */
    const refs = statedPassage(title);
    if (!refs || !officialUrl) { if (!refs) noPassage.push(title); continue; }

    const brefs: string[] = [];
    let refused = false;
    for (const ref of refs) {
      const valid = validateRef(ref, backbone);
      if (!valid.ok) { refused = true; break; }
      const bref = toBref(valid.value);
      if (!brefs.includes(bref)) brefs.push(bref);
    }
    if (refused || brefs.length === 0) { noPassage.push(title); continue; }

    records.push({
      id,
      sourceId: show.id,
      kind: "podcast",
      title: title.slice(0, 300),
      officialUrl,
      brefs,
      matchBasis: "publisher-title",
      audioUrl,
      metadata: {
        ...(publishedAt ? { publishedAt } : {}),
        ...(seconds ? { durationMinutes: Math.max(1, Math.round(seconds / 60)) } : {}),
        language: "en",
      },
    });
  }

  const manifest: TrustedResourceManifestV1 = {
    schema: "pericope.trusted-resource-manifest",
    version: 1,
    source: {
      id: show.id,
      name: show.name,
      homepageUrl: show.homepageUrl,
      officialHosts: show.pageHosts,
      mediaHosts: [show.mediaHost],
    },
    provenance: {
      publisher: show.name,
      reviewedAt: new Date().toISOString().slice(0, 10),
      coverage: "reviewed-sample",
      permissions: "outbound-link-only",
      note: `Imported from the publisher's public podcast feed. Coordinates are parsed from episode titles. Episodes stating no passage are omitted from the manifest and kept in episodes.json. ${records.length} of ${episodes.length} episodes.`,
    },
    capabilities: ["outbound-link"],
    records,
  };

  const validated = validateTrustedResourceManifest(manifest, backbone);
  if (!validated.ok) {
    console.error(`  FAIL ${show.id}: the built manifest does not validate: ${validated.error}`);
    process.exitCode = 1;
    return;
  }

  /* `--episodes-only` REFRESHES THE CATALOGUE AND LEAVES THE CARDS ALONE.
     Added when the episode catalogue learned to carry the publisher's own line:
     the eight shows here wanted a re-import for the summaries alone, and a full
     import rewrites `manifest.json` — which for a publisher whose cards were
     built by a different, richer importer would replace curated records with
     title-parsed ones. Two files, and now two reasons to write only one. */
  if (!process.argv.includes("--episodes-only")) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(validated.value, null, 2)}\n`);
  }
  mkdirSync(dirname(episodesPath), { recursive: true });
  writeFileSync(episodesPath, `${JSON.stringify({
    schema: "podcast-catalog/v1",
    sourceId: show.id,
    sourceName: show.name,
    generatedFrom: source,
    episodeCount: episodes.length,
    episodes,
  }, null, 2)}\n`);

  const hours = episodes.reduce((total, e) => total + (e.durationSeconds ?? 0), 0) / 3600;
  const pct = episodes.length > 0 ? (records.length / episodes.length) * 100 : 0;
  console.log(
    `  ${show.id.padEnd(28)} ${String(episodes.length).padStart(4)} eps  ${hours.toFixed(0).padStart(4)}h`
    + `   carded ${String(records.length).padStart(4)} (${pct.toFixed(0).padStart(3)}%)`
    + `   no passage ${String(noPassage.length).padStart(4)}   no page ${String(noPage).padStart(4)}`
    + (skipped.offHost || skipped.noAudio || skipped.duplicate
      ? `   skipped ${skipped.noAudio}/${skipped.offHost}/${skipped.duplicate}` : ""),
  );
  if (process.argv.includes("--show-unmatched")) {
    for (const title of noPassage.slice(0, 40)) console.log(`       ${title.slice(0, 96)}`);
  }
}

/** A short, stable, path-safe key for a guid that may be a URL or a UUID. */
function slug(value: string): string {
  const clean = value.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,72}$/.test(clean)) return clean;
  let hash = 0x811c9dc5;
  for (let index = 0; index < clean.length; index += 1) {
    hash ^= clean.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const tail = clean.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-40);
  return `${hash.toString(16)}-${tail}`;
}

const wanted = process.argv.includes("--all")
  ? SHOWS
  : SHOWS.filter((show) => show.id === arg("source"));
if (wanted.length === 0) {
  console.error(`usage: --source <${SHOWS.map((s) => s.id).join("|")}> | --all`);
  process.exit(1);
}

console.log(`importing ${wanted.length} show${wanted.length === 1 ? "" : "s"}\n`);
for (const show of wanted) {
  try {
    await importShow(show);
  } catch (error) {
    console.error(`  FAIL ${show.id}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
