import assert from "node:assert/strict";
import test from "node:test";

import { _internals, planRoute } from "../lab/route-engine.js";

type Rect = { left: number; right: number; top: number; bottom: number };
type CorridorClaim = {
  corridor: number;
  y: number;
  xMin?: number;
  xMax?: number;
  pad?: number;
};

const rect = (left: number, right: number, top: number, bottom: number): Rect =>
  ({ left, right, top, bottom });

function makeBlock(renderedLines: Rect[], wordRuns: Rect[], verseNumberRects: Rect[] = []) {
  return {
    bounds: rect(0, 400, 0, 120),
    renderedLines,
    wordRuns,
    verseNumberRects,
    additionalObstacles: [],
    lineHeight: 30,
    preferredMargin: "left",
    availableLeftMargin: 100,
    availableRightMargin: 20,
  };
}

function makeAnn(id: string, fragments: Rect[]) {
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

const common = { fontSize: 17, focused: true, loomX: 65 };

function assertFiniteClaims(plan: ReturnType<typeof planRoute>, expectedCount?: number): void {
  assert.equal(plan.valid, true, `expected a valid plan, received ${plan.reason ?? "unknown failure"}`);
  assert.ok(plan.claimsOut.length > 0, "valid route did not reserve a corridor span");
  if (expectedCount != null) assert.equal(plan.claimsOut.length, expectedCount);
  for (const claim of plan.claimsOut) {
    assert.ok(Number.isFinite(claim.corridor), "claim corridor must be finite");
    assert.ok(Number.isFinite(claim.y), "claim Y must be finite");
    assert.ok(Number.isFinite(claim.xMin), "claim xMin must be finite");
    assert.ok(Number.isFinite(claim.xMax), "claim xMax must be finite");
    assert.ok(Number.isFinite(claim.pad), "claim pad must be finite");
    assert.ok(claim.xMin <= claim.xMax, "claim X bounds must be normalized");
  }
}

test("normalizes finite claim bounds and treats legacy or malformed bounds conservatively", () => {
  assert.deepEqual(
    _internals.makeCorridorClaim(2, 10, 180, 140, -3),
    { corridor: 2, y: 10, xMin: 140, xMax: 180, pad: 0 },
  );

  const candidate = { corridor: 2, y: 10, xMin: 140, xMax: 180, pad: 0 };
  assert.equal(
    _internals.corridorClaimsConflict(
      { corridor: 2, y: 10, xMin: 220, xMax: 260, pad: 0 },
      candidate,
    ),
    false,
    "disjoint horizontal spans should share a corridor rung",
  );
  assert.equal(
    _internals.corridorClaimsConflict(
      { corridor: 2, y: 10, xMin: 170, xMax: 220, pad: 0 },
      candidate,
    ),
    true,
    "overlapping horizontal spans must conflict",
  );
  assert.equal(
    _internals.corridorClaimsConflict({ corridor: 2, y: 10, pad: 0 }, candidate),
    true,
    "legacy claims without X bounds must remain corridor-wide",
  );
  assert.equal(
    _internals.corridorClaimsConflict(
      { corridor: 2, y: 10, xMin: Number.NaN, xMax: 170, pad: 0 },
      candidate,
    ),
    true,
    "malformed bounds must never legalize an overlap",
  );
  assert.equal(
    _internals.corridorClaimsConflict(
      { corridor: 2, y: 10, xMin: 220, xMax: 260, pad: Number.NaN },
      candidate,
    ),
    true,
    "malformed padding must remain conservative",
  );
  assert.equal(
    _internals.corridorClaimsConflict(
      { corridor: 2, y: 10, xMin: 181, xMax: 220, pad: 1 },
      candidate,
    ),
    true,
    "claim padding applies to horizontal overlap",
  );
});

test("reuses the exact rung for disjoint spans and walks the deterministic ladder for overlap", () => {
  const fragments = [rect(120, 145, 20, 30), rect(180, 205, 20, 30)];
  const block = makeBlock(
    [rect(80, 320, 20, 30), rect(80, 180, 50, 60)],
    fragments,
  );
  const ann = makeAnn("cradle", fragments);
  const baseline = planRoute(block, ann, common);
  assertFiniteClaims(baseline, 1);
  assert.equal(baseline.mode, "same-line");
  const y = baseline.claimsOut[0].y;

  const disjoint = planRoute(block, ann, {
    ...common,
    corridorClaims: [{ corridor: 1, y, xMin: 240, xMax: 280, pad: 0 }],
  });
  assertFiniteClaims(disjoint, 1);
  assert.equal(disjoint.claimsOut[0].y, y);

  const overlappingClaim = { corridor: 1, y, xMin: 150, xMax: 170, pad: 0 };
  const overlap = planRoute(block, ann, { ...common, corridorClaims: [overlappingClaim] });
  assertFiniteClaims(overlap, 1);
  assert.ok(Math.abs(overlap.claimsOut[0].y - (y - 2.4)) < 1e-9);

  const reversed = planRoute(block, ann, {
    ...common,
    corridorClaims: [{ ...overlappingClaim, xMin: 170, xMax: 150 }],
  });
  assertFiniteClaims(reversed, 1);
  assert.equal(reversed.claimsOut[0].y, overlap.claimsOut[0].y);

  const conservativeClaims: CorridorClaim[] = [
    { corridor: 1, y, pad: 0 },
    { corridor: 1, y, xMin: Number.NaN, xMax: 170, pad: 0 },
    { corridor: 1, y, xMin: 150, xMax: Number.POSITIVE_INFINITY, pad: 0 },
  ];
  for (const claim of conservativeClaims) {
    const result = planRoute(block, ann, { ...common, corridorClaims: [claim] });
    assertFiniteClaims(result, 1);
    assert.equal(result.claimsOut[0].y, overlap.claimsOut[0].y);
  }
});

test("disjoint claim reuse never weakens verse-number obstacle clearance", () => {
  const fragments = [rect(120, 145, 20, 30), rect(180, 205, 20, 30)];
  const lines = [rect(80, 320, 20, 30), rect(80, 180, 50, 60)];
  const clearBlock = makeBlock(lines, fragments);
  const ann = makeAnn("obstacle-cradle", fragments);
  const baseline = planRoute(clearBlock, ann, common);
  assert.equal(baseline.mode, "same-line");

  const blockedBlock = makeBlock(lines, fragments, [rect(150, 170, 35, 40)]);
  const blocked = planRoute(blockedBlock, ann, {
    ...common,
    disableLocal: true,
    corridorClaims: [{
      corridor: baseline.claimsOut[0].corridor,
      y: baseline.claimsOut[0].y,
      xMin: 240,
      xMax: 280,
      pad: 0,
    }],
  });
  /* C0.5c: the cradle still declines, and the bracket margin route carries
   * the pair at underline level instead — but the obstacle's RAW ink stays
   * untouchable regardless of any claim pressure. */
  assert.ok(blocked.diagnostics.declined.some((entry: { move: string; why: string }) =>
    entry.move === "cradle:facing" && entry.why === "no-corridor-slot"));
  assert.equal(blocked.valid, true);
  assert.equal(blocked.mode, "corridor");
  const raw = rect(150, 170, 35, 40);
  assert.ok(blocked.sampledPoints.every((point: { x: number; y: number }) =>
    !(point.x > raw.left && point.x < raw.right && point.y > raw.top && point.y < raw.bottom)),
  "no sampled point may enter the obstacle's raw ink");
});

test("every route family emits finite normalized horizontal extents", () => {
  const cradleFragments = [rect(120, 145, 20, 30), rect(180, 205, 20, 30)];
  const cradle = planRoute(
    makeBlock([rect(80, 320, 20, 30), rect(80, 180, 50, 60)], cradleFragments),
    makeAnn("cradle", cradleFragments),
    common,
  );
  assert.equal(cradle.mode, "same-line");
  assertFiniteClaims(cradle, 1);

  const localLevelFragment = rect(160, 190, 20, 30);
  const localLevel = planRoute(
    makeBlock(
      [rect(80, 320, 20, 30), rect(80, 180, 50, 60)],
      [localLevelFragment],
    ),
    makeAnn("local-level", [localLevelFragment]),
    common,
  );
  assert.equal(localLevel.mode, "local-tag");
  assert.deepEqual(localLevel.diagnostics.exits, ["level"]);
  /* C0.5c: the local tag is one straight run and one claim — no drip */
  assertFiniteClaims(localLevel, 1);

  const localDropFragment = rect(160, 190, 20, 30);
  /* C0.5c: only RAW ink vetoes underline-level travel, and there is no
   * offset shoulder to dodge into — a raw box sitting on the underline band
   * holds the route honestly instead of drawing a parallel line below. */
  const localBlocked = planRoute(
    makeBlock(
      [rect(80, 320, 20, 30), rect(80, 180, 50, 60)],
      [rect(150, 155, 20, 33), localDropFragment],
    ),
    makeAnn("local-blocked", [localDropFragment]),
    common,
  );
  assert.equal(localBlocked.valid, false);
  assert.equal(localBlocked.reason, "needs-space");

  const localCombFragments = [
    rect(160, 175, 20, 30),
    rect(195, 210, 20, 30),
    rect(230, 245, 20, 30),
  ];
  const localComb = planRoute(
    makeBlock(
      [rect(80, 320, 20, 30), rect(80, 180, 50, 60)],
      localCombFragments,
    ),
    makeAnn("local-comb", localCombFragments),
    common,
  );
  assert.equal(localComb.mode, "local-comb");
  assertFiniteClaims(localComb, 1);

  const middleFragments = [rect(120, 150, 20, 30), rect(190, 220, 50, 60)];
  const middle = planRoute(
    makeBlock(
      [rect(80, 320, 20, 30), rect(190, 240, 50, 60)],
      middleFragments,
    ),
    makeAnn("middle", middleFragments),
    { ...common, disableCradle: true, disableLocal: true, allowMiddle: true },
  );
  assert.equal(middle.mode, "middle-shaft");
  assertFiniteClaims(middle, 2);

  const marginFragments = [
    rect(160, 175, 20, 30),
    rect(210, 225, 20, 30),
    rect(180, 195, 50, 60),
  ];
  const margin = planRoute(
    makeBlock(
      [rect(80, 320, 20, 30), rect(80, 280, 50, 60)],
      marginFragments,
    ),
    makeAnn("margin", marginFragments),
    { ...common, disableCradle: true, disableLocal: true, allowMiddle: false },
  );
  assert.equal(margin.mode, "multipoint");
  /* C0.5c: every group is one colinear run and one soft corner — the
   * bottom group's corner turns up, but both are "level" exits */
  assert.deepEqual(margin.diagnostics.exits, ["level", "level"]);
  assertFiniteClaims(margin, 2);
});

test("a claimed underline rung holds honestly instead of dodging below", () => {
  const fragment = rect(160, 190, 20, 30);
  const block = makeBlock(
    [rect(80, 320, 20, 30), rect(80, 180, 50, 60)],
    [fragment],
  );
  const baseline = planRoute(block, makeAnn("level-baseline", [fragment]), common);
  assert.deepEqual(baseline.diagnostics.exits, ["level"]);

  /* C0.5c: the underline rung is the only legal horizontal for this contact.
   * When another thread owns it, the honest answer is a held tick — never a
   * parallel line drawn offset below the underline. */
  const blocked = planRoute(block, makeAnn("level-blocked", [fragment]), {
    ...common,
    corridorClaims: [baseline.claimsOut[0]],
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.reason, "needs-space");
});
