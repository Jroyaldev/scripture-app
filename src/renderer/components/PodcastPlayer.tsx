import type React from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BookNameData } from "../api.js";
import type { Transcript } from "../../core/transcripts.js";
import { readingLines } from "../../core/transcripts.js";
import { verseSpan } from "../../core/passage-index.js";
import type { PassageReference, ReferenceRelation, ReferenceSet } from "../../core/references.js";
import { passingIn, subjectsOf } from "../../core/references.js";
import { relationSaid, relationSpoken } from "../../core/relation-words.js";
import { transcriptBasis } from "../../core/transcripts.js";
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

/**
 * The passage a launch is actually about — as coordinates, not as a bref.
 *
 * A bref cannot say the one thing this surface needs it to. `bref:v1/ROM.8.1`
 * is written both for "Romans 8" and for "Romans 8:1", and the two are
 * different instructions to the reading canvas: the first should leave the
 * reader's own selection alone, and the second should replace it. Pressing the
 * dock's passage chip used to throw a reader on 32:35 to 32:1 and destroy their
 * selection precisely because the launch had flattened a chapter claim onto a
 * verse. `verse: null` is the chapter, and the canvas is told nothing about
 * verses when it is.
 *
 * `basis` is what the chip is allowed to SAY. A moment claim is "the passage
 * playing here"; a record claim is "the passage this episode is filed under".
 * The chip asserted the second about the first for every launch from the
 * margin, which was false for all 41,426 of them.
 */
export interface PodcastPassage {
  book: string;
  chapter: number;
  /** Null when the whole chapter is meant. */
  verse: number | null;
  /** Null when a single verse, or when `verse` is null. */
  endVerse: number | null;
  basis: "record" | "moment";
}

/**
 * What the reader pressed, when they pressed a moment rather than a card.
 *
 * A moment used to evaporate on press: the passage, the relation and the
 * length were all on the row and none of them survived into the dock, so an
 * episode opened at "eleven minutes on Romans 8" arrived as an episode title
 * and a clock. It is a thing, so it travels.
 */
export interface PodcastMomentClaim {
  at: number;
  seconds: number;
  relation: ReferenceRelation;
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
  /** The passage this launch carries, or null when it carries none. */
  passage: PodcastPassage | null;
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
  /** The moment the reader pressed, when they pressed one. */
  moment?: PodcastMomentClaim;
  /**
   * The record's cover, and the one colour it is.
   *
   * Optional because a podcast reached from the margin has neither and does
   * not need them: the mast draws the publisher's plate, which is what a
   * spoken record is identified by. A SONG is identified by its sleeve — the
   * artwork is the object, not decoration around it — so when the Listen room
   * hands one over it hands the cover with it, and the dock wears the record's
   * colour while it plays.
   */
  artUrl?: string;
  tint?: string;
}

/**
 * `bref:v1/1SA.30.1-1SA.30.31` as coordinates a reader can be sent to.
 *
 * Only the record's own claim arrives as a bref — the moments carry their
 * verse range as data. A bare `.1` with no range end is read as the CHAPTER,
 * which is what the corpus writes it for: `brefFor` in
 * scripts/install-references.ts emits exactly that shape when a reference has
 * no verses, and the resource ranking matches whole chapters the same way.
 * Reading it as "verse 1" is what sent readers to the top of the chapter.
 */
