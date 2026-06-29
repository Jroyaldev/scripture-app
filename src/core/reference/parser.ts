/**
 * Reference parser — converts between bref strings, CanonicalRef, and human-readable forms.
 * Pure, platform-agnostic (INV-18). No Node/Electron imports.
 */

import type {
  BackboneData,
  BookCode,
  BookNameMap,
  CanonicalRef,
  CanonicalVerse,
  TokenNarrowing,
} from "./types.js";
import { isValidBookCode } from "./backbone.js";
import { validateVerse } from "./backbone.js";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Parse a bref string into a CanonicalRef.
 * Grammar: bref:v1/BOOK.chapter.verse[-BOOK.chapter.verse][@layer:tokenStart-tokenEnd]
 */
export function parseBref(input: string): ParseResult<CanonicalRef> {
  const brefPrefix = "bref:v1/";
  if (!input.startsWith(brefPrefix)) {
    return { ok: false, error: `Expected bref string to start with '${brefPrefix}', got: ${input}` };
  }
  const body = input.slice(brefPrefix.length);

  let mainPart = body;
  let tokenNarrowing: TokenNarrowing | undefined;

  const atIdx = body.indexOf("@");
  if (atIdx !== -1) {
    mainPart = body.slice(0, atIdx);
    const tokenPart = body.slice(atIdx + 1);
    const colonIdx = tokenPart.indexOf(":");
    if (colonIdx === -1) {
      return { ok: false, error: `Invalid token narrowing (missing ':'): ${tokenPart}` };
    }
    const layer = tokenPart.slice(0, colonIdx);
    const range = tokenPart.slice(colonIdx + 1);
    const dashIdx = range.indexOf("-");
    if (dashIdx === -1) {
      return { ok: false, error: `Invalid token range (missing '-'): ${range}` };
    }
    tokenNarrowing = {
      layer,
      tokenStart: range.slice(0, dashIdx),
      tokenEnd: range.slice(dashIdx + 1),
    };
  }

  const dashIdx = findRangeDash(mainPart);
  let startStr: string;
  let endStr: string;

  if (dashIdx === -1) {
    startStr = mainPart;
    endStr = mainPart;
  } else {
    startStr = mainPart.slice(0, dashIdx);
    endStr = mainPart.slice(dashIdx + 1);
  }

  const startResult = parseVerseRef(startStr);
  if (!startResult.ok) return startResult;

  const endResult = parseVerseRef(endStr);
  if (!endResult.ok) return endResult;

  return {
    ok: true,
    value: {
      version: "v1",
      start: startResult.value,
      end: endResult.value,
      tokenNarrowing,
    },
  };
}

/**
 * Find the dash that separates range start from range end.
 * Must handle the fact that book codes like "1SA" contain no dash,
 * so the range dash is between two BOOK.ch.v segments.
 */
function findRangeDash(s: string): number {
  const parts = s.split("-");
  if (parts.length <= 1) return -1;

  // Reconstruct: try each dash position; the valid one has valid verse refs on both sides.
  let pos = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    pos += (parts[i] as string).length;
    const left = s.slice(0, pos);
    const right = s.slice(pos + 1);
    if (parseVerseRef(left).ok && parseVerseRef(right).ok) {
      return pos;
    }
    pos += 1; // skip the dash
  }
  return -1;
}

function parseVerseRef(s: string): ParseResult<CanonicalVerse> {
  const dotParts = s.split(".");
  if (dotParts.length !== 3) {
    return { ok: false, error: `Expected BOOK.chapter.verse, got: ${s}` };
  }
  const [bookStr, chStr, vStr] = dotParts as [string, string, string];
  if (!isValidBookCode(bookStr)) {
    return { ok: false, error: `Invalid book code: ${bookStr}` };
  }
  const chapter = parseInt(chStr, 10);
  const verse = parseInt(vStr, 10);
  if (isNaN(chapter) || isNaN(verse) || chapter < 1 || verse < 1) {
    return { ok: false, error: `Invalid chapter/verse numbers in: ${s}` };
  }
  return {
    ok: true,
    value: { book: bookStr, chapter, verse },
  };
}

/**
 * Serialize a CanonicalRef back to a bref string.
 */
export function toBref(ref: CanonicalRef): string {
  const startStr = `${ref.start.book}.${ref.start.chapter}.${ref.start.verse}`;
  const endStr = `${ref.end.book}.${ref.end.chapter}.${ref.end.verse}`;
  let result = "bref:v1/";
  if (
    ref.start.book === ref.end.book &&
    ref.start.chapter === ref.end.chapter &&
    ref.start.verse === ref.end.verse
  ) {
    result += startStr;
  } else {
    result += `${startStr}-${endStr}`;
  }
  if (ref.tokenNarrowing) {
    result += `@${ref.tokenNarrowing.layer}:${ref.tokenNarrowing.tokenStart}-${ref.tokenNarrowing.tokenEnd}`;
  }
  return result;
}

/**
 * Validate a CanonicalRef against the backbone data.
 */
export function validateRef(
  ref: CanonicalRef,
  backbone: BackboneData,
): ParseResult<CanonicalRef> {
  const startVal = validateVerse(backbone, ref.start);
  if (!startVal.ok) return { ok: false, error: `Start: ${startVal.error}` };
  const endVal = validateVerse(backbone, ref.end);
  if (!endVal.ok) return { ok: false, error: `End: ${endVal.error}` };
  if (compareVerses(ref.start, ref.end) > 0) {
    return { ok: false, error: "Start must not be after end in a range" };
  }
  return { ok: true, value: ref };
}

