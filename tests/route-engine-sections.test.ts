import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { _internals, planRoute } from "../lab/route-engine.js";

type Rect = { left: number; right: number; top: number; bottom: number };

const rect = (left: number, right: number, top: number, bottom: number): Rect =>
  ({ left, right, top, bottom });

function makeGoldenAnn(id: string, fragments: Rect[]) {
  return {
    id,
    kind: "contrast",
    focused: true,
    anchors: fragments.map((fragment, documentOrder) => ({
      id: `${id}:${documentOrder}`,
      fragments: [fragment],
      documentOrder,
    })),
  };
}

function makeGoldenBlock({
  bounds = rect(0, 400, 0, 120),
  renderedLines,
  wordRuns,
  verseNumberRects = [],
  additionalObstacles = [],
  lineHeight = 30,
  availableLeftMargin = 100,
  availableRightMargin = 100,
}: {
  bounds?: Rect;
  renderedLines: Rect[];
  wordRuns: Rect[];
  verseNumberRects?: Rect[];
  additionalObstacles?: Rect[];
  lineHeight?: number;
  availableLeftMargin?: number;
  availableRightMargin?: number;
}) {
  return {
    bounds,
    renderedLines,
    wordRuns,
    verseNumberRects,
    additionalObstacles,
    lineHeight,
    preferredMargin: "left",
    availableLeftMargin,
    availableRightMargin,
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function sha256Json(value: unknown): string {
  const json = JSON.stringify(stable(value));
  if (json === undefined) throw new Error("Golden value is not JSON-serializable");
  return createHash("sha256").update(json).digest("hex");
}

function legacyGeometryProjection(plan: ReturnType<typeof planRoute>): unknown {
  return stable({
    valid: plan.valid,
    reason: plan.reason,
    detail: plan.detail,
    mode: plan.mode,
    cradleVariant: plan.cradleVariant,
    side: plan.side,
    strand: plan.strand,
    contacts: plan.contacts,
    corridors: plan.corridors,
    corridorIdx: plan.corridorIdx,
    marginRailX: plan.marginRailX,
    centerline: plan.centerline,
    sampledPoints: {
      count: plan.sampledPoints?.length,
      sha256: sha256Json(plan.sampledPoints),
    },
    spine: plan.spine,
    ports: plan.ports,
    markerRanges: plan.markerRanges,
    claimsOut: plan.claimsOut,
    spineClaimOut: plan.spineClaimOut,
    strandClaimOut: plan.strandClaimOut,
    rawLength: plan.rawLength,
    semCenter: plan.semCenter,
    scoreRaw: plan.scoreRaw,
    diagnostics: plan.diagnostics && {
      minimumClearance: plan.diagnostics.minimumClearance,
      intersections: plan.diagnostics.intersections,
      cornerRadii: plan.diagnostics.cornerRadii,
      totalLength: plan.diagnostics.totalLength,
      laneIndex: plan.diagnostics.laneIndex,
      declined: plan.diagnostics.declined,
      exits: plan.diagnostics.exits,
      side: plan.diagnostics.side,
      score: plan.diagnostics.score,
      alternativesConsidered: plan.diagnostics.alternativesConsidered,
    },
  });
}

const compactLines = [rect(80, 320, 20, 30), rect(80, 180, 50, 60)];
const symmetricLines = [
  rect(100, 400, 20, 30),
  rect(100, 400, 60, 70),
  rect(100, 400, 100, 110),
];
const commonOpts = { fontSize: 17, focused: true, loomX: 65 };
const marginOpts = {
  fontSize: 17,
  focused: true,
  disableCradle: true,
  disableLocal: true,
  allowMiddle: false,
  leftLoomX: 90,
  rightLoomX: 410,
};
const cradleFragments = [rect(120, 145, 20, 30), rect(180, 205, 20, 30)];
const localFragments = [rect(160, 190, 20, 30)];
const middleFragments = [rect(120, 150, 20, 30), rect(190, 220, 50, 60)];
const leftFragments = [rect(180, 205, 20, 30), rect(260, 280, 100, 110)];
const rightFragments = [rect(295, 320, 20, 30), rect(220, 240, 100, 110)];
const multipointFragments = [
  rect(160, 175, 20, 30),
  rect(210, 225, 20, 30),
  rect(180, 195, 60, 70),
];

const c03GoldenPlans = {
  cradle: () => planRoute(
    makeGoldenBlock({
      renderedLines: compactLines,
      wordRuns: cradleFragments,
      availableRightMargin: 20,
    }),
    makeGoldenAnn("golden-cradle", cradleFragments),
    commonOpts,
  ),
  local: () => planRoute(
    makeGoldenBlock({
      renderedLines: compactLines,
      wordRuns: localFragments,
      availableRightMargin: 20,
    }),
    makeGoldenAnn("golden-local", localFragments),
    commonOpts,
  ),
  middle: () => planRoute(
    makeGoldenBlock({
      renderedLines: [rect(80, 320, 20, 30), rect(190, 240, 50, 60)],
      wordRuns: middleFragments,
      availableRightMargin: 20,
    }),
    makeGoldenAnn("golden-middle", middleFragments),
    { ...commonOpts, disableCradle: true, disableLocal: true, allowMiddle: true },
  ),
  leftMargin: () => planRoute(
    makeGoldenBlock({
      bounds: rect(0, 500, 0, 150),
      renderedLines: symmetricLines,
      wordRuns: leftFragments,
    }),
    makeGoldenAnn("golden-left-margin", leftFragments),
    { ...marginOpts, sides: ["left"] },
  ),
  rightMargin: () => planRoute(
    makeGoldenBlock({
      bounds: rect(0, 500, 0, 150),
      renderedLines: symmetricLines,
      wordRuns: rightFragments,
    }),
    makeGoldenAnn("golden-right-margin", rightFragments),
    { ...marginOpts, sides: ["right"] },
  ),
  multipoint: () => planRoute(
    makeGoldenBlock({
      bounds: rect(0, 500, 0, 150),
      renderedLines: symmetricLines,
      wordRuns: multipointFragments,
    }),
    makeGoldenAnn("golden-multipoint", multipointFragments),
    { ...marginOpts, sides: ["left"] },
  ),
};

/* Rebaselined 2026-07-19 for the C0.5 bracket grammar: every contact comes
 * straight off its underline in ONE colinear level run (raw-ink guarded,
 * skirt passage enveloped) and meets the rail in ONE soft right-angle
 * corner — the route's bottommost group turns up, every other group turns
 * down. The cradle is the squared hammock (lead, corner, wall, corner, one
 * flat floor, mirrored). No shoulder, settle, swoop, dip, or under-run
 * exists outside the host-disabled middle shaft. Route CHOICE is unchanged
 * — every mode/side/strand below matches the pre-amendment table; only the
 * silhouettes moved. */
const c03GoldenExpected = {
  cradle: {
    mode: "same-line", side: "left", strand: null, samples: 60,
    sampleSha256: "795c7fcdd9136408fb24ccf6da81dcff35bfb94cb068ab871b454958e8d0993c",
    sha256: "ef3ff6dbc64d425b7b831dbe9ef855b85d5842d030ced116116bf7f61bfe4a50",
  },
  local: {
    mode: "local-tag", side: "left", strand: null, samples: 17,
    sampleSha256: "2610b23cee233b7b7351c8cc5a40c0555d89373acc311a7e6104274c5bd9a684",
    sha256: "688f048dc56ec903f88b7d1ba138e26d4067a95104842d26f58f4276d3dfb4da",
  },
  middle: {
    mode: "middle-shaft", side: "left", strand: null, samples: 111,
    sampleSha256: "372daf46dd5e0b96ada55b2432d222d1eb2f073758b31fc28ef6d2faf6ca47f7",
    sha256: "398b8e3ac8d1fbb3bca7ef6d982cf1c2ba4e29c164affe8e115b4f0d75794138",
  },
  leftMargin: {
    mode: "corridor", side: "left", strand: 0, samples: 345,
    sampleSha256: "ea6bf0f23afae9cf3091211ac2de0fce8aa4f882a6a6efe5c804a78926ea0cb8",
    sha256: "dcf7702bcecca67256eeb418372ee803687a8e4e65d0137b3d00a72fbe3da427",
  },
  rightMargin: {
    mode: "corridor", side: "right", strand: 0, samples: 345,
    sampleSha256: "148222cadebc8ab5211c176b5e50dccadaf424f7db3ba0d6949aace4c4352bdd",
    sha256: "87f0ed490fd04f8acc2acceb9a976e9f27d75ae4f174f3f664b6e82808006d45",
  },
  multipoint: {
    mode: "multipoint", side: "left", strand: 0, samples: 256,
    sampleSha256: "d4c497d16bc2aa0790e05a53a9d07f2bf3f07781c1edd3ceeffb8e582e5ca12f",
    sha256: "6ccf6e7db76614900c2878a46cc5a756cd879d622455d4ee13db8a6371e4857f",
  },
} as const;

test("section routing preserves canonical C0.3 geometry when section metadata is absent", () => {
  for (const name of Object.keys(c03GoldenPlans) as Array<keyof typeof c03GoldenPlans>) {
    const plan = c03GoldenPlans[name]();
    const expected = c03GoldenExpected[name];
    assert.equal(plan.valid, true, name);
    assert.equal(plan.mode, expected.mode, name);
    assert.equal(plan.side, expected.side, name);
    assert.equal(plan.strand ?? null, expected.strand, name);
    assert.equal(plan.sampledPoints.length, expected.samples, name);
    assert.equal(sha256Json(plan.sampledPoints), expected.sampleSha256, `${name} samples`);
    assert.equal(
      sha256Json(legacyGeometryProjection(plan)),
      expected.sha256,
      `${name} canonical geometry`,
    );
  }
});

type MarginSide = "left" | "right";
type SectionRect = Rect & {
  id: string;
  sectionId: string;
  documentOrder: number;
};
type SectionBounds = Rect & { id: string; documentOrder: number };
type SectionGap = Rect & {
  id: string;
  documentOrder: number;
  fromSectionId: string;
  toSectionId: string;
  hardClear: true;
};
type SectionFixture = {
  block: ReturnType<typeof makeSectionBlock>;
  ann: ReturnType<typeof makeSectionAnn>;
  opts: ReturnType<typeof makeSectionOpts>;
};

const SECTION_IDS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const SECTION_STEP = 160;
const SECTION_FIRST_LINE_TOP = 20;
const SECTION_LINE_STEP = 30;
const SECTION_LINE_COUNT = 4;
const SECTION_LINE_HEIGHT = 10;
const SECTION_GAP_INSET = 10;

function sectionIdAt(index: number): string {
  const id = SECTION_IDS[index];
  if (!id) throw new Error(`The test fixture supports at most ${SECTION_IDS.length} sections`);
  return id;
}

function makeSectionBlock(sectionCount: number) {
  const sections: SectionBounds[] = [];
  const renderedLines: SectionRect[] = [];
  const sectionGaps: SectionGap[] = [];
  let documentOrder = 0;

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
    const sectionId = sectionIdAt(sectionIndex);
    const base = sectionIndex * SECTION_STEP;
    const top = base + SECTION_FIRST_LINE_TOP;
    const bottom = top + (SECTION_LINE_COUNT - 1) * SECTION_LINE_STEP + SECTION_LINE_HEIGHT;
    sections.push({
      id: sectionId,
      documentOrder: sectionIndex,
      left: 100,
      right: 400,
      top,
      bottom,
    });
    for (let lineIndex = 0; lineIndex < SECTION_LINE_COUNT; lineIndex++) {
      const lineTop = top + lineIndex * SECTION_LINE_STEP;
      renderedLines.push({
        id: `line:${sectionId}:${lineIndex}`,
        sectionId,
        documentOrder: documentOrder++,
        left: 100,
        right: 400,
        top: lineTop,
        bottom: lineTop + SECTION_LINE_HEIGHT,
      });
    }
    if (sectionIndex > 0) {
      const previous = sections[sectionIndex - 1]!;
      sectionGaps.push({
        id: `${previous.id}-${sectionId}`,
        documentOrder: sectionIndex - 1,
        fromSectionId: previous.id,
        toSectionId: sectionId,
        hardClear: true,
        left: 0,
        right: 500,
        top: previous.bottom + SECTION_GAP_INSET,
        bottom: top - SECTION_GAP_INSET,
      });
    }
  }

  const height = Math.max(160, sectionCount * SECTION_STEP);
  return {
    bounds: rect(0, 500, 0, height),
    renderedLines,
    wordRuns: [] as Array<Rect & { sectionId: string }>,
    verseNumberRects: [] as Rect[],
    additionalObstacles: [] as Rect[],
    sections,
    sectionGaps,
    lineHeight: SECTION_LINE_STEP,
    preferredMargin: "left",
    availableLeftMargin: 100,
    availableRightMargin: 100,
  };
}

function makeSectionAnn(id: string, pattern: readonly MarginSide[], block: ReturnType<typeof makeSectionBlock>) {
  const anchors: Array<{
    id: string;
    sectionId: string;
    fragments: Array<Rect & { sectionId: string }>;
    documentOrder: number;
  }> = [];
  let documentOrder = 0;

  for (let sectionIndex = 0; sectionIndex < pattern.length; sectionIndex++) {
    const sectionId = sectionIdAt(sectionIndex);
    const side = pattern[sectionIndex]!;
    const lines = block.renderedLines.filter((line) => line.sectionId === sectionId);
    for (const line of lines) {
      const fragment = side === "left"
        ? { left: 110, right: 125, top: line.top, bottom: line.bottom, sectionId }
        : { left: 375, right: 390, top: line.top, bottom: line.bottom, sectionId };
      anchors.push({
        id: `${id}:${sectionId}:${documentOrder}`,
        sectionId,
        fragments: [fragment],
        documentOrder: documentOrder++,
      });
      block.wordRuns.push(fragment);
    }
  }

  return { id, kind: "contrast", focused: false, anchors };
}

function makeSectionOpts() {
  return {
    fontSize: 17,
    focused: false,
    disableCradle: true,
    disableLocal: true,
    allowMiddle: false,
    leftLoomX: 70,
    rightLoomX: 430,
    sides: ["left", "right"] as MarginSide[],
    sectionRouting: { enabled: true },
  };
}

function makeSectionFixture(
  pattern: readonly MarginSide[],
  id = `section-${pattern.join("-")}`,
): SectionFixture {
  const block = makeSectionBlock(pattern.length);
  const ann = makeSectionAnn(id, pattern, block);
  return { block, ann, opts: makeSectionOpts() };
}

function reflectX(x: number, axisX = 250): number {
  return 2 * axisX - x;
}

function reflectRect(input: Rect, axisX = 250): Rect {
  return {
    ...input,
    left: reflectX(input.right, axisX),
    right: reflectX(input.left, axisX),
  };
}

function mirroredSectionFixture(source: SectionFixture): SectionFixture {
  const block = structuredClone(source.block);
  block.bounds = reflectRect(block.bounds);
  block.renderedLines = block.renderedLines.map((line) => ({ ...line, ...reflectRect(line) }));
  block.wordRuns = block.wordRuns.map((word) => ({ ...word, ...reflectRect(word) }));
  block.verseNumberRects = block.verseNumberRects.map((obstacle) => reflectRect(obstacle));
  block.additionalObstacles = block.additionalObstacles.map((obstacle) => reflectRect(obstacle));
  block.sections = block.sections.map((section) => ({ ...section, ...reflectRect(section) }));
  block.sectionGaps = block.sectionGaps.map((gap) => ({ ...gap, ...reflectRect(gap) }));
  const ann = structuredClone(source.ann);
  ann.anchors = ann.anchors.map((anchor) => ({
    ...anchor,
    fragments: anchor.fragments.map((fragment) => ({ ...fragment, ...reflectRect(fragment) })),
  }));
  const opts = structuredClone(source.opts);
  opts.sides = [...opts.sides].reverse();
  return { block, ann, opts };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertValidPlan(plan: ReturnType<typeof planRoute>, label: string): void {
  assert.equal(plan.valid, true, `${label}: ${plan.reason ?? "unknown planning failure"}`);
  assert.ok(plan.centerline.length > 0, `${label}: no route geometry`);
  assert.ok(plan.sampledPoints.length > 0, `${label}: no sampled geometry`);
  assert.equal(plan.diagnostics.intersections, 0, `${label}: route crossed an obstacle`);
}

function assertStructuredSectionFallback(
  plan: ReturnType<typeof planRoute>,
  label: string,
): { move: string; why: string } {
  assertValidPlan(plan, label);
  assert.equal(plan.handoffs?.length ?? 0, 0, `${label}: malformed metadata created a handoff`);
  assert.notEqual(plan.side, null, `${label}: fallback lost the honest whole-route side`);
  const decline = plan.diagnostics.declined.find((entry: { move: string; why: string }) =>
    entry.move === "section-routing");
  assert.ok(decline, `${label}: missing structured section-routing decline`);
  assert.equal(typeof decline.why, "string", `${label}: decline code is not structured`);
  assert.ok(decline.why.length > 0, `${label}: decline code is empty`);
  return decline;
}

test("section routing is opt-in and malformed semantic metadata always declines to C0.3", () => {
  const optOut = makeSectionFixture(["left", "right"], "metadata-opt-out");
  delete (optOut.opts as Partial<typeof optOut.opts>).sectionRouting;
  const optOutPlan = planRoute(optOut.block, optOut.ann, optOut.opts);
  assertValidPlan(optOutPlan, "section opt-out");
  assert.equal(optOutPlan.handoffs?.length ?? 0, 0);
  assert.notEqual(optOutPlan.side, null);

  const cases: Array<{
    label: string;
    mutate: (fixture: SectionFixture) => void;
  }> = [
    {
      label: "missing sections",
      mutate: ({ block }) => { delete (block as Partial<typeof block>).sections; },
    },
    {
      label: "duplicate section id",
      mutate: ({ block }) => { block.sections[1]!.id = block.sections[0]!.id; },
    },
    {
      label: "duplicate section order",
      mutate: ({ block }) => {
        block.sections[1]!.documentOrder = block.sections[0]!.documentOrder;
      },
    },
    {
      label: "out-of-order sections",
      mutate: ({ block }) => { block.sections.reverse(); },
    },
    {
      label: "non-finite section bounds",
      mutate: ({ block }) => { block.sections[0]!.bottom = Number.NaN; },
    },
    {
      label: "missing rendered-line identity",
      mutate: ({ block }) => {
        delete (block.renderedLines[0] as Partial<SectionRect>).id;
      },
    },
    {
      label: "duplicate rendered-line identity",
      mutate: ({ block }) => { block.renderedLines[1]!.id = block.renderedLines[0]!.id; },
    },
    {
      label: "non-finite rendered-line bounds",
      mutate: ({ block }) => { block.renderedLines[0]!.right = Number.NaN; },
    },
    {
      label: "rendered-line document order contradicts geometry",
      mutate: ({ block }) => {
        const count = block.renderedLines.length;
        block.renderedLines.forEach((line) => { line.documentOrder = count - 1 - line.documentOrder; });
      },
    },
    {
      label: "rendered line names an undeclared section",
      mutate: ({ block }) => { block.renderedLines[0]!.sectionId = "UNDECLARED"; },
    },
    {
      label: "missing anchor section provenance",
      mutate: ({ ann }) => {
        delete (ann.anchors[0] as Partial<(typeof ann.anchors)[number]>).sectionId;
      },
    },
    {
      label: "anchor names an undeclared section",
      mutate: ({ ann }) => { ann.anchors[0]!.sectionId = "UNDECLARED"; },
    },
    {
      label: "anchor document order contradicts semantic order",
      mutate: ({ ann }) => {
        const count = ann.anchors.length;
        ann.anchors.forEach((anchor) => { anchor.documentOrder = count - 1 - anchor.documentOrder; });
      },
    },
    {
      label: "duplicate gap identity",
      mutate: ({ block }) => { block.sectionGaps.push({ ...block.sectionGaps[0]! }); },
    },
    {
      label: "gap names an undeclared section",
      mutate: ({ block }) => { block.sectionGaps[0]!.toSectionId = "UNDECLARED"; },
    },
    {
      label: "gap lacks measured hard-clear provenance",
      mutate: ({ block }) => {
        (block.sectionGaps[0] as { hardClear: boolean }).hardClear = false;
      },
    },
    {
      label: "non-finite gap bounds",
      mutate: ({ block }) => { block.sectionGaps[0]!.top = Number.POSITIVE_INFINITY; },
    },
  ];

  const declineCodes = new Set<string>();
  for (const fixtureCase of cases) {
    const fixture = makeSectionFixture(["left", "right"], `metadata-${fixtureCase.label}`);
    fixtureCase.mutate(fixture);
    const decline = assertStructuredSectionFallback(
      planRoute(fixture.block, fixture.ann, fixture.opts),
      fixtureCase.label,
    );
    declineCodes.add(decline.why);
  }
  assert.ok(
    declineCodes.size >= 5,
    `metadata failures collapsed into only ${declineCodes.size} undifferentiated decline codes`,
  );
});

test("malformed opt-in metadata remains visible when a cradle returns before margin planning", () => {
  const fixture = makeSectionFixture(["left", "right"], "early-cradle-decline");
  const line = fixture.block.renderedLines[0]!;
  const first = { left: 110, right: 125, top: line.top, bottom: line.bottom, sectionId: "A" };
  const second = { left: 170, right: 185, top: line.top, bottom: line.bottom, sectionId: "B" };
  fixture.ann.anchors = [
    { id: "early:A", sectionId: "A", fragments: [first], documentOrder: 0 },
    { id: "early:B", sectionId: "B", fragments: [second], documentOrder: 1 },
  ];
  fixture.block.wordRuns = [first, second];
  fixture.opts.disableCradle = false;
  fixture.opts.disableLocal = false;

  const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertStructuredSectionFallback(plan, "early cradle metadata decline");
  assert.equal(plan.mode, "same-line", "fixture did not exercise the early cradle return");
  assert.ok(plan.diagnostics.declined.some((entry: { move: string }) =>
    entry.move === "section-routing"),
  "early route return erased the structured section decline");
});

test("gap document order must agree with semantic adjacent-pair order", () => {
  const fixture = makeSectionFixture(["left", "right", "left"], "reversed-gap-order");
  const [aToB, bToC] = fixture.block.sectionGaps;
  fixture.block.sectionGaps = [
    { ...bToC!, documentOrder: 0 },
    { ...aToB!, documentOrder: 1 },
  ];
  const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
  const decline = assertStructuredSectionFallback(plan, "semantic gap order");
  assert.match(decline.why, /section-gap/,
    "semantic gap inversion did not produce a structured gap decline");
  assert.equal(plan.handoffs?.length ?? 0, 0,
    "out-of-order declared gaps created a section handoff");
});

test("section planning treats all measured inputs and prior claims as immutable values", () => {
  const fixture = makeSectionFixture(["left", "right", "left"], "immutable-inputs");
  const opts = {
    ...fixture.opts,
    corridorClaims: [{ corridor: 2, y: 150, xMin: 10, xMax: 30, pad: 0 }],
    strandClaims: [{ side: "right", strand: 2, top: 0, bottom: 20 }],
    spineClaims: [{ x: 10, top: 0, bottom: 20 }],
    handoffClaims: [{ gapId: "other", xMin: 10, xMax: 20, top: 10, bottom: 20, pad: 0 }],
    previousTopology: {
      sectionSides: [
        { sectionId: "A", side: "left" as const },
        { sectionId: "B", side: "right" as const },
        { sectionId: "C", side: "left" as const },
      ],
    },
  };
  const blockSnapshot = structuredClone(fixture.block);
  const annSnapshot = structuredClone(fixture.ann);
  const optsSnapshot = structuredClone(opts);

  deepFreeze(fixture.block);
  deepFreeze(fixture.ann);
  deepFreeze(opts);
  const plan = planRoute(fixture.block, fixture.ann, opts);

  assertValidPlan(plan, "deep-frozen section input");
  assert.deepEqual(fixture.block, blockSnapshot);
  assert.deepEqual(fixture.ann, annSnapshot);
  assert.deepEqual(opts, optsSnapshot);
});

type Point = { x: number; y: number };
type RouteSegment = {
  type: "L" | "C";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c1x?: number;
  c1y?: number;
  c2x?: number;
  c2y?: number;
  role?: string;
  runId?: string;
  spineId?: string;
  handoffId?: string;
  ownerId?: string;
};

function near(actual: number, expected: number, tolerance = 1e-8, label = "value"): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`,
  );
}

function sectionSidesOf(plan: ReturnType<typeof planRoute>): Array<{ sectionId: string; side: MarginSide }> {
  if (Array.isArray(plan.topologyMemory?.sectionSides)) return plan.topologyMemory.sectionSides;
  if (Array.isArray(plan.sectionSides)) return plan.sectionSides;
  if (Array.isArray(plan.topologySignature)) return plan.topologySignature;
  return (plan.sideRuns ?? []).flatMap((run: { sectionIds: string[]; side: MarginSide }) =>
    run.sectionIds.map((sectionId) => ({ sectionId, side: run.side })));
}

function handoffSegments(
  plan: ReturnType<typeof planRoute>,
  handoff: { id: string; segmentIndexes?: number[] },
): RouteSegment[] {
  if (Array.isArray(handoff.segmentIndexes)) {
    return handoff.segmentIndexes.map((index) => plan.centerline[index]).filter(Boolean);
  }
  const part = plan.routeParts?.find((candidate: {
    role?: string;
    ownerId?: string;
    handoffId?: string;
  }) => candidate.role === "handoff" &&
    (candidate.ownerId === handoff.id || candidate.handoffId === handoff.id));
  if (Array.isArray(part?.segments)) return part.segments;
  return (plan.centerline as RouteSegment[]).filter((segment) =>
    segment.role === "handoff" && segment.handoffId === handoff.id);
}

function pointsForSegments(segments: RouteSegment[]): Point[] {
  return segments.flatMap((segment, index) => {
    const points = _internals.segPoints(segment, 0.5) as Point[];
    return index ? points.slice(1) : points;
  });
}

function assertCanonicalSectionPlan(
  plan: ReturnType<typeof planRoute>,
  expectedSides: readonly MarginSide[],
  expectedRunSections: readonly (readonly string[])[],
  label: string,
): void {
  assertValidPlan(plan, label);
  assert.equal(plan.topology, "sectioned", `${label}: missing canonical topology discriminant`);
  assert.deepEqual(
    sectionSidesOf(plan).map(({ side }) => side),
    expectedSides,
    `${label}: semantic side assignment`,
  );
  assert.equal(plan.sideRuns.length, expectedRunSections.length, `${label}: side-run count`);
  assert.equal(plan.spines.length, expectedRunSections.length, `${label}: spine count`);
  assert.equal(plan.handoffs.length, expectedRunSections.length - 1, `${label}: handoff count`);
  assert.deepEqual(
    plan.sideRuns.map((run: { sectionIds: string[] }) => run.sectionIds),
    expectedRunSections,
    `${label}: maximal run coalescing`,
  );

  const runIds = new Set<string>();
  const spineIds = new Set<string>();
  for (const [index, run] of plan.sideRuns.entries()) {
    assert.equal(typeof run.id, "string", `${label}: run ${index} lacks a stable id`);
    assert.ok(run.id.length > 0, `${label}: run ${index} id is empty`);
    assert.equal(runIds.has(run.id), false, `${label}: duplicate run id ${run.id}`);
    runIds.add(run.id);
    assert.ok(run.side === "left" || run.side === "right", `${label}: invalid run side`);
    assert.ok(Number.isInteger(run.strand) && run.strand >= 0 && run.strand <= 2,
      `${label}: invalid run strand`);
    assert.ok(Number.isFinite(run.railX), `${label}: non-finite run rail`);
    assert.ok(Number.isFinite(run.top) && Number.isFinite(run.bottom) && run.top <= run.bottom,
      `${label}: non-finite run extent`);
    if (index) assert.notEqual(run.side, plan.sideRuns[index - 1].side,
      `${label}: adjacent same-side runs were not coalesced`);

    const spine = plan.spines.find((candidate: { id: string; ownerRunId?: string }) =>
      candidate.id === run.spineId || candidate.ownerRunId === run.id);
    assert.ok(spine, `${label}: run ${run.id} has no owned spine`);
    assert.equal(spineIds.has(spine.id), false, `${label}: duplicate spine id ${spine.id}`);
    spineIds.add(spine.id);
    assert.equal(spine.kind, "margin", `${label}: non-margin spine in a side run`);
    assert.equal(spine.side, run.side, `${label}: spine side disagrees with run`);
    assert.equal(spine.strand, run.strand, `${label}: spine strand disagrees with run`);
    near(spine.x, run.railX, 1e-9, `${label}: spine/run X`);
    assert.ok(Number.isFinite(spine.top) && Number.isFinite(spine.bottom) && spine.top <= spine.bottom,
      `${label}: invalid spine extent`);
  }

  for (const handoff of plan.handoffs) {
    assert.ok(handoff.id && handoff.gapId, `${label}: handoff lacks stable ownership ids`);
    assert.ok(runIds.has(handoff.fromRunId) && runIds.has(handoff.toRunId),
      `${label}: handoff names an unknown run`);
    assert.ok(spineIds.has(handoff.fromSpineId) && spineIds.has(handoff.toSpineId),
      `${label}: handoff names an unknown spine`);
    const segments = handoffSegments(plan, handoff);
    /* C0.5 visual amendment: "S" names the topology, not a glyph. The
     * crossing is two compact rounded edge turns around one near-flat run
     * (plus optional straight rail continuations), never one page-wide
     * diagonal cubic. */
    assert.ok(segments.length >= 2 && segments.length <= 5,
      `${label}: handoff must be edge turns around a near-flat crossing`);
    assert.equal(segments.filter((segment) => segment.type === "C").length, 2,
      `${label}: handoff must turn exactly twice`);
    assert.ok(segments.every((segment) => segment.role === "handoff" &&
      segment.handoffId === handoff.id), `${label}: handoff segment ownership is ambiguous`);
  }

  assert.equal(plan.anchorRuns.length, plan.contacts.length, `${label}: anchor ownership is incomplete`);
  assert.ok(plan.anchorRuns.every((owner: {
    anchorId: string;
    sectionId: string;
    runId: string;
    side: MarginSide;
    strand: number;
  }) => owner.anchorId && owner.sectionId && runIds.has(owner.runId) &&
    (owner.side === "left" || owner.side === "right") && Number.isInteger(owner.strand)),
  `${label}: invalid anchor-to-run ownership`);
  const contactsById = new Map(plan.contacts.map((contact: { id?: string }) => [contact.id, contact]));
  assert.ok(plan.contacts.every((contact: {
    id?: string;
    anchorId?: string;
    sectionId?: string;
    runId?: string;
    spineId?: string;
  }) => contact.id && contact.anchorId && contact.sectionId &&
    runIds.has(String(contact.runId)) && spineIds.has(String(contact.spineId))),
  `${label}: terminal contacts require direct anchor/run/spine ownership`);
  assert.ok(plan.anchorRuns.every((owner: { contactId?: string; anchorId: string }) => {
    const contact = contactsById.get(owner.contactId);
    return contact && (contact as { anchorId?: string }).anchorId === owner.anchorId;
  }), `${label}: anchor-to-contact mapping is not exact`);
  assert.ok(plan.centerline.every((segment: RouteSegment) => segment.role &&
    (segment.runId || segment.spineId || segment.handoffId || segment.ownerId)),
  `${label}: centerline contains an unowned segment`);
  assert.ok(Array.isArray(plan.routeParts) && plan.routeParts.length > 0,
    `${label}: missing canonical route parts`);
  assert.ok(plan.topologySignature &&
    (typeof plan.topologySignature === "string" || Array.isArray(plan.topologySignature)),
  `${label}: missing topology signature`);
  assert.ok(plan.topologyMemory && Array.isArray(plan.topologyMemory.sectionSides),
    `${label}: missing semantic topology memory`);
  assert.ok(plan.diagnostics.sectionRouting, `${label}: missing section-routing diagnostics`);
  assert.ok(plan.diagnostics.dp, `${label}: missing bounded-work diagnostics`);
  near(plan.score, plan.diagnostics.dp.winningBucket / 10, 1e-12,
    `${label}: displayed score did not use the complete raw-score bucket`);
  assert.equal(plan.markerRangesByRun.length, plan.sideRuns.length,
    `${label}: plural marker extents do not match plural runs`);

  assert.equal(plan.spineClaimsOut.length, plan.sideRuns.length,
    `${label}: one spine claim is required per run`);
  assert.equal(plan.strandClaimsOut.length, plan.sideRuns.length,
    `${label}: one strand claim is required per run`);
  assert.equal(plan.handoffClaimsOut.length, plan.handoffs.length,
    `${label}: one handoff claim is required per transition`);
  assert.equal(plan.corridorClaimsOut.length, plan.claimsOut.length,
    `${label}: canonical corridor claims diverge from painted route occupancy`);
  assert.ok(plan.corridorClaimsOut.every((claim: {
    id?: string;
    ownerRunId?: string;
    sectionId?: string;
  }) => claim.id && claim.sectionId && runIds.has(String(claim.ownerRunId))),
  `${label}: corridor claims lack stable run ownership`);
  for (const run of plan.sideRuns) {
    const owned = plan.corridorClaimsOut.filter((claim: { ownerRunId?: string }) =>
      claim.ownerRunId === run.id);
    assert.deepEqual(run.corridorClaimIds, owned.map((claim: { id: string }) => claim.id),
      `${label}: run ${run.id} does not enumerate its corridor claims`);
    assert.ok(run.spineClaimId && run.strandClaimId,
      `${label}: run ${run.id} lacks explicit plural claim ownership`);
  }
  if (plan.sideRuns.length > 1) {
    for (const alias of [
      "side", "strand", "marginRailX", "spine", "spineClaimOut", "strandClaimOut",
    ] as const) {
      assert.equal(Object.hasOwn(plan, alias), true,
        `${label}: mixed topology omitted canonical null alias ${alias}`);
      assert.equal(plan[alias], null, `${label}: mixed topology fabricated singular ${alias}`);
    }
    assert.equal(plan.diagnostics.side, "mixed", `${label}: mixed diagnostics fabricated a side`);
    assert.equal(plan.diagnostics.laneIndex, null, `${label}: mixed diagnostics fabricated a strand`);
  } else {
    assert.equal(plan.diagnostics.side, plan.sideRuns[0].side,
      `${label}: one-run diagnostics lost its honest side`);
    assert.equal(plan.diagnostics.laneIndex, plan.sideRuns[0].strand,
      `${label}: one-run diagnostics lost its honest strand`);
  }
}

function assertHandoffGeometry(
  plan: ReturnType<typeof planRoute>,
  block: ReturnType<typeof makeSectionBlock>,
  label: string,
): void {
  const expand = Math.max(2.5, 17 * 0.12) + 5 / 2;
  const obstacles = [
    ...block.wordRuns,
    ...block.verseNumberRects,
    ...block.additionalObstacles,
  ].map((obstacle) => _internals.expandRect(obstacle, expand));

  for (const handoff of plan.handoffs) {
    const gap = block.sectionGaps.find((candidate) => candidate.id === handoff.gapId);
    assert.ok(gap, `${label}: undeclared handoff gap ${handoff.gapId}`);
    const fromSpine = plan.spines.find((spine: { id: string }) => spine.id === handoff.fromSpineId);
    const toSpine = plan.spines.find((spine: { id: string }) => spine.id === handoff.toSpineId);
    assert.ok(fromSpine && toSpine, `${label}: missing handoff spines`);
    const segments = handoffSegments(plan, handoff);
    const first = segments[0]!;
    const last = segments.at(-1)!;
    near(first.x1, fromSpine.x, 1e-8, `${label}: crossing starts on source spine`);
    near(last.x2, toSpine.x, 1e-8, `${label}: crossing ends on target spine`);
    /* C0.5: the crossing leaves and arrives vertically (continuing each
     * rail), turns exactly twice with the shared compact corner token, and
     * carries one genuinely horizontal run between the turns whenever the
     * rails are farther apart than the two corners. */
    if (first.type === "C") near(first.c1x!, first.x1, 1e-8, `${label}: source tangent is vertical`);
    else near(first.x2, first.x1, 1e-8, `${label}: source continuation is vertical`);
    if (last.type === "C") near(last.c2x!, last.x2, 1e-8, `${label}: target tangent is vertical`);
    else near(last.x2, last.x1, 1e-8, `${label}: target continuation is vertical`);
    const corners = segments.filter((segment) => segment.type === "C");
    assert.equal(corners.length, 2, `${label}: crossing must turn exactly twice`);
    for (const corner of corners) {
      assert.ok(Math.abs(corner.y2 - corner.y1) <= 6 + 1e-6 &&
        Math.abs(corner.x2 - corner.x1) <= 6 + 1e-6,
      `${label}: edge turn exceeds the shared corner token`);
    }
    for (const straight of segments.filter((segment) => segment.type === "L")) {
      assert.ok(Math.abs(straight.x2 - straight.x1) < 1e-8 ||
        Math.abs(straight.y2 - straight.y1) < 1e-8,
      `${label}: every straight in a crossing must be axis-aligned`);
    }
    const flats = segments.filter((segment) => segment.type === "L" &&
      Math.abs(segment.y2 - segment.y1) < 1e-8);
    const span = Math.abs(toSpine.x - fromSpine.x);
    if (span > 12) {
      assert.equal(flats.length, 1, `${label}: crossing lacks its near-flat run`);
      assert.ok(Math.abs(flats[0]!.x2 - flats[0]!.x1) >= span - 12.002,
        `${label}: the flat run must genuinely cross between the rails`);
    }
    assert.ok(first.y1 < last.y2, `${label}: handoff does not descend in document order`);

    const points = pointsForSegments(segments);
    assert.ok(points.every((point, index) => index === 0 || point.y >= points[index - 1]!.y - 1e-8),
      `${label}: handoff reverses vertically`);
    const direction = toSpine.x > fromSpine.x ? 1 : -1;
    assert.ok(points.every((point, index) => index === 0 ||
      direction * point.x >= direction * points[index - 1]!.x - 1e-8),
    `${label}: handoff doubles back horizontally`);
    assert.ok(points.every((point) =>
      point.x >= gap.left - 1e-8 && point.x <= gap.right + 1e-8 &&
      point.y >= gap.top - 1e-8 && point.y <= gap.bottom + 1e-8),
    `${label}: handoff escaped its measured gap`);
    assert.ok(points.every((point) => obstacles.every((obstacle) =>
      !(point.x > obstacle.left && point.x < obstacle.right &&
        point.y > obstacle.top && point.y < obstacle.bottom))),
    `${label}: handoff crossed expanded ink`);

    const claim = plan.handoffClaimsOut.find((candidate: { ownerHandoffId?: string }) =>
      candidate.ownerHandoffId === handoff.id);
    assert.ok(claim, `${label}: handoff lacks an owned claim`);
    assert.ok(handoff.claimOut, `${label}: handoff does not carry its owned claim`);
    assert.equal(handoff.claimOut.ownerHandoffId, handoff.id,
      `${label}: handoff claim ownership is ambiguous`);
    assert.deepEqual(handoff.claimOut, claim,
      `${label}: canonical handoff claim disagrees with the plural claim output`);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    assert.ok(claim.xMin <= minX + 1e-8 && claim.xMax >= maxX - 1e-8,
      `${label}: handoff claim misses its X extent`);
    assert.ok(claim.top <= minY + 1e-8 && claim.bottom >= maxY - 1e-8,
      `${label}: handoff claim misses its Y extent`);
    assert.equal(claim.gapId, handoff.gapId,
      `${label}: handoff claim names the wrong measured gap`);
  }
}

test("legal left-right and right-left section topologies are exact mirrored crossings", () => {
  const leftRightFixture = makeSectionFixture(["left", "right"], "mirror-sections");
  const rightLeftFixture = mirroredSectionFixture(leftRightFixture);
  const leftRight = planRoute(leftRightFixture.block, leftRightFixture.ann, leftRightFixture.opts);
  const rightLeft = planRoute(rightLeftFixture.block, rightLeftFixture.ann, rightLeftFixture.opts);

  assertCanonicalSectionPlan(leftRight, ["left", "right"], [["A"], ["B"]], "left-right S");
  assertCanonicalSectionPlan(rightLeft, ["right", "left"], [["A"], ["B"]], "right-left S");
  assertHandoffGeometry(leftRight, leftRightFixture.block, "left-right S");
  assertHandoffGeometry(rightLeft, rightLeftFixture.block, "right-left S");
  near(rightLeft.rawLength, leftRight.rawLength, 1e-8, "mirrored unrounded ink length");

  assert.equal(rightLeft.centerline.length, leftRight.centerline.length);
  for (const [index, left] of (leftRight.centerline as RouteSegment[]).entries()) {
    const right = rightLeft.centerline[index] as RouteSegment;
    assert.equal(right.type, left.type, `segment ${index} grammar`);
    near(right.x1, reflectX(left.x1), 1e-8, `segment ${index} x1`);
    near(right.x2, reflectX(left.x2), 1e-8, `segment ${index} x2`);
    near(right.y1, left.y1, 1e-8, `segment ${index} y1`);
    near(right.y2, left.y2, 1e-8, `segment ${index} y2`);
    if (left.type === "C") {
      near(right.c1x!, reflectX(left.c1x!), 1e-8, `segment ${index} c1x`);
      near(right.c2x!, reflectX(left.c2x!), 1e-8, `segment ${index} c2x`);
      near(right.c1y!, left.c1y!, 1e-8, `segment ${index} c1y`);
      near(right.c2y!, left.c2y!, 1e-8, `segment ${index} c2y`);
    }
  }

  assert.equal(rightLeft.spines.length, leftRight.spines.length);
  leftRight.spines.forEach((left: { x: number; top: number; bottom: number }, index: number) => {
    const right = rightLeft.spines[index];
    near(right.x, reflectX(left.x), 1e-8, `spine ${index} X`);
    near(right.top, left.top, 1e-8, `spine ${index} top`);
    near(right.bottom, left.bottom, 1e-8, `spine ${index} bottom`);
  });
  assert.equal(rightLeft.claimsOut.length, leftRight.claimsOut.length);
  leftRight.claimsOut.forEach((left: {
    xMin: number;
    xMax: number;
    y: number;
    top?: number;
    bottom?: number;
  }, index: number) => {
    const right = rightLeft.claimsOut[index];
    near(right.xMin, reflectX(left.xMax), 1e-8, `claim ${index} xMin`);
    near(right.xMax, reflectX(left.xMin), 1e-8, `claim ${index} xMax`);
    near(right.y, left.y, 1e-8, `claim ${index} y`);
    if (left.top != null) near(right.top, left.top, 1e-8, `claim ${index} top`);
    if (left.bottom != null) near(right.bottom, left.bottom, 1e-8, `claim ${index} bottom`);
  });
});

test("semantic-side cost uses each declared section center instead of the passage center", () => {
  const fixture = makeSectionFixture(["left", "right"], "asymmetric-section-centers");
  for (const section of fixture.block.sections) {
    if (section.id === "A") { section.left = 0; section.right = 300; }
    else { section.left = 200; section.right = 500; }
  }
  for (const line of fixture.block.renderedLines) {
    if (line.sectionId === "A") { line.left = 0; line.right = 300; }
    else { line.left = 200; line.right = 500; }
  }

  const left = planRoute(fixture.block, fixture.ann, { ...fixture.opts, sides: ["left"] });
  const right = planRoute(fixture.block, fixture.ann, { ...fixture.opts, sides: ["right"] });
  assertCanonicalSectionPlan(left, ["left", "left"], [["A", "B"]], "asymmetric forced left");
  assertCanonicalSectionPlan(right, ["right", "right"], [["A", "B"]], "asymmetric forced right");
  const expectedLocalPenalty = 32.5 * 0.035;
  near(left.scoreRaw - left.rawLength, expectedLocalPenalty, 0.002,
    "left score used a passage-wide semantic center");
  near(right.scoreRaw - right.rawLength, expectedLocalPenalty, 0.002,
    "right score used a passage-wide semantic center");
});

test("complete tenth-pixel ties use bounded backpointers and requested-side order", () => {
  const fixture = makeSectionFixture(["left", "left", "left", "left"], "prefix-tie");
  for (const anchor of fixture.ann.anchors) {
    for (const fragment of anchor.fragments) {
      fragment.left = 242.5;
      fragment.right = 257.5;
    }
  }
  const leftFirst = planRoute(fixture.block, fixture.ann, fixture.opts);
  const rightFirst = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    sides: ["right", "left"],
  });
  assertCanonicalSectionPlan(leftFirst, ["left", "left", "left", "left"], [["A", "B", "C", "D"]], "left-first tie");
  assertCanonicalSectionPlan(rightFirst, ["right", "right", "right", "right"], [["A", "B", "C", "D"]], "right-first tie");
  near(leftFirst.rawLength, rightFirst.rawLength, 1e-8, "mirrored tie ink");
  assert.equal(leftFirst.diagnostics.dp.scoreDefinition, "complete-tenth-raw-v5");
  assert.equal(leftFirst.diagnostics.dp.scoreAccumulator, "number-forward-document-order");
  assert.equal(leftFirst.diagnostics.dp.scoreQuantization, "complete-total-only");
  assert.equal(leftFirst.diagnostics.dp.predecessorStorage, "handoff-count-backpointer");
  assert.equal(leftFirst.diagnostics.dp.tieScope, "all-complete-topologies");
  assert.ok(leftFirst.diagnostics.dp.maxFrontierSize <= 6,
    "DP retained complete prefixes instead of six bounded state backpointers");
});

test("bounded backpointer DP retains the exhaustive minimum raw prefix per end state", () => {
  const sides = ["left", "right"] as const;
  const states = Array.from({ length: 4 }, (_, sectionOrder) =>
    sides.flatMap((side, sideRank) => Array.from({ length: 3 }, (_, strand) => ({
      sectionOrder,
      side,
      sideRank,
      strand,
      baseCost: 10 + sectionOrder * 0.0137 + sideRank * 0.0071 + strand * 0.0033,
    }))));
  const edge = (previous: (typeof states)[number][number], state: (typeof states)[number][number]) => {
    if (previous.side === state.side && previous.strand !== state.strand) return null;
    const handoff = previous.side !== state.side;
    return {
      transition: { kind: handoff ? "handoff" : "continue" },
      cost: (handoff ? 7.0000007 : 1.0000003) + Math.abs(previous.strand - state.strand) * 0.0029,
    };
  };
  const diagnostics: Record<string, number> = {};
  const solved = _internals.solveSectionStateDP(states, edge, diagnostics);
  assert.ok(solved, "synthetic bounded DP returned no topology");

  let prefixes = states[0].map((state) => ({
    state,
    scoreRaw: state.baseCost,
    handoffCount: 0,
  }));
  for (let sectionIndex = 1; sectionIndex < states.length; sectionIndex++) {
    const next: typeof prefixes = [];
    for (const prefix of prefixes) for (const state of states[sectionIndex]) {
      const candidateEdge = edge(prefix.state, state);
      if (!candidateEdge) continue;
      const incrementRaw = state.baseCost + candidateEdge.cost;
      const scoreRaw = prefix.scoreRaw + incrementRaw;
      next.push({
        state,
        scoreRaw,
        handoffCount: prefix.handoffCount + (candidateEdge.transition.kind === "handoff" ? 1 : 0),
      });
    }
    prefixes = next;
  }
  const exhaustive = new Map<string, { scoreRaw: number }>();
  for (const prefix of prefixes) {
    const key = `${prefix.state.side}:${prefix.state.strand}:${prefix.handoffCount}`;
    const existing = exhaustive.get(key);
    if (!existing || prefix.scoreRaw < existing.scoreRaw) exhaustive.set(key, {
      scoreRaw: prefix.scoreRaw,
    });
  }
  assert.ok(solved.terminalEntries.length <= 6 * states.length);
  for (const terminal of solved.terminalEntries) {
    const expected = exhaustive.get(`${terminal.side}:${terminal.strand}:${terminal.handoffCount}`);
    assert.ok(expected, "solver retained an impossible handoff-count label");
    near(terminal.scoreRaw, expected.scoreRaw, 1e-12,
      `retained ${terminal.side}/${terminal.strand}/${terminal.handoffCount} label was not its exhaustive minimum`);
  }
  assert.ok(diagnostics.maxFrontierSize <= 6);
  assert.ok(diagnostics.maxLabelsPerState <= states.length);
  assert.ok(diagnostics.maxFrontierLabels <= 6 * states.length);
});

test("complete comparator keeps converged ties and raw tenth boundaries exact", () => {
  const state = (side: MarginSide, sideRank: number, baseCost: number) =>
    ({ side, sideRank, strand: 0, baseCost });
  const edge = (previous: { side: MarginSide }, current: { side: MarginSide }) => ({
    transition: { kind: previous.side === current.side ? "continue" : "handoff" },
    cost: 0,
  });

  const fewerHandoffs = _internals.solveSectionStateDP([
    [state("left", 0, 0.04), state("right", 1, 0)],
    [state("left", 0, 0)],
  ], edge, {});
  assert.deepEqual(fewerHandoffs.path.map((item: { side: MarginSide }) => item.side), ["left", "left"]);
  assert.equal(fewerHandoffs.chosen.handoffCount, 0,
    "a lower raw prefix defeated fewer handoffs inside the same complete tenth");
  assert.equal(fewerHandoffs.chosen.score, 0);

  const tenthBoundary = _internals.solveSectionStateDP([
    [state("left", 0, 0.0506), state("right", 1, 0.0494)],
    [state("left", 0, 0)],
  ], edge, {});
  assert.deepEqual(tenthBoundary.path.map((item: { side: MarginSide }) => item.side), ["right", "left"]);
  assert.equal(tenthBoundary.chosen.handoffCount, 1,
    "the topology below the tenth boundary lost to the topology above it");
  assert.equal(tenthBoundary.chosen.score, 0);

  const atomicRoundingInversion = _internals.solveSectionStateDP([[
    state("left", 0, 0.04951),
    state("right", 1, 0.04949),
  ]], edge, {});
  assert.deepEqual(atomicRoundingInversion.path.map((item: { side: MarginSide }) => item.side), ["left"],
    "rounding atomic costs before the complete comparator inverted requested-side order");
  assert.equal(atomicRoundingInversion.chosen.scoreRaw, 0.04951);
  assert.equal(atomicRoundingInversion.chosen.score, 0,
    "a raw score below 0.05 was double-rounded into the next tenth");

  const regroupingCosts = [0.968, 0.43, 0.611, 0.816, 0.954, 1.871];
  const regroupBoundary = _internals.solveSectionStateDP(
    regroupingCosts.map((baseCost) => [state("left", 0, baseCost)]), edge, {});
  assert.ok(regroupBoundary, "suffix regrouping lost the only legal topology at a tenth boundary");
  assert.equal(regroupBoundary.path.length, regroupingCosts.length);
  const canonicalRaw = regroupingCosts.reduce((sum, cost) => sum + cost, 0);
  assert.equal(canonicalRaw, 5.65);
  assert.equal(regroupBoundary.chosen.scoreRaw, canonicalRaw);
  assert.equal(regroupBoundary.chosen.score, 5.7,
    "suffix feasibility regrouped the canonical complete raw total");
});

test("raw score accumulation buckets only complete totals and declines unsafe ranges", () => {
  assert.equal(_internals.scoreBucketFromRaw(0.04951), 0,
    "a complete score below 0.05 was double-rounded");
  assert.equal(_internals.scoreBucketFromRaw(0.05), 1);
  assert.equal(_internals.scoreBucketFromRaw(5.65), 57);
  assert.equal(_internals.addScoreRaw(0.968, 0.43, 0.611, 0.816, 0.954, 1.871), 5.65);
  assert.equal(_internals.scoreBucketFromRaw(Number.MAX_VALUE), null);
  assert.equal(_internals.addScoreRaw(Number.MAX_VALUE, Number.MAX_VALUE), null);

  const diagnostics: Record<string, unknown> = {};
  const unsafe = _internals.solveSectionStateDP([
    [{ side: "left", sideRank: 0, strand: 0, baseCost: Number.MAX_VALUE }],
  ], () => null, diagnostics);
  assert.equal(unsafe, null);
  assert.equal(diagnostics.scoreDeclineReason, "unsafe-score-range");

  const stateDiagnostics: Record<string, unknown> = {}, edgeDiagnostics: Record<string, unknown> = {};
  assert.equal(_internals.solveSectionStateDP(
    [[{ side: "left", sideRank: 0, strand: 0, baseCost: -0.0004 }]], () => null, stateDiagnostics), null);
  assert.equal(_internals.solveSectionStateDP(Array.from({ length: 2 }, () =>
    [{ side: "left", sideRank: 0, strand: 0, baseCost: 0 }]),
  () => ({ transition: { kind: "continue" }, cost: -0.0004 }), edgeDiagnostics), null);
  assert.deepEqual([stateDiagnostics.scoreDeclineReason, edgeDiagnostics.scoreDeclineReason],
    ["unsafe-score-range", "unsafe-score-range"]);
});

test("generated topology identifiers encode delimiter-bearing semantic ids", () => {
  const fixture = makeSectionFixture(["left", "right"], "annotation:|>+/%");
  const renamed = new Map([["A", "A:|>+"], ["B", "B/%:two"]]);
  for (const section of fixture.block.sections) section.id = renamed.get(section.id)!;
  for (const line of fixture.block.renderedLines) line.sectionId = renamed.get(line.sectionId)!;
  for (const word of fixture.block.wordRuns) word.sectionId = renamed.get(word.sectionId)!;
  for (const anchor of fixture.ann.anchors) {
    anchor.sectionId = renamed.get(anchor.sectionId)!;
    for (const fragment of anchor.fragments) fragment.sectionId = anchor.sectionId;
  }
  for (const gap of fixture.block.sectionGaps) {
    gap.fromSectionId = renamed.get(gap.fromSectionId)!;
    gap.toSectionId = renamed.get(gap.toSectionId)!;
    gap.id = "gap:|>+/%";
  }
  const sectionIds = [renamed.get("A")!, renamed.get("B")!];
  const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(plan, ["left", "right"], [[sectionIds[0]], [sectionIds[1]]], "encoded ids");
  for (const sectionId of sectionIds) {
    assert.ok(plan.topologySignature.includes(encodeURIComponent(sectionId)),
      `signature did not encode ${sectionId}`);
  }
  assert.ok(plan.sideRuns.every((run: { id: string }) =>
    !run.id.includes("A:|>+") && !run.id.includes("B/%:two")),
  "generated run ids embedded raw structural delimiters");
  assert.equal(planRoute(fixture.block, fixture.ann, fixture.opts).topologySignature,
    plan.topologySignature, "encoded signature is not deterministic");
});

test("generated topology identifiers preserve isolated UTF-16 surrogates safely", () => {
  const high = "\ud800";
  const low = "\udfff";
  assert.equal(_internals.stableIdPart(high), "%uD800");
  assert.equal(_internals.stableIdPart(low), "%uDFFF");
  assert.equal(_internals.stableIdPart("literal%uD800"), "literal%25uD800",
    "malformed-code-unit escape collided with a literal id");
  assert.equal(_internals.stableIdPart("A😀/%"), encodeURIComponent("A😀/%"),
    "well-formed id encoding changed");

  const fixture = makeSectionFixture(["left", "right"], `annotation${high}`);
  const renamed = new Map([["A", `A${high}`], ["B", `B${low}`]]);
  for (const section of fixture.block.sections) section.id = renamed.get(section.id)!;
  for (const line of fixture.block.renderedLines) line.sectionId = renamed.get(line.sectionId)!;
  for (const word of fixture.block.wordRuns) word.sectionId = renamed.get(word.sectionId)!;
  fixture.ann.anchors.forEach((anchor, index) => {
    anchor.id = `anchor-${index}${index ? low : high}`;
    anchor.sectionId = renamed.get(anchor.sectionId)!;
    for (const fragment of anchor.fragments) fragment.sectionId = anchor.sectionId;
  });
  for (const gap of fixture.block.sectionGaps) {
    gap.fromSectionId = renamed.get(gap.fromSectionId)!;
    gap.toSectionId = renamed.get(gap.toSectionId)!;
    gap.id = `gap${high}`;
  }

  const sectionIds = [renamed.get("A")!, renamed.get("B")!];
  const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(plan, ["left", "right"], [[sectionIds[0]], [sectionIds[1]]],
    "isolated-surrogate ids");
  const generatedIds = [
    ...plan.sideRuns, ...plan.spines, ...plan.handoffs, ...plan.routeParts,
    ...plan.contacts, ...plan.ports, ...plan.claimsOut,
  ].map((item: { id: string }) => item.id);
  assert.ok(generatedIds.some((id: string) => id.includes("%uD800")),
    "high surrogate was not stably encoded");
  assert.ok(generatedIds.some((id: string) => id.includes("%uDFFF")),
    "low surrogate was not stably encoded");
  assert.equal(plan.handoffs[0].gapId, `gap${high}`,
    "gap identity changed while hardening generated ids");
});

test("undeclared, narrow, misnamed, or obstructed gaps never become scored crossings", () => {
  const cases: Array<{
    label: string;
    mutate: (fixture: SectionFixture) => Rect | null;
  }> = [
    {
      label: "undeclared gap",
      mutate: ({ block }) => { block.sectionGaps = []; return null; },
    },
    {
      label: "narrow gap",
      mutate: ({ block }) => {
        block.sectionGaps[0]!.top = 147;
        block.sectionGaps[0]!.bottom = 153;
        return null;
      },
    },
    {
      label: "misnamed gap",
      mutate: ({ block }) => { block.sectionGaps[0]!.toSectionId = "UNDECLARED"; return null; },
    },
    {
      label: "word obstruction",
      mutate: ({ block }) => {
        const obstacle = rect(245, 255, 130, 170);
        block.wordRuns.push({ ...obstacle, sectionId: "A" });
        return obstacle;
      },
    },
    {
      label: "verse-number obstruction",
      mutate: ({ block }) => {
        const obstacle = rect(245, 255, 130, 170);
        block.verseNumberRects.push(obstacle);
        return obstacle;
      },
    },
    {
      label: "heading obstruction",
      mutate: ({ block }) => {
        const obstacle = rect(245, 255, 130, 170);
        block.additionalObstacles.push(obstacle);
        return obstacle;
      },
    },
    {
      label: "gap does not contain both spines",
      mutate: ({ block }) => { block.sectionGaps[0]!.right = 400; return null; },
    },
  ];

  for (const fixtureCase of cases) {
    const fixture = makeSectionFixture(["left", "right"], `blocked-${fixtureCase.label}`);
    const obstacle = fixtureCase.mutate(fixture);
    const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
    assertValidPlan(plan, fixtureCase.label);
    assert.equal(plan.handoffs?.length ?? 0, 0, `${fixtureCase.label}: illegal S was emitted`);
    assert.ok((plan.sideRuns?.length ?? 1) <= 1,
      `${fixtureCase.label}: illegal side transition survived without a handoff`);
    assert.notEqual(plan.side, null, `${fixtureCase.label}: fallback lost its whole-route side`);
    if (obstacle) {
      const expanded = _internals.expandRect(obstacle, 5);
      assert.ok(plan.sampledPoints.every((point: Point) =>
        !(point.x > expanded.left && point.x < expanded.right &&
          point.y > expanded.top && point.y < expanded.bottom)),
      `${fixtureCase.label}: fallback crossed the blocking ink`);
    }
  }
});

test("three sections support L-R-L handoffs and maximal same-side run coalescing", () => {
  const alternatingFixture = makeSectionFixture(["left", "right", "left"], "three-run-lrl");
  const alternating = planRoute(
    alternatingFixture.block,
    alternatingFixture.ann,
    alternatingFixture.opts,
  );
  assertCanonicalSectionPlan(
    alternating,
    ["left", "right", "left"],
    [["A"], ["B"], ["C"]],
    "L-R-L",
  );
  assertHandoffGeometry(alternating, alternatingFixture.block, "L-R-L");
  assert.equal(alternating.sideRuns[0].strand, alternating.sideRuns[2].strand,
    "disjoint left runs should reuse their local strand");
  for (const spine of alternating.spines) {
    const spineSegments = alternating.centerline.filter((segment: RouteSegment) =>
      segment.role === "spine" && segment.spineId === spine.id);
    assert.equal(spineSegments.length, 1, `spine ${spine.id} was emitted more than once`);
    const ownedPorts = alternating.ports.filter((port: { spineId?: string }) =>
      port.spineId === spine.id);
    assert.ok(ownedPorts.length > 0, `spine ${spine.id} has no owned ports`);
    near(Math.min(...ownedPorts.map((port: Point) => port.y)), spine.top, 1e-8,
      `spine ${spine.id} top does not equal its first port`);
    near(Math.max(...ownedPorts.map((port: Point) => port.y)), spine.bottom, 1e-8,
      `spine ${spine.id} bottom does not equal its last port`);
  }

  const coalescedFixture = makeSectionFixture(["left", "left", "right"], "coalesced-llr");
  const coalesced = planRoute(coalescedFixture.block, coalescedFixture.ann, coalescedFixture.opts);
  assertCanonicalSectionPlan(
    coalesced,
    ["left", "left", "right"],
    [["A", "B"], ["C"]],
    "coalesced L-L-R",
  );
  assertHandoffGeometry(coalesced, coalescedFixture.block, "coalesced L-L-R");
  assert.equal(coalesced.handoffs[0].gapId, "B-C",
    "coalescing must not fabricate a dead A-B plateau");
});

test("plural spine, strand, corridor, and handoff claims remain locally owned", () => {
  const fixture = makeSectionFixture(["left", "right"], "plural-claims");
  const baseline = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(baseline, ["left", "right"], [["A"], ["B"]], "claim baseline");

  const leftRun = baseline.sideRuns.find((run: { side: MarginSide }) => run.side === "left");
  const rightRun = baseline.sideRuns.find((run: { side: MarginSide }) => run.side === "right");
  assert.ok(leftRun && rightRun);
  const outward = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    strandClaims: [{
      side: "left",
      strand: 0,
      top: leftRun.top,
      bottom: leftRun.bottom,
    }],
  });
  assertCanonicalSectionPlan(outward, ["left", "right"], [["A"], ["B"]], "local strand claim");
  assert.equal(outward.sideRuns[0].strand, 1, "overlapping left run did not step outward");
  assert.equal(outward.sideRuns[1].strand, 0, "left claim incorrectly consumed a right strand");

  const claim = baseline.handoffClaimsOut[0];
  assert.ok(claim, "baseline handoff did not emit a committed claim");
  const blockedByHandoff = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    handoffClaims: [{
      gapId: claim.gapId,
      xMin: claim.xMin,
      xMax: claim.xMax,
      top: claim.top,
      bottom: claim.bottom,
      pad: claim.pad,
    }],
  });
  assertValidPlan(blockedByHandoff, "overlapping committed handoff claim");
  assert.equal(blockedByHandoff.handoffs?.length ?? 0, 0,
    "an overlapping committed handoff claim was treated as a soft cost");

  const blockedByReversedHandoff = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    handoffClaims: [{
      gapId: claim.gapId,
      xMin: claim.xMax,
      xMax: claim.xMin,
      top: claim.bottom,
      bottom: claim.top,
      pad: claim.pad,
    }],
  });
  assertValidPlan(blockedByReversedHandoff, "reversed committed handoff claim");
  assert.equal(blockedByReversedHandoff.handoffs?.length ?? 0, 0,
    "reversed handoff bounds escaped conservative normalization");

  const disjointHandoff = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    handoffClaims: [{
      gapId: claim.gapId,
      xMin: 0,
      xMax: 20,
      top: claim.top,
      bottom: claim.bottom,
      pad: 0,
    }],
  });
  assertCanonicalSectionPlan(
    disjointHandoff,
    ["left", "right"],
    [["A"], ["B"]],
    "disjoint handoff claim",
  );
});

test("spine claims eliminate DP states before selection so the same side can step outward", () => {
  const fixture = makeSectionFixture(["left", "right"], "spine-claim-dp");
  const baseline = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(baseline, ["left", "right"], [["A"], ["B"]], "spine DP baseline");
  const leftSpine = baseline.spines.find((spine: { side: MarginSide }) => spine.side === "left");
  assert.ok(leftSpine, "baseline lacks its left spine");

  const outward = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    spineClaims: [{
      x: leftSpine.x,
      top: leftSpine.top,
      bottom: leftSpine.bottom,
    }],
  });
  assertCanonicalSectionPlan(outward, ["left", "right"], [["A"], ["B"]], "spine DP outward");
  assert.equal(outward.sideRuns[0].strand, 1,
    "occupied left strand zero aborted section selection instead of trying strand one");
  assert.equal(outward.sideRuns[1].strand, 0,
    "a local left spine claim incorrectly moved the right run");
});

test("strand claims reserve the eventual maximal run span through section whitespace", () => {
  const fixture = makeSectionFixture(["left", "left"], "gap-strand-claim");
  const baseline = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(baseline, ["left", "left"], [["A", "B"]], "gap claim baseline");
  assert.equal(baseline.sideRuns[0].strand, 0);

  const gap = fixture.block.sectionGaps[0]!;
  const outward = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    strandClaims: [{
      side: "left",
      strand: 0,
      top: gap.top + 3,
      bottom: gap.bottom - 3,
    }],
  });
  assertCanonicalSectionPlan(outward, ["left", "left"], [["A", "B"]], "gap claim outward");
  assert.equal(outward.sideRuns[0].strand, 1,
    "a claim living only between section fragments did not reserve the connecting spine");
});

test("handoffs attach at exact plural spine extrema without dangling tails", () => {
  const fixture = makeSectionFixture(["left", "right"], "exact-handoff-attachments");
  fixture.block.sectionGaps[0]!.top = 120;
  fixture.block.sectionGaps[0]!.bottom = 180;
  const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(plan, ["left", "right"], [["A"], ["B"]], "exact attachments");
  assert.equal(plan.handoffs.length, 1);

  const handoff = plan.handoffs[0]!;
  const segments = handoffSegments(plan, handoff);
  const fromSpine = plan.spines.find((spine: { id: string }) => spine.id === handoff.fromSpineId);
  const toSpine = plan.spines.find((spine: { id: string }) => spine.id === handoff.toSpineId);
  assert.ok(fromSpine && toSpine);
  near(segments[0]!.y1, fromSpine.bottom, 1e-9,
    "source spine extends below its handoff attachment");
  near(segments.at(-1)!.y2, toSpine.top, 1e-9,
    "destination spine extends above its handoff attachment");

  for (const spine of plan.spines) {
    const ownedPorts = plan.ports.filter((port: { spineId?: string }) => port.spineId === spine.id);
    assert.ok(ownedPorts.length > 0, `spine ${spine.id} has no owned attachment ports`);
    near(Math.min(...ownedPorts.map((port: Point) => port.y)), spine.top, 1e-9,
      `spine ${spine.id} overshoots above its first port`);
    near(Math.max(...ownedPorts.map((port: Point) => port.y)), spine.bottom, 1e-9,
      `spine ${spine.id} overshoots below its last port`);
  }
});

test("semantic topology hysteresis is exactly 12 units per changed section", () => {
  assert.equal(_internals.SECTION_HYSTERESIS, 12);
  const fixture = makeSectionFixture(["left", "right"], "section-hysteresis");
  const matchingSides = [
    { sectionId: "A", side: "left" as const },
    { sectionId: "B", side: "right" as const },
  ];
  const matching = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    previousTopology: { sectionSides: matchingSides },
  });
  const nestedMatching = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    sectionRouting: { enabled: true, previousSides: matchingSides },
  });
  const oneChanged = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    previousTopology: {
      sectionSides: [
        { sectionId: "A", side: "right" as const },
        { sectionId: "B", side: "right" as const },
      ],
    },
  });
  const twoChanged = planRoute(fixture.block, fixture.ann, {
    ...fixture.opts,
    previousTopology: {
      sectionSides: [
        { sectionId: "A", side: "right" as const },
        { sectionId: "B", side: "left" as const },
      ],
    },
  });
  for (const [label, plan] of [["matching", matching], ["nested matching", nestedMatching], ["one changed", oneChanged], ["two changed", twoChanged]] as const) {
    assertCanonicalSectionPlan(plan, ["left", "right"], [["A"], ["B"]], label);
  }
  near(nestedMatching.scoreRaw, matching.scoreRaw, 1e-8, "nested previous-side memory");
  near(oneChanged.scoreRaw - matching.scoreRaw, 12, 1e-8, "one changed section penalty");
  near(twoChanged.scoreRaw - matching.scoreRaw, 24, 1e-8, "two changed section penalty");
});

test("stable IDs and document order make section planning invariant to input shuffles", () => {
  const fixture = makeSectionFixture(["left", "right", "left"], "deterministic-shuffle");
  const baseline = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertCanonicalSectionPlan(
    baseline,
    ["left", "right", "left"],
    [["A"], ["B"], ["C"]],
    "shuffle baseline",
  );

  const shuffled = structuredClone(fixture);
  shuffled.block.renderedLines.reverse();
  shuffled.block.wordRuns = [
    ...shuffled.block.wordRuns.filter((_, index) => index % 2 === 0).reverse(),
    ...shuffled.block.wordRuns.filter((_, index) => index % 2 === 1).reverse(),
  ];
  shuffled.ann.anchors = [
    ...shuffled.ann.anchors.slice(4, 8),
    ...shuffled.ann.anchors.slice(8),
    ...shuffled.ann.anchors.slice(0, 4),
  ];
  const shuffledPlan = planRoute(shuffled.block, shuffled.ann, shuffled.opts);
  assert.deepEqual(stable(shuffledPlan), stable(baseline));
  assert.equal(shuffledPlan.topologySignature, baseline.topologySignature);
});

test("section DP exposes six geometric states and polynomial handoff-count labels", () => {
  const sectionCount = 20;
  const pattern = Array.from({ length: sectionCount }, (_, index): MarginSide =>
    index % 2 ? "right" : "left");
  const fixture = makeSectionFixture(pattern, "bounded-dp");
  const plan = planRoute(fixture.block, fixture.ann, fixture.opts);
  assertValidPlan(plan, "bounded section DP");
  assert.equal(plan.topology, "sectioned");
  const dp = plan.diagnostics.dp;
  assert.ok(dp, "bounded section DP diagnostics are absent");
  assert.equal(dp.sectionCount, sectionCount);
  assert.equal(dp.maxStatesPerSection, 6);
  assert.ok(Number.isInteger(dp.statesEvaluated) && dp.statesEvaluated <= 6 * sectionCount,
    `${dp.statesEvaluated} states exceeded ${6 * sectionCount}`);
  assert.ok(Number.isInteger(dp.transitionsEvaluated) &&
    dp.transitionsEvaluated <= 36 * (sectionCount - 1),
  `${dp.transitionsEvaluated} transitions exceeded ${36 * (sectionCount - 1)}`);
  assert.ok(Number.isInteger(dp.handoffsEvaluated) &&
    dp.handoffsEvaluated <= 36 * (sectionCount - 1),
  `${dp.handoffsEvaluated} handoff checks exceeded ${36 * (sectionCount - 1)}`);
  assert.ok(Number.isInteger(dp.maxLabelsPerState) && dp.maxLabelsPerState <= sectionCount,
    `${dp.maxLabelsPerState} labels per state exceeded the handoff-count bound ${sectionCount}`);
  assert.ok(Number.isInteger(dp.maxFrontierLabels) && dp.maxFrontierLabels <= 6 * sectionCount,
    `${dp.maxFrontierLabels} retained labels exceeded ${6 * sectionCount}`);
  assert.ok(Number.isInteger(dp.labelsEvaluated) && dp.labelsEvaluated <= 36 * sectionCount * sectionCount,
    `${dp.labelsEvaluated} label relaxations exceeded the polynomial work cage`);
  assert.ok(plan.handoffs.length <= sectionCount - 1,
    "selected topology contains more than one handoff per semantic boundary");
});
