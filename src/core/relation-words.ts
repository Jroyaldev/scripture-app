/**
 * What the four relations mean, said in the words a reader uses.
 *
 * The schema's four values are a considered taxonomy — see
 * `src/core/references.ts`, which argues for them at length — and until this
 * build they reached the reader as `crossref` and `mention`, printed raw into
 * a reading margin, or as an empty string. That is 23,169 of 41,426 moments,
 * 56% of the corpus, labelled with a database token or with nothing.
 *
 * The largest class is the one that was worst served. `crossref` is 18,091
 * moments — 44% of everything — and it is arguably the most interesting offer
 * on the surface: "this passage was brought in to illuminate something else"
 * is a different and often better thing to be told than "this episode is about
 * it". It read as noise below the fold because it was spelled like a column
 * name.
 *
 * These are written to complete one sentence, which is the sentence the row
 * makes: *Romans 8:9–17 · 0:26 · <said>*. So they are past participles rather
 * than nouns — "brought in alongside", not "cross-reference" — because the row
 * is reporting what happened in an episode, not filing it.
 *
 * One vocabulary, in core, because two surfaces say it: the chapter's merged
 * margin surface and the dock's own passage list. Two copies would drift, and
 * they already had — the margin printed "alluded" and the dock printed
 * "alluded" for allusions and nothing at all for the other two.
 */

import type { ReferenceRelation } from "./references.js";

/**
 * The clause a row ends with.
 *
 * `subject` is deliberately said too. It used to be the silent case on both
 * surfaces — the relation was printed only when it was NOT a subject — which
 * made the most valuable claim in the corpus the one with no words on it, and
 * left the reader inferring it from the absence of the others.
 */
const SAID: Readonly<Record<ReferenceRelation, string>> = {
  subject: "worked through",
  crossref: "brought in alongside",
  mention: "mentioned",
  allusion: "alluded to",
};

/** How the relation reads at the end of a row. Never a schema token. */
export function relationSaid(relation: ReferenceRelation): string {
  return SAID[relation];
}

/**
 * Every relation the schema has, with its word — so a fifth value added to
 * `ReferenceRelation` cannot ship with nothing to say. TypeScript catches the
 * missing key in `SAID`; this catches a key added here and nowhere a reader
 * can see it.
 */
export const RELATION_WORDS_FIXTURE: ReadonlyArray<readonly [ReferenceRelation, string]> =
  Object.entries(SAID) as ReadonlyArray<readonly [ReferenceRelation, string]>;

/**
 * The whole claim, for an accessible name — where the row's visual grammar
 * (a dot-separated run) is not available and the sentence has to carry it.
 */
export function relationSpoken(relation: ReferenceRelation, passage: string): string {
  switch (relation) {
    case "subject": return `${passage} is worked through here`;
    case "crossref": return `${passage} is brought in alongside the passage being taught`;
    case "mention": return `${passage} is mentioned here`;
    case "allusion": return `${passage} is alluded to here, without being named`;
  }
}

/**
 * The claim a title-level record makes, which is not one of the four.
 *
 * A publisher filing an episode under a passage is a real claim and a
 * different one: nothing in a transcript was read to produce it, so it carries
 * no timestamp and no evidence. Saying so is what keeps the merged surface
 * honest about which of its rows were read out of the audio and which were
 * taken from a catalogue.
 */
export const LISTED_SAID = "listed under this passage";
