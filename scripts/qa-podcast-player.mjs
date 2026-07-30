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
 * controls move the file; and stopping releases it. The tour plays audio and
 * always stops it before leaving.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const CDP_HTTP = `http://localhost:${process.env.CDP_PORT ?? "9222"}/json/list`;
const OUT_DIR = "docs/ui-audit/podcast-player";
const CAPTURE_SCREENSHOTS = !process.argv.includes("--no-screenshots");
// The Naked Bible catalogue is titled by passage and covers 1 Samuel end to
// end, so this chapter is guaranteed an episode with an audioUrl on it.
const PASSAGE = "1 Samuel 30";
const ELSEWHERE = "Acts 19";

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

async function screenshot(name, selector = null) {
  if (!CAPTURE_SCREENSHOTS) return;
  let clip;
  if (selector) {
    clip = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x - 26, y: rect.y - 26, width: rect.width + 52, height: rect.height + 52, scale: 2 };
    })()`);
    if (!clip) throw new Error(`Cannot capture missing element: ${selector}`);
  }
  await cdp.send("Page.bringToFront");
  await sleep(240);
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
    publisher: dock.querySelector(".podcast-mast-source")?.textContent?.trim(),
    passage: dock.querySelector(".podcast-mast-passage")?.textContent?.trim() ?? null,
    title: dock.querySelector(".podcast-dock-title")?.textContent?.trim(),
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
    // What the panel gives up to the player, and what is actually left between
    // them. The reservation moved from padding to margin when the panel stopped
    // growing a floor and started ENDING above the player — "extra padding only
    // moves the end of the list; everything before the end still scrolls under
    // the player" (styles.css) — and this went on reading paddingBottom, which
    // is now the panel's own gutter and nothing to do with the dock.
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
    rect: (() => { const r = dock.getBoundingClientRect(); return { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; })(),
  };
})()`;

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
await setMargin(true);
await setTheme("light");
await navigatePassage(PASSAGE);

// Before the press. The element exists — it has to, or there would be nothing
// to press play on — and it holds no source, which is the whole of what
// `preload="none"` buys: rendering a card tells the publisher nothing.
const atRest = await evaluate(DOCK_TRUTH);
assert.equal(atRest.present, false, "the dock draws itself only once something is playing");
assert.equal(atRest.audioSrc, null, "audio must not be fetched before a reader presses play");
console.log("at rest", atRest);

await waitFor(`Boolean(document.querySelector('.trusted-resource-imprint[data-source="naked-bible"]'))`, 20_000);
await clickElement('.trusted-resource-imprint[data-source="naked-bible"]');
await waitFor(`Boolean(document.querySelector(".trusted-resource-play"))`);
await screenshot("paper-card-before-press", ".trusted-resource-card");

