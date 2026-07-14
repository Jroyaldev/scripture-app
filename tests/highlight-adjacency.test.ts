import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSegments, buildRuns, resolveBlobExtent, type HighlightLike } from "../src/core/events/highlightAdjacency.js";

function hl(id: string, vs: number, ve: number, color: string, cs: number | null = null, ce: number | null = null): HighlightLike {
  return { id, verse_start: vs, verse_end: ve, char_start: cs, char_end: ce, color };
}

test("two adjacent same-color single-verse records merge into one run", () => {
  const runs = buildRuns(buildSegments([hl("a", 3, 3, "blue"), hl("b", 4, 4, "blue")]));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.segments.length, 2);
});

test("same-color records with an unhighlighted verse between them do NOT merge", () => {
  const runs = buildRuns(buildSegments([hl("a", 3, 3, "blue"), hl("b", 5, 5, "blue")]));
  assert.equal(runs.length, 2);
});

test("adjacent different-color records do not merge", () => {
  const runs = buildRuns(buildSegments([hl("a", 3, 3, "blue"), hl("b", 4, 4, "green")]));
  assert.equal(runs.length, 2);
});

test("a multi-verse whole-verse record folds into one run across its verses", () => {
  const runs = buildRuns(buildSegments([hl("a", 3, 6, "blue")]));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.segments.length, 4); // verses 3,4,5,6
});

test("two touching same-verse char ranges of the same color merge", () => {
  // verse 5: [0,10) then [10,20), same color.
  const runs = buildRuns(buildSegments([hl("a", 5, 5, "pink", 0, 10), hl("b", 5, 5, "pink", 10, 20)]));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.segments.length, 2);
});

test("two same-verse char ranges with a gap between them do NOT merge", () => {
  // verse 5: [0,10) then [15,20) — gap [10,15) of unhighlighted text.
  const runs = buildRuns(buildSegments([hl("a", 5, 5, "pink", 0, 10), hl("b", 5, 5, "pink", 15, 20)]));
  assert.equal(runs.length, 2);
});

test("a phrase ending at the verse's end (charEnd null) bridges into a same-color next verse", () => {
  // verse 5 [3,end] whole-tail + verse 6 whole-verse, same color → merge.
  const runs = buildRuns(buildSegments([hl("a", 5, 5, "blue", 3, null), hl("b", 6, 6, "blue")]));
  assert.equal(runs.length, 1);
});

test("a phrase stopping mid-verse does NOT bridge into the same-color next verse", () => {
  // verse 5 [3,8) (stops mid-verse) + verse 6 whole-verse same color → separate.
  const runs = buildRuns(buildSegments([hl("a", 5, 5, "blue", 3, 8), hl("b", 6, 6, "blue")]));
  assert.equal(runs.length, 2);
});

test("a whole verse does NOT bridge into a next-verse phrase that starts mid-verse", () => {
  // Regression: the adjacency check only looked at the earlier segment's
  // charEnd, never the later segment's charStart — so verse 3 (whole, reaches
  // its own end) wrongly bridged into verse 4's phrase [5,end) even though
  // verse 4's first 5 characters are a real, unhighlighted gap.
  const runs = buildRuns(buildSegments([hl("a", 3, 3, "blue"), hl("b", 4, 4, "blue", 5, null)]));
  assert.equal(runs.length, 2);
});

test("a phrase reaching a verse's true end bridges the same as a whole verse would", () => {
  // The renderer/selection layer normalizes charEnd to null when a drag
  // reaches the verse's literal last character (rangeToVerseCharOffsets) —
  // this is what makes a phrase-created highlight bridge into an adjacent
  // same-color verse exactly like a whole-verse highlight does. Simulated
  // here directly at the segment level with the post-normalization shape.
  const runs = buildRuns(buildSegments([hl("a", 3, 3, "blue", 10, null), hl("b", 4, 4, "blue")]));
  assert.equal(runs.length, 1);
});

test("resolveBlobExtent returns all record ids in the connected same-color blob", () => {
  const highlights = [hl("a", 3, 3, "blue"), hl("b", 4, 4, "blue"), hl("c", 5, 5, "blue"), hl("d", 7, 7, "green")];
  const extent = resolveBlobExtent(highlights, "b");
  assert.deepEqual([...extent].sort(), ["a", "b", "c"]);
});

test("resolveBlobExtent from a lone record returns just that record", () => {
  const highlights = [hl("a", 3, 3, "blue"), hl("d", 7, 7, "green")];
  assert.deepEqual(resolveBlobExtent(highlights, "d"), ["d"]);
});

test("resolveBlobExtent does not cross a color boundary", () => {
  const highlights = [hl("a", 3, 3, "blue"), hl("b", 4, 4, "green"), hl("c", 5, 5, "green")];
  assert.deepEqual([...resolveBlobExtent(highlights, "b")].sort(), ["b", "c"]);
});
