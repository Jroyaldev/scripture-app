/**
 * Desktop-only visual and interaction QA for the podcast dock.
 *
 * Requires Electron on --remote-debugging-port=9222, and a library with the
 * Naked Bible manifest installed — it is the one source holding the media
 * grant, so it is the only source that can prove any of this. The tour fetches
 * a real episode from the publisher, which is the point: `preload="none"` means
 * nothing is requested until the press below, and the assertions here are about
 * what happens after it.
 *
 * What it proves, in order: the element is not fetched before the press; the
 * dock appears with the episode named; playback survives a passage change, a
 * closed panel, a view change and the command palette; the transport's own
 * controls move the file; the sheet's machine does the whole errand; and
 * stopping releases it. The tour plays audio and always stops it before
 * leaving.
 *
 * ── Restated 2026-07-30, with the build that made the app own the surface ────
 *
 * The tour was written for the PERMISSION boundary, which it still guards well,
 * and was asked afterwards to stand in for visual truth, which it was never
 * built to carry: it captured fourteen states of a collapsed corner and none of
 * the extended form, and every capture it had ever committed predated the code
 * that drew it. It now carries both jobs and says which is which.
 *
 * What is new, and why each of these is a gate rather than a picture:
 *
 *   · THE GROUND. The dock used to be painted `var(--resource-source)` — the
 *     publisher's colour — which is ten palettes against four atmospheres and
 *     forced colors, forty-four conditions nobody could check. The app owns it
 *     now, and `ownership()` below walks every source against every atmosphere
 *     IN THE RUNNING ENGINE and asserts the ground is the app's paper and never
 *     the brand's.
 *   · THE ACCENT. One brand colour still leaves the brand's surface, fitted to
 *     ours by a lightness clamp (see --accent-fit-* in styles.css). The same
 *     sweep measures its contrast against the app's paper, because the sweep is
 *     the only thing standing between that clamp and a number nobody checked.
 *   · THE SHEET IS A PLACE. Opening it must not move the study panel or the
 *     toast lane, and must not push the masthead — where the close control
 *     lives — off the top of a short window.
 *   · THE DESIGNED STATES. Reaching, refusal, empty, the disc, the unbranded
 *     fallback, forced colors, translucent, narrow. The disc in particular had
 *     never been seen by anyone: the one capture of it in the audit shows the
 *     dock at full size, because the tour had left focus inside the dock and
 *     the rule excludes `:has(:focus-visible)`.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { ATMOSPHERES, waitForState } from "./qa-support/app-vocabulary.mjs";

const CDP_HTTP = `http://localhost:${process.env.CDP_PORT ?? "9222"}/json/list`;
const OUT_DIR = "docs/ui-audit/podcast-player";
const CAPTURE_SCREENSHOTS = !process.argv.includes("--no-screenshots");
// The Naked Bible catalogue is titled by passage and covers 1 Samuel end to
// end, so this chapter is guaranteed an episode with an audioUrl on it.
const PASSAGE = "1 Samuel 30";
const ELSEWHERE = "Acts 19";

/* Every source with a palette block in styles.css, plus one that has none.
   The last entry is not a typo: an unregistered feed is a real configuration —
   the ingest pipeline exists precisely to add feeds — and it is the one the
   fallback palette was broken on, drawing a white play glyph on a near-white
   pill in two of the four atmospheres. */
const SOURCES = [
  "working-preacher",
  "bibleproject",
  "enter-the-bible",
  "naked-bible",
  "spoken-gospel",
  "forty-minutes-ot",
  "five-minutes-church-history",
  "ask-nt-wright",
  "listeners-commentary",
  "radically-christian",
  "the-gospel-coalition",
  "qa-unregistered-source",
];

/* The floor the accent's fit has to clear. 4.5 rather than 3, because the
   binding consumer is `.podcast-transcript-line mark` — 16px body copy sitting
   on this colour — and Law 6 holds text to 4.5. The measured worst case across
   these twelve sources and four atmospheres is BibleProject's cyan on Paper. */
const ACCENT_FLOOR = 4.5;

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ws, send };
}

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((page) => page.title === "Pericope");
if (!app) throw new Error("Pericope is not available on :9222");
const cdp = await connect(app.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 700));
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeout = 8_000) {
  await waitForState(evaluate, sleep, expression, timeout);
}

/**
 * `settle` is how long the page is given to stop moving before the shutter.
 *
 * The default is a quarter second, which is right for every state that stays
 * put. It is wrong for the two that do not: the dock reaching for a file it has
 * not got, and the sheet with both fetches in flight. Measured 2026-07-30, a
 * 240ms settle on the reaching capture produced a picture of the state AFTER
 * it — metadata had landed, the clock had filled in, and the play glyph was
 * caught mid-crossfade. A capture of the wrong state is worse than no capture,
 * because it is filed under the right name.
 */
