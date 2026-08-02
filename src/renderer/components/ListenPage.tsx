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
 * a listening room without the record is a spreadsheet of runtimes.
 *
 * The image is REFERENCED from the publisher's own host at draw time, never
 * copied, and every piece of art carries its illustrator's name where the
 * publisher states one.
 *
 * ── THE DETAIL PASS · 2026-08-02 ────────────────────────────────────────────
 *
 * The maintainer read the first art-led build as a mockup rather than a
 * finished screen, and named the tell exactly: the publisher's description was
 * clamped to three lines with no way to open it. That is what separates a comp
 * from a product — a comp is built with copy that happens to fit. Everything
 * below is the same category of defect, found by looking for it:
 *
 *   · the description opens now, and fades rather than guillotines
 *   · ONE hero serves both pages, because album and series are siblings and
 *     were drifting into rich and poor relations of each other
 *   · a series carries its span and its runtime, so its hero says something
 *   · the accent is derived from the record's own artwork rather than the
 *     app's seal, so each page is coloured by the thing it is about
 *   · the shelf paints a skeleton instead of popping the Series row in when
 *     the audio IPC lands
 *   · a playing row says so, in every list
 *   · Escape leaves a series the way it already left an album
 *
 * WHAT IS DELIBERATELY NOT HERE: pressing Play still starts one track rather
 * than a queue. That is real, it is task #2, and it wants the walk machinery
 * rather than a second sequencer bolted on here.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import catalogue from "../../../data/music/poor-bishop-hooper.json";
import seriesArt from "../../../data/music/series-art.json";
import {
  playPodcastEpisode,
  usePodcastNowPlaying,
  type PodcastEpisode,
  type PodcastPassage,
} from "./PodcastPlayer";
import type { ResourceLibraryCatalogue } from "./ResourceLibraryMatrix";
import { sameEpisode, type AudioCatalogueEpisode } from "../../core/resources/audio-catalogue";

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
/** Cover and the one colour it is, computed at author time by
 *  scripts/compute-cover-tints.py so no page has to look at an image to
 *  know what colour it should be. */
const SERIES_ART = seriesArt as Record<string, { cover: string; tint: string }>;

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

/** "3 hr 12 min" — the shape a listener reads a runtime in, not "192 min".
 *  Past a day of audio the minutes stop meaning anything, so they go. */
