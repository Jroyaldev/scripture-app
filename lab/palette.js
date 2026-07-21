/* ── marking surfaces · palette.js ──────────────────────────────
 * Four authoring surfaces over the shapes engine. lab.js exposes
 * window.LAB_AUTHOR (the verbs) and defers to window.LAB_PALETTE
 * (the chrome) whenever a hook returns truthy. This file is only
 * chrome: every record still lands through the engine's own
 * startSession / createHighlight / removeHighlight, so undo,
 * routing, cards, and storage behave identically on every variant. */

const A = window.LAB_AUTHOR;
const WASH_DEF = (c) => `a quiet ${c} wash behind these words`;
const WASH_CODES = { amber: "A", sage: "G", sky: "S", rose: "R", violet: "V" };

/* The lab deliberately owns a tiny icon set instead of borrowing a UI
 * package.  Every glyph is one 1.35px, round-ended vocabulary so the four
 * surfaces can feel related without collapsing into the same control. */
const ICONS = {
  read: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.2 4.4c1.9-.7 3.8-.5 5.8.7v9c-2-1.2-3.9-1.4-5.8-.7zM14.8 4.4c-1.9-.7-3.8-.5-5.8.7v9c2-1.2 3.9-1.4 5.8-.7z"/></svg>`,
  wash: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m4.1 10.7 5.8-6.1 3.5 3.3-5.9 6.2H4.1zM3.2 14.1h11.6"/></svg>`,
  link: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M7.2 11.7 5.9 13a3 3 0 0 1-4.2-4.2l2-2a3 3 0 0 1 4.2 0M10.8 6.3 12.1 5a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2 0M6.5 11.5l5-5"/></svg>`,
  note: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 3.2h10v8.1l-3.4 3.5H4zM10.6 14.8v-3.5H14M6.6 6.2h4.8M6.6 8.8h3.6"/></svg>`,
  erase: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m6.6 14.3-3.4-3.4 6.9-7a1.5 1.5 0 0 1 2.2 0l2 2a1.5 1.5 0 0 1 0 2.2l-6.2 6.2zM6.3 7.8l4.4 4.4M6.6 14.3h8.2"/></svg>`,
  pin: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m6 3 6 0-.8 3.6 2.2 2.1H4.6l2.2-2.1zM9 8.7v6.4"/></svg>`,
  close: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 4.5 9 9M13.5 4.5l-9 9"/></svg>`,
  trash: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.8 5.2h10.4M7 5.2V3.5h4v1.7M5.3 5.2l.6 9.3h6.2l.6-9.3M7.6 7.7v4.5M10.4 7.7v4.5"/></svg>`,
  cursor: `<svg class="pz-icon-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m4 2.8 9.6 6.1-4.4 1.2-2.1 4.1z"/></svg>`,
};

const KIND_ICONS = {
  "link:parallel": `<svg class="pz-kind-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6h12M3 12h12"/></svg>`,
  "link:contrast": `<svg class="pz-kind-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m7 4-4 5 4 5M11 4l4 5-4 5"/></svg>`,
  "link:echo": `<svg class="pz-kind-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M5.3 6.2H12a3.1 3.1 0 0 1 0 6.2H7.5M5.4 3.8 3 6.2l2.4 2.4"/></svg>`,
  mirror: `<svg class="pz-kind-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M7 5 3.5 9 7 13M11 5l3.5 4-3.5 4"/></svg>`,
  series: `<svg class="pz-kind-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9h10"/><circle cx="4" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="9" r="1.5"/></svg>`,
  hinge: `<svg class="pz-kind-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h4M11 9h4M9 5.5 12.5 9 9 12.5 5.5 9z"/></svg>`,
};

function icon(name) { return ICONS[name] || ""; }
function kindGlyph(kind) {
  return `<span class="pz-kindglyph" style="--pz-tone:${A.hues[kind]}">${KIND_ICONS[kind]}</span>`;
}
function washGlyph(color) {
  return `<span class="pz-washglyph" data-code="${WASH_CODES[color] || color[0]}" style="--pz-wash:var(--hl-${color}-ink)"></span>`;
}

/* ── tiny dom helpers ────────────────────────────────────────── */
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function kindTag(kind) { return `<span class="pz-tooltag">${kindGlyph(kind)}<span>${A.labels[kind]}</span></span>`; }
function washTag(color) { return `<span class="pz-tooltag">${washGlyph(color)}<span>${color}</span></span>`; }
/* chips act on the selection the user is still holding — never let
 * the button's own mousedown take it away */
function keepSelection(btn) { btn.addEventListener("mousedown", (e) => e.preventDefault()); return btn; }
function kindChip(kind, fn) {
  const b = el("button", "pz-ak pz-choice pz-kindchoice", `${kindGlyph(kind)}<span>${A.labels[kind]}</span>`);
  b.type = "button";
  b.setAttribute("aria-label", A.labels[kind]);
  keepSelection(b).addEventListener("click", (e) => { e.stopPropagation(); fn(kind); });
  return b;
}
function washChip(color, fn) {
  const b = el("button", "pz-ak pz-choice pz-washchoice", `${washGlyph(color)}<span>${color}</span>`);
  b.type = "button";
  b.setAttribute("aria-label", `highlight ${color}`);
  keepSelection(b).addEventListener("click", (e) => { e.stopPropagation(); fn(color); });
  return b;
}
/* hover a chip and the nearest definition line explains it */
let DEF_ID = 0;
function explain(btn, defEl, text, resting) {
  if (!defEl.id) defEl.id = `pz-def-${++DEF_ID}`;
  btn.setAttribute("aria-describedby", defEl.id);
  btn.addEventListener("mouseenter", () => { defEl.textContent = text; });
  btn.addEventListener("mouseleave", () => { if (document.activeElement !== btn) defEl.textContent = resting; });
  btn.addEventListener("focus", () => { defEl.textContent = text; });
  btn.addEventListener("blur", () => { defEl.textContent = resting; });
}
function iconButton(name, label, cls = "") {
  const b = el("button", `pz-iconbutton pz-tip ${cls}`.trim(), icon(name));
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.dataset.tip = label;
  return b;
}
function wireChoiceKeys(container, buttons) {
  if (!buttons.length) return;
  buttons.forEach((button, index) => { button.tabIndex = index === 0 ? 0 : -1; });
  container.onkeydown = (event) => {
    if (event.key === "Escape") return;
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[current].tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus({ preventScroll: true });
  };
}
function wireRadioKeys(container, buttons) {
  wireChoiceKeys(container, buttons);
  const moveFocus = container.onkeydown;
  container.onkeydown = (event) => {
    const selects = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key);
    moveFocus?.(event);
    if (selects && document.activeElement instanceof HTMLButtonElement) document.activeElement.click();
  };
}
/* float wholly above the held words when there's room; below when not */
function place(elm, rect, gap = 10) {
  elm.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - elm.offsetWidth / 2, innerWidth - elm.offsetWidth - 12)) + "px";
  const above = rect.top - elm.offsetHeight - gap;
  const fitsAbove = above >= 60;
  elm.dataset.placement = fitsAbove ? "top" : "bottom";
  elm.style.top = (fitsAbove ? above : Math.min(rect.bottom + gap, innerHeight - elm.offsetHeight - 12)) + "px";
}
function placeAt(elm, x, y, gap = 40) {
  elm.style.left = Math.max(12, Math.min(x - elm.offsetWidth / 2, innerWidth - elm.offsetWidth - 12)) + "px";
  elm.style.top = Math.max(52, y - gap) + "px";
}