async function screenshot(name, selector = null, { settle = 240 } = {}) {
  if (!CAPTURE_SCREENSHOTS) return;
  let clip;
  if (selector) {
    /* Brought into the viewport first. `captureBeyondViewport: false` means a
       clip outside the visible region is a rectangle of nothing — which is what
       the pre-press card capture had been for as long as it sat below the
       panel's fold: 5KB of empty canvas, committed as a picture of a card. */
    const moved = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      if (rect.top >= 40 && rect.bottom <= window.innerHeight - 8) return false;
      element.scrollIntoView({ block: "center", behavior: "instant" });
      return true;
    })()`);
    // Paid only when something actually moved: for a time-critical capture the
    // settle budget is the whole of the state being captured.
    if (moved) await sleep(260);
    /* The clip is in the page's UNZOOMED pixels, and this shell runs at a zoom.
       Measured 2026-07-30, the first time this tour was ever run with captures
       on against a real window: the window is 1512 device-independent pixels
       wide and the viewport is 1656 CSS pixels, a factor of 0.913 — so a clip
       written in CSS pixels landed ~57px right and ~40px down of the element it
       named and ran a tenth too wide. Every clipped capture this tour produced
       was a picture of the corner of its subject and the canvas beside it. The
       factor is read off the window rather than assumed: it is the reader's
       zoom, not ours. */
    clip = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const zoom = window.outerWidth / window.innerWidth;
      const rect = element.getBoundingClientRect();
      return {
        x: (rect.x - 26) * zoom,
        y: (rect.y - 26) * zoom,
        width: (rect.width + 52) * zoom,
        height: (rect.height + 52) * zoom,
        scale: 2,
      };
    })()`);
    if (!clip) throw new Error(`Cannot capture missing element: ${selector}`);
  }
  await cdp.send("Page.bringToFront");
  if (settle > 0) await sleep(settle);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  if (!response.result?.data) throw new Error(`Could not capture ${name}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

/**
 * A capture this run could not take must not be left behind by an earlier one.
 *
 * Two states here are caught rather than staged — the dock reaching for the
 * file, and the sheet with both fetches still in flight — and a run that misses
 * one leaves the previous run's picture on disk. That is precisely how this
 * surface's audit went wrong the first time: fifteen captures of a dock that no
 * longer existed, committed beside the code that replaced it. An empty slot is
 * a true statement; a stale picture is a false one.
 */
function forgetCapture(name) {
  if (!CAPTURE_SCREENSHOTS) return;
  rmSync(`${OUT_DIR}/${name}.png`, { force: true });
}

/* Scoped by the caller, always. `.transport-play` stopped naming one element on
   2026-07-30: the merged margin surface carries the same face on every row, so
   a bare selector picks whichever of thirty is first in the tree — and on this
   tour that is a margin row, whose press starts a different episode. Every
   consumer here names the surface it means. */
async function clickElement(selector) {
  // Scrolled into view before it is measured: a rect below the fold is still a
  // rect, and dispatching a click at it lands on whatever happens to be at
  // those coordinates instead of failing.
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element && element.getBoundingClientRect().bottom > window.innerHeight - 8) {
      element.scrollIntoView({ block: "center" });
    }
  })()`);
  await sleep(220);
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Clickable element not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(150);
}

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await waitFor(`Boolean(document.querySelector(".theme-picker-popover"))`);
  const changed = await evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Theme option not found: ${theme}`);
  await waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
  await sleep(260);
  await evaluate(`document.querySelectorAll(".toast-close").forEach((button) => button.click())`);
  await waitFor(`document.querySelectorAll(".toast").length === 0`);
}

/* The material is a class the shell puts on itself (app.tsx · shellClass) and
   its only control lives in Settings, three surfaces away from anything this
   tour touches. Applied here as the app applies it, to the element the app
   applies it to, and taken off again — which is a fair capture of the material
   and not a fair capture of the settings screen, and this tour is not about the
   settings screen. */
async function setMaterial(translucent) {
  await evaluate(`document.querySelector(".app-shell")?.classList.toggle("material-translucent", ${translucent})`);
  await sleep(280);
}

/**
 * Put the PAGE at a CSS width, whatever the window will and will not do.
 *
 * Two things sit between a number and the viewport, and the tour has to know
 * both: `minWidth: 900` in src/electron/main.ts is a floor on the window, and
 * the shell runs at a zoom (measured here rather than assumed) that makes the
 * viewport wider than the window by about a tenth. Between them, the narrowest
 * page this app can be RESIZED to is 986 CSS pixels — on the far side of its own
 * 979 breakpoint, so every rule in the compact band is unreachable by resizing.
 * The device-metrics override goes under both, and the zoom still applies on top
 * of it, which is why this converges instead of computing once.
 */
async function setViewportWidth(width) {
  let device = Math.round(width * (await evaluate(`window.outerWidth / window.innerWidth`)));
  for (let attempt = 0; attempt < 5; attempt++) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: device, height: 0, deviceScaleFactor: 0, mobile: false,
    });
    await sleep(680);
    const seen = await evaluate(`window.innerWidth`);
    if (Math.abs(seen - width) <= 2) return seen;
    device = Math.round(device * (width / seen));
  }
  return await evaluate(`window.innerWidth`);
}

async function setMargin(visible) {
  const current = await evaluate(`Boolean(document.querySelector(".living-margin"))`);
  if (current === visible) return;
  await evaluate(`document.querySelector("[data-instrument=margin]")?.click()`);
  await waitFor(`Boolean(document.querySelector(".living-margin")) === ${visible}`);
  await sleep(260);
}

async function setFocusMode(active) {
  const current = await evaluate(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true"`);
  if (current === active) return;
  await evaluate(`document.querySelector("[data-instrument=focus]")?.click()`);
  await waitFor(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === ${JSON.stringify(active ? "true" : "false")}`);
  await sleep(260);
}

async function navigatePassage(passage) {
  await evaluate(`document.querySelector(".command-palette-trigger")?.click()`);
  await waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
  const entered = await evaluate(`(() => {
    const input = document.querySelector(".command-palette-input-row input");
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(passage)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  if (!entered) throw new Error("Command palette query is unavailable");
  await waitFor(`[...document.querySelectorAll(".command-palette-result")].some((row) => row.querySelector(".command-result-meta")?.textContent === "Exact reference")`);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll(".command-palette-result")].find((candidate) =>
      candidate.querySelector(".command-result-meta")?.textContent === "Exact reference"
    );
    row?.click();
  })()`);
  await waitFor(`(() => {
    const title = document.querySelector(".chapter-title");
    return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
      .filter(Boolean).join(" ") === ${JSON.stringify(passage)};
  })()`);
  await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
  await sleep(320);
}

/** Everything the dock is currently saying, read from the dock itself. */
const DOCK_TRUTH = `(() => {
  const dock = document.querySelector(".podcast-dock");
  const audio = document.querySelector("audio");
  if (!dock) return { present: false, audioSrc: audio?.getAttribute("src") ?? null, audioTime: audio?.currentTime ?? null };
  return {
    present: true,
    status: dock.getAttribute("data-status"),
    source: dock.getAttribute("data-source"),
    layer: dock.getAttribute("data-floating-layer"),
    // Restated 2026-07-30: the name moved inside the plate, which is the one
    // place a publisher's colour survives. It is still the name in the
    // accessibility tree for a marked source — the mark rule indents the
    // glyphs, not the text.
    publisher: dock.querySelector(".podcast-mast-name")?.textContent?.trim(),
    passage: dock.querySelector(".podcast-mast-passage")?.textContent?.trim() ?? null,
    passageSays: dock.querySelector(".podcast-mast-passage")?.getAttribute("aria-label") ?? null,
    /* Restated 2026-07-30: a launch from a MOMENT opens the sheet, so the
       corner stops repeating a title the sheet is already showing. The
       episode is named in one of the two places, never neither. */
    expanded: dock.getAttribute("data-expanded"),
    title: (dock.querySelector(".podcast-dock-title") ?? dock.querySelector(".podcast-episode-title"))?.textContent?.trim(),
    now: dock.querySelector(".podcast-dock-now")?.textContent?.trim() ?? null,
    clock: [...dock.querySelectorAll(".podcast-dock-clock span")].map((node) => node.textContent?.trim()),
    played: getComputedStyle(dock).getPropertyValue("--podcast-played").trim(),
    audioTime: audio?.currentTime ?? null,
    audioDuration: audio?.duration ?? null,
    audioPaused: audio?.paused ?? null,
    audioPreload: audio?.getAttribute("preload") ?? null,
    audioSrc: audio?.getAttribute("src") ?? null,
    elements: document.querySelectorAll("audio").length,
    markingDock: document.querySelector(".marking-dock-host")?.getAttribute("data-dock-layout") ?? null,
    marginOpen: Boolean(document.querySelector(".living-margin")),
    // Read rather than remembered. The frame's inset was re-canonned from 24 to
    // 10 in e8e2ee9 and this tour went on asserting 24 for months, which is a
    // gate that could not pass being mistaken for a gate nobody had run.
    pageInset: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-inset")) || 0),
    // What the dock RESERVES, which since 2026-07-30 is its collapsed height
    // rather than its live one — the sheet is an overlay, so opening it must
    // leave this number, the panel and the toast lane exactly where they were.
    reserved: Math.round(parseFloat(getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--podcast-dock-h")) || 0),
    // What the panel gives up to the player, and what is actually left between
    // them. The reservation moved from padding to margin when the panel stopped
    // growing a floor and started ENDING above the player.
    marginFloor: (() => {
      const margin = document.querySelector(".living-margin");
      return margin ? Math.round(parseFloat(getComputedStyle(margin).marginBottom)) : null;
    })(),
    marginClearance: (() => {
      const margin = document.querySelector(".living-margin");
      const dock = document.querySelector(".podcast-dock");
      if (!margin || !dock) return null;
      return Math.round(dock.getBoundingClientRect().top - margin.getBoundingClientRect().bottom);
    })(),
    toastLane: (() => {
      const toasts = document.querySelector(".toast-container");
      return toasts ? Math.round(parseFloat(getComputedStyle(toasts).bottom)) : null;
    })(),
    // The masthead's own top edge. A dock with no max-height could grow past
    // the top of a short window, and the dock clips what it cannot hold — so
    // the masthead, which is where the only control that stops the episode
    // lives, would be the first thing to go.
    mastTop: Math.round(dock.querySelector(".podcast-mast")?.getBoundingClientRect().top ?? 0),
    rect: (() => { const r = dock.getBoundingClientRect(); return { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; })(),
  };
})()`;

/**
 * Whose surface this is, measured rather than asserted.
 *
 * Two questions, one probe, run over every source against the atmosphere the
 * app happens to be in:
 *
 *   1. Is the dock's ground the APP's paper — --bg-float — in every case, and
 *      never the publisher's colour? A single `background: var(--resource-source)`
 *      returning to this rule is the regression this whole build exists to
 *      prevent, and it would be invisible in any capture of one source.
 *   2. Does the one brand colour that still leaves the brand's surface hold
 *      against that paper? The fit is a lightness clamp in CSS; nothing but
 *      this reads the number it actually produces.
 *
 * Colours are normalised through a canvas rather than parsed. A computed
 * `oklch()` value serialises as `oklch(...)`, a `color-mix(in srgb, …)` as
 * `rgb(...)`, and a hex as `rgb(...)` — one string parser for three formats is
 * three chances to be wrong about a number the whole gate depends on. Canvas
 * takes any CSS colour and gives back sRGB bytes.
 */
const OWNERSHIP = `((sources) => {
  const dock = document.querySelector(".podcast-dock");
  if (!dock) return null;
  const was = dock.getAttribute("data-source");
  const canvas = document.createElement("canvas");
  const ink = canvas.getContext("2d");
  const bytes = (value) => {
    ink.clearRect(0, 0, 1, 1);
    ink.fillStyle = "#000";
    ink.fillStyle = value;
    ink.fillRect(0, 0, 1, 1);
    return [...ink.getImageData(0, 0, 1, 1).data].slice(0, 3).map((c) => c / 255);
  };
  const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.pointerEvents = "none";
  dock.append(probe);
  const paper = bytes(getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--bg-float").trim());
  const rows = [];
  for (const source of sources) {
    dock.setAttribute("data-source", source);
    // color-mix coerces whatever the clamp produced into sRGB, which is the
    // space every one of these numbers is about.
    probe.style.backgroundColor = "color-mix(in srgb, var(--player-accent) 100%, transparent)";
    const accent = bytes(getComputedStyle(probe).backgroundColor);
    probe.style.backgroundColor = "var(--player-accent-ink)";
    const accentInk = bytes(getComputedStyle(probe).backgroundColor);
    probe.style.backgroundColor = "var(--resource-source)";
    const brand = bytes(getComputedStyle(probe).backgroundColor);
    const ground = bytes(getComputedStyle(dock).backgroundColor);
    const plate = dock.querySelector(".podcast-mast-plate");
    /* The plate's colour is the one thing on this surface that TRANSITIONS with
       the episode — a new publisher's ground arriving in one frame under a mark
       being replaced is the cut this build removed — so a read taken in the
       same tick as the attribute change returns the old colour, part way
       through. Finished rather than waited out: the value under test is where
       the transition lands, not how long it takes. */
    for (const animation of plate?.getAnimations() ?? []) animation.finish();
    rows.push({
      source,
      // Rounded to a byte: the dock's ground and the app's floating paper have
      // to be the same paint, and a sub-byte difference is a rounding artefact
      // rather than a decision.
      groundIsPaper: ground.every((c, at) => Math.abs(c - paper[at]) < 0.004),
      groundIsBrand: ground.every((c, at) => Math.abs(c - brand[at]) < 0.004),
      accentOnPaper: Number(contrast(accent, ground).toFixed(2)),
      inkOnAccent: Number(contrast(accentInk, accent).toFixed(2)),
      // The plate is the one place the brand's own colour survives, and it has
      // to actually be the brand's colour or the signature is gone.
      plateIsBrand: plate ? bytes(getComputedStyle(plate).backgroundColor).every((c, at) => Math.abs(c - brand[at]) < 0.004) : null,
      plateShare: plate
        ? Number((plate.getBoundingClientRect().width / dock.querySelector(".podcast-mast").getBoundingClientRect().width).toFixed(3))
        : null,
    });
  }
  probe.remove();
  if (was === null) dock.removeAttribute("data-source"); else dock.setAttribute("data-source", was);
  return rows;
})(${JSON.stringify(SOURCES)})`;

await cdp.send("Network.enable");
await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`);
await sleep(560);

const originalBounds = await evaluate(`({
  left: window.screenX,
  top: window.screenY,
  width: window.outerWidth,
  height: window.outerHeight,
})`);
const original = await evaluate(`(() => ({
  theme: document.querySelector(".app-shell")?.dataset.theme ?? "light",
  margin: Boolean(document.querySelector(".living-margin")),
  focus: document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true",
  material: document.querySelector(".app-shell")?.classList.contains("material-translucent") ?? false,
  passage: (() => {
    const title = document.querySelector(".chapter-title");
    return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
      .filter(Boolean).join(" ") || "Genesis 1";
  })(),
}))()`);

if (await evaluate(`window.innerWidth < 1_500`)) {
  await evaluate(`window.resizeTo(1512, ${JSON.stringify(Math.max(880, originalBounds.height))})`);
  await sleep(680);
}

await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-content"))`);
await setFocusMode(false);
await setMaterial(false);
await setMargin(true);
await setTheme("light");
await navigatePassage(PASSAGE);

/* The ring, before anything else. `--focus-ring` was declared nowhere in the
   bundle and appeared once as a consumer, so the transcript's ring fell through
   to `currentColor` and worked by accident for as long as the text happened to
   be visible. It is a token now, and this is the cheapest possible proof that
   it resolves to a colour rather than to nothing. */
const ring = await evaluate(`(() => {
  const shell = getComputedStyle(document.querySelector(".app-shell"));
  return {
    ring: shell.getPropertyValue("--focus-ring").trim(),
    width: shell.getPropertyValue("--focus-ring-width").trim(),
    seal: shell.getPropertyValue("--accent-seal").trim(),
  };
})()`);
assert.notEqual(ring.ring, "", "--focus-ring is still a phantom");
assert.equal(ring.width, "2px");
console.log("focus ring", ring);

// Before the press. The element exists — it has to, or there would be nothing
// to press play on — and it holds no source, which is the whole of what
// `preload="none"` buys: rendering a card tells the publisher nothing.
const atRest = await evaluate(DOCK_TRUTH);
assert.equal(atRest.present, false, "the dock draws itself only once something is playing");
assert.equal(atRest.audioSrc, null, "audio must not be fetched before a reader presses play");
console.log("at rest", atRest);

await waitFor(`Boolean(document.querySelector(".taught-here"))`, 20_000);

/* ── One surface for this chapter's episode audio ──────────────────────────
   Added 2026-07-30, with the build that merged them. Two blocks used to draw
   the same episodes — 25 of 28 on the reference chapter — with two mastheads,
   two orders, two brand policies and an identity key that was the same string
   in both, which is why pressing a moment for an already-running episode had
   to be special-cased in the machine. This is the gate that keeps them one.

   Every band is opened first: the surface rests shut on purpose, and what is
   being measured is the row grammar rather than the resting state. */
await evaluate(`document.querySelectorAll(".taught-here-toggle").forEach((toggle) => {
  if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
})`);
await waitFor(`document.querySelectorAll(".taught-here-row").length > 0`);
await sleep(320);

const merged = await evaluate(`(() => {
  const surfaces = document.querySelectorAll(".taught-here");
  const rows = [...document.querySelectorAll(".taught-here-row")];
  return {
    surfaces: surfaces.length,
    rows: rows.length,
    // The duplication, at the level it actually caused a defect: the identity
    // key. Two surfaces keying the same episode is what made a press pause it.
    keys: rows.length,
    // Nothing in the publisher index starts audio any more. Every row that had
    // an audioUrl moved onto the surface above it.
    playInIndex: document.querySelectorAll(".trusted-resource-play").length,
    // The relation, in reader's words, on every row that states one. A schema
    // token or an empty span reaching this list is the regression.
    said: [...new Set(rows.map((row) => row.querySelector(".taught-here-said")?.textContent?.trim() ?? ""))],
    // The plate is the ONE publisher crossing on the row, and only where a
    // mark is approved: everyone else takes their name in type.
    plated: rows.filter((row) => {
      const plate = row.querySelector(".taught-here-plate");
      const mark = row.querySelector(".taught-here-mark");
      return mark ? getComputedStyle(mark).backgroundImage !== "none" : false;
    }).length,
    footing: document.querySelector(".taught-here-footing")?.textContent?.trim() ?? null,
    walk: document.querySelector(".taught-here-walk")?.getAttribute("aria-label") ?? null,
    // Every row states its extent and, where the transcript found it, a second.
    grammar: rows.every((row) => row.querySelector(".taught-here-episode")
      && row.querySelector(".taught-here-extent")
      && row.querySelector(".taught-here-ref")
      && row.querySelector(".taught-here-said")
      && row.querySelector(".transport-play")),
  };
})()`);
assert.equal(merged.surfaces, 1, "a chapter has one surface for its episode audio");
assert.ok(merged.rows > 0, "the merged surface drew no rows");
assert.equal(merged.playInIndex, 0,
  "the publisher index is starting audio again — that is the duplication coming back");
assert.equal(merged.grammar, true, "a row is missing part of the one row grammar");
const TOKENS = ["crossref", "mention", "allusion", "subject", ""];
for (const said of merged.said) {
  assert.ok(!TOKENS.includes(said),
    `a relation reached the margin as a schema token or an empty span: ${JSON.stringify(said)}`);
}
assert.match(merged.footing ?? "", /Machine-read from published audio/,
  "the two footings are not disclosed on the surface that shows them");
assert.match(merged.walk ?? "", /^Listen through .+ — \d+ treatments, longest first, .+ in all$/,
  "the walk must declare its whole extent before it is pressed");
console.log("merged surface", merged);

await sleep(200);
await screenshot("paper-margin-merged", ".taught-here");

/* One transport language, and this surface was the fourth that started audio
   with no transport glyph on it at all. The row's own press IS the transport,
   so it carries the FACE rather than a second button inside it — a 22px circle
   inside a 300px row would be a smaller target than the row containing it, and
   two controls for one offer is two tab stops to walk past. */
const family = await evaluate(`(() => {
  const row = [...document.querySelectorAll(".taught-here-row")]
    .find((candidate) => candidate.querySelector('.taught-here-plate[data-source="naked-bible"]'));
  const mark = row?.querySelector(".taught-here-play");
  const style = mark ? getComputedStyle(mark) : null;
  return {
    row: Boolean(row),
    isFamily: mark?.classList.contains("transport-play") ?? null,
    size: style ? Math.round(parseFloat(style.width)) : null,
    filled: style?.backgroundColor ?? null,
    round: style?.borderRadius ?? null,
    glyphs: mark?.querySelectorAll(".transport-glyph").length ?? null,
    grid: [...(mark?.querySelectorAll("svg") ?? [])].map((svg) => svg.getAttribute("viewBox")),
    // One tab stop for the offer, on the row itself.
    stops: row ? row.querySelectorAll("button").length : null,
  };
})()`);
assert.equal(family.row, true, "no Naked Bible row on the merged surface to press");
assert.equal(family.isFamily, true, "the margin row's play is not in the transport family");
assert.equal(family.size, 22, "the family at the margin row's own scale");
assert.equal(family.glyphs, 2, "play and pause are both in the tree so one can cross into the other");
assert.deepEqual([...new Set(family.grid)], ["0 0 24 24"], "one icon grid");
assert.notEqual(family.filled, "rgba(0, 0, 0, 0)", "the family is filled, on every surface");
assert.equal(family.stops, 0, "the row is the control; a second button inside it is a second tab stop");
console.log("transport family", family);

/* Cold, and only for the press. Chromium's disk cache turns the second run of
   this tour into a local read, which removes the only window in which the dock
   is genuinely REACHING for anything — the state becomes uncatchable and its
   capture goes stale, which is the exact failure this build exists to end.
   Reaching is a fact about someone else's server and has to be measured against
   one. Put back the moment the file is playing: a media element streams for
   forty minutes after this, and an uncached range request every few seconds is
   a stall the persistence assertions below correctly read as a stopped
   episode. */
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
/* The LONGEST Naked Bible treatment on this chapter, marked by name. The bare
   `:has(...)` selector took whichever came first, which on this chapter is a
   forty-eight-second mention forty-two minutes into a forty-four minute file —
   a launch with no room after it for any of the seek assertions below, and not
   what a reader arriving at a chapter is being offered first. */
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.taught-here-row')]
    .filter((row) => row.querySelector('.taught-here-plate[data-source="naked-bible"]'))
    .filter((row) => row.querySelector(".taught-here-said")?.textContent?.trim() === "worked through");
  rows[0]?.setAttribute("data-qa-target", "press");
  return rows.length;
})()`);
await clickElement('[data-qa-target="press"]');
await waitFor(`Boolean(document.querySelector(".podcast-dock"))`);

/* Reaching, which is a real state with a real network behind it and used to be
   drawn as a lie: `paused` excluded "reaching", so the loudest control on the
   surface drew PAUSE — claiming the file was running — over a clock reading
   0:00 / —:—. Caught here rather than staged, because the publisher's server
   genuinely takes seconds. */
const reaching = await (async () => {
  for (let look = 0; look < 60; look++) {
    const seen = await evaluate(`(() => {
      const dock = document.querySelector(".podcast-dock");
      if (dock?.getAttribute("data-status") !== "reaching") return null;
      if (!dock.querySelector(".podcast-dock-reaching")) return null;
      return {
        glyph: dock.querySelector(".transport-play")?.getAttribute("data-glyph") ?? null,
        says: dock.querySelector(".podcast-dock-reaching")?.textContent?.trim() ?? null,
        clock: Boolean(dock.querySelector(".podcast-dock-clock")),
        travelling: Boolean(dock.querySelector(".podcast-rail-reaching")),
        rule: Boolean(dock.querySelector(".podcast-rail-played")),
      };
    })()`);
    if (seen) return seen;
    if (await evaluate(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "playing"`)) return null;
    await sleep(90);
  }
  return null;
})();
if (reaching) {
  assert.equal(reaching.glyph, "play", "reaching is not playing, and must not draw a pause");
  assert.equal(reaching.clock, false, "reaching must not draw a clock counting a file it has not got");
  assert.equal(reaching.travelling, true, "the rail is the loading device");
  assert.equal(reaching.rule, false, "there is no played part of a file that has not arrived");
  assert.match(reaching.says, /^Reaching .+…$/);
  await screenshot("paper-dock-reaching", ".podcast-dock", { settle: 0 });
  console.log("reaching", reaching);
} else {
  forgetCapture("paper-dock-reaching");
  console.log("reaching: the file arrived before the state could be caught (capture withdrawn)");
}