export function passageFromBref(bref: string, basis: PodcastPassage["basis"] = "record"): PodcastPassage | null {
  const match = /^bref:v1\/([1-3A-Z]{3})\.(\d+)(?:\.(\d+))?(?:-([1-3A-Z]{3})\.(\d+)\.(\d+))?$/.exec(bref);
  if (!match) return null;
  const [, book, chapterText, verseText, endBook, , endVerseText] = match;
  const verse = verseText === undefined ? null : Number(verseText);
  // A range crossing into another book has no single chapter to name, so the
  // claim is filed under where it starts — which is where it starts.
  const sameBook = endBook === undefined || endBook === book;
  const endVerse = verse == null || !sameBook || endVerseText === undefined
    ? null
    : Number(endVerseText);
  return {
    book: book!,
    chapter: Number(chapterText),
    // `.1` alone is the chapter. `.1-.31` is a range that happens to start at 1.
    verse: verse === 1 && endVerse == null ? null : verse,
    endVerse,
    basis,
  };
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

/* ── Two residents of one column ────────────────────────────────────────────
   THE COLUMN SWAP · decided 2026-07-30, and it supersedes Build 2's sheet
   geometry (see the dated note on .podcast-sheet in styles/player.css).

   Build 2's answer was an overlay: the sheet opened upward OVER the study
   panel, out of the panel's own reservation, so that "nothing outside this
   surface moves when it opens". That was honest about layout and dishonest
   about attention — an open sheet covered most of the margin, so reading the
   transcript and reading the passage list became sequential where they had
   been simultaneous (the regression audit's R7), and two surfaces claimed one
   column at once.

   The column has two residents and exactly one of them is unfolded. Open the
   player and the Living Margin folds to a single line naming what it still
   follows; unfold the margin and the player folds back to its corner. Neither
   is ever destroyed, neither is ever covered, and the gesture that switches
   them is the same in both directions: the arrow on the folded one.

   The state lives here rather than in the dock's own component for the same
   reason the transport does — the margin has to read it, and the margin is not
   inside this tree. One boolean, one truth, no way for the two residents to
   both believe they are open. */
let playerExpanded = false;
const expandedWatchers = new Set<() => void>();

function announceExpanded(next: boolean): void {
  if (next === playerExpanded) return;
  playerExpanded = next;
  for (const watcher of expandedWatchers) watcher();
}

/** True while the player owns the column. The margin reads this to fold. */
export function usePodcastExpanded(): boolean {
  return useSyncExternalStore(
    (watcher) => { expandedWatchers.add(watcher); return () => { expandedWatchers.delete(watcher); }; },
    () => playerExpanded,
  );
}

export function setPodcastExpanded(next: boolean): void {
  announceExpanded(next);
}

/**
 * Give the column back to the margin.
 *
 * Called by the folded margin's own tab — the arrow on the folded resident is
 * the switch gesture, and there is exactly one of them per direction.
 */
export function foldPodcastPlayer(): void {
  announceExpanded(false);
}

/* ── The gain ramp ──────────────────────────────────────────────────────────
   No hard cuts. A file stopped at a waveform's midpoint clicks, and the click
   is louder than the voice it interrupts; the same is true of a seek, of a
   walk stepping from one treatment to the next, and of the first frame of a
   file that starts at full level.

   ~120ms, one step under --transport-quick, because this is the audio's own
   tier: the transport tokens time what a reader SEES, and an ear resolves a
   fade faster than an eye resolves a crossfade. Short enough to be inaudible
   as a fade and long enough to have no edge in it.

   It is `element.volume` on a rAF rather than a WebAudio GainNode, and that is
   a decision rather than a convenience: a MediaElementAudioSourceNode over a
   cross-origin file with no CORS headers is silenced by the engine, and these
   files come from publishers' own servers under a media grant that says
   nothing about CORS. A gain graph here would have muted the app. */
const EASE_MS = 120;
let easeFrame = 0;

function endEase(): void {
  if (easeFrame) cancelAnimationFrame(easeFrame);
  easeFrame = 0;
}

/**
 * Ride the level to `to`, then do `then`.
 *
 * Every caller is a transition the reader asked for, so the ramp never decides
 * anything: if there is no element the errand still runs, immediately.
 */
function ease(to: number, then?: () => void): void {
  const element = transport;
  endEase();
  if (!element) { then?.(); return; }
  const from = element.volume;
  /* Silence has no edge to soften. A paused element — or one that has not been
     given a file yet — takes the level immediately and the errand runs in the
     same tick, so nothing a reader pressed waits on a fade of nothing. */
  if (element.paused || Math.abs(to - from) < 0.01) { element.volume = to; then?.(); return; }
  const started = performance.now();
  const step = (): void => {
    const through = Math.min(1, (performance.now() - started) / EASE_MS);
    /* Equal-power rather than linear: the ear hears loudness, not amplitude,
       and a linear ramp of the same length has an audible dip in the middle. */
    element.volume = Math.max(0, Math.min(1, from + (to - from) * Math.sin((through * Math.PI) / 2)));
    if (through >= 1) { easeFrame = 0; then?.(); return; }
    easeFrame = requestAnimationFrame(step);
  };
  easeFrame = requestAnimationFrame(step);
}

/** Take the level down for a seek and bring it back. One click's worth. */
function easeThrough(move: () => void): void {
  const element = transport;
  if (!element) { move(); return; }
  endEase();
  element.volume = 0;
  move();
  ease(1);
}

/* ── The walk ───────────────────────────────────────────────────────────────
   A declared, finite, visible list of this chapter's own treatments, played in
   an order the reader was told before they pressed anything.

   It is not a playlist and it must never become one. There is no algorithm in
   it, nothing is appended while it runs, and it ends. The rule is written once
   here and stated on the control that starts it: the chapter's longest
   treatments, longest first, each played for the length of the treatment and
   no further. When the last span ends the walk is over and the dock is just a
   dock again.

   Each entry is bounded by `until` rather than by the end of the file, which
   is the whole difference between a walk through a passage and twelve podcasts
   queued back to back: a fourteen-minute exposition of Romans 8:9-17 inside a
   ninety-minute episode is the thing the reader asked for, and the seventy-six
   minutes around it are not. */
export interface PodcastWalkStop {
  episode: PodcastEpisode;
  /** Seconds into the file where this treatment stops being the reason. */
  until: number;
  /** The passage, already labelled by the surface that knows book names. */
  label: string;
}

export interface PodcastWalk {
  /** What the walk is through — "Romans 8". Printed, never parsed. */
  of: string;
  stops: PodcastWalkStop[];
  /** Which stop is running, or -1 once the walk has been left behind. */
  at: number;
}

let walk: PodcastWalk | null = null;
const walkWatchers = new Set<() => void>();

function announceWalk(next: PodcastWalk | null): void {
  walk = next;
  for (const watcher of walkWatchers) watcher();
}

export function usePodcastWalk(): PodcastWalk | null {
  return useSyncExternalStore(
    (watcher) => { walkWatchers.add(watcher); return () => { walkWatchers.delete(watcher); }; },
    () => walk,
  );
}

/**
 * True while a launch is the walk's own doing, so `playPodcastEpisode` can
 * tell the walk moving on from the reader pressing something else. Anything
 * the reader starts by hand ends the walk — an episode that keeps advancing
 * after you chose something different is the behaviour this whole surface is
 * built to refuse.
 */
let walking = false;

/**
 * Who changed the episode last — the reader, or the machine on their behalf.
 *
 * Held on the module rather than on the episode because it is a fact about the
 * PRESS and not about the thing pressed: the same episode arriving from a card
 * and from a walk's own advance is the same object and two different events.
 */
let launchedBy: "reader" | "walk" = "reader";

/** Read once per episode change by the dock's reset effect. */
export function podcastLaunchedBy(): "reader" | "walk" {
  return launchedBy;
}

function enterStop(index: number): void {
  const held = walk;
  const stop = held?.stops[index];
  if (!held || !stop) return;
  /* A treatment ending and the next one beginning is the one boundary on this
     surface where two different voices meet, so it is the one that most needs
     the ramp: the file is cut mid-word by construction — the span ends where
     the treatment ends, not where the speaker stops — and a hard cut there is
     a click between two people talking. Down, then over, then up. */
  ease(0, () => {
    announceWalk({ ...held, at: index });
    walking = true;
    try { playPodcastEpisode(stop.episode); } finally { walking = false; }
  });
}

/** Begin a declared walk. The reader has already been shown its whole extent. */
export function startPodcastWalk(of: string, stops: PodcastWalkStop[]): void {
  if (stops.length === 0) return;
  announceWalk({ of, stops, at: -1 });
  enterStop(0);
}

/** Leave the walk where it stands. The audio keeps playing; nothing advances. */
export function leavePodcastWalk(): void {
  if (walk) announceWalk(null);
}

export function stepPodcastWalk(by: 1 | -1): void {
  const held = walk;
  if (!held) return;
  const next = held.at + by;
  if (next < 0 || next >= held.stops.length) return;
  enterStop(next);
}

/**
 * The one place a walk advances, and it advances on the file running past the
 * end of a span rather than on a timer.
 *
 * Called from the element's own timeupdate, which is the only authority on
 * where the file is. A reader who scrubs back inside the span stays inside it;
 * a reader who scrubs past the end has left the treatment, and the walk agrees
 * with them rather than dragging them back.
 */
function walkPastEnd(at: number): void {
  const held = walk;
  const stop = held?.stops[held.at];
  if (!held || !stop || at < stop.until) return;
  if (held.at + 1 >= held.stops.length) { announceWalk(null); pausePodcast(); return; }
  enterStop(held.at + 1);
}

/* ── The queue ───────────────────────────────────────────────────────────────
   A RECORD, played in the order its publisher put it in.

   THIS IS NOT THE WALK, and the two must not be merged however similar the
   plumbing looks. A walk is passage-shaped: bounded spans inside episodes,
   declared before the reader presses anything, ending when the passage has
   been heard out. A queue is record-shaped: whole tracks, in the order they
   were released, running until the record is over. The walk's own note says
   it must never become a playlist. This is the playlist, kept separate so
   that stays true.

   They are mutually exclusive because both answer "what plays next", and two
   answers is how a reader ends up somewhere neither of them chose. Starting
   one leaves the other. */
export interface PodcastQueue {
  /** What is being played through — "EveryPsalm". Printed, never parsed. */
  of: string;
  episodes: PodcastEpisode[];
  /** Which track is running. */
  at: number;
}

let queue: PodcastQueue | null = null;
/** Set around a machine-initiated launch, exactly as `walking` is. */
let queueing = false;
const queueWatchers = new Set<() => void>();

function announceQueue(next: PodcastQueue | null): void {
  queue = next;
  for (const watcher of queueWatchers) watcher();
}

export function usePodcastQueue(): PodcastQueue | null {
  return useSyncExternalStore(
    (watcher) => { queueWatchers.add(watcher); return () => { queueWatchers.delete(watcher); }; },
    () => queue,
  );
}

function enterTrack(index: number): void {
  const held = queue;
  const episode = held?.episodes[index];
  if (!held || !episode) return;
  announceQueue({ ...held, at: index });
  queueing = true;
  try { playPodcastEpisode(episode); } finally { queueing = false; }
}

/** Straight to a track in the record already running — the Up Next list's
 *  own press, which is neither a step nor a new queue. */
export function jumpPodcastQueue(index: number): void {
  enterTrack(index);
}

/** Begin a record. `from` is the track pressed; the rest follow it. */
export function startPodcastQueue(of: string, episodes: PodcastEpisode[], from = 0): void {
  if (episodes.length === 0) return;
  if (walk) announceWalk(null);
  announceQueue({ of, episodes, at: -1 });
  enterTrack(Math.min(Math.max(from, 0), episodes.length - 1));
}

/** Leave the record where it stands. The audio keeps playing; nothing follows. */
export function leavePodcastQueue(): void {
  if (queue) announceQueue(null);
}

/** Is there a track that way? Read by the dock to dim a control it cannot use. */
export function queueHas(by: 1 | -1): boolean {
  const held = queue;
  if (!held) return false;
  if (by === -1) return held.at > 0 || (transport?.currentTime ?? 0) > RESTART_WITHIN;
  return held.at + 1 < held.episodes.length;
}

/** A few seconds in, "previous" means this track again — every music player
 *  in the world behaves this way and a reader's hand already knows it. */
const RESTART_WITHIN = 3;

export function stepPodcastQueue(by: 1 | -1): void {
  const held = queue;
  if (!held) return;
  if (by === -1 && (transport?.currentTime ?? 0) > RESTART_WITHIN) {
    seekPodcast(0);
    return;
  }
  const next = held.at + by;
  if (next < 0 || next >= held.episodes.length) return;
  enterTrack(next);
}

/**
 * The record plays on. Called from the element's own `ended`.
 *
 * Returns whether it took the ending — the walk gets first refusal on nothing,
 * because the two never run together, but the caller still has to know whether
 * to report a pause. A record whose last track has ended is over: the queue is
 * put away and the dock becomes a dock again, which is the same ending the
 * walk gives itself.
 */
function queuePastEnd(): boolean {
  const held = queue;
  if (!held) return false;
  if (held.at + 1 >= held.episodes.length) { announceQueue(null); return false; }
  enterTrack(held.at + 1);
  return true;
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
  /* A press the reader made themselves ends the walk. Nothing is worse on a
     surface like this than a list that keeps advancing after you chose
     something else — the reader would have to find and press stop to escape a
     queue they had already left. */
  if (!walking && walk) announceWalk(null);
  /* And the same for a record: choosing something else ends the one that was
     playing, or the reader would have to find stop to escape a list they had
     already left. */
  if (!queueing && queue) announceQueue(null);
  /* WHO CHANGED THE EPISODE. Read by the dock's reset effect, which throws
     away the lens over an episode when a new one arrives — the query, the
     mode, the view, and the open sheet itself.

     That is right for a press: a reader who chose a different episode did not
     bring their search with them. It is wrong for the walk, which changes the
     episode without the reader touching anything: a walk advancing at the end
     of a treatment used to wipe a search mid-read and SHUT the sheet under a
     reader who was in it — silently, with no action of theirs to associate the
     loss with. Machine-initiated launches leave the reader's lens alone. */
  /* Machine-initiated either way. A queue advancing at the end of a track did
     not involve the reader's hands, so it must not wipe the lens they left
     open — the same reasoning the walk carries above. */
  launchedBy = walking || queueing ? "walk" : "reader";
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
  /* Same reason as the resume: a fade armed against the LAST episode must not
     be able to pause this one. */
  endEase();
  element.src = episode.audioUrl;
  applyPodcastRate();
  /* The first frame of a new file arrives at whatever level the last one was
     left at, which after a walk's fade-out is zero — so the level is restored
     UNDER the silence and ridden back up once the file is running. */
  element.volume = 0;
  announceElapsed(episode.startAt ?? 0, 0);
  announceNowPlaying({ episode, status: "reaching" });
  void element.play().then(() => ease(1)).catch(() => {
    element.volume = 1;
    announceNowPlaying({ episode, status: "failed" });
  });
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
  /* A pending fade-out belongs to a decision the reader has just reversed, and
     its errand is `element.pause()`. Cancel it here rather than at the end of
     `play()`: a frame loop does not run while the window is behind another
     one, so a ramp armed before a resume can land several seconds AFTER it and
     pause an episode that is already playing. Caught by the QA tour, which
     brings the window to the front to take a picture and so ran the stale
     frame at exactly the wrong moment. */
  endEase();
  /* Up from silence rather than in at full level: a voice that arrives with an
     edge on it reads as a fault in the file. */
  element.volume = 0;
  void element.play().then(() => ease(1)).catch(() => {
    element.volume = 1;
    announceNowPlaying({ episode, status: "failed" });
  });
}

/** Stop the file where it is, without letting go of it. */
export function pausePodcast(): void {
  const element = transport;
  if (!element || element.paused) return;
  /* The pause lands after the ramp, not before it: pausing first and fading
     afterwards is fading silence. The element's own `pause` event is what
     writes the resume position, so the position kept is the one the reader
     heard last rather than the one 120ms earlier.

     The DOCK says paused now, though. A ramp is 120ms of audio and the glyph
     is the answer to a press — waiting for the element's event would leave the
     loudest control on the surface showing "playing" for a tenth of a second
     after the reader stopped it, which reads as a control that missed. If a
     resume arrives inside the ramp it cancels this errand outright (see
     `endEase`), so the element never pauses and the state announced with it
     wins in the ordinary way. */
  if (nowPlaying.episode) announceNowPlaying({ episode: nowPlaying.episode, status: "paused" });
  ease(0, () => { element.pause(); element.volume = 1; });
}

export function togglePodcast(): void {
  const element = transport;
  if (!element || !nowPlaying.episode) return;
  if (!element.paused) {
    pausePodcast();
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
  /* A seek lands the playhead in the middle of a waveform, which is a
     discontinuity in the signal — the click every player that does not do this
     has. The level drops for the assignment and rides back up behind the first
     syllable of the new place. */
  easeThrough(() => { element.currentTime = clamped; });
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
 *
 * It also forgets where they were, and that is the same sentence. The player
 * keeps a place for reading across a restart and now keeps one for listening
 * too — but the reader closing the dock is the one act on this surface that
 * says "done", so it is the one act that clears it. Quitting mid-episode
 * remembers; pressing the cross does not.
 */
export function stopPodcast(): void {
  pendingSeek = null;
  if (walk) announceWalk(null);
  const element = transport;
  if (element) {
    /* Down before the file is let go. `removeAttribute("src")` + `load()` on a
       running element is the hardest cut on this surface — the audio stops
       between one sample and the next — and it is the one a reader hears most,
       because closing the dock is a deliberate act they are listening to the
       result of. */
    ease(0, () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      element.volume = 1;
    });
  }
  /* The column comes back to the margin with the dock. Nothing is playing, so
     there is no second resident to be unfolded. */
  announceExpanded(false);
  forgetHeard();
  announceElapsed(0, 0);
  announceNowPlaying({ episode: null, status: "idle" });
}

/* ── Where the listening was left ───────────────────────────────────────────
   The player has always kept the reader's place in the TEXT across a restart —
   `lastRead` in the settings store, written on every chapter turn — and kept
   nothing at all about the voice. A reader forty minutes into a two-hour
   episode who quit the app came back to silence and no way to find the place
   again except by scrubbing.

   Held here rather than in the component for the same reason the transport is:
   the dock unmounts with nothing, but it is not the thing that knows. And
   written through one throttle, because a timeupdate fires four times a second
   and a settings store is a file. */
export interface PodcastHeard {
  episode: PodcastEpisode;
  positionSeconds: number;
}

let heard: PodcastHeard | null = null;
const heardWatchers = new Set<() => void>();
/** Set by the dock once, so this module owns no IPC of its own. */
let writeHeard: ((next: PodcastHeard | null) => void) | null = null;
let heardWrittenAt = 0;
/** Every fifteen seconds of listening, which is a file write per quarter minute. */
const HEARD_CADENCE_MS = 15_000;

function announceHeard(next: PodcastHeard | null): void {
  heard = next;
  for (const watcher of heardWatchers) watcher();
}

export function usePodcastHeard(): PodcastHeard | null {
  return useSyncExternalStore(
    (watcher) => { heardWatchers.add(watcher); return () => { heardWatchers.delete(watcher); }; },
    () => heard,
  );
}

/** What the settings store had on launch, offered rather than resumed. */
export function offerPodcastHeard(next: PodcastHeard | null): void {
  if (nowPlaying.episode) return;
  announceHeard(next);
}

export function registerHeardWriter(write: (next: PodcastHeard | null) => void): void {
  writeHeard = write;
}

function rememberHeard(position: number, { force = false } = {}): void {
  const episode = nowPlaying.episode;
  if (!episode || !Number.isFinite(position)) return;
  const now = performance.now();
  if (!force && now - heardWrittenAt < HEARD_CADENCE_MS) return;
  heardWrittenAt = now;
  const next: PodcastHeard = { episode, positionSeconds: Math.max(0, Math.floor(position)) };
  announceHeard(next);
  writeHeard?.(next);
}

function forgetHeard(): void {
  heardWrittenAt = 0;
  announceHeard(null);
  writeHeard?.(null);
}

/** Take up the offer. The passage claim and the position come back with it. */
export function resumePodcastHeard(): void {
  const held = heard;
  if (!held) return;
  playPodcastEpisode({ ...held.episode, startAt: held.positionSeconds });
}

/** Put the offer away. Nothing is fetched, nothing was fetched. */
export function forgetPodcastHeard(): void {
  forgetHeard();
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

/**
 * The one passage label on this surface, so a chip, a heading and a reference
 * row cannot disagree about what to call the same coordinates.
 *
 * It used to drop the verses — an episode opened at "Romans 8:9-17" was named
 * "Romans 8" on the mast — which is the part of the claim a reader is actually
 * choosing on. The en dash is the app's; the corpus writes a hyphen.
 */
function passageLabel(passage: PodcastPassage, bookNames: BookNameData): string {
  const name = bookNames[passage.book]?.[0] ?? passage.book;
  if (passage.verse == null) return `${name} ${passage.chapter}`;
  return passage.endVerse != null && passage.endVerse > passage.verse
    ? `${name} ${passage.chapter}:${passage.verse}–${passage.endVerse}`
    : `${name} ${passage.chapter}:${passage.verse}`;
}

/**
 * A chapter's span, without the book. The episode's own passage is set above
 * the list and every chapter falls inside it, so naming the book on each row
 * spends the column on nine repetitions of the same word and truncates the part
 * that differs.
 */
function chapterSpanLabel(passage: PodcastPassage): string {
  if (passage.verse == null) return String(passage.chapter);
  return passage.endVerse != null && passage.endVerse > passage.verse
    ? `${passage.chapter}:${passage.verse}–${passage.endVerse}`
    : `${passage.chapter}:${passage.verse}`;
}

/** A reference's own passage, as the coordinates the canvas takes. */
export function passageOfReference(reference: PassageReference): PodcastPassage {
  const span = verseSpan(reference.verses);
  return {
    book: reference.book,
    chapter: reference.chapter,
    verse: span ? span.from : null,
    endVerse: span && span.to > span.from ? span.to : null,
    basis: "moment",
  };
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
function TransportGlyphs(): React.JSX.Element {
  return (
    <>
      <svg className="transport-glyph transport-glyph-play" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4.53 20 12 8 19.47z" fill="currentColor" />
      </svg>
      <svg className="transport-glyph transport-glyph-pause" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.47 4.53h3.47v14.94H7.47zM13.07 4.53h3.47v14.94h-3.47z" fill="currentColor" />
      </svg>
    </>
  );
}

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
      <TransportGlyphs />
    </button>
  );
}

/**
 * The transport's face without its button, for a surface where the ROW is the
 * control.
 *
 * The margin's moment rows are a list a reader scans and presses anywhere on —
 * a 22px circle inside a 300px row would be a smaller target than the row it
 * sits in, and two controls doing the same thing is two tab stops for one
 * offer. So the row keeps its press and takes the transport's FACE: the same
 * pill, the same optically-centred glyph, the same crossfade, and the states
 * driven by the row's own hover and focus (see .taught-here-row .transport-play).
 *
 * Composed from the same parts rather than redrawn, which is the point. The
 * card's copy of this triangle went uncorrected for two builds twenty pixels
 * from the dock whose comment documents the correction at length.
 */
export function TransportPlayMark({
  className,
  paused,
}: {
  className?: string;
  paused: boolean;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={className ? `transport-play ${className}` : "transport-play"}
      data-glyph={paused ? "play" : "pause"}
    >
      <TransportGlyphs />
    </span>
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
 * UP NEXT — what the sheet holds open for a song.
 *
 * THE DEFECT THIS REPLACES: the chevron opened the transcript machinery for a
 * hymn. A song has no transcript, no chapters and no passage list, so every
 * branch in there was false and the reader got the sheet's empty state — a
 * panel that opened to say it had nothing. Meanwhile the one thing a listener
 * opens a music player to see, the rest of the record, was reachable only by
 * pressing next and watching the title change.
 *
 * So for a song the sheet is the record: every track, in order, the running
 * one marked, any of them one press away. The walk strip above is untouched —
 * these are different lists and both can be shown, though in practice a walk
 * and a record never run together.
 */
function UpNext({ queue }: { queue: PodcastQueue }): React.JSX.Element {
  const here = useRef<HTMLButtonElement>(null);
  /* Opening the sheet forty tracks into EveryPsalm should not open it at track
     one. `block: "center"` rather than "nearest" because the running track is
     what the panel is about — it belongs in the middle of it, not clinging to
     an edge the reader has to hunt along. */
  useEffect(() => {
    here.current?.scrollIntoView({ block: "center" });
  }, [queue.at]);

  return (
    <div className="podcast-upnext" role="group" aria-label={`Playing ${queue.of}`}>
      <p className="podcast-upnext-head">
        <span className="podcast-upnext-of">{queue.of}</span>
        <span className="podcast-upnext-place">{`${queue.at + 1} of ${queue.episodes.length}`}</span>
      </p>
      <ol className="podcast-upnext-list">
        {queue.episodes.map((entry, index) => {
          const on = index === queue.at;
          return (
            <li key={entry.id}>
              <button
                aria-current={on ? "true" : undefined}
                className="podcast-upnext-track"
                data-on={on ? "" : undefined}
                onClick={() => jumpPodcastQueue(index)}
                ref={on ? here : undefined}
                type="button"
              >
                <span aria-hidden="true" className="podcast-upnext-no">{index + 1}</span>
                <span className="podcast-upnext-title">{entry.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Previous and next, for a record.
 *
 * A song does not want the podcast transport. Fifteen seconds back inside a
 * three-minute hymn is a nudge nobody asked for, and 1.5× on a psalm setting
 * is a novelty rather than a feature — those two controls and the rate exist
 * because a ninety-minute exposition needs them. What a record needs is the
 * track either side of this one, which is what these are.
 *
 * Disabled rather than hidden at the ends of a record: a transport whose
 * controls come and go is one a hand has to re-learn every track.
 */
function StepButton({ back, disabled, label, onPress }: {
  back: boolean; disabled: boolean; label: string; onPress: () => void;
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="transport-step"
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">
        {back
          ? <path d="M7 5.5h2v13H7zm11 0v13l-9-6.5z" />
          : <path d="M15 5.5h2v13h-2zm-9 0l9 6.5-9 6.5z" />}
      </svg>
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
 * The plate, at the size the system's Now Playing panel wants it.
 *
 * The record carries no artwork, and going to find one would be a request to a
 * publisher's server that nobody pressed anything to make — the boundary this
 * whole surface is built around. So this fetches nothing. It draws the object
 * the dock already draws: the publisher's own colour under their own approved
 * mark, unmodified, which is the field that artwork is approved against. See
 * docs/trusted-resource-permissions, "The player's surface" — the plate is one
 * object at three sizes now, and the third is 512px because that is the size
 * MediaSession asks for.
 *
 * Both inputs are read off the live dock rather than duplicated here: the
 * colour from the plate's computed background, and the artwork from the mark's
 * computed `background-image`, which is where styles.css substitutes the six
 * approved paths. A source with no approved mark gets no artwork at all — the
 * same rule as everywhere else on this surface, and a 512px rectangle of a
 * publisher's colour identifies nobody.
 *
 * Everything in here can fail — a mark that has not decoded, a canvas an engine
 * declines to read back — and none of it is worth a broken dock, so the whole
 * thing is one try and a null.
 */
async function plateArtwork(dock: HTMLElement | null): Promise<MediaImage | null> {
  try {
    const mark = dock?.querySelector<HTMLElement>(".podcast-mast-mark");
    const plate = mark?.parentElement;
    if (!mark || !plate) return null;
    const url = /^url\("?(.+?)"?\)$/.exec(getComputedStyle(mark).backgroundImage)?.[1];
    if (!url) return null;
    const artwork = new Image();
    await new Promise<void>((resolve, reject) => {
      artwork.onload = () => resolve();
      artwork.onerror = () => reject(new Error("mark"));
      artwork.src = url;
    });
    if (!artwork.naturalWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const paint = canvas.getContext("2d");
    if (!paint) return null;
    paint.fillStyle = getComputedStyle(plate).backgroundColor;
    paint.fillRect(0, 0, 512, 512);
    /* The mast's own clear space, kept: 68% leaves the widest lockup on the
       shelf the same proportional margin a 26px plate leaves it at 4px. */
    const width = 512 * 0.68;
    const height = width * (artwork.naturalHeight / artwork.naturalWidth);
    paint.drawImage(artwork, (512 - width) / 2, (512 - height) / 2, width, height);
    return { src: canvas.toDataURL("image/png"), sizes: "512x512", type: "image/png" };
  } catch {
    return null;
  }
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
  const nowPlaying = usePodcastNowPlaying();
  const { episode, status } = nowPlaying;
  const { at, of } = useSyncExternalStore(subscribeElapsed, () => elapsed);
  const walk = usePodcastWalk();
  const walkActive = walk != null;
  const queued = usePodcastQueue();
  /* The system's own next/previous belong to whichever list is running. */
  const stepping = walkActive || queued != null;
  const heard = usePodcastHeard();
  /* The offer stands only when nothing is playing: an episode in the dock IS
     where the reader is, and two players in one corner is never what anyone
     meant. */
  const resumeShown = !nowPlaying.episode && heard != null;
  /* Where the reader's thumb is, which is not yet where the file is. Committing
     on release rather than on every input keeps one seek per drag instead of
     sixty, and one range request on the publisher's server instead of sixty. */
  const [scrubbingAt, setScrubbingAt] = useState<number | null>(null);
  /* Open is the reader asking for the whole episode rather than the corner of
     it. It is deliberately not remembered across episodes: pressing play on a
     new card should give back the corner, not whatever the last one was left
     at.

     It lives on the module now rather than in this component — see the column
     swap above. Open means the player owns the study column, which is a fact
     the Living Margin has to know in order to fold, and the margin is not
     inside this tree. */
  const expanded = usePodcastExpanded();
  const setExpanded = setPodcastExpanded;
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
  /* Which hit the arrows are standing on. Allowed to run past either end and
     wrapped on read, so ‹ from the first goes to the last without a branch at
     each press — the reference players all wrap, and a disabled arrow on a
     seventeen-hit search is a control that stops working for no reason. */
  const [hitAt, setHitAt] = useState(0);
  /* Where the reader is, in the episode's own time, while they are browsing.
     Null while following — the playhead IS where they are, and the clock in
     the corner already says it. */
  const [whereAt, setWhereAt] = useState<number | null>(null);
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
  /**
   * The other number: the dock WITHOUT its sheet, in whatever state it is in.
   *
   * Added 2026-07-31 with the swap's motion, and it is a different number from
   * --podcast-dock-h even though the arithmetic looks the same. That one is a
   * RESERVATION — what the dock takes up when nobody is reading it — and it is
   * deliberately frozen at the last shut measurement, because the study panel's
   * floor must not move when the player opens. This one is a FACT about right
   * now, and the open player's sheet is sized from it.
   *
   * They differ by 1.55px, measured at 1512 × 884, and the comment above
   * predicted exactly why: "the collapsed dock is genuinely a pixel shorter
   * while the sheet is open — the corner stops repeating a title the sheet is
   * already showing". `.podcast-dock-body` is 71.55 shut and 70.00 open.
   *
   * That 1.55 is the whole reason this exists. The open player's height is
   * head + sheet, and if the sheet is sized from the frozen reservation the
   * player lands 1.55px short of the column it is supposed to fill — which the
   * seam pays for, at 11.55px between the residents instead of the frame's 10,
   * in every configuration (measured: margin open, margin closed, and the
   * compact band, all three off by the same amount).
   *
   * Subtracting is safe HERE and was not safe there. The objection to
   * `round(whole − sheet)` was that it lands on 143 in one state and 142 in the
   * other and twitches the panel's floor; nothing about this number reaches the
   * panel's floor, and it is published unrounded.
   *
   * IT IS PUBLISHED FROM A LAYOUT EFFECT, not only from the observer, and that
   * is the point of it being a callback. The masthead loses its line in the
   * same commit that starts the move, and a ResizeObserver is by definition a
   * frame behind — so the first frames of every swap were sized from the head
   * the dock had a moment ago. Measured before this: the seam sat 1.55px off
   * for the first ~50ms of each direction and then converged, which is a seam
   * that changes width during a gesture whose whole claim is that it does not.
   * Read in the commit that changes it, there is nothing to converge from.
   */
  const publishDockHead = (): void => {
    const box = dockBoxRef.current;
    const shell = box?.closest<HTMLElement>(".app-shell");
    if (!box || !shell) return;
    const head = box.getBoundingClientRect().height
      - (sheetRef.current?.getBoundingClientRect().height ?? 0);
    const next = `${Math.round(head * 100) / 100}px`;
    if (shell.style.getPropertyValue("--podcast-dock-head-h") === next) return;
    shell.style.setProperty("--podcast-dock-head-h", next);
  };

  /* Keyed on the swap and nothing else. Every other reason the head can change
     is a resize, which the observer below already sees in time; this exists for
     the ONE change that happens in the same commit as the move and would
     otherwise be seen a frame late. Reading layout on every render of a
     component whose clock re-renders it four times a second would be a
     forced reflow four times a second, for no frame that needs it. */
  useLayoutEffect(publishDockHead, [expanded]);

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
         nobody is reading it.

         ── AND WHILE IT IS MOVING · 2026-07-31 ──────────────────────────────
         Both reasons above are kept, and a third condition joins them, because
         the swap now takes 240ms instead of one frame.

         The state guard alone is right on the way OPEN and wrong on the way
         BACK. `expandedRef` goes false at the first frame of the collapse,
         while the box is still most of a column tall — so every resize tick of
         the closing animation published a height between 772 and 145 as
         "what the dock reserves when nobody is reading it". Measured before
         this line existed: the study panel's own target height was rewritten
         on every frame of the collapse, so its transition restarted on every
         frame and it crawled — 21% of the way back while the player was 72% of
         the way down. The seam between the two residents, which is supposed to
         be 10px in every frame of the swap, opened to 316.

         The sheet's height is the settle signal, and it is the right one: the
         number is defined as the box WITHOUT the sheet, so the box is only
         worth measuring when there is no sheet in it. Reason two above is why
         this cannot replace the state guard — on the way open the sheet is
         still at zero for a frame while the masthead has already lost its
         line — so it stands beside it rather than instead of it. */
      if (expandedRef.current) return;
      if ((sheetRef.current?.getBoundingClientRect().height ?? 0) > 0.5) return;
      /* Two decimal places rather than whole pixels, dated 2026-07-31, and the
         reason is arithmetic rather than precision. This number is now on both
         sides of one sum: the open sheet is the column LESS this, and the open
         box is this PLUS the sheet. Rounded, the two do not cancel — measured
         at 1280 × 884 the collapsed box is 143.55 and the published 144 made
         the open player 2px short of the column, which the seam paid for: 12px
         of canvas between the residents instead of the frame's 10, constant
         through the whole transition and wrong at both ends of it.

         Whole pixels were never the point. The rounding was here to keep the
         panel's floor from twitching, and the thing that twitched was
         `round(whole − sheet)` flipping between 143 and 142 — a subtraction
         this still does not do. */
      shell.style.setProperty(
        "--podcast-dock-h",
        `${Math.round(box.getBoundingClientRect().height * 100) / 100}px`,
      );
    };
    const publishBoth = (): void => { publish(); publishDockHead(); };
    publishBoth();
    const observer = new ResizeObserver(publishBoth);
    observer.observe(box);
    if (sheetRef.current) observer.observe(sheetRef.current);
    return () => {
      observer.disconnect();
      /* Back to the sheet's own value when the player leaves, rather than
         leaving the last measured height behind as a floor nothing stands on. */
      shell.style.removeProperty("--podcast-dock-h");
      shell.style.removeProperty("--podcast-dock-head-h");
    };
    /* The resume offer takes the same reservation, because it stands in the
       same lane: without this it would sit ON the last rows of the study panel
       on every cold start that has something to offer. One ref does for both —
       only ever one of the two is in the tree. */
  }, [episode?.id, resumeShown]);

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
  /* …with one exception, and it is the whole of Build 3's reason for being.
     A launch from a CARD is an episode the reader has not been inside yet, so
     it gives back the corner. A launch from a MOMENT is a reader who named a
     place — "eleven minutes on Romans 8" — and the corner is precisely where
     that place is not: it holds a title, a clock and no account of why the
     playhead is eleven minutes in. The sheet is where the transcript and the
     passage list live, so a moment launch opens it.

     No focus moves either way. Nothing in the dock was pressed. */
  /* …and with one exception to the exception, dated 2026-07-30.

     All of this is written about a reader who PRESSED something. The walk
     changes the episode with nobody pressing anything — that is what a walk
     is — and running the reset for it took a reader's search away mid-read,
     put the view back, re-engaged following, and SHUT the sheet they were
     reading in, at the end of a treatment, with no action of theirs to
     associate any of it with. It is the one path on this surface where the
     loss is silent, which makes it the worst one.

     So a machine-initiated launch leaves the lens exactly as the reader left
     it. The episode under it changes; what they were doing to it does not. */
  const episodeId = episode?.id;
  const launchedAtMoment = episode?.moment != null;
  useEffect(() => {
    if (podcastLaunchedBy() === "walk") return;
    setExpanded(launchedAtMoment);
    setPeeking(false);
    setQuery("");
    setMode("following");
    setView("transcript");
    setNotice("");
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
    // `launchedAtMoment` is a fact about THIS episode's arrival, read at the
    // same render the id changed on. Depending on it as well would re-run the
    // whole reset if the same episode were ever re-announced without one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  /* FOLDING PUTS THE TRANSCRIPT BACK UNDER THE VOICE. Added 2026-07-30 with
     the column swap.

     The list is drawn only while the player is unfolded, so folding destroys
     the box the reader had scrolled — there is no position left to be browsing
     at. Two things follow, and the second is the one that bit: the mode has to
     come back to following, and it cannot be left to the scroll handler,
     because the collapse itself scrolls. A box that loses its height clamps
     its own scrollTop and fires a scroll for it, which the machine correctly
     reads as "the reader moved the list" and wrongly attributes to a reader
     who pressed fold. */
  useEffect(() => {
    if (expanded) return;
    setMode("following");
    setWhereAt(null);
  }, [expanded]);

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

  const passage = episode?.passage ?? null;
  /* Which conversation this publisher's transcripts rest on. Read from the
     one map that records it rather than from anything on the record, so a
     hand-edited artifact cannot promote a feed to a grant. */
  const footing = episode ? transcriptBasis(episode.recordId) : null;
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

  /* The moment the reader pressed, and the publisher's own words behind it.
     The margin row carries the passage, the relation and the length; the
     evidence lives on the episode's reference set, and the two agree because
     scripts/install-references.ts writes both out of the same row — same
     chapter, same rounded second. Matched on that second with three seconds of
     tolerance, so a rebuilt index that shifted a boundary still finds its
     sentence rather than silently attaching the wrong one. */
  const momentClaim = episode?.moment ?? null;
  const momentReference = useMemo(() => {
    if (!momentClaim || !refs) return null;
    let best: PassageReference | null = null;
    let gap = Number.POSITIVE_INFINITY;
    for (const reference of refs.references) {
      const distance = Math.abs(reference.at - momentClaim.at);
      if (distance < gap) { best = reference; gap = distance; }
    }
    return gap <= 3 ? best : null;
  }, [momentClaim, refs]);

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
    /* Dated 2026-07-30 — the query SURVIVES a seek now, and Build 1's
       invariant is amended to say so.

       It used to be cleared here, and that was right when searching meant a
       FILTER: the list held only the hits, so a reader who pressed one and
       stayed inside the filter would be following an episode through a
       four-line keyhole. The list is the whole transcript now and the hits are
       marked in place, so there is no keyhole to leave — and clearing the box
       destroyed the seventeen other places the phrase was said, which is the
       reason the reader typed it. The MODE still returns to following, because
       a seek is still "I want to be here"; what changes is that the marks stay
       and stay navigable, which is the pattern every reference player uses. */
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

  /* The one way the query changes, so the mode cannot drift away from it:
     typing into the box IS entering the searching state, and emptying it
     returns to the voice.

     Amended 2026-07-30. The invariant used to run both ways — `searching` if
     and only if the box has words in it — and that is no longer true, on
     purpose. A seek made FROM a hit puts the machine back into following with
     the box still full, because the marks are in the transcript itself now
     rather than replacing it. So the box entering the searching state is still
     one setter and cannot drift; leaving that state no longer requires
     emptying it. */
  const askFor = (next: string): void => {
    setQuery(next);
    setHitAt(0);
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
    markWhere();
    if (mode !== "following") return;
    if (performance.now() < selfScrollUntil.current) return;
    setMode("browsing");
    setNotice("Following paused.");
  };

  /* ── Wayfinding, for the reader who has scrolled away ─────────────────────
     A two-hour episode is 2,280 lines in a box that shows four, and once a
     reader stops following there has been nothing on the surface saying where
     in it they are standing. The clock in the corner is the PLAYHEAD's
     position, which is exactly the thing they have left; the scrub rail is the
     playhead too. So a reader who scrolled back to find something had no way
     to tell whether they were four minutes behind the voice or fifty, and the
     only way to find out was to give up and press Follow.

     It is the episode's own clock rather than a second scrubber: a duplicate
     rail here would be a second control for a job the first one does, and the
     answer a browsing reader wants is not "how far through" but "when was
     this said". So the time of the line at the top of the box, in the same
     face as the corner's clock, beside the pill that goes back to now.

     Measured off the DOM in a frame rather than tracked in state: a scroll
     handler that reads geometry per event on a smooth-scrolling list is one
     layout per frame anyway, and this way there is exactly one. */
  const whereFrame = useRef(0);
  const markWhere = (): void => {
    if (whereFrame.current) return;
    whereFrame.current = requestAnimationFrame(() => {
      whereFrame.current = 0;
      const box = listRef.current;
      if (!box) return;
      const top = box.getBoundingClientRect().top;
      for (const element of box.querySelectorAll<HTMLElement>(".podcast-transcript-line")) {
        if (element.getBoundingClientRect().bottom < top + 2) continue;
        const at = Number(element.dataset["line"]);
        const line = lines[at];
        setWhereAt(line ? line.s : null);
        return;
      }
    });
  };
  useEffect(() => () => { if (whereFrame.current) cancelAnimationFrame(whereFrame.current); }, []);

  /* Stepping the hits IS working the search, so it puts the machine back into
     searching — the list stops following the voice while a reader is walking
     their own answer through it, which is the same rule a scroll obeys. */
  const stepHit = (by: 1 | -1): void => {
    if (matches === 0) return;
    setHitAt((current) => current + by);
    setMode("searching");
  };

  /* How far the reader has wandered, in the episode's own minutes, and which
     way. Only drawn once they have actually gone somewhere: half a minute
     either side is where the voice already is, and a pill reading "0:04 back"
     would be noise on every scroll. */
  const whereGap = ((): string | null => {
    if (following || whereAt == null || !(of > 0)) return null;
    const delta = whereAt - position;
    if (Math.abs(delta) < 30) return null;
    return `${formatClock(Math.abs(delta))} ${delta < 0 ? "back" : "ahead"}`;
  })();

  /* The seek handlers, always the current ones.

     Two callers hold onto them across renders: the transcript list, which is
     memoized on its own content and so keeps whichever render built it, and
     the system transport, whose handlers are registered once per episode. The
     seek itself would survive being stale — the setters never change — but
     what is SAID about it does not: whether a press resumed following is a
     fact about where the reader was standing when they pressed, and that has
     to be read now rather than remembered. */
  /**
   * Open a passage on the reading canvas, with the audio still running.
   *
   * This is the half of the loop that did not exist. The episode's references
   * carry a canonical passage each — twelve at the median, sixty-four at the
   * top — and every one of them was seek-only: the player could print
   * "Romans 8:1-11" and had no way to show it to anybody.
   *
   * The reader's place is kept by the canvas rather than by this dock: `goTo`
   * pushes the entry it is leaving onto the navigation history, so the way
   * back is the same Alt+← and the same back arrow the rest of the app uses.
   * What this end owes is a truthful target — a chapter claim arrives with
   * `verse: null` and is sent as a chapter, which leaves whatever the reader
   * had selected alone instead of collapsing it onto verse 1.
   */
  const navigateTo = (target: PodcastPassage): void => {
    void onNavigate(
      target.book,
      target.chapter,
      target.verse ?? undefined,
      target.endVerse ?? undefined,
    );
  };

  /**
   * One row for the two passage lists, with the two things a reader can do
   * with a passage on it.
   *
   * Hear it — the row itself, which has always been the whole of what this
   * list could offer. Read it — the second control, which is the half of the
   * loop that did not exist: 41,426 rows across the corpus name a passage and
   * not one of them could open it.
   *
   * They are two controls rather than one row with a modifier because they are
   * two different intentions and both are ordinary. The read control is the
   * smaller of the two and sits at the end, because on a surface a reader
   * opened to listen, listening is the sentence and reading is the aside.
   */
  const referenceRow = (r: PassageReference): React.JSX.Element => (
    <li className="podcast-ref-row" key={`${r.relation}-${r.at}-${r.bref}`}>
      <button
        className="podcast-ref"
        data-relation={r.relation}
        onClick={() => goToMoment(r.at)}
        type="button"
      >
        <span className="podcast-ref-time">{formatClock(r.at)}</span>
        <span className="podcast-ref-title">{r.title}</span>
        <span className="podcast-ref-extent">
          {r.seconds >= 60 ? `${Math.round(r.seconds / 60)} min` : ""}
        </span>
        {/* The words behind the claim, shown rather than hidden under a hover.
            A native title arrives after a second, in the system's own styling,
            and cannot be reached at all by touch — and this is the line that
            lets a reader dismiss a wrong reference at a glance, which is too
            important to hide.

            The relation leads it, in reader's words. The claim and its
            evidence are one sentence — "brought in alongside · so Paul reaches
            back to Deuteronomy here" — and splitting them put the kind of
            claim in a column with the minutes. */}
        <span className="podcast-ref-why">
          <span className="podcast-ref-said">{relationSaid(r.relation)}</span>
          {r.evidence}
        </span>
      </button>
      <button
        aria-label={`Read ${r.title} — opens the passage; the episode keeps playing`}
        className="podcast-ref-read"
        onClick={() => navigateTo(passageOfReference(r))}
        type="button"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M4.6 5.4h4.9c1.1 0 2 .6 2.5 1.5.5-.9 1.4-1.5 2.5-1.5h4.9v12.1h-4.9c-1.1 0-2 .6-2.5 1.5-.5-.9-1.4-1.5-2.5-1.5H4.6zM12 6.9v11.6"
            stroke="currentColor"
          />
        </svg>
      </button>
    </li>
  );

  const latest = useRef({ line: goToLine, skip: skipBy, seek: goTo, read: navigateTo });
  useEffect(() => {
    latest.current = { line: goToLine, skip: skipBy, seek: goTo, read: navigateTo };
  });

  const chapters: PodcastChapter[] = episode?.chapters ?? [];
  const chapterIndex = chapters.reduce(
    (found, chapter, index) => (position >= chapter.start ? index : found),
    -1,
  );
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : undefined;

  /* Deduplicated to the second: two references a heartbeat apart would draw
     two marks a pixel apart on a two-hour rail, which is a smudge rather than
     two places. */
  const scrubTicks = useMemo(() => {
    const source = chapters.length > 0
      ? chapters.map((entry) => entry.start)
      : (refs?.references ?? []).map((reference) => reference.at);
    return [...new Set(source.map((second) => Math.round(second)))];
  }, [chapters, refs]);

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

  /* ── Where the passages are named, line by line ───────────────────────────
     The reference set has been loaded, validated and sitting in this
     component's own state since the episode started, and the transcript has
     never once consulted it: a listener who heard "turn to Romans 8" saw plain
     text whose only behaviour was to seek to itself.

     A reference is a point in time; a line is a span of time. So a reference
     belongs to the last line that had started when it was recorded — the same
     rule the playhead uses to find the active line, applied to a different
     clock reading. Both arrays are sorted, so this is one walk rather than a
     scan per reference.

     Line-level and no further. The word timings are in the payload — 24,995 of
     them on the longest episode — and word-level marking is refused by
     standing decision: a transcript with a chip on every proper noun stops
     being something you read. */
  const citedLines = useMemo(() => {
    const byLine = new Map<number, PassageReference[]>();
    if (!refs || lines.length === 0) return byLine;
    let at = 0;
    for (const reference of refs.references) {
      while (at + 1 < lines.length && lines[at + 1]!.s <= reference.at) at += 1;
      const held = byLine.get(at);
      if (held) held.push(reference); else byLine.set(at, [reference]);
    }
    return byLine;
  }, [lines, refs]);

  /* ── Searching in place ───────────────────────────────────────────────────
     Restated 2026-07-30, and the note it replaces was arguing the opposite:
     "a hit fourteen screens down is invisible, and the reader would be
     scrolling a transcript looking for their own search."

     That is true of marking WITHOUT navigation, and marking without navigation
     is not the pattern. Every reference player on the desk marks in place and
     gives the reader a pair of arrows and a count — ‹ 3/17 › — which answers
     the invisible-hit objection directly while keeping the thing the filter
     destroyed: the surrounding sentences. A filtered list can tell you that
     seventeen lines say "covenant" and cannot tell you that four of them are
     in the same two minutes, which is usually the actual finding.

     `highlight` has existed on this surface since the first draft and has
     never been used for this; it was written for the filtered rows. */
  const hits = useMemo(() => (needle
    ? lines.reduce<number[]>((found, line, index) => {
      if (line.t.toLowerCase().includes(needle)) found.push(index);
      return found;
    }, [])
    : []),
  [lines, needle]);
  const matches = hits.length;
  const hitIndex = matches === 0 ? -1 : ((hitAt % matches) + matches) % matches;
  const hitLine = hitIndex < 0 ? -1 : hits[hitIndex]!;

  /* No playhead the ramp could be measured from: a reader working a search is
     reading the answer rather than tracking a voice, and before the first line
     has been spoken there is nothing to be near. Either way every line sits at
     the same readable weight instead of pretending to a distance from a voice
     that is not in view. */
  const flatWeight = searching || lineIndex < 0;

  /* Built once per episode, once per query and once per reference set, and
     never again.

     It used to be keyed on the active line as well, which the comment here
     defended as a saving — 2,280 elements reconciled once a line instead of
     four times a second. It is a saving and it is still 2,280 elements every
     four seconds for the length of an episode, in a sheet that is usually shut,
     because the list mounts when the episode starts rather than when anyone
     asks to read it. Both halves are fixed: the block below renders only while
     the sheet is open, and everything that is a function of the playhead has
     moved out of the tree and into the ladder effect, which touches seven
     elements. Which hit is CURRENT is written the same way, by the hit effect,
     for the same reason. */
  const renderedLines = useMemo(() => lines.map((line, index) => {
    const cited = citedLines.get(index);
    return (
      <li key={`${line.s}-${index}`} data-cited={cited ? "true" : undefined}>
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
        {/* Beside the line rather than inside it: a control inside a control
            is not markup a browser or a screen reader has any way to resolve,
            and the line's own press has to keep meaning "play from here". So
            the passage gets its own smaller target, set under the line where
            a marginal note goes. Pressing it opens the passage; the audio does
            not move, because a reader following along who wants to SEE Romans
            8 has not asked to stop hearing this. */}
        {cited && (
          <span className="podcast-transcript-cites">
            {cited.map((reference) => (
              <button
                aria-label={`Read ${reference.title} — ${relationSpoken(reference.relation, reference.title)}`}
                className="podcast-transcript-cite"
                key={reference.bref}
                onClick={() => latest.current.read(passageOfReference(reference))}
                tabIndex={-1}
                type="button"
              >
                {reference.title}
              </button>
            ))}
          </span>
        )}
      </li>
    );
  }), [citedLines, lines, needle]);

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
    /* The passage marks travel with the lines rather than forming a second
       ladder. Each one sits directly after the line that names it, so the
       arrows walk them in reading order and a keyboard reader meets a mark in
       the same place a pointer reader sees it — as opposed to not at all,
       which is what a -1 outside the roving set would have meant. */
    const lines = [...box.querySelectorAll<HTMLElement>(".podcast-transcript-line, .podcast-transcript-cite")];
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

  /* Which of the marked lines the arrows are standing on, written the same way
     the ramp is: onto the one element it shows on, rather than through the
     list as a prop. Seventeen hits marked identically is a wall; one of them
     carried is a place. */
  const hitRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    hitRef.current?.removeAttribute("data-hit");
    hitRef.current = null;
    const box = listRef.current;
    if (!box || !expanded || hitLine < 0) return;
    const line = box.querySelector<HTMLElement>(`.podcast-transcript-line[data-line="${hitLine}"]`);
    if (!line) return;
    line.setAttribute("data-hit", "true");
    hitRef.current = line;
    if (mode !== "searching") return;
    /* The reader asked to be taken here, so this scroll is ours and the
       browsing guard must not read it as theirs. */
    selfScrollUntil.current = performance.now() + 1_000;
    line.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    // `mode` decides whether to travel, not whether to mark. Marking on every
    // render keeps the current hit correct after a seek has left searching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, hitLine, renderedLines]);

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
  /* Which face the transport wears. `kind` is the record's own word for
     itself, set where the episode is made, so nothing here has to guess from
     a duration or a URL. */
  const isSong = episode?.kind === "song";
  const cycleRate = (): void => {
    const at = PODCAST_RATES.findIndex((value) => value === rateLabel);
    setPodcastRate(PODCAST_RATES[(at + 1) % PODCAST_RATES.length] ?? 1);
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
    if (!expanded || needle.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setNotice(matches === 0
        ? "No line says that."
        : `${matches} ${matches === 1 ? "line says" : "lines say"} that, marked in place.`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [expanded, matches, needle]);

  /* The system's own transport.

     macOS Now Playing, the hardware media keys and everything that speaks to
     them go through MediaSession, and without it the only way to pause 3,521
     episodes' worth of audio is to find a 38px circle in the corner of one
     window. The seek actions land on the same errand every seek on this dock
     runs — through the `latest` ref above, so the handlers can be registered
     once per episode instead of once per render.

     The image is the PLATE, drawn here rather than fetched. Amended
     2026-07-30: no image was offered at all, on the grounds that the record
     carries none and going to find one would be a request to a publisher's
     server nobody pressed anything to make. That reasoning is unchanged and
     this does not touch it — see plateArtwork above, which paints the
     publisher's own colour under their own approved mark, from a file already
     on this machine, and hands back null for any source without one. */
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
    /* Painted after the metadata rather than with it: the plate is read off
       the live dock, and on the first frame of a new episode the mark may not
       have decoded yet. The title and the publisher are on the system's panel
       immediately either way; the artwork arrives when it can, or never. */
    let artworkLive = true;
    void plateArtwork(dockBoxRef.current).then((artwork) => {
      if (!artworkLive || !artwork || session.metadata?.title !== episodeTitle) return;
      session.metadata = new MediaMetadata({
        title: episodeTitle,
        artist: episodeSource,
        artwork: [artwork],
      });
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => resumePodcast()],
      ["pause", () => pausePodcast()],
      ["stop", () => stopPodcast()],
      ["seekbackward", (details) => latest.current.skip(-(details.seekOffset ?? 15))],
      ["seekforward", (details) => latest.current.skip(details.seekOffset ?? 30)],
      ["seekto", (details) => {
        if (details.seekTime != null) latest.current.seek(details.seekTime, { hear: false, show: false });
      }],
      /* Registered only while a list is running. An engine handed a `nexttrack`
         handler draws the button whether or not there is a next track, and a
         system control that does nothing is worse than one that is not there.
         With neither a walk nor a record there is no next: this dock plays the
         one episode a reader chose and queues nothing behind it.

         RESTATED 2026-08-02 — a record queue is the second thing that has a
         next, and the lock screen must step whichever list is actually
         running rather than only the walk. */
      ...(stepping
        ? ([
          ["previoustrack", () => (walkActive ? stepPodcastWalk(-1) : stepPodcastQueue(-1))],
          ["nexttrack", () => (walkActive ? stepPodcastWalk(1) : stepPodcastQueue(1))],
        ] as [MediaSessionAction, MediaSessionActionHandler][])
        : []),
    ];
    for (const [action, handler] of handlers) {
      /* An engine that does not know an action throws rather than ignoring it,
         and one unknown action must not cost the other five. */
      try { session.setActionHandler(action, handler); } catch { /* not on this engine */ }
    }
    return () => {
      artworkLive = false;
      for (const [action] of handlers) {
        try { session.setActionHandler(action, null); } catch { /* as above */ }
      }
    };
  }, [episodeId, episodeSource, episodeTitle, walkActive, stepping]);

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
        onEnded={() => {
          /* A record plays on; a walk ends where its last treatment does. */
          if (queuePastEnd()) return;
          walkPastEnd(Number.POSITIVE_INFINITY);
          elementReports("paused");
        }}
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
        /* A pause is a place worth keeping exactly, so the throttle is spent
           here rather than waited out — a reader who pauses and quits within
           fifteen seconds would otherwise come back to where they were a
           quarter of a minute earlier. */
        onPause={(event) => { rememberHeard(event.currentTarget.currentTime, { force: true }); elementReports("paused"); }}
        onPlaying={() => elementReports("playing")}
        /* The element is the authority on its own rate, so the dock reads it
           here instead of remembering what it asked for. */
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          announceElapsed(time, event.currentTarget.duration || 0);
          if (!event.currentTarget.paused) {
            rememberHeard(time);
            walkPastEnd(time);
          }
        }}
        onWaiting={() => elementReports("reaching")}
        preload="none"
        ref={registerTransport}
      />
      {episode && (
        <section
          /* A song announced as a "podcast" is the sort of small lie a reader
             notices, and a screen reader says out loud. */
          aria-label={`${isSong ? "Music" : "Podcast"} player — ${episode.title}`}
          className="podcast-dock"
          ref={dockBoxRef}
          data-expanded={expanded}
          data-peeking={peeking}
          onPointerEnter={(event) => armPeek(true, event.pointerType)}
          onPointerLeave={(event) => armPeek(false, event.pointerType)}
          data-floating-layer="player"
          data-source={episode.sourceId}
          /* Present only when the record brought a colour of its own, which is
             what lets the sheet swap the publisher's accent for the record's
             without having to test whether a custom property was set. */
          data-record={episode.tint ? "" : undefined}
          data-status={status}
          style={{
            "--podcast-played": `${(played * 100).toFixed(3)}%`,
            /* The dock takes the colour of what is playing, by the same
               derivation the Listen room uses — chroma multiplied, never
               floored, so a black-and-white record stays grey. */
            ...(episode.tint ? { "--record-tint": episode.tint } : {}),
          } as React.CSSProperties}
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
            {episode.artUrl ? (
              /* The sleeve, at plate size and in the plate's place. A record
                 is known by its cover before it is known by its label, and a
                 dock that draws the publisher's mark over a song is naming the
                 shop rather than the record. The source name stays in the
                 accessibility tree, where the plate had put it. */
              <span className="podcast-mast-cover">
                <img alt="" decoding="async" src={episode.artUrl} />
                <span className="sr-only">{episode.sourceName}</span>
              </span>
            ) : (
              <span className="podcast-mast-plate">
                <span className="podcast-mast-mark podcast-mast-name">{episode.sourceName}</span>
              </span>
            )}
            <span className="podcast-mast-kind">{episode.kind}</span>
            {/* The one control on this dock that reaches the reading canvas,
                and until 2026-07-30 it was hidden by `!expanded` — removed
                from the DOM at exactly the moment the reader had the passage
                list open and was most likely to want it.

                It also said something false. Its accessible name claimed "the
                passage this episode works through" while its bref was the
                READER's own chapter at verse 1, put there by all three margin
                call sites; for every one of the 41,426 launches from that
                surface the sentence was untrue and the press destroyed the
                reader's selection. The passage is now whatever the launch
                actually carried, and the sentence says which of the two kinds
                of claim that is. */}
            {passage && (
              <button
                aria-label={passage.basis === "moment"
                  ? `Read ${passageLabel(passage, bookNames)} — the passage playing here`
                  : `Read ${passageLabel(passage, bookNames)} — the passage this episode is filed under`}
                className="podcast-mast-passage"
                onClick={() => navigateTo(passage)}
                type="button"
              >
                {passageLabel(passage, bookNames)}
              </button>
            )}
            {/* The switch gesture, one per direction. Folded, this is the
                arrow on the closed resident and it takes the study column —
                the Living Margin folds to its own one-line tab as this opens,
                because the column has two residents and exactly one of them is
                unfolded. Open, it is the compact control on the open one, and
                it hands the column back. The margin's tab is the mirror of
                this button and calls the same machine. */}
            <button
              aria-expanded={expanded}
              /* The control names what it will actually open. For a song
                 that is the record, not "the whole of" a three-minute track —
                 a label describing a transcript, over a panel holding a track
                 list, is worse than no label at all. */
              aria-label={expanded
                ? "Fold the player — gives the column back to Study"
                : isSong && queued
                  ? `Show the rest of ${queued.of} — takes the study column`
                  : `Show the whole of ${episode.title} — takes the study column`}
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
                the thing it says and a fifth of the width it was spending.

                AND IT COMES BACK FOR ONE STATE. The refusal's own copy is
                written around "the way out is the link that was always beside
                play", and in the state that says it the sheet is shut and the
                sentence was pointing at nothing. The corner's line column
                cannot hold both the reason and the route — 226px against a
                223px sentence — so the route returns to the mast, in the one
                state where the reader needs it and the passage chip is the
                least useful thing on the row. */}
            {status === "failed" && (
              <button
                aria-label={`Open ${episode.title} at ${episode.sourceName} — opens the official page`}
                className="podcast-mast-icon podcast-mast-out"
                onClick={() => void openOfficial()}
                type="button"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M9.6 6.3h8.1v8.1M17.7 6.3 7.5 16.5" stroke="currentColor" />
                </svg>
              </button>
            )}
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
              {/* ── The walk ──────────────────────────────────────────────
                  Where the reader is inside a list they were shown the whole
                  of before they started it. Its extent is fixed, its order was
                  declared, and it ends: "3 of 12" is a promise that there is a
                  twelfth and nothing after it.

                  Leaving is one press and it leaves the audio playing, because
                  a reader who steps out of the walk in the middle of a good
                  exposition asked to stop ADVANCING, not to stop listening. */}
              {walk && (
                <div className="podcast-walk" role="group" aria-label={`Walking ${walk.of}`}>
                  <button
                    aria-label="The treatment before this one"
                    className="podcast-walk-step"
                    disabled={walk.at <= 0}
                    onClick={() => stepPodcastWalk(-1)}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <path d="M14.4 6.3 8.7 12l5.7 5.7" stroke="currentColor" />
                    </svg>
                  </button>
                  <span className="podcast-walk-of">
                    {`Walking ${walk.of}`}
                    <span className="podcast-walk-place">{`${walk.at + 1} of ${walk.stops.length}`}</span>
                  </span>
                  <button
                    aria-label="The next treatment"
                    className="podcast-walk-step"
                    disabled={walk.at + 1 >= walk.stops.length}
                    onClick={() => stepPodcastWalk(1)}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <path d="M9.6 6.3 15.3 12l-5.7 5.7" stroke="currentColor" />
                    </svg>
                  </button>
                  <button
                    aria-label="Stop walking the chapter — this episode keeps playing"
                    className="podcast-walk-leave"
                    onClick={leavePodcastWalk}
                    type="button"
                  >
                    leave
                  </button>
                </div>
              )}

              {/* The episode's own masthead. It had no rules at all until
                  2026-07-30 — see .podcast-episode-title — so this <h2> drew at
                  the UA's 24px bold and was the largest type in the study
                  column by accident. The publisher's own page is a sentence
                  here rather than a third glyph on the mast's line, which is
                  where the masthead's comment has always said it went. */}
              <div className="podcast-episode">
                <h2 className="podcast-episode-title" tabIndex={-1}>{episode.title}</h2>
                <p className="podcast-episode-meta">
                  {passage ? `${passageLabel(passage, bookNames)} · ` : ""}
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
                {/* Which footing this publisher is on, said once and quietly,
                    in the same register as the transcript's "auto" mark.

                    docs/trusted-resource-permissions.md records that the
                    distinction "must stay visible", and until this build the
                    only places it was visible were a TypeScript literal and a
                    test — while 48% of everything these surfaces show comes
                    from publishers nobody has asked. It is one sentence at the
                    foot of the episode's own block rather than a badge on
                    every row, because it is a fact about the publisher and not
                    about this episode, and because a legal notice repeated
                    twenty-five times is chrome. */}
                {/* RESTATED 2026-07-30 in the reader's language. The
                    public-feed form used to end "We have not asked them yet"
                    — a fact about our outreach backlog, printed on a reading
                    surface. The reader is owed the DISTINCTION, which is what
                    the permissions doc requires and what this still carries:
                    one form names a permission, the other names a public feed,
                    and a reader can tell which of the two they are looking at
                    without being told what is on our to-do list. */}
                {/* Not on a song. There is no transcript of a hymn here and
                    saying there is, under a panel that plainly holds a track
                    list, is the same small lie as calling it a podcast. */}
                {!isSong && (
                  <p className="podcast-episode-footing" data-basis={footing ?? undefined}>
                    {`Transcript machine-read from ${episode.sourceName}'s published audio.`}
                  </p>
                )}
              </div>

              {/* ── The record, when the record is what is playing ──────────
                  A song's sheet is its record. Everything below this is the
                  spoken-word machinery — transcript, chapters, passage list —
                  and for a hymn every branch of it is false, which is how the
                  chevron came to open a panel whose only content was the
                  sentence saying it had none. */}
              {isSong && queued && <UpNext queue={queued} />}

              {/* ── The moment that started this ────────────────────────────
                  A press in the margin used to be self-erasing: the passage,
                  the relation and the length were all on the row the reader
                  chose, and the dock that answered it held an episode title
                  and a clock. "Eleven minutes on Romans 8" became "0:26" under
                  a title about something else, and the reader had no way back
                  to what they had just been told.

                  It says the three things the row said, plus the one the row
                  had no space for — the publisher's own sentence, which is why
                  the entry exists at all and the only thing on this surface
                  that lets a reader throw out a wrong reference at a glance.
                  Pressing the passage opens it. */}
              {momentClaim && passage && (
                <div className="podcast-moment">
                  <button
                    aria-label={`Read ${passageLabel(passage, bookNames)} — the passage playing here`}
                    className="podcast-moment-ref"
                    onClick={() => navigateTo(passage)}
                    type="button"
                  >
                    {passageLabel(passage, bookNames)}
                  </button>
                  <span className="podcast-moment-said">{relationSaid(momentClaim.relation)}</span>
                  <span className="podcast-moment-extent">
                    {momentClaim.seconds >= 60
                      ? `${Math.round(momentClaim.seconds / 60)} min`
                      : `${Math.max(1, Math.round(momentClaim.seconds))}s`}
                    {` from ${formatClock(momentClaim.at)}`}
                  </span>
                  {momentReference?.evidence && (
                    <p className="podcast-moment-why">{momentReference.evidence}</p>
                  )}
                </div>
              )}

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
                    {subjects.map(referenceRow)}
                  </ul>
                )}

                {/* Everything the episode touches without being about. Ordered by
                    time, because this list is read while listening rather than
                    before. Every row says which kind of touching it was: until
                    2026-07-30 an allusion said "alluded" and a crossref and a
                    mention said nothing at all, so 23,169 moments across the
                    corpus were an empty span. */}
                {passing.length > 0 && (
                  <div className="podcast-refs-passing">
                    <p className="podcast-refs-head">Also referenced</p>
                    <ul aria-label="Passages referenced in this episode" className="podcast-refs">
                      {passing.map(referenceRow)}
                    </ul>
                  </div>
                )}
                </div>
              )}

              {chapters.length > 0 && (
                <ul aria-label="Chapters" className="podcast-chapters">
                  {chapters.map((entry, index) => {
                    const entryPassage = passageFromBref(entry.bref);
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
                    {/* ‹ 3/17 › — the pattern every reference player uses, and
                        the half that makes marking in place work at all. The
                        count answers "is this word anywhere in two hours"; the
                        arrows answer "show me the next one"; and the transcript
                        underneath stays the transcript, so the sentence on
                        either side of the hit is still there to read.

                        Shown whenever the box has words in it, not only while
                        the machine is in `searching` — a reader who pressed a
                        hit is back in following with sixteen other places still
                        marked, and taking their arrows away at that moment
                        would be taking the answer away. */}
                    {needle.length > 0 && (
                      <span className="podcast-transcript-hits" role="group" aria-label="Search results">
                        <button
                          aria-label="Previous line that says that"
                          className="podcast-transcript-step"
                          disabled={matches === 0}
                          onClick={() => stepHit(-1)}
                          type="button"
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                            <path d="M14.4 6.3 8.7 12l5.7 5.7" stroke="currentColor" />
                          </svg>
                        </button>
                        <span className="podcast-transcript-count">
                          {matches === 0 ? "0" : `${hitIndex + 1}/${matches}`}
                        </span>
                        <button
                          aria-label="Next line that says that"
                          className="podcast-transcript-step"
                          disabled={matches === 0}
                          onClick={() => stepHit(1)}
                          type="button"
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                            <path d="M9.6 6.3 15.3 12l-5.7 5.7" stroke="currentColor" />
                          </svg>
                        </button>
                        <button
                          aria-label="Clear the search and follow along"
                          className="podcast-transcript-clear"
                          onClick={followAgain}
                          title="Clear search and follow along"
                          type="button"
                        >
                          clear
                        </button>
                      </span>
                    )}
                    {/* Provenance without a byline. The model id was a
                        debugging artefact sitting where a reader looks; this
                        keeps the claim — these words were machined, not
                        written — in the smallest form that still makes it,
                        and names us rather than a checkpoint, because who a
                        reader can hold responsible is the useful half. */}
                    {needle.length === 0 && (
                      <span
                        className="podcast-transcript-auto"
                        data-basis={footing ?? undefined}
                        title={`Automatically transcribed by Pericope from ${episode.sourceName}'s published audio`}
                      >
                        auto
                      </span>
                    )}
                  </div>

                  <div className="podcast-transcript-stage">
                    {/* IN ITS OWN LANE, since 2026-07-30. It floated over the
                        list — the argument being that it answers "I have
                        scrolled away", so it belongs where the scrolling
                        happened and should not hold a row of chrome open for
                        the whole time it is irrelevant.

                        The first half of that is still true and the second half
                        was paid for by the words: a dark pill drawn over the
                        transcript covers about half of whichever line it lands
                        on, and it lands on a different line every time. The
                        list's bottom padding had already been widened to 44px
                        so the LAST line could be pressed, which is the same
                        defect admitted one row at a time. So the lane is real
                        and always there — nothing moves when the pill arrives,
                        because the space was never the pill's to take — and the
                        list ends where the lane begins.

                        AFTER the list in the document now, which the lane also
                        buys. It used to come first, because with 2,280 tab
                        stops in the list an offer below them was unreachable;
                        the list holds one roving stop, so the pill is one Tab
                        past the words and the reading order finally matches
                        what is on screen. It stands during a search too:
                        `!searching` read as restraint and took the only
                        follow-state control off the surface at the exact
                        moment the reader was furthest from the playhead. */}
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

                    {/* The way back to now, and — since 2026-07-30 — where
                        "away" actually is. A reader who has scrolled in a 2h18m
                        transcript was told nothing about their own position:
                        the clock in the corner is the playhead's, which is the
                        thing they left, and so is the rail. So the pill carries
                        the distance it would travel. It is not a second
                        scrubber; it is one number on the control that already
                        means "go back", in the clock's own face. */}
                    <div className="podcast-transcript-lane">
                      {!following && (
                        <button
                          aria-label={whereGap == null
                            ? "Follow the episode again"
                            : `Follow the episode again — you are ${whereGap} from the voice`}
                          className="podcast-transcript-follow"
                          onClick={followAgain}
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M12 5.1v12.3M6.9 12.6 12 17.7l5.1-5.1" />
                          </svg>
                          Follow
                          {whereGap && <span className="podcast-transcript-where">{whereGap}</span>}
                        </button>
                      )}
                    </div>

                    {needle.length > 0 && matches === 0 && (
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
              {/* Not for a song: it has the record above, which is the
                  opposite of nothing. */}
              {expanded && !isSong && !hasTranscript && !hasPassages && (
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
              {/* THE TWO FACES OF ONE TRANSPORT. There is still exactly one
                  audio element and one dock; what changes is which controls it
                  offers, decided by the record's own `kind`. A spoken record
                  gets the instruments a long file needs; a sung one gets the
                  track either side. Nothing else about the dock moves — the
                  position, the size, and the play button stay exactly where a
                  hand already found them. */}
              {isSong
                ? <StepButton back disabled={!queueHas(-1)} label="Previous track" onPress={() => stepPodcastQueue(-1)} />
                : <SkipButton label="Back 15 seconds" onPress={() => skipBy(-15)} seconds={-15} />}
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
              {isSong
                ? <StepButton back={false} disabled={!queueHas(1)} label="Next track" onPress={() => stepPodcastQueue(1)} />
                : <SkipButton label="Forward 30 seconds" onPress={() => skipBy(30)} seconds={30} />}
            </div>
            <div className="podcast-dock-lines">
              {expanded && chapter ? (
                /* Open, the title is already set above, so this line names the
                   span instead of repeating it. */
                <p className="podcast-dock-now" title={chapter.title}>
                  {(() => {
                    const span = passageFromBref(chapter.bref);
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
              ) : momentClaim ? (
                /* Shut, and launched from a moment: the corner names the thing
                   that is talking, and then says which of the four claims it
                   is making.

                   RESTATED 2026-07-30 — the two ranks are the other way round
                   now. The argument for carrying the relation at all is sound
                   and unchanged: which of the four claims this is cannot be
                   recovered from anywhere else once the sheet is shut, because
                   an episode working through Romans 8 and one that mentions it
                   in passing are the same title, the same publisher and the
                   same clock. The execution inverted it. `relationSaid()` took
                   semibold serif at full ink and LED the line, while the
                   episode's name — the only string that identifies the thing —
                   was demoted to the secondary ramp and clipped, so the row
                   whose whole job is to say what is playing read "worked
                   through Naked Bible 479: 1 S…". A relation is a qualifier
                   and had been given the weight of a subject. The title leads,
                   at full ink, and the qualifier sits after it in the small UI
                   face. */
                <p className="podcast-dock-now" title={episode.title}>
                  <span className="podcast-dock-now-title">{episode.title}</span>
                  <span className="podcast-dock-now-said">{relationSaid(momentClaim.relation)}</span>
                </p>
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
                /* The sentence, and only the sentence. The way out it is
                   written around is on the mast, where the audit says it used
                   to be — see the ↗ above, which is drawn in this state and in
                   no other. It cannot be here: the corner's line column is
                   about 226px and this sentence wants 223 of them, so a second
                   thing on the row ellipses the reason, and a truncated reason
                   is not a reason. */
                <p className="podcast-dock-refusal">
                  <span className="podcast-dock-refusal-said">Did not arrive. This needed the network.</span>
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
                  {/* A rate control on a song is a control for spoiling it. */}
                  {!isSong && (
                    <button
                      aria-label={`Playback speed ${rateLabel}×. Press to change.`}
                      className="podcast-rate"
                      onClick={cycleRate}
                      type="button"
                    >
                      {rateLabel}×
                    </button>
                  )}
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
            {/* The ticks, fed at last.
                This mechanism has been coded and styled since the first draft
                and drew nothing, because the only array it read was
                `chapters` — which the type itself documents as "currently
                never supplied" and which no call site has ever supplied. Two
                hundred lines away sat the array it wanted: the episode's own
                references, twelve at the median, each with a second on it.
                A publisher's own chapters still win where they exist, for the
                reason they always did; below that, these are the places this
                episode goes. Quiet marks in the fitted accent, not labels —
                the sheet's passage list is where they are named. */}
            {of > 0 && scrubTicks.map((tick) => (
              <span
                aria-hidden="true"
                className="podcast-rail-tick"
                key={tick}
                style={{ left: `${Math.min(100, (tick / of) * 100)}%` }}
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
              /* Dated 2026-07-30. This was a bare `Math.floor(position)`, and
                 while the file is still loading `max` is the `Math.max(1, …)`
                 above — so a resume at 6:19 handed a value of 379 to a range
                 whose maximum was 1, and the engine clamped it to the end.
                 Every resumed episode drew a FINISHED scrubber, thumb hard
                 against the right edge, for the whole time it was reaching:
                 the one moment the reader is being told to wait, told in the
                 same frame that there is nothing left to hear. With no
                 duration there is no position to draw, so it draws none. */
              value={of > 0 ? Math.floor(position) : 0}
            />
          </div>
        </section>
      )}

      {/* ── Where the listening was left ─────────────────────────────────────
          The player has kept the reader's place in the TEXT across a restart
          since the beginning — `lastRead`, written on every chapter turn — and
          kept nothing at all about the voice. Forty minutes into a two-hour
          episode, quit, and the way back was to remember which episode and
          scrub for it.

          It is an OFFER and not a resumption. Nothing is fetched to draw this:
          the title, the publisher and the second came out of the settings
          store, and the publisher's server is not touched until a reader
          presses something — which is the boundary the whole surface is built
          around, and it would be an odd place to break it, restoring audio
          nobody had asked for on a launch nobody had pressed play on.

          Generic treatment on purpose: the name in type, no plate, no
          publisher colour. This is the app remembering something, not the
          publisher announcing themselves on a launch screen. */}
      {resumeShown && heard && (
        <section
          aria-label="Where you were listening"
          className="podcast-resume"
          data-floating-layer="player"
          ref={dockBoxRef}
        >
          <button
            className="podcast-resume-take"
            onClick={resumePodcastHeard}
            type="button"
          >
            <TransportPlayMark className="podcast-resume-mark" paused />
            <span className="podcast-resume-lines">
              <span className="podcast-resume-title">{heard.episode.title}</span>
              <span className="podcast-resume-meta">
                {`Resume · ${formatClock(heard.positionSeconds)}`}
                <span className="podcast-resume-source">{heard.episode.sourceName}</span>
              </span>
            </span>
          </button>
          <button
            aria-label="Forget where I was listening"
            className="podcast-mast-icon podcast-resume-forget"
            onClick={forgetPodcastHeard}
            type="button"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" stroke="currentColor" />
            </svg>
          </button>
        </section>
      )}
    </>
  );
}
