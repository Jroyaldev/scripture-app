/* Pattern shapes lab · v3 — "the text awakens".
 * At rest the page is almost plain scripture: keyed phrases carry only a
 * whisper of a dotted hint. Touch one and its whole pattern wakes — sibling
 * phrases ink in, a connector draws itself through the gutter, the rest of
 * the page recedes, and a small whisper names the shape. Click pins it.
 * No dialect switcher, no chrome at rest: one opinionated language. */

const hovered = new Set(); // gids under the cursor
const pinned = new Set();  // gids pinned by click

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

/* glyphs — used only by the Revelation matrix panel */
const GLYPH_PATHS = {
  address: "M7 3.4 A3.6 3.6 0 1 1 6.9 3.4 Z",
  know:    "M7 2.4 L11.6 7 L7 11.6 L2.4 7 Z",
  commend: "M7 2.8 L11.6 10.6 L2.4 10.6 Z",
  rebuke:  "M7 11.2 L2.4 3.4 L11.6 3.4 Z",
  exhort:  "M4.2 2.8 L9.8 7 L4.2 11.2",
  promise: "M7 1.8 C7.9 5.1 8.9 6.1 12.2 7 C8.9 7.9 7.9 8.9 7 12.2 C6.1 8.9 5.1 7.9 1.8 7 C5.1 6.1 6.1 5.1 7 1.8 Z",
  ear:     "M4.6 10.6 A4.4 4.4 0 1 1 10.4 8.6",
};

/* ── sheets ──────────────────────────────────────────────── */
const SHEETS = {
  psa: { title: "Psalm 1", ref: "PSA.1.1–6 · WEB", chapters: [{ head: null, key: "PSA.1" }] },
  gen: { title: "The creation week", ref: "GEN.1.1 – 2.3 · WEB", chapters: [{ head: "Genesis 1", key: "GEN.1" }, { head: "Genesis 2", key: "GEN.2" }] },
  rev: { title: "Letters to the seven assemblies", ref: "REV.2.1 – 3.22 · WEB", chapters: [{ head: "Revelation 2", key: "REV.2" }, { head: "Revelation 3", key: "REV.3" }] },
};
const TRUNCATE = { rev: 190 };

/* ── awaken groups (gids) ────────────────────────────────── */
/* A gid is one touchable pattern instance: hover any of its phrases and
 * every member wakes together. Derived from PATTERNS, never stored. */