// The publisher's server, over the network, for a real 40-odd-minute file.
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "playing"`, 30_000);
await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
await waitFor(`(document.querySelector("audio")?.currentTime ?? 0) > 2`, 20_000);

const playing = await evaluate(DOCK_TRUTH);
assert.equal(playing.status, "playing");
assert.equal(playing.source, "naked-bible");
assert.equal(playing.layer, "player");
assert.equal(playing.publisher, "Naked Bible Podcast");
assert.match(playing.title ?? "", /^Naked Bible \d+:/);
/* A moment launch opens the sheet. Build 1 deferred this and the consequence
   was that an episode opened at "eleven minutes on 1 Samuel 30:1-10" landed
   collapsed, hiding the transcript and the passage list that justify the
   jump behind a control nobody had a reason to press. */
assert.equal(playing.expanded, "true", "a launch from a moment must open the sheet");
/* Shut again for the geometry below, which is about the COLLAPSED dock — the
   thing the study panel and the toast lane reserve. The sheet is an overlay
   above that reservation and is measured on its own terms further down. */
await clickElement('.podcast-mast-icon[aria-expanded="true"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "false"`);
await parkPointer();
Object.assign(playing, await evaluate(DOCK_TRUTH));
/* Restated 2026-07-30. The chip used to be asserted equal to the chapter the
   READER was on, which is precisely the bug: all three margin call sites handed
   over `bref:v1/${book}.${chapter}.1` under an accessible name claiming it was
   "the passage this episode works through". It now names what is actually
   playing — the moment's own verses — and says which kind of claim that is. */
