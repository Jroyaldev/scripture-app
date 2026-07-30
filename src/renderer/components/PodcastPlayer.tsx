import type React from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BookNameData } from "../api.js";
import type { Transcript } from "../../core/transcripts.js";
import { readingLines } from "../../core/transcripts.js";
import type { PassageReference, ReferenceSet } from "../../core/references.js";
import { passingIn, subjectsOf } from "../../core/references.js";
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
 * Still the publisher's slot. An episode arriving with its own chapters — a
 * `podcast:chapters` tag or ID3 CHAP frames — keeps them, because a publisher
 * saying where their own passage is beats anything we work out afterwards.
 *
 * What we work out ourselves is no longer squeezed through this shape. It lives
 * in `src/core/references.ts`, because a reference carries things a chapter
 * marker has nowhere to put: whether the passage is the subject or merely
 * touched, how long the discussion runs, whether it was named aloud at all, and
 * the words that justify the claim. Those distinctions are the product; folding
 * them into {start, bref, title} would have thrown them away to reuse a type.
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
  /**
   * Where to begin, in seconds.
   *
   * Set when an episode is opened from a passage rather than from its card: a
   * reader who pressed "eleven minutes on Romans 8" asked for that discussion,
   * not for the top of a ninety-minute file. Absent, playback starts where it
   * always did.
   */
  startAt?: number;
}

/**
 * Marks the searched-for run inside a line.
 *
 * Split on the needle rather than replaced with markup: the text goes into the
 * DOM as text either way, so a line containing angle brackets or an ampersand
 * cannot become anything but the characters it is.
 */
function highlight(text: string, needle: string): React.ReactNode {
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    cursor = at + needle.length;
  }
  parts.push(text.slice(cursor));
  return parts;
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
 * What became of a seek.
 *
 * The caller has to be able to tell these apart, because the one thing this
 * surface must never do is draw a confident "we went there" over a press that
 * went nowhere. `queued` is not a failure — the file simply has not said how
 * long it is yet, and the moment is held until it does. `refused` is the only
 * answer that means nothing will happen.
 */
export type PodcastSeek = "moved" | "queued" | "refused";

/** A seek asked for before the element could take one. */
let pendingSeek: number | null = null;

/**
 * How many times the playhead has been MOVED, as opposed to having run.
 *
 * The dock is not the only thing that can seek: a moment pressed in the margin
 * for the episode already playing goes straight through `playPodcastEpisode`,
 * and the system's own transport can arrive from outside React entirely. All
 * of them are the same statement — "I want to be here" — and all of them have
 * to put the transcript back under the voice, so the rule lives on the count
 * rather than on each of the callers that could forget it.
 */
let seekMark = 0;
const seekWatchers = new Set<() => void>();

function subscribeSeek(watcher: () => void): () => void {
  seekWatchers.add(watcher);
  return () => { seekWatchers.delete(watcher); };
}

/** Rises once per press that moves the playhead. Never on a timeupdate. */
export function usePodcastSeekMark(): number {
  return useSyncExternalStore(subscribeSeek, () => seekMark);
}

/**
 * Spend a held seek, once the element knows how long the file is.
 *
 * With `preload="none"` there is a real window — the whole of "reaching" —
 * where `duration` is NaN and a currentTime assignment is discarded by the
 * element. Every press in that window used to be a silent no-op: no movement,
 * no acknowledgement, and in `goToMoment`'s case a confident-looking "we went
 * there" over a playhead still sitting at the top of the episode. They are
 * held here instead and spent the moment they can be.
 */
function applyPendingSeek(): void {
  const element = transport;
  if (pendingSeek == null || !element || !Number.isFinite(element.duration)) return;
  const target = Math.min(pendingSeek, element.duration);
  pendingSeek = null;
  element.currentTime = target;
  announceElapsed(target, element.duration);
}

/**
 * The rate the reader chose, held here rather than only on the element.
 *
 * The element forgets: the media load algorithm resets `playbackRate` to
 * `defaultPlaybackRate` on every new source, so a dock that remembered 1.5×
 * across an episode change was reading 1.5× over a file playing at 1×. Setting
 * both properties is what makes the reader's choice survive the next episode,
 * and `preservesPitch` is set on the same pass — including at 1×, where it was
 * previously never set at all.
 */
let podcastRate = 1;

function applyPodcastRate(): void {
  const element = transport;
  if (!element) return;
  element.preservesPitch = true;
  element.defaultPlaybackRate = podcastRate;
  element.playbackRate = podcastRate;
}

/**
 * Press play on an episode. The one element is re-pointed rather than joined by
 * a second: two voices at once is never what anyone meant, and a per-card
 * element would have made that the default.
 *
 * A moment named with the episode is honoured even when that episode is
 * already the one running. Both surfaces that press this key it identically —
 * `${sourceId}:${recordId}` — so "eleven minutes on Romans 8", pressed while
 * the same episode plays from its own card or from another chapter's list,
 * fell through to the pause branch and stopped it. That is the opposite of the
 * request. A press carrying a moment is a request to HEAR that moment; only a
 * press with no moment on it is a toggle.
 */
export function playPodcastEpisode(episode: PodcastEpisode): void {
  const element = transport;
  if (!element) return;
  if (nowPlaying.episode?.id === episode.id) {
    if (episode.startAt == null) {
      togglePodcast();
      return;
    }
    seekPodcast(episode.startAt);
    resumePodcast();
    return;
  }
  /* Held rather than listened for: the same queue every other early seek on
     this surface goes through, so there is one answer to "the file is not
     ready yet" instead of two that can drift apart. */
  pendingSeek = episode.startAt != null && episode.startAt > 0 ? episode.startAt : null;
  element.src = episode.audioUrl;
  applyPodcastRate();
  announceElapsed(episode.startAt ?? 0, 0);
  announceNowPlaying({ episode, status: "reaching" });
  void element.play().catch(() => announceNowPlaying({ episode, status: "failed" }));
}

/** Start the file, if it is not already running. */
export function resumePodcast(): void {
  const element = transport;
  const episode = nowPlaying.episode;
  if (!element || !episode || !element.paused) return;
  // An episode that reached its end restarts. A bare play() there resolves
  // against a finished element and leaves the reader pressing a dead button.
  if (element.ended && pendingSeek == null) element.currentTime = 0;
  announceNowPlaying({ episode, status: "reaching" });
  void element.play().catch(() => announceNowPlaying({ episode, status: "failed" }));
}

/** Stop the file where it is, without letting go of it. */
export function pausePodcast(): void {
  if (transport && !transport.paused) transport.pause();
}

export function togglePodcast(): void {
  const element = transport;
  if (!element || !nowPlaying.episode) return;
  if (!element.paused) {
    element.pause();
    return;
  }
  resumePodcast();
}

