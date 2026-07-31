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
/* The density case, and it is a real one rather than a stress test: Genesis 1
   holds 922 moments against a corpus median of 18, and it is the chapter the
   old drawer showed 25 of. The room is measured and captured here. */
const DENSE = "Genesis 1";

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
      /* CLAMPED TO THE VIEWPORT, added 2026-07-30. The 26px of air around the
         subject is what makes a clipped capture readable, and it is also what
         runs a full-width column past the window's own right edge: the study
         column ends at the frame's 10px inset, so 26 more is 16 outside. With
         captureBeyondViewport false the engine refuses the whole capture
         rather than trimming it, and a refused capture is a state nobody looks
         at. Integers for the same reason: fractional device pixels are what
         turns "refuses sometimes" into "refuses on this machine". */
      const left = Math.max(0, Math.round((rect.x - 26) * zoom));
      const top = Math.max(0, Math.round((rect.y - 26) * zoom));
      const right = Math.min(window.innerWidth * zoom, Math.round((rect.right + 26) * zoom));
      const bottom = Math.min(window.innerHeight * zoom, Math.round((rect.bottom + 26) * zoom));
      return { x: left, y: top, width: right - left, height: bottom - top, scale: 2 };
    })()`);
    if (!clip) throw new Error(`Cannot capture missing element: ${selector}`);
  }
  await cdp.send("Page.bringToFront");
  if (settle > 0) await sleep(settle);
  /* Asked more than once, because the engine sometimes cannot answer.
     Measured 2026-07-30: the SAME clip refuses and then succeeds a moment
     later — the compositor has no frame to hand back yet — and the refusal is
     a protocol error rather than an empty image, so a single ask turns a
     working tour into a failing one at random. Three asks, a beat apart. */
  let response = null;
  for (let ask = 0; ask < 3; ask += 1) {
    response = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      ...(clip ? { clip } : {}),
    });
    if (response.result?.data) break;
    await sleep(240);
  }
  if (!response?.result?.data) throw new Error(`Could not capture ${name}`);
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

/* ── Withdrawn, rather than left standing ─────────────────────────────────
   The merged surface these named is gone: its work is the Resources room, and
   a room is not the same picture under a different name. Deleted at the top of
   the run rather than at the end of it, so a run that fails halfway still
   leaves no picture of a surface that does not exist. That failure is exactly
   how this feature's audit went wrong the first time. */
for (const retired of [
  "paper-margin-merged",
  "dark-margin-merged",
  "porcelain-margin-merged",
  "onyx-margin-merged",
  "forced-colors-margin-merged",
]) forgetCapture(retired);

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
  if (!dock) return {
    present: false,
    audioSrc: audio?.getAttribute("src") ?? null,
    audioTime: audio?.currentTime ?? null,
    // With no dock there is no second resident, so the column is the margin's
    // — and this is where a fold that outlived its player would show.
    folded: document.querySelector(".living-margin")?.getAttribute("data-folded") ?? null,
  };
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
    // The reading page's own measure. Added 2026-07-30 with the column swap:
    // the player widens the study column while it owns it, and the ceiling on
    // that width is that the passage must not re-wrap. The page's text is
    // max-width bound, so this number is the proof rather than the intent.
    verseWidth: Math.round(document.querySelector(".verse-line")?.getBoundingClientRect().width ?? 0),
    folded: document.querySelector(".living-margin")?.getAttribute("data-folded") ?? null,
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

/**
 * The card's ground, swept the way the accent is · 2026-07-30.
 *
 * The resources room's cards wear a muted homage to the publisher's hue —
 * hue kept, chroma clamped, lightness replaced by the atmosphere's own figure
 * (see --ground-fit-* in styles.css). Eleven publishers × four atmospheres is
 * forty-four grounds, and the whole of the reader's ask — "important they look
 * good" — rests on two numbers nobody could otherwise check:
 *
 *   1. It is a HOMAGE, not a reproduction. The ground must not be the brand's
 *      own colour, and must not have collapsed back onto the app's paper.
 *   2. The ink on it holds. The app's tertiary is drawn to clear 4.5 against
 *      paper by a hair and does NOT clear it on a tinted card — 4.07:1 at the
 *      worst — which is exactly why the card steps its quietest rank up to
 *      secondary. This asserts the rank that is actually used, resting and
 *      under the pointer, so the step cannot be undone without failing here.
 *
 * Colours are normalised through a canvas for the same reason the accent sweep
 * does it: a computed `oklch()` serialises as `oklch(...)` and a token as
 * `rgb(...)`, and one string parser for two formats is two chances to be wrong.
 */
const GROUND = `((sources) => {
  const card = document.querySelector(".resource-card");
  if (!card) return null;
  const was = card.getAttribute("data-source");
  const ink = document.createElement("canvas").getContext("2d");
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
  probe.style.cssText = "position:absolute;pointer-events:none";
  card.append(probe);
  const paint = (value) => {
    probe.style.backgroundColor = "color-mix(in srgb, " + value + " 100%, transparent)";
    return bytes(getComputedStyle(probe).backgroundColor);
  };
  const shell = getComputedStyle(document.querySelector(".app-shell"));
  const paper = bytes(shell.getPropertyValue("--bg-reading").trim());
  /* The rank the card actually draws its quietest type in. Read off the
     element rather than off the token, so the step is what is asserted. */
  const quietest = bytes(getComputedStyle(card.querySelector(".resource-card-extent")).color);
  const rows = [];
  for (const source of sources) {
    card.setAttribute("data-source", source);
    const ground = paint("var(--resource-ground)");
    const lift = paint("var(--resource-ground-lift)");
    const brand = paint("var(--resource-source)");
    rows.push({
      source,
      groundIsBrand: ground.every((c, at) => Math.abs(c - brand[at]) < 0.004),
      groundIsPaper: ground.every((c, at) => Math.abs(c - paper[at]) < 0.004),
      quietOnGround: Number(contrast(quietest, ground).toFixed(2)),
      quietOnHover: Number(contrast(quietest, lift).toFixed(2)),
    });
  }
  probe.remove();
  if (was === null) card.removeAttribute("data-source"); else card.setAttribute("data-source", was);
  return rows;
/* The unregistered sentinel is excluded below, and its exclusion is the point:
   a source with no palette has no hue to pay homage to, so the derivation is
   invalid at computed-value time and the card's ground falls back to the app's
   own paper. That is the correct behaviour and it is not a ground this sweep
   has anything to measure. */
})(${JSON.stringify(SOURCES.filter((source) => source !== "qa-unregistered-source"))})`;

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

await waitFor(`Boolean(document.querySelector(".resources-digest"))`, 20_000);

/* ── One room for this chapter's material ──────────────────────────────────
   RESTATED 2026-07-30 with the column swap and the room.

   The finding this section was written for is unchanged and still gated: two
   blocks used to draw the same episodes — 25 of 28 on the reference chapter —
   with two mastheads, two orders, two brand policies and an identity key that
   was the same string in both, which is why pressing a moment for an
   already-running episode had to be special-cased in the machine.

   What changed is where the one answer lives. Overview carries a digest and a
   door; the room is the study panel's fifth lens, and it holds the chapter's
   episodes AND its link-only material under one card and one key. So the tour
   enters through the door, which is also the shortest way to prove the door
   works. */
await evaluate(`document.querySelector(".resources-door")?.click()`);
await waitFor(`Boolean(document.querySelector('#margin-resources-panel:not([hidden]) .resources'))`, 10_000);
await waitFor(`document.querySelectorAll(".resource-card").length > 0`, 20_000);
await sleep(320);

const room = await evaluate(`(() => {
  /* SCOPED TO THE OPEN LENS. The margin draws three mutually exclusive states
     and each of them holds an Overview panel with the room's own card in its
     digest — hidden, so those cards have no geometry, and a probe that finds
     them first measures nothing. Ask the lens that is open. */
  const lens = document.querySelector("#margin-resources-panel:not([hidden])");
  const rooms = lens.querySelectorAll(".resources");
  const cards = [...lens.querySelectorAll(".resource-card-face")];
  const shelf = [...lens.querySelectorAll(".resource-shelf .trusted-resource-imprint")];
  return {
    rooms: rooms.length,
    cards: cards.length,
    // The lens is the one place this chapter's material is drawn. A second
    // surface anywhere in the panel is the duplication coming back.
    otherSurfaces: document.querySelectorAll(".taught-here, .trusted-resource-card").length,
    lensCards: lens.querySelectorAll(".resource-card").length,
    // Nothing else starts audio: no play control outside the room's own cards.
    playOutside: [...document.querySelectorAll(".living-margin .transport-play")]
      .filter((play) => !play.closest(".resource-card-face") && !play.closest(".taught-here-walk")).length,
    // THE FACE. Four things, and the fifth is what this gate refuses: no
    // relation word, no timestamp, no evidence sentence on any card.
    grammar: cards.every((card) => card.querySelector(".resource-card-title")
      && card.querySelector(".resource-card-ref")
      && card.querySelector(".resource-card-extent")
      && (card.querySelector(".resource-card-plate") || card.querySelector(".resource-card-out"))),
    stray: cards.some((card) => /worked through|brought in alongside|mentioned|alluded to/
      .test(card.textContent ?? "")),
    // One control per card, and it is the card: the face IS the button, and
    // nothing inside it is a second tab stop.
    controls: [...new Set([...lens.querySelectorAll(".resource-card")]
      .map((card) => card.querySelectorAll("button").length))],
    // The relation is still SAID, where a screen reader is owed the claim.
    spoken: cards.filter((card) => /worked through|brought in alongside|mentioned|alluded to/
      .test(card.getAttribute("aria-label") ?? "")).length,
    // The shelf: colour, marks, a filter, and the route into settings.
    shelfChips: shelf.length,
    shelfMarked: shelf.filter((chip) => {
      const mark = chip.querySelector(".trusted-resource-source");
      return mark ? getComputedStyle(mark).backgroundImage !== "none" : false;
    }).length,
    shelfColoured: shelf.filter((chip) => {
      const ground = getComputedStyle(chip).backgroundColor;
      return ground !== "rgba(0, 0, 0, 0)" && ground !== "transparent";
    }).length,
    filter: shelf.some((chip) => chip.hasAttribute("aria-pressed")),
    /* RESTATED 2026-07-30 with the register. This read
       ".resource-shelf .trusted-resource-imprint.is-settings" — the route
       into the library as a PLATE in the row of publishers, which is what made
       it "the one control in the row that is not a publisher, and it looks
       like a publisher that failed to load". The claim is the same claim: the
       route exists on this surface. It is in the shelf's head now, with the
       way back to everything, in the app's quiet action voice. */
    settings: Boolean(lens.querySelector(".resource-shelf-action.is-library")),
    /* And the register's own two facts, added with it. Every plate is exactly
       one track or exactly two — never an intrinsic width, which is what made
       the shelf read as a chart of bars — and the tally is on every one of
       them, which it was not: "count > 1" left a numeral column with holes. */
    shelfTracks: (() => {
      const measure = lens.querySelector(".resource-shelf")?.getBoundingClientRect().width ?? 0;
      const track = (measure - 6) / 2;
      return [...new Set(shelf.map((chip) => {
        const width = chip.getBoundingClientRect().width;
        if (Math.abs(width - track) < 1.5) return "one";
        if (Math.abs(width - measure) < 1.5) return "two";
        return String(Math.round(width));
      }))].sort();
    })(),
    shelfTallies: shelf.filter((chip) => chip.querySelector(".trusted-resource-imprint-count")).length,
    /* THE PLATE LAW, on the shelf · added 2026-07-30 with the taste pass. The
       chips were 30px with a 14px corner — a full-round pill on a frame whose
       radius law is 0.22 × the shorter dimension — which is why the same brand
       colours read as premium on the dock's 26px plate and as a rack here. One
       object, one law: 26 and 6, the same numbers .podcast-mast-plate takes. */
    shelfPlate: [...new Set(shelf.map((chip) => {
      const box = getComputedStyle(chip);
      /* Concatenated rather than interpolated: this whole probe is a template
         literal on the driver's side, so a nested one is evaluated in Node. */
      return String(Math.round(parseFloat(box.height))) + "/" + box.borderTopLeftRadius;
    }))],
    /* AND THE INK ON IT. The chip declared a ground and no colour, so a
       <button>'s initial ButtonText — flat black — was set on the publisher's
       own colour: four of the five name-in-type plates measured under 4.5 and
       one under 2. Measured here rather than asserted from the palette,
       because the failure was the ABSENCE of a declaration. */
    shelfInk: (() => {
      const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const luminance = (colour) => {
        const [r, g, b] = colour.match(/[\\d.]+/g).map(Number);
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const against = (ink, ground) => {
        const [high, low] = [luminance(ink), luminance(ground)].sort((a, b) => b - a);
        return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
      };
      return shelf
        .filter((chip) => {
          /* Only the plates that draw a NAME. An approved mark is artwork with
             its own indent, and its ink is never painted. */
          const name = chip.querySelector(".trusted-resource-source");
          const ground = getComputedStyle(chip).backgroundColor;
          return name && getComputedStyle(name).backgroundImage === "none"
            && ground !== "rgba(0, 0, 0, 0)";
        })
        .map((chip) => {
          const box = getComputedStyle(chip);
          const after = getComputedStyle(chip, "::after");
          const ink = after.content !== "none" ? after.color : box.color;
          return { source: chip.dataset.source, ratio: against(ink, box.backgroundColor) };
        });
    })(),
    /* THE MARK ON EVERY CARD · REVERSED 2026-07-30. What stood here for one
       build was twiceRunning, which asserted that a publisher's wordmark was
       never drawn on two consecutive cards — the run rule. The reader saw that
       drawn and rejected it ("i dont like how some lose the logo it just
       confuses. logo on every is better"), so the gate is turned over: every
       card names its publisher, and no card carries the withdrawn form. */
    unmarked: cards.filter((card) => !card.querySelector(".taught-here-mark")).length,
    reduced: document.querySelectorAll("[data-repeat]").length,
    // The plate is the ONE publisher crossing on a card, and only where a mark
    // is approved: everyone else takes their name in type.
    plated: cards.filter((card) => {
      const mark = card.querySelector(".taught-here-mark");
      return mark ? getComputedStyle(mark).backgroundImage !== "none" : false;
    }).length,
    footing: lens.querySelector(".taught-here-footing")?.textContent?.trim() ?? null,
    walk: lens.querySelector(".taught-here-walk")?.getAttribute("aria-label") ?? null,
    // Two sizes, no more.
    sizes: [...new Set([...lens.querySelectorAll(".resource-card")].map((card) => card.dataset.weight))].sort(),
  };
})()`);
assert.equal(room.rooms, 1, "a chapter has one room for its material");
assert.ok(room.cards > 0, "the room drew no cards");
assert.equal(room.otherSurfaces, 0,
  "a second surface is drawing this chapter's material — that is the duplication coming back");
assert.equal(room.playOutside, 0,
  "something outside the room is offering to start audio");
assert.equal(room.grammar, true, "a card is missing part of the one face");
assert.equal(room.stray, false,
  "a relation word reached a card's face; aboutness does its work in the ordering");
assert.deepEqual(room.controls, [1], "a card holds exactly one control, and it is the card");
assert.ok(room.spoken > 0, "no card says its claim in its accessible name");
assert.ok(room.shelfChips > 1, "the publisher shelf is missing");
assert.ok(room.shelfColoured >= room.shelfChips - 1,
  `${room.shelfChips - room.shelfColoured} shelf chips have no colour on them`);
assert.ok(room.shelfMarked > 0, "no approved mark is drawn on the shelf");
assert.equal(room.filter, true, "the shelf is a drawer again rather than a filter");
assert.equal(room.settings, true, "the route into resource settings is missing from the shelf");
assert.deepEqual(room.shelfPlate, ["26/6px"],
  `the shelf left the plate law: ${room.shelfPlate.join(", ")} (want 26px tall, 6px corner)`);
assert.ok(room.shelfTracks.every((track) => track === "one" || track === "two"),
  `the register is justified again — a plate is one track or two, never ${room.shelfTracks.join(", ")}`);
assert.equal(room.shelfTallies, room.shelfChips,
  `${room.shelfChips - room.shelfTallies} plates carry no tally; a numeral column with holes in it is not a column`);
/* The reference chapter's shelf is short and may hold only approved marks; the
   dense chapter below carries all eleven and is where the count is gated. */
for (const plate of room.shelfInk) {
  assert.ok(plate.ratio >= ACCENT_FLOOR,
    `${plate.source} sets its name on its own ground at ${plate.ratio}:1`);
}
assert.equal(room.unmarked, 0,
  `${room.unmarked} cards do not name their publisher; the mark is on every card`);
assert.equal(room.reduced, 0,
  "the run's reduced plate is back; a mark present on some cards and not others is what the reader rejected");
assert.ok(room.sizes.every((size) => ["heavy", "light"].includes(size)),
  `the card family grew a third size: ${room.sizes.join(", ")}`);
assert.match(room.footing ?? "", /machine-read/i,
  "the two footings are not disclosed on the surface that shows them");
assert.doesNotMatch(room.footing ?? "", /not been asked/i,
  "the reading surface is telling a reader what is on our outreach backlog");
/* RESTATED 2026-07-30 (taste pass). The shape asserted here was
   "— N treatments, longest first, X in all", which is the specification chain
   the room's own voice replaced; what the gate is FOR is that the offer
   declares itself before it is pressed, and it now declares one thing more —
   that a five-hour walk can be left. Facts, not phrasing. */
assert.match(room.walk ?? "", /^Listen through .+ — the \d+ fullest treatments, end to end, about .+\. Leave it whenever you like\.$/,
  "the walk must declare its whole extent, and that it can be left, before it is pressed");
console.log("the room", room);

await sleep(200);
await screenshot("paper-resources", ".living-margin");

/* One transport language, and the room's cards were the fourth surface to
   start audio with no transport glyph at all. The card's press IS the
   transport, so it carries the FACE rather than a second button inside it. */
const family = await evaluate(`(() => {
  const lens = document.querySelector("#margin-resources-panel:not([hidden])");
  const card = [...lens.querySelectorAll(".resource-card-face")]
    .find((candidate) => candidate.querySelector('.taught-here-plate[data-source="naked-bible"]'));
  const mark = card?.querySelector(".resource-card-play");
  const style = mark ? getComputedStyle(mark) : null;
  return {
    card: Boolean(card),
    isFamily: mark?.classList.contains("transport-play") ?? null,
    size: style ? Math.round(parseFloat(style.width)) : null,
    filled: style?.backgroundColor ?? null,
    round: style?.borderRadius ?? null,
    glyphs: mark?.querySelectorAll(".transport-glyph").length ?? null,
    grid: [...(mark?.querySelectorAll("svg") ?? [])].map((svg) => svg.getAttribute("viewBox")),
    // One tab stop for the offer, on the card itself.
    stops: card ? card.querySelectorAll("button").length : null,
  };
})()`);
assert.equal(family.card, true, "no Naked Bible card in the room to press");
assert.equal(family.isFamily, true, "the card's play is not in the transport family");
/* 20 → 14, dated 2026-07-30 with the card's ground. The mark left the card's
   head — where it was a 20px disc of amber beside the publisher's plate, twice
   per card and nine hundred times per chapter — and moved to the foot, against
   the extent it acts on. What this gate is FOR is that the room speaks the one
   transport language rather than inventing a fifth; the scale is the room's,
   and the room's is now the numeral line's. */
assert.equal(family.size, 14, "the family at the room's own scale");
assert.equal(family.glyphs, 2, "play and pause are both in the tree so one can cross into the other");
assert.deepEqual([...new Set(family.grid)], ["0 0 24 24"], "one icon grid");
assert.notEqual(family.filled, "rgba(0, 0, 0, 0)", "the family is filled, on every surface");
assert.equal(family.stops, 0, "the card is the control; a second button inside it is a second tab stop");
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
/* The LONGEST Naked Bible treatment on this chapter, marked by name. A bare
   `:has(...)` selector took whichever came first, which on this chapter is a
   forty-eight-second mention forty-two minutes into a forty-four minute file —
   a launch with no room after it for any of the seek assertions below, and not
   what a reader arriving at a chapter is being offered first. The room's own
   ordering puts the longest treatment first, so this is also a gate on the
   ordering: the card the tour wants is the card a reader is offered. */
await evaluate(`(() => {
  const lens = document.querySelector("#margin-resources-panel:not([hidden])");
  const cards = [...lens.querySelectorAll('.resource-card-face')]
    .filter((card) => card.querySelector('.taught-here-plate[data-source="naked-bible"]'))
    .filter((card) => /worked through/.test(card.getAttribute("aria-label") ?? ""));
  cards[0]?.setAttribute("data-qa-target", "press");
  return cards.length;
})()`);
/* Brought into the room's own viewport BY HAND, because the room is nine
   hundred cards long on a dense chapter and every card carries
   `content-visibility: auto`. A skipped card still has a box — that is what
   `contain-intrinsic-size` is for — but its CONTENTS have no geometry at all,
   so a coordinate press taken off the face lands at 0,0, which on this shell
   is the sidebar. Scroll the card, not the face. */
await evaluate(`document.querySelector('[data-qa-target="press"]')?.closest(".resource-card")?.scrollIntoView({ block: "center" })`);
await sleep(320);
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

  /* And the room's cards, on the same sweep and in the same engine. */
  const grounds = await evaluate(GROUND);
  assert.ok(grounds, "the ground probe found no card");
  for (const row of grounds) {
    assert.equal(row.groundIsBrand, false,
      `${theme}/${row.source}: the card's ground is the raw brand colour — an homage, not a reproduction`);
    assert.equal(row.groundIsPaper, false,
      `${theme}/${row.source}: the card's ground collapsed back onto the app's paper; the homage is gone`);
    assert.ok(row.quietOnGround >= ACCENT_FLOOR,
      `${theme}/${row.source}: the card's quietest ink is ${row.quietOnGround}:1 on its own ground`);
    assert.ok(row.quietOnHover >= ACCENT_FLOOR,
      `${theme}/${row.source}: the card's quietest ink is ${row.quietOnHover}:1 under the pointer`);
  }
  const quietest = grounds.reduce((low, row) => Math.min(low, row.quietOnGround, row.quietOnHover), Infinity);
  console.log(`grounds ${theme}: ${grounds.length} publishers, quietest ink ${quietest}:1`);
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

