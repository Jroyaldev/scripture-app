/**
 * Pure passage-reference parser for the "jump to" input in ScripturePage.
 * No DOM, no window — reimplements the book-name matching logic from
 * src/core/reference/parser.ts locally since the renderer must not import core.
 */
import type { BackboneData, BookNameData } from "../api.js";

export type ParsePassageResult =
  | { ok: true; value: { book: string; chapter: number; verse?: number; endVerse?: number } }
  | { ok: false; error: string };

type ReverseMapEntry = { code: string; name: string; length: number };

function buildReverseBookNameMap(bookNames: BookNameData): ReverseMapEntry[] {
  const entries: ReverseMapEntry[] = [];
  for (const [code, names] of Object.entries(bookNames)) {
    if (!names) continue;
    for (const name of names) {
      entries.push({ code, name, length: name.length });
    }
  }
  // Sort by length descending so longer/more specific names win.
  entries.sort((a, b) => b.length - a.length);
  return entries;
}

function matchBookName(
  input: string,
  reverseMap: ReverseMapEntry[],
): { code: string; length: number } | null {
  const lower = input.toLowerCase();
  for (const entry of reverseMap) {
    const nameLower = entry.name.toLowerCase();
    if (lower.startsWith(nameLower)) {
      const nextChar = input[entry.length];
      // Must be followed by space, digit, colon, or end of string.
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

export function parsePassage(
  input: string,
  bookNames: BookNameData,
  backbone: BackboneData,
): ParsePassageResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter a reference" };
  }

  const reverseMap = buildReverseBookNameMap(bookNames);
  const match = matchBookName(trimmed, reverseMap);
  if (!match) {
    return { ok: false, error: `Couldn't find a book in "${input}"` };
  }

  const code = match.code;
  const remainder = trimmed.slice(match.length).trim();

  let chapter: number;
  let verseStr: string | undefined;

  if (remainder === "") {
    chapter = 1;
  } else {
    const cvMatch = remainder.match(/^(\d+)(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
    if (!cvMatch) {
      return { ok: false, error: `Couldn't read chapter in "${input}"` };
    }
    chapter = parseInt(cvMatch[1]!, 10);
    verseStr = cvMatch[2];
    if (cvMatch[3]) verseStr = `${verseStr}-${cvMatch[3]}`;
  }

  const bookData = backbone.books[code];
  const chapterCount = bookData?.chapters.length ?? 0;
  const fullName = bookNames[code]?.[0] ?? code;

  if (chapter < 1 || chapter > chapterCount) {
    return { ok: false, error: `${fullName} has ${chapterCount} chapters` };
  }

  const value: { book: string; chapter: number; verse?: number; endVerse?: number } = { book: code, chapter };

  if (verseStr !== undefined) {
    const [verseText, endVerseText] = verseStr.split("-");
    const verse = parseInt(verseText ?? "", 10);
    const verseCount = bookData?.chapters[chapter - 1] ?? 0;
    if (verse >= 1 && verse <= verseCount) {
      value.verse = verse;
      const endVerse = endVerseText ? parseInt(endVerseText, 10) : undefined;
      if (endVerse && endVerse >= verse && endVerse <= verseCount) value.endVerse = endVerse;
    }
  }

  return { ok: true, value };
}