assert.match(playing.passage ?? "", new RegExp(`^${PASSAGE}(:\\d+(–\\d+)?)?$`),
  `the dock's chip names ${playing.passage}, which is not this episode's moment`);
assert.match(playing.passageSays ?? "", /— the passage playing here$/,
  "the chip is claiming a title-level filing over a moment launch");
assert.equal(playing.audioPreload, "none");
assert.equal(playing.audioPaused, false);
assert.equal(playing.elements, 1, "one element for the whole app");
assert.ok(playing.audioDuration > 600, `expected a real episode, got ${playing.audioDuration}s`);
assert.match(playing.clock?.[0] ?? "", /^\d+:\d\d$/);
assert.match(playing.clock?.[1] ?? "", /^−\d+:\d\d/);
// Bottom-right, on the frame's own inset — the same edge and the same pin as
// the study panel it is inscribed in.
//
// Restated 2026-07-30. This asserted a right edge of 24 and picked a bottom
// lane from the marking Dock's layout, and both were wrong at once: --page-inset
// has been 10 since e8e2ee9, and the marking Dock's lanes are guarded by
// `:not(:has(.living-margin))` — with the study panel open, which is the only
// state this tour reaches, the player never steps over the Dock at all,
// because the two are in different columns. So the lane is asserted where it
// is true, and the marking Dock's own lanes are named as untested rather than
// asserted from a state that cannot produce them.
assert.equal(playing.marginOpen, true, "this assertion is about the panel-open lane");
assert.equal(playing.pageInset, 10, "the frame's inset moved; the dock's pin follows it");
assert.equal(playing.rect.right, playing.pageInset, JSON.stringify(playing.rect));
assert.equal(playing.rect.bottom, playing.pageInset, JSON.stringify(playing.rect));
// And the two surfaces the player displaces make room rather than being covered.
assert.ok(playing.toastLane >= playing.rect.bottom + playing.rect.height,
  `toasts would land on the player: ${playing.toastLane} vs ${playing.rect.bottom + playing.rect.height}`);
/* Restated 2026-07-30: the panel does not reserve a floor, it STOPS. So what
   is asserted is the gap that is actually left — the panel's bottom edge above
   the player's top edge, one frame gutter clear and no more. The tolerance is
   the ResizeObserver's: --podcast-dock-h is published on a measured change, so
   it trails the dock's live height by a pixel or two after the mast reflows. */
assert.ok(playing.marginClearance >= 0,
  `the panel overlaps the player by ${-playing.marginClearance}px`);
assert.ok(playing.marginClearance <= 24,
  `the panel stops ${playing.marginClearance}px above the player, which is not a seam`);
assert.ok(playing.marginFloor >= playing.rect.height - 4,
  `the panel's reservation is a guess rather than the dock's own height: ${playing.marginFloor} vs ${playing.rect.height}`);
/* The system's Now Playing panel, and the one thing that must never appear on
   it: a URL on a publisher's host. The artwork is the plate, painted from a
   file already on this machine — see plateArtwork. */
const system = await evaluate(`(() => {
  const meta = navigator.mediaSession?.metadata;
  const art = meta?.artwork?.[0] ?? null;
  return {
    title: meta?.title ?? null,
    artist: meta?.artist ?? null,
    art: art ? { scheme: art.src.slice(0, art.src.indexOf(":")), sizes: art.sizes, type: art.type } : null,
  };
})()`);
assert.match(system.title ?? "", /^Naked Bible \d+:/, "the system panel does not name the episode");
assert.equal(system.artist, "Naked Bible Podcast");
if (system.art) {
  assert.equal(system.art.scheme, "data",
    "the system artwork points at a host; nothing may be fetched to draw it");
  assert.equal(system.art.sizes, "512x512");
}
console.log("system", system);
console.log("playing", playing);

/* ── Whose surface this is ─────────────────────────────────────────────────
   Twelve sources against every atmosphere, read out of the running engine.
   Forty-eight conditions that used to be forty-four unverifiable ones. */
for (const theme of ATMOSPHERES) {
  await setTheme(theme);
  const rows = await evaluate(OWNERSHIP);
  assert.ok(rows, "the ownership probe found no dock");
  for (const row of rows) {
    assert.equal(row.groundIsPaper, true,
      `${theme}/${row.source}: the dock's ground is not the app's floating paper`);
    assert.equal(row.groundIsBrand && row.source !== "qa-unregistered-source", false,
      `${theme}/${row.source}: the publisher is painting the ground again`);
    assert.ok(row.accentOnPaper >= ACCENT_FLOOR,
      `${theme}/${row.source}: the fitted accent is ${row.accentOnPaper}:1 on the app's paper`);
    assert.ok(row.inkOnAccent >= ACCENT_FLOOR,
      `${theme}/${row.source}: what sits on the accent is ${row.inkOnAccent}:1 against it`);
    assert.equal(row.plateIsBrand, true,
      `${theme}/${row.source}: the plate is not the publisher's own colour`);
    assert.ok(row.plateShare <= 0.46,
      `${theme}/${row.source}: the plate takes ${(row.plateShare * 100).toFixed(0)}% of the mast`);
  }
  const worst = rows.reduce((low, row) => Math.min(low, row.accentOnPaper), Infinity);
  console.log(`ownership ${theme}: ${rows.length} sources, worst accent ${worst}:1`);
}
await setTheme("light");

/* The pointer is still where it pressed play, which is under the dock — so
   every capture below would be a hover capture unless it is moved. The scrub's
   head is drawn on hover and nowhere else, and both states are worth seeing. */
async function parkPointer() {
  const point = await evaluate(`(() => {
    const rect = document.querySelector(".scripture-content")?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width * 0.5, y: rect.top + 120 } : null;
  })()`);
  if (!point) return;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  // Long enough for a tooltip left behind by the last click to expire, and not
  // gated on its absence: a tour must not fail because a hint outstayed a hover.
  await sleep(700);
}

async function hoverDock() {
  const point = await evaluate(`(() => {
    const rect = document.querySelector(".podcast-dock")?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width * 0.6, y: rect.top + rect.height * 0.5 } : null;
  })()`);
  if (!point) return;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await sleep(220);
}

await parkPointer();
await screenshot("paper-dock", ".podcast-dock");
await screenshot("paper-dock-in-place");
await hoverDock();
await screenshot("paper-dock-hover", ".podcast-dock");
await parkPointer();

// Persistence, one surface at a time. Each of these used to stop the episode,
// because each of them unmounts the card the element used to live in.
const marks = [];
async function stillPlaying(what) {
  const truth = await evaluate(DOCK_TRUTH);
  assert.equal(truth.present, true, `${what} took the dock away`);
  assert.equal(truth.audioPaused, false, `${what} stopped the episode`);
  assert.ok(truth.audioTime > (marks.at(-1) ?? 0), `${what} rewound the episode`);
  marks.push(truth.audioTime);
  console.log("survived", what, `${truth.audioTime.toFixed(1)}s`);
  return truth;
}

await navigatePassage(ELSEWHERE);

/* ── Density is a CONTROL, not a sentence ─────────────────────────────────
   Measured on a dense chapter rather than the reference one: this is the
   whole point of the band, and the reference chapter has eleven entries.
   Genesis 1 holds 922 moments, and this drawer used to end at row 25 with an
   inert <li> reading "897 more, shortest last" — a sentence shaped like a
   disclosure in front of 97% of the answer, beside a stylesheet that still
   carried a button's worth of rules for a control somebody had removed.

   Two presses, because there are two intentions: another page, or all of it.
   Both are asserted to actually reveal rows, which the sentence never did. */
await waitFor(`document.querySelectorAll(".taught-here-group").length > 0`, 20_000);
const density = await evaluate(`(() => {
  const bands = [...document.querySelectorAll(".taught-here-group")];
  const band = bands.sort((a, b) =>
    Number(b.querySelector(".taught-here-count").textContent)
    - Number(a.querySelector(".taught-here-count").textContent))[0];
  if (!band) return null;
  const held = Number(band.querySelector(".taught-here-count").textContent);
  /* Every OTHER band shut first, so the probes below can name "the open one"
     and mean this one. */
  for (const other of bands) {
    const toggle = other.querySelector(".taught-here-toggle");
    const wanted = other === band;
    if ((toggle.getAttribute("aria-expanded") === "true") !== wanted) toggle.click();
  }
  return { held };
})()`);
if (density && density.held > 25) {
  await waitFor(`document.querySelectorAll(".taught-here-row").length > 0`);
  const paged = await evaluate(`(() => {
    const band = document.querySelector('.taught-here-group[data-open="true"]');
    const first = band.querySelectorAll(".taught-here-row").length;
    const more = band.querySelector(".taught-here-more");
    const label = more?.textContent?.trim() ?? null;
    const tag = more?.tagName ?? null;
    const all = band.querySelector(".taught-here-more.is-all");
    more?.click();
    return { first, label, tag, hasAll: Boolean(all) };
  })()`);
  await sleep(200);
  const after = await evaluate(`document.querySelector('.taught-here-group[data-open="true"]').querySelectorAll(".taught-here-row").length`);
  assert.equal(paged.tag, "BUTTON", "the density control is inert text again");
  assert.match(paged.label ?? "", /shortest last/, "a partial list must say what it is holding back");
  assert.ok(after > paged.first, `"more" revealed nothing: ${paged.first} → ${after}`);
  if (paged.hasAll) {
    await evaluate(`document.querySelector(".taught-here-more.is-all")?.click()`);
    await sleep(240);
    const whole = await evaluate(`document.querySelector('.taught-here-group[data-open="true"]').querySelectorAll(".taught-here-row").length`);
    assert.equal(whole, density.held, `"all" showed ${whole} of ${density.held}`);
    console.log("density", { ...paged, after, whole });
  } else {
    console.log("density", { ...paged, after });
  }
  await evaluate(`document.querySelector('.taught-here-group[data-open="true"] .taught-here-toggle')?.click()`);
} else {
  console.log(`density: the densest band here holds ${density?.held ?? 0} (control not exercised)`);
}
await stillPlaying("a passage change");
/* The dock still names the MOMENT's own passage, not the chapter now on
   screen — and the reader is on Acts 19, so the two are unmistakably
   different. Restated 2026-07-30: this asserted equality with the reference
   chapter, which is exactly the untruth the chip used to tell. */
