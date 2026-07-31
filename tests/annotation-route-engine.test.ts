import assert from "node:assert/strict";
import test from "node:test";

import {
  assignStrands,
  planRoute,
  rankCompanions,
  type RouteAnnotation,
  type RouteBlock,
  type RouteOptions,
  type RoutePlan,
  type RouteRect,
  type ValidRoutePlan,
} from "../src/core/annotations/route-engine.js";

const rect = (left: number, right: number, top: number, bottom: number): RouteRect =>
  ({ left, right, top, bottom });

const lines = [
  rect(120, 380, 20, 30),
  rect(120, 380, 60, 70),
  rect(120, 380, 100, 110),
];

function makeBlock(): RouteBlock {
  return {
    bounds: rect(0, 500, 0, 180),
    renderedLines: lines,
    wordRuns: [],
    verseNumberRects: [],
    additionalObstacles: [],
    lineHeight: 40,
    preferredMargin: "left",
    availableLeftMargin: 100,
    availableRightMargin: 100,
  };
}

function makeAnnotation(id: string, fragments: RouteRect[]): RouteAnnotation {
  return {
    id,
    kind: "contrast",
    focused: false,
    anchors: fragments.map((fragment, documentOrder) => ({
      id: `${id}:${documentOrder}`,
      fragments: [fragment],
      documentOrder,
    })),
  };
}

const marginOptions: RouteOptions = {
  fontSize: 17,
  disableCradle: true,
  disableLocal: true,
  allowMiddle: false,
  leftLoomX: 90,
  rightLoomX: 410,
};

function assertValid(plan: RoutePlan): asserts plan is ValidRoutePlan {
  assert.equal(plan.valid, true, plan.valid ? undefined : plan.reason);
}

test("planRoute is deterministic across replay and anchor storage order", () => {
  const block = makeBlock();
  const annotation = makeAnnotation("deterministic", [
    rect(180, 205, 20, 30),
    rect(260, 280, 100, 110),
  ]);
  const options: RouteOptions = { ...marginOptions, sides: ["left"] };
  const before = structuredClone({ block, annotation, options });

  const first = planRoute(block, annotation, options);
  const replay = planRoute(
    structuredClone(block),
    structuredClone(annotation),
    structuredClone(options),
  );
  const reversed = planRoute(
    structuredClone(block),
    { ...structuredClone(annotation), anchors: [...annotation.anchors].reverse() },
    structuredClone(options),
  );

  assert.deepEqual(replay, first);
  assert.deepEqual(reversed, first);
  assert.deepEqual({ block, annotation, options }, before, "planner must not mutate measured inputs");
  assertValid(first);
  assert.deepEqual({
    valid: first.valid,
    mode: first.mode,
    side: first.side,
    contacts: first.contacts,
    corridors: first.corridors,
    marginRailX: first.marginRailX,
    ports: first.ports,
    spine: first.spine,
    claimsOut: first.claimsOut,
    score: first.diagnostics.score,
  }, {
    valid: true,
    // DATED REVERSAL, 2026-07-30 (the connection-lines revival). This pin
    // previously read mode "corridor": the C0.5 bracket — level runs, two
    // 6px corners at ports y 38/106, a straight rail spine 38..106, score
    // 335.8. The reader asked for "s curves … not just underline with a
    // line pointing at margin", so a two-line route now draws the BOW: the
    // same level runs and the same corridor claims, with one horizontal-
    // tangent cubic sweeping through a vertical apex 14px beyond the rail
    // (spine.x 76 = rail 90 − apex 14). Contacts, corridors, rail, and
    // claims are unchanged — the reversal is curvature, not routing.
    mode: "bow",
    side: "left",
    contacts: [{ x: 180.5, y: 32 }, { x: 260.5, y: 112 }],
    corridors: [32, 112],
    marginRailX: 90,
    ports: [{ x: 90, y: 32 }, { x: 90, y: 112 }],
    spine: { x: 76, top: 32, bottom: 112 },
    claimsOut: [
      { corridor: 1, y: 32, xMin: 90, xMax: 180.5, pad: 0 },
      { corridor: 3, y: 112, xMin: 90, xMax: 260.5, pad: 0 },
    ],
    score: 351.4,
  });
});

test("explicit left and right tag plans emit exact mirrored output", () => {
  const block = makeBlock();
  const annotation = makeAnnotation("tag", [rect(235, 265, 20, 30)]);
  const left = planRoute(block, annotation, { ...marginOptions, sides: ["left"] });
  const right = planRoute(block, annotation, { ...marginOptions, sides: ["right"] });
  assertValid(left);
  assertValid(right);

  const project = (plan: ValidRoutePlan) => ({
    valid: plan.valid,
    mode: plan.mode,
    side: plan.side,
    strand: plan.strand,
    contacts: plan.contacts,
    ports: plan.ports,
    marginRailX: plan.marginRailX,
    claimsOut: plan.claimsOut,
    centerline: plan.centerline,
    rawLength: plan.rawLength,
    score: plan.diagnostics.score,
  });

  assert.deepEqual(project(left), {
    valid: true,
    mode: "tag",
    side: "left",
    strand: 0,
    contacts: [{ x: 235.5, y: 32 }],
    ports: [{ x: 90, y: 32 }],
    marginRailX: 90,
    claimsOut: [{ corridor: 1, y: 32, xMin: 90, xMax: 235.5, pad: 0 }],
    centerline: [{ type: "L", x1: 235.5, y1: 32, x2: 90, y2: 32 }],
    rawLength: 145.5,
    score: 145.5,
  });
  assert.deepEqual(project(right), {
    valid: true,
    mode: "tag",
    side: "right",
    strand: 0,
    contacts: [{ x: 264.5, y: 32 }],
    ports: [{ x: 410, y: 32 }],
    marginRailX: 410,
    claimsOut: [{ corridor: 1, y: 32, xMin: 264.5, xMax: 410, pad: 0 }],
    centerline: [{ type: "L", x1: 264.5, y1: 32, x2: 410, y2: 32 }],
    rawLength: 145.5,
    score: 145.5,
  });
});

test("rankCompanions is pure and resolves overlap ties deterministically", () => {
  const intervals = [
    { id: "focus", top: 40, bottom: 60 },
    { id: "wide", top: 0, bottom: 100 },
    { id: "same-b", top: 42, bottom: 52 },
    { id: "same-a", top: 42, bottom: 52 },
    { id: "near", top: 61, bottom: 70 },
    { id: "far", top: 90, bottom: 100 },
  ];
  const before = structuredClone(intervals);

  assert.deepEqual(
    rankCompanions(intervals, "focus"),
    ["same-a", "same-b", "wide", "near", "far"],
  );
  assert.deepEqual(intervals, before);
  assert.deepEqual(rankCompanions(intervals, "missing"), intervals.map(({ id }) => id));
});

test("assignStrands is input-order independent and holds overflow at -1", () => {
  const annotations = [
    { id: "late", top: 30, bottom: 50, focused: false },
    { id: "focus", top: 20, bottom: 40, focused: true },
    { id: "early", top: 0, bottom: 10, focused: false },
    { id: "clash", top: 22, bottom: 36, focused: false },
    { id: "disjoint", top: 60, bottom: 70, focused: false },
  ];
  const expected = [
    ["focus", 0],
    ["early", 0],
    ["clash", 1],
    ["late", -1],
    ["disjoint", 0],
  ];

  assert.deepEqual([...assignStrands(annotations, 2)], expected);
  assert.deepEqual([...assignStrands([...annotations].reverse(), 2)], expected);
});
