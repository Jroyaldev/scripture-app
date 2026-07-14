import assert from "node:assert/strict";
import { test } from "node:test";
import { isHighlightOverlap, computeTrim } from "../src/core/events/highlightOverlap.js";

// --- char-aware isHighlightOverlap (single-verse, same verse) ---

test("same-verse char ranges that only touch do NOT overlap: [0,5) vs [5,10)", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 5 },
      { verseStart: 5, verseEnd: 5, charStart: 5, charEnd: 10 },
    ),
    false,
  );
});

test("same-verse char ranges that share a character DO overlap: [0,6) vs [5,10)", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 6 },
      { verseStart: 5, verseEnd: 5, charStart: 5, charEnd: 10 },
    ),
    true,
  );
});

test("whole-verse existing (null chars) overlaps any char range in that verse", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 5, verse_end: 5, char_start: null, char_end: null },
      { verseStart: 5, verseEnd: 5, charStart: 3, charEnd: 8 },
    ),
    true,
  );
});

test("char range in verse 5 does not overlap a highlight in verse 6", () => {
  assert.equal(
    isHighlightOverlap(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 10 },
      { verseStart: 6, verseEnd: 6, charStart: 0, charEnd: 10 },
    ),
    false,
  );
});

test("an interior verse of a multi-verse range has whole-verse semantics", () => {
  // Endpoint chars scope verses 4 and 6 only. Verse 5 remains fully covered.
  assert.equal(
    isHighlightOverlap(
      { verse_start: 4, verse_end: 6, char_start: null, char_end: null },
      { verseStart: 5, verseEnd: 5, charStart: 100, charEnd: 200 },
    ),
    true,
  );
});

// --- computeTrim outcomes ---

test("trim delete: incoming fully covers existing", () => {
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: 3, char_end: 8 },
      { verseStart: 5, verseEnd: 5, charStart: 0, charEnd: 12 },
    ),
    { kind: "delete" },
  );
});

test("trim delete: incoming whole-verse covers a char-scoped existing", () => {
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: 3, char_end: 8 },
      { verseStart: 5, verseEnd: 5, charStart: null, charEnd: null },
    ),
    { kind: "delete" },
  );
});

test("trim shrink-after: incoming covers existing's head", () => {
  // existing [0,10), incoming [0,4) → existing keeps [4,10).
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 10 },
      { verseStart: 5, verseEnd: 5, charStart: 0, charEnd: 4 },
    ),
    { kind: "shrink-after", charStart: 4 },
  );
});

test("trim shrink-before: incoming covers existing's tail", () => {
  // existing [0,10), incoming [6,10) → existing keeps [0,6).
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 10 },
      { verseStart: 5, verseEnd: 5, charStart: 6, charEnd: 10 },
    ),
    { kind: "shrink-before", charEnd: 6 },
  );
});

test("trim shrink-before: existing whole-verse, incoming trims its tail to verse end", () => {
  // existing whole-verse [0,∞), incoming [6,∞) (to verse end) → keep [0,6).
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: null, char_end: null },
      { verseStart: 5, verseEnd: 5, charStart: 6, charEnd: null },
    ),
    { kind: "shrink-before", charEnd: 6 },
  );
});

test("trim split: incoming lands strictly inside existing", () => {
  // existing [0,20), incoming [5,10) → before [0,5), after [10,20).
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 20 },
      { verseStart: 5, verseEnd: 5, charStart: 5, charEnd: 10 },
    ),
    { kind: "split", before: { charEnd: 5 }, after: { charStart: 10 } },
  );
});

test("trim split of a whole-verse existing keeps the after piece open-ended", () => {
  // existing whole-verse [0,∞), incoming [5,10) → before [0,5), after [10,∞).
  // The 'after' piece's charStart is 10; its charEnd stays whatever existing
  // had (null = verse end), which the caller preserves via applyHighlightCreate.
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: null, char_end: null },
      { verseStart: 5, verseEnd: 5, charStart: 5, charEnd: 10 },
    ),
    { kind: "split", before: { charEnd: 5 }, after: { charStart: 10 } },
  );
});

test("trim split tiles perfectly: before.charEnd = incoming.start, after.charStart = incoming.end", () => {
  const incoming = { verseStart: 5, verseEnd: 5, charStart: 7, charEnd: 13 };
  const outcome = computeTrim(
    { verse_start: 5, verse_end: 5, char_start: 2, char_end: 20 },
    incoming,
  );
  assert.equal(outcome.kind, "split");
  if (outcome.kind === "split") {
    assert.equal(outcome.before.charEnd, incoming.charStart);
    assert.equal(outcome.after.charStart, incoming.charEnd);
  }
});

test("trim none: char ranges only touch (no shared character)", () => {
  assert.deepEqual(
    computeTrim(
      { verse_start: 5, verse_end: 5, char_start: 0, char_end: 5 },
      { verseStart: 5, verseEnd: 5, charStart: 5, charEnd: 10 },
    ),
    { kind: "none" },
  );
});
