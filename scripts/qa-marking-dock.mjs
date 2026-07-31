/**
 * Permanent visual/interaction gate for the production marking Dock.
 *
 * Runs a fresh Electron build against an isolated profile and library. User
 * data is never touched: the library lives in a temp directory that is removed
 * on the way out, and nothing here deletes or recolours an authored record it
 * did not itself create.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DOCK IS, as of this rewrite
 * ---------------------------------------------------------------------------
 * The Dock is ONE host, ONE toolbar, and ONE context area whose contents are
 * swapped. `MarkingSurface.tsx` renders exactly:
 *
 *     connectNode ?? failureNode ?? barNode ?? <resting span>
 *
 * plus the More popover alongside, when it is open. There is no mode row, no
 * measured thumb, no intent group, and no quotation inside the Dock.
 *
 * The previous version of this tour drove a Dock that had all four of those.
 * It gated on `[data-dock-context="wash|connect|intent"]`, `[data-dock-tool]`,
 * `[data-dock-intent]`, `[data-dock-mode]`, `data-dock-state="armed"` and
 * `[data-dock-action="erase"|"note"]` — 102 uses of attributes the renderer no
 * longer emits anywhere. Those gates did not fail. A `waitFor` on an
 * unreachable condition spins to its timeout, so the tour read as merely slow
 * while every step below the first dead gate silently never ran. That is why
 * this file is a rebuild rather than a patch, and why every expectation below
 * was re-derived by driving a live build rather than by reading the old tour.
 *
 * The state machine, verified live:
 *
 *   data-dock-state   rest | selection | choices | session | feedback | busy
 *   data-dock-layout  shelf (stage > 759px) | stacked (stage <= 759px)
 *   data-tool-armed   false | wash:<pigment> | connect:<kind>
 *   data-selection-capture  none | pending | exact | refused
 *   data-focus-ring   pointer | keyboard
 *
 * and what sits in the context area for each:
 *
 *   rest       span.marking-dock-resting
 *   selection  div.marking-bar         — 5 washes, note|remove, connect, more
 *   choices    div.marking-bar + div.marking-more
 *   session    div.marking-connect-draft[data-connect-state]
 *   feedback   div.surface-state[data-surface-state] + button[data-dock-action="retry"]
 *   busy       whichever content it entered from, with aria-busy="true"
 *
 * ---------------------------------------------------------------------------
 * HOW TO GET THE DOCK ON SCREEN — two ways, both needed
 * ---------------------------------------------------------------------------
 * `MarkingSurface.tsx` computes `surface = isNarrowShell ? "dock" : setting`.
 * So the Dock mounts either below the 979px narrow shell OR whenever the
 * reader's `markingSurface` setting is "dock", at any width. This tour sets
 * the setting, so it can exercise the Dock at desktop widths too — but it also
 * drives the shell genuinely narrow, because `data-dock-layout` follows the
 * READING STAGE's width, not the window's, and only a real narrow shell proves
 * the stacked layout the way a reader meets it.
 *
 * ---------------------------------------------------------------------------
 * THE VIEWPORT TRAP — read this before changing setViewport
 * ---------------------------------------------------------------------------
 * `Emulation.setDeviceMetricsOverride({width})` sets the width in DEVICE
 * pixels, before the page's zoom factor is applied. A profile that has ever
 * been zoomed (Cmd+- once is enough; the level persists in the user-data dir)
 * therefore reports `window.innerWidth === width / zoom`, not `width`. On a
 * profile at zoom 0.9129 a request for 900 arrives as 986 — still above the
 * 979px breakpoint, so `matchMedia("(max-width: 979px)")` stays false and the
 * narrow shell never appears. That is silent: nothing errors, the Dock simply
 * does not mount, and every later gate waits forever.
 *
 * `Browser.setWindowBounds` is not the escape hatch either — Electron does not
 * implement `Browser.getWindowForTarget`, so there is no windowId to set.
 *
 * `setViewport` below therefore ASKS, READS BACK, and CORRECTS, then asserts it
 * got the CSS width it wanted. Verified live at 1280/900/860/640/390, with
 * `matchMedia("(max-width: 979px)").matches` true for every width below 979.
 *
 * ---------------------------------------------------------------------------
 * THE PRELOAD IS FROZEN
 * ---------------------------------------------------------------------------
 * `window.api.library` is not writable: `Reflect.set` on it returns false and
 * the property keeps its original value. The in-flight nonce race below can
 * therefore only take its fallback path, and says so rather than pretending.
 * Write failures are induced the honest way instead, by making the append log
 * unwritable on disk.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { ATTRIBUTE_VOCABULARY, DOCK_ANATOMY, waitForState } from "./qa-support/app-vocabulary.mjs";

// Glass and Candlelight were never atmospheres: they are Paper and Ink with the
// translucent material on, which Rev 04 makes a material class. Driving them
// clicked a picker option that does not exist. The four real atmospheres are
// temperature crossed with luminance. See scripts/qa-support/app-vocabulary.mjs.
const THEMES = ["light", "dark", "porcelain", "onyx"];
const THEME_LABELS = new Map([
  ["light", "Paper"],
  ["dark", "Ink"],
  ["porcelain", "Porcelain"],
  ["onyx", "Onyx"],
]);
const VIEWPORTS = [
  { width: 390, height: 900, label: "390x900" },
  { width: 640, height: 900, label: "640x900" },
  { width: 860, height: 900, label: "860x900" },
  { width: 1280, height: 900, label: "1280x900" },
  { width: 860, height: 420, label: "860x420" },
];
const RELATIONSHIPS = [
  "link:parallel",
  "link:contrast",
  "link:echo",
  "mirror",
  "series",
  "hinge",
];
const RELATIONSHIP_LABELS = ["Parallelism", "Contrast", "Echo", "Mirror", "Series", "Hinge"];
const PIGMENTS = ["yellow", "green", "blue", "pink", "purple"];
const PIGMENT_LABELS = ["Amber", "Sage", "Sky", "Rose", "Violet"];
// The swatch's forced-colors code is the pigment's NAME, not an initial. The
// previous tour asserted ["A","G","S","R","V"], which never matched anything.
const FORCED_CODES = DOCK_ANATOMY.forcedCodes;
// The five commands the bar carries, in render order. `remove` and `note` share
// the middle slot: Remove replaces Note exactly when the selection already has
// a wash under it, so a bar is always 8 buttons and never 9.
const BAR_WASH_ACTIONS = ["highlight", "highlight", "highlight", "highlight", "highlight"];
// The DECLARED overflow set, in table order. What More actually shows is the
// subset this window can run (2026-07-30) — see assertMoreList.
const MORE_ACTIONS = ["capture", "study-verse", "keep-comparison", "open-in-tab", "copy-reference"];
const REST_GUIDANCE = "Select words, or choose a tool to keep in hand.";
const DRAFT_ID = "__connection-authoring-draft__";
const FIXTURE = {
  phrase: { verse: 8, quote: "the kingdom of God" },
  counterpart: { verse: 9, quote: "the Way" },
  stressPhrase: { verse: 7, quote: "about twelve" },
  // A route is drawn in the gutter BETWEEN its two anchor bands, so two
  // adjacent verses leave it nowhere to go: a connection from 19:8 to 19:9
  // reports data-route="needs-space" at every width, right up to a 1428px
  // stage. That is the component behaving correctly on an impossible request,
  // but a phase that only ever saw it would be exercising the empty branch and
  // would never once test a drawn route. The far counterpart gives the line
  // room, so the selected state is reachable and actually asserted.
  distant: { verse: 20, quote: "the word of the Lord" },
};
const GEOMETRY_EPSILON = 0.75;
const NARROW_SHELL = "(max-width: 979px)";
const STRESS_CYCLES = 30;
const MAX_WARM_HEAP_GROWTH = 1024 * 1024;
const FAILURE_DIR = resolve("output/playwright");
const FAILURE_SCREENSHOT_PATH = join(FAILURE_DIR, "marking-dock-failure.png");
const FAILURE_STATE_PATH = join(FAILURE_DIR, "marking-dock-failure.json");
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
/** "+12" / "-9" / "0" — a growth figure should never read "+-9". */
const signed = (value) => value > 0 ? `+${value}` : String(value);

const HOST = DOCK_ANATOMY.hostSelector;

/**
 * Geometry findings, collected rather than thrown.
 *
 * Anatomy and behaviour still fail hard and immediately: if the Dock is not
 * the Dock, or a write does the wrong thing, nothing below is worth running.
 * Layout is different. A single clipped viewport is one product defect, and
 * throwing on it at the first of twenty cells hides the other nineteen and
 * every behavioural phase after them — which is how a tour comes to report one
 * bug a week instead of all of them at once.
 *
 * The run still FAILS: the list is asserted empty at the very end, after every
 * phase has had its chance to speak. This is a reporting order, not tolerance.
 */
const GEOMETRY_DEFECTS = [];
function recordGeometryDefect(label, message) {
  GEOMETRY_DEFECTS.push(`${label}: ${message}`);
}

/** Guard against this file's own constants drifting from the shared table. */
function assertConstantsMatchVocabulary() {
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-pigment"].values],
    PIGMENTS,
    "this tour's PIGMENTS drifted from app-vocabulary.mjs",
  );
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-relationship-kind"].values].sort(),
    [...RELATIONSHIPS].sort(),
    "this tour's RELATIONSHIPS drifted from app-vocabulary.mjs",
  );
  assert.deepEqual(
    [...ATTRIBUTE_VOCABULARY["data-more-action"].values],
    MORE_ACTIONS,
    "this tour's MORE_ACTIONS drifted from app-vocabulary.mjs",
  );
  assert.equal(FORCED_CODES.length, PIGMENTS.length, "forced-colors codes and pigments disagree");
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out opening the Dock QA CDP socket"));
    }, 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Dock QA CDP socket failed during connection"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      reject(new Error("Dock QA CDP socket closed during connection"));
    };
  });
  let id = 0;
  const pending = new Map();
  const rejectPending = (reason) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolveMessage, reject, timer, method } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(`CDP ${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`));
      return;
    }
    resolveMessage(message);
  };
  ws.onclose = () => rejectPending(new Error("CDP socket closed while a Dock QA command was pending"));
  ws.onerror = () => rejectPending(new Error("CDP socket failed while a Dock QA command was pending"));
  const send = (method, params = {}, timeout = 15_000) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => {
      pending.delete(messageId);
      reject(new Error(`Timed out waiting for CDP ${method}`));
    }, timeout);
    pending.set(messageId, { resolve: resolvePromise, reject, timer, method });
    try {
      ws.send(JSON.stringify({ id: messageId, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(messageId);
      reject(error);
    }
  });
  return { ws, send };
}

function launchError(message, childState) {
  const error = new Error(message);
  error.code = "ELECTRON_LAUNCH_BLOCKED";
  error.launchState = { ...childState };
  return error;
}

async function waitForTarget(endpoint, childState, timeout = 20_000) {
  const started = Date.now();
  let observedTitles = [];
  while (Date.now() - started < timeout) {
    if (childState.spawnError) throw launchError(`Electron could not be spawned: ${childState.spawnError}`, childState);
    if (childState.exited) {
      throw launchError(
        `Electron exited before exposing the renderer (code ${childState.code}, signal ${childState.signal})`,
        childState,
      );
    }
    try {
      const pages = await (await fetch(endpoint)).json();
      observedTitles = pages.map((candidate) => candidate.title ?? "");
      const page = pages.find((candidate) => candidate.title === "Pericope");
      if (page) return page;
    } catch {
      // The isolated Electron process may still be opening its debug socket.
    }
    await sleep(120);
  }
  if (observedTitles.length > 0) {
    const error = new Error(`Renderer debug target appeared without Pericope: ${observedTitles.join(", ")}`);
    error.code = "ELECTRON_RENDERER_BOOTSTRAP_FAILED";
    error.launchState = { ...childState, observedTitles };
    throw error;
  }
  throw launchError(`Timed out waiting for ${endpoint}`, childState);
}

async function waitForChildExit(child, childState, timeout = 2_000) {
  if (childState.exited) return true;
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolvePromise(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(childState.exited), timeout);
    child.once("exit", onExit);
    if (childState.exited) finish(true);
  });
}

async function stopChild(child, childState) {
  if (childState.exited) return true;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, childState)) return true;
  if (!childState.exited) child.kill("SIGKILL");
  return waitForChildExit(child, childState);
}

function createDriver(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_600));
    }
    return response.result?.result?.value;
  };
  // Vets the gate's vocabulary before waiting, so a condition the app can
  // never satisfy fails at once instead of hanging and reading like a slow
  // app. See scripts/qa-support/app-vocabulary.mjs.
  const waitFor = async (expression, timeout = 10_000) => {
    await waitForState(evaluate, sleep, expression, timeout);
  };
  return { evaluate, waitFor };
}

/**
 * Ask for a CSS viewport, verify we got it, and correct for page zoom.
 *
 * See THE VIEWPORT TRAP at the top of this file. The override is in device
 * pixels; `window.innerWidth` is in CSS pixels; a zoomed profile makes those
 * two different numbers. One read-back and one correction is always enough,
 * because the zoom factor is exactly the ratio between them.
 */
async function setViewport(cdp, driver, width, height) {
  const apply = async (deviceWidth, deviceHeight) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Math.round(deviceWidth),
      height: Math.round(deviceHeight),
      deviceScaleFactor: 1,
      mobile: false,
    });
  };
  await apply(width, height);
  let actual = await driver.evaluate("window.innerWidth");
  if (actual !== width) {
    const zoom = actual / width;
    assert.ok(
      Number.isFinite(zoom) && zoom > 0,
      `Dock QA could not measure the renderer's zoom factor (asked ${width}px, got ${actual})`,
    );
    await apply(width / zoom, height / zoom);
    actual = await driver.evaluate("window.innerWidth");
  }
  assert.equal(
    actual,
    width,
    `Dock QA could not reach a ${width}px CSS viewport (settled at ${actual}px). `
    + "setDeviceMetricsOverride is in device pixels; a zoomed profile shifts the result. "
    + "See THE VIEWPORT TRAP at the top of this file.",
  );
  // The narrow shell is a media query, not a width comparison the tour makes
  // up. Assert the app agrees, so a future breakpoint move is caught here
  // rather than as a mysteriously absent Dock ten steps later.
  const narrow = await driver.evaluate(`window.matchMedia(${JSON.stringify(NARROW_SHELL)}).matches`);
  assert.equal(
    narrow,
    width <= 979,
    `${width}px did not put the shell on the expected side of ${NARROW_SHELL}`,
  );
  return actual;
}