/* ── shared state ────────────────────────────────────────────── */
let MODE = null;        // null = read · {type:"wash",color} · {type:"connect",kind} · {type:"note"} · {type:"erase"}
let LAST_HIT = null;    // last tapped wash — the dock's contextual edits aim at it
const SURFACE_KEY = "shape-marks-surface";
let VARIANT = localStorage.getItem(SURFACE_KEY) || "palette";

function setMode(m) { MODE = m; VARIANTS[VARIANT].refresh(); }
function sessionButtons() {
  const s = A.session();
  if (!s) return [];
  if (s.extend) return [{ label: "done", act: true, fn: () => A.endSession() }];
  const btns = [];
  if (!A.binary.has(s.kind) && s.members.length >= 2)
    btns.push({ label: "done", act: true, fn: () => A.finalizeSession() });
  btns.push({ label: "cancel", fn: () => A.endSession() });
  return btns;
}
function actionButtons(btns) {
  return btns.map((b) => {
    const btn = el("button", "pz-ak" + (b.act ? " act" : ""), b.label);
    btn.type = "button";
    keepSelection(btn).addEventListener("click", (e) => { e.stopPropagation(); b.fn(); });
    return btn;
  });
}

/* ── shared chrome · status pill (bottom right) ──────────────── */
const statusEl = el("div", "pz-chrome pz-status");
statusEl.dataset.pz = "";
document.body.appendChild(statusEl);
function hideStatus() { statusEl.classList.remove("on"); }
/* tagHtml names what's in the hand; msg says what happens next;
 * × puts the pen down entirely — Esc (engine) cancels only the session */
function showStatus(tagHtml, msg) {
  statusEl.innerHTML = tagHtml + `<span class="pz-hint">${msg}</span>`;
  statusEl.append(...actionButtons(sessionButtons()));
  const release = iconButton("close", "Put the tool down");
  keepSelection(release).addEventListener("click", (e) => {
    e.stopPropagation();
    if (A.session()) A.endSession();
    setMode(null);
  });
  statusEl.appendChild(release);
  statusEl.classList.add("on");
}
function modeStatusText() {
  if (MODE?.type === "wash") return "select words — the wash stays in your hand";
  if (MODE?.type === "connect") return "select words — the shape stays in your hand";
  if (MODE?.type === "note") return "tap a wash or a marked phrase to annotate";
  if (MODE?.type === "erase") return "tap a wash to lift it";
  return "";
}
function refreshModeStatus() {
  if (A.session()) return; // session status owns the pill
  if (!MODE) { hideStatus(); return; }
  const tag = MODE.type === "wash" ? washTag(MODE.color)
    : MODE.type === "connect" ? kindTag(MODE.kind)
    : `<span class="pz-tooltag">${icon(MODE.type)}<span>${MODE.type}</span></span>`;
  showStatus(tag, modeStatusText());
}

/* ── shared chrome · the highlight chip (a tapped wash's edits) ─ */
const hlchip = el("div", "pz-chrome pz-hlchip");
hlchip.dataset.pz = "";
document.body.appendChild(hlchip);
function hideHlchip() { hlchip.classList.remove("on"); }
function showHlchip(hit, x, y) {
  hlchip.innerHTML = washTag(hit.color);
  const note = iconButton("note", "Add note");
  note.addEventListener("click", (e) => { e.stopPropagation(); hideHlchip(); openNote(hit, x, y); });
  const remove = iconButton("trash", `Remove ${hit.color} highlight`, "is-danger");
  remove.setAttribute("aria-label", `remove ${hit.color} highlight`);
  remove.addEventListener("click", (e) => { e.stopPropagation(); hideHlchip(); A.removeHighlight(hit.id); });
  hlchip.append(note, el("span", "pz-sep"), remove);
  hlchip.classList.add("on");
  placeAt(hlchip, x, y);
}
document.addEventListener("mousedown", (e) => { if (!e.target.closest?.(".pz-hlchip")) hideHlchip(); });
addEventListener("scroll", hideHlchip, { passive: true });

/* ── shared chrome · the note popover ────────────────────────── */
const noteEl = el("div", "pz-chrome pz-note");
noteEl.dataset.pz = "";
noteEl.setAttribute("role", "dialog");
noteEl.setAttribute("aria-label", "Highlight observation");
document.body.appendChild(noteEl);
let NOTE_ID = null;
let NOTE_RETURN_FOCUS = null;
function hideNote(restoreFocus = false) {
  noteEl.classList.remove("on"); NOTE_ID = null;
  if (restoreFocus && NOTE_RETURN_FOCUS?.isConnected) NOTE_RETURN_FOCUS.focus({ preventScroll: true });
  NOTE_RETURN_FOCUS = null;
}
function openNote(hit, x, y) {
  NOTE_ID = hit.id;
  NOTE_RETURN_FOCUS = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  noteEl.innerHTML = "";
  const head = el("div", "pz-note-head", `<span>${washTag(hit.color)}<span>Observation</span></span>`);
  const close = iconButton("close", "Close note");
  close.addEventListener("click", () => hideNote(true));
  head.appendChild(close);
  const ta = el("textarea");
  ta.placeholder = "what do you see here?";
  ta.value = A.getNote(hit.id);
  ta.addEventListener("input", () => A.setNote(hit.id, ta.value));
  ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); hideNote(true); } });
  const foot = el("div", "pz-note-foot", `<span>saved as you write</span><span>esc</span>`);
  noteEl.append(head, ta, foot);
  noteEl.classList.add("on");
  placeAt(noteEl, x, y, 24);
  ta.focus();
}
document.addEventListener("mousedown", (e) => { if (NOTE_ID && !e.target.closest?.(".pz-note")) hideNote(); });
addEventListener("scroll", hideNote, { passive: true });

/* note mode also reaches patterns: tap marked words → pin + card note */
document.addEventListener("click", (e) => {
  if (MODE?.type !== "note") return;
  const t = e.target.closest?.("[data-gids]");
  if (!t) return;
  const gid = t.dataset.gids.split(" ")[0];
  A.pinMark(gid);
  requestAnimationFrame(() => A.focusCardNote());
});

/* every selection runs through the mode first; the mode either marks
 * immediately (wash / connect) or waves the gesture through (note /
 * erase have no use for a selection) */
