import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Point = { x: number; y: number };
type Fragment = { x: number; right: number; top: number; bottom: number; width: number; height: number };
type Member = {
  fragments: Array<Fragment & { underlineY: number; startContact: Point; endContact: Point }>;
  primaryFragment: Fragment & { underlineY: number; startContact: Point; endContact: Point };
  contact: Point;
  continuationContacts: Point[];
};
type ArcPlan = {
  mode: "same-line" | "adjacent" | "far";
  route?: "corridor";
  start: Point;
  end: Point;
  laneX?: number;
  corridorTop?: number;
  corridorBottom?: number;
  corridorY?: number;
  cornerRadius?: number;
  marginStartFraction?: number;
  marginEndFraction?: number;
  marginFraction?: number;
  points: Point[];
  d: string;
};
type ThreadPlan = {
  mode: string;
  spine: { start: Point; end: Point };
  parallelSpine?: { start: Point; end: Point };
  rails: number[];
  contacts: Point[];
  branches: Array<{
    contact: Point;
    port: Point;
    corridorY: number;
    lead?: Point;
    points: Point[];
    portGroup?: number;
    isPortLeader?: boolean;
    parallel: [Point[], Point[]];
  }>;
};
type TraceGeometry = {
  constants: { TOUCH_RADIUS: number; TOUCH_OVERLAP: number; UNDERLINE_CENTER_OFFSET: number };
  relativeClientRects(base: { left: number; top: number }, rects: Array<{ left: number; right: number; top: number; bottom: number }>): Fragment[];
  planMember(fragments: Fragment[]): Member;
  planArc(a: Member, b: Member, options: { gutterX: number; laneOffset?: number; lineHeight: number }): ArcPlan;
  planThread(members: Member[], options: { laneX: number; lineHeight?: number }): ThreadPlan;
  parallelRails(points: Point[]): [Point[], Point[]];
  contrastHalves(points: Point[], gap?: number, shear?: number, centerFraction?: number): [Point[], Point[]];
  resolveSegmentHue(segmentGids: string[], activeGids: string[], focusGid: string | null, hues: Record<string, string>): string;
  orderSegmentGids(segmentGids: string[], activeGids: string[], focusGid: string | null): string[];
};

const helperSource = readFileSync(new URL("../lab/trace-geometry.js", import.meta.url), "utf8");
const context: { TraceGeometry?: TraceGeometry } = {};
vm.runInNewContext(helperSource, context);
const geometry = context.TraceGeometry;
assert.ok(geometry, "trace geometry helper did not install");

function fragment(x: number, right: number, bottom: number, top = bottom - 22): Fragment {
  return { x, right, top, bottom, width: right - x, height: bottom - top };
}

function near(actual: number, expected: number, tolerance = 0.01): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function pointNear(actual: Point, expected: Point, tolerance = 0.01): void {
  near(actual.x, expected.x, tolerance);
  near(actual.y, expected.y, tolerance);
}

function assertCorridor(plan: ArcPlan, top: Member, bottom: Member): void {
  assert.equal(plan.route, "corridor");
  assert.ok(plan.laneX != null && plan.corridorTop != null && plan.corridorBottom != null && plan.cornerRadius != null);
  assert.ok(plan.marginStartFraction != null && plan.marginEndFraction != null && plan.marginFraction != null);
  assert.ok(plan.marginStartFraction < plan.marginFraction && plan.marginFraction < plan.marginEndFraction,
    "kind-specific breaks and markers need a real span on the margin");
  assert.ok(plan.corridorTop > top.primaryFragment.bottom, "top shoulder did not leave into the interline corridor");
  assert.ok(plan.corridorBottom > bottom.primaryFragment.bottom, "bottom shoulder did not leave into the interline corridor");
  const marginSpan = plan.points.filter((point) =>
    point.y > plan.corridorTop! + plan.cornerRadius! + 0.01 &&
    point.y < plan.corridorBottom! - plan.cornerRadius! - 0.01,
  );
  assert.ok(marginSpan.length > 0, "route has no margin span");
  assert.ok(marginSpan.every((point) => Math.abs(point.x - plan.laneX!) < 0.02), "route crossed prose between rendered lines");
  const firstStep = { x: plan.points[1].x - plan.points[0].x, y: plan.points[1].y - plan.points[0].y };
  const last = plan.points.length - 1;
  const lastStep = { x: plan.points[last].x - plan.points[last - 1].x, y: plan.points[last].y - plan.points[last - 1].y };
  assert.ok(Math.abs(firstStep.x) < Math.abs(firstStep.y), "top terminal must leave vertically into whitespace");
  assert.ok(Math.abs(lastStep.x) < Math.abs(lastStep.y), "bottom terminal must return vertically from whitespace");
}

