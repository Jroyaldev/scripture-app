import type React from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BookNameData } from "../api.js";
import type { Transcript } from "../../core/transcripts.js";
import { safeCall } from "../utils/safeCall.js";
import { useToast } from "./Toast.js";

/**
 * One podcast transport for the whole app, and the dock a reader steers it from.
 *
 * The element used to live inside the Living Margin's resource block, which
 * meant it died with the margin: switching study tab, changing passage, closing
 * the panel or leaving Read each unmounted the block and stopped the episode
 * mid-sentence. The comment that shipped with it called that deliberate — "a
 * player that outlives the reason it was opened is a player nobody can find to
 * switch off" — and the second half of that sentence is the real requirement.
 * So the transport is drawn somewhere it can always be found instead of being
 * destroyed somewhere it cannot: one element above everything that unmounts
 * during reading, and one dock with a stop on it.
 *
 * The permission boundary does not move with the element. Audio is fetched only
 * from a host the source declared in `mediaHosts`, only through
 * `record.audioUrl`, and only after a reader presses play — which is what
 * `preload="none"` below makes true rather than merely intended. Nothing is
 * stored, cached or re-hosted; closing the dock releases the file rather than
 * leaving a connection open on the publisher's server. The card still carries
 * its outbound link and so does the dock. See docs/trusted-resource-permissions.
 */

/**
 * A named span inside an episode, with the passage it works through.
 *
 * NOT WIRED. Nothing populates this yet. No trusted-resource adapter returns
 * chapter data, and none of the manifests carry it — see
 * src/core/resources/trusted-resources.ts, whose records are deliberately
 * body-less. The dock renders the list whenever an episode arrives carrying
 * one, and renders none when it does not, so the surface is ready for whichever
 * of these lands first:
 *
 *   · a publisher's own chapters, from the Podcasting 2.0 `podcast:chapters`
 *     tag or ID3 CHAP frames, parsed in the adapter that fetched the record;
 *   · our own, derived from the passage index the ranking already computes when
 *     it matches an episode to a bref.
 *
 * Until then this type is the contract, not a promise.
 */
export interface PodcastChapter {
  /** Seconds from the start of the file. */
  start: number;
  /** Canonical bref for the span, so a press can reach the reading canvas. */
  bref: string;
  /** The publisher's or our own label for the span. */
  title: string;
}

/** What a card hands over on press. Every field is already printed on the card. */
export interface PodcastEpisode {
  /** `${sourceId}:${recordId}` — the key the margin already draws its cards by. */
  id: string;
  sourceId: string;
  /** Kept whole rather than sliced back out of `id`: the broker matches on it. */
  recordId: string;
  sourceName: string;
  title: string;
  /** The publisher's own page. Play sits beside this link, never instead of it. */
  officialUrl: string;
  /** HTTPS on a declared media host; the manifest refused to load otherwise. */
  audioUrl: string;
  /** The passage the publisher's own title named, as the ranking matched it. */
  bref: string;
  /** The record's own kind — podcast, sermon, video. Named on the card too. */
  kind: string;
  /** Optional, and currently never supplied — see PodcastChapter. */
  chapters?: PodcastChapter[];
}

/** Where the transport is, in the element's own words rather than our guess. */
export type PodcastStatus = "idle" | "reaching" | "playing" | "paused" | "failed";

export interface PodcastNowPlaying {
  episode: PodcastEpisode | null;
  status: PodcastStatus;
}

interface PodcastElapsed {
  at: number;
  of: number;
}

/* Two subscriptions rather than one. A card's play button needs to know which
   episode is running; it does not need to know where in it, and a timeupdate
   four times a second must not re-render five thousand lines of study panel. */
let nowPlaying: PodcastNowPlaying = { episode: null, status: "idle" };
let elapsed: PodcastElapsed = { at: 0, of: 0 };
const nowPlayingWatchers = new Set<() => void>();
const elapsedWatchers = new Set<() => void>();

/** The one element, held outside React so no render can misplace it. */
let transport: HTMLAudioElement | null = null;