function applyModeSelection(info) {
  if (!MODE) return false;
  if (MODE.type === "wash") { A.createHighlight(info, MODE.color); VARIANTS[VARIANT].refresh(); }
  else if (MODE.type === "connect") A.startSession(MODE.kind, info);
  return true;
}

/* ══ variant A · the refined popover ═══════════════════════════ */
const pop = el("div", "pz-chrome pz-pop");
pop.dataset.pz = "";
pop.setAttribute("role", "toolbar");
pop.setAttribute("aria-label", "Mark selected text");
document.body.appendChild(pop);
let POP_INFO = null;   // the held selection the open menu is serving
let POP_RETURN_FOCUS = null;
let KEEP = false;

function hidePop(restoreFocus = false) {
  pop.classList.remove("on", "is-session");
  POP_INFO = null;
  KEEP = false;
  if (restoreFocus && POP_RETURN_FOCUS?.isConnected) POP_RETURN_FOCUS.focus({ preventScroll: true });
  POP_RETURN_FOCUS = null;
}

function popMenu(info) {
  POP_INFO = info;
  POP_RETURN_FOCUS = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pop.innerHTML = "";
  pop.classList.remove("is-session");
  pop.style.flexDirection = ""; pop.style.alignItems = "";
  const def = el("div", "pz-def", A.resting);
  const head = el("div", "pz-pop-head");
  const headCopy = el("div", "pz-pop-copy");
  headCopy.append(
    el("span", "pz-eyebrow", "Mark selection"),
    el("span", "pz-selection", `“${info.phrase.length > 42 ? `${info.phrase.slice(0, 41)}…` : info.phrase}”`),
  );
  const headActions = el("div", "pz-pop-actions");
  const keep = iconButton("pin", "Keep chosen tool active", "pz-keep");
  keep.setAttribute("aria-pressed", "false");
  keepSelection(keep).addEventListener("click", (event) => {
    event.stopPropagation();
    KEEP = !KEEP;
    keep.setAttribute("aria-pressed", KEEP ? "true" : "false");
    keep.dataset.tip = KEEP ? "Tool will stay active" : "Keep chosen tool active";
    def.textContent = KEEP ? "The tool you choose will remain in your hand." : A.resting;
  });
  const close = iconButton("close", "Close palette");
  keepSelection(close).addEventListener("click", (event) => { event.stopPropagation(); hidePop(true); });
  headActions.append(keep, close);
  head.append(headCopy, headActions);

  const kindGroup = el("section", "pz-pop-group");
  const kindLabel = el("div", "pz-group-label", "Connect");
  const kindGrid = el("div", "pz-choice-grid pz-kind-grid");
  kindGrid.setAttribute("role", "group");
  kindGrid.setAttribute("aria-label", "Connection types");
  const choices = [];
  A.kinds.forEach((kind, index) => {
    const b = kindChip(kind, () => {
      const keepIt = KEEP;
      hidePop();
      if (keepIt) setMode({ type: "connect", kind });
      A.startSession(kind, info);
    });
    b.setAttribute("aria-keyshortcuts", String(index + 1));
    explain(b, def, A.defs[kind], A.resting);
    choices.push(b);
    kindGrid.appendChild(b);
  });
  kindGroup.append(kindLabel, kindGrid);

  const washGroup = el("section", "pz-pop-group");
  const washLabel = el("div", "pz-group-label", "Highlight");
  const washGrid = el("div", "pz-choice-grid pz-wash-grid");
  washGrid.setAttribute("role", "group");
  washGrid.setAttribute("aria-label", "Highlight colors");
  A.colors.forEach((color, index) => {
    const b = washChip(color, () => {
      const keepIt = KEEP;
      hidePop();
      if (keepIt) setMode({ type: "wash", color });
      A.createHighlight(info, color);
    });
    b.setAttribute("aria-keyshortcuts", `Shift+${index + 1}`);
    explain(b, def, WASH_DEF(color), A.resting);
    choices.push(b);
    washGrid.appendChild(b);
  });
  washGroup.append(washLabel, washGrid);

  const foot = el("div", "pz-pop-foot");
  foot.append(def, el("span", "pz-shortcuts", `<kbd>1–6</kbd> connect <kbd>⇧1–5</kbd> highlight`));
  pop.append(head, kindGroup, washGroup, foot);
  wireChoiceKeys(pop, choices);
  const arrowKeys = pop.onkeydown;
  pop.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); hidePop(true); return;
    }
    arrowKeys?.(event);
  };
  pop.classList.add("on");
  place(pop, info.range.getBoundingClientRect());
  requestAnimationFrame(() => choices[0]?.focus({ preventScroll: true }));
}

function popSession(msg) {
  const s = A.session();
  pop.innerHTML = `<div class="pz-session-copy">${kindTag(s.kind)}<span class="pz-hint">${msg}</span></div>`;
  pop.style.flexDirection = "row"; pop.style.alignItems = "center";
  pop.append(...actionButtons(sessionButtons()));
  pop.classList.add("is-session");
  pop.classList.add("on");
  const anchor = s.members[s.members.length - 1];
  if (anchor) place(pop, anchor.range.getBoundingClientRect());
}

/* number keys pick from the open menu — 1–6 kinds, ⇧1–5 washes */
document.addEventListener("keydown", (e) => {
  if (!POP_INFO || e.target.closest("input, textarea, [contenteditable]")) return;
  const m = /^Digit([1-6])$/.exec(e.code); // e.code: ⇧1 is "!" in e.key
  if (!m) return;
  const n = parseInt(m[1], 10);
  const info = POP_INFO;
  if (e.shiftKey) {
    const color = A.colors[n - 1];
    if (color) {
      const keepIt = KEEP; hidePop();
      if (keepIt) setMode({ type: "wash", color });
      A.createHighlight(info, color);
    }
  } else {
    const kind = A.kinds[n - 1];
    if (kind) {
      const keepIt = KEEP; hidePop();
      if (keepIt) setMode({ type: "connect", kind });
      A.startSession(kind, info);
    }
  }
});

/* ══ variant B · the pen rail ══════════════════════════════════ */
const rail = el("div", "pz-chrome pz-rail");
rail.dataset.pz = "";
rail.setAttribute("role", "toolbar");
rail.setAttribute("aria-label", "Pen Rail tools");
const tray = el("div", "pz-chrome pz-tray");
tray.dataset.pz = "";
tray.id = "pz-rail-tray";
tray.setAttribute("role", "dialog");
const railfoot = el("div", "pz-chrome pz-railfoot");
railfoot.dataset.pz = "";
railfoot.setAttribute("role", "status");
railfoot.setAttribute("aria-live", "polite");
document.body.append(rail, tray, railfoot);
rail.style.display = "none"; tray.style.display = "none"; railfoot.style.display = "none";