test("keeps every wrapped client rect and chooses the nearest-margin fragment", () => {
  const rects = geometry.relativeClientRects(
    { left: 20, top: 30 },
    [
      { left: 240, right: 420, top: 80, bottom: 102 },
      { left: 140, right: 390, top: 106, bottom: 128 },
      { left: 140, right: 260, top: 132, bottom: 154 },
    ],
  );
  assert.equal(rects.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(rects.map(({ x, right, top, bottom }) => ({ x, right, top, bottom })))), [
    { x: 220, right: 400, top: 50, bottom: 72 },
    { x: 120, right: 370, top: 76, bottom: 98 },
    { x: 120, right: 240, top: 102, bottom: 124 },
  ]);
  const member = geometry.planMember(rects);
  assert.equal(member.fragments.length, 3);
  assert.equal(member.contact.x, 120 - geometry.constants.TOUCH_RADIUS + geometry.constants.TOUCH_OVERLAP);
  assert.equal(member.contact.y, 98 - geometry.constants.UNDERLINE_CENTER_OFFSET);
});

test("touch dots overlap the underline and same-line cradles have no air gap", () => {
  const left = geometry.planMember([fragment(100, 160, 50)]);
  const right = geometry.planMember([fragment(200, 270, 50)]);
  const plan = geometry.planArc(left, right, { gutterX: 70, lineHeight: 26 });
  assert.equal(plan.mode, "same-line");
  pointNear(plan.start, left.fragments[0].endContact);
  pointNear(plan.end, right.fragments[0].startContact);
  near(plan.start.x - geometry.constants.TOUCH_RADIUS, 160 - geometry.constants.TOUCH_OVERLAP);
  near(plan.end.x + geometry.constants.TOUCH_RADIUS, 200 + geometry.constants.TOUCH_OVERLAP);
  assert.ok(plan.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(Math.max(...plan.points.map((point) => point.y)) > plan.start.y, "cradle must dip below the underline");
  assert.ok(plan.corridorY != null);
  assert.ok(Math.max(...plan.points.map((point) => point.y)) < plan.corridorY,
    "same-line cradle must reserve the lower half of the leading for the next line");
});

test("focused overlap owns the wash and the underline nearest the dot", () => {
  const hues = { held: "gold", focus: "green" };
  assert.equal(geometry.resolveSegmentHue(["held", "focus"], ["held", "focus"], "focus", hues), "green");
  assert.equal(geometry.resolveSegmentHue(["focus", "held"], ["held", "focus"], "focus", hues), "green");
  assert.deepEqual(Array.from(geometry.orderSegmentGids(["focus", "held"], ["held", "focus"], "focus")), ["held", "focus"]);
  assert.equal(geometry.resolveSegmentHue(["held", "focus"], ["held"], null, hues), "gold");
});

test("adjacent-line routes use interline corridors and turn only at the margin", () => {
  const top = geometry.planMember([fragment(120, 220, 50)]);
  const bottom = geometry.planMember([fragment(180, 300, 76)]);
  const plan = geometry.planArc(top, bottom, { gutterX: 82, lineHeight: 26 });
  assert.equal(plan.mode, "adjacent");
  pointNear(plan.start, top.contact);
  pointNear(plan.end, bottom.contact);
  assert.ok((plan.laneX ?? Infinity) < Math.min(plan.start.x, plan.end.x));
  assertCorridor(plan, top, bottom);
});

test("many-line corridor routes stay finite while retaining their kind envelopes", () => {
  const top = geometry.planMember([fragment(130, 240, 50)]);
  const bottom = geometry.planMember([fragment(360, 500, 550)]);
  const plan = geometry.planArc(top, bottom, { gutterX: 78, laneOffset: 20, lineHeight: 26 });
  assert.equal(plan.mode, "far");
  assert.ok(plan.points.length <= 100, `unexpected long-span sample count ${plan.points.length}`);
  assertCorridor(plan, top, bottom);

  const [railA, railB] = geometry.parallelRails(plan.points);
  pointNear(railA[0], plan.start);
  pointNear(railB[0], plan.start);
  pointNear(railA.at(-1)!, plan.end);
  pointNear(railB.at(-1)!, plan.end);

  const [contrastA, contrastB] = geometry.contrastHalves(plan.points, 8, 1.2, plan.marginFraction);
  pointNear(contrastA[0], plan.start);
  pointNear(contrastB.at(-1)!, plan.end);
  assert.ok(Math.abs(contrastA.at(-1)!.x - plan.laneX!) <= 2,
    "the first contrast half must break at the margin, not under prose");
  assert.ok(Math.abs(contrastB[0].x - plan.laneX!) <= 2,
    "the second contrast half must resume at the margin, not under prose");

  const asymmetric = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 950, y: 50 }];
  const [asymmetricA, asymmetricB] = geometry.contrastHalves(asymmetric, 8, 0, 0.025);
  near(asymmetricA.at(-1)!.x, 0);
  near(asymmetricB[0].x, 0);
});

