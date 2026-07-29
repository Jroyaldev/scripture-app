/**
 * The passage a podcast episode's title states, if it states one.
 *
 * Pure, and separate from any one publisher, because six shows now write their
 * titles six ways and the *coordinate grammar* underneath is the same in all of
 * them. What differs is where the coordinate sits in the sentence, which is the
 * caller's business; what does not differ is that "11-12" means two chapters and
 * "5:1-6:2" crosses one.
 *
 * WHY NOT THE WORKING PREACHER NORMALIZER
 *
 * That one scans prose for a book name and reads whatever follows. It is right
 * for a title like "Commentary on Exodus 32:1-14", which is a sentence with a
 * passage in it. Podcast titles are mostly the other shape — the coordinate IS
 * the title, or its head — and reading them strictly buys two things that
 * scanning cannot:
 *
 *   it keeps the tail of a chapter range. The scanner drops it, so "2
 *   Corinthians 11-12" yields chapter 11 alone. That costs nothing on a
 *   publisher who rarely writes ranges and a chapter an episode on one who does.
 *
 *   it refuses prose. "Exodus 20 (Part 2)" must not contribute verse 2, and
 *   "Who is the Proverbs 31 Woman?" must not claim Proverbs 31 from its head.
 *   A strict reader can say no; a scanner takes whatever digits it finds.
 */

import type { BackboneData, BookCode, BookNameMap, CanonicalRef } from "../reference/types.js";

/**
 * Book names a publisher uses that the canon does not.
 *
 * "Chronicles Overview" and "Kings Introduction" name no book our versification
 * knows, but they are not vague — the show means both volumes and says so in the
 * episode. Left unmapped they produce nothing, which reads as the publisher
 * having said nothing when they said something perfectly clear.
 */
export const DEFAULT_SERIES_ALIASES: ReadonlyArray<{ name: string; codes: BookCode[] }> = [
  { name: "Ezra-Nehemiah", codes: ["EZR", "NEH"] },
  { name: "1 & 2 Timothy", codes: ["1TI", "2TI"] },
  { name: "1 and 2 Timothy", codes: ["1TI", "2TI"] },
  { name: "John's Letters", codes: ["1JN", "2JN", "3JN"] },
  { name: "Chronicles", codes: ["1CH", "2CH"] },
  { name: "Samuel", codes: ["1SA", "2SA"] },
  { name: "Kings", codes: ["1KI", "2KI"] },
];

/**
 * The words a show uses to mean "this whole book".
 *
 * Each follows a bare book name — "Romans Overview: Jesus is King" — and each is
 * a claim about the book entire. Whole-book coordinates rank last on
 * specificity, which is correct: naming a book is exactly as much as the title
 * said.
 */
const WHOLE_BOOK_SUFFIX =
  /^(?:overview|introduction|intro|sermon|replay|special episode|special|commentary)?$/i;

const fold = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export interface PassageReader {
  /** Everything the title claims, or null where it claims nothing. */
  (title: string): CanonicalRef[] | null;
}