const RAIL_TOOLS = [
  { id: "wash", icon: "wash", name: "Highlight" },
  { id: "connect", icon: "link", name: "Connect" },
  { id: "note", icon: "note", name: "Note" },
  { id: "erase", icon: "erase", name: "Erase" },
];
for (const t of RAIL_TOOLS) {
  const b = el("button", `pz-tool pz-tip pz-tool-${t.id}`, `<span class="pz-glyph">${icon(t.icon)}</span><span class="pz-tname">${t.name}</span>`);
  b.type = "button";
  b.dataset.tool = t.id;
  b.dataset.tip = t.name;
  b.setAttribute("aria-label", t.name);
  b.setAttribute("aria-pressed", "false");
  if (t.id === "wash" || t.id === "connect") {
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", tray.id);
  }
  b.addEventListener("click", () => railTool(t.id, b));
  rail.appendChild(b);
}
let RAIL_OPEN = null;
let RAIL_OPENER = null;
function hideTray(restoreFocus = false) {
  tray.classList.remove("on");
  if (RAIL_OPENER) RAIL_OPENER.setAttribute("aria-expanded", "false");
  const opener = RAIL_OPENER;
  RAIL_OPEN = null; RAIL_OPENER = null;
  if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
}
function placeRailTray(anchorRect) {
  const r = rail.getBoundingClientRect();
  tray.style.left = r.right + 8 + "px";
  const preferred = anchorRect?.top ?? r.top;
  tray.style.top = Math.max(64, Math.min(preferred - 8, innerHeight - tray.offsetHeight - 12)) + "px";
}
function trayHeader(title, subtitle) {
  const head = el("div", "pz-tray-head");
  const copy = el("div", "pz-tray-copy");
  copy.append(el("span", "pz-eyebrow", title), el("span", "pz-tray-sub", subtitle));
  const close = iconButton("close", "Close tool tray");
  keepSelection(close).addEventListener("click", (event) => { event.stopPropagation(); hideTray(true); });
  head.append(copy, close);
  return head;
}
function openRailOptions(id, btn, info = null, anchorRect = null) {
  hideTray();
  RAIL_OPEN = id;
  RAIL_OPENER = btn;
  if (btn) btn.setAttribute("aria-expanded", "true");
  tray.innerHTML = "";
  tray.setAttribute("aria-label", id === "wash" ? "Choose a highlight" : "Choose a connection");
  const title = id === "wash" ? "Highlight" : "Connect";
  const subtitle = info ? "Apply once to this selection" : "Choose the tool to carry";
  const def = el("div", "pz-def", id === "wash" ? "Choose a quiet wash." : "Choose how these words relate.");
  const grid = el("div", `pz-choice-grid ${id === "wash" ? "pz-wash-grid" : "pz-kind-grid"}`);
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", title);
  const choices = [];
  if (id === "wash") {
    A.colors.forEach((color) => {
      const choice = washChip(color, () => {
        hideTray();
        if (info) A.createHighlight(info, color);
        else setMode({ type: "wash", color });
      });
      explain(choice, def, WASH_DEF(color), "Choose a quiet wash.");
      choices.push(choice); grid.appendChild(choice);
    });
  } else {
    A.kinds.forEach((kind) => {
      const choice = kindChip(kind, () => {
        hideTray();
        if (info) A.startSession(kind, info);
        else setMode({ type: "connect", kind });
      });
      explain(choice, def, A.defs[kind], "Choose how these words relate.");
      choices.push(choice); grid.appendChild(choice);
    });
  }
  tray.append(trayHeader(title, subtitle), grid, def);
  tray.classList.add("on");
  placeRailTray(anchorRect || btn?.getBoundingClientRect());
  wireChoiceKeys(tray, choices);
  const arrowKeys = tray.onkeydown;
  tray.onkeydown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hideTray(true); return; }
    arrowKeys?.(event);
  };
  requestAnimationFrame(() => choices[0]?.focus({ preventScroll: true }));
}
function openRailIntent(info) {
  hideTray();
  RAIL_OPEN = "intent";
  tray.innerHTML = "";
  tray.setAttribute("aria-label", "Mark selected text");
  const grid = el("div", "pz-intent-grid");
  const wash = el("button", "pz-intent", `${icon("wash")}<span><strong>Highlight</strong><small>Lay a quiet wash</small></span>`);
  const connect = el("button", "pz-intent", `${icon("link")}<span><strong>Connect</strong><small>Relate these words</small></span>`);
  for (const button of [wash, connect]) { button.type = "button"; keepSelection(button); }
  wash.addEventListener("click", (event) => { event.stopPropagation(); openRailOptions("wash", null, info, info.range.getBoundingClientRect()); });
  connect.addEventListener("click", (event) => { event.stopPropagation(); openRailOptions("connect", null, info, info.range.getBoundingClientRect()); });
  grid.append(wash, connect);
  tray.append(trayHeader("Mark selection", `“${info.phrase.length > 30 ? `${info.phrase.slice(0, 29)}…` : info.phrase}”`), grid);
  tray.classList.add("on");
  placeRailTray(info.range.getBoundingClientRect());
  wireChoiceKeys(tray, [wash, connect]);
  const arrowKeys = tray.onkeydown;
  tray.onkeydown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hideTray(); return; }
    arrowKeys?.(event);
  };
  requestAnimationFrame(() => wash.focus({ preventScroll: true }));
}
function railTool(id, btn) {
  if (RAIL_OPEN === id) { hideTray(true); return; }
  if (id === "note" || id === "erase") {
    const active = btn.getAttribute("aria-pressed") === "true";
    hideTray(); setMode(active ? null : { type: id });
    return;
  }
  openRailOptions(id, btn);
}
function railRefresh() {
  hideStatus(); // the rail's foot owns mode and session status
  rail.querySelectorAll(".pz-tool").forEach((b) => {
    const id = b.dataset.tool;
    const on = (MODE?.type === "wash" && id === "wash") || (MODE?.type === "connect" && id === "connect") || MODE?.type === id;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    const ink = MODE?.type === "wash" && id === "wash" ? `var(--hl-${MODE.color}-ink)`
      : MODE?.type === "connect" && id === "connect" ? A.hues[MODE.kind] : null;
    b.style.setProperty("--tool-ink", ink || "var(--text-primary)");
    const base = RAIL_TOOLS.find((tool) => tool.id === id)?.name || id;
    const subtype = MODE?.type === "wash" && id === "wash" ? MODE.color
      : MODE?.type === "connect" && id === "connect" ? A.labels[MODE.kind] : "";
    b.setAttribute("aria-label", subtype ? `${base}: ${subtype}` : base);
    b.dataset.tip = subtype ? `${base} · ${subtype}` : base;
  });
  /* the foot names what's in the hand, or carries the session */
  const s = A.session();
  if (!s && !MODE) { railfoot.classList.remove("on"); return; }
  railfoot.innerHTML = "";
  if (s) {
    railfoot.innerHTML = `<div class="pz-railfoot-head">${kindTag(s.kind)}</div>`;
  } else {
    const tag = MODE.type === "wash" ? washTag(MODE.color)
      : MODE.type === "connect" ? kindTag(MODE.kind)
      : `<span class="pz-tooltag">${icon(MODE.type)}<span>${MODE.type}</span></span>`;
    const head = el("div", "pz-railfoot-head", tag);
    const release = iconButton("close", "Put tool down");
    release.addEventListener("click", () => setMode(null));
    head.appendChild(release);
    railfoot.append(head, el("div", "pz-def", modeStatusText()));
  }
  const row = el("div", "pz-row");
  row.append(...actionButtons(sessionButtons()));
  railfoot.appendChild(row);
  railfoot.classList.add("on");
}
function railSession(msg) {
  railfoot.innerHTML = `<div class="pz-railfoot-head">${kindTag(A.session().kind)}</div><div class="pz-def">${msg}</div>`;
  const row = el("div", "pz-row");
  row.append(...actionButtons(sessionButtons()));
  railfoot.appendChild(row);
  railfoot.classList.add("on");
}
document.addEventListener("mousedown", (event) => {
  if (RAIL_OPEN && !event.target.closest?.(".pz-tray, .pz-rail")) hideTray();
});

