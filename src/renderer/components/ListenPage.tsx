/**
 * Listen — the room where everything with a runtime lives.
 *
 * ── WHY A PAGE AND NOT A FOURTH MARGIN LENS ─────────────────────────────────
 *
 * Every other way into the player answers a question the reader already asked:
 * the margin offers what teaches THIS chapter, the walk offers what teaches it
 * next, the dock offers what is already running. All three are passage-shaped,
 * and none of them can answer "what is here?" — a reader who wants to browse
 * has to first choose a chapter and hope its margin is interesting.
 *
 * So this is the one surface in the app organised by the material rather than
 * by the text: series, albums, seasons, tracks. It is the shape a listener
 * already knows from every music app they have ever used, and it exists so
 * that pressing play is not conditional on knowing what to press play ON.
 *
 * ── WHAT IT IS NOT: A WALL OF COVER ART ─────────────────────────────────────
 *
 * The obvious way to build a discovery page is to fetch every publisher's
 * artwork and lay it out in a grid, and docs/trusted-resource-permissions
 * lists "publisher artwork and cover thumbnails" under DEFERRED work — not as
 * an oversight, as a decision. Album art is the publisher's, remote, and
 * unlicensed to us; a grid of it would also be the fastest possible way to
 * make this app look like every other one.
 *
 * The room is TYPOGRAPHIC instead, which is what the rest of the app already
 * is. A card carries the work's name in the reading face, what it holds, and
 * the one fact a listener chooses on — how long, how many, which passages.
 * Publisher identity comes from the plates the brand system already draws and
 * is already permitted to draw. Nothing here is fetched from anyone's server
 * but the audio itself, at press time, the same as every other launch.
 *
 * ── ONE TRANSPORT ───────────────────────────────────────────────────────────
 *
 * Music does not get a player of its own. A track is shaped into the same
 * `PodcastEpisode` the margin hands over and goes through the same
 * `playPodcastEpisode`, so there is still exactly one audio element in the
 * app and the dock is still the only thing that owns it. Two players is how
 * two things end up making sound at once.
 */

import React, { useEffect, useMemo, useState } from "react";

import catalogue from "../../../data/music/poor-bishop-hooper.json";
import { playPodcastEpisode, type PodcastEpisode, type PodcastPassage } from "./PodcastPlayer";
import type { ResourceLibraryCatalogue } from "./ResourceLibraryMatrix";

interface MusicTrack {
  title: string;
  url: string;
  duration: string;
  psalm?: number;
  stanza?: number;
  download?: string;
}
interface MusicAlbum { name: string; cover: string | null; tracks: MusicTrack[] }
interface MusicCatalogue {
  source: { id: string; name: string; homepageUrl: string; listenUrl: string };
  albums: MusicAlbum[];
}

const MUSIC = catalogue as unknown as MusicCatalogue;