export function createPassageReader(
  bookNames: BookNameMap,
  backbone: BackboneData,
  seriesAliases: ReadonlyArray<{ name: string; codes: BookCode[] }> = DEFAULT_SERIES_ALIASES,
): PassageReader {
  /** Book names longest-first, so "1 John" is tried before "John". */
  const candidates: Array<{ code: BookCode; name: string }> = [];
  for (const [code, names] of Object.entries(bookNames)) {
    for (const name of names) candidates.push({ code: code as BookCode, name });
  }
  candidates.sort((left, right) => right.name.length - left.name.length);
  const aliases = [...seriesAliases].sort((left, right) => right.name.length - left.name.length);

  const chapterCount = (code: BookCode): number => backbone.books[code]?.chapters.length ?? 0;
  const verseCount = (code: BookCode, chapter: number): number =>
    backbone.books[code]?.chapters[chapter - 1] ?? 0;

  const wholeBook = (code: BookCode): CanonicalRef => {
    const last = chapterCount(code);
    return {
      version: "v1",
      start: { book: code, chapter: 1, verse: 1 },
      end: { book: code, chapter: last, verse: verseCount(code, last) },
    };
  };

  const wholeChapter = (code: BookCode, chapter: number): CanonicalRef => ({
    version: "v1",
    start: { book: code, chapter, verse: 1 },
    end: { book: code, chapter, verse: verseCount(code, chapter) },
  });

  /** The book a coordinate expression opens with, and what follows it. */
  function leadingBook(expression: string): { codes: BookCode[]; rest: string } | null {
    const folded = fold(expression);
    for (const alias of aliases) {
      const name = fold(alias.name);
      if (folded.startsWith(name) && !/[a-z0-9]/.test(folded.charAt(name.length))) {
        return { codes: [...alias.codes], rest: expression.slice(alias.name.length).trim() };
      }
    }
    for (const candidate of candidates) {
      const name = fold(candidate.name);
      if (!folded.startsWith(name)) continue;
      /* A name must end at a boundary, or "Job" swallows the "Jo" of "John". */
      if (/[a-z0-9]/.test(folded.charAt(name.length))) continue;
      return { codes: [candidate.code], rest: expression.slice(candidate.name.length).trim() };
    }
    return null;
  }

  /**
   * Read a coordinate expression that has already had its book stripped.
   *
   *   24-27, 30        chapter ranges and lists      Exodus 24-27, 30
   *   23 and 25        the same, written out         Leviticus 23 and 25
   *   11-12            a chapter range               2 Corinthians 11-12
   *   6:3-21           verses inside one chapter     1 Timothy 6:3-21
   *   5:1-6:2          verses across two chapters    1 Timothy 5:1-6:2
   *   3:16-6           a verse to a later chapter's end   Ecclesiastes 3:16-6
   *   2:18-27; 4:1-6   two spans in one book         1 John 2:18-27; 4:1-6
   *
   * Null on anything else, rather than a guess. A title is evidence only while
   * it is read literally; the moment this starts inferring, a manifest stops
   * being the publisher's claim and becomes ours.
   */
  function coordinates(code: BookCode, expression: string): CanonicalRef[] | null {
    const cleaned = expression
      .replace(/[–—−]/g, "-")
      /* "23 and 25" is a list written in words; publishers use both forms. */
      .replace(/\s+and\s+/gi, ", ")
      .trim();
    if (!cleaned) return null;
    /* Nothing but coordinates may remain. A stray word means the expression was
       prose and whatever digits it holds are not a reference. */
    if (!/^[\d\s:;,-]+$/.test(cleaned)) return null;

    const refs: CanonicalRef[] = [];
    for (const part of cleaned.split(/[;,]/)) {
      const piece = part.trim();
      if (!piece) continue;
      const match = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(piece);
      if (!match) return null;
      const startChapter = Number(match[1]);
      const startVerse = match[2] == null ? null : Number(match[2]);
      const endLeft = match[3] == null ? null : Number(match[3]);
      const endRight = match[4] == null ? null : Number(match[4]);

      if (startVerse == null) {
        /* "11-12" is chapters; "11" is one chapter. Both cover whole chapters,
           and the range's tail is kept — losing it is the defect that made a
           purpose-built reader worth writing. */
        const lastChapter = endLeft ?? startChapter;
        if (lastChapter < startChapter) return null;
        for (let chapter = startChapter; chapter <= lastChapter; chapter += 1) {
          if (verseCount(code, chapter) === 0) return null;
          refs.push(wholeChapter(code, chapter));
        }
        continue;
      }

      /* "6:3-21" ends in the same chapter and "5:1-6:2" crosses into another,
         told apart by whether a verse follows the dash. Where none does, one
         number does one of two jobs: "6:3-21" ends at verse 21, "3:16-6" ends
         at the close of chapter 6. Only its size distinguishes them — a range
         cannot end before it starts, so a tail below the opening verse is a
         chapter. */
      let endChapter = startChapter;
      let endVerse = startVerse;
      if (endRight != null) {
        endChapter = endLeft ?? startChapter;
        endVerse = endRight;
      } else if (endLeft != null) {
        if (endLeft >= startVerse) endVerse = endLeft;
        else { endChapter = endLeft; endVerse = verseCount(code, endLeft); }
      }
      if (verseCount(code, startChapter) === 0 || verseCount(code, endChapter) === 0) return null;
      refs.push({
        version: "v1",
        start: { book: code, chapter: startChapter, verse: startVerse },
        end: { book: code, chapter: endChapter, verse: endVerse },
      });
    }
    return refs.length > 0 ? refs : null;
  }

  /**
   * Drop what sits beside a coordinate rather than in it.
   *
   * A guest credit, a part number and a show's own episode number are all
   * asides, and shows write each several ways — "Exodus 20 (Part 2)", "Esther
   * 4-8 Part 2", "Leviticus 11-15, pt. 3", "Daniel 6:1-18 (Episode 515)".
   * Left in, a bare part number reads as a verse and turns Esther 4-8 into
   * Esther 4:2.
   */
  const stripAside = (value: string): string =>
    value
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/[,;]?\s*\b(?:part|pt\.?)\s*\d+\s*$/i, "")
      .replace(/[,;]?\s*\bepisode\s*\d+\s*$/i, "")
      /* "Gospel of John" is how one show names the book on its overview run. */
      .replace(/^\s*(?:the\s+)?gospel of\s+/i, "")
      .replace(/\s+/g, " ")
      .replace(/[\s,;:]+$/, "")
      .trim();

  function claimFrom(expression: string): CanonicalRef[] | null {
    const cleaned = stripAside(expression);
    if (!cleaned) return null;
    const book = leadingBook(cleaned);
    if (!book) return null;
    if (WHOLE_BOOK_SUFFIX.test(book.rest)) return book.codes.map(wholeBook);
    /* A multi-book series name carries no chapter numbers of its own — "Kings 3"
       would be this reader inventing a coordinate nobody wrote. */
    if (book.codes.length > 1) return null;
    return coordinates(book.codes[0]!, book.rest);
  }

  /** Everything before the first colon that is not part of a `chapter:verse`. */
  const headOf = (title: string): string => {
    const index = title.search(/:(?!\d)/);
    return (index === -1 ? title : title.slice(0, index)).trim();
  };
  const tailOf = (title: string): string => {
    const index = title.search(/:(?!\d)/);
    return index === -1 ? "" : title.slice(index + 1).trim();
  };

  /* Prose fallback. Only a coordinate sitting inside the sentence counts, and
     only the first: a sentence with two references is a sentence, not a claim. */
  const COORDINATE =
    /((?:[123]\s+)?[A-Z][a-z]+(?:\s+of\s+[A-Z][a-z]+)*)\s+(\d+(?::\d+)?(?:-\d+(?::\d+)?)?)/;

  return function statedPassage(title: string): CanonicalRef[] | null {
    if (!title.trim()) return null;
    /* The head is where most shows put it. */
    const head = claimFrom(headOf(title));
    if (head) return head;

    /* Then inside the brackets. `stripAside` throws parentheticals away because
       for most shows they hold a guest credit or a part number — but one show
       changed format part-way through its run and its earlier episodes read
       "Episode 181 (Deuteronomy 33:1-34:12)", where the bracket holds the only
       coordinate there is. Trying the contents costs nothing: "Part 2",
       "w/ Andrew Wilson" and "Episode 516" all open with no book name and are
       refused by the same rule that refuses any other prose. */
    for (const bracket of title.matchAll(/\(([^)]*)\)/g)) {
      const claim = claimFrom(bracket[1] ?? "");
      if (claim) return claim;
    }

    /* Then the tail, which rescues the handful written the other way round —
       "Psalms of Ascent: Psalms 130-134" — and then the whole title, which
       reads one with no colon to have a head at all, like "Psalm 91 &
       Coronavirus". */
    for (const prose of [tailOf(title), title]) {
      if (!prose) continue;
      const inside = COORDINATE.exec(prose);
      const claim = inside ? claimFrom(`${inside[1]} ${inside[2]}`) : null;
      if (claim) return claim;
    }
    return null;
  };
}