/* ── Density is a ROOM, not a drawer ──────────────────────────────────────
   RESTATED 2026-07-30. This measured a density CONTROL — "897 more, shortest
   last" as a button rather than as inert text — which was the right fix for a
   block that had to live at the foot of a tab. The reader rejected the shape
   itself: no drawers of 25, no inventory sentence, no counts standing in front
   of the answer.

   Measured on a dense chapter rather than the reference one, because this is
   the whole point of the room and the reference chapter has eleven entries.
   Genesis 1 holds 922 moments. Every one of them is a card, the ordering is
   what makes the first screen the right one, and the ones nobody has reached
   are cheap until they are. */
await navigatePassage(DENSE);
await evaluate(`[...document.querySelectorAll(".margin-tab")].find((tab) => tab.textContent.startsWith("Resources"))?.click()`);
await waitFor(`Boolean(document.querySelector('#margin-resources-panel:not([hidden]) .resources'))`, 10_000);
await waitFor(`document.querySelectorAll(".resource-card").length > 100`, 25_000);
/* From the top, so what is captured is the room a reader arrives in: the shelf
   over the walk over the first screen of cards. The tour has scrolled this
   panel to reach a card by name further up. */
await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
await sleep(500);
const density = await evaluate(`(() => {
  const lens = document.querySelector("#margin-resources-panel:not([hidden])");
  const cards = [...lens.querySelectorAll(".resource-card")];
  const first = cards[0]?.querySelector(".resource-card-face");
  return {
    cards: cards.length,
    // No drawer, no page, no sentence in front of the rest of the answer.
    drawers: document.querySelectorAll(".taught-here-group, .taught-here-more").length,
    lens: Boolean(lens),
    // The room's own cheapness, which is what makes drawing all of them honest.
    lazy: cards.filter((card) => getComputedStyle(card).contentVisibility === "auto").length,
    // And the first card is the strongest answer rather than the first row of
    // an alphabet: aboutness ranks a long treatment of this chapter above a
    // one-line mention of it.
    firstSays: first?.getAttribute("aria-label") ?? null,
    firstExtent: first?.querySelector(".resource-card-extent")?.textContent?.trim() ?? null,
    heavy: lens.querySelectorAll('.resource-card[data-weight="heavy"]').length,
  };
})()`);
assert.ok(density.cards > 25,
  `the dense chapter drew ${density.cards} cards — the room is capping the answer again`);
