/* route-lab.js — measurement, fixtures, rendering, and the validation
 * suite for route-engine.js (Loom). The engine never touches the DOM;
 * this file measures real rendered text, hands it over, and draws the
 * plan under one paradigm: one solid line type for every thread — the
 * focused thread in its kind hue at full strength, at most two woven
 * companions in quiet ink, and every other annotation as whisper
 * underline + one held-rail tick. Corridor claims and strand budget
 * belong only to threads that paint. */
import { planRoute, assignStrands } from "./route-engine.js";

const SVGNS = "http://www.w3.org/2000/svg";
const HUES = {
  parallel: "var(--k-parallel)", contrast: "var(--k-contrast)", echo: "var(--k-echo)",
  hinge: "var(--k-hinge)", mirror: "var(--k-mirror)", series: "var(--k-series)", note: "var(--k-note)",
};
const INK = "var(--thread-ink)";
const MAX_STRANDS = 3;

/* ── fixtures: the contract's matrix plus the tag case ── */
const FIXTURES = [
  { id: "far-pair", name: "left pair · 5 lines", kind: "parallel",
    keys: [{ ref: "PSA.1.1", phrase: "Blessed is the man" }, { ref: "PSA.1.6", phrase: "the way of the wicked" }] },
  { id: "same-line", name: "same rendered line", kind: "hinge",
    keys: [{ ref: "PSA.1.6", phrase: "the way of the righteous" }, { ref: "PSA.1.6", phrase: "the way of the wicked" }] },
  { id: "note-tag", name: "single anchor · tag", kind: "note",
    keys: [{ ref: "PSA.1.2", phrase: "his delight" }] },
  { id: "mid-right-1", name: "middle → later, 1 line", kind: "contrast",
    keys: [{ ref: "PSA.1.1", phrase: "the counsel of the wicked" }, { ref: "PSA.1.2", phrase: "day and" }] },
  { id: "mid-right-far", name: "middle → far, 6+ lines", kind: "echo",
    keys: [{ ref: "GEN.1.3", phrase: "Let there be light" }, { ref: "GEN.1.14", phrase: "Let there be lights" }] },
  { id: "reversed", name: "reversed anchor order", kind: "contrast",
    keys: [{ ref: "PSA.1.4", phrase: "the chaff" }, { ref: "PSA.1.3", phrase: "streams of water" }] },
  { id: "tri", name: "3 anchors", kind: "series",
    keys: [{ ref: "GEN.1.10", phrase: "God saw that it was good" }, { ref: "GEN.1.12", phrase: "God saw that it was good" }, { ref: "GEN.1.18", phrase: "God saw that it was good" }] },
  { id: "five", name: "5 anchors", kind: "series",
    keys: [3, 6, 9, 11, 14].map((v) => ({ ref: `GEN.1.${v}`, phrase: "God said" })) },
  { id: "ten", name: "10 anchors", kind: "series",
    keys: [3, 6, 9, 11, 14, 20, 24, 26, 28, 29].map((v) => ({ ref: `GEN.1.${v}`, phrase: "God said" })) },
  { id: "same-line-multi", name: "several on one line", kind: "parallel",
    keys: [{ ref: "GEN.1.11", phrase: "grass" }, { ref: "GEN.1.11", phrase: "herbs" }, { ref: "GEN.1.11", phrase: "fruit trees" }] },
  { id: "wrapped", name: "phrase that wraps", kind: "echo",
    keys: [{ ref: "GEN.1.14", phrase: "in the expanse of the sky to divide the day from the night" }, { ref: "GEN.1.15", phrase: "lights in the expanse" }] },
  { id: "first-last", name: "first ↔ last block line", kind: "mirror",
    keys: [{ ref: "PSA.1.1", phrase: "walk" }, { ref: "GEN.2.3", phrase: "God blessed the seventh day" }] },
];

