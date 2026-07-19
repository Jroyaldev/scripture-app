/* route-lab.js — measurement, fixtures, rendering, and the validation
 * suite for route-engine.js (Loom). The engine never touches the DOM;
 * this file measures real rendered text, hands it over, and draws the
 * plan under one paradigm: one solid line type for every thread — the
 * focused thread in its kind hue at full strength, at most two woven
 * companions in quiet ink, and every other annotation as whisper
 * underline + one held-rail tick. Corridor claims and strand budget
 * belong only to threads that paint. */
import { planRoute, assignStrands, rankCompanions } from "./route-engine.js";

const SVGNS = "http://www.w3.org/2000/svg";
const HUES = {
  parallel: "var(--k-parallel)", contrast: "var(--k-contrast)", echo: "var(--k-echo)",
  hinge: "var(--k-hinge)", mirror: "var(--k-mirror)", series: "var(--k-series)", note: "var(--k-note)",
};
const INK = "var(--thread-ink)";
const MAX_STRANDS = 3;
const planSideRuns = (plan) => plan && plan.valid && Array.isArray(plan.sideRuns)
  ? plan.sideRuns
  : plan && plan.valid && Number.isInteger(plan.strand)
    ? [{
        id: `${plan.side || "left"}:${plan.strand}:whole`,
        sectionIds: [], side: plan.side || "left", strand: plan.strand,
        x: plan.marginRailX,
        top: plan.spine ? plan.spine.top : Math.min(...(plan.ports || []).map((p) => p.y)),
        bottom: plan.spine ? plan.spine.bottom : Math.max(...(plan.ports || []).map((p) => p.y)),
      }]
    : [];
const isMarginPlan = (plan) => planSideRuns(plan).length > 0;
const runRailX = (run) => run && (Number.isFinite(run.railX) ? run.railX : run.x);
const planSpines = (plan) => plan && plan.valid && Array.isArray(plan.spines)
  ? plan.spines
  : plan && plan.valid && plan.spine
    ? [{ id: `${plan.side || "left"}:${plan.strand ?? 0}:spine`, kind: "margin", ...plan.spine,
        side: plan.side || "left", strand: plan.strand ?? 0,
        portIndexes: (plan.ports || []).map((_, index) => index) }]
    : [];
const planHandoffs = (plan) => plan && plan.valid && Array.isArray(plan.handoffs) ? plan.handoffs : [];
const planSpineClaims = (plan) => plan && plan.valid && Array.isArray(plan.spineClaimsOut)
  ? plan.spineClaimsOut
  : plan && plan.valid && plan.spineClaimOut ? [plan.spineClaimOut] : [];
const planStrandClaims = (plan) => plan && plan.valid && Array.isArray(plan.strandClaimsOut)
  ? plan.strandClaimsOut
  : plan && plan.valid && plan.strandClaimOut ? [plan.strandClaimOut] : [];
function topologySides(plan) {
  if (!plan || !plan.valid) return [];
  if (Array.isArray(plan.sectionSides)) return plan.sectionSides.map(({ sectionId, side }) => ({ sectionId, side }));
  if (Array.isArray(plan.topologySignature)) return plan.topologySignature.map(({ sectionId, side }) => ({ sectionId, side }));
  return planSideRuns(plan).flatMap((run) => (run.sectionIds || []).map((sectionId) => ({ sectionId, side: run.side })));
}
function topologySignatureOf(plan) {
  if (!plan || !plan.valid) return "";
  if (typeof plan.topologySignature === "string") return plan.topologySignature;
  const sides = topologySides(plan);
  return sides.length ? sides.map(({ sectionId, side }) => `${sectionId}:${side}`).join("|")
    : isMarginPlan(plan) ? `whole:${plan.side || planSideRuns(plan)[0].side}:${plan.strand ?? planSideRuns(plan)[0].strand}`
      : plan.mode || "direct";
}
function sideForAnchor(plan, ann, anchorId, sectionId) {
  if (!plan || !plan.valid) return null;
  const anchorIndex = ann.anchors.findIndex((anchor) => anchor.id === anchorId);
  const owned = Array.isArray(plan.anchorRuns) && plan.anchorRuns.find((entry) =>
    entry.anchorId === anchorId || entry.anchorIndex === anchorIndex);
  if (owned && (owned.side === "left" || owned.side === "right")) return owned.side;
  const bySection = sectionId && planSideRuns(plan).find((run) => (run.sectionIds || []).includes(sectionId));
  if (bySection) return bySection.side;
  return plan.side === "right" ? "right" : plan.side === "left" ? "left" : null;
}

/* These five source sections are deliberately authored rather than inferred
 * from wrapping. Four rows per section make side selection an actual-ink
 * decision: fixtures claim the leading phrase for a left bias and the
 * trailing phrase for a right bias, with no scorer override. The first three
 * have two measured, clear gaps; the final pair has one explicitly narrow
 * gap and leaves a legal whole-route fallback when its S cannot fit. */
const QA_SECTIONS = [
  { id: "qa-s-a", label: "A · origin", rows: [
      { ref: "QA.SA.1", left: "Root · Dawn", right: "Horizon" },
      { ref: "QA.SA.2", left: "Seed · Morning", right: "Distance" },
      { ref: "QA.SA.3", left: "Source · Rising", right: "Far shore" },
      { ref: "QA.SA.4", left: "Beginning · Daybreak", right: "Outer edge" },
    ],
    gapAfter: { id: "qa-gap-a-b", to: "qa-s-b", state: "clear" } },
  { id: "qa-s-b", label: "B · turning", rows: [
      { ref: "QA.SB.1", left: "Return", right: "Arrival · Turning" },
      { ref: "QA.SB.2", left: "Near bank", right: "Landing · Bend" },
      { ref: "QA.SB.3", left: "Home", right: "Welcome · Pivot" },
      { ref: "QA.SB.4", left: "This edge", right: "Harbor · Curve" },
    ],
    gapAfter: { id: "qa-gap-b-c", to: "qa-s-c", state: "clear" } },
  { id: "qa-s-c", label: "C · return", rows: [
      { ref: "QA.SC.1", left: "Homeward", right: "Rest" },
      { ref: "QA.SC.2", left: "Reprise", right: "Quiet" },
      { ref: "QA.SC.3", left: "Again", right: "Stillness" },
      { ref: "QA.SC.4", left: "Resting", right: "Close" },
    ] },
  { id: "qa-block-a", label: "D · before narrow gap", rows: [
      { ref: "QA.BA.1", left: "Boundary", right: "Before" },
      { ref: "QA.BA.2", left: "Threshold", right: "Near" },
      { ref: "QA.BA.3", left: "Before line", right: "Waiting" },
      { ref: "QA.BA.4", left: "Near side", right: "Pause" },
    ],
    gapAfter: { id: "qa-gap-blocked", to: "qa-block-b", state: "narrow" } },
  { id: "qa-block-b", label: "E · after narrow gap", rows: [
      { ref: "QA.BB.1", left: "", right: "Beyond" },
      { ref: "QA.BB.2", left: "", right: "Far boundary" },
      { ref: "QA.BB.3", left: "", right: "After line" },
      { ref: "QA.BB.4", left: "", right: "Across" },
    ] },
];

const qaSectionKeys = (sectionId, sectionCode, phrases) => phrases.map((phrase, index) => ({
  ref: `QA.${sectionCode}.${index + 1}`, phrase, sectionId,
}));

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
  { id: "adjacent-pair", name: "adjacent words · tight gap", kind: "hinge",
    keys: [{ ref: "GEN.1.11", phrase: "grass" }, { ref: "GEN.1.11", phrase: "herbs" }] },
  { id: "day-night", name: "adjacent lines · void right", kind: "mirror",
    keys: [{ ref: "PSA.1.2", phrase: "he meditates" }, { ref: "PSA.1.2", phrase: "night" }] },
  { id: "short-pair", name: "short closed pair", kind: "contrast",
    keys: [{ ref: "GEN.1.14", phrase: "days" }, { ref: "GEN.1.14", phrase: "years" }] },
  { id: "wrapped", name: "phrase that wraps", kind: "echo",
    keys: [{ ref: "GEN.1.14", phrase: "in the expanse of the sky to divide the day from the night" }, { ref: "GEN.1.15", phrase: "lights in the expanse" }] },
  { id: "first-last", name: "first ↔ last block line", kind: "mirror",
    keys: [{ ref: "PSA.1.1", phrase: "walk" }, { ref: "GEN.2.3", phrase: "God blessed the seventh day" }] },
  { id: "section-lr", name: "sections · left → right S", kind: "parallel",
    expectedTopology: ["left", "right"],
    keys: [
      ...qaSectionKeys("qa-s-a", "SA", ["Root", "Seed", "Source", "Beginning"]),
      ...qaSectionKeys("qa-s-b", "SB", ["Turning", "Bend", "Pivot", "Curve"]),
    ] },
  { id: "section-rl", name: "sections · right → left S", kind: "contrast",
    expectedTopology: ["right", "left"],
    keys: [
      ...qaSectionKeys("qa-s-a", "SA", ["Horizon", "Distance", "Far shore", "Outer edge"]),
      ...qaSectionKeys("qa-s-b", "SB", ["Return", "Near bank", "Home", "This edge"]),
    ] },
  { id: "section-lrl", name: "sections · left → right → left", kind: "series",
    expectedTopology: ["left", "right", "left"],
    keys: [
      ...qaSectionKeys("qa-s-a", "SA", ["Root", "Seed", "Source", "Beginning"]),
      ...qaSectionKeys("qa-s-b", "SB", ["Turning", "Bend", "Pivot", "Curve"]),
      ...qaSectionKeys("qa-s-c", "SC", ["Homeward", "Reprise", "Again", "Resting"]),
    ] },
  { id: "section-blocked", name: "sections · narrow-gap fallback", kind: "hinge",
    expectedHandoffs: 0, expectedSectionDecline: true,
    keys: [
      ...qaSectionKeys("qa-block-a", "BA", ["Boundary", "Threshold", "Before line", "Near side"]),
      ...qaSectionKeys("qa-block-b", "BB", ["Beyond", "Far boundary", "After line", "Across"]),
    ] },
];
const LEGACY_C03_FIXTURE_IDS = Object.freeze([
  "far-pair", "same-line", "note-tag", "mid-right-1", "mid-right-far",
  "reversed", "tri", "five", "ten", "same-line-multi", "adjacent-pair",
  "day-night", "short-pair", "wrapped", "first-last",
]);
const LEGACY_C03_FIXTURE_SET = new Set(LEGACY_C03_FIXTURE_IDS);
const LEGACY_C03_REFS = new Set(FIXTURES
  .filter((fixture) => LEGACY_C03_FIXTURE_SET.has(fixture.id))
  .flatMap((fixture) => fixture.keys.map((key) => key.ref)));
if (FIXTURES.some((fixture) => !LEGACY_C03_FIXTURE_SET.has(fixture.id) &&
    fixture.keys.some((key) => LEGACY_C03_REFS.has(key.ref)))) {
  throw new Error("C0.4 fixture refs must remain disjoint from the C0.3 host oracle");
}
/* Frozen from the isolated landed-C0.3 host universe: its 15 fixtures, its
 * measured pre-section surface, and its own side memory across every integer
 * width 460–760. It is intentionally not derived by the C0.4 sweep at runtime:
 * two equally wrong C0.4 passes must not be able to agree with each other. */
const LEGACY_C03_PROJECTION_SHA256 = "323bc250ff08ab0304750d26faf878599a2d0adbb65a10e44b4158e7e482c5c8";