assert.equal(density.drawers, 0, "the drawer is back in front of the answer");
assert.equal(density.lazy, density.cards, "the room is drawing nine hundred cards eagerly");
/* Heavy is rare by construction — within three quarters of a point of the best
   answer in the room — and on a chapter with nine hundred entries that is a
   handful. A room where a tenth of the cards are heavy is a chart. */
assert.ok(density.heavy >= 1, "no card in a 900-card room earned the second size");
assert.ok(density.heavy <= Math.max(6, Math.round(density.cards * 0.02)),
  `${density.heavy} of ${density.cards} cards took the heavy size; the family is a chart`);
assert.match(density.firstSays ?? "", /worked through/,
  "the room opens on something other than a treatment of this chapter");
console.log("density", density);

/* ── THE SHELF, WHERE ALL ELEVEN ARE ON IT · added 2026-07-30 ───────────────
   The reference chapter carries two or three publishers; Genesis 1 carries the
   whole library, which is the only place the shelf's own composition and its
   ink can be measured against every palette at once.

   THE INK is the gate that matters. The chip declared a ground and no colour,
   so a <button>'s initial ButtonText — flat black — was painted on five
   publishers' own colours: Radically Christian measured 1.75:1 here. Measured
   in the engine rather than read off the palette, because the failure was the
   ABSENCE of a declaration and a palette audit would have found nothing. */