/** Move to a second in the file, clamped to it. */
export function seekPodcast(seconds: number): PodcastSeek {
  const element = transport;
  if (!element || !nowPlaying.episode) return "refused";
  const target = Math.max(0, seconds);
  seekMark += 1;
  for (const watcher of seekWatchers) watcher();
  if (!Number.isFinite(element.duration)) {
    pendingSeek = target;
    /* The clock says where the press is taking us rather than where we were.
       A reader who asked for 42:17 and is shown 0:00 has been told the press
       failed, and it has not. */
    announceElapsed(target, 0);
    return "queued";
  }
  pendingSeek = null;
  const clamped = Math.min(target, element.duration);
  element.currentTime = clamped;
  announceElapsed(clamped, element.duration);
  return "moved";
}

/** Back or forward by an interval, from wherever the file actually is. */
export function skipPodcast(seconds: number): PodcastSeek {
  const element = transport;
  if (!element) return "refused";
  /* A held seek is where the file is going, so two skips before the metadata
     lands add up instead of both measuring from 0:00. */
  return seekPodcast((pendingSeek ?? element.currentTime) + seconds);
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
  podcastRate = rate;
  applyPodcastRate();
}

/**
 * Stop, and let go of the publisher's file. Closing the dock is the reader
 * saying they are done with it: the connection closes with the dock rather than
 * idling open on a server that is not ours.
 */
