/** Find the references a publisher stated in their own prose. Pure, no I/O. */

import { parseHumanRef, toBref } from "../reference/parser.js";
import type { BackboneData, BookNameMap } from "../reference/types.js";

/**
 * Only spelled-out book names are read out of prose. Abbreviations are not.
 *
 * This is the whole safety argument for scanning prose at all. Our name map
 * carries the short forms a citation uses — `Is`, `Jn`, `Re`, `So`, `Jon` — and
 * every one of them is also an ordinary English word or a person's name. Run
 * them over sentences and "What Forgiveness *Is* and Isn't (Pt. *4*)" becomes
 * Isaiah 4, which is not a near miss: it is a card a reader opens *from a
 * passage*, having trusted that the passage is what the card is about.
 *
 * `Jon` is the sharpest case. It is a real Jonah abbreviation, and it is also
 * the name of one of the two men talking on every BibleProject episode.
 *
 * So the rule is the publisher's own habit: prose says "Genesis", "1 Samuel",
 * "Revelation". A truncation in prose is far more likely to be a word than a
 * book, and the cost of missing one is a card we do not show — while the cost
 * of inventing one is a card that lies.
 */
const PROSE_SAFE_ALTERNATES = new Set([
  "Psalm", "Song of Songs", "Canticles", "Apocalypse",
]);

/** The names worth looking for, longest first so "1 Samuel" beats "Samuel". */
function proseNames(bookNames: BookNameMap): Array<{ code: string; name: string }> {
  const names: Array<{ code: string; name: string }> = [];
  for (const [code, aliases] of Object.entries(bookNames)) {
    const canonical = aliases[0];
    if (canonical) names.push({ code, name: canonical });
    for (const alias of aliases.slice(1)) {
      if (PROSE_SAFE_ALTERNATES.has(alias)) names.push({ code, name: alias });
    }
  }
  return names.sort((left, right) => right.name.length - left.name.length);
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Verses in a chapter, or 0 if the book or chapter is not in the backbone. */
function versesIn(code: string, chapter: number, backbone: BackboneData): number {
  const book = (backbone as unknown as { books: Record<string, { chapters: number[] }> }).books[code];
  return book?.chapters[chapter - 1] ?? 0;
}

/**
 * Every reference stated in `text`, as brefs, deduplicated in document order.
 *
 * Four shapes are read, because these are the four a publisher writes:
 *
 *   Genesis 1:1-13        chapter and verses
 *   Genesis 1:1-2:4       across a chapter break
 *   Genesis 1:1           a single verse
 *   Genesis 1             a whole chapter, expanded to its real length
 *   Deuteronomy 12-26     a run of chapters, expanded end to end
 *
 * The colon is what separates the last two, and it has to be, because "Genesis
 * 1-2" and "Genesis 1:2" are different claims that differ by one character.
 *
 * A chapter-only reference is expanded rather than dropped: "Revelation 4" is a
 * genuine claim about Revelation 4, and the backbone already knows it runs to
 * eleven verses. Anything the backbone rejects — a chapter the book does not
 * have, a verse past the end — is dropped silently, because a publisher's typo
 * is not a coordinate.
 */
export function extractStatedReferences(
  text: string,
  bookNames: BookNameMap,
  backbone: BackboneData,
): string[] {
  const names = proseNames(bookNames);
  if (names.length === 0) return [];
  const alternation = names.map((entry) => escape(entry.name)).join("|");
  /* The word "chapter" is allowed between the name and the number because
     publishers write it — "Philippians chapter 2" is the same claim as
     "Philippians 2" and there is no reason to read only one of them. */
  const pattern = new RegExp(
    `\\b(${alternation})\\s+(?:chapters?\\s+)?(\\d+)`
    + `(?:\\s*[-–]\\s*(\\d+)(?![:\\d])|:(\\d+)(?:\\s*[-–]\\s*(?:(\\d+):)?(\\d+))?)?`
    + `(?![:\\d])`,
    "gi",
  );

  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    const entry = name ? names.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase()) : undefined;
    if (!entry) continue;
    const [, , first, chapterEnd, startVerse, crossChapter, endVerse] = match;

    let bref: string | null = null;
    if (startVerse !== undefined) {
      const tail = crossChapter !== undefined
        ? `${first}:${startVerse}-${crossChapter}:${endVerse}`
        : endVerse !== undefined ? `${first}:${startVerse}-${endVerse}` : `${first}:${startVerse}`;
      const parsed = parseHumanRef(`${entry.name} ${tail}`, bookNames, backbone);
      if (parsed.ok) bref = toBref(parsed.value);
    } else {
      // Chapter, or a run of them: expand to what the backbone actually holds.
      const from = Number(first);
      const to = chapterEnd === undefined ? from : Number(chapterEnd);
      const last = versesIn(entry.code, to, backbone);
      if (to >= from && versesIn(entry.code, from, backbone) > 0 && last > 0) {
        bref = `bref:v1/${entry.code}.${from}.1-${entry.code}.${to}.${last}`;
      }
    }
    if (bref && !seen.has(bref)) { seen.add(bref); found.push(bref); }
  }
  return found;
}
