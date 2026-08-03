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
 * ── THE ROOM REMEMBERS · 2026-08-02 ────────────────────────────────────────
 *
 * Play starts a QUEUE now, not a track — the record plays through, in the order
 * on screen, through the queue machine in PodcastPlayer (which is deliberately
 * not the walk; the note beside it says why). The line that used to stand here
 * calling that "task #2" outlived its own defect by several commits, which is
 * its own small lesson about comments that describe intentions.
 *
 * What arrived with it: every episode's position is remembered rather than only
 * the last one, so a row can say how far in you are and the room can open on
 * what you had not finished.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  isListenHidden,
  keepShelfScroll,
  openListenRecord,
  readListenHidden,
  readListenRoom,
  readSeriesOrder,
  setListenHidden,
  setListenQuery,
  setSeriesOrder,
  subscribeListenRoom,
} from "../listen-view.js";

import {
  playPodcastEpisode,
  placeKey,
  startPodcastQueue,
  usePodcastLedger,
  usePodcastNowPlaying,
  type PodcastEpisode,
  type PodcastPlace,
} from "./PodcastPlayer";
import type { ResourceLibraryCatalogue } from "./ResourceLibraryMatrix";
import { sameEpisode, type AudioCatalogueEpisode } from "../../core/resources/audio-catalogue";
import type { BackboneData, BookNameData } from "../api.js";
import { parsePassage } from "../utils/parsePassage.js";
import { safeCall } from "../utils/safeCall.js";
/* The shapes and the shaping both live beside this now rather than in it, so
   the boot-time rebuild of a resumed record produces byte-identical ids. Two
   shapers drifting by one character would mean a resumed album playing while
   every row in this room showed nothing playing. */
import {
  MUSIC,
  SERIES_ART,
  asEpisode,
  resolveEntry,
  /* Written here, moved out with the shapers, imported back for the one thing
     the room still wants it for: summing an album into a hero line. The note
     beside it in listen-episodes says why a copy would have been worse than
     the round trip. */
  seconds,
  seriesEpisode,
  trackId,
  trackPassage,
  type MusicAlbum,
  type MusicTrack,
} from "./listen-episodes";
import {
  AddToPlaylist,
  usePlaylistAsk,
  usePlaylistAskButton,
  type PlaylistAsk,
} from "./AddToPlaylist";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  insertPlaylistEntry,
  movePlaylistEntry,
  playlistIndex,
  readPlaylists,
  removeFromPlaylist,
  renamePlaylist,
  restorePlaylist,
  subscribePlaylists,
  type PlaylistEntry,
} from "../playlists.js";
import { openListenPlaylist } from "../listen-view.js";
import { useToast } from "./Toast.js";

/** For separating two records released in the same year. Matched, not parsed —
 *  `released` is the publisher's own prose and takes every shape prose takes. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The publisher's own naming, and the ONLY place the division is read. It was
 *  written out twice — once to split the record and once to count it — which is
 *  how a count came to disagree with the rows it was counting. */
const INSTRUMENTAL = /instrumental/i;

/** What the shows the manifest registry does not carry call themselves. */
const NAMES: Record<string, string> = {
  "bema": "The BEMA Podcast",
  "thirty-minutes-nt": "30 Minutes in the New Testament",
};

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
 * the sort of fact a listener weighs before starting a 676-episode show. When
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

/** Two paths crossing, which is the one shape everybody reads as shuffle. */
function ShuffleGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.6 3.6h2.6c.9 0 1.7.5 2.2 1.2l3.2 6.4c.4.7 1.2 1.2 2.2 1.2h2.6" />
      <path d="M1.6 12.4h2.6c.9 0 1.7-.5 2.2-1.2l.9-1.8" />
      <path d="M9.6 5.4l.9-1.8c.4-.7 1.2-1.2 2.2-1.2h1.7" />
      <path d="M12.6 1.4l1.8 2.2-1.8 2.2M12.6 10.2l1.8 2.2-1.8 2.2" />
    </svg>
  );
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
 * The room's colour, painted where the RAIL can also see it.
 *
 * Every screen in here is coloured by what it is about, and until now that
 * colour was laid inside this pane — which begins to the right of the rail. The
 * rail is transparent and blurs whatever is behind it, so a field that stopped
 * at the pane's left edge turned an invisible strip into a dark band with a
 * hard seam down the window. The maintainer saw it on the shelf, and the field
 * was removed rather than moved, which cost the shelf a colour they wanted and
 * left every record page still doing it.
 *
 * So the field is portalled out of this pane and into `.app-shell`, the one box
 * the rail and the room are both inside. The rail then blurs a stained ground
 * and the window is one field. See `.app-ambient` in styles.css for the paint.
 *
 * A PORTAL RATHER THAN A PROPERTY WRITTEN ONTO THE SHELL, and the difference is
 * the whole safety argument. Setting `--record-tint` on the shell would have
 * been fewer lines and would have reached two surfaces that read that name and
 * are not in this room — a resource card's cover face, and the dock — so a
 * record's colour would have followed the reader out of Listen and stained a
 * page that never asked. The tint rides on the portalled element instead, under
 * a name nothing else reads, and the element is unmounted with the room: there
 * is no property to clear and nothing that can outlive the leaving.
 *
 * The target is looked up in an effect rather than during render, so this
 * renders nothing on its first pass and the portal on its second. Reading the
 * DOM in a render body is the version of this that works until something
 * renders it twice.
 */
function ShellAmbient({ tint }: { tint?: string }): React.ReactPortal | null {
  const [shell, setShell] = useState<HTMLElement | null>(null);
  useEffect(() => { setShell(document.querySelector<HTMLElement>(".app-shell")); }, []);
  if (!shell) return null;
  return createPortal(
    <div
      className="app-ambient"
      style={tint ? { "--shell-tint": tint } as React.CSSProperties : undefined}
    />,
    shell,
  );
}

/**
 * How far into a row the reader already is.
 *
 * A listening room that cannot say what has been heard makes the reader keep
 * that list themselves, which is the one thing a library is for. Two states,
 * because there are only two worth a mark: BEEN HERE, drawn as the fraction
 * played, and DONE, drawn as a tick — a bar sitting at 99% is a puzzle where a
 * tick is an answer.
 *
 * Nothing is drawn for a row never started. Six hundred untouched rows each
 * wearing an empty tray is noise pretending to be information, and it would
 * bury the handful of rows that do carry a mark.
 *
 * The duration is the LEDGER'S, not the catalogue's: it is what the file
 * actually reported while playing, so the fraction is against the audio the
 * reader heard rather than against a feed's rounded claim about it.
 */