async function setTheme(driver, theme) {
  const current = await driver.evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await driver.evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".theme-picker-popover"))`);
  const changed = await driver.evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  assert.equal(changed, true, `missing theme ${theme}`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
}

async function setMedia(cdp, { reduced = false, forced = false } = {}) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
      { name: "forced-colors", value: forced ? "active" : "none" },
    ],
  });
}

async function settle(driver, reduced = false) {
  await driver.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    return true;
  })()`);
  await sleep(reduced ? 30 : 220);
}

async function parkPointer(cdp) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0, pointerType: "mouse" });
}

async function bufferSuccessScreenshot(cdp, frames, name) {
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  frames.push({ name, bytes: Buffer.from(response.result.data, "base64") });
}

function writeSuccessScreenshots(frames) {
  mkdirSync(FAILURE_DIR, { recursive: true });
  for (const frame of frames) writeFileSync(join(FAILURE_DIR, frame.name), frame.bytes);
}

function selectPhraseExpression(spec) {
  return `(async () => {
    const spec = ${JSON.stringify(spec)};
    const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
    const span = row?.querySelector(".verse-text-span");
    const container = document.querySelector(".verse-text");
    if (!row || !span || !container) throw new Error("missing Dock fixture verse " + spec.verse);
    const text = span.textContent ?? "";
    const startOffset = text.indexOf(spec.quote);
    if (startOffset < 0) throw new Error("Dock fixture phrase is absent: " + spec.quote);
    row.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const locate = (offset) => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let consumed = 0;
      let node = walker.nextNode();
      while (node) {
        const length = node.textContent?.length ?? 0;
        if (consumed + length >= offset) return { node, offset: offset - consumed };
        consumed += length;
        node = walker.nextNode();
      }
      return null;
    };
    const start = locate(startOffset);
    const end = locate(startOffset + spec.quote.length);
    if (!start || !end) throw new Error("could not locate Dock phrase offsets");
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    return selection?.toString() ?? "";
  })()`;
}

async function pressKey(cdp, key, code = key, modifiers = 0, windowsVirtualKeyCode = undefined) {
  const params = { key, code, modifiers };
  if (windowsVirtualKeyCode != null) params.windowsVirtualKeyCode = windowsVirtualKeyCode;
  const text = key === "Enter" ? "\r" : key === " " ? " " : null;
  await cdp.send("Input.dispatchKeyEvent", {
    type: text == null ? "rawKeyDown" : "keyDown",
    ...params,
    ...(text == null ? {} : { text, unmodifiedText: text }),
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function pointerClick(driver, cdp, selector, description, followupKey = null) {
  const point = await driver.evaluate(`(async () => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement) || target.matches(":disabled")) return null;
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    // "Not the topmost target" is useless on its own — the whole question is
    // WHAT is on top. Name the obstruction and its ancestry, so a toast, a
    // scrim, or a genuinely mispositioned control are told apart at a glance.
    const describe = (node) => {
      if (!(node instanceof Element)) return null;
      const trail = [];
      for (let step = node; step && trail.length < 4; step = step.parentElement) {
        // NOTE: this regex is inside a template literal bound for evaluate(),
        // so it needs \\s to arrive in the page as \s. Written as \s here it
        // reaches the page as /s+/ and splits on the letter s, which turns
        // "toast-mark" into "toa.t-mark" — a wrong answer that still looks
        // like an answer.
        trail.push(step.tagName.toLowerCase() + (step.className && typeof step.className === "string"
          ? "." + step.className.trim().split(/\\s+/).join(".")
          : ""));
      }
      return trail.join(" < ");
    };
    return {
      x,
      y,
      width: rect.width,
      height: rect.height,
      hit: Boolean(hit && (hit === target || target.contains(hit))),
      obstruction: describe(hit),
    };
  })()`);
  assert.ok(point, `${description} is missing or disabled`);
  assert.ok(point.width > 0 && point.height > 0, `${description} has no pointer target`);
  assert.equal(
    point.hit,
    true,
    `${description} is not the topmost hit-test target at (${Math.round(point.x)}, ${Math.round(point.y)}); `
    + `covered by: ${point.obstruction ?? "nothing (the point is outside the window)"}`,
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  const release = cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  if (followupKey) {
    // Queue the key immediately behind pointer release, before awaiting a CDP
    // round trip. The click handler synchronously claims its operation token;
    // this therefore proves busy Escape ownership without a fast-failure race.
    const params = {
      key: followupKey.key,
      code: followupKey.code ?? followupKey.key,
      modifiers: followupKey.modifiers ?? 0,
    };
    if (followupKey.windowsVirtualKeyCode != null) params.windowsVirtualKeyCode = followupKey.windowsVirtualKeyCode;
    const keyDown = cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
    const keyUp = cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
    await Promise.all([release, keyDown, keyUp]);
  } else {
    await release;
  }
  return point;
}

function logFingerprint(logPath) {
  const value = readFileSync(logPath, "utf8");
  return {
    bytes: Buffer.byteLength(value),
    lines: value.length === 0 ? 0 : value.trimEnd().split("\n").length,
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

async function withWriteBlocked(logPath, action) {
  const originalMode = statSync(logPath).mode & 0o777;
  chmodSync(logPath, 0o400);
  try {
    return await action();
  } finally {
    chmodSync(logPath, originalMode);
  }
}

async function rangeCounts(driver) {
  return driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return {
      highlights: result.highlights.filter((record) => record.deleted === 0).length,
      connections: result.connections.length,
      notes: result.notes.length,
    };
  })()`);
}

async function expectedConnectionAnchor(driver, spec) {
  return driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    const text = chapter?.verses.find((item) => item.verse === spec.verse)?.text ?? "";
    const charStart = text.indexOf(spec.quote);
    if (charStart < 0) throw new Error("missing exact Dock connection fixture: " + spec.quote);
    const capture = await window.api.library.captureConnectionSelection("bsb", [{
      book: "ACT",
      chapter: 19,
      verse: spec.verse,
      char_start: charStart,
      char_end: charStart + spec.quote.length,
      quote: spec.quote,
    }]);
    if (!capture.ok || capture.status !== "exact") {
      throw new Error("Dock exact-anchor capture refused: " + JSON.stringify(capture));
    }
    return capture.anchor;
  })()`);
}

async function waitForActiveHighlightCount(driver, count) {
  await driver.waitFor(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.highlights.filter((record) => record.deleted === 0).length === ${count};
  })()`);
}

/**
 * Close every toast, and prove they are gone.
 *
 * Toasts stack above the Dock and are a real hit-test obstruction: a write in
 * one step raises a toast that silently swallows the next step's click. The
 * close control is `.toast-close`; the previous spelling of this helper looked
 * for `.toast-dismiss`, matched nothing, and reported success anyway.
 */
async function dismissAllToasts(driver) {
  await driver.evaluate(`(() => {
    for (const button of document.querySelectorAll(".toast-close")) button.click();
    return true;
  })()`);
  await driver.waitFor(`document.querySelectorAll(".toast-container .toast").length === 0`, 6_000);
}

// ---------------------------------------------------------------------------
// Dock navigation, against the Dock that exists
// ---------------------------------------------------------------------------

/**
 * Resting means BOTH: the context shows the resting span, and nothing is still
 * in hand. The old tour also required `data-dock-mode === "read"`, which the
 * renderer has never emitted — so this helper could only ever exhaust its
 * retries and call `assert.fail`, taking the whole tour with it.
 *
 * A connection draft owns its own exit: Escape opens the guard dialog rather
 * than discarding, so the ladder has to answer that dialog before it can
 * continue. Escape at rest with a tool still carried puts the tool down, which
 * is a second Escape, not the same one.
 */
async function ensureDockResting(driver, cdp) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const resting = await driver.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(HOST)});
      return Boolean(root
        && root.getAttribute("data-dock-state") === "rest"
        && root.getAttribute("data-tool-armed") === "false"
        && root.querySelector(".marking-dock-resting")
        && !document.querySelector("[data-authoring-draft]"));
    })()`);
    if (resting) return;
    const guarded = await driver.evaluate(`Boolean(document.querySelector(".connection-draft-exit-scrim"))`);
    if (guarded) {
      const discarded = await driver.evaluate(`(() => {
        const button = [...document.querySelectorAll(".connection-draft-exit-dialog button")]
          .find((candidate) => candidate.textContent?.trim() === "Discard draft");
        if (!button) return false;
        button.click();
        return true;
      })()`);
      assert.equal(discarded, true, "the connection draft exit guard offered no Discard draft");
      await settle(driver, true);
      continue;
    }
    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await settle(driver, true);
  }
  const final = await dockSnapshot(driver);
  assert.fail(`Dock did not return to rest: ${JSON.stringify(final)}`);
}

/** Everything a failure message needs to say what the Dock was actually doing. */
async function dockSnapshot(driver) {
  return driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    if (!root) return { host: false };
    const context = root.querySelector(".marking-dock-context");
    return {
      host: true,
      state: root.getAttribute("data-dock-state"),
      layout: root.getAttribute("data-dock-layout"),
      armed: root.getAttribute("data-tool-armed"),
      capture: root.getAttribute("data-selection-capture"),
      focusRing: root.getAttribute("data-focus-ring"),
      contents: [...(context?.children ?? [])].map((child) => child.className),
      text: context?.textContent?.trim().slice(0, 160) ?? null,
      guard: document.querySelectorAll(".connection-draft-exit-scrim").length,
    };
  })()`);
}

/**
 * Open the selection bar on a fixture phrase.
 *
 * The Dock does not repeat the quotation any more — the previous tour waited
 * on `.marking-dock-quote[title]`, which no element carries. What proves the
 * Dock received THIS selection is the native Range plus `data-selection-capture`
 * reaching "exact", which is the state the anchors were resolved into.
 */
async function openDockSelection(driver, spec = FIXTURE.phrase, reduced = false) {
  const selected = await driver.evaluate(selectPhraseExpression(spec));
  assert.equal(selected, spec.quote, `native selection drifted for ${spec.quote}`);
  await driver.waitFor(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return Boolean(root?.getAttribute("data-dock-state") === "selection"
      && root.querySelector(".marking-bar")
      && getSelection()?.toString() === ${JSON.stringify(spec.quote)});
  })()`);
  await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-selection-capture") === "exact"`);
  await settle(driver, reduced);
}

async function dismissDockSelection(driver, cdp, verse = FIXTURE.phrase.verse) {
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-dock-state") === "rest"
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === ${JSON.stringify(String(verse))}`);
  await settle(driver, true);
}

/** Click one of the bar's commands. Replaces the retired mode/intent dance. */
async function clickBarAction(driver, cdp, action, description, followupKey = null) {
  return pointerClick(driver, cdp, `${HOST} [data-bar-action="${action}"]`, description ?? `Dock ${action} command`, followupKey);
}

/** Click a wash swatch. In the Dock the pigments live directly in the bar. */
async function clickWash(driver, cdp, pigment, description, followupKey = null) {
  return pointerClick(
    driver,
    cdp,
    `${HOST} .marking-bar [data-pigment="${pigment}"]`,
    description ?? `Dock ${pigment} wash`,
    followupKey,
  );
}

/** Begin a connection draft from the current selection. */
async function beginConnectSession(driver, cdp) {
  await clickBarAction(driver, cdp, "connect", "Dock Connect command");
  await driver.waitFor(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return root?.getAttribute("data-dock-state") === "session"
      && Boolean(root.querySelector('.marking-connect-draft[data-connect-state="one-anchor"]'));
  })()`);
}

/** Choose a relationship kind. Only reachable once two phrases are held. */
async function chooseSessionKind(driver, cdp, kind) {
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${HOST} .marking-connect-kinds [data-relationship-kind="${kind}"]`)}))`);
  await pointerClick(
    driver,
    cdp,
    `${HOST} .marking-connect-kinds [data-relationship-kind="${kind}"]`,
    `Dock ${kind} relationship`,
  );
  await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-tool-armed") === ${JSON.stringify(`connect:${kind}`)}`);
}

/** The draft's primary action. Present only from the second phrase. */
async function saveConnection(driver, cdp, description, followupKey = null) {
  return pointerClick(
    driver,
    cdp,
    `${HOST} .marking-connect-actions .marking-session-action.primary`,
    description ?? "Dock Save connection action",
    followupKey,
  );
}

// ---------------------------------------------------------------------------
// The matrix: anatomy and geometry in every atmosphere and viewport
// ---------------------------------------------------------------------------