function announceNowPlaying(next: PodcastNowPlaying): void {
  if (next.episode === nowPlaying.episode && next.status === nowPlaying.status) return;
  nowPlaying = next;
  for (const watcher of nowPlayingWatchers) watcher();
}

function announceElapsed(at: number, of: number): void {
  if (at === elapsed.at && of === elapsed.of) return;
  elapsed = { at, of };
  for (const watcher of elapsedWatchers) watcher();
}

function subscribeNowPlaying(watcher: () => void): () => void {
  nowPlayingWatchers.add(watcher);
  return () => { nowPlayingWatchers.delete(watcher); };
}

function subscribeElapsed(watcher: () => void): () => void {
  elapsedWatchers.add(watcher);
  return () => { elapsedWatchers.delete(watcher); };
}

/** Which episode is loaded and what it is doing. Safe to call from anywhere. */
export function usePodcastNowPlaying(): PodcastNowPlaying {
  return useSyncExternalStore(subscribeNowPlaying, () => nowPlaying);
}

/**
 * Press play on an episode. The one element is re-pointed rather than joined by
 * a second: two voices at once is never what anyone meant, and a per-card
 * element would have made that the default.
 */
export function playPodcastEpisode(episode: PodcastEpisode): void {
  if (!transport) return;
  if (nowPlaying.episode?.id === episode.id) {
    togglePodcast();
    return;
  }
  transport.src = episode.audioUrl;
  announceElapsed(0, 0);
  announceNowPlaying({ episode, status: "reaching" });
  void transport.play().catch(() => announceNowPlaying({ episode, status: "failed" }));
}

export function togglePodcast(): void {
  const element = transport;
  const episode = nowPlaying.episode;
  if (!element || !episode) return;
  if (!element.paused) {
    element.pause();
    return;
  }
  // An episode that reached its end restarts. A bare play() there resolves
  // against a finished element and leaves the reader pressing a dead button.
  if (element.ended) element.currentTime = 0;
  announceNowPlaying({ episode, status: "reaching" });
  void element.play().catch(() => announceNowPlaying({ episode, status: "failed" }));
}

/** Move to a second in the file, clamped to it. */
export function seekPodcast(seconds: number): void {
  const element = transport;
  if (!element || !Number.isFinite(element.duration)) return;
  const target = Math.min(Math.max(0, seconds), element.duration);
  element.currentTime = target;
  announceElapsed(target, element.duration);
}

/** Back or forward by an interval, from wherever the file actually is. */
export function skipPodcast(seconds: number): void {
  if (!transport) return;
  seekPodcast(transport.currentTime + seconds);
}

/** The rates the dock cycles. 1 first, so one press always returns to normal. */
export const PODCAST_RATES = [1, 1.2, 1.5, 1.75, 2] as const;

/**
 * Set playback rate on the element. `preservesPitch` defaults true in every
 * engine we ship on, which is what makes 1.5× a listenable voice rather than a
 * chipmunk; it is set explicitly so a future engine default cannot change that
 * silently.
 */
export function setPodcastRate(rate: number): void {
  if (!transport) return;
  transport.preservesPitch = true;
  transport.playbackRate = rate;
}

/**
 * Stop, and let go of the publisher's file. Closing the dock is the reader
 * saying they are done with it: the connection closes with the dock rather than
 * idling open on a server that is not ours.
 */
export function stopPodcast(): void {
  if (transport) {
    transport.pause();
    transport.removeAttribute("src");
    transport.load();
  }
  announceElapsed(0, 0);
  announceNowPlaying({ episode: null, status: "idle" });
}

function registerTransport(element: HTMLAudioElement | null): void {
  transport = element;
}

/**
 * The element saying what it is doing, which is the only authority on it.
 *
 * A failure is the last word until a reader presses play again. The element
 * fires `error` and *then* `pause` — in that order, every time — so without
 * this the dock would end up saying "paused" about an episode it never
 * reached, which is the one wrong thing it could say. Only reaching the file
 * clears it.
 */
function elementReports(status: PodcastStatus): void {
  const episode = nowPlaying.episode;
  if (!episode) return;
  if (nowPlaying.status === "failed" && status !== "playing") return;
  announceNowPlaying({ episode, status });
}