assert.match((await evaluate(DOCK_TRUTH)).passage ?? "", new RegExp(`^${PASSAGE}(:\\d+(–\\d+)?)?$`));

await evaluate(`document.querySelector(".living-margin").scrollTop = 400`);
await sleep(400);
await stillPlaying("scrolling the panel");

await setMargin(false);
await stillPlaying("closing the panel");
await screenshot("paper-dock-margin-closed");
await setMargin(true);

await evaluate(`document.querySelector(".command-palette-trigger")?.click()`);
await waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
await stillPlaying("the command palette");
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
await waitFor(`!document.querySelector(".command-palette-panel")`);

await evaluate(`document.querySelector('[aria-label="Notes (3)"]')?.click()`);
await waitFor(`!document.querySelector(".scripture-content")`);
await stillPlaying("leaving Read for Notes");
await screenshot("paper-dock-notes-surface");
await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-content"))`);

/* ── The disc ──────────────────────────────────────────────────────────────
   Looked at for the first time. The minimised state is excluded by
   `:not(:has(:focus-visible))`, and every previous run of this tour reached it
   with focus still inside the dock from the click before — so the one capture
   of the disc in the audit is a picture of the full-size card, and nobody had
   ever seen the ~190 lines that draw it. Blur first, then park the pointer well
   clear of the aim cone, then assert the size before capturing it. */
await setFocusMode(true);
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await parkPointer();
await stillPlaying("focus mode");
const disc = await evaluate(`(() => {
  const dock = document.querySelector(".podcast-dock");
  const rect = dock.getBoundingClientRect();
  const style = getComputedStyle(dock);
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    round: style.borderRadius,
    shadow: style.boxShadow,
    stop: Boolean(dock.querySelector('[aria-label^="Stop"]')),
    play: Boolean(dock.querySelector(".transport-play")),
  };
})()`);
assert.equal(disc.width, 54, `the disc never minimised: ${JSON.stringify(disc)}`);
assert.equal(disc.height, 54, JSON.stringify(disc));
assert.notEqual(disc.shadow, "none", "the minimised player is the app's only floating surface with no shadow");
assert.equal(disc.play, true, "the disc keeps the one control it exists for");
await screenshot("paper-dock-focus-mode");
await screenshot("paper-dock-disc", ".podcast-dock");
console.log("disc", disc);
await setFocusMode(false);

// The transport's own controls, against the file rather than against the UI.
const beforeSkip = await evaluate(`document.querySelector("audio").currentTime`);
await clickElement('[aria-label="Forward 30 seconds"]');
await sleep(400);
const afterSkip = await evaluate(`document.querySelector("audio").currentTime`);
assert.ok(afterSkip - beforeSkip > 24, `forward 30 moved ${afterSkip - beforeSkip}s`);
await clickElement('[aria-label="Back 15 seconds"]');
await sleep(400);
const afterBack = await evaluate(`document.querySelector("audio").currentTime`);
assert.ok(afterSkip - afterBack > 9, `back 15 moved ${afterSkip - afterBack}s`);
console.log("skip", { beforeSkip, afterSkip, afterBack });

// The scrub commits on release, not on every input, so a keyboard step is one
// seek and a drag is one seek — never sixty range requests on someone's server.
await evaluate(`document.querySelector(".podcast-scrub").focus()`);
const beforeSeek = await evaluate(`document.querySelector("audio").currentTime`);
for (let step = 0; step < 6; step++) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
}
await sleep(500);
const afterSeek = await evaluate(`document.querySelector("audio").currentTime`);
assert.ok(afterSeek > beforeSeek, `the scrub did not move the file: ${beforeSeek} → ${afterSeek}`);
await screenshot("paper-dock-scrub-focus", ".podcast-dock");

// F6 reaches it without a binding of its own.
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.focus()`);
for (let press = 0; press < 5; press++) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "F6", code: "F6", windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "F6", code: "F6", windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 });
  await sleep(140);
  if (await evaluate(`Boolean(document.activeElement?.closest(".podcast-dock"))`)) break;
}
// Restated 2026-07-30: the class is the transport family's rather than this
// surface's, so what is asserted is membership rather than a string.
assert.equal(await evaluate(`document.activeElement?.classList.contains("transport-play")`), true,
  "F6 never reached the dock's play");
console.log("F6 reaches the dock");

/* ── The sheet, which nothing above this line has ever opened ───────────────
   What is proved here is the machine AND the look. The machine: a hit is
   pressed, and the press has to do the WHOLE errand — move the audio, leave the
   filter, and put the transcript back under the voice. The look: the sheet is a
   PLACE, so opening it must move nothing outside itself. */
const beforeSheet = await evaluate(DOCK_TRUTH);
await clickElement('.podcast-mast-icon[aria-expanded="false"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "true"`);

/* Caught rather than staged. Two fetches are in flight the moment the sheet
   opens, and while they are the sheet has to account for itself — both facts
   were computed with care (`undefined` while unasked, `null` once we know there
   is none) and then drawn as the same nothing. The transcript is a synchronous
   read of up to 1.26MB on the main process, so the window is real but short;
   the capture is best-effort and the exhaustiveness assertion below is not. */
const waiting = await evaluate(`Boolean(document.querySelector(".podcast-sheet-reaching"))`);
if (waiting) {
  await screenshot("paper-dock-sheet-reaching", ".podcast-dock", { settle: 0 });
  console.log("sheet: caught the reaching state");
} else {
  forgetCapture("paper-dock-sheet-reaching");
  console.log("sheet: the transcript was already on disk and in hand (capture withdrawn)");
}

// Whatever the sheet settles on, so a missing transcript is reported as a
// missing transcript rather than as a timeout on a selector.
await waitFor(`Boolean(
  document.querySelector(".podcast-transcript-line")
  || document.querySelector(".podcast-refs-view")
  || document.querySelector(".podcast-sheet-empty")
)`, 20_000);
const settled = await evaluate(`(document.querySelector(".podcast-sheet-empty") ?? document.querySelector(".podcast-views"))?.textContent?.trim() ?? "nothing"`);

/* An open sheet is never allowed to be a title and a length and nothing else,
   which is what it was for an episode with references but no transcript, and
   for every episode for as long as its two fetches were in flight. */
const accountedFor = await evaluate(`(() => {
  const sheet = document.querySelector(".podcast-sheet-inner");
  return Boolean(
    sheet?.querySelector(".podcast-transcript-block")
    || sheet?.querySelector(".podcast-refs-view")
    || sheet?.querySelector(".podcast-sheet-reaching")
    || sheet?.querySelector(".podcast-sheet-empty")
  );
})()`);
assert.equal(accountedFor, true, "the open sheet accounts for itself in none of its four forms");

/* The sheet is a place: it opens over the study panel, not through it. The
   reservation is made once, against the collapsed dock, so none of these three
   numbers may move when several hundred pixels of transcript appear. */
const openSheet = await evaluate(DOCK_TRUTH);
assert.equal(openSheet.reserved, beforeSheet.reserved,
  `opening the sheet changed the dock's reservation: ${beforeSheet.reserved} → ${openSheet.reserved}`);
assert.equal(openSheet.marginFloor, beforeSheet.marginFloor,
  `opening the sheet re-laid out the study panel: ${beforeSheet.marginFloor} → ${openSheet.marginFloor}`);
assert.equal(openSheet.toastLane, beforeSheet.toastLane,
  `opening the sheet relocated the toast lane: ${beforeSheet.toastLane} → ${openSheet.toastLane}`);
assert.ok(openSheet.rect.height > beforeSheet.rect.height + 100, "the sheet did not actually open");
assert.ok(openSheet.mastTop >= 0,
  `the sheet pushed the masthead — and the only control that stops the episode — off screen at ${openSheet.mastTop}`);
console.log("sheet is a place", { before: beforeSheet.rect.height, open: openSheet.rect.height, reserved: openSheet.reserved });

const transcriptAtRest = await evaluate(`(() => {
  const list = document.querySelector(".podcast-transcript");
  return {
    lines: document.querySelectorAll(".podcast-transcript-line").length,
    mode: list?.getAttribute("data-transcript-mode") ?? null,
    // The depth ramp reaches three lines either side of the voice and nowhere
    // else. Everything past it used to carry data-d="3", which is a blur, so a
    // two-hour episode asked for ~2,274 filtered surfaces at once.
    ladder: document.querySelectorAll(".podcast-transcript-line[data-d]").length,
    current: document.querySelectorAll('.podcast-transcript-line[aria-current="true"]').length,
    search: Boolean(document.querySelector(".podcast-transcript-search")),
    // One tab stop for the whole list. Every line used to be one, so reaching
    // the Follow pill or the search box by keyboard cost 2,280 presses.
    stops: document.querySelectorAll('.podcast-transcript-line[tabindex="0"]').length,
    // The episode's own masthead, which had no rules at all until this build:
    // the UA's 1.5em bold made it the largest type in the study column.
    titleSize: (() => {
      const h = document.querySelector(".podcast-episode-title");
      return h ? Math.round(parseFloat(getComputedStyle(h).fontSize)) : null;
    })(),
    titleFace: (() => {
      const h = document.querySelector(".podcast-episode-title");
      return h ? getComputedStyle(h).fontFamily.split(",")[0].replace(/['"]/g, "") : null;
    })(),
    titleLines: (() => {
      const h = document.querySelector(".podcast-episode-title");
      return h ? getComputedStyle(h).webkitLineClamp : null;
    })(),
  };
})()`);
assert.ok(transcriptAtRest.lines > 20,
  `this episode has no transcript on disk — the sheet settled on "${settled}". `
  + "The tour needs one; pick a passage whose Naked Bible episode has been transcribed.");
assert.equal(transcriptAtRest.mode, "following", "the transcript rests on following");
assert.ok(transcriptAtRest.ladder <= 7, `the depth ramp reached ${transcriptAtRest.ladder} lines`);
assert.equal(transcriptAtRest.current, 1, "exactly one line is the one being spoken");
assert.equal(transcriptAtRest.search, true);
assert.equal(transcriptAtRest.stops, 1,
  `the transcript holds ${transcriptAtRest.stops} tab stops; a roving list holds one`);
