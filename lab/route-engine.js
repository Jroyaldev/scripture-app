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

/* ── the planner ───────────────────────────────────────────── */
/* block: TextBlock (measured), ann: Annotation.
 * opts: { fontSize, envelope, underlineDy, strandIndex, strandPitch,
 *         corridorClaims: [{corridor, y}], loomAir } */
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
  corridors.push({ top: first.top - 6, bottom: first.top, above: -1, below: 0 });
  for (let i = 0; i < lines.length - 1; i++) {
    const a = expandRect(lines[i], expand), b = expandRect(lines[i + 1], expand);
    corridors.push(b.top - a.bottom >= BAND_MIN
      ? { top: a.bottom, bottom: b.top, above: i, below: i + 1 } : null);
  }
  const last = expandRect(lines[lines.length - 1], expand);
  corridors.push({ top: last.bottom, bottom: last.bottom + 6, above: lines.length - 1, below: -1 });

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
      let why = null;
      if (!clearRun(y, xa, xb)) why = "obstacle";
      else if (claims.some((cl) => cl.corridor === ci &&
        Math.abs(cl.y - y) < CLAIM_GAP + claimPad + (cl.pad || 0))) why = "claim";
      else if (fits) {
        const verdict = fits(y);
        if (verdict !== true) why = verdict || "fits";
      }
      if (!why) return { y, dip: Math.min(SWOOP_DIP, Math.max(0, band.bottom - y - 0.25)) };
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
  const pinOf = (frag) => ({ x: frag.left + 0.5, y: frag.bottom + underlineDy });

  /* ── loom strand x ──
   * The loom is a passage-level datum: one inner edge computed from EVERY
   * obstacle in the block (the widest intrusion wins), never per
   * annotation — two annotations on strand k must land on the same x.
   * The host may pin it explicitly via opts.loomX. */
  let minLeft = Infinity;
  for (const o of obstacles) minLeft = Math.min(minLeft, o.left);
  if (!isFinite(minLeft)) minLeft = block.bounds.left + 40;
  const loomInner = opts.loomX ?? (minLeft - loomAir);
  const strandX = loomInner - strandIndex * strandPitch;
  if (strandX < block.bounds.left - (block.availableLeftMargin ?? 60)) return fail("needs-space");
  if (strandX < block.bounds.left + 4) return fail("needs-space");

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
        ]);
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
      /* the slot needs full dip room AND at least 1px of drip below it */
      const slot = corridorYFor(ci, localX, xMaxPin, cy, true, (y) =>
        band.bottom - 0.25 - (y + Math.min(SWOOP_DIP, band.bottom - y - 0.25)) >= 1.0 ? true : "drip-room");
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
      const plan = finalize(segsL, mode, localContacts, [y], [ci], localX, null,
        [{ x: localX, y: portY }], undefined, exemptsL);
      if (plan.valid) {
        /* dual claims: the shoulder AND the drip zone hold the corridor */
        plan.claimsOut.push({ corridor: ci, y: portY + drip / 2, pad: claimPad });
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
   * shoulder; every shoulder swoops into the strand. */
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

  for (const g of groups) {
    /* bottom pins can only leave downward: the corridor below the group's
     * rendered line is the only legal one. If it cannot host a shoulder,
     * the honest answer is needs-space — never a climb through the line. */
    const ci = g.li + 1, slot = corridorYFor(ci, strandX, g.xMax, g.cy);
    if (!slot) return fail("needs-space");
    g.ci = ci; g.shoulderY = slot.y; g.dip = slot.dip;
  }
  groups.sort((a, b) => a.shoulderY - b.shoulderY);

  const contacts = [];
  const centerline = [];
  const exempts = [];  // parallel to centerline: terminal-only ink privileges
  const ports = [];
  const corridorYs = [];
  const corridorIdx = [];

  try {
    groups.forEach((g, gi) => {
    const y = g.shoulderY;
    corridorYs.push(y); corridorIdx.push(g.ci);
    /* terminals: pins comb into the shoulder, right to left */
    let minEndX = Infinity;
    for (const m of [...g.members].sort((a, b) => b.frag.left - a.frag.left)) {
      const c = pinOf(m.frag);
      const r = Math.abs(y - c.y);
      if (r < DROP_MIN) throw { kink: true };
      contacts.push(c);
      centerline.push(quarterVH(c.x, c.y, c.x - r, y));
      exempts.push([{ rect: expandRect(m.frag, expand), cx: c.x, cy: c.y }]);
      minEndX = Math.min(minEndX, c.x - r);
    }
    /* shoulder: one hairline through every terminal's merge point */
    const reach = Math.min(SWOOP_REACH, Math.max(4, (minEndX - strandX) * 0.5));
    centerline.push(L(minEndX, y, strandX + reach, y));
    exempts.push(null);
    /* port: shallow swoop pouring down onto the strand */
    const dip = g.dip;
    centerline.push(quarterHV(strandX + reach, y, strandX, y + dip));
    exempts.push(null);
    ports.push({ x: strandX, y: y + dip });
    g.portY = y + dip;
    });
  } catch (e) {
    if (e && e.kink) return fail("kink");
    throw e;
  }

  /* spine: one vertical from first port to last port, never overshooting */
  let spine = null;
  if (groups.length > 1) {
    const top = Math.min(...groups.map((g) => g.portY));
    const bot = Math.max(...groups.map((g) => g.portY));
    centerline.push(L(strandX, top, strandX, bot));
    exempts.push(null);
    spine = { x: strandX, top, bottom: bot };
  } else {
    /* single-group arrival: the swoop ends in a short drip */
    const g = groups[0];
    centerline.push(L(strandX, g.portY, strandX, g.portY + 2.5));
    exempts.push(null);
  }

  const mode = ann.anchors.length === 1 ? "tag"
    : groups.length > 1 ? (ann.anchors.length > 2 || groups.length > 2 ? "multipoint" : "corridor")
    : "corridor";

  return finalize(centerline, mode, contacts, corridorYs, corridorIdx, strandX, spine, ports, undefined, exempts);

  /* ── shared finish: sample, validate, diagnose ──
   * Ink privileges are ownership-scoped: a terminal segment may pass
   * through its OWN fragment's expanded rect (and the departure wedge at
   * its own pin, where neighbor expansions unavoidably overlap); every
   * other segment — floors, shoulders, swoops, spines, drips — must be
   * genuinely clear of everything. */
  function finalize(segs, mode, contacts, corridorYs, corridorIdx, railXOut, spine, ports, cradleVariant, exempts) {
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
      claimsOut: corridorIdx.map((ci, i) => ({ corridor: ci, y: corridorYs[i], pad: claimPad })),
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

export const _internals = { quarterVH, quarterHV, segPoints, expandRect, KAPPA };