const shelfInk = await evaluate(`(() => {
  const lens = document.querySelector("#margin-resources-panel:not([hidden])");
  const chips = [...lens.querySelectorAll(".resource-shelf .trusted-resource-imprint")];
  const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = (colour) => {
    const [r, g, b] = colour.match(/[\\d.]+/g).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const against = (ink, ground) => {
    const [high, low] = [luminance(ink), luminance(ground)].sort((a, b) => b - a);
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
  };
  return chips
    .filter((chip) => {
      const name = chip.querySelector(".trusted-resource-source");
      const ground = getComputedStyle(chip).backgroundColor;
      return name && getComputedStyle(name).backgroundImage === "none"
        && ground !== "rgba(0, 0, 0, 0)";
    })
    .map((chip) => {
      const box = getComputedStyle(chip);
      const after = getComputedStyle(chip, "::after");
      const ink = after.content !== "none" ? after.color : box.color;
      return { source: chip.dataset.source, ratio: against(ink, box.backgroundColor) };
    });
})()`);
assert.ok(shelfInk.length >= 4,
  `only ${shelfInk.length} name-in-type plates on the dense chapter's shelf; the ink gate is looking at nothing`);
for (const plate of shelfInk) {
  assert.ok(plate.ratio >= ACCENT_FLOOR,
    `${plate.source} sets its name on its own ground at ${plate.ratio}:1`);
}
console.log("shelf ink", shelfInk);

