import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSegments, buildRuns, type HighlightLike } from "../src/core/events/highlightAdjacency.js";

function hl(id: string, vs: number, ve: number, color: string, cs: number | null = null, ce: number | null = null): HighlightLike {
  return { id, verse_start: vs, verse_end: ve, char_start: cs, char_end: ce, color };
}

test("multi-verse char endpoints scope only the first and last verse", () => {
  const segments = buildSegments([hl("cross", 1, 3, "blue", 40, 45)]);
  assert.deepEqual(
    segments.map((segment) => ({
      verse: segment.verse,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
    })),
    [
      { verse: 1, charStart: 40, charEnd: null },
      { verse: 2, charStart: null, charEnd: null },
      { verse: 3, charStart: null, charEnd: 45 },
    ],
  );
});

test("a partial last verse does not bridge into the next verse", () => {
  const runs = buildRuns(buildSegments([
    hl("cross", 1, 3, "blue", 40, 45),
    hl("next", 4, 4, "blue"),
  ]));
  assert.equal(runs.length, 2);
});

test("a cross-verse range ending at the verse boundary bridges cleanly", () => {
  const runs = buildRuns(buildSegments([
    hl("cross", 1, 3, "blue", 40, null),
    hl("next", 4, 4, "blue"),
  ]));
  assert.equal(runs.length, 1);
});