/* ── build the text block ──────────────────────────────────── */
const sheet = document.getElementById("sheet");
function buildSheet() {
  sheet.innerHTML = "";
  let sourceLineOrder = 0;
  const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = "Loom · Psalm 1 + Creation";
  const r = document.createElement("div"); r.className = "sheet-ref"; r.textContent = "PSA.1 · GEN.1.1–2.3 · WEB · engine fixture";
  sheet.append(t, r);
  const appendMarkedText = (parent, text, ref) => {
    const marks = [];
    for (const f of FIXTURES) f.keys.forEach((k, ki) => {
      if (k.ref !== ref) return;
      const idx = text.indexOf(k.phrase);
      if (idx >= 0) marks.push({ start: idx, end: idx + k.phrase.length, fid: f.id, ki });
    });
    marks.sort((a, b) => a.start - b.start || a.end - b.end || a.fid.localeCompare(b.fid));
    const merged = [];
    for (const m of marks) {
      const same = merged.find((x) => x.start === m.start && x.end === m.end);
      if (same) same.tokens.push(`${m.fid}:${m.ki}`);
      else merged.push({ start: m.start, end: m.end, tokens: [`${m.fid}:${m.ki}`] });
    }
    let pos = 0;
    for (const m of merged) {
      if (m.start < pos) continue;
      if (m.start > pos) parent.appendChild(document.createTextNode(text.slice(pos, m.start)));
      const sp = document.createElement("span");
      sp.className = "anchor"; sp.dataset.tokens = m.tokens.join(" ");
      sp.textContent = text.slice(m.start, m.end);
      parent.appendChild(sp);
      pos = m.end;
    }
    parent.appendChild(document.createTextNode(text.slice(pos)));
  };
  const makeRow = ({ ref, number, text, left, right, sectionId = null }) => {
    const row = document.createElement("div");
    row.className = `vrow${left != null || right != null ? " qa-route-row" : ""}`;
    row.dataset.ref = ref;
    row.dataset.sourceLineId = ref;
    row.dataset.sourceLineOrder = String(sourceLineOrder++);
    if (sectionId) row.dataset.sectionId = sectionId;
    const num = document.createElement("span"); num.className = "vnum"; num.textContent = number;
    const txt = document.createElement("span"); txt.className = `vtext${left != null || right != null ? " qa-vtext" : ""}`;
    if (left != null || right != null) {
      const a = document.createElement("span"); a.className = "qa-edge qa-edge-left";
      const b = document.createElement("span"); b.className = "qa-edge qa-edge-right";
      appendMarkedText(a, left || "", ref);
      appendMarkedText(b, right || "", ref);
      txt.append(a, b);
    } else appendMarkedText(txt, text || "", ref);
    row.append(num, txt);
    return row;
  };
  const chapters = [["Psalm 1", "PSA.1"], ["Genesis 1", "GEN.1"], ["Genesis 2", "GEN.2"]];
  for (const [head, key] of chapters) {
    const h = document.createElement("div"); h.className = "chap-head"; h.textContent = head;
    sheet.appendChild(h);
    for (const v of VERSES[key]) {
      const ref = `${key}.${v.verse}`;
      sheet.appendChild(makeRow({ ref, number: v.verse, text: v.text }));
    }
  }
  const demoHead = document.createElement("div");
  demoHead.className = "qa-demo-head";
  demoHead.innerHTML = `<span>Section handoffs</span><small>declared structure · measured gaps</small>`;
  sheet.appendChild(demoHead);
  for (let i = 0; i < QA_SECTIONS.length; i++) {
    const section = QA_SECTIONS[i];
    const el = document.createElement("section");
    el.className = "qa-section";
    el.id = `route-section-${section.id}`;
    el.dataset.routeSection = "";
    el.dataset.sectionId = section.id;
    el.dataset.sectionOrder = String(i);
    const label = document.createElement("div");
    label.className = "qa-section-label"; label.textContent = section.label;
    el.appendChild(label);
    section.rows.forEach((row, rowIndex) => el.appendChild(makeRow({
      ref: row.ref, number: `S${i + 1}.${rowIndex + 1}`, left: row.left, right: row.right,
      sectionId: section.id,
    })));
    sheet.appendChild(el);
    if (section.gapAfter) {
      const gap = document.createElement("div");
      gap.className = `route-section-gap ${section.gapAfter.state === "narrow" ? "narrow" : "clear"}`;
      gap.id = `route-gap-${section.gapAfter.id}`;
      gap.dataset.routeSectionGap = "";
      gap.dataset.gapId = section.gapAfter.id;
      gap.dataset.fromSectionId = section.id;
      gap.dataset.toSectionId = section.gapAfter.to;
      gap.dataset.gapState = section.gapAfter.state;
      sheet.appendChild(gap);
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
  const cache = inkSlack._cache || (inkSlack._cache = new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  const ctx = (inkSlack._canvas || (inkSlack._canvas = document.createElement("canvas"))).getContext("2d");
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText("Mahglpqy");
  const val = {
    top: Math.max(0, m.fontBoundingBoxAscent - m.actualBoundingBoxAscent),
    bottom: Math.max(0, m.fontBoundingBoxDescent - m.actualBoundingBoxDescent),
  };
  cache.set(key, val);
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
  const renderedLines = [];
  sheet.querySelectorAll(".vtext").forEach((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const row = el.closest(".vrow");
    const sourceLineId = row && row.dataset.sourceLineId;
    const sourceOrder = Number(row && row.dataset.sourceLineOrder);
    const sectionId = row && row.dataset.sectionId;
    const lineRects = [...range.getClientRects()].map(rel);
    mergeByLine(lineRects)
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .forEach((rect, wrapIndex) => {
        const line = {
          id: `${sourceLineId || `source-${sourceOrder}`}:rendered-${wrapIndex}`,
          sourceLineId: sourceLineId || `source-${sourceOrder}`,
          documentOrder: sourceOrder * 100 + wrapIndex,
          left: rect.left, right: rect.right,
          top: rect.top + slack.top, bottom: rect.bottom - slack.bottom,
        };
        if (sectionId) line.sectionId = sectionId;
        renderedLines.push(line);
      });
  });
  renderedLines.sort((a, b) => a.top - b.top || a.documentOrder - b.documentOrder || a.left - b.left);
  /* word runs: the collision truth is words, not lines — the whitespace
   * between words is real routing room. Corridors and the loom datum still
   * derive from merged lines; only clearance checks use these. The walk is
   * ~1ms-per-1000-words expensive, so it caches on layout dimensions —
   * focus/hover replans reuse it; only reflow rebuilds. */
  const wrKey = `${base.width}x${sheet.scrollHeight}`;
  let wordRuns = measure._wrKey === wrKey ? measure._wrVal : null;
  if (!wordRuns) {
    wordRuns = [];
    const range = document.createRange();
    sheet.querySelectorAll(".vtext").forEach((el) => {
      const row = el.closest(".vrow");
      const sectionId = row && row.dataset.sectionId;
      const sourceLineId = row && row.dataset.sourceLineId;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue || "";
        if (!text.trim()) continue;
        const s = inkSlack(node.parentElement);
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          for (const r of range.getClientRects()) {
            if (r.width <= 0.4 || r.height <= 1) continue;
            const rr = rel(r);
            const word = { left: rr.left, right: rr.right, top: rr.top + s.top, bottom: rr.bottom - s.bottom };
            if (sourceLineId) word.sourceLineId = sourceLineId;
            if (sectionId) word.sectionId = sectionId;
            wordRuns.push(word);
          }
        }
      }
    });
    measure._wrKey = wrKey; measure._wrVal = wordRuns;
  }
  /* measure number glyphs — a grid-stretched span lies about its box */
  const verseNumberRects = [...sheet.querySelectorAll(".vnum")].map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getClientRects()[0] || el.getBoundingClientRect();
    const obstacle = rel(r);
    const sectionId = el.closest(".vrow")?.dataset.sectionId;
    if (sectionId) obstacle.sectionId = sectionId;
    return obstacle;
  });
  const additionalObstacles = [...sheet.querySelectorAll(".chap-head, .sheet-title, .sheet-ref, .qa-demo-head, .qa-section-label")]
    .map((el) => {
      const obstacle = rel(el.getBoundingClientRect());
      const sectionId = el.closest("[data-route-section]")?.dataset.sectionId;
      if (sectionId) obstacle.sectionId = sectionId;
      if (el.matches(".qa-demo-head")) obstacle.c04Only = true;
      return obstacle;
    });
  const sections = [...sheet.querySelectorAll("[data-route-section]")]
    .map((el) => {
      const bounds = rel(el.getBoundingClientRect());
      return {
        id: el.dataset.sectionId,
        documentOrder: Number(el.dataset.sectionOrder),
        ...bounds,
        bounds: { ...bounds },
      };
    })
    .sort((a, b) => a.documentOrder - b.documentOrder || a.top - b.top || a.id.localeCompare(b.id));
  const sectionGaps = [...sheet.querySelectorAll("[data-route-section-gap]")]
    .map((el, documentOrder) => {
      const bounds = rel(el.getBoundingClientRect());
      return {
        id: el.dataset.gapId,
        fromSectionId: el.dataset.fromSectionId,
        toSectionId: el.dataset.toSectionId,
        beforeSectionId: el.dataset.fromSectionId,
        afterSectionId: el.dataset.toSectionId,
        documentOrder,
        state: el.dataset.gapState,
        hardClear: true,
        ...bounds,
        bounds: { ...bounds },
      };
    });
  const fontSize = parseFloat(getComputedStyle(sheet.querySelector(".vtext")).fontSize);
  const lineHeight = parseFloat(getComputedStyle(sheet.querySelector(".vtext")).lineHeight);
  const sheetStyle = getComputedStyle(sheet);
  const legacyRows = [...sheet.querySelectorAll(".vrow:not([data-section-id])")];
  const legacyLastRow = legacyRows[legacyRows.length - 1];
  const legacySurfaceHeight = legacyLastRow
    ? legacyLastRow.getBoundingClientRect().bottom - base.top +
      parseFloat(sheetStyle.paddingBottom) + parseFloat(sheetStyle.borderBottomWidth)
    : base.height;
  const block = {
    id: "route-lab-source-block",
    bounds: rel(base),
    renderedLines, wordRuns, verseNumberRects, additionalObstacles,
    sections, sectionGaps,
    lineHeight,
    preferredMargin: "left",
    availableLeftMargin: 116,
    availableRightMargin: 40,
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
      const row = spans[0].closest(".vrow");
      const sectionId = row && row.dataset.sectionId;
      const sourceLineId = row && row.dataset.sourceLineId;
      const anchor = {
        id: `${f.id}:${ki}`,
        fragments: mergeByLine(rects).map((r) => {
          const fragment = {
            left: r.left, right: r.right,
            top: r.top + slack.top, bottom: r.bottom - slack.bottom,
          };
          if (sourceLineId) fragment.sourceLineId = sourceLineId;
          if (sectionId) fragment.sectionId = sectionId;
          return fragment;
        }),
        documentOrder: ki,
        sourceLineId,
      };
      if (sectionId) anchor.sectionId = sectionId;
      anchors.push(anchor);
    });
    return { id: f.id, anchors, kind: f.kind, focused: false, fixture: f };
  }).filter((a) => a.anchors.length >= 1);
  return { block, annotations, fontSize, legacySurfaceHeight };
}

/* The frozen C0.3 host projection is a compatibility oracle, not a filtered
 * view of a C0.4 render. Remove every section-owned input before planning so
 * added demo rows cannot change the passage loom datum, companion ranking,
 * committed claims, held-tick stacking, or paint order. Legacy coordinates
 * remain the browser-measured coordinates from the same reading surface. */
