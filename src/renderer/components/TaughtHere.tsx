import type React from "react";
import { useMemo, useState } from "react";
import type { PassageMoment, Proximity } from "../../core/passage-index.js";
import { proximityOf, verseSpan } from "../../core/passage-index.js";
import type { ReferenceRelation } from "../../core/references.js";
import { LISTED_SAID, relationSaid } from "../../core/relation-words.js";
import type { TranscriptBasis } from "../../core/transcripts.js";
import type { RankedTrustedResource } from "../../core/resources/trusted-resources.js";
import type { PodcastEpisode, PodcastPassage, PodcastWalkStop } from "./PodcastPlayer.js";
import {
  TransportPlayMark,
  passageFromBref,
  playPodcastEpisode,
  startPodcastWalk,
  usePodcastNowPlaying,
} from "./PodcastPlayer.js";

/**
 * ONE surface for a chapter's episode audio.
 *
 * There were two, six inches apart, and for the test chapter twenty-five of
 * the twenty-eight episodes appeared on both of them — the same shows, drawn
 * twice, under two mastheads, in two orders, with two brand policies, two play
 * semantics, and identity keys that were the same string. That last one was
 * not a tidiness problem: `playPodcastEpisode` keys on it, so pressing an
 * episode's moment while the same episode ran from its card paused it instead
 * of jumping, and the fix in Build 1 was a patch on a duplication that should
 * not have existed.
 *
 * The two lists were not two lenses. They were one question — "who has taught
 * this chapter" — answered from two files, and the answers agree. So they are
 * one list, and where both files know about an episode the transcript's answer
 * wins, because it is the one carrying a timestamp, a length, a relation and
 * the speaker's own words.
 *
 * WHAT A ROW IS. An entry in a study margin, not a card in a directory. Its
 * grammar is fixed and every row obeys it whichever file it came from:
 *
 *     [play]  Episode title …………………………………… 25 min
 *             [plate]  Romans 8:9–17 · 0:26 · worked through
 *
 * The plate is the publisher — the same object the dock's masthead carries, at
 * the size of a printer's device rather than a masthead. It is the ONLY colour
 * on the row, and it replaces the grey name that used to sit in the meta line,
 * so the line has room for what actually differs between rows.
 *
 * WHAT A ROW SAYS. Every row ends in a relation, in English. The four schema
 * values reached readers as `crossref` and `mention` — 23,169 moments, 56% of
 * the corpus, labelled with a column name — and as an empty span in the dock.
 * See src/core/relation-words.ts, which holds the vocabulary for both surfaces
 * so they cannot drift apart again.
 *
 * RANKED BY SECONDS, AND BY NOTHING ELSE, within each band. That is a finding
 * rather than a default, and the argument is in src/core/passage-index.ts:
 * share-of-episode and relation counts both measure the publisher rather than
 * the passage, and duration is the one quantity whose distribution sits on top
 * of itself across two opposite formats.
 */

/** How many rows a band opens with, and how many each press of "more" adds. */
const PAGE = 25;

/**
 * The walk's own rule, stated here because the control states it to the reader.
 *
 * A minute is the floor because below it a "treatment" is a remark — measured
 * across the corpus a subject runs about eighty seconds against ten for a
 * mention — and twelve is the ceiling because a walk you cannot hold in your
 * head is a radio station. Everything past the twelfth is still one press away
 * in the bands below; it is simply not something the app will start playing on
 * its own.
 */
const WALK_FLOOR_SECONDS = 60;
const WALK_STOPS = 12;

interface Entry {
  /** `${sourceId}:${recordId}` — the one identity key on this surface. */
  key: string;
  sourceId: string;
  sourceName: string;
  recordId: string;
  episode: string;
  audioUrl: string;
  officialUrl: string;
  kind: string;
  /** What the transcript found. Null for a title-level claim. */
  timed: { at: number; seconds: number; relation: ReferenceRelation } | null;
  passage: PodcastPassage;
  /** The passage as this surface says it. */
  label: string;
  /** Which footing the publisher is on, where we transcribe them at all. */
  basis: TranscriptBasis | null;
  proximity: Proximity;
}