/** Seconds to m:ss, or h:mm:ss past the hour. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

interface EpisodePassage {
  book: string;
  chapter: number;
  verse: number;
  endChapter: number;
  endVerse: number;
}

/**
 * `bref:v1/1SA.30.1-1SA.30.31` as coordinates a reader can be sent to. The
 * shape is the canonical one ScripturePage already reads, so the dock cannot
 * navigate somewhere the reading canvas would decline to go.
 */
function readEpisodePassage(bref: string): EpisodePassage | null {
  const match = /^bref:v1\/([1-3A-Z]{3})\.(\d+)\.(\d+)(?:-([1-3A-Z]{3})\.(\d+)\.(\d+))?$/.exec(bref);
  if (!match) return null;
  const [, book, chapterText, verseText, endBook, endChapterText, endVerseText] = match;
  const chapter = Number(chapterText);
  const verse = Number(verseText);
  // A range that crosses into another book has no single chapter to name, so
  // the episode is filed under where it starts — which is where it starts.
  const spansBook = endBook !== undefined && endBook !== book;
  return {
    book: book!,
    chapter,
    verse,
    endChapter: spansBook || endChapterText === undefined ? chapter : Number(endChapterText),
    endVerse: spansBook || endVerseText === undefined ? verse : Number(endVerseText),
  };
}

/**
 * A chapter's span, without the book. The episode's own passage is set above
 * the list and every chapter falls inside it, so naming the book on each row
 * spends the column on nine repetitions of the same word and truncates the part
 * that differs.
 */
function chapterSpanLabel(passage: EpisodePassage): string {
  if (passage.endChapter > passage.chapter) {
    return `${passage.chapter}:${passage.verse}–${passage.endChapter}:${passage.endVerse}`;
  }
  return passage.endVerse > passage.verse
    ? `${passage.chapter}:${passage.verse}–${passage.endVerse}`
    : `${passage.chapter}:${passage.verse}`;
}

function episodePassageLabel(passage: EpisodePassage, bookNames: BookNameData): string {
  const name = bookNames[passage.book]?.[0] ?? passage.book;
  return passage.endChapter > passage.chapter
    ? `${name} ${passage.chapter}–${passage.endChapter}`
    : `${name} ${passage.chapter}`;
}

/**
 * Play is optically centred, not geometrically. A right-pointing triangle
 * carries its mass at the base, so centring its bounding box leaves it sitting
 * visibly left of the circle it is in. Its centroid — a third of the way from
 * base to apex — is what has to land on centre, which is +0.6 on this box.
 * Pause is symmetrical and needs no such correction; both bars are measured
 * about the same centre so the two states do not shift under the pointer.
 */
function PlayGlyph({ paused }: { paused: boolean }): React.JSX.Element {
  return paused ? (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path d="M6 3.4 15 9l-9 5.6z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path d="M5.6 3.4h2.6v11.2H5.6zM9.8 3.4h2.6v11.2H9.8z" fill="currentColor" />
    </svg>
  );
}

/**
 * An arrow bent round the interval it moves, with the interval inside it.
 *
 * Ring r 8.2 on a 24 box, stroke 1.5, broken by a 40° gap about vertical. The
 * head seats inward by (half − stroke/2), which puts its outer corner exactly
 * on the ring's outer edge: centred on the path it throws a barb past the
 * stroke, and set back off the path it exposes the stroke's round cap as a
 * spur. Seated, it can be large enough to read at 20px without doing either.
 * Forward is the same path mirrored, so the pair cannot drift apart.
 */
function SkipGlyph({ seconds }: { seconds: number }): React.JSX.Element {
  const back = seconds < 0;
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      <g transform={back ? undefined : "scale(-1 1) translate(-24 0)"}>
        <path
          d="M9.20 4.29A8.2 8.2 0 1 0 14.80 4.29"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <path d="M5.47 7.51L8.94 3.59L10.65 8.29Z" fill="currentColor" />
      </g>
      <text
        x="12"
        y="12.6"
        dominantBaseline="central"
        fill="currentColor"
        fontFamily="var(--font-mono)"
        fontSize="9.4"
        fontWeight="500"
        textAnchor="middle"
      >
        {Math.abs(seconds)}
      </text>
    </svg>
  );
}