/* ── AND THE TALLY, ON EVERY PLATE · added 2026-07-30 ───────────────────────
   The ink gate above only sees the five plates that draw a NAME — an approved
   mark is artwork and its ink is never painted — so the numeral was never
   measured anywhere, on any plate. It is text, and it was set at
   `opacity: 0.74` over the publisher's own ink: that takes 40 Minutes' 5.42:1
   to roughly 3.4 and Working Preacher's to about 3.6, under Law 6's floor, on
   every plate on the shelf. Full strength now, quiet by size, and measured
   here on all eleven because the six with artwork have no other textual gate
   at all. */
const shelfTally = await evaluate(`(() => {
  const lens = document.querySelector("#margin-resources-panel:not([hidden])");
  const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = (colour) => {
    const [r, g, b] = colour.match(/[\\d.]+/g).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const against = (ink, ground) => {
    const [high, low] = [luminance(ink), luminance(ground)].sort((a, b) => b - a);
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
  };
  return [...lens.querySelectorAll(".resource-shelf .trusted-resource-imprint")]
    .map((chip) => {
      const tally = chip.querySelector(".trusted-resource-imprint-count");
      if (!tally) return null;
      const box = getComputedStyle(tally);
      const ground = getComputedStyle(chip).backgroundColor;
      const alpha = Number(box.opacity);
      return {
        source: chip.dataset.source,
        opacity: alpha,
        ratio: against(box.color, ground),
      };
    })
    .filter(Boolean);
})()`);
assert.ok(shelfTally.length >= 10,
  `only ${shelfTally.length} tallies on the dense chapter's shelf; the tally gate is looking at nothing`);
