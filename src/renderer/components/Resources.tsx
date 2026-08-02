import type React from "react";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ResourceView } from "../api.js";
import { readResourceView, setResourceView, subscribeResourceView } from "../resource-view.js";
import { readShelfFace, setShelfFace, subscribeShelfFace } from "../shelf-face.js";
import type { ShelfFace } from "../api.js";
import seriesArt from "../../../data/music/series-art.json";
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

/**
 * How many voices the Overview digest offers before its door.
 *
 * RESTATED 2026-07-31. It read "Four, so the room's two-column grid closes as
 * a square rather than leaving an orphan" — a reason that died with the second
 * column. Four survives on a different footing and the number is unchanged
 * because the new one holds it at the same value: the card is a row shorter
 * than it was, so four of them cost Overview about what two of the old ones
 * did, and four is what a digest under an insight and a cross-reference list
 * can carry without becoming the room it has a door to.
 */
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
/**
 * A publisher's own cover, for the shelf's second face.
 *
 * The same table the Listen room draws from — one artwork per source, on the
 * publisher's own host, never copied. A source with no entry keeps its MARK
 * whatever the reader chose, because the alternative is a hole in a register
 * whose whole job is to be an even column.
 */
const SHELF_ART = seriesArt as Record<string, { cover: string; tint: string }>;

const FACES: ReadonlyArray<{ id: ShelfFace; label: string }> = [
  { id: "mark", label: "Marks" },
  { id: "cover", label: "Covers" },
];

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
 * THE ENTRY'S OWN SENTENCE, said once for both forms of the room.
 *
 * Factored out of the card on 2026-07-31, when the list view arrived. The two
 * forms draw very different things — the list draws no mark at all — and if
 * each composed its own sentence they would drift, which is precisely how the
 * merged surface ended up with two brand policies over one set of episodes.
 *
 * What a screen reader is owed is the CLAIM: who, what, where in the chapter,
 * how long, and from what point in the file. The relation is spoken here and
 * printed on neither face, because what a face is owed is calm.
 */
