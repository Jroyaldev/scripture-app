import assert from "node:assert/strict";
import { test } from "node:test";
import { isHighlightOverlap } from "../src/core/events/highlightOverlap.js";

test("a phrase before a multi-verse range's first endpoint does not overlap", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 3, verse_end: 4, char_start: 10, char_end: 20 },
      { verseStart: 3, verseEnd: 3, charStart: 0, charEnd: 10 },
    ),
    false,
  );
});

test("a phrase after a multi-verse range's last endpoint does not overlap", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 3, verse_end: 4, char_start: 10, char_end: 20 },
      { verseStart: 4, verseEnd: 4, charStart: 20, charEnd: 30 },
    ),
    false,
  );
});

test("two multi-verse records may touch at one verse without overlapping", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 1, verse_end: 4, char_start: 8, char_end: 5 },
      { verseStart: 4, verseEnd: 8, charStart: 5, charEnd: 12 },
    ),
    false,
  );
});

test("a whole-verse endpoint still overlaps any phrase on that verse", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 3, verse_end: 4, char_start: null, char_end: null },
      { verseStart: 4, verseEnd: 4, charStart: 50, charEnd: 60 },
    ),
    true,
  );
});
