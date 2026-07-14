import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSegments, buildRuns, resolveBlobExtent, type HighlightLike } from "../src/core/events/highlightAdjacency.js";

function hl(id: string, vs: number, ve: number, color: string, cs: number | null = null, ce: number | null = null): HighlightLike {
  return { id, verse_start: vs, verse_end: ve, char_start: cs, char_end: ce, color };
}

function scenario(): HighlightLike[] {
  return [
    hl("M", 1, 4, "blue"),
    hl("C2", 2, 2, "blue", 5, 10),
    hl("C3", 3, 3, "blue", 5, 10),
  ];
}

test("a segment that connects through any run member keeps one visual blob", () => {
  const runs = buildRuns(buildSegments(scenario()));
  assert.equal(runs.length, 1);
  assert.deepEqual([...new Set(runs[0]!.segments.map((segment) => segment.id))].sort(), ["C2", "C3", "M"]);
});

test("blob extent is symmetric regardless of the record used as entry point", () => {
  const highlights = scenario();
  const expected = ["C2", "C3", "M"];
  assert.deepEqual([...resolveBlobExtent(highlights, "M")].sort(), expected);
  assert.deepEqual([...resolveBlobExtent(highlights, "C2")].sort(), expected);
  assert.deepEqual([...resolveBlobExtent(highlights, "C3")].sort(), expected);
});