function spokenFor(entry: ResourceEntry, running: boolean): string {
  const said = entry.timed ? relationSaid(entry.timed.relation) : LISTED_SAID;
  if (entry.link) {
    return `Read ${entry.episode} on ${entry.sourceName} — ${entry.label}, ${entry.kind}. Opens the official page.`;
  }
  const now = running ? "Now playing. " : "";
  return entry.timed
    ? `${now}Hear ${entry.episode}, ${entry.sourceName}. ${relationSpoken(entry.timed.relation, entry.label)}, ${extentOf(entry.timed.seconds)} from ${clockOf(entry.timed.at)}.`
    : `${now}Hear ${entry.episode}, ${entry.sourceName}. ${entry.label} is ${said}.`;
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
 *
 * ── ONE CARD PER ROW, AND THE CARD RE-PROPORTIONED FOR IT · 2026-07-31 ──────
 *
 * The maintainer, verbatim: "i see were pretty good where were at we just need
 * to make listing cards not stack side by side make them force full width".
 *
 * THE TWO-UP GRID WAS THE ROOT OF MOST OF WHAT HAS BEEN WRONG WITH THIS CARD.
 * A 332px column laid two-up gives each card about 146px of measure, and every
 * defect the last three builds fixed was a symptom of that one number: a title
 * that wrapped after three words, a passage that ellipsed mid-word, a
 * publisher's name cut to "40 MINUTES IN THE OLD TE…", a plate whose size had
 * to be argued down. None of those were composition problems. They were a
 * measure problem wearing composition's clothes.
 *
 * So the grid is ONE COLUMN, and the card is redrawn for the shape that makes
 * — not stretched into it. What was a three-row stack (plate · title · foot)
 * is now a HEAD LINE and a TITLE:
 *
 *     [PLATE] ······················· Genesis 6:1–4  ▸ 9 min
 *     Who were "the sons of God" in Genesis 6?
 *
 * The head carries all three of the small facts — whose material this is,
 * where in the chapter it lands, how long it runs — because at full width they
 * fit on one rule, and at 146px they never could: that is the whole reason the
 * old card had to spend a row on the plate alone and another on the foot.
 * Identity anchors the left, the filing closes the right, and the title gets
 * the card's ENTIRE measure on the line beneath, which is the thing a reader
 * is actually scanning for.
 *
 * Measured on the reference width: the title's measure goes from ~124px to
 * ~288 (about 20 characters a line to 48), and the card gets SHORTER rather
 * than taller — three rows became two, so a screen holds about the same number
 * of entries it did two-up while each of them is finally legible.
 *
 * WHAT DID NOT CHANGE, and neither may: the ground is still the derived homage
 * to the publisher's hue (--ground-fit-*), and the mark is still on every card.
 * Both are the reader's own standing rulings and this build touches neither.
 */
function ResourceCard({
  entry,
  heavy,
  running,
  playing,
  face,
  onOpen,
}: {
  entry: ResourceEntry;
  heavy: boolean;
  running: boolean;
  playing: boolean;
  face: ShelfFace;
  onOpen: (entry: ResourceEntry) => void;
}): React.JSX.Element {
  const spoken = spokenFor(entry, running);
  /* The reader's ONE choice, made in the library panel, answered the same way
     on both surfaces. A room where the shelf wears covers and the cards wear
     marks is a room that made the choice twice. A publisher with no artwork
     keeps its plate whatever was chosen, so this states what is actually
     drawn rather than what was asked for. */
  const art = face === "cover" ? SHELF_ART[entry.sourceId] : undefined;
  return (
    /* The publisher moves to the CARD, and it is the card that needs it: the
       ground is derived from `--resource-source`, and the face below re-declares
       that property as the app's own gold so the transport mark on it stays the
       app's voice rather than the publisher's. Two scopes, one attribute, and
       the division is the point — the ground is whose material this is, the
       transport is whose app this is. */
    <li
      className="resource-card"
      data-face={art ? "cover" : "mark"}
      data-source={entry.sourceId}
      data-weight={heavy ? "heavy" : "light"}
      /* THE CARD'S GROUND FOLLOWS ITS COVER. The ground is a lightness FIT —
         the atmosphere sets l, the hue is the source's — so feeding it the
         artwork's colour instead of the brand's keeps every contrast the sweep
         measured and makes the card agree with the sleeve lying on it.
         See the chroma note in styles.css: multiplied, never floored. */
      style={art ? { "--record-tint": art.tint } as React.CSSProperties : undefined}
    >
      <button
        aria-label={spoken}
        className="resource-card-face"
        data-face={art ? "cover" : "mark"}
        data-kind={entry.link ? "read" : "hear"}
        data-running={running ? "true" : undefined}
        onClick={() => onOpen(entry)}
        type="button"
      >
        {/* ── THE HEAD LINE IS THE WHOLE FILING · 2026-07-31 ────────────────
            The card was a three-row STACK — plate, then title, then a foot of
            passage and extent — and it had to be, because at 146px the plate
            and the extent could not share a line. At full width they can, and
            so the three small facts (whose it is, where it is, how long it
            runs) close up into ONE rule across the top and the title takes
            everything below it.

            What that buys is measured rather than claimed: the title's measure
            goes from ~124px to ~288, about 20 characters a line to 48, and the
            card gets SHORTER — one row came out of it. See `.resource-card-head`
            in styles.css for the proportions. */}
        {/* THE SLEEVE, BESIDE THE WORDS. A cover in the plate's 56×28 slot
            would be a 28px thumbnail — too small to recognise and too small to
            be worth the fetch. So when a card wears one it takes the whole
            left of the card, spanning both rows, the way every listening app
            in the world lays out a row. The head and the title move right and
            keep their own order. */}
        {art ? (
          <span className="resource-card-cover" style={{ background: art.tint }}>
            <img alt="" decoding="async" loading="lazy" src={art.cover} />
          </span>
        ) : (
          /* The plate, in the sleeve's own slot and at the sleeve's own size.
             It used to sit INSIDE the head line as a 56×28 landscape colophon,
             which was right when the head was a rule across the top of the
             card. With artwork on the shelf the maintainer asked for one shape
             throughout — "even the marks should be square" — and they are
             right: a register whose left column is square on some rows and
             landscape on others is not a column. The publisher's own colour
             fills the square behind their mark, so a wordmark drawn for a
             banner still gets a field to sit in. */
          <span className="taught-here-plate resource-card-plate" data-source={entry.sourceId}>
            <span className="taught-here-mark">{entry.sourceName}</span>
          </span>
        )}
        <span className="resource-card-head">
          <span className="resource-card-ref">{entry.label}</span>
          {/* The transport mark stays against the extent it acts on — "▸ 12
              min" is one object, which is why the pair moved up together
              rather than the extent moving alone. */}
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
        <span className="resource-card-title">{entry.episode}</span>
      </button>
    </li>
  );
}

/**
 * ── THE LIST · 2026-07-31 ──────────────────────────────────────────────────
 *
 * The maintainer, verbatim: "give a toggle for a list view where people can get
 * more data in via list if the logo views are too much for them (not for shelf
 * but for listings)".
 *
 * THIS FORM WAS NOT INVENTED HERE. It is the app's own resource masthead
 * brought forward — recovered from ae15ab9, drawn at the real column width
 * against real Genesis 6 material, and approved on the night of 2026-07-31.
 * What it is, in the order a reader meets it:
 *
 *   A MASTHEAD · a tracked kicker, a bold title with tight letterspacing, and
 *     a 3px rule in full ink beneath. A flag, in the newspaper sense: it says
 *     what the column below it is and then gets out of the way.
 *   PUBLISHER RUNS · the publisher named ONCE, at the head of their own run,
 *     in THEIR OWN COLOUR at 9px bold tracked caps. This is the run rule the
 *     card room reversed — and the reversal stands where it was made. What the
 *     reader rejected was a MARK that appeared on some cards and not others,
 *     because a withdrawn mark asks a question it cannot answer. There are no
 *     marks on this surface at all, so there is nothing to withdraw: the
 *     publisher is a heading, and a heading over its own run is what every
 *     printed table of contents in the world does.
 *   AN ENTRY · a 3px spine in the publisher's colour, a hairline above, the
 *     title in the reading serif at the column's whole measure, and a meta
 *     line of passage and length.
 *
 * NO BOXES, NO TINTS, NO PLATES, NO ARTWORK. Brand is carried by COLOUR AND
 * TYPE and by nothing else, which is the entire reason this form fits two and
 * a half times as much on a screen as the cards do.
 *
 * THE CROPPED SYMBOLS WERE TRIED AT THE RUN HEAD AND DROPPED. The maintainer
 * looked at that version and could not see them at that size — which is the
 * same finding the shelf's own rack note reaches from the other direction (a
 * mark is sized by what a logo needs, and a 12px logo needs nothing). They are
 * not to be added back.
 *
 * ── WHY THE ORDER IS DIFFERENT HERE, AND WHY THAT IS NOT A SECOND ANSWER ────
 *
 * The card room is aboutness end to end: 956 entries in one ranked column,
 * because the ordering is what makes the first screen the right one. Grouping
 * that ranking by publisher would produce runs of one, over and over, and a
 * publisher named once per run would then be named 300 times — which is the
 * repetition this form exists to remove.
 *
 * So the list groups by PUBLISHER, in the shelf's own order (which is itself
 * the ranking's, by first appearance), and holds aboutness INSIDE each run.
 * Nothing is filtered, nothing is capped, and the same entries are present in
 * both forms — what changes is the axis a reader scans down. That is the whole
 * of what "more data in via list" asks for: on Genesis 1 it turns a wall into
 * a table of contents with eleven headings in it.
 */
function ResourceList({
  runs,
  playing,
  runningKey,
  onOpen,
}: {
  runs: ReadonlyArray<{ id: string; name: string; entries: ResourceEntry[] }>;
  playing: boolean;
  runningKey: string | null;
  onOpen: (entry: ResourceEntry) => void;
}): React.JSX.Element {
  return (
    <ul className="resource-runs">
      {runs.map((run) => (
        <li className="resource-run" key={run.id}>
          {/* The publisher, once, in their own ink. `.resource-source` is the
              palette hook the eleven brand blocks have always declared and
              nothing has ever used; it is live now, and it is what lets this
              surface take a publisher's colour without a twelfth per-source
              enumeration to fall out of step with the other eleven. */}
          <p className="resource-source resource-run-name" data-source={run.id}>{run.name}</p>
          <ul className="resource-run-entries">
            {run.entries.map((entry) => {
              const running = runningKey === entry.key;
              return (
                <li
                  className="resource-source resource-entry"
                  data-source={entry.sourceId}
                  key={entry.key}
                >
                  <button
                    aria-label={spokenFor(entry, running)}
                    className="resource-entry-face"
                    data-kind={entry.link ? "read" : "hear"}
                    data-running={running ? "true" : undefined}
                    onClick={() => onOpen(entry)}
                    type="button"
                  >
                    <span className="resource-entry-title">{entry.episode}</span>
                    <span className="resource-entry-meta">
                      {/* THE ONE MARK ON THIS SURFACE, and it is the app's
                          rather than a publisher's: the entry the dock is
                          actually playing says so in the transport's own face.
                          Drawn on that entry ALONE — 956 amber discs is the
                          thing the card room moved its transport to the foot to
                          stop, and a list has no foot to move it to. */}
                      {running && (
                        <TransportPlayMark className="resource-entry-play" paused={!playing} />
                      )}
                      <span className="resource-entry-ref">{entry.label}</span>
                      <span aria-hidden="true" className="resource-entry-dot">·</span>
                      <span className="resource-entry-extent">
                        {entry.timed ? extentOf(entry.timed.seconds) : entry.kind}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * ── THE TOGGLE · 2026-07-31 ────────────────────────────────────────────────
 *
 * Two states, at the head of the thing they govern, in the app's own view-tab
 * idiom: ink and Law 2's seal on the edge nearest what it opens. That idiom is
 * chosen deliberately over the shelf's pressed plates — THE SHELF ALREADY OWNS
 * FILTERING, and a control that looks filter-shaped in a room with a filter in
 * it will be read as one. This changes what the same entries look like; it
 * never changes which entries there are.
 *
 * ANNOUNCED AS A CHOICE, not as two switches. A radio group is the honest
 * shape — the two states are mutually exclusive and exhaustive — so a screen
 * reader reads "How this chapter's listings are laid out, Cards, selected, 1
 * of 2", and the arrow keys move and choose the way a radio group's do. Roving
 * tabindex, so the group is ONE tab stop rather than two: a room whose listings
 * are nine hundred entries long must not spend two of a reader's tab presses on
 * how they are drawn.
 */
const VIEWS: ReadonlyArray<{ id: ResourceView; label: string }> = [
  { id: "cards", label: "Cards" },
  { id: "list", label: "List" },
];

function ResourceViewToggle({
  view,
  onChange,
}: {
  view: ResourceView;
  onChange: (next: ResourceView) => void;
}): React.JSX.Element {
  const choose = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = VIEWS.findIndex((option) => option.id === view);
    const next = VIEWS[(at + step + VIEWS.length) % VIEWS.length]!;
    onChange(next.id);
    /* The focus follows the selection, which is what makes a radio group a
       radio group. Read off the DOM rather than held in a ref: two of them, in
       one parent, with a stable class. */
    const group = event.currentTarget.parentElement;
    const moved = group?.querySelectorAll<HTMLButtonElement>(".resource-view-choice");
    moved?.[(at + step + VIEWS.length) % VIEWS.length]?.focus();
  };
  return (
    <div
      aria-label="How this chapter's listings are laid out"
      className="resource-view-toggle"
      role="radiogroup"
    >
      {VIEWS.map((option) => (
        <button
          aria-checked={view === option.id}
          className="resource-view-choice"
          key={option.id}
          onClick={() => onChange(option.id)}
          onKeyDown={choose}
          role="radio"
          tabIndex={view === option.id ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* The two footings that used to live here — a sentence naming whether each
   publisher had granted their transcripts or merely published a feed — were
   deleted on 2026-07-31 with the footing itself (see TRANSCRIPT_SOURCES). They
   were `footingSentence` and `footingOf`, exported and, as it turned out,
   rendered by nothing: the room never drew the sentence they composed. The
   product's position did not change with them — approvals are sought before
   any public listing, takedowns honoured on request — it simply stopped being
   a distinction the reading surface had to carry. */

/* ── THE PACKING OF THE REGISTER, AND WHY IT IS RETIRED · 2026-07-31 ─────────
 *
 * `SHELF_LIFT`, `ShelfTracks`, `packShelf`, `measureShelfTracks`, `sameTracks`
 * and the layout effect that drove them are all gone from this file. They ran
 * for one build and they worked; what removed them is that the shelf they were
 * written for no longer exists. The claim they made is quoted in full, because
 * a mechanism deleted without its own words on the page is one nobody can
 * argue with later:
 *
 *   "WHAT THE READER ASKED, looking at Genesis 6's shelf: 'why do these stack
 *    differently; what decides; how come we're not optimizing for gap
 *    placement and how to have no gaps when 2 small can go together or when
 *    not to stretch one out'. … WHAT DECIDED, until this. Nothing did. … A
 *    HOLE. A one-track plate whose next-ranked neighbour needs two tracks is
 *    alone on its line with the other half of the line empty — on Genesis 6
 *    that stranded BibleProject at the very top of the register and Naked
 *    Bible in the middle of it … A STRETCH. Worse, and invisible as a fault: a
 *    plate whose identity is a NAME still grew, so a one-track publisher alone
 *    on a line silently became a two-track slab. … A row is two tracks. Walk
 *    the ranking: 1. A TWO-TRACK PLATE TAKES A ROW OF ITS OWN. 2. A ONE-TRACK
 *    PLATE WANTS A PARTNER … provided it is no more than three places further
 *    down the ranking. 3. IF THERE IS NONE WITHIN THREE, THE PLATE KEEPS ITS
 *    SINGLE TRACK and the row keeps its gap. … THREE is the longest unbroken
 *    RUN of two-track publishers the corpus produces."
 *
 * EVERY ONE OF THOSE SENTENCES IS ABOUT TWO WIDTHS. The hole is a hole because
 * a wide plate cannot follow a narrow one onto its line; the stretch is a
 * stretch because a lone plate could grow into a width it had not earned; the
 * bound is three because that is how long a run of the OTHER width gets. The
 * reader's next instruction removed the widths: a shelf that draws logos and
 * no names has nothing left to measure, so every plate is one cell of a grid
 * of equal cells (`.resource-shelf` in styles.css).
 *
 * WHAT THAT BUYS, and it is more than the pass ever could: the register is now
 * EXACTLY the ranking, with no lift at all. A plate is never moved, because
 * moving one could not help. Genesis 6's shelf reads in rank order top to
 * bottom, which is the thing the packing pass had to spend three places of
 * rank to approximate. The only hole any composition can have is at the very
 * end of the last row, and that is arithmetic — eleven publishers do not fill
 * three columns — not a decision anybody made.
 *
 * tests/resource-shelf-packing is retired against this note rather than
 * deleted; scripts/qa-podcast-player's `assertShelfPacking` likewise.
 */


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
  /* Cards or list, and it OUTLIVES the passage — which is the one way it
     differs from the two pieces of state below. See renderer/resource-view for
     why it is on a module and in settings rather than in this component. */
  const view = useSyncExternalStore(subscribeResourceView, readResourceView);
  const face = useSyncExternalStore(subscribeShelfFace, readShelfFace);
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

  /* ── THE REGISTER IS THE RANKING · 2026-07-31 ──────────────────────────
     A layout effect, a ResizeObserver, a measuring beat and a bounded
     line-breaker stood here. All four existed to decide the ORDER a shelf of
     two widths was handed to flexbox; the shelf has one width now, so the
     order IS the ranking and there is nothing left to decide. See the
     retirement note above for what the pass claimed and why none of it
     survives the removal of the names. */

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

  /* ── The list's runs ──────────────────────────────────────────────────────
     One pass over the SAME `shown` the cards draw — same filter, same
     aboutness, same entries — regrouped so a publisher is named once. The
     order of the runs is the order a publisher first appears in the ranking,
     which is the shelf's own order, so the rack above and the column below
     read down in the same sequence. Nothing is sorted here and nothing is
     dropped: `runs.flatMap(r => r.entries)` is `shown`, permuted. */
  const runs = useMemo(() => {
    const order: Array<{ id: string; name: string; entries: ResourceEntry[] }> = [];
    const held = new Map<string, { id: string; name: string; entries: ResourceEntry[] }>();
    for (const entry of shown) {
      let run = held.get(entry.sourceId);
      if (!run) {
        run = { id: entry.sourceId, name: entry.sourceName, entries: [] };
        held.set(entry.sourceId, run);
        order.push(run);
      }
      run.entries.push(entry);
    }
    return order;
  }, [shown]);

  /* ── The second size · RESTATED 2026-07-31 ────────────────────────────────
     What this said, and it was true of the two-column grid: "the cards that
     genuinely work through this passage take the full width and the rest are
     tiles, so the weight of a chapter is visible before a word is read."

     EVERY CARD TAKES THE FULL WIDTH NOW, so a span is no longer a currency the
     family can spend — see the card's own recomposition note. What survives is
     the claim underneath it, which was never about columns: the strongest
     answer in the room should look like the strongest answer. It is spent in
     TYPE instead, on the one thing a reader is scanning — the title — and that
     is the only difference between the two sizes. Still two, still no more:
     a size family with three in it is a chart. */
  const heaviest = shown.length > 2
    ? Math.max(...shown.map((entry) => entry.weight))
    : Number.POSITIVE_INFINITY;
  /* Heavy is earned by a treatment, not by being first in a thin list. A
     chapter whose whole shelf is four articles has no treatments in it, and
     four emphasised cards would be a claim the data does not make — so the
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

          ── THE RACK · 2026-07-31 (fourth recomposition) ─────────────────

          The three forms this replaces are quoted in full at `.resource-shelf`
          in styles.css, where the geometry is; what belongs here is the one
          sentence that decided this one, from the reader, looking at Genesis
          6: "what if shelf we did just logos so we can get them closer to same
          size and polish and made them bigger so each logo is bigger and not
          fighting against different word sizes and also tertiary constraints".

          SO NO PLATE SETS A NAME. Every publisher's own symbol, in their own
          colour, in a cell the same size as every other cell — which is what
          finally makes "closer to same size" possible, because the thing that
          decided a plate's width was never the logo, it was the longest name
          the plate had to hold. Eleven marks that were 10–16px are 22–37px.

          The crop is what paid for it and it is real asset work rather than a
          CSS trick: five lockups cut down to their symbol, four publishers who
          already ship one, and two wordmark brands left whole because they
          have no separable symbol and inventing one would be inventing a mark.
          Provenance is recorded per file and per palette block.

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
          {/* The shelf's geometry follows its face: marks want a wide plate to
              lay a wordmark across, covers want the square they were drawn as.
              Stated on the container so the grid changes with it, not just the
              cells. */}
          <div
            aria-label="Publishers on this passage"
            className="trusted-resource-imprints resource-shelf"
            data-face={face}
            role="group"
          >
            {shelf.map((chip, rank) => (
              <button
                /* WHERE THE NAME WENT · 2026-07-31. The plate draws no type
                   except its tally, so this label and the title below are the
                   whole of how a publisher's name reaches a person. Both were
                   already here — the label is unchanged — and both matter more
                   than they did: a screen reader gets the name and the count in
                   one sentence, and a pointer gets the name on hover, which is
                   the affordance a logo-only rack owes anyone who does not
                   recognise a mark. */
                aria-label={`${chip.name} — ${chip.count} ${chip.count === 1 ? "item" : "items"} for this passage`}
                aria-pressed={only === chip.id}
                className="trusted-resource-imprint"
                /* The ranking, on the plate. The reader will ask what decides
                   the order again, and a register whose rank is only in this
                   file's memo cannot answer. With one uniform cell the answer
                   is now trivial — the register IS the ranking, in order, with
                   nothing moved — and this is what lets `qa:player` hold that
                   claim against the engine rather than take it on trust. */
                data-rank={rank}
                /* WHICH FACE THIS CELL IS WEARING. Not simply the reader's
                   choice: a publisher with no artwork keeps its mark, so the
                   attribute states what was actually drawn rather than what
                   was asked for — which is what the stylesheet needs and what
                   a tour can check. */
                data-face={face === "cover" && SHELF_ART[chip.id] ? "cover" : "mark"}
                data-source={chip.id}
                key={chip.id}
                onClick={() => setOnly(only === chip.id ? null : chip.id)}
                /* The name on hover. Plain rather than composed with the count:
                   a tooltip that repeats what the plate already prints is
                   noise, and the tally is printed. */
                title={chip.name}
                type="button"
              >
                {/* The publisher's own symbol is painted on this span and the
                    name is indented off-screen behind it — the app's own mark
                    idiom, and the reason the text stays in the DOM. Which
                    artwork, and how big, is the stylesheet's: see
                    --resource-symbol and the optical scale on
                    `.resource-shelf .trusted-resource-imprint`. */}
                {face === "cover" && SHELF_ART[chip.id] && (
                  /* The sleeve, filling the cell the mark had. Lazy and async
                     for the same reason the Listen room's are: a margin can
                     hold eleven of these and none of them should hold up the
                     passage. The tint underneath means a cover that has not
                     landed is a coloured cell of the right shape rather than a
                     hole, so the register never reflows as the art arrives. */
                  <span
                    className="trusted-resource-cover"
                    style={{ background: SHELF_ART[chip.id]!.tint }}
                  >
                    <img alt="" decoding="async" loading="lazy" src={SHELF_ART[chip.id]!.cover} />
                  </span>
                )}
                <span className="trusted-resource-source">{chip.name}</span>
                {/* ALWAYS. It was `count > 1`, so a publisher with one thing
                    here showed no tally at all and the column had holes in it
                    — which is most of what "the counts are inconsistent" was.
                    A one is a fact, and a column of numerals with gaps in it
                    is not a column. It is also the only type left on this
                    shelf, and it has a lane of its own under the mark rather
                    than a corner it shares with one. */}
                <span className="trusted-resource-imprint-count">{chip.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {library && (
        <div className="trusted-resource-library">
          <p className="trusted-resource-library-lead">Your library, everywhere — not just this passage.</p>
          {/* ── THE SHELF'S FACE ────────────────────────────────────────────
              Here rather than on the shelf's own head, because the head is
              332px already holding a kicker, a filter release and this panel's
              own button — and because this is a preference about the library
              rather than about this passage, which is exactly what the panel
              it sits in is for.

              Radio group, not a pressed plate: two states, mutually exclusive
              and exhaustive, and the shelf below already owns `aria-pressed`
              for filtering. The same reasoning the layout toggle records, and
              the same keyboard: one tab stop, arrows move and choose. */}
          <div
            aria-label="What the publisher shelf shows"
            className="resource-face-toggle"
            role="radiogroup"
          >
            <span className="resource-face-lead">Shelf shows</span>
            {FACES.map((option) => (
              <button
                aria-checked={face === option.id}
                className="resource-face-choice"
                key={option.id}
                onClick={() => setShelfFace(option.id)}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? -1
                      : 0;
                  if (step === 0) return;
                  event.preventDefault();
                  const at = FACES.findIndex((entry) => entry.id === face);
                  const to = (at + step + FACES.length) % FACES.length;
                  setShelfFace(FACES[to]!.id);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>(".resource-face-choice")[to]?.focus();
                }}
                role="radio"
                tabIndex={face === option.id ? 0 : -1}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Said once, plainly, where the choice is made. Covers are fetched
              from each publisher's own server when the shelf DRAWS — so with
              them on, opening a passage tells those publishers you opened it.
              Marks are packaged and tell them nothing. That is the whole of
              the trade and it belongs next to the switch, not in a document. */}
          <p className="resource-face-note">
            {face === "cover"
              ? "Covers come from each publisher’s own server as the shelf draws."
              : "Marks are packaged with the app and fetch nothing."}
          </p>
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

      {/* ── The listings' own head, and the toggle in it · 2026-07-31 ────────
          WHERE IT LIVES, and it is a decision rather than a spare corner. The
          room's other head — `.resource-shelf-head` — is the SHELF's status
          line, and the shelf is the filter. A control for how the listings are
          drawn, parked among "Showing Naked Bible" and "Show all", would be
          read as a third way of narrowing the room. So it sits at the head of
          the thing it actually governs, directly over the listings, below the
          walk that belongs to the room rather than to them.

          IN LIST VIEW THIS LINE IS THE MASTHEAD. The kicker and the flag take
          its left and the 3px rule closes it, exactly as the approved grammar
          has it; the toggle rides at the right, which is where a dateline goes.
          In card view there is no masthead and no rule — the cards carry their
          own identity — so the line is the toggle alone, quiet, over the first
          card. */}
      {entries.length > 0 && (
        /* ONE ELEMENT, TWO DRESSES, and that is a keyboard decision rather than
           a tidiness one. Drawn as two branches — a <header> for the list and a
           <div> for the cards — React unmounts the whole subtree on every
           switch, WHICH TAKES THE FOCUSED RADIO WITH IT: measured, and a reader
           who pressed Left on the toggle was returned to the top of the
           document. The head keeps its identity and its position in the child
           list, so the toggle's own buttons survive the change they caused and
           focus stays where the reader put it.

           The flag is an h4 because this room's own <h3> is above it; on
           Overview's digest the same masthead's flag is an h3, because there it
           is the block's own head. */
        <header
          className={view === "list"
            ? "taught-here-masthead resource-list-masthead"
            : "resource-listing-head"}
          data-view={view}
        >
          {view === "list" && (
            <>
              <span className="taught-here-kicker">From the transcripts</span>
              <h4>Taught here</h4>
            </>
          )}
          <ResourceViewToggle onChange={setResourceView} view={view} />
        </header>
      )}

      {/* The reader's own setting decides the FORM; the discovery shape decides
          how cards are laid out inside the card form and has nothing to say
          about a list. See the shape's note above for why it is not a control. */}
      {view === "list" ? (
        <div className="resource-room" data-discovery={shape} data-view="list">
          <ResourceList onOpen={open} playing={playing} runningKey={runningKey} runs={runs} />
        </div>
      ) : shape === "spine" ? (
        <div className="resource-room" data-discovery="spine" data-view="cards">
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
                    face={face}
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
        <div className="resource-room" data-discovery={shape} data-view="cards">
          <ul className="resource-grid">
            {shown.map((entry) => (
              <ResourceCard
                entry={entry}
                face={face}
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
      {entries.length > 0 && (
        <footer className="resources-colophon">
          {/* One standing sentence, 2026-07-31. It used to be composed by
              `footingSentence` out of how many publishers had granted their
              transcripts against how many had not been asked — a distinction
              the app no longer draws (see TRANSCRIPT_SOURCES). What survives is
              the half a reader is actually owed: these words were read by a
              machine, not by a person. */}
          <p className="taught-here-footing">Transcripts machine-read from published audio.</p>
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
  /* The digest is a resource room like the others and wears the same face the
     reader chose. It was drawing without one — the prop was added when the
     shelf gained covers and this call site was missed, which typechecks in the
     main project and only fails under the renderer's own config. */
  const face = useSyncExternalStore(subscribeShelfFace, readShelfFace);
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
              face={face}
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
