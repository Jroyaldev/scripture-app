/* route-engine.ts — Loom: obstacle-aware marginalia threading.
 * Pure geometry: measured layout in, RoutePlan out. No DOM, no styling.
 *
 * One grammar for every annotation:
 *   pin → circular terminal turn → corridor shoulder → swoop port → spine
 * Every margin arrival pours tangentially into a vertical strand; a
 * multipoint annotation is tributaries feeding one spine. Same-line
 * pairs hammock beneath the line; a single anchor drips into the loom.
 *
 * Hard constraints (never traded away): no sampled point may enter an
 * expanded text/number obstacle (outside the terminal exemption);
 * horizontal travel only inside verified corridors; long verticals only
 * on a loom strand; every join tangent-continuous; ports never overshoot.
 */

export type RouteSide = "left" | "right";
export type RouteMode =
  | "same-line"
  | "local-tag"
  | "local-comb"
  | "middle-shaft"
  | "tag"
  | "corridor"
  | "bow"
  | "multipoint";
export type RouteCradleVariant = "facing" | "embrace";

export interface RouteRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteLineSegment {
  type: "L";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RouteCubicSegment {
  type: "C";
  x1: number;
  y1: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x2: number;
  y2: number;
}

export type RouteSegment = RouteLineSegment | RouteCubicSegment;

export interface RouteAnchor {
  id: string;
  fragments: readonly RouteRect[];
  documentOrder: number;
  sectionId?: string;
}

export type RouteFragment = RouteRect;

export interface RouteAnnotation {
  id: string;
  kind?: string;
  focused?: boolean;
  anchors: readonly RouteAnchor[];
}

export interface RouteRenderedLine extends RouteRect {
  id?: string;
  documentOrder?: number;
  sectionId?: string;
}

export interface RouteSection extends RouteRect {
  id: string;
  documentOrder: number;
}

export interface RouteSectionGap extends RouteRect {
  id: string;
  documentOrder: number;
  hardClear: boolean;
  fromSectionId?: string;
  toSectionId?: string;
  beforeSectionId?: string;
  afterSectionId?: string;
}

interface NormalizedSectionGap extends RouteSectionGap {
  fromSectionId: string;
  toSectionId: string;
}

export interface RouteTextBlock {
  bounds: RouteRect;
  renderedLines: readonly RouteRenderedLine[];
  wordRuns?: readonly RouteRect[];
  verseNumberRects?: readonly RouteRect[];
  additionalObstacles?: readonly RouteRect[];
  lineHeight?: number;
  preferredMargin?: RouteSide;
  availableLeftMargin?: number;
  availableRightMargin?: number;
  sections?: readonly RouteSection[];
  sectionGaps?: readonly RouteSectionGap[];
}

export type RouteBlock = RouteTextBlock;

export interface RouteCorridorClaim {
  corridor: number;
  y: number;
  xMin: number;
  xMax: number;
  pad: number;
  id?: string;
  ownerRunId?: string;
  sectionId?: string;
}

export interface RouteCorridorClaimInput {
  corridor?: number;
  y?: number;
  xMin?: number;
  xMax?: number;
  pad?: number;
}

export interface RouteSpineClaim {
  x: number;
  top: number;
  bottom: number;
  id?: string;
  ownerRunId?: string;
  side?: RouteSide;
  strand?: number;
}

export interface RouteStrandClaim {
  side: RouteSide;
  strand: number;
  top: number;
  bottom: number;
  id?: string;
  ownerRunId?: string;
}

export interface RouteHandoffClaimInput {
  gapId?: string;
  fromSectionId?: string;
  toSectionId?: string;
  xMin?: number;
  xMax?: number;
  top?: number;
  bottom?: number;
  pad?: number;
}

export interface RouteHandoffClaim {
  gapId: string;
  fromSectionId?: string;
  toSectionId?: string;
  xMin: number;
  xMax: number;
  top: number;
  bottom: number;
  pad: number;
}

export interface RouteSectionSideMemory {
  sectionId: string;
  side: RouteSide;
}

export type RouteSectionSides =
  | ReadonlyMap<string, RouteSide>
  | readonly RouteSectionSideMemory[]
  | Readonly<Record<string, RouteSide>>;

export interface RouteDebugCorridorAttempt {
  ci: number;
  band: { top: number; bottom: number };
  window: { minY: number; maxY: number };
  xa: number;
  xb: number;
  contactY?: number;
  tried: string[];
}

export interface RouteDebugCollector {
  corridors?: RouteDebugCorridorAttempt[];
}

export interface RouteOptions {
  fontSize?: number;
  envelope?: number;
  underlineDy?: number;
  strandIndex?: number;
  laneIndex?: number;
  strandPitch?: number;
  corridorClaims?: readonly RouteCorridorClaimInput[];
  loomAir?: number;
  claimPad?: number;
  spineClaims?: readonly RouteSpineClaim[];
  handoffClaims?: readonly RouteHandoffClaimInput[];
  strandClaims?: readonly RouteStrandClaim[];
  leftLoomX?: number;
  rightLoomX?: number;
  loomX?: number;
  sides?: readonly string[];
  focused?: boolean;
  allowMiddle?: boolean;
  disableCradle?: boolean;
  disableLocal?: boolean;
  previousSide?: RouteSide;
  previousSectionSides?: RouteSectionSides;
  previousTopology?: { sectionSides?: RouteSectionSides };
  sectionRouting?: boolean | { enabled?: boolean; previousSides?: RouteSectionSides };
  debug?: RouteDebugCollector;
}

export interface RouteDecline {
  move: string;
  why: string;
  detail?: unknown;
}

export interface RouteDiagnostics {
  minimumClearance?: number;
  intersections?: number;
  cornerRadii?: number[];
  totalLength?: number;
  laneIndex?: number | null;
  declined?: RouteDecline[];
  exits?: string[];
  side?: RouteSide | "mixed";
  score?: number;
  alternativesConsidered?: Array<{ side: RouteSide; strand: number; score: number }>;
  sectionRouting?: { status: string; topologySignature: string };
  dp?: SectionSolverDiagnostics;
  stateFailures?: SectionStateFailure[];
  finalize?: RouteDiagnostics;
}

export interface RouteSpine {
  x: number;
  top: number;
  bottom: number;
  id?: string;
  kind?: string;
  ownerRunId?: string;
  runId?: string;
  side?: RouteSide;
  strand?: number;
  sectionIds?: string[];
}

interface TerminalExemption {
  rect: RouteRect;
  cx: number;
  cy: number;
  guardRaw?: boolean;
}

type SegmentExemption = TerminalExemption[] | null;

interface SampledPoint extends RoutePoint {
  ex?: TerminalExemption[];
}

export interface ValidRoutePlan {
  valid: true;
  side: RouteSide | null;
  mode: RouteMode;
  cradleVariant?: RouteCradleVariant;
  contacts: RoutePoint[];
  corridors: number[];
  corridorIdx: number[];
  marginRailX: number | null;
  centerline: RouteSegment[];
  sampledPoints: SampledPoint[];
  spine: RouteSpine | null;
  ports: RoutePoint[];
  markerRanges: { marginStart?: number; marginEnd?: number };
  claimsOut: RouteCorridorClaim[];
  spineClaimOut: RouteSpineClaim | null;
  diagnostics: RouteDiagnostics;
  strand?: number | null;
  strandClaimOut?: RouteStrandClaim | null;
  rawLength?: number;
  semCenter?: number;
  scoreRaw?: number;
  score?: number;
  sectionId?: string;
  _exempts?: SegmentExemption[];
  _contactOwners?: Array<{ anchorId: string }>;
  topology?: string;
  sectionAware?: boolean;
  sideRuns?: unknown[];
  spines?: RouteSpine[];
  handoffs?: unknown[];
  routeParts?: unknown[];
  anchorRuns?: unknown[];
  corridorClaimsOut?: RouteCorridorClaim[];
  spineClaimsOut?: RouteSpineClaim[];
  strandClaimsOut?: RouteStrandClaim[];
  handoffClaimsOut?: RouteHandoffClaim[];
  topologySignature?: string;
  topologyMemory?: { sectionSides: RouteSectionSideMemory[]; topologySignature: string };
  sectionSides?: RouteSectionSideMemory[];
  markerRangesByRun?: Array<{ runId: string; marginStart: number; marginEnd: number }>;
}

export interface FailedRoutePlan {
  valid: false;
  reason: string;
  detail?: unknown;
  declined?: RouteDecline[];
  laneIndex?: number;
  diagnostics?: RouteDiagnostics | SectionSolverDiagnostics;
  failures?: SectionStateFailure[];
  debug?: unknown;
}

export type RoutePlan = ValidRoutePlan | FailedRoutePlan;

export interface CompanionInterval {
  id: string;
  top: number;
  bottom: number;
}

export interface StrandInterval extends CompanionInterval {
  focused: boolean;
}

interface ExpandedObstacle extends RouteRect {
  raw: RouteRect;
}

interface Corridor {
  top: number;
  bottom: number;
  above: number;
  below: number;
}

interface CorridorSlot {
  y: number;
  dip: number;
  claim: RouteCorridorClaim;
}

interface RouteBranch {
  anchor: RouteAnchor;
  frag: RouteRect;
  li: number;
}

interface CradleCandidate {
  variant: "facing" | "embrace";
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface CradleFit {
  lead: number;
  rA: number;
  rB: number;
  aFloor: number;
  bFloor: number;
}

interface MarginGroup {
  li: number;
  members: RouteBranch[];
  contacts: RoutePoint[];
  xMax: number;
  cy: number;
  sectionId?: string;
  left: number;
  right: number;
}

interface PreparedMarginGroup extends MarginGroup {
  pins: RoutePoint[];
  runY: number;
  innerPinX: number;
  r: number;
  up: boolean;
  claim: RouteCorridorClaim;
  side?: RouteSide | null;
}

interface MiddleMarginGroup extends MarginGroup {
  side: RouteSide;
}

interface MiddlePin extends RoutePoint {
  m: RouteBranch;
}

interface MarginRoutePlan extends ValidRoutePlan {
  side: RouteSide;
  strand: number;
  marginRailX: number;
  rawLength: number;
  semCenter: number;
}

interface ScoredMarginRoutePlan extends MarginRoutePlan {
  scoreRaw: number;
  score: number;
}

interface SectionMarginPlan extends MarginRoutePlan {
  sectionId: string;
  _exempts: SegmentExemption[];
  _contactOwners: Array<{ anchorId: string }>;
}

interface SectionState {
  section: RouteSection;
  sectionOrder: number;
  side: RouteSide;
  sideRank: number;
  strand: number;
  x: number;
  plan: SectionMarginPlan;
  minPortY: number;
  maxPortY: number;
  baseCost: number;
}

interface SectionStateFailure {
  sectionId: string;
  side: RouteSide;
  strand: number;
  why: string;
}

interface SectionHandoff {
  gap: NormalizedSectionGap;
  segments: RouteSegment[];
  claim: RouteHandoffClaim;
  fromY: number;
  toY: number;
  rawLength: number;
}

type SectionTransition =
  | { kind: "continue" }
  | { kind: "handoff"; handoff: SectionHandoff };

interface SectionRunDraft {
  side: RouteSide;
  strand: number;
  railX: number;
  x: number;
  states: SectionState[];
  sectionIds: string[];
  id: string;
  runIndex: number;
  spineId: string;
  top: number;
  bottom: number;
  corridorClaimIds?: string[];
  spineClaimId?: string;
  strandClaimId?: string;
}

interface SectionHandoffDraft {
  id: string;
  gapId: string;
  fromSectionId: string;
  toSectionId: string;
  fromRunId: string;
  toRunId: string;
  fromSpineId: string;
  toSpineId: string;
  from: RoutePoint;
  to: RoutePoint;
  _segments?: RouteSegment[];
  segments?: OwnedRouteSegment[];
  claim?: RouteHandoffClaim;
  claimOut?: OwnedHandoffClaim;
}

interface SegmentOwnership {
  role: "tributary" | "spine" | "handoff";
  ownerId: string;
  runId?: string;
  sectionId?: string;
  spineId?: string;
  handoffId?: string;
  fromRunId?: string;
  toRunId?: string;
}

interface OwnedRoutePoint extends RoutePoint {
  id: string;
  role: "terminal-contact" | "tributary-port" | "handoff-port";
  ownerId: string;
  runId: string;
  spineId: string;
  sectionId?: string;
  anchorId?: string;
  handoffId?: string;
}

type OwnedRouteSegment = RouteSegment & SegmentOwnership & { id: string };

interface RoutePartDraft extends SegmentOwnership {
  id: string;
  segments: OwnedRouteSegment[];
  corridorClaimIds?: string[];
}

interface SectionSpine extends RouteSpine {
  id: string;
  kind: string;
  ownerRunId: string;
  runId: string;
  side: RouteSide;
  strand: number;
  sectionIds: string[];
}

interface OwnedCorridorClaim extends RouteCorridorClaim {
  id: string;
  ownerRunId: string;
  sectionId: string;
}

interface OwnedHandoffClaim extends RouteHandoffClaim {
  id: string;
  ownerHandoffId: string;
}

interface SectionSolverDiagnostics {
  sectionCount?: number;
  maxStatesPerSection?: number;
  statesEvaluated?: number;
  transitionsEvaluated?: number;
  handoffsEvaluated?: number;
  scoreDefinition?: string;
  scoreAccumulator?: string;
  scoreQuantization?: string;
  predecessorStorage?: string;
  maxFrontierSize?: number;
  scoreDeclineReason?: string;
  maximumPathRaw?: number;
  maxLabelsPerState?: number;
  maxFrontierLabels?: number;
  labelsEvaluated?: number;
  winningBucket?: number;
  winningHandoffs?: number;
  tieScope?: string;
  terminalStates?: DPTerminalEntry[];
}

interface DPStateBase {
  side: RouteSide;
  sideRank: number;
  strand: number;
  baseCost: number;
}

interface DPEdge<TTransition> {
  transition: TTransition;
  cost: number;
}

interface DPForwardLabel<TState, TTransition> {
  state: TState;
  stateIndex: number;
  scoreRaw: number;
  handoffCount: number;
  previous: DPForwardLabel<TState, TTransition> | null;
  transition: TTransition | null;
  lexRank: number;
}

interface DPSuffixLabel {
  scoreRaw: number;
  incrementRaw: number | null;
  next: DPSuffixLabel | null;
}

interface DPTerminalEntry {
  side: RouteSide;
  strand: number;
  scoreRaw: number;
  handoffCount: number;
  tieRank: number;
}

interface DPSolution<TState, TTransition> {
  chosen: {
    state: TState;
    scoreRaw: number;
    score: number;
    handoffCount: number;
    tieRank: number;
  };
  path: TState[];
  transitions: TTransition[];
  terminalEntries: DPTerminalEntry[];
}

interface ContactTerminal {
  segs: [RouteLineSegment, RouteCubicSegment];
  landX: number;
  envelope: RouteRect;
}

type SectionMetadata =
  | { active: boolean; valid: false; reason: string; detail?: unknown }
  | {
      active: true;
      valid: true;
      sections: RouteSection[];
      sectionIndex: Map<string, number>;
      gapByPair: Map<string, NormalizedSectionGap>;
    };

const KAPPA = 0.5522847498;

/* ── rect + segment primitives ─────────────────────────────── */
function expandRect(r: RouteRect, e: number): RouteRect {
  return { left: r.left - e, right: r.right + e, top: r.top - e, bottom: r.bottom + e };
}
function inRect(x: number, y: number, r: RouteRect): boolean {
  return x > r.left && x < r.right && y > r.top && y < r.bottom;
}
function L(x1: number, y1: number, x2: number, y2: number): RouteLineSegment {
  return { type: "L", x1, y1, x2, y2 };
}
function C(x1: number, y1: number, c1x: number, c1y: number, c2x: number, c2y: number,
  x2: number, y2: number): RouteCubicSegment {
  return { type: "C", x1, y1, c1x, c1y, c2x, c2y, x2, y2 };
}
/* quarter cubic: vertical tangent at (x1,y1) → horizontal tangent at (x2,y2) */
function quarterVH(x1: number, y1: number, x2: number, y2: number): RouteCubicSegment {
  return C(x1, y1, x1, y1 + KAPPA * (y2 - y1), x2 - KAPPA * (x2 - x1), y2, x2, y2);
}
/* quarter cubic: horizontal tangent at (x1,y1) → vertical tangent at (x2,y2).
 * With |dx| > |dy| this is the shallow "swoop" that pours into a strand. */
function quarterHV(x1: number, y1: number, x2: number, y2: number): RouteCubicSegment {
  return C(x1, y1, x1 + KAPPA * (x2 - x1), y1, x2, y2 - KAPPA * (y2 - y1), x2, y2);
}
/* settle cubic: horizontal tangent at BOTH ends. Retired from the drawn
 * grammar by the C0.5 bracket amendment (only the host-disabled middle
 * shaft still reaches it through contactTerminal). */
function settleHH(x1: number, y1: number, x2: number, y2: number): RouteCubicSegment {
  return C(x1, y1, x1 + KAPPA * (x2 - x1), y1, x2 - KAPPA * (x2 - x1), y2, x2, y2);
}
function segPoints(s: RouteSegment, step = 1): RoutePoint[] {
  const pts: RoutePoint[] = [];
  if (s.type === "L") {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t });
    }
  } else {
    const approx = (Math.hypot(s.c1x - s.x1, s.c1y - s.y1) +
      Math.hypot(s.c2x - s.c1x, s.c2y - s.c1y) +
      Math.hypot(s.x2 - s.c2x, s.y2 - s.c2y));
    const n = Math.max(4, Math.ceil(approx / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push({
        x: u * u * u * s.x1 + 3 * u * u * t * s.c1x + 3 * u * t * t * s.c2x + t * t * t * s.x2,
        y: u * u * u * s.y1 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y2,
      });
    }
  }
  return pts;
}
function segmentsLength(segs: readonly RouteSegment[]): number {
  let total = 0;
  for (const s of segs) {
    const pts = segPoints(s, 2);
    for (let i = 1; i < pts.length; i++) {
      const point = pts[i]!;
      const previous = pts[i - 1]!;
      total += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
  }
  return total;
}

/* tuning constants of the grammar — one place, deliberately few */
const DROP_MIN = 3.2;    // minimum level change between a contact and its run
const CONTACT_LEAD = 6;  // straight, colinear horizontal lead at every phrase dot
const CONTACT_LEAD_MIN = 3; // the lead may shrink this far for measured room, never vanish
const CORNER = 6;        // the C0.5 corner token — still measures section handoffs
/* THE SWEPT GRAMMAR — DATED REVERSAL, 2026-07-30 (the connection-lines
 * revival). C0.5 (eda2d11) ruled: "One drawn vocabulary remains: horizontals
 * colinear with underlines, verticals, and one soft rounded right-angle
 * corner" — and that one corner measured 6px. The reader has now asked for
 * the full connection lines back: "s curves left and right logic; not just
 * underline with a line pointing at margin." So the drawn vocabulary regains
 * disciplined curvature, in exactly two places:
 *   1. SWEEP replaces CORNER as the radius token wherever a route's level
 *      run meets its rail or cradle wall — same construction, same caps
 *      (never past runGap-1, never half the port gap), so a dense stack
 *      degrades toward the old bracket instead of colliding.
 *   2. A route of exactly two single-line groups may draw one BOW: both
 *      level runs extend colinearly to the rail datum and one cubic with
 *      horizontal end-tangents sweeps through a vertical apex just beyond
 *      the rail. Level → S → level, one continuous stroke, no corner-rail-
 *      corner bracket, no separate margin pointer.
 * What C0.5 rejected stays rejected: offset parallels, vertical-tangent pin
 * turns, below-line return loops, ornament. Departures remain colinear with
 * their underlines, landings remain on the 0.00px datum, and curvature
 * exists only where level travel becomes rail travel. (The ribbons era had
 * retired the mirror-S itself — 44f8ab3: "wobbly brackets at short range, a
 * knee at long range, hockey-stick terminals." Those modes cannot recur
 * here: the S never touches a terminal — leads and dots stay straight — and
 * beyond BOW_SPAN_MAX the straight rail still carries the journey.) */
const SWEEP = 16;        // swept-corner token: route curvature at the rail
const BOW_SPAN_MIN = 12; // a bow needs real vertical travel to read as an S
const BOW_SPAN_MAX = 132; // beyond ~4 lines the straight rail carries better
const BOW_APEX_MIN = 6;  // shallowest apex that still reads as a sweep
const BOW_APEX_MAX = 14; // deepest apex — an S is a passage, not an ornament
const UNDERLINE_STRIP = 2.25; // bottom strip of a box where underlines (and runs) live
const SETTLE_MIN = 3.5;  // narrowest legal settle width
const SETTLE_MAX = 14;   // widest — a settle is a level change, not a journey
const SWOOP_REACH = 11;  // horizontal length of the port swoop
const SWOOP_DIP = 3.2;   // ideal vertical dip of the port swoop
const SWOOP_DIP_MIN = 1.5;
const CLAIM_GAP = 2.2;   // min separation of two shoulders in one corridor
const BAND_MIN = 4.2;    // corridor must be at least this tall to be legal
const FLOOR_MIN = 5;         // a cradle floor must really exist
const GAP_FACING_MIN = 18;   // ≈ 2 min leads + 2 min settles + FLOOR_MIN
const GAP_EMBRACE_MAX = 24;  // embrace rescues facing only in the 18..24 overlap band
const SECTION_HYSTERESIS = 12;
const MAX_SECTION_STRANDS = 3;
const HANDOFF_EDGE_INSET = 1;
const HANDOFF_MIN_SPAN = 8;

/* ── lead + settle terminal (middle shaft only) ─────────────────
 * Retired from the drawn grammar by the C0.5 bracket amendment: margins,
 * locals, and cradles now use only colinear level runs and soft corners.
 * The host-disabled middle shaft still attaches with this construction.
 * dir is the lead direction (−1 left, +1 right); null means no room. */
const settleWidth = (depth: number): number =>
  Math.max(SETTLE_MIN, Math.min(depth * 1.25, SETTLE_MAX));
function contactTerminal(pin: RoutePoint, dir: number, runY: number,
  maxSpan = Infinity): ContactTerminal | null {
  const depth = runY - pin.y;
  if (depth < DROP_MIN) return null;
  let lead = CONTACT_LEAD;
  let settle = settleWidth(depth);
  if (lead + settle > maxSpan) {
    /* measured room may compress the construction, never distort it */
    lead = Math.max(CONTACT_LEAD_MIN, Math.min(CONTACT_LEAD, maxSpan - settle));
    settle = Math.min(settle, maxSpan - lead);
    if (settle < SETTLE_MIN || lead + settle > maxSpan) return null;
  }
  const leadX = pin.x + dir * lead;
  const landX = leadX + dir * settle;
  return {
    segs: [L(pin.x, pin.y, leadX, pin.y), settleHH(leadX, pin.y, landX, runY)],
    landX,
    /* the lead + settle live below the underline, never above it, and only
     * as far sideways as the settle itself — a deliberate, tiny privilege
     * through neighboring clearance skirts, guarded against real ink */
    envelope: {
      left: Math.min(pin.x, landX) - 0.5,
      right: Math.max(pin.x, landX) + 0.5,
      top: pin.y - 0.75,
      bottom: runY + 0.75,
    },
  };
}

/* Keep the measured score raw. Tenth-pixel calm is a comparator on a complete
 * topology, never a second round of already-rounded atomic contributions. */
function addScoreRaw(...parts: Array<number | null | undefined>): number | null {
  let total = 0;
  for (const part of parts) {
    if (typeof part !== "number" || !Number.isFinite(part)) return null;
    total += part;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function scoreBucketFromRaw(scoreRaw: number | null | undefined): number | null {
  if (typeof scoreRaw !== "number" || !Number.isFinite(scoreRaw)) return null;
  const bucket = Math.round(scoreRaw * 10);
  return Number.isSafeInteger(bucket) ? bucket : null;
}

function finiteRect(r: Partial<RouteRect> | null | undefined): boolean {
  return !!r && typeof r.left === "number" && Number.isFinite(r.left) &&
    typeof r.right === "number" && Number.isFinite(r.right) &&
    typeof r.top === "number" && Number.isFinite(r.top) &&
    typeof r.bottom === "number" && Number.isFinite(r.bottom) &&
    r.left < r.right && r.top < r.bottom;
}

function normalizeHandoffClaim(
  claim: RouteHandoffClaimInput | null | undefined,
): RouteHandoffClaim | null {
  if (!claim || typeof claim.gapId !== "string" || !claim.gapId ||
      typeof claim.xMin !== "number" || !Number.isFinite(claim.xMin) ||
      typeof claim.xMax !== "number" || !Number.isFinite(claim.xMax) ||
      typeof claim.top !== "number" || !Number.isFinite(claim.top) ||
      typeof claim.bottom !== "number" || !Number.isFinite(claim.bottom)) return null;
  return {
    gapId: claim.gapId,
    fromSectionId: typeof claim.fromSectionId === "string" ? claim.fromSectionId : undefined,
    toSectionId: typeof claim.toSectionId === "string" ? claim.toSectionId : undefined,
    xMin: Math.min(claim.xMin, claim.xMax),
    xMax: Math.max(claim.xMin, claim.xMax),
    top: Math.min(claim.top, claim.bottom),
    bottom: Math.max(claim.top, claim.bottom),
    pad: typeof claim.pad === "number" && Number.isFinite(claim.pad) ? Math.max(0, claim.pad) : 0,
  };
}

function handoffClaimsConflict(
  existing: RouteHandoffClaimInput | null | undefined,
  candidate: RouteHandoffClaimInput | null | undefined,
): boolean {
  if (!existing || !candidate || existing.gapId !== candidate.gapId) return false;
  const a = normalizeHandoffClaim(existing);
  const b = normalizeHandoffClaim(candidate);
  if (!a || !b) return true;
  return a.xMin - a.pad <= b.xMax + b.pad && b.xMin - b.pad <= a.xMax + a.pad &&
    a.top - a.pad <= b.bottom + b.pad && b.top - b.pad <= a.bottom + a.pad;
}

function stableNumber(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function stableIdPart(value: unknown): string {
  const text = String(value);
  let encoded = "";
  let chunkStart = 0;
  const flush = (end: number): void => {
    if (end > chunkStart) encoded += encodeURIComponent(text.slice(chunkStart, end));
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff &&
        i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff) {
      i++;
      continue;
    }
    if (code < 0xd800 || code > 0xdfff) continue;
    flush(i);
    /* encodeURIComponent rejects isolated UTF-16 surrogates. `%u` cannot
     * collide with its well-formed output because a literal percent is
     * encoded as `%25`; preserve the exact code unit instead of replacing
     * distinct malformed IDs with the same U+FFFD value. */
    encoded += `%u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    chunkStart = i + 1;
  }
  flush(text.length);
  return encoded;
}

function sectionPairKey(fromSectionId: unknown, toSectionId: unknown): string {
  return JSON.stringify([fromSectionId, toSectionId]);
}

/* Validate section provenance as one closed semantic contract. Partial or
 * contradictory declarations must never leak permission for a handoff. */
function validateSectionMetadata(
  block: RouteTextBlock,
  ann: RouteAnnotation,
  enabled: boolean | undefined,
): SectionMetadata {
  const sections = block.sections;
  const gaps = block.sectionGaps;
  const lines = block.renderedLines;
  if (enabled !== true) return { active: false, valid: false, reason: enabled === false ? "disabled" : "absent" };
  const bad = (reason: string, detail?: unknown): SectionMetadata =>
    ({ active: true, valid: false, reason, detail });
  if (!Array.isArray(sections) || sections.length < 2) return bad("missing-sections");
  if (!Array.isArray(gaps)) return bad("missing-section-gaps");

  const ids = new Set();
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    if (!section || typeof section.id !== "string" || !section.id) return bad("malformed-section", { index: i });
    if (ids.has(section.id)) return bad("duplicate-section", { sectionId: section.id });
    if (!Number.isFinite(section.documentOrder) || !finiteRect(section)) return bad("malformed-section", { sectionId: section.id });
    if (i && (section.documentOrder <= sections[i - 1]!.documentOrder || section.top < sections[i - 1]!.bottom)) {
      return bad("out-of-order-section", { sectionId: section.id });
    }
    ids.add(section.id);
  }
  const sectionIndex = new Map<string, number>(sections.map((section, index) => [section.id, index]));

  const lineIds = new Set();
  const lineOrders = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line || typeof line.id !== "string" || !line.id || lineIds.has(line.id) ||
        !Number.isFinite(line.documentOrder) || lineOrders.has(line.documentOrder) ||
        typeof line.sectionId !== "string" || !ids.has(line.sectionId) || !finiteRect(line)) {
      return bad(lineIds.has(line?.id) ? "duplicate-rendered-line" : "malformed-rendered-line", { index: i });
    }
    const owner = sections[sectionIndex.get(line.sectionId)!]!;
    if (line.left < owner.left || line.right > owner.right ||
        line.top < owner.top || line.bottom > owner.bottom) {
      return bad("out-of-bounds-rendered-line", { lineId: line.id, sectionId: line.sectionId });
    }
    lineIds.add(line.id);
    lineOrders.add(line.documentOrder);
  }
  const orderedLines = [...lines] as Array<RouteRenderedLine & {
    id: string;
    documentOrder: number;
    sectionId: string;
  }>;
  orderedLines.sort((a, b) =>
    a.documentOrder - b.documentOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 1; i < orderedLines.length; i++) {
    const before = orderedLines[i - 1]!;
    const after = orderedLines[i]!;
    if (after.top < before.top || sectionIndex.get(after.sectionId)! < sectionIndex.get(before.sectionId)!) {
      return bad("out-of-order-rendered-line", { lineId: after.id });
    }
  }

  const anchorIds = new Set();
  const anchorOrders = new Set();
  for (let i = 0; i < ann.anchors.length; i++) {
    const anchor = ann.anchors[i]!;
    if (!anchor || typeof anchor.id !== "string" || !anchor.id || anchorIds.has(anchor.id) ||
        !Number.isFinite(anchor.documentOrder) || anchorOrders.has(anchor.documentOrder) ||
        typeof anchor.sectionId !== "string" || !ids.has(anchor.sectionId) ||
        !Array.isArray(anchor.fragments) || !anchor.fragments.length ||
        anchor.fragments.some((fragment) => !finiteRect(fragment))) {
      return bad(anchorIds.has(anchor?.id) ? "duplicate-anchor" : "malformed-anchor", { index: i });
    }
    const owner = sections[sectionIndex.get(anchor.sectionId)!]!;
    if (anchor.fragments.some((fragment) => fragment.left < owner.left || fragment.right > owner.right ||
        fragment.top < owner.top || fragment.bottom > owner.bottom)) {
      return bad("out-of-bounds-anchor", { anchorId: anchor.id, sectionId: anchor.sectionId });
    }
    anchorIds.add(anchor.id);
    anchorOrders.add(anchor.documentOrder);
  }
  const orderedAnchors = [...ann.anchors] as Array<RouteAnchor & { sectionId: string }>;
  orderedAnchors.sort((a, b) =>
    a.documentOrder - b.documentOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const firstFragment = (anchor: RouteAnchor): RouteRect => [...anchor.fragments].sort((a, b) =>
    a.top - b.top || a.left - b.left || a.bottom - b.bottom || a.right - b.right)[0]!;
  for (let i = 1; i < orderedAnchors.length; i++) {
    const before = orderedAnchors[i - 1]!;
    const after = orderedAnchors[i]!;
    const beforeFragment = firstFragment(before);
    const afterFragment = firstFragment(after);
    if (sectionIndex.get(after.sectionId)! < sectionIndex.get(before.sectionId)! ||
        (after.sectionId === before.sectionId &&
          (afterFragment.top < beforeFragment.top ||
            (afterFragment.top === beforeFragment.top && afterFragment.left < beforeFragment.left)))) {
      return bad("out-of-order-anchor", { anchorId: after.id });
    }
  }

  const gapIds = new Set();
  const gapPairs = new Set();
  const gapByPair = new Map<string, NormalizedSectionGap>();
  let lastGapOrder = -Infinity;
  let lastGapFromIndex = -1;
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i]!;
    const fromSectionId = gap?.fromSectionId ?? gap?.beforeSectionId;
    const toSectionId = gap?.toSectionId ?? gap?.afterSectionId;
    const fromIndex = fromSectionId == null ? undefined : sectionIndex.get(fromSectionId);
    const toIndex = toSectionId == null ? undefined : sectionIndex.get(toSectionId);
    const pair = sectionPairKey(fromSectionId, toSectionId);
    if (!gap || typeof gap.id !== "string" || !gap.id || gapIds.has(gap.id) || gapPairs.has(pair) ||
        !Number.isFinite(gap.documentOrder) || gap.documentOrder <= lastGapOrder || !finiteRect(gap) ||
        fromIndex == null || toIndex !== fromIndex + 1 || fromIndex <= lastGapFromIndex ||
        gap.hardClear !== true) {
      return bad(gapIds.has(gap?.id) ? "duplicate-section-gap" : gapPairs.has(pair) ? "duplicate-section-gap-pair" : "malformed-section-gap", { index: i });
    }
    const before = sections[fromIndex]!;
    const after = sections[toIndex]!;
    if (gap.top < before.bottom || gap.bottom > after.top) return bad("out-of-bounds-section-gap", { gapId: gap.id });
    gapIds.add(gap.id);
    gapPairs.add(pair);
    gapByPair.set(pair, { ...gap, fromSectionId: fromSectionId!, toSectionId: toSectionId! });
    lastGapOrder = gap.documentOrder;
    lastGapFromIndex = fromIndex;
  }

  const activeIds: string[] = [];
  const activeSeen = new Set<string>();
  for (const anchor of orderedAnchors) {
    if (activeIds[activeIds.length - 1] === anchor.sectionId) continue;
    if (activeSeen.has(anchor.sectionId)) return bad("noncontiguous-anchor-section", { sectionId: anchor.sectionId });
    activeSeen.add(anchor.sectionId);
    activeIds.push(anchor.sectionId);
  }
  if (activeIds.length < 2) return { active: true, valid: false, reason: "single-active-section" };
  let previous = -1;
  for (const id of activeIds) {
    const index = sectionIndex.get(id)!;
    if (index <= previous) return bad("out-of-order-anchor-section", { sectionId: id });
    previous = index;
  }
  return {
    active: true,
    valid: true,
    sections: activeIds.map((id) => sections[sectionIndex.get(id)!]!),
    sectionIndex,
    gapByPair,
  };
}

/* Exact complete-topology ordering without exponential assignments.
 * For each geometric state and total handoff count, retain the minimum-raw
 * backpointer label. That is sufficient to discover the winning complete
 * decipixel bucket and the smallest feasible handoff count. Raw Number costs
 * accumulate in document order and only complete topologies enter the tenth-
 * pixel comparator. Suffix labels retain their forward increments so the lex
 * reconstruction replays a candidate completion in that same order instead of
 * changing a boundary result through floating-point regrouping. Six geometric
 * states remain; labels grow only linearly with semantic sections, for
 * O(section² × state²) work. */
function solveSectionStateDP<TState extends DPStateBase, TTransition extends { kind: string }>(
  statesBySection: readonly (readonly TState[])[],
  transitionFor: (from: TState, to: TState, layer: number) => DPEdge<TTransition> | null,
  diagnostics: SectionSolverDiagnostics = {},
): DPSolution<TState, TTransition> | null {
  if (!statesBySection.length || statesBySection.some((states) => !states.length)) return null;
  const unsafeScore = () => { diagnostics.scoreDeclineReason = "unsafe-score-range"; return null; };
  const layers: TState[][] = statesBySection.map((states) => [...states].sort((a, b) =>
    a.sideRank - b.sideRank || a.strand - b.strand));
  const possibleStateCosts = layers.map((states) => states.map((state) =>
    Number.isFinite(state.baseCost) && state.baseCost >= 0 ? state.baseCost : null));
  if (possibleStateCosts.some((states) => states.some((score) => score == null))) return unsafeScore();
  const stateCosts = possibleStateCosts as number[][];
  const edges: Array<Array<Array<DPEdge<TTransition> | null>>> = [];
  const edgeCosts: Array<Array<Array<number | null>>> = [];
  for (let layer = 0; layer < layers.length - 1; layer++) {
    const currentLayer = layers[layer]!;
    const nextLayer = layers[layer + 1]!;
    const edgeLayer: Array<Array<DPEdge<TTransition> | null>> = currentLayer
      .map(() => Array<DPEdge<TTransition> | null>(nextLayer.length).fill(null));
    const costLayer: Array<Array<number | null>> = currentLayer
      .map(() => Array<number | null>(nextLayer.length).fill(null));
    for (let fromIndex = 0; fromIndex < currentLayer.length; fromIndex++) {
      for (let toIndex = 0; toIndex < nextLayer.length; toIndex++) {
        diagnostics.transitionsEvaluated = (diagnostics.transitionsEvaluated || 0) + 1;
        const edge = transitionFor(
          currentLayer[fromIndex]!, nextLayer[toIndex]!, layer + 1,
        );
        if (!edge) continue;
        if (!Number.isFinite(edge.cost) || edge.cost < 0) return unsafeScore();
        edgeLayer[fromIndex]![toIndex] = edge;
        costLayer[fromIndex]![toIndex] = edge.cost;
      }
    }
    if (!edgeLayer.some((row) => row.some(Boolean))) return null;
    edges.push(edgeLayer);
    edgeCosts.push(costLayer);
  }
  /* All route costs are non-negative. A sum of each layer's largest state
   * and transition is therefore a safe finite upper bound for every DP prefix
   * and suffix. Scores too large to own a stable tenth bucket decline. */
  const maximumPathRaw = addScoreRaw(
    ...stateCosts.map((values) => Math.max(...values)),
    ...edgeCosts.map((matrix) => Math.max(...matrix.flat().filter((value): value is number => value != null))),
  );
  if (maximumPathRaw == null || scoreBucketFromRaw(maximumPathRaw) == null) return unsafeScore();
  diagnostics.maximumPathRaw = maximumPathRaw;

  const forward: Array<Array<Map<number, DPForwardLabel<TState, TTransition>>>> =
    layers.map((states) => states.map(() => new Map<number, DPForwardLabel<TState, TTransition>>()));
  const firstLayer = layers[0]!;
  for (let stateIndex = 0; stateIndex < firstLayer.length; stateIndex++) {
    const state = firstLayer[stateIndex]!;
    forward[0]![stateIndex]!.set(0, {
      state,
      stateIndex,
      scoreRaw: stateCosts[0]![stateIndex]!,
      handoffCount: 0,
      previous: null,
      transition: null,
      lexRank: stateIndex,
    });
  }
  diagnostics.maxFrontierSize = Math.max(...layers.map((layer) => layer.length));
  diagnostics.maxLabelsPerState = 1;
  diagnostics.maxFrontierLabels = firstLayer.length;
  diagnostics.labelsEvaluated = firstLayer.length;

  for (let layer = 1; layer < layers.length; layer++) {
    for (let fromIndex = 0; fromIndex < layers[layer - 1]!.length; fromIndex++) {
      for (const previous of forward[layer - 1]![fromIndex]!.values()) {
        for (let toIndex = 0; toIndex < layers[layer]!.length; toIndex++) {
          const edge = edges[layer - 1]![fromIndex]![toIndex];
          if (!edge) continue;
          diagnostics.labelsEvaluated++;
          const handoffDelta = edge.transition.kind === "handoff" ? 1 : 0;
          const handoffCount = previous.handoffCount + handoffDelta;
          const incrementRaw = addScoreRaw(stateCosts[layer]![toIndex],
            edgeCosts[layer - 1]![fromIndex]![toIndex]);
          const scoreRaw = addScoreRaw(previous.scoreRaw, incrementRaw);
          if (incrementRaw == null || scoreRaw == null) return unsafeScore();
          const candidate = {
            state: layers[layer]![toIndex]!,
            stateIndex: toIndex,
            scoreRaw,
            handoffCount,
            previous,
            transition: edge.transition,
            lexRank: 0,
          };
          const existing = forward[layer]![toIndex]!.get(handoffCount);
          if (!existing || candidate.scoreRaw < existing.scoreRaw ||
              (candidate.scoreRaw === existing.scoreRaw && previous.lexRank < existing.previous!.lexRank)) {
            forward[layer]![toIndex]!.set(handoffCount, candidate);
          }
        }
      }
    }
    const ranked = forward[layer]!.flatMap((labels) => [...labels.values()]);
    ranked.sort((a, b) => a.previous!.lexRank - b.previous!.lexRank ||
      a.state.sideRank - b.state.sideRank || a.state.strand - b.state.strand);
    ranked.forEach((label, rank) => { label.lexRank = rank; });
    diagnostics.maxLabelsPerState = Math.max(diagnostics.maxLabelsPerState,
      ...forward[layer]!.map((labels) => labels.size));
    diagnostics.maxFrontierLabels = Math.max(diagnostics.maxFrontierLabels, ranked.length);
  }

  const terminalLabels = forward.at(-1)!.flatMap((labels) => [...labels.values()]);
  if (!terminalLabels.length) return null;
  const terminalBuckets = terminalLabels.map((label) => scoreBucketFromRaw(label.scoreRaw));
  if (terminalBuckets.some((bucket) => bucket == null)) return unsafeScore();
  const winningBucket = Math.min(...terminalBuckets as number[]);
  const winningHandoffs = Math.min(...terminalLabels
    .filter((label) => scoreBucketFromRaw(label.scoreRaw) === winningBucket)
    .map((label) => label.handoffCount));

  const suffix: Array<Array<Map<number, DPSuffixLabel>>> =
    layers.map((states) => states.map(() => new Map<number, DPSuffixLabel>()));
  for (const labels of suffix.at(-1)!) labels.set(0, {
    scoreRaw: 0,
    incrementRaw: null,
    next: null,
  });
  for (let layer = layers.length - 2; layer >= 0; layer--) {
    for (let fromIndex = 0; fromIndex < layers[layer]!.length; fromIndex++) {
      for (let toIndex = 0; toIndex < layers[layer + 1]!.length; toIndex++) {
        const edge = edges[layer]![fromIndex]![toIndex];
        if (!edge) continue;
        const handoffDelta = edge.transition.kind === "handoff" ? 1 : 0;
        for (const [remainingHandoffs, next] of suffix[layer + 1]![toIndex]!) {
          const handoffCount = handoffDelta + remainingHandoffs;
          const incrementRaw = addScoreRaw(stateCosts[layer + 1]![toIndex],
            edgeCosts[layer]![fromIndex]![toIndex]);
          const scoreRaw = addScoreRaw(incrementRaw, next.scoreRaw);
          if (incrementRaw == null || scoreRaw == null) return unsafeScore();
          const candidate = { scoreRaw, incrementRaw, next };
          const existing = suffix[layer]![fromIndex]!.get(handoffCount);
          if (existing == null || candidate.scoreRaw < existing.scoreRaw) {
            suffix[layer]![fromIndex]!.set(handoffCount, candidate);
          }
        }
      }
    }
  }

  const replaySuffix = (prefixRaw: number, suffixLabel: DPSuffixLabel): number | null => {
    let scoreRaw = prefixRaw;
    for (let label = suffixLabel; label?.next; label = label.next) {
      const nextScore = addScoreRaw(scoreRaw, label.incrementRaw);
      if (nextScore == null) return null;
      scoreRaw = nextScore;
    }
    return scoreRaw;
  };

  const path: TState[] = [];
  const transitions: TTransition[] = [];
  let previousIndex = -1;
  let remainingHandoffs = winningHandoffs;
  let scoreRaw = 0;
  for (let layer = 0; layer < layers.length; layer++) {
    let selected: {
      state: TState;
      stateIndex: number;
      edge: DPEdge<TTransition> | null;
      handoffDelta: number;
      incrementRaw: number;
    } | null = null;
    for (let stateIndex = 0; stateIndex < layers[layer]!.length; stateIndex++) {
      const state = layers[layer]![stateIndex]!;
      const edge = layer ? edges[layer - 1]![previousIndex]![stateIndex] : null;
      if (layer && !edge) continue;
      const handoffDelta = edge?.transition.kind === "handoff" ? 1 : 0;
      const afterHandoffs = remainingHandoffs - handoffDelta;
      if (afterHandoffs < 0) continue;
      const suffixLabel = suffix[layer]![stateIndex]!.get(afterHandoffs);
      if (suffixLabel == null) continue;
      const incrementRaw = addScoreRaw(stateCosts[layer]![stateIndex],
        edge ? edgeCosts[layer - 1]![previousIndex]![stateIndex] : 0);
      const prefixRaw = addScoreRaw(scoreRaw, incrementRaw);
      if (incrementRaw == null || prefixRaw == null) return unsafeScore();
      const completeRaw = replaySuffix(prefixRaw, suffixLabel);
      if (completeRaw == null) return unsafeScore();
      if (scoreBucketFromRaw(completeRaw) !== winningBucket) continue;
      selected = { state, stateIndex, edge: edge ?? null, handoffDelta, incrementRaw };
      break;
    }
    if (!selected) return null;
    path.push(selected.state);
    if (selected.edge) transitions.push(selected.edge.transition);
    const nextScoreRaw = addScoreRaw(scoreRaw, selected.incrementRaw);
    if (nextScoreRaw == null) return unsafeScore();
    scoreRaw = nextScoreRaw;
    remainingHandoffs -= selected.handoffDelta;
    previousIndex = selected.stateIndex;
  }
  if (remainingHandoffs !== 0 || scoreBucketFromRaw(scoreRaw) !== winningBucket) return null;
  const chosen = {
    state: path.at(-1)!,
    scoreRaw,
    score: winningBucket / 10,
    handoffCount: winningHandoffs,
    tieRank: 0,
  };
  diagnostics.winningBucket = winningBucket;
  diagnostics.winningHandoffs = winningHandoffs;
  diagnostics.tieScope = "all-complete-topologies";
  return {
    chosen,
    path,
    transitions,
    terminalEntries: terminalLabels.map((label) => ({
      side: label.state.side,
      strand: label.state.strand,
      scoreRaw: label.scoreRaw,
      handoffCount: label.handoffCount,
      tieRank: label.lexRank,
    })),
  };
}

/* Corridor occupancy is two-dimensional. A finite route claim owns only
 * the horizontal run it actually verified; older claims without X bounds
 * remain corridor-wide so malformed input can never legalize an overlap. */
function normalizeCorridorClaim(
  claim: RouteCorridorClaimInput | null | undefined,
): RouteCorridorClaim | null {
  if (!claim || typeof claim.corridor !== "number" || !Number.isFinite(claim.corridor) ||
      typeof claim.y !== "number" || !Number.isFinite(claim.y) ||
      typeof claim.xMin !== "number" || !Number.isFinite(claim.xMin) ||
      typeof claim.xMax !== "number" || !Number.isFinite(claim.xMax)) return null;
  return {
    corridor: claim.corridor,
    y: claim.y,
    xMin: Math.min(claim.xMin, claim.xMax),
    xMax: Math.max(claim.xMin, claim.xMax),
    pad: typeof claim.pad === "number" && Number.isFinite(claim.pad) ? Math.max(0, claim.pad) : 0,
  };
}
function makeCorridorClaim(corridor: number, y: number, xa: number, xb: number,
  pad = 0): RouteCorridorClaim | null {
  return normalizeCorridorClaim({ corridor, y, xMin: xa, xMax: xb, pad });
}
function corridorClaimsConflict(
  existing: RouteCorridorClaimInput | null | undefined,
  candidate: RouteCorridorClaimInput | null | undefined,
): boolean {
  if (!existing || !candidate || existing.corridor !== candidate.corridor) return false;
  if ((existing.pad != null && !Number.isFinite(existing.pad)) ||
      (candidate.pad != null && !Number.isFinite(candidate.pad))) return true;
  const existingPad = typeof existing.pad === "number" && Number.isFinite(existing.pad)
    ? Math.max(0, existing.pad) : 0;
  const candidatePad = typeof candidate.pad === "number" && Number.isFinite(candidate.pad)
    ? Math.max(0, candidate.pad) : 0;
  /* A malformed claim on the same corridor is conservative. In particular,
   * it cannot turn NaN into permission to share a slot. */
  if (typeof existing.y !== "number" || !Number.isFinite(existing.y) ||
      typeof candidate.y !== "number" || !Number.isFinite(candidate.y)) return true;
  if (Math.abs(existing.y - candidate.y) >= CLAIM_GAP + existingPad + candidatePad) return false;
  const a = normalizeCorridorClaim(existing);
  const b = normalizeCorridorClaim(candidate);
  if (!a || !b) return true;
  return a.xMin - a.pad <= b.xMax + b.pad && b.xMin - b.pad <= a.xMax + a.pad;
}

/* ── the planner ───────────────────────────────────────────── */
/* block: TextBlock (measured), ann: Annotation.
 * opts: { fontSize, envelope, underlineDy, strandIndex, strandPitch,
 *         corridorClaims: [{corridor, y, xMin, xMax, pad}], loomAir,
 *         leftLoomX, rightLoomX, loomX (legacy left alias), sides } */
export function planRoute(
  block: RouteTextBlock,
  ann: RouteAnnotation,
  opts: RouteOptions = {},
): RoutePlan {
  const fontSize = opts.fontSize || 17;
  const clearance = Math.max(2.5, fontSize * 0.12);
  const halfEnv = (opts.envelope || 5) / 2;
  const expand = clearance + halfEnv;
  const underlineDy = opts.underlineDy ?? 2;
  const strandIndex = opts.strandIndex ?? opts.laneIndex ?? 0;
  const strandPitch = opts.strandPitch || 6;
  const claims = opts.corridorClaims || [];
  const loomAir = opts.loomAir ?? 10;
  /* claimPad widens this thread's corridor claim on both sides — a
   * double-railed treatment is optically wider than its centerline */
  const claimPad = opts.claimPad ?? 0;
  /* two spines closer than this with overlapping y-intervals would read
   * as one broken line — the doubled rail was rejected as vocabulary and
   * cannot be re-admitted as a routing accident. Inert at pitch 6 today;
   * it is the tripwire for interior shafts and right-margin routing. */
  const SPINE_SEP = Math.min(4.8, strandPitch - 1.2);
  const spineClaims = opts.spineClaims || [];

  /* declined: structured facts about moves this plan attempted and gave
   * up — never prose. Hosts turn them into explanations. */
  const declined: RouteDecline[] = [];
  const fail = (reason: string, detail?: unknown): FailedRoutePlan =>
    ({ valid: false, reason, detail, declined, laneIndex: strandIndex });

  const lines = [...block.renderedLines].sort((a, b) => a.top - b.top);
  if (!lines.length) return fail("no-rendered-lines");
  /* collision truth is words when the host measured them — the whitespace
   * between words is real routing room. Word runs are a strict subset of
   * their line rects, so this only ever legalizes routes. Corridors, line
   * indexing, and the loom datum still come from merged lines. */
  const hardRects = block.wordRuns && block.wordRuns.length ? block.wordRuns : lines;
  const obstacles: ExpandedObstacle[] = [
    ...hardRects,
    ...(block.verseNumberRects || []),
    ...(block.additionalObstacles || []),
  ].map((r) => Object.assign(expandRect(r, expand), { raw: r }));

  /* y-bucketed index: sampling checks only obstacles near the point */
  const BUCKET = 16;
  const bucketIndex = new Map<number, ExpandedObstacle[]>();
  for (const o of obstacles) {
    for (let b = Math.floor(o.top / BUCKET); b <= Math.floor(o.bottom / BUCKET); b++) {
      let arr = bucketIndex.get(b);
      if (!arr) bucketIndex.set(b, arr = []);
      arr.push(o);
    }
  }
  const nearCache = new Map<number, ExpandedObstacle[]>();
  const obstaclesNear = (y: number, reach = 0): ExpandedObstacle[] => {
    const b0 = Math.floor((y - reach) / BUCKET), b1 = Math.floor((y + reach) / BUCKET);
    if (b0 === b1) return bucketIndex.get(b0) || [];
    const key = b0 * 4096 + b1;
    let out = nearCache.get(key);
    if (!out) {
      out = [];
      for (let b = b0; b <= b1; b++) { const a = bucketIndex.get(b); if (a) out.push(...a); }
      nearCache.set(key, out);
    }
    return out;
  };

  /* corridors: the whitespace band between consecutive expanded lines,
   * plus overscan bands above the first and below the last */
  const corridors: Array<Corridor | null> = [];
  const first = expandRect(lines[0]!, expand);
  corridors.push({ top: first.top - 10, bottom: first.top, above: -1, below: 0 });
  for (let i = 0; i < lines.length - 1; i++) {
    const a = expandRect(lines[i]!, expand);
    const b = expandRect(lines[i + 1]!, expand);
    corridors.push(b.top - a.bottom >= BAND_MIN
      ? { top: a.bottom, bottom: b.top, above: i, below: i + 1 } : null);
  }
  /* below the last line the page itself is the corridor — give it real
   * room (a cradle floor and a staggered shoulder must coexist there) */
  const last = expandRect(lines[lines.length - 1]!, expand);
  corridors.push({ top: last.bottom, bottom: last.bottom + 16, above: lines.length - 1, below: -1 });

  const lineIndexOf = (frag: RouteRect): number => {
    const cy = (frag.top + frag.bottom) / 2;
    let best = 0, bd = Infinity;
    lines.forEach((ln, i) => {
      const d = Math.abs((ln.top + ln.bottom) / 2 - cy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  /* a horizontal run at y over [xa,xb] must clear every expanded obstacle */
  const clearRun = (y: number, xa: number, xb: number): boolean =>
    !obstaclesNear(y).some((o) => y > o.top && y < o.bottom && Math.min(xa, xb) < o.right && Math.max(xa, xb) > o.left);

  /* The bottom strip of any measured box is where underlines legally live —
   * a run riding there IS the underline extended, exactly level with it.
   * Ink begins above the strip: only raw boxes that genuinely CROSS the
   * run's level (a heading, a drop cap, an intruding obstacle reaching
   * deeper than the strip) may veto underline-level travel. Expanded
   * clearance skirts are passed deliberately, under a raw-guarded envelope
   * exempt — this is what lets a contact come straight off its underline in
   * ONE level run instead of jogging below and back. */
  const rawInkAt = (x: number, y: number, raw: RouteRect): boolean => x > raw.left && x < raw.right &&
    y > raw.top - 0.75 && y < raw.bottom - UNDERLINE_STRIP;
  const rawBlocked = (y: number, xa: number, xb: number): boolean => obstaclesNear(y, 4).some((o) => o.raw &&
    y > o.raw.top - 0.75 && y < o.raw.bottom - UNDERLINE_STRIP &&
    Math.min(xa, xb) < o.raw.right && Math.max(xa, xb) > o.raw.left);

  /* pick a shoulder y inside corridor ci. The hard bounds — DROP_MIN room
   * toward the contact, SWOOP_DIP_MIN room below when the shoulder pours
   * through a port (a cradle floor has none, so it may settle low) — are a
   * precomputed legal WINDOW, and the ladder walks it centered, skipping
   * out-of-range rungs instead of burning them on rejections. A caller may
   * pass fits(y) for per-slot acceptance (e.g. the cradle's floor length):
   * a slot that fails retries 0.6px away instead of killing the plan.
   * Honors prior claims. */
  const corridorYFor = (
    ci: number,
    xa: number,
    xb: number,
    contactY: number | null,
    needsDip = true,
    fits: ((y: number) => true | string) | null = null,
  ): CorridorSlot | null => {
    const band = corridors[ci];
    if (!band) return null;
    const minY = Math.max(band.top + 0.25, contactY != null ? contactY + DROP_MIN : -Infinity);
    const maxY = needsDip ? band.bottom - 0.25 - SWOOP_DIP_MIN : band.bottom - 0.05;
    if (minY > maxY) return null;
    const base = (minY + maxY) / 2;
    const tried: string[] = [];
    const ladder = [0];
    /* the ladder spans the whole legal window: a caller's fits() may only
     * be satisfiable at its shallow or deep extreme (the squared cradle in
     * a tight gap needs the shallowest slot a tall corridor offers) */
    const reachEnd = Math.max(5.4, (maxY - minY) / 2 + 0.3);
    for (let step = 0.6; step <= reachEnd; step += 0.6) ladder.push(-step, step);
    for (const dy of ladder) {
      const y = base + dy;
      if (y < minY - 1e-6 || y > maxY + 1e-6) continue;
      const candidateClaim = makeCorridorClaim(ci, y, xa, xb, claimPad);
      let why: string | null = null;
      if (!candidateClaim) why = "claim-bounds";
      else if (!clearRun(y, xa, xb)) why = "obstacle";
      else if (claims.some((cl) => corridorClaimsConflict(cl, candidateClaim))) why = "claim";
      else if (fits) {
        const verdict = fits(y);
        if (verdict !== true) why = verdict || "fits";
      }
      if (!why && candidateClaim) return {
        y,
        dip: Math.min(SWOOP_DIP, Math.max(0, band.bottom - y - 0.25)),
        claim: candidateClaim,
      };
      if (why) tried.push(why);
    }
    if (opts.debug) {
      (opts.debug.corridors ??= []).push({
        ci,
        band: { top: +band.top.toFixed(1), bottom: +band.bottom.toFixed(1) },
        window: { minY: +minY.toFixed(1), maxY: +maxY.toFixed(1) },
        xa: +xa.toFixed(1),
        xb: +xb.toFixed(1),
        contactY: contactY == null ? undefined : +contactY.toFixed(1),
        tried,
      });
    }
    return null;
  };

  /* anchors → primary fragments, contacts on the margin-facing (left) edge */
  const sorted = [...ann.anchors].sort((a, b) => {
    const ta = Math.min(...a.fragments.map((f) => f.top));
    const tb = Math.min(...b.fragments.map((f) => f.top));
    return ta - tb || a.documentOrder - b.documentOrder;
  });
  if (!sorted.length || sorted.some((a) => !a.fragments.length)) return fail("no-fragments");
  const branchesIn: RouteBranch[] = sorted.map((a) => {
    const frag = [...a.fragments].sort((f, g) => f.top - g.top || f.left - g.left)[0]!;
    return { anchor: a, frag, li: lineIndexOf(frag) };
  });
  const annotationCenter = branchesIn.reduce((sum, branch) =>
    sum + (branch.frag.left + branch.frag.right) / 2, 0) / branchesIn.length;
  const pinOf = (frag: RouteRect, side: RouteSide = "left"): RoutePoint => ({
    x: side === "right" ? frag.right - 0.5 : frag.left + 0.5,
    y: frag.bottom + underlineDy,
  });
  const sectionRoutingConfig = typeof opts.sectionRouting === "object"
    ? opts.sectionRouting : undefined;
  const sectionRoutingEnabled = opts.sectionRouting === true || sectionRoutingConfig?.enabled === true
    ? true : opts.sectionRouting === false || sectionRoutingConfig?.enabled === false ? false : undefined;
  let sectionMeta = validateSectionMetadata(block, ann, sectionRoutingEnabled);
  if (sectionMeta.valid) {
    const mismatched = branchesIn.find((branch) => lines[branch.li]?.sectionId !== branch.anchor.sectionId);
    if (mismatched) {
      sectionMeta = { active: true, valid: false, reason: "anchor-line-section-mismatch", detail: { anchorId: mismatched.anchor.id } };
    }
  }
  if (sectionMeta.active && !sectionMeta.valid) {
    declined.push({ move: "section-routing", why: sectionMeta.reason, detail: sectionMeta.detail });
  }

  /* ── loom datum ──
   * The loom is a passage-level datum: one inner edge computed from EVERY
   * obstacle in the block (the widest intrusion wins), never per
   * annotation — two annotations on strand k must land on the same x.
   * The host may pin it explicitly via opts.loomX. Strand CHOICE is the
   * engine's (see the margin route); cradles and local rails need no
   * strand, so a starved margin no longer starves them. */
  let minLeft = Infinity, maxRight = -Infinity;
  for (const o of obstacles) {
    minLeft = Math.min(minLeft, o.left);
    maxRight = Math.max(maxRight, o.right);
  }
  if (!isFinite(minLeft)) minLeft = block.bounds.left + 40;
  if (!isFinite(maxRight)) maxRight = block.bounds.right - 40;
  const leftLoomInner = opts.leftLoomX ?? opts.loomX ?? (minLeft - loomAir);
  const rightLoomInner = opts.rightLoomX ?? (maxRight + loomAir);
  /* Local rails and the gated middle-shaft predate the second datum. Keep
   * their left datum exactly stable; only the whole-trace margin generator
   * is bidirectional in this gate. */
  const loomInner = leftLoomInner;

  /* ── same-line cradle (two anchors, one rendered line) ──
   * Three regimes decide how the hammock takes hold:
   *   FACING (pins on the facing ends, floor under the gap) is the default
   *   — the drawing narrates the link in reading order.
   *   EMBRACE (pins on the outer ends, floor under the pair) takes over
   *   when the gap is too tight for two terminal turns, and is preferred
   *   for short closed single-word pairs (Day/Night), where inside pins
   *   would crowd the punctuation and enclosure is the truer drawing.
   * Embrace requires both anchors closed — a wrap edge is not a phrase
   * end. The floor-length test lives INSIDE the slot ladder, so a slot
   * whose radii would invert or starve the floor retries shallower
   * instead of aborting the cradle. */
  const allSameLine = branchesIn.every((b) => b.li === branchesIn[0]!.li);
  if (allSameLine && branchesIn.length === 2 && opts.disableCradle) {
    declined.push({ move: "cradle", why: "disabled" });
  }
  if (allSameLine && branchesIn.length === 2 && !opts.disableCradle) {
    const pair = [...branchesIn].sort((a, b) => a.frag.left - b.frag.left);
    const A = pair[0]!;
    const B = pair[1]!;
    const ci = A.li + 1;
    const gap = B.frag.left - A.frag.right;
    const span = B.frag.right - A.frag.left;
    const wA = A.frag.right - A.frag.left, wB = B.frag.right - B.frag.left;
    const closed = (b: RouteBranch): boolean => b.anchor.fragments.length === 1;
    const embraceEligible = closed(A) && closed(B) && span <= 7 * fontSize;
    const facing: CradleCandidate = {
      variant: "facing",
      ax: A.frag.right - 0.5, ay: A.frag.bottom + underlineDy,
      bx: B.frag.left + 0.5, by: B.frag.bottom + underlineDy,
    };
    const embrace: CradleCandidate = {
      variant: "embrace",
      ax: A.frag.left + 0.5, ay: A.frag.bottom + underlineDy,
      bx: B.frag.right - 0.5, by: B.frag.bottom + underlineDy,
    };
    const shortPair = embraceEligible && wA <= 2.5 * fontSize && wB <= 2.5 * fontSize && gap <= 2 * fontSize;
    const candidates = shortPair
      ? [embrace, facing]
      : gap >= GAP_FACING_MIN
        ? (embraceEligible && gap <= GAP_EMBRACE_MAX ? [facing, embrace] : [facing])
        : embraceEligible ? [embrace] : [];
    if (!candidates.length) declined.push({ move: "cradle", why: "gap-too-tight" });
    /* one sizing rule shared by the slot ladder and the build, so a slot
     * that fits is exactly a slot that draws */
    const cradleFit = (c: CradleCandidate, y: number): CradleFit | null => {
      const avail = c.bx - c.ax;
      const dA = y - c.ay, dB = y - c.by;
      if (dA < DROP_MIN || dB < DROP_MIN) return null;
      const lead = Math.min(CONTACT_LEAD, Math.max(CONTACT_LEAD_MIN, avail * 0.16));
      /* swept 2026-07-30: the hammock's turns share the SWEEP token, still
       * capped by half the available drop so shallow slots stay shallow */
      const rA = Math.min(SWEEP, dA / 2);
      const rB = Math.min(SWEEP, dB / 2);
      const aFloor = c.ax + lead + 2 * rA;
      const bFloor = c.bx - lead - 2 * rB;
      if (bFloor - aFloor < FLOOR_MIN) return null;
      return { lead, rA, rB, aFloor, bFloor };
    };
    for (const c of candidates) {
      /* the cradle has no port — it may settle low in the band */
      const slot = corridorYFor(ci, c.ax, c.bx, Math.max(c.ay, c.by), false, (y) =>
        cradleFit(c, y) ? true : "floor");
      if (!slot) { declined.push({ move: `cradle:${c.variant}`, why: "no-corridor-slot" }); continue; }
      const fy = slot.y;
      const fit = cradleFit(c, fy);
      if (!fit) continue;
      /* the squared hammock, all soft right angles: level lead off pin A,
       * corner down, wall, corner onto one genuinely flat floor, then the
       * exact mirror rising level into pin B */
      const exA: TerminalExemption[] = [
        { rect: expandRect(A.frag, expand), cx: c.ax, cy: c.ay },
        { rect: { left: c.ax - 0.5, right: fit.aFloor + 0.5, top: c.ay - 0.75, bottom: fy + 0.75 },
          cx: c.ax, cy: c.ay, guardRaw: true },
      ];
      const exB: TerminalExemption[] = [
        { rect: expandRect(B.frag, expand), cx: c.bx, cy: c.by },
        { rect: { left: fit.bFloor - 0.5, right: c.bx + 0.5, top: c.by - 0.75, bottom: fy + 0.75 },
          cx: c.bx, cy: c.by, guardRaw: true },
      ];
      const wallAX = c.ax + fit.lead + fit.rA;
      const wallBX = c.bx - fit.lead - fit.rB;
      const segs: RouteSegment[] = [];
      const segEx: SegmentExemption[] = [];
      const put = (seg: RouteSegment, ex: SegmentExemption): void => {
        segs.push(seg);
        segEx.push(ex);
      };
      put(L(c.ax, c.ay, c.ax + fit.lead, c.ay), exA);
      put(quarterHV(c.ax + fit.lead, c.ay, wallAX, c.ay + fit.rA), exA);
      if (fy - fit.rA - (c.ay + fit.rA) > 0.05) {
        put(L(wallAX, c.ay + fit.rA, wallAX, fy - fit.rA), exA);
      }
      put(quarterVH(wallAX, fy - fit.rA, fit.aFloor, fy), exA);
      put(L(fit.aFloor, fy, fit.bFloor, fy), null);
      put(quarterHV(fit.bFloor, fy, wallBX, fy - fit.rB), exB);
      if (fy - fit.rB - (c.by + fit.rB) > 0.05) {
        put(L(wallBX, fy - fit.rB, wallBX, c.by + fit.rB), exB);
      }
      put(quarterVH(wallBX, c.by + fit.rB, c.bx - fit.lead, c.by), exB);
      put(L(c.bx - fit.lead, c.by, c.bx, c.by), exB);
      return finalize(segs, "same-line",
        [{ x: c.ax, y: c.ay }, { x: c.bx, y: c.by }],
        [fy], [ci], null, null, [], c.variant, segEx, [slot.claim]);
    }
    /* no legal cradle → fall through to the margin, never squash */
  }

  /* ── local rail (single-line ideas stay beside their line) ──
   * A one-word tag dragging its line across the page to the loom for a
   * 2.5px drip is the worst ink in the grammar. When every anchor shares
   * one rendered line and the cradle declined, the whole route stays
   * beside the idea: one colinear level run straight off the underline
   * through every dot, one soft right-angle corner down, one short drip.
   * Candidates step outward from the phrase and never enter the loom's
   * own air. Falls through to the margin, never squashes. */
  if (allSameLine && !opts.disableLocal) {
    const members = [...branchesIn].sort((a, b) => a.frag.left - b.frag.left);
    const li = members[0]!.li, ci = li + 1;
    const localContacts = members.map((m) => pinOf(m.frag));
    const innerPinX = Math.max(...localContacts.map((c) => c.x));
    const outerPinX = Math.min(...localContacts.map((c) => c.x));
    const cy = Math.max(...localContacts.map((c) => c.y));
    const band = corridors[ci];
    const off = CORNER + 10;
    let planned: ValidRoutePlan | null = null;
    if (band) for (const localX of [outerPinX - off, outerPinX - off - 6, outerPinX - off - 12]) {
      if (localX < loomInner + 6) continue;
      if (rawBlocked(cy, localX + 0.5, innerPinX)) break;
      /* the whole route is one straight line off the underline — it ENDS,
       * with no corner or drip, exactly like a single-group margin route */
      const levelClaim = makeCorridorClaim(ci, cy, localX, innerPinX, claimPad);
      if (!levelClaim || claims.some((cl) => corridorClaimsConflict(cl, levelClaim))) {
        continue;
      }
      const ex: TerminalExemption[] = [
        ...members.map((m, i) => ({
          rect: expandRect(m.frag, expand),
          cx: localContacts[i]!.x,
          cy: localContacts[i]!.y,
        })),
        { rect: { left: localX - 0.5, right: innerPinX + 0.5, top: cy - 0.75, bottom: cy + 0.75 },
          cx: innerPinX, cy, guardRaw: true },
      ];
      /* the run breaks at every dot so each contact is a true vertex */
      const segs: RouteSegment[] = [];
      const stops = [...new Set(localContacts.map((c) => c.x))].sort((a, b) => b - a);
      let atX = stops[0]!;
      for (const stop of stops.slice(1)) {
        segs.push(L(atX, cy, stop, cy));
        atX = stop;
      }
      segs.push(L(atX, cy, localX, cy));
      const plan = finalize(segs, members.length === 1 ? "local-tag" : "local-comb",
        localContacts, [cy], [ci], localX, null, [{ x: localX, y: cy }], undefined,
        segs.map(() => ex), [levelClaim]);
      if (plan.valid) {
        plan.diagnostics.exits = ["level"];
        planned = plan;
        break;
      }
      /* finalize rejected this rail (collision) — step further out */
    }
    if (planned) return planned;
    declined.push({ move: "local", why: "no-slot" });
  }

  /* ── margin route ──
   * group anchors per rendered line; each group gets one corridor
   * shoulder; every shoulder swoops into the strand. Strand choice is
   * claims-driven and engine-owned: focused takes strand 0; companions
   * take the lowest strand whose committed spine intervals (±6px slack)
   * don't overlap this annotation, escalating only on failure. A dormant
   * scorer sits between the generators and the return — with one side it
   * picks the only candidate, but side choice arrives continuous. */
  const groups: MarginGroup[] = [];
  for (const b of branchesIn) {
    const g = groups.find((x) => x.li === b.li);
    if (g) g.members.push(b);
    else groups.push({ li: b.li, members: [b] } as MarginGroup);
  }
  for (const g of groups) {
    g.members.sort((a, b) => a.frag.left - b.frag.left);
    g.contacts = g.members.map((m) => pinOf(m.frag));
    g.xMax = Math.max(...g.contacts.map((c) => c.x)) + 1;
    g.cy = Math.max(...g.contacts.map((c) => c.y));
  }
  const mode = ann.anchors.length === 1 ? "tag"
    : groups.length > 1 ? (ann.anchors.length > 2 || groups.length > 2 ? "multipoint" : "corridor")
    : "corridor";

  if (sectionMeta.valid) {
    for (const group of groups) group.sectionId = group.members[0]!.anchor.sectionId;
  }

  /* ── middle shaft (the one gated constraint amendment) ──
   * For the FOCUSED thread only, when its anchors sit within three
   * rendered lines of each other, a short interior vertical may stand in
   * genuine whitespace beside the ideas — near their semantic center —
   * instead of traveling to the margin. Crossing a line's ink extent is
   * ILLEGAL, not merely expensive: the shaft must clear every crossed
   * line entirely, so it fires in ragged-right voids and verse-end
   * shortfalls, never through justified prose. Pins face the shaft
   * (per-group approach side); same grammar, mirrored where needed. */
  if (opts.allowMiddle && groups.length >= 2 && !sectionMeta.valid) {
    const liTop = Math.min(...groups.map((g) => g.li));
    const liBottom = Math.max(...groups.map((g) => g.li));
    if (liBottom - liTop > 3) {
      declined.push({ move: "middle", why: "span" });
    } else {
      for (const g of groups) {
        g.left = Math.min(...g.members.map((m) => m.frag.left));
        g.right = Math.max(...g.members.map((m) => m.frag.right));
      }
      const centers = branchesIn.map((b) => (b.frag.left + b.frag.right) / 2);
      const semCenter = centers.reduce((s, v) => s + v, 0) / centers.length;
      const shaftCandidates = [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30, 36, -36]
        .map((d) => semCenter + d)
        .filter((x) => x > loomInner + 20 && x < block.bounds.right - 6);
      const crossed = lines.slice(liTop + 1, liBottom + 1);
      let shaftPlan: ValidRoutePlan | null = null;
      for (const shaftX of shaftCandidates) {
        /* hard zero-crossing: the shaft clears every crossed line's ink */
        if (crossed.some((l) => shaftX > l.left - expand - 1 && shaftX < l.right + expand + 1)) continue;
        /* per-group approach side: every pin must face the shaft cleanly */
        const middleSides: Array<RouteSide | null> = groups.map((g) =>
          shaftX >= g.right + DROP_MIN + 2 ? "right" : shaftX <= g.left - DROP_MIN - 2 ? "left" : null);
        if (middleSides.some((side) => !side)) continue;

        const gs: MiddleMarginGroup[] = groups.map((g, i) => ({
          ...g,
          side: middleSides[i]!,
        }));
        const segsM: RouteSegment[] = [];
        const exemptsM: SegmentExemption[] = [];
        const contactsM: RoutePoint[] = [];
        const portsM: RoutePoint[] = [];
        const corYs: number[] = [];
        const corIdx: number[] = [];
        const corClaims: RouteCorridorClaim[] = [];
        let ok = true;
        for (const g of gs) {
          const ci = g.li + 1;
          const pins: MiddlePin[] = g.members.map((m) => {
            const f = m.frag;
            return { m, x: (g.side === "right" ? f.right - 0.5 : f.left + 0.5), y: f.bottom + underlineDy };
          });
          const xs = pins.map((p) => p.x);
          const spanA = Math.min(shaftX, ...xs) - 1, spanB = Math.max(shaftX, ...xs) + 1;
          const cy = Math.max(...pins.map((p) => p.y));
          const slot = corridorYFor(ci, spanA, spanB, cy);
          if (!slot) { ok = false; break; }
          const y = slot.y;
          const dir = g.side === "right" ? 1 : -1;
          let nearLand = g.side === "right" ? -Infinity : Infinity;
          let farLand = g.side === "right" ? Infinity : -Infinity;
          for (const p of (g.side === "right" ? [...pins].sort((a, b) => a.x - b.x) : [...pins].sort((a, b) => b.x - a.x))) {
            const t = contactTerminal(p, dir, y, (shaftX - p.x) * dir - 6);
            if (!t) { ok = false; break; }
            contactsM.push({ x: p.x, y: p.y });
            const ex: TerminalExemption[] = [
              { rect: expandRect(p.m.frag, expand), cx: p.x, cy: p.y },
              { rect: t.envelope, cx: p.x, cy: p.y, guardRaw: true },
            ];
            segsM.push(t.segs[0], t.segs[1]);
            exemptsM.push(ex, ex);
            nearLand = g.side === "right" ? Math.max(nearLand, t.landX) : Math.min(nearLand, t.landX);
            farLand = g.side === "right" ? Math.min(farLand, t.landX) : Math.max(farLand, t.landX);
          }
          if (!ok) break;
          const gapToShaft = (shaftX - nearLand) * dir;
          const reach = Math.min(SWOOP_REACH, Math.max(4, gapToShaft * 0.5));
          if (gapToShaft <= reach + 1.5) { ok = false; break; }
          const approachX = g.side === "right" ? shaftX - reach : shaftX + reach;
          segsM.push(L(farLand, y, approachX, y)); exemptsM.push(null);
          segsM.push(quarterHV(approachX, y, shaftX, y + slot.dip)); exemptsM.push(null);
          portsM.push({ x: shaftX, y: y + slot.dip });
          corYs.push(y); corIdx.push(ci); corClaims.push(slot.claim);
        }
        if (!ok) continue;
        const top = Math.min(...portsM.map((p) => p.y));
        const bot = Math.max(...portsM.map((p) => p.y));
        segsM.push(L(shaftX, top, shaftX, bot)); exemptsM.push(null);
        const spineM = { x: shaftX, top, bottom: bot };
        const plan = finalize(segsM, "middle-shaft", contactsM, corYs, corIdx, shaftX, spineM, portsM, undefined, exemptsM, corClaims);
        if (plan.valid) {
          plan.spineClaimOut = { x: shaftX, top, bottom: bot };
          shaftPlan = plan;
          break;
        }
      }
      if (shaftPlan) return shaftPlan;
      declined.push({ move: "middle", why: "no-clear-shaft" });
    }
  }

  const genMargin = (
    side: RouteSide,
    strand: number,
    marginGroups: MarginGroup[] = groups,
    sectionContext: { sectionId: string; final: boolean } | null = null,
  ): MarginRoutePlan | FailedRoutePlan => {
    const right = side === "right";
    const outward = right ? 1 : -1;
    const textward = -outward;
    const loom = right ? rightLoomInner : leftLoomInner;
    const strandX = right ? loom + strand * strandPitch : loom - strand * strandPitch;
    if (right) {
      if (strandX < maxRight + loomAir - 1e-6) return { valid: false, reason: "needs-space" };
      if (strandX > block.bounds.right + (block.availableRightMargin ?? 60)) return { valid: false, reason: "needs-space" };
      if (strandX > block.bounds.right - 4) return { valid: false, reason: "needs-space" };
    } else {
      if (strandX > minLeft - loomAir + 1e-6) return { valid: false, reason: "needs-space" };
      if (strandX < block.bounds.left - (block.availableLeftMargin ?? 60)) return { valid: false, reason: "needs-space" };
      if (strandX < block.bounds.left + 4) return { valid: false, reason: "needs-space" };
    }

    const gs = marginGroups.map((g) => ({ ...g })) as PreparedMarginGroup[];
    /* The whole bracket: every group is ONE colinear level run straight off
     * its underline plus ONE soft right-angle corner at the rail. The
     * route's bottommost group turns UP into the rail; every other group
     * turns down with the flow. Nothing in this grammar runs parallel to an
     * underline at an offset, settles, dips, or loops below a phrase. */
    let returnG: PreparedMarginGroup | null = null;
    if (sectionContext ? sectionContext.final : gs.length > 1) {
      for (const g of gs) if (!returnG || g.cy > returnG.cy) returnG = g;
    }
    for (const g of gs) {
      /* Underline-level travel is vetoed only by RAW ink — expanded
       * clearance skirts pass under the raw-guarded envelope. A vetoed run
       * holds honestly instead of dodging into the corridor. */
      const pins = g.members.map((m) => pinOf(m.frag, side));
      const runY = Math.max(...pins.map((p) => p.y));
      const innerPinX = right ? Math.min(...pins.map((p) => p.x)) : Math.max(...pins.map((p) => p.x));
      const outerPinX = right ? Math.max(...pins.map((p) => p.x)) : Math.min(...pins.map((p) => p.x));
      const runGap = (outerPinX - strandX) * textward;
      if (runGap < 7 || rawBlocked(runY, strandX + textward * 0.5, innerPinX)) {
        return { valid: false, reason: "needs-space" };
      }
      const claim = makeCorridorClaim(g.li + 1, runY, strandX, innerPinX, claimPad);
      if (!claim || claims.some((cl) => corridorClaimsConflict(cl, claim))) {
        return { valid: false, reason: "needs-space" };
      }
      g.pins = pins;
      g.runY = runY;
      g.innerPinX = innerPinX;
      /* swept 2026-07-30: the rail turn takes the SWEEP token (was CORNER).
       * The runGap cap keeps a cramped rail honest, and the adjacent-corner
       * cap below still halves it wherever two turns would meet. */
      g.r = Math.min(SWEEP, Math.max(2.5, runGap - 1));
      g.up = g === returnG;
      g.claim = claim;
    }
    gs.sort((a, b) => a.runY - b.runY);
    /* one corner radius per route, capped so adjacent corners never meet on
     * the rail — a short rail must still visibly reach both runs */
    for (let i = 1; i < gs.length; i++) {
      const cap = Math.max(2.5, (gs[i]!.runY - gs[i - 1]!.runY) / 2 - 1);
      for (const g of gs) g.r = Math.min(g.r, cap);
    }

    /* ── the bow (added 2026-07-30, the connection-lines revival) ──
     * Exactly two single-line groups within bow span: the rail contracts to
     * a point and the drawing becomes one S. Each run leaves its underline
     * colinearly, travels level to the rail datum, and ONE cubic with
     * horizontal end-tangents sweeps down through a vertical apex pinned
     * BOW apex px beyond the rail — entirely in proven margin air, outside
     * every obstacle the rail itself already cleared. Tangent-clean at both
     * junctions; the only free parameter is the apex depth, one-third of
     * the drop inside [BOW_APEX_MIN, BOW_APEX_MAX]. Falls through to the
     * swept bracket whenever its span or its air is not honestly there. */
    if (!sectionContext && gs.length === 2) {
      const gTop = gs[0]!;
      const gBottom = gs[1]!;
      const drop = gBottom.runY - gTop.runY;
      const apex = Math.max(BOW_APEX_MIN, Math.min(BOW_APEX_MAX, drop / 3));
      const apexX = strandX + outward * apex;
      const apexLegal = right
        ? apexX <= Math.min(block.bounds.right - 2,
          block.bounds.right + (block.availableRightMargin ?? 60) - 2)
        : apexX >= Math.max(block.bounds.left + 2,
          block.bounds.left - (block.availableLeftMargin ?? 60) + 2);
      if (drop >= BOW_SPAN_MIN && drop <= BOW_SPAN_MAX && apexLegal
        && !spineClaims.some((claim) => Number.isFinite(claim?.x) &&
          Math.abs(claim.x - apexX) < SPINE_SEP &&
          Math.min(claim.top, claim.bottom) - 2.6 < gBottom.runY &&
          gTop.runY < Math.max(claim.top, claim.bottom) + 2.6)) {
        const contacts: RoutePoint[] = [];
        const contactOwners: Array<{ anchorId: string }> = [];
        const centerline: RouteSegment[] = [];
        const exempts: SegmentExemption[] = [];
        const groupEx = (g: PreparedMarginGroup): TerminalExemption[] => [
          ...g.members.map((m, i) => ({
            rect: expandRect(m.frag, expand),
            cx: g.pins[i]!.x,
            cy: g.pins[i]!.y,
          })),
          { rect: { left: Math.min(strandX, g.innerPinX) - 0.5,
            right: Math.max(strandX, g.innerPinX) + 0.5,
            top: g.runY - 0.75, bottom: g.runY + 0.75 },
            cx: g.innerPinX, cy: g.runY, guardRaw: true },
        ];
        const pushRun = (g: PreparedMarginGroup, toRail: boolean): void => {
          const ordered = [...g.members].sort((a, b) =>
            right ? b.frag.right - a.frag.right : a.frag.left - b.frag.left);
          for (const m of ordered) {
            contacts.push(pinOf(m.frag, side));
            contactOwners.push({ anchorId: m.anchor.id });
          }
          const ex = groupEx(g);
          const stops = [...new Set(g.pins.map((p) => p.x))]
            .filter((x) => (x - strandX) * textward > 0.01)
            .sort((a, b) => right ? a - b : b - a);
          const orderedStops = toRail ? stops : [...stops].reverse();
          if (toRail) {
            let atX = orderedStops[0]!;
            for (const stop of orderedStops.slice(1)) {
              centerline.push(L(atX, g.runY, stop, g.runY));
              exempts.push(ex);
              atX = stop;
            }
            centerline.push(L(atX, g.runY, strandX, g.runY));
            exempts.push(ex);
          } else {
            let atX = strandX;
            for (const stop of orderedStops) {
              centerline.push(L(atX, g.runY, stop, g.runY));
              exempts.push(ex);
              atX = stop;
            }
          }
        };
        pushRun(gTop, true);
        const reach = apex * (4 / 3);
        centerline.push(C(
          strandX, gTop.runY,
          strandX + outward * reach, gTop.runY,
          strandX + outward * reach, gBottom.runY,
          strandX, gBottom.runY,
        ));
        /* the bow rides at and beyond the rail — genuinely clear, no
         * privileges — but its first and last samples sit inside the run
         * envelopes it departs from, so it carries both */
        exempts.push([...groupEx(gTop), ...groupEx(gBottom)]);
        pushRun(gBottom, false);
        const spine: RouteSpine = { x: apexX, top: gTop.runY, bottom: gBottom.runY };
        const bowPorts: RoutePoint[] = [
          { x: strandX, y: gTop.runY },
          { x: strandX, y: gBottom.runY },
        ];
        const plan = finalize(centerline, "bow", contacts,
          [gTop.runY, gBottom.runY], [gTop.li + 1, gBottom.li + 1],
          strandX, spine, bowPorts, undefined, exempts,
          [gTop.claim, gBottom.claim]);
        if (plan.valid) {
          plan.strand = strand;
          plan.side = side;
          plan.diagnostics.laneIndex = strand;
          plan.diagnostics.side = side;
          plan.diagnostics.exits = gs.map(() => "level");
          plan.rawLength = segmentsLength(centerline);
          plan.semCenter = annotationCenter;
          plan.spineClaimOut = { x: apexX, top: gTop.runY, bottom: gBottom.runY };
          plan.strandClaimOut = { side, strand, top: gTop.runY, bottom: gBottom.runY };
          return plan as MarginRoutePlan;
        }
        /* an illegal bow is not a refusal — the swept bracket still stands */
      }
    }

    const contacts: RoutePoint[] = [];
    const contactOwners: Array<{ anchorId: string }> = [];
    const centerline: RouteSegment[] = [];
    const exempts: SegmentExemption[] = [];  // parallel to centerline: terminal-only ink privileges
    const ports: RoutePoint[] = [];
    const corridorYs: number[] = [];
    const corridorIdx: number[] = [];
    const corridorClaimsOut: RouteCorridorClaim[] = [];

    /* When the whole route is one group, the whole route is one straight
     * line: it comes off the underline and simply ENDS at the rail datum.
     * A corner exists only where the rail genuinely connects two runs. */
    const single = !sectionContext && gs.length === 1;
    for (const g of gs) {
      /* dots in drawing order, then ONE run through all of them — and one
       * soft corner only when a rail continues past it */
      const ordered = [...g.members].sort((a, b) =>
        right ? b.frag.right - a.frag.right : a.frag.left - b.frag.left);
      for (const m of ordered) {
        contacts.push(pinOf(m.frag, side));
        contactOwners.push({ anchorId: m.anchor.id });
      }
      const ex: TerminalExemption[] = [
        ...g.members.map((m, i) => ({
          rect: expandRect(m.frag, expand),
          cx: g.pins[i]!.x,
          cy: g.pins[i]!.y,
        })),
        /* the run's envelope: colinear with the underline, raw-guarded */
        { rect: { left: Math.min(strandX, g.innerPinX) - 0.5, right: Math.max(strandX, g.innerPinX) + 0.5,
            top: g.runY - 0.75, bottom: g.runY + 0.75 },
          cx: g.innerPinX, cy: g.runY, guardRaw: true },
      ];
      /* the run breaks at every dot so each contact is a true vertex —
       * identical ink, honest anchoring */
      const runEndX = single ? strandX : strandX + textward * g.r;
      const stops = [...new Set(g.pins.map((p) => p.x))]
        .filter((x) => (x - runEndX) * textward > 0.01)
        .sort((a, b) => right ? a - b : b - a);
      let atX = stops[0]!;
      for (const stop of stops.slice(1)) {
        centerline.push(L(atX, g.runY, stop, g.runY));
        exempts.push(ex);
        atX = stop;
      }
      centerline.push(L(atX, g.runY, runEndX, g.runY));
      exempts.push(ex);
      if (single) {
        ports.push({ x: strandX, y: g.runY });
      } else {
        centerline.push(quarterHV(runEndX, g.runY, strandX, g.runY + (g.up ? -g.r : g.r)));
        exempts.push(ex);
        ports.push({ x: strandX, y: g.runY + (g.up ? -g.r : g.r) });
      }
      corridorYs.push(g.runY);
      corridorIdx.push(g.li + 1);
      corridorClaimsOut.push(g.claim);
    }

    /* spine: one vertical from first port to last port, never overshooting.
     * Section states deliberately stop at their ports; the topology
     * materializer owns the maximal plural spine and any gap handoff. */
    let spine: RouteSpine | null = null;
    if (!sectionContext && ports.length > 1) {
      const top = Math.min(...ports.map((p) => p.y));
      const bot = Math.max(...ports.map((p) => p.y));
      centerline.push(L(strandX, top, strandX, bot));
      exempts.push(null);
      spine = { x: strandX, top, bottom: bot };
    }

    const plan = finalize(centerline, mode, contacts, corridorYs, corridorIdx, strandX, spine, ports, undefined, exempts, corridorClaimsOut);
    if (!plan.valid) return plan;
    plan.strand = strand;
    plan.side = side;
    plan.diagnostics.laneIndex = strand;
    plan.diagnostics.side = side;
    plan.diagnostics.exits = gs.map(() => "level");
    plan.rawLength = segmentsLength(centerline);
    plan.semCenter = annotationCenter;
    plan.strandClaimOut = spine
      ? { side, strand, top: spine.top, bottom: spine.bottom }
      : null;
    if (sectionContext) {
      plan.sectionId = sectionContext.sectionId;
      plan._exempts = exempts;
      plan._contactOwners = contactOwners;
    }
    return plan as MarginRoutePlan;
  };

  const buildSectionTopology = (sectionSides: RouteSide[]): RoutePlan | null => {
    if (!sectionMeta.valid) return null;
    const diagnostics: SectionSolverDiagnostics = {
      sectionCount: sectionMeta.sections.length,
      maxStatesPerSection: sectionSides.length * MAX_SECTION_STRANDS,
      statesEvaluated: 0,
      transitionsEvaluated: 0,
      handoffsEvaluated: 0,
      scoreDefinition: "complete-tenth-raw-v5",
      scoreAccumulator: "number-forward-document-order",
      scoreQuantization: "complete-total-only",
      predecessorStorage: "handoff-count-backpointer",
      maxFrontierSize: 0,
    };
    const previousRaw = opts.previousTopology?.sectionSides ?? opts.previousSectionSides ??
      sectionRoutingConfig?.previousSides ?? [];
    const previousSides = new Map<string, RouteSide>();
    if (previousRaw instanceof Map) {
      for (const [sectionId, side] of previousRaw) previousSides.set(sectionId, side);
    } else if (Array.isArray(previousRaw)) {
      for (const item of previousRaw) if (item?.sectionId) previousSides.set(item.sectionId, item.side);
    } else if (previousRaw && typeof previousRaw === "object") {
      for (const [sectionId, side] of Object.entries(previousRaw)) previousSides.set(sectionId, side);
    }
    const handoffClaims = Array.isArray(opts.handoffClaims) ? opts.handoffClaims : [];
    const statesBySection: SectionState[][] = [];
    const failures: SectionStateFailure[] = [];
    const interval = (a: number, b: number): { top: number; bottom: number } =>
      ({ top: Math.min(a, b), bottom: Math.max(a, b) });
    const spineIntervalClaimed = (x: number, topIn: number, bottomIn: number): boolean => {
      const span = interval(topIn, bottomIn);
      return spineClaims.some((claim) => Number.isFinite(claim?.x) &&
        Number.isFinite(claim?.top) && Number.isFinite(claim?.bottom) &&
        Math.abs(claim.x - x) < SPINE_SEP &&
        Math.min(claim.top, claim.bottom) - 2.6 < span.bottom &&
        span.top < Math.max(claim.top, claim.bottom) + 2.6);
    };
    const strandIntervalClaimed = (
      side: RouteSide,
      strand: number,
      topIn: number,
      bottomIn: number,
    ): boolean => {
      const span = interval(topIn, bottomIn);
      return strandClaims.some((claim) => claim?.side === side && claim?.strand === strand &&
        Number.isFinite(claim?.top) && Number.isFinite(claim?.bottom) &&
        Math.min(claim.top, claim.bottom) < span.bottom + 6 &&
        span.top < Math.max(claim.top, claim.bottom) + 6);
    };
    const runIntervalClear = (state: SectionState, top: number, bottom: number): boolean =>
      !spineIntervalClaimed(state.x, top, bottom) &&
      !strandIntervalClaimed(state.side, state.strand, top, bottom);

    for (let sectionOrder = 0; sectionOrder < sectionMeta.sections.length; sectionOrder++) {
      const section = sectionMeta.sections[sectionOrder]!;
      const sectionGroups = groups.filter((group) => group.sectionId === section.id);
      const sectionBranches = branchesIn.filter((branch) => branch.anchor.sectionId === section.id);
      const sectionLines = lines.filter((line) => line.sectionId === section.id);
      const sectionTextCenter = (Math.min(...sectionLines.map((line) => line.left)) +
        Math.max(...sectionLines.map((line) => line.right))) / 2;
      const semanticCenter = sectionBranches.reduce((sum, branch) =>
        sum + (branch.frag.left + branch.frag.right) / 2, 0) / sectionBranches.length;
      const sectionStates: SectionState[] = [];
      for (let sideRank = 0; sideRank < sectionSides.length; sideRank++) {
        const side = sectionSides[sideRank]!;
        for (let strand = 0; strand < MAX_SECTION_STRANDS; strand++) {
          diagnostics.statesEvaluated = (diagnostics.statesEvaluated ?? 0) + 1;
          const candidatePlan = genMargin(side, strand, sectionGroups, {
            sectionId: section.id,
            final: sectionOrder === sectionMeta.sections.length - 1,
          });
          if (!candidatePlan.valid) {
            failures.push({ sectionId: section.id, side, strand, why: candidatePlan.reason });
            continue;
          }
          if (!candidatePlan.ports.length) {
            failures.push({ sectionId: section.id, side, strand, why: "no-port" });
            continue;
          }
          const plan = candidatePlan as SectionMarginPlan;
          const x = plan.marginRailX;
          const minPortY = Math.min(...plan.ports.map((port) => port.y));
          const maxPortY = Math.max(...plan.ports.map((port) => port.y));
          if (spineIntervalClaimed(x, minPortY, maxPortY)) {
            failures.push({ sectionId: section.id, side, strand, why: "spine-claim" });
            continue;
          }
          if (strandIntervalClaimed(side, strand, minPortY, maxPortY)) {
            failures.push({ sectionId: section.id, side, strand, why: "strand-claim" });
            continue;
          }
          const wrongSide = side === "left"
            ? Math.max(0, semanticCenter - sectionTextCenter) * 0.035
            : Math.max(0, sectionTextCenter - semanticCenter) * 0.035;
          const hysteresis = previousSides.has(section.id) && previousSides.get(section.id) !== side
            ? SECTION_HYSTERESIS : 0;
          sectionStates.push({
            section, sectionOrder, side, sideRank, strand, x, plan, minPortY, maxPortY,
            baseCost: plan.rawLength + (maxPortY - minPortY) + wrongSide + hysteresis,
          });
        }
      }
      if (!sectionStates.length) return { valid: false, reason: "needs-space", diagnostics, failures };
      statesBySection.push(sectionStates);
    }

    const makeHandoff = (from: SectionState, to: SectionState): SectionHandoff | null => {
      diagnostics.handoffsEvaluated = (diagnostics.handoffsEvaluated ?? 0) + 1;
      const gap = sectionMeta.gapByPair.get(sectionPairKey(from.section.id, to.section.id));
      if (!gap) return null;
      /* Attach only at the source run's bottom and destination run's top.
       * If a branch port reaches into the declared whitespace, the handoff
       * begins there — never above it with a dangling spine tail. */
      const top = Math.max(gap.top + HANDOFF_EDGE_INSET, from.maxPortY);
      const bottom = Math.min(gap.bottom - HANDOFF_EDGE_INSET, to.minPortY);
      if (bottom - top < HANDOFF_MIN_SPAN || from.x < gap.left || from.x > gap.right ||
          to.x < gap.left || to.x > gap.right) return null;
      if (!runIntervalClear(from, from.maxPortY, top) ||
          !runIntervalClear(to, bottom, to.minPortY)) return null;
      /* "S" names the topology, not a glyph. The crossing is two compact
       * rounded edge turns around one genuinely horizontal run centered in
       * the declared clear gap — never a page-wide diagonal cubic. The
       * corner token shrinks only for measured room. */
      const dy = bottom - top;
      const dx = to.x - from.x;
      const dir = dx >= 0 ? 1 : -1;
      const r = Math.min(CORNER, dy / 2, Math.abs(dx) / 2);
      if (!(r > 0.5)) return null;
      const yRun = top + dy / 2;
      const segments: RouteSegment[] = [];
      if (yRun - r - top > 0.05) segments.push(L(from.x, top, from.x, yRun - r));
      segments.push(quarterVH(from.x, yRun - r, from.x + dir * r, yRun));
      if (Math.abs(dx) - 2 * r > 0.05) {
        segments.push(L(from.x + dir * r, yRun, to.x - dir * r, yRun));
      }
      segments.push(quarterHV(to.x - dir * r, yRun, to.x, yRun + r));
      if (bottom - (yRun + r) > 0.05) segments.push(L(to.x, yRun + r, to.x, bottom));
      for (const segment of segments) {
        for (const point of segPoints(segment, 1)) {
          if (point.x < gap.left - 1e-6 || point.x > gap.right + 1e-6 ||
              point.y < gap.top - 1e-6 || point.y > gap.bottom + 1e-6 ||
              obstaclesNear(point.y, 2).some((obstacle) => inRect(point.x, point.y, obstacle))) return null;
        }
      }
      const claim = normalizeHandoffClaim({
        gapId: gap.id,
        fromSectionId: from.section.id,
        toSectionId: to.section.id,
        xMin: from.x,
        xMax: to.x,
        top,
        bottom,
        pad: claimPad,
      });
      if (!claim || handoffClaims.some((existing) =>
        (!normalizeHandoffClaim(existing) && (!existing?.gapId || existing.gapId === gap.id)) ||
        handoffClaimsConflict(existing, claim))) return null;
      return { gap, segments, claim, fromY: top, toY: bottom, rawLength: segmentsLength(segments) };
    };

    const solved = solveSectionStateDP<SectionState, SectionTransition>(statesBySection,
      (previousState, state): DPEdge<SectionTransition> | null => {
      if (previousState.side === state.side) {
        if (previousState.strand !== state.strand ||
            !runIntervalClear(state, previousState.maxPortY, state.minPortY)) return null;
        return {
          transition: { kind: "continue" },
          cost: Math.max(0, state.minPortY - previousState.maxPortY),
        };
      }
      const handoff = makeHandoff(previousState, state);
      if (!handoff) return null;
      return {
        transition: { kind: "handoff", handoff },
        cost: Math.max(0, handoff.fromY - previousState.maxPortY) + handoff.rawLength +
          Math.max(0, state.minPortY - handoff.toY),
      };
      }, diagnostics);
    if (!solved) return { valid: false, reason: diagnostics.scoreDeclineReason || "needs-space", diagnostics, failures };
    const { chosen, path: chosenPath, transitions: chosenTransitions } = solved;
    diagnostics.terminalStates = solved.terminalEntries;

    const runs: SectionRunDraft[] = [];
    const stateRun = new Map<string, SectionRunDraft>();
    const annKey = stableIdPart(ann.id);
    for (const state of chosenPath) {
      let run = runs[runs.length - 1];
      if (!run || run.side !== state.side || run.strand !== state.strand) {
        run = {
          side: state.side,
          strand: state.strand,
          railX: state.x,
          x: state.x,
          states: [],
          sectionIds: [],
        } as unknown as SectionRunDraft;
        runs.push(run);
      }
      run.states.push(state);
      run.sectionIds.push(state.section.id);
      stateRun.set(state.section.id, run);
    }
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index]!;
      const sectionKey = run.sectionIds.map(stableIdPart).join("+");
      run.id = `run:${annKey}:${sectionKey}:${run.side}:${run.strand}`;
      run.runIndex = index;
      run.spineId = `spine:${annKey}:${sectionKey}:${run.side}:${run.strand}`;
      const ys = run.states.flatMap((state) => state.plan.ports.map((port) => port.y));
      run.top = Math.min(...ys);
      run.bottom = Math.max(...ys);
    }

    const handoffs: SectionHandoffDraft[] = [];
    for (let index = 0; index < chosenTransitions.length; index++) {
      const transition = chosenTransitions[index]!;
      if (transition.kind !== "handoff") continue;
      const fromState = chosenPath[index]!;
      const toState = chosenPath[index + 1]!;
      const fromRun = stateRun.get(fromState.section.id)!;
      const toRun = stateRun.get(toState.section.id)!;
      fromRun.bottom = Math.max(fromRun.bottom, transition.handoff.fromY);
      toRun.top = Math.min(toRun.top, transition.handoff.toY);
      handoffs.push({
        id: `handoff:${annKey}:${stableIdPart(fromState.section.id)}>${stableIdPart(toState.section.id)}`,
        gapId: transition.handoff.gap.id,
        fromSectionId: fromState.section.id,
        toSectionId: toState.section.id,
        fromRunId: fromRun.id,
        toRunId: toRun.id,
        fromSpineId: fromRun.spineId,
        toSpineId: toRun.spineId,
        from: { x: fromState.x, y: transition.handoff.fromY },
        to: { x: toState.x, y: transition.handoff.toY },
        _segments: transition.handoff.segments,
        claim: transition.handoff.claim,
      });
    }

    const centerline: OwnedRouteSegment[] = [];
    const exempts: SegmentExemption[] = [];
    const routeParts: RoutePartDraft[] = [];
    let segmentOrdinal = 0;
    const own = (segment: RouteSegment, metadata: SegmentOwnership): OwnedRouteSegment =>
      ({ ...segment, id: `segment:${annKey}:${segmentOrdinal++}`, ...metadata });
    for (const state of chosenPath) {
      const run = stateRun.get(state.section.id)!;
      const segments = state.plan.centerline.map((segment) => own(segment, {
        role: "tributary", ownerId: run.id, runId: run.id, sectionId: state.section.id,
      }));
      centerline.push(...segments);
      exempts.push(...state.plan._exempts);
      routeParts.push({
        id: `part:${annKey}:tributary:${stableIdPart(state.section.id)}`,
        role: "tributary", ownerId: run.id, runId: run.id, sectionId: state.section.id, segments,
      });
    }
    const spines: SectionSpine[] = runs.map((run) => {
      const spine: SectionSpine = {
        id: run.spineId, kind: "margin", ownerRunId: run.id, runId: run.id, side: run.side, strand: run.strand,
        x: run.railX, top: run.top, bottom: run.bottom, sectionIds: [...run.sectionIds],
      };
      const segment = own(L(spine.x, spine.top, spine.x, spine.bottom), {
        role: "spine", ownerId: spine.id, runId: run.id, spineId: spine.id,
      });
      centerline.push(segment); exempts.push(null);
      routeParts.push({ id: `part:${stableIdPart(spine.id)}`, role: "spine", ownerId: spine.id, runId: run.id, spineId: spine.id, segments: [segment] });
      return spine;
    });
    for (const handoff of handoffs) {
      const segments = handoff._segments!.map((segment) => own(segment, {
        role: "handoff", ownerId: handoff.id, handoffId: handoff.id,
        fromRunId: handoff.fromRunId, toRunId: handoff.toRunId,
      }));
      delete handoff._segments;
      handoff.segments = segments;
      centerline.push(...segments);
      for (const _ of segments) exempts.push(null);
      routeParts.push({ id: `part:${stableIdPart(handoff.id)}`, role: "handoff", ownerId: handoff.id, handoffId: handoff.id, segments });
    }

    for (const spine of spines) {
      if (spineIntervalClaimed(spine.x, spine.top, spine.bottom)) {
        /* This is an invariant check: DP state/transition feasibility must
         * have rejected the occupied run before topology selection. */
        return { valid: false, reason: "spine-separation", diagnostics, failures };
      }
    }
    const corridorClaimsOut: OwnedCorridorClaim[] = [];
    const contacts: OwnedRoutePoint[] = [];
    const contactIdByAnchor = new Map<string, string>();
    for (const state of chosenPath) {
      const run = stateRun.get(state.section.id)!;
      state.plan.claimsOut.forEach((claim, index) => corridorClaimsOut.push({
        ...claim,
        id: `corridor-claim:${annKey}:${stableIdPart(state.section.id)}:${index}`,
        ownerRunId: run.id,
        sectionId: state.section.id,
      }));
      state.plan.contacts.forEach((contact, index) => {
        const owner = state.plan._contactOwners[index]!;
        const id = `contact:${annKey}:${stableIdPart(owner.anchorId)}`;
        contacts.push({
          ...contact, id, role: "terminal-contact", ownerId: run.id, runId: run.id,
          spineId: run.spineId, sectionId: state.section.id, anchorId: owner.anchorId,
        });
        contactIdByAnchor.set(owner.anchorId, id);
      });
    }
    const ports: OwnedRoutePoint[] = [];
    for (const state of chosenPath) {
      const run = stateRun.get(state.section.id)!;
      const spineId = run.spineId;
      state.plan.ports.forEach((port, index) => ports.push({
        ...port, id: `port:${annKey}:${stableIdPart(state.section.id)}:${index}`, role: "tributary-port",
        ownerId: run.id, runId: run.id, spineId, sectionId: state.section.id,
      }));
    }
    for (const handoff of handoffs) {
      const handoffKey = stableIdPart(handoff.id);
      ports.push({ ...handoff.from, id: `port:${handoffKey}:from`, role: "handoff-port", ownerId: handoff.id, handoffId: handoff.id, runId: handoff.fromRunId, spineId: handoff.fromSpineId });
      ports.push({ ...handoff.to, id: `port:${handoffKey}:to`, role: "handoff-port", ownerId: handoff.id, handoffId: handoff.id, runId: handoff.toRunId, spineId: handoff.toSpineId });
    }
    const finalized = finalize(centerline, mode, contacts,
      chosenPath.flatMap((state) => state.plan.corridors),
      chosenPath.flatMap((state) => state.plan.corridorIdx),
      null, null, ports, undefined, exempts, corridorClaimsOut);
    if (!finalized.valid) return {
      ...finalized,
      diagnostics: {
        ...diagnostics,
        finalize: finalized.diagnostics as RouteDiagnostics | undefined,
      },
    };

    const spineClaimsOut = spines.map((spine) => ({
      id: `claim:${stableIdPart(spine.id)}`, ownerRunId: spine.ownerRunId, side: spine.side, strand: spine.strand,
      x: spine.x, top: spine.top, bottom: spine.bottom,
    }));
    const strandClaimsOut = runs.map((run) => ({
      id: `strand-claim:${stableIdPart(run.id)}`, ownerRunId: run.id, side: run.side, strand: run.strand,
      top: run.top, bottom: run.bottom,
    }));
    const handoffClaimsOut: OwnedHandoffClaim[] = handoffs.map((handoff) => ({
      ...handoff.claim!,
      id: `claim:${stableIdPart(handoff.id)}`,
      ownerHandoffId: handoff.id,
    }));
    handoffs.forEach((handoff, index) => {
      handoff.claimOut = handoffClaimsOut[index]!;
      delete handoff.claim;
    });
    for (const run of runs) {
      run.corridorClaimIds = corridorClaimsOut
        .filter((claim) => claim.ownerRunId === run.id)
        .map((claim) => claim.id);
      run.spineClaimId = spineClaimsOut.find((claim) => claim.ownerRunId === run.id)?.id;
      run.strandClaimId = strandClaimsOut.find((claim) => claim.ownerRunId === run.id)?.id;
      const partClaims = new Map<string, string[]>();
      for (const claim of corridorClaimsOut.filter((candidate) => candidate.ownerRunId === run.id)) {
        const ids = partClaims.get(claim.sectionId) || [];
        ids.push(claim.id);
        partClaims.set(claim.sectionId, ids);
      }
      for (const part of routeParts) {
        if (part.runId === run.id && part.sectionId && partClaims.has(part.sectionId)) {
          part.corridorClaimIds = partClaims.get(part.sectionId);
        }
      }
    }
    const outputSectionSides = chosenPath.map((state) => ({ sectionId: state.section.id, side: state.side }));
    const topologySignature = `section-topology:v1|${chosenPath.map((state) =>
      `${stableIdPart(state.section.id)}:${state.side[0]}${state.strand}`).join("|")}`;
    const canonicalAnchors = [...ann.anchors].sort((a, b) =>
      a.documentOrder - b.documentOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const anchorRuns = canonicalAnchors.map((anchor, anchorIndex) => {
      const run = stateRun.get(anchor.sectionId!)!;
      return {
        anchorId: anchor.id, anchorIndex, contactId: contactIdByAnchor.get(anchor.id),
        sectionId: anchor.sectionId, runId: run.id, side: run.side, strand: run.strand,
      };
    });
    const rawLength = segmentsLength(centerline);
    const markerRangesByRun = runs.map((run) => ({
      runId: run.id,
      marginStart: run.top,
      marginEnd: run.bottom,
    }));
    const result: ValidRoutePlan = {
      ...finalized,
      topology: "sectioned",
      sectionAware: true,
      sideRuns: runs.map(({ states, ...run }) => run),
      spines,
      handoffs,
      routeParts,
      centerline,
      ports,
      anchorRuns,
      corridorClaimsOut,
      spineClaimsOut,
      strandClaimsOut,
      handoffClaimsOut,
      topologySignature,
      topologyMemory: { sectionSides: outputSectionSides, topologySignature },
      sectionSides: outputSectionSides,
      markerRangesByRun,
      markerRanges: runs.length === 1
        ? { marginStart: runs[0]!.top, marginEnd: runs[0]!.bottom }
        : {},
      rawLength,
      scoreRaw: chosen.scoreRaw,
      score: chosen.score,
      diagnostics: {
        ...finalized.diagnostics,
        side: runs.length === 1 ? runs[0]!.side : "mixed",
        laneIndex: runs.length === 1 ? runs[0]!.strand : null,
        score: chosen.score,
        sectionRouting: { status: "selected", topologySignature },
        dp: diagnostics,
        stateFailures: failures,
      },
    };
    if (runs.length === 1) {
      const run = runs[0]!;
      const spine = spines[0]!;
      result.side = run.side;
      result.strand = run.strand;
      result.marginRailX = run.railX;
      result.spine = spine;
      result.spineClaimOut = spineClaimsOut[0]!;
      result.strandClaimOut = strandClaimsOut[0]!;
    } else {
      result.side = null;
      result.strand = null;
      result.marginRailX = null;
      result.spine = null;
      result.spineClaimOut = null;
      result.strandClaimOut = null;
    }
    return result;
  };

  /* claims-driven strand availability: committed spine intervals block a
   * strand only where they actually run (±6px slack — kissing spines on
   * one strand read as a single broken line) */
  const annTop = Math.min(...branchesIn.map((b) => b.frag.top));
  const annBottom = Math.max(...ann.anchors.flatMap((a) => a.fragments.map((f) => f.bottom)));
  const strandClaims = opts.strandClaims || [];
  const requestedSides = Array.isArray(opts.sides) ? opts.sides : ["left"];
  const sides: RouteSide[] = [];
  for (const side of requestedSides) {
    if (side !== "left" && side !== "right") {
      declined.push({ move: `margin:${side}`, why: "unsupported" });
    } else if (!sides.includes(side)) sides.push(side);
  }
  if (!sides.length) return fail("needs-space", "no-supported-side");

  if (sectionMeta.valid) {
    const sectionPlan = buildSectionTopology(sides);
    if (sectionPlan?.valid) return sectionPlan;
    declined.push({
      move: "section-routing",
      why: sectionPlan?.reason || "no-legal-topology",
      detail: sectionPlan?.diagnostics,
    });
  }

  /* Each side owns its own strand stack. Search outward independently and
   * compare the first legal route on each side; a committed left strand 0
   * must never suppress right strand 0 (or vice versa). */
  const candidates: MarginRoutePlan[] = [];
  const failReasons: string[] = [];
  for (const side of sides) {
    const openStrands = opts.focused ? [0] : [0, 1, 2].filter((strand) =>
      !strandClaims.some((sc) => sc.side === side && sc.strand === strand &&
        sc.top < annBottom + 6 && annTop < sc.bottom + 6));
    if (!openStrands.length) {
      failReasons.push("needs-space");
      declined.push({ move: `margin:${side}`, why: "no-strand" });
      continue;
    }
    for (const strand of openStrands) {
      const res = genMargin(side, strand);
      if (res.valid) {
        candidates.push(res);
        break;
      }
      failReasons.push(res.reason);
    }
  }
  if (!candidates.length) {
    const order = ["needs-space", "kink", "obstacle-collision"];
    return fail(order.find((r) => failReasons.includes(r)) || failReasons[0] || "needs-space");
  }

  /* Whole-route scorer: ink length + a quiet semantic-side preference +
   * committed-side hysteresis. Side selection stays continuous, never a
   * special-case routing rule. */
  const textCenter = (Math.min(...lines.map((l) => l.left)) + Math.max(...lines.map((l) => l.right))) / 2;
  for (const c of candidates) {
    const wrongSide = c.side === "left"
      ? Math.max(0, c.semCenter - textCenter) * 0.035
      : Math.max(0, textCenter - c.semCenter) * 0.035;
    const hysteresis = opts.previousSide && opts.previousSide !== c.side ? 12 : 0;
    c.scoreRaw = c.rawLength + wrongSide + hysteresis;
    c.score = Math.round(c.scoreRaw * 10) / 10;
  }
  const scoredCandidates = candidates as ScoredMarginRoutePlan[];
  const sideOrder = new Map<RouteSide, number>(sides.map((side, index) => [side, index]));
  scoredCandidates.sort((a, b) => {
    /* The scorer's 0.1px quantization is deliberate calm: sub-tenth
     * measurement noise is a tie, so requested-side order owns it. */
    const scoreDelta = a.score - b.score;
    if (scoreDelta) return scoreDelta;
    return sideOrder.get(a.side)! - sideOrder.get(b.side)! ||
      (a.strand ?? 9) - (b.strand ?? 9);
  });
  const best = scoredCandidates[0]!;
  best.diagnostics.score = best.score;
  best.diagnostics.alternativesConsidered = scoredCandidates.slice(1).map((c) => ({
    side: c.side, strand: c.strand, score: c.score,
  }));
  return best;

  /* ── shared finish: sample, validate, diagnose ──
   * Ink privileges are ownership-scoped: a terminal segment may pass
   * through its OWN fragment's expanded rect (and the departure wedge at
   * its own pin, where neighbor expansions unavoidably overlap); every
   * other segment — floors, shoulders, swoops, spines, drips — must be
   * genuinely clear of everything. */
  function finalize(
    segs: RouteSegment[],
    mode: RouteMode,
    contacts: RoutePoint[],
    corridorYs: number[],
    corridorIdx: number[],
    railXOut: number | null,
    spine: RouteSpine | null,
    ports: RoutePoint[],
    cradleVariant: RouteCradleVariant | undefined,
    exempts: SegmentExemption[] | undefined,
    corridorClaimsOut: RouteCorridorClaimInput[] | undefined,
  ): RoutePlan {
    const normalizedClaims: RouteCorridorClaim[] = [];
    for (const claim of corridorClaimsOut || []) {
      const normalized = normalizeCorridorClaim(claim);
      if (!normalized) return fail("nan", { claim });
      normalizedClaims.push(normalized);
    }
    const sampled: SampledPoint[] = [];
    segs.forEach((s, si) => {
      const ex = exempts ? exempts[si] : null;
      for (const p of segPoints(s, 1)) {
        const sampledPoint = p as SampledPoint;
        if (ex) sampledPoint.ex = ex;
        sampled.push(sampledPoint);
      }
    });
    for (const p of sampled) {
      if (!isFinite(p.x) || !isFinite(p.y)) return fail("nan");
    }
    if (spine) {
      for (const sc of spineClaims) {
        if (Math.abs(sc.x - spine.x) < SPINE_SEP &&
            sc.top - 2.6 < spine.bottom && spine.top < sc.bottom + 2.6) {
          return fail("spine-separation", { x: spine.x, against: sc.x });
        }
      }
    }
    let minClear = Infinity;
    for (const p of sampled) {
      for (const o of obstaclesNear(p.y, 32)) {
        if (inRect(p.x, p.y, o)) {
          /* an envelope exempt (guardRaw) buys passage through expanded
           * clearance skirts and the underline strip — never through the
           * ink zone above the strip */
          const excused = p.ex && p.ex.some((e) =>
            (inRect(p.x, p.y, e.rect) ||
              (!e.guardRaw && Math.hypot(p.x - e.cx, p.y - e.cy) < expand + 1)) &&
            (!e.guardRaw || !o.raw || !rawInkAt(p.x, p.y, o.raw)));
          if (!excused) {
            const f = fail("obstacle-collision");
            f.debug = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, obstacle: o };
            return f;
          }
        } else {
          const dx = Math.max(o.left - p.x, 0, p.x - o.right);
          const dy = Math.max(o.top - p.y, 0, p.y - o.bottom);
          minClear = Math.min(minClear, Math.hypot(dx, dy));
        }
      }
    }
    if (!isFinite(minClear)) minClear = 99;
    return {
      valid: true,
      side: "left",
      mode,
      cradleVariant,
      contacts,
      corridors: corridorYs,
      corridorIdx,
      marginRailX: railXOut,
      centerline: segs,
      sampledPoints: sampled,
      spine,
      ports,
      markerRanges: spine
        ? { marginStart: spine.top, marginEnd: spine.bottom }
        : corridorYs.length ? { marginStart: corridorYs[0]!, marginEnd: corridorYs[0]! } : {},
      claimsOut: normalizedClaims,
      spineClaimOut: spine ? { x: spine.x, top: spine.top, bottom: spine.bottom } : null,
      diagnostics: {
        minimumClearance: Math.round(minClear * 100) / 100,
        intersections: 0,
        cornerRadii: [],
        totalLength: Math.round(segmentsLength(segs)),
        laneIndex: strandIndex,
        declined,
      },
    };
  }
}

/* ── companion ranking (the density policy's ordering) ─────── */
/* Rank candidates "beside" a focus interval: overlapping first, then
 * nearest; ties break smaller-span-first (local companions beat
 * page-spanning ones), then top order, then id. Pure and exported so
 * hosts share one definition of "beside". */
export function rankCompanions(
  intervals: readonly CompanionInterval[],
  focusId: string,
): string[] {
  const f = intervals.find((i) => i.id === focusId);
  if (!f) return intervals.map((i) => i.id);
  const dist = (i: CompanionInterval): number =>
    (i.top > f.bottom ? i.top - f.bottom : f.top > i.bottom ? f.top - i.bottom : 0);
  const span = (i: CompanionInterval): number => i.bottom - i.top;
  return intervals
    .filter((i) => i.id !== focusId)
    .sort((a, b) => dist(a) - dist(b) || span(a) - span(b) || a.top - b.top || (a.id < b.id ? -1 : 1))
    .map((i) => i.id);
}

/* ── stable strand assignment (the loom) ───────────────────── */
/* anns: [{id, top, bottom, focused}] → Map id → strandIndex.
 * Focused gets strand 0 (nearest the text); others stack outward in
 * deterministic order; disjoint intervals may share a strand; beyond
 * the budget the annotation is held (ticks only, -1). */
export function assignStrands(
  anns: readonly StrandInterval[],
  maxStrands = 3,
): Map<string, number> {
  const out = new Map<string, number>();
  const order = [...anns].sort((a, b) =>
    (a.focused === b.focused ? a.top - b.top || (a.id < b.id ? -1 : 1) : a.focused ? -1 : 1));
  for (const a of order) {
    let s = a.focused ? 0 : 0;
    for (;;) {
      const clash = order.some((o) =>
        o !== a && out.has(o.id) && out.get(o.id) === s &&
        o.top < a.bottom + 6 && a.top < o.bottom + 6);
      if (!clash) break;
      s++;
    }
    if (s >= maxStrands) out.set(a.id, -1);
    else out.set(a.id, s);
  }
  return out;
}

export const _internals = {
  quarterVH,
  quarterHV,
  settleHH,
  contactTerminal,
  CONTACT_LEAD,
  CORNER,
  segPoints,
  expandRect,
  normalizeCorridorClaim,
  makeCorridorClaim,
  corridorClaimsConflict,
  finiteRect,
  validateSectionMetadata,
  normalizeHandoffClaim,
  handoffClaimsConflict,
  SECTION_HYSTERESIS,
  MAX_SECTION_STRANDS,
  HANDOFF_EDGE_INSET,
  HANDOFF_MIN_SPAN,
  addScoreRaw,
  scoreBucketFromRaw,
  stableNumber,
  stableIdPart,
  sectionPairKey,
  solveSectionStateDP,
  KAPPA,
};