await clickElement(".trusted-resource-play");
await waitFor(`Boolean(document.querySelector(".podcast-dock"))`);
// The publisher's server, over the network, for a real 40-odd-minute file.
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "playing"`, 30_000);
await waitFor(`(document.querySelector("audio")?.currentTime ?? 0) > 2`, 20_000);

const playing = await evaluate(DOCK_TRUTH);
assert.equal(playing.status, "playing");
assert.equal(playing.source, "naked-bible");
assert.equal(playing.layer, "player");
assert.equal(playing.publisher, "Naked Bible Podcast");
assert.match(playing.title ?? "", /^Naked Bible \d+:/);
assert.equal(playing.passage, PASSAGE, "the dock names the passage the episode works through");
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
   the player's top edge, one frame gutter clear and no more. The old form read
   paddingBottom against the dock's height and had never run: everything from
   the publisher assertion down was unreachable while this tour was stale.
   The tolerance is the ResizeObserver's: --podcast-dock-h is published on a
   measured change, so it trails the dock's live height by a pixel or two after
   the mast reflows. */
assert.ok(playing.marginClearance >= 0,
  `the panel overlaps the player by ${-playing.marginClearance}px`);
assert.ok(playing.marginClearance <= 24,
  `the panel stops ${playing.marginClearance}px above the player, which is not a seam`);
assert.ok(playing.marginFloor >= playing.rect.height - 4,
  `the panel's reservation is a guess rather than the dock's own height: ${playing.marginFloor} vs ${playing.rect.height}`);
console.log("playing", playing);

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
await stillPlaying("a passage change");
// The dock still names the episode's own passage, not the one now on screen.
assert.equal((await evaluate(DOCK_TRUTH)).passage, PASSAGE);

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

await setFocusMode(true);
await stillPlaying("focus mode");
await screenshot("paper-dock-focus-mode");
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
assert.equal(await evaluate(`document.activeElement?.className`), "podcast-transport-play",
  "F6 never reached the dock");
console.log("F6 reaches the dock");

/* The sheet, which nothing above this line has ever opened. Fourteen captures
   of a collapsed corner and none of the extended player: no transcript, no
   search, no follow state. What is proved here is the machine rather than the
   look — a hit is pressed, and the press has to do the WHOLE errand: move the
   audio, leave the filter, and put the transcript back under the voice. */
await clickElement('.podcast-mast-icon[aria-expanded="false"]');
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-expanded") === "true"`);
// Whatever the sheet settles on, so a missing transcript is reported as a
// missing transcript rather than as a timeout on a selector.
await waitFor(`Boolean(
  document.querySelector(".podcast-transcript-line")
  || document.querySelector(".podcast-refs-view")
  || document.querySelector(".podcast-sheet-empty")
)`, 20_000);
const settled = await evaluate(`(document.querySelector(".podcast-sheet-empty") ?? document.querySelector(".podcast-views"))?.textContent?.trim() ?? "nothing"`);

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
  };
})()`);
assert.ok(transcriptAtRest.lines > 20,
  `this episode has no transcript on disk — the sheet settled on "${settled}". `
  + "The tour needs one; pick a passage whose Naked Bible episode has been transcribed.");
assert.equal(transcriptAtRest.mode, "following", "the transcript rests on following");
assert.ok(transcriptAtRest.ladder <= 7, `the depth ramp reached ${transcriptAtRest.ladder} lines`);
assert.equal(transcriptAtRest.current, 1, "exactly one line is the one being spoken");
assert.equal(transcriptAtRest.search, true);
await screenshot("paper-dock-sheet", ".podcast-dock");
console.log("sheet", transcriptAtRest);

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
await waitFor(`document.querySelectorAll(".podcast-transcript-line").length < ${transcriptAtRest.lines}`);

const filtered = await evaluate(`(() => {
  const mark = document.querySelector(".podcast-transcript-line mark");
  const style = mark ? getComputedStyle(mark) : null;
  return {
    hits: document.querySelectorAll(".podcast-transcript-line").length,
    marks: document.querySelectorAll(".podcast-transcript-line mark").length,
    markBackground: style?.backgroundColor ?? null,
    markInk: style?.color ?? null,
    // The ladder is a claim about distance from a voice, and a filtered list is
    // not a place a voice is. It used to flatten every hit to data-d="0", which
    // is not "readable weight" but the ACTIVE-line treatment, so every hit was
    // drawn as though it were the one playing.
    flat: document.querySelector(".podcast-transcript")?.getAttribute("data-flat") ?? null,
    ladder: document.querySelectorAll(".podcast-transcript-line[data-d]").length,
    // Present DURING a search, which is the moment the reader is furthest from
    // the playhead and used to be the moment this was taken off the surface.
    follow: Boolean(document.querySelector(".podcast-transcript-follow")),
  };
})()`);
assert.ok(filtered.hits > 0, `"${chosen.word}" matched nothing`);
assert.ok(filtered.marks > 0, "a hit must mark the word it matched");
assert.notEqual(filtered.markBackground, "rgba(0, 0, 0, 0)",
  "the search mark resolved to nothing — see --accent in player.css");
assert.notEqual(filtered.markBackground, filtered.markInk,
  `the mark is the same colour as the text on it: ${filtered.markBackground}`);
assert.equal(filtered.flat, "true", "a filtered list has no playhead to be near");
assert.equal(filtered.ladder, 0, "no line in a filtered list is at a distance from the voice");
assert.equal(filtered.follow, true, "the way back to the voice must survive a search");
await screenshot("paper-dock-sheet-search", ".podcast-dock");
console.log("filtered", filtered);

/* Deep into the hit list but never its last row. A container scrolled to its
   end puts the final row at the bottom of the box, which is where the Follow
   pill floats — so a coordinate click on the last hit lands on the pill, clears
   the search, and looks exactly like a seek that did not happen. (Noted, not
   fixed: where the pill sits is the look, and the look is not this build's.) */
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
  };
})()`);
assert.ok(afterHit.time - beforeHit > 60,
  `pressing a hit moved the file ${(afterHit.time - beforeHit).toFixed(1)}s`);