const GIDS = {};
function addGid(gid, study, kind, label, keys, conn) {
  GIDS[gid] = { gid, study, kind, hue: KIND_HUE[kind], label, keys: keys.filter(Boolean), conn, spans: [], anchors: [] };
}
function buildGids() {
  for (const p of PATTERNS.psa) {
    addGid(p.id, "psa", p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`, p.members.map((m) => m.key), "arc");
  }
  PATTERNS.gen[0].pairs.forEach((pair, i) => {
    addGid(`gen1-form-fill:${i}`, "gen", "mirror", `mirror · ${pair.label}`, [pair.a, pair.b], "arc");
  });
  addGid("gen1-refrain", "gen", "series", "series · “God saw that it was good” ×7",
    PATTERNS.gen[1].members.map((m) => m.key), "thread");
  const R = PATTERNS.rev[0];
  const ELEMS = {
    address: "“To the angel … write” ×7",
    know: "“I know your works” ×7",
    promise: "“he who overcomes” ×7",
    ear: "“he who has an ear” ×7",
  };
  for (const el of Object.keys(ELEMS)) {
    addGid(`rev23:${el}`, "rev", "series", `series · ${ELEMS[el]}`, R.members.map((m) => m.keys[el]), "thread");
  }
}

const LEGEND = {
  psa: () => PATTERNS.psa.map((p) => ({ label: `${KIND_LABEL[p.kind]} · ${p.label}`, kind: p.kind, gids: [p.id] })),
  gen: () => [
    { label: "mirror · forming ↔ filling", kind: "mirror", gids: ["gen1-form-fill:0", "gen1-form-fill:1", "gen1-form-fill:2"] },
    { label: "series · the goodness refrain", kind: "series", gids: ["gen1-refrain"] },
  ],
  rev: () => [
    { label: "the address", kind: "series", gids: ["rev23:address"] },
    { label: "“I know your works”", kind: "series", gids: ["rev23:know"] },
    { label: "the overcomer promise", kind: "series", gids: ["rev23:promise"] },
    { label: "“he who has an ear”", kind: "series", gids: ["rev23:ear"] },
  ],
};

/* letter boundaries for Revelation — quiet structural heads, like chapter heads */
const LETTER_STARTS = {};
for (const m of PATTERNS.rev[0].members) LETTER_STARTS[m.range[0]] = m.role;

/* ── build: verses with phrase spans woven in ────────────── */
function versePlan(study, ref, text) {
  const ranges = [];
  for (const gid in GIDS) {
    const G = GIDS[gid];
    if (G.study !== study) continue;
    for (const k of G.keys) {
      if (k.ref !== ref) continue;
      const idx = text.indexOf(k.phrase);
      if (idx < 0) { console.warn("phrase missing", ref, k.phrase); continue; }
      ranges.push({ start: idx, end: idx + k.phrase.length, gid, ref, phrase: k.phrase });
    }
  }
  return ranges;
}

function appendSegments(container, text, ranges) {
  const pts = new Set([0, text.length]);
  ranges.forEach((r) => { pts.add(r.start); pts.add(r.end); });
  const cuts = [...pts].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1];
    const seg = text.slice(s, e);
    const cover = ranges.filter((r) => r.start <= s && r.end >= e);
    if (!cover.length) { container.appendChild(document.createTextNode(seg)); continue; }
    const el = document.createElement("span");
    el.className = "pk"; el.textContent = seg;
    el.dataset.gids = cover.map((r) => r.gid).join(" ");
    el.style.setProperty("--h", GIDS[cover[0].gid].hue);
    container.appendChild(el);
    cover.forEach((r) => {
      GIDS[r.gid].spans.push(el);
      if (r.start === s) GIDS[r.gid].anchors.push({ el, ref: r.ref, phrase: r.phrase });
    });
  }
}

function buildSheets() {
  for (const [id, cfg] of Object.entries(SHEETS)) {
    const sheet = document.querySelector(`[data-sheet="${id}"]`);
    sheet.innerHTML = "";
    for (const gid in GIDS) if (GIDS[gid].study === id) { GIDS[gid].spans = []; GIDS[gid].anchors = []; }
    const t = document.createElement("div"); t.className = "sheet-title"; t.textContent = cfg.title;
    const r = document.createElement("div"); r.className = "sheet-ref"; r.textContent = cfg.ref;
    sheet.append(t, r);
    for (const ch of cfg.chapters) {
      if (ch.head) { const h = document.createElement("div"); h.className = "chap-head"; h.textContent = ch.head; sheet.appendChild(h); }
      for (const v of VERSES[ch.key]) {
        const ref = `${ch.key}.${v.verse}`;
        if (LETTER_STARTS[ref] && id === "rev") {
          const lh = document.createElement("div");
          lh.className = "letter-head"; lh.dataset.letter = LETTER_STARTS[ref];
          lh.textContent = LETTER_STARTS[ref];
          sheet.appendChild(lh);
        }
        let text = v.text;
        const ranges = versePlan(id, ref, text);
        const limit = TRUNCATE[id];
        if (limit && text.length > limit) {
          const cut = text.slice(0, limit);
          const cutAt = cut.lastIndexOf(" ");
          if (ranges.every((rg) => rg.end <= cutAt)) text = cut.slice(0, cutAt) + " …";
        }
        const row = document.createElement("div");
        row.className = "vrow"; row.dataset.key = ref;
        const num = document.createElement("span"); num.className = "vnum"; num.textContent = v.verse;
        const txt = document.createElement("span"); txt.className = "vtext";
        appendSegments(txt, text, ranges.filter((rg) => rg.end <= text.length));
        row.append(num, txt); sheet.appendChild(row);
      }
    }
    sheet.appendChild(S("svg", { class: "overlay" }));
    const wh = document.createElement("div"); wh.className = "whisper"; sheet.appendChild(wh);
    const legend = document.createElement("div"); legend.className = "legend";
    for (const entry of LEGEND[id]()) {
      const chip = document.createElement("span");
      chip.className = "chip"; chip.dataset.gids = entry.gids.join(" ");
      chip.innerHTML = `<svg width="9" height="9"><circle cx="4.5" cy="4.5" r="3" fill="${KIND_HUE[entry.kind]}"/></svg>${entry.label}`;
      legend.appendChild(chip);
    }
    sheet.appendChild(legend);
  }
}

/* ── overlay: connectors that draw themselves on awaken ──── */
function measure(sid) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const base = sheet.getBoundingClientRect();
  svg.setAttribute("width", base.width); svg.setAttribute("height", base.height);
  let textLeft = Infinity;
  sheet.querySelectorAll(".vrow .vtext").forEach((el) => {
    textLeft = Math.min(textLeft, el.getBoundingClientRect().left - base.left);
  });
  return { sheet, svg, base, textLeft };
}
function firstRect(M, el) {
  const r = el.getClientRects()[0];
  if (!r) return null;
  return { x: r.left - M.base.left, right: r.right - M.base.left, top: r.top - M.base.top, bottom: r.bottom - M.base.top };
}
function animDraw(p, ms = 340) {
  const L = p.getTotalLength();
  p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
  p.getBoundingClientRect();
  p.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.3,.7,.3,1)`;
  p.style.strokeDashoffset = 0;
}
function animFade(el, ms = 240) {
  el.style.opacity = 0;
  el.getBoundingClientRect();
  el.style.transition = `opacity ${ms}ms ease`;
  el.style.opacity = 1;
}

/* Connectors are one continuous gesture that actually touches the marks:
 * underline → touch dot → leg (hairline at underline height, quieter) →
 * gutter spine (always the same margin) → leg → touch dot → underline.
 * The spine never crosses text; the legs run at underline level so they
 * read as the underline reaching out to the margin. */
function dashFor(p, kind) {
  if (kind === "link:echo") { p.setAttribute("stroke-dasharray", "0.1 5"); p.setAttribute("stroke-width", 1.9); }
}
function leg(g, x1, x2, y, hue, kind) {
  const p = S("path", {
    d: `M ${x1} ${y} H ${x2}`, fill: "none", stroke: hue,
    "stroke-width": 1.2, "stroke-linecap": "round", opacity: 0.5,
  }, g);
  dashFor(p, kind);
  animFade(p);
}
function touchDot(g, x, y, hue, delay = 0) {
  animFade(S("circle", { cx: x, cy: y, r: 1.8, fill: hue }, g), 200 + delay);
}

function drawArc(g, a, b, hue, kind, lane, gx) {
  const y1 = a.bottom + 2.5, y2 = b.bottom + 2.5;
  const sameLine = Math.abs(y1 - y2) < 5;
  if (sameLine) {
    const sx = a.right + 4, ex = b.x - 4, dip = 12;
    const p = S("path", {
      d: `M ${sx} ${y1} C ${sx + 4} ${y1 + dip}, ${ex - 4} ${y2 + dip}, ${ex} ${y2}`,
      fill: "none", stroke: hue, "stroke-width": 1.3, "stroke-linecap": "round",
    }, g);
    dashFor(p, kind);
    animDraw(p);
    return;
  }
  const p = S("path", {
    d: `M ${gx} ${y1} C ${lane} ${y1 + 3}, ${lane} ${y2 - 3}, ${gx} ${y2}`,
    fill: "none", stroke: hue, "stroke-width": 1.3, "stroke-linecap": "round",
  }, g);
  if (kind === "link:echo") { dashFor(p, kind); animFade(p); }
  else if (kind === "link:contrast") { p.setAttribute("pathLength", 100); p.setAttribute("stroke-dasharray", "45.5 9 45.5"); animFade(p); }
  else animDraw(p);
  leg(g, gx, a.x - 2, y1, hue, kind);
  leg(g, gx, b.x - 2, y2, hue, kind);
  touchDot(g, a.x - 2, y1, hue);
  touchDot(g, b.x - 2, y2, hue);
}

function drawThread(g, rects, hue, laneX) {
  const ys = rects.map((r) => r.bottom + 2.5);
  const line = S("path", { d: `M ${laneX} ${ys[0]} V ${ys[ys.length - 1]}`, stroke: hue, "stroke-width": 1, fill: "none", opacity: 0.55 }, g);
  animDraw(line, 420);
  rects.forEach((r, i) => {
    const l = S("path", { d: `M ${laneX} ${ys[i]} H ${r.x - 2}`, stroke: hue, "stroke-width": 1, opacity: 0.35 }, g);
    animFade(l, 200 + i * 40);
    touchDot(g, r.x - 2, ys[i], hue, i * 40);
  });
}

function drawOverlay(sid, gids) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const key = gids.slice().sort().join("|");
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  svg.innerHTML = "";
  if (!gids.length) return;
  const M = measure(sid);
  gids.forEach((gid, i) => {
    const G = GIDS[gid];
    const rects = G.anchors.map((a) => firstRect(M, a.el)).filter(Boolean);
    if (rects.length < 2) return;
    const g = S("g", {}, svg);
    if (G.conn === "thread") drawThread(g, rects, G.hue, M.textLeft - 46 - i * 10);
    else drawArc(g, rects[0], rects[rects.length - 1], G.hue, G.kind, M.textLeft - 40 - i * 10, M.textLeft - 12);
  });
}

/* ── awaken state ────────────────────────────────────────── */
function activeGids() { return new Set([...pinned, ...hovered]); }

function applyActive() {
  const act = activeGids();
  for (const sid of Object.keys(SHEETS)) {
    const sheet = document.querySelector(`[data-sheet="${sid}"]`);
    const local = [...act].filter((g) => GIDS[g].study === sid);
    sheet.classList.toggle("awake", local.length > 0);
    sheet.querySelectorAll(".pk.on").forEach((el) => el.classList.remove("on"));
    for (const gid of local) for (const el of GIDS[gid].spans) el.classList.add("on");
    drawOverlay(sid, local);
  }
  document.querySelectorAll("[data-gids]").forEach((c) => {
    if (!c.classList.contains("chip") && !c.classList.contains("mcell") && !c.classList.contains("mhead")) return;
    c.classList.toggle("on", c.dataset.gids.split(" ").some((g) => act.has(g)));
  });
  updatePills();
  updateCard();
}

/* whisper — the pattern names itself, anchored to the touched phrase */
function showWhisper(pk) {
  const sheet = pk.closest(".sheet");
  const wh = sheet.querySelector(".whisper");
  const gids = pk.dataset.gids.split(" ");
  wh.textContent = gids.map((g) => GIDS[g].label).join("  +  ");
  wh.style.color = GIDS[gids[0]].hue;
  const base = sheet.getBoundingClientRect();
  const r = pk.getClientRects()[0];
  wh.style.left = Math.max(8, Math.min(r.left - base.left, base.width - 300)) + "px";
  wh.style.top = (r.top - base.top - 24) + "px";
  wh.classList.add("on");
}
function hideWhisper() {
  document.querySelectorAll(".whisper.on").forEach((w) => w.classList.remove("on"));
}

/* off-screen awareness — quiet pills at the viewport edge */
const pillUp = document.createElement("button");
const pillDown = document.createElement("button");
pillUp.className = "pill pill-up"; pillDown.className = "pill pill-down";
document.body.append(pillUp, pillDown);
let pillTargets = { up: null, down: null };
pillUp.addEventListener("click", () => pillTargets.up && pillTargets.up.scrollIntoView({ behavior: "smooth", block: "center" }));
pillDown.addEventListener("click", () => pillTargets.down && pillTargets.down.scrollIntoView({ behavior: "smooth", block: "center" }));

function updatePills() {
  const act = [...activeGids()];
  // while a pattern is pinned the card is the navigator; pills serve hover only
  if (!act.length || pinned.size) { pillUp.classList.remove("on"); pillDown.classList.remove("on"); return; }
  const anchors = act.flatMap((g) => GIDS[g].anchors.map((a) => a.el));
  const above = [], below = [];
  let sheetRect = null;
  for (const a of anchors) {
    const r = a.getBoundingClientRect();
    if (r.bottom < 64) above.push(a);
    else if (r.top > innerHeight - 36) below.push(a);
    if (!sheetRect) sheetRect = a.closest(".sheet").getBoundingClientRect();
  }
  const hue = GIDS[act[0]].hue;
  const cx = sheetRect ? sheetRect.left + 62 : innerWidth / 2;
  for (const [pill, list, arrow] of [[pillUp, above, "↑"], [pillDown, below, "↓"]]) {
    if (list.length) {
      pill.textContent = `${arrow} ${list.length} more`;
      pill.style.color = hue; pill.style.left = cx + "px";
      pill.classList.add("on");
    } else pill.classList.remove("on");
  }
  pillTargets = { up: above[above.length - 1] || null, down: below[0] || null };
}
addEventListener("scroll", () => { if (activeGids().size) { updatePills(); updateCardView(); } }, { passive: true });

/* pattern card — the pinned pattern, condensed to one glance.
 * Every member as ref + phrase; off-screen rows dim with a direction arrow;
 * click a row to jump. Appears only while something is pinned. */
const card = document.createElement("div");
card.className = "pcard";
document.body.appendChild(card);

function updateCard() {
  const gids = [...pinned];
  if (!gids.length) { card.classList.remove("on"); return; }
  card.innerHTML = "";
  for (const gid of gids) {
    const G = GIDS[gid];
    const sec = document.createElement("div"); sec.className = "pcard-sec";
    const head = document.createElement("div"); head.className = "pcard-head";
    head.innerHTML = `<svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="${G.hue}"/></svg>`;
    head.appendChild(document.createTextNode(G.label));
    sec.appendChild(head);
    for (const a of G.anchors) {
      const row = document.createElement("div"); row.className = "pcard-row";
      const [, ch, v] = a.ref.split(".");
      const ref = document.createElement("span"); ref.className = "pr-ref"; ref.textContent = `${ch}:${v}`;
      const txt = document.createElement("span"); txt.className = "pr-txt"; txt.textContent = a.phrase;
      const dir = document.createElement("span"); dir.className = "pr-dir";
      row.append(ref, txt, dir);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        a.el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      row._el = a.el;
      sec.appendChild(row);
    }
    card.appendChild(sec);
  }
  const foot = document.createElement("div"); foot.className = "pcard-foot";
  foot.textContent = "click a line to jump · esc clears";
  card.appendChild(foot);
  card.classList.add("on");
  updateCardView();
}
function updateCardView() {
  if (!card.classList.contains("on")) return;
  card.querySelectorAll(".pcard-row").forEach((row) => {
    const r = row._el.getBoundingClientRect();
    const off = r.bottom < 60 ? "↑" : r.top > innerHeight - 30 ? "↓" : "";
    row.classList.toggle("off", !!off);
    row.querySelector(".pr-dir").textContent = off;
  });
}

/* ── revelation matrix panel ─────────────────────────────── */
function glyphSVGString(name, partial, earPos) {
  const extra = earPos ? `<text x="${earPos === "pre" ? -4 : 18}" y="10" font-size="7" font-family="var(--font-mono)" fill="var(--text-tertiary)">${earPos === "pre" ? "≺" : "≻"}</text>` : "";
  return `<svg class="glyph" width="18" height="18" viewBox="-4 -4 22 22" style="overflow:visible;opacity:${partial ? 0.45 : 1}"><path d="${GLYPH_PATHS[name]}" fill="none" stroke="var(--k-series)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${extra}</svg>`;
}
function buildRevPanel() {
  const panel = document.querySelector('[data-panel="rev"]');
  const P = PATTERNS.rev[0];
  const els = P.elementSchema;
  const keyed = new Set(["address", "know", "promise", "ear"]);
  panel.innerHTML = `<h3>One letter, seven times</h3><div class="panel-sub">absence is data · hover a column to trace it in the text</div>
    <div class="matrix" style="grid-template-columns: 96px repeat(7, 1fr)">
      <div></div>${els.map((e) => `<div class="mhead" ${keyed.has(e) ? `data-gids="rev23:${e}"` : ""}>${e}</div>`).join("")}
      ${P.members.map((m) => `<div class="mrow" data-letter="${m.role}">
        <div class="mrow-label">${m.role}<span class="cell-ref">${m.range[0].replace("REV.", "")}–${m.range[1].split(".")[2]}</span></div>
        ${els.map((el) => {
          const has = !!m.elements[el];
          const partial = (m.partial || []).includes(el);
          const gid = keyed.has(el) ? ` data-gids="rev23:${el}"` : "";
          return `<div class="mcell"${gid}>${has ? glyphSVGString(el, partial, el === "ear" ? m.earPos : null) : `<span style="color:var(--border-medium);font-size:9px">·</span>`}</div>`;
        }).join("")}
      </div>`).join("")}
    </div>
    <div class="panel-note">≺ ear before promise · ≻ after — the flip lands after Thyatira. Rows: click a name to jump to that letter.</div>`;
  panel.querySelectorAll(".mrow-label").forEach((lbl) => {
    lbl.addEventListener("click", () => {
      const head = document.querySelector(`.letter-head[data-letter="${lbl.parentElement.dataset.letter}"]`);
      if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ── events ──────────────────────────────────────────────── */
function gidsOf(el) { return el.dataset.gids.split(" "); }

function wire() {
  document.querySelectorAll(".study").forEach((scope) => {
    scope.addEventListener("mouseover", (e) => {
      const t = e.target.closest("[data-gids]");
      if (!t || !scope.contains(t)) return;
      hovered.clear(); gidsOf(t).forEach((g) => hovered.add(g));
      applyActive();
      if (t.classList.contains("pk")) showWhisper(t);
    });
    scope.addEventListener("mouseout", (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest("[data-gids]")) return;
      if (hovered.size) { hovered.clear(); applyActive(); }
      hideWhisper();
    });
    scope.addEventListener("click", (e) => {
      const t = e.target.closest("[data-gids]");
      if (!t) {
        if (pinned.size) { pinned.clear(); applyActive(); }
        return;
      }
      const gs = gidsOf(t);
      const all = gs.every((g) => pinned.has(g));
      gs.forEach((g) => (all ? pinned.delete(g) : pinned.add(g)));
      applyActive();
    });
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (pinned.size || hovered.size)) {
      pinned.clear(); hovered.clear(); applyActive(); hideWhisper();
    }
  });
  document.getElementById("reveal-btn").addEventListener("click", (e) => {
    const on = document.body.classList.toggle("reveal");
    e.currentTarget.setAttribute("aria-pressed", on);
  });
  document.getElementById("atm-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#atm-seg button").forEach((x) => x.setAttribute("aria-checked", x === b));
    document.body.className = `theme-${b.dataset.theme}` + (document.body.classList.contains("reveal") ? " reveal" : "");
    requestAnimationFrame(redrawActive);
  });
  addEventListener("resize", () => requestAnimationFrame(redrawActive));
}
function redrawActive() {
  document.querySelectorAll("svg.overlay").forEach((s) => { s.dataset.key = "~"; });
  applyActive();
}

/* ── boot ────────────────────────────────────────────────── */
buildGids();
buildSheets();
buildRevPanel();
for (const s of Object.keys(SHEETS)) {
  const pre = document.querySelector(`[data-payload="${s}"]`);
  if (pre) pre.textContent = JSON.stringify(PATTERNS[s], null, 2);
}
wire();
applyActive();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawActive);