/* ── build the text block ──────────────────────────────────── */
const sheet = document.getElementById("sheet");
function buildSheet() {
  sheet.innerHTML = "";
  const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = "Loom · Psalm 1 + Creation";
  const r = document.createElement("div"); r.className = "sheet-ref"; r.textContent = "PSA.1 · GEN.1.1–2.3 · WEB · engine fixture";
  sheet.append(t, r);
  const chapters = [["Psalm 1", "PSA.1"], ["Genesis 1", "GEN.1"], ["Genesis 2", "GEN.2"]];
  for (const [head, key] of chapters) {
    const h = document.createElement("div"); h.className = "chap-head"; h.textContent = head;
    sheet.appendChild(h);
    for (const v of VERSES[key]) {
      const ref = `${key}.${v.verse}`;
      const row = document.createElement("div"); row.className = "vrow"; row.dataset.ref = ref;
      const num = document.createElement("span"); num.className = "vnum"; num.textContent = v.verse;
      const txt = document.createElement("span"); txt.className = "vtext";
      const marks = [];
      for (const f of FIXTURES) f.keys.forEach((k, ki) => {
        if (k.ref !== ref) return;
        const idx = v.text.indexOf(k.phrase);
        if (idx >= 0) marks.push({ start: idx, end: idx + k.phrase.length, fid: f.id, ki });
      });
      marks.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const m of marks) {
        const same = merged.find((x) => x.start === m.start && x.end === m.end);
        if (same) same.tokens.push(`${m.fid}:${m.ki}`);
        else merged.push({ start: m.start, end: m.end, tokens: [`${m.fid}:${m.ki}`] });
      }
      let pos = 0;
      for (const m of merged) {
        if (m.start < pos) continue;
        if (m.start > pos) txt.appendChild(document.createTextNode(v.text.slice(pos, m.start)));
        const sp = document.createElement("span");
        sp.className = "anchor"; sp.dataset.tokens = m.tokens.join(" ");
        sp.textContent = v.text.slice(m.start, m.end);
        txt.appendChild(sp);
        pos = m.end;
      }
      txt.appendChild(document.createTextNode(v.text.slice(pos)));
      row.append(num, txt);
      sheet.appendChild(row);
    }
  }
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "overlay");
  sheet.appendChild(svg);
}

/* ink slack: how much leading a Range client rect carries beyond real glyph
 * ink, measured from canvas TextMetrics for the element's own font. Chrome's
 * selection rects span the font box (ascent+descent), not the line box; the
 * flat ±2.2 constant over-tightened below the baseline and under-tightened
 * above it, which cramped every corridor. */
function inkSlack(el) {
  const cs = getComputedStyle(el);
  const key = `${cs.fontWeight}|${cs.fontSize}|${cs.fontFamily}`;
  if (inkSlack._key === key) return inkSlack._val;
  const ctx = (inkSlack._canvas || (inkSlack._canvas = document.createElement("canvas"))).getContext("2d");
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText("Mahglpqy");
  const val = {
    top: Math.max(0, m.fontBoundingBoxAscent - m.actualBoundingBoxAscent),
    bottom: Math.max(0, m.fontBoundingBoxDescent - m.actualBoundingBoxDescent),
  };
  inkSlack._key = key; inkSlack._val = val;
  return val;
}

/* merge client rects whose vertical centers sit within 2px */
function mergeByLine(rects, tol = 2) {
  const out = [];
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const cy = (r.top + r.bottom) / 2;
    const hit = out.find((o) => Math.abs((o.top + o.bottom) / 2 - cy) <= tol);
    if (hit) {
      hit.left = Math.min(hit.left, r.left); hit.right = Math.max(hit.right, r.right);
      hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom);
    } else out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  return out;
}