for (const plate of shelfTally) {
  assert.equal(plate.opacity, 1,
    `${plate.source}'s tally is drawn at ${plate.opacity} of its own ink; a number is quiet by size or it is under the floor`);
  assert.ok(plate.ratio >= ACCENT_FLOOR,
    `${plate.source} sets its tally on its own ground at ${plate.ratio}:1`);
}
console.log("shelf tally", shelfTally);

await screenshot("paper-resources-dense", ".living-margin");

/* The three discovery treatments, from the same cards and the same ordering.
   NOT a product control and never asserted as one — see the room's own note
   and tests/resources-contract. The tour renders each of them so the reader
   can choose between pictures of real data rather than between descriptions. */
for (const shape of ["weight", "even", "spine"]) {
  await evaluate(`(() => {
    document.documentElement.dataset.discoveryShape = ${JSON.stringify(shape)};
    window.dispatchEvent(new Event("quire:discovery-shape"));
  })()`);
  await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
  await sleep(450);
  /* Captured against the PANEL rather than the lens. The lens is nine hundred
     cards and fifty thousand pixels tall on this chapter, and a capture that
     names it scrolls it into view by its own centre — which is a picture of
     the middle of the room rather than of the room a reader arrives in. */
  await screenshot(`paper-discovery-${shape}`, ".living-margin");
}
await evaluate(`(() => {
  delete document.documentElement.dataset.discoveryShape;
  window.dispatchEvent(new Event("quire:discovery-shape"));
})()`);
await sleep(300);
await navigatePassage(ELSEWHERE);
await sleep(200);

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

/* ── THE COLUMN SWAP ───────────────────────────────────────────────────────
   RESTATED 2026-07-30, and it replaces the three assertions that stood here.

   They asserted that opening the sheet moved NOTHING outside itself — the
   dock's reservation, the study panel's floor and the toast lane all unchanged
   — because Build 2's sheet was an overlay that opened upward over the panel.
   That was honest about layout and dishonest about attention: an open sheet
   covered most of the margin, so two surfaces claimed one column at once.

   The column has two residents now and exactly one of them is unfolded. What
   this gate holds is the geometry that makes that true: the two share a left
   edge and a width, the folded tab sits at the column's own top, the player
   takes everything from one gutter below it down to the frame's inset, and the
   panel behind the tab is inert rather than merely hidden. */
const openSheet = await evaluate(`(() => {
  const dock = document.querySelector(".podcast-dock");
  const margin = document.querySelector(".living-margin");
  const tab = document.querySelector(".margin-fold-tab");
  const panel = margin?.querySelector(".margin-workspace-panel");
  const box = dock.getBoundingClientRect();
  const marginBox = margin?.getBoundingClientRect() ?? null;
  const tabBox = tab?.getBoundingClientRect() ?? null;
  const line = document.querySelector(".podcast-transcript-line");
  const lineStyle = line ? getComputedStyle(line) : null;
  const measure = (() => {
    if (!line || !lineStyle) return null;
    const canvas = document.createElement("canvas");
    const paint = canvas.getContext("2d");
    paint.font = lineStyle.fontSize + " " + lineStyle.fontFamily;
    const alphabet = "abcdefghijklmnopqrstuvwxyz ";
    const per = paint.measureText(alphabet).width / alphabet.length;
    const width = line.getBoundingClientRect().width
      - parseFloat(lineStyle.paddingLeft) - parseFloat(lineStyle.paddingRight);
    return { width: Math.round(width), characters: Math.round(width / per) };
  })();
  return {
    dock: { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) },
    margin: marginBox ? { top: Math.round(marginBox.top), bottom: Math.round(marginBox.bottom), left: Math.round(marginBox.left), width: Math.round(marginBox.width) } : null,
    folded: margin?.getAttribute("data-folded") ?? null,
    tab: tabBox ? { height: Math.round(tabBox.height), text: tab.textContent?.trim() ?? "" } : null,
    inert: panel?.hasAttribute("inert") ?? null,
    /* Asked rather than counted. inert leaves the controls in the DOM — the
       panel keeps its React state and its scroll, which is the whole point of
       folding rather than closing — so what has to be true is that none of
       them can TAKE focus. */
    reachable: (() => {
      const first = panel?.querySelector("button:not([disabled])");
      if (!first) return 0;
      const held = document.activeElement;
      first.focus();
      const took = document.activeElement === first ? 1 : 0;
      if (held instanceof HTMLElement) held.focus();
      return took;
    })(),
    innerHeight: window.innerHeight,
    inset: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-inset"))),
    gutter: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pane-gutter"))),
    /* Measured through a probe rather than parsed. --frame-top is composed —
       calc(var(--page-inset) + var(--register-strip)) — and getPropertyValue
       hands back the SPECIFIED value for a custom property, which parseFloat
       reads as NaN. A one-frame element with that height is the only way to
       ask the engine what the token resolves to. */
    frameTop: (() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;height:var(--frame-top)";
      document.body.append(probe);
      const height = Math.round(probe.getBoundingClientRect().height);
      probe.remove();
      return height;
    })(),
    bodyTop: Math.round(document.querySelector(".scripture-body").getBoundingClientRect().top),
    verseWidth: Math.round(document.querySelector(".verse-line")?.getBoundingClientRect().width ?? 0),
    measure,
  };
})()`);
assert.equal(openSheet.folded, "true", "the player took the column and the margin did not fold");
assert.equal(openSheet.margin.left, openSheet.dock.left,
  "the two residents do not share a left edge");
