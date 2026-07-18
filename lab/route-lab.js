/* route-lab.js — measurement, fixtures, rendering, and the validation
 * suite for route-engine.js. The engine never touches the DOM; this file
 * measures real rendered text and hands it over. */
import { planRoute, assignLanes } from "./route-engine.js";

const SVGNS = "http://www.w3.org/2000/svg";
const HUES = {
  parallel: "var(--k-parallel)", contrast: "var(--k-contrast)", echo: "var(--k-echo)",
  hinge: "var(--k-parallel)", mirror: "var(--k-mirror)", series: "var(--k-series)",
};

/* ── fixtures: the contract's required matrix, on real text ── */
const FIXTURES = [
  { id: "far-pair", name: "left pair · 5 lines", kind: "parallel",
    keys: [{ ref: "PSA.1.1", phrase: "Blessed is the man" }, { ref: "PSA.1.6", phrase: "the way of the wicked" }] },
  { id: "same-line", name: "same rendered line", kind: "hinge",
    keys: [{ ref: "PSA.1.6", phrase: "the way of the righteous" }, { ref: "PSA.1.6", phrase: "the way of the wicked" }] },
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
    keys: [{ ref: "GEN.1.14", phrase: "lights in the expanse of the sky to divide the day from the night" }, { ref: "GEN.1.15", phrase: "lights in the expanse" }] },
  { id: "first-last", name: "first ↔ last block line", kind: "mirror",
    keys: [{ ref: "PSA.1.1", phrase: "walk" }, { ref: "GEN.2.3", phrase: "God blessed the seventh day" }] },
];

/* ── build the text block ──────────────────────────────────── */
const sheet = document.getElementById("sheet");
function buildSheet() {
  sheet.innerHTML = "";
  const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = "Route lab · Psalm 1 + Creation";
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
      // wrap fixture phrases (fixtures are chosen not to overlap)
      const marks = [];
      for (const f of FIXTURES) f.keys.forEach((k, ki) => {
        if (k.ref !== ref) return;
        const idx = v.text.indexOf(k.phrase);
        if (idx >= 0) marks.push({ start: idx, end: idx + k.phrase.length, fid: f.id, ki });
      });
      marks.sort((a, b) => a.start - b.start);
      // identical ranges may serve several fixtures — merge their tokens
      const merged = [];
      for (const m of marks) {
        const same = merged.find((x) => x.start === m.start && x.end === m.end);
        if (same) same.tokens.push(`${m.fid}:${m.ki}`);
        else merged.push({ start: m.start, end: m.end, tokens: [`${m.fid}:${m.ki}`] });
      }
      let pos = 0;
      for (const m of merged) {
        if (m.start < pos) continue; // true overlap guard
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
  // rendered lines: every vtext's client rects, merged per visual line
  const lineRects = [];
  sheet.querySelectorAll(".vtext").forEach((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) lineRects.push(rel(r));
  });
  // obstacles are ink, not line boxes: Range rects include leading, so
  // tighten each rendered line toward its glyph box before expansion
  const renderedLines = mergeByLine(lineRects).map((r) => ({
    left: r.left, right: r.right, top: r.top + 2.2, bottom: r.bottom - 2.2,
  }));
  // measure number ink via a Range — the span's box can stretch far
  // beyond the glyphs inside a grid row
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
  // anchors per fixture
  const annotations = FIXTURES.map((f, i) => {
    const anchors = [];
    f.keys.forEach((k, ki) => {
      const spans = [...sheet.querySelectorAll(`.anchor[data-tokens~="${f.id}:${ki}"]`)];
      if (!spans.length) return;
      const rects = [];
      for (const sp of spans) for (const r of sp.getClientRects()) rects.push(rel(r));
      anchors.push({ id: `${f.id}:${ki}`, fragments: mergeByLine(rects), documentOrder: ki });
    });
    return { id: f.id, anchors, kind: f.kind, focused: false, fixture: f };
  }).filter((a) => a.anchors.length >= 2);
  return { block, annotations, fontSize };
}

/* ── rendering ─────────────────────────────────────────────── */
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