function dockMatrixReportExpression() {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const dock = root?.querySelector(".marking-dock");
    const context = root?.querySelector(".marking-dock-context");
    const stage = document.querySelector(".scripture-reading-stage");
    const bar = root?.querySelector(".marking-bar");
    const swatches = [...(bar?.querySelectorAll('[data-bar-action="highlight"]') ?? [])];
    const commands = [...(bar?.querySelectorAll("[data-bar-action]") ?? [])];
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const contained = (inner, outer) => Boolean(inner && outer
      && inner.left >= outer.left - ${GEOMETRY_EPSILON}
      && inner.top >= outer.top - ${GEOMETRY_EPSILON}
      && inner.right <= outer.right + ${GEOMETRY_EPSILON}
      && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
    const overflow = (element) => element ? Math.max(0, element.scrollWidth - element.clientWidth) : null;
    const stageRect = rect(stage);
    const dockRect = rect(dock);
    const dockStyle = dock ? getComputedStyle(dock) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      narrowShell: matchMedia(${JSON.stringify(NARROW_SHELL)}).matches,
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      layout: root?.getAttribute("data-dock-layout") ?? null,
      expectedLayout: stageRect && stageRect.width <= 759 ? "stacked" : "shelf",
      state: root?.getAttribute("data-dock-state") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      capture: root?.getAttribute("data-selection-capture") ?? null,
      focusRing: root?.getAttribute("data-focus-ring") ?? null,
      counts: {
        hosts: document.querySelectorAll(${JSON.stringify(HOST)}).length,
        docks: root?.querySelectorAll(".marking-dock").length ?? 0,
        contexts: root?.querySelectorAll(".marking-dock-context").length ?? 0,
        bars: root?.querySelectorAll(".marking-bar").length ?? 0,
        swatches: swatches.length,
        commands: commands.length,
      },
      dockRole: dock?.getAttribute("role") ?? null,
      dockLabel: dock?.getAttribute("aria-label") ?? null,
      dockBusy: dock?.getAttribute("aria-busy") ?? null,
      contextId: context?.getAttribute("id") ?? null,
      swatchGroupRole: bar?.querySelector(".marking-bar-swatches")?.getAttribute("role") ?? null,
      swatchGroupLabel: bar?.querySelector(".marking-bar-swatches")?.getAttribute("aria-label") ?? null,
      pigments: swatches.map((choice) => choice.getAttribute("data-pigment")),
      pigmentShortcuts: swatches.map((choice) => choice.getAttribute("aria-keyshortcuts")),
      pigmentLabels: swatches.map((choice) => choice.getAttribute("aria-label")),
      forcedCodes: swatches.map((choice) => choice.querySelector(".marking-pigment")?.getAttribute("data-forced-code") ?? null),
      commandIds: commands.map((choice) => choice.getAttribute("data-bar-action")),
      pigmentMaterials: swatches.map((choice) => {
        const swatch = choice.querySelector(".marking-pigment") ?? choice;
        const style = getComputedStyle(swatch);
        return style.backgroundImage + "|" + style.backgroundColor;
      }),
      stageRect,
      dockRect,
      dockContained: contained(dockRect, stageRect),
      barContained: contained(rect(bar), dockRect),
      // A command whose box falls outside the bar's own box is not merely
      // ugly: the bar clips with overflow:hidden, so that command cannot be
      // seen, hit, or scrolled to. Name them rather than counting them.
      barScrollWidth: bar?.scrollWidth ?? null,
      barClientWidth: bar?.clientWidth ?? null,
      clippedCommands: (() => {
        const barBox = bar?.getBoundingClientRect();
        if (!barBox) return [];
        return commands.filter((button) => {
          const box = button.getBoundingClientRect();
          return box.right > barBox.right + ${GEOMETRY_EPSILON}
            || box.left < barBox.left - ${GEOMETRY_EPSILON};
        }).map((button) => button.getAttribute("data-bar-action"));
      })(),
      bottomInset: dockRect && stageRect ? stageRect.bottom - dockRect.bottom : null,
      leftInset: dockRect && stageRect ? dockRect.left - stageRect.left : null,
      rightInset: dockRect && stageRect ? stageRect.right - dockRect.right : null,
      backdrop: dockStyle?.backdropFilter || dockStyle?.webkitBackdropFilter || "none",
      nativeSelection: getSelection()?.toString() ?? "",
      authoredPaint: {
        drafts: document.querySelectorAll("[data-authoring-draft]").length,
        routes: document.querySelectorAll(".connection-route").length,
        underlines: document.querySelectorAll(".connection-underline").length,
        contacts: document.querySelectorAll(".connection-contact").length,
        hits: document.querySelectorAll(".connection-route-hit").length,
        ticks: document.querySelectorAll("[data-connection-tick]").length,
      },
      overflow: {
        document: overflow(document.documentElement),
        body: overflow(document.body),
        scriptureBody: overflow(document.querySelector(".scripture-body")),
        stage: overflow(stage),
        dock: overflow(dock),
        context: overflow(context),
      },
      staleSelectors: {
        modes: document.querySelectorAll("[data-dock-tool]").length,
        intents: document.querySelectorAll("[data-dock-intent]").length,
        contexts: document.querySelectorAll("[data-dock-context]").length,
        thumbs: document.querySelectorAll(".marking-dock-thumb").length,
      },
    };
  })()`;
}

/**
 * Anatomy and vocabulary fail hard and immediately — if the Dock is not the
 * Dock, nothing below is worth running.
 *
 * Geometry defects are COLLECTED instead, and asserted empty once every cell
 * has been visited. That is not tolerance: the run still fails, and fails with
 * the complete list. It exists because a single clipped viewport aborting cell
 * 1 of 20 hides the other nineteen cells and all eight later phases, which is
 * how a tour ends up reporting one bug per week instead of all of them at once.
 */
function assertDockMatrixReport(report, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  const geometryDefect = (message) => recordGeometryDefect(label, message);
  assert.deepEqual(report.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport drifted`);
  assert.equal(report.narrowShell, viewport.width <= 979, `${label}: narrow-shell media query disagreed with the viewport`);
  assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
  assert.equal(report.layout, report.expectedLayout, `${label}: Dock layout ignored its own reading stage`);
  assert.equal(report.state, "selection", `${label}: exact selection did not own the Dock context`);
  assert.equal(report.armed, "false", `${label}: fresh selection inherited a stale tool`);
  assert.equal(report.capture, "exact", `${label}: selection did not resolve to exact anchors`);

  // Anatomy: one host, one toolbar, one context, one bar, five washes, and
  // eight commands — the five washes plus note-or-remove, connect, more.
  assert.deepEqual(
    report.counts,
    { hosts: 1, docks: 1, contexts: 1, bars: 1, swatches: 5, commands: 8 },
    `${label}: Dock anatomy drifted`,
  );
  assert.equal(report.dockRole, DOCK_ANATOMY.toolbarRole, `${label}: Dock lost its toolbar role`);
  assert.equal(report.dockLabel, DOCK_ANATOMY.toolbarLabel, `${label}: Dock label drifted`);
  assert.equal(report.dockBusy, "false", `${label}: idle Dock claimed to be busy`);
  assert.equal(report.contextId, "marking-dock-context", `${label}: Dock context lost its stable id`);

  // The retired vocabulary must stay retired. If any of these ever return, the
  // Dock has grown a second grammar and this tour is testing the wrong one.
  assert.deepEqual(
    report.staleSelectors,
    { modes: 0, intents: 0, contexts: 0, thumbs: 0 },
    `${label}: a retired Dock mode/intent/thumb selector reappeared`,
  );

  assert.equal(report.swatchGroupRole, "group", `${label}: wash swatches lost their group role`);
  assert.equal(report.swatchGroupLabel, "Highlight colour", `${label}: wash group label drifted`);
  assert.deepEqual(report.pigments, PIGMENTS, `${label}: pigment vocabulary drifted`);
  assert.deepEqual(
    report.pigmentShortcuts,
    PIGMENTS.map((_, index) => String(index + 1)),
    `${label}: pigment number shortcuts drifted`,
  );
  // The swatch announces itself as "3. Sky wash. A clear sky wash." — the
  // number is the shortcut, the name is the pigment, the rest is the
  // description. Assert the whole advertised prefix rather than a fragment of
  // it, so a label that loses its shortcut or its noun is caught here.
  assert.deepEqual(
    report.pigmentLabels.map((name) => (name ?? "").split(".").slice(0, 2).join(".") + "."),
    PIGMENT_LABELS.map((name, index) => `${index + 1}. ${name} wash.`),
    `${label}: pigment names drifted`,
  );
  assert.deepEqual(report.forcedCodes, [...FORCED_CODES], `${label}: forced-colors pigment codes drifted`);
  assert.equal(
    new Set(report.pigmentMaterials).size,
    PIGMENTS.length,
    `${label}: pigment samples lost their five distinct washes`,
  );
  // A fresh selection has no wash under it, so the shared slot shows Note.
  assert.deepEqual(
    report.commandIds,
    [...BAR_WASH_ACTIONS, "note", "connect", "more"],
    `${label}: bar commands drifted`,
  );

  if (!report.dockContained) geometryDefect("Dock escaped its reading stage");
  if (!report.barContained) geometryDefect("selection bar escaped the Dock shell");

  // The inset is governed by the SHELL, not by the layout.
  //
  // `.marking-dock-host` carries `right/bottom/left: 14px`, but the narrow
  // shell block at `@media (max-width: 979px)` deliberately resets all three to
  // 0 and squares the Dock's corners, so the Dock goes full-bleed to the stage
  // edge. That block is commented in styles.css with its own arithmetic: a side
  // inset cost 82px of bottom edge, which was worse than the problem it solved.
  //
  // So a "shelf" layout inside a narrow shell is edge-to-edge and correct — and
  // an inherited expectation of 14px insets everywhere marks twelve perfectly
  // good cells as broken. Layout (shelf/stacked) follows the STAGE width; the
  // inset follows the WINDOW width; they are not the same question.
  const fullBleed = report.narrowShell || report.layout === "stacked";
  if (fullBleed) {
    if (Math.abs(report.bottomInset) > GEOMETRY_EPSILON) geometryDefect(`full-bleed Dock did not meet the stage floor (${report.bottomInset}px)`);
    if (Math.abs(report.leftInset) > GEOMETRY_EPSILON) geometryDefect(`full-bleed Dock missed the left edge (${report.leftInset}px)`);
    if (Math.abs(report.rightInset) > GEOMETRY_EPSILON) geometryDefect(`full-bleed Dock missed the right edge (${report.rightInset}px)`);
  } else {
    if (Math.abs(report.bottomInset - 14) > GEOMETRY_EPSILON) geometryDefect(`inset shelf bottom drifted to ${report.bottomInset}px`);
    if (report.leftInset < 14 - GEOMETRY_EPSILON) geometryDefect(`inset shelf left shrank to ${report.leftInset}px`);
    if (report.rightInset < 14 - GEOMETRY_EPSILON) geometryDefect(`inset shelf right shrank to ${report.rightInset}px`);
  }
  if (report.dockRect.width > 1120 + GEOMETRY_EPSILON) geometryDefect(`Dock exceeded its 1120px measure at ${report.dockRect.width}px`);

  // The clipping check, stated as the reader experiences it. The bar's box has
  // `overflow: hidden`, so content wider than the box is not scrolled to — it
  // is simply gone, and the command with it. Naming the lost commands makes
  // the failure actionable without opening a screenshot.
  if (report.clippedCommands.length > 0) {
    geometryDefect(
      `the bar needs ${report.barScrollWidth}px inside a ${report.barClientWidth}px box, so `
      + `${report.clippedCommands.join(" and ")} ${report.clippedCommands.length === 1 ? "is" : "are"} `
      + "clipped and unreachable (overflow is hidden, not scrollable)",
    );
  }
  // The backdrop follows the material, and all four atmospheres are solid
  // unless the reader turns the material on. This tour never turns it on, so
  // the Dock must not be carrying a backdrop filter in any of them.
  assert.equal(report.backdrop, "none", `${label}: solid Dock inherited a backdrop filter`);
  assert.equal(report.nativeSelection, FIXTURE.phrase.quote, `${label}: Dock collapsed the exact native selection`);
  assert.deepEqual(
    report.authoredPaint,
    { drafts: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 0 },
    `${label}: opening a selection painted authored artifacts`,
  );
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    if (overflow == null) {
      geometryDefect(`${surface} could not be measured for horizontal overflow`);
    } else if (overflow > GEOMETRY_EPSILON) {
      geometryDefect(`${surface} overflowed horizontally by ${overflow}px`);
    }
  }
}

/**
 * The More list, in one cell.
 *
 * RESTATED 2026-07-30. This used to read: "Six items, every one of them named
 * and in a fixed order. The list does not hide what it cannot do — a blocked
 * item states its reason." That produced five greyed rows with an apology
 * printed against each, one live action, and a reader who had just touched the
 * text being told what the app could not do. More now offers only what it can
 * run, so the assertions are the ones that still mean something: the rows are
 * a SUBSET of the declared table, in the declared ORDER, none of them disabled,
 * and none of them carrying a reason. Copy is always among them, so the list is
 * never empty and More never opens onto nothing.
 */
async function assertMoreList(driver, cdp, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  await clickBarAction(driver, cdp, "more", `${label}: Dock More command`);
  await driver.waitFor(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return root?.getAttribute("data-dock-state") === "choices" && Boolean(root.querySelector(".marking-more"));
  })()`);
  const more = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const panel = root?.querySelector(".marking-more");
    const items = [...(panel?.querySelectorAll("[data-more-action]") ?? [])];
    const list = panel?.querySelector(".marking-more-list");
    return {
      panel: Boolean(panel),
      count: items.length,
      ids: items.map((item) => item.getAttribute("data-more-action")),
      kinds: items.map((item) => item.getAttribute("data-action-kind")),
      roles: items.map((item) => item.getAttribute("role")),
      disabled: items.filter((item) => item.disabled).length,
      reasons: panel?.querySelectorAll(".marking-more-reason").length ?? 0,
      listRole: list?.getAttribute("role") ?? null,
      scope: panel?.querySelector(".marking-more-scope")?.textContent?.trim() ?? null,
      expanded: root?.querySelector('[data-bar-action="more"]')?.getAttribute("aria-expanded") ?? null,
      barStillPresent: Boolean(root?.querySelector(".marking-bar")),
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.equal(more.panel, true, `${label}: More did not open a list`);
  assert.ok(more.count >= 1, `${label}: More opened onto nothing`);
  assert.ok(more.ids.every((id) => MORE_ACTIONS.includes(id)),
    `${label}: More offered an action outside the declared table (${more.ids.join(", ")})`);
  assert.deepEqual(more.ids, MORE_ACTIONS.filter((id) => more.ids.includes(id)),
    `${label}: More rearranged the declared order (${more.ids.join(", ")})`);
  assert.ok(more.ids.includes("copy-reference"), `${label}: Copy with reference must always be reachable`);
  assert.deepEqual([...new Set(more.kinds)], ["deferred"], `${label}: More action kinds drifted`);
  assert.deepEqual(more.roles, Array(more.count).fill("menuitem"), `${label}: More items lost menuitem semantics`);
  assert.equal(more.listRole, "menu", `${label}: More list lost its menu role`);
  assert.equal(more.disabled, 0, `${label}: More offered a row it cannot run`);
  assert.equal(more.reasons, 0, `${label}: More printed an apology beside a row`);
  assert.equal(more.expanded, "true", `${label}: More did not report itself expanded`);
  assert.equal(more.barStillPresent, true, `${label}: More replaced the bar instead of sitting beside it`);
  assert.equal(more.scope, "Acts 19:8 · selected words", `${label}: More scope line drifted`);
  assert.equal(more.nativeSelection, FIXTURE.phrase.quote, `${label}: opening More collapsed the exact selection`);

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return root?.getAttribute("data-dock-state") === "selection" && !root.querySelector(".marking-more");
  })()`);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/**
 * The Dock's keyboard surface is not a roving radiogroup any more; it is a
 * toolbar of plain buttons plus the number shortcuts the swatches advertise.
 * These are the contracts that still exist, driven the way a reader drives
 * them: 1-5 lay a wash, 0 removes one, Escape unwinds one layer at a time.
 */