assert.equal(openSheet.margin.width, openSheet.dock.width,
  "the two residents do not share a width");
/* The column's own top is --frame-top, which is where `.scripture-body`
   actually begins. The stylesheet composes --player-column-top from that token
   rather than asserting a number, and this is where the two are compared. */
assert.equal(openSheet.bodyTop, openSheet.frameTop,
  `the study column begins at ${openSheet.bodyTop}, not at --frame-top ${openSheet.frameTop}`);
assert.equal(openSheet.margin.top, openSheet.bodyTop, "the folded tab is not at the column's top");
assert.equal(openSheet.dock.top, openSheet.margin.bottom + openSheet.gutter,
  "the player does not begin one gutter below the folded tab");
assert.equal(openSheet.innerHeight - openSheet.dock.bottom, openSheet.inset,
  "the player does not reach the frame's own bottom inset");
assert.equal(openSheet.inert, true, "the folded panel is hidden but still reachable");
assert.equal(openSheet.reachable, 0, "a control inside the folded panel is still in the tab order");
assert.match(openSheet.tab?.text ?? "", /·/, "the folded tab must name what it is still following");
assert.ok(openSheet.tab.height <= 40, `the folded tab is ${openSheet.tab.height}px — that is a panel`);
assert.ok(openSheet.dock.height > beforeSheet.rect.height + 200,
  "the player did not actually take the column");
/* THE MEASURE, which the column swap is what makes possible. 46 characters was
   a documented defect and the old comment said it "cannot be more without
   taking width from the study panel the dock is inscribed in" — the player IS
   that panel's column now. The floor is the app's own reading band. */
assert.ok((openSheet.measure?.characters ?? 0) >= 52,
  `the transcript measures ${openSheet.measure?.characters} characters — the column swap bought nothing`);
/* And it is not bought from the passage: the reading page's text is max-width
   bound, so widening the column spends the stage's side air and stops there. */
assert.equal(openSheet.verseWidth, beforeSheet.verseWidth,
  `opening the player re-wrapped the reading page: ${beforeSheet.verseWidth} → ${openSheet.verseWidth}`);
console.log("the column swap", openSheet);
await screenshot("paper-column-open");
await screenshot("paper-column-folded-tab", ".margin-fold-tab");

/* THE SWAP ITSELF, mid-gesture. Both residents are moving here — the tab
   unfolding downward and the player folding back into its corner — and the
   only way to know whether that reads as one movement or as two surfaces
   fighting is to look at a frame of it. 110ms is a little under half of
   --transport-move, so it is the middle of the transition rather than either
   end of it. The settle is zero on purpose; see `screenshot`. */
await evaluate(`document.querySelector('.margin-fold-tab')?.click()`);
await sleep(110);
await screenshot("paper-column-swapping", null, { settle: 0 });
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "false"`);
await sleep(320);
/* And the resting state: the margin unfolded, the player folded into the
   bottom of the same column. The two folded forms are each other's inverse and
   this is the picture that says whether that is true. */
await parkPointer();
await screenshot("paper-column-rest");
const rest = await evaluate(`(() => {
  const dock = document.querySelector(".podcast-dock").getBoundingClientRect();
  const margin = document.querySelector(".living-margin");
  const box = margin.getBoundingClientRect();
  return {
    folded: margin.getAttribute("data-folded"),
    tab: Boolean(document.querySelector(".margin-fold-tab")),
    marginLeft: Math.round(box.left),
    dockLeft: Math.round(dock.left),
    marginWidth: Math.round(box.width),
    dockWidth: Math.round(dock.width),
    seam: Math.round(dock.top - box.bottom),
    arrow: document.querySelector('.podcast-mast-icon[aria-expanded="false"]')?.getAttribute("aria-label") ?? null,
  };
})()`);
assert.equal(rest.folded, null, "the margin is still folded with the player back in its corner");
assert.equal(rest.tab, false, "the folded tab outlived the fold");
assert.equal(rest.marginLeft, rest.dockLeft, "at rest the two residents do not share a left edge");
assert.equal(rest.marginWidth, rest.dockWidth, "at rest the two residents do not share a width");
assert.ok(rest.seam >= 0 && rest.seam <= 24, `the seam between the residents is ${rest.seam}px`);
assert.match(rest.arrow ?? "", /takes the study column$/,
  "the arrow on the folded resident must say what it is about to do");
console.log("the column at rest", rest);
/* Back open for the transcript assertions below, which are about the sheet's
   own machine rather than about the column. */
await clickElement('.podcast-mast-icon[aria-expanded="false"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "true"`);
await sleep(320);

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
  await screenshot(`${theme}-resources`, ".living-margin");
  /* And the column swap in every atmosphere. Both residents are on paper the
     reader chose — the folded tab, the open player, and the one seam between
     them — so this is the picture that says whether the two forms still read
     as one column when the polarity flips. */
  await clickElement('.podcast-mast-icon[aria-expanded="false"]');
  await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "true"`);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await parkPointer();
  await screenshot(`${theme}-column-open`);
  await clickElement('.podcast-mast-icon[aria-expanded="true"]');
  await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "false"`);
  await parkPointer();
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
/* The room in the reader's own two colours. Its ancestor had NO forced-colors
   coverage at all — hover was the only thing distinguishing a pointed-at row
   and it flattens to Canvas — and the card family it replaces it with is
   covered here from the beginning: the face's hairline, the running mark, the
   ↗ ring, and the plate's one documented opt-out. */
