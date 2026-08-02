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

/**
 * Seconds, out of the publisher's own "m:ss" (or "h:mm:ss").
 *
 * ── WHY THIS PARSER LIVES HERE AND NOT IN THE ROOM ─────────────────────────
 *
 * It was written in the Listen room, where the only thing wanted from it was a
 * sum: thirteen tracks added into "48 min" under an album's name. Then playlist
 * rows needed a duration each, and the shaping that would have to carry it —
 * `asEpisode` — had already moved out here, because a track's `id` must be built
 * in exactly one place or a resumed album plays while every row on screen shows
 * nothing playing.
 *
 * That left two bad options and one right one. Importing the room from this file
 * would make the shapers depend on the surface that draws them, which is the
 * loop the move was made to break. Copying six lines of parser would put the two
 * halves of a duration — the sum in the hero and the number on the row — on
 * separate implementations, free to disagree the first time a publisher writes
 * an hour. So the parser comes here with the shapers and the room imports it
 * back. One parser, two callers, same as the ids.
 *
 * The two sources genuinely disagree in type and neither is wrong: a song's
 * length is a string the publisher typed, a spoken episode's is a number the
 * feed stated. This is the only place that has to know that.
 */
export function seconds(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

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
  /* Parsed once, and omitted rather than carried as zero when the publisher's
     string is something this parser cannot read. Zero would print as an empty
     clock anyway, but through a branch claiming the publisher stated nothing
     while carrying a number that says otherwise. */
  const stated = seconds(track.duration);
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
    ...(stated > 0 ? { durationSeconds: stated } : {}),
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
    /* `durationSeconds` on a catalogue episode is `number | null` — a feed that
       stated no length is ordinary, not an error — so the field is omitted
       rather than set to null. An episode carrying none draws a blank cell of
       the right width, which keeps the right edge of the list in one line
       whether the publisher said anything or not. */
    ...(ep.durationSeconds != null && ep.durationSeconds > 0
      ? { durationSeconds: ep.durationSeconds }
      : {}),
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

/**
 * A stored playlist entry, turned back into something playable — or not.
 *
 * NOTHING IS TRUSTED FROM THE ENTRY except the identity. The title it carries
 * is a fallback for naming a row that no longer resolves, never a source for
 * what gets drawn or played, so a catalogue that renamed a track shows the
 * catalogue's name and a track that has left shows the last one we knew.
 *
 * Null is an ordinary answer, not a failure: the record left the library, or
 * its publisher is muted, or the reader's library is a different one. The
 * caller draws that row as unplayable rather than dropping it, because a list
 * that silently shortens is a list a reader cannot trust.
 *
 * The album is matched by NAME OR SLUG. Name is the stored key because songs
 * have no ids; slug is the hedge for a record retitled upstream.
 */
export function resolveEntry(
  entry:
    | { kind: "music"; sourceId: string; album: string; title: string }
    | { kind: "podcast"; sourceId: string; recordId: string; title: string },
  audio: Record<string, AudioCatalogueEpisode[]> | null,
  named: (sourceId: string) => string,
): PodcastEpisode | null {
  if (entry.kind === "music") {
    if (entry.sourceId !== MUSIC.source.id) return null;
    const album = MUSIC.albums.find((one) => one.name === entry.album)
      ?? MUSIC.albums.find((one) => one.slug === entry.album);
    const track = album?.tracks.find((one) => one.title === entry.title);
    return album && track ? asEpisode(album, track) : null;
  }
  const episodes = audio?.[entry.sourceId];
  const found = episodes?.find((one) => one.recordId === entry.recordId);
  if (!found) return null;
  return seriesEpisode(entry.sourceId, named(entry.sourceId), found, SERIES_ART[entry.sourceId]);
}