/**
 * The dock, and the element it steers. Rendered by App so nothing a reader does
 * inside a passage can take it away; hidden until a reader presses play, which
 * is also the first moment anything is fetched.
 */
export function PodcastPlayer({
  bookNames,
  onNavigate,
}: {
  bookNames: BookNameData;
  onNavigate: (book: string, chapter: number, verse?: number, endVerse?: number) => Promise<boolean>;
}): React.JSX.Element {
  const { showToast } = useToast();
  const { episode, status } = usePodcastNowPlaying();
  const { at, of } = useSyncExternalStore(subscribeElapsed, () => elapsed);
  /* Where the reader's thumb is, which is not yet where the file is. Committing
     on release rather than on every input keeps one seek per drag instead of
     sixty, and one range request on the publisher's server instead of sixty. */
  const [scrubbingAt, setScrubbingAt] = useState<number | null>(null);
  /* Open is the reader asking for the whole episode rather than the corner of
     it. It is deliberately not remembered across episodes: pressing play on a
     new card should give back the corner, not whatever the last one was left
     at. */
  const [expanded, setExpanded] = useState(false);
  /* undefined while unasked or in flight, null once we know there is none.
     The distinction matters: "no transcript" is a fact worth drawing, and
     "not looked yet" must not be drawn as that fact. */
  const [transcript, setTranscript] = useState<Transcript | null | undefined>(undefined);
  const activeLineRef = useRef<HTMLLIElement>(null);
  const [following, setFollowing] = useState(true);
  const [rateIndex, setRateIndex] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  /* Focus mode's peek, held here rather than read off :hover.

     :hover is a function of the element's box, and in focus mode the box is a
     function of :hover — the dock grows from a 54px disc to the full card when
     pointed at. A state derived from live hit-testing of the thing whose
     geometry it changes can always flicker: any moment where the growing or
     shrinking box crosses the pointer re-evaluates the condition that caused
     it. Shaping the hit area moves the conditions; it does not remove the loop.

     So the state is explicit. pointerenter and pointerleave are events about a
     pointer CROSSING a boundary, not a continuously re-evaluated predicate, and
     the box changing under a stationary pointer fires neither. Once open it
     stays open until the pointer actually leaves — which is the same reason
     menu-aim keeps its own state rather than leaning on :hover.

     The two delays are the intent pair, and they live here now instead of in
     the stylesheet: waiting in CSS as well would spend both twice. */
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<number | null>(null);

  const armPeek = (next: boolean, pointerType: string): void => {
    /* A pointer that cannot hover has nothing to peek with. Touch fires enter
       on the press and leave on the lift, so without this a tap on the disc
       opens the whole card 160ms after the finger has gone — and then closes
       it. On touch the disc is simply the play button, which is what a 54px
       target in a corner should be. */
    if (pointerType === "touch") return;
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      peekTimer.current = null;
      setPeeking(next);
    }, next ? 160 : 130);
  };

  useEffect(() => () => {
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
  }, []);

  /* A new episode gives back the corner. Open was the reader asking for THIS
     episode's whole self; the next card has not been asked anything yet. No
     focus moves here — nothing was pressed. */
  const episodeId = episode?.id;
  useEffect(() => {
    setExpanded(false);
    setPeeking(false);
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
  }, [episodeId]);

  /* Asked once per episode, not per open. A reader who opens and shuts the
     sheet is not asking the disk anything new, and the answer for an episode
     does not change while it is playing. */
  useEffect(() => {
    if (!episode) { setTranscript(undefined); return; }
    let live = true;
    setTranscript(undefined);
    void window.api.transcripts.load(episode.recordId).then((result) => {
      if (!live) return;
      setTranscript(result.ok ? result.transcript : null);
    }).catch(() => { if (live) setTranscript(null); });
    return () => { live = false; };
  }, [episode?.recordId]);

  /* Focus follows the press, in both directions: into the sheet when it opens,
     back to the control that opened it when it shuts. Without the second half a
     reader who collapses the sheet is left focused on an element that is now
     inert, and the next Tab starts again from the top of the document. */
  const toggleSheet = (): void => {
    const next = !expanded;
    setExpanded(next);
    requestAnimationFrame(() => {
      if (next) sheetRef.current?.querySelector<HTMLElement>("h2, button")?.focus({ preventScroll: true });
      else toggleRef.current?.focus({ preventScroll: true });
    });
  };

  const openOfficial = async (): Promise<void> => {
    if (!episode) return;
    const result = await safeCall(() => window.api.trustedResources.openOfficial(
      episode.sourceId,
      episode.recordId,
      episode.officialUrl,
    ));
    if (!result.ok) showToast("That official resource link could not be opened.", undefined, undefined, { tone: "error" });
  };

  const passage = episode ? readEpisodePassage(episode.bref) : null;
  const position = scrubbingAt ?? at;
  const played = of > 0 ? Math.min(1, Math.max(0, position / of)) : 0;
  const paused = status !== "playing" && status !== "reaching";
  const commitScrub = (): void => {
    if (scrubbingAt == null) return;
    seekPodcast(scrubbingAt);
    setScrubbingAt(null);
  };

  /* Chapters are drawn only when an episode brought some; nothing does yet.
     See PodcastChapter for what would. */
  const chapters = episode?.chapters ?? [];
  const chapterIndex = chapters.reduce(
    (found, chapter, index) => (position >= chapter.start ? index : found),
    -1,
  );
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : undefined;

  /* The active line is found the same way the active chapter is: the last span
     that has started. Binary search would be tidier over 1,400 lines, but this
     runs on a timeupdate tick against an already-sorted array, and the loader
     sorts precisely so this scan can be trusted. */
  const lines = transcript?.segments ?? [];
  const lineIndex = lines.reduce(
    (found, line, index) => (position >= line.s ? index : found),
    -1,
  );

  /* Following is the default and stays on until the reader scrolls away from
     the playhead themselves. Dragging someone back to the active line while
     they are reading ahead is the worst thing a transcript can do, so any
     manual scroll is taken as an instruction to stop. */
  useEffect(() => {
    if (!expanded || !following || lineIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [lineIndex, following, expanded]);

  const rate = PODCAST_RATES[rateIndex] ?? 1;
  const cycleRate = (): void => {
    const next = (rateIndex + 1) % PODCAST_RATES.length;
    setRateIndex(next);
    setPodcastRate(PODCAST_RATES[next] ?? 1);
  };

  const navigateTo = (target: EpisodePassage): void => {
    void onNavigate(
      target.book,
      target.chapter,
      target.verse,
      target.endChapter === target.chapter ? target.endVerse : undefined,
    );
  };

  return (
    <>
      <audio
        onDurationChange={(event) => announceElapsed(event.currentTarget.currentTime, event.currentTarget.duration || 0)}
        onEnded={() => elementReports("paused")}
        onError={() => { if (nowPlaying.episode) announceNowPlaying({ episode: nowPlaying.episode, status: "failed" }); }}
        onLoadedMetadata={(event) => announceElapsed(0, event.currentTarget.duration || 0)}
        onPause={() => elementReports("paused")}
        onPlaying={() => elementReports("playing")}
        onTimeUpdate={(event) => announceElapsed(event.currentTarget.currentTime, event.currentTarget.duration || 0)}
        onWaiting={() => elementReports("reaching")}
        preload="none"
        ref={registerTransport}
      />
      {episode && (
        <section
          aria-label={`Podcast player — ${episode.title}`}
          className="podcast-dock"
          data-expanded={expanded}
          data-peeking={peeking}
          onPointerEnter={(event) => armPeek(true, event.pointerType)}
          onPointerLeave={(event) => armPeek(false, event.pointerType)}
          data-floating-layer="player"
          data-source={episode.sourceId}
          data-status={status}
          style={{ "--podcast-played": `${(played * 100).toFixed(3)}%` } as React.CSSProperties}
        >
          {/* Said once, on a change, and never on a timeupdate — a position
              announced every second is a screen reader nobody can use. */}
          <span className="sr-only" role="status" aria-live="polite">
            {status === "failed"
              ? `${episode.title} could not be reached.`
              : `${status === "playing" ? "Playing" : status === "reaching" ? "Loading" : "Paused"}: ${episode.title}, ${episode.sourceName}.`}
          </span>

          <header className="podcast-mast">
            {/* The publisher's approved mark replaces this name in CSS for the
                sources whose marks have been cleared, and the name stays in the
                accessibility tree either way. See player.css. */}
            <span className="podcast-mast-source">{episode.sourceName}</span>
            <span className="podcast-mast-kind">{episode.kind}</span>
            {passage && !expanded && (
              <button
                aria-label={`Read ${episodePassageLabel(passage, bookNames)}, the passage this episode works through`}
                className="podcast-mast-passage"
                onClick={() => navigateTo(passage)}
                type="button"
              >
                {episodePassageLabel(passage, bookNames)}
              </button>
            )}
            <button
              aria-expanded={expanded}
              aria-label={expanded ? `Collapse the player` : `Show the whole of ${episode.title}`}
              className="podcast-mast-icon"
              onClick={toggleSheet}
              ref={toggleRef}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  d={expanded ? "M4.2 9.6 8 5.8l3.8 3.8" : "M4.2 6.4 8 10.2l3.8-3.8"}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
            <button
              aria-label={`Open ${episode.title} at ${episode.sourceName} — opens the official page`}
              className="podcast-mast-icon"
              onClick={() => void openOfficial()}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5">
                  <path d="M6 3.4H3.4v9.2h9.2V10" />
                  <path d="M9.4 3.4h3.2v3.2M12.6 3.4 7.4 8.6" />
                </g>
              </svg>
            </button>
            <button
              aria-label={`Stop ${episode.title} and close the player`}
              className="podcast-mast-icon"
              onClick={stopPodcast}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
              </svg>
            </button>
          </header>

          {/* Open, the dock says the two things the corner had to truncate: the
              whole title, and how long the thing actually is. */}
          {/* Shut, the sheet keeps its height but leaves the document: it is
              clipped to nothing, so a chapter a reader cannot see is a chapter
              they must not be able to Tab into either. */}
          <div className="podcast-sheet" inert={!expanded} ref={sheetRef}>
            <div className="podcast-sheet-inner">
              <div className="podcast-episode">
                <h2 className="podcast-episode-title" tabIndex={-1}>{episode.title}</h2>
                <p className="podcast-episode-meta">
                  {passage ? `${episodePassageLabel(passage, bookNames)} · ` : ""}
                  {of > 0 ? formatClock(of) : "length unknown until it loads"}
                </p>
              </div>

              {chapters.length > 0 && (
                <ul aria-label="Chapters" className="podcast-chapters">
                  {chapters.map((entry, index) => {
                    const entryPassage = readEpisodePassage(entry.bref);
                    return (
                      <li key={entry.start}>
                        <button
                          aria-current={index === chapterIndex}
                          className="podcast-chapter"
                          onClick={() => seekPodcast(entry.start)}
                          type="button"
                        >
                          <span className="podcast-chapter-time">{formatClock(entry.start)}</span>
                          <span className="podcast-chapter-ref">
                            {entryPassage ? chapterSpanLabel(entryPassage) : ""}
                          </span>
                          <span className="podcast-chapter-title">{entry.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Machine transcript. The provenance line is not decoration: the
                  reader has to be able to tell at a glance that no person wrote
                  this, because some of the words in it will be wrong. */}
              {transcript && lines.length > 0 && (
                <div className="podcast-transcript-block">
                  <div className="podcast-transcript-head">
                    <p className="podcast-transcript-note">
                      Machine transcript · {transcript.model}
                    </p>
                    {!following && (
                      <button
                        className="podcast-transcript-resume"
                        onClick={() => setFollowing(true)}
                        type="button"
                      >
                        Follow along
                      </button>
                    )}
                  </div>
                  <ul
                    aria-label="Transcript"
                    className="podcast-transcript"
                    onWheel={() => setFollowing(false)}
                    onTouchMove={() => setFollowing(false)}
                  >
                    {lines.map((line, index) => (
                      <li
                        key={`${line.s}-${index}`}
                        ref={index === lineIndex ? activeLineRef : undefined}
                      >
                        <button
                          aria-current={index === lineIndex}
                          className="podcast-transcript-line"
                          data-spoken={line.s <= position}
                          onClick={() => seekPodcast(line.s)}
                          type="button"
                        >
                          <span className="podcast-transcript-time">{formatClock(line.s)}</span>
                          <span className="podcast-transcript-text">{line.t}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="podcast-dock-body">
            <div className="podcast-transport" role="group" aria-label="Playback">
              <button
                aria-label="Back 15 seconds"
                className="podcast-transport-skip"
                onClick={() => skipPodcast(-15)}
                type="button"
              >
                <SkipGlyph seconds={-15} />
              </button>
              <button
                aria-label={`${paused ? "Play" : "Pause"} ${episode.title}`}
                aria-pressed={!paused}
                className="podcast-transport-play"
                onClick={togglePodcast}
                type="button"
              >
                <PlayGlyph paused={paused} />
              </button>
              <button
                aria-label="Forward 30 seconds"
                className="podcast-transport-skip"
                onClick={() => skipPodcast(30)}
                type="button"
              >
                <SkipGlyph seconds={30} />
              </button>
            </div>
            <div className="podcast-dock-lines">
              {expanded && chapter ? (
                /* Open, the title is already set above, so this line names the
                   span instead of repeating it. */
                <p className="podcast-dock-now" title={chapter.title}>
                  {(() => {
                    const span = readEpisodePassage(chapter.bref);
                    return span ? <span className="podcast-dock-now-ref">{chapterSpanLabel(span)}</span> : null;
                  })()}
                  <span className="podcast-dock-now-title">{chapter.title}</span>
                </p>
              ) : (
                <p className="podcast-dock-title" title={episode.title}>{episode.title}</p>
              )}
              {status === "failed" ? (
                /* Name the thing, the reason, and whether it was ours to fix.
                   The thing is named on the line above and the publisher on the
                   line above that, so this states only what those two do not:
                   it did not arrive, and the reason is not on this machine. The
                   way out is the link that was always beside play. */
                <p className="podcast-dock-refusal">
                  Could not reach the episode. This needed the network.
                </p>
              ) : (
                <p className="podcast-dock-clock">
                  <span>{formatClock(position)}</span>
                  <button
                    aria-label={`Playback speed ${rate}×. Press to change.`}
                    className="podcast-rate"
                    onClick={cycleRate}
                    type="button"
                  >
                    {rate}×
                  </button>
                  <span className="podcast-dock-clock-rest">
                    {of > 0 ? `−${formatClock(of - position)}` : "—:—"}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="podcast-rail">
            {/* One loading device in this app, and it is a segment travelling a
                rule. The rail is already a rule, so it says "reaching the
                publisher" without a second device appearing to say it. */}
            {status === "reaching" && of <= 0 && <span aria-hidden="true" className="podcast-rail-reaching" />}
            {of > 0 && chapters.map((entry) => (
              <span
                aria-hidden="true"
                className="podcast-rail-tick"
                key={entry.start}
                style={{ left: `${Math.min(100, (entry.start / of) * 100)}%` }}
              />
            ))}
            <input
              aria-label="Seek"
              aria-valuetext={`${formatClock(position)} of ${of > 0 ? formatClock(of) : "an unknown length"}`}
              className="podcast-scrub"
              disabled={of <= 0}
              max={Math.max(1, Math.floor(of))}
              min={0}
              onBlur={commitScrub}
              onChange={(event) => setScrubbingAt(Number(event.target.value))}
              onKeyUp={commitScrub}
              onLostPointerCapture={commitScrub}
              onPointerUp={commitScrub}
              step={1}
              type="range"
              value={Math.floor(position)}
            />
          </div>
        </section>
      )}
    </>
  );
}