function legacyProjectionMeasured(measured) {
  const legacyLines = measured.block.renderedLines.filter((line) => !line.sectionId);
  const legacyWords = measured.block.wordRuns.filter((word) => !word.sectionId);
  const legacyNumbers = measured.block.verseNumberRects.filter((rect) => !rect.sectionId);
  const legacyObstacles = measured.block.additionalObstacles.filter((rect) => !rect.sectionId && !rect.c04Only);
  const isolated = {
    ...measured,
    block: {
      ...measured.block,
      renderedLines: legacyLines,
      wordRuns: legacyWords,
      verseNumberRects: legacyNumbers,
      additionalObstacles: legacyObstacles,
      sections: [],
      sectionGaps: [],
    },
    annotations: measured.annotations.filter((ann) => LEGACY_C03_FIXTURE_SET.has(ann.id)),
  };
  const ids = isolated.annotations.map((ann) => ann.id);
  const inputsAreLegacyOnly = ids.length === LEGACY_C03_FIXTURE_IDS.length &&
    ids.every((id, index) => id === LEGACY_C03_FIXTURE_IDS[index]) &&
    isolated.block.sections.length === 0 && isolated.block.sectionGaps.length === 0 &&
    isolated.block.renderedLines.every((line) => !line.sectionId) &&
    isolated.block.wordRuns.every((word) => !word.sectionId) &&
    isolated.block.verseNumberRects.every((rect) => !rect.sectionId) &&
    isolated.block.additionalObstacles.every((rect) => !rect.sectionId && !rect.c04Only);
  if (!inputsAreLegacyOnly) throw new Error("C0.3 projection isolation failed");
  if (!Number.isFinite(measured.legacySurfaceHeight) || measured.legacySurfaceHeight <= 0) {
    throw new Error("C0.3 projection surface height is not measurable");
  }
  isolated.projectionHeight = measured.legacySurfaceHeight;
  isolated.block.bounds = { ...isolated.block.bounds, bottom: isolated.projectionHeight };
  return isolated;
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

/* A held tick stays inside the SVG even when several annotations share one
 * line. It stacks outward while room exists, then uses tiny vertical rungs
 * at the same rail instead of trespassing into prose or the adjacent panel. */
function placeHeldTick(side, rawX, rawY, used, width, height) {
  const outward = side === "right" ? 1 : -1;
  const minX = 5.5, maxX = Math.max(minX, width - 5.5);
  const baseX = Math.max(minX, Math.min(maxX, rawX));
  const free = (x, y) => !used.some((u) =>
    u.side === side && Math.abs(u.y - y) < 2.5 && Math.abs(u.x - x) < 1);
  for (let step = 0; step < 24; step++) {
    const x = baseX + outward * step * 7;
    if (x < minX || x > maxX) break;
    if (free(x, rawY)) return { x, y: rawY, side, stacked: step > 0 };
  }
  const minY = 6, maxY = Math.max(minY, height - 6);
  for (let step = 1; step < 24; step++) {
    for (const sign of [-1, 1]) {
      const y = rawY + sign * step * 12;
      if (y >= minY && y <= maxY && free(baseX, y)) {
        return { x: baseX, y, side, stacked: true };
      }
    }
  }
  return { x: baseX, y: Math.max(minY, Math.min(maxY, rawY)), side, stacked: true };
}
/* One line type, everywhere. Doubled rails (polyline offsets, then a carved
 * tube) and dashed strokes were tried and rejected — at reading size any
 * second line type reads as a rendering artifact, not a meaning. A thread's
 * kind speaks only through its hue when focused. */
/* split a spine into drawn segments around its hop gaps: gap intervals are
 * clamped to the spine, merged when they touch (tol 0.2), and slivers under
 * 0.25px are dropped — overlapping crossings can never mince the spine */
function splitSpine(spine, gapCenters) {
  if (!spine) return [];
  const y1 = spine.top, y2 = spine.bottom;
  if (y2 - y1 < 0.01) return [];
  const intervals = gapCenters
    .map((y) => [Math.max(y1, y - 1.7), Math.min(y2, y + 1.7)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv[0] <= prev[1] + 0.2) prev[1] = Math.max(prev[1], iv[1]);
    else merged.push([...iv]);
  }
  const segments = [];
  let cursor = y1;
  for (const [a, b] of merged) {
    if (a - cursor > 0.25) segments.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (y2 - cursor > 0.25) segments.push([cursor, y2]);
  return segments;
}
function spineHops(plan, spine) {
  const hops = plan.renderHops || [];
  if (hops.every((entry) => typeof entry === "number")) {
    return planSpines(plan).length === 1 ? hops : [];
  }
  return hops.filter((entry) => entry && entry.spineId === spine.id).map((entry) => entry.y);
}
function spineD(plan, spine) {
  if (!spine) return "";
  return splitSpine(spine, spineHops(plan, spine))
    .map(([a, b]) => `M ${spine.x} ${a.toFixed(2)} L ${spine.x} ${b.toFixed(2)}`)
    .join(" ");
}

function isOwnedSpineSegment(segment, spines) {
  if (segment.role === "spine") return true;
  return segment.type === "L" && Math.abs(segment.x1 - segment.x2) < 0.01 &&
    spines.some((spine) => Math.abs(segment.x1 - spine.x) < 0.01 &&
      Math.min(segment.y1, segment.y2) >= spine.top - 0.01 &&
      Math.max(segment.y1, segment.y2) <= spine.bottom + 0.01);
}

/* Canonical centerline segments carry role + owner ids. Consecutive parts
 * with the same owner stay in one SVG path so tangent joins remain visually
 * continuous; legacy C0.3 plans collapse to one unowned part. */
function drawableRouteParts(plan) {
  const spines = planSpines(plan);
  if (Array.isArray(plan.routeParts) && plan.routeParts.length) {
    return plan.routeParts.flatMap((part, index) => {
      const segments = Array.isArray(part.segments)
        ? part.segments
        : Array.isArray(part.segmentIndexes)
          ? part.segmentIndexes.map((segmentIndex) => plan.centerline[segmentIndex]).filter(Boolean)
          : [];
      const role = part.role || "route";
      if (role === "spine") return [];
      return segments.length ? [{
        key: part.id || `${role}:${index}`,
        partId: part.id || "",
        role,
        ownerId: part.ownerId || part.handoffId || part.runId || part.id || `part-${index}`,
        segments,
      }] : [];
    });
  }
  const parts = [];
  for (const segment of plan.centerline || []) {
    if (isOwnedSpineSegment(segment, spines)) continue;
    const role = segment.role || "route";
    const ownerId = segment.handoffId || segment.runId || segment.ownerId || "whole";
    const key = `${role}:${ownerId}`;
    const previous = parts[parts.length - 1];
    if (previous && previous.key === key) previous.segments.push(segment);
    else parts.push({ key, partId: "", role, ownerId, segments: [segment] });
  }
  return parts;
}

/* Route Lab and Shapes deliberately share one paint grammar. Keeping the
 * route-part painter in one helper means the hidden native preflight and the
 * visible artifact cannot quietly disagree about canonical ownership. */
function paintRouteParts(plan, group, base) {
  const canonicalParts = Array.isArray(plan.routeParts) ? plan.routeParts : [];
  for (const spine of planSpines(plan)) {
    const part = canonicalParts.find((candidate) =>
      candidate.role === "spine" && candidate.ownerId === spine.id);
    const d = spineD(plan, spine);
    if (d) S("path", {
      ...base, d, class: "route-part route-spine",
      "data-route-part": part?.id || "",
      "data-route-role": "spine", "data-route-owner": spine.id,
    }, group);
  }
  for (const part of drawableRouteParts(plan)) {
    const d = pathD(part.segments);
    if (d) S("path", {
      ...base, d, class: `route-part route-${part.role}`,
      "data-route-part": part.partId,
      "data-route-role": part.role, "data-route-owner": part.ownerId,
    }, group);
  }
}

function stableTickKey(annId, sectionId, anchorIds, sourceLineIds) {
  const part = (value) => encodeURIComponent(value || "legacy");
  return `tick:${part(annId)}|section:${part(sectionId)}|anchors:${[...anchorIds].sort().map(part).join("+")}|lines:${[...sourceLineIds].sort().map(part).join("+")}`;
}

/* ── rendering ─────────────────────────────────────────────── */
/* One paradigm, one line type: every drawn thread is the same quiet solid
 * line. The focused thread takes its kind hue at full strength and a
 * slightly heavier stroke; woven companions stay monochrome ink. Held
 * annotations are whisper underlines plus one ink tick per anchor line on
 * a dedicated held rail outside the strands — never on top of a spine. */
function render(measured, ctx) {
  const { plans, focusedId, drawnIds, leftLoomInner, rightLoomInner, strandPitch, layoutHeight } = ctx;
  const svg = sheet.querySelector(".overlay");
  /* capture keyboard position BEFORE the wipe resets activeElement */
  const priorTickKey = requestedTickKey || (document.activeElement && document.activeElement.getAttribute &&
    document.activeElement.getAttribute("data-tick-key")) || null;
  requestedTickKey = null;
  svg.innerHTML = "";
  sheet.classList.toggle("dimmed", true);
  sheet.querySelectorAll(".anchor").forEach((el) => { el.classList.remove("lit"); el.style.removeProperty("--h"); });

  const drawn = measured.annotations.filter((a) => drawnIds.has(a.id));
  const held = measured.annotations.filter((a) => !drawnIds.has(a.id));

  /* held layer: whisper underlines + ink ticks on the held rail.
   * Tick LAYOUT includes a tick-previewed annotation (its thread is
   * bloomed, its tick invisible) so positions and the keyboard's roving
   * focus stay stable through the bloom. */
  const gHeld = S("g", { class: "held-layer" }, svg);
  const svgBox = svg.getBoundingClientRect();
  const svgWidth = svgBox.width;
  const svgHeight = Number.isFinite(layoutHeight) ? layoutHeight : svgBox.height;
  let outerLeftRail = leftLoomInner, outerRightRail = rightLoomInner;
  for (const plan of plans.values()) {
    if (!isMarginPlan(plan)) continue;
    for (const run of planSideRuns(plan)) {
      const x = runRailX(run);
      if (!Number.isFinite(x)) continue;
      if (run.side === "right") outerRightRail = Math.max(outerRightRail, x);
      else outerLeftRail = Math.min(outerLeftRail, x);
    }
  }
  const usedTicks = [];
  const tickHits = [];
  const heldForTicks = measured.annotations.filter((a) => !drawnIds.has(a.id) || a.id === previewId);
  for (const ann of heldForTicks) {
    const visible = !drawnIds.has(ann.id);
    if (visible) for (const a of ann.anchors) for (const f of a.fragments) {
      S("path", {
        d: `M ${f.left + 0.5} ${f.bottom + 2} H ${f.right - 0.5}`,
        stroke: INK, "stroke-width": 1.1, fill: "none", "stroke-linecap": "round", opacity: 0.30,
      }, gHeld);
    }
    /* one tick per anchor LINE (several anchors on one line share a tick);
     * cross-annotation collisions step outward, never onto a strand */
    const tickLineMap = new Map();
    for (const a of ann.anchors) {
      const f = [...a.fragments].sort((p, q) => p.top - q.top)[0];
      const y = (f.top + f.bottom) / 2;
      const sectionId = a.sectionId || f.sectionId || null;
      const sourceLineId = a.sourceLineId || f.sourceLineId || `anchor:${a.id}`;
      const groupingKey = `${sectionId || "legacy"}|${sourceLineId}`;
      const existing = tickLineMap.get(groupingKey);
      if (existing) existing.anchorIds.push(a.id);
      else tickLineMap.set(groupingKey, { y, anchorIds: [a.id], sourceLineIds: [sourceLineId], sectionId });
    }
    const tickLines = [...tickLineMap.values()]
      .map((line) => ({ ...line, key: stableTickKey(ann.id, line.sectionId, line.anchorIds, line.sourceLineIds) }))
      .sort((a, b) => a.y - b.y || a.key.localeCompare(b.key));
    const frozen = previewTickLayouts && previewTickLayouts.annId === ann.id &&
      Math.abs(previewTickLayouts.width - svgWidth) < 0.5 &&
      Math.abs(previewTickLayouts.height - svgHeight) < 0.5
      ? new Map(previewTickLayouts.ticks.map((tick) => [tick.key, tick]))
      : null;
    for (const tickLine of tickLines) {
      const lineY = tickLine.y;
      const shadow = plans.get(ann.id);
      const rememberedTopology = lastTopologies.get(ann.id) || [];
      const rememberedSide = tickLine.sectionId && rememberedTopology.find((entry) => entry.sectionId === tickLine.sectionId);
      const plannedSide = sideForAnchor(shadow, ann, tickLine.anchorIds[0], tickLine.sectionId) ||
        (rememberedSide && rememberedSide.side) || lastSides.get(ann.id) || "left";
      const plannedOutward = plannedSide === "right" ? 1 : -1;
      const heldRailX = (plannedSide === "right" ? outerRightRail : outerLeftRail) + plannedOutward * 4;
      const tick = frozen && frozen.get(tickLine.key)
        ? { ...frozen.get(tickLine.key) }
        : placeHeldTick(plannedSide, heldRailX, lineY, usedTicks, svgWidth, svgHeight);
      const { x, y, stacked } = tick;
      const side = tick.side;
      const outward = side === "right" ? 1 : -1;
      usedTicks.push(tick);
      if (visible) S("path", {
        d: `M ${x.toFixed(2)} ${y.toFixed(2)} h ${(outward * 5.5).toFixed(1)}`, stroke: INK,
        "stroke-width": 1.2, fill: "none", "stroke-linecap": "round", opacity: 0.55, class: "tick",
        "data-tick-side": side,
      }, gHeld);
      tickHits.push({
        x, y, ann, key: tickLine.key, stacked, side, sectionId: tickLine.sectionId,
        anchorIds: tickLine.anchorIds, sourceLineIds: tickLine.sourceLineIds,
      });
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
    const sideRuns = planSideRuns(plan);
    const runSides = [...new Set(sideRuns.map((run) => run.side))];
    const topologySide = runSides.length > 1 ? "mixed" : runSides[0] || "direct";
    const g = S("g", {
      class: focused ? "thread focused" : "thread woven",
      "data-annotation-id": ann.id,
      "data-side": topologySide,
      "data-strand": sideRuns.length === 1 ? sideRuns[0].strand : "",
      "data-topology-signature": topologySignatureOf(plan),
      "data-side-run-count": sideRuns.length,
      "data-handoff-count": planHandoffs(plan).length,
    }, svg);

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
    paintRouteParts(plan, g, base);

    /* weave pause under the focused spine: an angle-invariant mask bite
     * instead of a paper-colored rect — theme-proof by construction */
    if (!focused && plan.renderPatches && plan.renderPatches.length) {
      const W = +svg.getAttribute("width") + 40, H = +svg.getAttribute("height") + 40;
      let defs = svg.querySelector("defs");
      if (!defs) { defs = document.createElementNS(SVGNS, "defs"); svg.insertBefore(defs, svg.firstChild); }
      const mask = S("mask", { id: `weave-${ann.id}`, maskUnits: "userSpaceOnUse", x: -20, y: -20, width: W, height: H }, defs);
      S("rect", { x: -20, y: -20, width: W, height: H, fill: "#fff" }, mask);
      for (const pt of plan.renderPatches) S("circle", { cx: pt.x, cy: pt.y, r: 2.6, fill: "#000" }, mask);
      g.setAttribute("mask", `url(#weave-${ann.id})`);
    }

    /* pins: exactly on the underline endpoints, over the thread start */
    for (const c of plan.contacts) S("circle", { cx: c.x, cy: c.y, r: focused ? 2.6 : 2.4, fill: hue, opacity: tone }, g);
  };

  for (const ann of drawn) {
    if (ann.id === focusedId) continue;
    drawOne(ann);
  }
  const focusedAnn = drawn.find((a) => a.id === focusedId);
  if (focusedAnn) drawOne(focusedAnn);

  /* invisible hit targets for the held ticks — hover was a 1.2px hunt.
   * One roving tab stop: arrows walk the rail, Enter holds, Escape lets
   * go. Stacked ticks get 7px-clipped targets so neighbors stay distinct. */
  const gHits = S("g", { class: "tick-hits" }, svg);
  tickHits.sort((a, b) => a.y - b.y ||
    ({ left: 0, right: 1 }[a.side] - { left: 0, right: 1 }[b.side]) || b.x - a.x);
  const restoreKey = priorTickKey;
  const freezeTickLayout = (annId) => {
    previewTickLayouts = {
      annId, width: svgWidth, height: svgHeight,
      ticks: tickHits.filter((hit) => hit.ann.id === annId)
        .map(({ key, x, y, side, stacked, sectionId, anchorIds, sourceLineIds }) => ({
          key, x, y, side, stacked, sectionId,
          anchorIds: [...anchorIds], sourceLineIds: [...sourceLineIds],
        })),
    };
  };
  tickHits.forEach((t, i) => {
    const w = t.stacked ? 7 : 15.5;
    const rawRx = t.side === "right"
      ? (t.stacked ? t.x - 0.75 : t.x - 5)
      : (t.stacked ? t.x - 6.25 : t.x - 10.5);
    const rx = Math.max(0, Math.min(svgWidth - w, rawRx));
    const r = S("a", {
      href: "#", class: "tick-hit", "data-tick-ann": t.ann.id,
      "data-tick-key": t.key,
      "data-tick-side": t.side,
      "data-tick-section": t.sectionId || "",
      "data-tick-anchors": [...t.anchorIds].sort().join(" "),
      "data-tick-source-lines": [...t.sourceLineIds].sort().join(" "),
      role: "button", "aria-label": `${t.ann.fixture.name}${t.sectionId ? ` · section ${t.sectionId}` : ""} · held on ${t.side} margin`,
      tabindex: i === 0 ? 0 : -1,
    }, gHits);
    S("rect", {
      x: rx.toFixed(2), y: (t.y - 6).toFixed(2), width: w, height: 12,
      fill: "transparent", class: "tick-hit-shape",
    }, r);
    r.style.pointerEvents = "all";
    r.style.cursor = "pointer";
    r.addEventListener("mouseenter", () => {
      if (previewId !== t.ann.id) { freezeTickLayout(t.ann.id); previewId = t.ann.id; run(); }
    });
    const commitTick = () => commitHeldAnnotation(t.ann.id);
    r.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      /* Pointer activation belongs to the completed-gesture delegate.
       * detail=0 preserves keyboard, assistive-tech, and programmatic clicks. */
      if (e.detail === 0) commitTick();
    });
    r.addEventListener("focus", () => {
      /* Escape restores the same semantic tick after the SVG rebuild. That
       * restoration is focus preservation, not a fresh request to bloom. */
      if (restoreTickFocusWithoutPreview) return;
      if (previewId !== t.ann.id) { freezeTickLayout(t.ann.id); previewId = t.ann.id; run(); }
    });
    r.addEventListener("keydown", (e) => {
      const key = (e.key || "").toLowerCase();
      const rects = [...svg.querySelectorAll(".tick-hit")];
      const idx = rects.indexOf(r);
      if (key === "arrowdown" || key === "arrowup") {
        e.preventDefault();
        /* drive the preview from the keydown itself — programmatic focus
         * events are unreliable on unfocused surfaces; render's restore
         * pass moves DOM focus to the previewed rect */
        const nxt = rects[(idx + (key === "arrowdown" ? 1 : rects.length - 1)) % rects.length];
        requestedTickKey = nxt.getAttribute("data-tick-key");
        freezeTickLayout(nxt.getAttribute("data-tick-ann"));
        previewId = nxt.getAttribute("data-tick-ann");
        run();
      } else if (key === "enter" || key === "return" || key === " " || key === "spacebar" ||
          e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
        e.preventDefault();
        commitTick();
      } else if (key === "escape" || e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestedTickKey = r.getAttribute("data-tick-key");
        restoreTickFocusWithoutPreview = true;
        previewId = null;
        previewTickLayouts = null;
        run();
      }
    });
  });
  if (restoreKey) {
    const rects = [...gHits.querySelectorAll(".tick-hit")];
    const again = rects.find((r) => r.getAttribute("data-tick-key") === restoreKey);
    if (again) {
      rects.forEach((r) => r.setAttribute("tabindex", r === again ? 0 : -1));
      again.focus({ preventScroll: true });
    }
  }
  restoreTickFocusWithoutPreview = false;
}

/* ── woven crossings: one line pauses, the other passes ──
 * Default: the traveling shoulder passes, the spine pauses (a hop gap).
 * Hierarchy: the focused thread is never gapped — a shoulder crossing a
 * focused spine takes the gap itself (an eraser patch under the spine). */
/* exact crossing: where does a traveler's centerline cross vertical X?
 * Horizontal travels answer directly; curved segments (all x-monotone
 * quarter cubics) answer by bisection — the gap lands exactly on the
 * curve instead of on a sampled-cluster average. */
function solveCubicYAtX(s, x) {
  const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
  if (x < minX - 0.001 || x > maxX + 0.001) return null;
  let lo = 0, hi = 1;
  const dec = s.x2 < s.x1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, u = 1 - mid;
    const px = u * u * u * s.x1 + 3 * u * u * mid * s.c1x + 3 * u * mid * mid * s.c2x + mid * mid * mid * s.x2;
    if ((dec && px > x) || (!dec && px < x)) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2, u = 1 - t;
  return u * u * u * s.y1 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y2;
}
function crossingsAt(plan, x) {
  const ys = [];
  for (const s of plan.centerline) {
    if (s.type === "L") {
      /* horizontal travels cross; verticals are strand-parallel, never */
      if (Math.abs(s.y2 - s.y1) < 0.01 &&
          x >= Math.min(s.x1, s.x2) - 0.001 && x <= Math.max(s.x1, s.x2) + 0.001) ys.push(s.y1);
    } else {
      const y = solveCubicYAtX(s, x);
      if (y !== null) ys.push(y);
    }
  }
  return ys;
}
function portsForSpine(plan, spine) {
  if (Array.isArray(spine.portIndexes)) return spine.portIndexes.map((index) => plan.ports[index]).filter(Boolean);
  const owned = (plan.ports || []).filter((port) => port.spineId === spine.id ||
    (port.role === "handoff-port" && port.runId === spine.ownerRunId));
  return owned.length ? owned : planSpines(plan).length === 1 ? (plan.ports || []) : [];
}
function computeHops(drawnPlans) {
  for (const p of drawnPlans) { p.renderHops = []; p.renderPatches = []; }
  for (const A of drawnPlans) {
    if (!A.valid) continue;
    for (const B of drawnPlans) {
      if (A === B || !B.valid) continue;
      for (const spine of planSpines(B)) {
        for (const y of crossingsAt(A, spine.x)) {
          if (y < spine.top + 2 || y > spine.bottom - 2) continue;
          if (B.focused && !A.focused) {
            /* focused spine stands: the traveler pauses instead — even near
             * a port, since gapping the traveler never harms B's pour */
            if (!A.renderPatches.some((h) => Math.abs(h.y - y) < 3 && Math.abs(h.x - spine.x) < 1)) {
              A.renderPatches.push({ x: spine.x, y, againstSpineId: spine.id });
            }
          } else {
            /* never gap a spine at its own port merge — the weave yields */
            if (portsForSpine(B, spine).some((pt) => Math.abs(pt.y - y) < 2.6)) continue;
            if (!B.renderHops.some((h) => h.spineId === spine.id && Math.abs(h.y - y) < 3)) {
              B.renderHops.push({ spineId: spine.id, y });
            }
          }
        }
      }
    }
  }
}

/* ── validation suite ──────────────────────────────────────── */
function sampleSegment(segment, step = 1) {
  const controlLength = segment.type === "L"
    ? Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1)
    : Math.hypot(segment.c1x - segment.x1, segment.c1y - segment.y1) +
      Math.hypot(segment.c2x - segment.c1x, segment.c2y - segment.c1y) +
      Math.hypot(segment.x2 - segment.c2x, segment.y2 - segment.c2y);
  const count = Math.max(segment.type === "L" ? 1 : 4, Math.ceil(controlLength / step));
  const points = [];
  for (let index = 0; index <= count; index++) {
    const t = index / count;
    if (segment.type === "L") {
      points.push({ x: segment.x1 + (segment.x2 - segment.x1) * t, y: segment.y1 + (segment.y2 - segment.y1) * t });
    } else {
      const u = 1 - t;
      points.push({
        x: u ** 3 * segment.x1 + 3 * u * u * t * segment.c1x + 3 * u * t * t * segment.c2x + t ** 3 * segment.x2,
        y: u ** 3 * segment.y1 + 3 * u * u * t * segment.c1y + 3 * u * t * t * segment.c2y + t ** 3 * segment.y2,
      });
    }
  }
  return points;
}

