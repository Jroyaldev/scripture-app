import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseConnectionWordHit,
  orderConnectionWordHits,
  resolveReadingPointerIntent,
} from "../src/renderer/utils/readingInteraction.js";

test("a real drag outranks connected-word and verse click behavior", () => {
  assert.equal(resolveReadingPointerIntent({
    nativeSelectionCollapsed: false,
    connectionHitCount: 2,
    insideVerse: true,
  }), "marking-selection");
});

test("a collapsed exact-word click outranks the surrounding research verse", () => {
  assert.equal(resolveReadingPointerIntent({
    nativeSelectionCollapsed: true,
    connectionHitCount: 1,
    insideVerse: true,
  }), "connection");
  assert.equal(resolveReadingPointerIntent({
    nativeSelectionCollapsed: true,
    connectionHitCount: 0,
    insideVerse: true,
  }), "research");
  assert.equal(resolveReadingPointerIntent({
    nativeSelectionCollapsed: true,
    connectionHitCount: 0,
    insideVerse: false,
  }), "dismiss");
});

test("the selected exact connection remains idempotent on repeated word clicks", () => {
  const candidates = [
    { id: "connection-b", value: "B", area: 30 },
    { id: "connection-a", value: "A", area: 20 },
  ];
  assert.equal(chooseConnectionWordHit(candidates, "connection-b", [])?.value, "B");
});

test("the latest deliberate hold wins before exact-area and stable-id ties", () => {
  const candidates = [
    { id: "connection-a", value: "A", area: 10 },
    { id: "connection-b", value: "B", area: 20 },
  ];
  assert.equal(
    chooseConnectionWordHit(candidates, null, ["connection-a", "connection-b"])?.value,
    "B",
  );
});

test("overlapping unheld connections choose the smallest exact phrase deterministically", () => {
  const candidates = [
    { id: "connection-z", value: "Z", area: 20 },
    { id: "connection-b", value: "B", area: 12 },
    { id: "connection-a", value: "A", area: 12 },
    { id: "connection-a", value: "duplicate", area: 18 },
  ];
  assert.equal(chooseConnectionWordHit(candidates, null, [])?.value, "A");
  assert.equal(chooseConnectionWordHit([], null, []), null);
});

test("an overlap chooser orders selected, recent holds, then exact specificity", () => {
  const ordered = orderConnectionWordHits([
    { id: "connection-small", value: "small", area: 10 },
    { id: "connection-held-old", value: "held-old", area: 30 },
    { id: "connection-selected", value: "selected", area: 40 },
    { id: "connection-held-new", value: "held-new", area: 50 },
  ], "connection-selected", ["connection-held-old", "connection-held-new"]);
  assert.deepEqual(ordered.map((candidate) => candidate.value), [
    "selected",
    "held-new",
    "held-old",
    "small",
  ]);
});
