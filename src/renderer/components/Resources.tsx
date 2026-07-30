import type React from "react";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { PassageMoment } from "../../core/passage-index.js";
import { verseSpan } from "../../core/passage-index.js";
import type { ReferenceRelation } from "../../core/references.js";
import { LISTED_SAID, relationSaid, relationSpoken } from "../../core/relation-words.js";
import type { TranscriptBasis } from "../../core/transcripts.js";
import type { RankedTrustedResource } from "../../core/resources/trusted-resources.js";
import { safeCall } from "../utils/safeCall.js";
import {
  ResourceKindIcon,
  ResourceLibraryMatrix,
  type ResourceLibraryCatalogue,
} from "./ResourceLibraryMatrix.js";
import { useToast } from "./Toast.js";
import type { PodcastEpisode, PodcastPassage, PodcastWalkStop } from "./PodcastPlayer.js";
import {
  TransportPlayMark,
  passageFromBref,
  playPodcastEpisode,
  startPodcastWalk,
  usePodcastNowPlaying,
} from "./PodcastPlayer.js";

/**
 * RESOURCES — the one room for everything a publisher has said about this
 * chapter.
 *
 * ── What this was, and why it moved · 2026-07-30 ────────────────────────────
 *
 * This file was `TaughtHere`: the merged surface, the third block down the
 * Overview tab. The MERGE was right and is untouched — "Published resources"
 * and "Taught here" were drawing the same episodes twice, 25 of 28 on the test
 * chapter, under two mastheads, in two orders, with two brand policies and
 * identity keys that were the same string. One question, one answer, one key.
 *
 * What was wrong was where the answer lived. A chapter with 922 moments in it
 * (Genesis 1; the median is 18) was being offered through three shut drawers
 * at the bottom of a tab that also holds cross-references, an insight and the
 * reader's own notes — and the drawers paid for that room by hiding almost
 * everything: 25 rows and a sentence in front of 97% of the answer. Density
 * that large is not a disclosure problem. It needs a room.
 *
 * So it has one, and the tab strip gains a fifth lens. Overview keeps a digest
 * of the best few voices and one quiet door through to here.
 *
 * ── The shelf comes back ────────────────────────────────────────────────────
 *
 * The merge deleted more than it meant to. `TrustedResourcesBlock` went from
 * the Overview tab with the duplication, and it took with it the publisher
 * shelf — six full-colour imprints in one glance — the `All` control, the
 * publisher filter, and the route into resource settings. What replaced it was
 * one monochrome plate stamped four times down a column of rows.
 *
 * The shelf is the first thing in this room now, and it is a FILTER rather
 * than a drawer: pressing a publisher narrows the room to their material, and
 * the room is where everything is drawn. One shelf of colour, one filter, and
 * every card below it quiet.
 *
 * ── The cards ───────────────────────────────────────────────────────────────
 *
 * One geometry, in a disciplined two-size family, laid in a grid. A face
 * carries the publisher's identity (their plate, or their name in type where
 * there is no approved mark), the thing's own name, the passage, and how long
 * it runs. Nothing else reaches the face: no relation word, no timestamp, no
 * evidence quote, no byline, no date, no counts, no "N more, shortest last".
 *
 * ABOUTNESS DOES ITS WORK INVISIBLY. Which card is most likely to be the one a
 * reader wants — how the episode treats the passage, how long it stays with
 * it, whether it covers the verse they are actually on — decides ORDER, and in
 * the weighted shape it decides SIZE. It never becomes a label. See
 * `aboutness` below, which is the whole of the ranking and is deliberately one
 * function so it can be read in one sitting.
 *
 * THE DISCOVERY SHAPE IS NOT FROZEN. Three treatments of the same cards and
 * the same ordering live in this file — weight, even and spine — and the
 * reader chooses. `data-discovery-shape` on the document element picks one;
 * the default is what ships. Everything else on this surface is contract.
 */

/**
 * The walk's own rule, stated here because the control states it to a reader.
 *
 * A minute is the floor because below it a "treatment" is a remark — measured
 * across the corpus a subject runs about eighty seconds against ten for a
 * mention — and twelve is the ceiling because a walk you cannot hold in your
 * head is a radio station. Everything past the twelfth is still one press away
 * in the room below; it is simply not something the app will start playing on
 * its own.
 */