function handoffSegments(plan, handoff) {
  if (Array.isArray(handoff.segments)) return handoff.segments;
  if (Array.isArray(handoff.segmentIndexes)) return handoff.segmentIndexes.map((index) => plan.centerline[index]).filter(Boolean);
  return (plan.centerline || []).filter((segment) => segment.handoffId === handoff.id);
}

function sameCanonicalNumber(a, b, epsilon = 1e-6) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}

function canonicalSegmentEqual(a, b) {
  if (!a || !b || a.id !== b.id || a.type !== b.type ||
      a.role !== b.role || a.ownerId !== b.ownerId) return false;
  const geometry = a.type === "C"
    ? ["x1", "y1", "c1x", "c1y", "c2x", "c2y", "x2", "y2"]
    : a.type === "L" ? ["x1", "y1", "x2", "y2"] : null;
  if (!geometry || !geometry.every((field) => sameCanonicalNumber(a[field], b[field]))) return false;
  return ["runId", "spineId", "handoffId", "sectionId", "fromRunId", "toRunId"]
    .every((field) => a[field] == null && b[field] == null || String(a[field]) === String(b[field]));
}

function canonicalRoutePartEvidence(plan) {
  if (!Array.isArray(plan.routeParts) || !Array.isArray(plan.centerline)) return { ok: false, detail: "missing canonical parts" };
  const runs = planSideRuns(plan);
  const spines = planSpines(plan);
  const handoffs = planHandoffs(plan);
  const runById = new Map(runs.map((run) => [run.id, run]));
  const spineById = new Map(spines.map((spine) => [spine.id, spine]));
  const handoffById = new Map(handoffs.map((handoff) => [handoff.id, handoff]));
  if (runById.size !== runs.length || spineById.size !== spines.length || handoffById.size !== handoffs.length ||
      [...runById.keys(), ...spineById.keys(), ...handoffById.keys()].some((id) => typeof id !== "string" || !id)) {
    return { ok: false, detail: "canonical owner ids" };
  }
  if (runs.some((run) => {
    const spine = spineById.get(run.spineId);
    return !spine || String(spine.runId ?? spine.ownerRunId) !== String(run.id);
  }) || handoffs.some((handoff) =>
    !runById.has(handoff.fromRunId) || !runById.has(handoff.toRunId) ||
    !spineById.has(handoff.fromSpineId) || !spineById.has(handoff.toSpineId))) {
    return { ok: false, detail: "owner graph" };
  }

  const centerIds = plan.centerline.map((segment) => segment?.id);
  const centerlineById = new Map(plan.centerline.map((segment) => [segment?.id, segment]));
  if (centerIds.some((id) => typeof id !== "string" || !id) || centerlineById.size !== centerIds.length) {
    return { ok: false, detail: "centerline ids" };
  }
  const allowedRoles = new Set(["tributary", "spine", "handoff"]);
  for (const segment of plan.centerline) {
    if (!allowedRoles.has(segment?.role)) return { ok: false, detail: `centerline role ${segment?.id || "missing"}` };
    if (segment.role === "tributary") {
      const run = runById.get(segment.runId);
      if (!run || segment.ownerId !== run.id || !run.sectionIds?.includes(segment.sectionId)) {
        return { ok: false, detail: `tributary owner ${segment.id}` };
      }
    } else if (segment.role === "spine") {
      const spine = spineById.get(segment.spineId);
      const runId = spine?.runId ?? spine?.ownerRunId;
      if (!spine || segment.ownerId !== spine.id || String(segment.runId) !== String(runId) || !runById.has(runId)) {
        return { ok: false, detail: `spine owner ${segment.id}` };
      }
    } else {
      const handoff = handoffById.get(segment.handoffId);
      if (!handoff || segment.ownerId !== handoff.id ||
          String(segment.fromRunId) !== String(handoff.fromRunId) ||
          String(segment.toRunId) !== String(handoff.toRunId)) {
        return { ok: false, detail: `handoff owner ${segment.id}` };
      }
    }
  }

  const partIds = new Set();
  const covered = [];
  for (const part of plan.routeParts) {
    if (!part || typeof part.id !== "string" || !part.id || typeof part.role !== "string" || !part.role ||
        typeof part.ownerId !== "string" || !part.ownerId || !Array.isArray(part.segments) || !part.segments.length) {
      return { ok: false, detail: "malformed route part" };
    }
    if (partIds.has(part.id)) return { ok: false, detail: `duplicate part id ${part.id}` };
    partIds.add(part.id);
    if (!allowedRoles.has(part.role)) return { ok: false, detail: `part role ${part.id}` };
    if (part.role === "tributary") {
      const run = runById.get(part.runId);
      if (!run || part.ownerId !== run.id || !run.sectionIds?.includes(part.sectionId)) {
        return { ok: false, detail: `tributary part owner ${part.id}` };
      }
    } else if (part.role === "spine") {
      const spine = spineById.get(part.spineId);
      const runId = spine?.runId ?? spine?.ownerRunId;
      if (!spine || part.ownerId !== spine.id || String(part.runId) !== String(runId) || !runById.has(runId)) {
        return { ok: false, detail: `spine part owner ${part.id}` };
      }
    } else {
      const handoff = handoffById.get(part.handoffId);
      if (!handoff || part.ownerId !== handoff.id) return { ok: false, detail: `handoff part owner ${part.id}` };
    }
    for (const segment of part.segments) {
      const canonical = centerlineById.get(segment?.id);
      if (!canonicalSegmentEqual(segment, canonical) || segment.role !== part.role || segment.ownerId !== part.ownerId) {
        return { ok: false, detail: `part segment ${part.id}:${segment?.id || "missing"}` };
      }
      for (const field of ["runId", "spineId", "handoffId", "sectionId"]) {
        if (part[field] != null && String(segment[field]) !== String(part[field])) {
          return { ok: false, detail: `part ${field} ${part.id}` };
        }
      }
      covered.push(segment.id);
    }
  }
  const coverage = new Set(covered);
  if (coverage.size !== covered.length || covered.length !== centerIds.length ||
      centerIds.some((id) => !coverage.has(id))) return { ok: false, detail: "segment omissions/extras" };

  const spineParts = plan.routeParts.filter((part) => part.role === "spine");
  if (spineParts.length !== spines.length || spines.some((spine) =>
    spineParts.filter((part) => part.ownerId === spine.id && part.segments.length === 1 &&
      part.spineId === spine.id && part.segments[0].spineId === spine.id &&
      part.segments[0].type === "L" && sameCanonicalNumber(part.segments[0].x1, spine.x) &&
      sameCanonicalNumber(part.segments[0].x2, spine.x) &&
      sameCanonicalNumber(Math.min(part.segments[0].y1, part.segments[0].y2), spine.top) &&
      sameCanonicalNumber(Math.max(part.segments[0].y1, part.segments[0].y2), spine.bottom)).length !== 1)) {
    return { ok: false, detail: "spine part coverage" };
  }
  const handoffParts = plan.routeParts.filter((part) => part.role === "handoff");
  if (handoffParts.length !== handoffs.length || handoffs.some((handoff) =>
    handoffParts.filter((part) => part.ownerId === handoff.id && part.handoffId === handoff.id &&
      part.segments.length === 1 && part.segments[0].type === "C").length !== 1)) {
    return { ok: false, detail: "handoff part coverage" };
  }
  const activeSections = Array.isArray(plan.sectionSides)
    ? plan.sectionSides.map((entry) => entry.sectionId)
    : runs.flatMap((run) => run.sectionIds || []);
  const tributaryParts = plan.routeParts.filter((part) => part.role === "tributary");
  if (tributaryParts.length !== activeSections.length || activeSections.some((sectionId) =>
    tributaryParts.filter((part) => part.sectionId === sectionId).length !== 1)) {
    return { ok: false, detail: "tributary part coverage" };
  }
  return { ok: true, detail: `${plan.routeParts.length} parts/${centerIds.length} segments` };
}

function renderedRoutePartEvidence(ann, plan, renderedThread = null) {
  const svg = sheet.querySelector(".overlay");
  const thread = renderedThread || [...svg.querySelectorAll(".thread")]
    .find((group) => group.dataset.annotationId === ann.id);
  if (!thread || !Array.isArray(plan.routeParts)) return { ok: false, detail: "missing rendered thread/parts" };
  const actual = [...thread.querySelectorAll("path.route-part")];
  if (actual.length !== plan.routeParts.length) return { ok: false, detail: `${actual.length}/${plan.routeParts.length} rendered parts` };
  const paintedIds = actual.map((path) => path.dataset.routePart);
  if (paintedIds.some((id) => !id) || new Set(paintedIds).size !== paintedIds.length) {
    return { ok: false, detail: "rendered part ids" };
  }
  for (const part of plan.routeParts) {
    const matches = actual.filter((path) => path.dataset.routePart === part.id);
    if (matches.length !== 1) return { ok: false, detail: `missing/duplicate ${part.id}` };
    const path = matches[0];
    if (path.dataset.routeRole !== part.role || path.dataset.routeOwner !== part.ownerId) {
      return { ok: false, detail: `paint ownership ${part.id}` };
    }
    let nativeLength = NaN;
    let bounds = null;
    try { nativeLength = path.getTotalLength(); bounds = path.getBBox(); } catch { /* fail closed below */ }
    if (!Number.isFinite(nativeLength) || nativeLength <= 0) return { ok: false, detail: `invalid path ${part.id}` };
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
      return { ok: false, detail: `invalid bounds ${part.id}` };
    }
    const spine = part.role === "spine" ? planSpines(plan).find((candidate) => candidate.id === part.ownerId) : null;
    const expectedD = spine ? spineD(plan, spine) : pathD(part.segments);
    if (!expectedD || path.getAttribute("d") !== expectedD) {
      return { ok: false, detail: `paint mismatch ${part.id}` };
    }
  }
  return { ok: true, detail: "exact" };
}

