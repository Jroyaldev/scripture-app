/* Pattern shapes lab — phrase-anchored pattern marks.
 * Marks key on exact words (Range-measured, same approach as HighlightUnderlay):
 * a fine phrase underline + hairline connectors drawn word-to-word.
 * The gutter stays nearly empty; the text itself carries the shape. */

const state = { motif: "arcs", theme: "light" };

const KIND_HUE = {
  "link:parallel": "var(--k-parallel)",
  "link:contrast": "var(--k-contrast)",
  "link:echo": "var(--k-echo)",
  hinge: "var(--k-parallel)",
  mirror: "var(--k-mirror)",
  series: "var(--k-series)",
};
const KIND_LABEL = {
  "link:parallel": "parallelism", "link:contrast": "contrast", "link:echo": "echo",
  hinge: "hinge", mirror: "mirror", series: "series",
};

const SVGNS = "http://www.w3.org/2000/svg";
function S(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

const GLYPH_PATHS = {
  address: "M7 3.4 A3.6 3.6 0 1 1 6.9 3.4 Z",
  know:    "M7 2.4 L11.6 7 L7 11.6 L2.4 7 Z",
  commend: "M7 2.8 L11.6 10.6 L2.4 10.6 Z",
  rebuke:  "M7 11.2 L2.4 3.4 L11.6 3.4 Z",
  exhort:  "M4.2 2.8 L9.8 7 L4.2 11.2",
  promise: "M7 1.8 C7.9 5.1 8.9 6.1 12.2 7 C8.9 7.9 7.9 8.9 7 12.2 C6.1 8.9 5.1 7.9 1.8 7 C5.1 6.1 6.1 5.1 7 1.8 Z",
  ear:     "M4.6 10.6 A4.4 4.4 0 1 1 10.4 8.6",
  contrast:"M7 2.2 A4.8 4.8 0 0 1 7 11.8 Z M7 2.2 A4.8 4.8 0 0 0 7 11.8",
  echo:    "M3 9.4 A3.8 3.8 0 1 1 6.8 10.8 M3 9.4 L2.8 6.6 M3 9.4 L5.8 9.2",
  mirror:  "M2.4 3 L6.2 7 L2.4 11 Z M11.6 3 L7.8 7 L11.6 11 Z",
  hinge:   "M7 2.6 L11.4 7 L7 11.4 L2.6 7 Z M7 5.4 L8.6 7 L7 8.6 L5.4 7 Z",
};
function glyph(name, x, y, hue, opts = {}) {
  const g = document.createElementNS(SVGNS, "g");
  g.setAttribute("transform", `translate(${x - 7} ${y - 7})${opts.scale ? ` scale(${opts.scale})` : ""}`);
  const p = S("path", {
    d: GLYPH_PATHS[name], fill: opts.fill ? hue : "none", stroke: hue,
    "stroke-width": opts.sw || 1.5, "stroke-linecap": "round", "stroke-linejoin": "round",
  }, g);
  if (opts.dash) p.setAttribute("stroke-dasharray", opts.dash);
  return g;
}

/* ── sheets ──────────────────────────────────────────────── */
const SHEETS = {
  psa: { title: "Psalm 1", ref: "PSA.1.1–6 · WEB", chapters: [{ head: null, key: "PSA.1" }] },
  gen: { title: "The creation week", ref: "GEN.1.1 – 2.3 · WEB", chapters: [{ head: "Genesis 1", key: "GEN.1" }, { head: "Genesis 2", key: "GEN.2" }] },
  rev: { title: "Letters to the seven assemblies", ref: "REV.2.1 – 3.22 · WEB", chapters: [{ head: "Revelation 2", key: "REV.2" }, { head: "Revelation 3", key: "REV.3" }] },
};
const TRUNCATE = { rev: 190 };

function buildSheets() {
  for (const [id, cfg] of Object.entries(SHEETS)) {
    const sheet = document.querySelector(`[data-sheet="${id}"]`);
    sheet.innerHTML = "";
    const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = cfg.title;
    const r = document.createElement("div"); r.className = "sheet-ref"; r.textContent = cfg.ref;
    sheet.append(t, r);
    for (const ch of cfg.chapters) {
      if (ch.head) { const h = document.createElement("div"); h.className = "chap-head"; h.textContent = ch.head; sheet.appendChild(h); }
      for (const v of VERSES[ch.key]) {
        const row = document.createElement("div");
        row.className = "vrow"; row.dataset.key = `${ch.key}.${v.verse}`;
        const num = document.createElement("span"); num.className = "vnum"; num.textContent = v.verse;
        const txt = document.createElement("span"); txt.className = "vtext";
        const limit = TRUNCATE[id];
        if (limit && v.text.length > limit) {
          const cut = v.text.slice(0, limit);
          txt.textContent = cut.slice(0, cut.lastIndexOf(" ")) + " …";
        } else txt.textContent = v.text;
        row.append(num, txt); sheet.appendChild(row);
      }
    }
    const svg = S("svg", { class: "overlay", "data-overlay": id }); sheet.appendChild(svg);
    const legend = document.createElement("div"); legend.className = "legend"; legend.dataset.legend = id;
    sheet.appendChild(legend);
  }
}

/* ── phrase measurement ──────────────────────────────────── */
function measureBase(sheetId) {
  const sheet = document.querySelector(`[data-sheet="${sheetId}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const base = svg.getBoundingClientRect();
  const rows = {};
  let textLeft = Infinity;
  sheet.querySelectorAll(".vrow").forEach((row) => {
    const r = row.getBoundingClientRect();
    rows[row.dataset.key] = { top: r.top - base.top, bottom: r.bottom - base.top, mid: r.top - base.top + r.height / 2 };
    textLeft = Math.min(textLeft, row.querySelector(".vtext").getBoundingClientRect().left - base.left);
  });
  const W = sheet.getBoundingClientRect().width, H = sheet.getBoundingClientRect().height;
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  return { sheet, svg, base, rows, textLeft, W, H };
}

/* exact-word geometry: all line rects the phrase spans, in overlay coordinates */
function phraseRects(G, ref, phrase) {
  const vt = G.sheet.querySelector(`[data-key="${ref}"] .vtext`);
  if (!vt || !vt.firstChild) return null;
  const node = vt.firstChild;
  const idx = node.textContent.indexOf(phrase);
  if (idx < 0) { console.warn("phrase missing", ref, phrase); return null; }
  const range = document.createRange();
  range.setStart(node, idx); range.setEnd(node, idx + phrase.length);
  return [...range.getClientRects()].map((r) => ({
    x: r.left - G.base.left, right: r.right - G.base.left,
    top: r.top - G.base.top, bottom: r.bottom - G.base.top,
  }));
}

/* ── mark primitives ─────────────────────────────────────── */
function mark(G, pid, member, draw) {
  const g = S("g", { class: "pm", "data-pid": pid }, G.svg);
  if (member) g.dataset.member = member;
  draw(g);
  return g;
}
const UL = 3.5; // underline offset below baseline box

function underline(g, rects, hue, { style = "solid", sw = 1.6 } = {}) {
  for (const r of rects) {
    const y = r.bottom + UL - 2;
    const p = S("path", {
      d: `M ${r.x + 0.5} ${y} H ${r.right - 0.5}`, fill: "none", stroke: hue,
      "stroke-width": sw, "stroke-linecap": "round", class: "stroke-main",
    }, g);
    if (style === "dotted") { p.setAttribute("stroke-dasharray", "0.1 4.6"); p.setAttribute("stroke-width", sw + 0.5); }
    if (style === "double") S("path", {
      d: `M ${r.x + 0.5} ${y + 3.2} H ${r.right - 0.5}`, fill: "none", stroke: hue,
      "stroke-width": 1, "stroke-linecap": "round", class: "stroke-main", opacity: 0.8,
    }, g);
  }
}

/* bezier word-to-word connector, bowing fully into the margin lane */
function connect(g, a, b, hue, { style = "solid", sw = 1.3, lane } = {}) {
  const x1 = a.x, y1 = a.bottom + UL, x2 = b.x, y2 = b.bottom + UL;
  const sameLine = Math.abs(y1 - y2) < 5;
  let d;
  if (sameLine) {
    const sx = a.right + 4, ex = b.x - 4, dip = 13;
    d = `M ${sx} ${y1} C ${sx + 4} ${y1 + dip}, ${ex - 4} ${y2 + dip}, ${ex} ${y2}`;
  } else {
    // deep enough bow that the curve's leftmost point rests in the gutter lane
    const target = lane ?? Math.min(x1, x2) - 30;
    const bow = Math.max((Math.min(x1, x2) - target) / 0.72, 14);
    d = `M ${x1} ${y1} C ${x1 - bow} ${y1 + 2}, ${x2 - bow} ${y2 - 2}, ${x2} ${y2}`;
  }
  const p = S("path", {
    d, fill: "none", stroke: hue, "stroke-width": sw,
    "stroke-linecap": "round", class: "stroke-main",
  }, g);
  if (style === "dotted") { p.setAttribute("stroke-dasharray", "0.1 5"); p.setAttribute("stroke-width", sw + 0.6); }
  if (style === "broken") { p.setAttribute("pathLength", "100"); p.setAttribute("stroke-dasharray", "45.5 9 45.5"); }
  S("path", { d, fill: "none", stroke: "transparent", "stroke-width": 12 }, g); // hit area
  if (!sameLine) {
    S("circle", { cx: x1, cy: y1, r: 2.1, fill: hue, class: "fill-main" }, g);
    S("circle", { cx: x2, cy: y2, r: 2.1, fill: hue, class: "fill-main" }, g);
  }
  return p;
}

/* orthogonal variant — the vertical leg always rests in the gutter lane */
function connectElbow(g, a, b, hue, { style = "solid", sw = 1.2, lane } = {}) {
  const x1 = a.x, y1 = a.bottom + UL, x2 = b.x, y2 = b.bottom + UL;
  const laneX = lane ?? Math.min(x1, x2) - 20;
  const d = `M ${x1} ${y1} H ${laneX + 3} Q ${laneX} ${y1} ${laneX} ${y1 + 3} V ${y2 - 3} Q ${laneX} ${y2} ${laneX + 3} ${y2} H ${x2}`;
  const p = S("path", {
    d, fill: "none", stroke: hue, "stroke-width": sw,
    "stroke-linecap": "round", "stroke-linejoin": "round", class: "stroke-main",
  }, g);
  if (style === "dotted" || style === "broken") p.setAttribute("stroke-dasharray", style === "broken" ? "5 4" : "0.1 4.5");
  S("path", { d, fill: "none", stroke: "transparent", "stroke-width": 12 }, g);
  S("circle", { cx: x1, cy: y1, r: 1.8, fill: hue, class: "fill-main" }, g);
  S("circle", { cx: x2, cy: y2, r: 1.8, fill: hue, class: "fill-main" }, g);
}

/* whisper-quiet block spine for wide structures */
function spine(g, x, top, bottom, hue, label) {
  S("path", { d: `M ${x} ${top} V ${bottom}`, stroke: hue, "stroke-width": 1, opacity: 0.22, class: "stroke-main" }, g);
  if (label) {
    const lx = x - 52; // labels sit left of every connector lane, never under a curve
    const t = S("text", {
      x: lx, y: (top + bottom) / 2, "text-anchor": "middle", "font-size": 8.5,
      "letter-spacing": "0.14em", "font-family": "var(--font-mono)", fill: "var(--text-tertiary)",
      opacity: 0.8, transform: `rotate(-90 ${lx} ${(top + bottom) / 2})`,
    }, g);
    t.textContent = label.toUpperCase();
  }
}

/* ── shared per-study logic, parameterized by motif ──────── */
function drawLink(G, pattern, style, elbow) {
  const hue = KIND_HUE[pattern.kind];
  const rects = pattern.members.map((m) => phraseRects(G, m.key.ref, m.key.phrase));
  if (rects.some((r) => !r)) return;
  mark(G, pattern.id, null, (g) => {
    const ulStyle = pattern.kind === "link:echo" ? "dotted" : pattern.kind === "hinge" ? "double" : "solid";
    underline(g, rects[0], hue, { style: ulStyle });
    underline(g, rects[1], hue, { style: ulStyle });
    const linkStyle = style === "broken" ? "broken" : pattern.kind === "link:echo" ? "dotted" : "solid";
    (elbow ? connectElbow : connect)(g, rects[0][0], rects[1][0], hue, { style: linkStyle, lane: G.textLeft - 16 });
  });
}

function drawPsalm(G, motif) {
  const elbow = motif === "ortho";
  for (const p of PATTERNS.psa) {
    if (p.id === "psa1-two-ways") drawLink(G, p, "broken", elbow);
    else drawLink(G, p, "solid", elbow);
    if (motif === "glyphs") {
      // glyph-first: symbol above each key phrase's first word
      const hue = KIND_HUE[p.kind];
      const glyphName = p.kind === "link:contrast" ? "contrast" : p.kind === "link:echo" ? "echo" : "hinge";
      mark(G, p.id, null, (g) => {
        for (const m of p.members) {
          const rs = phraseRects(G, m.key.ref, m.key.phrase);
          if (rs) g.appendChild(glyph(glyphName, rs[0].x + 5, rs[0].top - 7, hue, { scale: 0.85 }));
        }
      });
    }
  }
}

function drawGen(G, motif) {
  const mirror = PATTERNS.gen[0], refrain = PATTERNS.gen[1];
  const hueM = KIND_HUE.mirror, hueS = KIND_HUE.series;
  const elbow = motif === "ortho";
  mark(G, mirror.id, null, (g) => {
    const form = { top: G.rows["GEN.1.3"].top, bottom: G.rows["GEN.1.13"].bottom };
    const fill = { top: G.rows["GEN.1.14"].top, bottom: G.rows["GEN.1.31"].bottom };
    spine(g, G.textLeft - 10, form.top, form.bottom, hueM, motif === "glyphs" ? null : "forming");
    spine(g, G.textLeft - 10, fill.top, fill.bottom, hueM, motif === "glyphs" ? null : "filling");
    for (const [i, pair] of mirror.pairs.entries()) {
      const ra = phraseRects(G, pair.a.ref, pair.a.phrase);
      const rb = phraseRects(G, pair.b.ref, pair.b.phrase);
      if (!ra || !rb) continue;
      underline(g, ra, hueM); underline(g, rb, hueM);
      (elbow ? connectElbow : connect)(g, ra[0], rb[0], hueM, { lane: G.textLeft - 26 - i * 11 });
      if (motif === "glyphs") {
        g.appendChild(glyph("mirror", ra[0].x + 5, ra[0].top - 7, hueM, { scale: 0.85 }));
        g.appendChild(glyph("mirror", rb[0].x + 5, rb[0].top - 7, hueM, { scale: 0.85 }));
      }
    }
  });
  mark(G, refrain.id, null, (g) => {
    let prevTop = null;
    for (const m of refrain.members) {
      const rs = phraseRects(G, m.key.ref, m.key.phrase);
      if (!rs) continue;
      if (motif === "glyphs") {
        g.appendChild(glyph("promise", rs[0].x + 5, rs[0].top - 7, hueS, { scale: 0.7 }));
      } else {
        underline(g, rs, hueS, { sw: 1.4 });
      }
      if (prevTop === null) prevTop = rs[0].top;
    }
  });
}

function drawRev(G, motif) {
  const letters = PATTERNS.rev[0];
  const hue = KIND_HUE.series;
  const keyOrder = ["address", "know", "promise", "ear"];
  for (const m of letters.members) {
    mark(G, letters.id, m.role, (g) => {
      const first = G.rows[m.range[0]], last = G.rows[m.range[1]];
      spine(g, G.textLeft - 10, first.top + 2, last.bottom - 2, hue, null);
      const label = S("text", {
        x: G.textLeft - 16, y: first.top + 8, "text-anchor": "end", "font-size": 8,
        "letter-spacing": "0.12em", "font-family": "var(--font-mono)", fill: "var(--text-tertiary)",
      }, g);
      label.textContent = m.role.toUpperCase();
      for (const el of keyOrder) {
        const k = m.keys[el];
        const rs = phraseRects(G, k.ref, k.phrase);
        if (!rs) continue;
        if (motif === "glyphs") {
          g.appendChild(glyph(el, rs[0].x + 5, rs[0].top - 7, hue, { scale: 0.8 }));
        } else {
          underline(g, rs, hue, { sw: 1.4 });
        }
      }
    });
  }
}

const STUDY_DRAW = { psa: drawPsalm, gen: drawGen, rev: drawRev };

/* ── panels ──────────────────────────────────────────────── */
function buildPanel(study) {
  const panel = document.querySelector(`[data-panel="${study}"]`);
  panel.innerHTML = "";
  if (study === "psa") {
    panel.innerHTML = `<h3>Shape view · the two ways</h3><div class="panel-sub">PSA.1 · contrast + frame</div>
      <div class="lattice" style="grid-template-columns: 1fr 1fr">
        <div class="lcell pm" data-pid="psa1-two-ways"><div class="day" style="color:${KIND_HUE["link:contrast"]}">the righteous · 1–3</div><div class="cell-excerpt">${excerpt("PSA.1.1", 14)}</div><div class="cell-ref">tree · water · fruit · prospering</div></div>
        <div class="lcell pm" data-pid="psa1-two-ways"><div class="day" style="color:${KIND_HUE["link:contrast"]}">the wicked · 4–5</div><div class="cell-excerpt">${excerpt("PSA.1.4", 8)}</div><div class="cell-ref">chaff · wind · no standing</div></div>
      </div>
      <div class="coda-strip pm" data-pid="psa1-frame"><div class="day" style="color:${KIND_HUE["link:echo"]}">frame · 1 &amp; 6</div><div class="cell-excerpt">${excerpt("PSA.1.6", 12)}</div></div>`;
  }
  if (study === "gen") {
    const pairs = PATTERNS.gen[0].pairs;
    panel.innerHTML = `<h3>Shape view · forming &amp; filling</h3><div class="panel-sub">GEN.1.3–31 · mirror</div>
      <div class="lattice" style="grid-template-columns: 1fr 1fr">
        ${pairs.map((p, i) => `
          <div class="lcell pm" data-pid="gen1-form-fill"><div class="day" style="color:${KIND_HUE.mirror}">day ${i + 1} · formed</div><div class="cell-excerpt">${excerpt(p.a.ref, 9)}</div></div>
          <div class="lcell pm" data-pid="gen1-form-fill"><div class="day" style="color:${KIND_HUE.mirror}">day ${i + 4} · filled</div><div class="cell-excerpt">${excerpt(p.b.ref, 9)}</div></div>`).join("")}
      </div>
      <div class="coda-strip pm" data-pid="gen1-refrain"><div class="day" style="color:${KIND_HUE.series}">the refrain · “it was good” ×7</div><div class="cell-excerpt">${excerpt("GEN.1.31", 12)}</div></div>`;
  }
  if (study === "rev") {
    const P = PATTERNS.rev[0];
    const els = P.elementSchema;
    panel.innerHTML = `<h3>Shape view · one letter, seven times</h3><div class="panel-sub">REV.2–3 · series · absence is data</div>
      <div class="matrix" style="grid-template-columns: 110px repeat(7, 1fr)">
        <div></div>${els.map((e) => `<div class="mhead">${e}</div>`).join("")}
        ${P.members.map((m) => `<div class="mrow pm" data-pid="rev23-letters" data-member="${m.role}">
          <div class="mrow-label">${m.role}<span class="cell-ref">${m.range[0].replace("REV.", "Rv ")}–${m.range[1].split(".")[2]}</span></div>
          ${els.map((el) => {
            const has = !!m.elements[el];
            const partial = (m.partial || []).includes(el);
            return `<div class="mcell">${has ? glyphSVGString(el, partial, el === "ear" ? m.earPos : null) : `<span style="color:var(--border-medium);font-size:9px">·</span>`}</div>`;
          }).join("")}
        </div>`).join("")}
      </div>
      <div class="legend"><span class="chip" style="cursor:default">≺ ear before promise · ≻ ear after — the flip after Thyatira is the shape changing</span></div>`;
  }
}
function glyphSVGString(name, partial, earPos) {
  const extra = earPos ? `<text x="${earPos === "pre" ? -4 : 18}" y="10" font-size="7" font-family="var(--font-mono)" fill="var(--text-tertiary)">${earPos === "pre" ? "≺" : "≻"}</text>` : "";
  return `<svg class="glyph" width="18" height="18" viewBox="-4 -4 22 22" style="overflow:visible;opacity:${partial ? 0.45 : 1}"><path d="${GLYPH_PATHS[name]}" fill="none" stroke="var(--k-series)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${extra}</svg>`;
}

/* ── legend ──────────────────────────────────────────────── */
function buildLegend(study, patterns) {
  const el = document.querySelector(`[data-legend="${study}"]`);
  el.innerHTML = "";
  for (const p of patterns) {
    const chip = document.createElement("span"); chip.className = "chip";
    chip.innerHTML = `<svg width="10" height="10"><circle cx="5" cy="5" r="3.4" fill="${KIND_HUE[p.kind]}"/></svg>${KIND_LABEL[p.kind]} · ${p.label}`;
    chip.dataset.pid = p.id;
    el.appendChild(chip);
  }
}

/* ── hover: gold is a verb, and a name appears on request ── */
const tip = document.createElement("div");
tip.className = "mark-tip"; document.body.appendChild(tip);
let tipText = {};

function wireHover() {
  document.querySelectorAll(".study").forEach((scope) => {
    scope.addEventListener("mouseover", (e) => {
      const t = e.target.closest(".pm, .chip"); if (!t || !scope.contains(t)) return;
      const pid = t.dataset.pid, member = t.dataset.member;
      scope.querySelectorAll("svg.overlay, .panel").forEach((o) => o.classList.add("hovering"));
      scope.querySelectorAll(".pm").forEach((m) => {
        if (m.dataset.pid === pid && (!member || m.dataset.member === member)) m.classList.add("focus");
      });
      if (tipText[pid]) {
        tip.textContent = (member ? member + " · " : "") + tipText[pid];
        tip.classList.add("on");
      }
    });
    scope.addEventListener("mousemove", (e) => {
      if (tip.classList.contains("on")) { tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 16 + "px"; }
    });
    scope.addEventListener("mouseout", (e) => {
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".pm, .chip")) return;
      scope.querySelectorAll(".hovering").forEach((o) => o.classList.remove("hovering"));
      scope.querySelectorAll(".pm.focus").forEach((m) => m.classList.remove("focus"));
      tip.classList.remove("on");
    });
  });
}