await screenshot("forced-colors-resources", ".living-margin");
/* The column in the reader's own two colours: the folded tab's kicker, its
   seal dot where there is one, and the open player beside it. */
await clickElement('.podcast-mast-icon[aria-expanded="false"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "true"`);
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await parkPointer();
await screenshot("forced-colors-column-open");
await clickElement('.podcast-mast-icon[aria-expanded="true"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "false"`);
await parkPointer();
const forcedRoom = await evaluate(`(() => {
  const face = document.querySelector(".resource-card-face");
  const plate = document.querySelector(".resource-card-plate");
  return {
    faceBorder: face ? getComputedStyle(face).borderTopColor : null,
    faceGround: face ? getComputedStyle(face).backgroundColor : null,
    plateOptOut: plate ? getComputedStyle(plate).forcedColorAdjust : null,
  };
})()`);
assert.notEqual(forcedRoom.faceBorder, forcedRoom.faceGround,
  "a card's own edge disappears in the reader's colours");
assert.equal(forcedRoom.plateOptOut, "none",
  "the plate must keep the publisher's own pair — the marks are approved reverses");
console.log("forced colors, the room", forcedRoom);
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

/* ── Exclusivity at every width ────────────────────────────────────────────
   The compact band is where the audit's ⊘ finding lived: an already-crushed
   pane, plus a reservation for a dock whose height had grown, opened a strip
   of dead canvas between them. The answer here is the answer at 1512 — the two
   residents never hold the band at once. */
await clickElement('.podcast-mast-icon[aria-expanded="false"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "true"`);
await sleep(360);
const narrowOpen = await evaluate(`(() => {
  const dock = document.querySelector(".podcast-dock").getBoundingClientRect();
  const margin = document.querySelector(".living-margin");
  const box = margin?.getBoundingClientRect() ?? null;
  return {
    folded: margin?.getAttribute("data-folded") ?? null,
    marginHeight: box ? Math.round(box.height) : null,
    overlap: box ? Math.round(box.bottom - dock.top) : null,
    dockHeight: Math.round(dock.height),
    inner: window.innerHeight,
  };
})()`);
assert.equal(narrowOpen.folded, "true", "the compact margin did not fold for the open player");
assert.ok(narrowOpen.marginHeight <= 44,
  `the folded margin is ${narrowOpen.marginHeight}px at compact width`);
assert.ok(narrowOpen.overlap <= 0,
  `the folded margin runs ${narrowOpen.overlap}px under the open player`);
await parkPointer();
await screenshot("paper-column-narrow");
console.log("narrow, open", narrowOpen);
await clickElement('.podcast-mast-icon[aria-expanded="true"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "false"`);
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
    /* The SENTENCE, without the chip beside it. The way out lives on the same
       line since 2026-07-30 (see C1), so reading the row's whole text reads
       the button too. */
    refusal: line?.querySelector(".podcast-dock-refusal-said")?.textContent?.trim() ?? null,
    // A truncated reason is not a reason. The sentence has to fit the line it
    // was given, in the language the app is set to, without an ellipsis.
    clipped: (() => {
      const said = line?.querySelector(".podcast-dock-refusal-said");
      return said ? said.scrollWidth > said.clientWidth : null;
    })(),
    // In the app's error ink. It used to be --resource-ink — the same colour as
    // every other word on the surface — on a dock otherwise byte-identical to
    // paused, so a failure cost ten pixels of body text and nothing else.
    ink: line ? getComputedStyle(line.querySelector(".podcast-dock-refusal-said") ?? line).color : null,
    error,
    seal: shell.getPropertyValue("--error").trim(),
    clock: document.querySelector(".podcast-dock-clock"),
    height: Math.round(document.querySelector(".podcast-dock").getBoundingClientRect().height),
    stop: Boolean(document.querySelector('[aria-label^="Stop"]')),
    out: Boolean(document.querySelector(".podcast-mast-out")),
    outSays: document.querySelector(".podcast-mast-out")?.getAttribute("aria-label") ?? null,
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
/* C1 · and the way out the sentence is written around. "The way out is the
   link that was always beside play" was still in the code while the link
   itself had become a sentence inside a sheet that is SHUT in this state. */
assert.equal(refused.out, true, "the refusal has no route to the publisher's own page");
assert.match(refused.outSays ?? "", /^Open .+ at .+ — opens the official page$/,
  "the way out does not say where it goes");
await parkPointer();
await screenshot("paper-dock-refused", ".podcast-dock");
console.log("refused", refused);

// Stopping is the reader saying they are done, and the file is let go with the
// dock rather than left open on a server that is not ours.
await clickElement('[aria-label^="Stop"]');
await waitFor(`!document.querySelector(".podcast-dock")`);
/* The dock leaves immediately and the FILE leaves one ramp later — ~120ms, so
   that letting go of a running episode is not a click in the reader's ears.
   See the ease note in PodcastPlayer: the ramp's callback is what releases the
   element, so this waits for the release rather than racing it. */
await waitFor(`document.querySelector("audio")?.getAttribute("src") === null`, 2_000);
const stopped = await evaluate(DOCK_TRUTH);
assert.equal(stopped.present, false);
assert.equal(stopped.audioSrc, null, "stopping must release the publisher's file, not merely pause it");
assert.equal(stopped.folded, null, "stopping must give the study column back to the margin");
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