const WALK_FLOOR_SECONDS = 60;
const WALK_STOPS = 12;

/** How many voices the Overview digest offers before its door. Four, so the
 * room's two-column grid closes as a square rather than leaving an orphan. */
const DIGEST = 4;

export interface ResourceEntry {
  /** `${sourceId}:${recordId}` — the one identity key on this surface. */
  key: string;
  sourceId: string;
  sourceName: string;
  recordId: string;
  episode: string;
  audioUrl: string;
  officialUrl: string;
  kind: string;
  /** What the transcript found. Null for a title-level claim or a link. */
  timed: { at: number; seconds: number; relation: ReferenceRelation } | null;
  /** True when this is something to read on the publisher's page, not hear. */
  link: boolean;
  passage: PodcastPassage;
  /** The passage as this surface says it. */
  label: string;
  /** The first verse this entry speaks to, for the shapes that use position. */
  atVerse: number | null;
  /** Which footing the publisher is on, where we transcribe them at all. */
  basis: TranscriptBasis | null;
  /** How likely this is to be the one — see `aboutness`. Never printed. */
  weight: number;
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

/**
 * How likely this entry is to be the one the reader wants, as one number.
 *
 * Everything the old surface said out loud is in here instead. The proximity
 * bands — "On this passage", "The chapter as a whole", "Around it" — were
 * three drawers and three counts spending most of a margin to say what an
 * ordering says for free; the relation word on every row said in English what
 * a position says in silence. Both are inputs now, and neither is a label.
 *
 * The four terms, in the order they matter:
 *
 *   TREATMENT · what the episode does with the passage. A subject is an
 *   episode about it; an allusion, a cross-reference and a mention are three
 *   strengths of touching it. Measured over the corpus a subject runs about
 *   eighty seconds against ten for a mention, so this term and the next are
 *   not independent — which is why the first is a multiplier and the second a
 *   curve, rather than two additions pretending to be orthogonal.
 *
 *   LENGTH · how long it stays. Logarithmic: the difference between forty
 *   seconds and four minutes is the whole decision, and the difference between
 *   forty minutes and forty-four is nothing.
 *
 *   PLACE · whether it covers the verse the reader is actually on. This is the
 *   band system's entire content, as a term.
 *
 *   EVIDENCE · a transcript's answer outranks a title-level claim at equal
 *   weight, because it knows where in the episode, for how long, and in whose
 *   words. A link sits below both: it is here to be read, not heard, and a
 *   reader in this room is usually choosing a voice.
 *
 * The app's embedding index would be a fifth term — "what else is this episode
 * about" against "what is this passage about" — and it is deliberately NOT
 * consumed here: the index answers per record, over IPC, and a room that has
 * to make 922 round trips before it can draw is not a room. Recorded as the
 * open question it is rather than half-done.
 */
function aboutness(entry: Omit<ResourceEntry, "weight">, verse: number | null): number {
  const treatment = entry.timed
    ? ({ subject: 3, allusion: 1.8, crossref: 1.5, mention: 1 }[entry.timed.relation] ?? 1)
    : 1.2;
  const seconds = entry.timed?.seconds ?? 0;
  const length = Math.log10(1 + Math.max(0, seconds)) * 1.4;
  const place = verse == null || entry.atVerse == null
    ? 0
    : entry.atVerse === verse
      ? 2
      : Math.max(0, 1.2 - Math.abs(entry.atVerse - verse) / 12);
  const evidence = entry.timed ? 1 : entry.link ? -1.5 : 0;
  return treatment * (1 + length) + place + evidence;
}

/**
 * One list, from three files, keyed once.
 *
 * Transcript evidence first, and it is not a preference — a moment knows WHERE
 * in the episode, for how long, in what way, and (through the episode's
 * reference set) in whose words. A title-level record knows that the publisher
 * filed it here. Where both speak, the first answer contains the second.
 */
export function resourceEntries({
  moments,
  records,
  links,
  book,
  displayBook,
  chapter,
  verse,
}: {
  moments: readonly PassageMoment[];
  records: readonly RankedTrustedResource[];
  links: readonly RankedTrustedResource[];
  book: string;
  displayBook: string;
  chapter: number;
  verse: number | null;
}): ResourceEntry[] {
  const held = new Map<string, Omit<ResourceEntry, "weight">>();
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
      link: false,
      /* The moment's OWN verses, so the dock's chip names what is playing and
         a press on it opens that rather than the top of the chapter.
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
      atVerse: span ? span.from : null,
      basis: moment.basis,
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
      link: false,
      passage: claimed ?? { book, chapter, verse: null, endVerse: null, basis: "record" },
      label: labelFor(displayBook, chapter, span),
      atVerse: span?.from ?? null,
      basis: null,
    });
  }
  /* Things a reader READS, on the publisher's own page. They were a second
     block under a second masthead; they are the same kind of object as an
     episode — a publisher, a passage, an extent — so they take the same card
     and the same key. What differs is what a press does, and that is the one
     thing the face says with a glyph rather than with a word. */
  for (const record of links) {
    const key = `${record.source.id}:${record.record.id}`;
    if (held.has(key)) continue;
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
      audioUrl: "",
      officialUrl: record.record.officialUrl,
      kind: record.record.kind,
      timed: null,
      link: true,
      passage: claimed ?? { book, chapter, verse: null, endVerse: null, basis: "record" },
      label: labelFor(displayBook, chapter, span),
      atVerse: span?.from ?? null,
      basis: null,
    });
  }
  return [...held.values()]
    .map((entry) => ({ ...entry, weight: aboutness(entry, verse) }))
    .sort((left, right) => right.weight - left.weight);
}