test("thread spines stop at rounded ports and parallel shoulders join both rails", () => {
  const members = [
    geometry.planMember([fragment(180, 260, 100)]),
    geometry.planMember([fragment(260, 360, 210)]),
    geometry.planMember([fragment(150, 220, 320)]),
  ];
  const plan = geometry.planThread(members, { laneX: 40 });
  assert.equal(plan.mode, "thread");
  assert.deepEqual(Array.from(plan.rails), [38.3, 41.7]);
  assert.ok(plan.spine.start.y > members[0].contact.y, "spine overshot the top shoulder");
  assert.ok(plan.spine.end.y < members[2].contact.y, "spine overshot the bottom shoulder");
  for (const branch of plan.branches) {
    const starts = branch.parallel.map((points) => points[0].x).sort((a, b) => a - b);
    near(starts[0], 38.3, 0.02);
    near(starts[1], 41.7, 0.02);
    assert.ok(branch.corridorY > branch.contact.y, "thread shoulder did not use the interline corridor");
    branch.parallel.forEach((points) => pointNear(points.at(-1)!, branch.contact));
  }

  const inline = geometry.planThread([
    geometry.planMember([fragment(120, 160, 80)]),
    geometry.planMember([fragment(220, 270, 80)]),
    geometry.planMember([fragment(330, 390, 80)]),
  ], { laneX: 40 });
  assert.equal(inline.mode, "inline-thread");
  assert.ok(inline.parallelSpine);
  near(inline.parallelSpine.start.x, inline.branches[0].port.x);
  near(inline.parallelSpine.end.x, inline.branches.at(-1)!.port.x);
  for (const branch of inline.branches) {
    assert.notEqual(branch.parallel[0][0].x, branch.contact.x, "upper shoulder must originate on its rail, not the center");
    assert.notEqual(branch.parallel[1][0].x, branch.contact.x, "lower shoulder must originate on its rail, not the center");
    branch.parallel.forEach((points) => pointNear(points.at(-1)!, branch.contact));
  }

  const mixed = geometry.planThread([
    geometry.planMember([fragment(150, 220, 100)]),
    geometry.planMember([fragment(300, 370, 100)]),
    geometry.planMember([fragment(210, 290, 260)]),
  ], { laneX: 40 });
  assert.equal(mixed.mode, "thread");
  assert.equal(mixed.branches[0].portGroup, mixed.branches[1].portGroup,
    "same-line members inside a long thread must share one rounded margin port");
  assert.equal(mixed.branches.filter((branch) => branch.portGroup === mixed.branches[0].portGroup && branch.isPortLeader).length, 1,
    "a shared port must have exactly one margin leader before its branches fork");
  assert.ok(mixed.branches.find((branch) => branch.portGroup === mixed.branches[0].portGroup && !branch.isPortLeader)!.points[0].x > 40,
    "the second same-line branch must fork from the shared corridor instead of redrawing the margin turn");
  mixed.branches.forEach((branch) => {
    assert.ok(branch.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
    branch.parallel.forEach((points) => pointNear(points.at(-1)!, branch.contact));
  });
});

test("the lab is wired to the tested geometry, Loom engine, and 18-case proof", () => {
  const lab = readFileSync(new URL("../lab/lab.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../lab/shapes.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../lab/lab.css", import.meta.url), "utf8");
  /* C0.5: Reading retired its local bows — both views now paint the bracket
   * grammar through the Loom engine (drawRouted), so lab.js no longer calls
   * TG.planArc / TG.planThread / TG.relativeClientRects, and the drawArc /
   * drawThread paint paths are gone. trace-geometry's measurement utilities
   * stay covered directly by the geometry tests above. */
  assert.match(lab, /drawRouted\(/);
  assert.doesNotMatch(lab, /TG\.planArc/);
  assert.doesNotMatch(lab, /TG\.planThread/);
  assert.doesNotMatch(lab, /function drawArc\b/);
  assert.doesNotMatch(lab, /function drawThread\b/);
  assert.match(lab, /TG\.resolveSegmentHue/);
  assert.doesNotMatch(lab, /function firstRect/);
  for (const kind of ["link:parallel", "link:contrast", "link:echo", "hinge", "mirror", "series"]) assert.match(lab, new RegExp(`kind: "${kind.replace(":", "\\:")}"`));
  assert.match(lab, /qaDistance: "same"/);
  assert.match(lab, /qaDistance: "adjacent"/);
  assert.match(lab, /qaDistance: "far"/);
  assert.match(lab, /qaPlacement: "middle-right"/);
  assert.match(lab, /\.join\("\\n"\)/);
  assert.match(lab, /function appendQaLines/);
  assert.match(css, /\.qa-line\[data-align="right"\]/);
  assert.match(html, /id="angles-btn"/);
  assert.match(html, /src="trace-geometry\.js"/);
  assert.match(lab, /import \{ planRoute, rankCompanions \} from "\.\/route-engine\.js"/);
  assert.match(lab, /planRoute\(block, ann/);
  assert.doesNotMatch(lab, /"data-role": "(?:mirror-joint|series-tick)"/);
});
