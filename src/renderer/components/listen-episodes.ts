/**
 * One shaping of a record into episodes, for the two places that need it.
 *
 * ── WHY THIS MOVED OUT OF THE ROOM ─────────────────────────────────────────
 *
 * The Listen room built these shapes for its own lists and that was the only
 * place they were wanted, so that is where they lived. Then the resume learned
 * to restore a whole record rather than one track, and App — which mounts the
 * room but is not the room — needed to rebuild the same list from the same
 * catalogue at boot.
 *
 * Copying them would have been the quiet disaster: a track's `id` is the
 * identity every surface matches on, so two shapers drifting by one character
 * means a resumed album plays while every row in the room shows nothing
 * playing. One shaper, two callers.
 *
 * ── WHAT THIS FILE MAY NOT DO ──────────────────────────────────────────────
 *
 * It shapes and it resolves. It never plays. The play verbs live behind a
 * caller-list contract naming exactly three components, and the point of that
 * contract is that new ways to FILL a queue must not become new ways to start
 * audio. A `startPodcastQueue` in here would slip that leash unnoticed, since
 * the contract only reads `.tsx`.
 *
 * Everything here reads LOCAL data — the bundled music catalogue and episode
 * files the library already holds. No publisher is asked anything, which is
 * what lets a resume be rebuilt before the reader has pressed a thing.
 */
import catalogue from "../../../data/music/poor-bishop-hooper.json";
import seriesArt from "../../../data/music/series-art.json";
import type { PodcastEpisode, PodcastPassage } from "./PodcastPlayer";
import type { AudioCatalogueEpisode } from "../../core/resources/audio-catalogue";

export interface MusicTrack {
  title: string; url: string; duration: string;
  psalm?: number; stanza?: number; group?: string; cover?: string; download?: string;
}
export interface MusicAlbum {
  name: string; cover: string | null; tracks: MusicTrack[];
  released?: string; about?: string; tint?: string; slug?: string | null;
  credits?: Record<string, string>;
}
export interface MusicCatalogue {
  source: { id: string; name: string; homepageUrl: string; listenUrl: string };
  albums: MusicAlbum[];
}

export const MUSIC = catalogue as unknown as MusicCatalogue;

/** Cover and the one colour it is, computed at author time by
 *  scripts/compute-cover-tints.py so no page has to look at an image to
 *  know what colour it should be. */
export const SERIES_ART = seriesArt as Record<string, { cover: string; tint: string }>;

/** The whole track IS the psalm; there is no interior position to point at. */
export function trackPassage(track: MusicTrack): PodcastPassage | null {
  if (track.psalm === undefined) return null;
  return { book: "PSA", chapter: track.psalm, verse: null, endVerse: null, basis: "record" };
}

/**
 * A song's identity, and the thing to be careful with.
 *
 * It is built from DISPLAY strings — the album's name and the track's title —
 * because the catalogue gives songs no ids of their own. That is stable across
 * launches, which is all the ledger and the row markings need. It is NOT stable
 * across a re-import that retitles something, and anything that stores these
 * for a long time should expect an orphan and cope rather than trust it.
 */
export function trackId(album: MusicAlbum, track: MusicTrack): string {
  return `${MUSIC.source.id}:${album.name}:${track.title}`;
}

export function asEpisode(album: MusicAlbum, track: MusicTrack): PodcastEpisode {
  const id = trackId(album, track);
  return {
    id, sourceId: MUSIC.source.id, recordId: id,
    sourceName: MUSIC.source.name,
    title: track.title,
    officialUrl: MUSIC.source.listenUrl,
    audioUrl: track.url,
    passage: trackPassage(track),
    /* Named for what it is: a song announced as a "podcast" is the sort of
       small lie a reader notices. And `kind` is what the dock reads to decide
       which transport to wear, so the word does real work now. */
    kind: "song",
    /* The sleeve travels with the song. A group cover where the publisher drew
       one, the record's otherwise. */
    ...(track.cover ?? album.cover ? { artUrl: track.cover ?? album.cover ?? undefined } : {}),
    ...(album.tint ? { tint: album.tint } : {}),
  };
}

/** A series episode, shaped for the one transport the app has. */
export function seriesEpisode(
  sourceId: string,
  name: string,
  ep: AudioCatalogueEpisode,
  art?: { cover: string; tint: string },
): PodcastEpisode {
  return {
    id: `${sourceId}:${ep.recordId}`,
    sourceId,
    recordId: ep.recordId,
    sourceName: name,
    title: ep.title,
    officialUrl: ep.officialUrl ?? "",
    audioUrl: ep.audioUrl,
    passage: null,
    kind: "podcast",
    ...(art ? { artUrl: art.cover, tint: art.tint } : {}),
  };
}

/**
 * An album's tracks in the order the room draws them.
 *
 * The room groups by the publisher's own `group` in order of first appearance
 * and then flattens, so a queue started from a row matches the row's position.
 * A queue rebuilt at boot has to use the SAME order or a resumed record would
 * carry on from a different track than the one on screen.
 */
export function albumOrder(album: MusicAlbum): MusicTrack[] {
  const order: string[] = [];
  const byGroup = new Map<string, MusicTrack[]>();
  for (const track of album.tracks) {
    const key = track.group ?? "";
    if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key); }
    byGroup.get(key)!.push(track);
  }
  return order.flatMap((key) => byGroup.get(key)!);
}

/** Newest first, and newest within a year first — the order the room shows. */
export function seriesOrder(
  episodes: readonly AudioCatalogueEpisode[],
): AudioCatalogueEpisode[] {
  return [...episodes].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}
