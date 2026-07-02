import assert from "node:assert/strict";
import { test } from "node:test";
import { isHighlightOverlap } from "../src/core/events/highlightOverlap.js";

test("adjacent-touching ranges overlap (inclusive): [1,3] vs [3,5]", () => {
  assert.equal(
    isHighlightOverlap({ verse_start: 1, verse_end: 3 }, { verseStart: 3, verseEnd: 5 }),
    true,
  );
});

test("disjoint ranges do not overlap: [1,3] vs [4,5]", () => {
  assert.equal(
    isHighlightOverlap({ verse_start: 1, verse_end: 3 }, { verseStart: 4, verseEnd: 5 }),
    false,
  );
});

test("incoming range fully inside existing: [1,5] vs [2,3]", () => {
  assert.equal(
    isHighlightOverlap({ verse_start: 1, verse_end: 5 }, { verseStart: 2, verseEnd: 3 }),
    true,
  );
});

test("existing range fully inside incoming: [2,3] vs [1,5]", () => {
  assert.equal(
    isHighlightOverlap({ verse_start: 2, verse_end: 3 }, { verseStart: 1, verseEnd: 5 }),
    true,
  );
});

test("identical single-verse ranges overlap: [5,5] vs [5,5]", () => {
  assert.equal(
    isHighlightOverlap({ verse_start: 5, verse_end: 5 }, { verseStart: 5, verseEnd: 5 }),
    true,
  );
});

test("reversed incoming range (verseStart > verseEnd) — documents actual behavior only; the UI always sorts ranges before calling this, so a reversed incoming range cannot occur in practice", () => {
  // existing [2,3], incoming {verseStart:5, verseEnd:1} (reversed).
  // Actual formula: existing.verse_start <= incoming.verseEnd && existing.verse_end >= incoming.verseStart
  //   => 2 <= 1 (false) && 3 >= 5 (false) => false
  assert.equal(
    isHighlightOverlap({ verse_start: 2, verse_end: 3 }, { verseStart: 5, verseEnd: 1 }),
    false,
  );
});