function measure() {
  const base = sheet.getBoundingClientRect();
  const rel = (r) => ({ left: r.left - base.left, right: r.right - base.left, top: r.top - base.top, bottom: r.bottom - base.top });
  const slack = inkSlack(sheet.querySelector(".vtext"));
  const lineRects = [];
  sheet.querySelectorAll(".vtext").forEach((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) lineRects.push(rel(r));
  });
  /* obstacles are ink, not line boxes: Range rects include leading */
  const renderedLines = mergeByLine(lineRects).map((r) => ({
    left: r.left, right: r.right, top: r.top + slack.top, bottom: r.bottom - slack.bottom,
  }));
  /* measure number glyphs — a grid-stretched span lies about its box */
  const verseNumberRects = [...sheet.querySelectorAll(".vnum")].map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getClientRects()[0] || el.getBoundingClientRect();
    return rel(r);
  });
  const additionalObstacles = [...sheet.querySelectorAll(".chap-head, .sheet-title, .sheet-ref")]
    .map((el) => rel(el.getBoundingClientRect()));
  const fontSize = parseFloat(getComputedStyle(sheet.querySelector(".vtext")).fontSize);
  const lineHeight = parseFloat(getComputedStyle(sheet.querySelector(".vtext")).lineHeight);
  const block = {
    bounds: rel(base),
    renderedLines, verseNumberRects, additionalObstacles,
    lineHeight,
    preferredMargin: "left",
    availableLeftMargin: 116,
    availableRightMargin: 24,
  };
  const annotations = FIXTURES.map((f) => {
    const anchors = [];
    f.keys.forEach((k, ki) => {
      const spans = [...sheet.querySelectorAll(`.anchor[data-tokens~="${f.id}:${ki}"]`)];
      if (!spans.length) return;
      const rects = [];
      for (const sp of spans) for (const r of sp.getClientRects()) rects.push(rel(r));
      /* fragments are ink, not line boxes — underlines and pins hang from
       * glyph extents; a leading-inflated bottom puts the pin in the
       * corridor and corrupts every drop calculation downstream */
      anchors.push({
        id: `${f.id}:${ki}`,
        fragments: mergeByLine(rects).map((r) => ({ left: r.left, right: r.right, top: r.top + slack.top, bottom: r.bottom - slack.bottom })),
        documentOrder: ki,
      });
    });
    return { id: f.id, anchors, kind: f.kind, focused: false, fixture: f };
  }).filter((a) => a.anchors.length >= 1);
  return { block, annotations, fontSize };
}