/**
 * Compare two CanonicalVerse values. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVerses(a: CanonicalVerse, b: CanonicalVerse): number {
  const bookCmp = BOOK_CODES_INDEX.get(a.book)! - BOOK_CODES_INDEX.get(b.book)!;
  if (bookCmp !== 0) return bookCmp;
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.verse - b.verse;
}

import { BOOK_CODES } from "./types.js";

const BOOK_CODES_INDEX: ReadonlyMap<string, number> = new Map(
  BOOK_CODES.map((code, idx) => [code, idx]),
);

/**
 * Format a CanonicalRef for human display, e.g. "Acts 19:1-7" or "Acts 19:1 - 20:3".
 */
export function toDisplayString(
  ref: CanonicalRef,
  bookNames: BookNameMap,
): string {
  const startBookNames = bookNames[ref.start.book];
  const startName = startBookNames?.[0] ?? ref.start.book;

  const isSingleVerse =
    ref.start.book === ref.end.book &&
    ref.start.chapter === ref.end.chapter &&
    ref.start.verse === ref.end.verse;

  if (isSingleVerse) {
    return `${startName} ${ref.start.chapter}:${ref.start.verse}`;
  }

  const sameBook = ref.start.book === ref.end.book;
  const sameChapter = sameBook && ref.start.chapter === ref.end.chapter;

  if (sameChapter) {
    return `${startName} ${ref.start.chapter}:${ref.start.verse}\u2013${ref.end.verse}`;
  }

  if (sameBook) {
    return `${startName} ${ref.start.chapter}:${ref.start.verse}\u2013${ref.end.chapter}:${ref.end.verse}`;
  }

  const endBookNames = bookNames[ref.end.book];
  const endName = endBookNames?.[0] ?? ref.end.book;
  return `${startName} ${ref.start.chapter}:${ref.start.verse} \u2013 ${endName} ${ref.end.chapter}:${ref.end.verse}`;
}

/**
 * Parse a human-readable scripture reference into a CanonicalRef.
 * Handles forms like "Acts 19:1-7", "John 3:1-8", "Gal 3:26-29",
 * "cf. Galatians 3:26-29", "1 Samuel 3:1-10".
 */
export function parseHumanRef(
  input: string,
  bookNames: BookNameMap,
  backbone: BackboneData,
): ParseResult<CanonicalRef> {
  let cleaned = input.trim();
  // Strip common prefixes
  for (const prefix of ["cf.", "cf", "see", "See", "cp.", "cp"]) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
    }
  }

  const reverseMap = buildReverseBookNameMap(bookNames);
  const match = matchBookName(cleaned, reverseMap);
  if (!match) {
    return { ok: false, error: `Could not identify book name in: ${input}` };
  }

  const bookCode = match.code;
  const rest = cleaned.slice(match.length).trim();

  // Parse chapter:verse[-verse] or chapter:verse-chapter:verse
  const cvMatch = rest.match(/^(\d+):(\d+)(?:\s*[-\u2013]\s*(?:(\d+):)?(\d+))?$/);
  if (!cvMatch) {
    return { ok: false, error: `Could not parse chapter:verse in: ${rest}` };
  }

  const startChapter = parseInt(cvMatch[1]!, 10);
  const startVerse = parseInt(cvMatch[2]!, 10);

  let endChapter: number;
  let endVerse: number;

  if (cvMatch[4] !== undefined) {
    // Has a range
    if (cvMatch[3] !== undefined) {
      // Cross-chapter range: ch:v-ch:v
      endChapter = parseInt(cvMatch[3], 10);
    } else {
      endChapter = startChapter;
    }
    endVerse = parseInt(cvMatch[4], 10);
  } else {
    endChapter = startChapter;
    endVerse = startVerse;
  }

  const ref: CanonicalRef = {
    version: "v1",
    start: { book: bookCode, chapter: startChapter, verse: startVerse },
    end: { book: bookCode, chapter: endChapter, verse: endVerse },
  };

  return validateRef(ref, backbone);
}

type ReverseMapEntry = { code: BookCode; name: string; length: number };

function buildReverseBookNameMap(bookNames: BookNameMap): ReverseMapEntry[] {
  const entries: ReverseMapEntry[] = [];
  for (const [code, names] of Object.entries(bookNames)) {
    if (!names) continue;
    for (const name of names) {
      entries.push({ code: code as BookCode, name, length: name.length });
    }
  }
  // Sort by length descending so longer matches win
  entries.sort((a, b) => b.length - a.length);
  return entries;
}

function matchBookName(
  input: string,
  reverseMap: ReverseMapEntry[],
): { code: BookCode; length: number } | null {
  const lower = input.toLowerCase();
  for (const entry of reverseMap) {
    const nameLower = entry.name.toLowerCase();
    if (lower.startsWith(nameLower)) {
      const nextChar = input[entry.length];
      // Must be followed by space, digit, colon, or end of string
      if (
        nextChar === undefined ||
        nextChar === " " ||
        nextChar === ":" ||
        /\d/.test(nextChar)
      ) {
        return { code: entry.code, length: entry.length };
      }
    }
  }
  return null;
}

/**
 * Check if a verse falls within a reference range.
 */
export function verseInRange(
  verse: CanonicalVerse,
  ref: CanonicalRef,
): boolean {
  return compareVerses(verse, ref.start) >= 0 && compareVerses(verse, ref.end) <= 0;
}

/**
 * Check if two reference ranges overlap.
 */
export function rangesOverlap(
  a: CanonicalRef,
  b: CanonicalRef,
): boolean {
  return compareVerses(a.start, b.end) <= 0 && compareVerses(b.start, a.end) <= 0;
}