/* ══ variant C · the radial ════════════════════════════════════ */
const radial = el("div", "pz-radial");
radial.dataset.pz = "";
radial.setAttribute("role", "dialog");
radial.setAttribute("aria-modal", "true");
radial.setAttribute("aria-label", "Radial marking menu");
document.body.appendChild(radial);
let RAD_INFO = null;
let RAD_KEEP = false;
let RAD_RETURN_FOCUS = null;
const RAD_R = 124;

function hideRadial(restoreFocus = false) {
  radial.classList.remove("on");
  RAD_INFO = null; RAD_KEEP = false;
  if (restoreFocus && RAD_RETURN_FOCUS?.isConnected) RAD_RETURN_FOCUS.focus({ preventScroll: true });
  RAD_RETURN_FOCUS = null;
}
function openRadial(info) {
  RAD_INFO = info;
  RAD_RETURN_FOCUS = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  radial.innerHTML = "";
  const fragments = [...info.range.getClientRects()];
  const rect = fragments[fragments.length - 1] || info.range.getBoundingClientRect();
  const outer = RAD_R + 28;
  const rangeNode = info.range.commonAncestorContainer;
  const rangeElement = rangeNode.nodeType === Node.ELEMENT_NODE ? rangeNode : rangeNode.parentElement;
  const sheetRect = rangeElement?.closest?.(".sheet")?.getBoundingClientRect();
  let radialSide = "anchor";
  let cx = Math.max(outer + 12, Math.min(rect.left + rect.width / 2, innerWidth - outer - 12));
  let cy = Math.max(outer + 58, Math.min(rect.top - RAD_R - 20, innerHeight - outer - 20));
  if (sheetRect) {
    const rightCenter = sheetRect.right + outer + 12;
    const leftCenter = sheetRect.left - outer - 12;
    if (rightCenter + outer + 12 <= innerWidth) { cx = rightCenter; radialSide = "right"; }
    else if (leftCenter - outer - 12 >= 0) { cx = leftCenter; radialSide = "left"; }
    if (radialSide !== "anchor") cy = Math.max(outer + 70, Math.min(rect.top + rect.height / 2, innerHeight - outer - 98));
  }
  const d = RAD_R * 2;
  /* backdrop vignette focuses light on the hub; the disc seats the petals */
  radial.style.setProperty("--rad-cx", cx + "px");
  radial.style.setProperty("--rad-cy", cy + "px");
  const disc = el("div", "pz-disc");
  const discR = RAD_R + 34;
  disc.style.cssText = `width:${discR * 2}px;height:${discR * 2}px;left:${cx - discR}px;top:${cy - discR}px`;
  const topArc = el("div", "pz-ring pz-ring-top");
  const bottomArc = el("div", "pz-ring pz-ring-bottom");
  for (const ring of [topArc, bottomArc]) ring.style.cssText = `width:${d}px;height:${d}px;left:${cx - RAD_R}px;top:${cy - RAD_R}px`;
  const hub = el("div", "pz-hub");
  hub.style.left = cx + "px"; hub.style.top = cy + "px";
  hub.innerHTML = `<span class="pz-hub-mark">mark</span>`;
  const keep = iconButton("pin", "Keep chosen tool active", "pz-rkeep");
  keep.setAttribute("aria-pressed", "false");
  keepSelection(keep).addEventListener("click", (e) => {
    e.stopPropagation();
    RAD_KEEP = !RAD_KEEP;
    keep.setAttribute("aria-pressed", RAD_KEEP ? "true" : "false");
    keep.dataset.tip = RAD_KEEP ? "Tool will stay active" : "Keep chosen tool active";
    helpName.textContent = RAD_KEEP ? "Tool will stay active" : "Choose a tool";
    helpDef.textContent = RAD_KEEP ? "Your next choice remains in hand until you put it down." : A.resting;
  });
  hub.appendChild(keep);
  const help = el("div", "pz-radial-help");
  const helpCopy = el("div", "pz-radial-help-copy");
  const helpName = el("span", "pz-hubname", "Choose a tool");
  const helpDef = el("span", "pz-def", A.resting);
  const close = iconButton("close", "Close radial menu");
  close.addEventListener("click", (event) => { event.stopPropagation(); hideRadial(true); });
  helpCopy.append(helpName, helpDef);
  help.append(helpCopy, close);
  radial.append(disc, topArc, bottomArc, hub, help);

  const helpWidth = 216;
  if (radialSide !== "anchor") {
    help.style.left = Math.max(12, Math.min(cx - helpWidth / 2, innerWidth - helpWidth - 12)) + "px";
    help.style.top = Math.min(innerHeight - 90, cy + outer + 8) + "px";
  } else if (innerWidth - (cx + outer) >= helpWidth + 20) {
    help.style.left = cx + outer + 12 + "px"; help.style.top = cy - 42 + "px";
  } else if (cx - outer >= helpWidth + 20) {
    help.style.left = cx - outer - helpWidth - 12 + "px"; help.style.top = cy - 42 + "px";
  } else {
    help.style.left = Math.max(12, Math.min(cx - helpWidth / 2, innerWidth - helpWidth - 12)) + "px";
    help.style.top = Math.min(innerHeight - 90, cy + outer + 8) + "px";
  }

  const petal = (angleDeg, node) => {
    const a = (angleDeg * Math.PI) / 180;
    node.style.left = cx + RAD_R * Math.cos(a) + "px";
    node.style.top = cy + RAD_R * Math.sin(a) + "px";
    radial.appendChild(node);
  };
  const choices = [];
  const describe = (name, description) => { helpName.textContent = name; helpDef.textContent = description; };
  const restoreHelp = () => {
    helpName.textContent = RAD_KEEP ? "Tool will stay active" : "Choose a tool";
    helpDef.textContent = RAD_KEEP ? "Your next choice remains in hand until you put it down." : A.resting;
  };
  /* Connections ride a quiet upper arc; washes sit on the lower arc. */
  A.kinds.forEach((kind, i) => {
    const p = el("button", "pz-petal pz-petal-kind", kindGlyph(kind));
    p.type = "button";
    p.setAttribute("aria-label", A.labels[kind]);
    p.dataset.group = "Connections";
    p.style.setProperty("--pz-petal-i", i);
    keepSelection(p);
    p.addEventListener("mouseenter", () => describe(A.labels[kind], A.defs[kind]));
    p.addEventListener("mouseleave", () => { if (document.activeElement !== p) restoreHelp(); });
    p.addEventListener("focus", () => describe(A.labels[kind], A.defs[kind]));
    p.addEventListener("blur", restoreHelp);
    p.addEventListener("click", (e) => {
      e.stopPropagation();
      const keepIt = RAD_KEEP; hideRadial();
      if (keepIt) setMode({ type: "connect", kind });
      A.startSession(kind, info);
    });
    choices.push(p);
    petal(200 + i * 28, p);
  });
  A.colors.forEach((color, i) => {
    const p = el("button", "pz-petal pz-petal-wash", washGlyph(color));
    p.type = "button";
    p.setAttribute("aria-label", `highlight ${color}`);
    p.dataset.group = "Highlights";
    p.style.setProperty("--pz-petal-i", A.kinds.length + i);
    keepSelection(p);
    p.addEventListener("mouseenter", () => describe(color, WASH_DEF(color)));
    p.addEventListener("mouseleave", () => { if (document.activeElement !== p) restoreHelp(); });
    p.addEventListener("focus", () => describe(color, WASH_DEF(color)));
    p.addEventListener("blur", restoreHelp);
    p.addEventListener("click", (e) => {
      e.stopPropagation();
      const keepIt = RAD_KEEP; hideRadial();
      if (keepIt) setMode({ type: "wash", color });
      A.createHighlight(info, color);
    });
    choices.push(p);
    petal(20 + i * 35, p);
  });
  radial.classList.add("on");
  wireChoiceKeys(radial, choices);
  const arrowKeys = radial.onkeydown;
  radial.onkeydown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hideRadial(true); return; }
    if (event.key === "Tab") {
      const activeChoice = choices.find((choice) => choice.tabIndex === 0) || choices[0];
      const stops = [activeChoice, keep, close].filter((element) => element.offsetParent !== null);
      const current = Math.max(0, stops.indexOf(document.activeElement));
      const next = (current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      event.preventDefault();
      stops[next].focus({ preventScroll: true });
      return;
    }
    arrowKeys?.(event);
  };
  requestAnimationFrame(() => choices[0]?.focus({ preventScroll: true }));
}
radial.addEventListener("mousedown", (e) => { if (e.target === radial) hideRadial(true); });
addEventListener("scroll", () => { if (RAD_INFO) hideRadial(); }, { passive: true });
addEventListener("resize", () => { if (RAD_INFO) hideRadial(); }, { passive: true });