function extentOf(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${Math.max(1, Math.round(seconds))}s`;
}

function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/** "Romans 8:9-17" as the corpus writes it, in the app's own punctuation. */
function labelFor(book: string, chapter: number, span: { from: number; to: number } | null): string {
  if (!span) return `${book} ${chapter}`;
  return span.to > span.from
    ? `${book} ${chapter}:${span.from}–${span.to}`
    : `${book} ${chapter}:${span.from}`;
}

function proximityOfSpan(span: { from: number; to: number } | null, verse: number | null): Proximity {
  if (!span) return "whole";
  if (verse == null) return "chapter";
  return verse >= span.from && verse <= span.to ? "on" : "chapter";
}

export function TaughtHere({
  moments,
  records,
  book,
  displayBook,
  chapter,
  verse,
}: {
  moments: readonly PassageMoment[];
  /** The title-level claims that carry audio — the ones that used to be drawn twice. */
  records: readonly RankedTrustedResource[];
  /** The canonical code. The index is keyed on chapter, so every row is here. */
  book: string;
  displayBook: string;
  chapter: number;
  verse: number | null;
}): React.JSX.Element {
  /* Which bands are open, and how far into each one the reader has asked to
     see. Both die with the passage, which is right: how much of Genesis 1 you
     wanted to read through is a fact about one visit. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  const nowPlaying = usePodcastNowPlaying();
  const runningKey = nowPlaying.status === "idle" || nowPlaying.status === "failed"
    ? null
    : nowPlaying.episode?.id ?? null;
  const running = nowPlaying.status === "playing";

  const entries = useMemo<Entry[]>(() => {
    const held = new Map<string, Entry>();
    /* Transcript evidence first, and it is not a preference — a moment knows
       WHERE in the episode, for how long, in what way, and (through the
       episode's reference set) in whose words. A title-level record knows that
       the publisher filed it here. Where both speak, the first answer contains
       the second. */
    for (const moment of moments) {
      const key = `${moment.sourceId}:${moment.id}`;
      if (held.has(key)) continue;
      const span = verseSpan(moment.verses);
      held.set(key, {
        key,
        sourceId: moment.sourceId,
        sourceName: moment.sourceName,
        recordId: moment.id,
        episode: moment.episode,
        audioUrl: moment.audioUrl,
        officialUrl: moment.officialUrl,
        kind: moment.kind,
        timed: { at: moment.at, seconds: moment.seconds, relation: moment.relation },
        /* The moment's OWN verses, so the dock's chip names what is playing
           and a press on it opens that rather than the top of the chapter.
           `verse: null` where the episode took the chapter as a unit, which is
           about a quarter of them — and which must reach the canvas as a
           chapter, not as verse 1, or it collapses the reader's selection. */
        passage: {
          book,
          chapter,
          verse: span ? span.from : null,
          endVerse: span && span.to > span.from ? span.to : null,
          basis: "moment",
        },
        label: labelFor(displayBook, chapter, span),
        basis: moment.basis,
        proximity: proximityOf(moment, verse),
      });
    }
    for (const record of records) {
      const key = `${record.source.id}:${record.record.id}`;
      if (held.has(key) || !record.record.audioUrl) continue;
      const claimed = passageFromBref(record.matchedBref);
      const span = claimed?.verse == null
        ? null
        : { from: claimed.verse, to: claimed.endVerse ?? claimed.verse };
      held.set(key, {
        key,
        sourceId: record.source.id,
        sourceName: record.source.name,
        recordId: record.record.id,
        episode: record.record.title,
        audioUrl: record.record.audioUrl,
        officialUrl: record.record.officialUrl,
        kind: record.record.kind,
        timed: null,
        passage: claimed ?? { book, chapter, verse: null, endVerse: null, basis: "record" },
        label: labelFor(displayBook, chapter, span),
        basis: null,
        proximity: proximityOfSpan(span, verse),
      });
    }
    return [...held.values()];
  }, [book, chapter, displayBook, moments, records, verse]);

  const bands = useMemo(() => [
    {
      key: "on",
      label: verse == null ? "On this chapter" : "On this passage",
      items: verse == null ? [] : entries.filter((entry) => entry.proximity === "on"),
    },
    {
      key: "whole",
      label: "The chapter as a whole",
      items: entries.filter((entry) => entry.proximity === "whole"),
    },
    {
      key: "around",
      label: verse == null ? "Elsewhere in the chapter" : "Around it",
      items: entries.filter((entry) => entry.proximity === "chapter"),
    },
  ].filter((band) => band.items.length > 0).map((band) => ({
    ...band,
    /* Longest first, and a treatment before a claim with no clock on it. */
    items: [...band.items].sort((a, b) => (b.timed?.seconds ?? -1) - (a.timed?.seconds ?? -1)),
  })), [entries, verse]);

  /* ── The walk, and its whole extent, worked out before it is offered ──── */
  const walkStops = useMemo<PodcastWalkStop[]>(() => entries
    .filter((entry) => entry.timed != null && entry.timed.seconds >= WALK_FLOOR_SECONDS)
    .sort((a, b) => b.timed!.seconds - a.timed!.seconds)
    .slice(0, WALK_STOPS)
    .map((entry) => ({
      episode: episodeOf(entry),
      until: entry.timed!.at + entry.timed!.seconds,
      label: entry.label,
    })), [entries]);
  const walkSeconds = useMemo(
    () => entries
      .filter((entry) => entry.timed != null && entry.timed.seconds >= WALK_FLOOR_SECONDS)
      .sort((a, b) => b.timed!.seconds - a.timed!.seconds)
      .slice(0, WALK_STOPS)
      .reduce((total, entry) => total + entry.timed!.seconds, 0),
    [entries],
  );

  /* ── The two footings, counted over what is actually on screen ────────── */
  const footing = useMemo(() => {
    const granted = new Set<string>();
    const unasked = new Set<string>();
    for (const entry of entries) {
      if (entry.basis === "publisher-granted") granted.add(entry.sourceId);
      else if (entry.basis === "public-feed") unasked.add(entry.sourceId);
    }
    return { granted: granted.size, unasked: unasked.size };
  }, [entries]);

  if (entries.length === 0) return <></>;

  const walkHours = Math.floor(walkSeconds / 3600);
  const walkMinutes = Math.round((walkSeconds % 3600) / 60);
  const walkLength = walkHours > 0 ? `${walkHours}h ${walkMinutes}m` : `${walkMinutes}m`;

  const row = (entry: Entry): React.JSX.Element => {
    const isRunning = runningKey === entry.key;
    const said = entry.timed ? relationSaid(entry.timed.relation) : LISTED_SAID;
    return (
      <li key={entry.key}>
        <button
          aria-pressed={isRunning}
          className="taught-here-row"
          data-running={isRunning ? "true" : undefined}
          /* The whole row is the press, and the transport's face sits on it —
             see TransportPlayMark. A 22px circle inside a 300px row would be a
             smaller target than the row containing it, and two controls for
             one offer is two tab stops a reader has to walk past. */
          onClick={() => playPodcastEpisode(episodeOf(entry))}
          type="button"
        >
          <TransportPlayMark className="taught-here-play" paused={!(isRunning && running)} />
          <span className="taught-here-episode">{entry.episode}</span>
          <span className="taught-here-extent">
            {entry.timed ? extentOf(entry.timed.seconds) : entry.kind}
          </span>
          <span className="taught-here-meta">
            {/* The publisher, in the one form the permissions boundary allows
                off their own surface: their colour under their own approved
                mark, or their name in it. See the plate at the dock's mast —
                this is the same object at a colophon's size. */}
            <span className="taught-here-plate" data-source={entry.sourceId}>
              <span className="taught-here-mark">{entry.sourceName}</span>
            </span>
            <span className="taught-here-ref">{entry.label}</span>
            {entry.timed && <span className="taught-here-at">{clockOf(entry.timed.at)}</span>}
            <span className="taught-here-said">{said}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="taught-here" aria-labelledby="taught-here-title">
      <header className="taught-here-masthead">
        <span className="taught-here-kicker">Transcripts and publisher index</span>
        <h3 id="taught-here-title">Taught here</h3>
      </header>

      {/* ── Listen through this chapter ─────────────────────────────────────
          One control, and everything about it is declared before it is
          pressed: how many treatments, in what order, and how long the whole
          thing runs. It plays each treatment's own span and stops at the last
          one. There is no up-next, nothing is chosen for the reader after the
          list they were shown, and it never continues into an episode they did
          not see named here.

          Offered only where there are at least two — a walk of one is an
          episode with extra words on the button. */}
      {walkStops.length > 1 && (
        <button
          aria-label={`Listen through ${displayBook} ${chapter} — ${walkStops.length} treatments, longest first, ${walkLength} in all`}
          className="taught-here-walk"
          onClick={() => startPodcastWalk(`${displayBook} ${chapter}`, walkStops)}
          type="button"
        >
          <TransportPlayMark className="taught-here-play" paused />
          <span className="taught-here-walk-lines">
            <span className="taught-here-walk-title">{`Listen through ${displayBook} ${chapter}`}</span>
            <span className="taught-here-walk-meta">
              {`${walkStops.length} treatments · longest first · ${walkLength}`}
            </span>
          </span>
        </button>
      )}

      {bands.map((band) => {
        const isOpen = open.has(band.key);
        const limit = shown[band.key] ?? PAGE;
        const rest = band.items.length - limit;
        return (
          <div className="taught-here-group" key={band.key} data-open={isOpen}>
            <button
              aria-controls={`taught-here-${band.key}`}
              aria-expanded={isOpen}
              className="taught-here-toggle"
              onClick={() => setOpen((previous) => {
                const next = new Set(previous);
                if (next.has(band.key)) next.delete(band.key); else next.add(band.key);
                return next;
              })}
              type="button"
            >
              <svg aria-hidden="true" className="taught-here-chevron" viewBox="0 0 12 12">
                <path d="M4.5 2.5 8 6l-3.5 3.5" />
              </svg>
              <span className="taught-here-label">{band.label}</span>
              {/* The count is what makes a shut drawer worth reading: it says
                  how much is behind it without spending a row saying so. */}
              <span className="taught-here-count">{band.items.length}</span>
            </button>
            {isOpen && (
              <div id={`taught-here-${band.key}`}>
                <ul className="taught-here-list">
                  {band.items.slice(0, limit).map(row)}
                </ul>
                {/* ── The density answer ───────────────────────────────────
                    Genesis 1 holds 922 moments and this drawer used to show
                    twenty-five of them followed by a plain <li> reading "897
                    more, shortest last" — a sentence shaped like a disclosure
                    with no control under it, in front of 97% of the answer.
                    The stylesheet had a button's worth of rules for a control
                    that had been removed.

                    Two real controls, because there are two real intentions.
                    Another page is a reader still scanning; all of it is a
                    reader who has decided to work through the chapter, and on
                    a list with its own scroll that is a legitimate thing to
                    ask for. Both say the number, and both say the order,
                    because "shortest last" is the only thing that makes a
                    partial list honest. */}
                {rest > 0 && (
                  <div className="taught-here-more-row">
                    <button
                      aria-label={`Show ${Math.min(PAGE, rest)} more of ${rest} remaining, longest first`}
                      className="taught-here-more"
                      onClick={() => setShown((previous) => ({ ...previous, [band.key]: limit + PAGE }))}
                      type="button"
                    >
                      {`${rest} more, shortest last — show ${Math.min(PAGE, rest)}`}
                    </button>
                    {rest > PAGE && (
                      <button
                        aria-label={`Show all ${band.items.length} in this group`}
                        className="taught-here-more is-all"
                        onClick={() => setShown((previous) => ({ ...previous, [band.key]: band.items.length }))}
                        type="button"
                      >
                        all
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── The two footings, at the foot ───────────────────────────────────
          docs/trusted-resource-permissions.md records that the distinction
          between a publisher who granted us their transcripts and one nobody
          has asked yet "must stay visible". Until this build the only places
          it was visible were a TypeScript literal and a test — while 48% of
          everything this surface shows came from the second kind.

          One sentence, at the foot, counted over the shows actually on screen.
          Not a badge on every row: it is a fact about a publisher rather than
          about an episode, and a notice repeated twenty-five times stops being
          read and starts being chrome. The register is the transcript's "auto"
          mark, not a licence agreement. */}
      {(footing.granted > 0 || footing.unasked > 0) && (
        <p className="taught-here-footing">
          {footing.unasked === 0
            ? "Machine-read from published audio, with these publishers' permission."
            : footing.granted === 0
              ? `Machine-read from published audio. ${footing.unasked === 1 ? "This publisher has" : `These ${footing.unasked} publishers have`} not been asked yet.`
              : `Machine-read from published audio. ${footing.granted} of these ${footing.granted + footing.unasked} publishers gave permission; ${footing.unasked} have not been asked yet.`}
        </p>
      )}
    </section>
  );
}

/** What a press hands the transport. One shape, both kinds of row. */
function episodeOf(entry: Entry): PodcastEpisode {
  return {
    id: entry.key,
    sourceId: entry.sourceId,
    recordId: entry.recordId,
    sourceName: entry.sourceName,
    title: entry.episode,
    officialUrl: entry.officialUrl,
    audioUrl: entry.audioUrl,
    /* The passage the launch is ACTUALLY about. All three margin call sites
       used to hand over `bref:v1/${book}.${chapter}.1` — the reader's own
       chapter, at verse 1 — under a chip whose accessible name claimed it was
       "the passage this episode works through". */
    passage: entry.passage,
    kind: entry.kind,
    ...(entry.timed
      ? {
        startAt: entry.timed.at,
        moment: { at: entry.timed.at, seconds: entry.timed.seconds, relation: entry.timed.relation },
      }
      : {}),
  };
}
