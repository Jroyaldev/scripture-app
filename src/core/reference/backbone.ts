/**
 * Backbone loader and validator — pure, platform-agnostic (INV-18).
 * Validates verse coordinates against the backbone coordinate system.
 */

import type { BackboneData, BookCode, CanonicalVerse } from "./types.js";
import { BOOK_CODES } from "./types.js";

const BOOK_CODE_SET: ReadonlySet<string> = new Set(BOOK_CODES);

export function isValidBookCode(code: string): code is BookCode {
  return BOOK_CODE_SET.has(code);
}

export type BackboneValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateVerse(
  backbone: BackboneData,
  verse: CanonicalVerse,
): BackboneValidationResult {
  if (!isValidBookCode(verse.book)) {
    return { ok: false, error: `Invalid book code: ${verse.book}` };
  }
  const bookData = backbone.books[verse.book];
  if (!bookData) {
    return { ok: false, error: `Book not found in backbone: ${verse.book}` };
  }
  if (
    verse.chapter < 1 ||
    verse.chapter > bookData.chapters.length
  ) {
    return {
      ok: false,
      error: `Chapter ${verse.chapter} out of range for ${verse.book} (1-${bookData.chapters.length})`,
    };
  }
  const maxVerse = bookData.chapters[verse.chapter - 1];
  if (maxVerse === undefined) {
    return {
      ok: false,
      error: `Chapter index error for ${verse.book} ${verse.chapter}`,
    };
  }
  if (verse.verse < 1 || verse.verse > maxVerse) {
    return {
      ok: false,
      error: `Verse ${verse.verse} out of range for ${verse.book} ${verse.chapter} (1-${maxVerse})`,
    };
  }
  return { ok: true };
}

export function validateBackboneData(data: unknown): BackboneValidationResult {
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "Backbone data must be an object" };
  }
  const d = data as Record<string, unknown>;
  if (d["version"] !== "v1") {
    return { ok: false, error: "Backbone version must be 'v1'" };
  }
  if (typeof d["books"] !== "object" || d["books"] === null) {
    return { ok: false, error: "Backbone must have a 'books' object" };
  }
  const books = d["books"] as Record<string, unknown>;
  for (const code of BOOK_CODES) {
    if (!(code in books)) {
      return { ok: false, error: `Missing book: ${code}` };
    }
    const book = books[code] as Record<string, unknown>;
    if (!Array.isArray(book["chapters"])) {
      return { ok: false, error: `Book ${code} missing 'chapters' array` };
    }
    for (let i = 0; i < (book["chapters"] as number[]).length; i++) {
      const vc = (book["chapters"] as number[])[i];
      if (typeof vc !== "number" || vc < 1) {
        return {
          ok: false,
          error: `Book ${code} chapter ${i + 1} has invalid verse count: ${vc}`,
        };
      }
    }
  }
  return { ok: true };
}