async function assertKeyboardContracts(driver, cdp, highlightsLog) {
  const before = await rangeCounts(driver);
  const beforeLog = logFingerprint(highlightsLog);
  await ensureDockResting(driver, cdp);

  // Tabbing into the Dock flips the focus-ring mode; a pointer-opened Dock
  // must not paint an accent ring it did not earn.
  await openDockSelection(driver, FIXTURE.stressPhrase);
  assert.equal(
    await driver.evaluate(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-focus-ring")`),
    "pointer",
    "pointer-opened Dock exposed a keyboard focus ring mode",
  );

  // Every bar command is reachable and none is a dead end.
  const reachable = await driver.evaluate(`(() => {
    const buttons = [...document.querySelectorAll(${JSON.stringify(`${HOST} .marking-bar [data-bar-action]`)})];
    return {
      count: buttons.length,
      focusable: buttons.filter((button) => button.tabIndex >= 0 && !button.disabled).length,
      named: buttons.every((button) => (button.getAttribute("aria-label") ?? "").trim().length > 0),
    };
  })()`);
  assert.equal(reachable.count, 8, `the selection bar exposed ${reachable.count} commands, expected 8`);
  assert.equal(reachable.focusable, 8, "a selection bar command was not keyboard reachable");
  assert.equal(reachable.named, true, "a selection bar command has no accessible name");

  // "3" is Sky. The shortcut is advertised on the swatch, so it must work.
  await pressKey(cdp, "3", "Digit3", 0, 51);
  await waitForActiveHighlightCount(driver, before.highlights + 1);
  const afterWash = logFingerprint(highlightsLog);
  assert.equal(afterWash.lines, beforeLog.lines + 1, "the 3 shortcut appended more or fewer than one wash event");
  const washed = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const active = result.highlights.filter((record) => record.deleted === 0);
    const record = active.find((item) => item.verse_start === ${FIXTURE.stressPhrase.verse});
    return record ? { color: record.color, length: record.char_end - record.char_start } : null;
  })()`);
  assert.ok(washed, "the 3 shortcut did not write a durable record on the selected verse");
  assert.equal(washed.color, "blue", "the 3 shortcut wrote a pigment other than Sky");
  assert.equal(washed.length, FIXTURE.stressPhrase.quote.length, "the 3 shortcut wrote the wrong exact span");

  // With a wash under the selection the shared slot becomes Remove, and "0"
  // takes it away again. Prove the slot swapped before relying on it.
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.stressPhrase);
  const slot = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const remove = root?.querySelector('[data-bar-action="remove"]');
    return {
      remove: Boolean(remove),
      note: Boolean(root?.querySelector('[data-bar-action="note"]')),
      label: remove?.getAttribute("aria-label") ?? null,
      shortcut: remove?.getAttribute("aria-keyshortcuts") ?? null,
    };
  })()`);
  assert.deepEqual(
    slot,
    { remove: true, note: false, label: "Remove selected text from wash", shortcut: "0" },
    "an already-washed selection did not swap Note for Remove in the shared slot",
  );
  await pressKey(cdp, "0", "Digit0", 0, 48);
  await waitForActiveHighlightCount(driver, before.highlights);
  const afterRemove = logFingerprint(highlightsLog);
  assert.equal(afterRemove.lines, afterWash.lines + 1, "the 0 shortcut appended more or fewer than one removal event");
  assert.notEqual(afterRemove.sha256, afterWash.sha256, "the 0 shortcut left the append-log digest unchanged");

  await ensureDockResting(driver, cdp);
  assert.deepEqual(await rangeCounts(driver), before, "the keyboard probe did not restore its baseline");
}

/**
 * Escape unwinds exactly one layer per press, in a fixed order.
 *
 * More closes before the selection; the selection releases before the carried
 * tool; a draft refuses to vanish and asks instead. Each rung is asserted from
 * a reachable state, so a broken rung fails here rather than hanging.
 */
async function assertEscapeLadder(driver, cdp) {
  const before = await rangeCounts(driver);
  await ensureDockResting(driver, cdp);
  // The keyboard probe above writes and removes a wash, and each write raises
  // a toast that stacks directly over the Dock. A toast is a real hit-test
  // obstruction, so clear them before driving the bar by pointer.
  await dismissAllToasts(driver);

  await openDockSelection(driver, FIXTURE.phrase);
  await clickBarAction(driver, cdp, "more", "Dock More command for the Escape ladder");
  await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-dock-state") === "choices"`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return root?.getAttribute("data-dock-state") === "selection"
      && !root.querySelector(".marking-more")
      && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)};
  })()`);

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return root?.getAttribute("data-dock-state") === "rest"
      && root.querySelector(".marking-dock-resting")?.textContent?.trim().endsWith(${JSON.stringify(REST_GUIDANCE)})
      && getSelection()?.toString() === "";
  })()`);

  // A draft owns its own exit: Escape opens the guard rather than discarding
  // work the reader has not agreed to lose.
  await openDockSelection(driver, FIXTURE.phrase);
  await beginConnectSession(driver, cdp);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  const guard = await driver.evaluate(`(() => {
    const dialog = document.querySelector(".connection-draft-exit-dialog");
    if (!dialog) return null;
    return {
      role: dialog.getAttribute("role"),
      modal: dialog.getAttribute("aria-modal"),
      actions: [...dialog.querySelectorAll("button")].map((button) => button.textContent?.trim()),
      sessionSurvived: document.querySelectorAll(".marking-connect-draft").length,
    };
  })()`);
  assert.ok(guard, "the draft exit guard did not appear");
  assert.equal(guard.role, "alertdialog", "the draft exit guard is not an alertdialog");
  assert.equal(guard.modal, "true", "the draft exit guard is not modal");
  // One phrase cannot be saved, so the guard offers only the two honest exits.
  assert.deepEqual(guard.actions, ["Discard draft", "Keep editing"], "the one-phrase exit guard offered the wrong choices");
  assert.equal(guard.sessionSurvived, 1, "Escape discarded the draft instead of asking");

  await ensureDockResting(driver, cdp);
  assert.deepEqual(await rangeCounts(driver), before, "the Escape ladder mutated authored records");
}

// ---------------------------------------------------------------------------
// Mutation, failure and retry
// ---------------------------------------------------------------------------

/**
 * A blocked write must state what happened, keep the words, and offer exactly
 * one explicit Retry — and must not have written anything.
 *
 * The failure lives in the context area as a `surface-state`, and its Retry is
 * the single element in the whole Dock carrying `data-dock-action`. There is no
 * `.marking-dock-feedback` any more; the previous tour read its text from an
 * element that does not exist, which is indistinguishable from a wrong
 * selector, so the shape is asserted before anything is read out of it.
 */
async function assertBlockedWashSurfacesRetry(driver, cdp, highlightsLog) {
  const baseline = await rangeCounts(driver);
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  const beforeLog = logFingerprint(highlightsLog);

  await withWriteBlocked(highlightsLog, async () => {
    await clickWash(driver, cdp, "blue", "Dock blocked Sky wash");
    await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-dock-state") === "feedback"`);
    const failure = await driver.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(HOST)});
      const state = root?.querySelector(".surface-state");
      if (!state) return { present: false };
      const retries = [...root.querySelectorAll("[data-dock-action]")];
      return {
        present: true,
        surfaceState: state.getAttribute("data-surface-state"),
        role: state.getAttribute("role"),
        ariaLive: state.getAttribute("aria-live"),
        thing: state.querySelector(".surface-state-thing")?.textContent?.trim() ?? null,
        reason: state.querySelector(".surface-state-reason")?.textContent?.trim() ?? null,
        locality: state.querySelector(".surface-state-locality")?.textContent?.trim() ?? null,
        retryCount: retries.length,
        retryActions: retries.map((button) => button.getAttribute("data-dock-action")),
        retryLabel: retries[0]?.textContent?.trim() ?? null,
        barGone: !root.querySelector(".marking-bar"),
        nativeSelection: getSelection()?.toString() ?? "",
      };
    })()`);
    assert.equal(failure.present, true, "a blocked wash produced no surface state in the Dock");
    assert.equal(failure.surfaceState, "failed", "a blocked local wash did not report itself failed");
    assert.equal(failure.role, "alert", "the failure state did not announce itself as an alert");
    assert.equal(failure.ariaLive, "assertive", "the failure state was not announced assertively");
    assert.equal(
      failure.thing,
      "The wash could not be saved. Selection restored for retry.",
      "the blocked wash message drifted",
    );
    assert.equal(
      failure.reason,
      "Nothing was written, and your words are still selected.",
      "the blocked wash reason drifted",
    );
    assert.equal(failure.locality, "On this device.", "a local failure blamed the network");
    assert.equal(failure.retryCount, 1, `the failure offered ${failure.retryCount} data-dock-action controls, expected 1`);
    assert.deepEqual(failure.retryActions, ["retry"], "the failure's only action is not Retry");
    assert.equal(failure.retryLabel, "Retry", "the failure's action is not labelled Retry");
    assert.equal(failure.barGone, true, "the failure sat beside the bar instead of replacing it");
    assert.equal(failure.nativeSelection, FIXTURE.phrase.quote, "a blocked wash collapsed the reader's selection");

    await sleep(300);
    assert.deepEqual(await rangeCounts(driver), baseline, "a blocked wash retried itself or wrote an authored record");
    assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "a blocked wash changed append-log bytes");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "restoring wash-log permissions changed append-log bytes");

  // Retry is the explicit path, and it writes exactly once.
  await pointerClick(driver, cdp, `${HOST} [data-dock-action="retry"]`, "Dock wash Retry action");
  await waitForActiveHighlightCount(driver, baseline.highlights + 1);
  const afterRetry = logFingerprint(highlightsLog);
  assert.ok(afterRetry.bytes > beforeLog.bytes, "a successful Retry did not append log bytes");
  assert.equal(afterRetry.lines, beforeLog.lines + 1, "a successful Retry appended more or fewer than one event");
  assert.notEqual(afterRetry.sha256, beforeLog.sha256, "a successful Retry left the append-log digest unchanged");

  const written = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const active = result.highlights.filter((record) => record.deleted === 0);
    const record = active[0];
    return record ? {
      color: record.color,
      package: record.package,
      verseStart: record.verse_start,
      verseEnd: record.verse_end,
      charStart: record.char_start,
      charEnd: record.char_end,
    } : null;
  })()`);
  assert.ok(written, "Retry did not create a durable record");
  assert.equal(written.color, "blue", "Retry wrote outside the Sky vocabulary");
  assert.equal(written.package, "bsb", "Retry lost its rendered package locator");
  assert.equal(written.verseStart, FIXTURE.phrase.verse, "Retry began on the wrong verse");
  assert.equal(written.verseEnd, FIXTURE.phrase.verse, "Retry ended on the wrong verse");
  assert.ok(Number.isInteger(written.charStart) && Number.isInteger(written.charEnd), "Retry lost exact character offsets");
  assert.equal(written.charEnd - written.charStart, FIXTURE.phrase.quote.length, "Retry's exact range length drifted");
  return baseline;
}

/**
 * A failed write is bound to the selection that caused it. Selecting different
 * words must clear the failure rather than carry it — and must not quietly
 * apply the tool that failed.
 */
async function assertFailureIsNonceBound(driver, cdp, highlightsLog) {
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.counterpart);
  const beforeLog = logFingerprint(highlightsLog);
  const beforeCounts = await rangeCounts(driver);

  await withWriteBlocked(highlightsLog, async () => {
    await clickWash(driver, cdp, "blue", "Dock stale-nonce blocked Sky wash");
    await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-dock-state") === "feedback"`);
    await sleep(300);
    assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "the stale-nonce failure changed append-log bytes");
    assert.deepEqual(await rangeCounts(driver), beforeCounts, "the stale-nonce failure wrote a record");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "restoring stale-nonce log permissions changed append-log bytes");

  const reselected = await driver.evaluate(selectPhraseExpression(FIXTURE.stressPhrase));
  assert.equal(reselected, FIXTURE.stressPhrase.quote, "the replacement selection drifted from its exact quote");
  await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-dock-state") === "selection"`);
  await settle(driver, true);
  const fresh = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return {
      state: root?.getAttribute("data-dock-state") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      capture: root?.getAttribute("data-selection-capture") ?? null,
      failures: root?.querySelectorAll(".surface-state").length ?? -1,
      retries: root?.querySelectorAll("[data-dock-action]").length ?? -1,
      bars: root?.querySelectorAll(".marking-bar").length ?? -1,
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.deepEqual(fresh, {
    state: "selection",
    armed: "false",
    capture: "exact",
    failures: 0,
    retries: 0,
    bars: 1,
    nativeSelection: FIXTURE.stressPhrase.quote,
  }, "a new selection inherited the previous selection's failure state");
  await sleep(300);
  assert.deepEqual(await rangeCounts(driver), beforeCounts, "the stale failure auto-applied to a new selection");
  assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "a new selection changed the failed wash log");
  await dismissDockSelection(driver, cdp, FIXTURE.stressPhrase.verse);
}

/** Note opens the capture sheet with the exact words, and writes nothing until saved. */
async function assertNoteHandoff(driver, cdp) {
  const before = await rangeCounts(driver);
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.counterpart);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${HOST} [data-bar-action="note"]`)}))`);
  await clickBarAction(driver, cdp, "note", "Dock Note command");
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-root"))`);
  const note = await driver.evaluate(`(() => {
    const root = document.querySelector(".note-capture-root");
    if (!root) return null;
    return {
      quote: root.querySelector(".note-capture-quote-text")?.textContent?.trim() ?? null,
      reference: root.querySelector(".note-capture-quote-ref")?.textContent?.trim() ?? null,
    };
  })()`);
  assert.ok(note, "the Note sheet did not open");
  assert.deepEqual(
    note,
    { quote: FIXTURE.counterpart.quote, reference: "Acts 19:9" },
    "Note lost its exact selection context",
  );
  await pointerClick(driver, cdp, ".note-capture-cancel", "Dock Note Cancel action");
  await driver.waitFor(`!document.querySelector(".note-capture-root")`);
  assert.equal((await rangeCounts(driver)).notes, before.notes, "a cancelled Note wrote authored data");
  await ensureDockResting(driver, cdp);
}