function Progress({ place }: { place?: PodcastPlace }): React.JSX.Element {
  /* THE SLOT IS ALWAYS DRAWN, even when it is empty, and that is deliberate.
     Returning nothing for an unheard row would let the duration column slide
     left on every row without a mark — a list whose right edge moves row to
     row reads as broken long before anybody works out why. An empty cell of a
     known width costs one span and keeps the column true. */
  const whole = place?.durationSeconds;
  const part = place && whole && whole > 0
    ? Math.min(1, Math.max(0.02, place.positionSeconds / whole))
    : null;
  return (
    <span className="listen-track-place">
      {place && place.positionSeconds > 0 && place.finished ? (
        <>
          <svg aria-hidden="true" className="listen-track-done" viewBox="0 0 16 16" width="13" height="13">
            <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.75"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="listen-sr">Played</span>
        </>
      ) : place && place.positionSeconds > 0 && part !== null && whole ? (
        <>
          <span aria-hidden="true" className="listen-track-progress">
            <span className="listen-track-progress-run" style={{ transform: `scaleX(${part})` }} />
          </span>
          <span className="listen-sr">
            {Math.max(0, Math.round((whole - place.positionSeconds) / 60))} minutes left
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * FIND ONE THING IN SIX HUNDRED, and choose which end to start from.
 *
 * A 676-episode show had exactly one way in: scroll. No filter, no way to run
 * the years forwards, and the publisher's own numbering — "Session 41", the
 * passage in the title — reachable only by eye. That is not a long list, it is
 * an archive with the doors welded shut.
 *
 * WHY A FILTER AND NOT A SEARCH. It matches titles and says so by having no
 * magnifier and no placeholder promising more. A search implies transcripts,
 * descriptions, relevance; this narrows the rows on the page and reports how
 * many are left. The narrow promise is the honest one, and titles are where a
 * series keeps its real index anyway.
 *
 * The order button is a TOGGLE and not a menu, because there are two answers
 * and a menu for two answers is a menu you open to find out it had two answers.
 * Its label is the direction it is currently in rather than the one it would
 * change to — a control that names its own effect reads as a state, and every
 * reader has been burned by guessing which convention a sort button follows.
 */
function Sift({ children, count, forwards, noun, onOrder, query, total }: {
  count: number; noun: string; query: string; total: number;
  /* Absent on an album, and that is a statement rather than an omission: a
     record's running order is the one its publisher sequenced, and offering to
     reverse it would be offering to un-make the record. A series' order is a
     calendar, which belongs to nobody. */
  forwards?: boolean; onOrder?: () => void;
  /* A record's own division of itself, where it has one — EveryPsalm's two
     halves. It sits here rather than in a row of its own because it is the
     same act as the filter: deciding which of these rows to look at. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  /* "/" is the shortcut every list in every app has trained a reader to try,
     and it costs nothing to honour — except while they are already typing
     somewhere, which is the one case it must not steal. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const at = document.activeElement;
      if (at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement) return;
      if (at instanceof HTMLElement && at.isContentEditable) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="listen-sift">
      <div className="listen-sift-field">
        <input
          aria-label={`Filter ${noun}s by title`}
          className="listen-sift-input"
          onChange={(event) => setListenQuery(event.target.value)}
          onKeyDown={(event) => {
            /* Escape empties the filter before it leaves the record — a reader
               whose list is narrowed to nothing wants the list back, not the
               shelf, and the room's Escape would have given them the shelf. */
            if (event.key !== "Escape" || query.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            setListenQuery("");
          }}
          placeholder="Filter by title"
          ref={field}
          type="search"
          value={query}
        />
        {query.length > 0 && (
          <button
            aria-label="Clear the filter"
            className="listen-sift-clear"
            onClick={() => setListenQuery("")}
            type="button"
          >×</button>
        )}
      </div>
      {/* The count is only worth saying when it is not the whole list; on an
          unfiltered page it would be the number already in the hero. */}
      {query.trim().length > 0 && (
        <span className="listen-sift-count">
          {count === 0 ? `No ${noun}s` : `${count} of ${total}`}
        </span>
      )}
      {children}
      {onOrder && (
        <button
          aria-label={`Sorted ${forwards ? "oldest first" : "newest first"}. Press to reverse.`}
          className="listen-sift-order"
          onClick={onOrder}
          type="button"
        >
          {forwards ? "Oldest first" : "Newest first"}
        </button>
      )}
    </div>
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
  /* A disclosure has to say three things and this said one: "More". Not what
     the more IS, and not whether it is already showing — so a reader who could
     not see the paragraph change had a button that appeared to do nothing,
     twice. Generated rather than written, because the hero is drawn on more
     than one page and a hard-coded id would be a duplicate. */
  const prose = React.useId();

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
      <p className="listen-about-text" data-open={open ? "" : undefined} id={prose} ref={ref}>{text}</p>
      {(clipped || open) && (
        <button
          aria-controls={prose}
          aria-expanded={open}
          className="listen-about-more"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/**
 * A LIST FROM A PASSAGE — the one thing this app can build that Spotify cannot.
 *
 * A general playlist is the reader's own arrangement and needs no help. This is
 * the scripture-native one: name a chapter and get everything in the library
 * that sings or teaches it, on a list you can then edit like any other.
 *
 * BOTH HALVES ALREADY EXIST and neither is a search. The sung half is the
 * `psalm` tag the music catalogue carries. The spoken half is the passage index
 * the reading margin already asks — chapter-granular, ranked by how long each
 * episode actually spends there, and mute-filtered in the main process. So this
 * is a join, not a new pipeline, and it costs one IPC the app makes constantly.
 *
 * ONE AFFORDANCE, and it stays one. A whole browsing surface for this would be
 * a second Listen room; a single control on the shelf head is a door.
 *
 * THE SEED IS PROVENANCE, NOT A QUERY. Once made, the list is an ordinary list:
 * the reader adds and removes freely, and it does not re-run behind them.
 */
function PassageSeed({ backbone, bookNames, onMade }: {
  backbone: BackboneData | null;
  bookNames: BookNameData | null;
  onMade: (id: string) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  /* Without the two reference tables there is nothing to parse a reference
     with, and a control that cannot work should not be drawn. */
  if (!bookNames || !backbone) return null;

  const build = async (): Promise<void> => {
    const parsed = parsePassage(text, bookNames, backbone);
    if (!parsed.ok) { setError(parsed.error); return; }
    setBusy(true);
    try {
      const { book, chapter } = parsed.value;
      /* A verse only narrows the SPOKEN half, where the index ranks by how near
         a moment lands. The sung half ignores it: a psalm's setting is of the
         whole psalm, and "Psalm 23:4" should still find the song. */
      const verse = parsed.value.verse ?? null;
      const entries: PlaylistEntry[] = [];

      /* Sung first: a psalm's own setting is the most direct answer there is to
         "what does the library have on Psalm 23". */
      /* THE SUNG HALF CARRIES ITS OWN CEILING, and it must, because the seed
         used to starve its own premise. Only the spoken loop below checked
         `SEEDED_MAX`, and it ran second — so the music scan filled whatever
         share of the twenty-five it liked and the teaching half took what was
         left, which on a long psalm was nothing at all. Psalm 119 has exactly
         twenty-five settings in EveryPsalm, so seeding "Psalm 119" produced
         twenty-five songs and zero sermons, silently: no error, no truncation
         notice, a full and plausible-looking list. The one feature whose whole
         claim is "a psalm, a sermon and a hymn on the same list" delivered a
         third of that on the psalm a reader is most likely to try, because it
         is the famous long one.

         Ten is not a guess about taste: ten settings of one chapter is already
         more of one thing than a twenty-five row list should spend, and it
         leaves fifteen the spoken half can always reach. Below ten nothing is
         capped and nothing changes for Psalm 23, the ordinary case.

         Considered and rejected: interleaving the halves round-robin. It reads
         well in the abstract and destroys the one ordering that is earned — the
         spoken half arrives ranked by how many seconds an episode spends in the
         chapter, and shuffling songs through it would present that as an order
         nobody computed. */
      for (const album of MUSIC.albums) {
        if (entries.length >= SEEDED_SUNG_MAX) break;
        for (const track of album.tracks) {
          if (entries.length >= SEEDED_SUNG_MAX) break;
          const passage = trackPassage(track);
          if (!passage || passage.book !== book || passage.chapter !== chapter) continue;
          entries.push({
            kind: "music", sourceId: MUSIC.source.id, album: album.name, title: track.title,
          });
        }
      }

      /* Then spoken, in the index's own ranking — which is seconds of treatment
         and nothing else. An episode can hold several moments in one chapter,
         so they are folded to one row each. */
      const answer = await safeCall(() => window.api.passages.moments(book, chapter, verse));
      if (answer.ok) {
        const seen = new Set<string>();
        for (const moment of answer.value.moments) {
          if (seen.has(moment.id) || entries.length >= SEEDED_MAX) continue;
          seen.add(moment.id);
          entries.push({
            kind: "podcast",
            sourceId: moment.sourceId,
            recordId: moment.id,
            title: moment.episode,
          });
        }
      }

      if (entries.length === 0) {
        setError("Nothing in your library on that passage yet");
        return;
      }
      /* `bookNames` maps a code to the names that book answers to, fullest
         first — so the first entry is the one to print. */
      const label = `${bookNames[book]?.[0] ?? book} ${chapter}`;
      const id = createPlaylist(label, { book, chapter, verse });
      for (const entry of entries) addToPlaylist(id, entry);
      setOpen(false);
      setText("");
      setError(null);
      onMade(id);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="listen-seed-open" onClick={() => setOpen(true)} type="button">
        New from a passage…
      </button>
    );
  }
  return (
    <div className="listen-seed">
      <input
        aria-label="A passage to build a playlist from"
        className="listen-sift-input"
        onChange={(event) => { setText(event.target.value); setError(null); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void build(); }
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); setError(null); }
        }}
        placeholder="Psalm 23, Romans 8…"
        ref={field}
        value={text}
      />
      <button
        className="listen-sift-order"
        disabled={busy || text.trim().length === 0}
        onClick={() => void build()}
        type="button"
      >{busy ? "Building…" : "Build"}</button>
      {/* A WAY OUT THAT CAN BE SEEN. Once this field opened, nothing on screen
          closed it: Escape did, but only while the field still held focus, so a
          reader who typed a reference, clicked elsewhere and changed their mind
          was left with an open field and no way back to the button it replaced.
          It behaves exactly as Escape does — closes, drops the error, keeps what
          was typed — because two dismissals of one field that differ is a defect
          waiting to be found. */}
      <button
        aria-label="Cancel"
        className="listen-field-cancel"
        onClick={() => { setOpen(false); setError(null); }}
        title="Cancel"
        type="button"
      >×</button>
      {/* ANNOUNCED, NOT MERELY DRAWN. "Nothing in your library on that passage
          yet" is the whole answer to a press, and it reached a sighted reader
          only — a screen reader was told the Build button had been pressed and
          then nothing, which reads as a control that does not work. `alert`
          rather than `status` because it is assertive by nature: it reports that
          the thing asked for did not happen. */}
      {error && <span className="listen-seed-error" role="alert">{error}</span>}
    </div>
  );
}

/** Enough to be a list, few enough to be a list somebody reads. */
const SEEDED_MAX = 25;

/**
 * A PLAIN LIST, MADE ON PURPOSE — the door that was not there.
 *
 * Every path to a new playlist ran through something else. Right-clicking a row
 * offered "New playlist…", but only as a step inside adding THAT row to it, and
 * only to a reader who thought to try the gesture. The seed control beside this
 * builds a list from a chapter, names it itself and caps it — a fine thing, and
 * not what a reader means by "make me a playlist". So the shelf's only visible
 * control was the specialist one, and the ordinary act — name an empty list,
 * then fill it — had no affordance at all. A shelf headed "Playlists · Yours"
 * with no way to start one is a promise the room does not keep.
 *
 * IT STAYS ON THE SHELF AFTER MAKING ONE. The seed opens what it built, and
 * should: a seeded list arrives with contents and the reader's next question is
 * what it found. An empty list has nothing to show — opening it would answer a
 * naming with a blank page and carry the reader away from the shelves that are
 * the only place they can fill it from. The card appearing below is the
 * confirmation, in the place they will look; the toast carries an Open for the
 * reader who did mean to go there.
 */
function NewPlaylist({ onMade }: {
  onMade: (id: string, name: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  const make = (): void => {
    /* `createPlaylist` falls back to "Untitled" on a blank name, which is right
       for a store and wrong to reach from here: a reader who presses Create on
       an empty field meant to type something. The button is disabled and Enter
       does nothing, so the field stays open holding the cursor rather than
       quietly inventing a name. */
    const clean = name.trim();
    if (!clean) return;
    const id = createPlaylist(clean);
    setOpen(false);
    setName("");
    onMade(id, clean);
  };

  if (!open) {
    return (
      <button className="listen-new-open" onClick={() => setOpen(true)} type="button">
        New playlist…
      </button>
    );
  }
  return (
    /* NOT `.listen-seed`. The tour reaches the passage field through
       `.listen-seed .listen-sift-input`; a second input under that class would
       hand it whichever the document held first. The input keeps the filter's
       class because it is the same object at the same size — only the container
       has to be able to tell the two apart. */
    <div className="listen-new">
      <input
        aria-label="Name for the new playlist"
        className="listen-sift-input"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); make(); }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setName("");
          }
        }}
        placeholder="Advent, Lament, Sunday…"
        ref={field}
        value={name}
      />
      <button
        className="listen-sift-order"
        disabled={name.trim().length === 0}
        onClick={make}
        type="button"
      >Create</button>
      <button
        aria-label="Cancel"
        className="listen-field-cancel"
        onClick={() => { setOpen(false); setName(""); }}
        title="Cancel"
        type="button"
      >×</button>
    </div>
  );
}

/** How much of that a single chapter's settings may take, so the spoken half is
 *  never crowded out — see the sung loop for the psalm that proved it. */
const SEEDED_SUNG_MAX = 10;

/**
 * Take a record off this shelf, or put it back.
 *
 * NOT A MUTE, and the difference is the whole design. `resourceMutes` silences
 * a publisher everywhere — the margin stops offering them, their cards leave
 * the reading page — which is a judgement about a publisher. A reader who does
 * not want fourteen albums on their listening shelf is not making that
 * judgement; they are tidying a shelf.
 *
 * So it hides a card from ONE room, the count of what is hidden is always on
 * screen, and every hidden record is one press from returning. Nothing here can
 * lose anything, which is what earns it a one-press affordance instead of a
 * confirmation.
 */
function Shelve({ away, of, onToggle }: {
  away: boolean; of: string; onToggle: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      aria-label={away ? `Put ${of} back on the shelf` : `Hide ${of} from this shelf`}
      className="listen-shelve"
      onClick={() => onToggle(!away)}
      title={away ? "Put back" : "Hide from this shelf"}
      type="button"
    >
      {away ? "＋" : "−"}
    </button>
  );
}

/**
 * One of a record's groups, and its rows.
 *
 * Extracted when EveryPsalm gained its two chapters: the same run of rows is
 * now drawn from two branches, and a group that renders differently depending
 * on which heading it happens to sit under is a bug waiting for somebody to
 * edit one copy.
 */
function AlbumGroup({
  album, askButton, askProps, group, onPlay, ordered, playingHere, sounding,
}: {
  album: MusicAlbum;
  /* Two bindings onto one menu: the row's right-click, and the hand's "+".
     Threaded in rather than made here because both come from the room's single
     `setAsk`, and a group that opened its own menu would be a second popover the
     room could not close. */
  askButton: (entry: PlaylistEntry, label: string) => {
    "aria-haspopup": "dialog";
    "aria-label": string;
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
    title: string;
  };
  askProps: (entry: PlaylistEntry, label: string) => {
    onContextMenu: (event: React.MouseEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
  group: { name: string; cover?: string; tracks: MusicTrack[] };
  onPlay: (from: number) => void;
  ordered: MusicTrack[];
  playingHere: (sourceId: string, recordId: string) => boolean;
  sounding: boolean;
}): React.JSX.Element {
  return (
    <section className="listen-group">
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
          /* Named once and handed to both gestures. Written out twice — once for
             the right-click, once for the "+" — it would be two literals that
             must stay identical or the menu offers to add a different song than
             the row it grew out of. */
          const entry: PlaylistEntry = {
            kind: "music",
            sourceId: MUSIC.source.id,
            album: album.name,
            title: track.title,
          };
          return (
            <li className="listen-track" key={`${track.title}:${index}`}>
              {/* THE ROW IS A BUTTON AND ITS HAND IS A SIBLING. A control nested
                  inside the row would be invalid HTML the engine unnests, which
                  is why the room went a whole wave with right-click as the only
                  way to put a song on a list — a gesture nothing on screen
                  mentions, so for a reader who did not already know it, no way
                  at all. This is the shape the playlist page has used since it
                  shipped, brought over unchanged. */}
              <div className="listen-track-row">
                {/* Named by its contents — the long note on the series rows
                    says why an explicit label here was silencing the rest of the
                    row. A song announces as "Psalm 23, 3:42, button": the album
                    and the publisher were in the label and are already in the
                    hero this list sits under. */}
                <button
                  aria-current={on ? "true" : undefined}
                  className="listen-track-face"
                  data-on={on ? "" : undefined}
                  onClick={() => onPlay(ordered.indexOf(track))}
                  type="button"
                  {...askProps(entry, track.title)}
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
                  {/* NO PLACE MARK ON A SONG, deliberately. The bar and the tick
                      answer "where was I in this?", which is a question about a
                      forty-minute exposition and not about a three-minute psalm
                      — nobody resumes a hymn halfway, and a tick would end up on
                      all 222 rows of EveryPsalm, which is noise wearing the
                      costume of information. The row keeps its slot so the
                      runtimes stay in one line with every other list. */}
                  <span className="listen-track-place" />
                  <span className="listen-track-extent">{track.duration}</span>
                </button>
                {/* ONE CONTROL, ALWAYS DRAWN — hidden by opacity, never by
                    `display`, because every row must reserve the same width or
                    the runtime column stops ending in one line down the page. */}
                <span className="listen-track-hand">
                  <button
                    className="listen-track-add"
                    type="button"
                    {...askButton(entry, track.title)}
                  >＋</button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
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
function Hero({
  art, tint, kicker, name, line, about, credits, onPlay, onShuffle, playing, innerRef,
  plate, initial, source, rename,
}: {
  art?: string | null; tint?: string; kicker: string; name: string; line: string;
  about?: string; credits?: Record<string, string>;
  onPlay: () => void; playing: boolean;
  /* Songs only. See the album page for why a series is not offered this. */
  onShuffle?: () => void;
  /* Where the publisher keeps this record themselves. */
  source?: { href: string; label: string };
  /* A publisher whose cover art we do not carry. See below. */
  plate?: string;
  /* A record with no publisher at all — the reader's own. See below. */
  initial?: string;
  /**
   * THE NAME BECOMES A FIELD IN PLACE — for the one record whose name is the
   * reader's to change.
   *
   * The swap belongs HERE and not in the playlist branch, and the reason is the
   * h1: it carries a fluid clamp and a `data-long` step-down nothing else
   * reproduces. A field rendered outside this component would restate both, and
   * the first edit to either would leave a page that jumps a whole type step the
   * moment a reader presses Rename.
   *
   * FULLY CONTROLLED, deliberately: the control that STARTS the edit is not in
   * the hero — it is the pill below, which has to become Save and know whether
   * Save can be pressed. A draft held in here would have to be reported back
   * out, which is the same state in two places with a callback pretending
   * otherwise.
   */
  rename?: {
    draft: string;
    onDraft: (next: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  };
  innerRef?: React.RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const nameField = useRef<HTMLInputElement>(null);
  const editing = rename != null;
  /* Focused on open and its text selected: a rename almost always replaces the
     name rather than appending to it, and a reader who must select four words by
     hand first has been given a text box instead of a rename. Focusing also
     brings the hero back on screen if the edit started from a page scrolled past
     it — the engine scrolls a focused element into view, and the compact bar's
     observer then retires the bar on its own. */
  useEffect(() => {
    if (!editing) return;
    nameField.current?.focus();
    nameField.current?.select();
  }, [editing]);
  return (
    <header className="listen-hero" ref={innerRef as React.RefObject<HTMLElement>}>
      {/* THE PLATE IS A REAL FACE, not a hole where a cover would go. The shelf
          has always drawn a publisher's own mark on their own colour for a
          source we carry no artwork for — and the hero, which is the same
          object at four times the size, drew an empty square. Nobody saw it
          because every source in the room happened to have art; onboarding two
          that do not is what made the gap visible. */}
      {art
        ? <Cover alt={`${name} cover`} className="is-hero" src={art} tint={tint} />
        : plate
          ? (
            <span className="listen-cover is-hero is-plate">
              <span className="listen-card-plate" data-source={plate}>
                <span className="taught-here-mark">{name}</span>
              </span>
            </span>
          )
          : initial
            ? (
              /* A PLAYLIST HAS NO PUBLISHER, so it cannot have a plate — and
                 with no artwork either it drew a `Cover` with no src and no
                 tint, which is a shadowed empty box: the universal look of an
                 image that failed to load, on the screen a reader reaches right
                 after making a list.

                 Three answers were weighed. A generic note glyph is what every
                 listening app reaches for; it is legible and says nothing about
                 THIS list. A mosaic of the first few covers is the handsome
                 answer and is exactly unavailable here — this branch exists
                 because nothing on the list resolves to art. What is left is the
                 one thing a playlist always has: the name the reader typed. Its
                 first letter, in the same reading face as the h1 beside it, so
                 it reads as the name enlarged rather than as a substitute for a
                 picture — a spine label. It changes when they rename the list,
                 which no placeholder ever does.

                 `aria-hidden`, because it is the name said twice and the reading
                 of it is the h1's job. */
              <span className="listen-cover is-hero is-initial">
                <span aria-hidden="true" className="listen-initial">{initial}</span>
              </span>
            )
            : <Cover alt={`${name} cover`} className="is-hero" src={art} tint={tint} />}
      <div className="listen-hero-words">
        <p className="listen-hero-kicker">{kicker}</p>
        {/* Long names step down rather than wrapping to four lines of display
            type, which is the one thing a fluid scale cannot do on its own. */}
        {/* The field is measured against the DRAFT rather than the stored name,
            so it steps down as a long name is typed instead of after saving. */}
        {rename
          ? (
            <input
              aria-label="Playlist name"
              className="listen-hero-name-field"
              data-long={rename.draft.length > 26 ? "" : undefined}
              onChange={(event) => rename.onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); rename.onCommit(); }
                /* ESCAPE IS STOPPED HERE, and that is why the key works at all.
                   The room hangs a `keydown` on `window` that leaves whatever
                   record is open — so on a playlist page the key that should
                   abandon an edit abandoned the PAGE, taking the half-typed name
                   with it. Stopping the synthetic event stops the native one at
                   the React root, below `window`. Only Escape is stopped:
                   swallowing every key would disarm the app's own shortcuts
                   inside one text field. */
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  rename.onCancel();
                }
              }}
              ref={nameField}
              value={rename.draft}
            />
          )
          : <h1 className="listen-hero-name" data-long={name.length > 26 ? "" : undefined}>{name}</h1>}
        <p className="listen-hero-line">{line}</p>
        {about && <About text={about} />}
        <div className="listen-hero-actions">
          <button className="listen-play-all" onClick={onPlay} type="button">
            {playing ? <BarsGlyph /> : <PlayGlyph size={16} />}
            {playing ? "Playing" : "Play"}
          </button>
          {onShuffle && (
            <button className="listen-shuffle" onClick={onShuffle} type="button">
              <ShuffleGlyph />
              Shuffle
            </button>
          )}
        </div>
        {credits && (
          <p className="listen-credits">
            {Object.entries(credits).map(([role, who]) => `${role}: ${who}`).join(" · ")}
          </p>
        )}
        {/* The publisher's own page for this record. It was in the catalogue
            from the first import and had never been drawn — so a room built on
            "the art and the audio are theirs" gave a reader no way to go to
            them. Opened outside the app, which is what an external link means
            and what the shell already enforces. */}
        {source && (
          <p className="listen-hero-source">
            <a className="listen-hero-link" href={source.href} rel="noreferrer" target="_blank">
              {source.label}
            </a>
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
 * Where the art and the audio come from, at the foot of every page in the room.
 *
 * It said the same thing in three places, varying only in whether it could name
 * one publisher or had to say "each". Three copies of a sentence about where
 * data goes is three chances for two of them to fall out of date after somebody
 * edits the third — and this particular sentence is a permission claim, so the
 * copies disagreeing would be worse than untidy.
 */
function Colophon({ who }: { who?: string }): React.JSX.Element {
  return (
    <p className="listen-colophon">
      Artwork and audio are shown and streamed from {who ? `${who}’s` : "each publisher’s"} own
      servers. Nothing is stored here.
    </p>
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

export function ListenPage({ backbone, bookNames }: {
  /* Only the passage seeding needs these, and only to parse what a reader
     types. App already holds both; passing them beats a second load. */
  backbone?: BackboneData | null;
  bookNames?: BookNameData | null;
} = {}): React.JSX.Element {
  const [resourceCatalogue, setResourceCatalogue] = useState<ResourceLibraryCatalogue | null>(null);
  const [audio, setAudio] = useState<Record<string, AudioCatalogueEpisode[]> | null>(null);
  /* WHERE THE READER WAS, held outside this component because the room unmounts
     whenever they look at scripture — see listen-view for the whole argument.
     With this in `useState`, glancing at the passage under discussion cost you
     four hundred rows, both catalogue IPCs, and a skeleton flash. */
  const room = useSyncExternalStore(subscribeListenRoom, readListenRoom);
  const { openAlbum, openSeries, openPlaylist, query } = room;
  const setOpenAlbum = (name: string | null): void => openListenRecord({ album: name });
  const setOpenSeries = (id: string | null): void => openListenRecord({ series: id });
  const lists = useSyncExternalStore(subscribePlaylists, readPlaylists);
  /* Shown while the reader is looking at what they hid, so the shelves fill
     back in and every card carries a way to bring it back. Session-only: it
     is a glance, not a mode, and it should not still be open tomorrow. */
  const [showHidden, setShowHidden] = useState(false);
  const [ask, setAsk] = useState<PlaylistAsk | null>(null);
  const askProps = usePlaylistAsk(setAsk);
  const askButton = usePlaylistAskButton(setAsk);
  /* WHERE THE READER IS PUT DOWN AGAIN once the menu closes. The menu portals to
     the document body and takes focus, so without this a keyboard reader who
     opened it from a row four hundred deep in BEMA and then changed their mind
     was returned to `body` and had to tab the whole page again. Keyed off the
     ask going null rather than off any one placement, because the room draws the
     menu once per branch and this must not care which. `isConnected` guarded:
     adding an entry can rerender the list the "+" lived in, and focusing a node
     the engine has already dropped throws. */
  const askOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (ask) { askOrigin.current = ask.origin ?? null; return; }
    const back = askOrigin.current;
    askOrigin.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, [ask]);
  /**
   * WHICH LIST IS BEING RENAMED, and what to.
   *
   * An ID rather than a boolean on purpose. A flag would be inherited: open one
   * list, press Rename, go back, open another, and the second list's hero would
   * arrive already in edit mode holding the first list's draft. An id makes the
   * test `renaming === list.id`, so only the list actually being edited can be
   * in that state — and it lets the edit survive a glance away and back, which
   * is the same memory the room already keeps for where you were. An unfinished
   * rename is an unfinished sentence; the room does not throw those away when a
   * reader looks at something else.
   */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /**
   * THE MENU, BUILT ONCE AND PLACED IN ALL FOUR ROOMS.
   *
   * THE DEFECT THIS REPLACES was invisible in review and total in use. This
   * component was mounted in exactly one place — the shelf's return — while the
   * rows that can ASK for it live on the album and series pages, whose branches
   * return long before the shelf's does. So right-clicking a track set the
   * state, re-rendered the page, and drew nothing at all. The one documented
   * way into a playlist was dead, and both empty states told the reader to use
   * it.
   *
   * The room has four mutually exclusive returns and the menu belongs to all of
   * them, so it is constructed once here and placed four times rather than
   * written out four times. Four copies of a JSX line is four chances for three
   * of them to keep a prop the fourth loses.
   *
   * Not by restructuring the returns into one, which was considered: the four
   * branches are ~600 lines of deeply indented JSX and collapsing them would
   * re-indent the lot, burying this fix inside a diff nobody could read.
   *
   * A contract counts these placements, because that is the shape of failure —
   * the code was never wrong, it was only absent from three of the four places
   * it had to be.
   */
  const menu = <AddToPlaylist ask={ask} onClose={() => setAsk(null)} />;
  const { showToast } = useToast();
  const now = usePodcastNowPlaying();
  /* Read straight from the player's own store rather than threaded down as a
     prop. A six-hundred-row series would otherwise pass one number through
     every list in the room, and the store already updates as you listen — a
     row's mark moves under the reader without a refetch. */
  const places = usePodcastLedger();
  const scroller = useRef<HTMLDivElement>(null);
  /* ALL THREE RECORDS, and a playlist is the third. The key is what re-runs the
     observer effect, and a playlist page kept the key it had on the shelf — the
     empty string — so the effect never re-ran, the hero was never observed, and
     the compact bar on a playlist was hidden for good. The two record pages had
     it right and the third was written afterwards, which is the same asymmetry
     Escape had before it. Any fourth thing this room opens belongs here. */
  const [passed, mark] = usePassed(scroller, openAlbum ?? openSeries ?? openPlaylist ?? "");

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
     "what is new" is the question a record shelf answers before any other.

     THE MONTH IS READ TOO, because the year alone could not separate two 2025
     records and fell through to track count: a 4-track Advent set released in
     December sorted BEHIND a 35-track record from September, which is the
     shelf's own claim getting the answer wrong by three months. The month is
     the publisher's prose ("December 8, 2025"), so it is matched rather than
     parsed, and anything unreadable simply scores 0 and ties as before. */
  const albums = useMemo(() => [...MUSIC.albums].sort((a, b) => {
    const when = (album: MusicAlbum): number => {
      const stated = year(album.released)?.slice(-4);
      if (!stated) return 0;
      const month = MONTHS.findIndex((name) => new RegExp(name, "i").test(album.released ?? ""));
      return Number(stated) * 12 + (month < 0 ? 0 : month + 1);
    };
    return when(b) - when(a) || b.tracks.length - a.tracks.length;
  }), []);
  const album = albums.find((a) => a.name === openAlbum) ?? null;

  /* Whatever is open — an album, a series, or one of the reader's own lists. */
  const opened = openAlbum ?? openSeries ?? openPlaylist;

  /* THE KEY A RECORD IS SHELVED UNDER. A series is its publisher; an album has
     no id of its own, so it is named — the same string the playlist entries
     key on, for the same reason. */
  const albumKey = (name: string): string => `music:${name}`;
  const hiddenCount = readListenHidden().size;
  const away = (key: string): boolean => !showHidden && isListenHidden(key);
  /* Filtered once and then both counted and drawn. It used to be filtered inline
     inside the grid, which meant the shelf could not know whether it was about
     to draw nothing — see the Music shelf for what that cost. */
  const shownAlbums = albums.filter((entry) => !away(albumKey(entry.name)));

  /* Escape leaves whichever record is open. It used to leave only an album,
     because the handler was hung on `album` and the series page had been
     written afterwards — the kind of asymmetry nobody sees until they are in
     the other page pressing the key that worked a moment ago.

     IT YIELDS TO WHATEVER IS OPEN ON TOP OF THE RECORD. This is a `window`
     listener and so is the popover's, and ours is registered first — so ours
     runs first, and the popover's `stopImmediatePropagation` arrives too late
     to matter. That was harmless only while the menu could never open: press
     Escape inside the add-to-playlist menu and the menu would close AND the
     reader would be thrown back to the shelf, having asked for neither.

     So the record's own Escape stands down while something smaller is open.
     `ask` is that today; a rename in progress will be the next, and it belongs
     in this same guard rather than in a second listener that has to be ordered
     against this one. */
  useEffect(() => {
    if (!opened) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || ask) return;
      event.preventDefault();
      openListenRecord({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened, ask]);

  /* OPENING GOES TO THE TOP; GOING BACK GOES BACK.
     This was one line that fired on both, so it solved half a problem and
     caused the other half: opening the second album no longer started four
     hundred rows down, and leaving any album dumped the reader at the top of a
     shelf they had scrolled through to get there. The shelf's position is kept
     as it is left and restored when it returns; a record still opens at its
     own top, which is the only place a record makes sense to open. */
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (opened) { box.scrollTo({ top: 0 }); return; }
    /* After paint, or the shelf is still the record's height and the scroll is
       clamped to a box that has not grown back yet. */
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: room.shelfScroll }));
  }, [opened]);

  /* Sampled as the reader scrolls rather than captured on the way out, because
     by the time a press is handled the room is already re-rendering into a
     record and the shelf's scrollTop is on its way to being meaningless. */
  const rememberScroll = (): void => {
    if (!opened) keepShelfScroll(scroller.current?.scrollTop ?? 0);
  };

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

  /* THE FILTER NARROWS THE ROWS AND LEAVES THE RECORD ALONE. Groups that lose
     every track disappear rather than standing as empty headings — thirteen
     group heads over one matching psalm is a page about its own structure.

     The queue is still built from the WHOLE record below, not from this: a
     reader who filters to "Psalm 40" and presses it wants the album to play on
     afterwards, not to stop because their filter ran out. */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        tracks: group.tracks.filter((t) => t.title.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.tracks.length > 0);
  }, [groups, query]);

  /**
   * TWO CHAPTERS OF ONE RECORD.
   *
   * EveryPsalm is 222 tracks: 171 sung psalms in the seven genres their
   * illustrator drew covers for, then 51 instrumentals filed under the
   * Psalter's five books. The publisher made that division and the room was
   * drawing it as thirteen equal groups in a row — so the instrumental half
   * arrived unannounced, halfway down, looking like six more genres.
   *
   * It stays ONE record, on the maintainer's call, because it is one project
   * and splitting the shelf card would fork the publisher's own work. What it
   * gains is a division the reader can see and act on: two chapter headings,
   * and a filter that can hold either half on its own.
   *
   * DETECTED, NOT DECLARED. There is no `instrumental` field to read, so the
   * signal is the publisher's own naming — the suffix on the title and the
   * word on the group. Any album without that naming has one chapter and draws
   * exactly as it did, which is every other record here.
   */
  const chapters = useMemo(() => {
    const sung = shown.filter((group) => !INSTRUMENTAL.test(group.name));
    const played = shown.filter((group) => INSTRUMENTAL.test(group.name));
    if (sung.length === 0 || played.length === 0) return null;
    return { sung, played };
  }, [shown]);
  /**
   * WHICH HALF, AND WHAT HAPPENS WHEN THERE IS NO HALF TO HOLD.
   *
   * The choice is the reader's and it was kept forever, which produced two
   * states nobody asked for. Filter a divided record down to rows that all live
   * in one half and `chapters` goes null — the control disappears while the
   * state still says "played", and the sung rows it was hiding come back with
   * nothing on screen to explain why. Open a different record and the choice
   * followed it there.
   *
   * Two different repairs, because they are two different facts. The filter case
   * is CLAMPED rather than reset: there is no such thing as a chosen half on an
   * undivided list, so `half` is derived and the reader's choice waits intact
   * for the filter to be cleared. An effect there would have written state on a
   * keystroke and thrown the choice away for good.
   *
   * The record case IS a reset, because opening another album is opening another
   * thing, and its halves are not this one's.
   */
  const [chosenHalf, setChosenHalf] = useState<"all" | "sung" | "played">("all");
  const half = chapters ? chosenHalf : "all";
  useEffect(() => { setChosenHalf("all"); }, [openAlbum]);

  /* Built from the AUDIO catalogue, so a publisher appears here when it has
     episodes rather than when it has cards — which is how BEMA and 30 Minutes
     in the New Testament reach this shelf at all: neither is in the manifest
     registry the margin reads. The name comes from the manifest where there is
     one and from the id where there is not. */
  /* A MUTE COMES IN TWO SHAPES and this room honoured one. `resourceMutes`
     holds either `publisher` or `publisher:kind`, and a reader who muted
     "radically-christian:podcast" in the library matrix — the only place the
     rules are written — still found the show sitting on this shelf. The
     publisher's own flag stays authoritative; the kind rules are read straight
     off the list beside it, because "no podcasts from these people" is exactly
     what a shelf of their podcasts should obey. */
  const muted = useMemo(() => new Set([
    ...resourceCatalogue?.sources.filter((s) => s.muted).map((s) => s.id) ?? [],
    ...(resourceCatalogue?.mutes ?? [])
      .filter((rule) => rule.endsWith(":podcast"))
      .map((rule) => rule.slice(0, -":podcast".length)),
  ]), [resourceCatalogue]);
  const named = useMemo(
    () => new Map(resourceCatalogue?.sources.map((s) => [s.id, s.name]) ?? []),
    [resourceCatalogue],
  );
  /* A publisher outside the manifest registry has no name to read, and an id
     title-cased is not a name — it drew "Bema" and "Thirty Minutes Nt". The
     feed registry already holds what these shows call themselves; the two the
     margin cannot name are named here until they join it. */
  const titleFromId = (id: string): string =>
    NAMES[id] ?? id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  /* NEWEST FIRST, the same question the Music shelf answers. It sorted by
     episode COUNT, which permanently pinned the two longest-running shows to
     the top-left and told a reader nothing except which publisher had been at
     it longest — a show that posted this morning sat below one that stopped in
     2019. Size is not news. */
  /* MEMOISED BECAUSE SOMETHING ELSE DEPENDS ON IT. This array is cheap to build
     and was rebuilt on every render — a new identity each time — so the `resume`
     memo below, which lists it as a dependency, recomputed on every render too.
     A memo whose dependency is rebuilt beside it is not a memo; it is a
     memo-shaped comment. The doorway walks the whole ledger against the whole
     catalogue, so this was the expensive half of a keystroke in the filter.
     `muted` and `named` are memoised above for the same reason: a Set rebuilt
     per render would have carried the defect straight through. */
  const series = useMemo(() => Object.entries(audio ?? {})
    .filter(([id]) => !muted.has(id))
    .map(([id, episodes]) => ({
      id,
      name: named.get(id) ?? titleFromId(id),
      episodes,
      latest: episodes.reduce((newest, ep) => (
        (ep.publishedAt ?? "") > newest ? ep.publishedAt ?? "" : newest), ""),
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest) || b.episodes.length - a.episodes.length),
  [audio, muted, named]);
  const openedSeries = series.find((s) => s.id === openSeries) ?? null;

  /* Identity is the SOURCE and the RECORD, never `episode.id` — that is a key
     each surface builds for its own lists, and the margin builds a different
     one. Matching on it meant an episode started from the reading page reached
     this room unrecognised. See sameEpisode() in core. */
  const sounding = now.status === "playing" || now.status === "reaching";
  const playingHere = (sourceId: string, recordId: string): boolean =>
    sameEpisode(now.episode, sourceId, recordId);

  /**
   * IS THIS LIST THE THING YOU ARE HEARING — answered from the entry itself.
   *
   * Every other card in the room lights while it plays and a playlist card did
   * not, which read as "playlists are not really records here". It was left out
   * because a list holds IDENTITIES rather than episodes, and lighting it looked
   * like it needed the whole list resolved against the catalogue on every
   * render.
   *
   * It does not. A stored identity IS the record id, in both shapes: a podcast
   * entry keeps the publisher's own `recordId`, and a music entry's id is
   * `sourceId:album:title` — the same string `trackId` builds, which is why that
   * shaper lives in one file. So this is a string comparison against what is
   * playing, and it costs nothing on a shelf of two hundred lists.
   */
  const entryPlaying = (entry: PlaylistEntry): boolean => (
    entry.kind === "music"
      ? playingHere(entry.sourceId, `${entry.sourceId}:${entry.album}:${entry.title}`)
      : playingHere(entry.sourceId, entry.recordId)
  );

  /**
   * WHAT WAS NOT FINISHED, newest first.
   *
   * The room opened on the whole library every time, which is the right answer
   * to "what is here?" and the wrong one to "where was I?" — and the second is
   * the question a listener actually arrives with, most days.
   *
   * Three rules keep it honest. It joins against the CATALOGUE rather than
   * printing what the ledger stored, so a row is only ever offered if the thing
   * still exists and the reader has not muted it; a place with no episode
   * behind it just does not draw. It ignores anything under a minute, because a
   * track sampled for ten seconds is not something to be invited back into. And
   * it ends at six: this is a doorway, not a history, and a history is what the
   * shelves below already are.
   */
  const resume = useMemo(() => {
    if (places.size === 0) return [];
    const found: Array<{
      key: string; heardAt: number; place: PodcastPlace; spoken: boolean;
      title: string; where: string; art?: string; tint?: string;
      open: () => void; episode: PodcastEpisode;
    }> = [];
    for (const [key, place] of places) {
      if (place.finished || place.positionSeconds < 60) continue;
      const cut = key.indexOf(":");
      const sourceId = key.slice(0, cut);
      const recordId = key.slice(cut + 1);
      if (sourceId === MUSIC.source.id) {
        for (const entry of MUSIC.albums) {
          const track = entry.tracks.find((t) => trackId(entry, t) === recordId);
          if (!track) continue;
          /* A SONG COMES BACK AS ITS RECORD. "Continue" means something
             different for music: nobody returns to the middle of a hymn, they
             return to the album they were working through. So the card wears
             the record's name and the sleeve, with the track named underneath
             as the place it will start — which is also why it carries no bar.
             Pressing it resumes that track inside the album's own queue. */
          found.push({
            key, heardAt: place.heardAt, place, spoken: false,
            title: entry.name, where: track.title,
            ...(entry.cover ? { art: entry.cover } : {}),
            ...(entry.tint ? { tint: entry.tint } : {}),
            open: () => setOpenAlbum(entry.name),
            episode: asEpisode(entry, track),
          });
          break;
        }
        continue;
      }
      const source = series.find((one) => one.id === sourceId);
      const ep = source?.episodes.find((one) => one.recordId === recordId);
      if (!source || !ep) continue;
      const art = SERIES_ART[sourceId];
      found.push({
        key, heardAt: place.heardAt, place, spoken: true,
        title: ep.title, where: source.name,
        ...(art ? { art: art.cover, tint: art.tint } : {}),
        open: () => setOpenSeries(sourceId),
        episode: seriesEpisode(sourceId, source.name, ep, art),
      });
    }
    return found.sort((a, b) => b.heardAt - a.heardAt).slice(0, 6);
  }, [places, series]);

  const list = lists.find((one) => one.id === openPlaylist) ?? null;
  if (list) {
    /* RESOLVED, NEVER PRINTED. Every row is looked up in the live catalogue by
       identity, so a renamed track shows its new name, a muted publisher's
       tracks disappear exactly as they do from a shelf, and a record that has
       left the library draws as a row that can still say what it was. */
    const rows = list.entries.map((entry) => ({
      entry,
      episode: resolveEntry(entry, audio, (id) => named.get(id) ?? titleFromId(id)),
    }));
    const live = rows.filter((row) => row.episode).map((row) => row.episode!);
    /* HOW MANY THINGS ARE ON THE LIST, which is not how long the list is. This
       stood as `runtime` in a file where `extent()` and `clock()` produce actual
       runtimes and every other `runtime` is a sum of seconds — so the hero's
       "12 items" was computed by a variable whose name promised "48 min".
       Nothing was wrong on screen; the next person to read the line would
       have been. */
    const count = list.entries.length;
    const here = live.some((ep) => playingHere(ep.sourceId, ep.recordId)) && sounding;
    /* Through the QUEUE, like everything else that plays through. A playlist is
       a way to fill it, not a second machine that advances on its own — see the
       note beside the queue for why a third answer to "what plays next" is how
       a listener ends up somewhere nobody chose.

       No recipe: a resume rebuilds a record from the shelf it came off, and a
       playlist is not on a shelf. It resumes as the single episode it was on,
       which is the honest fallback the recipe path already degrades to. */
    const play = (from: number): void => {
      if (live.length > 0) startPodcastQueue(list.name, live, from);
    };
    /* THE ACCENTS AND THE HERO HAVE TO AGREE ABOUT WHAT COLOUR THIS RECORD IS.
       Both other record pages declare `--record-tint` on `.listen` and lay the
       ambient beneath it; this branch did neither, and was the only record page
       standing on bare canvas. The consequence was not a missing gradient.
       `--record-tint` falls back to the app's seal at `.listen`, so every accent
       on this page — the play button, the sounding row's wash, the progress bar
       — wore the seal while the hero two inches away wore the artwork's colour,
       because the hero receives its tint as a prop. One page, two answers to
       "what colour is this?", which reads as a rendering fault, not a design.

       The colour is the first entry that still resolves — the same rule the
       shelf card uses for the same list, so a list is one colour in both places.
       When nothing resolves the ambient is still drawn: with no inline tint the
       field and the accents both derive from the seal, so the page is monochrome
       and INTERNALLY CONSISTENT, which is the whole point. A conditional ambient
       would hand a reader with an all-dead list the bare canvas this comment
       exists to abolish. */
    return (
      <div
        className="listen"
        ref={scroller}
        style={live[0]?.tint ? { "--record-tint": live[0].tint } as React.CSSProperties : undefined}
      >
        <ShellAmbient {...(live[0]?.tint ? { tint: live[0].tint } : {})} />
        <div className="listen-inner">
          <CompactBar
            name={list.name}
            onBack={() => openListenPlaylist(null)}
            onPlay={() => play(0)}
            playing={here}
            shown={passed}
          />
          <button className="listen-back" onClick={() => openListenPlaylist(null)} type="button">
            ← All playlists
          </button>
          <Hero
            art={live[0]?.artUrl}
            /* Stated always, used only when there is no art — the hero decides
               precedence; this branch supplies the fact that a list's fallback
               face is its own letter. `Array.from` rather than `charAt`, because
               a list named with an emoji would otherwise get half a surrogate
               pair and a replacement glyph. The em dash for a nameless list
               should be unreachable, and is written anyway: a blank square is
               the exact defect this removes, so no path may lead back to one. */
            initial={Array.from(list.name.trim())[0] ?? "—"}
            /* THE NAME, NOT THE CODE. The seed stores `PSA` because that is
               what the backbone keys on, and this printed it raw — so a list
               called "Psalms 23" carried "Playlist · from PSA 23" an inch above
               its own name. The list's name was built from `bookNames[book][0]`;
               this reads the same table the same way, so the two now agree by
               construction rather than by luck. */
            kicker={list.seed
              ? `Playlist · from ${bookNames?.[list.seed.book]?.[0] ?? list.seed.book} ${list.seed.chapter}`
              : "Playlist"}
            line={[
              `${count} ${count === 1 ? "item" : "items"}`,
              live.length < count ? `${count - live.length} unavailable` : null,
            ].filter(Boolean).join(" · ")}
            name={list.name}
            onPlay={() => play(0)}
            innerRef={mark}
            playing={here}
            {...(renaming === list.id ? {
              rename: {
                draft,
                onDraft: setDraft,
                onCommit: () => {
                  if (draft.trim().length === 0) return;
                  renamePlaylist(list.id, draft);
                  setRenaming(null);
                },
                onCancel: () => setRenaming(null),
              },
            } : {})}
            tint={live[0]?.tint}
          />
          {/* WHAT WAS WRONG WITH RENAME, and what is true now. `window.prompt`
              is not implemented in Electron's renderer — it THROWS rather than
              returning, so pressing Rename in the shipped app did nothing at
              all, and the `was != null` guard beside it read like careful
              handling of a cancel while the call above it never returned a value
              to guard. It was also the only prompt, confirm or alert anywhere in
              this renderer, which is why nobody had met it: every other question
              this app asks, it asks in its own window, in its own type, on the
              reader's own page.

              So the name is edited where the name IS. The pill that opened the
              dead dialogue opens the hero's own h1 as a field and becomes Save
              beside a Cancel — the reader's hand never leaves the row it started
              from, and Enter and Escape do what they do in every other field.

              SAVE IS DISABLED ON A BLANK NAME rather than allowed and ignored.
              `renamePlaylist` trims and returns silently on an empty string,
              which is right for a store and would be a lie here: the editor
              would close, the name would be unchanged, and the reader would have
              watched a control succeed at nothing. */}
          <div className="listen-list-tools">
            {renaming === list.id ? (
              <>
                <button
                  className="listen-list-tool"
                  disabled={draft.trim().length === 0}
                  onClick={() => {
                    if (draft.trim().length === 0) return;
                    renamePlaylist(list.id, draft);
                    setRenaming(null);
                  }}
                  type="button"
                >Save</button>
                <button
                  className="listen-list-tool"
                  onClick={() => setRenaming(null)}
                  type="button"
                >Cancel</button>
              </>
            ) : (
              <button
                className="listen-list-tool"
                onClick={() => { setDraft(list.name); setRenaming(list.id); }}
                type="button"
              >Rename</button>
            )}
            <button
              className="listen-list-tool"
              onClick={() => {
                const at = playlistIndex(list.id);
                const gone = deletePlaylist(list.id);
                openListenPlaylist(null);
                /* Deleting a list a reader spent time building must be
                   reversible in the same breath, or the menu item is a trap. */
                if (gone) showToast(`Deleted ${gone.name}`, "Undo", () => {
                  restorePlaylist(gone, at);
                  openListenPlaylist(gone.id);
                });
              }}
              type="button"
            >Delete</button>
          </div>
          {rows.length === 0 ? (
            <p className="listen-empty">
              Nothing on this list yet. Right-click any song or episode — on any
              album or series — to put it here.
            </p>
          ) : (
            <ol className="listen-tracks">
              {rows.map((row, index) => {
                const on = row.episode
                  && playingHere(row.episode.sourceId, row.episode.recordId);
                return (
                  <li className="listen-track" key={`${row.entry.title}:${index}`}>
                    <div className="listen-track-row" data-dead={row.episode ? undefined : ""}>
                      {/* NAMED BY ITS CONTENTS. An explicit `aria-label` on a
                          button REPLACES its contents in the accessible-name
                          algorithm rather than adding to them, so this label was
                          silencing everything under it — the publisher's name,
                          the runtime, and the row's own state. Here it also
                          stopped a lie being told twice: the row already says
                          "No longer in the library" in words on screen, and the
                          label said it again in different ones. */}
                      <button
                        aria-current={on ? "true" : undefined}
                        className="listen-track-face"
                        data-on={on ? "" : undefined}
                        disabled={!row.episode}
                        onClick={() => play(live.findIndex((ep) => ep === row.episode))}
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
                          <span className="listen-track-title">
                            {row.episode?.title ?? row.entry.title}
                          </span>
                          <span className="listen-track-when">
                            {row.episode?.sourceName ?? "No longer in the library"}
                          </span>
                        </span>
                        {/* The mark slot, empty and deliberately drawn: a row
                            that omitted the cell would slide its duration left
                            into the mark column and break the right edge of the
                            whole list — the same reason unheard rows on a record
                            page keep theirs. */}
                        <span className="listen-track-place" />
                        {/* A PLAYLIST ROW PRINTS ITS LENGTH like every other row
                            in the room. This span shipped self-closing and empty,
                            and so did the one beside it: fifty-four pixels of
                            column reserved on every row for nothing, on the one
                            page where a reader is deciding what to queue for a
                            drive. It was not missing by choice — it was
                            unreachable, because the episode shape carried no
                            length and both shapers dropped what their sources
                            had. It comes off the RESOLVED episode, never off the
                            stored entry: a number cached beside a title goes
                            stale the first time a publisher re-cuts a file. */}
                        <span className="listen-track-extent">
                          {clock(row.episode?.durationSeconds ?? null)}
                        </span>
                      </button>
                      {/* The hand this list invented and the rest of the room
                          now borrows: buttons beside the row rather than inside
                          it, which is what keeps the row a button. Here it is
                          longest, because ordering is the point of a list being
                          the reader's.

                          ADD COMES FIRST AND REMOVE STAYS LAST. The two arrows
                          are a pair and are not to be parted, so a fourth
                          control can only go at one end — and putting an
                          additive control past a destructive one reads as an
                          afterthought and puts × under the pointer on the way to
                          it. A dead row keeps its "+" DISABLED rather than
                          dropped: the entry is real and could honestly be copied
                          onto another list, but the record it names has left the
                          library, and offering to move a ghost somewhere is not
                          a kindness. Disabled rather than absent also holds the
                          hand's width, which the runtime column depends on. */}
                      <span className="listen-track-hand">
                        <button
                          className="listen-track-add"
                          disabled={!row.episode}
                          type="button"
                          {...askButton(row.entry, row.episode?.title ?? row.entry.title)}
                        >＋</button>
                        {/* EVERY BUTTON SAYS WHICH ROW IT BELONGS TO. A
                            twenty-row list read out as twenty buttons called
                            "Move up" and twenty called "Move down" — a control
                            list with no nouns in it, while the neighbouring ×
                            had carried its row's name since the first build.

                            The row's name goes AFTER the verb. A screen-reader
                            user tabbing a column hears the first word of each
                            control, so the verb has to lead or the column
                            becomes twenty readings of the same title — and it
                            keeps the label prefix-stable, which is what lets a
                            gate match on the verb alone. */}
                        <button
                          aria-label={`Move up — ${row.episode?.title ?? row.entry.title}`}
                          className="listen-track-move"
                          disabled={index === 0}
                          onClick={() => movePlaylistEntry(list.id, index, -1)}
                          type="button"
                        >↑</button>
                        <button
                          aria-label={`Move down — ${row.episode?.title ?? row.entry.title}`}
                          className="listen-track-move"
                          disabled={index === rows.length - 1}
                          onClick={() => movePlaylistEntry(list.id, index, 1)}
                          type="button"
                        >↓</button>
                        {/* THE ROW GOES AT ONCE AND CAN COME BACK, which is the
                            same bargain the Delete button above makes, and the
                            reason neither asks "are you sure?". A confirmation
                            on a one-row edit is a dialog in front of a reader
                            tidying a list, forty times an evening; an Undo costs
                            nothing until it is wanted.

                            Removed on the press rather than when the toast
                            lapses, and that is not a style preference. A
                            deferred removal reads well in a mockup and is a lie
                            about what the list contains: the store and the
                            screen disagree for five seconds, anything resolving
                            the list in that window sees the old row, and the
                            room's own tour counts rows half a second after the
                            press and would find nothing had happened. Truth
                            first, then the offer to reverse it. */}
                        <button
                          aria-label={`Remove ${row.entry.title}`}
                          className="listen-track-move"
                          onClick={() => {
                            const going = removeFromPlaylist(list.id, index);
                            if (!going) return;
                            showToast(`Removed ${row.entry.title}`, "Undo", () => {
                              insertPlaylistEntry(list.id, going, index);
                            });
                          }}
                          type="button"
                        >×</button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <Colophon />
        </div>
        {menu}
      </div>
    );
  }

  if (openedSeries) {
    /* SEASONS, and they are the publisher's calendar rather than our
       invention: a podcast's own division of itself is the year it published
       in, which is the grouping every listening app falls back to when a show
       declares no seasons of its own.

       WHICH WAY THE YEARS RUN is now the reader's, and stays theirs. Newest
       first is what a podcast is — the thing you subscribe to and catch up on.
       BEMA is not that: it is a sequential course through the whole Bible, and
       opening it at its newest session is opening a textbook at the index. */
    const forwards = readSeriesOrder(openedSeries.id) === "oldest";
    /* The filter is TITLES, and a series' titles are where its real numbering
       lives — BEMA's sessions, 30 Minutes' episode numbers, every passage a
       show put in its own title. Matching them is why "Galatians" or "441"
       finds something in six hundred rows without a search index. */
    const needle = query.trim().toLowerCase();
    /* THE ORDER ON SCREEN IS THE ORDER IT PLAYS, so the queue is built from the
       reader's chosen direction — a queue built from the unsorted catalogue
       would play something other than what they are looking at.

       IT IS THE WHOLE RECORD AND NOT THE FILTERED ROWS. A reader who narrows
       six hundred episodes to "Galatians" and presses one wants the show to
       carry on afterwards, not to stop dead because their filter ran out. The
       filter decides what is DRAWN; the record decides what plays. */
    const ordered = [...openedSeries.episodes].sort((a, b) => {
      const compared = (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
      return forwards ? -compared : compared;
    });
    const matching = needle
      ? ordered.filter((ep) => ep.title.toLowerCase().includes(needle))
      : ordered;
    const byYear = new Map<string, AudioCatalogueEpisode[]>();
    for (const ep of matching) {
      const when = ep.publishedAt ? new Date(ep.publishedAt).getFullYear() : null;
      const key = Number.isFinite(when) && when ? String(when) : "Undated";
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key)!.push(ep);
    }
    const art = SERIES_ART[openedSeries.id];
    const here = now.episode?.sourceId === openedSeries.id && sounding;
    const play = (from: number): void => {
      startPodcastQueue(
        openedSeries.name,
        ordered.map((ep) => seriesEpisode(openedSeries.id, openedSeries.name, ep, art)),
        from,
        /* The RECIPE travels with the record, not the list. It is what a
           relaunch rebuilds this same order from, so a reader who quits inside
           a series comes back to the series rather than to one episode of it. */
        { of: openedSeries.name, kind: "series", sourceId: openedSeries.id },
      );
    };
    const start = (): void => play(0);
    return (
      <div className="listen" ref={scroller} style={art ? { "--record-tint": art.tint } as React.CSSProperties : undefined}>
        <ShellAmbient {...(art ? { tint: art.tint } : {})} />
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
            plate={openedSeries.id}
            tint={art?.tint}
          />
          <Sift
            count={matching.length}
            forwards={forwards}
            noun="episode"
            onOrder={() => setSeriesOrder(openedSeries.id, forwards ? "newest" : "oldest")}
            query={query}
            total={openedSeries.episodes.length}
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
                  /* One entry, both gestures — see the album's rows for why it
                     is named rather than written out at each of them. */
                  const entry: PlaylistEntry = {
                    kind: "podcast",
                    sourceId: openedSeries.id,
                    recordId: ep.recordId,
                    title: ep.title,
                  };
                  return (
                    <li className="listen-track" key={ep.recordId}>
                      {/* Same grid as the album's rows and the playlist's: the
                          row button, and a hand beside it rather than inside it.
                          Six hundred episodes now carry a visible way onto a
                          list, at a cost of nothing until the pointer arrives. */}
                      <div className="listen-track-row">
                        {/* THE LABEL WAS SILENCING EVERYTHING IT SAT ON TOP OF.
                            An explicit `aria-label` REPLACES a button's contents
                            in the accessible-name algorithm, so the Progress
                            component's screen-reader text ("Played", "22 minutes
                            left"), the publisher's own line and the publication
                            date were all computed, hidden, and then discarded
                            before anybody heard them — and a CSS comment two
                            files away claimed the opposite. Named by its
                            contents now, which is what makes that sentence true.
                            The series' name is in the hero this list sits under;
                            "Play" was context a name should not carry. */}
                        <button
                          aria-current={on ? "true" : undefined}
                          className="listen-track-face"
                          data-on={on ? "" : undefined}
                          onClick={() => play(ordered.indexOf(ep))}
                          type="button"
                          {...askProps(entry, ep.title)}
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
                          {/* The publisher's own line, where their feed gave
                              one. A row without it draws exactly as it did —
                              which is most rows, and will stay most rows. */}
                            {ep.summary && <span className="listen-track-said">{ep.summary}</span>}
                            {stamp(ep.publishedAt) && <span className="listen-track-when">{stamp(ep.publishedAt)}</span>}
                          </span>
                          <Progress place={places.get(placeKey(openedSeries.id, ep.recordId))} />
                          <span className="listen-track-extent">{clock(ep.durationSeconds)}</span>
                        </button>
                        <span className="listen-track-hand">
                          <button
                            className="listen-track-add"
                            type="button"
                            {...askButton(entry, ep.title)}
                          >＋</button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          <Colophon />
        </div>
        {menu}
      </div>
    );
  }

  if (album) {
    const here = album.tracks.some((t) => playingHere(MUSIC.source.id, trackId(album, t))) && sounding;
    /* Flattened from the GROUPS rather than from `album.tracks`, for the same
       reason: the groups are what is on screen and their order is the
       publisher's. */
    const ordered = groups.flatMap((group) => group.tracks);
    const play = (from: number): void => {
      startPodcastQueue(
        album.name,
        ordered.map((track) => asEpisode(album, track)),
        from,
        { of: album.name, kind: "album", sourceId: MUSIC.source.id, album: album.name },
      );
    };
    const start = (): void => play(0);
    /* SHUFFLE THE PSALTER. A record is sequenced and Play honours that; shuffle
       is the other thing a listener does with music, and it did not exist here.
       Fisher–Yates over the whole record, then handed to the queue as an order
       of its own — so "next" means the next shuffled track rather than the next
       track on the sleeve, which is what shuffle has to mean to be worth having.

       Not offered on a series: shuffling a teaching series is shuffling the
       argument. */
    const shuffle = (): void => {
      const bag = ordered.map((track) => asEpisode(album, track));
      for (let at = bag.length - 1; at > 0; at -= 1) {
        const swap = Math.floor(Math.random() * (at + 1));
        [bag[at], bag[swap]] = [bag[swap]!, bag[at]!];
      }
      startPodcastQueue(album.name, bag, 0);
    };
    /* Sibling records, and the reason this is a title match rather than a field:
       `Hymns I` through `IV` and `As Foretold: Part 1` through `3` are seven
       separate shelf cards with nothing in the data linking them. The publisher
       named them as a family; nobody recorded that they were one. So the family
       is read back out of the naming, which is where it was put. */
    const family = album.name.match(/^(.*?)(?:\s+(?:[IVX]+|Part\s+\d+))$/i)?.[1]?.trim();
    const siblings = family
      ? albums.filter((one) => one.name !== album.name
        && one.name.replace(/\s+(?:[IVX]+|Part\s+\d+)$/i, "").trim() === family)
      : [];
    /* THE COUNT COUNTS WHAT IS ON SCREEN. It summed both halves of the record
       while one half was drawn — "18 of 222" standing over four visible rows,
       which is not a rounding error, it is the page contradicting itself. Both
       numbers move together now: the numerator is the rows the reader can see,
       and the denominator is the same half of the whole record, so narrowing
       the instrumentals reads "4 of 51" rather than "4 of 222". */
    const tally = (run: typeof groups): number => run.reduce((n, group) => n + group.tracks.length, 0);
    const drawn = chapters && half !== "all" ? chapters[half] : shown;
    const whole = chapters && half !== "all"
      ? tally(groups.filter((group) => INSTRUMENTAL.test(group.name) === (half === "played")))
      : album.tracks.length;
    return (
      <div className="listen" ref={scroller} style={album.tint ? { "--record-tint": album.tint } as React.CSSProperties : undefined}>
        <ShellAmbient {...(album.tint ? { tint: album.tint } : {})} />
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
            onShuffle={ordered.length > 1 ? shuffle : undefined}
            innerRef={mark}
            playing={here}
            source={album.slug
              /* The catalogue's homepage carries its own trailing slash, so
                 joining naively built a `.com//projects/` that their server
                 happens to forgive. Trimmed rather than trusted. */
              ? {
                href: `${MUSIC.source.homepageUrl.replace(/\/+$/, "")}/projects/${album.slug}`,
                label: `${album.name} at ${MUSIC.source.name}`,
              }
              : { href: MUSIC.source.listenUrl, label: MUSIC.source.name }}
            tint={album.tint}
          />
          {/* EveryPsalm is 222 rows — long enough to need a way in, and the one
              record here where "Psalm 40" is a thing a reader arrives wanting.
              No order control: see Sift for why a record's sequence is not
              ours to reverse. */}
          {album.tracks.length > 24 && (
            <Sift
              count={tally(drawn)}
              noun="song"
              query={query}
              total={whole}
            >
              {chapters && (
                <div aria-label="Which half of the record" className="listen-halves" role="group">
                  {([["all", "All"], ["sung", "Sung"], ["played", "Instrumental"]] as const)
                    .map(([which, label]) => (
                      <button
                        aria-pressed={half === which}
                        className="listen-half"
                        data-on={half === which ? "" : undefined}
                        key={which}
                        onClick={() => setChosenHalf(which)}
                        type="button"
                      >{label}</button>
                    ))}
                </div>
              )}
            </Sift>
          )}

          {chapters ? (
            /* Two chapters, each announced once, rather than thirteen equal
               group heads in a row with the instrumental half arriving
               unlabelled halfway down. The heading is suppressed when the
               reader has asked for one half — they know which half they chose,
               and a heading over the only thing on screen is furniture. */
            ([["sung", "Sung", chapters.sung], ["played", "Instrumental", chapters.played]] as const)
              .filter(([which]) => half === "all" || half === which)
              .map(([which, label, run]) => (
                <React.Fragment key={which}>
                  {half === "all" && run.length > 0 && (
                    <div className="listen-chapter">
                      <h2 className="listen-chapter-name">{label}</h2>
                      <span className="listen-chapter-count">
                        {run.reduce((n, group) => n + group.tracks.length, 0)}
                      </span>
                    </div>
                  )}
                  {run.map((group) => (
                    <AlbumGroup
                      album={album}
                      askButton={askButton}
                      askProps={askProps}
                      group={group}
                      key={group.name || "all"}
                      onPlay={play}
                      ordered={ordered}
                      playingHere={playingHere}
                      sounding={sounding}
                    />
                  ))}
                </React.Fragment>
              ))
          ) : shown.map((group) => (
            <AlbumGroup
              album={album}
              askButton={askButton}
              askProps={askProps}
              group={group}
              key={group.name || "all"}
              onPlay={play}
              ordered={ordered}
              playingHere={playingHere}
              sounding={sounding}
            />
          ))}

          {siblings.length > 0 && (
            <section aria-label={`More in ${family}`} className="listen-siblings">
              <h2 className="listen-siblings-name">More in {family}</h2>
              <ul className="listen-siblings-row">
                {siblings.map((one) => (
                  <li key={one.name}>
                    <button
                      aria-label={`${one.name} — ${albumLine(one)}`}
                      className="listen-sibling"
                      onClick={() => setOpenAlbum(one.name)}
                      type="button"
                    >
                      <Cover alt="" src={one.cover} tint={one.tint} />
                      <span className="listen-sibling-name">{one.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Colophon who={MUSIC.source.name} />
        </div>
        {menu}
      </div>
    );
  }

  return (
    <div
      className="listen"
      onScroll={rememberScroll}
      ref={scroller}
      /* THE SHELF WEARS THE LAST RECORD'S COLOUR AGAIN · restored 2026-08-03,
         and the round trip is the point of the note. It wore this field once
         before, on the reasoning that every record page has one and the shelf
         was the plainest screen in the room. The maintainer looked at it and
         named the cost in one line: the SIDEBAR stopped looking translucent. So
         it was removed — and what was removed was the field, when the fault was
         never in the field.

         The rail is transparent with a 26px backdrop blur, and what it blurs is
         the app SHELL behind it, not this pane, which begins to its right. A
         field painted INSIDE this pane therefore ran up to the rail and stopped
         dead: a strip that had been invisible became a dark band with a hard
         edge down the window. Every record page had the same seam and kept it,
         because on those pages the colour is the subject and could not go.

         Both halves were wanted — the maintainer said so plainly, the shelf's
         colour and the rail's translucency together — and they were only ever in
         conflict because of where the paint was. It is at shell scope now, under
         the rail as well as under this pane, so the rail has something stained
         to blur and the window is one field. See ShellAmbient above.

         The colour is the most recently heard record's, which is the same colour
         the first Continue Listening card is wearing an inch below — so the
         field is not decoration, it is the room agreeing with itself about where
         the reader last was. Nothing heard yet and it falls back to the app's
         own seal, which is a quiet warm ground rather than a missing one. */
    >
      <ShellAmbient {...(resume[0]?.tint ? { tint: resume[0].tint } : {})} />
      <div className="listen-inner">
        <header className="listen-head">
          <h1 className="listen-title">Listen</h1>
          <p className="listen-lede">Everything in your library that has a runtime — sung and spoken.</p>
        </header>

        {resume.length > 0 && (
          <section aria-label="Continue listening" className="listen-shelf is-resume">
            <div className="listen-shelf-head">
              <h2 className="listen-shelf-name">Continue listening</h2>
              <p className="listen-shelf-by">Where you left off</p>
            </div>
            <ul className="listen-resume-row">
              {resume.map((one) => (
                <li className="listen-resume" data-kind={one.spoken ? "spoken" : "sung"} key={one.key}>
                  {/* TWO PRESSES, because there are two intentions and one of
                      them is destructive of the other. The face plays from the
                      place — the whole reason this shelf exists. The name under
                      it opens the record, for a reader who wants the list
                      rather than the audio. Rolling both into one press would
                      make every "where was I?" also a commitment to start. */}
                  <button
                    aria-label={`Resume ${one.title} — ${one.where}`}
                    className="listen-resume-face"
                    onClick={() => playPodcastEpisode({
                      ...one.episode,
                      startAt: one.place.positionSeconds,
                    })}
                    style={one.tint ? { "--record-tint": one.tint } as React.CSSProperties : undefined}
                    type="button"
                  >
                    <span className="listen-resume-art">
                      <Cover alt="" src={one.art} tint={one.tint} />
                      <span aria-hidden="true" className="listen-resume-play">
                        {playingHere(one.episode.sourceId, one.episode.recordId) && sounding
                          ? <BarsGlyph />
                          : <PlayGlyph size={16} />}
                      </span>
                      {one.spoken && <Progress place={one.place} />}
                    </span>
                    <span className="listen-resume-title">{one.title}</span>
                  </button>
                  <button className="listen-resume-where" onClick={one.open} type="button">
                    {one.where}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Music" className="listen-shelf">
          <div className="listen-shelf-head">
            <h2 className="listen-shelf-name">Music</h2>
            <p className="listen-shelf-by">{MUSIC.source.name}</p>
          </div>
          {shownAlbums.length === 0 ? (
            /* THE DEFECT THE SERIES SHELF ALREADY DOCUMENTED, sitting one shelf
               above it unfixed: a heading, a byline, and then an empty grid.
               Music ships bundled, so the only way to empty this shelf is to
               shelve every record on it — which is a reader tidying, not a
               reader losing anything, and the sentence has to say so. It names
               the control that undoes it by the exact words on that control,
               because "use the toggle below" is a scavenger hunt. */
            <p className="listen-empty">
              Every album is hidden from this shelf. Nothing has been removed —
              Show them, below, brings them all back.
            </p>
          ) : (
          <ul className="listen-grid">
            {shownAlbums.map((entry) => {
              const on = entry.tracks.some((t) => playingHere(MUSIC.source.id, trackId(entry, t))) && sounding;
              return (
                <li
                  className="listen-card"
                  data-away={isListenHidden(albumKey(entry.name)) ? "" : undefined}
                  key={entry.name}
                >
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
                  <Shelve away={isListenHidden(albumKey(entry.name))} of={entry.name}
                    onToggle={(next) => setListenHidden(albumKey(entry.name), next)} />
                </li>
              );
            })}
          </ul>
          )}
        </section>

        <section aria-label="Series" className="listen-shelf">
          <div className="listen-shelf-head">
            <h2 className="listen-shelf-name">Series</h2>
            <p className="listen-shelf-by">Spoken, from your library</p>
          </div>
          {audio === null ? <Skeleton /> : series.length === 0 ? (
            /* A HEADING OVER NOTHING was what a refused or empty library drew:
               "Series", "Spoken, from your library", and then an empty list.
               Silence is not an error here — a library with no episode files is
               the ordinary state of a fresh install — so it says what is true
               and where the audio would come from. */
            <p className="listen-empty">
              No spoken series in your library yet. Shows arrive on this shelf on
              their own, as your library takes their episodes in — there is
              nothing to set up here, and nothing has gone wrong.
            </p>
          ) : (
            <ul className="listen-grid">
              {series.filter((source) => !away(source.id)).map((source) => {
                const art = SERIES_ART[source.id];
                const on = now.episode?.sourceId === source.id && sounding;
                return (
                  <li
                    className="listen-card"
                    data-away={isListenHidden(source.id) ? "" : undefined}
                    data-source={source.id}
                    key={source.id}
                  >
                    <button
                      aria-label={`${source.name} — ${seriesLine(source.episodes)}`}
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
                      {/* The same line the album cards carry, and the same line
                          this show's own hero carries. It said "676 episodes"
                          while its sibling said "2020–2022 · 222 songs · 15 hr"
                          — a poorer card for no reason, next to a function that
                          already computed the whole thing. */}
                      <span className="listen-card-foot">{seriesLine(source.episodes)}</span>
                    </button>
                    <Shelve away={isListenHidden(source.id)} of={source.name}
                      onToggle={(next) => setListenHidden(source.id, next)} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Playlists" className="listen-shelf">
          <div className="listen-shelf-head">
            <h2 className="listen-shelf-name">Playlists</h2>
            <p className="listen-shelf-by">Yours</p>
            {/* BOTH DOORS, SIDE BY SIDE, and in this order. The seed is first
                because it was here first, and a reader looking for the unusual
                thing this app can do finds it where they left it; the plain one
                sits after it, where the eye lands last on the way to the shelf
                it fills. Grouped rather than each pushed right on its own — see
                the styles for why two auto margins in one row is not twice
                one auto margin. */}
            <div className="listen-shelf-tools">
              <PassageSeed
                backbone={backbone ?? null}
                bookNames={bookNames ?? null}
                onMade={(id) => openListenPlaylist(id)}
              />
              <NewPlaylist
                onMade={(id, made) => showToast(
                  `Created ${made}`, "Open", () => openListenPlaylist(id),
                )}
              />
            </div>
          </div>
          {lists.length === 0 ? (
            <p className="listen-empty">
              No playlists yet. New playlist… makes an empty one to fill; New
              from a passage… builds one out of a chapter of scripture. Or
              right-click any song or episode to start from what you are already
              looking at.
            </p>
          ) : (
            <ul className="listen-grid">
              {lists.map((one) => {
                const first = one.entries
                  .map((entry) => resolveEntry(entry, audio, (id) => named.get(id) ?? titleFromId(id)))
                  .find(Boolean);
                /* Matched against the stored identity rather than the resolved
                   episode — see `entryPlaying`. A list is playing when anything
                   on it is, which is what a listener means by it: they put the
                   track there and they are hearing it. */
                const on = one.entries.some(entryPlaying) && sounding;
                return (
                  <li className="listen-card" key={one.id}>
                    <button
                      aria-label={`${one.name} — ${one.entries.length} items`}
                      className="listen-card-face"
                      data-on={on ? "" : undefined}
                      onClick={() => openListenPlaylist(one.id)}
                      style={first?.tint ? { "--record-tint": first.tint } as React.CSSProperties : undefined}
                      type="button"
                    >
                      <span className="listen-card-art">
                        <Cover alt="" src={first?.artUrl} tint={first?.tint} />
                        <span aria-hidden="true" className="listen-card-play">
                          {on ? <BarsGlyph /> : <PlayGlyph size={18} />}
                        </span>
                      </span>
                      <span className="listen-card-name">{one.name}</span>
                      <span className="listen-card-foot">
                        {one.entries.length} {one.entries.length === 1 ? "item" : "items"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* NOTHING IS EVER LOST, and the shelf says so out loud. A hidden record
            with no way back is a deleted record that lied about it, so the count
            is always on screen when it is not zero. */}
        {hiddenCount > 0 && (
          <p className="listen-hidden-note">
            {hiddenCount} {hiddenCount === 1 ? "record" : "records"} hidden from this room.{" "}
            <button
              className="listen-hidden-show"
              onClick={() => setShowHidden(!showHidden)}
              type="button"
            >{showHidden ? "Hide them again" : "Show them"}</button>
          </p>
        )}

        <Colophon />
      </div>
      {menu}
    </div>
  );
}
