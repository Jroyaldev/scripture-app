/**
 * Build a trusted-resource manifest and an episode catalogue from Spoken
 * Gospel's podcast feed.
 *
 * The first source imported from an RSS feed rather than a WordPress API, and
 * the first where the two artifacts had to come apart. Both changes have the
 * same cause: this publisher's audio catalogue and its passage catalogue are
 * not the same list.
 *
 * WHY TWO FILES
 *
 * A manifest record must state a passage — the validator requires non-empty
 * `brefs`, correctly, because a card that claims nothing has nothing to rank on
 * and would surface everywhere. But roughly a sixth of these 295 episodes name
 * no passage at all: "Halfway There", "SAVE OUR PODCAST!", "Merry Christmas!".
 * Under the old shape those episodes would have been dropped here and therefore
 * never transcribed, because the transcription pipeline builds its inventory
 * from the manifest.
 *
 * That is the wrong place to lose them. Whether an episode deserves a resource
 * card and whether it deserves to be transcribed are different questions: the
 * card asks "did the publisher say what this is about", and the transcript asks
 * "is there speech here". The reference extraction answers the first question
 * far better than a title ever could — it hears the passage discussed and
 * timestamps it — but only for episodes it was given. So the feed writes both:
 *
 *   manifest.json   episodes whose title states a passage — the card catalogue
 *   episodes.json   every episode with audio — the transcription catalogue
 *
 * HOW A TITLE STATES ITS PASSAGE
 *
 * Spoken Gospel titles read `<passage>: <theme>` — "Exodus 32: The Golden
 * Calf" — which is the reverse of the Naked Bible Podcast, where the show's own
 * numbering comes first and the passage follows the colon. So the head is
 * parsed here and the tail is only a fallback.
 *
 * The head is a pure coordinate expression, unlike Working Preacher's titles,
 * which are prose with a passage in them. That means it can be parsed strictly
 * rather than scanned — and it has to be, because the shared normalizer drops
 * the tail of a chapter range ("2 Corinthians 11-12" yields only chapter 11)
 * and that publisher's titles rarely have ranges while this one's often do.
 *
 * Offline, by hand, catalogue metadata only. See docs/trusted-resource-permissions.
 *
 * Usage:
 *   node --import tsx scripts/import-spoken-gospel-resources.ts
 *        [--feed <path|url>] [--out <path>] [--episodes <path>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { toBref, validateRef } from "../src/core/reference/parser.js";
import { validateTrustedResourceManifest } from "../src/core/resources/trusted-resources.js";
import { resolveManifestPath } from "./resource-import-target.js";
import type {
  TrustedResourceManifestV1,
  TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import type { BackboneData, BookCode, BookNameMap, CanonicalRef } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ID = "spoken-gospel";
const FEED = "https://feeds.megaphone.fm/SPG9627743817";
/* Two page hosts, both the publisher's. The show moved from its own podcast
   domain onto the main site part-way through, and the older episodes' links
   were never rewritten — so refusing either would silently drop 31 episodes. */
const PAGE_HOSTS = ["www.spokengospel.com", "www.spokengospelpodcast.com"];
/* Megaphone, where every one of the 295 enclosures lives. Declared apart from
   the page hosts because permission to link is not permission to fetch. */
const MEDIA_HOST = "traffic.megaphone.fm";
const USER_AGENT = "Pericope/0.1 (+https://marktheword.com; trusted-resource importer)";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const target = resolveManifestPath(SOURCE_ID);
const outPath = arg("out") ?? target.path;
const episodesPath = arg("episodes") ?? join(dirname(target.path), "episodes.json");

