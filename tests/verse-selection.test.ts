import assert from "node:assert/strict";
import { test } from "node:test";
import { nextVerseSelection } from "../src/renderer/utils/verseSelection.js";

test("a normal click selects one verse and establishes the range anchor", () => {
  const result = nextVerseSelection(new Set([3, 4]), 3, 9, false);
  assert.deepEqual([...result.selection], [9]);
  assert.equal(result.anchor, 9);
});

test("shift selection is contiguous from the stable anchor in either direction", () => {
  const forward = nextVerseSelection(new Set([5]), 5, 8, true);
  assert.deepEqual([...forward.selection], [5, 6, 7, 8]);
  const backward = nextVerseSelection(forward.selection, forward.anchor, 3, true);
  assert.deepEqual([...backward.selection], [3, 4, 5]);
});

test("clicking the sole selected verse keeps a stable research scope", () => {
  const result = nextVerseSelection(new Set([5]), 5, 5, false);
  assert.deepEqual([...result.selection], [5]);
  assert.equal(result.anchor, 5);
});