function isSectionTopology(plan) {
  return plan?.topology === "sectioned" || Boolean(planHandoffs(plan).length) ||
    planSideRuns(plan).some((run) => (run.sectionIds || []).length);
}

/* A candidate set is provisional until its final deterministic weave has
 * passed the complete host contract. computeHops may split an earlier woven
 * spine when a later companion arrives, so every section route in the
 * provisional set is repainted as its final connected SVG path before the
 * new candidate may commit occupancy or topology memory. */
function stagePlanSetForCommit(measured, entries) {
  const sectionEntries = entries.filter(({ plan }) => isSectionTopology(plan));
  if (!sectionEntries.length) return { ok: true, errors: [] };
  for (const { ann, plan } of sectionEntries) {
    const canonical = canonicalRoutePartEvidence(plan);
    if (!canonical.ok) {
      return { ok: false, errors: [`${ann.id} canonical route parts: ${canonical.detail}`] };
    }
  }

  const provisionalPlans = entries.map(({ plan }) => plan);
  computeHops(provisionalPlans);
  const errors = entries.flatMap(({ ann, plan }) =>
    validate(measured, ann, plan, provisionalPlans, false)
      .filter((check) => !check.ok)
      .map((check) => `${ann.id} ${check.name}: ${check.detail || "failed"}`));
  if (errors.length) return { ok: false, errors };

  const svg = sheet.querySelector(".overlay");
  for (const { ann, plan } of sectionEntries) {
    const stage = S("g", {
      class: "thread route-paint-stage", visibility: "hidden", "aria-hidden": "true",
      "data-annotation-id": ann.id,
    }, svg);
    try {
      paintRouteParts(plan, stage, {
        fill: "none", stroke: INK, "stroke-width": 1.25,
        "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 1,
      });
      const rendered = renderedRoutePartEvidence(ann, plan, stage);
      if (!rendered.ok) return { ok: false, errors: [`${ann.id} rendered route parts: ${rendered.detail}`] };
    } catch (error) {
      return { ok: false, errors: [`${ann.id} native paint: ${error?.message || error}`] };
    } finally {
      stage.remove();
    }
  }
  return { ok: true, errors: [] };
}

function expandedHandoffObstacles(measured) {
  const expand = Math.max(2.5, measured.fontSize * 0.12) + 2.5;
  const hard = measured.block.wordRuns && measured.block.wordRuns.length
    ? measured.block.wordRuns
    : measured.block.renderedLines;
  return [...hard, ...measured.block.verseNumberRects, ...measured.block.additionalObstacles]
    .map((rect) => ({
      left: rect.left - expand, right: rect.right + expand,
      top: rect.top - expand, bottom: rect.bottom + expand,
    }));
}

function pointInsideRect(point, rect) {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function validate(measured, ann, plan, drawnPlans, isDrawn = false) {
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

  const spines = planSpines(plan);
  /* long verticals only on one of this plan's explicit spines */
  if (spines.length) {
    let offRail = 0;
    for (const s of plan.centerline) {
      if (s.type === "L" && Math.abs(s.x2 - s.x1) < 0.01 && Math.abs(s.y2 - s.y1) > measured.block.lineHeight * 1.2) {
        if (!spines.some((spine) => Math.abs(s.x1 - spine.x) <= 0.5 &&
          Math.min(s.y1, s.y2) >= spine.top - 0.05 && Math.max(s.y1, s.y2) <= spine.bottom + 0.05)) offRail++;
      }
    }
    push("spines owned", offRail === 0, String(offRail));
  }

  /* ports: on the strand, tangent-vertical, spine never overshoots */
  if (spines.length) {
    const portErrors = [];
    for (const spine of spines) {
      const ports = portsForSpine(plan, spine);
      const onX = ports.length > 0 && ports.every((port) => Math.abs(port.x - spine.x) < 0.01);
      const inside = ports.every((port) => port.y >= spine.top - 0.01 && port.y <= spine.bottom + 0.01);
      const exact = ports.length > 0 &&
        Math.abs(Math.min(...ports.map((port) => port.y)) - spine.top) < 0.01 &&
        Math.abs(Math.max(...ports.map((port) => port.y)) - spine.bottom) < 0.01;
      if (!onX || !inside || !exact) portErrors.push(spine.id);
    }
    push("ports exact", portErrors.length === 0, portErrors.join(",") || "ok");
  }

  /* weave clearance: crossings are resolved by a hop gap in the spine or
   * an eraser patch on this traveler — anything else is a collision */
  let weaveBad = 0;
  for (const B of drawnPlans) {
    if (B === plan || !B.valid) continue;
    for (const spine of planSpines(B)) {
      for (const p of plan.sampledPoints) {
        if (Math.abs(p.x - spine.x) < 1.7 && p.y > spine.top + 1 && p.y < spine.bottom - 1) {
          const hopped = (B.renderHops || []).some((hop) => hop && hop.spineId === spine.id && Math.abs(p.y - hop.y) < 1.9);
          const patched = (plan.renderPatches || []).some((pt) => Math.abs(pt.x - spine.x) < 1 && Math.abs(pt.y - p.y) < 2.8);
          /* woven-over-woven crossings inside a port merge are yielded by
           * design — converging pours are allowed to touch */
          const yielded = !B.focused && portsForSpine(B, spine).some((pt) => Math.abs(pt.y - p.y) < 4.4);
          if (!hopped && !patched && !yielded) weaveBad++;
        }
      }
    }
  }
  if (drawnPlans.length > 1) push("weave clears", weaveBad === 0, weaveBad ? `${weaveBad} hits` : "ok");

  /* two drawn spines may never sit close enough to read as one broken
   * line — the engine's tripwire, proven end to end */
  if (spines.length && drawnPlans.length > 1) {
    const SEP = Math.min(4.8, 6 - 1.2);
    const clash = spines.some((spine) => drawnPlans.some((B) => B !== plan && B.valid &&
      planSpines(B).some((other) => Math.abs(other.x - spine.x) < SEP &&
        other.top - 2.6 < spine.bottom && spine.top < other.bottom + 2.6)));
    push("spine separation", !clash, clash ? "overlap" : "ok");
  }

  const runs = planSideRuns(plan);
  const handoffs = planHandoffs(plan);
  if (plan.topology === "sectioned" || handoffs.length || runs.some((run) => (run.sectionIds || []).length)) {
    const runIds = new Set(runs.map((run) => run.id));
    const spineIds = new Set(spines.map((spine) => spine.id));
    const gapIds = new Set(measured.block.sectionGaps.map((gap) => gap.id));
    const unique = runIds.size === runs.length && spineIds.size === spines.length &&
      new Set(handoffs.map((handoff) => handoff.id)).size === handoffs.length;
    const owned = runs.every((run) => spines.some((spine) =>
      spine.ownerRunId === run.id || run.spineId === spine.id)) && handoffs.every((handoff) =>
      runIds.has(handoff.fromRunId) && runIds.has(handoff.toRunId) && gapIds.has(handoff.gapId));
    const anchorOwnership = Array.isArray(plan.anchorRuns) && plan.anchorRuns.length === ann.anchors.length &&
      new Set(plan.anchorRuns.map((owner) => owner.anchorId)).size === ann.anchors.length &&
      ann.anchors.every((anchor) => plan.anchorRuns.some((owner) =>
        owner.anchorId === anchor.id && owner.sectionId === anchor.sectionId && runIds.has(owner.runId) &&
        (owner.side === "left" || owner.side === "right") && Number.isInteger(owner.strand)));
    const coalesced = runs.every((run, index) => index === 0 || runs[index - 1].side !== run.side);
    const aliasesHonest = runs.length === 1 || (plan.side == null && plan.strand == null && plan.marginRailX == null && plan.spine == null);
    const segmentsOwned = (plan.centerline || []).every((segment) => segment.role &&
      (segment.runId || segment.spineId || segment.handoffId || segment.ownerId));
    push("topology ownership", unique && owned && anchorOwnership && coalesced && aliasesHonest && segmentsOwned,
      unique && owned && anchorOwnership && coalesced && aliasesHonest && segmentsOwned ? "exact" : "run/spine/handoff mismatch");

    const canonicalParts = canonicalRoutePartEvidence(plan);
    push("canonical route parts", canonicalParts.ok, canonicalParts.detail);
    if (isDrawn) {
      const renderedParts = renderedRoutePartEvidence(ann, plan);
      push("rendered route parts", renderedParts.ok, renderedParts.detail);
    }

    const spineClaims = plan.spineClaimsOut;
    const strandClaims = plan.strandClaimsOut;
    const pluralClaimsExact = Array.isArray(spineClaims) && spineClaims.length === spines.length &&
      Array.isArray(strandClaims) && strandClaims.length === runs.length &&
      new Set(spineClaims.map((claim) => claim.id)).size === spines.length &&
      new Set(strandClaims.map((claim) => claim.id)).size === runs.length &&
      spines.every((spine) => spineClaims.some((claim) => claim.ownerRunId === spine.ownerRunId &&
        claim.x === spine.x && claim.top === spine.top && claim.bottom === spine.bottom &&
        claim.side === spine.side && claim.strand === spine.strand)) &&
      runs.every((run) => strandClaims.some((claim) => claim.ownerRunId === run.id &&
        claim.side === run.side && claim.strand === run.strand && claim.top === run.top && claim.bottom === run.bottom));
    push("plural claims exact", pluralClaimsExact, pluralClaimsExact ? `${spines.length}+${runs.length}` : "missing/extra/misowned");

    const gapErrors = [];
    const obstacles = expandedHandoffObstacles(measured);
    const handoffClaims = plan.handoffClaimsOut;
    const handoffClaimShape = Array.isArray(handoffClaims) && handoffClaims.length === handoffs.length &&
      new Set(handoffClaims.map((claim) => claim.id)).size === handoffs.length;
    for (const handoff of handoffs) {
      const gap = measured.block.sectionGaps.find((candidate) => candidate.id === handoff.gapId);
      const segments = handoffSegments(plan, handoff);
      const segment = segments[0];
      if (!gap || segments.length !== 1 || !segment || segment.type !== "C") {
        gapErrors.push(`${handoff.id}:one-cubic`);
        continue;
      }
      const points = sampleSegment(segment, 0.5);
      const xDirection = Math.sign(segment.x2 - segment.x1);
      const verticalTangents = Math.abs(segment.c1x - segment.x1) <= 0.001 &&
        Math.abs(segment.c2x - segment.x2) <= 0.001 &&
        segment.c1y > segment.y1 && segment.c2y < segment.y2;
      const monotone = xDirection !== 0 && segment.y2 > segment.y1 && points.every((point, index) => index === 0 ||
        (point.x - points[index - 1].x) * xDirection >= -0.0001 && point.y >= points[index - 1].y - 0.0001);
      const contained = points.every((point) =>
        point.x >= gap.left - 0.001 && point.x <= gap.right + 0.001 &&
        point.y >= gap.top - 0.001 && point.y <= gap.bottom + 0.001);
      const clear = points.every((point) => !obstacles.some((obstacle) => pointInsideRect(point, obstacle)));
      const endpoints = Math.abs(segment.x1 - handoff.from.x) <= 0.001 && Math.abs(segment.y1 - handoff.from.y) <= 0.001 &&
        Math.abs(segment.x2 - handoff.to.x) <= 0.001 && Math.abs(segment.y2 - handoff.to.y) <= 0.001;
      const ownership = segment.role === "handoff" && segment.handoffId === handoff.id && segment.ownerId === handoff.id &&
        handoff.fromSpineId && spineIds.has(handoff.fromSpineId) && handoff.toSpineId && spineIds.has(handoff.toSpineId);
      const ownedClaims = Array.isArray(handoffClaims)
        ? handoffClaims.filter((claim) => claim.ownerHandoffId === handoff.id)
        : [];
      const claim = ownedClaims[0];
      const claimExact = ownedClaims.length === 1 && handoff.claimOut === claim && claim.gapId === handoff.gapId &&
        claim.fromSectionId === handoff.fromSectionId && claim.toSectionId === handoff.toSectionId &&
        claim.xMin === Math.min(segment.x1, segment.x2) && claim.xMax === Math.max(segment.x1, segment.x2) &&
        claim.top === segment.y1 && claim.bottom === segment.y2;
      if (!verticalTangents) gapErrors.push(`${handoff.id}:tangents`);
      if (!monotone) gapErrors.push(`${handoff.id}:monotone`);
      if (!contained) gapErrors.push(`${handoff.id}:containment`);
      if (!clear) gapErrors.push(`${handoff.id}:clearance`);
      if (!endpoints || !ownership) gapErrors.push(`${handoff.id}:ownership`);
      if (!claimExact) gapErrors.push(`${handoff.id}:claim`);
    }
    const transitionCardinality = handoffs.length === Math.max(0, runs.length - 1) &&
      handoffs.every((handoff, index) => handoff.fromRunId === runs[index].id && handoff.toRunId === runs[index + 1].id);
    push("handoff cubic proof", gapErrors.length === 0 && handoffClaimShape && transitionCardinality,
      gapErrors.join(",") || `${handoffs.length} hard-clear S`);

    const sectionSides = plan.sectionSides;
    const memory = plan.topologyMemory;
    const expectedSignature = Array.isArray(sectionSides) && sectionSides.length
      ? `section-topology:v1|${sectionSides.map(({ sectionId, side }) => {
          const run = runs.find((candidate) => (candidate.sectionIds || []).includes(sectionId));
          return `${sectionId}:${side && side[0]}${run && run.strand}`;
        }).join("|")}`
      : "";
    const signatureExact = typeof plan.topologySignature === "string" && plan.topologySignature === expectedSignature &&
      memory && memory.topologySignature === plan.topologySignature &&
      JSON.stringify(memory.sectionSides) === JSON.stringify(sectionSides);
    push("topology signature exact", signatureExact, signatureExact ? plan.topologySignature : "missing/fabricated");

    const dp = plan.diagnostics && plan.diagnostics.dp;
    const activeSections = Array.isArray(sectionSides) ? sectionSides.length : 0;
    const boundedDp = dp && activeSections >= 2 && dp.sectionCount === activeSections && dp.maxStatesPerSection === 6 &&
      dp.statesEvaluated === activeSections * 6 && Number.isFinite(dp.transitionsEvaluated) &&
      dp.transitionsEvaluated >= 0 && dp.transitionsEvaluated <= (activeSections - 1) * 36 &&
      Number.isFinite(dp.handoffsEvaluated) && dp.handoffsEvaluated >= 0 && dp.handoffsEvaluated <= dp.transitionsEvaluated;
    push("bounded section DP", Boolean(boundedDp), boundedDp
      ? `${dp.statesEvaluated} states/${dp.transitionsEvaluated} transitions`
      : "missing or unbounded diagnostics");
  }

  /* cradle floor: really exists and never inverts (the floor-length test
   * lives in the engine's slot ladder; this proves it end to end) */
  if (plan.mode === "same-line") {
    const floor = plan.centerline.find((s) => s.type === "L");
    const len = floor ? floor.x2 - floor.x1 : -1;
    push("cradle floor ≥5", len >= 5 - 0.01, `${len.toFixed(1)}px · ${plan.cradleVariant || "?"}`);
  }

  push("clearance", plan.diagnostics.minimumClearance >= 0, `${plan.diagnostics.minimumClearance}px`);
  return checks;
}

/* ── route explanations: structured engine facts → one honest sentence ── */
function explainPlan(plan) {
  if (!plan) return { label: "held", reason: "not planned" };
  if (!plan.valid) {
    const why = {
      "needs-space": "no corridor slot or strand is free in the current weave — held as ticks",
      kink: "a terminal turn had no room to breathe",
      "obstacle-collision": "every legal path would touch ink",
      "host-paint-invalid": "the canonical section route did not survive host and native SVG validation — held without claiming space",
      held: "outside the drawn trio — whisper underline and tick",
    }[plan.reason] || plan.reason;
    return { label: plan.reason === "held" ? "held" : plan.reason, reason: why };
  }
  const runs = planSideRuns(plan);
  const handoffs = planHandoffs(plan);
  const routeArrow = runs.map((run) => run.side === "right" ? "R" : "L").join("→");
  if (handoffs.length) return {
    label: `section S · ${routeArrow}`,
    reason: `${runs.length} section-owned spines pour through ${handoffs.length} measured clear gap${handoffs.length > 1 ? "s" : ""}`,
  };
  const labels = {
    "same-line": plan.cradleVariant === "embrace" ? "direct hammock · embrace" : "direct hammock",
    "local-tag": "local tag",
    "local-comb": "local comb",
    "middle-shaft": "middle shaft",
    tag: "loom tag",
    corridor: `${plan.side || (runs[0] && runs[0].side) || "margin"} loom`,
    multipoint: `${plan.side || (runs[0] && runs[0].side) || "margin"} loom · tributaries`,
  };
  const reasons = {
    "same-line": plan.cradleVariant === "embrace"
      ? "the pair is held as one — outer pins, floor beneath both words; the margin never enters"
      : "both ideas share one verified corridor, so the margin detour disappears",
    "local-tag": "the whole route fits beside the idea itself — a page-edge detour would add ink without adding meaning",
    "local-comb": "the line's pins comb into one short rail beside the phrase; the loom never enters",
    "middle-shaft": "a clear vertical stands in the void beside the ideas — neither endpoint visits the page edge",
    tag: "a single idea; its pin pours into the loom beside its own line",
    corridor: `the ideas span rendered lines; one quiet spine on the ${plan.side || (runs[0] && runs[0].side) || "calmer"} loom carries them`,
    multipoint: `each line's pins comb into tributaries feeding one spine on the ${plan.side || (runs[0] && runs[0].side) || "calmer"} loom`,
  };
  let reason = reasons[plan.mode] || "";
  const cradleDecline = (plan.diagnostics.declined || []).find((d) => d.move.startsWith("cradle"));
  if ((plan.mode === "corridor" || plan.mode === "multipoint") && cradleDecline) {
    reason = `the cradle declined (${cradleDecline.why}); the ${plan.side || (runs[0] && runs[0].side) || "margin"} loom carries the pair instead`;
  }
  return { label: labels[plan.mode] || plan.mode, reason };
}

/* ── orchestration ─────────────────────────────────────────── */
let focusedId = "far-pair";
let previewId = null;
let previewTickLayouts = null;
let requestedTickKey = null;
let restoreTickFocusWithoutPreview = false;
let weaveOn = true;
let cradleOn = true;
let localOn = true;
let middleOn = true;
let lastLeftLoomInner = 0;
let lastRightLoomInner = 0;
let qaSweepActive = false;
/* side memory for the scorer's hysteresis — a held thread refocusing
 * shouldn't flap margins once a right margin exists */
const lastSides = new Map();
/* C0.4 remembers only stable semantic section→side assignments. Pixel
 * coordinates, run indexes, and strands are derived afresh after reflow. */
const lastTopologies = new Map();

function commitHeldAnnotation(annId) {
  focusedId = annId;
  previewId = null;
  previewTickLayouts = null;
  run();
  const fixtureButton = [...document.querySelectorAll(".fixture")]
    .find((button) => button.dataset.fixtureId === annId);
  if (fixtureButton) fixtureButton.focus({ preventScroll: true });
}

/* Hover blooms rebuild the SVG. A capture listener on the stable overlay
 * therefore owns pointer activation: it re-hit-tests the fresh tick at the
 * pointer coordinate instead of trusting the child that existed at hover
 * time. Keyboard/click fallbacks stay on each semantic link. */
function heldTickAtPointer(svg, event) {
  const direct = event.target && event.target.closest && event.target.closest(".tick-hit");
  if (direct && svg.contains(direct)) return direct;
  return [...svg.querySelectorAll(".tick-hit")].find((hit) => {
    const r = hit.getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right &&
      event.clientY >= r.top && event.clientY <= r.bottom;
  }) || null;
}

function qaHash(text) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b) ^ (b >>> 13);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