/* ── svg helpers ───────────────────────────────────────────── */
function S(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
function pathD(segs) {
  let d = "", cx = null, cy = null;
  for (const s of segs) {
    if (cx === null || Math.hypot(s.x1 - cx, s.y1 - cy) > 0.35) d += `M ${s.x1.toFixed(2)} ${s.y1.toFixed(2)} `;
    d += s.type === "L"
      ? `L ${s.x2.toFixed(2)} ${s.y2.toFixed(2)} `
      : `C ${s.c1x.toFixed(2)} ${s.c1y.toFixed(2)} ${s.c2x.toFixed(2)} ${s.c2y.toFixed(2)} ${s.x2.toFixed(2)} ${s.y2.toFixed(2)} `;
    cx = s.x2; cy = s.y2;
  }
  return d.trim();
}
/* split sampled points into continuous runs (never draw across jumps) */
function sampleRuns(plan) {
  const runs = [];
  let cur = [];
  for (const p of plan.sampledPoints) {
    const prev = cur[cur.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > 3) { runs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}
/* One line type, everywhere. Doubled rails (polyline offsets, then a carved
 * tube) and dashed strokes were tried and rejected — at reading size any
 * second line type reads as a rendering artifact, not a meaning. A thread's
 * kind speaks only through its hue when focused. */
/* spine path with woven hop gaps (and an optional contrast gap) */
function spineD(plan, extraGaps = []) {
  if (!plan.spine) return "";
  const gaps = [...(plan.renderHops || []), ...extraGaps].sort((a, b) => a - b);
  const segs = [];
  let y0 = plan.spine.top;
  for (const g of gaps) {
    if (g - 1.7 > y0) segs.push(`M ${plan.spine.x} ${y0.toFixed(2)} L ${plan.spine.x} ${(g - 1.7).toFixed(2)}`);
    y0 = g + 1.7;
  }
  if (plan.spine.bottom > y0) segs.push(`M ${plan.spine.x} ${y0.toFixed(2)} L ${plan.spine.x} ${plan.spine.bottom.toFixed(2)}`);
  return segs.join(" ");
}

/* ── rendering ─────────────────────────────────────────────── */
/* One paradigm, one line type: every drawn thread is the same quiet solid
 * line. The focused thread takes its kind hue at full strength and a
 * slightly heavier stroke; woven companions stay monochrome ink. Held
 * annotations are whisper underlines plus one ink tick per anchor line on
 * a dedicated held rail outside the strands — never on top of a spine. */
function render(measured, ctx) {
  const { plans, focusedId, drawnIds, loomInner, strandPitch } = ctx;
  const svg = sheet.querySelector(".overlay");
  svg.innerHTML = "";
  sheet.classList.toggle("dimmed", true);
  sheet.querySelectorAll(".anchor").forEach((el) => { el.classList.remove("lit"); el.style.removeProperty("--h"); });

  const drawn = measured.annotations.filter((a) => drawnIds.has(a.id));
  const held = measured.annotations.filter((a) => !drawnIds.has(a.id));

  /* held layer: whisper underlines + ink ticks on the held rail */
  const gHeld = S("g", { class: "held-layer" }, svg);
  const heldRailX = loomInner - strandPitch * 3 - 4;
  const usedTicks = [];
  for (const ann of held) {
    for (const a of ann.anchors) for (const f of a.fragments) {
      S("path", {
        d: `M ${f.left + 0.5} ${f.bottom + 2} H ${f.right - 0.5}`,
        stroke: INK, "stroke-width": 1.1, fill: "none", "stroke-linecap": "round", opacity: 0.30,
      }, gHeld);
    }
    /* one tick per anchor LINE (several anchors on one line share a tick);
     * cross-annotation collisions step outward, never onto a strand */
    const lineYs = [];
    for (const a of ann.anchors) {
      const f = [...a.fragments].sort((p, q) => p.top - q.top)[0];
      const y = (f.top + f.bottom) / 2;
      if (!lineYs.some((v) => Math.abs(v - y) < 3)) lineYs.push(y);
    }
    for (const y of lineYs) {
      let x = heldRailX;
      while (usedTicks.some((u) => Math.abs(u.y - y) < 2.5 && Math.abs(u.x - x) < 1)) x -= 7;
      usedTicks.push({ x, y });
      const tick = S("path", {
        d: `M ${x.toFixed(2)} ${y.toFixed(2)} h -5.5`, stroke: INK,
        "stroke-width": 1.2, fill: "none", "stroke-linecap": "round", opacity: 0.55, class: "tick",
      }, gHeld);
      tick.style.pointerEvents = "stroke";
      tick.style.cursor = "pointer";
      tick.addEventListener("mouseenter", () => { if (previewId !== ann.id) { previewId = ann.id; run(); } });
      tick.addEventListener("click", () => { focusedId = ann.id; previewId = null; run(); });
    }
  }

  /* drawn threads: woven first, then the patch layer, then the focused
   * thread on top — the hierarchy is paint order */
  const drawOne = (ann) => {
    const plan = plans.get(ann.id);
    const focused = ann.id === focusedId;
    const hue = focused ? (HUES[ann.kind] || INK) : INK;
    const tone = focused ? 1 : 0.7;
    if (focused) sheet.querySelectorAll(".anchor").forEach((el) => {
      if ((el.dataset.tokens || "").split(" ").some((t) => t.startsWith(ann.id + ":"))) {
        el.classList.add("lit"); el.style.setProperty("--h", hue);
      }
    });
    const g = S("g", { class: focused ? "thread focused" : "thread woven" }, svg);

    /* underlines: one per fragment, never bridging a wrap */
    for (const a of ann.anchors) for (const f of a.fragments) {
      S("path", {
        d: `M ${f.left + 0.5} ${f.bottom + 2} H ${f.right - 0.5}`,
        stroke: hue, "stroke-width": focused ? 1.6 : 1.25, fill: "none",
        "stroke-linecap": "round", opacity: tone,
      }, g);
    }

    const base = {
      fill: "none", stroke: hue, "stroke-width": focused ? 1.5 : 1.25,
      "stroke-linecap": "round", "stroke-linejoin": "round", opacity: tone,
    };
    const nonSpine = plan.spine
      ? plan.centerline.filter((s) =>
          !(s.type === "L" && Math.abs(s.x1 - plan.spine.x) < 0.01 && Math.abs(s.x2 - plan.spine.x) < 0.01 &&
            Math.abs(s.y2 - s.y1) > 4))
      : plan.centerline;

    const sd = spineD(plan, []);
    if (sd) S("path", { ...base, d: sd }, g);
    S("path", { ...base, d: pathD(nonSpine) }, g);

    /* pins: exactly on the underline endpoints, over the thread start */
    for (const c of plan.contacts) S("circle", { cx: c.x, cy: c.y, r: focused ? 2.6 : 2.4, fill: hue, opacity: tone }, g);
  };

  for (const ann of drawn) {
    if (ann.id === focusedId) continue;
    drawOne(ann);
  }
  /* eraser patches: woven travelers pause where the focused spine passes */
  for (const ann of drawn) {
    const plan = plans.get(ann.id);
    for (const pt of plan.renderPatches || []) {
      S("rect", { x: pt.x - 1.9, y: pt.y - 2.6, width: 3.8, height: 5.2, fill: "var(--bg-reading)" }, svg);
    }
  }
  const focusedAnn = drawn.find((a) => a.id === focusedId);
  if (focusedAnn) drawOne(focusedAnn);
}

/* ── woven crossings: one line pauses, the other passes ──
 * Default: the traveling shoulder passes, the spine pauses (a hop gap).
 * Hierarchy: the focused thread is never gapped — a shoulder crossing a
 * focused spine takes the gap itself (an eraser patch under the spine). */
function computeHops(drawnPlans, focusedId) {
  for (const p of drawnPlans) { p.renderHops = []; p.renderPatches = []; }
  for (const A of drawnPlans) {
    if (!A.valid) continue;
    const runs = sampleRuns(A);
    for (const B of drawnPlans) {
      if (A === B || !B.valid || !B.spine) continue;
      const hits = [];
      for (const run of runs) {
        for (const p of run) {
          if (Math.abs(p.x - B.spine.x) < 1.05 && p.y > B.spine.top + 2 && p.y < B.spine.bottom - 2) {
            hits.push(p.y);
          }
        }
      }
      if (!hits.length) continue;
      hits.sort((a, b) => a - b);
      const clusters = [];
      for (const y of hits) {
        const lastC = clusters[clusters.length - 1];
        if (lastC && y - lastC[lastC.length - 1] < 3) lastC.push(y);
        else clusters.push([y]);
      }
      for (const c of clusters) {
        const y = c.reduce((s, v) => s + v, 0) / c.length;
        /* never gap a port merge — the weave yields there */
        if (B.ports.some((pt) => Math.abs(pt.y - y) < 2.6)) continue;
        if (B.focused && !A.focused) {
          /* focused spine stands: the traveler pauses instead */
          if (!A.renderPatches.some((h) => Math.abs(h.y - y) < 3 && Math.abs(h.x - B.spine.x) < 1)) {
            A.renderPatches.push({ x: B.spine.x, y });
          }
        } else if (!B.renderHops.some((h) => Math.abs(h - y) < 3)) {
          B.renderHops.push(y);
        }
      }
    }
  }
}

/* ── validation suite ──────────────────────────────────────── */
function validate(measured, ann, plan, drawnPlans) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });
  if (!plan.valid) { push("route", false, plan.reason); return checks; }

  /* contact error ≤ 0.25px */
  let worst = 0;
  for (const c of plan.contacts) {
    let best = Infinity;
    for (const s of plan.centerline) {
      best = Math.min(best, Math.hypot(s.x1 - c.x, s.y1 - c.y), Math.hypot(s.x2 - c.x, s.y2 - c.y));
    }
    worst = Math.max(worst, best);
  }
  push("contact ≤0.25px", worst <= 0.25, worst.toFixed(2));

  push("finite", plan.sampledPoints.every((p) => isFinite(p.x) && isFinite(p.y)), "");

  /* long verticals only on the strand */
  if (plan.marginRailX != null) {
    let offRail = 0;
    for (const s of plan.centerline) {
      if (s.type === "L" && Math.abs(s.x2 - s.x1) < 0.01 && Math.abs(s.y2 - s.y1) > measured.block.lineHeight * 1.2) {
        if (Math.abs(s.x1 - plan.marginRailX) > 0.5) offRail++;
      }
    }
    push("spine on strand", offRail === 0, String(offRail));
  }

  /* ports: on the strand, tangent-vertical, spine never overshoots */
  if (plan.spine) {
    const onX = plan.ports.every((p) => Math.abs(p.x - plan.spine.x) < 0.01);
    const inside = plan.ports.every((p) => p.y >= plan.spine.top - 0.01 && p.y <= plan.spine.bottom + 0.01);
    const exact = Math.abs(Math.min(...plan.ports.map((p) => p.y)) - plan.spine.top) < 0.01 &&
                  Math.abs(Math.max(...plan.ports.map((p) => p.y)) - plan.spine.bottom) < 0.01;
    push("ports exact", onX && inside && exact, onX && inside && exact ? "" : "port/spine mismatch");
  }

  /* weave clearance: crossings are resolved by a hop gap in the spine or
   * an eraser patch on this traveler — anything else is a collision */
  let weaveBad = 0;
  for (const B of drawnPlans) {
    if (B === plan || !B.valid || !B.spine) continue;
    for (const p of plan.sampledPoints) {
      if (Math.abs(p.x - B.spine.x) < 1.7 && p.y > B.spine.top + 1 && p.y < B.spine.bottom - 1) {
        const hopped = (B.renderHops || []).some((h) => Math.abs(p.y - h) < 2.2);
        const patched = (plan.renderPatches || []).some((pt) => Math.abs(pt.x - B.spine.x) < 1 && Math.abs(pt.y - p.y) < 2.8);
        if (!hopped && !patched) weaveBad++;
      }
    }
  }
  if (drawnPlans.length > 1) push("weave clears", weaveBad === 0, weaveBad ? `${weaveBad} hits` : "ok");

  push("clearance", plan.diagnostics.minimumClearance >= 0, `${plan.diagnostics.minimumClearance}px`);
  return checks;
}

