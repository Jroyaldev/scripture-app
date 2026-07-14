import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isHighlightOverlap,
  subtractHighlightRange,
} from "../src/core/events/highlightOverlap.js";

test("cross-verse endpoints are char-aware on the first and last verse", () => {
  const existing = {
    verse_start: 3,
    verse_end: 5,
    char_start: 10,
    char_end: 20,
  };

  assert.equal(
    isHighlightOverlap(existing, {
      verseStart: 3,
      verseEnd: 3,
      charStart: 0,
      charEnd: 10,
    }),
    false,
  );
  assert.equal(
    isHighlightOverlap(existing, {
      verseStart: 3,
      verseEnd: 3,
      charStart: 9,
      charEnd: 11,
    }),
    true,
  );
  assert.equal(
    isHighlightOverlap(existing, {
      verseStart: 5,
      verseEnd: 5,
      charStart: 20,
      charEnd: 30,
    }),
    false,
  );
});

test("subtracting interior whole verses preserves both outer remainders", () => {
  assert.deepEqual(
    subtractHighlightRange(
      { verse_start: 33, verse_end: 36, char_start: null, char_end: null },
      { verseStart: 34, verseEnd: 35, charStart: null, charEnd: null },
    ),
    [
      { verseStart: 33, verseEnd: 33, charStart: null, charEnd: null },
      { verseStart: 36, verseEnd: 36, charStart: null, charEnd: null },
    ],
  );
});

test("subtracting a cross-verse phrase keeps a continuous before and after range", () => {
  assert.deepEqual(
    subtractHighlightRange(
      { verse_start: 3, verse_end: 6, char_start: 4, char_end: 18 },
      { verseStart: 4, verseEnd: 5, charStart: 7, charEnd: 11 },
    ),
    [
      { verseStart: 3, verseEnd: 4, charStart: 4, charEnd: 7 },
      { verseStart: 5, verseEnd: 6, charStart: 11, charEnd: 18 },
    ],
  );
});

test("subtracting a same-verse phrase from a multi-verse range tiles around it", () => {
  assert.deepEqual(
    subtractHighlightRange(
      { verse_start: 1, verse_end: 3, char_start: null, char_end: null },
      { verseStart: 2, verseEnd: 2, charStart: 5, charEnd: 10 },
    ),
    [
      { verseStart: 1, verseEnd: 2, charStart: null, charEnd: 5 },
      { verseStart: 2, verseEnd: 3, charStart: 10, charEnd: null },
    ],
  );
});

test("subtracting an exact range leaves no remainder", () => {
  assert.deepEqual(
    subtractHighlightRange(
      { verse_start: 3, verse_end: 5, char_start: 8, char_end: 12 },
      { verseStart: 3, verseEnd: 5, charStart: 8, charEnd: 12 },
    ),
    [],
  );
});
