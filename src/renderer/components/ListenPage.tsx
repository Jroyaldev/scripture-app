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
 * by the text: series, albums, groups, tracks. It is the shape a listener
 * already knows from every music app they have ever used, and it exists so
 * that pressing play is not conditional on knowing what to press play ON.
 *
 * ── THE RECORD IS THE OBJECT · RESTATED 2026-08-02 ──────────────────────────
 *
 * The first build of this room drew no artwork, because "publisher artwork and
 * cover thumbnails" sat under Deferred in docs/trusted-resource-permissions.
 * The maintainer lifted that deferral looking at the result, and was right to:
 * a listening room without the record is a spreadsheet of runtimes. A cover is
 * how anyone has ever found music, and fourteen albums of type all look like
 * the same album.
 *
 * So the room is art-led now, under the terms that clause records — the image
 * is REFERENCED from the publisher's own host at draw time, never copied — and
 * every piece of art carries its illustrator's name where the publisher states
 * one. The tint under each record is computed from the cover itself at import
 * (see scripts/import-poor-bishop-hooper), so an ambient field costs the
 * renderer nothing and cannot disagree with the artwork above it.
 *
 * ── ONE TRANSPORT ───────────────────────────────────────────────────────────
 *
 * Music does not get a player of its own. A track is shaped into the same
 * `PodcastEpisode` the margin hands over and goes through the same
 * `playPodcastEpisode`, so there is still exactly one audio element in the
 * app and the dock is still the only thing that owns it.
 */

import React, { useEffect, useMemo, useState } from "react";

import catalogue from "../../../data/music/poor-bishop-hooper.json";
import seriesArt from "../../../data/music/series-art.json";
import { playPodcastEpisode, type PodcastEpisode, type PodcastPassage } from "./PodcastPlayer";
import type { ResourceLibraryCatalogue } from "./ResourceLibraryMatrix";
import type { AudioCatalogueEpisode } from "../../core/resources/audio-catalogue";

interface MusicTrack {
  title: string; url: string; duration: string;
  psalm?: number; stanza?: number; group?: string; cover?: string; download?: string;
}
interface MusicAlbum {
  name: string; cover: string | null; tracks: MusicTrack[];
  released?: string; about?: string; tint?: string; slug?: string | null;
  credits?: Record<string, string>;
}
interface MusicCatalogue {
  source: { id: string; name: string; homepageUrl: string; listenUrl: string };
  albums: MusicAlbum[];
}

const MUSIC = catalogue as unknown as MusicCatalogue;
const SERIES_ART = seriesArt as Record<string, string>;

/** What the shows the manifest registry does not carry call themselves. */
const NAMES: Record<string, string> = {
  "bema": "The BEMA Podcast",
  "thirty-minutes-nt": "30 Minutes in the New Testament",
};