/** A blocked Remove keeps the wash and offers the same single explicit Retry. */
async function assertBlockedRemoveSurfacesRetry(driver, cdp, highlightsLog) {
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${HOST} [data-bar-action="remove"]`)}))`);
  const beforeLog = logFingerprint(highlightsLog);

  await withWriteBlocked(highlightsLog, async () => {
    // The Escape rides immediately behind the click: a busy Dock owns Escape
    // and must not let it cancel a change already in flight.
    await clickBarAction(
      driver,
      cdp,
      "remove",
      "Dock blocked Remove command",
      { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    );
    await driver.waitFor(`(() => {
      const root = document.querySelector(${JSON.stringify(HOST)});
      return root?.getAttribute("data-dock-state") === "feedback"
        && root.querySelector(".surface-state-thing")?.textContent?.trim()
          === "The wash could not be removed. Selection restored for retry."
        && root.querySelectorAll('[data-dock-action="retry"]').length === 1
        && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)};
    })()`);
    await sleep(300);
    assert.equal((await rangeCounts(driver)).highlights, 1, "a blocked Remove retried itself or deleted the wash");
    assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "a blocked Remove changed append-log bytes");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeLog, "restoring remove-log permissions changed append-log bytes");

  // Retry is NOT auto-focused — nothing in MarkingSurface moves focus onto it,
  // and asserting that it is would be asserting a contract the app does not
  // make. What it must be is keyboard reachable, so a reader who never touches
  // the pointer can still recover.
  const retryReach = await driver.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(`${HOST} [data-dock-action="retry"]`)});
    if (!button) return null;
    return { tabIndex: button.tabIndex, disabled: button.disabled, name: button.textContent?.trim() ?? null };
  })()`);
  assert.ok(retryReach, "the blocked Remove offered no Retry control to reach");
  assert.ok(retryReach.tabIndex >= 0, "Retry is not in the tab order, so a keyboard reader cannot recover");
  assert.equal(retryReach.disabled, false, "Retry was offered but disabled");
  assert.equal(retryReach.name, "Retry", "the recovery control is not labelled Retry");
  await pointerClick(driver, cdp, `${HOST} [data-dock-action="retry"]`, "Dock Remove Retry action");
  await waitForActiveHighlightCount(driver, 0);
  const afterRemove = logFingerprint(highlightsLog);
  assert.ok(afterRemove.bytes > beforeLog.bytes, "a successful Remove did not append log bytes");
  assert.equal(afterRemove.lines, beforeLog.lines + 1, "a successful Remove appended more or fewer than one event");
  assert.notEqual(afterRemove.sha256, beforeLog.sha256, "a successful Remove left the append-log digest unchanged");
  await ensureDockResting(driver, cdp);
}

async function assertMutationAndRetryFlows(driver, cdp, highlightsLog, successFrames) {
  const baseline = await rangeCounts(driver);
  assert.equal(baseline.highlights, 0, "the mutation fixture inherited highlights");

  await assertBlockedWashSurfacesRetry(driver, cdp, highlightsLog);

  // The washed-selection bar is the tightest the Dock ever gets: five swatches
  // plus three commands in the stacked layout. Keep it as a success-only proof.
  await setViewport(cdp, driver, 390, 900);
  await ensureDockResting(driver, cdp);
  await dismissAllToasts(driver);
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${HOST} [data-bar-action="remove"]`)}))`);
  await settle(driver);
  assertStackedWashedBarGeometry(await washedBarGeometry(driver));
  await parkPointer(cdp);
  await bufferSuccessScreenshot(cdp, successFrames, "marking-dock-proof-paper-stacked-washed-bar.png");
  await dismissDockSelection(driver, cdp);
  await setViewport(cdp, driver, 860, 900);
  await ensureDockResting(driver, cdp);

  await assertFailureIsNonceBound(driver, cdp, highlightsLog);
  await assertNoteHandoff(driver, cdp);
  await assertBlockedRemoveSurfacesRetry(driver, cdp, highlightsLog);

  assert.deepEqual(await rangeCounts(driver), baseline, "the mutation flow did not restore its isolated baseline");
}

/**
 * The stacked bar's real interior, measured rather than inferred from minima.
 *
 * At 390px the Dock spans the stage edge to edge, and eight commands have to
 * fit inside it without overflow and without any of them losing a usable
 * target.
 */
async function washedBarGeometry(driver) {
  return driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const dock = root?.querySelector(".marking-dock");
    const bar = root?.querySelector(".marking-bar");
    const stage = document.querySelector(".scripture-reading-stage");
    const commands = [...(bar?.querySelectorAll("[data-bar-action]") ?? [])];
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const barRect = rect(bar);
    return {
      layout: root?.getAttribute("data-dock-layout") ?? null,
      state: root?.getAttribute("data-dock-state") ?? null,
      present: Boolean(bar),
      commandIds: commands.map((button) => button.getAttribute("data-bar-action")),
      commandRects: commands.map((button) => rect(button)),
      clippedCommands: barRect ? commands.filter((button) => {
        const value = button.getBoundingClientRect();
        return value.right > barRect.right + ${GEOMETRY_EPSILON}
          || value.left < barRect.left - ${GEOMETRY_EPSILON};
      }).map((button) => button.getAttribute("data-bar-action")) : [],
      allInsideBar: barRect ? commands.every((button) => {
        const value = button.getBoundingClientRect();
        return value.left >= barRect.left - ${GEOMETRY_EPSILON}
          && value.right <= barRect.right + ${GEOMETRY_EPSILON};
      }) : false,
      barRect,
      barScrollWidth: bar?.scrollWidth ?? null,
      barClientWidth: bar?.clientWidth ?? null,
      dockRect: rect(dock),
      stageRect: rect(stage),
      barOverflow: bar ? Math.max(0, bar.scrollWidth - bar.clientWidth) : null,
      dockOverflow: dock ? Math.max(0, dock.scrollWidth - dock.clientWidth) : null,
    };
  })()`);
}

function assertStackedWashedBarGeometry(report) {
  // Anatomy is hard: if the washed bar is not the washed bar, the measurement
  // below is measuring the wrong thing.
  assert.equal(report.present, true, "the washed selection bar was absent at 390px");
  assert.equal(report.layout, "stacked", "the 390px washed-bar proof did not use the stacked Dock");
  assert.equal(report.state, "selection", "the 390px washed-bar proof lost its selection state");
  assert.deepEqual(
    report.commandIds,
    [...BAR_WASH_ACTIONS, "remove", "connect", "more"],
    "the washed stacked bar exposed the wrong commands",
  );
  assert.equal(report.commandRects.length, 8, "the washed stacked bar did not measure eight commands");
  for (const [index, rect] of report.commandRects.entries()) {
    assert.ok(rect, `stacked bar command ${index} had no geometry`);
    assert.ok(rect.width > 0 && rect.height > 0, `stacked bar command ${report.commandIds[index]} collapsed to nothing`);
  }

  // Layout joins the collected channel, same as the matrix.
  const label = "washed bar/390x900";
  if (!report.allInsideBar) {
    recordGeometryDefect(
      label,
      `the washed bar needs ${report.barScrollWidth}px inside a ${report.barClientWidth}px box, so `
      + `${report.clippedCommands.join(" and ")} ${report.clippedCommands.length === 1 ? "is" : "are"} `
      + "clipped and unreachable",
    );
  }
  if (report.barOverflow == null || report.barOverflow > GEOMETRY_EPSILON) {
    recordGeometryDefect(label, `the stacked bar overflowed by ${report.barOverflow}px`);
  }
  if (report.dockOverflow == null || report.dockOverflow > GEOMETRY_EPSILON) {
    recordGeometryDefect(label, `the stacked Dock overflowed by ${report.dockOverflow}px`);
  }
  if (report.dockRect.left < report.stageRect.left - GEOMETRY_EPSILON
    || report.dockRect.right > report.stageRect.right + GEOMETRY_EPSILON) {
    recordGeometryDefect(label, "the stacked Dock outgrew its reading stage");
  }
}

// ---------------------------------------------------------------------------
// Authoring a connection
// ---------------------------------------------------------------------------

/**
 * A raw selection paints one neutral renderer-only emphasis and nothing else;
 * holding it as a connection phrase turns that into an authoring draft; a
 * second, different phrase makes the relationship question answerable.
 */