/* ── orchestration ─────────────────────────────────────────── */
let focusedId = "far-pair";
let previewId = null;
let weaveOn = true;
let lastLoomInner = 0;

function run() {
  const measured = measure();
  const svg = sheet.querySelector(".overlay");
  const b = sheet.getBoundingClientRect();
  svg.setAttribute("width", b.width); svg.setAttribute("height", b.height);

  const effectiveFocus = previewId || focusedId;
  const anns = measured.annotations;
  const iv = new Map(anns.map((a) => {
    const tops = a.anchors.flatMap((x) => x.fragments.map((f) => f.top));
    const bots = a.anchors.flatMap((x) => x.fragments.map((f) => f.bottom));
    return [a.id, { top: Math.min(...tops), bottom: Math.max(...bots) }];
  }));

  /* the loom is a page-level datum: one inner edge for the whole block,
   * computed once, handed to every plan */
  const expand = Math.max(2.5, measured.fontSize * 0.12) + 2.5;
  let minLeft = Infinity;
  for (const r of [...measured.block.renderedLines, ...measured.block.verseNumberRects, ...measured.block.additionalObstacles]) {
    minLeft = Math.min(minLeft, r.left - expand);
  }
  const loomInner = minLeft - 10;
  lastLoomInner = loomInner;

  /* density policy IS the aesthetic: the focused thread fully drawn, at most
   * two companions woven beside it, everything else held as ticks. Corridor
   * claims come only from threads that actually paint — invisible threads
   * must not consume corridor space or strand budget. */
  const plans = new Map();
  const strands = new Map();
  const claims = [];
  const drawnIds = new Set();
  const tryPlan = (ann, strand, commit) => {
    try {
      const p = planRoute(measured.block, ann, {
        fontSize: measured.fontSize, strandIndex: strand,
        corridorClaims: claims, loomX: loomInner,
        /* every claim carries a little air so stacked shoulders never
         * read as one line */
        claimPad: 0.25,
      });
      plans.set(ann.id, p);
      if (p.valid && commit) {
        claims.push(...p.claimsOut);
        drawnIds.add(ann.id);
        strands.set(ann.id, strand);
      }
      return p.valid;
    } catch (e) {
      plans.set(ann.id, { valid: false, reason: "engine-error: " + (e.message || e), laneIndex: strand });
      return false;
    }
  };

  const focusAnn = anns.find((a) => a.id === effectiveFocus) || anns[0];
  if (focusAnn) { tryPlan(focusAnn, 0, true); }

  /* companions ranked "beside" the focus: overlapping intervals first, then
   * nearest; a page-spanning interval ranks behind local ones (span tie);
   * acceptance requires an actual valid route on its strand */
  const fiv = focusAnn ? iv.get(focusAnn.id) : { top: 0, bottom: 0 };
  const dist = (a) => {
    const i = iv.get(a.id);
    return i.top > fiv.bottom ? i.top - fiv.bottom : fiv.top > i.bottom ? fiv.top - i.bottom : 0;
  };
  const span = (a) => { const i = iv.get(a.id); return i.bottom - i.top; };
  const overlaps = (a, bId) => {
    const A = iv.get(a.id), B = iv.get(bId);
    return A.top < B.bottom + 6 && B.top < A.bottom + 6;
  };
  const ranked = anns.filter((a) => a !== focusAnn).sort((x, y) =>
    dist(x) - dist(y) || span(x) - span(y) || iv.get(x.id).top - iv.get(y.id).top || (x.id < y.id ? -1 : 1));

  if (weaveOn && focusAnn) {
    for (const cand of ranked) {
      if (drawnIds.size >= 3) break;
      let s = 0;
      while (s < MAX_STRANDS && [...drawnIds].some((id) => strands.get(id) === s && overlaps(cand, id))) s++;
      if (s >= MAX_STRANDS) continue;
      tryPlan(cand, s, true);
    }
  }

  /* everything else: shadow-plan for the suite (claims untouched), held */
  for (const ann of anns) {
    if (plans.has(ann.id)) continue;
    let s = 0;
    while (s < MAX_STRANDS && [...drawnIds].some((id) => strands.get(id) === s && overlaps(ann, id))) s++;
    tryPlan(ann, Math.min(s, MAX_STRANDS - 1), false);
  }

  const drawnPlans = [...drawnIds].map((id) => plans.get(id));
  drawnPlans.forEach((p) => { p.focused = p === plans.get(effectiveFocus); });
  computeHops(drawnPlans, effectiveFocus);

  render(measured, { plans, focusedId: effectiveFocus, drawnIds, loomInner, strandPitch: 6 });

  /* panel */
  const list = document.getElementById("fixture-list");
  list.innerHTML = "";
  let pass = 0;
  for (const ann of anns) {
    const plan = plans.get(ann.id);
    const isDrawn = drawnIds.has(ann.id);
    const checks = plan && plan.valid ? validate(measured, ann, plan, isDrawn ? drawnPlans : [plan]) : [];
    (window.__CHECKS = window.__CHECKS || {})[ann.id] = checks;
    const ok = plan && plan.valid && checks.every((c) => c.ok);
    if (isDrawn && ok) pass++;
    const btn = document.createElement("button");
    btn.className = "fixture" + (ann.id === effectiveFocus ? " sel" : "");
    const chip = isDrawn
      ? `<span class="chip ${ok ? "ok" : "bad"}">${ok ? "pass" : "fail"}</span>`
      : plan && plan.valid
        ? `<span class="chip held">held</span>`
        : `<span class="chip held">${plan && plan.reason ? plan.reason : "held"}</span>`;
    const strandBadge = isDrawn ? `<span class="strand s${strands.get(ann.id)}">s${strands.get(ann.id)}</span>` : "";
    btn.innerHTML = `<span class="frow"><i class="dot" style="background:${HUES[ann.kind]}"></i>
      <span class="fname">${ann.fixture.name}</span>${strandBadge}${chip}</span>
      <span class="fdiag">${plan && plan.valid
        ? `${plan.mode} · clear ${plan.diagnostics.minimumClearance}px · ${plan.diagnostics.totalLength}px · ${ann.anchors.length} anchor${ann.anchors.length > 1 ? "s" : ""}${plan.renderHops && plan.renderHops.length ? ` · ${plan.renderHops.length} hops` : ""}`
        : `${ann.anchors.length} anchor${ann.anchors.length > 1 ? "s" : ""}`}</span>`;
    btn.addEventListener("click", () => { focusedId = ann.id; previewId = null; run(); });
    list.appendChild(btn);
  }
  document.getElementById("suite-summary").textContent =
    `${drawnIds.size} drawn (${pass}/${drawnIds.size} pass) · ${anns.length - drawnIds.size} held as ticks · ${measured.block.renderedLines.length} rendered lines`;
}

const slider = document.getElementById("width-slider");
slider.addEventListener("input", () => {
  sheet.style.width = slider.value + "px";
  document.getElementById("width-val").textContent = slider.value;
  requestAnimationFrame(run);
});
const weaveBox = document.getElementById("weave-toggle");
if (weaveBox) weaveBox.addEventListener("change", () => { weaveOn = weaveBox.checked; run(); });
addEventListener("resize", () => requestAnimationFrame(run));

/* a bloomed tick re-renders as a thread, so its own mouseleave can never
 * fire — the bloom ends when the pointer returns to the text column */
let previewClearQueued = false;
sheet.addEventListener("pointermove", (e) => {
  if (!previewId || previewClearQueued) return;
  const r = sheet.getBoundingClientRect();
  if (e.clientX - r.left > lastLoomInner + 24) {
    previewClearQueued = true;
    requestAnimationFrame(() => { previewClearQueued = false; previewId = null; run(); });
  }
});

buildSheet();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
else run();

/* lab introspection */
window.RL = { measure, planRoute, assignStrands, FIXTURES, focus: (id) => { focusedId = id; previewId = null; run(); } };
