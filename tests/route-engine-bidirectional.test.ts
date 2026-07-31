import assert from "node:assert/strict";
import test from "node:test";

import { planRoute } from "../src/core/annotations/route-engine.js";

type Rect = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };
type Segment = {
  type: "L" | "C";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c1x?: number;
  c1y?: number;
  c2x?: number;
  c2y?: number;
};

const rect = (left: number, right: number, top: number, bottom: number): Rect =>
  ({ left, right, top, bottom });

const DEFAULT_LINES = [
  rect(120, 380, 20, 30),
  rect(120, 380, 60, 70),
  rect(120, 380, 100, 110),
];

function makeBlock({
  renderedLines = DEFAULT_LINES,
  wordRuns = [],
  bounds = rect(0, 500, 0, 180),
  availableLeftMargin = 100,
  availableRightMargin = 100,
}: {
  renderedLines?: Rect[];
  wordRuns?: Rect[];
  bounds?: Rect;
  availableLeftMargin?: number;
  availableRightMargin?: number;
} = {}) {
  return {
    bounds,
    renderedLines,
    wordRuns,
    verseNumberRects: [],
    additionalObstacles: [],
    lineHeight: 40,
    preferredMargin: "left",
    availableLeftMargin,
    availableRightMargin,
  };
}

function makeAnn(id: string, fragments: Rect[]) {
  return makeWrappedAnn(id, fragments.map((fragment) => [fragment]));
}

function makeWrappedAnn(id: string, anchors: Rect[][]) {
  return {
    id,
    kind: "contrast",
    focused: false,
    anchors: anchors.map((fragments, documentOrder) => ({
      id: `${id}:${documentOrder}`,
      fragments,
      documentOrder,
    })),
  };
}

const marginOpts = {
  fontSize: 17,
  disableCradle: true,
  disableLocal: true,
  allowMiddle: false,
  leftLoomX: 90,
  rightLoomX: 410,
};

