/* route-engine.js — Loom: obstacle-aware marginalia threading.
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

const KAPPA = 0.5522847498;

/* ── rect + segment primitives ─────────────────────────────── */
function expandRect(r, e) {
  return { left: r.left - e, right: r.right + e, top: r.top - e, bottom: r.bottom + e };
}
function inRect(x, y, r) {
  return x > r.left && x < r.right && y > r.top && y < r.bottom;
}
function L(x1, y1, x2, y2) { return { type: "L", x1, y1, x2, y2 }; }
function C(x1, y1, c1x, c1y, c2x, c2y, x2, y2) {
  return { type: "C", x1, y1, c1x, c1y, c2x, c2y, x2, y2 };
}
/* quarter cubic: vertical tangent at (x1,y1) → horizontal tangent at (x2,y2) */
function quarterVH(x1, y1, x2, y2) {
  return C(x1, y1, x1, y1 + KAPPA * (y2 - y1), x2 - KAPPA * (x2 - x1), y2, x2, y2);
}
/* quarter cubic: horizontal tangent at (x1,y1) → vertical tangent at (x2,y2).
 * With |dx| > |dy| this is the shallow "swoop" that pours into a strand. */
function quarterHV(x1, y1, x2, y2) {
  return C(x1, y1, x1 + KAPPA * (x2 - x1), y1, x2, y2 - KAPPA * (y2 - y1), x2, y2);
}
function segPoints(s, step = 1) {
  const pts = [];
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
function segmentsLength(segs) {
  let total = 0;
  for (const s of segs) {
    const pts = segPoints(s, 2);
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

/* tuning constants of the grammar — one place, deliberately few */
const DROP_MIN = 3.2;    // terminal turn radius floor (contact → shoulder)
const SWOOP_REACH = 11;  // horizontal length of the port swoop
const SWOOP_DIP = 3.2;   // ideal vertical dip of the port swoop
const SWOOP_DIP_MIN = 1.5;
const CLAIM_GAP = 2.2;   // min separation of two shoulders in one corridor
const BAND_MIN = 4.2;    // corridor must be at least this tall to be legal
const FLOOR_MIN = 5;         // a cradle floor must really exist
const GAP_FACING_MIN = 12;   // ≈ 2·DROP_MIN + FLOOR_MIN — below this, two facing turns can't fit
const GAP_EMBRACE_MAX = 16;  // embrace rescues facing only in the 12..16 overlap band
const SECTION_HYSTERESIS = 12;
const MAX_SECTION_STRANDS = 3;
const HANDOFF_EDGE_INSET = 1;
const HANDOFF_MIN_SPAN = 8;

/* Keep the measured score raw. Tenth-pixel calm is a comparator on a complete
 * topology, never a second round of already-rounded atomic contributions. */
function addScoreRaw(...parts) {
  let total = 0;
  for (const part of parts) {
    if (!Number.isFinite(part)) return null;
    total += part;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function scoreBucketFromRaw(scoreRaw) {
  if (!Number.isFinite(scoreRaw)) return null;
  const bucket = Math.round(scoreRaw * 10);
  return Number.isSafeInteger(bucket) ? bucket : null;
}

function finiteRect(r) {
  return !!r && Number.isFinite(r.left) && Number.isFinite(r.right) &&
    Number.isFinite(r.top) && Number.isFinite(r.bottom) &&
    r.left < r.right && r.top < r.bottom;
}

function normalizeHandoffClaim(claim) {
  if (!claim || typeof claim.gapId !== "string" || !claim.gapId ||
      !Number.isFinite(claim.xMin) || !Number.isFinite(claim.xMax) ||
      !Number.isFinite(claim.top) || !Number.isFinite(claim.bottom)) return null;
  return {
    gapId: claim.gapId,
    fromSectionId: typeof claim.fromSectionId === "string" ? claim.fromSectionId : undefined,
    toSectionId: typeof claim.toSectionId === "string" ? claim.toSectionId : undefined,
    xMin: Math.min(claim.xMin, claim.xMax),
    xMax: Math.max(claim.xMin, claim.xMax),
    top: Math.min(claim.top, claim.bottom),
    bottom: Math.max(claim.top, claim.bottom),
    pad: Number.isFinite(claim.pad) ? Math.max(0, claim.pad) : 0,
  };
}

function handoffClaimsConflict(existing, candidate) {
  if (!existing || !candidate || existing.gapId !== candidate.gapId) return false;
  const a = normalizeHandoffClaim(existing);
  const b = normalizeHandoffClaim(candidate);
  if (!a || !b) return true;
  return a.xMin - a.pad <= b.xMax + b.pad && b.xMin - b.pad <= a.xMax + a.pad &&
    a.top - a.pad <= b.bottom + b.pad && b.top - b.pad <= a.bottom + a.pad;
}

function stableNumber(n) {
  return Math.round(n * 1000) / 1000;
}

function stableIdPart(value) {
  const text = String(value);
  let encoded = "";
  let chunkStart = 0;
  const flush = (end) => {
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

function sectionPairKey(fromSectionId, toSectionId) {
  return JSON.stringify([fromSectionId, toSectionId]);
}

/* Validate section provenance as one closed semantic contract. Partial or
 * contradictory declarations must never leak permission for a handoff. */
function validateSectionMetadata(block, ann, enabled) {
  const sections = block.sections;
  const gaps = block.sectionGaps;
  const lines = block.renderedLines;
  if (enabled !== true) return { active: false, valid: false, reason: enabled === false ? "disabled" : "absent" };
  const bad = (reason, detail) => ({ active: true, valid: false, reason, detail });
  if (!Array.isArray(sections) || sections.length < 2) return bad("missing-sections");
  if (!Array.isArray(gaps)) return bad("missing-section-gaps");

  const ids = new Set();
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || typeof section.id !== "string" || !section.id) return bad("malformed-section", { index: i });
    if (ids.has(section.id)) return bad("duplicate-section", { sectionId: section.id });
    if (!Number.isFinite(section.documentOrder) || !finiteRect(section)) return bad("malformed-section", { sectionId: section.id });
    if (i && (section.documentOrder <= sections[i - 1].documentOrder || section.top < sections[i - 1].bottom)) {
      return bad("out-of-order-section", { sectionId: section.id });
    }
    ids.add(section.id);
  }
  const sectionIndex = new Map(sections.map((section, index) => [section.id, index]));

  const lineIds = new Set();
  const lineOrders = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line.id !== "string" || !line.id || lineIds.has(line.id) ||
        !Number.isFinite(line.documentOrder) || lineOrders.has(line.documentOrder) ||
        typeof line.sectionId !== "string" || !ids.has(line.sectionId) || !finiteRect(line)) {
      return bad(lineIds.has(line?.id) ? "duplicate-rendered-line" : "malformed-rendered-line", { index: i });
    }
    const owner = sections[sectionIndex.get(line.sectionId)];
    if (line.left < owner.left || line.right > owner.right ||
        line.top < owner.top || line.bottom > owner.bottom) {
      return bad("out-of-bounds-rendered-line", { lineId: line.id, sectionId: line.sectionId });
    }
    lineIds.add(line.id);
    lineOrders.add(line.documentOrder);
  }
  const orderedLines = [...lines].sort((a, b) =>
    a.documentOrder - b.documentOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 1; i < orderedLines.length; i++) {
    const before = orderedLines[i - 1], after = orderedLines[i];
    if (after.top < before.top || sectionIndex.get(after.sectionId) < sectionIndex.get(before.sectionId)) {
      return bad("out-of-order-rendered-line", { lineId: after.id });
    }
  }

  const anchorIds = new Set();
  const anchorOrders = new Set();
  for (let i = 0; i < ann.anchors.length; i++) {
    const anchor = ann.anchors[i];
    if (!anchor || typeof anchor.id !== "string" || !anchor.id || anchorIds.has(anchor.id) ||
        !Number.isFinite(anchor.documentOrder) || anchorOrders.has(anchor.documentOrder) ||
        typeof anchor.sectionId !== "string" || !ids.has(anchor.sectionId) ||
        !Array.isArray(anchor.fragments) || !anchor.fragments.length ||
        anchor.fragments.some((fragment) => !finiteRect(fragment))) {
      return bad(anchorIds.has(anchor?.id) ? "duplicate-anchor" : "malformed-anchor", { index: i });
    }
    const owner = sections[sectionIndex.get(anchor.sectionId)];
    if (anchor.fragments.some((fragment) => fragment.left < owner.left || fragment.right > owner.right ||
        fragment.top < owner.top || fragment.bottom > owner.bottom)) {
      return bad("out-of-bounds-anchor", { anchorId: anchor.id, sectionId: anchor.sectionId });
    }
    anchorIds.add(anchor.id);
    anchorOrders.add(anchor.documentOrder);
  }
  const orderedAnchors = [...ann.anchors].sort((a, b) =>
    a.documentOrder - b.documentOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const firstFragment = (anchor) => [...anchor.fragments].sort((a, b) =>
    a.top - b.top || a.left - b.left || a.bottom - b.bottom || a.right - b.right)[0];
  for (let i = 1; i < orderedAnchors.length; i++) {
    const before = orderedAnchors[i - 1], after = orderedAnchors[i];
    const beforeFragment = firstFragment(before), afterFragment = firstFragment(after);
    if (sectionIndex.get(after.sectionId) < sectionIndex.get(before.sectionId) ||
        (after.sectionId === before.sectionId &&
          (afterFragment.top < beforeFragment.top ||
            (afterFragment.top === beforeFragment.top && afterFragment.left < beforeFragment.left)))) {
      return bad("out-of-order-anchor", { anchorId: after.id });
    }
  }

  const gapIds = new Set();
  const gapPairs = new Set();
  const gapByPair = new Map();
  let lastGapOrder = -Infinity;
  let lastGapFromIndex = -1;
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    const fromSectionId = gap?.fromSectionId ?? gap?.beforeSectionId;
    const toSectionId = gap?.toSectionId ?? gap?.afterSectionId;
    const fromIndex = sectionIndex.get(fromSectionId);
    const toIndex = sectionIndex.get(toSectionId);
    const pair = sectionPairKey(fromSectionId, toSectionId);
    if (!gap || typeof gap.id !== "string" || !gap.id || gapIds.has(gap.id) || gapPairs.has(pair) ||
        !Number.isFinite(gap.documentOrder) || gap.documentOrder <= lastGapOrder || !finiteRect(gap) ||
        fromIndex == null || toIndex !== fromIndex + 1 || fromIndex <= lastGapFromIndex ||
        gap.hardClear !== true) {
      return bad(gapIds.has(gap?.id) ? "duplicate-section-gap" : gapPairs.has(pair) ? "duplicate-section-gap-pair" : "malformed-section-gap", { index: i });
    }
    const before = sections[fromIndex], after = sections[toIndex];
    if (gap.top < before.bottom || gap.bottom > after.top) return bad("out-of-bounds-section-gap", { gapId: gap.id });
    gapIds.add(gap.id);
    gapPairs.add(pair);
    gapByPair.set(pair, { ...gap, fromSectionId, toSectionId });
    lastGapOrder = gap.documentOrder;
    lastGapFromIndex = fromIndex;
  }

  const activeIds = [];
  const activeSeen = new Set();
  for (const anchor of orderedAnchors) {
    if (activeIds[activeIds.length - 1] === anchor.sectionId) continue;
    if (activeSeen.has(anchor.sectionId)) return bad("noncontiguous-anchor-section", { sectionId: anchor.sectionId });
    activeSeen.add(anchor.sectionId);
    activeIds.push(anchor.sectionId);
  }
  if (activeIds.length < 2) return { active: true, valid: false, reason: "single-active-section" };
  let previous = -1;
  for (const id of activeIds) {
    const index = sectionIndex.get(id);
    if (index <= previous) return bad("out-of-order-anchor-section", { sectionId: id });
    previous = index;
  }
  return {
    active: true,
    valid: true,
    sections: activeIds.map((id) => sections[sectionIndex.get(id)]),
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
function solveSectionStateDP(statesBySection, transitionFor, diagnostics = {}) {
  if (!statesBySection.length || statesBySection.some((states) => !states.length)) return null;
  const unsafeScore = () => { diagnostics.scoreDeclineReason = "unsafe-score-range"; return null; };
  const layers = statesBySection.map((states) => [...states].sort((a, b) =>
    a.sideRank - b.sideRank || a.strand - b.strand));
  const stateCosts = layers.map((states) => states.map((state) =>
    Number.isFinite(state.baseCost) && state.baseCost >= 0 ? state.baseCost : null));
  if (stateCosts.some((states) => states.some((score) => score == null))) return unsafeScore();
  const edges = [];
  const edgeCosts = [];
  for (let layer = 0; layer < layers.length - 1; layer++) {
    const edgeLayer = layers[layer].map(() => Array(layers[layer + 1].length).fill(null));
    const costLayer = layers[layer].map(() => Array(layers[layer + 1].length).fill(null));
    for (let fromIndex = 0; fromIndex < layers[layer].length; fromIndex++) {
      for (let toIndex = 0; toIndex < layers[layer + 1].length; toIndex++) {
        diagnostics.transitionsEvaluated = (diagnostics.transitionsEvaluated || 0) + 1;
        const edge = transitionFor(
          layers[layer][fromIndex], layers[layer + 1][toIndex], layer + 1,
        );
        if (!edge) continue;
        if (!Number.isFinite(edge.cost) || edge.cost < 0) return unsafeScore();
        edgeLayer[fromIndex][toIndex] = edge;
        costLayer[fromIndex][toIndex] = edge.cost;
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
    ...edgeCosts.map((matrix) => Math.max(...matrix.flat().filter((value) => value != null))),
  );
  if (maximumPathRaw == null || scoreBucketFromRaw(maximumPathRaw) == null) return unsafeScore();
  diagnostics.maximumPathRaw = maximumPathRaw;

  const forward = layers.map((states) => states.map(() => new Map()));
  for (let stateIndex = 0; stateIndex < layers[0].length; stateIndex++) {
    const state = layers[0][stateIndex];
    forward[0][stateIndex].set(0, {
      state,
      stateIndex,
      scoreRaw: stateCosts[0][stateIndex],
      handoffCount: 0,
      previous: null,
      transition: null,
      lexRank: stateIndex,
    });
  }
  diagnostics.maxFrontierSize = Math.max(...layers.map((layer) => layer.length));
  diagnostics.maxLabelsPerState = 1;
  diagnostics.maxFrontierLabels = layers[0].length;
  diagnostics.labelsEvaluated = layers[0].length;

  for (let layer = 1; layer < layers.length; layer++) {
    for (let fromIndex = 0; fromIndex < layers[layer - 1].length; fromIndex++) {
      for (const previous of forward[layer - 1][fromIndex].values()) {
        for (let toIndex = 0; toIndex < layers[layer].length; toIndex++) {
          const edge = edges[layer - 1][fromIndex][toIndex];
          if (!edge) continue;
          diagnostics.labelsEvaluated++;
          const handoffDelta = edge.transition.kind === "handoff" ? 1 : 0;
          const handoffCount = previous.handoffCount + handoffDelta;
          const incrementRaw = addScoreRaw(stateCosts[layer][toIndex],
            edgeCosts[layer - 1][fromIndex][toIndex]);
          const scoreRaw = addScoreRaw(previous.scoreRaw, incrementRaw);
          if (incrementRaw == null || scoreRaw == null) return unsafeScore();
          const candidate = {
            state: layers[layer][toIndex],
            stateIndex: toIndex,
            scoreRaw,
            handoffCount,
            previous,
            transition: edge.transition,
            lexRank: 0,
          };
          const existing = forward[layer][toIndex].get(handoffCount);
          if (!existing || candidate.scoreRaw < existing.scoreRaw ||
              (candidate.scoreRaw === existing.scoreRaw && previous.lexRank < existing.previous.lexRank)) {
            forward[layer][toIndex].set(handoffCount, candidate);
          }
        }
      }
    }
    const ranked = forward[layer].flatMap((labels) => [...labels.values()]);
    ranked.sort((a, b) => a.previous.lexRank - b.previous.lexRank ||
      a.state.sideRank - b.state.sideRank || a.state.strand - b.state.strand);
    ranked.forEach((label, rank) => { label.lexRank = rank; });
    diagnostics.maxLabelsPerState = Math.max(diagnostics.maxLabelsPerState,
      ...forward[layer].map((labels) => labels.size));
    diagnostics.maxFrontierLabels = Math.max(diagnostics.maxFrontierLabels, ranked.length);
  }

  const terminalLabels = forward.at(-1).flatMap((labels) => [...labels.values()]);
  if (!terminalLabels.length) return null;
  const terminalBuckets = terminalLabels.map((label) => scoreBucketFromRaw(label.scoreRaw));
  if (terminalBuckets.some((bucket) => bucket == null)) return unsafeScore();
  const winningBucket = Math.min(...terminalBuckets);
  const winningHandoffs = Math.min(...terminalLabels
    .filter((label) => scoreBucketFromRaw(label.scoreRaw) === winningBucket)
    .map((label) => label.handoffCount));

  const suffix = layers.map((states) => states.map(() => new Map()));
  for (const labels of suffix.at(-1)) labels.set(0, {
    scoreRaw: 0,
    incrementRaw: null,
    next: null,
  });
  for (let layer = layers.length - 2; layer >= 0; layer--) {
    for (let fromIndex = 0; fromIndex < layers[layer].length; fromIndex++) {
      for (let toIndex = 0; toIndex < layers[layer + 1].length; toIndex++) {
        const edge = edges[layer][fromIndex][toIndex];
        if (!edge) continue;
        const handoffDelta = edge.transition.kind === "handoff" ? 1 : 0;
        for (const [remainingHandoffs, next] of suffix[layer + 1][toIndex]) {
          const handoffCount = handoffDelta + remainingHandoffs;
          const incrementRaw = addScoreRaw(stateCosts[layer + 1][toIndex],
            edgeCosts[layer][fromIndex][toIndex]);
          const scoreRaw = addScoreRaw(incrementRaw, next.scoreRaw);
          if (incrementRaw == null || scoreRaw == null) return unsafeScore();
          const candidate = { scoreRaw, incrementRaw, next };
          const existing = suffix[layer][fromIndex].get(handoffCount);
          if (existing == null || candidate.scoreRaw < existing.scoreRaw) {
            suffix[layer][fromIndex].set(handoffCount, candidate);
          }
        }
      }
    }
  }

  const replaySuffix = (prefixRaw, suffixLabel) => {
    let scoreRaw = prefixRaw;
    for (let label = suffixLabel; label?.next; label = label.next) {
      scoreRaw = addScoreRaw(scoreRaw, label.incrementRaw);
      if (scoreRaw == null) return null;
    }
    return scoreRaw;
  };

  const path = [];
  const transitions = [];
  let previousIndex = -1;
  let remainingHandoffs = winningHandoffs;
  let scoreRaw = 0;
  for (let layer = 0; layer < layers.length; layer++) {
    let selected = null;
    for (let stateIndex = 0; stateIndex < layers[layer].length; stateIndex++) {
      const state = layers[layer][stateIndex];
      const edge = layer ? edges[layer - 1][previousIndex][stateIndex] : null;
      if (layer && !edge) continue;
      const handoffDelta = edge?.transition.kind === "handoff" ? 1 : 0;
      const afterHandoffs = remainingHandoffs - handoffDelta;
      if (afterHandoffs < 0) continue;
      const suffixLabel = suffix[layer][stateIndex].get(afterHandoffs);
      if (suffixLabel == null) continue;
      const incrementRaw = addScoreRaw(stateCosts[layer][stateIndex],
        edge ? edgeCosts[layer - 1][previousIndex][stateIndex] : 0);
      const prefixRaw = addScoreRaw(scoreRaw, incrementRaw);
      const completeRaw = replaySuffix(prefixRaw, suffixLabel);
      if (incrementRaw == null || prefixRaw == null || completeRaw == null) return unsafeScore();
      if (scoreBucketFromRaw(completeRaw) !== winningBucket) continue;
      selected = { state, stateIndex, edge, handoffDelta, incrementRaw };
      break;
    }
    if (!selected) return null;
    path.push(selected.state);
    if (selected.edge) transitions.push(selected.edge.transition);
    scoreRaw = addScoreRaw(scoreRaw, selected.incrementRaw);
    if (scoreRaw == null) return unsafeScore();
    remainingHandoffs -= selected.handoffDelta;
    previousIndex = selected.stateIndex;
  }
  if (remainingHandoffs !== 0 || scoreBucketFromRaw(scoreRaw) !== winningBucket) return null;
  const chosen = {
    state: path.at(-1),
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
function normalizeCorridorClaim(claim) {
  if (!claim || !Number.isFinite(claim.corridor) || !Number.isFinite(claim.y) ||
      !Number.isFinite(claim.xMin) || !Number.isFinite(claim.xMax)) return null;
  return {
    corridor: claim.corridor,
    y: claim.y,
    xMin: Math.min(claim.xMin, claim.xMax),
    xMax: Math.max(claim.xMin, claim.xMax),
    pad: Number.isFinite(claim.pad) ? Math.max(0, claim.pad) : 0,
  };
}
function makeCorridorClaim(corridor, y, xa, xb, pad = 0) {
  return normalizeCorridorClaim({ corridor, y, xMin: xa, xMax: xb, pad });
}
function corridorClaimsConflict(existing, candidate) {
  if (!existing || !candidate || existing.corridor !== candidate.corridor) return false;
  if ((existing.pad != null && !Number.isFinite(existing.pad)) ||
      (candidate.pad != null && !Number.isFinite(candidate.pad))) return true;
  const existingPad = Number.isFinite(existing.pad) ? Math.max(0, existing.pad) : 0;
  const candidatePad = Number.isFinite(candidate.pad) ? Math.max(0, candidate.pad) : 0;
  /* A malformed claim on the same corridor is conservative. In particular,
   * it cannot turn NaN into permission to share a slot. */
  if (!Number.isFinite(existing.y) || !Number.isFinite(candidate.y)) return true;
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
export function planRoute(block, ann, opts = {}) {
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
  const declined = [];
  const fail = (reason, detail) => ({ valid: false, reason, detail, declined, laneIndex: strandIndex });

  const lines = [...block.renderedLines].sort((a, b) => a.top - b.top);
  if (!lines.length) return fail("no-rendered-lines");
  /* collision truth is words when the host measured them — the whitespace
   * between words is real routing room. Word runs are a strict subset of
   * their line rects, so this only ever legalizes routes. Corridors, line
   * indexing, and the loom datum still come from merged lines. */
  const hardRects = block.wordRuns && block.wordRuns.length ? block.wordRuns : lines;
  const obstacles = [
    ...hardRects,
    ...(block.verseNumberRects || []),
    ...(block.additionalObstacles || []),
  ].map((r) => expandRect(r, expand));

  /* y-bucketed index: sampling checks only obstacles near the point */
  const BUCKET = 16;
  const bucketIndex = new Map();
  for (const o of obstacles) {
    for (let b = Math.floor(o.top / BUCKET); b <= Math.floor(o.bottom / BUCKET); b++) {
      let arr = bucketIndex.get(b);
      if (!arr) bucketIndex.set(b, arr = []);
      arr.push(o);
    }
  }
  const nearCache = new Map();
  const obstaclesNear = (y, reach = 0) => {
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
  const corridors = [];
  const first = expandRect(lines[0], expand);
  corridors.push({ top: first.top - 10, bottom: first.top, above: -1, below: 0 });
  for (let i = 0; i < lines.length - 1; i++) {
    const a = expandRect(lines[i], expand), b = expandRect(lines[i + 1], expand);
    corridors.push(b.top - a.bottom >= BAND_MIN
      ? { top: a.bottom, bottom: b.top, above: i, below: i + 1 } : null);
  }
  /* below the last line the page itself is the corridor — give it real
   * room (a cradle floor and a staggered shoulder must coexist there) */
  const last = expandRect(lines[lines.length - 1], expand);
  corridors.push({ top: last.bottom, bottom: last.bottom + 16, above: lines.length - 1, below: -1 });

  const lineIndexOf = (frag) => {
    const cy = (frag.top + frag.bottom) / 2;
    let best = 0, bd = Infinity;
    lines.forEach((ln, i) => {
      const d = Math.abs((ln.top + ln.bottom) / 2 - cy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  /* a horizontal run at y over [xa,xb] must clear every expanded obstacle */
  const clearRun = (y, xa, xb) =>
    !obstaclesNear(y).some((o) => y > o.top && y < o.bottom && Math.min(xa, xb) < o.right && Math.max(xa, xb) > o.left);

  /* pick a shoulder y inside corridor ci. The hard bounds — DROP_MIN room
   * toward the contact, SWOOP_DIP_MIN room below when the shoulder pours
   * through a port (a cradle floor has none, so it may settle low) — are a
   * precomputed legal WINDOW, and the ladder walks it centered, skipping
   * out-of-range rungs instead of burning them on rejections. A caller may
   * pass fits(y) for per-slot acceptance (e.g. the cradle's floor length):
   * a slot that fails retries 0.6px away instead of killing the plan.
   * Honors prior claims. */
  const corridorYFor = (ci, xa, xb, contactY, needsDip = true, fits = null) => {
    const band = corridors[ci];
    if (!band) return null;
    const minY = Math.max(band.top + 0.25, contactY != null ? contactY + DROP_MIN : -Infinity);
    const maxY = needsDip ? band.bottom - 0.25 - SWOOP_DIP_MIN : band.bottom - 0.05;
    if (minY > maxY) return null;
    const base = (minY + maxY) / 2;
    const tried = [];
    const ladder = [0];
    for (let step = 0.6; step <= 5.4; step += 0.6) ladder.push(-step, step);
    for (const dy of ladder) {
      const y = base + dy;
      if (y < minY - 1e-6 || y > maxY + 1e-6) continue;
      const candidateClaim = makeCorridorClaim(ci, y, xa, xb, claimPad);
      let why = null;
      if (!candidateClaim) why = "claim-bounds";
      else if (!clearRun(y, xa, xb)) why = "obstacle";
      else if (claims.some((cl) => corridorClaimsConflict(cl, candidateClaim))) why = "claim";
      else if (fits) {
        const verdict = fits(y);
        if (verdict !== true) why = verdict || "fits";
      }
      if (!why) return {
        y,
        dip: Math.min(SWOOP_DIP, Math.max(0, band.bottom - y - 0.25)),
        claim: candidateClaim,
      };
      tried.push(why);
    }
    if (typeof window !== "undefined" && window.__ROUTE_DEBUG__) {
      (window.__ROUTE_DEBUG__.corridors = window.__ROUTE_DEBUG__.corridors || [])
        .push({ ci, band: { top: +band.top.toFixed(1), bottom: +band.bottom.toFixed(1) }, window: { minY: +minY.toFixed(1), maxY: +maxY.toFixed(1) }, xa: +xa.toFixed(1), xb: +xb.toFixed(1), contactY: +contactY?.toFixed(1), tried });
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
  const branchesIn = sorted.map((a) => {
    const frag = [...a.fragments].sort((f, g) => f.top - g.top || f.left - g.left)[0];
    return { anchor: a, frag, li: lineIndexOf(frag) };
  });
  const annotationCenter = branchesIn.reduce((sum, branch) =>
    sum + (branch.frag.left + branch.frag.right) / 2, 0) / branchesIn.length;
  const pinOf = (frag, side = "left") => ({
    x: side === "right" ? frag.right - 0.5 : frag.left + 0.5,
    y: frag.bottom + underlineDy,
  });
  const sectionRoutingEnabled = opts.sectionRouting === true || opts.sectionRouting?.enabled === true
    ? true : opts.sectionRouting === false || opts.sectionRouting?.enabled === false ? false : undefined;
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
  const allSameLine = branchesIn.every((b) => b.li === branchesIn[0].li);
  if (allSameLine && branchesIn.length === 2 && opts.disableCradle) {
    declined.push({ move: "cradle", why: "disabled" });
  }
  if (allSameLine && branchesIn.length === 2 && !opts.disableCradle) {
    const [A, B] = [...branchesIn].sort((a, b) => a.frag.left - b.frag.left);
    const ci = A.li + 1;
    const gap = B.frag.left - A.frag.right;
    const span = B.frag.right - A.frag.left;
    const wA = A.frag.right - A.frag.left, wB = B.frag.right - B.frag.left;
    const closed = (b) => b.anchor.fragments.length === 1;
    const embraceEligible = closed(A) && closed(B) && span <= 7 * fontSize;
    const facing = {
      variant: "facing",
      ax: A.frag.right - 0.5, ay: A.frag.bottom + underlineDy,
      bx: B.frag.left + 0.5, by: B.frag.bottom + underlineDy,
    };
    const embrace = {
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
    for (const c of candidates) {
      /* the cradle has no port swoop — it may settle low in the band */
      const slot = corridorYFor(ci, c.ax, c.bx, Math.max(c.ay, c.by), false, (y) =>
        (c.bx - c.ax) - (y - c.ay) - (y - c.by) >= FLOOR_MIN ? true : "floor");
      if (!slot) { declined.push({ move: `cradle:${c.variant}`, why: "no-corridor-slot" }); continue; }
      const fy = slot.y;
      const r1 = fy - c.ay, r2 = fy - c.by;
      const segs = [
        quarterVH(c.ax, c.ay, c.ax + r1, fy),        // pour down-right from pin A
        L(c.ax + r1, fy, c.bx - r2, fy),             // the hammock floor
        quarterHV(c.bx - r2, fy, c.bx, c.by),        // rise into pin B
      ];
      return finalize(segs, "same-line",
        [{ x: c.ax, y: c.ay }, { x: c.bx, y: c.by }],
        [fy], [ci], null, null, [], c.variant, [
          [{ rect: expandRect(A.frag, expand), cx: c.ax, cy: c.ay }],
          null,
          [{ rect: expandRect(B.frag, expand), cx: c.bx, cy: c.by }],
        ], [slot.claim]);
    }
    /* no legal cradle → fall through to the margin, never squash */
  }

  /* ── local rail (single-line ideas stay beside their line) ──
   * A one-word tag dragging a dead shoulder across the page to the loom
   * for a 2.5px drip is the worst ink in the grammar. When every anchor
   * shares one rendered line and the cradle declined, try a short rail
   * just left of the phrase group — same pin → turn → shoulder → swoop
   * grammar, the drip pooled inside the corridor. Candidates step 6px
   * outward from the phrase and never enter the loom's own air.
   * Falls through to the margin, never squashes. */
  if (allSameLine && !opts.disableLocal) {
    const members = [...branchesIn].sort((a, b) => a.frag.left - b.frag.left);
    const li = members[0].li, ci = li + 1;
    const localContacts = members.map((m) => pinOf(m.frag));
    const xMinPin = Math.min(...localContacts.map((c) => c.x));
    const xMaxPin = Math.max(...localContacts.map((c) => c.x)) + 1;
    const cy = Math.max(...localContacts.map((c) => c.y));
    const band = corridors[ci];
    const off = SWOOP_REACH + DROP_MIN + 8;
    let planned = null;
    if (band) for (const localX of [xMinPin - off, xMinPin - off - 6, xMinPin - off - 12]) {
      if (localX < loomInner + 6) continue;
      /* LEVEL EXIT first: a lone clear pin continues straight from its
       * underline into the rail — no turn, no dip */
      if (members.length === 1) {
        const c = localContacts[0];
        const levelEnd = members[0].frag.left - expand - 0.6;
        if (levelEnd > localX + 6 && clearRun(c.y, localX + 0.5, levelEnd)) {
          const portY = c.y + SWOOP_DIP;
          const drip = Math.min(2.5, Math.max(1.0, band.bottom - 0.25 - portY));
          const reach = Math.min(SWOOP_REACH, Math.max(4, (c.x - localX) * 0.5));
          const levelClaim = makeCorridorClaim(ci, c.y, localX, c.x, claimPad);
          const dripClaim = makeCorridorClaim(ci, portY + drip / 2, localX, localX, claimPad);
          const fixedClaims = [levelClaim, dripClaim];
          if (fixedClaims.every(Boolean) &&
              !fixedClaims.some((candidate) => claims.some((cl) => corridorClaimsConflict(cl, candidate)))) {
            const plan = finalize([
              L(c.x, c.y, localX + reach, c.y),
              quarterHV(localX + reach, c.y, localX, portY),
              L(localX, portY, localX, portY + drip),
            ], "local-tag", [c], [c.y], [ci], localX, null, [{ x: localX, y: portY }], undefined, [
              [{ rect: expandRect(members[0].frag, expand), cx: c.x, cy: c.y }],
              null, null,
            ], fixedClaims);
            if (plan.valid) {
              plan.diagnostics.exits = ["level"];
              planned = plan;
              break;
            }
          }
        }
      }
      /* the slot needs full dip room AND at least 1px of drip below it */
      const slot = corridorYFor(ci, localX, xMaxPin, cy, true, (y) => {
        const dip = Math.min(SWOOP_DIP, Math.max(0, band.bottom - y - 0.25));
        const room = band.bottom - 0.25 - (y + dip);
        if (room < 1.0) return "drip-room";
        const portY = y + dip;
        const drip = Math.min(2.5, Math.max(1.0, room));
        const dripClaim = makeCorridorClaim(ci, portY + drip / 2, localX, localX, claimPad);
        return dripClaim && !claims.some((cl) => corridorClaimsConflict(cl, dripClaim)) ? true : "claim";
      });
      if (!slot) continue;
      const y = slot.y, dip = slot.dip;
      const portY = y + dip;
      const drip = Math.min(2.5, Math.max(1.0, band.bottom - 0.25 - portY));
      const segsL = [];
      const exemptsL = [];
      let minEndX = Infinity;
      let kinked = false;
      for (const m of [...members].sort((a, b) => b.frag.left - a.frag.left)) {
        const c = pinOf(m.frag);
        const r = y - c.y;
        if (r < DROP_MIN) { kinked = true; break; }
        segsL.push(quarterVH(c.x, c.y, c.x - r, y));
        exemptsL.push([{ rect: expandRect(m.frag, expand), cx: c.x, cy: c.y }]);
        minEndX = Math.min(minEndX, c.x - r);
      }
      if (kinked) continue;
      const reach = Math.min(SWOOP_REACH, Math.max(4, (minEndX - localX) * 0.5));
      if (minEndX <= localX + reach + 1.5) continue;
      segsL.push(L(minEndX, y, localX + reach, y)); exemptsL.push(null);
      segsL.push(quarterHV(localX + reach, y, localX, portY)); exemptsL.push(null);
      segsL.push(L(localX, portY, localX, portY + drip)); exemptsL.push(null);
      const mode = members.length === 1 ? "local-tag" : "local-comb";
      const dripClaim = makeCorridorClaim(ci, portY + drip / 2, localX, localX, claimPad);
      const plan = finalize(segsL, mode, localContacts, [y], [ci], localX, null,
        [{ x: localX, y: portY }], undefined, exemptsL, [slot.claim, dripClaim]);
      if (plan.valid) {
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
  const groups = [];
  for (const b of branchesIn) {
    const g = groups.find((x) => x.li === b.li);
    if (g) g.members.push(b); else groups.push({ li: b.li, members: [b] });
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
    for (const group of groups) group.sectionId = group.members[0].anchor.sectionId;
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
      let shaftPlan = null;
      for (const shaftX of shaftCandidates) {
        /* hard zero-crossing: the shaft clears every crossed line's ink */
        if (crossed.some((l) => shaftX > l.left - expand - 1 && shaftX < l.right + expand + 1)) continue;
        /* per-group approach side: every pin must face the shaft cleanly */
        const sides = groups.map((g) =>
          shaftX >= g.right + DROP_MIN + 2 ? "right" : shaftX <= g.left - DROP_MIN - 2 ? "left" : null);
        if (sides.some((s) => !s)) continue;

        const gs = groups.map((g, i) => ({ ...g, side: sides[i] }));
        const segsM = [], exemptsM = [], contactsM = [], portsM = [], corYs = [], corIdx = [], corClaims = [];
        let ok = true;
        for (const g of gs) {
          const ci = g.li + 1;
          const pins = g.members.map((m) => {
            const f = m.frag;
            return { m, x: (g.side === "right" ? f.right - 0.5 : f.left + 0.5), y: f.bottom + underlineDy };
          });
          const xs = pins.map((p) => p.x);
          const spanA = Math.min(shaftX, ...xs) - 1, spanB = Math.max(shaftX, ...xs) + 1;
          const cy = Math.max(...pins.map((p) => p.y));
          const slot = corridorYFor(ci, spanA, spanB, cy);
          if (!slot) { ok = false; break; }
          const y = slot.y;
          let endX = g.side === "right" ? -Infinity : Infinity;
          for (const p of (g.side === "right" ? [...pins].sort((a, b) => a.x - b.x) : [...pins].sort((a, b) => b.x - a.x))) {
            const r = y - p.y;
            if (r < DROP_MIN) { ok = false; break; }
            contactsM.push({ x: p.x, y: p.y });
            segsM.push(quarterVH(p.x, p.y, g.side === "right" ? p.x + r : p.x - r, y));
            exemptsM.push([{ rect: expandRect(p.m.frag, expand), cx: p.x, cy: p.y }]);
            endX = g.side === "right" ? Math.max(endX, p.x + r) : Math.min(endX, p.x - r);
          }
          if (!ok) break;
          const gapToShaft = Math.abs(shaftX - endX);
          const reach = Math.min(SWOOP_REACH, Math.max(4, gapToShaft * 0.5));
          if (gapToShaft <= reach + 1.5) { ok = false; break; }
          const approachX = g.side === "right" ? shaftX - reach : shaftX + reach;
          segsM.push(L(endX, y, approachX, y)); exemptsM.push(null);
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

  const genMargin = (side, strand, marginGroups = groups, sectionContext = null) => {
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

    const gs = marginGroups.map((g) => ({ ...g }));
    for (const g of gs) {
      /* LEVEL EXIT: when everything between the margin-facing pin and port
       * is genuinely clear, the connector continues straight from the
       * underline — no turn, no dip. The dip grammar is for anchors with
       * ink in the way. Within a group, only the nearest-to-rail member
       * can be clear; the rest comb below in the corridor. */
      const m0 = right
        ? g.members.reduce((best, member) => member.frag.right > best.frag.right ? member : best)
        : g.members[0];
      const c0 = pinOf(m0.frag, side);
      const levelEnd = right ? m0.frag.right + expand + 0.6 : m0.frag.left - expand - 0.6;
      const levelGap = (levelEnd - strandX) * textward;
      const canExitLevel = levelGap > 6 && clearRun(c0.y, strandX + textward * 0.5, levelEnd);
      const levelClaim = canExitLevel
        ? makeCorridorClaim(g.li + 1, c0.y, strandX, c0.x, claimPad)
        : null;
      g.level = canExitLevel && levelClaim &&
        !claims.some((cl) => corridorClaimsConflict(cl, levelClaim))
        ? { c: c0, m: m0, claim: levelClaim } : null;
      const combMembers = g.level
        ? g.members.filter((member) => member !== m0)
        : g.members;
      g.combMembers = combMembers;
      if (combMembers.length) {
        /* bottom pins can only leave downward: the corridor below the
         * group's rendered line is the only legal one. If it cannot host
         * a shoulder, the honest answer is needs-space — never a climb. */
        const ci = g.li + 1;
        const combContacts = combMembers.map((m) => pinOf(m.frag, side));
        const cyC = Math.max(...combContacts.map((c) => c.y));
        const farX = right
          ? Math.min(...combContacts.map((c) => c.x)) - 1
          : Math.max(...combContacts.map((c) => c.x)) + 1;
        const slot = corridorYFor(ci, strandX, farX, cyC);
        if (!slot) return { valid: false, reason: "needs-space" };
        g.ci = ci; g.shoulderY = slot.y; g.dip = slot.dip; g.farX = farX; g.claim = slot.claim;
      } else {
        g.ci = g.li + 1; g.shoulderY = c0.y; g.dip = SWOOP_DIP;
      }
    }
    gs.sort((a, b) => (a.level ? a.level.c.y : a.shoulderY) - (b.level ? b.level.c.y : b.shoulderY));

    const contacts = [];
    const contactOwners = [];
    const centerline = [];
    const exempts = [];  // parallel to centerline: terminal-only ink privileges
    const ports = [];
    const corridorYs = [];
    const corridorIdx = [];
    const corridorClaimsOut = [];

    for (const g of gs) {
      if (g.level) {
        /* the underline runs on: level travel, then the same pour */
        const c = g.level.c;
        const reach = Math.min(SWOOP_REACH, Math.max(4,
          (right ? strandX - c.x : c.x - strandX) * 0.5));
        const approachX = strandX + textward * reach;
        contacts.push(c);
        contactOwners.push({ anchorId: g.level.m.anchor.id });
        centerline.push(L(c.x, c.y, approachX, c.y));
        exempts.push([{ rect: expandRect(g.level.m.frag, expand), cx: c.x, cy: c.y }]);
        centerline.push(quarterHV(approachX, c.y, strandX, c.y + SWOOP_DIP));
        exempts.push(null);
        ports.push({ x: strandX, y: c.y + SWOOP_DIP });
        corridorYs.push(c.y); corridorIdx.push(g.li + 1);
        corridorClaimsOut.push(g.level.claim);
      }
      if (g.combMembers.length) {
        const y = g.shoulderY;
        corridorYs.push(y); corridorIdx.push(g.ci);
        corridorClaimsOut.push(g.claim);
        /* terminals comb from the text toward the margin; right routes are
         * the exact horizontal reflection of the established left grammar */
        let mergeX = right ? -Infinity : Infinity;
        const orderedMembers = [...g.combMembers].sort((a, b) =>
          right ? a.frag.right - b.frag.right : b.frag.left - a.frag.left);
        for (const m of orderedMembers) {
          const c = pinOf(m.frag, side);
          const r = Math.abs(y - c.y);
          if (r < DROP_MIN) return { valid: false, reason: "kink" };
          contacts.push(c);
          contactOwners.push({ anchorId: m.anchor.id });
          const endX = c.x + outward * r;
          centerline.push(quarterVH(c.x, c.y, endX, y));
          exempts.push([{ rect: expandRect(m.frag, expand), cx: c.x, cy: c.y }]);
          mergeX = right ? Math.max(mergeX, endX) : Math.min(mergeX, endX);
        }
        /* shoulder: one hairline through every terminal's merge point */
        const gapToStrand = (mergeX - strandX) * textward;
        const reach = Math.min(SWOOP_REACH, Math.max(4, gapToStrand * 0.5));
        const approachX = strandX + textward * reach;
        centerline.push(L(mergeX, y, approachX, y));
        exempts.push(null);
        /* port: shallow swoop pouring down onto the strand */
        centerline.push(quarterHV(approachX, y, strandX, y + g.dip));
        exempts.push(null);
        ports.push({ x: strandX, y: y + g.dip });
      }
    }

    /* spine: one vertical from first port to last port, never overshooting.
     * Section states deliberately stop at their ports; the topology
     * materializer owns the maximal plural spine and any gap handoff. */
    let spine = null;
    if (sectionContext) {
      // no-op: plural topology connects these arrivals after bounded DP
    } else if (ports.length > 1) {
      const top = Math.min(...ports.map((p) => p.y));
      const bot = Math.max(...ports.map((p) => p.y));
      centerline.push(L(strandX, top, strandX, bot));
      exempts.push(null);
      spine = { x: strandX, top, bottom: bot };
    } else {
      /* single arrival: the swoop ends in a short drip */
      centerline.push(L(strandX, ports[0].y, strandX, ports[0].y + 2.5));
      exempts.push(null);
    }

    const plan = finalize(centerline, mode, contacts, corridorYs, corridorIdx, strandX, spine, ports, undefined, exempts, corridorClaimsOut);
    if (plan.valid) {
      plan.strand = strand;
      plan.side = side;
      plan.diagnostics.laneIndex = strand;
      plan.diagnostics.side = side;
      plan.diagnostics.exits = gs.map((g) => g.level ? (g.combMembers.length ? "level+comb" : "level") : "drop");
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
    }
    return plan;
  };

  const buildSectionTopology = (sectionSides) => {
    if (!sectionMeta.valid) return null;
    const diagnostics = {
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
      opts.sectionRouting?.previousSides ?? [];
    const previousSides = new Map();
    if (previousRaw instanceof Map) {
      for (const [sectionId, side] of previousRaw) previousSides.set(sectionId, side);
    } else if (Array.isArray(previousRaw)) {
      for (const item of previousRaw) if (item?.sectionId) previousSides.set(item.sectionId, item.side);
    } else if (previousRaw && typeof previousRaw === "object") {
      for (const [sectionId, side] of Object.entries(previousRaw)) previousSides.set(sectionId, side);
    }
    const handoffClaims = Array.isArray(opts.handoffClaims) ? opts.handoffClaims : [];
    const statesBySection = [];
    const failures = [];
    const interval = (a, b) => ({ top: Math.min(a, b), bottom: Math.max(a, b) });
    const spineIntervalClaimed = (x, topIn, bottomIn) => {
      const span = interval(topIn, bottomIn);
      return spineClaims.some((claim) => Number.isFinite(claim?.x) &&
        Number.isFinite(claim?.top) && Number.isFinite(claim?.bottom) &&
        Math.abs(claim.x - x) < SPINE_SEP &&
        Math.min(claim.top, claim.bottom) - 2.6 < span.bottom &&
        span.top < Math.max(claim.top, claim.bottom) + 2.6);
    };
    const strandIntervalClaimed = (side, strand, topIn, bottomIn) => {
      const span = interval(topIn, bottomIn);
      return strandClaims.some((claim) => claim?.side === side && claim?.strand === strand &&
        Number.isFinite(claim?.top) && Number.isFinite(claim?.bottom) &&
        Math.min(claim.top, claim.bottom) < span.bottom + 6 &&
        span.top < Math.max(claim.top, claim.bottom) + 6);
    };
    const runIntervalClear = (state, top, bottom) =>
      !spineIntervalClaimed(state.x, top, bottom) &&
      !strandIntervalClaimed(state.side, state.strand, top, bottom);

    for (let sectionOrder = 0; sectionOrder < sectionMeta.sections.length; sectionOrder++) {
      const section = sectionMeta.sections[sectionOrder];
      const sectionGroups = groups.filter((group) => group.sectionId === section.id);
      const sectionBranches = branchesIn.filter((branch) => branch.anchor.sectionId === section.id);
      const sectionLines = lines.filter((line) => line.sectionId === section.id);
      const sectionTextCenter = (Math.min(...sectionLines.map((line) => line.left)) +
        Math.max(...sectionLines.map((line) => line.right))) / 2;
      const semanticCenter = sectionBranches.reduce((sum, branch) =>
        sum + (branch.frag.left + branch.frag.right) / 2, 0) / sectionBranches.length;
      const sectionStates = [];
      for (let sideRank = 0; sideRank < sectionSides.length; sideRank++) {
        const side = sectionSides[sideRank];
        for (let strand = 0; strand < MAX_SECTION_STRANDS; strand++) {
          diagnostics.statesEvaluated++;
          const plan = genMargin(side, strand, sectionGroups, { sectionId: section.id });
          if (!plan.valid || !plan.ports.length) {
            failures.push({ sectionId: section.id, side, strand, why: plan.reason || "no-port" });
            continue;
          }
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

    const makeHandoff = (from, to) => {
      diagnostics.handoffsEvaluated++;
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
      const dy = bottom - top;
      const segment = C(from.x, top, from.x, top + dy / 3, to.x, bottom - dy / 3, to.x, bottom);
      for (const point of segPoints(segment, 1)) {
        if (point.x < gap.left - 1e-6 || point.x > gap.right + 1e-6 ||
            point.y < gap.top - 1e-6 || point.y > gap.bottom + 1e-6 ||
            obstaclesNear(point.y, 2).some((obstacle) => inRect(point.x, point.y, obstacle))) return null;
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
      return { gap, segment, claim, fromY: top, toY: bottom, rawLength: segmentsLength([segment]) };
    };

    const solved = solveSectionStateDP(statesBySection, (previousState, state) => {
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

    const runs = [];
    const stateRun = new Map();
    const annKey = stableIdPart(ann.id);
    for (const state of chosenPath) {
      let run = runs[runs.length - 1];
      if (!run || run.side !== state.side || run.strand !== state.strand) {
        run = { side: state.side, strand: state.strand, railX: state.x, x: state.x, states: [], sectionIds: [] };
        runs.push(run);
      }
      run.states.push(state);
      run.sectionIds.push(state.section.id);
      stateRun.set(state.section.id, run);
    }
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index];
      const sectionKey = run.sectionIds.map(stableIdPart).join("+");
      run.id = `run:${annKey}:${sectionKey}:${run.side}:${run.strand}`;
      run.runIndex = index;
      run.spineId = `spine:${annKey}:${sectionKey}:${run.side}:${run.strand}`;
      const ys = run.states.flatMap((state) => state.plan.ports.map((port) => port.y));
      run.top = Math.min(...ys);
      run.bottom = Math.max(...ys);
    }

    const handoffs = [];
    for (let index = 0; index < chosenTransitions.length; index++) {
      const transition = chosenTransitions[index];
      if (transition.kind !== "handoff") continue;
      const fromState = chosenPath[index], toState = chosenPath[index + 1];
      const fromRun = stateRun.get(fromState.section.id), toRun = stateRun.get(toState.section.id);
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
        _segment: transition.handoff.segment,
        claim: transition.handoff.claim,
      });
    }

    const centerline = [];
    const exempts = [];
    const routeParts = [];
    let segmentOrdinal = 0;
    const own = (segment, metadata) => ({ ...segment, id: `segment:${annKey}:${segmentOrdinal++}`, ...metadata });
    for (const state of chosenPath) {
      const run = stateRun.get(state.section.id);
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
    const spines = runs.map((run) => {
      const spine = {
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
      const segment = own(handoff._segment, {
        role: "handoff", ownerId: handoff.id, handoffId: handoff.id,
        fromRunId: handoff.fromRunId, toRunId: handoff.toRunId,
      });
      delete handoff._segment;
      handoff.segments = [segment];
      centerline.push(segment); exempts.push(null);
      routeParts.push({ id: `part:${stableIdPart(handoff.id)}`, role: "handoff", ownerId: handoff.id, handoffId: handoff.id, segments: [segment] });
    }

    for (const spine of spines) {
      if (spineIntervalClaimed(spine.x, spine.top, spine.bottom)) {
        /* This is an invariant check: DP state/transition feasibility must
         * have rejected the occupied run before topology selection. */
        return { valid: false, reason: "spine-separation", diagnostics, failures };
      }
    }
    const corridorClaimsOut = [];
    const contacts = [];
    const contactIdByAnchor = new Map();
    for (const state of chosenPath) {
      const run = stateRun.get(state.section.id);
      state.plan.claimsOut.forEach((claim, index) => corridorClaimsOut.push({
        ...claim,
        id: `corridor-claim:${annKey}:${stableIdPart(state.section.id)}:${index}`,
        ownerRunId: run.id,
        sectionId: state.section.id,
      }));
      state.plan.contacts.forEach((contact, index) => {
        const owner = state.plan._contactOwners[index];
        const id = `contact:${annKey}:${stableIdPart(owner.anchorId)}`;
        contacts.push({
          ...contact, id, role: "terminal-contact", ownerId: run.id, runId: run.id,
          spineId: run.spineId, sectionId: state.section.id, anchorId: owner.anchorId,
        });
        contactIdByAnchor.set(owner.anchorId, id);
      });
    }
    const ports = [];
    for (const state of chosenPath) {
      const run = stateRun.get(state.section.id);
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
    if (!finalized.valid) return { ...finalized, diagnostics: { ...diagnostics, finalize: finalized.diagnostics } };

    const spineClaimsOut = spines.map((spine) => ({
      id: `claim:${stableIdPart(spine.id)}`, ownerRunId: spine.ownerRunId, side: spine.side, strand: spine.strand,
      x: spine.x, top: spine.top, bottom: spine.bottom,
    }));
    const strandClaimsOut = runs.map((run) => ({
      id: `strand-claim:${stableIdPart(run.id)}`, ownerRunId: run.id, side: run.side, strand: run.strand,
      top: run.top, bottom: run.bottom,
    }));
    const handoffClaimsOut = handoffs.map((handoff) => ({ ...handoff.claim, id: `claim:${stableIdPart(handoff.id)}`, ownerHandoffId: handoff.id }));
    handoffs.forEach((handoff, index) => {
      handoff.claimOut = handoffClaimsOut[index];
      delete handoff.claim;
    });
    for (const run of runs) {
      run.corridorClaimIds = corridorClaimsOut
        .filter((claim) => claim.ownerRunId === run.id)
        .map((claim) => claim.id);
      run.spineClaimId = spineClaimsOut.find((claim) => claim.ownerRunId === run.id)?.id;
      run.strandClaimId = strandClaimsOut.find((claim) => claim.ownerRunId === run.id)?.id;
      const partClaims = new Map();
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
      const run = stateRun.get(anchor.sectionId);
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
    const result = {
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
        ? { marginStart: runs[0].top, marginEnd: runs[0].bottom }
        : {},
      rawLength,
      scoreRaw: chosen.scoreRaw,
      score: chosen.score,
      diagnostics: {
        ...finalized.diagnostics,
        side: runs.length === 1 ? runs[0].side : "mixed",
        laneIndex: runs.length === 1 ? runs[0].strand : null,
        score: chosen.score,
        sectionRouting: { status: "selected", topologySignature },
        dp: diagnostics,
        stateFailures: failures,
      },
    };
    if (runs.length === 1) {
      const run = runs[0], spine = spines[0];
      result.side = run.side;
      result.strand = run.strand;
      result.marginRailX = run.railX;
      result.spine = spine;
      result.spineClaimOut = spineClaimsOut[0];
      result.strandClaimOut = strandClaimsOut[0];
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
  const sides = [];
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
  const candidates = [];
  const failReasons = [];
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
  const sideOrder = new Map(sides.map((side, index) => [side, index]));
  candidates.sort((a, b) => {
    /* The scorer's 0.1px quantization is deliberate calm: sub-tenth
     * measurement noise is a tie, so requested-side order owns it. */
    const scoreDelta = a.score - b.score;
    if (scoreDelta) return scoreDelta;
    return sideOrder.get(a.side) - sideOrder.get(b.side) ||
      (a.strand ?? 9) - (b.strand ?? 9);
  });
  const best = candidates[0];
  best.diagnostics.score = best.score;
  best.diagnostics.alternativesConsidered = candidates.slice(1).map((c) => ({
    side: c.side, strand: c.strand, score: c.score,
  }));
  return best;

  /* ── shared finish: sample, validate, diagnose ──
   * Ink privileges are ownership-scoped: a terminal segment may pass
   * through its OWN fragment's expanded rect (and the departure wedge at
   * its own pin, where neighbor expansions unavoidably overlap); every
   * other segment — floors, shoulders, swoops, spines, drips — must be
   * genuinely clear of everything. */
  function finalize(segs, mode, contacts, corridorYs, corridorIdx, railXOut, spine, ports, cradleVariant, exempts, corridorClaimsOut) {
    const normalizedClaims = [];
    for (const claim of corridorClaimsOut || []) {
      const normalized = normalizeCorridorClaim(claim);
      if (!normalized) return fail("nan", { claim });
      normalizedClaims.push(normalized);
    }
    const sampled = [];
    segs.forEach((s, si) => {
      const ex = exempts ? exempts[si] : null;
      for (const p of segPoints(s, 1)) {
        if (ex) p.ex = ex;
        sampled.push(p);
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
          const excused = p.ex && p.ex.some((e) =>
            inRect(p.x, p.y, e.rect) || Math.hypot(p.x - e.cx, p.y - e.cy) < expand + 1);
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
        : corridorYs.length ? { marginStart: corridorYs[0], marginEnd: corridorYs[0] } : {},
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
export function rankCompanions(intervals, focusId) {
  const f = intervals.find((i) => i.id === focusId);
  if (!f) return intervals.map((i) => i.id);
  const dist = (i) => (i.top > f.bottom ? i.top - f.bottom : f.top > i.bottom ? f.top - i.bottom : 0);
  const span = (i) => i.bottom - i.top;
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
export function assignStrands(anns, maxStrands = 3) {
  const out = new Map();
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