const backbone = JSON.parse(readFileSync(join(ROOT, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(ROOT, "data/scripture/book-names-en.json"), "utf8")) as BookNameMap;

/* ---------------------------------------------------------------- feed ---- */

const source = arg("feed") ?? FEED;
const xml = /^https?:/.test(source)
  ? await (async (): Promise<string> => {
    const response = await fetch(source, { headers: { accept: "application/rss+xml", "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${source} -> ${response.status}`);
    return response.text();
  })()
  : readFileSync(source, "utf8");

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
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : null;
}

/* ------------------------------------------------------------- passage ---- */

/** Book names longest-first, so "1 John" is tried before "John". */
const BOOK_CANDIDATES: Array<{ code: BookCode; name: string }> = [];
for (const [code, names] of Object.entries(bookNames)) {
  for (const name of names) BOOK_CANDIDATES.push({ code: code as BookCode, name });
}
/**
 * The publisher's own series names for the books it treats as one work.
 *
 * "Chronicles Overview" and "Kings Introduction" name no book our canon knows,
 * but they are not vague — the show means both volumes, and says so in the
 * episode. Left unmapped these produce nothing, which reads as the publisher
 * having said nothing when they said something perfectly clear.
 */
const SERIES_ALIASES: Array<{ name: string; codes: BookCode[] }> = [
  { name: "Ezra-Nehemiah", codes: ["EZR", "NEH"] },
  { name: "1 & 2 Timothy", codes: ["1TI", "2TI"] },
  { name: "John's Letters", codes: ["1JN", "2JN", "3JN"] },
  { name: "Chronicles", codes: ["1CH", "2CH"] },
  { name: "Samuel", codes: ["1SA", "2SA"] },
  { name: "Kings", codes: ["1KI", "2KI"] },
];
BOOK_CANDIDATES.sort((left, right) => right.name.length - left.name.length);

const fold = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The book a coordinate expression opens with, and what follows it. */
function leadingBook(expression: string): { codes: BookCode[]; rest: string } | null {
  const folded = fold(expression);
  for (const alias of SERIES_ALIASES) {
    const name = fold(alias.name);
    if (folded.startsWith(name) && !/[a-z0-9]/.test(folded.charAt(name.length))) {
      return { codes: alias.codes, rest: expression.slice(alias.name.length).trim() };
    }
  }
  for (const candidate of BOOK_CANDIDATES) {
    const name = fold(candidate.name);
    if (!folded.startsWith(name)) continue;
    /* A name must end at a boundary, or "Job" swallows the "Jo" of "John". */
    if (/[a-z0-9]/.test(folded.charAt(name.length))) continue;
    return { codes: [candidate.code], rest: expression.slice(candidate.name.length).trim() };
  }
  return null;
}

const chapterCount = (code: BookCode): number => backbone.books[code]?.chapters.length ?? 0;
const verseCount = (code: BookCode, chapter: number): number =>
  backbone.books[code]?.chapters[chapter - 1] ?? 0;

function wholeBook(code: BookCode): CanonicalRef {
  const last = chapterCount(code);
  return {
    version: "v1",
    start: { book: code, chapter: 1, verse: 1 },
    end: { book: code, chapter: last, verse: verseCount(code, last) },
  };
}

function wholeChapter(code: BookCode, chapter: number): CanonicalRef {
  return {
    version: "v1",
    start: { book: code, chapter, verse: 1 },
    end: { book: code, chapter, verse: verseCount(code, chapter) },
  };
}

/**
 * Read a coordinate expression that has already had its book stripped.
 *
 * Handles what this publisher actually writes, and nothing else:
 *
 *   24-27, 30     chapter ranges and lists      (Exodus 24-27, 30)
 *   23 and 25     the same, written out         (Leviticus 23 and 25)
 *   11-12         a chapter range               (2 Corinthians 11-12)
 *   6:3-21        verses inside one chapter     (1 Timothy 6:3-21)
 *   5:1-6:2       verses across two chapters    (1 Timothy 5:1-6:2)
 *   3:16-6        a verse to the end of a later chapter (Ecclesiastes 3:16-6)
 *   2:18-27; 4:1-6   two spans in one book      (1 John 2:18-27; 4:1-6)
 *
 * Returns null on anything else rather than guessing. A title is evidence only
 * while it is read literally; the moment this starts inferring, the manifest
 * stops being the publisher's claim and starts being ours.
 */
function coordinates(code: BookCode, expression: string): CanonicalRef[] | null {
  const cleaned = expression
    .replace(/[–—−]/g, "-")
    /* "23 and 25" is a list written in words; the publisher uses both forms
       and they mean the same thing. */
    .replace(/\s+and\s+/gi, ", ")
    .trim();
  if (!cleaned) return null;
  /* Nothing but coordinates may remain. A stray word means the head was prose
     and whatever digits it holds are not a reference. */
  if (!/^[\d\s:;,-]+$/.test(cleaned)) return null;

  const refs: CanonicalRef[] = [];
  for (const part of cleaned.split(/[;,]/)) {
    const piece = part.trim();
    if (!piece) continue;
    const match = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(piece);
    if (!match) return null;
    const startChapter = Number(match[1]);
    const startVerse = match[2] == null ? null : Number(match[2]);
    const endLeft = match[3] == null ? null : Number(match[3]);
    const endRight = match[4] == null ? null : Number(match[4]);

    if (startVerse == null) {
      /* "11-12" is chapters; "11" is one chapter. Both cover whole chapters,
         and the range's tail is kept — losing it is exactly the defect that
         made a purpose-built parser worth writing. */
      const lastChapter = endLeft ?? startChapter;
      if (lastChapter < startChapter) return null;
      for (let chapter = startChapter; chapter <= lastChapter; chapter += 1) {
        if (verseCount(code, chapter) === 0) return null;
        refs.push(wholeChapter(code, chapter));
      }
      continue;
    }

    /* "6:3-21" ends in the same chapter and "5:1-6:2" crosses into another,
       and those are told apart by whether a verse was written after the dash.
       Where none was, one number is doing one of two jobs: "6:3-21" ends at
       verse 21, "3:16-6" ends at the close of chapter 6. Nothing but its size
       distinguishes them — a range cannot end before it starts, so a tail
       below the opening verse is a chapter. */
    let endChapter = startChapter;
    let endVerse = startVerse;
    if (endRight != null) {
      endChapter = endLeft ?? startChapter;
      endVerse = endRight;
    } else if (endLeft != null) {
      if (endLeft >= startVerse) endVerse = endLeft;
      else { endChapter = endLeft; endVerse = verseCount(code, endLeft); }
    }
    if (verseCount(code, startChapter) === 0 || verseCount(code, endChapter) === 0) return null;
    refs.push({
      version: "v1",
      start: { book: code, chapter: startChapter, verse: startVerse },
      end: { book: code, chapter: endChapter, verse: endVerse },
    });
  }
  return refs.length > 0 ? refs : null;
}

/**
 * The words in which the show says what an episode covers.
 *
 * "Overview", "Introduction", "Sermon" and "Replay" all follow a bare book name
 * — "Romans Overview: Jesus is King" — and each is a claim about the whole
 * book. They rank last on specificity, which is correct: naming a book is
 * exactly as much as the title said.
 */
const WHOLE_BOOK_SUFFIX = /^(?:overview|introduction|intro|sermon|replay|special episode|special)?$/i;

/** Everything before the first colon that is not part of a `chapter:verse`. */
function headOf(title: string): string {
  const index = title.search(/:(?!\d)/);
  return (index === -1 ? title : title.slice(0, index)).trim();
}

function tailOf(title: string): string {
  const index = title.search(/:(?!\d)/);
  return index === -1 ? "" : title.slice(index + 1).trim();
}

/**
 * Drop what sits beside the coordinate rather than in it.
 *
 * A guest credit and a part number are both asides, and the show writes each
 * both ways — "Exodus 20 (Part 2)" and "Esther 4-8 Part 2". Left in, the
 * bare form's number reads as a verse and turns Esther 4-8 into Esther 4:2.
 */
const stripAside = (value: string): string =>
  value
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\b(?:part|pt\.?)\s*\d+\s*$/i, "")
    /* "Gospel of John" is how the show names the book on its overview run. */
    .replace(/^\s*(?:the\s+)?gospel of\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

function claimFrom(expression: string): CanonicalRef[] | null {
  const cleaned = stripAside(expression);
  if (!cleaned) return null;
  const book = leadingBook(cleaned);
  if (!book) return null;
  if (WHOLE_BOOK_SUFFIX.test(book.rest)) return book.codes.map(wholeBook);
  /* A multi-book series name carries no chapter numbers of its own — "Kings 3"
     would be this importer inventing a coordinate the publisher never wrote. */
  if (book.codes.length > 1) return null;
  return coordinates(book.codes[0]!, book.rest);
}

/**
 * The passage a title states, if it states one.
 *
 * The head is where this publisher puts it. The tail is tried only when the
 * head yields nothing, which rescues the handful written the other way round —
 * "Psalms of Ascent: Psalms 130-134", "Christmas Special: Seth's Exodus 3
 * Sermon" — without letting a theme contribute coordinates to a title that
 * already stated its own.
 */
function statedPassage(title: string): CanonicalRef[] | null {
  const head = claimFrom(headOf(title));
  if (head) return head;
  /* Prose, so only a coordinate sitting inside it counts, and only the first:
     a sentence with two references is a sentence, not a claim. The tail first,
     then the whole title — which is what reads "Psalm 91 & Coronavirus", a
     title with no colon to have a head at all. */
  const COORDINATE = /((?:[123]\s+)?[A-Z][a-z]+(?:\s+of\s+[A-Z][a-z]+)*)\s+(\d+(?::\d+)?(?:-\d+(?::\d+)?)?)/;
  for (const prose of [tailOf(title), title]) {
    if (!prose) continue;
    const inside = COORDINATE.exec(prose);
    const claim = inside ? claimFrom(`${inside[1]} ${inside[2]}`) : null;
    if (claim) return claim;
  }
  return null;
}

/* -------------------------------------------------------------- import ---- */

console.log(`Importing from ${source}`);

const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
if (blocks.length === 0) throw new Error("feed contained no items");

interface Episode {
  id: string;
  title: string;
  audioUrl: string;
  officialUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
}

const episodes: Episode[] = [];
const records: TrustedResourceRecordV1[] = [];
const seen = new Set<string>();
const skipped = { noAudio: 0, offHost: 0, duplicate: 0 };
const noPassage: string[] = [];

for (const block of blocks) {
  const title = tag(block, "title");
  const guid = tag(block, "guid");
  if (!title || !guid) continue;

  const enclosure = /<enclosure[^>]*\burl="([^"]+)"/.exec(block);
  const audioUrl = enclosure ? decode(enclosure[1]!) : "";
  let audioHost = "";
  try { audioHost = new URL(audioUrl).hostname; } catch { audioHost = ""; }
  if (!audioUrl) { skipped.noAudio += 1; continue; }
  if (audioHost !== MEDIA_HOST) { skipped.offHost += 1; continue; }

  const id = `${SOURCE_ID}:podcast:${guid}`;
  if (seen.has(id)) { skipped.duplicate += 1; continue; }
  seen.add(id);

  const link = tag(block, "link");
  let pageHost = "";
  try { pageHost = new URL(link).hostname; } catch { pageHost = ""; }
  const officialUrl = PAGE_HOSTS.includes(pageHost) ? link : null;

  const seconds = durationSeconds(tag(block, "itunes:duration"));
  const published = tag(block, "pubDate");
  const date = published ? new Date(published) : null;
  const publishedAt = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;

  episodes.push({ id, title, audioUrl, officialUrl, durationSeconds: seconds, publishedAt });

  /* A card needs both halves: somewhere to send a reader, and a passage to
     rank on. An episode missing either is still transcribed — it is in the
     catalogue above — it simply has no card. */
  const refs = statedPassage(title);
  if (!refs) { noPassage.push(title); continue; }
  if (!officialUrl) continue;

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
    sourceId: SOURCE_ID,
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
    id: SOURCE_ID,
    name: "Spoken Gospel",
    homepageUrl: "https://www.spokengospel.com/",
    officialHosts: PAGE_HOSTS,
    mediaHosts: [MEDIA_HOST],
  },
  provenance: {
    publisher: "Spoken Gospel",
    reviewedAt: new Date().toISOString().slice(0, 10),
    coverage: "reviewed-sample",
    permissions: "outbound-link-only",
    note: `Imported from the publisher's public podcast feed. Coordinates are parsed from episode titles, which state the passage before the colon. Episodes stating no passage are omitted from the manifest and kept in episodes.json. ${records.length} of ${episodes.length} episodes.`,
  },
  capabilities: ["outbound-link"],
  records,
};