function qaRound(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : String(value);
  if (Array.isArray(value)) return value.map(qaRound);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, qaRound(value[key])]));
  }
  return value;
}

function qaHasNonFinite(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(qaHasNonFinite);
  if (value && typeof value === "object") return Object.values(value).some(qaHasNonFinite);
  return false;
}

function qaPlanState(plan) {
  if (!plan) return null;
  return {
    valid: plan.valid, reason: plan.reason, mode: plan.mode,
    cradleVariant: plan.cradleVariant, side: plan.side, strand: plan.strand,
    score: plan.diagnostics && plan.diagnostics.score, scoreRaw: plan.scoreRaw,
    contacts: plan.contacts, centerline: plan.centerline, sampledPoints: plan.sampledPoints,
    ports: plan.ports, spine: plan.spine, claimsOut: plan.claimsOut,
    spineClaimOut: plan.spineClaimOut, strandClaimOut: plan.strandClaimOut,
    sideRuns: plan.sideRuns, spines: plan.spines, handoffs: plan.handoffs,
    routeParts: plan.routeParts, anchorRuns: plan.anchorRuns,
    spineClaimsOut: plan.spineClaimsOut, strandClaimsOut: plan.strandClaimsOut,
    handoffClaimsOut: plan.handoffClaimsOut,
    topologySignature: plan.topologySignature, topologyMemory: plan.topologyMemory,
    renderHops: plan.renderHops, renderPatches: plan.renderPatches,
  };
}

function qaPaintSignature(snapshot, width, focusId) {
  const svg = sheet.querySelector(".overlay");
  const svgBox = svg.getBoundingClientRect();
  const ticks = [...svg.querySelectorAll(".tick-hit")].map((hit) => {
    const r = hit.getBoundingClientRect();
    return {
      key: hit.getAttribute("data-tick-key"),
      ann: hit.getAttribute("data-tick-ann"),
      side: hit.getAttribute("data-tick-side"),
      x: r.left - svgBox.left, y: r.top - svgBox.top, width: r.width, height: r.height,
      tabindex: hit.getAttribute("tabindex"),
    };
  });
  const state = {
    width, focusId,
    annotations: snapshot.measured.annotations.map((ann) => ({
      id: ann.id,
      anchors: ann.anchors.map((anchor) => anchor.fragments),
    })),
    drawn: [...snapshot.drawnIds],
    plans: snapshot.measured.annotations.map((ann) => [ann.id, qaPlanState(snapshot.plans.get(ann.id))]),
    checks: snapshot.measured.annotations.map((ann) => [ann.id, snapshot.checks.get(ann.id)]),
    ticks,
    /* This is the actual paint contract, not a reconstruction from the
     * planner: SVG path commands, semantic role/owner, paint order, and
     * browser-native lengths all participate in determinism. */
    paths: [...svg.querySelectorAll("path")].map((path, paintOrder) => ({
      paintOrder,
      d: path.getAttribute("d") || "",
      class: path.getAttribute("class") || "",
      role: path.getAttribute("data-route-role") || "",
      owner: path.getAttribute("data-route-owner") || "",
      tickSide: path.getAttribute("data-tick-side") || "",
      nativeLength: path.getTotalLength(),
    })),
  };
  return qaHash(JSON.stringify(qaRound(state)));
}

function qaLegacyProjection(snapshot, width, focusId) {
  const svg = sheet.querySelector(".overlay");
  const svgBox = svg.getBoundingClientRect();
  const legacyAnnotations = snapshot.measured.annotations.filter((ann) => LEGACY_C03_FIXTURE_SET.has(ann.id));
  const planProjection = (plan) => plan ? {
    valid: plan.valid, reason: plan.reason, mode: plan.mode, cradleVariant: plan.cradleVariant,
    side: plan.side, strand: plan.strand, marginRailX: plan.marginRailX,
    contacts: plan.contacts, centerline: plan.centerline, ports: plan.ports, spine: plan.spine,
    claimsOut: plan.claimsOut, spineClaimOut: plan.spineClaimOut, strandClaimOut: plan.strandClaimOut,
    rawLength: plan.rawLength, scoreRaw: plan.scoreRaw,
    diagnostics: plan.diagnostics && {
      minimumClearance: plan.diagnostics.minimumClearance,
      totalLength: plan.diagnostics.totalLength,
      exits: plan.diagnostics.exits,
      declined: plan.diagnostics.declined,
    },
    renderHops: plan.renderHops, renderPatches: plan.renderPatches,
  } : null;
  const threads = [...svg.querySelectorAll(".thread")]
    .filter((thread) => LEGACY_C03_FIXTURE_SET.has(thread.dataset.annotationId))
    .map((thread) => ({
      id: thread.dataset.annotationId,
      side: thread.dataset.side,
      strand: thread.dataset.strand,
      paths: [...thread.querySelectorAll("path")].map((path) => path.getAttribute("d") || ""),
      pins: [...thread.querySelectorAll("circle")].map((circle) => ({
        cx: Number(circle.getAttribute("cx")), cy: Number(circle.getAttribute("cy")), r: Number(circle.getAttribute("r")),
      })),
    }));
  const ticks = [...svg.querySelectorAll(".tick-hit")]
    .filter((hit) => LEGACY_C03_FIXTURE_SET.has(hit.dataset.tickAnn))
    .map((hit) => {
      const rect = hit.getBoundingClientRect();
      return {
        ann: hit.dataset.tickAnn, side: hit.dataset.tickSide,
        x: rect.left - svgBox.left, y: rect.top - svgBox.top, width: rect.width, height: rect.height,
      };
    });
  return qaHash(JSON.stringify(qaRound({
    version: "c03-host-projection-v1", width, focusId,
    annotations: legacyAnnotations.map((ann) => ({ id: ann.id, anchors: ann.anchors.map((anchor) => anchor.fragments) })),
    plans: legacyAnnotations.map((ann) => [ann.id, planProjection(snapshot.plans.get(ann.id))]),
    drawn: [...snapshot.drawnIds].filter((id) => LEGACY_C03_FIXTURE_SET.has(id)),
    threads, ticks,
  })));
}

async function qaSha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* A focused capture gate for establishing the isolated compatibility oracle
 * without paying for the full two-pass C0.4 paint sweep. It walks the same
 * 301 widths × 15 legacy focuses in the same order and uses the same host
 * projection function as runRenderedSweep. */