function render(measured, plans, focusedId) {
  const svg = sheet.querySelector(".overlay");
  svg.innerHTML = "";
  sheet.classList.toggle("dimmed", !!focusedId);
  sheet.querySelectorAll(".anchor").forEach((el) => el.classList.remove("lit"));
  for (const ann of measured.annotations) {
    const plan = plans.get(ann.id);
    if (!plan) continue;
    const hue = HUES[ann.kind];
    const focused = ann.id === focusedId;
    if (focused) sheet.querySelectorAll(".anchor").forEach((el) => {
      if ((el.dataset.tokens || "").split(" ").some((t) => t.startsWith(ann.id + ":"))) {
        el.classList.add("lit"); el.style.setProperty("--h", hue);
      }
    });
    if (!plan.valid) continue;
    const g = S("g", { class: focused ? "" : "held" }, svg);
    // underlines: one per fragment, never bridging a wrap
    const uw = focused ? 1.9 : 1.4;
    for (const a of ann.anchors) for (const f of a.fragments) {
      S("path", {
        d: `M ${f.left + 0.5} ${f.bottom + 2} H ${f.right - 0.5}`,
        stroke: hue, "stroke-width": uw, fill: "none", "stroke-linecap": "round",
      }, g);
    }
    // centerline by kind
    const base = { fill: "none", stroke: hue, "stroke-width": focused ? 1.5 : 1.25, "stroke-linecap": "round", "stroke-linejoin": "round" };
    if (ann.kind === "parallel") {
      for (const off of [-1.6, 1.6]) S("path", { ...base, d: offsetPathD(plan, off), "stroke-width": 1.1 }, g);
    } else {
      const p = S("path", { ...base, d: pathD(plan.centerline) }, g);
      if (ann.kind === "echo") p.setAttribute("stroke-dasharray", "0.1 4.5");
    }
    // margin markers
    const m = plan.markerRanges;
    if (plan.marginRailX != null && m.marginStart != null && m.marginEnd > m.marginStart + 14) {
      const ym = (m.marginStart + m.marginEnd) / 2, x = plan.marginRailX;
      if (ann.kind === "contrast") S("path", { d: `M ${x} ${ym - 4} V ${ym + 4}`, stroke: "var(--bg-reading)", "stroke-width": 4 }, g);
      if (ann.kind === "mirror") S("path", { d: `M ${x} ${ym - 4} L ${x + 3.2} ${ym} L ${x} ${ym + 4} L ${x - 3.2} ${ym} Z`, fill: hue, stroke: "none" }, g);
      if (ann.kind === "series") for (const dy of [-6, 6]) S("path", { d: `M ${x - 3} ${ym + dy} H ${x + 3}`, stroke: hue, "stroke-width": 1.4 }, g);
    }
    if (ann.kind === "hinge" && plan.mode === "same-line") {
      const ym = plan.corridors[0], xs = plan.contacts.map((c) => c.x);
      const xm = (Math.min(...xs) + Math.max(...xs)) / 2;
      S("path", { d: `M ${xm} ${ym - 2.5} V ${ym + 2.5}`, stroke: hue, "stroke-width": 1.5 }, g);
    }
    // contact dots: exactly on underline endpoints, centred on the line
    for (const c of plan.contacts) S("circle", { cx: c.x, cy: c.y, r: 2.6, fill: hue }, g);
  }
}
/* parallel rails: offset the sampled centerline, tapering to zero at
 * both external contacts — sin²(πt) per the contract */
function offsetPathD(plan, maxSep) {
  // split sampled points into continuous runs — never draw across the
  // jump between subpaths (that jump is exactly a diagonal through prose)
  const runs = [];
  let cur = [];
  for (const p of plan.sampledPoints) {
    const prev = cur[cur.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > 3) { runs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  let d = "";
  for (const pts of runs) {
    const n = pts.length;
    if (n < 2) continue;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const sep = maxSep * Math.sin(Math.PI * t) ** 2;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      out.push(`${(pts[i].x + (-dy / len) * sep).toFixed(2)},${(pts[i].y + (dx / len) * sep).toFixed(2)}`);
    }
    d += "M" + out.join("L");
  }
  return d;
}

/* ── validation suite ──────────────────────────────────────── */
function validate(measured, ann, plan) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });
  if (!plan.valid) { push("route", false, plan.reason); return checks; }
  // contact error ≤ 0.25px: every contact coincides with a centerline endpoint
  let worst = 0;
  for (const c of plan.contacts) {
    let best = Infinity;
    for (const s of plan.centerline) {
      best = Math.min(best, Math.hypot(s.x1 - c.x, s.y1 - c.y), Math.hypot(s.x2 - c.x, s.y2 - c.y));
    }
    worst = Math.max(worst, best);
  }
  push("contact ≤0.25px", worst <= 0.25, worst.toFixed(2));
  // finite geometry
  const finite = plan.sampledPoints.every((p) => isFinite(p.x) && isFinite(p.y));
  push("finite", finite, "");
  // long verticals only on the rail
  if (plan.marginRailX != null) {
    let offRail = 0;
    for (const s of plan.centerline) {
      if (s.type === "L" && Math.abs(s.x2 - s.x1) < 0.01 && Math.abs(s.y2 - s.y1) > measured.block.lineHeight * 1.2) {
        if (Math.abs(s.x1 - plan.marginRailX) > 0.5) offRail++;
      }
    }
    push("spine on rail", offRail === 0, String(offRail));
  }
  // clearance reported by the engine (collisions already hard-fail inside)
  push("clearance", plan.diagnostics.minimumClearance >= 0, `${plan.diagnostics.minimumClearance}px`);
  return checks;
}

