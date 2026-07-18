/* route-engine.js — obstacle-aware annotation routing. Pure geometry:
 * measured layout in, RoutePlan out. No DOM access, no styling.
 *
 * Implements the multipoint marginalia routing contract:
 *   underline → dot → vertical terminal turn → interline shoulder
 *   → rounded margin turn → margin spine
 * Hard constraints (never traded away): no sampled point may enter an
 * expanded text/number obstacle (outside the terminal exemption);
 * horizontal travel only in verified corridors; long verticals only on
 * the margin rail; every join tangent-continuous. */

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
/* quarter-turn cubic between a vertical tangent at (x1,y1) and a
 * horizontal tangent at (x2,y2) — or the reverse. */
function quarterVH(x1, y1, x2, y2) {
  return C(x1, y1, x1, y1 + KAPPA * (y2 - y1), x2 - KAPPA * (x2 - x1), y2, x2, y2);
}
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
    const approx = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 1.4;
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

/* ── the planner ───────────────────────────────────────────── */
/* block: TextBlock (measured), ann: Annotation, opts: {fontSize,
 * underlineDy, laneIndex, lanePitch, envelope} */
export function planRoute(block, ann, opts = {}) {
  const fontSize = opts.fontSize || 17;
  const clearance = Math.max(2.5, fontSize * 0.12);
  const halfEnv = (opts.envelope || 5) / 2;
  const expand = clearance + halfEnv;
  const underlineDy = opts.underlineDy ?? 2;
  const laneIndex = opts.laneIndex || 0;
  const lanePitch = opts.lanePitch || 9;

  const fail = (reason) => ({ valid: false, reason, laneIndex });

  const lines = [...block.renderedLines].sort((a, b) => a.top - b.top);
  if (!lines.length) return fail("no-rendered-lines");
  const obstacles = [
    ...lines,
    ...(block.verseNumberRects || []),
    ...(block.additionalObstacles || []),
  ].map((r) => expandRect(r, expand));

  /* corridors: the whitespace band between consecutive rendered lines,
   * plus overscan bands above the first and below the last */
  const corridors = [];
  const first = expandRect(lines[0], expand);
  corridors.push({ top: first.top - 3 * halfEnv, bottom: first.top, above: -1, below: 0 });
  for (let i = 0; i < lines.length - 1; i++) {
    // the expansion already reserves clearance + half the envelope on
    // each side, so a corridor is legal when any band remains at all
    const a = expandRect(lines[i], expand), b = expandRect(lines[i + 1], expand);
    if (b.top - a.bottom >= 1) corridors.push({ top: a.bottom, bottom: b.top, above: i, below: i + 1 });
    else corridors.push(null); // gap too small — not a legal corridor
  }
  const last = expandRect(lines[lines.length - 1], expand);
  corridors.push({ top: last.bottom, bottom: last.bottom + 3 * halfEnv, above: lines.length - 1, below: -1 });

  const cornerR = Math.min(opts.preferredRadius || 6, (block.lineHeight || 26) * 0.35);

  const lineIndexOf = (frag) => {
    const cy = (frag.top + frag.bottom) / 2;
    let best = 0, bd = Infinity;
    lines.forEach((ln, i) => {
      const d = Math.abs((ln.top + ln.bottom) / 2 - cy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  /* a horizontal run at y over [xa,xb] is legal when it clears every
   * expanded obstacle; nudge y inside the corridor band if needed */
  const clearRun = (y, xa, xb) =>
    !obstacles.some((o) => y > o.top && y < o.bottom && Math.min(xa, xb) < o.right && Math.max(xa, xb) > o.left);
  const corridorYFor = (band, xa, xb) => {
    if (!band) return null;
    const mid = (band.top + band.bottom) / 2;
    for (const dy of [0, -1.5, 1.5, -3, 3, -4.5, 4.5]) {
      const y = mid + dy;
      if (y < band.top + 0.5 || y > band.bottom - 0.5) continue;
      if (clearRun(y, xa, xb)) return y;
    }
    return null;
  };

  /* anchors → primary fragments and contacts (left margin route) */
  const sorted = [...ann.anchors].sort((a, b) => {
    const ta = Math.min(...a.fragments.map((f) => f.top));
    const tb = Math.min(...b.fragments.map((f) => f.top));
    return ta - tb || a.documentOrder - b.documentOrder;
  });
  const branchesIn = sorted.map((a) => {
    const frag = [...a.fragments].sort((f, g) => f.top - g.top || f.left - g.left)[0];
    return { anchor: a, frag, li: lineIndexOf(frag) };
  });

  /* ── same-line cradle ── */
  const allSameLine = branchesIn.every((b) => b.li === branchesIn[0].li);
  if (allSameLine && branchesIn.length === 2) {
    const [A, B] = [...branchesIn].sort((a, b) => a.frag.left - b.frag.left);
    const ax = A.frag.right - 0.75, bx = B.frag.left + 0.75;
    const ay = A.frag.bottom + underlineDy, by = B.frag.bottom + underlineDy;
    const band = corridors[A.li + 1];
    const fy = band ? corridorYFor(band, ax, bx) : null;
    if (fy !== null && bx - ax > 14) {
      const r = Math.min(5, (fy - ay) - 0.5, (bx - ax) / 2 - 2);
      if (r >= 2.5) {
        const floorY = fy;
        const segs = [
          L(ax, ay, ax, floorY - r),
          quarterVH(ax, floorY - r, ax + r, floorY),
          L(ax + r, floorY, bx - r, floorY),
          quarterVH(bx, floorY - r, bx - r, floorY), // reversed below
        ];
        // build the reversed exit turn properly: horizontal → vertical up
        segs[3] = C(bx - r, floorY, bx - r + KAPPA * r, floorY, bx, floorY - KAPPA * (floorY - by) * 0 - r * (1 - KAPPA), bx, floorY - r);
        segs.push(L(bx, floorY - r, bx, by));
        return finalize(segs, "same-line", [{ x: ax, y: ay }, { x: bx, y: by }], [floorY], null);
      }
    }
    // fall through to margin route when the cradle cannot fit
  }

  /* ── margin route (corridor / multipoint) ──
   * group same-line anchors onto one shoulder; every group gets a
   * corridor; all shoulders join one margin rail. */
  const groups = [];
  for (const b of branchesIn) {
    const g = groups.find((x) => x.li === b.li);
    if (g) g.members.push(b); else groups.push({ li: b.li, members: [b] });
  }
  for (const g of groups) {
    g.members.sort((a, b) => a.frag.left - b.frag.left);
    g.xMax = Math.max(...g.members.map((m) => m.frag.left)) + 4;
  }

  /* rail: left of every expanded obstacle the spine passes */
  const probeTop = Math.min(...groups.map((g) => lines[g.li].top)) - 30;
  const probeBot = Math.max(...groups.map((g) => lines[g.li].bottom)) + 30;
  let minLeft = Infinity;
  for (const o of obstacles) if (o.bottom > probeTop && o.top < probeBot) minLeft = Math.min(minLeft, o.left);
  if (!isFinite(minLeft)) minLeft = block.bounds.left + 40;
  const railX = minLeft - 2 - laneIndex * lanePitch;
  if (railX < block.bounds.left - (block.availableLeftMargin ?? 60)) return fail("needs-space");

  /* per-group corridor + shoulder */
  for (const g of groups) {
    let band = corridors[g.li + 1], y = band ? corridorYFor(band, railX, g.xMax) : null;
    if (y === null) { band = corridors[g.li]; y = band ? corridorYFor(band, railX, g.xMax) : null; g.above = true; }
    if (y === null) return fail("needs-space");
    g.shoulderY = y;
  }
  groups.sort((a, b) => a.shoulderY - b.shoulderY);

  const contacts = [];
  const branchSegs = [];
  for (const g of groups) {
    const segs = [];
    let prevX = null;
    for (const m of [...g.members].sort((a, b) => b.frag.left - a.frag.left)) {
      const cx = m.frag.left + 0.75;
      const cy = m.frag.bottom + underlineDy;
      contacts.push({ x: cx, y: cy });
      const dir = g.shoulderY > cy ? 1 : -1;
      const drop = Math.abs(g.shoulderY - cy);
      const r = Math.min(cornerR, drop, 8);
      if (r < 2) return fail("kink");
      // terminal: vertical leg then quarter turn toward the margin
      segs.push(L(cx, cy, cx, g.shoulderY - dir * r));
      segs.push(quarterVH(cx, g.shoulderY - dir * r, cx - r, g.shoulderY));
      if (prevX !== null) segs.push(L(prevX, g.shoulderY, cx - r, g.shoulderY));
      prevX = cx - r;
    }
    // shoulder continues from the leftmost turn to the rail port
    segs.push(L(prevX, g.shoulderY, railX + cornerR, g.shoulderY));
    branchSegs.push({ g, segs });
  }

  /* spine between first and last ports, joined with rounded corners */
  const centerline = [];
  const yPorts = groups.map((g) => g.shoulderY);
  const spineTop = Math.min(...yPorts), spineBot = Math.max(...yPorts);
  branchSegs.forEach(({ g, segs }, i) => {
    centerline.push(...segs);
    const goingDown = g.shoulderY < spineBot;
    if (groups.length === 1) return;
    if (i === 0) {
      centerline.push(quarterHV(railX + cornerR, g.shoulderY, railX, g.shoulderY + cornerR));
    } else if (i === groups.length - 1) {
      centerline.push(quarterHV(railX + cornerR, g.shoulderY, railX, g.shoulderY - cornerR));
    } else {
      // middle branch: a rounded port touching the spine
      centerline.push(quarterHV(railX + cornerR, g.shoulderY, railX, g.shoulderY + (goingDown ? cornerR : -cornerR)));
    }
  });
  const spine = groups.length > 1
    ? [L(railX, spineTop + cornerR, railX, spineBot - cornerR)]
    : null;
  if (spine) centerline.push(...spine);

  const mode = ann.anchors.length > 2 || groups.length > 2 ? "multipoint" : "corridor";
  return finalize(centerline, mode, contacts, groups.map((g) => g.shoulderY), railX);

  /* ── shared finish: sample, validate, diagnose ── */
  function finalize(segs, mode, contacts, corridorYs, railXOut) {
    const sampled = [];
    for (const s of segs) sampled.push(...segPoints(s, 1));
    for (const p of sampled) {
      if (!isFinite(p.x) || !isFinite(p.y)) return fail("nan");
    }
    // hard constraint: no sample inside an expanded obstacle, except the
    // terminal exemption around each contact
    let minClear = Infinity;
    for (const p of sampled) {
      const exempt = contacts.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < expand + 3);
      for (const o of obstacles) {
        if (!exempt && inRect(p.x, p.y, o)) return fail("obstacle-collision");
        const dx = Math.max(o.left - p.x, 0, p.x - o.right);
        const dy = Math.max(o.top - p.y, 0, p.y - o.bottom);
        if (!inRect(p.x, p.y, o)) minClear = Math.min(minClear, Math.hypot(dx, dy));
      }
    }
    return {
      valid: true,
      side: "left",
      mode,
      contacts,
      corridors: corridorYs,
      marginRailX: railXOut,
      centerline: segs,
      sampledPoints: sampled,
      spine: railXOut != null ? [{ x: railXOut, top: Math.min(...corridorYs), bottom: Math.max(...corridorYs) }] : null,
      markerRanges: railXOut != null
        ? { marginStart: Math.min(...corridorYs), marginEnd: Math.max(...corridorYs) }
        : {},
      diagnostics: {
        minimumClearance: Math.round(minClear * 100) / 100,
        intersections: 0,
        cornerRadii: segs.filter((s) => s.type === "C").map(() => cornerRadiiOf(segs)),
        totalLength: Math.round(segmentsLength(segs)),
        laneIndex,
      },
    };
  }
  function cornerRadiiOf() { return Math.round(cornerR * 10) / 10; }
}

/* ── stable interval lane assignment ───────────────────────── */
/* anns: [{id, top, bottom, focused}] → Map id → laneIndex.
 * Focused gets lane 0; held stack outward in deterministic order;
 * disjoint intervals may share a lane. */
export function assignLanes(anns, maxLanes = 4) {
  const out = new Map();
  const order = [...anns].sort((a, b) =>
    (a.focused === b.focused ? a.top - b.top || (a.id < b.id ? -1 : 1) : a.focused ? -1 : 1));
  for (const a of order) {
    let lane = a.focused ? 0 : 1;
    for (;;) {
      const clash = order.some((o) =>
        o !== a && out.has(o.id) && out.get(o.id) === lane &&
        o.top < a.bottom + 6 && a.top < o.bottom + 6);
      if (!clash) break;
      lane++;
    }
    if (lane >= maxLanes) out.set(a.id, -1); // progressive disclosure
    else out.set(a.id, lane);
  }
  return out;
}

export const _internals = { quarterVH, quarterHV, segPoints, expandRect, KAPPA };