/* ══ variant D · the bottom dock ═══════════════════════════════ */
const dock = el("div", "pz-chrome pz-dock");
dock.dataset.pz = "";
dock.style.display = "none";
dock.setAttribute("role", "toolbar");
dock.setAttribute("aria-label", "Marking Dock");
document.body.appendChild(dock);
const dockModes = el("div", "pz-modes");
dockModes.setAttribute("role", "radiogroup");
dockModes.setAttribute("aria-label", "Marking mode");
const dockCenter = el("div", "pz-dock-center");
dockCenter.setAttribute("aria-live", "polite");
const dockActions = el("div", "pz-dock-actions");
dockActions.setAttribute("aria-label", "Selected highlight actions");
dock.append(dockModes, dockCenter, dockActions);
let DOCK_INFO = null;

const DOCK_TABS = [
  { id: "read", label: "Read", icon: "read" }, { id: "wash", label: "Highlight", icon: "wash" },
  { id: "connect", label: "Connect", icon: "link" }, { id: "note", label: "Note", icon: "note" }, { id: "erase", label: "Erase", icon: "erase" },
];
for (const t of DOCK_TABS) {
  const b = el("button", `pz-dock-mode pz-tip pz-dock-mode-${t.id}`, icon(t.icon));
  b.type = "button";
  b.dataset.tab = t.id;
  b.dataset.tip = t.label;
  b.setAttribute("aria-label", t.label);
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", t.id === "read" ? "true" : "false");
  keepSelection(b).addEventListener("click", () => {
    if (t.id === "read") setMode(null);
    else if (t.id === "note" || t.id === "erase") setMode({ type: t.id });
    else setMode({ type: t.id, ...(t.id === "wash" ? { color: MODE?.color || A.colors[0] } : { kind: MODE?.kind || A.kinds[0] }) });
  });
  dockModes.appendChild(b);
}
const dockModeButtons = [...dockModes.querySelectorAll(".pz-dock-mode")];
dockModeButtons.forEach((button, index) => { button.tabIndex = index === 0 ? 0 : -1; });
dockModes.addEventListener("keydown", (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const current = Math.max(0, dockModeButtons.indexOf(document.activeElement));
  const next = event.key === "Home" ? 0
    : event.key === "End" ? dockModeButtons.length - 1
    : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + dockModeButtons.length) % dockModeButtons.length;
  event.preventDefault();
  dockModeButtons[next].focus({ preventScroll: true });
  dockModeButtons[next].click();
});
/* Sliding mode indicator: a neutral lens thumb rides behind .pz-modes.
 * Repositioned by dockRefresh, which owns aria-checked. */