/** Seconds, from the publisher's own "m:ss". Used for a total, never displayed. */
function seconds(duration: string): number {
  const parts = duration.split(":").map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** "3 hr 12 min" — the shape a listener reads a runtime in, not "192 min". */
function extent(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * What an album says about itself under its name.
 *
 * A psalm range is the useful fact where there is one — "Psalms 1–150" tells a
 * reader what this is faster than a track count does — and a count is the
 * honest fallback where a record is not psalm-shaped.
 */
function albumFooting(album: MusicAlbum): string {
  const psalms = album.tracks.map((t) => t.psalm).filter((p): p is number => p !== undefined);
  const runtime = extent(album.tracks.reduce((n, t) => n + seconds(t.duration), 0));
  if (psalms.length >= album.tracks.length / 2) {
    const low = Math.min(...psalms);
    const high = Math.max(...psalms);
    const span = low === high ? `Psalm ${low}` : `Psalms ${low}–${high}`;
    return `${span} · ${album.tracks.length} songs · ${runtime}`;
  }
  return `${album.tracks.length} ${album.tracks.length === 1 ? "song" : "songs"} · ${runtime}`;
}

/**
 * The passage a track carries, where its own title named one.
 *
 * `basis: "record"` rather than "moment", and the distinction is the honest
 * one: a moment is a timestamped claim about where inside a runtime a passage
 * is discussed, and this is not that. The whole track IS the psalm — the
 * record says so in its title, and there is no interior position to point at.
 */
function trackPassage(track: MusicTrack): PodcastPassage | null {
  if (track.psalm === undefined) return null;
  return { book: "PSA", chapter: track.psalm, verse: null, endVerse: null, basis: "record" };
}

function asEpisode(album: MusicAlbum, track: MusicTrack): PodcastEpisode {
  const id = `${MUSIC.source.id}:${album.name}:${track.title}`;
  return {
    id,
    sourceId: MUSIC.source.id,
    recordId: id,
    sourceName: MUSIC.source.name,
    title: track.title,
    officialUrl: MUSIC.source.listenUrl,
    audioUrl: track.url,
    passage: trackPassage(track),
    /* Named for what it is. The dock prints this beside the extent, and a song
       announced as a "podcast" is the sort of small lie a reader notices. */
    kind: "song",
  };
}

function TransportMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

export function ListenPage(): React.JSX.Element {
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  /* The room reads the catalogue itself rather than being handed one. The
     margin keeps its own copy for the lens it draws, and threading that state
     up through the shell to reach a sibling page would make two surfaces
     share a lifetime they do not share — this page can be open while no
     margin exists. */
  const [resourceCatalogue, setResourceCatalogue] = useState<ResourceLibraryCatalogue | null>(null);
  useEffect(() => {
    let live = true;
    void window.api.trustedResources.catalogue().then((result) => {
      if (live && result.ok) setResourceCatalogue({ sources: result.sources, mutes: result.mutes });
    }).catch(() => { /* an empty shelf is the honest answer to a refusal */ });
    return () => { live = false; };
  }, []);

  /* Longest first, which is the same ordering the resources room uses and for
     the same reason: the fullest treatment is the one most likely to be what
     someone arriving with no particular question is looking for. */
  const albums = useMemo(
    () => [...MUSIC.albums].sort((a, b) => b.tracks.length - a.tracks.length),
    [],
  );
  const album = albums.find((a) => a.name === openAlbum) ?? null;

  /* Escape closes an open album before it does anything else on this page. */
  useEffect(() => {
    if (!album) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); setOpenAlbum(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [album]);

  const series = resourceCatalogue?.sources.filter((s) => !s.muted) ?? [];

  return (
    <div className="listen">
      <div className="listen-inner">
      <header className="listen-head">
        <h1 className="listen-title">Listen</h1>
        <p className="listen-lede">
          Everything in your library that has a runtime — sung and spoken.
        </p>
      </header>

      {album ? (
        <section className="listen-album" aria-label={album.name}>
          <div className="listen-album-head">
            <button className="listen-back" onClick={() => setOpenAlbum(null)} type="button">
              ← All music
            </button>
            <h2 className="listen-album-name">{album.name}</h2>
            <p className="listen-album-foot">{albumFooting(album)}</p>
          </div>
          <ol className="listen-tracks">
            {album.tracks.map((track, index) => (
              <li className="listen-track" key={`${album.name}:${track.title}:${index}`}>
                <button
                  aria-label={`Play ${track.title}${track.psalm !== undefined ? `, Psalm ${track.psalm}` : ""} — ${MUSIC.source.name}`}
                  className="listen-track-face"
                  onClick={() => playPodcastEpisode(asEpisode(album, track))}
                  type="button"
                >
                  <span aria-hidden="true" className="listen-track-no">{index + 1}</span>
                  <span className="listen-track-title">{track.title}</span>
                  <span aria-hidden="true" className="listen-track-play"><TransportMark /></span>
                  <span className="listen-track-extent">{track.duration}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <>
          <section aria-label="Music" className="listen-shelf">
            <div className="listen-shelf-head">
              <h2 className="listen-shelf-name">Music</h2>
              <p className="listen-shelf-by">{MUSIC.source.name}</p>
            </div>
            <ul className="listen-grid">
              {albums.map((entry) => (
                <li className="listen-card" key={entry.name}>
                  <button
                    aria-label={`${entry.name} — ${albumFooting(entry)}`}
                    className="listen-card-face"
                    onClick={() => setOpenAlbum(entry.name)}
                    type="button"
                  >
                    <span className="listen-card-name">{entry.name}</span>
                    <span className="listen-card-foot">{albumFooting(entry)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {series.length > 0 && (
            <section aria-label="Series" className="listen-shelf">
              <div className="listen-shelf-head">
                <h2 className="listen-shelf-name">Series</h2>
                <p className="listen-shelf-by">Spoken, from your library</p>
              </div>
              <ul className="listen-grid">
                {series.map((source) => (
                  <li className="listen-card" data-source={source.id} key={source.id}>
                    <span className="listen-card-face is-series">
                      <span className="listen-card-plate" data-source={source.id}>
                        <span className="taught-here-mark">{source.name}</span>
                      </span>
                      <span className="listen-card-name">{source.name}</span>
                      <span className="listen-card-foot">
                        {source.records} {source.records === 1 ? "episode" : "episodes"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* The footing this room owes, in the same words the player's own
          colophon uses. Music is referenced where the publisher serves it and
          is never copied here — see docs/trusted-resource-permissions. */}
      <p className="listen-colophon">
        Audio streams from each publisher’s own servers. Nothing is stored here.
      </p>
      </div>
    </div>
  );
}