const validated = validateTrustedResourceManifest(manifest, backbone);
if (!validated.ok) {
  console.error(`\nFAIL: the built manifest does not validate: ${validated.error}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(validated.value, null, 2)}\n`);

mkdirSync(dirname(episodesPath), { recursive: true });
writeFileSync(episodesPath, `${JSON.stringify({
  schema: "podcast-catalog/v1",
  sourceId: SOURCE_ID,
  sourceName: "Spoken Gospel",
  generatedFrom: source,
  episodeCount: episodes.length,
  episodes,
}, null, 2)}\n`);

const withPassage = records.length;
const hours = episodes.reduce((total, e) => total + (e.durationSeconds ?? 0), 0) / 3600;
console.log(`\n  episodes:   ${episodes.length}  (${hours.toFixed(1)}h)`);
console.log(`  carded:     ${withPassage}  (${((withPassage / episodes.length) * 100).toFixed(1)}% state a passage and have a page)`);
console.log(`  no passage: ${noPassage.length}`);
console.log(`  skipped:    ${skipped.noAudio} no audio, ${skipped.offHost} off-host, ${skipped.duplicate} duplicate`);
console.log(`  manifest:   ${outPath}${arg("out") ? "" : `  (library from ${target.from})`}`);
console.log(`  catalogue:  ${episodesPath}`);
if (process.argv.includes("--show-unmatched")) {
  console.log(`\n  titles stating no passage:`);
  for (const title of noPassage) console.log(`    ${title}`);
}