assert.ok(transcriptAtRest.titleSize <= 17,
  `the episode title is ${transcriptAtRest.titleSize}px — larger than the study column's own masthead`);
assert.equal(transcriptAtRest.titleFace, "Source Serif 4", "a title of a work is set in the reading face");
assert.equal(transcriptAtRest.titleLines, "3", "an unclamped title grows the dock upward without limit");
await screenshot("paper-dock-sheet", ".podcast-dock");
console.log("sheet", transcriptAtRest);

/* ── The sheet opened itself, and says why ─────────────────────────────────
   An episode launched from a moment used to land COLLAPSED: a reader who
   pressed "eleven minutes on 1 Samuel 30:1-10" got a title, a clock and no
   account of why the playhead was eleven minutes in, with the transcript that
   justifies it behind a control nobody had a reason to press. */
const moment = await evaluate(`(() => {
  const block = document.querySelector(".podcast-moment");
  if (!block) return null;
  return {
    ref: block.querySelector(".podcast-moment-ref")?.textContent?.trim() ?? null,
    said: block.querySelector(".podcast-moment-said")?.textContent?.trim() ?? null,
    extent: block.querySelector(".podcast-moment-extent")?.textContent?.trim() ?? null,
    why: block.querySelector(".podcast-moment-why")?.textContent?.trim() ?? null,
    opens: Boolean(block.querySelector(".podcast-moment-ref")),
  };
})()`);
assert.ok(moment, "a launch from a moment must name the moment it launched from");
assert.match(moment.ref ?? "", new RegExp(`^${PASSAGE}`), `the moment names ${moment.ref}`);
assert.ok(moment.said && !["crossref", "mention", "allusion", "subject"].includes(moment.said),
  `the moment's relation is a schema token: ${JSON.stringify(moment.said)}`);
assert.match(moment.extent ?? "", /from \d+:\d\d$/, "a moment is a place in a file and must say which");
assert.equal(moment.opens, true, "the moment's passage must be openable");
console.log("moment", moment);

/* The footing, on the surface rather than in a literal. 48% of everything
   these surfaces show comes from publishers nobody has asked; the permissions
   doc says the distinction must stay visible, and until this build the only
   places it was visible were a TypeScript constant and a test. */
const footing = await evaluate(`(() => {
  const line = document.querySelector(".podcast-episode-footing");
  return line ? { basis: line.getAttribute("data-basis"), says: line.textContent.trim() } : null;
})()`);
assert.ok(footing, "the episode does not say which footing its transcript rests on");
assert.ok(["publisher-granted", "public-feed"].includes(footing.basis ?? ""),
  `unknown footing on the surface: ${footing.basis}`);
assert.match(footing.says, footing.basis === "publisher-granted" ? /permission/ : /not asked/);
console.log("footing", footing);

/* The rail's ticks. The mechanism has been coded and styled since the first
   draft and drew nothing, because the only array it read was `chapters` —
   which the type documents as "currently never supplied" and which no call
   site has ever supplied. It reads the episode's own references now. */
const ticks = await evaluate(`(() => {
  const rail = document.querySelector(".podcast-rail");
  const marks = [...document.querySelectorAll(".podcast-rail-tick")];
  const width = rail?.getBoundingClientRect().width ?? 0;
  return {
    count: marks.length,
    refs: document.querySelectorAll(".podcast-ref-row").length,
    inside: marks.every((mark) => {
      const left = parseFloat(mark.style.left);
      return Number.isFinite(left) && left >= 0 && left <= 100;
    }),
    width: Math.round(width),
  };
})()`);
assert.ok(ticks.count > 0, "the rail's ticks are still fed by the array nobody supplies");
assert.equal(ticks.inside, true, "a tick landed off the rail it marks");
console.log("ticks", ticks);

/* Where scripture is named, marked in the transcript and pressable. */
const cites = await evaluate(`(() => {
  const marks = [...document.querySelectorAll(".podcast-transcript-cite")];
  return {
    count: marks.length,
    titles: marks.slice(0, 3).map((mark) => mark.textContent?.trim()),
    /* Beside the line, never inside it: a control inside a control is markup
       nothing can resolve, and the line's press keeps meaning play-from-here. */
    nested: marks.filter((mark) => mark.closest(".podcast-transcript-line")).length,
    lines: document.querySelectorAll('.podcast-transcript li[data-cited="true"]').length,
  };
})()`);
assert.ok(cites.count > 0, "the transcript still never consults the reference set in its own state");
assert.equal(cites.nested, 0, "a passage mark is nested inside a transcript line");
console.log("cites", cites);

/* The other half of a roving list: one stop is only an improvement if the
   arrows travel it. Pressed for real rather than dispatched at the element, so
   this is the same path a reader takes — and the stop has to MOVE with focus,
   or the next Tab out and back lands somewhere the reader has left. */
await evaluate(`document.querySelector('.podcast-transcript-line[tabindex="0"]')?.focus()`);
const roved = await (async () => {
  const from = await evaluate(`document.activeElement?.getAttribute("data-line")`);
  for (const key of ["ArrowDown", "ArrowDown", "End"]) {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: key === "End" ? 35 : 40, nativeVirtualKeyCode: key === "End" ? 35 : 40 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: key === "End" ? 35 : 40, nativeVirtualKeyCode: key === "End" ? 35 : 40 });
    await sleep(120);
  }
  return {
    from,
    to: await evaluate(`document.activeElement?.getAttribute("data-line")`),
    inList: await evaluate(`Boolean(document.activeElement?.closest(".podcast-transcript"))`),
    stops: await evaluate(`document.querySelectorAll('.podcast-transcript-line[tabindex="0"]').length`),
    onFocused: await evaluate(`document.activeElement?.getAttribute("tabindex")`),
  };
})();
assert.equal(roved.inList, true, "the arrows walked focus out of the transcript");
assert.notEqual(roved.to, roved.from, "the arrows did not move focus");
assert.equal(roved.stops, 1, `the list holds ${roved.stops} tab stops after roving`);
assert.equal(roved.onFocused, "0", "the tab stop did not follow focus");
console.log("roving", roved);

