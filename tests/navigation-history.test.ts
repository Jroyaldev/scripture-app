import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NAVIGATION_HISTORY_LIMIT,
  backNavigationHistory,
  createNavigationHistory,
  forwardNavigationHistory,
  pushNavigationHistory,
  type NavigationHistoryEntry,
} from "../src/renderer/utils/navigationHistory.js";

function entry(chapter: number, verse = chapter): NavigationHistoryEntry {
  return {
    book: "ACT",
    chapter,
    packageId: "bsb",
    verse,
    verseOffset: 164,
    scrollTop: chapter * 100,
    margin: {
      activeTab: chapter % 2 === 0 ? "connections" : "overview",
      scope: chapter % 2 === 0 ? { kind: "selection", start: verse, end: verse + 1 } : null,
    },
  };
}

test("new deliberate navigation pushes the current entry and clears Forward", () => {
  const current = entry(19, 5);
  const history = { back: [entry(18)], forward: [entry(20)] };
  const next = pushNavigationHistory(history, current);
  assert.deepEqual(next.back, [history.back[0], current]);
  assert.deepEqual(next.forward, []);
});

test("Back and Forward use browser stack semantics without losing context", () => {
  const a = entry(17, 1);
  const b = entry(18, 4);
  const c = entry(19, 7);
  const firstBack = backNavigationHistory({ back: [a, b], forward: [] }, c);
  assert.equal(firstBack.target, b);
  assert.deepEqual(firstBack.history.forward, [c]);
  const secondBack = backNavigationHistory(firstBack.history, b);
  const forward = forwardNavigationHistory(secondBack.history, a);
  assert.equal(forward.target, b);
  assert.deepEqual(forward.target?.margin, b.margin);
});

test("empty traversal is a no-op and both stacks are bounded", () => {
  const empty = createNavigationHistory();
  assert.deepEqual(backNavigationHistory(empty, entry(19)), { history: empty, target: null });
  assert.deepEqual(forwardNavigationHistory(empty, entry(19)), { history: empty, target: null });
  let history = empty;
  for (let chapter = 1; chapter <= NAVIGATION_HISTORY_LIMIT + 7; chapter += 1) {
    history = pushNavigationHistory(history, entry(chapter));
  }
  assert.equal(history.back.length, NAVIGATION_HISTORY_LIMIT);
  assert.equal(history.back[0]?.chapter, 8);
});
