import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHighlightPath, mergeHighlightLineRects, type LineRect } from "../src/renderer/utils/highlightPath.js";

test("overlapping rects on the same visual line merge into one clean band", () => {
  assert.deepEqual(
    mergeHighlightLineRects([
      { x0: 0, y0: 0, x1: 60, y1: 24 },
      { x0: 40, y0: 0.2, x1: 100, y1: 24.1 },
    ]),
    [{ x0: 0, y0: 0, x1: 100, y1: 24.1 }],
  );
});

test("separate phrases on one line remain separate rects", () => {
  assert.equal(
    mergeHighlightLineRects([
      { x0: 0, y0: 0, x1: 30, y1: 24 },
      { x0: 45, y0: 0, x1: 80, y1: 24 },
    ]).length,
    2,
  );
});

test("empty input yields empty path", () => {
  assert.equal(buildHighlightPath([]), "");
});

test("single line rect produces a rounded rectangle", () => {
  const r: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const d = buildHighlightPath([r], 4);
  assert.match(d, /^M/);
  assert.equal((d.match(/Q/g) ?? []).length, 4, d);
});

test("same-line colors share one subtly leaning seam with no gap", () => {
  const left = buildHighlightPath(
    [{ x0: 0, y0: 0, x1: 100, y1: 24 }],
    4,
    { joinTerminalRight: true, seamLean: 1 },
  );
  const right = buildHighlightPath(
    [{ x0: 100, y0: 0, x1: 180, y1: 24 }],
    4,
    { joinInitialLeft: true, seamLean: 1 },
  );
  assert.ok(left.includes("L99,0L101,24"), left);
  assert.ok(right.includes("L101,24") && right.includes("L99,0"), right);
});

test("stacked color handoff keeps one exact shared edge", () => {
  const r: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const d = buildHighlightPath([r], 4, { joinTerminalBottom: true });
  assert.equal((d.match(/Q/g) ?? []).length, 2, d);
  assert.ok(d.includes("L100,24L0,24"), d);
});

test("two equal-width stacked lines join without junction curves", () => {
  const a: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const b: LineRect = { x0: 0, y0: 24, x1: 100, y1: 48 };
  const d = buildHighlightPath([a, b], 4);
  assert.equal((d.match(/Q/g) ?? []).length, 4, d);
});

test("step-in on the right preserves a compact eased step", () => {
  const a: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const b: LineRect = { x0: 0, y0: 24, x1: 60, y1: 48 };
  const d = buildHighlightPath([a, b], 4);
  assert.equal((d.match(/Q/g) ?? []).length, 6, d);
  assert.ok(d.includes("L100,22.5Q100,24 98.5,24L61.5,24Q60,24 60,25.5"), d);
});

test("step-out on the right preserves a compact eased step", () => {
  const a: LineRect = { x0: 0, y0: 0, x1: 60, y1: 24 };
  const b: LineRect = { x0: 0, y0: 24, x1: 100, y1: 48 };
  const d = buildHighlightPath([a, b], 4);
  assert.equal((d.match(/Q/g) ?? []).length, 6, d);
  assert.ok(d.includes("L60,22.5Q60,24 61.5,24L98.5,24Q100,24 100,25.5"), d);
});

test("outer radius is clamped to half the shortest edge", () => {
  const a: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const b: LineRect = { x0: 0, y0: 24, x1: 60, y1: 48 };
  const d = buildHighlightPath([a, b], 100);
  assert.ok(d.startsWith("M12,0"), d);
});

test("input rects are reordered by y0 then x0", () => {
  const a: LineRect = { x0: 0, y0: 24, x1: 100, y1: 48 };
  const b: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const d = buildHighlightPath([a, b], 4);
  assert.equal((d.match(/Q/g) ?? []).length, 4, d);
  assert.ok(d.startsWith("M4,0"), d);
});

test("three lines: each right-side width step produces one compact junction", () => {
  const r1: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const r2: LineRect = { x0: 0, y0: 24, x1: 60, y1: 48 };
  const r3: LineRect = { x0: 0, y0: 48, x1: 90, y1: 72 };
  const d = buildHighlightPath([r1, r2, r3], 4);
  assert.equal((d.match(/Q/g) ?? []).length, 8, d);
});

test("a large left-side wrap confines easing to 1.5px so no corner nub forms", () => {
  const r1: LineRect = { x0: 10, y0: 0, x1: 100, y1: 24 };
  const r2: LineRect = { x0: 0, y0: 24, x1: 100, y1: 48 };
  const d = buildHighlightPath([r1, r2], 4);
  assert.equal((d.match(/Q/g) ?? []).length, 6, d);
  assert.ok(d.includes("L0,25.5Q0,24 1.5,24L8.5,24Q10,24 10,22.5"), d);
  assert.ok(!d.includes("A"), d);
});

test("path is closed", () => {
  const r: LineRect = { x0: 0, y0: 0, x1: 100, y1: 24 };
  const d = buildHighlightPath([r], 4);
  assert.ok(d.endsWith("Z"), d);
});