const dockThumb = el("span", "pz-dock-thumb");
dockThumb.setAttribute("aria-hidden", "true");
dockModes.insertBefore(dockThumb, dockModes.firstChild);
function moveDockThumb() {
  const active = dockModes.querySelector('.pz-dock-mode[aria-checked="true"]');
  if (!active || dock.style.display === "none") { dockModes.classList.remove("has-thumb"); return; }
  dockModes.style.setProperty("--dock-x", active.offsetLeft + "px");
  dockModes.style.setProperty("--dock-w", active.offsetWidth + "px");
  dockModes.classList.add("has-thumb");
}
function dockRefresh() {
  hideStatus(); // the dock's center owns mode and session status
  const focusedChoice = document.activeElement?.dataset?.choiceId || null;
  dockModes.querySelectorAll(".pz-dock-mode").forEach((b) => {
    const id = b.dataset.tab;
    const on = id === "read" ? !MODE
      : id === "wash" ? MODE?.type === "wash"
      : id === "connect" ? MODE?.type === "connect"
      : MODE?.type === id;
    b.removeAttribute("aria-pressed");
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
    const tab = DOCK_TABS.find((item) => item.id === id);
    const subtype = MODE?.type === "wash" && id === "wash" ? MODE.color
      : MODE?.type === "connect" && id === "connect" ? A.labels[MODE.kind] : "";
    b.setAttribute("aria-label", subtype ? `${tab.label}: ${subtype}` : tab.label);
    b.dataset.tip = subtype ? `${tab.label} · ${subtype}` : tab.label;
    const tone = MODE?.type === "wash" && id === "wash" ? `var(--hl-${MODE.color}-ink)`
      : MODE?.type === "connect" && id === "connect" ? A.hues[MODE.kind] : "var(--text-primary)";
    b.style.setProperty("--tool-ink", tone);
  });
  requestAnimationFrame(moveDockThumb);
  dockCenter.innerHTML = "";
  const s = A.session();
  if (s) {
    dockSession(A.binary.has(s.kind) && s.members.length < 2 ? "select the counterpart" : "select the next, or finish");
  } else if (MODE?.type === "wash") {
    dockCenter.appendChild(el("span", "pz-context-label", "Highlight"));
    const group = el("div", "pz-dock-choices");
    group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "Highlight color");
    const choices = [];
    for (const color of A.colors) {
      const b = washChip(color, () => setMode({ type: "wash", color }));
      b.dataset.choiceId = `wash-${color}`;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", color === MODE.color ? "true" : "false");
      choices.push(b); group.appendChild(b);
    }
    wireRadioKeys(group, choices);
    choices.forEach((button) => { button.tabIndex = button.getAttribute("aria-checked") === "true" ? 0 : -1; });
    dockCenter.appendChild(group);
  } else if (MODE?.type === "connect") {
    dockCenter.appendChild(el("span", "pz-context-label", "Connect"));
    const group = el("div", "pz-dock-choices");
    group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "Connection type");
    const choices = [];
    for (const kind of A.kinds) {
      const b = kindChip(kind, () => setMode({ type: "connect", kind }));
      b.dataset.choiceId = `kind-${kind}`;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", kind === MODE.kind ? "true" : "false");
      choices.push(b); group.appendChild(b);
    }
    wireRadioKeys(group, choices);
    choices.forEach((button) => { button.tabIndex = button.getAttribute("aria-checked") === "true" ? 0 : -1; });
    dockCenter.appendChild(group);
  } else {
    dockCenter.appendChild(el("span", "pz-dock-resting", `${icon(MODE ? MODE.type : "cursor")}<span>${MODE ? modeStatusText() : "Select words, or choose a tool to keep in hand."}</span>`));
  }
  /* Context actions appear only when the user has named a wash. */
  dockActions.innerHTML = "";
  if (LAST_HIT) {
    dockActions.appendChild(el("span", "pz-dock-hit", washTag(LAST_HIT.color)));
    const note = iconButton("note", "Add note to selected highlight");
    note.addEventListener("click", () => openNote(LAST_HIT, innerWidth / 2, innerHeight - 120));
    const remove = iconButton("trash", "Remove selected highlight", "is-danger");
    remove.addEventListener("click", () => { A.removeHighlight(LAST_HIT.id); LAST_HIT = null; dockRefresh(); });
    dockActions.append(note, remove);
  }
  if (focusedChoice) requestAnimationFrame(() => dockCenter.querySelector(`[data-choice-id="${focusedChoice}"]`)?.focus({ preventScroll: true }));
}
function dockSession(msg) {
  const s = A.session();
  dockCenter.innerHTML = "";
  const wrap = el("div", "pz-dstatus", kindTag(s.kind) + `<span class="pz-hint">${msg}</span>`);
  wrap.append(...actionButtons(sessionButtons()));
  dockCenter.appendChild(wrap);
}
function dockChoices(info, type) {
  DOCK_INFO = info;
  dockCenter.innerHTML = "";
  dockCenter.appendChild(el("span", "pz-context-label", type === "connect" ? "Connect" : "Highlight"));
  const group = el("div", "pz-dock-choices");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", type === "connect" ? "Connection types" : "Highlight colors");
  const def = el("span", "pz-hint pz-dock-def", type === "connect" ? "Choose how the words relate." : "Choose a quiet wash.");
  const choices = [];
  if (type === "connect") {
    A.kinds.forEach((kind) => {
      const b = kindChip(kind, () => { DOCK_INFO = null; A.startSession(kind, info); });
      explain(b, def, A.defs[kind], "Choose how the words relate.");
      choices.push(b); group.appendChild(b);
    });
  } else {
    A.colors.forEach((color) => {
      const b = washChip(color, () => { DOCK_INFO = null; A.createHighlight(info, color); });
      explain(b, def, WASH_DEF(color), "Choose a quiet wash.");
      choices.push(b); group.appendChild(b);
    });
  }
  dockCenter.append(group, def);
  wireChoiceKeys(dockCenter, choices);
  requestAnimationFrame(() => choices[0]?.focus({ preventScroll: true }));
}
function dockMenu(info) {
  DOCK_INFO = info;
  dockCenter.innerHTML = "";
  const prompt = el("span", "pz-context-label", "Mark selection");
  const intents = el("div", "pz-dock-intents");
  const wash = el("button", "pz-intent pz-intent-compact", `${icon("wash")}<span><strong>Highlight</strong></span>`);
  const connect = el("button", "pz-intent pz-intent-compact", `${icon("link")}<span><strong>Connect</strong></span>`);
  for (const button of [wash, connect]) { button.type = "button"; keepSelection(button); }
  wash.addEventListener("click", (event) => { event.stopPropagation(); dockChoices(info, "wash"); });
  connect.addEventListener("click", (event) => { event.stopPropagation(); dockChoices(info, "connect"); });
  intents.append(wash, connect);
  dockCenter.append(prompt, intents, el("span", "pz-hint pz-selection-hint", `“${info.phrase.length > 34 ? `${info.phrase.slice(0, 33)}…` : info.phrase}”`));
  wireChoiceKeys(dockCenter, [wash, connect]);
  requestAnimationFrame(() => wash.focus({ preventScroll: true }));
}

