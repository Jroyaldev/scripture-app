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

/* user-authored marks — same record shape, persisted locally */
const USER_KEY = "shape-marks-user";
let USER = [];
try { USER = JSON.parse(localStorage.getItem(USER_KEY) || "[]"); } catch { USER = []; }
function saveUser() { localStorage.setItem(USER_KEY, JSON.stringify(USER)); }

/* notes — observations attach to any pattern, yours or built-in */
const NOTES_KEY = "shape-marks-notes";
let NOTES = {};
try { NOTES = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); } catch { NOTES = {}; }
function getNote(gid) {
  if (gid.startsWith("u-")) return USER.find((p) => p.id === gid)?.note || "";
  return NOTES[gid] || "";
}
function setNote(gid, text) {
  text = text.trim();
  if (gid.startsWith("u-")) {
    const rec = USER.find((p) => p.id === gid);
    if (rec) { if (text) rec.note = text; else delete rec.note; saveUser(); }
  } else {
    if (text) NOTES[gid] = text; else delete NOTES[gid];
    localStorage.setItem(NOTES_KEY, JSON.stringify(NOTES));
  }
}
function renameUser(gid, label) {
  const rec = USER.find((p) => p.id === gid);
  if (!rec || !label.trim()) return;
  rec.label = label.trim();
  rec.custom = true; // a chosen name survives membership edits
  saveUser();
  const G = GIDS[gid];
  if (G) G.label = `${KIND_LABEL[G.kind]} · ${rec.label}`;
}
/* undo — destructive edits keep a six-second door open */
const toast = document.createElement("div");
toast.className = "toast";
document.body.appendChild(toast);
let undoTimer = 0;
function offerUndo(msg, snapshot, gidToRestore) {
  toast.innerHTML = "";
  const span = document.createElement("span"); span.textContent = msg;
  const btn = document.createElement("button"); btn.textContent = "undo";
  btn.addEventListener("click", () => {
    USER = JSON.parse(snapshot);
    saveUser();
    rebuildAll();
    if (gidToRestore) pinned.add(gidToRestore);
    applyActive();
    clearTimeout(undoTimer);
    toast.classList.remove("on");
  });
  toast.append(span, btn);
  toast.classList.add("on");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => toast.classList.remove("on"), 6000);
}