/** Seconds, from the publisher's own "m:ss". Summed for a runtime, never shown. */
function seconds(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** "3 hr 12 min" — the shape a listener reads a runtime in, not "192 min". */
function extent(total: number): string {
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** The year the publisher stated, out of whatever prose they stated it in. */
function year(released: string | undefined): string | null {
  const years = released?.match(/\b(?:19|20)\d{2}\b/g);
  if (!years) return null;
  return years[0] === years[years.length - 1] ? years[0]! : `${years[0]}–${years[years.length - 1]}`;
}

/** Year · N songs · runtime — the line a listener actually chooses on. */
function albumLine(album: MusicAlbum): string {
  const runtime = extent(album.tracks.reduce((n, t) => n + seconds(t.duration), 0));
  const count = `${album.tracks.length} ${album.tracks.length === 1 ? "song" : "songs"}`;
  return [year(album.released), count, runtime].filter(Boolean).join(" · ");
}

/** The whole track IS the psalm; there is no interior position to point at. */
function trackPassage(track: MusicTrack): PodcastPassage | null {
  if (track.psalm === undefined) return null;
  return { book: "PSA", chapter: track.psalm, verse: null, endVerse: null, basis: "record" };
}

function asEpisode(album: MusicAlbum, track: MusicTrack): PodcastEpisode {
  const id = `${MUSIC.source.id}:${album.name}:${track.title}`;
  return {
    id, sourceId: MUSIC.source.id, recordId: id,
    sourceName: MUSIC.source.name,
    title: track.title,
    officialUrl: MUSIC.source.listenUrl,
    audioUrl: track.url,
    passage: trackPassage(track),
    /* Named for what it is: a song announced as a "podcast" is the sort of
       small lie a reader notices. */
    kind: "song",
  };
}

/** A series episode, shaped for the one transport the app has. */
function seriesEpisode(sourceId: string, name: string, ep: AudioCatalogueEpisode): PodcastEpisode {
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
  };
}

/** "42:10" from the publisher's stated seconds; blank when they stated none. */
function clock(secondsTotal: number | null): string {
  if (!secondsTotal || secondsTotal <= 0) return "";
  const total = Math.round(secondsTotal);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s2 = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`
    : `${m}:${String(s2).padStart(2, "0")}`;
}

function PlayGlyph({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/**
 * The record itself.
 *
 * `loading="lazy"` because EveryPsalm alone opens thirteen of these and the
 * grid holds twenty-two; `decoding="async"` so a cover never blocks the room
 * from drawing. The tint sits UNDER the image rather than behind the card, so
 * a cover that has not arrived is a coloured square of the right shape rather
 * than a hole — the layout never moves when the art lands.
 */
function Cover({ src, tint, alt, className = "" }: {
  src?: string | null; tint?: string; alt: string; className?: string;
}): React.JSX.Element {
  return (
    <span className={`listen-cover ${className}`} style={tint ? { background: tint } : undefined}>
      {src ? <img alt={alt} decoding="async" loading="lazy" src={src} /> : null}
    </span>
  );
}

export function ListenPage(): React.JSX.Element {
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [resourceCatalogue, setResourceCatalogue] = useState<ResourceLibraryCatalogue | null>(null);
  const [audio, setAudio] = useState<Record<string, AudioCatalogueEpisode[]>>({});
  const [openSeries, setOpenSeries] = useState<string | null>(null);

  /* TWO CATALOGUES, AND THE ROOM NEEDS BOTH — for names, and for episodes.
     `trustedResources.catalogue()` knows what each publisher is CALLED, and
     its `records` count is the manifest's: episodes whose title stated a
     passage. That number is right for the margin and catastrophic here — it
     drew Radically Christian as 11 against the 301 the library holds, and Ask
     N.T. Wright as 0 against 318. The counts come from the audio catalogue;
     only the names come from the other. */
  useEffect(() => {
    let live = true;
    void window.api.trustedResources.catalogue().then(async (result) => {
      if (!live || !result.ok) return;
      setResourceCatalogue({ sources: result.sources, mutes: result.mutes });
      const ids = [...new Set([...result.sources.map((s) => s.id), ...Object.keys(SERIES_ART)])];
      const shelf = await window.api.audio.catalogue(ids);
      if (!live || !shelf.ok) return;
      setAudio(Object.fromEntries(shelf.series.map((s) => [s.sourceId, s.episodes])));
    }).catch(() => { /* an empty shelf is the honest answer to a refusal */ });
    return () => { live = false; };
  }, []);

  /* Newest first, then longest — a listening room is a shelf of releases, and
     "what is new" is the question a record shelf answers before any other. */
  const albums = useMemo(() => [...MUSIC.albums].sort((a, b) => {
    const ya = Number(year(a.released)?.slice(-4) ?? 0);
    const yb = Number(year(b.released)?.slice(-4) ?? 0);
    return yb - ya || b.tracks.length - a.tracks.length;
  }), []);
  const album = albums.find((a) => a.name === openAlbum) ?? null;

  useEffect(() => {
    if (!album) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); setOpenAlbum(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [album]);

  /* An album's own groups, in the order its tracks arrive. EveryPsalm ships
     thirteen — the psalm genres their illustrator drew a cover for, plus the
     Psalter's five books for the instrumentals — and that is the publisher's
     division of their own work rather than ours. An album with no groups
     renders as one unnamed run, which is every other album here. */
  const groups = useMemo(() => {
    if (!album) return [];
    const order: string[] = [];
    const byGroup = new Map<string, MusicTrack[]>();
    for (const track of album.tracks) {
      const key = track.group ?? "";
      if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key); }
      byGroup.get(key)!.push(track);
    }
    return order.map((key) => ({ name: key, cover: byGroup.get(key)![0]?.cover, tracks: byGroup.get(key)! }));
  }, [album]);

  /* Built from the AUDIO catalogue, so a publisher appears here when it has
     episodes rather than when it has cards — which is how BEMA and 30 Minutes
     in the New Testament reach this shelf at all: neither is in the manifest
     registry the margin reads. The name comes from the manifest where there is
     one and from the id where there is not. */
  const muted = new Set(resourceCatalogue?.sources.filter((s) => s.muted).map((s) => s.id) ?? []);
  const named = new Map(resourceCatalogue?.sources.map((s) => [s.id, s.name]) ?? []);
  /* A publisher outside the manifest registry has no name to read, and an id
     title-cased is not a name — it drew "Bema" and "Thirty Minutes Nt". The
     feed registry already holds what these shows call themselves; the two the
     margin cannot name are named here until they join it. */
  const titleFromId = (id: string): string =>
    NAMES[id] ?? id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const series = Object.entries(audio)
    .filter(([id]) => !muted.has(id))
    .map(([id, episodes]) => ({ id, name: named.get(id) ?? titleFromId(id), episodes }))
    .sort((a, b) => b.episodes.length - a.episodes.length);
  const openedSeries = series.find((s) => s.id === openSeries) ?? null;

  if (openedSeries) {
    /* SEASONS, and they are the publisher's calendar rather than our
       invention: a podcast's own division of itself is the year it published
       in, which is the grouping every listening app falls back to when a show
       declares no seasons of its own. Newest first, inside and out — a series
       page nobody has read before opens on what is new. */
    const byYear = new Map<string, AudioCatalogueEpisode[]>();
    for (const ep of [...openedSeries.episodes].sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))) {
      const when = ep.publishedAt ? new Date(ep.publishedAt).getFullYear() : null;
      const key = Number.isFinite(when) && when ? String(when) : "Undated";
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key)!.push(ep);
    }
    const art = SERIES_ART[openedSeries.id];
    return (
      <div className="listen">
        <div className="listen-inner">
          <button className="listen-back" onClick={() => setOpenSeries(null)} type="button">← All series</button>
          <header className="listen-hero">
            <Cover alt={`${openedSeries.name} cover`} className="is-hero" src={art} />
            <div className="listen-hero-words">
              <p className="listen-hero-kicker">Series</p>
              <h1 className="listen-hero-name">{openedSeries.name}</h1>
              <p className="listen-hero-line">{openedSeries.episodes.length} episodes</p>
              <div className="listen-hero-actions">
                <button
                  className="listen-play-all"
                  onClick={() => {
                    const first = openedSeries.episodes[0];
                    if (first) playPodcastEpisode(seriesEpisode(openedSeries.id, openedSeries.name, first));
                  }}
                  type="button"
                >
                  <PlayGlyph size={16} /> Play
                </button>
              </div>
            </div>
          </header>
          {[...byYear.entries()].map(([when, eps]) => (
            <section className="listen-group" key={when}>
              <div className="listen-group-head">
                <h2 className="listen-group-name">{when}</h2>
                <span className="listen-group-count">{eps.length}</span>
              </div>
              <ol className="listen-tracks">
                {eps.map((ep, index) => (
                  <li className="listen-track" key={ep.recordId}>
                    <button
                      aria-label={`Play ${ep.title} — ${openedSeries.name}`}
                      className="listen-track-face"
                      onClick={() => playPodcastEpisode(seriesEpisode(openedSeries.id, openedSeries.name, ep))}
                      type="button"
                    >
                      <span aria-hidden="true" className="listen-track-no">{index + 1}</span>
                      <span aria-hidden="true" className="listen-track-play"><PlayGlyph /></span>
                      <span className="listen-track-title">{ep.title}</span>
                      <span className="listen-track-extent">{clock(ep.durationSeconds)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          <p className="listen-colophon">
            Artwork and audio are shown and streamed from each publisher’s own servers.
            Nothing is stored here.
          </p>
        </div>
      </div>
    );
  }

  if (album) {
    return (
      <div className="listen">
        <div className="listen-ambient" style={album.tint ? { background: album.tint } : undefined} />
        <div className="listen-inner">
          <button className="listen-back" onClick={() => setOpenAlbum(null)} type="button">← All music</button>

          <header className="listen-hero">
            <Cover alt={`${album.name} cover`} className="is-hero" src={album.cover} tint={album.tint} />
            <div className="listen-hero-words">
              <p className="listen-hero-kicker">Album · {MUSIC.source.name}</p>
              <h1 className="listen-hero-name">{album.name}</h1>
              <p className="listen-hero-line">{albumLine(album)}</p>
              {album.about && <p className="listen-hero-about">{album.about}</p>}
              <div className="listen-hero-actions">
                <button
                  className="listen-play-all"
                  onClick={() => { const first = album.tracks[0]; if (first) playPodcastEpisode(asEpisode(album, first)); }}
                  type="button"
                >
                  <PlayGlyph size={16} /> Play
                </button>
              </div>
              {album.credits && (
                <p className="listen-credits">
                  {Object.entries(album.credits).map(([role, who]) => `${role}: ${who}`).join(" · ")}
                </p>
              )}
            </div>
          </header>

          {groups.map((group) => (
            <section className="listen-group" key={group.name || "all"}>
              {group.name && (
                <div className="listen-group-head">
                  <Cover alt={`${group.name} cover`} className="is-group" src={group.cover} tint={album.tint} />
                  <h2 className="listen-group-name">{group.name}</h2>
                  <span className="listen-group-count">{group.tracks.length}</span>
                </div>
              )}
              <ol className="listen-tracks">
                {group.tracks.map((track, index) => (
                  <li className="listen-track" key={`${track.title}:${index}`}>
                    <button
                      aria-label={`Play ${track.title} — ${album.name}, ${MUSIC.source.name}`}
                      className="listen-track-face"
                      onClick={() => playPodcastEpisode(asEpisode(album, track))}
                      type="button"
                    >
                      <span aria-hidden="true" className="listen-track-no">{index + 1}</span>
                      <span aria-hidden="true" className="listen-track-play"><PlayGlyph /></span>
                      <span className="listen-track-title">{track.title}</span>
                      <span className="listen-track-extent">{track.duration}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <p className="listen-colophon">
            Artwork and audio are shown and streamed from {MUSIC.source.name}’s own servers.
            Nothing is stored here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="listen">
      <div className="listen-inner">
        <header className="listen-head">
          <h1 className="listen-title">Listen</h1>
          <p className="listen-lede">Everything in your library that has a runtime — sung and spoken.</p>
        </header>

        <section aria-label="Music" className="listen-shelf">
          <div className="listen-shelf-head">
            <h2 className="listen-shelf-name">Music</h2>
            <p className="listen-shelf-by">{MUSIC.source.name}</p>
          </div>
          <ul className="listen-grid">
            {albums.map((entry) => (
              <li className="listen-card" key={entry.name}>
                <button
                  aria-label={`${entry.name} — ${albumLine(entry)}`}
                  className="listen-card-face"
                  onClick={() => setOpenAlbum(entry.name)}
                  type="button"
                >
                  <span className="listen-card-art">
                    <Cover alt={`${entry.name} cover`} src={entry.cover} tint={entry.tint} />
                    <span aria-hidden="true" className="listen-card-play"><PlayGlyph size={18} /></span>
                  </span>
                  <span className="listen-card-name">{entry.name}</span>
                  <span className="listen-card-foot">{albumLine(entry)}</span>
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
                  <button
                    aria-label={`${source.name} — ${source.episodes.length} episodes`}
                    className="listen-card-face"
                    onClick={() => setOpenSeries(source.id)}
                    type="button"
                  >
                    <span className="listen-card-art">
                      {SERIES_ART[source.id]
                        ? <Cover alt={`${source.name} cover`} src={SERIES_ART[source.id]} />
                        : (
                          <span className="listen-cover is-plate">
                            <span className="listen-card-plate" data-source={source.id}>
                              <span className="taught-here-mark">{source.name}</span>
                            </span>
                          </span>
                        )}
                      <span aria-hidden="true" className="listen-card-play"><PlayGlyph size={18} /></span>
                    </span>
                    <span className="listen-card-name">{source.name}</span>
                    <span className="listen-card-foot">
                      {source.episodes.length} {source.episodes.length === 1 ? "episode" : "episodes"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="listen-colophon">
          Artwork and audio are shown and streamed from each publisher’s own servers.
          Nothing is stored here.
        </p>
      </div>
    </div>
  );
}