function extent(total: number): string {
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24 || rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
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

/**
 * What a series can say about itself out of what the feed actually gave us.
 *
 * The album hero has the publisher's own prose; `episodes.json` carries no
 * description, so a series hero would be a name and a number unless it counted
 * something. Its span and its runtime are both real, both derived, and both
 * the sort of fact a listener weighs before starting a 514-episode show. When
 * the feed descriptions are captured, they belong above this line, not
 * instead of it.
 */
function seriesLine(episodes: readonly AudioCatalogueEpisode[]): string {
  const count = `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}`;
  const years = episodes
    .map((ep) => (ep.publishedAt ? new Date(ep.publishedAt).getFullYear() : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  const span = years.length
    ? (Math.min(...years) === Math.max(...years)
      ? String(Math.min(...years))
      : `${Math.min(...years)}–${Math.max(...years)}`)
    : null;
  const runtime = episodes.reduce((n, ep) => n + (ep.durationSeconds ?? 0), 0);
  return [span, count, runtime > 0 ? extent(runtime) : null].filter(Boolean).join(" · ");
}

/** The whole track IS the psalm; there is no interior position to point at. */
function trackPassage(track: MusicTrack): PodcastPassage | null {
  if (track.psalm === undefined) return null;
  return { book: "PSA", chapter: track.psalm, verse: null, endVerse: null, basis: "record" };
}

function trackId(album: MusicAlbum, track: MusicTrack): string {
  return `${MUSIC.source.id}:${album.name}:${track.title}`;
}

function asEpisode(album: MusicAlbum, track: MusicTrack): PodcastEpisode {
  const id = trackId(album, track);
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

/** "14 March 2019" — the publisher's date, in the reader's own locale. */
function stamp(iso: string | null): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function PlayGlyph({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/** Four bars, moving while the audio is. Held still by prefers-reduced-motion
 *  in the sheet, where it stays a legible mark rather than becoming nothing. */
function BarsGlyph(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="listen-bars">
      <i /><i /><i /><i />
    </span>
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

/**
 * The publisher's own words, all of them.
 *
 * THE DEFECT THIS REPLACES: a three-line clamp with no affordance, which cut
 * mid-sentence and left the rest unreachable. A clamp is the right instrument
 * — cutting on a line beats cutting at 220 characters, which ends mid-word —
 * but a clamp without a way out is a screenshot of a paragraph.
 *
 * So: it still clamps, it fades on the last line rather than stopping dead,
 * and the control that opens it says which way it goes. Short prose that fits
 * inside the clamp gets no control at all, because a More button that reveals
 * nothing is worse than the truncation it advertises — which is why the
 * measurement is against the live element rather than a character count.
 */
function About({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = (): void => setClipped(node.scrollHeight - node.clientHeight > 2);
    measure();
    /* The clamp is measured in lines and the lines depend on the width, so a
       window drag can hide or reveal the overflow the button is about. */
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="listen-about">
      <p className="listen-about-text" data-open={open ? "" : undefined} ref={ref}>{text}</p>
      {(clipped || open) && (
        <button className="listen-about-more" onClick={() => setOpen(!open)} type="button">
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/**
 * ONE hero, both pages.
 *
 * They had drifted: the album got a field of its own colour, the publisher's
 * prose and the illustrator's name, and the series got a name and a count on
 * bare paper. Two pages that arrive by the same gesture and hold the same kind
 * of thing should not look like different products, so the shape is declared
 * once here and each page passes what it actually has. A series with no prose
 * renders without prose — it does not render a placeholder, and it does not
 * get a different layout for being poorer in metadata.
 */
function Hero({ art, tint, kicker, name, line, about, credits, onPlay, playing, innerRef }: {
  art?: string | null; tint?: string; kicker: string; name: string; line: string;
  about?: string; credits?: Record<string, string>;
  onPlay: () => void; playing: boolean;
  innerRef?: React.RefObject<HTMLElement | null>;
}): React.JSX.Element {
  return (
    <header className="listen-hero" ref={innerRef as React.RefObject<HTMLElement>}>
      <Cover alt={`${name} cover`} className="is-hero" src={art} tint={tint} />
      <div className="listen-hero-words">
        <p className="listen-hero-kicker">{kicker}</p>
        {/* Long names step down rather than wrapping to four lines of display
            type, which is the one thing a fluid scale cannot do on its own. */}
        <h1 className="listen-hero-name" data-long={name.length > 26 ? "" : undefined}>{name}</h1>
        <p className="listen-hero-line">{line}</p>
        {about && <About text={about} />}
        <div className="listen-hero-actions">
          <button className="listen-play-all" onClick={onPlay} type="button">
            {playing ? <BarsGlyph /> : <PlayGlyph size={16} />}
            {playing ? "Playing" : "Play"}
          </button>
        </div>
        {credits && (
          <p className="listen-credits">
            {Object.entries(credits).map(([role, who]) => `${role}: ${who}`).join(" · ")}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * The bar that takes over when the hero leaves.
 *
 * In a 352-track album the header scrolls away within a screen and nothing
 * replaces it, so a listener four hundred rows down has no idea what they are
 * looking at. Both reference apps solve it the same way and so does this: the
 * record's name and its play control, on a blurred plate, appearing exactly
 * when the real hero stops being visible.
 *
 * It reserves no height — the negative margin cancels its own box — so the
 * page's rhythm is identical whether the bar is showing or not, and content
 * passes underneath it rather than being pushed by it.
 */
function CompactBar({ shown, name, onPlay, onBack, playing }: {
  shown: boolean; name: string; onPlay: () => void; onBack: () => void; playing: boolean;
}): React.JSX.Element {
  return (
    <div className="listen-bar" data-shown={shown ? "" : undefined}>
      <button aria-label="Back" className="listen-bar-back" onClick={onBack} type="button">←</button>
      <span className="listen-bar-name">{name}</span>
      <button aria-label={`Play ${name}`} className="listen-bar-play" onClick={onPlay} type="button">
        {playing ? <BarsGlyph /> : <PlayGlyph size={13} />}
      </button>
    </div>
  );
}

/** Placeholder records, so the Series shelf has a shape before it has content.
 *  Without this the page paints Music alone and then jumps when the audio IPC
 *  lands, which is the most reliable way to look unfinished. */
function Skeleton(): React.JSX.Element {
  return (
    <ul className="listen-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <li className="listen-card is-ghost" key={index}>
          <span className="listen-cover" />
          <span className="listen-ghost-line" />
          <span className="listen-ghost-line is-short" />
        </li>
      ))}
    </ul>
  );
}

/**
 * True once the hero has scrolled out of the room's own scroll box.
 *
 * TWO THINGS THE TOUR FOUND HERE, both invisible in the source.
 *
 * `open` is not decoration. The hero only exists on a record page, so an
 * effect that ran once on mount found nothing to observe — the shelf is what
 * is on screen then — and never looked again. The bar stayed hidden in every
 * album anyone opened.
 *
 * And it watches the HERO, not a sentinel after it. The first build observed
 * an empty `<div>`, which has no area, and a zero-area target is a question
 * IntersectionObserver answers differently depending on where it sits. The
 * hero is the thing the bar is standing in for; observing anything else is a
 * proxy that can drift from what it proxies.
 */
function usePassed(scroller: React.RefObject<HTMLDivElement | null>, open: string): [
  boolean, React.RefObject<HTMLElement | null>,
] {
  const mark = useRef<HTMLElement>(null);
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    setPassed(false);
    const node = mark.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setPassed(!(entry?.isIntersecting ?? true)),
      { root: scroller.current, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [scroller, open]);
  return [passed, mark];
}

export function ListenPage(): React.JSX.Element {
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [resourceCatalogue, setResourceCatalogue] = useState<ResourceLibraryCatalogue | null>(null);
  const [audio, setAudio] = useState<Record<string, AudioCatalogueEpisode[]> | null>(null);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const now = usePodcastNowPlaying();
  const scroller = useRef<HTMLDivElement>(null);
  const [passed, mark] = usePassed(scroller, openAlbum ?? openSeries ?? "");

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
      if (!live || !result.ok) { if (live) setAudio({}); return; }
      setResourceCatalogue({ sources: result.sources, mutes: result.mutes });
      const ids = [...new Set([...result.sources.map((s) => s.id), ...Object.keys(SERIES_ART)])];
      const shelf = await window.api.audio.catalogue(ids);
      if (!live) return;
      setAudio(shelf.ok ? Object.fromEntries(shelf.series.map((s) => [s.sourceId, s.episodes])) : {});
    }).catch(() => {
      /* An empty shelf is the honest answer to a refusal, and it has to be set
         rather than left null or the room waits on a skeleton forever. */
      if (live) setAudio({});
    });
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

  /* Escape leaves whichever record is open. It used to leave only an album,
     because the handler was hung on `album` and the series page had been
     written afterwards — the kind of asymmetry nobody sees until they are in
     the other page pressing the key that worked a moment ago. */
  useEffect(() => {
    if (!openAlbum && !openSeries) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenAlbum(null);
      setOpenSeries(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAlbum, openSeries]);

  /* Opening a record puts the reader at its top. Without this the second
     album you open starts four hundred rows down, inside the scroll position
     the first one left behind. */
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [openAlbum, openSeries]);

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
  const series = Object.entries(audio ?? {})
    .filter(([id]) => !muted.has(id))
    .map(([id, episodes]) => ({ id, name: named.get(id) ?? titleFromId(id), episodes }))
    .sort((a, b) => b.episodes.length - a.episodes.length);
  const openedSeries = series.find((s) => s.id === openSeries) ?? null;

  /* Identity is the SOURCE and the RECORD, never `episode.id` — that is a key
     each surface builds for its own lists, and the margin builds a different
     one. Matching on it meant an episode started from the reading page reached
     this room unrecognised. See sameEpisode() in core. */
  const sounding = now.status === "playing" || now.status === "reaching";
  const playingHere = (sourceId: string, recordId: string): boolean =>
    sameEpisode(now.episode, sourceId, recordId);

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
    const here = now.episode?.sourceId === openedSeries.id && sounding;
    const start = (): void => {
      const first = openedSeries.episodes[0];
      if (first) playPodcastEpisode(seriesEpisode(openedSeries.id, openedSeries.name, first));
    };
    return (
      <div className="listen" ref={scroller} style={art ? { "--record-tint": art.tint } as React.CSSProperties : undefined}>
        <div className="listen-ambient" />
        <div className="listen-inner">
          <CompactBar name={openedSeries.name} onBack={() => setOpenSeries(null)} onPlay={start} playing={here} shown={passed} />
          <button className="listen-back" onClick={() => setOpenSeries(null)} type="button">← All series</button>
          <Hero
            art={art?.cover}
            kicker="Series"
            line={seriesLine(openedSeries.episodes)}
            name={openedSeries.name}
            onPlay={start}
            innerRef={mark}
            playing={here}
            tint={art?.tint}
          />
          {[...byYear.entries()].map(([when, eps]) => (
            <section className="listen-group" key={when}>
              <div className="listen-group-head">
                <h2 className="listen-group-name">{when}</h2>
                <span className="listen-group-count">{eps.length}</span>
              </div>
              <ol className="listen-tracks">
                {eps.map((ep, index) => {
                  const on = playingHere(openedSeries.id, ep.recordId);
                  return (
                    <li className="listen-track" key={ep.recordId}>
                      <button
                        aria-current={on ? "true" : undefined}
                        aria-label={`Play ${ep.title} — ${openedSeries.name}`}
                        className="listen-track-face"
                        data-on={on ? "" : undefined}
                        onClick={() => playPodcastEpisode(seriesEpisode(openedSeries.id, openedSeries.name, ep))}
                        type="button"
                      >
                        <span className="listen-track-mark">
                          {on && sounding
                            ? <BarsGlyph />
                            : <>
                              <span aria-hidden="true" className="listen-track-no">{index + 1}</span>
                              <span aria-hidden="true" className="listen-track-play"><PlayGlyph /></span>
                            </>}
                        </span>
                        <span className="listen-track-words">
                          <span className="listen-track-title">{ep.title}</span>
                          {stamp(ep.publishedAt) && <span className="listen-track-when">{stamp(ep.publishedAt)}</span>}
                        </span>
                        <span className="listen-track-extent">{clock(ep.durationSeconds)}</span>
                      </button>
                    </li>
                  );
                })}
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
    const here = album.tracks.some((t) => playingHere(MUSIC.source.id, trackId(album, t))) && sounding;
    const start = (): void => { const first = album.tracks[0]; if (first) playPodcastEpisode(asEpisode(album, first)); };
    return (
      <div className="listen" ref={scroller} style={album.tint ? { "--record-tint": album.tint } as React.CSSProperties : undefined}>
        <div className="listen-ambient" />
        <div className="listen-inner">
          <CompactBar name={album.name} onBack={() => setOpenAlbum(null)} onPlay={start} playing={here} shown={passed} />
          <button className="listen-back" onClick={() => setOpenAlbum(null)} type="button">← All music</button>
          <Hero
            about={album.about}
            art={album.cover}
            credits={album.credits}
            kicker={`Album · ${MUSIC.source.name}`}
            line={albumLine(album)}
            name={album.name}
            onPlay={start}
            innerRef={mark}
            playing={here}
            tint={album.tint}
          />

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
                {group.tracks.map((track, index) => {
                  const on = playingHere(MUSIC.source.id, trackId(album, track));
                  return (
                    <li className="listen-track" key={`${track.title}:${index}`}>
                      <button
                        aria-current={on ? "true" : undefined}
                        aria-label={`Play ${track.title} — ${album.name}, ${MUSIC.source.name}`}
                        className="listen-track-face"
                        data-on={on ? "" : undefined}
                        onClick={() => playPodcastEpisode(asEpisode(album, track))}
                        type="button"
                      >
                        <span className="listen-track-mark">
                          {on && sounding
                            ? <BarsGlyph />
                            : <>
                              <span aria-hidden="true" className="listen-track-no">{index + 1}</span>
                              <span aria-hidden="true" className="listen-track-play"><PlayGlyph /></span>
                            </>}
                        </span>
                        <span className="listen-track-words">
                          <span className="listen-track-title">{track.title}</span>
                        </span>
                        <span className="listen-track-extent">{track.duration}</span>
                      </button>
                    </li>
                  );
                })}
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
    <div className="listen" ref={scroller}>
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
            {albums.map((entry) => {
              const on = entry.tracks.some((t) => playingHere(MUSIC.source.id, trackId(entry, t))) && sounding;
              return (
                <li className="listen-card" key={entry.name}>
                  <button
                    aria-label={`${entry.name} — ${albumLine(entry)}`}
                    className="listen-card-face"
                    data-on={on ? "" : undefined}
                    onClick={() => setOpenAlbum(entry.name)}
                    style={entry.tint ? { "--record-tint": entry.tint } as React.CSSProperties : undefined}
                    type="button"
                  >
                    <span className="listen-card-art">
                      <Cover alt={`${entry.name} cover`} src={entry.cover} tint={entry.tint} />
                      <span aria-hidden="true" className="listen-card-play">
                        {on ? <BarsGlyph /> : <PlayGlyph size={18} />}
                      </span>
                    </span>
                    <span className="listen-card-name">{entry.name}</span>
                    <span className="listen-card-foot">{albumLine(entry)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Series" className="listen-shelf">
          <div className="listen-shelf-head">
            <h2 className="listen-shelf-name">Series</h2>
            <p className="listen-shelf-by">Spoken, from your library</p>
          </div>
          {audio === null ? <Skeleton /> : (
            <ul className="listen-grid">
              {series.map((source) => {
                const art = SERIES_ART[source.id];
                const on = now.episode?.sourceId === source.id && sounding;
                return (
                  <li className="listen-card" data-source={source.id} key={source.id}>
                    <button
                      aria-label={`${source.name} — ${source.episodes.length} episodes`}
                      className="listen-card-face"
                      data-on={on ? "" : undefined}
                      onClick={() => setOpenSeries(source.id)}
                      style={art ? { "--record-tint": art.tint } as React.CSSProperties : undefined}
                      type="button"
                    >
                      <span className="listen-card-art">
                        {art
                          ? <Cover alt={`${source.name} cover`} src={art.cover} tint={art.tint} />
                          : (
                            <span className="listen-cover is-plate">
                              <span className="listen-card-plate" data-source={source.id}>
                                <span className="taught-here-mark">{source.name}</span>
                              </span>
                            </span>
                          )}
                        <span aria-hidden="true" className="listen-card-play">
                          {on ? <BarsGlyph /> : <PlayGlyph size={18} />}
                        </span>
                      </span>
                      <span className="listen-card-name">{source.name}</span>
                      <span className="listen-card-foot">
                        {source.episodes.length} {source.episodes.length === 1 ? "episode" : "episodes"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="listen-colophon">
          Artwork and audio are shown and streamed from each publisher’s own servers.
          Nothing is stored here.
        </p>
      </div>
    </div>
  );
}
