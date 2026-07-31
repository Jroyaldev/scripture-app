import type React from "react";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
 * ── THE MARK IS ON EVERY CARD · REVERSED 2026-07-30 ─────────────────────────
 *
 * The rule this replaces ran one build. It is quoted whole because a contract
 * that is reversed without its own words on the page is a contract nobody can
 * argue with later:
 *
 *   "The publisher is stated ONCE PER RUN. … The plate does not leave the face
 *   and the brand does not go quiet: the first card of a run carries the
 *   publisher's plate whole, and the cards that follow carry the SAME PLATE
 *   reduced to its ground … So a run reads as one publisher's column of colour
 *   with one wordmark at its head, which is what a printed page does with a
 *   running imprint."
 *
 * The reader read it on screen and rejected it: "i dont like how some lose the
 * logo it just confuses. logo on every is better." That settles it — a mark
 * that is present on some cards and withdrawn on others makes the reader ask
 * what the difference MEANS, and the answer ("the card above happened to be the
 * same publisher") is not worth a question. Identity is a trust instrument and
 * trust does not take turns. Every card carries its publisher's mark.
 *
 * The redundancy the run rule was solving is real, and it is solved in the
 * other four currencies instead — all of them in the stylesheet:
 *
 *   SCALE · the plate is the only thing on the card's first line now. The 20px
 *     transport disc that used to sit beside it moved to the foot, where it
 *     belongs to the extent it acts on, so the head is a colophon rather than
 *     two marks arguing.
 *   HIERARCHY · the ground carries the publisher and the plate confirms them,
 *     so the plate no longer has to be the whole of the identity.
 *   RHYTHM · one plate at one x on every card, and a foot that aligns across a
 *     row, so a column of them is a rule rather than a rash.
 *   SPACING · the gutter and the card's own padding both went up; air is what
 *     separates marks.
 *
 * The publisher's FORM is still the permission boundary's decision rather than
 * a design one, and it is still made in the stylesheet where the approved marks
 * live: a source with an approved mark gets the plate — their colour under
 * their own artwork — and a source without one gets its name in type. What is
 * no longer true is that a source without a mark takes no colour at all: the
 * card's ground is an homage to their hue either way, which is what finally
 * closes the gap between the two forms. See the ground note in styles.css.
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
    /* The publisher moves to the CARD, and it is the card that needs it: the
       ground is derived from `--resource-source`, and the face below re-declares
       that property as the app's own gold so the transport mark on it stays the
       app's voice rather than the publisher's. Two scopes, one attribute, and
       the division is the point — the ground is whose material this is, the
       transport is whose app this is. */
    <li
      className="resource-card"
      data-source={entry.sourceId}
      data-weight={heavy ? "heavy" : "light"}
    >
      <button
        aria-label={spoken}
        className="resource-card-face"
        data-kind={entry.link ? "read" : "hear"}
        data-running={running ? "true" : undefined}
        onClick={() => onOpen(entry)}
        type="button"
      >
        {/* The head is the colophon and nothing else. Every card carries it —
            see the reversal note above. */}
        <span className="taught-here-plate resource-card-plate" data-source={entry.sourceId}>
          <span className="taught-here-mark">{entry.sourceName}</span>
        </span>
        <span className="resource-card-title">{entry.episode}</span>
        {/* The foot is the passage on the left and, on the right, what a press
            will do to it. The transport mark sits against the extent it acts
            on rather than up in the head against the publisher's plate: one
            mark per line, and the loudest thing on the card is no longer a
            20px disc of amber repeated nine hundred times. */}
        <span className="resource-card-foot">
          <span className="resource-card-ref">{entry.label}</span>
          <span className="resource-card-tail">
            {entry.link ? (
              <span aria-hidden="true" className="resource-card-out">
                <ResourceKindIcon kind={entry.kind} />
              </span>
            ) : (
              <TransportPlayMark className="resource-card-play" paused={!(running && playing)} />
            )}
            <span className="resource-card-extent">
              {entry.timed ? extentOf(entry.timed.seconds) : entry.kind}
            </span>
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

/* ── THE PACKING OF THE REGISTER · 2026-07-31 ────────────────────────────────
 *
 * WHAT THE READER ASKED, looking at Genesis 6's shelf: "why do these stack
 * differently; what decides; how come we're not optimizing for gap placement
 * and how to have no gaps when 2 small can go together or when not to stretch
 * one out". Three questions, and the third one is the answer to the first two.
 *
 * WHAT DECIDED, until this. Nothing did. The register's geometry is a floor —
 * `min-width: calc(50% - gap/2)` on a growing flex item, see `.resource-shelf`
 * in styles.css — so a plate is one track wide or two, and flexbox then broke
 * the ranking into lines the way it breaks any sequence: greedily, left to
 * right, with no sight of what comes next. Two consequences, both of them
 * things the reader could see and neither of them decided by anybody:
 *
 *   · A HOLE. A one-track plate whose next-ranked neighbour needs two tracks
 *     is alone on its line with the other half of the line empty — on Genesis 6
 *     that stranded BibleProject at the very top of the register and Naked
 *     Bible in the middle of it, while Spoken Gospel + Radically Christian and
 *     TGC + Working Preacher paired for no reason except that rank happened to
 *     stand them next to each other. Luck of adjacency is not a rhythm.
 *   · A STRETCH. Worse, and invisible as a fault: a plate whose identity is a
 *     NAME still grew, so a one-track publisher alone on a line silently
 *     became a two-track slab. Radically Christian is one track on Genesis 1
 *     and was two on Romans 5 — the same publisher, the same name, at two
 *     different widths, because of who happened to be ranked above it.
 *
 * Flexbox cannot look ahead, so a line-breaker that can is the only place this
 * can be fixed. The floor stays exactly as it was: CSS is still what makes a
 * track real, and this pass only decides the ORDER the floor is handed.
 *
 * ── THE RULE, IN PLAIN WORDS ────────────────────────────────────────────────
 *
 * A row is two tracks. Walk the ranking:
 *
 *   1. A TWO-TRACK PLATE TAKES A ROW OF ITS OWN. It earned both tracks by not
 *      fitting one, and nothing is ellipsed to make it fit.
 *   2. A ONE-TRACK PLATE WANTS A PARTNER. The next plate in rank, if that is
 *      also one track; otherwise the NEAREST LATER one-track plate, provided
 *      it is no more than three places further down the ranking.
 *   3. IF THERE IS NONE WITHIN THREE, THE PLATE KEEPS ITS SINGLE TRACK and the
 *      row keeps its gap. Nothing is stretched to fill a row it did not earn —
 *      that is the reader's second condition, and it is the half of this that
 *      lives in styles.css (`[data-tracks="1"] { flex-grow: 0 }`).
 *
 * ── WHY THREE, AND WHY BOUNDED AT ALL ───────────────────────────────────────
 *
 * Unbounded, this stops being a ranking and becomes a shape: sort eleven
 * publishers by width and the register is a tidy arrangement of colour that no
 * longer says who is first. So the lift is bounded, and the bound is three:
 *
 *   · ONE (that is, only the immediate neighbour) is the behaviour this
 *     replaces. It can never fix anything, because the orphan is by definition
 *     the plate whose neighbour is wide.
 *   · THREE is the longest unbroken RUN of two-track publishers the corpus
 *     produces. Measured 2026-07-31 across Genesis 1, Genesis 6, 1 Samuel 30,
 *     Acts 19, Romans 5, Psalm 23 and Jude: the longest run is three — Genesis
 *     6's 40 Minutes / Ask N.T. Wright / The Listener's Commentary. A lift of
 *     three clears every run in the corpus; a lift of four clears nothing that
 *     three did not, on any of the seven.
 *   · AND THE RANKING SURVIVES INSIDE EACH WIDTH. The search takes the FIRST
 *     one-track plate it finds, so a plate is only ever lifted past plates of
 *     the OTHER width — never past another one-track plate. The one-track
 *     publishers therefore stay in rank order among themselves, and so do the
 *     two-track ones. Only the interleaving of the two gives, which is the
 *     smallest thing that could have given. The first plate on the shelf is
 *     still the publisher the ranking put first, always: rule 1 and rule 2 both
 *     begin by taking the head of the queue.
 *
 * Measured on the same seven chapters: six of the seven come out in EXACTLY
 * rank order or with one plate moved one place; the two that pay three places
 * are Genesis 6 (Spoken Gospel, 5th → 2nd) and Jude (TGC, 8th → 5th), and both
 * of those buy back a hole at the top of the register.
 *
 * ── ODD COUNTS, AND THE END OF THE SHELF ────────────────────────────────────
 *
 * An odd number of one-track plates leaves exactly one of them without a
 * partner. That is arithmetic and not a packing failure — no ordering of an
 * odd number of half-width things fills every row — and the count of lone rows
 * always has the same parity as the count of one-track plates. Every one of
 * the seven chapters sampled has an odd count, so the register always ends
 * with one plate that has no partner.
 *
 * The walk leaves it LAST, because it pairs greedily from the top and the only
 * plate left over is the last one-track plate in the ranking. A single plate on
 * the final row is not a hole: it is a short last line, which is what the last
 * line of a set paragraph is, and stretching it would break the reader's other
 * condition to satisfy this one. Before this pass Genesis 6 had three holes and
 * two of them were interior; after it there is one, at the foot.
 */
export const SHELF_LIFT = 3;

/** How many tracks a plate occupies. Measured from the DOM — see `shelfTracks`. */
export type ShelfTracks = 1 | 2;

/**
 * The line-breaking pass. Pure, and exported so `tests/resource-shelf-packing`
 * can hold the rule above against the compositions it was written for.
 *
 * `lift` is the bound defended above and is a parameter only so the test can
 * show what other bounds would have done.
 */
export function packShelf<T>(
  ranked: readonly T[],
  tracksOf: (chip: T) => ShelfTracks,
  lift: number = SHELF_LIFT,
): T[] {
  const queue = [...ranked];
  const packed: T[] = [];
  while (queue.length > 0) {
    const head = queue.shift() as T;
    packed.push(head);
    // Rule 1: a two-track plate has the whole row and takes nothing with it.
    if (tracksOf(head) === 2) continue;
    /* Rules 2 and 3: the nearest later one-track plate within the bound. `at`
       is exactly how many places that plate is lifted, so `at <= lift` IS the
       bound — and the loop stops at the first one-track plate it meets, which
       is what keeps a plate from ever being lifted past its own width. */
    const furthest = Math.min(lift, queue.length - 1);
    for (let at = 0; at <= furthest; at += 1) {
      if (tracksOf(queue[at] as T) !== 1) continue;
      packed.push(...queue.splice(at, 1));
      break;
    }
  }
  return packed;
}

/**
 * How wide each publisher's plate wants to be, in tracks, read off the running
 * engine.
 *
 * IT HAS TO BE MEASURED, and this is the whole reason the pass needs a layout
 * effect rather than a memo. A plate is two tracks when its own content will
 * not fit one, and what its content is worth is decided by the stylesheet: the
 * name's size comes off a clamped ramp on `--imprint-measure`, the mark's off
 * the publisher's declared aspect ratio, the tally is one or two digits, and
 * the track itself is half of whatever width the study column happens to have.
 * Every one of those is a number this file deliberately does not know — the
 * ramp "is the stylesheet's", as the comment on the plate says — and a second
 * copy of them here is the kind of duplicate that goes quietly wrong.
 *
 * So the plates are asked. `data-sizing` on the shelf drops the track floor for
 * one synchronous beat (see styles.css), every plate reports its natural width,
 * and the floor goes straight back on — inside `useLayoutEffect`, so nothing is
 * ever painted in the sizing state. Natural width does not depend on where a
 * plate sits, so the measurement cannot oscillate with the order it feeds.
 */
function measureShelfTracks(shelf: HTMLElement): Map<string, ShelfTracks> {
  const gap = Number.parseFloat(getComputedStyle(shelf).columnGap) || 0;
  const track = (shelf.getBoundingClientRect().width - gap) / 2;
  const plates = [...shelf.querySelectorAll<HTMLElement>(".trusted-resource-imprint")];
  shelf.dataset["sizing"] = "true";
  const widths = plates.map((plate) => plate.getBoundingClientRect().width);
  delete shelf.dataset["sizing"];
  const tracks = new Map<string, ShelfTracks>();
  plates.forEach((plate, at) => {
    const source = plate.dataset["source"];
    /* Half a pixel of tolerance, not none: a track is half of a fractional
       width and a plate's own width is fractional too, so an exact `>` turns a
       plate that fits into a plate that does not on some window widths. */
    if (source) tracks.set(source, (widths[at] ?? 0) > track + 0.5 ? 2 : 1);
  });
  return tracks;
}

function sameTracks(left: ReadonlyMap<string, ShelfTracks>, right: ReadonlyMap<string, ShelfTracks>): boolean {
  if (left.size !== right.size) return false;
  for (const [source, tracks] of left) if (right.get(source) !== tracks) return false;
  return true;
}

const NO_TRACKS: ReadonlyMap<string, ShelfTracks> = new Map();

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
     first chip is the publisher the ranking already put first. This is the
     RANKING — what the packing pass below treats as intent and never as a
     licence to sort. */
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

  /* ── The register's line-breaker ────────────────────────────────────────
     The rule and its defence are at `packShelf` above; this is only the
     plumbing that gets it the one fact it cannot compute — how many tracks
     each plate wants — and re-asks whenever the column changes width, because
     a track is half the column and a name that fits one at 332px need not at
     240. Measurement happens in a layout effect and is idempotent, so the
     first paint is already the packed one and the second measurement stops. */
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const [tracks, setTracks] = useState<ReadonlyMap<string, ShelfTracks>>(NO_TRACKS);
  const shelfKey = shelf.map((chip) => `${chip.id}:${chip.count}`).join(" ");
  useLayoutEffect(() => {
    const element = shelfRef.current;
    if (!element) { setTracks(NO_TRACKS); return; }
    /* The guard is not paranoia: the sizing beat changes the shelf's own
       height, and an observer that answered its own measurement would measure
       forever. */
    let measuring = false;
    const remeasure = (): void => {
      if (measuring) return;
      measuring = true;
      const next = measureShelfTracks(element);
      measuring = false;
      setTracks((held) => (sameTracks(held, next) ? held : next));
    };
    remeasure();
    const observer = new ResizeObserver(remeasure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shelfKey]);

  /* Until every plate has been measured the shelf is the ranking, untouched —
     which is the behaviour this replaces, and the right thing to fall back to.
     A half-measured shelf would pack against widths it had guessed. */
  const register = useMemo(() => {
    const ranked = shelf.map((chip, rank) => ({ chip, rank, tracks: tracks.get(chip.id) ?? null }));
    if (ranked.some((plate) => plate.tracks === null)) return ranked;
    return packShelf(ranked, (plate) => plate.tracks as ShelfTracks);
  }, [shelf, tracks]);

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
  /* ── What the walk offers, in the app's own voice ────────────────────────
     RESTATED 2026-07-30. It read "12 treatments · longest first · 5h 42m" — an
     inventory chain of three specifications with the reader's decision nowhere
     in it. Everything true about that line is still here and the scale is not
     softened: how many, that the fullest come first, and how long the whole
     thing runs. What is added is the only fact a reader actually needs before
     pressing a five-hour button, which the spec line never said — that they
     are not committing to it. Said once, in one sentence, on the control that
     starts it. */
  const walkOffer = `The ${walkStops.length} fullest, end to end — about ${walkLength}. Leave it whenever you like.`;
  const walkSpoken = `Listen through ${displayBook} ${chapter} — the ${walkStops.length} fullest treatments, end to end, about ${walkLength}. Leave it whenever you like.`;

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
          Every publisher who has taught this chapter, in one glance, in their
          own colours and with their own marks — and the filter and the settings
          route that went missing with the merge. A plate is a publisher, not a
          record: pressing one narrows the room to their material and pressing
          it again gives the room back.

          ── THE REGISTER · 2026-07-30 (third recomposition) ──────────────────

          The two forms this replaces are both quoted, because the third answer
          is only legible against the two that failed.

            1. "30px full-round pills laid in a wrapping flex row under a 47%
               cap" — a candy rack, and the cap was what made it read as a
               rigid two-wide stack rather than as a wrapped paragraph.
            2. "the shelf is JUSTIFIED: every plate is as wide as the publisher
               it names, and the plates on a row divide that row's whole width
               between them. Ragged inside, flush at both edges." Flush at the
               edges and arbitrary everywhere else: one plate on a row, then
               two, then three, at eleven different widths, with the tallies at
               eleven different x. A 332px slab of brick with 200px of empty
               brick in it is not more brand than a plate the size of its own
               mark — it is a highlighter bar, and it is why the shelf read as
               a chart of colour while the cards beneath it read as a room.

          A grid of equal cells was tried between them and rejected for the
          right reason, which still stands: half a 380px panel does not hold
          "40 Minutes in the Old Testament", and a publisher is either legible
          or absent.

          THE THIRD ANSWER IS QUANTISATION RATHER THAN JUSTIFICATION. The shelf
          is a two-track register: an imprint is either exactly one track wide
          or exactly two, never anything between, and nothing is ellipsed to
          make it so — the long names simply take both tracks. So every left
          edge lands on one of two x, every right edge on one of two, and the
          tallies fall into two true numeral columns. The rhythm is modular
          instead of accidental, and no publisher is dropped to buy it. The
          mechanism is one line of CSS (`min-width: calc(50% - gap/2)` on a
          flex item). See `.resource-shelf` in styles.css.

          RESTATED 2026-07-31. This note ended "so nothing is reordered and no
          cell is left empty", and the second half of that was never true:
          flexbox breaks lines with no sight of what comes next, so a one-track
          plate whose next-ranked neighbour needed two tracks sat alone with
          half its row empty — and a one-track plate alone on a row grew into a
          slab it had not earned. Both are now decided by a bounded
          line-breaking pass over the ranking, written out in full at
          `packShelf` above: rank is the intent, a plate is never lifted more
          than three places nor past another plate of its own width, and a plate
          fills the tracks it earned and no more.

          THE FILTER SAYS SO NOW. Every plate looked equally "on", the way back
          to all was a chip that appeared mid-shelf and pushed the row it
          landed in, and the settings route was an outlined pill sitting among
          filled plates looking like a publisher that failed to load. Both
          leave the register: the head above it is the shelf's own status line
          — what is showing on the left, the way back and the way into the
          library on the right, in the app's quiet action voice — and the
          register below is publishers and nothing else. */}
      {shelf.length > 0 && (
        <div className="resource-shelf-block">
          <div className="resource-shelf-head">
            <p className="resource-shelf-kicker">
              {only === null
                ? "Publishers on this passage"
                : `Showing ${shelf.find((chip) => chip.id === only)?.name ?? "one publisher"}`}
            </p>
            <div className="resource-shelf-actions">
              {only !== null && (
                <button
                  /* The tally is in the accessible name and not on the face.
                     The head is 332px holding three things at nine pixels, and
                     "Show all 956" is what put the publisher's own name into
                     an ellipsis — which is the one thing this shelf may never
                     do. A number here would also be the room's own inventory
                     voice arriving in the app's quietest line. */
                  aria-label={`Show all ${entries.length} for this passage`}
                  className="resource-shelf-action"
                  onClick={() => setOnly(null)}
                  type="button"
                >
                  Show all
                </button>
              )}
              {/* The shelf raises the question of who these publishers are, and
                  the answer lives in settings — so the way there is the shelf's
                  own head rather than a hunt through a menu, and rather than a
                  twelfth cell in a row of eleven publishers. */}
              <button
                aria-expanded={library}
                aria-label={(catalogue?.mutes.length ?? 0) > 0
                  ? `Your library — ${catalogue?.mutes.length} muted`
                  : "Choose what your library offers"}
                className="resource-shelf-action is-library"
                data-muted={(catalogue?.mutes.length ?? 0) > 0}
                onClick={() => setLibrary(!library)}
                title={(catalogue?.mutes.length ?? 0) > 0
                  ? `Your library — ${catalogue?.mutes.length} muted`
                  : "Choose what your library offers"}
                type="button"
              >
                {/* Sliders, not a cog: at 13px a cog's teeth close up into a
                    sun. Three rows with a knob each also happens to be what the
                    panel behind it actually is. */}
                <svg className="resource-shelf-sliders" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4">
                    <path d="M2.2 4.2h11.6M2.2 8h11.6M2.2 11.8h11.6" />
                    <circle cx="5.6" cy="4.2" r="1.6" fill="var(--bg-reading)" />
                    <circle cx="10.4" cy="8" r="1.6" fill="var(--bg-reading)" />
                    <circle cx="6.6" cy="11.8" r="1.6" fill="var(--bg-reading)" />
                  </g>
                </svg>
                <span aria-hidden="true">Your library</span>
              </button>
            </div>
          </div>
          <div className="trusted-resource-imprints resource-shelf" ref={shelfRef} role="group" aria-label="Publishers on this passage">
            {register.map(({ chip, rank, tracks: wide }) => (
              <button
                aria-label={`${chip.name} — ${chip.count} ${chip.count === 1 ? "item" : "items"} for this passage`}
                aria-pressed={only === chip.id}
                className="trusted-resource-imprint"
                /* The ranking, on the plate. The reader will ask what decides
                   the order again, and a register whose rank is only in this
                   file's memo cannot answer; with this, the answer is in the
                   engine and `qa:player` can hold the packing rule against it
                   without being told the ranking twice. */
                data-rank={rank}
                data-source={chip.id}
                {...(wide === null ? {} : { "data-tracks": wide })}
                key={chip.id}
                onClick={() => setOnly(only === chip.id ? null : chip.id)}
                /* THE OPTICAL SIZE OF A NAME, which is the other half of the
                   two-species problem. A shelf of logos has no nominal size:
                   "TGC" and "40 Minutes in the Old Testament" do not read as
                   one family at one point size, because a wordmark's weight is
                   its INK, not its height. The marks are normalised against
                   their own aspect ratio in the stylesheet; a name has no
                   ratio, so its one measurable is its length, and it is handed
                   over here because CSS cannot count characters. The ramp
                   itself — what a character is worth — is the stylesheet's. */
                style={{ "--imprint-measure": chip.name.length } as React.CSSProperties}
                type="button"
              >
                <span className="trusted-resource-source">{chip.name}</span>
                {/* ALWAYS. It was `count > 1`, so a publisher with one thing
                    here showed no tally at all and the column had holes in it
                    — which is most of what "the counts are inconsistent" was.
                    A one is a fact, and a column of numerals with gaps in it
                    is not a column. */}
                <span className="trusted-resource-imprint-count">{chip.count}</span>
              </button>
            ))}
          </div>
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
          aria-label={walkSpoken}
          className="taught-here-walk"
          onClick={() => startPodcastWalk(`${displayBook} ${chapter}`, walkStops)}
          type="button"
        >
          <TransportPlayMark className="taught-here-play" paused />
          <span className="taught-here-walk-lines">
            <span className="taught-here-walk-title">{`Listen through ${displayBook} ${chapter}`}</span>
            <span className="taught-here-walk-meta">{walkOffer}</span>
          </span>
        </button>
      )}

      {shape === "spine" ? (
        <div className="resource-room" data-discovery="spine">
          {stops.map(([at, cards]) => (
            <div className="resource-stop" key={at}>
              {/* The spine's whole idea, said in two characters: this run of
                  cards speaks to verse 7, and the one below it to verse 12.
                  A bare numeral could have been anything — a count, an
                  index, a rank — which is what the first draft drew. */}
              <span aria-hidden="true" className="resource-stop-mark">
                {at === 0 ? "ch" : `v${at}`}
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

      {/* ── The room's colophon ──────────────────────────────────────────────
          HOW NINE HUNDRED CARDS END. Added 2026-07-30 with the room's audit:
          the grid used to stop, and two loose paragraphs at two weights came
          after it — a settings count set as body copy and the footing sentence
          under a rule of its own. A reader who scrolls Genesis 1 to the bottom
          reaches the end of the app's answer, and the end of an answer is a
          colophon: one rule, one block, the standing facts about the shelf in
          the order they matter, and nothing that looks like another control.

          Drawn only where there is a room above it to close. */}
      {entries.length > 0 && (footingLine || hiddenCount > 0) && (
        <footer className="resources-colophon">
          {footingLine && <p className="taught-here-footing">{footingLine}</p>}
          {hiddenCount > 0 && (
            <p className="resources-colophon-hidden">{`${hiddenCount} hidden by your settings`}</p>
          )}
        </footer>
      )}
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
  const digest = entries.slice(0, DIGEST);
  if (entries.length === 0) return <></>;
  return (
    <section className="resources-digest" aria-labelledby="resources-digest-title">
      <header className="taught-here-masthead">
        <span className="taught-here-kicker">From the transcripts</span>
        <h3 id="resources-digest-title">Taught here</h3>
      </header>
      <div className="resource-room" data-discovery="digest">
        <ul className="resource-grid">
          {digest.map((entry) => (
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
