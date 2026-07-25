/**
 * Permanent visual/interaction gate for the production marking Dock.
 *
 * Runs a fresh Electron build against an isolated profile and library. The
 * exact 20-cell matrix proves stage-derived shelf/stacked geometry, measured
 * thumb alignment, exact selection context, the complete two vocabularies,
 * and responsive containment. Focused probes cover keyboard ownership, stale
 * tool switching, real mutation retries, connection paint/durability, media
 * fallbacks, motion stability, and two warm lifecycle batches. User data is
 * never touched.
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
import { waitForState } from "./qa-support/app-vocabulary.mjs";

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
const MODE_IDS = ["read", "wash", "connect", "note", "erase"];
const MODE_LABELS = ["Read", "Highlight", "Connect", "Note", "Erase"];
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
const FORCED_CODES = ["A", "G", "S", "R", "V"];
const DRAFT_ID = "__connection-authoring-draft__";
const FIXTURE = {
  phrase: { verse: 8, quote: "the kingdom of God" },
  counterpart: { verse: 9, quote: "the Way" },
  stressPhrase: { verse: 7, quote: "about twelve" },
};
const GEOMETRY_EPSILON = 0.75;
const STRESS_CYCLES = 30;
const MAX_WARM_HEAP_GROWTH = 1024 * 1024;
const FAILURE_DIR = resolve("output/playwright");
const FAILURE_SCREENSHOT_PATH = join(FAILURE_DIR, "marking-dock-failure.png");
const FAILURE_STATE_PATH = join(FAILURE_DIR, "marking-dock-failure.json");
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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

async function setViewport(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
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
    return {
      x,
      y,
      width: rect.width,
      height: rect.height,
      hit: Boolean(hit && (hit === target || target.contains(hit))),
    };
  })()`);
  assert.ok(point, `${description} is missing or disabled`);
  assert.ok(point.width > 0 && point.height > 0, `${description} has no pointer target`);
  assert.equal(point.hit, true, `${description} is not the topmost hit-test target`);
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

async function ensureDockResting(driver, cdp) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const resting = await driver.evaluate(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      return Boolean(root
        && root.getAttribute("data-dock-state") === "rest"
        && root.getAttribute("data-dock-mode") === "read"
        && root.getAttribute("data-tool-armed") === "false"
        && !document.querySelector("[data-authoring-draft]"));
    })()`);
    if (resting) return;
    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await settle(driver);
  }
  assert.fail("Dock did not return to its resting Read state");
}

async function openDockSelection(driver, spec = FIXTURE.phrase, reduced = false) {
  const selected = await driver.evaluate(selectPhraseExpression(spec));
  assert.equal(selected, spec.quote, `native selection drifted for ${spec.quote}`);
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const intent = root?.querySelector('[data-dock-context="intent"]');
    return Boolean(root?.getAttribute("data-dock-state") === "selection"
      && intent
      && intent.querySelector('.marking-dock-quote')?.getAttribute("title") === ${JSON.stringify(spec.quote)});
  })()`);
  await settle(driver, reduced);
}

async function dismissDockSelection(driver, cdp, verse = FIXTURE.phrase.verse) {
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "rest"
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === ${JSON.stringify(String(verse))}`);
  await settle(driver, true);
}

function dockMatrixReportExpression() {
  return `(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const dock = root?.querySelector(".marking-dock");
    const stage = document.querySelector(".scripture-reading-stage");
    const modes = [...(root?.querySelectorAll("[data-dock-tool]") ?? [])];
    const group = root?.querySelector(".marking-dock-modes");
    const thumb = root?.querySelector(".marking-dock-thumb");
    const active = root?.querySelector('[data-dock-tool][aria-checked="true"]');
    const quote = root?.querySelector(".marking-dock-quote");
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
    const thumbRect = rect(thumb);
    const activeRect = rect(active);
    const dockStyle = dock ? getComputedStyle(dock) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      layout: root?.getAttribute("data-dock-layout") ?? null,
      expectedLayout: stageRect && stageRect.width <= 759 ? "stacked" : "shelf",
      state: root?.getAttribute("data-dock-state") ?? null,
      mode: root?.getAttribute("data-dock-mode") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      counts: {
        hosts: document.querySelectorAll('[data-marking-surface="dock"]').length,
        docks: root?.querySelectorAll(".marking-dock").length ?? 0,
        groups: root?.querySelectorAll('.marking-dock-modes[role="radiogroup"]').length ?? 0,
        modes: modes.length,
        thumbs: root?.querySelectorAll(".marking-dock-thumb").length ?? 0,
      },
      dockRole: dock?.getAttribute("role") ?? null,
      dockLabel: dock?.getAttribute("aria-label") ?? null,
      groupLabel: group?.getAttribute("aria-label") ?? null,
      modeIds: modes.map((mode) => mode.dataset.dockTool),
      modeRoles: modes.map((mode) => mode.getAttribute("role")),
      modeLabels: modes.map((mode) => mode.getAttribute("aria-label")),
      modeTabStops: modes.map((mode, index) => mode.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      checkedModes: modes.filter((mode) => mode.getAttribute("aria-checked") === "true").map((mode) => mode.dataset.dockTool),
      stageRect,
      dockRect,
      dockContained: contained(dockRect, stageRect),
      bottomInset: dockRect && stageRect ? stageRect.bottom - dockRect.bottom : null,
      leftInset: dockRect && stageRect ? dockRect.left - stageRect.left : null,
      rightInset: dockRect && stageRect ? stageRect.right - dockRect.right : null,
      backdrop: dockStyle?.backdropFilter || dockStyle?.webkitBackdropFilter || "none",
      thumbReady: group?.getAttribute("data-thumb-ready") ?? null,
      thumbDisplay: thumb ? getComputedStyle(thumb).display : null,
      thumbOpacity: thumb ? Number.parseFloat(getComputedStyle(thumb).opacity) : null,
      thumbRect,
      activeRect,
      thumbDelta: thumbRect && activeRect ? {
        left: Math.abs(thumbRect.left - activeRect.left),
        width: Math.abs(thumbRect.width - activeRect.width),
        top: Math.abs(thumbRect.top - activeRect.top),
        height: Math.abs(thumbRect.height - activeRect.height),
      } : null,
      thumbVars: group ? {
        x: Number.parseFloat(group.style.getPropertyValue("--mark-dock-x")),
        width: Number.parseFloat(group.style.getPropertyValue("--mark-dock-width")),
      } : null,
      quote: quote?.textContent?.trim() ?? null,
      quoteTitle: quote?.getAttribute("title") ?? null,
      context: root?.querySelector(".marking-dock-context")?.getAttribute("data-dock-context") ?? null,
      intentLabels: [...(root?.querySelectorAll("[data-dock-intent]") ?? [])].map((button) => button.textContent?.trim()),
      activeElement: document.activeElement?.getAttribute("data-dock-intent") ?? null,
      focusRing: root?.getAttribute("data-focus-ring") ?? null,
      activeOutlineStyle: document.activeElement instanceof HTMLElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : null,
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
        context: overflow(root?.querySelector(".marking-dock-context")),
      },
    };
  })()`;
}

function assertDockMatrixReport(report, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  assert.deepEqual(report.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport drifted`);
  assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
  assert.equal(report.layout, report.expectedLayout, `${label}: Dock layout ignored its own reading stage`);
  assert.equal(report.state, "selection", `${label}: exact selection context did not own the Dock center`);
  assert.equal(report.mode, "read", `${label}: fresh selection inherited a stale mode`);
  assert.equal(report.armed, "false", `${label}: fresh selection inherited a stale tool`);
  assert.deepEqual(report.counts, { hosts: 1, docks: 1, groups: 1, modes: 5, thumbs: 1 }, `${label}: Dock anatomy drifted`);
  assert.equal(report.dockRole, "toolbar", `${label}: Dock lost its toolbar role`);
  assert.equal(report.dockLabel, "Marking Dock", `${label}: Dock label drifted`);
  assert.equal(report.groupLabel, "Marking mode", `${label}: mode radiogroup label drifted`);
  assert.deepEqual(report.modeIds, MODE_IDS, `${label}: Dock must expose Read/Highlight/Connect/Note/Erase in order`);
  assert.deepEqual(report.modeRoles, Array(5).fill("radio"), `${label}: Dock modes lost radio semantics`);
  assert.deepEqual(report.modeLabels, MODE_LABELS, `${label}: resting Dock labels drifted`);
  assert.deepEqual(report.modeTabStops, [0], `${label}: Dock must expose one roving mode stop`);
  assert.deepEqual(report.checkedModes, ["read"], `${label}: Read was not the sole selected mode`);
  assert.equal(report.dockContained, true, `${label}: Dock escaped its reading stage`);
  if (report.layout === "shelf") {
    assert.ok(Math.abs(report.bottomInset - 14) <= GEOMETRY_EPSILON, `${label}: shelf bottom inset drifted to ${report.bottomInset}px`);
    assert.ok(report.leftInset >= 14 - GEOMETRY_EPSILON, `${label}: shelf left inset shrank to ${report.leftInset}px`);
    assert.ok(report.rightInset >= 14 - GEOMETRY_EPSILON, `${label}: shelf right inset shrank to ${report.rightInset}px`);
    assert.ok(report.dockRect.width <= 1120 + GEOMETRY_EPSILON, `${label}: shelf exceeded its 1120px measure`);
  } else {
    assert.ok(Math.abs(report.bottomInset) <= GEOMETRY_EPSILON, `${label}: stacked Dock did not meet the stage floor`);
    assert.ok(Math.abs(report.leftInset) <= GEOMETRY_EPSILON, `${label}: stacked Dock missed the left edge`);
    assert.ok(Math.abs(report.rightInset) <= GEOMETRY_EPSILON, `${label}: stacked Dock missed the right edge`);
  }
  // The backdrop follows the material, and all four atmospheres are solid
  // unless the reader turns the material on. This tour never turns it on, so
  // the Dock must not be carrying a backdrop filter in any of them.
  assert.equal(report.backdrop, "none", `${label}: solid Dock inherited a backdrop filter`);
  assert.equal(report.thumbReady, "true", `${label}: measured thumb never became ready`);
  assert.notEqual(report.thumbDisplay, "none", `${label}: ordinary media hid the measured thumb`);
  assert.ok(report.thumbOpacity >= 0.99, `${label}: measured thumb remained transparent`);
  assert.ok(report.thumbDelta, `${label}: thumb/active mode geometry was unavailable`);
  for (const [dimension, delta] of Object.entries(report.thumbDelta)) {
    assert.ok(delta <= GEOMETRY_EPSILON, `${label}: measured thumb ${dimension} missed active Read by ${delta}px`);
  }
  assert.ok(Number.isFinite(report.thumbVars?.x), `${label}: measured thumb x variable is absent`);
  assert.ok(Number.isFinite(report.thumbVars?.width), `${label}: measured thumb width variable is absent`);
  assert.ok(Math.abs(report.thumbVars.width - report.activeRect.width) <= GEOMETRY_EPSILON, `${label}: thumb width variable drifted`);
  assert.equal(report.quote, FIXTURE.phrase.quote, `${label}: selected quote drifted`);
  assert.equal(report.quoteTitle, FIXTURE.phrase.quote, `${label}: complete selected quote title drifted`);
  assert.equal(report.context, "intent", `${label}: selected words lost their intent context`);
  assert.deepEqual(report.intentLabels, ["Highlight", "Connect"], `${label}: selection center exposed the wrong intents`);
  assert.equal(report.activeElement, "wash", `${label}: selection focus did not reach Highlight`);
  assert.equal(report.focusRing, "pointer", `${label}: pointer-open Dock exposed a keyboard focus ring mode`);
  assert.equal(report.activeOutlineStyle, "none", `${label}: programmatic initial intent focus painted an accent outline`);
  assert.equal(report.nativeSelection, FIXTURE.phrase.quote, `${label}: Dock collapsed the exact native selection`);
  assert.deepEqual(report.authoredPaint, { drafts: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 0 }, `${label}: opening selection context painted authored artifacts`);
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `${label}: ${surface} overflowed horizontally by ${overflow}px`);
  }
}

async function openDockMode(driver, cdp, mode, focusChoices = true) {
  await pointerClick(
    driver,
    cdp,
    `[data-marking-surface="dock"] [data-dock-tool="${mode}"]`,
    `Dock ${mode} mode`,
  );
  if (mode === "wash" || mode === "connect") {
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      return Boolean(root?.getAttribute("data-dock-mode") === ${JSON.stringify(mode)}
        && root.querySelector(${JSON.stringify(`[data-dock-context="${mode}"]`)}));
    })()`);
    if (focusChoices) {
      const selector = mode === "wash" ? "[data-pigment]" : "[data-relationship-kind]";
      await driver.waitFor(`document.activeElement?.matches(${JSON.stringify(`[data-marking-surface="dock"] ${selector}`)}) === true`);
    }
  }
}

async function assertVocabulariesInCell(driver, cdp, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  await openDockMode(driver, cdp, "connect");
  const connect = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const panel = root?.querySelector('[data-dock-context="connect"]');
    const grid = panel?.querySelector(".marking-relationship-grid");
    const choices = [...(grid?.querySelectorAll("[data-relationship-kind]") ?? [])];
    const last = choices.at(-1);
    const initialGridRect = grid?.getBoundingClientRect();
    const initialLastRect = last?.getBoundingClientRect();
    const initialLastVisible = Boolean(initialGridRect && initialLastRect
      && initialLastRect.left >= initialGridRect.left - ${GEOMETRY_EPSILON}
      && initialLastRect.right <= initialGridRect.right + ${GEOMETRY_EPSILON});
    const initialOverflow = grid ? Math.max(0, grid.scrollWidth - grid.clientWidth) : null;
    last?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const gridRect = grid?.getBoundingClientRect();
    const lastRect = last?.getBoundingClientRect();
    const neutral = choices.filter((choice) => choice !== document.activeElement && !choice.matches(":hover"));
    return {
      mode: root?.getAttribute("data-dock-mode") ?? null,
      layout: root?.getAttribute("data-dock-layout") ?? null,
      state: root?.getAttribute("data-dock-state") ?? null,
      expanded: root?.querySelector('[data-dock-tool="connect"]')?.getAttribute("aria-expanded") ?? null,
      ids: choices.map((choice) => choice.dataset.relationshipKind),
      labels: choices.map((choice) => choice.textContent?.trim()),
      labelVisibility: choices.map((choice) => {
        const text = choice.querySelector(".marking-choice-label");
        if (!text) return false;
        const rect = text.getBoundingClientRect();
        const style = getComputedStyle(text);
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number.parseFloat(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      }),
      tabStops: choices.map((choice, index) => choice.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      active: choices.indexOf(document.activeElement),
      initialLastVisible,
      initialOverflow,
      lastReachable: Boolean(gridRect && lastRect
        && lastRect.left >= gridRect.left - ${GEOMETRY_EPSILON}
        && lastRect.right <= gridRect.right + ${GEOMETRY_EPSILON}),
      overflow: grid ? Math.max(0, grid.scrollWidth - grid.clientWidth - grid.scrollLeft) : null,
      neutralColors: neutral.map((choice) => getComputedStyle(choice.querySelector(".marking-choice-glyph") ?? choice).color),
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.equal(connect.mode, "connect", `${label}: Connect did not own the active Dock mode`);
  assert.equal(connect.state, "choices", `${label}: Connect vocabulary did not own the Dock center`);
  assert.equal(connect.expanded, "true", `${label}: Connect did not expose expanded state`);
  assert.deepEqual(connect.ids, RELATIONSHIPS, `${label}: relationship vocabulary drifted`);
  assert.deepEqual(connect.labels, RELATIONSHIP_LABELS, `${label}: relationship labels drifted`);
  if (viewport.width === 390) {
    assert.equal(connect.labelVisibility.every(Boolean), true, `${label}: compact Connect hid a relationship label`);
  }
  assert.deepEqual(connect.tabStops, [0], `${label}: relationship choices lost one roving stop`);
  assert.equal(connect.active, 0, `${label}: Connect focus did not reach Parallelism`);
  if (connect.layout === "shelf") {
    assert.equal(connect.initialLastVisible, true, `${label}: shelf clipped Hinge before any horizontal navigation`);
    assert.ok(connect.initialOverflow != null && connect.initialOverflow <= GEOMETRY_EPSILON, `${label}: shelf vocabulary required ${connect.initialOverflow}px of hidden horizontal travel`);
  }
  assert.equal(connect.lastReachable, true, `${label}: Hinge could not be reached inside the Dock center`);
  assert.ok(connect.overflow != null && connect.overflow <= GEOMETRY_EPSILON, `${label}: Connect viewport retained ${connect.overflow}px inaccessible inline content`);
  assert.equal(new Set(connect.neutralColors).size, 1, `${label}: resting relationship commands leaked multiple persistent hues`);
  assert.equal(connect.nativeSelection, FIXTURE.phrase.quote, `${label}: opening Connect collapsed the exact selection`);

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="dock"] [data-dock-context="connect"]')`);
  await openDockMode(driver, cdp, "wash");
  const wash = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const panel = root?.querySelector('[data-dock-context="wash"]');
    const grid = panel?.querySelector(".marking-pigment-grid");
    const choices = [...(grid?.querySelectorAll("[data-pigment]") ?? [])];
    const last = choices.at(-1);
    last?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const gridRect = grid?.getBoundingClientRect();
    const lastRect = last?.getBoundingClientRect();
    return {
      mode: root?.getAttribute("data-dock-mode") ?? null,
      state: root?.getAttribute("data-dock-state") ?? null,
      expanded: root?.querySelector('[data-dock-tool="wash"]')?.getAttribute("aria-expanded") ?? null,
      ids: choices.map((choice) => choice.dataset.pigment),
      labels: choices.map((choice) => choice.textContent?.trim()),
      tabStops: choices.map((choice, index) => choice.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      active: choices.indexOf(document.activeElement),
      lastReachable: Boolean(gridRect && lastRect
        && lastRect.left >= gridRect.left - ${GEOMETRY_EPSILON}
        && lastRect.right <= gridRect.right + ${GEOMETRY_EPSILON}),
      overflow: grid ? Math.max(0, grid.scrollWidth - grid.clientWidth - grid.scrollLeft) : null,
      materials: choices.map((choice) => {
        const swatch = choice.querySelector(".marking-pigment") ?? choice;
        const style = getComputedStyle(swatch);
        return style.backgroundImage + "|" + style.backgroundColor;
      }),
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.equal(wash.mode, "wash", `${label}: Highlight did not own the active Dock mode`);
  assert.equal(wash.state, "choices", `${label}: Highlight vocabulary did not own the Dock center`);
  assert.equal(wash.expanded, "true", `${label}: Highlight did not expose expanded state`);
  assert.deepEqual(wash.ids, PIGMENTS, `${label}: pigment vocabulary drifted`);
  assert.deepEqual(wash.labels, PIGMENT_LABELS, `${label}: pigment labels drifted`);
  assert.deepEqual(wash.tabStops, [0], `${label}: pigment choices lost one roving stop`);
  assert.equal(wash.active, 0, `${label}: Highlight focus did not reach Amber`);
  assert.equal(wash.lastReachable, true, `${label}: Violet could not be reached inside the Dock center`);
  assert.ok(wash.overflow != null && wash.overflow <= GEOMETRY_EPSILON, `${label}: Highlight viewport retained ${wash.overflow}px inaccessible inline content`);
  assert.equal(new Set(wash.materials).size, PIGMENTS.length, `${label}: pigment samples lost their five distinct washes`);
  assert.equal(wash.nativeSelection, FIXTURE.phrase.quote, `${label}: opening Highlight collapsed the exact selection`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="dock"] [data-dock-context="wash"]')`);
}

async function captureShelfAestheticProofs(driver, cdp, frames) {
  await setMedia(cdp);
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await ensureDockResting(driver, cdp);
  await parkPointer(cdp);
  await driver.evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-dock-proof-paper-shelf-rest.png");

  await openDockSelection(driver, FIXTURE.phrase);
  await parkPointer(cdp);
  await bufferSuccessScreenshot(cdp, frames, "marking-dock-proof-paper-shelf-selection.png");
  await clickDockIntent(driver, cdp, "wash");
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-dock-proof-paper-shelf-highlight.png");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "selection"`);
  await clickDockIntent(driver, cdp, "connect");
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-dock-proof-paper-shelf-connect.png");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "selection"`);
  await dismissDockSelection(driver, cdp);

  await setTheme(driver, "dark");
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "connect");
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-dock-proof-ink-shelf-connect.png");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "selection"`);
  await dismissDockSelection(driver, cdp);
  await setTheme(driver, "light");
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

async function withWriteBlocked(logPath, action) {
  const originalMode = statSync(logPath).mode & 0o777;
  chmodSync(logPath, 0o400);
  try {
    return await action();
  } finally {
    chmodSync(logPath, originalMode);
  }
}

async function clickDockIntent(driver, cdp, intent) {
  await pointerClick(
    driver,
    cdp,
    `[data-marking-surface="dock"] [data-dock-intent="${intent}"]`,
    `Dock selection ${intent} intent`,
  );
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const selector = ${JSON.stringify(intent === "wash" ? "[data-pigment]" : "[data-relationship-kind]")};
    return root?.getAttribute("data-dock-state") === "choices"
      && Boolean(root.querySelector(${JSON.stringify(`[data-dock-context="${intent}"]`)} + " " + selector));
  })()`);
}

async function putDownDockTool(driver, cdp) {
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const read = root?.querySelector('[data-dock-tool="read"]');
    return root?.querySelector('.marking-dock')?.getAttribute('aria-busy') === 'false'
      && read instanceof HTMLButtonElement
      && !read.disabled;
  })()`);
  await pointerClick(
    driver,
    cdp,
    '[data-marking-surface="dock"] [data-dock-tool="read"]',
    "Dock Read reset mode",
  );
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "false"
    && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-mode") === "read"
    && Boolean(document.activeElement?.closest('.verse-line'))`);
  await settle(driver, true);
}

async function dockModeFocusState(driver) {
  return driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const modes = [...(root?.querySelectorAll("[data-dock-tool]") ?? [])];
    return {
      state: root?.getAttribute("data-dock-state") ?? null,
      mode: root?.getAttribute("data-dock-mode") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      context: root?.querySelector(".marking-dock-context")?.getAttribute("data-dock-context") ?? null,
      checked: modes.filter((mode) => mode.getAttribute("aria-checked") === "true").map((mode) => mode.dataset.dockTool),
      tabbable: modes.filter((mode) => mode.tabIndex === 0).map((mode) => mode.dataset.dockTool),
      focusedTool: document.activeElement?.getAttribute("data-dock-tool") ?? null,
      focusedIntent: document.activeElement?.getAttribute("data-dock-intent") ?? null,
    };
  })()`);
}

async function dockIntentFocusState(driver) {
  return driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const group = root?.querySelector(".marking-dock-intents");
    const intents = [...(group?.querySelectorAll("[data-dock-intent]") ?? [])];
    return {
      groupRole: group?.getAttribute("role") ?? null,
      groupLabel: group?.getAttribute("aria-label") ?? null,
      ids: intents.map((intent) => intent.getAttribute("data-dock-intent")),
      labels: intents.map((intent) => intent.textContent?.trim() ?? ""),
      tabbable: intents.filter((intent) => intent.tabIndex === 0).map((intent) => intent.getAttribute("data-dock-intent")),
      focused: document.activeElement?.getAttribute("data-dock-intent") ?? null,
      state: root?.getAttribute("data-dock-state") ?? null,
      mode: root?.getAttribute("data-dock-mode") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      context: root?.querySelector(".marking-dock-context")?.getAttribute("data-dock-context") ?? null,
      nativeSelection: getSelection()?.toString() ?? "",
      drafts: document.querySelectorAll("[data-authoring-draft]").length,
      sessions: root?.querySelectorAll(".marking-session").length ?? 0,
      retries: root?.querySelectorAll('[data-dock-action="retry"]').length ?? 0,
    };
  })()`);
}

async function dockSubtypeFocusState(driver, type) {
  const isWash = type === "wash";
  const selector = isWash ? "[data-pigment]" : "[data-relationship-kind]";
  const dataAttribute = isWash ? "data-pigment" : "data-relationship-kind";
  const gridSelector = isWash ? ".marking-pigment-grid" : ".marking-relationship-grid";
  return driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const group = root?.querySelector(${JSON.stringify(gridSelector)});
    const choices = [...(group?.querySelectorAll(${JSON.stringify(selector)}) ?? [])];
    return {
      groupRole: group?.getAttribute("role") ?? null,
      groupLabel: group?.getAttribute("aria-label") ?? null,
      ids: choices.map((choice) => choice.getAttribute(${JSON.stringify(dataAttribute)})),
      roles: choices.map((choice) => choice.getAttribute("role")),
      checked: choices.filter((choice) => choice.getAttribute("aria-checked") === "true")
        .map((choice) => choice.getAttribute(${JSON.stringify(dataAttribute)})),
      pressed: choices.filter((choice) => choice.getAttribute("aria-pressed") === "true")
        .map((choice) => choice.getAttribute(${JSON.stringify(dataAttribute)})),
      tabbable: choices.filter((choice) => choice.tabIndex === 0)
        .map((choice) => choice.getAttribute(${JSON.stringify(dataAttribute)})),
      focused: document.activeElement?.getAttribute(${JSON.stringify(dataAttribute)}) ?? null,
      state: root?.getAttribute("data-dock-state") ?? null,
      mode: root?.getAttribute("data-dock-mode") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      nativeSelection: getSelection()?.toString() ?? "",
      drafts: document.querySelectorAll("[data-authoring-draft]").length,
      sessions: root?.querySelectorAll(".marking-session").length ?? 0,
    };
  })()`);
}

function assertArmedSubtypeState(actual, expected, label) {
  assert.equal(actual.groupRole, "radiogroup", `${label}: armed subtype group lost radiogroup semantics`);
  assert.equal(actual.groupLabel, expected.groupLabel, `${label}: armed subtype group label drifted`);
  assert.deepEqual(actual.ids, expected.ids, `${label}: armed subtype vocabulary drifted`);
  assert.deepEqual(actual.roles, Array(expected.ids.length).fill("radio"), `${label}: armed subtype choices lost radio semantics`);
  assert.deepEqual(actual.checked, [expected.selected], `${label}: aria-checked did not follow the carried subtype`);
  assert.deepEqual(actual.pressed, [], `${label}: armed radios leaked button aria-pressed state`);
  assert.deepEqual(actual.tabbable, [expected.selected], `${label}: roving tab stop did not follow the carried subtype`);
  assert.equal(actual.focused, expected.selected, `${label}: focus did not follow the carried subtype`);
  assert.equal(actual.mode, expected.mode, `${label}: Dock mode drifted from the armed subtype`);
  assert.equal(actual.armed, expected.armed, `${label}: data-tool-armed drifted from the focused radio`);
  assert.equal(actual.nativeSelection, "", `${label}: no-selection armed chooser retained a native selection`);
  assert.deepEqual({ drafts: actual.drafts, sessions: actual.sessions }, { drafts: 0, sessions: 0 }, `${label}: radio navigation started authoring`);
}

async function assertArmedSubtypeRadioKeyboard(driver, cdp) {
  const before = await rangeCounts(driver);
  await ensureDockResting(driver, cdp);

  await openDockMode(driver, cdp, "wash");
  await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock armed Sky subtype");
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:blue"
    && document.activeElement?.getAttribute("data-pigment") === "blue"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "wash"), {
    groupLabel: "Highlight color", ids: PIGMENTS, selected: "blue", mode: "wash", armed: "wash:blue",
  }, "pointer-selected Sky");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "armed"`);
  await openDockMode(driver, cdp, "wash");
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "wash"), {
    groupLabel: "Highlight color", ids: PIGMENTS, selected: "blue", mode: "wash", armed: "wash:blue",
  }, "reopened Sky chooser");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:pink"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "wash"), {
    groupLabel: "Highlight color", ids: PIGMENTS, selected: "pink", mode: "wash", armed: "wash:pink",
  }, "Sky to Rose ArrowRight");
  await pressKey(cdp, "Home", "Home", 0, 36);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:yellow"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "wash"), {
    groupLabel: "Highlight color", ids: PIGMENTS, selected: "yellow", mode: "wash", armed: "wash:yellow",
  }, "armed Highlight Home");
  await pressKey(cdp, "End", "End", 0, 35);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:purple"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "wash"), {
    groupLabel: "Highlight color", ids: PIGMENTS, selected: "purple", mode: "wash", armed: "wash:purple",
  }, "armed Highlight End");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await putDownDockTool(driver, cdp);

  await openDockMode(driver, cdp, "connect");
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="series"]', "Dock armed Series subtype");
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "connect:series"
    && document.activeElement?.getAttribute("data-relationship-kind") === "series"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "connect"), {
    groupLabel: "Connection type", ids: RELATIONSHIPS, selected: "series", mode: "connect", armed: "connect:series",
  }, "pointer-selected Series");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "armed"`);
  await openDockMode(driver, cdp, "connect");
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "connect"), {
    groupLabel: "Connection type", ids: RELATIONSHIPS, selected: "series", mode: "connect", armed: "connect:series",
  }, "reopened Series chooser");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "connect:hinge"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "connect"), {
    groupLabel: "Connection type", ids: RELATIONSHIPS, selected: "hinge", mode: "connect", armed: "connect:hinge",
  }, "Series to Hinge ArrowRight");
  await pressKey(cdp, "Home", "Home", 0, 36);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "connect:link:parallel"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "connect"), {
    groupLabel: "Connection type", ids: RELATIONSHIPS, selected: "link:parallel", mode: "connect", armed: "connect:link:parallel",
  }, "armed Connect Home");
  await pressKey(cdp, "End", "End", 0, 35);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "connect:hinge"`);
  assertArmedSubtypeState(await dockSubtypeFocusState(driver, "connect"), {
    groupLabel: "Connection type", ids: RELATIONSHIPS, selected: "hinge", mode: "connect", armed: "connect:hinge",
  }, "armed Connect End");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await putDownDockTool(driver, cdp);
  assert.deepEqual(await rangeCounts(driver), before, "armed subtype radio navigation mutated authored records");
}

async function assertSelectionKeyboardBrowsing(driver, cdp) {
  const before = await rangeCounts(driver);
  await ensureDockResting(driver, cdp);

  // The two fresh-selection intents rove without mutating. Enter activates
  // Highlight, after which subtype arrows remain browse-only until Enter.
  await openDockSelection(driver, FIXTURE.stressPhrase);
  assert.deepEqual(await dockIntentFocusState(driver), {
    groupRole: "group",
    groupLabel: "Mark selected words",
    ids: ["wash", "connect"],
    labels: ["Highlight", "Connect"],
    tabbable: ["wash"],
    focused: "wash",
    state: "selection",
    mode: "read",
    armed: "false",
    context: "intent",
    nativeSelection: FIXTURE.stressPhrase.quote,
    drafts: 0,
    sessions: 0,
    retries: 0,
  }, "fresh selection did not expose one focused Highlight intent");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "connect"`);
  await pressKey(cdp, "Home", "Home", 0, 36);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "wash"`);
  await pressKey(cdp, "End", "End", 0, 35);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "connect"`);
  await pressKey(cdp, "Home", "Home", 0, 36);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "wash"`);
  const browsedHighlightIntent = await dockIntentFocusState(driver);
  assert.deepEqual(browsedHighlightIntent.tabbable, ["wash"], "intent Home/End browsing left more than one tab stop");
  assert.deepEqual(
    { armed: browsedHighlightIntent.armed, nativeSelection: browsedHighlightIntent.nativeSelection, drafts: browsedHighlightIntent.drafts, sessions: browsedHighlightIntent.sessions },
    { armed: "false", nativeSelection: FIXTURE.stressPhrase.quote, drafts: 0, sessions: 0 },
    "intent arrows mutated or collapsed the selected words",
  );
  assert.deepEqual(await rangeCounts(driver), before, "intent browsing wrote authored data before activation");
  await pressKey(cdp, "Enter", "Enter", 0, 13);
  await driver.waitFor(`document.activeElement?.matches('[data-dock-context="wash"] [data-pigment="yellow"]') === true`);
  const washInitial = await dockSubtypeFocusState(driver, "wash");
  assert.equal(washInitial.groupRole, "group", "selection-serving Highlight chooser became an auto-committing radiogroup");
  assert.deepEqual(washInitial.roles, Array(PIGMENTS.length).fill(null), "selection-serving Highlight choices gained radio activation semantics");
  assert.deepEqual(washInitial.checked, [], "selection-serving Highlight committed a subtype before activation");
  assert.deepEqual(washInitial.tabbable, ["yellow"], "selection-serving Highlight lost its single browse stop");
  assert.equal(washInitial.focused, "yellow", "selection-serving Highlight did not focus Amber");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.activeElement?.getAttribute("data-pigment") === "blue"`);
  const washBrowsed = await dockSubtypeFocusState(driver, "wash");
  assert.deepEqual(
    { checked: washBrowsed.checked, pressed: washBrowsed.pressed, tabbable: washBrowsed.tabbable, focused: washBrowsed.focused, armed: washBrowsed.armed, nativeSelection: washBrowsed.nativeSelection },
    { checked: [], pressed: [], tabbable: ["blue"], focused: "blue", armed: "false", nativeSelection: FIXTURE.stressPhrase.quote },
    "selection-serving Highlight arrows committed Sky before Enter",
  );
  assert.deepEqual(await rangeCounts(driver), before, "selection-serving Highlight browsing wrote before Enter");
  await pressKey(cdp, "Enter", "Enter", 0, 13);
  await waitForActiveHighlightCount(driver, before.highlights + 1);
  await putDownDockTool(driver, cdp);
  await openDockSelection(driver, FIXTURE.stressPhrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-action="erase"]'))`);
  await pointerClick(driver, cdp, '[data-dock-action="erase"]', "Dock keyboard-probe Highlight cleanup");
  await waitForActiveHighlightCount(driver, before.highlights);
  await ensureDockResting(driver, cdp);

  // Space activates Connect, but the relationship chooser itself still roves
  // without capture until an explicit Space activation.
  await openDockSelection(driver, FIXTURE.counterpart);
  const freshConnectIntent = await dockIntentFocusState(driver);
  assert.deepEqual(freshConnectIntent.tabbable, ["wash"], "fresh Connect probe inherited a stale intent tab stop");
  assert.equal(freshConnectIntent.focused, "wash", "fresh Connect probe did not begin on Highlight");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "connect"`);
  await pressKey(cdp, "Home", "Home", 0, 36);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "wash"`);
  await pressKey(cdp, "End", "End", 0, 35);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-intent") === "connect"`);
  const connectIntentBrowsed = await dockIntentFocusState(driver);
  assert.deepEqual(connectIntentBrowsed.tabbable, ["connect"], "Connect intent browsing left more than one tab stop");
  assert.deepEqual(
    { armed: connectIntentBrowsed.armed, nativeSelection: connectIntentBrowsed.nativeSelection, drafts: connectIntentBrowsed.drafts, sessions: connectIntentBrowsed.sessions },
    { armed: "false", nativeSelection: FIXTURE.counterpart.quote, drafts: 0, sessions: 0 },
    "Connect intent browsing mutated the selected words",
  );
  assert.deepEqual(await rangeCounts(driver), before, "Connect intent browsing wrote before Space");
  await pressKey(cdp, " ", "Space", 0, 32);
  await driver.waitFor(`document.activeElement?.matches('[data-dock-context="connect"] [data-relationship-kind="link:parallel"]') === true`);
  const connectInitial = await dockSubtypeFocusState(driver, "connect");
  assert.equal(connectInitial.groupRole, "group", "selection-serving Connect chooser became an auto-committing radiogroup");
  assert.deepEqual(connectInitial.roles, Array(RELATIONSHIPS.length).fill(null), "selection-serving relationships gained radio activation semantics");
  assert.deepEqual(connectInitial.checked, [], "selection-serving Connect committed a subtype before activation");
  assert.deepEqual(connectInitial.tabbable, ["link:parallel"], "selection-serving Connect lost its single browse stop");
  assert.equal(connectInitial.focused, "link:parallel", "selection-serving Connect did not focus Parallelism");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.activeElement?.getAttribute("data-relationship-kind") === "link:echo"`);
  const connectBrowsed = await dockSubtypeFocusState(driver, "connect");
  assert.deepEqual(
    { checked: connectBrowsed.checked, pressed: connectBrowsed.pressed, tabbable: connectBrowsed.tabbable, focused: connectBrowsed.focused, armed: connectBrowsed.armed, nativeSelection: connectBrowsed.nativeSelection },
    { checked: [], pressed: [], tabbable: ["link:echo"], focused: "link:echo", armed: "false", nativeSelection: FIXTURE.counterpart.quote },
    "selection-serving Connect arrows captured Echo before Space",
  );
  assert.deepEqual(await rangeCounts(driver), before, "selection-serving Connect browsing wrote before Space");
  await pressKey(cdp, " ", "Space", 0, 32);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "connect:link:echo"
    && Boolean(document.querySelector("[data-authoring-draft]"))
    && Boolean(document.querySelector(".marking-session"))`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector("[data-authoring-draft]") && !document.querySelector(".marking-session")`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "false"`);
  await ensureDockResting(driver, cdp);
  assert.deepEqual(await rangeCounts(driver), before, "selection keyboard activation probes did not restore authored baseline");
}

async function assertEscapeFocusContracts(driver, cdp) {
  await ensureDockResting(driver, cdp);

  // A selection intent is transient: Escape returns the checked/tabbable mode
  // to Read, while focus returns to the remounted matching Connect intent.
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "connect");
  await driver.waitFor(`document.activeElement?.matches('[data-dock-context="connect"] [data-relationship-kind]') === true`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "selection"
    && document.activeElement?.getAttribute("data-dock-intent") === "connect"`);
  assert.deepEqual(await dockModeFocusState(driver), {
    state: "selection",
    mode: "read",
    armed: "false",
    context: "intent",
    checked: ["read"],
    tabbable: ["read"],
    focusedTool: null,
    focusedIntent: "connect",
  }, "selection-intent Escape confused checked, tabbable, and focus-return targets");
  await dismissDockSelection(driver, cdp);

  // An unarmed mode tray follows the same distinction: Read is selected and
  // tabbable and focused after close; the closed subtype tray is no longer a
  // selected mode merely because it was the opener.
  await openDockMode(driver, cdp, "connect");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "rest"
    && document.activeElement?.getAttribute("data-dock-tool") === "read"`);
  assert.deepEqual(await dockModeFocusState(driver), {
    state: "rest",
    mode: "read",
    armed: "false",
    context: "status",
    checked: ["read"],
    tabbable: ["read"],
    focusedTool: "read",
    focusedIntent: null,
  }, "unarmed-mode Escape confused checked, tabbable, and focus-return targets");

  // Once Sky is carried, closing and reopening its subtype vocabulary keeps
  // Highlight as all three targets; it must not silently fall back to Read.
  await openDockMode(driver, cdp, "wash");
  await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock Sky subtype");
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:blue"`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "armed"
    && document.activeElement?.getAttribute("data-dock-tool") === "wash"`);
  const armedExpected = {
    state: "armed",
    mode: "wash",
    armed: "wash:blue",
    context: "status",
    checked: ["wash"],
    tabbable: ["wash"],
    focusedTool: "wash",
    focusedIntent: null,
  };
  assert.deepEqual(await dockModeFocusState(driver), armedExpected, "armed subtype close lost Highlight focus ownership");
  await openDockMode(driver, cdp, "wash");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "armed"
    && document.activeElement?.getAttribute("data-dock-tool") === "wash"`);
  assert.deepEqual(await dockModeFocusState(driver), armedExpected, "armed subtype reopening changed checked, tabbable, or focused Highlight");
  await putDownDockTool(driver, cdp);
}

async function assertKeyboardAndStaleToolSwitch(driver, cdp) {
  const before = await rangeCounts(driver);
  await assertEscapeFocusContracts(driver, cdp);
  await assertSelectionKeyboardBrowsing(driver, cdp);
  await assertArmedSubtypeRadioKeyboard(driver, cdp);
  await ensureDockResting(driver, cdp);
  await driver.evaluate(`document.querySelector('[data-dock-tool="read"]')?.focus()`);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-tool") === "wash"
    && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-mode") === "wash"`);
  assert.equal(await driver.evaluate(`document.activeElement?.tabIndex`), 0, "ArrowRight did not move the Dock's sole roving stop");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-tool") === "connect"
    && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-mode") === "connect"`);
  await pressKey(cdp, "End", "End", 0, 35);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-tool") === "erase"
    && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-mode") === "erase"`);
  await parkPointer(cdp);
  await settle(driver);
  const endState = await driver.evaluate(`(() => {
    const modes = [...document.querySelectorAll("[data-dock-tool]")];
    const active = document.querySelector('[data-dock-tool="erase"]')?.getBoundingClientRect();
    const thumb = document.querySelector(".marking-dock-thumb")?.getBoundingClientRect();
    return {
      focused: document.activeElement?.getAttribute("data-dock-tool"),
      checked: modes.filter((mode) => mode.getAttribute("aria-checked") === "true").map((mode) => mode.dataset.dockTool),
      tabStops: modes.map((mode, index) => mode.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      armed: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed"),
      thumbDelta: active && thumb ? {
        left: Math.abs(active.left - thumb.left),
        width: Math.abs(active.width - thumb.width),
        top: Math.abs(active.top - thumb.top),
        height: Math.abs(active.height - thumb.height),
      } : null,
    };
  })()`);
  assert.deepEqual(
    { focused: endState.focused, checked: endState.checked, tabStops: endState.tabStops, armed: endState.armed },
    { focused: "erase", checked: ["erase"], tabStops: [4], armed: "erase" },
    "Dock End navigation did not move selection and carried mode together",
  );
  assert.ok(endState.thumbDelta, "Dock Erase mode lost comparable thumb geometry");
  for (const [dimension, delta] of Object.entries(endState.thumbDelta)) {
    assert.ok(delta <= GEOMETRY_EPSILON, `measured thumb ${dimension} missed active Erase by ${delta}px`);
  }
  await pressKey(cdp, "Home", "Home", 0, 36);
  await driver.waitFor(`document.activeElement?.getAttribute("data-dock-tool") === "read"`);
  await putDownDockTool(driver, cdp);

  // Carry Sky, then switch vocabulary before choosing Series. Opening Connect
  // must discard the stale pigment instead of auto-applying it later.
  await openDockMode(driver, cdp, "wash");
  await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock Sky subtype");
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:blue"`);
  await openDockMode(driver, cdp, "connect");
  const switched = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    return {
      mode: root?.getAttribute("data-dock-mode"),
      armed: root?.getAttribute("data-tool-armed"),
      checked: [...(root?.querySelectorAll('[aria-checked="true"]') ?? [])].map((item) => item.dataset.dockTool),
      hasSkyClass: root?.querySelector('[data-dock-tool="wash"]')?.classList.contains("tone-blue") ?? false,
    };
  })()`);
  assert.deepEqual(switched, { mode: "connect", armed: "false", checked: ["connect"], hasSkyClass: false }, "switching to Connect retained stale Sky state");
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="series"]', "Dock Series subtype");
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "connect:series"`);
  await openDockMode(driver, cdp, "wash");
  const switchedBack = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    return {
      mode: root?.getAttribute("data-dock-mode"),
      armed: root?.getAttribute("data-tool-armed"),
      checked: [...(root?.querySelectorAll('[aria-checked="true"]') ?? [])].map((item) => item.dataset.dockTool),
      hasSeriesClass: root?.querySelector('[data-dock-tool="connect"]')?.classList.contains("marking-kind-series") ?? false,
    };
  })()`);
  assert.deepEqual(switchedBack, { mode: "wash", armed: "false", checked: ["wash"], hasSeriesClass: false }, "switching to Highlight retained stale Series state");
  await putDownDockTool(driver, cdp);
  assert.deepEqual(await rangeCounts(driver), before, "Dock keyboard/tool switching mutated authored records");
}

async function installDelayedHighlightRace(driver) {
  return driver.evaluate(`(() => {
    const library = window.api?.library;
    const original = library?.createHighlight;
    const descriptor = library ? Object.getOwnPropertyDescriptor(library, "createHighlight") : null;
    if (!library || typeof original !== "function") {
      return { installed: false, reason: "createHighlight is unavailable" };
    }
    const state = { original, entered: false, released: false, args: null, resolve: null, reject: null };
    const wrapped = (...args) => {
      if (state.entered) return original(...args);
      state.entered = true;
      state.args = args;
      return new Promise((resolvePromise, reject) => {
        state.resolve = resolvePromise;
        state.reject = reject;
      });
    };
    try {
      const assigned = Reflect.set(library, "createHighlight", wrapped);
      if (!assigned || library.createHighlight !== wrapped) {
        return {
          installed: false,
          reason: "preload API is frozen (writable=" + String(descriptor?.writable)
            + ", configurable=" + String(descriptor?.configurable) + ")",
        };
      }
    } catch (error) {
      return { installed: false, reason: "preload API rejected wrapper: " + String(error) };
    }
    window.__dockDelayedHighlightRace = state;
    return { installed: true, reason: null };
  })()`);
}

async function restoreDelayedHighlightRace(driver) {
  return driver.evaluate(`(() => {
    const state = window.__dockDelayedHighlightRace;
    if (!state) return true;
    const restored = Reflect.set(window.api.library, "createHighlight", state.original);
    const matches = window.api.library.createHighlight === state.original;
    delete window.__dockDelayedHighlightRace;
    return restored && matches;
  })()`);
}

async function assertInFlightSelectionNonceRace(driver, cdp, highlightsLog) {
  await ensureDockResting(driver, cdp);
  const installation = await installDelayedHighlightRace(driver);
  if (!installation.installed) return { exercised: false, reason: installation.reason };
  const before = await rangeCounts(driver);
  const beforeLog = logFingerprint(highlightsLog);
  try {
    await openDockSelection(driver, FIXTURE.stressPhrase);
    await clickDockIntent(driver, cdp, "wash");
    await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock delayed A Sky subtype");
    await driver.waitFor(`window.__dockDelayedHighlightRace?.entered === true
      && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "busy"`);

    const selectedB = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
    assert.equal(selectedB, FIXTURE.counterpart.quote, "in-flight B selection lost its exact Range");
    await driver.waitFor(`getSelection()?.toString() === ${JSON.stringify(FIXTURE.counterpart.quote)}`);
    const released = await driver.evaluate(`(() => {
      const state = window.__dockDelayedHighlightRace;
      if (!state?.entered || state.released || !state.args || !state.resolve || !state.reject) return false;
      state.released = true;
      Promise.resolve().then(() => state.original(...state.args)).then(state.resolve, state.reject);
      return true;
    })()`);
    assert.equal(released, true, "delayed Highlight A could not be released");
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      return root?.getAttribute("data-dock-state") === "selection"
        && root.getAttribute("data-dock-mode") === "read"
        && root.getAttribute("data-tool-armed") === "false"
        && root.querySelector('.marking-dock-quote')?.getAttribute("title") === ${JSON.stringify(FIXTURE.counterpart.quote)}
        && document.activeElement?.getAttribute("data-dock-intent") === "wash"
        && getSelection()?.toString() === ${JSON.stringify(FIXTURE.counterpart.quote)};
    })()`);
    const survivingB = await dockIntentFocusState(driver);
    assert.deepEqual(
      { tabbable: survivingB.tabbable, focused: survivingB.focused, retries: survivingB.retries, drafts: survivingB.drafts, sessions: survivingB.sessions },
      { tabbable: ["wash"], focused: "wash", retries: 0, drafts: 0, sessions: 0 },
      "released Highlight A stole B's nonce-bound selection intent or focus",
    );
    await driver.waitFor(`(async () => {
      const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
      return result.highlights.filter((record) => record.deleted === 0).length === ${before.highlights + 1};
    })()`);
    const authored = await driver.evaluate(`(async () => {
      const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
      return result.highlights.filter((record) => record.deleted === 0).map((record) => ({
        verseStart: record.verse_start,
        verseEnd: record.verse_end,
        charStart: record.char_start,
        charEnd: record.char_end,
      }));
    })()`);
    assert.equal(authored.length, before.highlights + 1, "delayed A produced more than one active highlight");
    const delayedA = authored.find((record) => record.verseStart === FIXTURE.stressPhrase.verse && record.verseEnd === FIXTURE.stressPhrase.verse);
    assert.ok(delayedA, "delayed A did not persist its own phrase");
    assert.equal(delayedA.charEnd - delayedA.charStart, FIXTURE.stressPhrase.quote.length, "delayed A persisted the wrong exact span");
    const afterA = logFingerprint(highlightsLog);
    assert.equal(afterA.lines, beforeLog.lines + 1, "delayed A appended more or fewer than one event");
    assert.ok(afterA.bytes > beforeLog.bytes, "delayed A did not append log bytes");
    assert.notEqual(afterA.sha256, beforeLog.sha256, "delayed A left the append-log digest unchanged");

    await dismissDockSelection(driver, cdp, FIXTURE.counterpart.verse);
    await openDockSelection(driver, FIXTURE.stressPhrase);
    await driver.waitFor(`Boolean(document.querySelector('[data-dock-action="erase"]'))`);
    await pointerClick(driver, cdp, '[data-dock-action="erase"]', "Dock delayed A cleanup");
    await waitForActiveHighlightCount(driver, before.highlights);
    await ensureDockResting(driver, cdp);
    return { exercised: true, reason: null };
  } finally {
    assert.equal(await restoreDelayedHighlightRace(driver), true, "Dock QA did not restore the renderer createHighlight API");
  }
}

async function assertMutationAndRetryFlows(driver, cdp, highlightsLog, successFrames) {
  const baseline = await rangeCounts(driver);
  assert.equal(baseline.highlights, 0, "Dock mutation fixture inherited highlights");
  await ensureDockResting(driver, cdp);

  const delayedRace = await assertInFlightSelectionNonceRace(driver, cdp, highlightsLog);

  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "wash");
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-context="wash"] [data-pigment="blue"]'))`);
  const beforeFailedHighlightLog = logFingerprint(highlightsLog);
  await withWriteBlocked(highlightsLog, async () => {
    await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock blocked Sky subtype");
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      return root?.getAttribute("data-dock-state") === "feedback"
        && root.querySelector(".marking-dock-feedback > span")?.textContent?.trim()
          === "The highlight could not be saved. Selection restored for retry."
        && document.activeElement?.getAttribute("data-dock-action") === "retry"
        && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)};
    })()`);
    await sleep(300);
    assert.deepEqual(await rangeCounts(driver), baseline, "failed Dock highlight retried or wrote an authored record");
    assert.deepEqual(logFingerprint(highlightsLog), beforeFailedHighlightLog, "failed Dock highlight changed append-log bytes");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeFailedHighlightLog, "restoring highlight-log permissions changed append-log bytes");

  // Switching intent explicitly abandons the nonce-bound failure without
  // collapsing the exact Range. Retry remains a separate, explicit path.
  await pointerClick(driver, cdp, '[data-dock-tool="connect"]', "Dock failed-Highlight switch to Connect");
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    return root?.getAttribute("data-dock-state") === "choices"
      && root.querySelector('[data-dock-context="connect"]')
      && !root.querySelector('[data-dock-action="retry"]')
      && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)};
  })()`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await dismissDockSelection(driver, cdp);
  assert.deepEqual(logFingerprint(highlightsLog), beforeFailedHighlightLog, "switching away from failed Highlight changed append-log bytes");

  // A genuine outside click clears the failed nonce and waits for the honest
  // resting copy; merely hiding conditional Retry UI is not sufficient.
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "wash");
  await withWriteBlocked(highlightsLog, async () => {
    await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock click-away blocked Sky subtype");
    await driver.waitFor(`document.activeElement?.getAttribute("data-dock-action") === "retry"`);
    await pointerClick(driver, cdp, ".chapter-header", "Dock failed-write outside dismissal");
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      const modes = [...(root?.querySelectorAll("[data-dock-tool]") ?? [])];
      return root?.getAttribute("data-dock-state") === "rest"
        && root.getAttribute("data-dock-mode") === "read"
        && root.getAttribute("data-tool-armed") === "false"
        && root.querySelector(".marking-dock-context")?.getAttribute("data-dock-context") === "status"
        && root.querySelector(".marking-dock-resting")?.textContent?.trim() === "Read tool active."
        && modes.filter((mode) => mode.getAttribute("aria-checked") === "true").map((mode) => mode.getAttribute("data-dock-tool")).join() === "read"
        && modes.filter((mode) => mode.tabIndex === 0).map((mode) => mode.getAttribute("data-dock-tool")).join() === "read"
        && !root.querySelector('[data-dock-action="retry"], .marking-dock-feedback, .marking-dock-quote, .marking-session')
        && !document.querySelector("[data-authoring-draft]")
        && getSelection()?.toString() === "";
    })()`);
    assert.deepEqual(await rangeCounts(driver), baseline, "failed-write click-away mutated authored data");
    assert.deepEqual(logFingerprint(highlightsLog), beforeFailedHighlightLog, "failed-write click-away changed append-log bytes");
  });

  // Recreate the failure so the direct Retry contract remains independently
  // covered after both abandonment routes above.
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "wash");
  await withWriteBlocked(highlightsLog, async () => {
    await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock retry-path blocked Sky subtype");
    await driver.waitFor(`document.activeElement?.getAttribute("data-dock-action") === "retry"
      && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)}`);
    assert.deepEqual(logFingerprint(highlightsLog), beforeFailedHighlightLog, "retry-path failed Highlight changed append-log bytes");
  });

  await pointerClick(driver, cdp, '[data-dock-action="retry"]', "Dock Highlight Retry action");
  await waitForActiveHighlightCount(driver, 1);
  const afterHighlightWriteLog = logFingerprint(highlightsLog);
  assert.ok(afterHighlightWriteLog.bytes > beforeFailedHighlightLog.bytes, "successful Dock Highlight did not append log bytes");
  assert.ok(afterHighlightWriteLog.lines > beforeFailedHighlightLog.lines, "successful Dock Highlight did not append an event line");
  assert.notEqual(afterHighlightWriteLog.sha256, beforeFailedHighlightLog.sha256, "successful Dock Highlight left append-log digest unchanged");
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:blue"`);
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
  assert.ok(written, "Dock highlight did not create a durable record");
  assert.equal(written.color, "blue", "Dock Sky wrote outside the existing blue vocabulary");
  assert.equal(written.package, "bsb", "Dock Sky lost its rendered package locator");
  assert.equal(written.verseStart, FIXTURE.phrase.verse, "Dock Sky began on the wrong verse");
  assert.equal(written.verseEnd, FIXTURE.phrase.verse, "Dock Sky ended on the wrong verse");
  assert.ok(Number.isInteger(written.charStart) && Number.isInteger(written.charEnd), "Dock Sky lost exact character offsets");
  assert.equal(written.charEnd - written.charStart, FIXTURE.phrase.quote.length, "Dock Sky exact range length drifted");
  await putDownDockTool(driver, cdp);

  // Existing-highlight commands share the tight second row with all five
  // modes at 390px. Prove the real 308px interior rather than inferring it
  // from button minima, and preserve the state as a success-only visual.
  await setViewport(cdp, 390, 900);
  await ensureDockResting(driver, cdp);
  await dismissAllToasts(driver);
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-action="note"]')
    && document.querySelector('[data-dock-action="erase"]'))`);
  await settle(driver);
  assertStackedHighlightGeometry(await dockExistingHighlightGeometry(driver));
  await bufferSuccessScreenshot(cdp, successFrames, "marking-dock-proof-paper-stacked-existing-highlight.png");
  await dismissDockSelection(driver, cdp);
  await setViewport(cdp, 860, 900);
  await ensureDockResting(driver, cdp);

  // A separate blocked selection is replaced in place by a new native Range.
  // The stale failure nonce must neither follow that Range nor auto-apply its
  // old tool, and the append-only log must stay byte-identical throughout.
  await openDockSelection(driver, FIXTURE.counterpart);
  await clickDockIntent(driver, cdp, "wash");
  const beforeStaleNonceLog = logFingerprint(highlightsLog);
  await withWriteBlocked(highlightsLog, async () => {
    await pointerClick(driver, cdp, '[data-dock-context="wash"] [data-pigment="blue"]', "Dock stale-nonce blocked Sky subtype");
    await driver.waitFor(`document.activeElement?.getAttribute("data-dock-action") === "retry"
      && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "feedback"`);
    await sleep(300);
    assert.deepEqual(logFingerprint(highlightsLog), beforeStaleNonceLog, "stale-nonce failure changed append-log bytes");
    assert.equal((await rangeCounts(driver)).highlights, 1, "stale-nonce failure wrote a second highlight");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeStaleNonceLog, "restoring stale-nonce log permissions changed append-log bytes");
  const selectedFreshNonce = await driver.evaluate(selectPhraseExpression(FIXTURE.stressPhrase));
  assert.equal(selectedFreshNonce, FIXTURE.stressPhrase.quote, "new selection nonce drifted from its exact quote");
  await settle(driver, true);
  const freshNonce = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    return {
      state: root?.getAttribute("data-dock-state") ?? null,
      mode: root?.getAttribute("data-dock-mode") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      context: root?.querySelector(".marking-dock-context")?.getAttribute("data-dock-context") ?? null,
      quote: root?.querySelector(".marking-dock-quote")?.getAttribute("title") ?? null,
      feedback: root?.querySelectorAll(".marking-dock-feedback").length ?? -1,
      focusedIntent: document.activeElement?.getAttribute("data-dock-intent") ?? null,
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.deepEqual(freshNonce, {
    state: "selection",
    mode: "read",
    armed: "false",
    context: "intent",
    quote: FIXTURE.stressPhrase.quote,
    feedback: 0,
    focusedIntent: "wash",
    nativeSelection: FIXTURE.stressPhrase.quote,
  }, "new selection nonce inherited stale highlight failure state");
  await sleep(300);
  assert.equal((await rangeCounts(driver)).highlights, 1, "stale failed highlight auto-applied to a new selection nonce");
  assert.deepEqual(logFingerprint(highlightsLog), beforeStaleNonceLog, "new selection nonce changed the failed highlight log");
  await dismissDockSelection(driver, cdp, FIXTURE.stressPhrase.verse);

  // Contextual Note uses the selected highlight without arming a parallel
  // store or writing before the user explicitly saves the note dialog.
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-action="note"]') && document.querySelector('[data-dock-action="erase"]'))`);
  await pointerClick(driver, cdp, '[data-dock-action="note"]', "Dock contextual Note action");
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-root"))`);
  const note = await driver.evaluate(`(() => ({
    quote: document.querySelector(".note-capture-quote-text")?.textContent?.trim() ?? null,
    reference: document.querySelector(".note-capture-quote-ref")?.textContent?.trim() ?? null,
  }))()`);
  assert.deepEqual(note, { quote: FIXTURE.phrase.quote, reference: "Acts 19:8" }, "Dock Note lost its exact selection context");
  await pointerClick(driver, cdp, ".note-capture-cancel", "Dock Note Cancel action");
  await driver.waitFor(`!document.querySelector(".note-capture-root")`);
  assert.equal((await rangeCounts(driver)).notes, baseline.notes, "cancelled Dock Note wrote authored data");

  // A failed contextual Remove retains the exact words and existing highlight
  // until the user explicitly retries the same action.
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-action="erase"]'))`);
  const beforeFailedEraseLog = logFingerprint(highlightsLog);
  await withWriteBlocked(highlightsLog, async () => {
    await pointerClick(
      driver,
      cdp,
      '[data-dock-action="erase"]',
      "Dock blocked Remove action",
      { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    );
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      return root?.getAttribute("data-dock-state") === "feedback"
        && root.querySelector(".marking-dock-feedback > span")?.textContent?.trim()
          === "The highlight could not be removed. Selection restored for retry."
        && document.activeElement?.getAttribute("data-dock-action") === "retry"
        && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)};
    })()`);
    await sleep(300);
    assert.equal((await rangeCounts(driver)).highlights, 1, "failed Dock Remove retried or deleted the highlight");
    assert.deepEqual(logFingerprint(highlightsLog), beforeFailedEraseLog, "failed Dock Remove changed append-log bytes");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeFailedEraseLog, "restoring erase-log permissions changed append-log bytes");
  await pressKey(cdp, "Enter", "Enter", 0, 13);
  await waitForActiveHighlightCount(driver, 0);
  const afterEraseWriteLog = logFingerprint(highlightsLog);
  assert.ok(afterEraseWriteLog.bytes > beforeFailedEraseLog.bytes, "successful Dock Remove did not append log bytes");
  assert.ok(afterEraseWriteLog.lines > beforeFailedEraseLog.lines, "successful Dock Remove did not append an event line");
  assert.notEqual(afterEraseWriteLog.sha256, beforeFailedEraseLog.sha256, "successful Dock Remove left append-log digest unchanged");
  await ensureDockResting(driver, cdp);
  assert.deepEqual(await rangeCounts(driver), baseline, "Dock mutation flow did not restore its isolated baseline");
  return delayedRace;
}

async function assertAuthoringDraft(driver, cdp, connectionsLog) {
  const before = await rangeCounts(driver);
  const beforeConnectionLog = logFingerprint(connectionsLog);
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  const selectionPaint = await driver.evaluate(`(() => {
    const group = document.querySelector("[data-marking-selection-emphasis]");
    const goldProbe = document.createElement("span");
    goldProbe.style.color = "var(--study-gold)";
    document.body.append(goldProbe);
    const studyGold = getComputedStyle(goldProbe).color;
    goldProbe.remove();
    return {
      groups: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      rendererOnlyId: group?.getAttribute("data-connection-id")?.startsWith("__marking-selection-emphasis__:") ?? false,
      paintState: group?.getAttribute("data-paint-state") ?? null,
      resolution: group?.getAttribute("data-anchor-resolution") ?? null,
      washes: group?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      neutralGold: group ? getComputedStyle(group).color === studyGold : false,
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
    neutralGold: true,
    authoring: 0,
    routeGroups: 0,
    routes: 0,
    underlines: 0,
    contacts: 0,
    hits: 0,
    ticks: 0,
    cards: 0,
  }, "Dock raw selection did not remain one exact neutral renderer-only emphasis");
  assert.deepEqual(await rangeCounts(driver), before, "Dock raw selection changed durable query counts");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "Dock raw selection changed connection append-log bytes");
  await clickDockIntent(driver, cdp, "connect");
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-context="connect"] [data-relationship-kind="series"]'))`);
  await driver.evaluate(`(() => {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) throw new Error("Dock authoring selection Range is absent");
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    window.__dockAuthoringSelectionRect = {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
  })()`);
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="series"]', "Dock authoring Series subtype");
  await driver.waitFor(`Boolean(document.querySelector('.connection-emphasis-mark[data-authoring-draft] .connection-emphasis-wash'))`);
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
      dockState: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") ?? null,
      dockMode: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-mode") ?? null,
      sessionKind: document.querySelector(".marking-dock-context .marking-session-kind")?.textContent?.trim() ?? null,
      sessionCopy: document.querySelector(".marking-dock-context .marking-session-copy")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
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
  assert.equal(report.draftCount, 1, "Dock authoring phrase did not receive one draft emphasis group");
  assert.equal(report.paintState, "authoring", "Dock authoring phrase lost its explicit paint state");
  assert.equal(report.resolution, "exact", "Dock authoring phrase degraded from exact coordinates");
  assert.ok(report.emphasisPaths > 0, "Dock authoring draft did not bring captured words into focus");
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
    "Dock authoring draft leaked route or durable paint",
  );
  assert.equal(report.dockState, "session", "Dock authoring session did not own the center");
  assert.equal(report.dockMode, "connect", "Dock authoring session lost Connect mode");
  assert.equal(report.sessionKind, "Series", "Dock authoring session lost its relationship kind");
  assert.match(report.sessionCopy, /^1 marked · /, "Dock authoring session did not retain the first phrase");
  assert.equal(report.nativeSelection, "", "captured Dock authoring selection remained native-selected");
  assert.equal(report.focusedVerse, String(FIXTURE.phrase.verse), "Dock authoring capture returned focus to the wrong verse");
  assert.deepEqual(report.globalRoutePlane, { groups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0 }, "Dock authoring capture leaked global line paint");
  assert.ok(report.selectionRect && report.paintRect, "Dock authoring phrase lacked comparable Range/paint geometry");
  assert.ok(Math.abs(report.selectionRect.left - report.paintRect.left) <= 4, "Dock authoring wash began on the wrong words");
  assert.ok(Math.abs(report.selectionRect.right - report.paintRect.right) <= 4, "Dock authoring wash ended on the wrong words");
  assert.ok(
    Math.abs((report.selectionRect.top + report.selectionRect.bottom) / 2 - (report.paintRect.top + report.paintRect.bottom) / 2) <= 6,
    "Dock authoring wash moved to the wrong rendered line",
  );
  assert.deepEqual(await rangeCounts(driver), before, "one held Dock authoring phrase wrote a durable connection");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "one held Dock authoring phrase changed connection append-log bytes");

  const firstHeldPaint = await driver.evaluate(`[...document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash")].map((path) => ({
    d: path.getAttribute("d"),
    anchorIndex: path.getAttribute("data-anchor-index"),
    lineCount: path.getAttribute("data-line-count"),
  }))`);
  assert.equal(firstHeldPaint.length, 1, "first Series phrase did not own exactly one held paint path");
  const duplicate = await driver.evaluate(selectPhraseExpression(FIXTURE.phrase));
  assert.equal(duplicate, FIXTURE.phrase.quote, "duplicate Series phrase selection drifted");
  await driver.waitFor(`document.querySelector(".marking-session-copy")?.textContent?.trim()
    === "That phrase is already held. Select a different phrase to continue."`);
  const duplicateState = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    return {
      state: root?.getAttribute("data-dock-state"),
      mode: root?.getAttribute("data-dock-mode"),
      armed: root?.getAttribute("data-tool-armed"),
      kind: root?.querySelector(".marking-session-kind")?.textContent?.trim(),
      primary: root?.querySelectorAll(".marking-session-action.primary").length ?? -1,
      cancel: [...(root?.querySelectorAll(".marking-session-action") ?? [])].filter((button) => button.textContent?.trim() === "Cancel").length,
      retries: root?.querySelectorAll('[data-dock-action="retry"]').length ?? -1,
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
    mode: "connect",
    armed: "connect:series",
    kind: "Series",
    primary: 0,
    cancel: 1,
    retries: 0,
    nativeSelection: "",
    paint: firstHeldPaint,
  }, "duplicate Series anchor became terminal or duplicated held paint");
  assert.deepEqual(await rangeCounts(driver), before, "duplicate Series anchor wrote durable data");

  const different = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(different, FIXTURE.counterpart.quote, "post-duplicate Series phrase selection drifted");
  await driver.waitFor(`document.querySelector(".marking-session-copy")?.textContent?.trim()
    === "2 marked · select another phrase, or finish"
    && document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Done"
    && [...document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash")]
      .map((path) => path.getAttribute("data-anchor-index")).join() === "0,1"`);
  const continued = await driver.evaluate(`(() => ({
    state: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state"),
    armed: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed"),
    actions: [...document.querySelectorAll(".marking-session-action")].map((button) => button.textContent?.trim()),
    indices: [...document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash")].map((path) => path.getAttribute("data-anchor-index")),
    draftGroups: document.querySelectorAll("[data-authoring-draft]").length,
    selectionEmphasis: document.querySelectorAll("[data-marking-selection-emphasis]").length,
    lineOrTickArtifacts: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit, [data-connection-tick]").length,
    cards: document.querySelectorAll(".connection-card").length,
    nativeSelection: getSelection()?.toString() ?? "",
  }))()`);
  assert.deepEqual(continued, {
    state: "session",
    armed: "connect:series",
    actions: ["Done", "Cancel"],
    indices: ["0", "1"],
    draftGroups: 1,
    selectionEmphasis: 0,
    lineOrTickArtifacts: 0,
    cards: 0,
    nativeSelection: "",
  }, "different phrase did not recover normally from duplicate-anchor notice");
  assert.deepEqual(await rangeCounts(driver), before, "recovered duplicate-anchor session wrote before Done");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "recovered duplicate-anchor session changed connection append-log bytes before Done");

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector(${JSON.stringify(`[data-connection-id="${DRAFT_ID}"]`)})`);
  const cancelled = await driver.evaluate(`(() => ({
    draft: document.querySelectorAll(${JSON.stringify(`[data-connection-id="${DRAFT_ID}"]`)}).length,
    route: document.querySelectorAll(${JSON.stringify(`.connection-mark[data-connection-id="${DRAFT_ID}"]`)}).length,
    tick: document.querySelectorAll(${JSON.stringify(`[data-connection-tick="${DRAFT_ID}"]`)}).length,
    session: document.querySelectorAll(".marking-session").length,
    armed: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed"),
    globalLines: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit").length,
  }))()`);
  assert.deepEqual(cancelled, { draft: 0, route: 0, tick: 0, session: 0, armed: "connect:series", globalLines: 0 }, "cancelling a Dock session leaked draft paint or lost the carried tool");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "false"`);
  await driver.evaluate(`delete window.__dockAuthoringSelectionRect`);
  assert.deepEqual(await rangeCounts(driver), before, "Dock authoring cancellation wrote after its Escape ladder completed");
}

async function assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames) {
  const before = await rangeCounts(driver);
  const expectedAnchors = await Promise.all([
    expectedConnectionAnchor(driver, FIXTURE.phrase),
    expectedConnectionAnchor(driver, FIXTURE.counterpart),
  ]);
  await ensureDockResting(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "connect");
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-context="connect"] [data-relationship-kind="series"]'))`);
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="series"]', "Dock durable Series subtype");
  await driver.waitFor(`Boolean(document.querySelector("[data-authoring-draft]"))`);
  const counterpart = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(counterpart, FIXTURE.counterpart.quote, "Dock Series counterpart selection drifted");
  await driver.waitFor(`Boolean(document.querySelector(".marking-dock-context .marking-session-action.primary"))`);

  const beforeFailedConnectionLog = logFingerprint(connectionsLog);
  await withWriteBlocked(connectionsLog, async () => {
    await pointerClick(
      driver,
      cdp,
      ".marking-dock-context .marking-session-action.primary",
      "Dock blocked connection Done action",
      { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    );
    await driver.waitFor(`document.querySelector(".marking-dock-context .marking-session-copy")?.textContent?.trim()
      === "The result is not confirmed. Retry this exact change; your selected phrases are still held."`);
    await driver.waitFor(`document.activeElement?.matches(".marking-dock-context .marking-session-action.primary") === true`);
    await sleep(300);
    const failed = await driver.evaluate(`(() => ({
      draftGroups: document.querySelectorAll("[data-authoring-draft]").length,
      draftPaths: document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash").length,
      done: document.querySelectorAll(".marking-dock-context .marking-session-action.primary").length,
      busy: document.querySelector(".marking-dock-context .marking-session")?.getAttribute("aria-busy"),
      state: document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state"),
      nativeSelection: getSelection()?.toString() ?? "",
      rawDiagnosticVisible: /EACCES|EPERM|ENOENT|connections\\.jsonl|\\/var\\/folders|QA simulated/i.test(document.body.innerText),
      connectionToasts: [...document.querySelectorAll(".toast-message")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter((message) => /connection|result is not confirmed|reading index/i.test(message)),
    }))()`);
    assert.equal(failed.draftGroups, 1, "failed Dock connection save dropped its held draft");
    assert.ok(failed.draftPaths >= 2, "failed Dock connection save dropped one held phrase");
    assert.equal(failed.done, 1, "failed Dock connection save removed the explicit retry action");
    assert.equal(failed.busy, "false", "failed Dock connection save never released busy state");
    assert.equal(failed.state, "session", "failed Dock connection save lost session ownership");
    assert.equal(failed.nativeSelection, "", "failed Dock connection save restored native selection instead of held paint");
    assert.equal(failed.rawDiagnosticVisible, false, "failed Dock connection exposed a host path or diagnostic string");
    assert.deepEqual(failed.connectionToasts, [], "failed Dock connection duplicated its owned inline recovery state in a toast");
    assert.deepEqual(await rangeCounts(driver), before, "failed Dock connection save retried or wrote a durable record");
    assert.deepEqual(logFingerprint(connectionsLog), beforeFailedConnectionLog, "failed Dock connection changed append-log bytes");
    await settle(driver);
    assertCoarseSessionActions(await dockSessionActionGeometry(driver), ["Retry", "Recovery required"]);
    await driver.evaluate(`(async () => {
      document.querySelector('.verse-line[data-verse="8"]')?.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    })()`);
    await settle(driver);
    await bufferSuccessScreenshot(cdp, successFrames, "marking-dock-proof-paper-stacked-retry.png");
  });
  assert.deepEqual(logFingerprint(connectionsLog), beforeFailedConnectionLog, "restoring connection-log permissions changed append-log bytes");

  await pointerClick(driver, cdp, ".marking-dock-context .marking-session-action.primary", "Dock retry connection Done action");
  await driver.waitFor(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.connections.length === ${before.connections + 1};
  })()`);
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    return root?.getAttribute("data-dock-state") === "armed"
      && root.getAttribute("data-dock-mode") === "connect"
      && root.getAttribute("data-tool-armed") === "connect:series";
  })()`);
  await driver.waitFor(`[...document.querySelectorAll(".toast-message")]
    .some((node) => (node.textContent?.trim() ?? "").startsWith("Series")
      && (node.textContent?.trim() ?? "").endsWith(" saved"))`);
  const terminalConnectionToasts = await driver.evaluate(`[...document.querySelectorAll(".toast-message")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter((message) => /series|connection|result is not confirmed|reading index/i.test(message))`);
  assert.equal(terminalConnectionToasts.length, 1, "Dock Retry did not reconcile to one terminal success notice");
  assert.match(terminalConnectionToasts[0], /^Series\b.* saved$/, "Dock terminal success notice lost its authored label");
  assert.equal(
    await driver.evaluate(`/EACCES|EPERM|ENOENT|connections\\.jsonl|\\/var\\/folders|QA simulated/i.test(document.body.innerText)`),
    false,
    "successful Dock Retry retained a raw host diagnostic",
  );
  const afterConnectionWriteLog = logFingerprint(connectionsLog);
  assert.ok(afterConnectionWriteLog.bytes > beforeFailedConnectionLog.bytes, "successful Dock connection did not append log bytes");
  assert.ok(afterConnectionWriteLog.lines > beforeFailedConnectionLog.lines, "successful Dock connection did not append an event line");
  assert.notEqual(afterConnectionWriteLog.sha256, beforeFailedConnectionLog.sha256, "successful Dock connection left append-log digest unchanged");
  const connection = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const record = result.connections.at(-1);
    if (!record) return null;
    window.__dockCompletedConnectionId = record.id;
    return {
      id: record.id,
      formatVersion: record.format_version,
      kind: record.kind,
      anchors: record.anchors,
    };
  })()`);
  assert.ok(connection?.id, "successful Dock connection did not return a durable id");
  assert.deepEqual(
    { formatVersion: connection.formatVersion, kind: connection.kind, anchors: connection.anchors },
    { formatVersion: 2, kind: "series", anchors: expectedAnchors },
    "successful Dock connection payload drifted from its exact v2 anchors",
  );
  await driver.waitFor(`Boolean(document.querySelector('[data-connection-tick="' + CSS.escape(window.__dockCompletedConnectionId) + '"]'))`);
  await settle(driver);

  const dormant = await driver.evaluate(`(() => {
    const id = window.__dockCompletedConnectionId;
    const exact = (suffix) => document.querySelectorAll('[data-connection-id="' + CSS.escape(id) + '"] ' + suffix).length;
    const emphasis = document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]');
    return {
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      resolution: emphasis?.getAttribute("data-anchor-resolution") ?? null,
      washes: emphasis?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      routeGroups: document.querySelectorAll('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]').length,
      routes: exact(".connection-route"),
      underlines: exact(".connection-underline"),
      contacts: exact(".connection-contact"),
      hits: exact(".connection-route-hit"),
      ticks: document.querySelectorAll('[data-connection-tick="' + CSS.escape(id) + '"]').length,
    };
  })()`);
  assert.equal(dormant.paintState, "dormant", "saved Dock connection did not settle into dormant presence paint");
  assert.equal(dormant.resolution, "exact", "saved Dock connection lost exact active-package paint");
  assert.ok(dormant.washes >= 2, "saved Dock connection did not retain both phrase washes");
  assert.deepEqual(
    { routeGroups: dormant.routeGroups, routes: dormant.routes, underlines: dormant.underlines, contacts: dormant.contacts, hits: dormant.hits, ticks: dormant.ticks },
    { routeGroups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 1 },
    "dormant Dock connection leaked line or hit paint",
  );

  await pointerClick(driver, cdp, `[data-connection-tick="${connection.id}"]`, "Dock durable connection tick");
  await driver.waitFor(`Boolean(document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(window.__dockCompletedConnectionId) + '"]'))`);
  await settle(driver);
  const routeReadiness = await driver.evaluate(`(() => {
    const id = window.__dockCompletedConnectionId;
    const group = document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]');
    return {
      routes: group?.querySelectorAll(".connection-route").length ?? 0,
      routeState: group?.getAttribute("data-route") ?? null,
      paintState: group?.getAttribute("data-paint-state") ?? null,
      underlines: group?.querySelectorAll(".connection-underline").length ?? 0,
      emphasisState: document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]')?.getAttribute("data-paint-state") ?? null,
    };
  })()`);
  assert.equal(routeReadiness.routes, 1, `selected compact Dock route unavailable: ${JSON.stringify(routeReadiness)}`);
  const selected = await driver.evaluate(`(() => {
    const id = window.__dockCompletedConnectionId;
    const group = document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]');
    const emphasis = document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]');
    const card = document.querySelector("#connection-card-inspector");
    const margin = card?.closest(".living-margin");
    const study = margin?.querySelector(".margin-study-content.has-connection-inspector");
    const stage = document.querySelector(".scripture-reading-stage");
    const dock = document.querySelector('[data-marking-surface="dock"] .marking-dock');
    const body = document.querySelector(".scripture-body");
    const rect = (element) => element?.getBoundingClientRect() ?? null;
    const contained = (inner, outer) => Boolean(inner && outer
      && inner.left >= outer.left - ${GEOMETRY_EPSILON}
      && inner.top >= outer.top - ${GEOMETRY_EPSILON}
      && inner.right <= outer.right + ${GEOMETRY_EPSILON}
      && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
    const overlapArea = (left, right) => left && right
      ? Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
      : 0;
    const cardRect = rect(card);
    const marginRect = rect(margin);
    const stageRect = rect(stage);
    const dockRect = rect(dock);
    const bodyRect = rect(body);
    return {
      groups: document.querySelectorAll('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]').length,
      routes: group?.querySelectorAll(".connection-route").length ?? 0,
      underlines: group?.querySelectorAll(".connection-underline").length ?? 0,
      contacts: group?.querySelectorAll(".connection-contact").length ?? 0,
      hits: group?.querySelectorAll(".connection-route-hit").length ?? 0,
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      veil: document.querySelectorAll(".connection-focus-veil").length,
      card: document.querySelectorAll("#connection-card-inspector").length,
      cardInMargin: Boolean(card && margin),
      cardContained: contained(cardRect, marginRect),
      marginContained: contained(marginRect, bodyRect),
      dockContained: contained(dockRect, stageRect),
      stageWidth: stageRect?.width ?? null,
      dockWidth: dockRect?.width ?? null,
      marginPosition: margin ? getComputedStyle(margin).position : null,
      marginMode: margin?.getAttribute("data-margin-mode") ?? null,
      marginHeight: marginRect?.height ?? null,
      marginScrollable: Boolean(margin && margin.scrollHeight > margin.clientHeight),
      studyFollowsCard: Boolean(card && study && (card.compareDocumentPosition(study) & Node.DOCUMENT_POSITION_FOLLOWING)),
      cardDockOverlap: overlapArea(marginRect, dockRect),
    };
  })()`);
  assert.equal(selected.groups, 1, "selected Dock connection did not produce one route group");
  assert.equal(selected.routes, 1, "selected Dock connection did not produce one bracket centerline");
  assert.ok(selected.underlines >= 2, "selected Dock connection did not underline both member phrases");
  assert.ok(selected.contacts >= 2, "selected Dock connection did not pin both member phrases");
  assert.equal(selected.hits, 1, "selected Dock connection lost its focused hit target");
  assert.equal(selected.paintState, "selected", "selected Dock connection did not bring member words into focus");
  assert.equal(selected.veil, 1, "selected Dock connection lost the reading-focus veil");
  assert.equal(selected.card, 1, "selected Dock connection did not open its Living Margin card");
  assert.equal(selected.cardInMargin, true, "Dock connection card escaped Living Margin flow");
  assert.equal(selected.cardContained, true, "Dock connection card overflowed Living Margin horizontally");
  assert.equal(selected.marginContained, true, "compact Living Margin escaped the scripture body");
  assert.equal(selected.dockContained, true, "compact connection selection pushed the Dock outside the reading stage");
  assert.ok(selected.stageWidth >= 300, `compact Living Margin collapsed the ${selected.stageWidth}px reading stage`);
  assert.ok(selected.dockWidth >= 300, `compact Living Margin collapsed the ${selected.dockWidth}px Dock`);
  assert.equal(selected.marginPosition, "absolute", "compact connection inspector still consumed the reader flex width");
  assert.equal(selected.marginMode, "connection", "compact Living Margin lost its explicit connection mode");
  assert.ok(selected.marginHeight != null && selected.marginHeight <= 320 + GEOMETRY_EPSILON, `compact Living Margin grew to ${selected.marginHeight}px instead of yielding the reader`);
  assert.equal(selected.marginScrollable, true, "compact Living Margin did not retain one scroll owner for the card and Study");
  assert.equal(selected.studyFollowsCard, true, "compact Living Margin removed or reordered the real Study tree");
  assert.ok(selected.cardDockOverlap <= GEOMETRY_EPSILON, `compact Living Margin covered ${selected.cardDockOverlap}px² of the Dock`);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, successFrames, "marking-dock-proof-selected-connection.png");

  await pointerClick(driver, cdp, `[data-connection-tick="${connection.id}"]`, "Dock selected connection release tick");
  await driver.waitFor(`(() => {
    const id = window.__dockCompletedConnectionId;
    return !document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]')
      && document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]')?.getAttribute("data-paint-state") === "dormant"
      && Boolean(document.querySelector('[data-connection-tick="' + CSS.escape(id) + '"]'))
      && !document.querySelector("#connection-card-inspector");
  })()`);
  const released = await driver.evaluate(`(() => {
    const id = window.__dockCompletedConnectionId;
    const emphasis = document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]');
    const stage = document.querySelector(".scripture-reading-stage");
    const dock = document.querySelector('[data-marking-surface="dock"] .marking-dock');
    const margin = document.querySelector(".scripture-body > .living-margin");
    const body = document.querySelector(".scripture-body");
    const read = document.querySelector('[data-marking-surface="dock"] [data-dock-tool="read"]');
    const rect = (element) => element?.getBoundingClientRect() ?? null;
    const contained = (inner, outer) => Boolean(inner && outer
      && inner.left >= outer.left - ${GEOMETRY_EPSILON}
      && inner.top >= outer.top - ${GEOMETRY_EPSILON}
      && inner.right <= outer.right + ${GEOMETRY_EPSILON}
      && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
    const stageRect = rect(stage);
    const dockRect = rect(dock);
    const marginRect = rect(margin);
    const bodyRect = rect(body);
    const readRect = rect(read);
    const readHit = readRect ? document.elementFromPoint(readRect.left + readRect.width / 2, readRect.top + readRect.height / 2) : null;
    const report = {
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      lines: document.querySelectorAll('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]').length,
      tick: document.querySelectorAll('[data-connection-tick="' + CSS.escape(id) + '"]').length,
      card: document.querySelectorAll("#connection-card-inspector").length,
      stageWidth: stageRect?.width ?? null,
      dockWidth: dockRect?.width ?? null,
      dockContained: contained(dockRect, stageRect),
      marginContained: contained(marginRect, bodyRect),
      marginPosition: margin ? getComputedStyle(margin).position : null,
      readTopmost: Boolean(readHit && read && (readHit === read || read.contains(readHit))),
    };
    delete window.__dockCompletedConnectionId;
    return report;
  })()`);
  assert.deepEqual(
    { paintState: released.paintState, lines: released.lines, tick: released.tick, card: released.card },
    { paintState: "dormant", lines: 0, tick: 1, card: 0 },
    "released Dock connection did not return to quiet dormant presence",
  );
  assert.ok(released.stageWidth >= 300 && released.dockWidth >= 300, "released compact connection collapsed reader or Dock geometry");
  assert.equal(released.dockContained, true, "released compact connection pushed the Dock outside the reading stage");
  assert.equal(released.marginContained, true, "released compact Living Margin escaped the scripture body");
  assert.equal(released.marginPosition, "absolute", "released compact Living Margin returned to flex sizing");
  assert.equal(released.readTopmost, true, "released compact Living Margin covered the Dock Read command");

  // A direct Done and a failure-to-Retry Done must converge on the same
  // persistent Dock state: the chosen relationship remains carried.
  await putDownDockTool(driver, cdp);
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "connect");
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="series"]', "Dock direct Series subtype");
  await driver.waitFor(`Boolean(document.querySelector("[data-authoring-draft]"))`);
  assert.equal(await driver.evaluate(selectPhraseExpression(FIXTURE.stressPhrase)), FIXTURE.stressPhrase.quote, "direct Series counterpart drifted");
  await driver.waitFor(`document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Done"`);
  await pointerClick(driver, cdp, ".marking-session-action.primary", "Dock direct connection Done action");
  await driver.waitFor(`(async () => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.connections.length === ${before.connections + 2}
      && root?.getAttribute("data-dock-state") === "armed"
      && root.getAttribute("data-dock-mode") === "connect"
      && root.getAttribute("data-tool-armed") === "connect:series";
  })()`);
}

async function assertConnectionCardinalityPersistence(driver, cdp, connectionsLog) {
  const before = await rangeCounts(driver);
  const expectedParallelAnchors = await Promise.all([
    expectedConnectionAnchor(driver, FIXTURE.phrase),
    expectedConnectionAnchor(driver, FIXTURE.counterpart),
  ]);
  const expectedContrastAnchors = await Promise.all([
    expectedConnectionAnchor(driver, FIXTURE.phrase),
    expectedConnectionAnchor(driver, FIXTURE.stressPhrase),
  ]);
  await putDownDockTool(driver, cdp);

  const beforeParallelLog = logFingerprint(connectionsLog);
  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "connect");
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="link:parallel"]', "Dock direct Parallelism subtype");
  await driver.waitFor(`Boolean(document.querySelector("[data-authoring-draft]"))`);
  assert.equal(await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart)), FIXTURE.counterpart.quote, "direct Parallelism counterpart drifted");
  await driver.waitFor(`document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Done"`);
  assert.deepEqual(await rangeCounts(driver), before, "multi-member Parallelism saved before explicit Done");
  await pointerClick(driver, cdp, ".marking-session-action.primary", "Dock Parallelism Done action");
  await driver.waitFor(`(async () => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.connections.length === ${before.connections + 1}
      && root?.getAttribute("data-dock-state") === "armed"
      && root.getAttribute("data-dock-mode") === "connect"
      && root.getAttribute("data-tool-armed") === "connect:link:parallel";
  })()`);
  const afterParallelLog = logFingerprint(connectionsLog);
  assert.equal(afterParallelLog.lines, beforeParallelLog.lines + 1, "Parallelism did not append exactly one event");
  assert.ok(afterParallelLog.bytes > beforeParallelLog.bytes, "Parallelism did not grow the append log");
  assert.notEqual(afterParallelLog.sha256, beforeParallelLog.sha256, "Parallelism left the append-log digest unchanged");
  const parallel = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const record = result.connections.at(-1);
    return record ? {
      id: record.id,
      formatVersion: record.format_version,
      kind: record.kind,
      anchors: record.anchors,
    } : null;
  })()`);
  assert.ok(parallel?.id, "Parallelism did not return a durable id");
  assert.deepEqual({ formatVersion: parallel.formatVersion, kind: parallel.kind, anchors: parallel.anchors }, {
    formatVersion: 2,
    kind: "link:parallel",
    anchors: expectedParallelAnchors,
  }, "Parallelism payload drifted from its two exact v2 anchors");
  await putDownDockTool(driver, cdp);

  await openDockSelection(driver, FIXTURE.phrase);
  await clickDockIntent(driver, cdp, "connect");
  await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="link:contrast"]', "Dock blocked Contrast subtype");
  await driver.waitFor(`Boolean(document.querySelector("[data-authoring-draft]"))`);
  const beforeBlockedBinaryLog = logFingerprint(connectionsLog);
  await withWriteBlocked(connectionsLog, async () => {
    assert.equal(await driver.evaluate(selectPhraseExpression(FIXTURE.stressPhrase)), FIXTURE.stressPhrase.quote, "blocked Contrast counterpart drifted");
    await driver.waitFor(`document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Retry"
      && document.activeElement?.matches(".marking-session-action.primary") === true`);
    assert.deepEqual(await rangeCounts(driver), { ...before, connections: before.connections + 1 }, "blocked binary save wrote another connection");
    assert.deepEqual(logFingerprint(connectionsLog), beforeBlockedBinaryLog, "blocked binary save changed append-log bytes");
  });
  await pointerClick(driver, cdp, ".marking-session-action.primary", "Dock binary Retry action");
  await driver.waitFor(`(async () => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.connections.length === ${before.connections + 2}
      && root?.getAttribute("data-dock-state") === "armed"
      && root.getAttribute("data-dock-mode") === "connect"
      && root.getAttribute("data-tool-armed") === "connect:link:contrast";
  })()`);
  const afterContrastLog = logFingerprint(connectionsLog);
  assert.equal(afterContrastLog.lines, beforeBlockedBinaryLog.lines + 1, "Contrast Retry did not append exactly one event");
  assert.ok(afterContrastLog.bytes > beforeBlockedBinaryLog.bytes, "Contrast Retry did not grow the append log");
  assert.notEqual(afterContrastLog.sha256, beforeBlockedBinaryLog.sha256, "Contrast Retry left the append-log digest unchanged");
  const contrast = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const record = result.connections.at(-1);
    return record ? {
      id: record.id,
      formatVersion: record.format_version,
      kind: record.kind,
      anchors: record.anchors,
    } : null;
  })()`);
  assert.ok(contrast?.id, "Contrast Retry did not return a durable id");
  assert.notEqual(contrast.id, parallel.id, "binary Dock writes reused a durable connection id");
  assert.deepEqual({ formatVersion: contrast.formatVersion, kind: contrast.kind, anchors: contrast.anchors }, {
    formatVersion: 2,
    kind: "link:contrast",
    anchors: expectedContrastAnchors,
  }, "Contrast Retry payload drifted from its two exact v2 anchors");
}

function allZeroDurations(value) {
  return value.split(",").every((duration) => Number.parseFloat(duration) === 0);
}

async function assertReducedMotion(driver, cdp) {
  await ensureDockResting(driver, cdp);
  await setMedia(cdp, { reduced: true });
  await openDockSelection(driver, FIXTURE.phrase, true);
  await clickDockIntent(driver, cdp, "connect");
  await driver.waitFor(`Boolean(document.querySelector('[data-dock-context="connect"]'))`);
  await settle(driver, true);
  const report = await driver.evaluate(`(() => {
    const targets = [
      document.querySelector(".marking-dock"),
      document.querySelector(".marking-dock-thumb"),
      document.querySelector(".marking-dock-mode"),
      document.querySelector(".marking-dock-context .marking-choice-panel"),
      document.querySelector(".marking-dock-context .marking-choice"),
    ].filter(Boolean);
    return {
      animations: targets.map((target) => getComputedStyle(target).animationDuration),
      transitions: targets.map((target) => getComputedStyle(target).transitionDuration),
      running: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="dock"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
      nativeSelection: getSelection()?.toString() ?? "",
    };
  })()`);
  assert.ok(report.animations.every(allZeroDurations), "reduced-motion Dock retained an animation duration");
  assert.ok(report.transitions.every(allZeroDurations), "reduced-motion Dock retained a transition duration");
  assert.equal(report.running, 0, "reduced-motion Dock retained a running animation");
  assert.equal(report.nativeSelection, FIXTURE.phrase.quote, "reduced-motion Dock collapsed its exact selection");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await dismissDockSelection(driver, cdp);
  await setMedia(cdp);
}

async function dockExistingHighlightGeometry(driver) {
  return driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const stage = document.querySelector(".scripture-reading-stage");
    const content = document.querySelector(".scripture-content");
    const dock = root?.querySelector(".marking-dock");
    const context = root?.querySelector(".marking-dock-context");
    const actions = root?.querySelector(".marking-dock-actions");
    const modes = root?.querySelector(".marking-dock-modes");
    const buttons = [...(actions?.querySelectorAll("button") ?? [])];
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const contained = (inner, outer) => Boolean(inner && outer
      && inner.left >= outer.left - ${GEOMETRY_EPSILON}
      && inner.top >= outer.top - ${GEOMETRY_EPSILON}
      && inner.right <= outer.right + ${GEOMETRY_EPSILON}
      && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
    const overlapArea = (left, right) => left && right
      ? Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
      : 0;
    const stageRect = rect(stage);
    const dockRect = rect(dock);
    const contextRect = rect(context);
    const actionsRect = rect(actions);
    const modesRect = rect(modes);
    const buttonRects = buttons.map(rect);
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const contentStyle = content ? getComputedStyle(content) : null;
    const overflow = (element, axis) => element
      ? Math.max(0, axis === "x" ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight)
      : null;
    return {
      layout: root?.getAttribute("data-dock-layout") ?? null,
      state: root?.getAttribute("data-dock-state") ?? null,
      quote: context?.querySelector(".marking-dock-quote")?.getAttribute("title") ?? null,
      intents: [...(context?.querySelectorAll("[data-dock-intent]") ?? [])].map((item) => item.textContent?.trim()),
      actionLabels: buttons.map((button) => button.getAttribute("aria-label")),
      actionSizes: buttonRects.map(({ width, height }) => ({ width, height })),
      hitColor: actions?.querySelector(".marking-dock-hit")?.getAttribute("data-highlight-color") ?? null,
      hitVisible: actions?.querySelector(".marking-dock-hit") ? getComputedStyle(actions.querySelector(".marking-dock-hit")).display !== "none" : null,
      dockHeight: dockRect?.height ?? null,
      markingBottomInset: stageStyle ? Number.parseFloat(stageStyle.getPropertyValue("--mdock-bottom-inset")) : null,
      contentPaddingBottom: contentStyle ? Number.parseFloat(contentStyle.paddingBottom) : null,
      contentScrollPaddingBottom: contentStyle ? Number.parseFloat(contentStyle.scrollPaddingBottom) : null,
      contained: {
        dockInStage: contained(dockRect, stageRect),
        contextInDock: contained(contextRect, dockRect),
        actionsInDock: contained(actionsRect, dockRect),
        modesInDock: contained(modesRect, dockRect),
        buttonsInActions: buttonRects.every((box) => contained(box, actionsRect)),
      },
      overlap: {
        contextActions: overlapArea(contextRect, actionsRect),
        modesActions: overlapArea(modesRect, actionsRect),
      },
      overflow: {
        documentX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        bodyX: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
        stageX: overflow(stage, "x"),
        dockX: overflow(dock, "x"),
        contextX: overflow(context, "x"),
        actionsX: overflow(actions, "x"),
      },
    };
  })()`);
}

function assertStackedHighlightGeometry(report) {
  assert.equal(report.layout, "stacked", "existing-highlight proof did not use the stacked Dock");
  assert.equal(report.state, "selection", "existing-highlight proof lost selection state");
  assert.equal(report.quote, FIXTURE.phrase.quote, "stacked existing highlight lost its exact quote");
  assert.deepEqual(report.intents, ["Highlight", "Connect"], "stacked existing highlight lost its two intent choices");
  assert.deepEqual(report.actionLabels, ["Add note to selected highlight", "Remove selected text from highlight"], "stacked existing-highlight actions drifted");
  assert.equal(report.hitColor, "blue", "stacked existing highlight lost its Sky identity");
  assert.equal(report.hitVisible, false, "stacked existing highlight spent scarce width on a redundant hit chip");
  assert.ok(report.actionSizes.every((size) => size.width >= 44 - GEOMETRY_EPSILON && size.height >= 44 - GEOMETRY_EPSILON), "stacked existing-highlight action lost a 44px target");
  assert.deepEqual(report.contained, {
    dockInStage: true,
    contextInDock: true,
    actionsInDock: true,
    modesInDock: true,
    buttonsInActions: true,
  }, "stacked existing-highlight controls escaped their measured hierarchy");
  assert.ok(report.overlap.contextActions <= GEOMETRY_EPSILON, `stacked context/actions overlap by ${report.overlap.contextActions}px²`);
  assert.ok(report.overlap.modesActions <= GEOMETRY_EPSILON, `stacked modes/actions overlap by ${report.overlap.modesActions}px²`);
  assert.ok(report.markingBottomInset >= report.dockHeight + 8 - GEOMETRY_EPSILON, "stacked existing-highlight Dock outgrew its reserved inset");
  assert.ok(report.contentPaddingBottom >= report.dockHeight + 32 - GEOMETRY_EPSILON, "stacked existing-highlight Dock outgrew content padding");
  assert.ok(report.contentScrollPaddingBottom >= report.dockHeight + 24 - GEOMETRY_EPSILON, "stacked existing-highlight Dock outgrew scroll padding");
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `stacked existing-highlight ${surface} overflowed by ${overflow}px`);
  }
}

async function dockSessionActionGeometry(driver) {
  return driver.evaluate(`(async () => {
    const lastVerse = document.querySelector('.verse-line[data-verse="28"]');
    lastVerse?.scrollIntoView({ block: "end", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const root = document.querySelector('[data-marking-surface="dock"]');
    const stage = document.querySelector(".scripture-reading-stage");
    const content = document.querySelector(".scripture-content");
    const dock = root?.querySelector(".marking-dock");
    const context = root?.querySelector(".marking-dock-context");
    const session = root?.querySelector(".marking-session");
    const kind = session?.querySelector(".marking-session-kind");
    const copy = session?.querySelector(".marking-session-copy");
    const actions = [...(session?.querySelectorAll(".marking-session-action") ?? [])];
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const contained = (inner, outer) => Boolean(inner && outer
      && inner.left >= outer.left - ${GEOMETRY_EPSILON}
      && inner.top >= outer.top - ${GEOMETRY_EPSILON}
      && inner.right <= outer.right + ${GEOMETRY_EPSILON}
      && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
    const overflow = (element, axis) => element
      ? Math.max(0, axis === "x" ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight)
      : null;
    const stageRect = rect(stage);
    const dockRect = rect(dock);
    const lastVerseRect = rect(lastVerse);
    const contextRect = rect(context);
    const sessionRect = rect(session);
    const partRects = [rect(kind), rect(copy)];
    const boxes = actions.map(rect);
    const overlap = boxes.reduce((total, left, index) => total + boxes.slice(index + 1).reduce((subtotal, right) => (
      subtotal + Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
    ), 0), 0);
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const contentStyle = content ? getComputedStyle(content) : null;
    return {
      layout: root?.getAttribute("data-dock-layout") ?? null,
      labels: actions.map((action) => action.textContent?.trim()),
      sizes: boxes.map(({ width, height }) => ({ width, height })),
      dockHeight: dockRect?.height ?? null,
      markingBottomInset: stageStyle ? Number.parseFloat(stageStyle.getPropertyValue("--mdock-bottom-inset")) : null,
      contentPaddingBottom: contentStyle ? Number.parseFloat(contentStyle.paddingBottom) : null,
      contentScrollPaddingBottom: contentStyle ? Number.parseFloat(contentStyle.scrollPaddingBottom) : null,
      lastVerseClearance: dockRect && lastVerseRect ? dockRect.top - lastVerseRect.bottom : null,
      contained: {
        dockInStage: contained(dockRect, stageRect),
        contextInDock: contained(contextRect, dockRect),
        sessionInContext: contained(sessionRect, contextRect),
        partsInSession: partRects.every((box) => contained(box, sessionRect)),
        actionsInSession: boxes.every((box) => contained(box, sessionRect)),
      },
      overlap,
      overflow: {
        documentX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        bodyX: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
        stageX: overflow(stage, "x"),
        dockX: overflow(dock, "x"),
        dockY: overflow(dock, "y"),
        contextX: overflow(context, "x"),
        contextY: overflow(context, "y"),
        sessionX: overflow(session, "x"),
        sessionY: overflow(session, "y"),
      },
    };
  })()`);
}

function assertCoarseSessionActions(report, labels) {
  assert.equal(report.layout, "stacked", `${labels.join("/")} did not use the stacked Dock`);
  assert.deepEqual(report.labels, labels, `coarse session actions drifted from ${labels.join("/")}`);
  assert.equal(report.sizes.every((size) => size.width >= 44 - GEOMETRY_EPSILON && size.height >= 44 - GEOMETRY_EPSILON), true, `${labels.join("/")} lost a 44px coarse target`);
  assert.deepEqual(report.contained, {
    dockInStage: true,
    contextInDock: true,
    sessionInContext: true,
    partsInSession: true,
    actionsInSession: true,
  }, `${labels.join("/")} escaped the measured Dock hierarchy`);
  assert.ok(report.overlap <= GEOMETRY_EPSILON, `${labels.join("/")} overlap by ${report.overlap}px²`);
  assert.ok(report.markingBottomInset >= report.dockHeight + 8 - GEOMETRY_EPSILON, `${labels.join("/")} outgrew the Dock inset`);
  assert.ok(report.contentPaddingBottom >= report.dockHeight + 32 - GEOMETRY_EPSILON, `${labels.join("/")} outgrew content padding`);
  assert.ok(report.contentScrollPaddingBottom >= report.dockHeight + 24 - GEOMETRY_EPSILON, `${labels.join("/")} outgrew scroll padding`);
  assert.ok(report.lastVerseClearance >= 24 - GEOMETRY_EPSILON, `${labels.join("/")} let the Dock cover the last verse`);
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `${labels.join("/")} ${surface} overflowed by ${overflow}px`);
  }
}

async function assertForcedColorsAndCoarseTargets(driver, cdp, connectionsLog) {
  await ensureDockResting(driver, cdp);
  await setViewport(cdp, 390, 900);
  await setMedia(cdp, { forced: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    await openDockSelection(driver, FIXTURE.phrase, true);
    await driver.evaluate(`(() => {
      window.__dockCoarseIntentRects = [...document.querySelectorAll("[data-dock-intent]")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
    })()`);
    await clickDockIntent(driver, cdp, "wash");
    await driver.waitFor(`document.activeElement?.matches('[data-dock-context="wash"] [data-pigment="yellow"]') === true`);
    await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
    await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
    await driver.waitFor(`document.activeElement?.getAttribute("data-pigment") === "blue"`);
    await settle(driver);
    const report = await driver.evaluate(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      const thumb = root?.querySelector(".marking-dock-thumb");
      const modes = [...(root?.querySelectorAll("[data-dock-tool]") ?? [])];
      const pigments = [...(root?.querySelectorAll("[data-pigment]") ?? [])];
      const intents = [...(root?.querySelectorAll("[data-dock-intent]") ?? [])];
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const overlapArea = (left, right) => left && right
        ? Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
          * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
        : 0;
      const pairwiseOverlap = (boxes) => boxes.reduce((total, value, index) => (
        total + boxes.slice(index + 1).reduce((subtotal, candidate) => subtotal + overlapArea(value, candidate), 0)
      ), 0);
      const contained = (inner, outer) => Boolean(inner && outer
        && inner.left >= outer.left - ${GEOMETRY_EPSILON}
        && inner.top >= outer.top - ${GEOMETRY_EPSILON}
        && inner.right <= outer.right + ${GEOMETRY_EPSILON}
        && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
      const dock = root?.querySelector(".marking-dock");
      const stage = document.querySelector(".scripture-reading-stage");
      const dockRect = box(dock);
      const stageRect = box(stage);
      const modeRects = modes.map(box);
      const pigmentRects = pigments.map(box);
      const intentRects = window.__dockCoarseIntentRects ?? intents.map(box);
      return {
        layout: root?.getAttribute("data-dock-layout") ?? null,
        coarse: matchMedia("(pointer: coarse)").matches,
        thumbDisplay: thumb ? getComputedStyle(thumb).display : null,
        codes: pigments.map((choice) => getComputedStyle(choice.querySelector(".marking-pigment"), "::after").content.replace(/["']/g, "")),
        modeSizes: modeRects.map(({ width, height }) => ({ width, height })),
        pigmentSizes: pigmentRects.map(({ width, height }) => ({ width, height })),
        intentSizes: intentRects.map(({ width, height }) => ({ width, height })),
        contained: {
          dock: contained(dockRect, stageRect),
          modes: modeRects.every((rect) => contained(rect, dockRect)),
          pigments: pigmentRects.every((rect) => contained(rect, dockRect)),
          intents: intentRects.every((rect) => contained(rect, dockRect)),
        },
        overlap: {
          modes: pairwiseOverlap(modeRects),
          pigments: pairwiseOverlap(pigmentRects),
          intents: pairwiseOverlap(intentRects),
        },
        overflow: {
          document: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          body: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
          stage: stage ? Math.max(0, stage.scrollWidth - stage.clientWidth) : null,
          dock: dock ? Math.max(0, dock.scrollWidth - dock.clientWidth) : null,
        },
        focused: document.activeElement?.dataset.pigment ?? null,
        focusOutline: getComputedStyle(document.activeElement).outlineStyle,
        dockBorder: getComputedStyle(root.querySelector(".marking-dock")).borderStyle,
      };
    })()`);
    assert.equal(report.layout, "stacked", "forced-colors/coarse probe did not use the compact Dock");
    assert.equal(report.coarse, true, "touch emulation did not activate coarse-pointer Dock media rules");
    assert.equal(report.thumbDisplay, "none", "forced colors did not hide the visual-only thumb");
    assert.deepEqual(report.codes, FORCED_CODES, "forced colors lost A/G/S/R/V pigment codes");
    for (const [family, sizes] of Object.entries({ modes: report.modeSizes, pigments: report.pigmentSizes, intents: report.intentSizes })) {
      assert.ok(sizes.length > 0, `stacked coarse-pointer Dock lost ${family}`);
      assert.ok(sizes.every((size) => size.width >= 44 - GEOMETRY_EPSILON && size.height >= 44 - GEOMETRY_EPSILON), `${family} lost a 44px coarse target`);
    }
    assert.deepEqual(report.contained, { dock: true, modes: true, pigments: true, intents: true }, "stacked coarse-pointer controls escaped Dock/stage geometry");
    for (const [family, overlap] of Object.entries(report.overlap)) {
      assert.ok(overlap <= GEOMETRY_EPSILON, `stacked coarse-pointer ${family} overlap by ${overlap}px²`);
    }
    for (const [surface, overflow] of Object.entries(report.overflow)) {
      assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `stacked coarse-pointer ${surface} overflowed by ${overflow}px`);
    }
    assert.equal(report.focused, "blue", "forced-colors focus did not reach Sky");
    assert.notEqual(report.focusOutline, "none", "forced-colors focused command lost its outline");
    assert.notEqual(report.dockBorder, "none", "forced-colors Dock lost its material boundary");
    await driver.evaluate(`delete window.__dockCoarseIntentRects`);
    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await dismissDockSelection(driver, cdp);

    // A nominally wide viewport can still leave a compact reading stage when
    // Living Margin is present. Prove the production contract against that
    // measured stage before moving to a genuinely shelf-sized stage: pointer
    // class changes target size, never the stage-owned layout breakpoint.
    await setMedia(cdp);
    await setViewport(cdp, 860, 900);
    await ensureDockResting(driver, cdp);
    await openDockSelection(driver, FIXTURE.phrase, true);
    const constrained = await driver.evaluate(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      const stage = document.querySelector(".scripture-reading-stage");
      const dock = root?.querySelector(".marking-dock");
      const box = (element) => {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
      };
      const contained = (inner, outer) => Boolean(inner && outer
        && inner.left >= outer.left - ${GEOMETRY_EPSILON}
        && inner.top >= outer.top - ${GEOMETRY_EPSILON}
        && inner.right <= outer.right + ${GEOMETRY_EPSILON}
        && inner.bottom <= outer.bottom + ${GEOMETRY_EPSILON});
      const stageRect = box(stage);
      const dockRect = box(dock);
      return {
        layout: root?.getAttribute("data-dock-layout") ?? null,
        expectedLayout: stageRect && stageRect.width <= 759 ? "stacked" : "shelf",
        coarse: matchMedia("(pointer: coarse)").matches,
        stageWidth: stageRect?.width ?? null,
        dockWidth: dockRect?.width ?? null,
        dockContained: contained(dockRect, stageRect),
        overflow: {
          document: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          body: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
          stage: stage ? Math.max(0, stage.scrollWidth - stage.clientWidth) : null,
          dock: dock ? Math.max(0, dock.scrollWidth - dock.clientWidth) : null,
        },
      };
    })()`);
    assert.equal(constrained.coarse, true, "wide constrained-stage probe lost coarse-pointer media");
    assert.equal(constrained.layout, constrained.expectedLayout, "coarse-pointer Dock ignored its measured constrained stage");
    assert.ok(constrained.stageWidth >= 300, `coarse-pointer constrained reader collapsed to ${constrained.stageWidth}px`);
    assert.ok(constrained.dockWidth >= 300, `coarse-pointer constrained Dock collapsed to ${constrained.dockWidth}px`);
    assert.equal(constrained.dockContained, true, "coarse-pointer constrained Dock escaped its reading stage");
    for (const [surface, overflow] of Object.entries(constrained.overflow)) {
      assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `coarse-pointer constrained ${surface} overflowed by ${overflow}px`);
    }
    await dismissDockSelection(driver, cdp);

    // Coarse-pointer geometry must also remain legal in a stage that is
    // actually wider than the shelf threshold. This catches 44px minimum
    // targets being poured into stale 38px grid tracks without confusing
    // viewport width with the reader's available width.
    await setViewport(cdp, 1280, 900);
    await driver.waitFor(`(() => {
      const stage = document.querySelector(".scripture-reading-stage");
      const root = document.querySelector('[data-marking-surface="dock"]');
      return stage?.getBoundingClientRect().width > 759
        && root?.getAttribute("data-dock-layout") === "shelf";
    })()`);
    await ensureDockResting(driver, cdp);
    await openDockSelection(driver, FIXTURE.phrase, true);
    await driver.evaluate(`(() => {
      window.__dockShelfIntentRects = [...document.querySelectorAll("[data-dock-intent]")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
    })()`);
    await clickDockIntent(driver, cdp, "connect");
    await driver.waitFor(`Boolean(document.querySelector('[data-dock-context="connect"]'))`);
    await settle(driver);
    const shelf = await driver.evaluate(`(() => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      const dock = root?.querySelector(".marking-dock");
      const stage = document.querySelector(".scripture-reading-stage");
      const group = root?.querySelector(".marking-dock-modes");
      const thumb = root?.querySelector(".marking-dock-thumb");
      const active = root?.querySelector('[data-dock-tool="connect"]');
      const modes = [...(root?.querySelectorAll("[data-dock-tool]") ?? [])];
      const choices = [...(root?.querySelectorAll("[data-relationship-kind]") ?? [])];
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
      const overlapArea = (left, right) => {
        if (!left || !right) return 0;
        return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
          * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      };
      const pairwiseOverlap = (elements) => {
        const boxes = elements.map(rect);
        return boxes.reduce((total, box, index) => (
          total + boxes.slice(index + 1).reduce((subtotal, candidate) => subtotal + overlapArea(box, candidate), 0)
        ), 0);
      };
      const dockRect = rect(dock);
      const stageRect = rect(stage);
      const groupRect = rect(group);
      const activeRect = rect(active);
      const thumbRect = rect(thumb);
      const intentRects = window.__dockShelfIntentRects ?? [];
      return {
        layout: root?.getAttribute("data-dock-layout") ?? null,
        state: root?.getAttribute("data-dock-state") ?? null,
        coarse: matchMedia("(pointer: coarse)").matches,
        stageWidth: stageRect?.width ?? null,
        dockWidth: dockRect?.width ?? null,
        dockContained: contained(dockRect, stageRect),
        bottomInset: dockRect && stageRect ? stageRect.bottom - dockRect.bottom : null,
        modeSizes: modes.map((mode) => ({ width: rect(mode).width, height: rect(mode).height })),
        choiceSizes: choices.map((choice) => ({ width: rect(choice).width, height: rect(choice).height })),
        intentSizes: intentRects.map(({ width, height }) => ({ width, height })),
        modesContained: modes.every((mode) => contained(rect(mode), groupRect)),
        intentsContained: intentRects.every((intent) => contained(intent, dockRect)),
        modeOverlap: pairwiseOverlap(modes),
        choiceOverlap: pairwiseOverlap(choices),
        intentOverlap: intentRects.reduce((total, value, index) => (
          total + intentRects.slice(index + 1).reduce((subtotal, candidate) => subtotal + overlapArea(value, candidate), 0)
        ), 0),
        thumbDelta: activeRect && thumbRect ? {
          left: Math.abs(activeRect.left - thumbRect.left),
          width: Math.abs(activeRect.width - thumbRect.width),
          top: Math.abs(activeRect.top - thumbRect.top),
          height: Math.abs(activeRect.height - thumbRect.height),
        } : null,
        overflow: {
          document: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          body: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
          stage: stage ? Math.max(0, stage.scrollWidth - stage.clientWidth) : null,
          dock: dock ? Math.max(0, dock.scrollWidth - dock.clientWidth) : null,
        },
      };
    })()`);
    assert.equal(shelf.layout, "shelf", "coarse-pointer wide cell did not use the Dock shelf");
    assert.equal(shelf.state, "choices", "coarse-pointer shelf lost its Connect center");
    assert.equal(shelf.coarse, true, "coarse-pointer shelf media query did not match");
    assert.ok(shelf.stageWidth > 759, `coarse-pointer shelf probe only measured a ${shelf.stageWidth}px stage`);
    assert.ok(shelf.stageWidth >= 300 && shelf.dockWidth >= 300, "coarse-pointer shelf collapsed reader or Dock geometry");
    assert.equal(shelf.dockContained, true, "coarse-pointer shelf escaped the reading stage");
    assert.ok(Math.abs(shelf.bottomInset - 14) <= GEOMETRY_EPSILON, `coarse-pointer shelf bottom inset drifted to ${shelf.bottomInset}px`);
    for (const [family, sizes] of Object.entries({ modes: shelf.modeSizes, choices: shelf.choiceSizes, intents: shelf.intentSizes })) {
      assert.ok(sizes.length > 0, `coarse-pointer shelf lost ${family}`);
      assert.ok(sizes.every((size) => size.width >= 44 - GEOMETRY_EPSILON && size.height >= 44 - GEOMETRY_EPSILON), `coarse-pointer shelf ${family} lost a 44px target`);
    }
    assert.equal(shelf.modesContained, true, "coarse-pointer shelf mode escaped its measured group");
    assert.equal(shelf.intentsContained, true, "coarse-pointer shelf intent escaped its Dock shell");
    assert.ok(shelf.modeOverlap <= GEOMETRY_EPSILON, `coarse-pointer shelf modes overlap by ${shelf.modeOverlap}px²`);
    assert.ok(shelf.choiceOverlap <= GEOMETRY_EPSILON, `coarse-pointer shelf choices overlap by ${shelf.choiceOverlap}px²`);
    assert.ok(shelf.intentOverlap <= GEOMETRY_EPSILON, `coarse-pointer shelf intents overlap by ${shelf.intentOverlap}px²`);
    assert.ok(shelf.thumbDelta, "coarse-pointer shelf lost measured Connect/thumb geometry");
    for (const [dimension, delta] of Object.entries(shelf.thumbDelta)) {
      assert.ok(delta <= GEOMETRY_EPSILON, `coarse-pointer shelf thumb ${dimension} missed Connect by ${delta}px`);
    }
    for (const [surface, overflow] of Object.entries(shelf.overflow)) {
      assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `coarse-pointer shelf ${surface} overflowed by ${overflow}px`);
    }
    await driver.evaluate(`delete window.__dockShelfIntentRects`);
    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await dismissDockSelection(driver, cdp);

    // Session commands are part of the same coarse target contract. Exercise
    // both ordinary Done and terminal Retry at the narrow stacked breakpoint.
    await setViewport(cdp, 390, 900);
    await ensureDockResting(driver, cdp);
    const beforeSession = await rangeCounts(driver);
    await openDockSelection(driver, FIXTURE.phrase, true);
    await clickDockIntent(driver, cdp, "connect");
    await pointerClick(driver, cdp, '[data-dock-context="connect"] [data-relationship-kind="series"]', "Dock coarse Series subtype");
    await driver.waitFor(`Boolean(document.querySelector("[data-authoring-draft]"))`);
    assert.equal(await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart)), FIXTURE.counterpart.quote, "coarse session counterpart drifted");
    await driver.waitFor(`document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Done"`);
    assertCoarseSessionActions(await dockSessionActionGeometry(driver), ["Done", "Cancel"]);
    const beforeFailedSessionLog = logFingerprint(connectionsLog);
    await withWriteBlocked(connectionsLog, async () => {
      await pointerClick(driver, cdp, ".marking-session-action.primary", "Dock coarse blocked Done action");
      await driver.waitFor(`document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Retry"`);
      assertCoarseSessionActions(await dockSessionActionGeometry(driver), ["Retry", "Recovery required"]);
      assert.deepEqual(logFingerprint(connectionsLog), beforeFailedSessionLog, "coarse blocked Done changed append-log bytes");
      assert.deepEqual(await rangeCounts(driver), beforeSession, "coarse blocked Done wrote a connection");
    });
    await pointerClick(driver, cdp, ".marking-session-action.primary", "Dock coarse exact-command Retry action");
    await driver.waitFor(`(async () => {
      const root = document.querySelector('[data-marking-surface="dock"]');
      const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
      return result.connections.length === ${beforeSession.connections + 1}
        && !document.querySelector(".marking-session")
        && !document.querySelector("[data-authoring-draft]")
        && root?.getAttribute("data-dock-state") === "armed"
        && root.getAttribute("data-tool-armed") === "connect:series";
    })()`);
    const afterRetrySessionLog = logFingerprint(connectionsLog);
    assert.equal(afterRetrySessionLog.lines, beforeFailedSessionLog.lines + 1, "coarse exact Retry did not append one connection event");
    assert.ok(afterRetrySessionLog.bytes > beforeFailedSessionLog.bytes, "coarse exact Retry did not grow the append log");
    assert.notEqual(afterRetrySessionLog.sha256, beforeFailedSessionLog.sha256, "coarse exact Retry left the append-log digest unchanged");
    await putDownDockTool(driver, cdp);
    await ensureDockResting(driver, cdp);
    assert.deepEqual(
      await rangeCounts(driver),
      { ...beforeSession, connections: beforeSession.connections + 1 },
      "coarse exact Retry did not resolve to exactly one authored connection",
    );
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
    await setMedia(cdp);
  }
}

async function assertNoMotionReplay(driver, cdp) {
  await setMedia(cdp);
  await setViewport(cdp, 1280, 900);
  await setTheme(driver, "light");
  await ensureDockResting(driver, cdp);
  await driver.waitFor(`(() => {
    const stage = document.querySelector(".scripture-reading-stage");
    const root = document.querySelector('[data-marking-surface="dock"]');
    return stage?.getBoundingClientRect().width > 759
      && root?.getAttribute("data-dock-layout") === "shelf";
  })()`);
  await settle(driver);
  const initialStarts = await driver.evaluate(`window.__dockEntranceStarts ?? -1`);
  assert.equal(initialStarts, 1, "fresh Dock did not play exactly one restrained entrance");
  await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="dock"]');
    const dock = root?.querySelector(".marking-dock");
    window.__dockStableRoot = root;
    window.__dockStableShell = dock;
    window.__dockShellAdds = 0;
    window.__dockReplayStarts = 0;
    window.__dockReplayListener = (event) => {
      if (event.animationName === "marking-dock-in") window.__dockReplayStarts += 1;
    };
    document.addEventListener("animationstart", window.__dockReplayListener, true);
    window.__dockReplayObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".marking-dock")) window.__dockShellAdds += 1;
        window.__dockShellAdds += node.querySelectorAll(".marking-dock").length;
      }
    });
    window.__dockReplayObserver.observe(document.body, { childList: true, subtree: true });
  })()`);

  await setViewport(cdp, 1400, 900);
  await driver.waitFor(`(() => {
    const stage = document.querySelector(".scripture-reading-stage");
    const root = document.querySelector('[data-marking-surface="dock"]');
    return stage?.getBoundingClientRect().width > 759
      && root?.getAttribute("data-dock-layout") === "shelf";
  })()`);
  await settle(driver);
  await setViewport(cdp, 640, 900);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-layout") === "stacked"`);
  await settle(driver);
  await setViewport(cdp, 1280, 900);
  await driver.waitFor(`(() => {
    const stage = document.querySelector(".scripture-reading-stage");
    const root = document.querySelector('[data-marking-surface="dock"]');
    return stage?.getBoundingClientRect().width > 759
      && root?.getAttribute("data-dock-layout") === "shelf";
  })()`);
  await setTheme(driver, "dark");
  await settle(driver);
  const report = await driver.evaluate(`(() => {
    window.__dockReplayObserver?.disconnect();
    document.removeEventListener("animationstart", window.__dockReplayListener, true);
    const root = document.querySelector('[data-marking-surface="dock"]');
    const dock = root?.querySelector(".marking-dock");
    const result = {
      sameRoot: root === window.__dockStableRoot,
      sameShell: dock === window.__dockStableShell,
      additions: window.__dockShellAdds,
      starts: window.__dockReplayStarts,
      running: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="dock"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
      layout: root?.getAttribute("data-dock-layout") ?? null,
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
    };
    delete window.__dockStableRoot;
    delete window.__dockStableShell;
    delete window.__dockShellAdds;
    delete window.__dockReplayStarts;
    delete window.__dockReplayListener;
    delete window.__dockReplayObserver;
    return result;
  })()`);
  assert.deepEqual(report, {
    sameRoot: true,
    sameShell: true,
    additions: 0,
    starts: 0,
    running: 0,
    layout: "shelf",
    theme: "dark",
  }, "Dock remounted or replayed entrance motion across resize, breakpoint, or theme changes");
  await setTheme(driver, "light");
}

async function collectRendererMemory(cdp) {
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const domResponse = await cdp.send("Memory.getDOMCounters");
  const heapResponse = await cdp.send("Runtime.getHeapUsage");
  const dom = domResponse.result;
  const usedHeap = heapResponse.result?.usedSize;
  assert.ok(dom && Number.isFinite(dom.documents) && Number.isFinite(dom.nodes) && Number.isFinite(dom.jsEventListeners), "CDP returned invalid Dock DOM memory counters");
  assert.ok(Number.isFinite(usedHeap), "CDP returned an invalid Dock renderer heap size");
  return { dom, usedHeap };
}

async function dismissAllToasts(driver) {
  await driver.evaluate(`(() => {
    document.querySelectorAll(".toast-close").forEach((button) => button.click());
  })()`);
  await driver.waitFor(`!document.querySelector(".toast")`);
  await settle(driver, true);
}

async function runDockStressBatch(driver, cycles) {
  // This is a resource-only lifecycle loop, not interaction evidence. The
  // behavioral probes above use real CDP pointer presses/releases; DOM
  // activation here keeps 60 mount/state cycles deterministic and fast.
  return driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(FIXTURE.stressPhrase)};
    const frame = () => new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    const waitUntil = async (predicate, message) => {
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (predicate()) return;
        await frame();
      }
      throw new Error(message);
    };
    const select = async () => {
      const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
      const span = row?.querySelector(".verse-text-span");
      const container = document.querySelector(".verse-text");
      if (!row || !span || !container) throw new Error("Dock stress fixture missing");
      const text = span.textContent ?? "";
      const startOffset = text.indexOf(spec.quote);
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
      if (startOffset < 0 || !start || !end) throw new Error("Dock stress phrase absent");
      span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    };
    const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", bubbles: true, cancelable: true,
    }));
    for (let cycle = 0; cycle < ${cycles}; cycle += 1) {
      const path = cycle % 5;
      if (path === 0 || path === 4) {
        await select();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "selection",
          "Dock stress selection context did not mount",
        );
      }
      if (path === 0) {
        escape();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "rest",
          "Dock stress selection did not dismiss",
        );
      } else if (path === 1 || path === 2) {
        const mode = path === 1 ? "wash" : "connect";
        document.querySelector('[data-dock-tool="' + mode + '"]')?.click();
        await waitUntil(
          () => Boolean(document.querySelector('[data-dock-context="' + mode + '"]')),
          "Dock stress vocabulary did not mount: " + mode,
        );
        escape();
        await waitUntil(
          () => !document.querySelector('[data-dock-context="' + mode + '"]')
            && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-mode") === "read",
          "Dock stress vocabulary did not close: " + mode,
        );
      } else if (path === 3) {
        document.querySelector('[data-dock-tool="wash"]')?.click();
        await waitUntil(() => Boolean(document.querySelector('[data-dock-context="wash"]')), "Dock stress wash did not mount");
        document.querySelector('[data-dock-context="wash"] [data-pigment="blue"]')?.click();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "wash:blue",
          "Dock stress Sky did not arm",
        );
        document.querySelector('[data-dock-tool="read"]')?.click();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "false"
            && document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-state") === "rest",
          "Dock stress Sky did not clear",
        );
      } else {
        document.querySelector('[data-dock-intent="connect"]')?.click();
        await waitUntil(() => Boolean(document.querySelector('[data-dock-context="connect"]')), "Dock stress Connect intent did not open");
        document.querySelector('[data-dock-context="connect"] [data-relationship-kind="series"]')?.click();
        await waitUntil(() => Boolean(document.querySelector("[data-authoring-draft]")), "Dock stress authoring draft did not mount");
        escape();
        await waitUntil(
          () => !document.querySelector("[data-authoring-draft]") && !document.querySelector(".marking-session"),
          "Dock stress authoring draft did not cancel",
        );
        escape();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-tool-armed") === "false",
          "Dock stress carried connection did not clear",
        );
      }
      await frame();
      await frame();
    }
    getSelection()?.removeAllRanges();
    await frame();
    await frame();
    const settlingAnimations = document.getAnimations({ subtree: true }).filter((animation) => {
      const target = animation.effect?.target;
      return target instanceof Element
        && Boolean(target.closest('[data-marking-surface="dock"]'))
        && (animation.playState === "running" || animation.playState === "pending");
    });
    await Promise.all(settlingAnimations.map((animation) => animation.finished.catch(() => undefined)));
    await frame();
    const root = document.querySelector('[data-marking-surface="dock"]');
    return {
      hosts: document.querySelectorAll('[data-marking-surface="dock"]').length,
      docks: root?.querySelectorAll(".marking-dock").length ?? 0,
      margins: document.querySelectorAll(".living-margin").length,
      modes: root?.querySelectorAll("[data-dock-tool]").length ?? 0,
      choices: root?.querySelectorAll("[data-relationship-kind], [data-pigment]").length ?? 0,
      intents: root?.querySelectorAll("[data-dock-intent]").length ?? 0,
      sessions: root?.querySelectorAll(".marking-session").length ?? 0,
      drafts: document.querySelectorAll("[data-authoring-draft]").length,
      state: root?.getAttribute("data-dock-state") ?? null,
      mode: root?.getAttribute("data-dock-mode") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      activeMarkingAnimations: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="dock"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);
}

async function assertWarmPlateau(driver, cdp) {
  // Keep this resource-only probe scoped to the reading canvas and Dock.
  // Living Margin owns an independent async Study loader; allowing that tree
  // to resolve between heap snapshots would masquerade as retained Dock DOM.
  await driver.evaluate(`(() => {
    const marginToggle = document.querySelector("[data-instrument=margin]");
    if (marginToggle?.getAttribute("aria-pressed") === "true") marginToggle.click();
    return true;
  })()`);
  await driver.waitFor(`document.querySelector("[data-instrument=margin]")?.getAttribute("aria-pressed") === "false"
    && !document.querySelector(".living-margin")`);
  await setViewport(cdp, 1280, 900);
  await ensureDockResting(driver, cdp);
  await driver.waitFor(`(() => {
    const stage = document.querySelector(".scripture-reading-stage");
    const root = document.querySelector('[data-marking-surface="dock"]');
    return stage?.getBoundingClientRect().width > 759
      && root?.getAttribute("data-dock-layout") === "shelf";
  })()`);
  await dismissAllToasts(driver);
  const expected = {
    hosts: 1,
    docks: 1,
    margins: 0,
    modes: 5,
    choices: 0,
    intents: 0,
    sessions: 0,
    drafts: 0,
    state: "rest",
    mode: "read",
    armed: "false",
    activeMarkingAnimations: 0,
  };
  const authoredBefore = await rangeCounts(driver);
  const firstBatch = await runDockStressBatch(driver, STRESS_CYCLES);
  await settle(driver);
  const firstMemory = await collectRendererMemory(cdp);
  await setViewport(cdp, 390, 900);
  await ensureDockResting(driver, cdp);
  await driver.waitFor(`document.querySelector('[data-marking-surface="dock"]')?.getAttribute("data-dock-layout") === "stacked"`);
  const secondBatch = await runDockStressBatch(driver, STRESS_CYCLES);
  await settle(driver);
  const secondMemory = await collectRendererMemory(cdp);
  assert.deepEqual(firstBatch, expected, "first warm Dock batch retained transient state");
  assert.deepEqual(secondBatch, expected, "second warm Dock batch retained transient state");
  assert.deepEqual(await rangeCounts(driver), authoredBefore, "warm Dock lifecycle stress mutated authored records");
  assert.equal(secondMemory.dom.documents, firstMemory.dom.documents, "Dock cycles retained a DOM document");
  assert.equal(secondMemory.dom.nodes, firstMemory.dom.nodes, "Dock cycles retained DOM nodes");
  assert.equal(secondMemory.dom.jsEventListeners, firstMemory.dom.jsEventListeners, "Dock cycles retained event listeners");
  const heapGrowth = secondMemory.usedHeap - firstMemory.usedHeap;
  assert.ok(heapGrowth <= MAX_WARM_HEAP_GROWTH, `second Dock batch retained ${heapGrowth} heap bytes`);
  return { heapGrowth, dom: secondMemory.dom };
}

function failureClassification(error, context, childState) {
  if (error?.code === "ELECTRON_RENDERER_BOOTSTRAP_FAILED") return "renderer-bootstrap-failure";
  if (error?.code === "ELECTRON_LAUNCH_BLOCKED" || context.phase === "launch") return "electron-launch-blocked";
  if (childState.exited) return "renderer-runtime-exit";
  return "dock-contract-failure";
}

async function captureFailure(cdp, driver, error, context, childLog, childState) {
  mkdirSync(FAILURE_DIR, { recursive: true });
  const screenshotPath = FAILURE_SCREENSHOT_PATH;
  const statePath = FAILURE_STATE_PATH;
  let screenshotError = null;
  if (cdp) {
    try {
      const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(screenshotPath, Buffer.from(response.result.data, "base64"));
    } catch (captureError) {
      screenshotError = String(captureError);
    }
  }
  let renderer = null;
  if (driver) {
    try {
      renderer = await driver.evaluate(`(async () => {
        let authored = null;
        try {
          const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
          authored = {
            highlights: result.highlights.filter((record) => record.deleted === 0).length,
            connections: result.connections.length,
            notes: result.notes.length,
          };
        } catch (error) {
          authored = { error: String(error) };
        }
        const root = document.querySelector('[data-marking-surface="dock"]');
        const box = (element) => element?.getBoundingClientRect().toJSON?.() ?? null;
        return {
          url: location.href,
          viewport: { width: innerWidth, height: innerHeight },
          theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
          layout: root?.getAttribute("data-dock-layout") ?? null,
          state: root?.getAttribute("data-dock-state") ?? null,
          mode: root?.getAttribute("data-dock-mode") ?? null,
          armed: root?.getAttribute("data-tool-armed") ?? null,
          dock: root?.outerHTML?.slice(0, 22_000) ?? null,
          draft: document.querySelector("[data-authoring-draft]")?.outerHTML?.slice(0, 6_000) ?? null,
          geometry: {
            stage: box(document.querySelector(".scripture-reading-stage")),
            dock: box(root?.querySelector(".marking-dock")),
            modes: box(root?.querySelector(".marking-dock-modes")),
            thumb: box(root?.querySelector(".marking-dock-thumb")),
          },
          activeElement: document.activeElement?.outerHTML?.slice(0, 2_000) ?? null,
          animations: document.getAnimations({ subtree: true }).map((animation) => ({
            state: animation.playState,
            target: animation.effect?.target instanceof Element ? animation.effect.target.className : null,
          })).slice(0, 80),
          authored,
        };
      })()`);
    } catch (stateError) {
      renderer = { stateError: String(stateError) };
    }
  }
  const classification = failureClassification(error, context, childState);
  writeFileSync(statePath, `${JSON.stringify({
    classification,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack, code: error.code, launchState: error.launchState }
      : String(error),
    context,
    childState,
    screenshotError,
    renderer,
    childLog,
  }, null, 2)}\n`);
  console.error(`Dock failure classification: ${classification}`);
  console.error(`Dock failure artifacts: ${screenshotPath}, ${statePath}`);
}

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
  await setViewport(cdp, 1280, 900);

  const fixtureReady = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const fixtures = ${JSON.stringify([FIXTURE.phrase, FIXTURE.counterpart, FIXTURE.stressPhrase])};
    for (const fixture of fixtures) {
      if (!text(fixture.verse).includes(fixture.quote)) throw new Error("Dock fixture quote is absent: " + fixture.quote);
    }
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
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
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="dock"] .marking-dock'))`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === "light"`);
  await driver.waitFor(`!document.querySelector(".living-margin")`);
  await driver.waitFor(`document.querySelector(".marking-dock-modes")?.getAttribute("data-thumb-ready") === "true"`);
  await driver.waitFor(`Number.isInteger(window.__dockEntranceStarts)`);
  await setMedia(cdp);
  await settle(driver);
  assert.deepEqual(await rangeCounts(driver), { highlights: 0, connections: 0, notes: 0 }, "isolated Dock library was not empty");
  failureContext = { phase: "renderer-ready" };

  if (process.env.DOCK_QA_AUTHORING_DIAGNOSTIC === "1") {
    failureContext = { phase: "authoring-selection-diagnostic" };
    await setViewport(cdp, 860, 900);
    await setTheme(driver, "light");
    await assertAuthoringDraft(driver, cdp, connectionsLog);
    console.log("PASS Dock raw-selection to authoring diagnostic");
  } else if (process.env.DOCK_QA_COMPACT_DIAGNOSTIC === "1") {
    failureContext = { phase: "compact-selected-diagnostic" };
    await setViewport(cdp, 390, 900);
    await setTheme(driver, "light");
    await assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames);
    console.log("PASS compact selected-connection diagnostic");
  } else {
  const reports = [];
  for (const theme of THEMES) {
    await setViewport(cdp, 1280, 900);
    await setTheme(driver, theme);
    for (const viewport of VIEWPORTS) {
      failureContext = { phase: "matrix", theme, viewport };
      await setViewport(cdp, viewport.width, viewport.height);
      await ensureDockResting(driver, cdp);
      await openDockSelection(driver);
      const report = await driver.evaluate(dockMatrixReportExpression());
      assertDockMatrixReport(report, theme, viewport);
      await assertVocabulariesInCell(driver, cdp, theme, viewport);
      reports.push({ theme, ...viewport, layout: report.layout, stage: report.stageRect });
      console.log(
        `${THEME_LABELS.get(theme).padEnd(11)} ${viewport.label.padStart(8)}  `
        + `${report.layout.padEnd(7)}  5 radio modes + 6 connect + 5 wash  measured thumb  overflow 0`,
      );
      await dismissDockSelection(driver, cdp);
    }
  }
  const expectedMatrixKeys = THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => `${theme}:${viewport.label}`));
  const actualMatrixKeys = reports.map((report) => `${report.theme}:${report.label}`);
  assert.equal(reports.length, THEMES.length * VIEWPORTS.length, "Dock matrix did not execute every declared cell");
  assert.deepEqual(actualMatrixKeys, expectedMatrixKeys, "Dock matrix executed the wrong theme/viewport keys");

  failureContext = { phase: "aesthetic-proofs" };
  await captureShelfAestheticProofs(driver, cdp, successFrames);

  failureContext = { phase: "keyboard-stale-switch" };
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await assertKeyboardAndStaleToolSwitch(driver, cdp);

  failureContext = { phase: "mutation-retry" };
  const delayedRace = await assertMutationAndRetryFlows(driver, cdp, highlightsLog, successFrames);

  failureContext = { phase: "authoring-draft" };
  await assertAuthoringDraft(driver, cdp, connectionsLog);

  failureContext = { phase: "reduced-motion" };
  await assertReducedMotion(driver, cdp);

  failureContext = { phase: "forced-colors-coarse" };
  await assertForcedColorsAndCoarseTargets(driver, cdp, connectionsLog);

  failureContext = { phase: "motion-replay" };
  await assertNoMotionReplay(driver, cdp);

  failureContext = { phase: "warm-plateau" };
  await setViewport(cdp, 1280, 900);
  await setTheme(driver, "light");
  const plateau = await assertWarmPlateau(driver, cdp);

  failureContext = { phase: "completed-connection" };
  await assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames);

  failureContext = { phase: "connection-cardinality-persistence" };
  await assertConnectionCardinalityPersistence(driver, cdp, connectionsLog);
  gatePassed = true;

  console.log("PASS Dock keyboard: one five-mode radio path, grouped choice browsing, Escape focus return, stale-tool switching");
  console.log(delayedRace.exercised
    ? "PASS Dock nonce race: delayed A released into focused B selection intent with one A event"
    : `LIMIT Dock nonce race: ${delayedRace.reason}; frozen-preload fallback retained nonce/fingerprint proofs`);
  console.log("PASS Dock mutations: real-pointer Highlight/Note/Remove, byte-identical blocked logs, nonce isolation, pointer/Enter Retry");
  console.log("PASS Dock paint: exact authoring emphasis with 0 draft route/underline/contact/hit/tick");
  console.log("PASS Dock connection: durable two-phrase Series, zero dormant lines, one selected bracket, Living Margin card, quiet release");
  console.log("PASS Dock media: reduced motion terminal, forced colors A/G/S/R/V, visible focus, 44px coarse targets");
  console.log("PASS Dock motion: one entrance, same nodes and no replay after same-layout, breakpoint, or theme changes");
  console.log(`PASS Dock warm plateau: ${STRESS_CYCLES * 2} mixed shelf/stacked cycles, stable DOM/listeners, heap delta ${plateau.heapGrowth} bytes`);
  console.log(`PASS marking Dock: ${reports.length}/20 theme-viewport cells`);
  }
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