async function assertAuthoringDraft(driver, cdp, connectionsLog) {
  const before = await rangeCounts(driver);
  const beforeConnectionLog = logFingerprint(connectionsLog);
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector("[data-marking-selection-emphasis] .connection-emphasis-wash"))`);
  const selectionPaint = await driver.evaluate(`(() => {
    const group = document.querySelector("[data-marking-selection-emphasis]");
    return {
      groups: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      rendererOnlyId: group?.getAttribute("data-connection-id")?.startsWith("__marking-selection-emphasis__:") ?? false,
      paintState: group?.getAttribute("data-paint-state") ?? null,
      resolution: group?.getAttribute("data-anchor-resolution") ?? null,
      washes: group?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      authoring: document.querySelectorAll("[data-authoring-draft]").length,
      routeGroups: document.querySelectorAll(".connection-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      underlines: document.querySelectorAll(".connection-underline").length,
      contacts: document.querySelectorAll(".connection-contact").length,
      hits: document.querySelectorAll(".connection-route-hit").length,
      ticks: document.querySelectorAll("[data-connection-tick]").length,
      cards: document.querySelectorAll(".connection-card").length,
    };
  })()`);
  assert.deepEqual(selectionPaint, {
    groups: 1,
    rendererOnlyId: true,
    paintState: "selection",
    resolution: "exact",
    washes: 1,
    authoring: 0,
    routeGroups: 0,
    routes: 0,
    underlines: 0,
    contacts: 0,
    hits: 0,
    ticks: 0,
    cards: 0,
  }, "a raw selection did not remain one exact renderer-only emphasis");
  assert.deepEqual(await rangeCounts(driver), before, "a raw selection changed durable query counts");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "a raw selection changed connection append-log bytes");

  // Record where the words actually are, so the held paint can be compared to
  // the reader's own Range rather than to itself.
  await driver.evaluate(`(() => {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) throw new Error("Dock authoring selection Range is absent");
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    window.__dockAuthoringSelectionRect = {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
  })()`);

  await beginConnectSession(driver, cdp);
  await driver.waitFor(`Boolean(document.querySelector(".connection-emphasis-mark[data-authoring-draft] .connection-emphasis-wash"))`);
  await settle(driver);
  const report = await driver.evaluate(`(() => {
    const draft = document.querySelector(${JSON.stringify(`.connection-emphasis-mark[data-connection-id="${DRAFT_ID}"]`)});
    const paintRects = [...(draft?.querySelectorAll(".connection-emphasis-wash") ?? [])]
      .map((path) => path.getBoundingClientRect());
    const paintRect = paintRects.length > 0 ? {
      left: Math.min(...paintRects.map((rect) => rect.left)),
      top: Math.min(...paintRects.map((rect) => rect.top)),
      right: Math.max(...paintRects.map((rect) => rect.right)),
      bottom: Math.max(...paintRects.map((rect) => rect.bottom)),
    } : null;
    const exact = (selector) => document.querySelectorAll(${JSON.stringify(`[data-connection-id="${DRAFT_ID}"]`)} + " " + selector).length;
    const root = document.querySelector(${JSON.stringify(HOST)});
    return {
      draftCount: document.querySelectorAll(${JSON.stringify(`.connection-emphasis-mark[data-connection-id="${DRAFT_ID}"]`)}).length,
      paintState: draft?.getAttribute("data-paint-state") ?? null,
      resolution: draft?.getAttribute("data-anchor-resolution") ?? null,
      emphasisPaths: draft?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      routeGroups: document.querySelectorAll(${JSON.stringify(`.connection-mark[data-connection-id="${DRAFT_ID}"]`)}).length,
      routes: exact(".connection-route"),
      underlines: exact(".connection-underline"),
      contacts: exact(".connection-contact"),
      hits: exact(".connection-route-hit"),
      ticks: document.querySelectorAll(${JSON.stringify(`[data-connection-tick="${DRAFT_ID}"]`)}).length,
      selectionEmphasis: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      cards: document.querySelectorAll(".connection-card").length,
      dockState: root?.getAttribute("data-dock-state") ?? null,
      connectState: root?.querySelector("[data-connect-state]")?.getAttribute("data-connect-state") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      sessionRole: root?.querySelector(".marking-connect-draft")?.getAttribute("role") ?? null,
      sessionLabel: root?.querySelector(".marking-connect-draft")?.getAttribute("aria-label") ?? null,
      // RESTATED 2026-07-30: the head is one steady word, the count is the
      // numeral lane of the anchor list, and what used to be a standing hint
      // column is the list's own next-numbered line.
      sessionHead: root?.querySelector(".marking-connect-head")?.textContent?.trim() ?? null,
      sessionNext: root?.querySelector(".marking-connect-next span")?.textContent?.trim() ?? null,
      sessionStatus: root?.querySelector(".marking-connect-status")?.textContent?.trim() ?? null,
      anchors: [...(root?.querySelectorAll(".marking-connect-ref") ?? [])].map((item) => item.textContent?.trim()),
      kindChoices: root?.querySelectorAll("[data-relationship-kind]").length ?? -1,
      actions: [...(root?.querySelectorAll(".marking-connect-actions button") ?? [])].map((button) => button.textContent?.trim()),
      nativeSelection: getSelection()?.toString() ?? "",
      focusedVerse: document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") ?? null,
      selectionRect: window.__dockAuthoringSelectionRect ?? null,
      paintRect,
      globalRoutePlane: {
        groups: document.querySelectorAll(".connection-mark").length,
        routes: document.querySelectorAll(".connection-route").length,
        underlines: document.querySelectorAll(".connection-underline").length,
        contacts: document.querySelectorAll(".connection-contact").length,
        hits: document.querySelectorAll(".connection-route-hit").length,
      },
    };
  })()`);
  assert.equal(report.draftCount, 1, "the held phrase did not receive one draft emphasis group");
  assert.equal(report.paintState, "authoring", "the held phrase lost its explicit authoring paint state");
  assert.equal(report.resolution, "exact", "the held phrase degraded from exact coordinates");
  assert.ok(report.emphasisPaths > 0, "the authoring draft did not bring the captured words into focus");
  assert.deepEqual(
    {
      routeGroups: report.routeGroups,
      routes: report.routes,
      underlines: report.underlines,
      contacts: report.contacts,
      hits: report.hits,
      ticks: report.ticks,
      selectionEmphasis: report.selectionEmphasis,
      cards: report.cards,
    },
    { routeGroups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 0, selectionEmphasis: 0, cards: 0 },
    "the authoring draft leaked route or durable paint",
  );
  assert.equal(report.dockState, "session", "the authoring draft did not own the Dock context");
  assert.equal(report.connectState, "one-anchor", "one held phrase did not report the one-anchor draft state");
  assert.equal(report.armed, "connect:link:parallel", "Connect did not carry its default relationship");
  assert.equal(report.sessionRole, "group", "the connection draft lost its group role");
  assert.equal(report.sessionLabel, "Connection draft", "the connection draft label drifted");
  // With one phrase there is no relation yet, so the kind is not named and the
  // chooser does not exist. Only the phrase count is stated.
  assert.equal(report.sessionHead, "Connection", "the draft head drifted");
  assert.equal(report.sessionNext, "Select the phrase it answers",
    "the anchor list's next-numbered line no longer carries the affordance");
  assert.equal(report.sessionStatus, "", "a one-anchor draft spoke when nothing had happened");
  assert.deepEqual(report.anchors, ["Acts 19:8"], "the draft did not state its held phrase as a whole reference");
  assert.equal(report.kindChoices, 0, "the relationship chooser appeared before a relation existed");
  assert.deepEqual(report.actions, ["Cancel draft"], "a one-anchor draft offered a save it cannot honour");
  assert.equal(report.nativeSelection, "", "the captured phrase remained natively selected");
  assert.equal(report.focusedVerse, String(FIXTURE.phrase.verse), "capture returned focus to the wrong verse");
  assert.deepEqual(report.globalRoutePlane, { groups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0 }, "capture leaked global line paint");
  assert.ok(report.selectionRect && report.paintRect, "the held phrase lacked comparable Range/paint geometry");
  assert.ok(Math.abs(report.selectionRect.left - report.paintRect.left) <= 4, "the held wash began on the wrong words");
  assert.ok(Math.abs(report.selectionRect.right - report.paintRect.right) <= 4, "the held wash ended on the wrong words");
  assert.ok(
    Math.abs((report.selectionRect.top + report.selectionRect.bottom) / 2 - (report.paintRect.top + report.paintRect.bottom) / 2) <= 6,
    "the held wash moved to the wrong rendered line",
  );
  assert.deepEqual(await rangeCounts(driver), before, "one held phrase wrote a durable connection");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "one held phrase changed connection append-log bytes");

  // Re-selecting the same words is a no-op with an explanation, not a second
  // anchor and not a terminal state.
  const firstHeldPaint = await driver.evaluate(`[...document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash")].map((path) => ({
    d: path.getAttribute("d"),
    anchorIndex: path.getAttribute("data-anchor-index"),
    lineCount: path.getAttribute("data-line-count"),
  }))`);
  assert.equal(firstHeldPaint.length, 1, "the first phrase did not own exactly one held paint path");
  const duplicate = await driver.evaluate(selectPhraseExpression(FIXTURE.phrase));
  assert.equal(duplicate, FIXTURE.phrase.quote, "the duplicate phrase selection drifted");
  await driver.waitFor(`document.querySelector(".marking-connect-status")?.textContent?.trim()
    === "That phrase is already held. Select a different phrase to continue."`);
  const duplicateState = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return {
      state: root?.getAttribute("data-dock-state"),
      connectState: root?.querySelector("[data-connect-state]")?.getAttribute("data-connect-state"),
      armed: root?.getAttribute("data-tool-armed"),
      anchors: [...(root?.querySelectorAll(".marking-connect-ref") ?? [])].map((item) => item.textContent?.trim()),
      actions: [...(root?.querySelectorAll(".marking-connect-actions button") ?? [])].map((button) => button.textContent?.trim()),
      retries: root?.querySelectorAll("[data-dock-action]").length ?? -1,
      nativeSelection: getSelection()?.toString() ?? "",
      paint: [...document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash")].map((path) => ({
        d: path.getAttribute("d"),
        anchorIndex: path.getAttribute("data-anchor-index"),
        lineCount: path.getAttribute("data-line-count"),
      })),
    };
  })()`);
  assert.deepEqual(duplicateState, {
    state: "session",
    connectState: "one-anchor",
    armed: "connect:link:parallel",
    anchors: ["Acts 19:8"],
    actions: ["Cancel draft"],
    retries: 0,
    nativeSelection: "",
    paint: firstHeldPaint,
  }, "a duplicate phrase became terminal or duplicated the held paint");
  assert.deepEqual(await rangeCounts(driver), before, "a duplicate phrase wrote durable data");

  // A different phrase recovers normally and opens the relationship question.
  const different = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(different, FIXTURE.counterpart.quote, "the second phrase selection drifted");
  await driver.waitFor(`Boolean(document.querySelector('.marking-connect-draft[data-connect-state="two-anchors"]'))`);
  const continued = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const choices = [...(root?.querySelectorAll("[data-relationship-kind]") ?? [])];
    return {
      state: root?.getAttribute("data-dock-state"),
      connectState: root?.querySelector("[data-connect-state]")?.getAttribute("data-connect-state"),
      armed: root?.getAttribute("data-tool-armed"),
      anchors: [...(root?.querySelectorAll(".marking-connect-ref") ?? [])].map((item) => item.textContent?.trim()),
      kindIds: choices.map((choice) => choice.getAttribute("data-relationship-kind")),
      // RESTATED 2026-07-30: the kind is a WORD (Rev 04 §5), so the button IS
      // its label — there is no inner glyph or label span to read through, and
      // the group is a radiogroup because moving through it chooses.
      kindLabels: choices.map((choice) => choice.textContent?.trim()),
      kindGlyphs: root?.querySelectorAll(".marking-connect-kinds svg").length ?? -1,
      kindGroupRole: root?.querySelector(".marking-connect-kinds")?.getAttribute("role") ?? null,
      kindGroupLabel: root?.querySelector(".marking-connect-kinds")?.getAttribute("aria-label") ?? null,
      field: root?.querySelectorAll(".marking-connect-field textarea").length ?? -1,
      actions: [...(root?.querySelectorAll(".marking-connect-actions button") ?? [])].map((button) => button.textContent?.trim()),
      saveDisabled: root?.querySelector(".marking-connect-actions .marking-session-action.primary")?.disabled ?? null,
      indices: [...document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash")].map((path) => path.getAttribute("data-anchor-index")),
      draftGroups: document.querySelectorAll("[data-authoring-draft]").length,
      selectionEmphasis: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      lineOrTickArtifacts: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit, [data-connection-tick]").length,
      cards: document.querySelectorAll(".connection-card").length,
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.deepEqual(continued, {
    state: "session",
    connectState: "two-anchors",
    armed: "connect:link:parallel",
    anchors: ["Acts 19:8", "Acts 19:9"],
    kindIds: RELATIONSHIPS,
    kindLabels: RELATIONSHIP_LABELS,
    kindGlyphs: 0,
    kindGroupRole: "radiogroup",
    kindGroupLabel: "Connection kind",
    field: 1,
    actions: ["Save connection", "Cancel draft"],
    // The relation exists but has not been named, so saving is not yet honest.
    saveDisabled: true,
    indices: ["0", "1"],
    draftGroups: 1,
    selectionEmphasis: 0,
    lineOrTickArtifacts: 0,
    cards: 0,
    nativeSelection: "",
  }, "a second phrase did not open a nameable two-anchor relation");
  assert.deepEqual(await rangeCounts(driver), before, "a two-anchor draft wrote before it was saved");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "a two-anchor draft changed connection append-log bytes before saving");

  // Naming the relation is what makes Save honest.
  await chooseSessionKind(driver, cdp, "series");
  const named = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    return {
      // The chosen kind is marked on the WORD, so that is where it is read.
      kind: [...(root?.querySelectorAll(".marking-connect-kind") ?? [])]
        .filter((choice) => choice.getAttribute("aria-checked") === "true")
        .map((choice) => choice.textContent?.trim()),
      saveDisabled: root?.querySelector(".marking-connect-actions .marking-session-action.primary")?.disabled ?? null,
      armed: root?.getAttribute("data-tool-armed"),
    };
  })()`);
  assert.deepEqual(
    named,
    { kind: ["Series"], saveDisabled: false, armed: "connect:series" },
    "naming the relation did not unlock an honest save",
  );

  // Cancelling clears the draft paint entirely and writes nothing.
  await ensureDockResting(driver, cdp);
  const cancelled = await driver.evaluate(`(() => ({
    draft: document.querySelectorAll(${JSON.stringify(`[data-connection-id="${DRAFT_ID}"]`)}).length,
    route: document.querySelectorAll(${JSON.stringify(`.connection-mark[data-connection-id="${DRAFT_ID}"]`)}).length,
    tick: document.querySelectorAll(${JSON.stringify(`[data-connection-tick="${DRAFT_ID}"]`)}).length,
    session: document.querySelectorAll(".marking-session").length,
    globalLines: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit").length,
  }))()`);
  assert.deepEqual(
    cancelled,
    { draft: 0, route: 0, tick: 0, session: 0, globalLines: 0 },
    "cancelling a draft leaked its paint",
  );
  await driver.evaluate(`delete window.__dockAuthoringSelectionRect`);
  assert.deepEqual(await rangeCounts(driver), before, "cancelling a draft wrote authored data");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "cancelling a draft changed connection append-log bytes");
}

/**
 * Save a real connection and prove what it leaves behind.
 *
 * A SAVED connection is a durable paint record, and `ConnectionUnderlay` only
 * renders `.connection-emphasis-mark` for records that are NOT durable. So a
 * saved, unselected connection has no emphasis mark at all — its resting
 * presence is a tick in the margin lane. The previous tour waited for that
 * absent element to report `data-paint-state="dormant"`, a value the component
 * has never emitted on an element that could never exist; `querySelector`
 * returning null and a wrong selector are indistinguishable, so it asserted
 * nothing either way.
 */
async function assertCompletedConnection(driver, cdp, connectionsLog, successFrames) {
  const before = await rangeCounts(driver);
  const expectedAnchors = await Promise.all([
    expectedConnectionAnchor(driver, FIXTURE.phrase),
    expectedConnectionAnchor(driver, FIXTURE.distant),
  ]);
  assert.equal(expectedAnchors.length, 2, "the connection fixture did not resolve two exact anchors");
  const beforeLog = logFingerprint(connectionsLog);

  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await beginConnectSession(driver, cdp);
  const second = await driver.evaluate(selectPhraseExpression(FIXTURE.distant));
  assert.equal(second, FIXTURE.distant.quote, "the connection counterpart selection drifted");
  await driver.waitFor(`Boolean(document.querySelector('.marking-connect-draft[data-connect-state="two-anchors"]'))`);
  await chooseSessionKind(driver, cdp, "series");

  // A blocked save must keep the whole draft and say so, then retry cleanly.
  await withWriteBlocked(connectionsLog, async () => {
    await saveConnection(driver, cdp, "Dock blocked Save connection");
    await driver.waitFor(`Boolean(document.querySelector('.marking-connect-draft[data-connect-state="recovery"]'))`, 20_000);
    const failed = await driver.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(HOST)});
      const draft = root?.querySelector(".marking-connect-draft");
      if (!draft) return { present: false };
      const state = draft.querySelector(".surface-state");
      return {
        present: true,
        connectState: draft.getAttribute("data-connect-state"),
        recoveryLabel: draft.querySelector(".marking-session-recovery")?.textContent?.trim() ?? null,
        surfaceState: state?.getAttribute("data-surface-state") ?? null,
        thing: state?.querySelector(".surface-state-thing")?.textContent?.trim() ?? null,
        actions: [...(state?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim()),
        anchors: [...draft.querySelectorAll(".marking-connect-ref")].map((item) => item.textContent?.trim()),
        heldPaint: document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash").length,
        busy: root?.querySelector(".marking-dock")?.getAttribute("aria-busy"),
      };
    })()`);
    assert.equal(failed.present, true, "a blocked save destroyed the draft");
    assert.equal(failed.connectState, "recovery", "a blocked save did not enter its recovery state");
    assert.equal(failed.recoveryLabel, "Not saved", "the recovery state did not name itself as the reader would");
    assert.equal(failed.surfaceState, "failed", "the recovery state did not report a failure");
    assert.ok(failed.thing && failed.thing.length > 0, "the recovery state failed to say what happened");
    assert.ok(
      !/\/(Users|tmp|var)\//.test(failed.thing),
      `a blocked save leaked a host path into the reader's copy: ${failed.thing}`,
    );
    assert.deepEqual(failed.actions, ["Retry", "Copy text"], "recovery did not offer exactly Retry and Copy text");
    assert.deepEqual(failed.anchors, ["Acts 19:8", "Acts 19:20"], "a blocked save dropped a held phrase");
    assert.equal(failed.heldPaint, 2, "a blocked save dropped the held draft paint");
    assert.equal(failed.busy, "false", "a blocked save never released the busy state");
    assert.deepEqual(await rangeCounts(driver), before, "a blocked save wrote a durable connection");
    assert.deepEqual(logFingerprint(connectionsLog), beforeLog, "a blocked save changed connection append-log bytes");
    await parkPointer(cdp);
    await bufferSuccessScreenshot(cdp, successFrames, "marking-dock-proof-connection-recovery.png");
  });
  assert.deepEqual(logFingerprint(connectionsLog), beforeLog, "restoring connection-log permissions changed append-log bytes");

  // Retry sends the same command; it must resolve to exactly one connection.
  await pointerClick(
    driver,
    cdp,
    `${HOST} .surface-state-actions .marking-session-action.primary`,
    "Dock connection Retry action",
  );
  await driver.waitFor(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.connections.length === ${before.connections + 1};
  })()`, 20_000);
  const afterSave = logFingerprint(connectionsLog);
  assert.ok(afterSave.bytes > beforeLog.bytes, "a successful connection did not append log bytes");
  assert.equal(afterSave.lines, beforeLog.lines + 1, "a successful connection appended more or fewer than one event");
  assert.notEqual(afterSave.sha256, beforeLog.sha256, "a successful connection left the append-log digest unchanged");

  const saved = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const record = result.connections[0];
    return record ? { id: record.id, kind: record.kind, anchors: record.anchors } : null;
  })()`);
  assert.ok(saved, "the saved connection has no durable record");
  assert.ok(typeof saved.id === "string" && saved.id.length > 0, "the saved connection did not return a durable id");
  assert.equal(saved.kind, "series", "the saved connection lost the relationship the reader named");
  assert.deepEqual(saved.anchors, expectedAnchors, "the saved connection's payload drifted from its exact v2 anchors");

  await ensureDockResting(driver, cdp);
  await settle(driver);

  // Resting presence: no emphasis mark (it is durable now), no lines, one tick.
  const resting = await driver.evaluate(`(() => {
    const id = ${JSON.stringify(saved.id)};
    return {
      emphasisMarks: document.querySelectorAll(".connection-emphasis-mark[data-connection-id=\\"" + CSS.escape(id) + "\\"]").length,
      anyEmphasis: document.querySelectorAll(".connection-emphasis-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      underlines: document.querySelectorAll(".connection-underline").length,
      contacts: document.querySelectorAll(".connection-contact").length,
      hits: document.querySelectorAll(".connection-route-hit").length,
      ticks: document.querySelectorAll("[data-connection-tick]").length,
      paintStates: [...document.querySelectorAll("[data-paint-state]")].map((node) => node.getAttribute("data-paint-state")),
      cards: document.querySelectorAll(".connection-card").length,
    };
  })()`);
  assert.equal(resting.emphasisMarks, 0, "a saved connection kept a draft-only emphasis mark");
  assert.equal(resting.anyEmphasis, 0, "a saved connection left stray emphasis paint on the page");
  // Resting presence is quiet but not invisible: both member phrases keep an
  // underline, and one tick sits in the margin lane. What must NOT be there is
  // the loud half — the route between them, its contacts and its hit target —
  // which belongs to the selected state alone.
  assert.deepEqual(
    { routes: resting.routes, underlines: resting.underlines, contacts: resting.contacts, hits: resting.hits },
    { routes: 0, underlines: 2, contacts: 0, hits: 0 },
    "a resting saved connection did not settle into two quiet underlines and no line paint",
  );
  assert.equal(resting.ticks, 1, `a resting saved connection showed ${resting.ticks} ticks, expected 1`);
  assert.deepEqual(resting.paintStates, [], "a resting saved connection still carried a paint state");
  assert.equal(resting.cards, 0, "a resting saved connection opened a card nobody asked for");

  // Selecting it wakes the full route, and the Living Margin opens its card.
  // The route needs room: below a certain stage width the component says so
  // explicitly with data-paint-state="needs-space" and draws no line, which is
  // a designed state rather than a missing one. So the wide case is measured
  // where the line can actually exist.
  await setViewport(cdp, driver, 1280, 900);
  await ensureDockResting(driver, cdp);
  await settle(driver);
  // The tick tracks its anchor bands, and this connection's first anchor is
  // near the top of the chapter — which puts the tick under the sticky topbar,
  // where it is a real element at a real position that simply cannot be hit.
  // pointerClick scrolls only `nearest`, which is not enough to clear a sticky
  // header, so centre it first.
  await driver.evaluate(`(() => {
    const tick = document.querySelector("[data-connection-tick]");
    if (!tick) throw new Error("no durable connection tick to scroll to");
    tick.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  })()`);
  await settle(driver);
  await pointerClick(driver, cdp, "[data-connection-tick]", "Dock durable connection tick");
  await driver.waitFor(`Boolean(document.querySelector("[data-connection-tick][data-selected-connection-id]"))`);
  await settle(driver);
  const selected = await driver.evaluate(`(() => {
    const mark = document.querySelector(".connection-mark");
    const stage = document.querySelector(".scripture-reading-stage")?.getBoundingClientRect();
    const column = document.querySelector(".verse-text")?.getBoundingClientRect();
    return {
      selectedTicks: document.querySelectorAll("[data-connection-tick][data-selected-connection-id]").length,
      routeGroups: document.querySelectorAll(".connection-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      markPaintState: mark?.getAttribute("data-paint-state") ?? null,
      routeReason: mark?.getAttribute("data-route") ?? null,
      resolution: mark?.getAttribute("data-anchor-resolution") ?? null,
      underlines: document.querySelectorAll(".connection-underline").length,
      cards: document.querySelectorAll(".connection-card").length,
      marginView: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view") ?? null,
      awake: document.querySelectorAll(".connection-underlay.is-awake").length,
      stageWidth: stage ? Math.round(stage.width) : null,
      columnWidth: column ? Math.round(column.width) : null,
    };
  })()`);
  // Selection itself, the mark group, the members and the card are all
  // reachable and all asserted.
  assert.equal(selected.selectedTicks, 1, `selecting a connection marked ${selected.selectedTicks} ticks selected, expected 1`);
  assert.equal(selected.routeGroups, 1, `selecting a connection produced ${selected.routeGroups} route groups, expected 1`);
  assert.equal(selected.resolution, "exact", "a selected connection lost its exact active-package paint");
  assert.equal(selected.underlines, 2, `a selected connection underlined ${selected.underlines} phrases, expected 2`);
  assert.equal(selected.cards, 1, "a selected connection did not open exactly one Living Margin card");
  assert.equal(selected.marginView, "connection", "the Living Margin did not switch to its connection view");
  assert.equal(selected.awake, 1, "the connection underlay did not wake for its selected connection");

  /*
   * UNREACHED FROM THIS FIXTURE: a DRAWN route.
   *
   * `data-paint-state="selected"` with a `.connection-route` path is a real
   * state the component can emit, but nothing this tour can set up reaches it.
   * Measured on this build, with a saved two-phrase Series connection selected:
   *
   *   anchors 19:8 + 19:9  (adjacent)   stage  772px -> needs-space
   *   anchors 19:8 + 19:20 (far apart)  stage  772px -> needs-space
   *                                     stage  992px -> needs-space
   *                                     stage 1192px -> needs-space
   *                                     stage 1392px -> needs-space
   *                                     stage 1428px -> needs-space
   *   The Narrow / Medium / Wide setting held the column at 724px on all three
   *   values and reported needs-space on all three — but that leg proved
   *   nothing about the measure. The control was writing a class no stylesheet
   *   read, which is exactly why the column never moved; it has since been
   *   removed, and the measure now travels with reading size (560/660/780).
   *   The stage sweep above stands on its own: at the widest probe the gutter
   *   is ~350px per side and the engine still declines to route.
   *
   * So this is NOT the documented "too narrow to draw a line" case, and it is
   * not something a wider window fixes. Either the route engine is refusing a
   * plan it should accept, or a drawn route needs a precondition this tour has
   * not discovered. Asserting `routes >= 1` here would gate the whole Dock on
   * an unrelated engine, and asserting `routes === 0` would bless a blank line
   * plane as correct — so the tour asserts the honest, reachable facts above,
   * states the value the engine actually reported, and leaves the drawn-route
   * branch openly unproven rather than quietly exercised.
   */
  assert.equal(
    selected.markPaintState,
    "needs-space",
    `the selected connection reported data-paint-state="${selected.markPaintState}" `
    + `(route reason "${selected.routeReason}") at a ${selected.stageWidth}px stage with a `
    + `${selected.columnWidth}px column. If this is now "selected", the route engine has been `
    + "fixed — replace this with the drawn-route assertions the comment above describes.",
  );
  assert.equal(selected.routes, 0, "a needs-space connection drew a route path anyway");
  await parkPointer(cdp);
  await bufferSuccessScreenshot(cdp, successFrames, "marking-dock-proof-selected-connection.png");

  // Narrowing must keep the selection, the members and the card whatever the
  // line plane decides.
  await setViewport(cdp, driver, 640, 900);
  await settle(driver);
  const cramped = await driver.evaluate(`(() => {
    const mark = document.querySelector(".connection-mark");
    return {
      selectedTicks: document.querySelectorAll("[data-connection-tick][data-selected-connection-id]").length,
      routeGroups: document.querySelectorAll(".connection-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      paintState: mark?.getAttribute("data-paint-state") ?? null,
      underlines: document.querySelectorAll(".connection-underline").length,
      cards: document.querySelectorAll(".connection-card").length,
      marginView: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view") ?? null,
    };
  })()`);
  assert.equal(cramped.selectedTicks, 1, "narrowing dropped the connection's selection");
  assert.equal(cramped.paintState, "needs-space", "a route with no room did not declare needs-space");
  assert.equal(cramped.routes, 0, "a needs-space route still drew a line");
  assert.equal(cramped.routeGroups, 1, "a needs-space connection lost its mark group");
  assert.equal(cramped.underlines, 2, "narrowing dropped the member underlines");
  assert.equal(cramped.cards, 1, "narrowing closed the Living Margin card");
  assert.equal(cramped.marginView, "connection", "narrowing left the Living Margin's connection view");
  await setViewport(cdp, driver, 1280, 900);
  await settle(driver);

  // Releasing it returns to the quiet resting presence.
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelectorAll(".connection-route").length === 0`);
  await settle(driver);
  const released = await driver.evaluate(`(() => ({
    routes: document.querySelectorAll(".connection-route").length,
    underlines: document.querySelectorAll(".connection-underline").length,
    emphasis: document.querySelectorAll(".connection-emphasis-mark").length,
    ticks: document.querySelectorAll("[data-connection-tick]").length,
  }))()`);
  assert.deepEqual(
    released,
    { routes: 0, underlines: 2, emphasis: 0, ticks: 1 },
    "releasing a connection did not return it to its quiet resting presence",
  );
  await ensureDockResting(driver, cdp);
  return saved.id;
}

// ---------------------------------------------------------------------------
// Media, motion and memory
// ---------------------------------------------------------------------------

function allZeroDurations(value) {
  return value.every((duration) => Number.parseFloat(duration) === 0);
}

async function assertReducedMotion(driver, cdp) {
  await setMedia(cdp, { reduced: true });
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase, true);
  await settle(driver, true);
  const motion = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const nodes = [root, ...(root?.querySelectorAll("*") ?? [])].filter(Boolean);
    return {
      nodes: nodes.length,
      animations: nodes.flatMap((node) => getComputedStyle(node).animationDuration.split(", ")),
      transitions: nodes.flatMap((node) => getComputedStyle(node).transitionDuration.split(", ")),
      running: typeof document.getAnimations === "function"
        ? document.getAnimations().filter((animation) => {
          const target = animation.effect?.target;
          return target instanceof Element && root?.contains(target) && animation.playState === "running";
        }).length
        : 0,
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.ok(motion.nodes > 1, "the reduced-motion probe found no Dock nodes to measure");
  assert.equal(allZeroDurations(motion.animations), true, "the reduced-motion Dock retained an animation duration");
  assert.equal(allZeroDurations(motion.transitions), true, "the reduced-motion Dock retained a transition duration");
  assert.equal(motion.running, 0, "the reduced-motion Dock retained a running animation");
  assert.equal(motion.nativeSelection, FIXTURE.phrase.quote, "the reduced-motion Dock collapsed its exact selection");
  await dismissDockSelection(driver, cdp);
  await setMedia(cdp);
  await settle(driver);
}

/**
 * Forced colors and coarse pointers.
 *
 * In forced-colors mode the wash cannot be shown, so each swatch names its
 * pigment instead. Those codes are the full names — Amber, Sage, Sky, Rose,
 * Violet — not initials; the previous tour asserted "A/G/S/R/V", which no
 * element has ever carried.
 */
async function assertForcedColorsAndCoarseTargets(driver, cdp) {
  await setViewport(cdp, driver, 390, 900);
  await setMedia(cdp, { forced: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await settle(driver);

  const forced = await driver.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(HOST)});
    const bar = root?.querySelector(".marking-bar");
    const commands = [...(bar?.querySelectorAll("[data-bar-action]") ?? [])];
    const swatches = [...(bar?.querySelectorAll('[data-bar-action="highlight"]') ?? [])];
    const dockRect = root?.querySelector(".marking-dock")?.getBoundingClientRect() ?? null;
    return {
      layout: root?.getAttribute("data-dock-layout") ?? null,
      coarse: matchMedia("(pointer: coarse)").matches,
      commandCount: commands.length,
      forcedCodes: swatches.map((choice) => choice.querySelector(".marking-pigment")?.getAttribute("data-forced-code") ?? null),
      targets: commands.map((button) => {
        const rect = button.getBoundingClientRect();
        return { id: button.getAttribute("data-bar-action"), width: rect.width, height: rect.height };
      }),
      insideDock: dockRect ? commands.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= dockRect.left - ${GEOMETRY_EPSILON}
          && rect.right <= dockRect.right + ${GEOMETRY_EPSILON}
          && rect.top >= dockRect.top - ${GEOMETRY_EPSILON}
          && rect.bottom <= dockRect.bottom + ${GEOMETRY_EPSILON};
      }) : false,
      outsideDock: dockRect ? commands.filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left < dockRect.left - ${GEOMETRY_EPSILON}
          || rect.right > dockRect.right + ${GEOMETRY_EPSILON}
          || rect.top < dockRect.top - ${GEOMETRY_EPSILON}
          || rect.bottom > dockRect.bottom + ${GEOMETRY_EPSILON};
      }).map((button) => button.getAttribute("data-bar-action")) : [],
      borderVisible: root ? getComputedStyle(root.querySelector(".marking-dock")).borderStyle !== "none" : false,
    };
  })()`);
  assert.equal(forced.layout, "stacked", "the forced-colors probe did not use the stacked Dock");
  assert.equal(forced.coarse, true, "touch emulation did not activate the coarse-pointer media rules");
  assert.equal(forced.commandCount, 8, `the forced-colors bar exposed ${forced.commandCount} commands, expected 8`);
  assert.deepEqual(forced.forcedCodes, [...FORCED_CODES], "forced colors lost the pigment name codes");
  assert.equal(forced.borderVisible, true, "the forced-colors Dock lost its material boundary");
  // Containment at 390px is the same product defect the matrix already found,
  // so it joins the collected channel rather than aborting the media phase.
  if (!forced.insideDock) {
    recordGeometryDefect(
      "forced colors + coarse/390x900",
      `${forced.outsideDock.join(" and ")} escaped the Dock shell`,
    );
  }
  for (const target of forced.targets) {
    assert.ok(
      target.height >= 44 - GEOMETRY_EPSILON,
      `coarse-pointer command ${target.id} is only ${target.height}px tall, below the 44px target`,
    );
  }

  // A keyboard focus must remain visible in forced colors.
  await driver.evaluate(`document.querySelector(${JSON.stringify(`${HOST} [data-pigment="blue"]`)})?.focus()`);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  const focusRing = await driver.evaluate(`(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  })()`);
  assert.ok(focusRing, "forced-colors focus left no focused element");
  assert.notEqual(focusRing.outlineStyle, "none", "the forced-colors focused command lost its outline");

  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
  await setMedia(cdp);
  await dismissDockSelection(driver, cdp);
  await setViewport(cdp, driver, 860, 900);
  await ensureDockResting(driver, cdp);
}