/* ══ the variant registry ══════════════════════════════════════ */
const VARIANTS = {
  palette: {
    caption: "Selection palette · two clear vocabularies, one persistence control, full keyboard navigation",
    enter() { this.refresh(); },
    exit() { hidePop(); },
    refresh() { refreshModeStatus(); },
    onSelection(info) { return applyModeSelection(info) || (popMenu(info), true); },
    onSession(msg) {
      if (MODE?.type === "connect") { showStatus(kindTag(MODE.kind), msg); return true; }
      popSession(msg); return true;
    },
    onSessionEnd() { hidePop(); this.refresh(); },
    onHighlightTap(hit, x, y) {
      LAST_HIT = hit;
      if (MODE?.type === "erase") { A.removeHighlight(hit.id); return true; }
      if (MODE?.type === "note") { openNote(hit, x, y); return true; }
      showHlchip(hit, x, y); return true;
    },
    onSelectionCleared() { if (!MODE) hidePop(); },
    onEscape() {
      if (NOTE_ID) { hideNote(); return true; }
      if (POP_INFO) { hidePop(); return true; }
      if (A.session()) return false;
      if (MODE) { setMode(null); return true; }
      return false;
    },
  },
  rail: {
    caption: "Pen Rail · pick up a tool, work through the passage, put it down when the observation is complete",
    enter() { rail.style.display = ""; tray.style.display = ""; railfoot.style.display = ""; this.refresh(); },
    exit() { rail.style.display = "none"; tray.style.display = "none"; railfoot.style.display = "none"; hideTray(); },
    refresh() { railRefresh(); },
    onSelection(info) {
      if (applyModeSelection(info)) return true;
      openRailIntent(info); return true;
    },
    onSession(msg) { railSession(msg); return true; },
    onSessionEnd() { this.refresh(); },
    onHighlightTap(hit, x, y) {
      LAST_HIT = hit;
      if (MODE?.type === "erase") { A.removeHighlight(hit.id); return true; }
      if (MODE?.type === "note") { openNote(hit, x, y); return true; }
      showHlchip(hit, x, y); return true;
    },
    onSelectionCleared() { if (!MODE) hideTray(); },
    onEscape() {
      if (NOTE_ID) { hideNote(); return true; }
      if (tray.classList.contains("on")) { hideTray(); return true; }
      if (A.session()) return false;
      if (MODE) { setMode(null); return true; }
      return false;
    },
  },
  radial: {
    caption: "Radial · connection grammar above, highlight pigment below, navigable by pointer or arrow keys",
    enter() { this.refresh(); },
    exit() { hideRadial(); },
    refresh() { refreshModeStatus(); },
    onSelection(info) { return applyModeSelection(info) || (openRadial(info), true); },
    onSession(msg) { showStatus(kindTag(A.session().kind), msg); return true; },
    onSessionEnd() { this.refresh(); },
    onHighlightTap(hit, x, y) {
      LAST_HIT = hit;
      if (MODE?.type === "erase") { A.removeHighlight(hit.id); return true; }
      if (MODE?.type === "note") { openNote(hit, x, y); return true; }
      showHlchip(hit, x, y); return true;
    },
    onSelectionCleared() { hideRadial(); },
    onEscape() {
      if (NOTE_ID) { hideNote(); return true; }
      if (RAD_INFO) { hideRadial(); return true; }
      if (A.session()) return false;
      if (MODE) { setMode(null); return true; }
      return false;
    },
  },
  dock: {
    caption: "Dock · stable modes, one contextual center, and actions only when a highlight is actually selected",
    enter() { dock.style.display = ""; this.refresh(); },
    exit() { dock.style.display = "none"; },
    refresh() { dockRefresh(); },
    onSelection(info) { return applyModeSelection(info) || (dockMenu(info), true); },
    onSession(msg) { dockSession(msg); return true; },
    onSessionEnd() { this.refresh(); },
    onHighlightTap(hit, x, y) {
      LAST_HIT = hit;
      if (MODE?.type === "erase") { A.removeHighlight(hit.id); LAST_HIT = null; dockRefresh(); return true; }
      if (MODE?.type === "note") { openNote(hit, x, y); return true; }
      dockRefresh(); return true; // the right-hand actions light up
    },
    onSelectionCleared() { if (DOCK_INFO) { DOCK_INFO = null; dockRefresh(); } },
    onEscape() {
      if (NOTE_ID) { hideNote(); return true; }
      if (DOCK_INFO) { DOCK_INFO = null; dockRefresh(); return true; }
      if (A.session()) return false;
      if (MODE) { setMode(null); return true; }
      return false;
    },
  },
};

/* ── the host: lab.js defers to the active variant ───────────── */
window.LAB_PALETTE = {
  onSelection: (info) => VARIANTS[VARIANT].onSelection(info),
  onSession: (msg) => VARIANTS[VARIANT].onSession(msg),
  onSessionEnd: () => VARIANTS[VARIANT].onSessionEnd(),
  onHighlightTap: (hit, x, y) => VARIANTS[VARIANT].onHighlightTap(hit, x, y),
  onSelectionCleared: () => VARIANTS[VARIANT].onSelectionCleared(),
  onEscape: () => VARIANTS[VARIANT].onEscape(),
};

/* ── the switcher ────────────────────────────────────────────── */
const seg = document.getElementById("pz-seg");
const caption = document.getElementById("pz-caption");
function setVariant(v) {
  VARIANTS[VARIANT].exit();
  VARIANT = v;
  hideStatus(); hideHlchip(); hideNote();
  localStorage.setItem(SURFACE_KEY, v);
  document.body.dataset.variant = v;
  caption.textContent = VARIANTS[v].caption;
  seg.querySelectorAll("button").forEach((b) => {
    const checked = b.dataset.variant === v;
    b.setAttribute("aria-checked", checked ? "true" : "false");
    b.tabIndex = checked ? 0 : -1;
  });
  VARIANTS[v].enter();
}
seg.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.variant !== VARIANT) setVariant(b.dataset.variant);
});
seg.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const buttons = [...seg.querySelectorAll('button[role="radio"]')];
  const current = Math.max(0, buttons.indexOf(document.activeElement));
  const next = event.key === "Home" ? 0
    : event.key === "End" ? buttons.length - 1
    : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus(); buttons[next].click();
});
setVariant(VARIANT);

/* ── segmented thumb: a sliding lens behind the active segment ──
 * Progressive enhancement over every .seg group. It reads the current
 * aria-checked button and springs a floating tile to it; a MutationObserver
 * keeps it in sync no matter which handler (this file or lab.js) flips the
 * state, so no existing wiring changes. */
function initSegThumb(seg) {
  if (!seg) return null;
  const thumb = el("span", "seg-thumb");
  thumb.setAttribute("aria-hidden", "true");
  seg.insertBefore(thumb, seg.firstChild);
  const move = () => {
    const active = seg.querySelector('button[aria-checked="true"]');
    if (!active) { seg.classList.remove("has-thumb"); return; }
    seg.style.setProperty("--seg-x", `${active.offsetLeft}px`);
    seg.style.setProperty("--seg-w", `${active.offsetWidth}px`);
    seg.classList.add("has-thumb");
  };
  const observer = new MutationObserver(move);
  seg.querySelectorAll('button[role="radio"]').forEach((button) =>
    observer.observe(button, { attributes: true, attributeFilter: ["aria-checked"] }));
  requestAnimationFrame(move);
  return move;
}
const segMoves = ["pz-seg", "route-seg", "atm-seg"]
  .map((id) => initSegThumb(document.getElementById(id)))
  .filter(Boolean);
let measureChromeFrame = 0;
const remeasureChrome = () => {
  if (measureChromeFrame) return;
  measureChromeFrame = requestAnimationFrame(() => {
    measureChromeFrame = 0;
    segMoves.forEach((move) => move());
    moveDockThumb();
  });
};
addEventListener("resize", remeasureChrome, { passive: true });
addEventListener("load", remeasureChrome);
if (document.fonts?.ready) document.fonts.ready.then(remeasureChrome);