assert.equal(afterHit.query, "", "pressing a hit must leave the filter, not park the reader inside it");
assert.equal(afterHit.mode, "following", "pressing a hit must put the transcript back under the voice");
assert.equal(afterHit.lines, transcriptAtRest.lines, "the whole transcript comes back around the hit");
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

// Pause, then the other three appearances.
await clickElement(".podcast-transport-play");
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "paused"`);
await screenshot("paper-dock-paused", ".podcast-dock");
await clickElement(".podcast-transport-play");
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "playing"`, 20_000);

for (const theme of ["dark", "porcelain", "onyx"]) {
  await setTheme(theme);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await parkPointer();
  const themed = await evaluate(DOCK_TRUTH);
  assert.equal(themed.present, true, `${theme} took the dock away`);
  assert.equal(themed.audioPaused, false, `${theme} stopped the episode`);
  await screenshot(`${theme}-dock`, ".podcast-dock");
  if (theme === "dark") await screenshot("ink-dock-in-place");
}
await setTheme("light");

/* A file the reader cannot be given. This points the element at a host the
   renderer's own policy refuses — `media-src 'self' https://nakedbiblepodcast.com`
   — which is both the shape of a network failure and the exact refusal an
   audioUrl that slipped past validation would produce. Two things are asserted:
   the policy does refuse it, and the dock says so.

   The element fires `error` and then `pause`, in that order, and a dock that
   took the second event as its answer would report "paused" about an episode it
   never reached. That is what this guards. */
await evaluate(`(() => {
  const element = document.querySelector("audio");
  element.src = "https://example.com/not-an-approved-media-host.mp3";
  element.load();
  void element.play().catch(() => {});
})()`);
await waitFor(`document.querySelector(".podcast-dock")?.getAttribute("data-status") === "failed"`);
const refused = await evaluate(`(() => {
  const line = document.querySelector(".podcast-dock-refusal");
  return {
    code: document.querySelector("audio").error?.code ?? null,
    refusal: line?.textContent?.trim() ?? null,
    // A truncated reason is not a reason. The sentence has to fit the line it
    // was given, in the language the app is set to, without an ellipsis.
    clipped: line ? line.scrollWidth > line.clientWidth : null,
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
assert.equal(refused.clock, null, "the refusal takes the clock's line rather than growing the dock");
/* Restated 2026-07-30 with a measured tolerance and the reason for it. The
   refusal takes the clock's line, and the clock's line is one pixel taller than
   the refusal's: both are 10px/1.3 type, but .podcast-rate carries 1px of
   vertical padding, so the flex row it sits in measures 15px where the bare
   sentence measures 13. The dock therefore loses a pixel when it fails. That is
   the rate pill's padding, which belongs to the build that owns the look — this
   asserts the claim the sentence was making (the dock does not resize when it
   fails) at the resolution the surface actually keeps it. Never ran before:
   everything from the publisher assertion down was unreachable. */
assert.ok(Math.abs(refused.height - playing.rect.height) <= 2,
  `a failure changed the dock's height: ${playing.rect.height} → ${refused.height}`);
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
await setFocusMode(original.focus);
await evaluate(`window.resizeTo(${JSON.stringify(originalBounds.width)}, ${JSON.stringify(originalBounds.height)}); window.moveTo(${JSON.stringify(originalBounds.left)}, ${JSON.stringify(originalBounds.top)})`);
await sleep(420);
cdp.ws.close();
console.log("Podcast player QA PASS");