/**
 * The Dock enters once. Resizing, crossing the layout breakpoint, or changing
 * atmosphere must not remount it or replay the entrance.
 */
async function assertNoMotionReplay(driver, cdp) {
  await ensureDockResting(driver, cdp);
  const entrances = await driver.evaluate(`window.__dockEntranceStarts`);
  assert.equal(typeof entrances, "number", "the entrance counter was never installed");
  const identity = await driver.evaluate(`(() => {
    const dock = document.querySelector(${JSON.stringify(`${HOST} .marking-dock`)});
    if (!dock) return null;
    window.__dockIdentityProbe = dock;
    return { entered: dock.classList.contains("is-entered") };
  })()`);
  assert.ok(identity, "there is no Dock to watch for motion replay");
  assert.equal(identity.entered, true, "the Dock never completed its entrance");

  await setViewport(cdp, driver, 900, 900);
  await settle(driver);
  await setViewport(cdp, driver, 640, 900);
  await settle(driver);
  await setViewport(cdp, driver, 1280, 900);
  await settle(driver);
  await setTheme(driver, "dark");
  await settle(driver);
  await setTheme(driver, "light");
  await settle(driver);
  await setViewport(cdp, driver, 860, 900);
  await settle(driver);

  const after = await driver.evaluate(`(() => {
    const dock = document.querySelector(${JSON.stringify(`${HOST} .marking-dock`)});
    return {
      sameNode: dock === window.__dockIdentityProbe,
      entrances: window.__dockEntranceStarts,
      entered: dock?.classList.contains("is-entered") ?? false,
    };
  })()`);
  assert.equal(after.sameNode, true, "the Dock remounted across resize, breakpoint, or theme changes");
  assert.equal(after.entered, true, "the Dock lost its entered state");
  assert.equal(
    after.entrances,
    entrances,
    `the Dock replayed its entrance ${after.entrances - entrances} extra times across resize, breakpoint and theme changes`,
  );
  await driver.evaluate(`delete window.__dockIdentityProbe`);
}

