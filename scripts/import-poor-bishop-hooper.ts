/**
 * Build the music catalogue from Poor Bishop Hooper's own listen page.
 *
 *   node --import tsx scripts/import-poor-bishop-hooper.ts --from <captured.json>
 *
 * WHY THIS ONE CANNOT FETCH FOR ITSELF, and what to hand it instead.
 *
 * Their listen page is a Webflow CMS collection whose audio URLs are not in
 * the server-rendered HTML: `curl` returns 354 items and fifty mp3s, which is
 * one album's worth and reads like the whole catalogue until you count. The
 * rest arrive when the page's own script fetches them, and the track's URL is
 * never an attribute — it is the text of a `[tmplayer-meta="audio-url"]` node
 * their player reads at press time.
 *
 * So the capture is a browser step, run by hand against the all-projects URL
 * the maintainer supplied (every project selected in the `project=` query),
 * and this script is the part that has to be reproducible: the shaping, the
 * psalm mapping, and the refusal to invent anything the page did not say.
 * The capture expression is in docs/onboarding-a-podcast.md under "Music".
 *
 * WHAT IS TAKEN. Title, album, cover, duration, the audio URL on the
 * publisher's own CDN, and the download link where the page offers one. No
 * audio is copied and no artwork is re-hosted; both are referenced where the
 * publisher serves them, which is the same relation the podcast manifests
 * take to an enclosure URL.
 *
 * THE PSALM MAPPING is the reason this catalogue belongs in a Bible app at
 * all. EveryPsalm sets all 150 psalms, and its titles say so plainly enough
 * to parse: 149 of them are "PSALM n", and Psalm 119 arrives as its
 * twenty-two acrostic stanzas — "PSALM 119 - ALEPH" through "TAW" — which is
 * the psalm's own structure rather than a division we imposed. A track that
 * names no psalm gets no psalm; nothing here guesses.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "data/music/poor-bishop-hooper.json");

/** The Hebrew alphabet in the order Psalm 119 walks it. */
const STANZA: Readonly<Record<string, number>> = {
  ALEPH: 1, BETH: 2, GIMEL: 3, DALETH: 4, HE: 5, WAW: 6, ZAYIN: 7, HETH: 8,
  TETH: 9, YODH: 10, KAPH: 11, LAMEDH: 12, MEM: 13, NUN: 14, SAMEKH: 15,
  AYIN: 16, PE: 17, TSADHE: 18, QOPH: 19, RESH: 20, SIN: 21, SHIN: 21, TAW: 22,
};

interface Captured {
  title: string; album: string; kind: string;
  duration: string; url: string; cover: string | null; download?: string | null;
}

export interface MusicTrack {
  title: string; url: string; duration: string;
  psalm?: number; stanza?: number; download?: string;
}
export interface MusicAlbum { name: string; cover: string | null; tracks: MusicTrack[] }

/* Their page sets every string in caps for display. Caps are a typographic
   choice on their surface and would be shouting on ours, so the words come
   back to sentence case — the text is unchanged, only its casing.
   Two things must survive the trip: the roman numerals that number the Hymns
   volumes, and EveryPsalm, which is one word the publisher writes camel. A
   naive "leave short words alone" rule kept MY in "All MY Delight", so the
   exception is a list of what is actually a numeral rather than a length. */
const ROMAN = /^(?:I{1,3}|IV|V|VI{0,3}|IX|X)$/;
const titleCase = (s: string): string =>
  s.split(" ")
    .map((w) => (ROMAN.test(w) ? w
      : w.toUpperCase() === "EVERYPSALM" ? "EveryPsalm"
      : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");

export function shape(rows: Captured[]): { albums: MusicAlbum[] } {
  const albums = new Map<string, MusicAlbum>();
  for (const row of rows) {
    if (!row.url) continue;
    const album = albums.get(row.album)
      ?? { name: titleCase(row.album), cover: row.cover, tracks: [] };
    albums.set(row.album, album);

    const track: MusicTrack = { title: titleCase(row.title), url: row.url, duration: row.duration };
    const plain = /^PSALM\s+(\d+)$/.exec(row.title);
    const acrostic = /^PSALM\s+119\s*-\s*([A-Z]+)$/.exec(row.title);
    if (plain) track.psalm = Number(plain[1]);
    else if (acrostic && STANZA[acrostic[1]!] !== undefined) {
      track.psalm = 119;
      track.stanza = STANZA[acrostic[1]!];
    }
    if (row.download) track.download = row.download;
    album.tracks.push(track);
  }
  return { albums: [...albums.values()] };
}

if (process.argv[1]?.endsWith("import-poor-bishop-hooper.ts")) {
  const at = process.argv.indexOf("--from");
  if (at === -1) throw new Error("--from <captured.json> is required; see the note at the head of this file");
  const rows = JSON.parse(readFileSync(resolve(process.argv[at + 1]!), "utf8")) as Captured[];
  const { albums } = shape(rows);
  const catalogue = {
    schema: "pericope.music-catalogue",
    version: 1,
    source: {
      id: "poor-bishop-hooper",
      name: "Poor Bishop Hooper",
      homepageUrl: "https://www.poorbishophooper.com/",
      listenUrl: "https://www.poorbishophooper.com/listen",
      mediaHosts: ["cdn.prod.website-files.com"],
    },
    albums,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(catalogue, null, 1)}\n`);
  const tracks = albums.reduce((n, a) => n + a.tracks.length, 0);
  const linked = albums.reduce((n, a) => n + a.tracks.filter((t) => t.psalm !== undefined).length, 0);
  console.log(`${albums.length} albums · ${tracks} tracks · ${linked} carry a psalm`);
}