function removeMember(gid, ref, phrase, occ = 0) {
  const rec = USER.find((p) => p.id === gid);
  if (!rec) return;
  const snap = JSON.stringify(USER);
  rec.members = rec.members.filter((m) => !(m.ref === ref && m.phrase === phrase && (m.occ || 0) === occ));
  if (rec.members.length < 2) {
    USER = USER.filter((p) => p.id !== gid);
    saveUser();
    pinned.delete(gid); hovered.delete(gid);
    rebuildAll(); applyActive();
    offerUndo("mark deleted — a pattern needs two members", snap, gid);
    return;
  }
  if (!rec.custom) rec.label = userLabel(rec.kind, rec.members);
  saveUser();
  rebuildAll();
  applyActive();
  offerUndo("words removed", snap, gid);
}
function refStudy(ref) {
  const chKey = ref.split(".").slice(0, 2).join(".");
  for (const [sid, cfg] of Object.entries(SHEETS))
    if (cfg.chapters.some((c) => c.key === chKey)) return sid;
  return null;
}
function shortQuote(s, n = 24) { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
/* contrast, hinge, and mirror are two-sided by nature; parallelism,
 * echo, and series may run as long as the text does */
const BINARY_KINDS = new Set(["link:contrast", "hinge", "mirror"]);
function userLabel(kind, members) {
  if (members.length > 2 || kind === "series") return `“${shortQuote(members[0].phrase)}” ×${members.length}`;
  return `“${shortQuote(members[0].phrase, 18)}” ↔ “${shortQuote(members[1].phrase, 18)}”`;
}

function buildGids() {
  for (const k of Object.keys(GIDS)) delete GIDS[k];
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
  for (const p of USER) {
    const study = refStudy(p.members[0].ref);
    if (!study) continue;
    addGid(p.id, study, p.kind, `${KIND_LABEL[p.kind]} · ${p.label}`,
      p.members.map((m) => ({ ref: m.ref, phrase: m.phrase, occ: m.occ })),
      p.members.length > 2 ? "thread" : "arc");
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
      // k.occ picks the nth occurrence — "law" the second time, not the first
      let idx = -1;
      for (let n = 0; n <= (k.occ || 0); n++) idx = text.indexOf(k.phrase, idx + 1);
      if (idx < 0) { console.warn("phrase missing", ref, k.phrase); continue; }
      ranges.push({ start: idx, end: idx + k.phrase.length, gid, ref, phrase: k.phrase, occ: k.occ || 0 });
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
    // shared words rest in neutral gold — "more than one shape lives here"
    el.className = cover.length > 1 ? "pk pk-shared" : "pk";
    el.textContent = seg;
    el.dataset.gids = cover.map((r) => r.gid).join(" ");
    el.style.setProperty("--h", GIDS[cover[0].gid].hue);
    container.appendChild(el);
    cover.forEach((r) => {
      GIDS[r.gid].spans.push(el);
      if (r.start === s) GIDS[r.gid].anchors.push({ el, ref: r.ref, phrase: r.phrase, occ: r.occ });
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
    const entries = [...LEGEND[id](),
      ...USER.filter((p) => refStudy(p.members[0].ref) === id)
        .map((p) => ({ label: `${KIND_LABEL[p.kind]} · ${p.label}`, kind: p.kind, gids: [p.id] }))];
    for (const entry of entries) {
      const chip = document.createElement("span");
      chip.className = "chip"; chip.dataset.gids = entry.gids.join(" ");
      chip.innerHTML = `<svg width="9" height="9"><circle cx="4.5" cy="4.5" r="3" fill="${KIND_HUE[entry.kind]}"/></svg>${entry.label}`;
      legend.appendChild(chip);
    }
    sheet.appendChild(legend);
    // until the first mark exists, the first sheet teaches the gesture
    if (id === "psa" && USER.length === 0) {
      const hint = document.createElement("div");
      hint.className = "mark-hint";
      hint.textContent = "✎ select any words to begin a pattern of your own";
      sheet.appendChild(hint);
    }
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
function animFade(el, ms = 240, delay = 0) {
  const target = el.getAttribute("opacity") || 1;
  el.style.opacity = 0;
  el.getBoundingClientRect();
  el.style.transition = `opacity ${ms}ms ease ${delay}ms`;
  el.style.opacity = target;
}

/* Connectors are one continuous gesture that actually touches the marks:
 * underline → touch dot → leg (hairline at underline height, quieter) →
 * gutter spine (always the same margin) → leg → touch dot → underline.
 * The spine never crosses text; the legs run at underline level so they
 * read as the underline reaching out to the margin. */
function dashFor(p, kind) {
  if (kind === "link:echo") { p.setAttribute("stroke-dasharray", "0.1 5"); p.setAttribute("stroke-width", 1.9); }
}

/* ── ink ribbons ─────────────────────────────────────────────
 * A premium line is not a uniform stroke: it is a filled outline
 * around a centerline with a designed width profile — tapered ends,
 * restrained swell midway (≈55%→115% of nominal). The perfect-freehand
 * insight, composed rather than gestured: no pressure, no wobble. */
function sampleCubic(p0, p1, p2, p3, n = 44) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return pts;
}
function ribbonOutline(pts, w, frac = 1) {
  const total = pts.length;
  const count = Math.max(2, Math.round(total * Math.min(1, frac)));
  const L = [], R = [];
  for (let i = 0; i < count; i++) {
    const t = i / (total - 1);
    const ramp = Math.min(1, Math.min(t, 1 - t) / 0.16); // endpoint taper
    let r = (w / 2) * (0.55 + 0.6 * Math.sin(Math.PI * t)) * (0.3 + 0.7 * ramp);
    if (frac < 1) {
      // mid-draw the leading edge narrows to a nib tip
      r *= Math.min(1, (count - 1 - i) / Math.max(1, total * 0.12));
    }
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(total - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    L.push(`${(pts[i].x + nx * r).toFixed(2)},${(pts[i].y + ny * r).toFixed(2)}`);
    R.push(`${(pts[i].x - nx * r).toFixed(2)},${(pts[i].y - ny * r).toFixed(2)}`);
  }
  return `M${L.join("L")}L${R.reverse().join("L")}Z`;
}
/* the ribbon draws itself: the ink flows point by point along the
 * centerline, leading edge tapered like a nib in contact */
function ribbonDraw(g, pts, hue, { w = 1.6, opacity = 1, delay = 0, dur = 380 } = {}) {
  const p = S("path", { d: "", fill: hue, stroke: "none" }, g);
  if (opacity < 1) p.setAttribute("opacity", opacity);
  const t0 = performance.now() + delay;
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function frame(now) {
    if (!p.isConnected) return; // overlay cleared mid-flight
    const u = Math.min(1, Math.max(0, (now - t0) / dur));
    if (u > 0) p.setAttribute("d", ribbonOutline(pts, w, ease(u)));
    if (u < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return p;
}
function leg(g, x1, x2, y, hue, kind, delay = 0) {
  const p = S("path", {
    d: `M ${x1} ${y} H ${x2}`, fill: "none", stroke: hue,
    "stroke-width": 1.2, "stroke-linecap": "round", opacity: 0.5,
  }, g);
  dashFor(p, kind);
  animFade(p, 220, delay);
}
function touchDot(g, x, y, hue, delay = 0) {
  animFade(S("circle", { cx: x, cy: y, r: 1.8, fill: hue }, g), 200, delay);
}

/* the member you touched is where the ink starts */
let LAST_TOUCH = null;
function touchYIn(M) {
  if (!LAST_TOUCH || !LAST_TOUCH.isConnected) return null;
  const r = LAST_TOUCH.getClientRects()[0];
  return r ? r.top - M.base.top : null;
}

function drawArc(g, a, b, hue, kind, lane, gx, touchY) {
  const y1 = a.bottom + 2.5, y2 = b.bottom + 2.5;
  const sameLine = Math.abs(y1 - y2) < 5;
  if (sameLine) {
    const sx = a.right + 4, ex = b.x - 4, dip = 12;
    if (kind === "link:echo") {
      const p = S("path", {
        d: `M ${sx} ${y1} C ${sx + 4} ${y1 + dip}, ${ex - 4} ${y2 + dip}, ${ex} ${y2}`,
        fill: "none", stroke: hue, "stroke-width": 1.3, "stroke-linecap": "round",
      }, g);
      dashFor(p, kind);
      animFade(p);
    } else {
      ribbonDraw(g, sampleCubic({ x: sx, y: y1 }, { x: sx + 4, y: y1 + dip }, { x: ex - 4, y: y2 + dip }, { x: ex, y: y2 }), hue, { dur: 300 });
    }
    return;
  }
  let pts = sampleCubic({ x: gx, y: y1 }, { x: lane, y: y1 + 3 }, { x: lane, y: y2 - 3 }, { x: gx, y: y2 });
  // ink flows from the touched member toward its counterpart
  const flip = touchY != null && Math.abs(touchY - y2) < Math.abs(touchY - y1);
  if (flip) pts = pts.slice().reverse();
  const near = flip ? { x: b.x - 2, y: y2 } : { x: a.x - 2, y: y1 };
  const far = flip ? { x: a.x - 2, y: y1 } : { x: b.x - 2, y: y2 };
  if (kind === "link:echo") {
    const p = S("path", {
      d: `M ${gx} ${y1} C ${lane} ${y1 + 3}, ${lane} ${y2 - 3}, ${gx} ${y2}`,
      fill: "none", stroke: hue, "stroke-width": 1.3, "stroke-linecap": "round",
    }, g);
    dashFor(p, kind);
    animFade(p);
    leg(g, gx, a.x - 2, y1, hue, kind);
    leg(g, gx, b.x - 2, y2, hue, kind);
    touchDot(g, a.x - 2, y1, hue);
    touchDot(g, b.x - 2, y2, hue);
    return;
  }
  // choreography: pen sets down at the near member, draws, arrives at the far
  leg(g, gx, near.x, near.y, hue, kind, 30);
  touchDot(g, near.x, near.y, hue, 30);
  if (kind === "link:contrast") {
    // two strokes with a beat between — the pen lifts at the break
    ribbonDraw(g, pts.slice(0, Math.floor(pts.length * 0.45)), hue, { delay: 90, dur: 210 });
    ribbonDraw(g, pts.slice(Math.ceil(pts.length * 0.55)), hue, { delay: 360, dur: 210 });
    leg(g, gx, far.x, far.y, hue, kind, 520);
    touchDot(g, far.x, far.y, hue, 520);
  } else {
    ribbonDraw(g, pts, hue, { delay: 90, dur: 380 });
    leg(g, gx, far.x, far.y, hue, kind, 400);
    touchDot(g, far.x, far.y, hue, 400);
  }
}

function drawThread(g, rects, hue, laneX, touchY) {
  const ys = rects.map((r) => r.bottom + 2.5);
  const yTop = ys[0], yBot = ys[ys.length - 1];
  // ink starts nearest the touched member and runs the length of the spine
  const flip = touchY != null && Math.abs(touchY - yBot) < Math.abs(touchY - yTop);
  const spine = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    spine.push({ x: laneX, y: flip ? yBot - (yBot - yTop) * t : yTop + (yBot - yTop) * t });
  }
  const dur = 460;
  ribbonDraw(g, spine, hue, { w: 1.35, opacity: 0.7, delay: 40, dur });
  rects.forEach((r, i) => {
    // each member lights as the ink passes its line
    const frac = (yBot === yTop) ? 0 : (flip ? (yBot - ys[i]) / (yBot - yTop) : (ys[i] - yTop) / (yBot - yTop));
    const delay = 40 + dur * frac * 0.85;
    const l = S("path", { d: `M ${laneX} ${ys[i]} H ${r.x - 2}`, stroke: hue, "stroke-width": 1, opacity: 0.35 }, g);
    animFade(l, 200, delay);
    touchDot(g, r.x - 2, ys[i], hue, delay);
  });
}

function drawOverlay(sid, gids) {
  const sheet = document.querySelector(`[data-sheet="${sid}"]`);
  const svg = sheet.querySelector("svg.overlay");
  const key = gids.slice().sort().join("|");
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  const live = svg.querySelector("g.live");
  svg.innerHTML = "";
  if (live) svg.appendChild(live);
  if (!gids.length) return;
  const M = measure(sid);
  const touchY = touchYIn(M);
  gids.forEach((gid, i) => {
    const G = GIDS[gid];
    const rects = G.anchors.map((a) => firstRect(M, a.el)).filter(Boolean);
    if (rects.length < 2) return;
    const g = S("g", {}, svg);
    if (G.conn === "thread") drawThread(g, rects, G.hue, M.textLeft - 46 - i * 10, touchY);
    else drawArc(g, rects[0], rects[rects.length - 1], G.hue, G.kind, M.textLeft - 40 - i * 10, M.textLeft - 12, touchY);
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
    sheet.querySelectorAll(".pk").forEach((el) => {
      const gs = gidsOf(el);
      const activeG = gs.filter((g) => act.has(g));
      el.classList.toggle("on", activeG.length > 0);
      // the words wear the hue of the pattern you chose, not just the first
      el.style.setProperty("--h", GIDS[activeG[0] || gs[0]].hue);
      // both patterns awake on the same words → stacked underlines, one per hue
      el.classList.toggle("stack", activeG.length > 1);
      if (activeG.length > 1) {
        el.style.backgroundImage = activeG.map((g) => `linear-gradient(${GIDS[g].hue}, ${GIDS[g].hue})`).join(", ");
        el.style.backgroundPosition = activeG.map((_, i) => `0 calc(100% - ${(activeG.length - 1 - i) * 3}px)`).join(", ");
        el.style.backgroundSize = "100% 1.5px";
        el.style.backgroundRepeat = "no-repeat";
      } else {
        el.style.backgroundImage = ""; el.style.backgroundPosition = "";
        el.style.backgroundSize = ""; el.style.backgroundRepeat = "";
      }
    });
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
/* whisper grammar — dots carry identity, words stay few:
 *   one shape       ● echo · "the wicked" frames the psalm
 *   several, none   ●● 2 shapes · click to focus
 *   one focused     ● hinge · 2 of 2 · click for next
 *   all focused     ●● all 2 · click to clear                */
function wdot(hue) { return `<i class="wdot" style="background:${hue}"></i>`; }
function showWhisper(pk) {
  const sheet = pk.closest(".sheet");
  const wh = sheet.querySelector(".whisper");
  const gids = pk.dataset.gids.split(" ");
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  let html;
  if (gids.length === 1) {
    html = wdot(GIDS[gids[0]].hue) + esc(short(GIDS[gids[0]].label, 44));
  } else {
    const pinnedIn = gids.filter((g) => pinned.has(g));
    const dots = gids.map((g) => wdot(GIDS[g].hue)).join("");
    if (pinnedIn.length === 0) html = `${dots}${gids.length} shapes · click to focus`;
    else if (pinnedIn.length === gids.length) html = `${dots}all ${gids.length} · click to clear`;
    else html = `${wdot(GIDS[pinnedIn[0]].hue)}${esc(KIND_LABEL[GIDS[pinnedIn[0]].kind])} · ${gids.indexOf(pinnedIn[0]) + 1} of ${gids.length} · click for next`;
  }
  wh.innerHTML = html;
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
 * Docked in the study's right rail like an app inspector: every member as
 * ref + phrase, off-screen rows dim with a direction arrow, click to jump.
 * One card per study, visible only while one of its patterns is pinned. */
const CARDS = {};
for (const sid of Object.keys(SHEETS)) {
  const rail = document.querySelector(`[data-rail="${sid}"]`);
  const card = document.createElement("div");
  card.className = "pcard";
  rail.prepend(card);
  CARDS[sid] = card;
}

function updateCard() {
  for (const sid of Object.keys(SHEETS)) {
    const card = CARDS[sid];
    const gids = [...pinned].filter((g) => GIDS[g].study === sid);
    if (!gids.length) { card.classList.remove("on"); continue; }
    card.innerHTML = "";
    for (const gid of gids) {
      const G = GIDS[gid];
      const sec = document.createElement("div"); sec.className = "pcard-sec";
      const head = document.createElement("div"); head.className = "pcard-head";
      head.innerHTML = `<svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="${G.hue}"/></svg>`;
      const title = document.createElement("span"); title.className = "pcard-title";
      if (gid.startsWith("u-")) {
        const rec = USER.find((p) => p.id === gid);
        title.textContent = rec?.label || G.label;
        title.contentEditable = "plaintext-only";
        title.spellcheck = false;
        title.title = "click to rename";
        title.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); title.blur(); } });
        title.addEventListener("blur", () => {
          renameUser(gid, title.textContent);
          rebuildAll();
          applyActive();
        });
        title.addEventListener("click", (ev) => ev.stopPropagation());
      } else {
        title.textContent = G.label;
      }
      const exp = document.createElement("button"); exp.className = "pcard-x"; exp.textContent = "⤓";
      exp.title = "export as card";
      exp.addEventListener("click", (e) => { e.stopPropagation(); exportCard(gid); });
      head.append(title, exp);
      if (gid.startsWith("u-")) {
        const del = document.createElement("button"); del.className = "pcard-x pcard-del";
        del.innerHTML = `<svg width="11" height="12" viewBox="0 0 14 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 4h10M5.5 4V2.5h3V4M3.5 4l.7 9h5.6l.7-9M5.8 6.5v4M8.2 6.5v4"/></svg>`;
        del.title = "delete this mark";
        del.addEventListener("click", (e) => { e.stopPropagation(); deleteUserPattern(gid); });
        head.appendChild(del);
      }
      const close = document.createElement("button"); close.className = "pcard-x"; close.textContent = "×";
      close.title = "unpin (esc)";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        pinned.delete(gid);
        applyActive();
      });
      head.appendChild(close);
      sec.appendChild(head);
      for (const a of G.anchors) {
        const row = document.createElement("div"); row.className = "pcard-row";
        const [, ch, v] = a.ref.split(".");
        const ref = document.createElement("span"); ref.className = "pr-ref"; ref.textContent = `${ch}:${v}`;
        const txt = document.createElement("span"); txt.className = "pr-txt"; txt.textContent = a.phrase;
        const dir = document.createElement("span"); dir.className = "pr-dir";
        row.append(ref, txt, dir);
        if (gid.startsWith("u-")) {
          const rm = document.createElement("button"); rm.className = "pr-rm"; rm.textContent = "–";
          rm.title = "remove these words from the pattern";
          rm.addEventListener("click", (e) => { e.stopPropagation(); removeMember(gid, a.ref, a.phrase, a.occ); });
          row.appendChild(rm);
        }
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          a.el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        row._el = a.el;
        sec.appendChild(row);
      }
      if (gid.startsWith("u-")) {
        const add = document.createElement("button"); add.className = "pcard-add";
        add.textContent = "+ add words";
        add.addEventListener("click", (e) => { e.stopPropagation(); startExtend(gid); });
        sec.appendChild(add);
      }
      const note = document.createElement("textarea");
      note.className = "pcard-note";
      note.rows = 1;
      note.placeholder = "why these? note an observation…";
      note.value = getNote(gid);
      const grow = () => { note.style.height = "auto"; note.style.height = note.scrollHeight + "px"; };
      note.addEventListener("input", grow);
      note.addEventListener("change", () => setNote(gid, note.value));
      note.addEventListener("click", (ev) => ev.stopPropagation());
      note.addEventListener("mouseup", (ev) => ev.stopPropagation());
      sec.appendChild(note);
      requestAnimationFrame(grow);
      card.appendChild(sec);
    }
    card.classList.add("on");
  }
  updateCardView();
}
function updateCardView() {
  document.querySelectorAll(".pcard.on .pcard-row").forEach((row) => {
    const r = row._el.getBoundingClientRect();
    const off = r.bottom < 60 ? "↑" : r.top > innerHeight - 30 ? "↓" : "";
    row.classList.toggle("off", !!off);
    row.querySelector(".pr-dir").textContent = off;
  });
}

/* ── export — a pinned pattern as a letterpress card (SVG) ─
 * Cream stock, the pattern's own mark language on the left spine,
 * ref + phrase per member, kind named in small caps. Shareable. */
const EXPORT_HUES = {
  "link:parallel": "#4E9A5F", "link:contrast": "#C05A80", "link:echo": "#4678C8",
  hinge: "#4E9A5F", mirror: "#8760C4", series: "#C8961E",
};
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function exportCard(gid) {
  const G = GIDS[gid];
  const hue = EXPORT_HUES[G.kind];
  const cfg = SHEETS[G.study];
  const W = 900, rowH = 58, padX = 84, top = 168;
  const rows = G.anchors.map((a) => {
    const [, ch, v] = a.ref.split(".");
    return { ref: `${ch}:${v}`, phrase: a.phrase };
  });
  const noteLines = [];
  const noteText = getNote(gid);
  if (noteText) {
    let line = "";
    for (const w of noteText.split(/\s+/)) {
      if ((line + " " + w).trim().length > 62) { noteLines.push(line.trim()); line = w; }
      else line += " " + w;
      if (noteLines.length === 5) break;
    }
    if (line.trim() && noteLines.length < 6) noteLines.push(line.trim());
  }
  const noteH = noteLines.length ? 34 + noteLines.length * 26 : 0;
  const H = top + rows.length * rowH + noteH + 96;
  const spineX = padX + 34, refX = padX + 118, txtX = padX + 138;
  const y0 = top + rowH / 2, y1 = top + (rows.length - 1) * rowH + rowH / 2;
  const spine = rows.length > 2
    ? `<path d="M ${spineX} ${y0} V ${y1}" stroke="${hue}" stroke-width="1.2" opacity="0.55"/>`
    : `<path d="M ${spineX + 24} ${y0} C ${spineX - 14} ${y0 + 4}, ${spineX - 14} ${y1 - 4}, ${spineX + 24} ${y1}" fill="none" stroke="${hue}" stroke-width="1.4"${G.kind === "link:echo" ? ' stroke-dasharray="0.1 6" stroke-linecap="round" stroke-width="2"' : ""}/>`;
  const marks = rows.map((r, i) => {
    const y = top + i * rowH + rowH / 2;
    return `<path d="M ${spineX} ${y} H ${refX - 26}" stroke="${hue}" stroke-width="1" opacity="0.35"/>
      <circle cx="${refX - 26}" cy="${y}" r="2.4" fill="${hue}"/>
      <text x="${refX}" y="${y + 4}" text-anchor="end" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="12" fill="#6B6254">${r.ref}</text>
      <text x="${txtX}" y="${y + 6}" font-family="'Source Serif 4', Georgia, serif" font-size="21" fill="#181511">${esc(shortQuote(r.phrase, 52))}</text>
      <path d="M ${txtX} ${y + 14} H ${txtX + Math.min(r.phrase.length, 52) * 9.6}" stroke="${hue}" stroke-width="1.4" opacity="0.85"/>`;
  }).join("\n");
  const [kindWord, ...rest] = G.label.split(" · ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="26" fill="#FAF6EC"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="25.5" fill="none" stroke="#E4DAC9"/>
  <circle cx="${padX}" cy="76" r="5" fill="${hue}"/>
  <text x="${padX + 18}" y="81" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="13" letter-spacing="3" fill="#6B6254">${esc(kindWord.toUpperCase())} · ${esc(cfg.title.toUpperCase())}</text>
  <text x="${padX}" y="128" font-family="'Source Serif 4', Georgia, serif" font-size="30" font-weight="600" fill="#181511">${esc(rest.join(" · "))}</text>
  ${spine}
  ${marks}
  ${noteLines.map((l, i) =>
    `<text x="${padX}" y="${top + rows.length * rowH + 44 + i * 26}" font-family="'Source Serif 4', Georgia, serif" font-size="16" font-style="italic" fill="#4D463C">${esc(l)}</text>`
  ).join("\n")}
  <text x="${padX}" y="${H - 44}" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="11" letter-spacing="1.5" fill="#9A8F7D">${esc(cfg.ref)} · PATTERN SHAPES</text>
</svg>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = `${(rest.join("-") || gid).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "pattern"}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
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

/* ── authoring — select words, pick a tool, wire the counterpart ──
 * Selection is the gesture (picking words is what selection is for);
 * the tldraw part is the live wire that follows the cursor until the
 * counterpart is chosen. Records land in localStorage as the same
 * shape-marks payload the built-ins use. */
let SESSION = null; // { kind, members: [{ref, phrase, range}], study }
const AUTHOR_KINDS = ["link:parallel", "link:contrast", "link:echo", "mirror", "series", "hinge"];
const authbar = document.createElement("div");
authbar.className = "authbar";
document.body.appendChild(authbar);

function nodeRow(n) { return (n.nodeType === 3 ? n.parentElement : n)?.closest?.(".vrow") || null; }
function selectionInfo() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const row = nodeRow(range.commonAncestorContainer);
  if (!row || !row.closest(".sheet")) return null;
  const phrase = sel.toString().replace(/\s+/g, " ").trim();
  if (phrase.length < 2) return null;
  // which occurrence did they actually select? measure the selection's
  // absolute offset in the verse, then rank it among the phrase's matches
  const vt = row.querySelector(".vtext");
  const pre = document.createRange();
  pre.selectNodeContents(vt);
  pre.setEnd(range.startContainer, range.startOffset);
  const raw = sel.toString();
  const abs = pre.toString().length + (raw.length - raw.trimStart().length);
  const full = vt.textContent;
  const positions = [];
  for (let i = full.indexOf(phrase); i !== -1; i = full.indexOf(phrase, i + 1)) positions.push(i);
  let occ = positions.indexOf(abs);
  if (occ === -1) occ = Math.max(0, positions.findIndex((p) => p >= abs));
  return { ref: row.dataset.key, phrase, occ, range: range.cloneRange() };
}
function placeAuthbar(rect) {
  authbar.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - authbar.offsetWidth / 2, innerWidth - authbar.offsetWidth - 12)) + "px";
  authbar.style.top = Math.max(60, rect.top - 46) + "px";
}
/* each kind explains itself in plain words while you decide */
const KIND_DEF = {
  "link:parallel": "the same thought, said again in other words",
  "link:contrast": "two things set against each other",
  "link:echo": "a word or phrase that returns from earlier",
  mirror: "paired halves that answer each other in order",
  series: "the same phrase recurring — a refrain",
  hinge: "one line that weighs both sides",
};
const DEF_RESTING = "what kind of connection is this?";

function showKindPalette(info) {
  authbar.innerHTML = "";
  authbar.classList.add("palette");
  const row = document.createElement("div"); row.className = "authrow";
  const def = document.createElement("div"); def.className = "authdef";
  def.textContent = DEF_RESTING;
  for (const kind of AUTHOR_KINDS) {
    const b = document.createElement("button");
    b.className = "ak";
    b.innerHTML = `<i style="background:${KIND_HUE[kind]}"></i>${KIND_LABEL[kind]}`;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("mouseenter", () => { def.textContent = KIND_DEF[kind]; });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      startSession(kind, info);
    });
    row.appendChild(b);
  }
  row.addEventListener("mouseleave", () => { def.textContent = DEF_RESTING; });
  authbar.append(row, def);
  authbar.classList.add("on");
  placeAuthbar(info.range.getBoundingClientRect());
}
function sessionBar(msg) {
  const G = SESSION;
  authbar.classList.remove("palette");
  authbar.innerHTML = `<span class="ak" style="cursor:default"><i style="background:${KIND_HUE[G.kind]}"></i>${KIND_LABEL[G.kind]}</span>
    <span class="hint">${msg}</span>`;
  if (G.extend) {
    const done = document.createElement("button"); done.className = "ak act"; done.textContent = "done";
    done.addEventListener("click", (e) => { e.stopPropagation(); endSession(); });
    authbar.appendChild(done);
  } else {
    if (!BINARY_KINDS.has(G.kind) && G.members.length >= 2) {
      const done = document.createElement("button"); done.className = "ak act"; done.textContent = "done";
      done.addEventListener("click", (e) => { e.stopPropagation(); finalizeSession(); });
      authbar.appendChild(done);
    }
    const cancel = document.createElement("button"); cancel.className = "ak"; cancel.textContent = "cancel";
    cancel.addEventListener("click", (e) => { e.stopPropagation(); endSession(); });
    authbar.appendChild(cancel);
  }
  authbar.classList.add("on");
  const anchor = G.members[G.members.length - 1];
  if (anchor) placeAuthbar(anchor.range.getBoundingClientRect());
  else {
    const card = document.querySelector(`[data-rail="${G.study}"] .pcard`);
    if (card) placeAuthbar(card.getBoundingClientRect());
  }
}
function startSession(kind, info) {
  const study = refStudy(info.ref);
  if (!study) { endSession(); return; }
  SESSION = { kind, members: [info], study };
  getSelection().removeAllRanges();
  sessionBar(BINARY_KINDS.has(kind) ? "select the counterpart" : "select the next occurrence");
  liveWire();
}
function captureMember() {
  const info = selectionInfo();
  if (!info) return;
  if (refStudy(info.ref) !== SESSION.study) { sessionBar("stay within this passage"); return; }
  if (SESSION.extend) {
    // extending an existing pattern: each selection lands immediately
    const rec = USER.find((p) => p.id === SESSION.extend);
    if (!rec || rec.members.some((m) => m.ref === info.ref && m.phrase === info.phrase && (m.occ || 0) === info.occ)) return;
    rec.members.push({ ref: info.ref, phrase: info.phrase, ...(info.occ ? { occ: info.occ } : {}) });
    if (!rec.custom) rec.label = userLabel(rec.kind, rec.members);
    saveUser();
    getSelection().removeAllRanges();
    rebuildAll();
    applyActive();
    sessionBar(`${rec.members.length} in the pattern · select more, or finish`);
    return;
  }
  if (SESSION.members.some((m) => m.ref === info.ref && m.phrase === info.phrase && m.occ === info.occ)) return;
  SESSION.members.push(info);
  getSelection().removeAllRanges();
  if (BINARY_KINDS.has(SESSION.kind) && SESSION.members.length === 2) { finalizeSession(); return; }
  sessionBar(`${SESSION.members.length} marked · select the next, or finish`);
}
function startExtend(gid) {
  const G = GIDS[gid];
  SESSION = { kind: G.kind, members: [], study: G.study, extend: gid };
  pinned.add(gid);
  applyActive();
  sessionBar("select the words to add");
}
function finalizeSession() {
  const { kind, members } = SESSION;
  const rec = {
    id: `u-${Date.now()}`,
    kind,
    label: userLabel(kind, members),
    members: members.map(({ ref, phrase, occ }) => ({ ref, phrase, ...(occ ? { occ } : {}) })),
  };
  USER.push(rec);
  saveUser();
  endSession();
  rebuildAll();
  pinned.clear(); hovered.clear();
  pinned.add(rec.id);
  applyActive();
}
function endSession() {
  SESSION = null;
  authbar.classList.remove("on");
  document.querySelectorAll("svg.overlay g.live").forEach((g) => g.remove());
  document.querySelectorAll("svg.overlay").forEach((s) => { s.dataset.key = "~"; });
  applyActive();
}
function deleteUserPattern(gid, silent) {
  const snap = JSON.stringify(USER);
  USER = USER.filter((p) => p.id !== gid);
  saveUser();
  pinned.delete(gid); hovered.delete(gid);
  rebuildAll();
  applyActive();
  if (!silent) offerUndo("mark deleted", snap, gid);
}

/* the live wire — provisional marks + a dashed thread chasing the cursor */
function liveWire(e) {
  if (!SESSION) return;
  const M = measure(SESSION.study);
  let g = M.svg.querySelector("g.live");
  if (!g) g = S("g", { class: "live" }, M.svg);
  g.innerHTML = "";
  const hue = KIND_HUE[SESSION.kind];
  let last = null;
  for (const m of SESSION.members) {
    const rects = [...m.range.getClientRects()];
    for (const r of rects) {
      S("path", {
        d: `M ${r.left - M.base.left} ${r.bottom - M.base.top + 2.5} H ${r.right - M.base.left}`,
        stroke: hue, "stroke-width": 1.6, fill: "none", "stroke-linecap": "round",
      }, g);
    }
    if (rects[0]) last = { x: rects[0].left - M.base.left - 2, y: rects[0].bottom - M.base.top + 2.5 };
    if (last) S("circle", { cx: last.x, cy: last.y, r: 2, fill: hue }, g);
  }
  if (last && e) {
    S("path", {
      d: `M ${last.x} ${last.y} L ${e.clientX - M.base.left} ${e.clientY - M.base.top}`,
      stroke: hue, "stroke-width": 1.2, fill: "none",
      "stroke-dasharray": "0.1 5", "stroke-linecap": "round", opacity: 0.7,
    }, g);
  }
}
addEventListener("mousemove", (e) => { if (SESSION) requestAnimationFrame(() => liveWire(e)); });
document.addEventListener("mouseup", (e) => {
  if (e.target.closest?.(".authbar")) return;
  setTimeout(() => {
    if (SESSION) { captureMember(); return; }
    const info = selectionInfo();
    if (info) showKindPalette(info);
    else authbar.classList.remove("on");
  }, 0);
});

/* ── events ──────────────────────────────────────────────── */
function gidsOf(el) { return el.dataset.gids.split(" "); }

/* hover intent — the page only awakens for a deliberate pause, and
 * survives the cursor crossing small gaps without flickering asleep */
let hoverTimer = 0, sleepTimer = 0;

function wire() {
  document.querySelectorAll(".study").forEach((scope) => {
    scope.addEventListener("mouseover", (e) => {
      const t = e.target.closest("[data-gids]");
      if (!t || !scope.contains(t)) return;
      clearTimeout(sleepTimer);
      clearTimeout(hoverTimer);
      if (t.classList.contains("pk")) LAST_TOUCH = t;
      hoverTimer = setTimeout(() => {
        const gs = gidsOf(t);
        hovered.clear();
        // once you've cycled to a specific pattern, hover defers to your choice
        if (!gs.some((g) => pinned.has(g))) gs.forEach((g) => hovered.add(g));
        applyActive();
        if (t.classList.contains("pk")) showWhisper(t);
      }, 140);
    });
    scope.addEventListener("mouseout", (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest("[data-gids]")) return;
      clearTimeout(hoverTimer);
      sleepTimer = setTimeout(() => {
        if (hovered.size) { hovered.clear(); applyActive(); }
        hideWhisper();
      }, 90);
    });
    scope.addEventListener("click", (e) => {
      if (SESSION || !getSelection().isCollapsed) return; // authoring owns the gesture
      const t = e.target.closest("[data-gids]");
      if (!t) {
        if (pinned.size && !e.target.closest(".rail")) { pinned.clear(); applyActive(); }
        return;
      }
      /* one pattern: click toggles. Shared words: click cycles through
       * what they carry — first pattern → second → … → all → none. */
      const gs = gidsOf(t);
      if (gs.length === 1) {
        pinned.has(gs[0]) ? pinned.delete(gs[0]) : pinned.add(gs[0]);
      } else {
        const all = gs.every((g) => pinned.has(g));
        const idx = gs.findIndex((g) => pinned.has(g));
        gs.forEach((g) => pinned.delete(g));
        if (all) { /* → none */ }
        else if (idx === -1) pinned.add(gs[0]);
        else if (idx < gs.length - 1) pinned.add(gs[idx + 1]);
        else gs.forEach((g) => pinned.add(g));
      }
      // the display and the whisper follow the click immediately
      if (t.classList.contains("pk")) LAST_TOUCH = t;
      gs.forEach((g) => hovered.delete(g));
      applyActive();
      if (t.classList.contains("pk")) showWhisper(t);
    });
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (SESSION) { endSession(); return; }
    if (pinned.size || hovered.size) {
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
function rebuildAll() {
  buildGids();
  buildSheets();
  for (const s of Object.keys(SHEETS)) {
    const pre = document.querySelector(`[data-payload="${s}"]`);
    if (!pre) continue;
    const mine = USER.filter((p) => refStudy(p.members[0].ref) === s);
    pre.textContent = JSON.stringify(mine.length ? { builtIn: PATTERNS[s], yours: mine } : PATTERNS[s], null, 2);
  }
}
rebuildAll();
buildRevPanel();
wire();
applyActive();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawActive);