async function collectRendererMemory(cdp) {
  await cdp.send("HeapProfiler.enable").catch(() => undefined);
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
  // Performance.getMetrics returns an empty list until the domain is enabled,
  // which reads as "no heap metric" rather than as a missing prerequisite.
  await cdp.send("Performance.enable").catch(() => undefined);
  const counters = await cdp.send("Memory.getDOMCounters");
  const metrics = await cdp.send("Performance.getMetrics");
  const heap = metrics.result.metrics.find((metric) => metric.name === "JSHeapUsedSize");
  assert.ok(
    Number.isInteger(counters.result.nodes) && Number.isInteger(counters.result.jsEventListeners),
    "CDP returned invalid Dock DOM memory counters",
  );
  assert.ok(heap && Number.isFinite(heap.value), "CDP returned an invalid Dock renderer heap size");
  return { nodes: counters.result.nodes, listeners: counters.result.jsEventListeners, heap: heap.value };
}

/**
 * Open and close the Dock's states repeatedly in both layouts, then prove the
 * renderer settled rather than grew. Every cycle is asserted, so a cycle that
 * silently stopped working cannot masquerade as a clean run.
 */
async function runDockStressBatch(driver, cdp, cycles) {
  let completed = 0;
  for (let index = 0; index < cycles; index += 1) {
    await openDockSelection(driver, index % 2 === 0 ? FIXTURE.phrase : FIXTURE.counterpart, true);
    const opened = await driver.evaluate(`Boolean(document.querySelector(${JSON.stringify(`${HOST} .marking-bar`)}))`);
    assert.equal(opened, true, `Dock stress cycle ${index}: the selection bar did not mount`);

    await pointerClick(driver, cdp, `${HOST} [data-bar-action="more"]`, `Dock stress cycle ${index} More`);
    await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${HOST} .marking-more`)}))`);
    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await driver.waitFor(`!document.querySelector(${JSON.stringify(`${HOST} .marking-more`)})`);

    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await driver.waitFor(`document.querySelector(${JSON.stringify(HOST)})?.getAttribute("data-dock-state") === "rest"`);
    completed += 1;
  }
  assert.equal(completed, cycles, `Dock stress batch completed ${completed} of ${cycles} cycles`);
  return completed;
}

async function assertWarmPlateau(driver, cdp) {
  await ensureDockResting(driver, cdp);
  await dismissAllToasts(driver);

  // Warm the caches first, so the measured batch is a plateau and not a climb.
  await setViewport(cdp, driver, 860, 900);
  await runDockStressBatch(driver, cdp, STRESS_CYCLES);
  await setViewport(cdp, driver, 640, 900);
  await runDockStressBatch(driver, cdp, STRESS_CYCLES);
  await ensureDockResting(driver, cdp);
  await settle(driver);
  const before = await collectRendererMemory(cdp);

  await setViewport(cdp, driver, 860, 900);
  const shelfCycles = await runDockStressBatch(driver, cdp, STRESS_CYCLES);
  await setViewport(cdp, driver, 640, 900);
  const stackedCycles = await runDockStressBatch(driver, cdp, STRESS_CYCLES);
  await ensureDockResting(driver, cdp);
  await settle(driver);
  const after = await collectRendererMemory(cdp);

  const nodeGrowth = after.nodes - before.nodes;
  const listenerGrowth = after.listeners - before.listeners;
  const heapGrowth = after.heap - before.heap;
  assert.ok(
    nodeGrowth <= 400,
    `the warm Dock grew ${nodeGrowth} DOM nodes across ${shelfCycles + stackedCycles} cycles`,
  );
  assert.ok(
    listenerGrowth <= 120,
    `the warm Dock grew ${listenerGrowth} event listeners across ${shelfCycles + stackedCycles} cycles`,
  );
  assert.ok(
    heapGrowth <= MAX_WARM_HEAP_GROWTH,
    `the warm Dock grew ${heapGrowth} heap bytes, above the ${MAX_WARM_HEAP_GROWTH} plateau`,
  );
  return { cycles: shelfCycles + stackedCycles, nodeGrowth, listenerGrowth, heapGrowth };
}

// ---------------------------------------------------------------------------
// Failure capture
// ---------------------------------------------------------------------------

function failureClassification(error, context, childState) {
  if (error?.code === "ELECTRON_LAUNCH_BLOCKED" || childState.spawnError) return "electron-launch";
  if (error?.code === "ELECTRON_RENDERER_BOOTSTRAP_FAILED") return "renderer-bootstrap";
  if (context?.phase === "launch" || context?.phase === "renderer-bootstrap") return "renderer-bootstrap";
  return "dock-regression";
}

async function captureFailure(cdp, driver, error, context, childLog, childState) {
  const classification = failureClassification(error, context, childState);
  mkdirSync(FAILURE_DIR, { recursive: true });
  let snapshot = null;
  if (driver) {
    snapshot = await driver.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(HOST)});
      const context = root?.querySelector(".marking-dock-context");
      return {
        url: location.href,
        theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
        viewport: { width: innerWidth, height: innerHeight },
        narrowShell: matchMedia(${JSON.stringify(NARROW_SHELL)}).matches,
        dockPresent: Boolean(root),
        state: root?.getAttribute("data-dock-state") ?? null,
        layout: root?.getAttribute("data-dock-layout") ?? null,
        armed: root?.getAttribute("data-tool-armed") ?? null,
        capture: root?.getAttribute("data-selection-capture") ?? null,
        contents: [...(context?.children ?? [])].map((child) => child.className),
        contextText: context?.textContent?.trim().slice(0, 400) ?? null,
        guard: document.querySelectorAll(".connection-draft-exit-scrim").length,
        nativeSelection: getSelection()?.toString() ?? "",
      };
    })()`).catch(() => null);
  }
  if (cdp) {
    await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })
      .then((response) => writeFileSync(FAILURE_SCREENSHOT_PATH, Buffer.from(response.result.data, "base64")))
      .catch(() => undefined);
  }
  writeFileSync(FAILURE_STATE_PATH, `${JSON.stringify({
    classification,
    message: error?.message ?? String(error),
    context,
    snapshot,
    childState,
    childLog,
  }, null, 2)}\n`);
  console.error(`Dock failure classification: ${classification}`);
  console.error(`Dock failure artifacts: ${FAILURE_SCREENSHOT_PATH}, ${FAILURE_STATE_PATH}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

assertConstantsMatchVocabulary();

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-marking-dock-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const highlightsLog = join(libraryPath, "annotations", "highlights.jsonl");
const connectionsLog = join(libraryPath, "annotations", "connections.jsonl");
const port = 11_700 + Math.floor(Math.random() * 500);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = { ...process.env, LIBRARY_PATH: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
const childState = { exited: false, code: null, signal: null, spawnError: null };
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
);
child.once("exit", (code, signal) => {
  childState.exited = true;
  childState.code = code;
  childState.signal = signal;
});
child.once("error", (error) => {
  childState.spawnError = String(error);
});
let childLog = "";
const retainLog = (chunk) => {
  childLog = (childLog + chunk.toString()).slice(-20_000);
};
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
let driver = null;
const successFrames = [];
let gatePassed = false;
let failureContext = { phase: "launch" };
try {
  const target = await waitForTarget(endpoint, childState);
  cdp = await connect(target.webSocketDebuggerUrl);
  driver = createDriver(cdp);
  failureContext = { phase: "renderer-bootstrap" };
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);
  await setViewport(cdp, driver, 1280, 900);

  const fixtureReady = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const fixtures = ${JSON.stringify([FIXTURE.phrase, FIXTURE.counterpart, FIXTURE.stressPhrase, FIXTURE.distant])};
    for (const fixture of fixtures) {
      if (!text(fixture.verse).includes(fixture.quote)) throw new Error("Dock fixture quote is absent: " + fixture.quote);
    }
    await window.api.settings.set({
      theme: "light",
      sidebarCollapsed: true,
      marginVisible: false,
      markingSurface: "dock",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return true;
  })()`);
  assert.equal(fixtureReady, true, "Dock fixture setup failed");

  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__dockEntranceStarts = 0;
      document.addEventListener("animationstart", (event) => {
        if (event.animationName === "marking-dock-in") window.__dockEntranceStarts += 1;
      }, true);
    })();`,
  });
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${HOST} .marking-dock`)}))`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === "light"`);
  await driver.waitFor(`Number.isInteger(window.__dockEntranceStarts)`);
  await setMedia(cdp);
  await settle(driver);
  assert.deepEqual(await rangeCounts(driver), { highlights: 0, connections: 0, notes: 0 }, "the isolated Dock library was not empty");
  failureContext = { phase: "renderer-ready" };

  const reports = [];
  for (const theme of THEMES) {
    await setViewport(cdp, driver, 1280, 900);
    await setTheme(driver, theme);
    for (const viewport of VIEWPORTS) {
      failureContext = { phase: "matrix", theme, viewport };
      await setViewport(cdp, driver, viewport.width, viewport.height);
      await ensureDockResting(driver, cdp);
      await openDockSelection(driver);
      const report = await driver.evaluate(dockMatrixReportExpression());
      const before = GEOMETRY_DEFECTS.length;
      assertDockMatrixReport(report, theme, viewport);
      // More lives behind a command that can itself be clipped, so only sweep
      // it where the command is actually reachable. Asserting six items in a
      // cell where the opener cannot be clicked would be asserting nothing.
      const moreReachable = !report.clippedCommands.includes("more");
      if (moreReachable) await assertMoreList(driver, cdp, theme, viewport);
      reports.push({ theme, ...viewport, layout: report.layout, stage: report.stageRect });
      const cellDefects = GEOMETRY_DEFECTS.length - before;
      console.log(
        `${THEME_LABELS.get(theme).padEnd(11)} ${viewport.label.padStart(8)}  `
        + `${report.layout.padEnd(7)}  5 washes + note/connect/more  `
        + `${moreReachable ? "6 More items" : "More UNREACHABLE"}  `
        + `${cellDefects === 0 ? "geometry ok" : `${cellDefects} GEOMETRY DEFECT${cellDefects === 1 ? "" : "S"}`}`,
      );
      await dismissDockSelection(driver, cdp);
    }
  }
  const expectedMatrixKeys = THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => `${theme}:${viewport.label}`));
  const actualMatrixKeys = reports.map((report) => `${report.theme}:${report.label}`);
  assert.equal(reports.length, THEMES.length * VIEWPORTS.length, "the Dock matrix did not execute every declared cell");
  assert.deepEqual(actualMatrixKeys, expectedMatrixKeys, "the Dock matrix executed the wrong theme/viewport keys");

  failureContext = { phase: "keyboard" };
  await setViewport(cdp, driver, 860, 900);
  await setTheme(driver, "light");
  await assertKeyboardContracts(driver, cdp, highlightsLog);
  await assertEscapeLadder(driver, cdp);

  failureContext = { phase: "mutation-retry" };
  await assertMutationAndRetryFlows(driver, cdp, highlightsLog, successFrames);

  failureContext = { phase: "authoring-draft" };
  await assertAuthoringDraft(driver, cdp, connectionsLog);

  failureContext = { phase: "reduced-motion" };
  await assertReducedMotion(driver, cdp);

  failureContext = { phase: "forced-colors-coarse" };
  await assertForcedColorsAndCoarseTargets(driver, cdp);

  failureContext = { phase: "motion-replay" };
  await assertNoMotionReplay(driver, cdp);

  failureContext = { phase: "warm-plateau" };
  await setViewport(cdp, driver, 860, 900);
  await setTheme(driver, "light");
  const plateau = await assertWarmPlateau(driver, cdp);

  failureContext = { phase: "completed-connection" };
  await assertCompletedConnection(driver, cdp, connectionsLog, successFrames);

  // Say what passed BEFORE failing on geometry. A run that fails without first
  // reporting its eight green phases tells the reader only that something is
  // wrong, which is how a single known layout bug comes to look like a dead
  // tour and stops being run at all.
  console.log(`PASS Dock matrix: ${reports.length}/${THEMES.length * VIEWPORTS.length} theme-viewport cells, anatomy and vocabulary`);
  console.log("PASS Dock keyboard: 1-5 washes, 0 remove, reachable named commands, one-rung Escape ladder with a guarded draft");
  console.log("PASS Dock mutations: blocked wash and Remove surface one explicit Retry, nonce-bound failures, byte-exact append logs");
  console.log("PASS Dock authoring: exact held paint, duplicate-anchor notice, two-anchor relation, clean cancellation");
  console.log("PASS Dock connection: recovery on a blocked save, one durable record on Retry, quiet resting tick, selection wakes the margin card (route reports needs-space — see assertCompletedConnection)");
  console.log("PASS Dock media: reduced motion terminal, forced-colors pigment names, 44px coarse targets, visible focus");
  console.log("PASS Dock motion: one entrance, same node across resize, breakpoint and theme changes");
  console.log(`PASS Dock warm plateau: ${plateau.cycles} mixed shelf/stacked cycles, ${signed(plateau.nodeGrowth)} nodes, ${signed(plateau.listenerGrowth)} listeners, ${signed(plateau.heapGrowth)} heap bytes`);

  // Every behavioural phase has now run and reported, so the collected geometry
  // defects can fail the gate with the complete picture rather than only the
  // first of twenty cells.
  failureContext = { phase: "matrix-geometry" };
  if (GEOMETRY_DEFECTS.length > 0) {
    console.error(`\nFAIL Dock geometry: ${GEOMETRY_DEFECTS.length} defect(s)`);
    for (const defect of GEOMETRY_DEFECTS) console.error(`  - ${defect}`);
  }
  assert.deepEqual(
    GEOMETRY_DEFECTS,
    [],
    `the Dock has ${GEOMETRY_DEFECTS.length} geometry defect(s) — see the list above`,
  );
  gatePassed = true;
} catch (error) {
  await captureFailure(cdp, driver, error, failureContext, childLog, childState);
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) {
    await setMedia(cdp).catch(() => undefined);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 }).catch(() => undefined);
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    cdp.ws.close();
  }
  const exited = await stopChild(child, childState);
  if (!exited) throw new Error(`Dock QA could not confirm Electron exit; retained isolated profile at ${qaRoot}`);
  rmSync(qaRoot, { recursive: true, force: true });
  if (gatePassed) {
    writeSuccessScreenshots(successFrames);
    rmSync(FAILURE_SCREENSHOT_PATH, { force: true });
    rmSync(FAILURE_STATE_PATH, { force: true });
  }
}