/* ── render cycle ────────────────────────────────────────── */
function renderOverlays() {
  for (const study of ["psa", "gen", "rev"]) {
    const sheet = document.querySelector(`[data-sheet="${study}"]`);
    let svg = sheet.querySelector("svg.overlay");
    svg.remove();
    svg = S("svg", { class: "overlay", "data-overlay": study });
    sheet.insertBefore(svg, sheet.querySelector(".legend"));
    const G = measureBase(study);
    STUDY_DRAW[study](G, state.motif);
  }
}
function renderAll() {
  buildSheets();
  tipText = {};
  for (const s of ["psa", "gen", "rev"]) {
    buildPanel(s); buildLegend(s, PATTERNS[s]);
    for (const p of PATTERNS[s]) tipText[p.id] = `${KIND_LABEL[p.kind]} · ${p.label}`;
    document.querySelector(`[data-payload="${s}"]`).textContent = JSON.stringify(PATTERNS[s], null, 2);
  }
  renderOverlays();
}

/* ── switchers ───────────────────────────────────────────── */
function syncSeg() {
  document.querySelectorAll("#motif-seg button").forEach((x) => x.setAttribute("aria-checked", x.dataset.motif === state.motif));
  document.querySelectorAll("#atm-seg button").forEach((x) => x.setAttribute("aria-checked", x.dataset.theme === state.theme));
}
document.getElementById("motif-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.motif = b.dataset.motif; syncSeg(); renderOverlays();
});
document.getElementById("atm-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.theme = b.dataset.theme; syncSeg();
  document.body.className = `theme-${state.theme}`;
  requestAnimationFrame(renderOverlays);
});

window.addEventListener("resize", () => requestAnimationFrame(renderOverlays));
syncSeg();
renderAll();
wireHover();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderOverlays);