// The passage list, which no capture has ever held. Only reachable when the
// episode has references — the strip is a choice, and with one list there is
// nothing to choose.
const passagesTab = await evaluate(`(() => {
  const tabs = [...document.querySelectorAll(".podcast-view-tab")];
  const passages = tabs.find((tab) => tab.textContent?.startsWith("Passages"));
  if (!passages) return null;
  passages.click();
  return { count: passages.querySelector(".podcast-view-count")?.textContent ?? null };
})()`);
if (passagesTab) {
  await waitFor(`Boolean(document.querySelector(".podcast-refs-view"))`);
  await parkPointer();
  await screenshot("paper-dock-sheet-passages", ".podcast-dock");
  console.log("passages", passagesTab);

  /* ── The half of the loop that did not exist ─────────────────────────────
     Every row here names a passage — twelve at the median, sixty-four at the
     top — and until 2026-07-30 not one of them could open it: the canonical
     bref was loaded, validated, and used for nothing. Each row now carries a
     second, smaller control, and the press opens the passage WITHOUT touching
     the audio, because a reader following along who wants to see Romans 8 has
     not asked to stop hearing this. */
  const rows = await evaluate(`(() => {
    const list = [...document.querySelectorAll(".podcast-ref-row")];
    return {
      rows: list.length,
      reads: document.querySelectorAll(".podcast-ref-read").length,
      /* Never an empty span. The crossref and mention relations printed
         nothing at all here — 23,169 moments across the corpus with no
         statement of what kind of reference they were. */
      said: [...new Set(list.map((row) => row.querySelector(".podcast-ref-said")?.textContent?.trim() ?? ""))],
      /* The evidence was argued for at length in the component and then given
         a nowrap rule inside a minmax(0,1fr) column, against a corpus median
         of 52 characters. */
      whyClamp: getComputedStyle(list[0]?.querySelector(".podcast-ref-why")).webkitLineClamp,
    };
  })()`);
  assert.equal(rows.reads, rows.rows, "every passage row can be heard; every one must also open");
  for (const said of rows.said) {
    assert.ok(said && !["crossref", "mention", "allusion", "subject"].includes(said),
      `a relation reached the passage list as a token or an empty span: ${JSON.stringify(said)}`);
  }
  assert.equal(rows.whyClamp, "2", "the evidence line is back to one clipped line");
  console.log("passage rows", rows);

  const wasAt = await evaluate(`(() => {
    const title = document.querySelector(".chapter-title");
    return {
      chapter: [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent].filter(Boolean).join(" "),
      time: document.querySelector("audio").currentTime,
      paused: document.querySelector("audio").paused,
    };
  })()`);
  /* A row naming somewhere ELSE, so the navigation is unmistakable: an
     episode on 1 Samuel 30 reaching for Romans is exactly the crossref case
     the whole relation vocabulary exists to name. */
  const opened = await evaluate(`(() => {
    const row = [...document.querySelectorAll(".podcast-ref-row")].find((candidate) => {
      const title = candidate.querySelector(".podcast-ref-title")?.textContent ?? "";
      return !title.startsWith(${JSON.stringify(PASSAGE.replace(/ \d+$/, ""))});
    });
    if (!row) return null;
    const title = row.querySelector(".podcast-ref-title")?.textContent ?? null;
    row.querySelector(".podcast-ref-read")?.click();
    return { title };
  })()`);
  if (opened) {
    await sleep(1_400);
    const landed = await evaluate(`(() => {
      const title = document.querySelector(".chapter-title");
      return {
        chapter: [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent].filter(Boolean).join(" "),
        time: document.querySelector("audio").currentTime,
        paused: document.querySelector("audio").paused,
        dock: Boolean(document.querySelector(".podcast-dock")),
        back: Boolean([...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Back")),
      };
    })()`);
    assert.notEqual(landed.chapter, wasAt.chapter,
      `pressing read on ${opened.title} did not move the canvas`);
    assert.equal(landed.paused, false, "opening a passage stopped the episode");
    assert.equal(landed.dock, true, "the dock did not survive the navigation it started");
    assert.equal(landed.back, true, "the reader's place must be in history to come back to");
    /* And back, by the canvas's own control, so the loop closes. */
    await evaluate(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Back")?.click()`);
    await sleep(1_600);
    const returned = await evaluate(`(() => {
      const title = document.querySelector(".chapter-title");
      return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent].filter(Boolean).join(" ");
    })()`);
    assert.equal(returned, wasAt.chapter, `the way back landed on ${returned}`);
    console.log("read it", opened.title, "→", landed.chapter, "→ back to", returned);
  } else {
    console.log("read it: this episode's references never leave its own book (path not exercised)");
  }

  await evaluate(`[...document.querySelectorAll(".podcast-view-tab")].find((tab) => tab.textContent?.startsWith("Transcript"))?.click()`);
  await waitFor(`Boolean(document.querySelector(".podcast-transcript"))`);
} else {
  forgetCapture("paper-dock-sheet-passages");
  console.log("passages: this episode carries no references (capture withdrawn)");
}

// A word from four fifths of the way in, so the hit is unmistakably elsewhere
// in the file and a seek to it cannot be confused with the playhead drifting.
const chosen = await evaluate(`(() => {
  const lines = [...document.querySelectorAll(".podcast-transcript-line")];
  for (let at = Math.floor(lines.length * 0.8); at < lines.length; at++) {
    const word = (lines[at]?.textContent ?? "").split(/\\s+/)
      .map((token) => token.replace(/[^A-Za-z]/g, ""))
      .filter((token) => token.length >= 7)
      .sort((a, b) => b.length - a.length)[0];
    if (word) return { word, at };
  }
  return null;
})()`);
assert.ok(chosen, "no line late in the episode carried a word long enough to search for");
console.log("searching for", chosen);

await evaluate(`(() => {
  const input = document.querySelector(".podcast-transcript-search");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, ${JSON.stringify("")});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  setter?.call(input, ${JSON.stringify(chosen.word)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await waitFor(`document.querySelector(".podcast-transcript")?.getAttribute("data-transcript-mode") === "searching"`);
await waitFor(`document.querySelectorAll(".podcast-transcript-line mark").length > 0`);

/* ── Marked in place, with somewhere to go ─────────────────────────────────
   Restated 2026-07-30. The search used to FILTER the list to its hits, and
   this block asserted that the list got shorter. That answered "is this word
   anywhere in two hours" and destroyed the thing a reader is usually after:
   the sentences on either side, and whether four of the seventeen are in the
   same two minutes. So the transcript stays whole, every hit is marked where
   it sits, and ‹ 3/17 › is what makes a hit fourteen screens down reachable —
   which is the objection the old note raised and the arrows answer. */
const marked = await evaluate(`(() => {
  const mark = document.querySelector(".podcast-transcript-line mark");
  const style = mark ? getComputedStyle(mark) : null;
  return {
    lines: document.querySelectorAll(".podcast-transcript-line").length,
    marks: document.querySelectorAll(".podcast-transcript-line mark").length,
    markBackground: style?.backgroundColor ?? null,
    markInk: style?.color ?? null,
    // ‹ n/N › — the count and the two arrows that make it navigable.
    count: document.querySelector(".podcast-transcript-count")?.textContent?.trim() ?? null,
    steps: document.querySelectorAll(".podcast-transcript-step").length,
    // Exactly one hit is the one the arrows are standing on.
    current: document.querySelectorAll('.podcast-transcript-line[data-hit="true"]').length,
    // The ladder is a claim about distance from a voice, and a reader working
    // their own answer through the list is not tracking one. It used to
    // flatten every hit to data-d="0", which is not "readable weight" but the
    // ACTIVE-line treatment — every hit drawn as though it were playing.
    flat: document.querySelector(".podcast-transcript")?.getAttribute("data-flat") ?? null,
    ladder: document.querySelectorAll(".podcast-transcript-line[data-d]").length,
    // Present DURING a search, which is the moment the reader is furthest from
    // the playhead and used to be the moment this was taken off the surface.
    follow: Boolean(document.querySelector(".podcast-transcript-follow")),
  };
})()`);
assert.ok(marked.marks > 0, `"${chosen.word}" matched nothing`);
assert.equal(marked.lines, transcriptAtRest.lines,
  "the transcript is being filtered again — the marks belong in the whole of it");
assert.notEqual(marked.markBackground, "rgba(0, 0, 0, 0)",
  "the search mark resolved to nothing — see --player-accent in styles.css");
assert.notEqual(marked.markBackground, marked.markInk,
  `the mark is the same colour as the text on it: ${marked.markBackground}`);
assert.match(marked.count ?? "", /^\d+\/\d+$/, "a search with no count is a search with no answer");
assert.equal(marked.steps, 2, "marks with no next and previous are marks nobody can reach");
assert.equal(marked.current, 1, "exactly one hit is the one the arrows are standing on");
assert.equal(marked.flat, "true", "a reader working a search is not tracking a voice");
assert.equal(marked.ladder, 0, "no line is at a distance from a voice nobody is following");
assert.equal(marked.follow, true, "the way back to the voice must survive a search");
await screenshot("paper-dock-sheet-search", ".podcast-dock");
console.log("marked", marked);

/* The arrows travel, and the count follows them. */
const stepped = await evaluate(`(() => {
  const before = document.querySelector(".podcast-transcript-count")?.textContent?.trim();
  [...document.querySelectorAll(".podcast-transcript-step")][1]?.click();
  return { before };
})()`);
await sleep(320);
const steppedTo = await evaluate(`document.querySelector(".podcast-transcript-count")?.textContent?.trim()`);
assert.notEqual(steppedTo, stepped.before, `the next arrow did not move: still ${steppedTo}`);
console.log("stepped", stepped.before, "→", steppedTo);

/* The Follow pill and the last row. Build 1 measured this and left it: a
   container scrolled to its end put the final row exactly where the pill floats,
   so a coordinate press on the last hit landed on the pill, cleared the search,
   and read like a seek that never happened. The list reserves the pill's own
   band at the bottom of its padding now, in both states, so nothing moves when
   the pill appears and the last row can always be pressed. */
const lastRow = await evaluate(`(() => {
  const box = document.querySelector(".podcast-transcript");
  const pill = document.querySelector(".podcast-transcript-follow");
  if (!box || !pill) return null;
  box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
  const rows = [...box.querySelectorAll(".podcast-transcript-line")];
  const last = rows.at(-1)?.getBoundingClientRect();
  const over = pill.getBoundingClientRect();
  return last ? { gap: Math.round(over.top - last.bottom), rows: rows.length } : null;
})()`);
await sleep(200);
if (lastRow) {
  assert.ok(lastRow.gap >= 0,
    `the Follow pill covers the last row by ${-lastRow.gap}px — a press on it lands on the pill`);
  console.log("last row clears the pill by", lastRow.gap);
}

/* Deep into the hit list but never its last row — the pill is clear of it now,
   and this stays off the extreme so the assertion is about the seek. */
const pressed = await evaluate(`(() => {
  const hits = [...document.querySelectorAll(".podcast-transcript-line")];
  const at = Math.max(0, Math.min(hits.length - 2, Math.floor(hits.length * 0.6)));
  hits[at]?.setAttribute("data-qa-target", "hit");
  return { at, line: hits[at]?.getAttribute("data-line") ?? null, of: hits.length };
})()`);
assert.ok(pressed.line !== null, "no hit to press");
console.log("pressing hit", pressed);
/* Brought into the box instantly, and by hand.
   `.podcast-transcript` sets `scroll-behavior: smooth`, so the scrollIntoView
   inside clickElement is still travelling when a coordinate is taken off the
   row — the press then lands where the row used to be, on nothing, and reads
   exactly like a seek that did not fire. (The same rule is why the autoscroll
   has to say "instant" in script instead of trusting the stylesheet.) */
await evaluate(`(() => {
  const target = document.querySelector('[data-qa-target="hit"]');
  const box = document.querySelector(".podcast-transcript");
  if (!target || !box) return;
  const boxAt = box.getBoundingClientRect();
  const rowAt = target.getBoundingClientRect();
  box.scrollTo({
    top: box.scrollTop + (rowAt.top - boxAt.top) - (box.clientHeight - rowAt.height) / 2,
    behavior: "instant",
  });
})()`);
await sleep(300);
const beforeHit = await evaluate(`document.querySelector("audio").currentTime`);
await clickElement('[data-qa-target="hit"]');
await sleep(500);
const afterHit = await evaluate(`(() => {
  const list = document.querySelector(".podcast-transcript");
  return {
    time: document.querySelector("audio").currentTime,
    paused: document.querySelector("audio").paused,
    query: document.querySelector(".podcast-transcript-search")?.value ?? null,
    mode: list?.getAttribute("data-transcript-mode") ?? null,
    lines: document.querySelectorAll(".podcast-transcript-line").length,
    marks: document.querySelectorAll(".podcast-transcript-line mark").length,
  };
})()`);
assert.ok(Math.abs(afterHit.time - beforeHit) > 60,
  `pressing a hit moved the file ${(afterHit.time - beforeHit).toFixed(1)}s`);
/* Restated 2026-07-30 with the invariant it depends on. This asserted the box
   was EMPTIED, which was right while searching meant a filter: staying inside
   one would have been following an episode through a four-line keyhole. There
   is no keyhole now, and clearing the box would destroy the sixteen other
   places the phrase was said — which is the reason the reader typed it. The
   MODE still returns to following; the marks stay and stay navigable. */
assert.equal(afterHit.query, chosen.word, "the marks must survive a seek made from one of them");
assert.ok(afterHit.marks > 0, "pressing a hit took the other hits off the surface");
assert.equal(afterHit.mode, "following", "pressing a hit must put the transcript back under the voice");
assert.equal(afterHit.lines, transcriptAtRest.lines, "the whole transcript stands around the hit");
assert.equal(afterHit.paused, false, "a line pressed is a line asked to be heard");
console.log("hit", afterHit, `moved ${(afterHit.time - beforeHit).toFixed(1)}s`);

// Shut again, so every capture below is the collapsed dock it has always been.
await clickElement('.podcast-mast-icon[aria-expanded="true"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "false"`);
// A shut sheet holds nothing. The list used to mount when the episode started
// and reconcile every four seconds for the length of it, in a box clipped to
// nothing that the reader may never open.
await waitFor(`document.querySelectorAll(".podcast-transcript-line").length === 0`);
await parkPointer();

// A rail with something on it. Every capture so far is the first minute of a
// forty-four minute file, which is a rail that looks empty in a screenshot and
// proves nothing about the one state it exists to draw.
await evaluate(`(() => {
  const scrub = document.querySelector(".podcast-scrub");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(scrub, String(Math.round(document.querySelector("audio").duration * 0.38)));
  scrub.dispatchEvent(new Event("input", { bubbles: true }));
  scrub.dispatchEvent(new Event("pointerup", { bubbles: true }));
})()`);
await waitFor(`(document.querySelector("audio")?.currentTime ?? 0) > 900`, 20_000);
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await parkPointer();
await screenshot("paper-dock-part-heard", ".podcast-dock");

// Pause, then the other three appearances, then the material and the fallback.
await clickElement(".podcast-dock .transport-play");
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "paused"`);
await parkPointer();
await screenshot("paper-dock-paused", ".podcast-dock");
await clickElement(".podcast-dock .transport-play");
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "playing"`, 20_000);