function near(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

function assertPointReflected(left: Point, right: Point, axisX: number): void {
  near(right.x, 2 * axisX - left.x);
  near(right.y, left.y);
}

function assertSegmentReflected(left: Segment, right: Segment, axisX: number): void {
  assert.equal(right.type, left.type);
  for (const key of ["x1", "x2"] as const) near(right[key], 2 * axisX - left[key]);
  for (const key of ["y1", "y2"] as const) near(right[key], left[key]);
  if (left.type === "C") {
    assert.equal(right.type, "C");
    for (const key of ["c1x", "c2x"] as const) near(right[key]!, 2 * axisX - left[key]!);
    for (const key of ["c1y", "c2y"] as const) near(right[key]!, left[key]!);
  }
}

function assertValidFinite(plan: ReturnType<typeof planRoute>, context: string): void {
  assert.equal(plan.valid, true, `${context}: ${plan.reason ?? "unknown route failure"}`);
  assert.ok(plan.centerline.length > 0, `${context}: empty centerline`);
  assert.ok(plan.sampledPoints.length > 0, `${context}: empty sampled geometry`);
  for (const segment of plan.centerline as Segment[]) {
    const values = segment.type === "C"
      ? [segment.x1, segment.y1, segment.c1x, segment.c1y, segment.c2x, segment.c2y, segment.x2, segment.y2]
      : [segment.x1, segment.y1, segment.x2, segment.y2];
    assert.ok(values.every((value) => Number.isFinite(value)), `${context}: non-finite segment`);
  }
  for (const point of [...plan.contacts, ...plan.ports, ...plan.sampledPoints]) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${context}: non-finite point`);
  }
  for (const claim of plan.claimsOut) {
    assert.ok(
      [claim.corridor, claim.y, claim.xMin, claim.xMax, claim.pad].every(Number.isFinite),
      `${context}: non-finite corridor claim`,
    );
    assert.ok(claim.xMin <= claim.xMax, `${context}: unnormalized corridor claim`);
  }
  assert.ok(Number.isFinite(plan.rawLength), `${context}: non-finite raw ink length`);
  assert.ok(Number.isFinite(plan.diagnostics.score), `${context}: non-finite score`);
  assert.equal(plan.diagnostics.intersections, 0, `${context}: obstacle validation failed`);
}

test("the complete right margin grammar is the exact reflection of the left grammar", () => {
  const axisX = 250;
  const leftFragments = [
    rect(180, 205, 20, 30),
    rect(230, 250, 20, 30),
    rect(200, 225, 60, 70),
    rect(260, 280, 100, 110),
  ];
  const reflectRect = (fragment: Rect): Rect =>
    rect(2 * axisX - fragment.right, 2 * axisX - fragment.left, fragment.top, fragment.bottom);
  const block = makeBlock();
  const left = planRoute(block, makeAnn("mirror-left", leftFragments), {
    ...marginOpts,
    sides: ["left"],
  });
  const right = planRoute(block, makeAnn("mirror-right", leftFragments.map(reflectRect)), {
    ...marginOpts,
    sides: ["right"],
  });

  assertValidFinite(left, "left reflection fixture");
  assertValidFinite(right, "right reflection fixture");
  assert.equal(left.mode, "multipoint");
  assert.equal(right.mode, left.mode);
  assert.equal(left.side, "left");
  assert.equal(right.side, "right");
  assert.deepEqual(right.diagnostics.exits, left.diagnostics.exits);
  near(right.rawLength, left.rawLength);
  near(right.semCenter, 2 * axisX - left.semCenter);
  near(right.marginRailX, 2 * axisX - left.marginRailX);

  assert.equal(right.contacts.length, left.contacts.length);
  left.contacts.forEach((point: Point, index: number) =>
    assertPointReflected(point, right.contacts[index], axisX));
  assert.equal(right.ports.length, left.ports.length);
  left.ports.forEach((point: Point, index: number) =>
    assertPointReflected(point, right.ports[index], axisX));
  assert.equal(right.centerline.length, left.centerline.length);
  left.centerline.forEach((segment: Segment, index: number) =>
    assertSegmentReflected(segment, right.centerline[index], axisX));

  assert.ok(left.spine && right.spine);
  near(right.spine.x, 2 * axisX - left.spine.x);
  near(right.spine.top, left.spine.top);
  near(right.spine.bottom, left.spine.bottom);
  assert.deepEqual(right.strandClaimOut, {
    side: "right",
    strand: left.strandClaimOut.strand,
    top: left.strandClaimOut.top,
    bottom: left.strandClaimOut.bottom,
  });

  assert.equal(right.claimsOut.length, left.claimsOut.length);
  left.claimsOut.forEach((claim: { corridor: number; y: number; xMin: number; xMax: number; pad: number }, index: number) => {
    const reflected = right.claimsOut[index];
    assert.equal(reflected.corridor, claim.corridor);
    near(reflected.y, claim.y);
    near(reflected.xMin, 2 * axisX - claim.xMax);
    near(reflected.xMax, 2 * axisX - claim.xMin);
    near(reflected.pad, claim.pad);
  });
});

test("right routes keep level, comb, tag, corridor, multipoint, and wrapped-anchor cases finite", () => {
  const cases = [
    {
      name: "level tag",
      anchors: [[rect(235, 265, 20, 30)]],
      mode: "tag",
      exits: ["level"],
    },
    {
      name: "same-line comb",
      anchors: [
        [rect(170, 195, 20, 30)],
        [rect(220, 245, 20, 30)],
        [rect(270, 295, 20, 30)],
      ],
      mode: "corridor",
      /* C0.5c: one colinear run threads every dot in the group */
      exits: ["level"],
    },
    /* C0.5c: every group is one colinear level run and one soft corner.
     * The bottommost group's corner turns UP into the rail (the bracket);
     * all exits are honest "level" — no drop family exists.
     *
     * DATED REVERSAL, 2026-07-30 (the connection-lines revival): this case
     * previously pinned mode "corridor" — two runs, two 6px corners, a
     * straight rail. The reader asked for "s curves … not just underline
     * with a line pointing at margin", so a route of exactly two
     * single-line groups within bow span now draws the BOW: the same
     * colinear level runs to the rail datum, joined by one horizontal-
     * tangent cubic through a vertical apex beyond the rail. Exits stay
     * honest "level"; three-plus groups keep the swept bracket below. */
    {
      name: "two-line bow",
      anchors: [[rect(220, 250, 20, 30)], [rect(260, 290, 60, 70)]],
      mode: "bow",
      exits: ["level", "level"],
    },
    {
      name: "three-line multipoint",
      anchors: [
        [rect(220, 250, 20, 30)],
        [rect(260, 290, 60, 70)],
        [rect(200, 230, 100, 110)],
      ],
      mode: "multipoint",
      exits: ["level", "level", "level"],
    },
    {
      name: "wrapped nested anchor",
      anchors: [
        [rect(210, 250, 20, 30), rect(150, 200, 60, 70)],
        [rect(240, 280, 100, 110)],
      ],
      /* two representative groups within bow span → bow (2026-07-30) */
      mode: "bow",
      exits: ["level", "level"],
    },
  ];

  for (const fixture of cases) {
    const wordRuns = fixture.anchors.flat();
    const plan = planRoute(makeBlock({ wordRuns }), makeWrappedAnn(fixture.name, fixture.anchors), {
      ...marginOpts,
      sides: ["right"],
    });
    assertValidFinite(plan, fixture.name);
    assert.equal(plan.side, "right", fixture.name);
    assert.equal(plan.strand, 0, fixture.name);
    assert.equal(plan.marginRailX, 410, fixture.name);
    assert.equal(plan.mode, fixture.mode, fixture.name);
    assert.deepEqual(plan.diagnostics.exits, fixture.exits, fixture.name);
    assert.ok(plan.contacts.every((contact: Point) => contact.x < plan.marginRailX), fixture.name);
    /* C0.5c bracket semantics, independent of the golden digests: every run
     * is genuinely colinear with an underline, and in a multi-group route
     * the bottommost corner turns UP (port above its run) while every other
     * corner turns down (port below its run).
     *
     * REVISED 2026-07-30 (the connection-lines revival): a two-group bow
     * has no corners at all — the rail contracts to a point, so both ports
     * sit EXACTLY on their run levels and the S carries the whole turn.
     * The bracket's up/down law still governs every multi-group route. */
    const ports = [...plan.ports].sort((a: Point, b: Point) => a.y - b.y);
    const runYs = [...new Set(plan.contacts.map((contact: Point) => contact.y))]
      .sort((a: number, b: number) => a - b);
    if (plan.mode === "bow") {
      assert.equal(ports.length, 2, `${fixture.name}: a bow joins exactly two runs`);
      assert.deepEqual(ports.map((port: Point) => port.y), runYs,
        `${fixture.name}: bow ports sit exactly on their run levels`);
    } else if (ports.length > 1) {
      const bottomRunY = runYs[runYs.length - 1]!;
      const bottomPort = ports[ports.length - 1]!;
      assert.ok(bottomPort.y < bottomRunY,
        `${fixture.name}: the bottom corner must turn UP into the rail`);
      for (const port of ports.slice(0, -1)) {
        const nearestRun = runYs.reduce((best: number, y: number) =>
          Math.abs(y - port.y) < Math.abs(best - port.y) ? y : best, runYs[0]!);
        assert.ok(port.y > nearestRun,
          `${fixture.name}: a non-bottom corner must turn down with the flow`);
      }
    }
  }
});

test("a right level exit selects the greatest right edge in an overlapping same-line group", () => {
  const fragments = [
    rect(170, 250, 20, 30),
    rect(220, 320, 20, 30),
    rect(270, 300, 20, 30),
  ];
  const plan = planRoute(
    makeBlock({
      renderedLines: [DEFAULT_LINES[0]],
      wordRuns: fragments,
      bounds: rect(0, 500, 0, 100),
    }),
    makeAnn("nested-right-selector", fragments),
    { ...marginOpts, sides: ["right"] },
  );

  assertValidFinite(plan, "overlapping right selector");
  assert.equal(plan.mode, "corridor");
  /* C0.5c: the whole group rides one colinear run through every dot */
  assert.deepEqual(plan.diagnostics.exits, ["level"]);
  assert.equal(plan.contacts[0].x, 319.5, "drawing order starts from the greatest frag.right");
  assert.equal(plan.claimsOut[0].xMin, 249.5,
    "the run claim spans from the innermost dot to the rail");
});

test("strand claims are local to a side and each side escalates independently", () => {
  const fragments = [
    rect(220, 250, 20, 30),
    rect(260, 290, 60, 70),
    rect(200, 230, 100, 110),
  ];
  const block = makeBlock({ wordRuns: fragments });
  const ann = makeAnn("strand-locality", fragments);
  const interval = { top: 0, bottom: 180 };

  const oppositeClaim = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    strandClaims: [{ side: "left", strand: 0, ...interval }],
  });
  assertValidFinite(oppositeClaim, "opposite-side strand claim");
  assert.equal(oppositeClaim.strand, 0);
  assert.equal(oppositeClaim.marginRailX, 410);

  const innerClaimed = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    strandClaims: [{ side: "right", strand: 0, ...interval }],
  });
  assertValidFinite(innerClaimed, "right strand zero claimed");
  assert.equal(innerClaimed.strand, 1);
  assert.equal(innerClaimed.marginRailX, 416);

  const twoClaimed = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    strandClaims: [
      { side: "right", strand: 0, ...interval },
      { side: "right", strand: 1, ...interval },
    ],
  });
  assertValidFinite(twoClaimed, "right strands zero and one claimed");
  assert.equal(twoClaimed.strand, 2);
  assert.equal(twoClaimed.marginRailX, 422);
});

test("the scorer uses actual ink, quantized ties, semantic center, and 12-unit hysteresis", () => {
  const centeredFragment = rect(235, 265, 20, 30);
  const block = makeBlock({
    renderedLines: [DEFAULT_LINES[0]],
    bounds: rect(0, 500, 0, 100),
  });
  const ann = makeAnn("scorer", [centeredFragment]);
  const common = { ...marginOpts, disableCradle: true, sides: ["left", "right"] };

  const rightFirstTie = planRoute(block, ann, { ...common, sides: ["right", "left"] });
  const leftFirstTie = planRoute(block, ann, { ...common, sides: ["left", "right"] });
  assertValidFinite(rightFirstTie, "right-first score tie");
  assertValidFinite(leftFirstTie, "left-first score tie");
  assert.equal(rightFirstTie.side, "right");
  assert.equal(leftFirstTie.side, "left");
  assert.equal(
    rightFirstTie.diagnostics.score,
    rightFirstTie.diagnostics.alternativesConsidered[0].score,
    "equal rounded scores must defer to requested-side order",
  );

  const forcedLeft = planRoute(block, ann, { ...common, sides: ["left"], rightLoomX: 405 });
  const forcedRight = planRoute(block, ann, { ...common, sides: ["right"], rightLoomX: 405 });
  assert.ok(forcedRight.rawLength < forcedLeft.rawLength, "fixture must make the right route shorter");
  const shorterWins = planRoute(block, ann, { ...common, rightLoomX: 405 });
  assert.equal(shorterWins.side, "right");

  const underHysteresis = planRoute(block, ann, {
    ...common,
    rightLoomX: 400,
    previousSide: "left",
  });
  assert.equal(underHysteresis.side, "left", "a 10-unit improvement must not flap sides");

  const quantizedBoundary = planRoute(block, ann, {
    ...common,
    rightLoomX: 398,
    previousSide: "left",
  });
  assert.equal(quantizedBoundary.side, "left");
  assert.equal(
    quantizedBoundary.diagnostics.score,
    quantizedBoundary.diagnostics.alternativesConsidered[0].score,
    "the rounded 0.1 score tie must be settled by requested-side order",
  );

  const beyondHysteresis = planRoute(block, ann, {
    ...common,
    rightLoomX: 395,
    previousSide: "left",
  });
  assert.equal(beyondHysteresis.side, "right", "a 15-unit improvement must beat hysteresis");

  const offsetFragments = [rect(200, 220, 20, 30), rect(330, 350, 60, 70)];
  const offsetAnn = makeAnn("semantic-center", offsetFragments);
  const offsetBlock = makeBlock({ wordRuns: offsetFragments });
  const semanticLeft = planRoute(offsetBlock, offsetAnn, { ...marginOpts, sides: ["left"] });
  const semanticRight = planRoute(offsetBlock, offsetAnn, { ...marginOpts, sides: ["right"] });
  assert.equal(semanticLeft.semCenter, 275);
  assert.equal(semanticRight.semCenter, 275);
  near(semanticLeft.scoreRaw - semanticLeft.rawLength, (275 - 250) * 0.035);
  near(semanticRight.scoreRaw - semanticRight.rawLength, 0);
});

test("right corridor claims reuse disjoint rungs and stagger overlapping spans", () => {
  const fragment = rect(235, 265, 20, 30);
  const block = makeBlock({
    renderedLines: [DEFAULT_LINES[0]],
    bounds: rect(0, 500, 0, 100),
  });
  const ann = makeAnn("right-claims", [fragment]);
  const opts = { ...marginOpts, sides: ["right"] };
  const baseline = planRoute(block, ann, opts);
  assertValidFinite(baseline, "right claim baseline");
  assert.equal(baseline.claimsOut.length, 1);
  const claim = baseline.claimsOut[0];
  /* C0.5b: underline-level travel is only vetoed by RAW ink, so this tag
   * exits level and claims the underline rung itself */
  near(claim.y, 32);

  const disjoint = planRoute(block, ann, {
    ...opts,
    corridorClaims: [{ corridor: claim.corridor, y: claim.y, xMin: 100, xMax: 200, pad: 0 }],
  });
  assertValidFinite(disjoint, "right disjoint claim");
  near(disjoint.claimsOut[0].y, claim.y);

  const overlapping = planRoute(block, ann, {
    ...opts,
    corridorClaims: [{ corridor: claim.corridor, y: claim.y, xMin: 300, xMax: 350, pad: 0 }],
  });
  /* C0.5c: there is no offset shoulder to dodge into. A claimed underline
   * rung holds honestly instead of drawing a parallel line below it. */
  assert.equal(overlapping.valid, false, "right overlapping claim must hold");
  assert.equal(overlapping.reason, "needs-space");

  const reversedOverlap = planRoute(block, ann, {
    ...opts,
    corridorClaims: [{ corridor: claim.corridor, y: claim.y, xMin: 350, xMax: 300, pad: 0 }],
  });
  assert.equal(reversedOverlap.valid, false, "reversed overlapping claim must hold");
  assert.equal(reversedOverlap.reason, "needs-space");
});

test("right strands stay in measured margin air and at least four pixels inside bounds", () => {
  const fragment = rect(235, 265, 20, 30);
  const block = makeBlock({
    renderedLines: [DEFAULT_LINES[0]],
    bounds: rect(0, 500, 0, 100),
  });
  const ann = makeAnn("right-bounds", [fragment]);

  const escalatedToAir = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    rightLoomX: 383,
  });
  assertValidFinite(escalatedToAir, "right datum inside prose air");
  assert.equal(escalatedToAir.strand, 2);
  assert.equal(escalatedToAir.marginRailX, 395);

  const noMeasuredAir = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    rightLoomX: 382,
  });
  assert.equal(noMeasuredAir.valid, false);
  assert.equal(noMeasuredAir.reason, "needs-space");

  const edge = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    rightLoomX: 496,
  });
  assertValidFinite(edge, "four-pixel right edge");
  assert.equal(edge.marginRailX, 496);

  const edgeClaimed = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    rightLoomX: 496,
    strandClaims: [{ side: "right", strand: 0, top: 0, bottom: 100 }],
  });
  assert.equal(edgeClaimed.valid, false);
  assert.equal(edgeClaimed.reason, "needs-space");

  const outsideEdge = planRoute(block, ann, {
    ...marginOpts,
    sides: ["right"],
    rightLoomX: 496.01,
  });
  assert.equal(outsideEdge.valid, false);
  assert.equal(outsideEdge.reason, "needs-space");
});

test("legacy loomX and omitted sides preserve the left plan byte-for-byte", () => {
  const fragments = [
    rect(180, 205, 20, 30),
    rect(230, 250, 20, 30),
    rect(200, 225, 60, 70),
    rect(260, 280, 100, 110),
  ];
  const block = makeBlock();
  const ann = makeAnn("legacy-left", fragments);
  const legacy = planRoute(block, ann, {
    fontSize: 17,
    disableCradle: true,
    disableLocal: true,
    allowMiddle: false,
    loomX: 90,
  });
  const explicit = planRoute(block, ann, {
    fontSize: 17,
    disableCradle: true,
    disableLocal: true,
    allowMiddle: false,
    leftLoomX: 90,
    sides: ["left"],
  });
  assertValidFinite(legacy, "legacy left plan");
  assert.deepEqual(explicit, legacy);
});

test("unsupported sides are declined and never reinterpreted as left", () => {
  const fragment = rect(235, 265, 20, 30);
  const block = makeBlock({ renderedLines: [DEFAULT_LINES[0]] });
  const ann = makeAnn("unsupported-side", [fragment]);

  const unsupportedOnly = planRoute(block, ann, {
    ...marginOpts,
    sides: ["top"],
  });
  assert.equal(unsupportedOnly.valid, false);
  assert.equal(unsupportedOnly.reason, "needs-space");
  assert.equal(unsupportedOnly.detail, "no-supported-side");
  assert.deepEqual(unsupportedOnly.declined, [{ move: "margin:top", why: "unsupported" }]);

  const mixed = planRoute(block, ann, {
    ...marginOpts,
    sides: ["top", "right"],
  });
  assertValidFinite(mixed, "mixed supported and unsupported sides");
  assert.equal(mixed.side, "right");
  assert.ok(mixed.diagnostics.declined.some((entry: { move: string; why: string }) =>
    entry.move === "margin:top" && entry.why === "unsupported"));
});