/* ── The discovery shape ────────────────────────────────────────────────────
   NOT FROZEN, and the only thing on this surface that is not. How likely
   relevant material should present itself is a question with a taste bar and
   three answers rendered from the same real data; the reader picks one and the
   other two come out.

   It is not a product control and must never become one: no chooser, no
   setting, no persisted preference. `data-discovery-shape` on the document
   element, which the QA tour sets before it captures, and a default that is
   what ships. */
const SHAPES = ["weight", "even", "spine"] as const;
export type DiscoveryShape = (typeof SHAPES)[number];

function readShape(): DiscoveryShape {
  const asked = document.documentElement.dataset["discoveryShape"] ?? "";
  return (SHAPES as readonly string[]).includes(asked) ? (asked as DiscoveryShape) : "weight";
}

export function useDiscoveryShape(): DiscoveryShape {
  return useSyncExternalStore(
    (watcher) => {
      window.addEventListener("quire:discovery-shape", watcher);
      return () => window.removeEventListener("quire:discovery-shape", watcher);
    },
    readShape,
  );
}

/** What a press hands the transport. One shape, both kinds of audio entry. */
function episodeOf(entry: ResourceEntry): PodcastEpisode {
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

/**
 * The card, in both sizes and all three shapes.
 *
 * THE FACE IS A CONTRACT: the publisher's identity, the thing's own name, the
 * passage, and the extent. A fifth thing on this face is a regression rather
 * than an enhancement — the surface it replaces carried six fragments per row
 * and answered none of the four questions it was asked, because a 300px column
 * clipped all of them at once.
 *
 * The publisher's form is the permission boundary's decision rather than a
 * design one, and it is made in the stylesheet where the approved marks live:
 * a source with an approved mark gets the plate — their colour under their own
 * artwork — and every other source gets its name in type and no colour at all.
 * Six of eleven, so the room stays a margin rather than a colour chart.
 */
function ResourceCard({
  entry,
  heavy,
  running,
  playing,
  onOpen,
}: {
  entry: ResourceEntry;
  heavy: boolean;
  running: boolean;
  playing: boolean;
  onOpen: (entry: ResourceEntry) => void;
}): React.JSX.Element {
  const said = entry.timed ? relationSaid(entry.timed.relation) : LISTED_SAID;
  /* The card's own sentence, rather than its four faces read end to end. The
     relation is SPOKEN here and printed nowhere: what a screen reader is owed
     is the claim, and what the face is owed is calm. */
  const spoken = entry.link
    ? `Read ${entry.episode} on ${entry.sourceName} — ${entry.label}, ${entry.kind}. Opens the official page.`
    : entry.timed
      ? `${running ? "Now playing. " : ""}Hear ${entry.episode}, ${entry.sourceName}. ${relationSpoken(entry.timed.relation, entry.label)}, ${extentOf(entry.timed.seconds)} from ${clockOf(entry.timed.at)}.`
      : `${running ? "Now playing. " : ""}Hear ${entry.episode}, ${entry.sourceName}. ${entry.label} is ${said}.`;
  return (
    <li className="resource-card" data-weight={heavy ? "heavy" : "light"}>
      <button
        aria-label={spoken}
        className="resource-card-face"
        data-kind={entry.link ? "read" : "hear"}
        data-running={running ? "true" : undefined}
        onClick={() => onOpen(entry)}
        type="button"
      >
        <span className="resource-card-head">
          {entry.link ? (
            <span aria-hidden="true" className="resource-card-out">
              <ResourceKindIcon kind={entry.kind} />
            </span>
          ) : (
            <TransportPlayMark className="resource-card-play" paused={!(running && playing)} />
          )}
          <span className="taught-here-plate resource-card-plate" data-source={entry.sourceId}>
            <span className="taught-here-mark">{entry.sourceName}</span>
          </span>
        </span>
        <span className="resource-card-title">{entry.episode}</span>
        <span className="resource-card-foot">
          <span className="resource-card-ref">{entry.label}</span>
          <span className="resource-card-extent">
            {entry.timed ? extentOf(entry.timed.seconds) : entry.kind}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The two footings, at the foot, in the reader's language.
 *
 * docs/trusted-resource-permissions.md records that the distinction between a
 * publisher who granted us their transcripts and one nobody has asked "must
 * stay visible". It is one sentence, once, counted over the publishers
 * actually on screen — not a badge on every card, because it is a fact about a
 * publisher rather than about an episode, and a notice repeated twenty-five
 * times stops being read and starts being chrome.
 *
 * RESTATED 2026-07-30. It used to end "1 of these 2 publishers gave
 * permission; 1 has not been asked yet" — our outreach backlog, printed on a
 * reading surface. The distinction survives and the ops language does not: one
 * sentence names a permission, the other names a public feed, and a reader can
 * tell which of the two they are looking at without being handed our to-do
 * list.
 */
export function footingSentence(granted: number, unasked: number): string | null {
  if (granted === 0 && unasked === 0) return null;
  if (unasked === 0) return "Transcripts machine-read from these publishers' audio, with their permission.";
  if (granted === 0) {
    return unasked === 1
      ? "Transcript machine-read from this publisher's public feed."
      : "Transcripts machine-read from these publishers' public feeds.";
  }
  return "Transcripts machine-read from published audio — some with the publisher's permission, some from their public feed.";
}

function footingOf(entries: readonly ResourceEntry[]): { granted: number; unasked: number } {
  const granted = new Set<string>();
  const unasked = new Set<string>();
  for (const entry of entries) {
    if (entry.basis === "publisher-granted") granted.add(entry.sourceId);
    else if (entry.basis === "public-feed") unasked.add(entry.sourceId);
  }
  return { granted: granted.size, unasked: unasked.size };
}

/**
 * The room.
 *
 * Everything a publisher has for this chapter, in one place, at one scale,
 * with a shelf over it and nothing behind a count. Genesis 1's 922 moments are
 * 922 cards here; the room scrolls, `content-visibility` keeps the ones nobody
 * has reached cheap, and the ordering is what makes the first screen the right
 * one.
 */
export function Resources({
  moments,
  records,
  links,
  book,
  displayBook,
  chapter,
  verse,
  loading,
  refusal,
  hiddenCount,
  catalogue,
  onOpenSettings,
  onFiltersChanged,
}: {
  moments: readonly PassageMoment[];
  /** The title-level claims that carry audio. */
  records: readonly RankedTrustedResource[];
  /** Everything else the publisher index holds — things a reader opens. */
  links: readonly RankedTrustedResource[];
  book: string;
  displayBook: string;
  chapter: number;
  verse: number | null;
  loading: boolean;
  refusal: string | null;
  hiddenCount: number;
  catalogue: ResourceLibraryCatalogue | null;
  onOpenSettings?: (() => void) | undefined;
  onFiltersChanged?: (() => void) | undefined;
}): React.JSX.Element {
  const { showToast } = useToast();
  const shape = useDiscoveryShape();
  /* Which publisher the room is narrowed to, and whether the library panel is
     open. Both die with the passage: "just show me Naked Bible" is a glance,
     not a preference. */
  const [only, setOnly] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const nowPlaying = usePodcastNowPlaying();
  const runningKey = nowPlaying.status === "idle" || nowPlaying.status === "failed"
    ? null
    : nowPlaying.episode?.id ?? null;
  const playing = nowPlaying.status === "playing";

  const entries = useMemo(
    () => resourceEntries({ moments, records, links, book, displayBook, chapter, verse }),
    [book, chapter, displayBook, links, moments, records, verse],
  );

  /* The shelf: one chip per publisher, in the order the room is in, so the
     first chip is the publisher the ranking already put first. */
  const shelf = useMemo(() => {
    const order: Array<{ id: string; name: string; count: number }> = [];
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const entry of entries) {
      const held = seen.get(entry.sourceId);
      if (held) { held.count += 1; continue; }
      const chip = { id: entry.sourceId, name: entry.sourceName, count: 1 };
      seen.set(entry.sourceId, chip);
      order.push(chip);
    }
    return order;
  }, [entries]);

  const shown = useMemo(
    () => (only ? entries.filter((entry) => entry.sourceId === only) : entries),
    [entries, only],
  );

  /* ── The walk, and its whole extent, worked out before it is offered ──────
     One pass, because the control has to state a count and a total that are
     facts about the SAME list — two passes with the same filter written twice
     is how a control ends up promising 47 minutes of twelve treatments it is
     not going to play. */
  const walk = useMemo(() => {
    const stops = entries
      .filter((entry) => entry.timed != null && entry.timed.seconds >= WALK_FLOOR_SECONDS)
      .sort((a, b) => b.timed!.seconds - a.timed!.seconds)
      .slice(0, WALK_STOPS);
    return {
      stops: stops.map((entry): PodcastWalkStop => ({
        episode: episodeOf(entry),
        until: entry.timed!.at + entry.timed!.seconds,
        label: entry.label,
      })),
      seconds: stops.reduce((total, entry) => total + entry.timed!.seconds, 0),
    };
  }, [entries]);

  const footing = useMemo(() => footingOf(entries), [entries]);
  const footingLine = footingSentence(footing.granted, footing.unasked);

  const openLink = async (entry: ResourceEntry): Promise<void> => {
    const result = await safeCall(() => window.api.trustedResources.openOfficial(
      entry.sourceId,
      entry.recordId,
      entry.officialUrl,
    ));
    if (!result.ok) showToast("That official resource link could not be opened.", undefined, undefined, { tone: "error" });
  };

  const open = (entry: ResourceEntry): void => {
    if (entry.link) { void openLink(entry); return; }
    playPodcastEpisode(episodeOf(entry));
  };

  const walkStops = walk.stops;
  const walkHours = Math.floor(walk.seconds / 3600);
  const walkMinutes = Math.round((walk.seconds % 3600) / 60);
  const walkLength = walkHours > 0 ? `${walkHours}h ${walkMinutes}m` : `${walkMinutes}m`;

  /* Heavy is the shape of the answer rather than a count of it: the cards that
     genuinely work through this passage take the full width and the rest are
     tiles, so the weight of a chapter is visible before a word is read. Two
     sizes and no more — a size family with three in it is a chart. */
  const heaviest = shown.length > 2
    ? Math.max(...shown.map((entry) => entry.weight))
    : Number.POSITIVE_INFINITY;
  /* Heavy is earned by a treatment, not by being first in a thin list. A
     chapter whose whole shelf is four articles has no treatments in it, and
     four full-width cards would be a claim the data does not make — so the
     size only ever marks a timed answer, and only one within three quarters of
     a point of the best. */
  const isHeavy = (entry: ResourceEntry): boolean => shape === "weight"
    && entry.timed != null
    && entry.weight >= heaviest - 0.75;

  /* The spine: the chapter itself as the order. Cards hang off the verse they
     speak to, so reading down the room is reading down the chapter — nothing
     is banded, nothing is collapsed, and the ordering inside a stop is the
     same aboutness the other two shapes use. */
  const stops = useMemo(() => {
    if (shape !== "spine") return [];
    const byVerse = new Map<number, ResourceEntry[]>();
    for (const entry of shown) {
      const at = entry.atVerse ?? 0;
      const held = byVerse.get(at);
      if (held) held.push(entry); else byVerse.set(at, [entry]);
    }
    return [...byVerse.entries()].sort((left, right) => left[0] - right[0]);
  }, [shape, shown]);

  return (
    <section className="resources" aria-labelledby="resources-title">
      <h3 className="sr-only" id="resources-title">{`Resources for ${displayBook} ${chapter}`}</h3>

      {/* ── The shelf ────────────────────────────────────────────────────────
          Six publishers in one glance, in their own colours, with their own
          marks — and the filter and the settings route that went missing with
          the merge. A chip is a publisher, not a record: pressing one narrows
          the room to their material and pressing it again gives the room
          back. */}
      {shelf.length > 0 && (
        <div className="trusted-resource-imprints resource-shelf" role="group" aria-label="Publishers on this passage">
          {shelf.map((chip) => (
            <button
              aria-label={`${chip.name} — ${chip.count} ${chip.count === 1 ? "item" : "items"} for this passage`}
              aria-pressed={only === chip.id}
              className="trusted-resource-imprint"
              data-source={chip.id}
              key={chip.id}
              onClick={() => setOnly(only === chip.id ? null : chip.id)}
              type="button"
            >
              <span className="trusted-resource-source">{chip.name}</span>
              {chip.count > 1 && <span className="trusted-resource-imprint-count">{chip.count}</span>}
            </button>
          ))}
          {only !== null && (
            <button
              aria-label={`All ${entries.length} for this passage`}
              className="trusted-resource-imprint is-all"
              onClick={() => setOnly(null)}
              type="button"
            >
              <span className="trusted-resource-source">All</span>
              <span className="trusted-resource-imprint-count">{entries.length}</span>
            </button>
          )}
          {/* The shelf raises the question of who these publishers are, and the
              answer lives in settings — so the way there is a chip in the same
              row rather than a hunt through a menu. */}
          <button
            aria-expanded={library}
            aria-label={(catalogue?.mutes.length ?? 0) > 0
              ? `Your library — ${catalogue?.mutes.length} muted`
              : "Choose what your library offers"}
            className="trusted-resource-imprint is-settings"
            data-muted={(catalogue?.mutes.length ?? 0) > 0}
            onClick={() => setLibrary(!library)}
            title={(catalogue?.mutes.length ?? 0) > 0
              ? `Your library — ${catalogue?.mutes.length} muted`
              : "Choose what your library offers"}
            type="button"
          >
            <span className="trusted-resource-source" aria-hidden="true">
              {/* Sliders, not a cog: at 13px a cog's teeth close up into a sun.
                  Three rows with a knob each also happens to be what the panel
                  behind it actually is. */}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4">
                  <path d="M2.2 4.2h11.6M2.2 8h11.6M2.2 11.8h11.6" />
                  <circle cx="5.6" cy="4.2" r="1.6" fill="var(--bg-reading)" />
                  <circle cx="10.4" cy="8" r="1.6" fill="var(--bg-reading)" />
                  <circle cx="6.6" cy="11.8" r="1.6" fill="var(--bg-reading)" />
                </g>
              </svg>
            </span>
          </button>
        </div>
      )}

      {library && (
        <div className="trusted-resource-library">
          <p className="trusted-resource-library-lead">Your library, everywhere — not just this passage.</p>
          <ResourceLibraryMatrix
            catalogue={catalogue}
            onChanged={() => onFiltersChanged?.()}
            onFailed={(message) => showToast(message, undefined, undefined, { tone: "error" })}
          />
          {onOpenSettings && (
            <button className="trusted-resource-library-more" onClick={onOpenSettings} type="button">
              Open in settings <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      {loading && <p className="trusted-resources-status" role="status">Checking local resource manifests…</p>}
      {refusal && <p className="trusted-resources-status is-refusal" role="status">Published resources unavailable: {refusal}</p>}

      {/* ── Listen through this chapter ──────────────────────────────────────
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

      {shape === "spine" ? (
        <div className="resource-room" data-discovery="spine">
          {stops.map(([at, cards]) => (
            <div className="resource-stop" key={at}>
              <span aria-hidden="true" className="resource-stop-mark">
                {at === 0 ? "ch." : at}
              </span>
              <ul className="resource-grid">
                {cards.map((entry) => (
                  <ResourceCard
                    entry={entry}
                    heavy={false}
                    key={entry.key}
                    onOpen={open}
                    playing={playing}
                    running={runningKey === entry.key}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="resource-room" data-discovery={shape}>
          <ul className="resource-grid">
            {shown.map((entry) => (
              <ResourceCard
                entry={entry}
                heavy={isHeavy(entry)}
                key={entry.key}
                onOpen={open}
                playing={playing}
                running={runningKey === entry.key}
              />
            ))}
          </ul>
        </div>
      )}

      {!loading && !refusal && entries.length === 0 && (
        <p className="trusted-resources-status" role="status">
          {hiddenCount > 0
            ? "Every source that matches this passage is switched off in settings."
            : "Nobody in your library has taught this chapter yet."}
        </p>
      )}

      {hiddenCount > 0 && entries.length > 0 && (
        <p className="trusted-resource-more-hidden">{`${hiddenCount} hidden by your settings`}</p>
      )}

      {footingLine && <p className="taught-here-footing">{footingLine}</p>}
    </section>
  );
}

/**
 * The digest, and the door.
 *
 * Overview breathes. It used to carry the whole merged surface — a masthead, a
 * walk, three drawers and a footing — as its third block, under an insight and
 * a cross-reference list, which is a large part of why that surface had to
 * hide 97% of itself to fit. It carries the best few voices now, on the same
 * card the room uses, and one quiet door.
 *
 * The door names the room rather than a number: a count here would be the
 * inventory language the room exists to stop.
 */
export function ResourcesDigest({
  moments,
  records,
  book,
  displayBook,
  chapter,
  verse,
  onOpen,
}: {
  moments: readonly PassageMoment[];
  records: readonly RankedTrustedResource[];
  book: string;
  displayBook: string;
  chapter: number;
  verse: number | null;
  onOpen: () => void;
}): React.JSX.Element {
  const nowPlaying = usePodcastNowPlaying();
  const runningKey = nowPlaying.status === "idle" || nowPlaying.status === "failed"
    ? null
    : nowPlaying.episode?.id ?? null;
  const playing = nowPlaying.status === "playing";
  const entries = useMemo(
    () => resourceEntries({ moments, records, links: [], book, displayBook, chapter, verse }),
    [book, chapter, displayBook, moments, records, verse],
  );
  if (entries.length === 0) return <></>;
  return (
    <section className="resources-digest" aria-labelledby="resources-digest-title">
      <header className="taught-here-masthead">
        <span className="taught-here-kicker">From the transcripts</span>
        <h3 id="resources-digest-title">Taught here</h3>
      </header>
      <div className="resource-room" data-discovery="digest">
        <ul className="resource-grid">
          {entries.slice(0, DIGEST).map((entry) => (
            <ResourceCard
              entry={entry}
              heavy={false}
              key={entry.key}
              onOpen={(chosen) => playPodcastEpisode(episodeOf(chosen))}
              playing={playing}
              running={runningKey === entry.key}
            />
          ))}
        </ul>
      </div>
      <button className="resources-door" onClick={onOpen} type="button">
        {`Everything on ${displayBook} ${chapter}`}
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