/* ── orchestration ─────────────────────────────────────────── */
let focusedId = FIXTURES[0].id;
function run() {
  const measured = measure();
  const svg = sheet.querySelector(".overlay");
  const b = sheet.getBoundingClientRect();
  svg.setAttribute("width", b.width); svg.setAttribute("height", b.height);
  // lanes: focused nearest the column, held outward, stable order
  const intervals = measured.annotations.map((a) => {
    const tops = a.anchors.flatMap((x) => x.fragments.map((f) => f.top));
    const bots = a.anchors.flatMap((x) => x.fragments.map((f) => f.bottom));
    return { id: a.id, top: Math.min(...tops), bottom: Math.max(...bots), focused: a.id === focusedId };
  });
  const lanes = assignLanes(intervals, 4);
  const plans = new Map();
  for (const ann of measured.annotations) {
    const lane = lanes.get(ann.id);
    if (lane === -1 && ann.id !== focusedId) { plans.set(ann.id, { valid: false, reason: "held · beyond lane budget", laneIndex: -1 }); continue; }
    try {
      plans.set(ann.id, planRoute(measured.block, ann, {
        fontSize: measured.fontSize,
        laneIndex: Math.max(0, lane),
        underlineDy: 2,
      }));
    } catch (e) {
      plans.set(ann.id, { valid: false, reason: "engine-error: " + e.message, laneIndex: lane });
    }
  }
  render(measured, plans, focusedId);
  // panel
  const list = document.getElementById("fixture-list");
  list.innerHTML = "";
  let pass = 0, total = 0;
  for (const ann of measured.annotations) {
    const plan = plans.get(ann.id);
    const checks = validate(measured, ann, plan);
    const ok = plan.valid && checks.every((c) => c.ok);
    if (plan.valid) { total++; if (ok) pass++; }
    const btn = document.createElement("button");
    btn.className = "fixture" + (ann.id === focusedId ? " sel" : "");
    btn.innerHTML = `<span class="frow"><i class="dot" style="background:${HUES[ann.kind]}"></i>
      <span class="fname">${ann.fixture.name}</span>
      <span class="chip ${plan.valid ? (ok ? "ok" : "bad") : "bad"}">${plan.valid ? (ok ? "pass" : "fail") : plan.reason}</span></span>
      <span class="fdiag">${plan.valid
        ? `${plan.mode} · lane ${plan.diagnostics.laneIndex} · clear ${plan.diagnostics.minimumClearance}px · ${plan.diagnostics.totalLength}px · ${ann.anchors.length} anchors`
        : `${ann.anchors.length} anchors`}</span>`;
    btn.addEventListener("click", () => { focusedId = ann.id; run(); });
    list.appendChild(btn);
  }
  document.getElementById("suite-summary").textContent =
    `${pass}/${total} routed fixtures pass all assertions · ${measured.block.renderedLines.length} rendered lines measured`;
}

const slider = document.getElementById("width-slider");
slider.addEventListener("input", () => {
  sheet.style.width = slider.value + "px";
  document.getElementById("width-val").textContent = slider.value;
  requestAnimationFrame(run);
});
addEventListener("resize", () => requestAnimationFrame(run));

buildSheet();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
else run();

// lab introspection
window.RL = { measure, planRoute, FIXTURES, focus: (id) => { focusedId = id; run(); } };