for (const theme of ["dark", "porcelain", "onyx"]) {
  await setTheme(theme);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await parkPointer();
  const themed = await evaluate(DOCK_TRUTH);
  assert.equal(themed.present, true, `${theme} took the dock away`);
  assert.equal(themed.audioPaused, false, `${theme} stopped the episode`);
  await screenshot(`${theme}-dock`, ".podcast-dock");
  /* The merged surface in every atmosphere it can be read in. It is fully
     tokenised except for the plate, so this is a picture of the app's own
     paper answering the reader's choice — and the plate holding the
     publisher's colour through all four, which is the one thing on it that
     must not follow the theme. */
  await screenshot(`${theme}-margin-merged`, ".taught-here");
  if (theme === "dark") await screenshot("ink-dock-in-place");
}

// The translucent material, over each polarity's ground. The dock is floating
// paper and takes --bg-float, which is the plane the material thins.
await setMaterial(true);
await parkPointer();
await screenshot("onyx-translucent-dock", ".podcast-dock");
await setTheme("light");
await parkPointer();
await screenshot("paper-translucent-dock", ".podcast-dock");
await setMaterial(false);

/* The unbranded fallback. Every source on the shelf has a palette block, so
   this configuration is one feed away and unreachable through the UI — but it
   is the exact CSS path a new feed takes, and it is the one the old default
   drew a white play glyph on a near-white pill in. Set by attribute, in the
   two atmospheres it was broken in, and put back. */
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await evaluate(`document.querySelector(".podcast-dock")?.setAttribute("data-source", "qa-unregistered-source")`);
  await sleep(240);
  const fallback = await evaluate(`(() => {
    const play = document.querySelector(".podcast-dock .transport-play");
    const style = getComputedStyle(play);
    return { fill: style.backgroundColor, ink: style.color };
  })()`);
  assert.notEqual(fallback.fill, fallback.ink,
    `${theme}: the unbranded play button is drawing its glyph in its own fill`);
  await parkPointer();
  await screenshot(`${theme === "light" ? "paper" : "ink"}-dock-unbranded`, ".podcast-dock");
  await evaluate(`document.querySelector(".podcast-dock")?.setAttribute("data-source", "naked-bible")`);
  await sleep(200);
  console.log("unbranded", theme, fallback);
}
await setTheme("light");

/* Forced colors. Emulated through CDP rather than through the OS, which is the
   only way a tour can reach it — and the state where seven of this surface's
   rules used to disappear, including which view tab is selected and the
   transcript's blur ladder, because neither `filter` nor `opacity` is a forced
   property. */
await cdp.send("Emulation.setEmulatedMedia", {
  features: [{ name: "forced-colors", value: "active" }],
});
await sleep(320);
await parkPointer();
const forced = await evaluate(`(() => {
  const dock = document.querySelector(".podcast-dock");
  const line = dock.querySelector(".podcast-transcript-line");
  return {
    ground: getComputedStyle(dock).backgroundColor,
    border: getComputedStyle(dock).borderTopColor,
    lineOpacity: line ? getComputedStyle(line).opacity : null,
    lineFilter: line ? getComputedStyle(line).filter : null,
  };
})()`);
assert.notEqual(forced.ground, forced.border, "the dock's forced ground and its hairline are the same colour");
await screenshot("forced-colors-dock", ".podcast-dock");
/* The taught-here family had NO forced-colors coverage at all: hover was the
   only thing distinguishing a pointed-at row and it flattens to Canvas, the
   masthead's 3px rule lost its distinction from the hairlines, and the two
   real buttons on it had no focus rule anywhere in the stylesheet. */
await screenshot("forced-colors-margin-merged", ".taught-here");
console.log("forced colors", forced);
await cdp.send("Emulation.setEmulatedMedia", { features: [] });
await sleep(320);

/* The narrow range. 979 is the app's own compact breakpoint — where the study
   panel becomes a full-width pane along the bottom — and the dock's only rule
   used to be at 620, so across the whole band between them a fixed 380px card
   sat on top of the pane it claims to be inscribed in. */
const narrowAt = await setViewportWidth(900);
assert.ok(narrowAt <= 979, `the viewport would not go below the breakpoint: ${narrowAt}`);
const narrow = await evaluate(`(() => {
  const dock = document.querySelector(".podcast-dock");
  const margin = document.querySelector(".living-margin");
  const rect = dock.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    inner: window.innerWidth,
    left: Math.round(rect.left),
    right: Math.round(window.innerWidth - rect.right),
    overlap: margin ? Math.round(margin.getBoundingClientRect().bottom - rect.top) : null,
    plate: Math.round(dock.querySelector(".podcast-mast-plate")?.getBoundingClientRect().width ?? 0),
  };
})()`);
assert.equal(narrow.left, narrow.right, "the dock is not centred on the frame's own inset");
assert.ok(narrow.width > narrow.inner - 40, `the dock is still a 380px card at ${narrow.inner}px: ${narrow.width}`);
if (narrow.overlap !== null) {
  assert.ok(narrow.overlap <= 0, `the compact study pane runs ${narrow.overlap}px under the player`);
}
await parkPointer();
await screenshot("paper-dock-narrow");
console.log("narrow", narrow);
await cdp.send("Emulation.clearDeviceMetricsOverride");
await sleep(760);

/* A file the reader cannot be given. This points the element at a host the
   renderer's own policy refuses — `media-src 'self' https://nakedbiblepodcast.com`
   — which is both the shape of a network failure and the exact refusal an
   audioUrl that slipped past validation would produce. Two things are asserted:
   the policy does refuse it, and the dock says so.

   The element fires `error` and then `pause`, in that order, and a dock that
   took the second event as its answer would report "paused" about an episode it
   never reached. That is what this guards. */
const beforeRefusal = await evaluate(DOCK_TRUTH);
await evaluate(`(() => {
  const element = document.querySelector("audio");
  element.src = "https://example.com/not-an-approved-media-host.mp3";
  element.load();
  void element.play().catch(() => {});
})()`);
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "failed"`);
const refused = await evaluate(`(() => {
  const line = document.querySelector(".podcast-dock-refusal");
  const shell = getComputedStyle(document.querySelector(".app-shell"));
  const swatch = document.createElement("span");
  swatch.style.color = "var(--error)";
  document.querySelector(".podcast-dock").append(swatch);
  const error = getComputedStyle(swatch).color;
  swatch.remove();
  return {
    code: document.querySelector("audio").error?.code ?? null,
    refusal: line?.textContent?.trim() ?? null,
    // A truncated reason is not a reason. The sentence has to fit the line it
    // was given, in the language the app is set to, without an ellipsis.
    clipped: line ? line.scrollWidth > line.clientWidth : null,
    // In the app's error ink. It used to be --resource-ink — the same colour as
    // every other word on the surface — on a dock otherwise byte-identical to
    // paused, so a failure cost ten pixels of body text and nothing else.
    ink: line ? getComputedStyle(line).color : null,
    error,
    seal: shell.getPropertyValue("--error").trim(),
    clock: document.querySelector(".podcast-dock-clock"),
    height: Math.round(document.querySelector(".podcast-dock").getBoundingClientRect().height),
    stop: Boolean(document.querySelector('[aria-label^="Stop"]')),
  };
})()`);
assert.equal(refused.code, 4, "the policy must refuse an unapproved media host");
// Restated 2026-07-30 with the sentence it now says. The old one wanted 253px
// of a 223px line and was ellipsed mid-word; this assertion has stood since the
// tour was written and could not be reached until the tour above it was fixed.
assert.match(refused.refusal ?? "", /^Did not arrive\. This needed the network\.$/);
assert.equal(refused.clipped, false, `the refusal is cut off: "${refused.refusal}"`);
assert.equal(refused.ink, refused.error, `the refusal is not in the app's error ink: ${refused.ink}`);
assert.equal(refused.clock, null, "the refusal takes the clock's line rather than growing the dock");
/* Restated 2026-07-30, and the tolerance is gone. It was ±2, because the clock's
   row measured 15px where the bare refusal sentence measured 13 — .podcast-rate
   carries a pixel of vertical padding — so the dock lost a pixel when it failed.
   The three forms of that row (clock, reaching, refusal) now share one declared
   height, so the claim the sentence was always making is true exactly. */
assert.equal(refused.height, beforeRefusal.rect.height,
  `a failure changed the dock's height: ${beforeRefusal.rect.height} → ${refused.height}`);
assert.equal(refused.stop, true, "a failed dock must still be closeable");
await parkPointer();
await screenshot("paper-dock-refused", ".podcast-dock");
console.log("refused", refused);

// Stopping is the reader saying they are done, and the file is let go with the
// dock rather than left open on a server that is not ours.
await clickElement('[aria-label^="Stop"]');
await waitFor(`!document.querySelector(".podcast-dock")`);
const stopped = await evaluate(DOCK_TRUTH);
assert.equal(stopped.present, false);
assert.equal(stopped.audioSrc, null, "stopping must release the publisher's file, not merely pause it");
console.log("stopped", stopped);

await navigatePassage(original.passage);
await setMargin(original.margin);
await setTheme(original.theme);
await setMaterial(original.material);
await setFocusMode(original.focus);
await evaluate(`window.resizeTo(${JSON.stringify(originalBounds.width)}, ${JSON.stringify(originalBounds.height)}); window.moveTo(${JSON.stringify(originalBounds.left)}, ${JSON.stringify(originalBounds.top)})`);
await sleep(420);
cdp.ws.close();
console.log("Podcast player QA PASS");