export function stopPodcast(): void {
  pendingSeek = null;
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
 * The app's one play affordance, drawn once and consumed by everything that
 * starts audio: the dock's transport and the resource card's row today, and the
 * TaughtHere margin rows when Build 3 merges that surface — they start audio
 * with no transport glyph at all. A consumer sets `--transport-size` and passes
 * a label; nothing else about it is theirs to decide.
 *
 * Play is optically centred, not geometrically. A right-pointing triangle
 * carries its mass at the base, so centring its bounding box leaves it sitting
 * visibly left of the circle it is in. Its centroid — a third of the way from
 * base to apex — is what has to land on centre: (8 + 8 + 20) / 3 = 12, which is
 * this box's own centre. Pause is symmetrical about the same 12, so the two
 * states do not shift under the pointer.
 *
 * The card's copy of this glyph never received that correction — `M4.6 2.8
 * 12.6 8l-8 5.2z` on a 16-box puts the centroid at 7.27 against a centre of 8,
 * so play and pause shifted 0.73px under the pointer twenty pixels from the
 * dock whose comment claimed to have fixed exactly that. There is one glyph
 * now, so it cannot happen again.
 *
 * Both paths are always in the tree and one of them is on. The state they mark
 * is a voice already in motion, and a hard swap on the loudest control of such
 * a surface reads as a fault in the audio — see --transport-quick at :root.
 */
export function TransportPlayButton({
  className,
  label,
  onPress,
  paused,
  pressed,
}: {
  className?: string;
  label: string;
  onPress: () => void;
  paused: boolean;
  pressed?: boolean;
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={className ? `transport-play ${className}` : "transport-play"}
      data-glyph={paused ? "play" : "pause"}
      onClick={onPress}
      type="button"
    >
      <svg className="transport-glyph transport-glyph-play" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4.53 20 12 8 19.47z" fill="currentColor" />
      </svg>
      <svg className="transport-glyph transport-glyph-pause" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.47 4.53h3.47v14.94H7.47zM13.07 4.53h3.47v14.94h-3.47z" fill="currentColor" />
      </svg>
    </button>
  );
}

/**
 * An arrow bent round the interval it moves, with the interval beside it —
 * which is to say, in the document rather than inside the glyph.
 *
 * Ring r 8.2 on a 24 box, broken by a 40° gap about vertical. The head seats
 * inward by (half − stroke/2), which puts its outer corner exactly on the
 * ring's outer edge: centred on the path it throws a barb past the stroke, and
 * set back off the path it exposes the stroke's round cap as a spur. Seated, it
 * can be large enough to read at 20px without doing either. Forward is the same
 * path mirrored, so the pair cannot drift apart.
 *
 * The number used to be a <text> element inside this SVG at `fontSize="9.4"` —
 * the only place in the app that set type inside an icon. It was scaled by the
 * viewBox rather than by the type scale, it was subject to font loading inside
 * a glyph, and it could inherit nothing. It is the same number in the same
 * face; it is a text node now, laid over the ring by the button's own grid.
 * Stroke and cap come from the surface's one icon grammar — see
 * styles/player.css, where a 24 grid at 1.25 with `non-scaling-stroke` replaces
 * three grids, five rendered sizes and three stroke weights.
 */
function SkipGlyph({ back }: { back: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g transform={back ? undefined : "scale(-1 1) translate(-24 0)"}>
        <path d="M9.20 4.29A8.2 8.2 0 1 0 14.80 4.29" stroke="currentColor" />
        <path d="M5.47 7.51L8.94 3.59L10.65 8.29Z" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Back or forward, with its interval. One geometry, mirrored, twice. */
function SkipButton({
  label,
  onPress,
  seconds,
}: {
  label: string;
  onPress: () => void;
  seconds: number;
}): React.JSX.Element {
  return (
    <button aria-label={label} className="transport-skip" onClick={onPress} type="button">
      <SkipGlyph back={seconds < 0} />
      <span aria-hidden="true" className="transport-skip-count">{Math.abs(seconds)}</span>
    </button>
  );
}

/**
 * What the transcript is doing, as one state rather than a boolean with
 * patches on it.
 *
 * `following` used to mean two things at once — "the list may move itself" and
 * "the reader is at the playhead" — and those come apart the instant anyone
 * searches. That is why the Follow pill's guard had to grow a `!searching`
 * clause, and why the autoscroll effect never learned about searching at all:
 * a filtered list yanked itself under the reader's cursor whenever the line
 * being spoken happened to be one of the hits. One state cannot be in two of
 * these at once, so neither can happen.
 *
 *   following  the list moves itself to the voice. The resting state, and
 *              where every seek and every clearing of the box puts it back.
 *   browsing   the reader moved the list themselves; it stays where they left
 *              it, and offers itself back rather than resuming on its own.
 *   searching  a filter is up. The list is the answer to a question, not the
 *              episode, so nothing may scroll it but the reader.
 */
type TranscriptMode = "following" | "browsing" | "searching";

/**
 * How far either side of the voice the depth ramp is drawn.
 *
 * The box shows fewer than four lines, so three either side is already more
 * than anyone can see it on — and it used to be a prop on every line, which
 * made the entire list a function of the playhead. See the ladder effect.
 */
const LADDER_REACH = 3;

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
  /* Read by the ResizeObserver below, which is not a render and cannot close
     over state. */
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  /* undefined while unasked or in flight, null once we know there is none.
     The distinction matters: "no transcript" is a fact worth drawing, and
     "not looked yet" must not be drawn as that fact. */
  const [transcript, setTranscript] = useState<Transcript | null | undefined>(undefined);
  const listRef = useRef<HTMLUListElement>(null);
  const [mode, setMode] = useState<TranscriptMode>("following");
  const [query, setQuery] = useState("");
  /* One view at a time. Stacking the passage lists above the transcript let
     them take whatever height they wanted and gave a reader no way to put them
     away — on an episode with fifteen references the transcript was pushed off
     the bottom of a sheet that has no scroll of its own. */
  const [wantedView, setView] = useState<"transcript" | "passages">("transcript");
  /* undefined while unasked, null once we know there are none. */
  const [refs, setRefs] = useState<ReferenceSet | null | undefined>(undefined);
  /* Read off the element rather than chosen alongside it. The dock used to
     hold an index into PODCAST_RATES and the element used to hold a rate, and
     an episode change reset one of them — so the label said 1.5× about a file
     playing at 1×. Now the label IS the element's rate: `ratechange` is the
     only thing that writes it, and nothing else can make the two disagree. */
  const [rate, setRate] = useState(1);
  /* One quiet channel for the machine's own words: following stopping and
     starting, where a press landed, how many lines said it. */
  const [notice, setNotice] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  /* Until when a scroll on the transcript is ours rather than the reader's.
     See the follow effect and onTranscriptScroll. */
  const selfScrollUntil = useRef(0);
  /* The list the follow effect last placed, so a fresh one can be placed
     rather than animated across an hour of transcript. */
  const scrolledList = useRef<HTMLUListElement | null>(null);
  /* The handful of elements currently carrying the depth ramp, so the next
     pass knows exactly what to take it back off. */
  const ladderRef = useRef<HTMLElement[]>([]);
  const panelBaseId = useId();

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
  const dockBoxRef = useRef<HTMLElement>(null);

  /**
   * Publish the height the dock RESERVES, so the study panel stops above it
   * exactly — and does not move again.
   *
   * `--podcast-dock-h` was a constant, 138px, and the dock has never been one
   * height: it grows for a chapter line, again while peeking, and to several
   * hundred pixels when the sheet is open. The panel was shortened by a guess,
   * so the gap under it was right in one state and wrong in every other.
   *
   * Measured with a ResizeObserver rather than from state, because the height
   * changes for reasons this component does not own — a long episode title
   * wrapping, a font finishing loading, the window narrowing.
   *
   * Dated 2026-07-30: it is the COLLAPSED height that is published, which is
   * the whole box less the sheet. The measurement was right and the consequence
   * was violent — the study panel reserves this number as its floor and the
   * toast lane steps over it, so opening the sheet shortened the panel by
   * several hundred pixels and relocated every toast, in one 300ms grid
   * transition, mid-scroll, with nothing damping either.
   *
   * The alternative was to reserve the OPEN height always, which is several
   * hundred pixels of empty panel for a sheet that is usually shut. So the
   * reservation is made once, against the thing that is always there, and the
   * sheet is an overlay above it: the dock is bottom-pinned, so it opens upward
   * over the panel rather than through it. Nothing outside this surface moves
   * when the sheet opens, which is what makes it a place rather than a
   * disclosure.
   *
   * Written to the shell rather than to :root, so a second player could never
   * write over the first one's number.
   */
  useEffect(() => {
    const box = dockBoxRef.current;
    const shell = box?.closest<HTMLElement>(".app-shell");
    if (!box || !shell) return undefined;
    const publish = (): void => {
      /* Measured only while the sheet is SHUT, rather than measured always and
         corrected by subtracting the sheet. Two reasons, and the second is why
         the guard reads the state rather than the sheet's height:

         The whole box and the sheet are fractional rects, so `round(whole −
         sheet)` lands on 143 in one state and 142 in the other, and the panel
         below twitches by a pixel every time the sheet opens.

         And the collapsed dock is genuinely a pixel shorter while the sheet is
         open — the corner stops repeating a title the sheet is already showing,
         which takes a line out of the lines column and changes what the body's
         row height rounds from. Gated on the sheet's measured height, the first
         frame after the toggle has the new body and a sheet still at zero, and
         publishes the 142. Gated on the state, it cannot.

         Holding the last shut measurement is also the honest statement of what
         this number IS: what the dock reserves, which is what it takes up when
         nobody is reading it. */
      if (expandedRef.current) return;
      shell.style.setProperty(
        "--podcast-dock-h",
        `${Math.round(box.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(box);
    if (sheetRef.current) observer.observe(sheetRef.current);
    return () => {
      observer.disconnect();
      /* Back to the sheet's own value when the player leaves, rather than
         leaving the last measured height behind as a floor nothing stands on. */
      shell.style.removeProperty("--podcast-dock-h");
    };
  }, [episode?.id]);

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
     focus moves here — nothing was pressed.

     The lens over the episode goes with it, for the same reason and by the
     same argument. A query typed against episode A, the follow state A was
     left in, and the view A was last read in are not facts about B — and
     because the sheet is handed back closed, none of them was even visible:
     a reader opened B and found a stranger's search in the box, B's transcript
     filtered by A's word, and the Passages tab up on an episode that has no
     passages. Three states that outlived their subject, all of them arguing
     against themselves in the comment above. */
  const episodeId = episode?.id;
  useEffect(() => {
    setExpanded(false);
    setPeeking(false);
    setQuery("");
    setMode("following");
    setView("transcript");
    setNotice("");
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
  }, [episodeId]);

  /* Asked once per episode, not per open. A reader who opens and shuts the
     sheet is not asking the disk anything new, and the answer for an episode
     does not change while it is playing. */
  useEffect(() => {
    if (!episode) { setTranscript(undefined); setRefs(undefined); return; }
    let live = true;
    setTranscript(undefined);
    setRefs(undefined);
    void window.api.transcripts.load(episode.recordId).then((result) => {
      if (!live) return;
      setTranscript(result.ok ? result.transcript : null);
    }).catch(() => { if (live) setTranscript(null); });
    void window.api.references.load(episode.recordId).then((result) => {
      if (!live) return;
      setRefs(result.ok ? result.references : null);
    }).catch(() => { if (live) setRefs(null); });
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
  /* Dated 2026-07-30. This was `status !== "playing" && status !== "reaching"`,
     so while the dock was still reaching for a file it had not received the
     loudest control on the surface drew PAUSE — claiming the episode was
     running — over a clock reading 0:00 / —:—. Reaching is not playing. The
     glyph stays play, the press cancels, and what is actually happening is said
     in words on the clock's own line. */
  const paused = status !== "playing";
  /* Reaching WITH nothing known about the file yet, which is the only version
     of it a reader can be told anything useful about: a resume mid-episode
     passes through `reaching` with a duration already in hand, and swapping the
     clock out for a sentence there would be a flicker rather than a state. The
     rail's travelling segment is gated on the same pair. */
  const reaching = status === "reaching" && of <= 0;
  const following = mode === "following";
  const needle = query.trim().toLowerCase();
  const searching = mode === "searching";

  /* Every seek re-engages following, wherever the seek came from — the dock's
     own controls do it on the way past, and this catches the two that cannot:
     a moment pressed in the margin for the episode already playing, and the
     system's Now Playing scrubber. Same statement, same answer. */
  const seekMark = usePodcastSeekMark();
  const lastSeekMark = useRef(seekMark);
  useEffect(() => {
    if (lastSeekMark.current === seekMark) return;
    lastSeekMark.current = seekMark;
    setQuery("");
    setMode("following");
  }, [seekMark]);

  /* Two lists, because they are two different claims. What an episode works
     THROUGH is what a reader chooses an episode for; what it merely touches is
     what a reader searching a passage wants to find. Collapsing them into one
     list of hits would say neither, and ordering them together would rank a
     one-line aside beside a twenty-minute exposition.

     A publisher's own chapters still win where they exist — the dock keeps
     drawing those instead, because a publisher saying where their own passage
     is beats us reading it out of a transcript. */
  const subjects: PassageReference[] = refs ? subjectsOf(refs) : [];
  const passing: PassageReference[] = refs ? passingIn(refs) : [];

  /* Choosing a place in the episode is a request to HEAR it, not to read about
     it. So the press does the whole errand: move the audio, put the transcript
     back under the voice, and take away whatever lens was over it — landing a
     reader in the passage list they just left, or inside the filter they just
     chose from, with the words scrolling somewhere behind them, would make
     them do the last two steps themselves every time.

     That was written for passage rows and applied to passage rows alone. It is
     the same request from a transcript line, a chapter row, a skip and a
     scrub, so every seek on this dock is now this one function. The two things
     that differ are named rather than assumed: `hear`, because a press on a
     PLACE is a request for the voice and a press on the transport is not — a
     reader stepping a paused episode forward asked to move, not to listen —
     and `show`, because a row lives in the other view and a skip does not, so
     only the row has a reason to bring the transcript back. */
  const goTo = (seconds: number, { hear, show }: { hear: boolean; show: boolean }): void => {
    /* Nothing is claimed over a seek that will not happen. `queued` will
       happen, the moment the file says how long it is, so it counts. */
    if (seekPodcast(seconds) === "refused") return;
    if (hear) resumePodcast();
    setQuery("");
    setMode("following");
    if (show) setView("transcript");
    setNotice(following
      ? `Jumped to ${formatClock(seconds)}.`
      : `Jumped to ${formatClock(seconds)}, following again.`);
  };

  const goToMoment = (seconds: number): void => goTo(seconds, { hear: true, show: true });
  /* Already in the transcript, so there is nothing to come back to — but a
     line pressed while the episode is paused starts it, because a reader who
     points at a sentence is asking to hear that sentence and every reference
     implementation on the desk answers a tap that way. */
  const goToLine = (seconds: number): void => goTo(seconds, { hear: true, show: false });

  const skipBy = (seconds: number): void => {
    if (skipPodcast(seconds) === "refused") return;
    setQuery("");
    setMode("following");
    /* The element's own clock is the one that moved; this is the same number
       to within a tick, and it is the only one this closure can see. */
    const landed = formatClock(Math.max(0, position + seconds));
    setNotice(following ? `Jumped to ${landed}.` : `Jumped to ${landed}, following again.`);
  };

  const commitScrub = (): void => {
    if (scrubbingAt == null) return;
    const target = scrubbingAt;
    setScrubbingAt(null);
    goTo(target, { hear: false, show: false });
  };

  /* The one way the query changes, so the mode cannot drift away from it: a
     box with words in it IS the searching state, and an empty box is not some
     third thing that has to be reconciled afterwards. */
  const askFor = (next: string): void => {
    setQuery(next);
    setMode(next.trim() ? "searching" : "following");
  };

  /* The way back to the voice, from either place a reader can be standing.
     Clearing the box is not enough on its own — a reader who searched,
     scrolled, and then cleared would be left parked wherever they had wandered
     to, with the audio elsewhere. */
  const followAgain = (): void => {
    const hadQuery = needle.length > 0;
    setQuery("");
    setMode("following");
    setNotice(hadQuery
      ? "Search cleared. Following the episode again."
      : "Following the episode again.");
  };

  /* Every way the reader can move this list, in one event.

     It used to be `onWheel` and `onTouchMove`, which is neither the whole set
     nor a correct member of it. Wheel fires at the scroll extent where nothing
     moves, and trackpad momentum keeps firing for a second after the fingers
     lift, so idle wheeling silently ended following; touchmove fires on the
     two-pixel drift of an ordinary tap, so on touch EVERY press of a line
     stopped following a beat before it seeked. And between them they missed
     keyboard scrolling, focus scrolling, and a screen reader's virtual cursor
     walking the list — which is why an assistive-technology reader had no way
     out of the autoscroll at all.

     A scroll event is the one thing all of those have in common and the tap
     does not. The only scrolls that are not the reader's are ours, and those
     are announced in advance by the follow effect. */
  const onTranscriptScroll = (): void => {
    if (mode !== "following") return;
    if (performance.now() < selfScrollUntil.current) return;
    setMode("browsing");
    setNotice("Following paused.");
  };

  /* The seek handlers, always the current ones.

     Two callers hold onto them across renders: the transcript list, which is
     memoized on its own content and so keeps whichever render built it, and
     the system transport, whose handlers are registered once per episode. The
     seek itself would survive being stale — the setters never change — but
     what is SAID about it does not: whether a press resumed following is a
     fact about where the reader was standing when they pressed, and that has
     to be read now rather than remembered. */
  const latest = useRef({ line: goToLine, skip: skipBy, seek: goTo });
  useEffect(() => {
    latest.current = { line: goToLine, skip: skipBy, seek: goTo };
  });

  const chapters: PodcastChapter[] = episode?.chapters ?? [];
  const chapterIndex = chapters.reduce(
    (found, chapter, index) => (position >= chapter.start ? index : found),
    -1,
  );
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : undefined;

  /* The active line is found the same way the active chapter is: the last span
     that has started. Binary search would be tidier over 1,400 lines, but this
     runs on a timeupdate tick against an already-sorted array, and the loader
     sorts precisely so this scan can be trusted. */
  /* The recogniser's segments are shaped by breathing, not by reading; these
     are rebuilt from its words to a length the eye takes in one go. Done once
     per transcript rather than per tick. */
  const lines = useMemo(
    () => (transcript ? readingLines(transcript.words) : []),
    [transcript],
  );
  const lineIndex = lines.reduce(
    (found, line, index) => (position >= line.s ? index : found),
    -1,
  );

  /* Searching narrows to the lines that say it. Highlighting in place was the
     alternative and it is worse here: a hit fourteen screens down is invisible,
     and the reader would be scrolling a transcript looking for their own
     search. Narrowing turns the panel into the answer. */
  const found = useMemo(() => (needle
    ? lines.map((line, index) => ({ line, index })).filter(({ line }) => line.t.toLowerCase().includes(needle))
    : lines.map((line, index) => ({ line, index }))),
  [lines, needle]);
  const matches = found.length;

  /* No playhead the ramp could be measured from: a search answers a question
     rather than tracking a voice, and before the first line has been spoken
     there is nothing to be near. Either way every line sits at the same
     readable weight instead of pretending to a distance from a voice that is
     not in the list. */
  const flatWeight = searching || lineIndex < 0;

  /* Built once per episode and once per query, and never again.

     It used to be keyed on the active line as well, which the comment here
     defended as a saving — 2,280 elements reconciled once a line instead of
     four times a second. It is a saving and it is still 2,280 elements every
     four seconds for the length of an episode, in a sheet that is usually shut,
     because the list mounts when the episode starts rather than when anyone
     asks to read it. Both halves are fixed: the block below renders only while
     the sheet is open, and everything that is a function of the playhead has
     moved out of the tree and into the ladder effect, which touches seven
     elements. */
  const renderedLines = useMemo(() => found.map(({ line, index }) => (
    <li key={`${line.s}-${index}`}>
      <button
        className="podcast-transcript-line"
        data-line={index}
        onClick={() => latest.current.line(line.s)}
        /* Every line starts out of the tab order and exactly one is put back
           into it by the roving effect below. Written as a static -1 here
           rather than a computed 0/-1 so this list stays a function of its own
           content: a tabindex that depended on the playhead would put all 2,280
           elements back into the render, which is the thing Build 1 took them
           out of. */
        tabIndex={-1}
        type="button"
      >
        {needle ? highlight(line.t, needle) : line.t}
      </button>
    </li>
  )), [found, needle]);

  /* ── One tab stop for the whole transcript ────────────────────────────────
     A two-hour episode is 2,280 buttons, and every one of them was a tab stop:
     reaching the Follow pill, the search box or anything below the list by
     keyboard meant 2,280 presses. This is the same roving pattern the tab strip
     and the study line use — the list holds one stop, and the arrows travel it.

     Written to the DOM by hand, for the same reason the depth ramp is: as a
     prop it would make the list a function of the playhead again. The stop
     rests on the line being spoken where there is one, so a reader who tabs in
     arrives at the voice rather than at the top of an hour of transcript. */
  const rovingRef = useRef<HTMLElement | null>(null);
  const setRoving = (next: HTMLElement | null): void => {
    if (rovingRef.current === next) return;
    rovingRef.current?.setAttribute("tabindex", "-1");
    next?.setAttribute("tabindex", "0");
    rovingRef.current = next;
  };

  useLayoutEffect(() => {
    const box = listRef.current;
    if (!box) { rovingRef.current = null; return; }
    /* Still in the list? A new query rebuilds every element, so the one holding
       the stop is usually gone. */
    if (rovingRef.current?.isConnected && box.contains(rovingRef.current)) return;
    rovingRef.current = null;
    const atVoice = lineIndex >= 0
      ? box.querySelector<HTMLElement>(`.podcast-transcript-line[data-line="${lineIndex}"]`)
      : null;
    setRoving(atVoice ?? box.querySelector<HTMLElement>(".podcast-transcript-line"));
  }, [expanded, lineIndex, renderedLines]);

  /* Arrows travel, Home and End jump, and the stop follows focus. Focus is
     moved without the browser's own scroll and then placed by hand, because
     `.podcast-transcript` sets `scroll-behavior: smooth` and a focus scroll
     would animate — under the pointer, at the moment the reader is trying to
     land on a line. Landing on a line is a scroll the reader started, so
     following stops, which is the intended answer. */
  const onLineKeys = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const box = listRef.current;
    if (!box) return;
    const lines = [...box.querySelectorAll<HTMLElement>(".podcast-transcript-line")];
    if (lines.length === 0) return;
    const at = lines.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? lines.length - 1
        : event.key === "ArrowUp" ? Math.max(0, at - 1)
          : Math.min(lines.length - 1, at < 0 ? 0 : at + 1);
    const target = lines[next];
    if (!target) return;
    event.preventDefault();
    setRoving(target);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: "instant" });
  };

  /* The depth ramp, written onto the seven elements it can be seen on.

     Distance from the voice is still one subtraction, and it is still computed
     here rather than chained through CSS sibling selectors — but it is written
     to the DOM by hand instead of being a prop, because as a prop it made the
     whole list a function of the playhead. The ramp reaches three lines either
     side; the box shows fewer than four; so three either side is everything
     anyone can ever see it on, and the pass is: take it off whatever had it,
     put it on whatever should.

     Dated 2026-07-30 — what changed for a reader: lines further away than the
     ramp reaches no longer blur. They used to all carry data-d="3", which is
     `filter: blur(1.9px)`, so a two-hour episode drew ~2,274 blur surfaces to
     shade a four-line window. Blur said "just behind the voice"; a line twenty
     minutes from the voice is not behind it, it is elsewhere, and the
     stylesheet now says that in one flat rule with no filter in it. */
  useLayoutEffect(() => {
    const lit = ladderRef.current;
    for (const element of lit) {
      element.removeAttribute("data-d");
      element.removeAttribute("data-past");
      element.removeAttribute("aria-current");
    }
    lit.length = 0;
    const box = listRef.current;
    if (!box || flatWeight) return;
    for (let step = -LADDER_REACH; step <= LADDER_REACH; step += 1) {
      const at = lineIndex + step;
      if (at < 0) continue;
      const line = box.querySelector<HTMLElement>(`.podcast-transcript-line[data-line="${at}"]`);
      if (!line) continue;
      line.setAttribute("data-d", String(Math.abs(step)));
      /* Already spoken lines sit a little clearer than the ones still coming
         at the same distance; scrolling back should meet text, not fog. */
      line.setAttribute("data-past", String(step < 0));
      if (step === 0) line.setAttribute("aria-current", "true");
      lit.push(line);
    }
  }, [expanded, flatWeight, lineIndex, renderedLines]);

  /* Following is the resting state and stays on until the reader moves the
     list themselves. Dragging someone back to the active line while they are
     reading ahead is the worst thing a transcript can do, so any scroll that
     is not this one is taken as an instruction to stop.

     Which is why this arms the guard before it moves anything, and only when
     it is actually going to move something: an arm for a scroll that never
     happens would deafen the list to the reader for a second out of every
     four, forever. */
  useEffect(() => {
    if (!expanded || !following || lineIndex < 0) return;
    const box = listRef.current;
    const line = box?.querySelector<HTMLElement>(`.podcast-transcript-line[data-line="${lineIndex}"]`);
    if (!box || !line) return;
    const boxBox = box.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const centred = box.scrollTop
      + (lineBox.top - boxBox.top)
      - (box.clientHeight - lineBox.height) / 2;
    const target = Math.max(0, Math.min(centred, box.scrollHeight - box.clientHeight));
    if (Math.abs(target - box.scrollTop) < 2) return;
    /* A list that has just been mounted is not drifting from anywhere — it is
       at the top of a two-hour episode and the voice is forty minutes down, so
       animating there is a smear rather than a movement. The first placement
       on a fresh list is a placement; every one after it is a drift. */
    const placing = scrolledList.current !== box;
    scrolledList.current = box;
    selfScrollUntil.current = performance.now() + 1_000;
    box.scrollTo({
      top: target,
      /* The stylesheet's reduced-motion opt-out cannot reach a behavior passed
         here: an explicit "smooth" beats the computed scroll-behavior by spec,
         and "auto" means "go and ask the computed value" — which is smooth. So
         a vestibular-sensitive reader was given the full smooth autoscroll by
         a rule written specifically to spare them it. The branch has to be
         made in script, and the instant case has to say instant. */
      behavior: placing || window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [expanded, following, lineIndex, renderedLines]);

  /* A rate off the element is a double, so it is printed rather than trusted
     to be one of ours; and a rate that is not one of ours cycles to the first,
     which is 1 — one press always returns to normal. */
  const rateLabel = Number(rate.toFixed(2));
  const cycleRate = (): void => {
    const at = PODCAST_RATES.findIndex((value) => value === rateLabel);
    setPodcastRate(PODCAST_RATES[(at + 1) % PODCAST_RATES.length] ?? 1);
  };

  const navigateTo = (target: EpisodePassage): void => {
    void onNavigate(
      target.book,
      target.chapter,
      target.verse,
      target.endChapter === target.chapter ? target.endVerse : undefined,
    );
  };

  /* What the sheet can show, which is not always what the reader last chose.
     `view` used to be the whole answer and the tab strip needed BOTH lists to
     draw at all, so the two disagreed in both directions: a reader who left
     Passages up and then played one of the ~9% of episodes with no references
     got a sheet holding a title, a length and no control that could reach the
     transcript; and an episode with references whose transcript would not load
     showed no references either, because the strip that names them is drawn
     from the transcript's line count. Neither view depends on the other's data
     now, and a view cannot outlive the thing it names. */
  const hasPassages = subjects.length + passing.length > 0;
  const hasTranscript = lines.length > 0;
  const view = wantedView === "passages" && hasPassages ? "passages"
    : hasTranscript ? "transcript"
      : hasPassages ? "passages"
        : "transcript";
  /* A strip is a choice. With one list there is nothing to choose, and with
     none there is nothing to choose between. */
  const tabbed = hasPassages && hasTranscript;
  const transcriptTabId = `${panelBaseId}-transcript-tab`;
  const passagesTabId = `${panelBaseId}-passages-tab`;
  const panelId = `${panelBaseId}-panel`;
  const tabStripRef = useRef<HTMLDivElement>(null);

  /* Manual activation, deliberately. APG asks for automatic activation only
     where the panel appears without noticeable latency, and the transcript
     panel is two thousand elements — so the arrows move focus and the press
     chooses, which is the pattern's own answer for an expensive panel. */
  const onTabKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...(tabStripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    if (tabs.length === 0) return;
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowLeft" ? (at <= 0 ? tabs.length - 1 : at - 1)
          : (at + 1) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
  };

  /* Held for a beat rather than said on every keystroke: a count announced
     letter by letter is a screen reader reading numbers over the reader's own
     typing. "No line says that" is on this channel too — it was only ever
     drawn, so a reader who could not see it was told nothing at all. */
  useEffect(() => {
    if (!expanded || !searching) return undefined;
    const timer = window.setTimeout(() => {
      setNotice(matches === 0
        ? "No line says that."
        : `${matches} ${matches === 1 ? "line says" : "lines say"} that.`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [expanded, matches, needle, searching]);

  /* The system's own transport.

     macOS Now Playing, the hardware media keys and everything that speaks to
     them go through MediaSession, and without it the only way to pause 3,521
     episodes' worth of audio is to find a 38px circle in the corner of one
     window. The seek actions land on the same errand every seek on this dock
     runs — through the `latest` ref above, so the handlers can be registered
     once per episode instead of once per render.

     No image is offered. The record carries none, and going to find one would
     be a request to a publisher's server that nobody pressed anything to make
     — which is the boundary this whole surface is built around. See
     docs/trusted-resource-permissions. */
  const episodeTitle = episode?.title;
  const episodeSource = episode?.sourceName;
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return undefined;
    if (!episodeTitle) {
      session.metadata = null;
      return undefined;
    }
    session.metadata = new MediaMetadata({ title: episodeTitle, artist: episodeSource });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => resumePodcast()],
      ["pause", () => pausePodcast()],
      ["stop", () => stopPodcast()],
      ["seekbackward", (details) => latest.current.skip(-(details.seekOffset ?? 15))],
      ["seekforward", (details) => latest.current.skip(details.seekOffset ?? 30)],
      ["seekto", (details) => {
        if (details.seekTime != null) latest.current.seek(details.seekTime, { hear: false, show: false });
      }],
    ];
    for (const [action, handler] of handlers) {
      /* An engine that does not know an action throws rather than ignoring it,
         and one unknown action must not cost the other five. */
      try { session.setActionHandler(action, handler); } catch { /* not on this engine */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { session.setActionHandler(action, null); } catch { /* as above */ }
      }
    };
  }, [episodeId, episodeSource, episodeTitle]);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    session.playbackState = !episodeId ? "none" : status === "playing" ? "playing" : "paused";
  }, [episodeId, status]);

  /* Position, at walking pace. The element reports four times a second and the
     system needs no such thing — it interpolates between whatever it was last
     told, so once every five seconds and on every real change is both honest
     and quiet. */
  const positionStep = Math.floor(position / 5);
  useEffect(() => {
    const session = navigator.mediaSession;
    if (typeof session?.setPositionState !== "function") return;
    if (!episodeId || !(of > 0)) { session.setPositionState(); return; }
    session.setPositionState({ duration: of, playbackRate: rate, position: Math.min(position, of) });
    // `position` is deliberately absent: positionStep is the throttle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, of, positionStep, rate, status]);

  return (
    <>
      <audio
        onDurationChange={(event) => {
          applyPendingSeek();
          announceElapsed(event.currentTarget.currentTime, event.currentTarget.duration || 0);
        }}
        onEnded={() => elementReports("paused")}
        onError={() => { if (nowPlaying.episode) announceNowPlaying({ episode: nowPlaying.episode, status: "failed" }); }}
        /* The held seek is spent BEFORE anything is announced. This used to
           announce a flat 0 and let the seek land afterwards, which is a frame
           of 0:00 and a moment of lineIndex 0 for an episode a reader opened
           at eleven minutes in — the top of the file flashing past on the way
           to the place they actually asked for. */
        onLoadedMetadata={(event) => {
          applyPendingSeek();
          announceElapsed(event.currentTarget.currentTime, event.currentTarget.duration || 0);
        }}
        onPause={() => elementReports("paused")}
        onPlaying={() => elementReports("playing")}
        /* The element is the authority on its own rate, so the dock reads it
           here instead of remembering what it asked for. */
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
        onTimeUpdate={(event) => announceElapsed(event.currentTarget.currentTime, event.currentTarget.duration || 0)}
        onWaiting={() => elementReports("reaching")}
        preload="none"
        ref={registerTransport}
      />
      {episode && (
        <section
          aria-label={`Podcast player — ${episode.title}`}
          className="podcast-dock"
          ref={dockBoxRef}
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

          {/* The same pattern one surface down, for the machine rather than
              the transport: following stopping and starting, where a press
              landed, how many lines said it. One channel, throttled at each
              source, so it can be left on. */}
          <span className="sr-only" role="status" aria-live="polite">{notice}</span>

          <header className="podcast-mast">
            {/* The plate: the publisher's own colour at signature size,
                carrying either their approved mark or their name. Both forms
                are one object — see .podcast-mast-plate — and the mark's
                artwork is substituted in styles.css, because a relative url()
                inside a custom property resolves against the stylesheet that
                substitutes it. The name is in the accessibility tree in both
                forms; the mark rule indents the glyphs, not the text. */}
            <span className="podcast-mast-plate">
              <span className="podcast-mast-mark podcast-mast-name">{episode.sourceName}</span>
            </span>
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
              {/* One grid, one stroke. Every glyph on this surface is drawn on
                  a 24 box and takes its stroke from the icon grammar in
                  styles/player.css, where `non-scaling-stroke` makes 1.25 mean
                  1.25 RENDERED pixels at any size. It was three grids (16, 18,
                  24), five rendered sizes and three stroke weights. */}
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  d={expanded ? "M6.3 14.4 12 8.7l5.7 5.7" : "M6.3 9.6 12 15.3l5.7-5.7"}
                  stroke="currentColor"
                />
              </svg>
            </button>
            {/* The publisher's own page left this row on 2026-07-30, which is
                what the comment at the head of .podcast-mast had claimed for
                two commits while the glyph was still here. It is a sentence in
                the sheet now — "Open at Naked Bible Podcast" — which is both
                the thing it says and a fifth of the width it was spending. */}
            <button
              aria-label={`Stop ${episode.title} and close the player`}
              className="podcast-mast-icon"
              onClick={stopPodcast}
              type="button"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" stroke="currentColor" />
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
              {/* The episode's own masthead. It had no rules at all until
                  2026-07-30 — see .podcast-episode-title — so this <h2> drew at
                  the UA's 24px bold and was the largest type in the study
                  column by accident. The publisher's own page is a sentence
                  here rather than a third glyph on the mast's line, which is
                  where the masthead's comment has always said it went. */}
              <div className="podcast-episode">
                <h2 className="podcast-episode-title" tabIndex={-1}>{episode.title}</h2>
                <p className="podcast-episode-meta">
                  {passage ? `${episodePassageLabel(passage, bookNames)} · ` : ""}
                  {of > 0 ? formatClock(of) : "length unknown until it loads"}
                </p>
                <button
                  aria-label={`Open ${episode.title} at ${episode.sourceName} — opens the official page`}
                  className="podcast-episode-official"
                  onClick={() => void openOfficial()}
                  type="button"
                >
                  {`Open at ${episode.sourceName}`}
                </button>
              </div>

              {/* Two views, not two stacked panels. A reader is either choosing
                  a passage or following the words, and the sheet has no scroll
                  of its own — so the lists took height the transcript needed
                  and offered no way to give it back.

                  The pattern is finished rather than gestured at. It used to be
                  role=tablist and role=tab with no panel, no aria-controls, no
                  roving tabindex and no arrow keys — which is worse for a
                  screen reader than two plain buttons would have been, because
                  the roles promise a structure that is not there. */}
              {tabbed && (
                <div
                  aria-label="What to show"
                  className="podcast-views"
                  onKeyDown={onTabKeys}
                  ref={tabStripRef}
                  role="tablist"
                >
                  <button
                    aria-controls={panelId}
                    aria-selected={view === "transcript"}
                    className="podcast-view-tab"
                    id={transcriptTabId}
                    onClick={() => setView("transcript")}
                    role="tab"
                    tabIndex={view === "transcript" ? 0 : -1}
                    type="button"
                  >
                    Transcript
                  </button>
                  <button
                    aria-controls={panelId}
                    aria-selected={view === "passages"}
                    className="podcast-view-tab"
                    id={passagesTabId}
                    onClick={() => setView("passages")}
                    role="tab"
                    tabIndex={view === "passages" ? 0 : -1}
                    type="button"
                  >
                    Passages
                    <span className="podcast-view-count">{subjects.length + passing.length}</span>
                  </button>
                </div>
              )}

              {/* What the episode works through. Ordered by how long they stay
                  with it rather than by when it comes up: a reader scanning
                  this is deciding whether the episode is worth an hour, and
                  the twenty-minute passage answers that better than whichever
                  one happened to be first. */}
              {view === "passages" && (
                <div
                  aria-labelledby={tabbed ? passagesTabId : undefined}
                  className="podcast-refs-view"
                  id={tabbed ? panelId : undefined}
                  role={tabbed ? "tabpanel" : undefined}
                >
                {subjects.length > 0 && (
                  <ul aria-label="Passages in this episode" className="podcast-refs">
                    {subjects.map((r) => (
                      <li key={`s-${r.at}-${r.bref}`}>
                        <button
                          className="podcast-ref"
                          data-relation="subject"
                          onClick={() => goToMoment(r.at)}
                          type="button"
                        >
                          <span className="podcast-ref-time">{formatClock(r.at)}</span>
                          <span className="podcast-ref-title">{r.title}</span>
                          <span className="podcast-ref-extent">
                            {r.seconds >= 60 ? `${Math.round(r.seconds / 60)} min` : ""}
                          </span>
                          {/* The words behind the claim, shown rather than
                              hidden under a hover. A native title arrives after
                              a second, in the system's own styling, and cannot
                              be reached at all by touch — and this is the line
                              that lets a reader dismiss a wrong reference at a
                              glance, which is too important to hide. */}
                          {r.evidence && <span className="podcast-ref-why">{r.evidence}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
  
                {/* Everything the episode touches without being about. Ordered by
                    time, because this list is read while listening rather than
                    before. Allusions are marked: a passage nobody named aloud is
                    the one entry here a reader could not have found themselves. */}
                {passing.length > 0 && (
                  <div className="podcast-refs-passing">
                    <p className="podcast-refs-head">Also referenced</p>
                    <ul aria-label="Passages referenced in this episode" className="podcast-refs">
                      {passing.map((r) => (
                        <li key={`p-${r.at}-${r.bref}`}>
                          <button
                            className="podcast-ref"
                            data-relation={r.relation}
                            onClick={() => goToMoment(r.at)}
                            type="button"
                          >
                            <span className="podcast-ref-time">{formatClock(r.at)}</span>
                            <span className="podcast-ref-title">{r.title}</span>
                            <span className="podcast-ref-extent">
                              {r.relation === "allusion" ? "alluded" : ""}
                            </span>
                            {r.evidence && <span className="podcast-ref-why">{r.evidence}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                </div>
              )}

              {chapters.length > 0 && (
                <ul aria-label="Chapters" className="podcast-chapters">
                  {chapters.map((entry, index) => {
                    const entryPassage = readEpisodePassage(entry.bref);
                    return (
                      <li key={entry.start}>
                        <button
                          aria-current={index === chapterIndex}
                          className="podcast-chapter"
                          onClick={() => goToMoment(entry.start)}
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
                  this, because some of the words in it will be wrong.

                  Drawn only while the sheet is open. It used to mount when the
                  episode started — 2,280 buttons and ~4,560 nodes for a two-
                  hour episode, into a sheet clipped to nothing — and then
                  reconcile every four seconds for as long as the episode ran,
                  whether or not anyone had ever asked to read it. */}
              {expanded && view === "transcript" && hasTranscript && (
                <div
                  aria-labelledby={tabbed ? transcriptTabId : undefined}
                  className="podcast-transcript-block"
                  id={tabbed ? panelId : undefined}
                  role={tabbed ? "tabpanel" : undefined}
                >
                  <div className="podcast-transcript-head">
                    <svg aria-hidden="true" className="podcast-transcript-glass" viewBox="0 0 24 24">
                      <circle cx="10.8" cy="10.8" r="6.6" />
                      <path d="M15.75 15.75 20.1 20.1" />
                    </svg>
                    <input
                      aria-label="Search this transcript"
                      className="podcast-transcript-search"
                      onChange={(event) => askFor(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Escape") followAgain(); }}
                      placeholder="Search transcript"
                      type="search"
                      value={query}
                    />
                    {searching && (
                      <button
                        aria-label={`${matches} ${matches === 1 ? "line" : "lines"} say that. Clear the search and follow along.`}
                        className="podcast-transcript-clear"
                        onClick={followAgain}
                        title="Clear search and follow along"
                        type="button"
                      >
                        {matches} · clear
                      </button>
                    )}
                    {/* Provenance without a byline. The model id was a
                        debugging artefact sitting where a reader looks; this
                        keeps the claim — these words were machined, not
                        written — in the smallest form that still makes it,
                        and names us rather than a checkpoint, because who a
                        reader can hold responsible is the useful half. */}
                    {!searching && (
                      <span className="podcast-transcript-auto" title="Automatically transcribed by Pericope">
                        auto
                      </span>
                    )}
                  </div>

                  <div className="podcast-transcript-stage">
                    {/* Floats over the text rather than sitting in the header:
                        it is an answer to "I have scrolled away", so it belongs
                        where the scrolling happened and should not hold a row
                        of chrome open for the whole time it is irrelevant.

                        Before the list in the document though it is drawn over
                        it — its position is absolute either way, and an offer a
                        keyboard reader can only reach by tabbing through two
                        thousand lines is not an offer. It stands during a
                        search too: `!searching` read as restraint and took the
                        only follow-state control off the surface at the exact
                        moment the reader was furthest from the playhead. */}
                    {!following && (
                      <button
                        className="podcast-transcript-follow"
                        onClick={followAgain}
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M12 5.1v12.3M6.9 12.6 12 17.7l5.1-5.1" />
                        </svg>
                        Follow
                      </button>
                    )}

                    <ul
                      aria-label="Transcript"
                      className="podcast-transcript"
                      data-flat={flatWeight ? "true" : undefined}
                      data-transcript-mode={mode}
                      onKeyDown={onLineKeys}
                      onScroll={onTranscriptScroll}
                      onScrollEnd={() => { selfScrollUntil.current = 0; }}
                      ref={listRef}
                    >
                      {renderedLines}
                    </ul>

                    {searching && matches === 0 && (
                      <p className="podcast-transcript-empty">No line says that.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Neither list has anything, and the sheet says which of the two
                  facts that is. Both were computed with care — undefined while
                  unasked, null once we know there is none — and then drawn as
                  the same nothing, which left an open sheet holding a title, a
                  length, and no account of itself.

                  Drawn as two states rather than as two sentences, dated
                  2026-07-30: waiting is a state with a device (the same
                  travelling segment the rail uses, laid flat) and knowing is a
                  state with a sentence. A reader who is shown "Looking for a
                  transcript…" as static text for four seconds and then the same
                  weight of text saying there is none has been shown one thing
                  twice. */}
              {expanded && !hasTranscript && !hasPassages && (
                transcript === undefined || refs === undefined ? (
                  <div className="podcast-sheet-reaching">
                    <span aria-hidden="true" className="podcast-sheet-reaching-rule" />
                    <p>Looking for a transcript…</p>
                  </div>
                ) : (
                  <p className="podcast-transcript-empty podcast-sheet-empty">
                    No transcript for this episode, and no passages found in it.
                  </p>
                )
              )}
            </div>
          </div>

          <div className="podcast-dock-body">
            <div className="podcast-transport" role="group" aria-label="Playback">
              <SkipButton label="Back 15 seconds" onPress={() => skipBy(-15)} seconds={-15} />
              <TransportPlayButton
                /* While reaching, the press is a cancellation rather than a
                   toggle — the element is already un-paused and waiting on
                   bytes — so it is named for what it does. */
                label={reaching
                  ? `Stop loading ${episode.title}`
                  : `${paused ? "Play" : "Pause"} ${episode.title}`}
                onPress={togglePodcast}
                paused={paused}
                pressed={!paused}
              />
              <SkipButton label="Forward 30 seconds" onPress={() => skipBy(30)} seconds={30} />
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
              ) : expanded ? (
                /* Nothing. Open and without chapters — which is every episode
                   today — this line was drawing the episode's title a second
                   time, six inches under the sheet's own heading of it. The
                   corner has to name what is playing because nothing else on
                   screen does; the sheet already has. Dated 2026-07-30. */
                null
              ) : (
                <p className="podcast-dock-title" title={episode.title}>{episode.title}</p>
              )}
              {status === "failed" ? (
                /* Name the thing, the reason, and whether it was ours to fix.
                   The thing is named on the line above and the publisher on the
                   line above that, so this states only what those two do not:
                   it did not arrive, and the reason is not on this machine. The
                   way out is the link that was always beside play.

                   Shortened 2026-07-30, to the argument this comment already
                   makes. "Could not reach the episode." wanted 253px of a
                   223px line, so it was ellipsed mid-word — and a truncated
                   reason is not a reason. The episode is named directly above;
                   repeating it here was what pushed the sentence off the end
                   of its own line. The QA tour has asserted this fit since it
                   was written and never once reached the assertion. */
                <p className="podcast-dock-refusal">
                  Did not arrive. This needed the network.
                </p>
              ) : reaching ? (
                /* The third form of this one row, added 2026-07-30. Reaching
                   used to be drawn as `0:00  1×  —:—` under a pause glyph: a
                   clock counting a file that had not arrived, beside a rate for
                   a voice not yet speaking. It is the state a reader on someone
                   else's server sees most often and it was the least designed
                   one here. Now it says what is happening, in the publisher's
                   name, on the clock's own line and at the clock's own height —
                   so nothing about the dock moves when it resolves. */
                <p className="podcast-dock-reaching">{`Reaching ${episode.sourceName}…`}</p>
              ) : (
                <p className="podcast-dock-clock">
                  <span>{formatClock(position)}</span>
                  <button
                    aria-label={`Playback speed ${rateLabel}×. Press to change.`}
                    className="podcast-rate"
                    onClick={cycleRate}
                    type="button"
                  >
                    {rateLabel}×
                  </button>
                  <span className="podcast-dock-clock-rest">
                    {of > 0 ? `−${formatClock(of - position)}` : "—:—"}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="podcast-rail">
            {/* The rule is drawn by the app and the input is only the hand on
                it. A range element painting its own gradient track cannot
                transition — a gradient stop moving is a background-image change
                — and this fill is sampled from a clock four times a second, so
                it stepped. As two boxes the played part is a width, and a width
                can catch up. */}
            {!reaching && <span aria-hidden="true" className="podcast-rail-track" />}
            {!reaching && <span aria-hidden="true" className="podcast-rail-played" />}
            {/* The loading device: a segment travelling a rule. The rail is
                already a rule, so it says "reaching the publisher" without a
                second device appearing to say it. Its keyframes are this
                surface's own now — it used to animate one declared in
                styles/marking-actions.css, and an undefined animation-name
                fails silently. */}
            {reaching && <span aria-hidden="true" className="podcast-rail-reaching" />}
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
