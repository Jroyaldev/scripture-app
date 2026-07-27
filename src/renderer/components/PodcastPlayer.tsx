import type React from "react";
import { useState, useSyncExternalStore } from "react";
import type { BookNameData } from "../api.js";
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

function episodePassageLabel(passage: EpisodePassage, bookNames: BookNameData): string {
  const name = bookNames[passage.book]?.[0] ?? passage.book;
  return passage.endChapter > passage.chapter
    ? `${name} ${passage.chapter}–${passage.endChapter}`
    : `${name} ${passage.chapter}`;
}

function PlayGlyph({ paused }: { paused: boolean }): React.JSX.Element {
  return paused ? (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
      <path d="M5.4 3.4 14.4 9l-9 5.6z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
      <path d="M5.6 3.6h2.5v10.8H5.6zM9.9 3.6h2.5v10.8H9.9z" fill="currentColor" />
    </svg>
  );
}

/** An arrow bent round the interval it moves, with the interval inside it. */
function SkipGlyph({ seconds }: { seconds: number }): React.JSX.Element {
  const back = seconds < 0;
  return (
    <svg viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
        transform={back ? undefined : "scale(-1 1) translate(-22 0)"}
      >
        <path d="M11 4.4A6.6 6.6 0 1 0 17.6 11" />
        <path d="M11 1.6 8.3 4.4 11 7.2" />
      </g>
      <text
        x="11"
        y="14.6"
        fill="currentColor"
        fontSize="7.4"
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

          <header className="podcast-dock-head">
            <span aria-hidden="true" className="podcast-dock-imprint" />
            <span className="podcast-dock-publisher">{episode.sourceName}</span>
            {passage && (
              <button
                aria-label={`Read ${episodePassageLabel(passage, bookNames)}, the passage this episode works through`}
                className="podcast-dock-passage"
                onClick={() => void onNavigate(
                  passage.book,
                  passage.chapter,
                  passage.verse,
                  passage.endChapter === passage.chapter ? passage.endVerse : undefined,
                )}
                type="button"
              >
                {episodePassageLabel(passage, bookNames)}
              </button>
            )}
            <button
              aria-label={`Open ${episode.title} at ${episode.sourceName} — opens the official page`}
              className="podcast-dock-icon"
              onClick={() => void openOfficial()}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4">
                  <path d="M6 3.4H3.4v9.2h9.2V10" />
                  <path d="M9.4 3.4h3.2v3.2M12.6 3.4 7.4 8.6" />
                </g>
              </svg>
            </button>
            <button
              aria-label={`Stop ${episode.title} and close the player`}
              className="podcast-dock-icon"
              onClick={stopPodcast}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
              </svg>
            </button>
          </header>

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
              <p className="podcast-dock-title" title={episode.title}>{episode.title}</p>
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
                  <span className="podcast-dock-clock-rest">
                    {of > 0 ? `−${formatClock(of - position)}` : "—:—"}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="podcast-rail">
            {/* One loading device in this app, and it is a segment travelling a
                hairline. The rail is already a hairline, so it says "reaching
                the publisher" without a second device appearing to say it. */}
            {status === "reaching" && of <= 0 && <span aria-hidden="true" className="podcast-rail-reaching" />}
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
