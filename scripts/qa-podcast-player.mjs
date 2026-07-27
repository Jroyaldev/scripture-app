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
    publisher: dock.querySelector(".podcast-dock-publisher")?.textContent?.trim(),
    passage: dock.querySelector(".podcast-dock-passage")?.textContent?.trim() ?? null,
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
    marginFloor: (() => {
      const margin = document.querySelector(".living-margin");
      return margin ? Math.round(parseFloat(getComputedStyle(margin).paddingBottom)) : null;
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
// Bottom-right, clear of the toolbar and of the rail's own footer. When the
// marking Dock is shelved it owns the bottom band, so the player takes the lane
// above it — one band, and three surfaces that step over each other in order.
const dockLane = { shelf: 104, stacked: 144, null: 24 }[String(playing.markingDock)];
assert.equal(playing.rect.right, 24, JSON.stringify(playing.rect));
assert.equal(playing.rect.bottom, dockLane, JSON.stringify(playing.rect));
// And the two surfaces the player displaces make room rather than being covered.
assert.ok(playing.toastLane >= playing.rect.bottom + playing.rect.height,
  `toasts would land on the player: ${playing.toastLane} vs ${playing.rect.bottom + playing.rect.height}`);
assert.ok(playing.marginFloor >= playing.rect.height,
  `the panel's last entry sits under the player: ${playing.marginFloor} vs ${playing.rect.height}`);
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
assert.match(refused.refusal ?? "", /^Could not reach the episode\. This needed the network\.$/);
assert.equal(refused.clipped, false, `the refusal is cut off: "${refused.refusal}"`);
assert.equal(refused.clock, null, "the refusal takes the clock's line rather than growing the dock");
assert.equal(refused.height, playing.rect.height, "a failure must not change the dock's height");
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