async function captureLegacyProjection() {
  const output = document.createElement("output");
  output.id = "c03-projection-result";
  output.dataset.status = "running";
  output.setAttribute("role", "status");
  output.style.cssText = "display:block;margin:0 0 12px;font:500 11px/1.5 var(--mono,monospace);";
  document.querySelector(".panel").prepend(output);
  const original = {
    focusedId, previewId, previewTickLayouts,
    width: sheet.style.width, slider: slider.value,
    widthLabel: document.getElementById("width-val").textContent,
    sides: new Map(lastSides),
    topologies: new Map([...lastTopologies].map(([id, sides]) =>
      [id, sides.map((entry) => ({ ...entry }))])),
    qaSweepActive,
  };
  const sequence = [];
  const browserErrors = [];
  const onError = (event) => browserErrors.push(event.message || "window error");
  const onRejection = (event) => browserErrors.push(`unhandled rejection: ${event.reason && event.reason.message ? event.reason.message : event.reason}`);
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  qaSweepActive = true;
  lastSides.clear();
  lastTopologies.clear();
  let digest = "", fatalError = null;
  try {
    for (let width = 460; width <= 760; width++) {
      sheet.style.width = `${width}px`;
      slider.value = String(width);
      document.getElementById("width-val").textContent = String(width);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const measured = legacyProjectionMeasured(measure());
      for (const id of LEGACY_C03_FIXTURE_IDS) {
        focusedId = id;
        previewId = null;
        previewTickLayouts = null;
        const snapshot = run({ measured });
        const key = `${width}:${id}`;
        sequence.push(`${key}:${qaLegacyProjection(snapshot, width, id)}`);
      }
      if ((width - 459) % 10 === 0 || width === 760) {
        output.textContent = `C0.3 isolated projection · ${width}px`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    digest = await qaSha256(sequence.join("\n"));
  } catch (error) {
    fatalError = error && error.message ? error.message : String(error);
  } finally {
    focusedId = original.focusedId;
    previewId = original.previewId;
    previewTickLayouts = original.previewTickLayouts;
    sheet.style.width = original.width;
    slider.value = original.slider;
    document.getElementById("width-val").textContent = original.widthLabel;
    lastSides.clear();
    for (const [id, side] of original.sides) lastSides.set(id, side);
    lastTopologies.clear();
    for (const [id, sides] of original.topologies) lastTopologies.set(id, sides);
    qaSweepActive = original.qaSweepActive;
    run();
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  }
  const expectedStates = (760 - 460 + 1) * LEGACY_C03_FIXTURE_IDS.length;
  const matchesBaseline = digest === LEGACY_C03_PROJECTION_SHA256;
  const ok = !fatalError && !browserErrors.length && sequence.length === expectedStates && matchesBaseline;
  output.dataset.status = ok ? "pass" : "fail";
  output.dataset.sha256 = digest;
  output.dataset.expectedSha256 = LEGACY_C03_PROJECTION_SHA256;
  output.dataset.states = String(sequence.length);
  output.textContent = ok
    ? `C0.3 isolated projection PASS · ${sequence.length} states · SHA-256 ${digest}`
    : `C0.3 isolated projection FAIL · ${sequence.length}/${expectedStates} states · ${fatalError || browserErrors.slice(0, 3).join(" | ") || `expected ${LEGACY_C03_PROJECTION_SHA256}, got ${digest}`}`;
  return { ok, digest, states: sequence.length, browserErrors, fatalError };
}

/* Query-only browser gate: C0.4 is authoritative and C0.3 remains a useful
 * compatibility URL. Both walk every fixture at every integer width twice
 * from empty semantic-topology memory, exercising the actual rendered SVG. */
async function runRenderedSweep(gate = "c04") {
  const label = gate.toUpperCase();
  const datasetKey = `${gate}Sweep`;
  const output = document.createElement("output");
  output.id = `${gate}-sweep-result`;
  output.dataset[datasetKey] = "running";
  output.dataset.status = "running";
  document.documentElement.dataset[datasetKey] = "running";
  output.setAttribute("role", "status");
  output.style.cssText = "display:block;margin:0 0 12px;font:500 11px/1.5 var(--mono,monospace);";
  document.querySelector(".panel").prepend(output);

  const original = {
    focusedId, previewId, previewTickLayouts,
    width: sheet.style.width,
    slider: slider.value,
    widthLabel: document.getElementById("width-val").textContent,
    sides: new Map(lastSides),
    topologies: new Map([...lastTopologies].map(([id, sides]) => [id, sides.map((entry) => ({ ...entry }))])),
    qaSweepActive,
  };
  qaSweepActive = true;
  const ids = FIXTURES.map((fixture) => fixture.id);
  const expectedStates = (760 - 460 + 1) * ids.length;
  const signatures = new Map();
  const signatureSequence = [];
  const legacyProjectionSequence = [];
  const failures = [];
  const rightWinners = new Set();
  const observedMargins = new Set();
  const observedSectionTopologies = new Set();
  const browserErrors = [];
  const legacyMemory = { sides: new Map(), topologies: new Map() };
  let states = 0, renders = 0, failureCount = 0, digest = "", legacyDigest = "";
  const recordFailure = (failure) => {
    failureCount++;
    if (failures.length < 20) failures.push(failure);
  };
  const onError = (event) => browserErrors.push(event.message || "window error");
  const onRejection = (event) => browserErrors.push(`unhandled rejection: ${event.reason && event.reason.message ? event.reason.message : event.reason}`);
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const cloneTopologies = (source) => new Map([...source].map(([id, sides]) =>
    [id, sides.map((entry) => ({ ...entry }))]));
  const loadMemories = (sides, topologies) => {
    lastSides.clear();
    for (const [id, side] of sides) lastSides.set(id, side);
    lastTopologies.clear();
    for (const [id, sectionSides] of topologies) {
      lastTopologies.set(id, sectionSides.map((entry) => ({ ...entry })));
    }
  };
  const isolatedLegacySnapshot = (measured) => {
    const liveSides = new Map(lastSides);
    const liveTopologies = cloneTopologies(lastTopologies);
    let snapshot;
    try {
      loadMemories(legacyMemory.sides, legacyMemory.topologies);
      snapshot = run({ measured: legacyProjectionMeasured(measured) });
      legacyMemory.sides = new Map(lastSides);
      legacyMemory.topologies = cloneTopologies(lastTopologies);
    } finally {
      loadMemories(liveSides, liveTopologies);
    }
    return snapshot;
  };

  const traverse = async (compare) => {
    lastSides.clear();
    lastTopologies.clear();
    for (let width = 460; width <= 760; width++) {
      sheet.style.width = `${width}px`;
      slider.value = String(width);
      document.getElementById("width-val").textContent = String(width);
      await nextFrame();
      for (const id of ids) {
        focusedId = id;
        previewId = null;
        previewTickLayouts = null;
        const snapshot = run();
        renders++;
        const passNo = compare ? 2 : 1;
        const svg = sheet.querySelector(".overlay");
        const svgBox = svg.getBoundingClientRect();
        const actualWidth = sheet.getBoundingClientRect().width;
        const badDrawn = [...snapshot.drawnIds].filter((drawnId) =>
          !(snapshot.checks.get(drawnId) || []).every((check) => check.ok));
        const nonFinitePlans = ids.filter((annId) => qaHasNonFinite(qaPlanState(snapshot.plans.get(annId))));
        let malformed = false;
        for (const path of svg.querySelectorAll("path")) {
          if (/(?:NaN|Infinity|undefined|null)/.test(path.getAttribute("d") || "")) malformed = true;
          try { if (!Number.isFinite(path.getTotalLength())) malformed = true; } catch { malformed = true; }
        }
        const heldIds = ids.filter((annId) => !snapshot.drawnIds.has(annId));
        const hits = [...svg.querySelectorAll(".tick-hit")];
        const hitIds = new Set(hits.map((hit) => hit.getAttribute("data-tick-ann")));
        const missingTicks = heldIds.filter((annId) => !hitIds.has(annId));
        const stableTickKeys = new Set(hits.map((hit) => hit.getAttribute("data-tick-key"))).size === hits.length &&
          hits.every((hit) => hit.getAttribute("data-tick-key") === stableTickKey(
            hit.getAttribute("data-tick-ann"),
            hit.getAttribute("data-tick-section") || null,
            (hit.getAttribute("data-tick-anchors") || "").split(" ").filter(Boolean),
            (hit.getAttribute("data-tick-source-lines") || "").split(" ").filter(Boolean)));
        const wrongTickSides = hits.flatMap((hit) => {
          const annId = hit.getAttribute("data-tick-ann");
          const ann = snapshot.measured.annotations.find((candidate) => candidate.id === annId);
          const plan = snapshot.plans.get(annId);
          const sectionId = hit.getAttribute("data-tick-section") || null;
          const anchor = ann && ann.anchors.find((candidate) => candidate.sectionId === sectionId) || ann && ann.anchors[0];
          const remembered = (lastTopologies.get(annId) || []).find((entry) => entry.sectionId === sectionId);
          const expected = ann && anchor && sideForAnchor(plan, ann, anchor.id, sectionId) ||
            remembered && remembered.side || lastSides.get(annId) || "left";
          return hit.getAttribute("data-tick-side") === expected ? [] : [{ annId, expected, actual: hit.getAttribute("data-tick-side") }];
        });
        const tickBounds = hits.every((hit) => {
          const r = hit.getBoundingClientRect();
          return r.left >= svgBox.left - 0.1 && r.right <= svgBox.right + 0.1 &&
            r.top >= svgBox.top - 0.1 && r.bottom <= svgBox.bottom + 0.1;
        });
        const tabStops = hits.filter((hit) => hit.getAttribute("tabindex") === "0").length;
        const threadBounds = [...svg.querySelectorAll(".thread")].every((thread) => {
          const r = thread.getBoundingClientRect();
          return r.left >= svgBox.left - 3 && r.right <= svgBox.right + 3 &&
            r.top >= svgBox.top - 3 && r.bottom <= svgBox.bottom + 3;
        });
        if (Math.abs(actualWidth - width) > 0.1 || snapshot.measured.annotations.length !== ids.length ||
            snapshot.drawnIds.size > 3 || badDrawn.length || nonFinitePlans.length || malformed ||
            missingTicks.length || !stableTickKeys || wrongTickSides.length || !tickBounds || !threadBounds ||
            tabStops !== (hits.length ? 1 : 0) || sheet.querySelectorAll(".chip.bad").length) {
          recordFailure({ pass: passNo, width, id, actualWidth, annotations: snapshot.measured.annotations.length,
            drawn: snapshot.drawnIds.size, badDrawn, nonFinitePlans, malformed, missingTicks,
            stableTickKeys, wrongTickSides, tickBounds, threadBounds, tabStops });
        }
        for (const plan of snapshot.plans.values()) for (const run of planSideRuns(plan)) observedMargins.add(run.side);
        const focusPlan = snapshot.plans.get(id);
        const fixture = FIXTURES.find((candidate) => candidate.id === id);
        if (fixture && fixture.expectedTopology) {
          const actualTopology = planSideRuns(focusPlan).map((run) => run.side);
          const expectedTopology = fixture.expectedTopology;
          const exactTopology = actualTopology.length === expectedTopology.length &&
            actualTopology.every((side, index) => side === expectedTopology[index]);
          const handoffCount = planHandoffs(focusPlan).length;
          if (!exactTopology || handoffCount !== expectedTopology.length - 1) {
            recordFailure({ pass: passNo, width, id, expectedTopology, actualTopology, handoffCount });
          } else observedSectionTopologies.add(id);
        }
        if (fixture && fixture.expectedHandoffs === 0 && planHandoffs(focusPlan).length !== 0) {
          recordFailure({ pass: passNo, width, id, expectedHandoffs: 0, actual: planHandoffs(focusPlan).length });
        }
        if (fixture && fixture.expectedSectionDecline) {
          const diagnosticText = JSON.stringify(focusPlan && focusPlan.diagnostics || {});
          if (!/(?:section|gap|handoff)/i.test(diagnosticText)) {
            recordFailure({ pass: passNo, width, id, missingStructuredSectionDecline: true });
          }
        }
        const focusThread = sheet.querySelector('.overlay .thread.focused[data-side="right"]');
        if (!compare && focusThread) rightWinners.add(id);
        const key = `${width}:${id}`;
        const signature = qaPaintSignature(snapshot, width, id);
        if (compare) {
          if (signatures.get(key) !== signature) recordFailure({ pass: 2, width, id, nondeterministic: true });
        } else {
          signatures.set(key, signature);
          signatureSequence.push(`${key}:${signature}`);
          if (LEGACY_C03_FIXTURE_SET.has(id)) {
            const legacySnapshot = isolatedLegacySnapshot(snapshot.measured);
            legacyProjectionSequence.push(`${key}:${qaLegacyProjection(legacySnapshot, width, id)}`);
          }
          states++;
        }
      }
      if ((width - 459) % 10 === 0 || width === 760) {
        output.textContent = `${label} rendered sweep · pass ${compare ? 2 : 1}/2 · ${width}px`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  };

  let fatalError = null;
  try {
    await traverse(false);
    legacyDigest = await qaSha256(legacyProjectionSequence.join("\n"));
    output.dataset.legacyProjectionSha256 = legacyDigest;
    await traverse(true);
    digest = await qaSha256(signatureSequence.join("\n"));
  } catch (error) {
    fatalError = error && error.message ? error.message : String(error);
  } finally {
    try {
      focusedId = original.focusedId;
      previewId = original.previewId;
      previewTickLayouts = original.previewTickLayouts;
      sheet.style.width = original.width;
      slider.value = original.slider;
      document.getElementById("width-val").textContent = original.widthLabel;
      lastSides.clear();
      for (const [id, side] of original.sides) lastSides.set(id, side);
      lastTopologies.clear();
      for (const [id, sides] of original.topologies) lastTopologies.set(id, sides);
      qaSweepActive = original.qaSweepActive;
      run();
    } catch (error) {
      fatalError ||= `restore: ${error && error.message ? error.message : error}`;
    }
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  }

  if (states !== expectedStates) recordFailure({ states, expectedStates });
  if (legacyProjectionSequence.length !== (760 - 460 + 1) * LEGACY_C03_FIXTURE_IDS.length) {
    recordFailure({ legacyProjectionStates: legacyProjectionSequence.length, expected: 4515 });
  }
  if (legacyDigest !== LEGACY_C03_PROJECTION_SHA256) {
    recordFailure({ legacyProjection: "regressed", expected: LEGACY_C03_PROJECTION_SHA256, actual: legacyDigest });
  }
  if (!rightWinners.size) recordFailure({ rightWinner: "missing" });
  if (!observedMargins.has("left") || !observedMargins.has("right")) {
    recordFailure({ observedMargins: [...observedMargins] });
  }
  if (browserErrors.length) recordFailure({ browserErrors: browserErrors.slice(0, 5) });
  if (fatalError) recordFailure({ fatalError });
  const status = failureCount ? "fail" : "pass";
  output.dataset[datasetKey] = status;
  output.dataset.status = status;
  output.dataset.legacyProjectionSha256 = legacyDigest;
  document.documentElement.dataset[datasetKey] = status;
  if (failureCount) {
    output.textContent = `${label} sweep FAIL · ${failureCount} failures · ${states} states · ${renders} renders · ${JSON.stringify(failures.slice(0, 5))}`;
  } else {
    output.textContent = `${label} sweep PASS · ${states} unique states · ${renders} deterministic renders · section S fixtures ${observedSectionTopologies.size} · right winners ${rightWinners.size} · legacy C0.3 ${legacyDigest} · SHA-256 ${digest}`;
  }
}

/* Section provenance is a closed planner input, not a decoration on a
 * passage-wide line list. Give an eligible annotation the contiguous slice
 * of declared semantic sections it spans; collision obstacles and the page
 * bounds remain passage-wide. Legacy annotations explicitly keep the full
 * C0.3 block and never activate section routing. */
function scopedSectionBlock(block, ann) {
  const sectionIds = [...new Set(ann.anchors.map((anchor) => anchor.sectionId).filter(Boolean))];
  const sectionIndex = new Map((block.sections || []).map((section, index) => [section.id, index]));
  const indexes = sectionIds.map((id) => sectionIndex.get(id));
  const explicitSectionIntent = ann.anchors.some((anchor) =>
    Object.prototype.hasOwnProperty.call(anchor, "sectionId") ||
    (anchor.fragments || []).some((fragment) => Object.prototype.hasOwnProperty.call(fragment, "sectionId")));
  const eligible = ann.anchors.length >= 2 && sectionIds.length >= 2 &&
    ann.anchors.every((anchor) => typeof anchor.sectionId === "string" && sectionIndex.has(anchor.sectionId)) &&
    indexes.every(Number.isInteger);
  /* Absence remains legacy opt-out. Partial/unknown/single-section intent is
   * explicitly enabled so the engine records its structured section decline
   * before taking the unchanged whole-route fallback. */
  if (!eligible) return { enabled: explicitSectionIntent, block };
  const first = Math.min(...indexes), last = Math.max(...indexes);
  const sections = block.sections.slice(first, last + 1);
  const selectedIds = new Set(sections.map((section) => section.id));
  return {
    enabled: true,
    block: {
      ...block,
      sections,
      renderedLines: block.renderedLines.filter((line) => selectedIds.has(line.sectionId)),
      sectionGaps: block.sectionGaps.filter((gap) =>
        selectedIds.has(gap.fromSectionId) && selectedIds.has(gap.toSectionId)),
    },
  };
}

function run(options = null) {
  const measured = options && options.measured ? options.measured : measure();
  const svg = sheet.querySelector(".overlay");
  const b = sheet.getBoundingClientRect();
  svg.setAttribute("width", b.width);
  svg.setAttribute("height", Number.isFinite(measured.projectionHeight) ? measured.projectionHeight : b.height);

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
  let minLeft = Infinity, maxRight = -Infinity;
  for (const r of [...measured.block.renderedLines, ...measured.block.verseNumberRects, ...measured.block.additionalObstacles]) {
    minLeft = Math.min(minLeft, r.left - expand);
    maxRight = Math.max(maxRight, r.right + expand);
  }
  const leftLoomInner = minLeft - 10;
  const rightLoomInner = maxRight + 10;
  lastLeftLoomInner = leftLoomInner;
  lastRightLoomInner = rightLoomInner;

  /* density policy IS the aesthetic: the focused thread fully drawn, at most
   * two companions woven beside it, everything else held as ticks. Corridor
   * claims come only from threads that actually paint — invisible threads
   * must not consume corridor space or strand budget. */
  const plans = new Map();
  const strands = new Map();
  const claims = [];
  const spineClaims = [];
  const strandClaims = [];
  const handoffClaims = [];
  const drawnIds = new Set();
  const tryPlan = (ann, commit, focused) => {
    try {
      const previousSectionSides = lastTopologies.get(ann.id);
      const sectionInput = scopedSectionBlock(measured.block, ann);
      const p = planRoute(sectionInput.block, ann, {
        fontSize: measured.fontSize,
        corridorClaims: claims, spineClaims, strandClaims, handoffClaims,
        loomX: leftLoomInner, leftLoomX: leftLoomInner, rightLoomX: rightLoomInner,
        focused, sides: ["left", "right"], previousSide: lastSides.get(ann.id),
        sectionRouting: { enabled: sectionInput.enabled, previousSides: previousSectionSides || [] },
        previousTopology: previousSectionSides ? { sectionSides: previousSectionSides } : undefined,
        previousSectionSides,
        allowMiddle: focused && middleOn,
        disableCradle: !cradleOn, disableLocal: !localOn,
        /* every claim carries a little air so stacked shoulders never
         * read as one line */
        claimPad: 0.25,
      });
      plans.set(ann.id, p);
      if (p.valid && commit) {
        p.focused = focused;
        const committedEntries = [...drawnIds].map((id) => ({
          ann: anns.find((candidate) => candidate.id === id),
          plan: plans.get(id),
        })).filter((entry) => entry.ann && entry.plan);
        const staged = stagePlanSetForCommit(measured, [...committedEntries, { ann, plan: p }]);
        if (!staged.ok) {
          computeHops(committedEntries.map((entry) => entry.plan));
          plans.set(ann.id, {
            ...p,
            valid: false,
            reason: "host-paint-invalid",
            hostValidationErrors: staged.errors,
          });
          return false;
        }
        /* Occupancy and hysteresis are one transaction: neither becomes
         * visible to a later candidate until canonical host checks and the
         * connected native SVG preflight above have both succeeded. */
        claims.push(...p.claimsOut);
        spineClaims.push(...planSpineClaims(p));
        strandClaims.push(...planStrandClaims(p));
        if (Array.isArray(p.handoffClaimsOut)) handoffClaims.push(...p.handoffClaimsOut);
        drawnIds.add(ann.id);
        /* cradles and local rails never touch the loom; a section topology
         * exposes every run instead of fabricating one representative lane. */
        strands.set(ann.id, planSideRuns(p).map((run) => ({ side: run.side, strand: run.strand })));
        if (isMarginPlan(p)) {
          const sectionSides = p.topologyMemory && Array.isArray(p.topologyMemory.sectionSides)
            ? p.topologyMemory.sectionSides
            : topologySides(p);
          if (sectionSides.length) lastTopologies.set(ann.id,
            sectionSides.map(({ sectionId, side }) => ({ sectionId, side })));
          if (planSideRuns(p).length === 1) lastSides.set(ann.id, planSideRuns(p)[0].side);
        }
      }
      return p.valid;
    } catch (e) {
      plans.set(ann.id, { valid: false, reason: "engine-error: " + (e.message || e) });
      return false;
    }
  };

  const focusAnn = anns.find((a) => a.id === effectiveFocus) || anns[0];
  if (focusAnn) { tryPlan(focusAnn, true, true); }

  /* companions ranked "beside" the COMMITTED focus, not the preview — a
   * hover bloom adds the previewed thread and demotes the committed focus
   * to a woven companion, instead of reshuffling the whole margin.
   * Acceptance still requires an actual valid route; strand choice is the
   * engine's, driven by committed strand claims. */
  const rankAnchorId = anns.some((a) => a.id === focusedId) ? focusedId : focusAnn ? focusAnn.id : null;
  const intervals = anns.map((a) => ({ id: a.id, ...iv.get(a.id) }));
  const ranked = rankCompanions(intervals, rankAnchorId)
    .map((id) => anns.find((a) => a.id === id))
    .filter((a) => a !== focusAnn);

  if (weaveOn && focusAnn) {
    for (const cand of ranked) {
      if (drawnIds.size >= 3) break;
      tryPlan(cand, true, false);
    }
  }

  /* everything else: shadow-plan for the suite (claims untouched), held */
  for (const ann of anns) {
    if (plans.has(ann.id)) continue;
    tryPlan(ann, false, false);
  }

  const drawnPlans = [...drawnIds].map((id) => plans.get(id));
  drawnPlans.forEach((p) => { p.focused = p === plans.get(effectiveFocus); });
  computeHops(drawnPlans);

  render(measured, {
    plans, focusedId: effectiveFocus, drawnIds,
    leftLoomInner, rightLoomInner, strandPitch: 6,
    layoutHeight: measured.projectionHeight,
  });
  window.__RL_STATE = {
    focusedId, previewId,
    effectiveFocus,
    drawnIds: [...drawnIds],
    sides: Object.fromEntries(lastSides),
    topologies: Object.fromEntries([...lastTopologies].map(([id, sectionSides]) => [id, sectionSides])),
  };
  window.__RL_PLANS = plans;

  /* panel */
  const list = document.getElementById("fixture-list");
  if (!qaSweepActive) list.innerHTML = "";
  const checksById = new Map();
  let pass = 0;
  for (const ann of anns) {
    const plan = plans.get(ann.id);
    const isDrawn = drawnIds.has(ann.id);
    const checks = plan && plan.valid && (isDrawn || !qaSweepActive)
      ? validate(measured, ann, plan, isDrawn ? drawnPlans : [plan], isDrawn)
      : [];
    checksById.set(ann.id, checks);
    (window.__CHECKS = window.__CHECKS || {})[ann.id] = checks;
    const ok = plan && plan.valid && checks.every((c) => c.ok);
    if (isDrawn && ok) pass++;
    if (qaSweepActive) continue;
    const btn = document.createElement("button");
    btn.className = "fixture" + (ann.id === effectiveFocus ? " sel" : "");
    btn.dataset.fixtureId = ann.id;
    const chip = isDrawn
      ? `<span class="chip ${ok ? "ok" : "bad"}">${ok ? "pass" : "fail"}</span>`
      : plan && plan.valid
        ? `<span class="chip held">held</span>`
        : `<span class="chip held">${plan && plan.reason ? plan.reason : "held"}</span>`;
    const st = strands.get(ann.id);
    const strandBadge = isDrawn
      ? (Array.isArray(st) && st.length
        ? `<span class="strand">${st.map((run) => `${run.side === "right" ? "r" : "l"}${run.strand}`).join("→")}</span>`
        : `<span class="strand">${plan.mode === "same-line" ? "direct" : plan.mode === "middle-shaft" ? "shaft" : "local"}</span>`)
      : "";
    const ex = explainPlan(plan);
    btn.innerHTML = `<span class="frow"><i class="dot" style="background:${HUES[ann.kind]}"></i>
      <span class="fname">${ann.fixture.name}</span>${strandBadge}${chip}</span>
      <span class="fdiag">${plan && plan.valid
        ? `${plan.mode}${plan.cradleVariant ? "·" + plan.cradleVariant : ""} · clear ${plan.diagnostics.minimumClearance}px · ${plan.diagnostics.totalLength}px · ${ann.anchors.length} anchor${ann.anchors.length > 1 ? "s" : ""}${plan.renderHops && plan.renderHops.length ? ` · ${plan.renderHops.length} hops` : ""}`
        : `${ann.anchors.length} anchor${ann.anchors.length > 1 ? "s" : ""}`}</span>${
      ann.id === effectiveFocus ? `<span class="freason">${ex.label} — ${ex.reason}</span>` : ""}`;
    btn.addEventListener("click", () => {
      focusedId = ann.id; previewId = null; previewTickLayouts = null; run();
    });
    list.appendChild(btn);
  }
  if (!qaSweepActive) {
    document.getElementById("suite-summary").textContent =
      `${drawnIds.size} drawn (${pass}/${drawnIds.size} pass) · ${anns.length - drawnIds.size} held as ticks · ${explainPlan(plans.get(effectiveFocus)).label}`;
  }
  return { measured, plans, drawnIds: new Set(drawnIds), checks: checksById };
}

const slider = document.getElementById("width-slider");
slider.addEventListener("input", () => {
  sheet.style.width = slider.value + "px";
  document.getElementById("width-val").textContent = slider.value;
  requestAnimationFrame(run);
});
const weaveBox = document.getElementById("weave-toggle");
if (weaveBox) weaveBox.addEventListener("change", () => { weaveOn = weaveBox.checked; run(); });
const cradleBox = document.getElementById("cradle-toggle");
if (cradleBox) cradleBox.addEventListener("change", () => { cradleOn = cradleBox.checked; run(); });
const localBox = document.getElementById("local-toggle");
if (localBox) localBox.addEventListener("change", () => { localOn = localBox.checked; run(); });
const middleBox = document.getElementById("middle-toggle");
if (middleBox) middleBox.addEventListener("change", () => { middleOn = middleBox.checked; run(); });
addEventListener("resize", () => requestAnimationFrame(run));

/* a bloomed tick re-renders as a thread, so its own mouseleave can never
 * fire — the bloom ends when the pointer returns to the text column.
 * Direct call, no rAF: frames are on-demand in headless surfaces, and the
 * previewId guard already makes this a one-shot. */
sheet.addEventListener("pointermove", (e) => {
  if (!previewId) return;
  const r = sheet.getBoundingClientRect();
  const x = e.clientX - r.left;
  if (x > lastLeftLoomInner + 24 && x < lastRightLoomInner - 24) {
    previewId = null;
    previewTickLayouts = null;
    run();
  }
});

buildSheet();
const stableOverlay = sheet.querySelector(".overlay");
let pendingTickPointer = null;
let suppressTickClick = null;
stableOverlay.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.isPrimary === false) return;
  const hit = heldTickAtPointer(stableOverlay, event);
  if (!hit) return;
  pendingTickPointer = {
    pointerId: event.pointerId,
    key: hit.getAttribute("data-tick-key"),
    x: event.clientX,
    y: event.clientY,
  };
}, true);
sheet.addEventListener("pointerup", (event) => {
  const pending = pendingTickPointer;
  pendingTickPointer = null;
  if (!pending || pending.pointerId !== event.pointerId) return;
  /* A tick-origin gesture owns its one follow-up click even when movement or
   * a bloom rerender makes the completed gesture ineligible to commit. */
  suppressTickClick = { x: event.clientX, y: event.clientY, until: performance.now() + 250 };
  if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) return;
  const hit = heldTickAtPointer(stableOverlay, event);
  if (!hit || hit.getAttribute("data-tick-key") !== pending.key) return;
  event.preventDefault();
  event.stopPropagation();
  commitHeldAnnotation(hit.getAttribute("data-tick-ann"));
}, true);
sheet.addEventListener("pointercancel", () => { pendingTickPointer = null; }, true);
sheet.addEventListener("click", (event) => {
  const suppression = suppressTickClick;
  suppressTickClick = null;
  if (!suppression || performance.now() > suppression.until ||
      Math.hypot(event.clientX - suppression.x, event.clientY - suppression.y) > 8) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
const routeFontsReady = document.fonts && document.fonts.ready
  ? document.fonts.ready
  : Promise.resolve();
routeFontsReady.then(() => {
  run();
  const qa = new URLSearchParams(location.search).get("qa");
  if (qa === "c04-sweep") setTimeout(() => runRenderedSweep("c04"), 0);
  else if (qa === "c03-sweep") setTimeout(() => runRenderedSweep("c03"), 0);
  else if (qa === "c03-projection") setTimeout(() => captureLegacyProjection(), 0);
});

/* lab introspection */
window.RL = {
  measure, planRoute, assignStrands, FIXTURES, captureLegacyProjection,
  focus: (id) => { focusedId = id; previewId = null; previewTickLayouts = null; run(); },
  state: () => ({
    focusedId, previewId,
    sides: Object.fromEntries(lastSides),
    topologies: Object.fromEntries(lastTopologies),
  }),
};
