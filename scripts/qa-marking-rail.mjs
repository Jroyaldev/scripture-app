/**
 * Permanent visual/interaction gate for the production Pen Rail.
 *
 * Runs the real Electron renderer against an isolated profile and library.
 * The 20-cell matrix proves that Rail geometry is derived from its own reading
 * stage. Focused probes cover its two vocabularies, toolbar and tray keyboard
 * ownership, authoring-only phrase emphasis, media fallbacks, motion stability,
 * and warm resource behavior. User data is never touched.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";

const THEMES = ["light", "dark", "glass", "dark-glass"];
const THEME_LABELS = new Map([
  ["light", "Paper"],
  ["dark", "Ink"],
  ["glass", "Glass"],
  ["dark-glass", "Candlelight"],
]);
const VIEWPORTS = [
  { width: 390, height: 900, label: "390x900" },
  { width: 640, height: 900, label: "640x900" },
  { width: 860, height: 900, label: "860x900" },
  { width: 1280, height: 900, label: "1280x900" },
  { width: 860, height: 420, label: "860x420" },
];
const TOOL_IDS = ["wash", "connect", "note", "erase"];
const TOOL_LABELS = ["Highlight", "Connect", "Note", "Erase"];
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
  book: "ACT",
  chapter: 19,
  displayBook: "Acts",
  phrase: { verse: 8, quote: "the kingdom of God" },
  counterpart: { verse: 9, quote: "the Way" },
  stressPhrase: { verse: 7, quote: "about twelve" },
};
const GEOMETRY_EPSILON = 0.75;
const STRESS_CYCLES = 30;
const MAX_WARM_HEAP_GROWTH = 1024 * 1024;
const FAILURE_DIR = resolve("output/playwright");
const FAILURE_SCREENSHOT_PATH = join(FAILURE_DIR, "marking-rail-failure.png");
const FAILURE_STATE_PATH = join(FAILURE_DIR, "marking-rail-failure.json");
const SUCCESS_PROOF_PREFIX = "marking-rail-proof-";
const CONNECTION_RETRY_ONLY = process.argv.includes("--connection-retry-only");
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out opening the Rail QA CDP socket"));
    }, 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Rail QA CDP socket failed during connection"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      reject(new Error("Rail QA CDP socket closed during connection"));
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
  ws.onclose = () => rejectPending(new Error("CDP socket closed while a Rail QA command was pending"));
  ws.onerror = () => rejectPending(new Error("CDP socket failed while a Rail QA command was pending"));
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
    if (childState.spawnError) {
      throw launchError(`Electron could not be spawned: ${childState.spawnError}`, childState);
    }
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

  const waitFor = async (expression, timeout = 10_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(80);
    }
    throw new Error(`Timed out waiting for ${expression}`);
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
  await driver.evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
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
  await sleep(reduced ? 30 : 240);
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
  for (const name of readdirSync(FAILURE_DIR)) {
    if (name.startsWith(SUCCESS_PROOF_PREFIX) && name.endsWith(".png")) {
      rmSync(join(FAILURE_DIR, name), { force: true });
    }
  }
  for (const frame of frames) writeFileSync(join(FAILURE_DIR, frame.name), frame.bytes);
}

function selectPhraseExpression(spec) {
  return `(async () => {
    const spec = ${JSON.stringify(spec)};
    const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
    const span = row?.querySelector(".verse-text-span");
    const container = document.querySelector(".verse-text");
    if (!row || !span || !container) throw new Error("missing phrase fixture verse " + spec.verse);
    const text = span.textContent ?? "";
    const startOffset = text.indexOf(spec.quote);
    if (startOffset < 0) throw new Error("fixture phrase is absent: " + spec.quote);
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
    if (!start || !end) throw new Error("could not locate phrase offsets");
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
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

async function ensureRailResting(driver, cdp) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const resting = await driver.evaluate(`(() => {
      const root = document.querySelector('[data-marking-surface="rail"]');
      return Boolean(root
        && root.getAttribute("data-tool-armed") === "false"
        && !root.querySelector(".marking-rail-tray")
        && !root.querySelector(".marking-rail-status"));
    })()`);
    if (resting) return;
    await pressKey(cdp, "Escape", "Escape", 0, 27);
    await settle(driver, true);
  }
  assert.fail("Pen Rail did not return to its resting state");
}

async function openSelectionIntent(driver, spec = FIXTURE.phrase, reduced = false) {
  await driver.evaluate(`(() => {
    window.__railFocusTrace = [];
    if (window.__railFocusTraceInstalled) return;
    window.__railFocusTraceInstalled = true;
    document.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const intents = [...document.querySelectorAll(".marking-rail-intents .marking-intent")];
      const entry = target.matches(".marking-intent")
        ? "intent:" + intents.indexOf(target)
        : target.hasAttribute("data-rail-tool")
          ? "tool:" + target.getAttribute("data-rail-tool")
          : target.matches(".verse-line")
            ? "verse:" + target.getAttribute("data-verse")
            : target.className
              ? "class:" + String(target.className).split(/\\s+/).slice(0, 2).join(".")
              : target.tagName.toLowerCase();
      window.__railFocusTrace.push(entry);
      if (window.__railFocusTrace.length > 24) window.__railFocusTrace.shift();
    }, true);
  })()`);
  const selected = await driver.evaluate(selectPhraseExpression(spec));
  assert.equal(selected, spec.quote, `native selection drifted for ${spec.quote}`);
  await driver.waitFor(`(() => {
    const tray = document.querySelector('[data-marking-surface="rail"] .marking-rail-tray[data-rail-tray-mode="intent"]');
    return Boolean(tray && getComputedStyle(tray).visibility === "visible" && tray.getBoundingClientRect().width > 0);
  })()`);
  await settle(driver, reduced);
}

async function dismissSelection(driver, cdp) {
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="rail"] .marking-rail-tray')`);
  await settle(driver, true);
}

async function captureRailAestheticProofs(driver, cdp, frames) {
  await setMedia(cdp);
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await ensureRailResting(driver, cdp);
  await driver.evaluate(`(() => {
    getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-rail-proof-paper-rest.png");

  await openSelectionIntent(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-rail-proof-paper-open.png");
  await dismissSelection(driver, cdp);

  await setTheme(driver, "dark");
  await driver.evaluate(`getSelection()?.removeAllRanges()`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-rail-proof-ink-rest.png");

  await openSelectionIntent(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-rail-proof-ink-open.png");
  await dismissSelection(driver, cdp);
  await setTheme(driver, "light");
}

function railMatrixReportExpression() {
  return `(() => {
    const root = document.querySelector('[data-marking-surface="rail"]');
    const rail = root?.querySelector(".marking-rail");
    const tray = root?.querySelector(".marking-rail-tray");
    const stage = document.querySelector(".scripture-reading-stage");
    const tools = [...(rail?.querySelectorAll("[data-rail-tool]") ?? [])];
    const intents = [...(tray?.querySelectorAll(".marking-rail-intents .marking-intent") ?? [])];
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
    const railRect = rect(rail);
    const trayRect = rect(tray);
    const nativeSelection = getSelection();
    const nativeRangeRect = nativeSelection && nativeSelection.rangeCount > 0
      ? nativeSelection.getRangeAt(0).getBoundingClientRect()
      : null;
    const selectionRect = nativeRangeRect && nativeRangeRect.width > 0 && nativeRangeRect.height > 0
      ? { left: nativeRangeRect.left, top: nativeRangeRect.top, right: nativeRangeRect.right, bottom: nativeRangeRect.bottom, width: nativeRangeRect.width, height: nativeRangeRect.height }
      : null;
    const selectionGap = 12;
    const expandedSelection = selectionRect ? {
      left: selectionRect.left - selectionGap,
      top: selectionRect.top - selectionGap,
      right: selectionRect.right + selectionGap,
      bottom: selectionRect.bottom + selectionGap,
    } : null;
    const traySelectionOverlap = Boolean(trayRect && expandedSelection
      && trayRect.left < expandedSelection.right
      && trayRect.right > expandedSelection.left
      && trayRect.top < expandedSelection.bottom
      && trayRect.bottom > expandedSelection.top);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      layout: root?.getAttribute("data-rail-layout") ?? null,
      expectedLayout: stageRect && (stageRect.width < 600 || stageRect.height < 520) ? "bottom" : "side",
      orientation: rail?.getAttribute("aria-orientation") ?? null,
      stageRect,
      railRect,
      trayRect,
      selectionRect,
      traySelectionOverlap,
      trayPlacement: tray?.getAttribute("data-rail-tray-placement") ?? null,
      railContained: contained(railRect, stageRect),
      trayContained: contained(trayRect, stageRect),
      centerDelta: railRect && stageRect
        ? Math.abs((railRect.top + railRect.height / 2) - (stageRect.top + stageRect.height / 2))
        : null,
      horizontalCenterDelta: railRect && stageRect
        ? Math.abs((railRect.left + railRect.width / 2) - (stageRect.left + stageRect.width / 2))
        : null,
      bottomInset: railRect && stageRect ? stageRect.bottom - railRect.bottom : null,
      contentPaddingLeft: Number.parseFloat(getComputedStyle(document.querySelector(".scripture-content")).paddingLeft),
      markingBottomInset: getComputedStyle(stage).getPropertyValue("--marking-bottom-inset").trim(),
      toolIds: tools.map((tool) => tool.dataset.railTool),
      toolLabels: tools.map((tool) => tool.getAttribute("aria-label")),
      toolTabStops: tools.map((tool, index) => tool.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      pressedTools: tools.filter((tool) => tool.getAttribute("aria-pressed") === "true").length,
      trayMode: tray?.getAttribute("data-rail-tray-mode") ?? null,
      trayRole: tray?.getAttribute("role") ?? null,
      trayLabel: tray?.getAttribute("aria-label") ?? null,
      header: tray?.querySelector(".marking-rail-tray-copy > span")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      quote: tray?.querySelector(".marking-rail-tray-copy q")?.textContent?.trim() ?? null,
      quoteTitle: tray?.querySelector(".marking-rail-tray-copy q")?.getAttribute("title") ?? null,
      intentLabels: intents.map((intent) => intent.querySelector("strong")?.textContent?.trim()),
      intentDescriptions: intents.map((intent) => intent.querySelector("small")?.textContent?.trim()),
      activeIntent: intents.indexOf(document.activeElement),
      focusRing: root?.getAttribute("data-focus-ring") ?? null,
      activeOutlineStyle: document.activeElement instanceof HTMLElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : null,
      focusTrace: window.__railFocusTrace ?? [],
      closeLabel: tray?.querySelector(".marking-rail-tray-close")?.getAttribute("aria-label") ?? null,
      help: tray?.querySelector(".marking-rail-tray-help")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      overflow: {
        document: overflow(document.documentElement),
        body: overflow(document.body),
        scriptureBody: overflow(document.querySelector(".scripture-body")),
        stage: overflow(stage),
        rail: overflow(rail),
        tray: overflow(tray),
        trayBody: overflow(tray?.querySelector(".marking-rail-tray-body")),
      },
    };
  })()`;
}

function assertRailMatrixReport(report, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  assert.deepEqual(report.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport drifted`);
  assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
  assert.equal(report.layout, report.expectedLayout, `${label}: layout ignored the Rail's own stage dimensions`);
  assert.equal(report.orientation, report.layout === "side" ? "vertical" : "horizontal", `${label}: toolbar orientation drifted`);
  assert.equal(report.railContained, true, `${label}: Rail escaped its own reading stage`);
  assert.equal(report.trayContained, true, `${label}: selection tray escaped its own reading stage`);
  assert.ok(report.selectionRect?.width > 0 && report.selectionRect?.height > 0, `${label}: native phrase geometry was unavailable`);
  assert.equal(report.traySelectionOverlap, false, `${label}: Pen Rail tray covered the selected phrase`);
  assert.ok(["rail", "above", "below", "right", "left"].includes(report.trayPlacement), `${label}: collision-aware tray placement was not exposed`);
  if (report.layout === "side") {
    assert.ok(report.centerDelta != null && report.centerDelta <= GEOMETRY_EPSILON, `${label}: side Rail is ${report.centerDelta}px off vertical center`);
    assert.ok(report.contentPaddingLeft >= 82 - GEOMETRY_EPSILON, `${label}: side Rail did not reserve left reading space`);
  } else {
    assert.ok(report.bottomInset != null && Math.abs(report.bottomInset - 10) <= GEOMETRY_EPSILON, `${label}: bottom Rail inset drifted to ${report.bottomInset}px`);
    assert.ok(report.horizontalCenterDelta != null && report.horizontalCenterDelta <= GEOMETRY_EPSILON, `${label}: bottom Rail is ${report.horizontalCenterDelta}px off horizontal center`);
    assert.equal(report.markingBottomInset, "82px", `${label}: bottom Rail did not reserve its reading inset`);
  }
  assert.deepEqual(report.toolIds, TOOL_IDS, `${label}: Rail must expose Highlight, Connect, Note, Erase only`);
  assert.deepEqual(report.toolLabels, TOOL_LABELS, `${label}: resting tool labels drifted`);
  assert.deepEqual(report.toolTabStops, [0], `${label}: Rail must expose exactly one roving toolbar stop`);
  assert.equal(report.pressedTools, 0, `${label}: a resting Rail inherited a stale tool`);
  assert.equal(report.trayMode, "intent", `${label}: fresh selection did not open the intent tray`);
  assert.equal(report.trayRole, "dialog", `${label}: selection tray lost its dialog role`);
  assert.equal(report.trayLabel, "Mark selected text", `${label}: selection tray label drifted`);
  assert.equal(report.header, `Mark selection · ${FIXTURE.displayBook} ${FIXTURE.chapter}:${FIXTURE.phrase.verse}`, `${label}: exact reference drifted`);
  assert.equal(report.quote, `“${FIXTURE.phrase.quote}”`, `${label}: exact selected quotation drifted`);
  assert.equal(report.quoteTitle, FIXTURE.phrase.quote, `${label}: complete quotation title drifted`);
  assert.deepEqual(report.intentLabels, ["Highlight", "Connect"], `${label}: intent tray exposed more than its two approved paths`);
  assert.deepEqual(report.intentDescriptions, ["Lay a quiet wash", "Relate these words"], `${label}: selection intent descriptions drifted`);
  assert.equal(
    report.activeIntent,
    0,
    `${label}: fresh selection focus did not reach Highlight; focus trace ${JSON.stringify(report.focusTrace)}`,
  );
  assert.equal(report.focusRing, "pointer", `${label}: pointer-open Rail exposed a keyboard focus ring mode`);
  assert.equal(report.activeOutlineStyle, "none", `${label}: programmatic initial intent focus painted an accent outline`);
  assert.equal(report.closeLabel, "Close Pen Rail tray", `${label}: selection tray lost its close action`);
  assert.equal(report.help, "Choose a path for these words.", `${label}: selection guidance drifted`);
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `${label}: ${surface} overflowed horizontally by ${overflow}px`);
  }
}

async function rangeCounts(driver) {
  return driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return {
      highlights: result.highlights.filter((record) => record.deleted === 0).length,
      connections: result.connections.length,
    };
  })()`);
}

async function expectedConnectionAnchor(driver, spec) {
  return driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    const text = chapter?.verses.find((item) => item.verse === spec.verse)?.text ?? "";
    const charStart = text.indexOf(spec.quote);
    if (charStart < 0) throw new Error("missing exact Rail connection fixture: " + spec.quote);
    const capture = await window.api.library.captureConnectionSelection("bsb", [{
      book: "ACT",
      chapter: 19,
      verse: spec.verse,
      char_start: charStart,
      char_end: charStart + spec.quote.length,
      quote: spec.quote,
    }]);
    if (!capture.ok || capture.status !== "exact") {
      throw new Error("Rail exact-anchor capture refused: " + JSON.stringify(capture));
    }
    return capture.anchor;
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

async function clickSelectionIntent(driver, label) {
  const clicked = await driver.evaluate(`(() => {
    const button = [...document.querySelectorAll(".marking-rail-intents .marking-intent")]
      .find((candidate) => candidate.querySelector("strong")?.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `selection intent lost ${label}`);
}

async function waitForActiveHighlightCount(driver, count) {
  await driver.waitFor(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.highlights.filter((record) => record.deleted === 0).length === ${count};
  })()`);
}

async function assertRailMutationFlows(driver, cdp, highlightsLog) {
  const baseline = await rangeCounts(driver);
  assert.equal(baseline.highlights, 0, "Rail mutation fixture inherited highlights");

  // A failed wash must restore the exact selection once, expose retry copy,
  // and remain inert after the failed request settles.
  await openSelectionIntent(driver, FIXTURE.phrase);
  await clickSelectionIntent(driver, "Highlight");
  await driver.waitFor(`Boolean(document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]'))`);
  await withWriteBlocked(highlightsLog, async () => {
    await driver.evaluate(`document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]')?.click()`);
    await driver.waitFor(`(() => {
      const tray = document.querySelector('[data-rail-tray-mode="intent"]');
      return tray?.querySelector(".marking-rail-tray-copy q")?.getAttribute("title") === ${JSON.stringify(FIXTURE.phrase.quote)}
        && tray?.querySelector(".marking-rail-tray-help")?.textContent?.trim()
          === "The highlight could not be saved. Selection restored for retry.";
    })()`);
    await sleep(300);
    assert.deepEqual(await rangeCounts(driver), baseline, "failed Rail wash retried or wrote an authored record");
  });

  // Retry from the restored selection itself, then prove the carried tool
  // auto-applies to a second phrase without flashing or mounting a tray.
  await clickSelectionIntent(driver, "Highlight");
  await driver.waitFor(`Boolean(document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]'))`);
  await driver.evaluate(`document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]')?.click()`);
  await waitForActiveHighlightCount(driver, 1);
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "wash:blue"`);
  await driver.evaluate(`(() => {
    const host = document.querySelector('[data-marking-surface="rail"]');
    window.__railMutationTrayAdds = 0;
    window.__railMutationObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".marking-rail-tray")) window.__railMutationTrayAdds += 1;
        window.__railMutationTrayAdds += node.querySelectorAll(".marking-rail-tray").length;
      }
    });
    if (host) window.__railMutationObserver.observe(host, { childList: true, subtree: true });
  })()`);
  const autoSelected = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(autoSelected, FIXTURE.counterpart.quote, "armed Sky selection drifted");
  await waitForActiveHighlightCount(driver, 2);
  await settle(driver);
  const autoReport = await driver.evaluate(`(async () => {
    window.__railMutationObserver?.disconnect();
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const active = result.highlights.filter((record) => record.deleted === 0);
    const report = {
      additions: window.__railMutationTrayAdds,
      armed: document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed"),
      trayCount: document.querySelectorAll('[data-marking-surface="rail"] .marking-rail-tray').length,
      nativeSelection: getSelection()?.toString() ?? "",
      focusedVerse: document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") ?? null,
      colors: active.map((record) => record.color),
      exact: active.every((record) => record.char_start != null && record.char_end != null),
    };
    delete window.__railMutationTrayAdds;
    delete window.__railMutationObserver;
    return report;
  })()`);
  assert.deepEqual(autoReport.colors, ["blue", "blue"], "Rail Sky writes did not use the existing blue highlight vocabulary");
  assert.equal(autoReport.exact, true, "Rail Sky writes lost exact phrase offsets");
  assert.equal(autoReport.additions, 0, "armed Sky flashed a Rail tray during auto-apply");
  assert.equal(autoReport.trayCount, 0, "armed Sky left a Rail tray mounted");
  assert.equal(autoReport.armed, "wash:blue", "armed Sky was dropped after auto-apply");
  assert.equal(autoReport.nativeSelection, "", "armed Sky left native selection behind");
  assert.equal(autoReport.focusedVerse, String(FIXTURE.counterpart.verse), "armed Sky returned focus to the wrong verse");
  await driver.evaluate(`document.querySelector(".marking-rail-put-down")?.click()`);
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false"`);

  // Note remains an explicit, non-writing dialog until Save and preserves the
  // exact selected quotation and Scripture reference.
  await openSelectionIntent(driver, FIXTURE.phrase);
  await driver.evaluate(`document.querySelector('[data-marking-surface="rail"] [data-rail-tool="note"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-root"))`);
  const note = await driver.evaluate(`(() => ({
    quote: document.querySelector(".note-capture-quote-text")?.textContent?.trim() ?? null,
    reference: document.querySelector(".note-capture-quote-ref")?.textContent?.trim() ?? null,
  }))()`);
  assert.deepEqual(note, { quote: FIXTURE.phrase.quote, reference: "Acts 19:8" }, "Rail Note lost its exact selection context");
  await driver.evaluate(`document.querySelector(".note-capture-cancel")?.click()`);
  await driver.waitFor(`!document.querySelector(".note-capture-root")`);
  await driver.evaluate(`document.querySelector(".marking-rail-put-down")?.click()`);

  // Erase the armed-auto-applied phrase successfully first.
  await openSelectionIntent(driver, FIXTURE.counterpart);
  await driver.evaluate(`document.querySelector('[data-marking-surface="rail"] [data-rail-tool="erase"]')?.click()`);
  await waitForActiveHighlightCount(driver, 1);
  await driver.evaluate(`document.querySelector(".marking-rail-put-down")?.click()`);

  // A failed erase owns Escape synchronously, restores the exact phrase once,
  // and leaves the existing highlight untouched until an explicit retry.
  await openSelectionIntent(driver, FIXTURE.phrase);
  await withWriteBlocked(highlightsLog, async () => {
    await driver.evaluate(`(() => {
      document.querySelector('[data-marking-surface="rail"] [data-rail-tool="erase"]')?.click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    })()`);
    await driver.waitFor(`(() => {
      const tray = document.querySelector('[data-rail-tray-mode="intent"]');
      return tray?.querySelector(".marking-rail-tray-copy q")?.getAttribute("title") === ${JSON.stringify(FIXTURE.phrase.quote)}
        && tray?.querySelector(".marking-rail-tray-help")?.textContent?.trim()
          === "The highlight could not be removed. Selection restored for retry.";
    })()`);
    await sleep(300);
    const retained = await rangeCounts(driver);
    assert.equal(retained.highlights, 1, "failed Rail erase retried or removed the highlight");
  });
  await driver.evaluate(`document.querySelector('[data-marking-surface="rail"] [data-rail-tool="erase"]')?.click()`);
  await waitForActiveHighlightCount(driver, 0);
  await driver.evaluate(`document.querySelector(".marking-rail-put-down")?.click()`);
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false"`);
  assert.deepEqual(await rangeCounts(driver), baseline, "Rail mutation flow did not restore its isolated authored baseline");
}

async function openToolTray(driver, tool) {
  const opened = await driver.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(`[data-marking-surface="rail"] [data-rail-tool="${tool}"]`)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(opened, true, `missing Rail ${tool} tool`);
  await driver.waitFor(`(() => {
    const tray = document.querySelector(${JSON.stringify(`[data-marking-surface="rail"] .marking-rail-tray[data-rail-tray-mode="${tool}"]`)});
    return Boolean(tray && getComputedStyle(tray).visibility === "visible");
  })()`);
  await driver.waitFor(`Boolean(document.activeElement?.closest(${JSON.stringify(`[data-rail-tray-mode="${tool}"]`)}))`);
}

async function assertSkyStatusInCell(driver, cdp, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  const restingGlyphColors = await driver.evaluate(`[...document.querySelectorAll('[data-marking-surface="rail"] [data-rail-tool] svg')]
    .map((glyph) => getComputedStyle(glyph).color)`);
  assert.equal(restingGlyphColors.length, 4, `${label}: resting Rail lost a tool glyph`);
  assert.ok(restingGlyphColors.every((color) => typeof color === "string" && color.length > 0), `${label}: resting Rail lost its neutral glyph color`);
  assert.equal(new Set(restingGlyphColors).size, 1, `${label}: resting Rail glyphs do not share one neutral color`);
  const restingGlyphColor = restingGlyphColors[0];
  await openToolTray(driver, "connect");
  const connectTray = await driver.evaluate(`(() => {
    const tray = document.querySelector('[data-rail-tray-mode="connect"]');
    const stage = document.querySelector(".scripture-reading-stage");
    const grid = tray?.querySelector(".marking-relationship-grid");
    const body = tray?.querySelector(".marking-rail-tray-body");
    const lastChoice = tray?.querySelector("[data-relationship-kind]:last-child");
    lastChoice?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const trayRect = tray?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    const lastChoiceRect = lastChoice?.getBoundingClientRect();
    return {
      choices: tray?.querySelectorAll("[data-relationship-kind]").length ?? 0,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(/\\s+/).filter(Boolean).length : 0,
      contained: Boolean(trayRect && stageRect
        && trayRect.left >= stageRect.left - ${GEOMETRY_EPSILON}
        && trayRect.top >= stageRect.top - ${GEOMETRY_EPSILON}
        && trayRect.right <= stageRect.right + ${GEOMETRY_EPSILON}
        && trayRect.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}),
      overflow: tray ? Math.max(0, tray.scrollWidth - tray.clientWidth) : null,
      lastChoiceReachable: Boolean(bodyRect && lastChoiceRect
        && lastChoiceRect.top >= bodyRect.top - ${GEOMETRY_EPSILON}
        && lastChoiceRect.bottom <= bodyRect.bottom + ${GEOMETRY_EPSILON}),
    };
  })()`);
  assert.equal(connectTray.choices, 6, `${label}: relationship tray lost a command`);
  assert.equal(connectTray.columns, 2, `${label}: relationship tray lost its two-by-three grid`);
  assert.equal(connectTray.contained, true, `${label}: relationship tray escaped its own stage`);
  assert.ok(connectTray.overflow != null && connectTray.overflow <= GEOMETRY_EPSILON, `${label}: relationship tray overflowed by ${connectTray.overflow}px`);
  assert.equal(connectTray.lastChoiceReachable, true, `${label}: final relationship could not be reached inside the tray body`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-rail-tray-mode="connect"]')`);

  await openToolTray(driver, "wash");
  const washTray = await driver.evaluate(`(() => {
    const tray = document.querySelector('[data-rail-tray-mode="wash"]');
    const stage = document.querySelector(".scripture-reading-stage");
    const grid = tray?.querySelector(".marking-pigment-grid");
    const body = tray?.querySelector(".marking-rail-tray-body");
    const lastChoice = tray?.querySelector("[data-pigment]:last-child");
    lastChoice?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const trayRect = tray?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    const lastChoiceRect = lastChoice?.getBoundingClientRect();
    return {
      choices: tray?.querySelectorAll("[data-pigment]").length ?? 0,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(/\\s+/).filter(Boolean).length : 0,
      contained: Boolean(trayRect && stageRect
        && trayRect.left >= stageRect.left - ${GEOMETRY_EPSILON}
        && trayRect.top >= stageRect.top - ${GEOMETRY_EPSILON}
        && trayRect.right <= stageRect.right + ${GEOMETRY_EPSILON}
        && trayRect.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}),
      overflow: tray ? Math.max(0, tray.scrollWidth - tray.clientWidth) : null,
      lastChoiceReachable: Boolean(bodyRect && lastChoiceRect
        && lastChoiceRect.top >= bodyRect.top - ${GEOMETRY_EPSILON}
        && lastChoiceRect.bottom <= bodyRect.bottom + ${GEOMETRY_EPSILON}),
    };
  })()`);
  assert.equal(washTray.choices, 5, `${label}: wash tray lost a command`);
  assert.equal(washTray.columns, 5, `${label}: wash tray lost its five-swatch row`);
  assert.equal(washTray.contained, true, `${label}: wash tray escaped its own stage`);
  assert.ok(washTray.overflow != null && washTray.overflow <= GEOMETRY_EPSILON, `${label}: wash tray overflowed by ${washTray.overflow}px`);
  assert.equal(washTray.lastChoiceReachable, true, `${label}: final wash could not be reached inside the tray body`);
  const choseSky = await driver.evaluate(`(() => {
    const choice = document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]');
    if (!choice) return false;
    choice.click();
    return true;
  })()`);
  assert.equal(choseSky, true, `${label}: Sky wash was unavailable`);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="rail"][data-tool-armed="wash:blue"] .marking-rail-status'))`);
  await driver.waitFor(`document.activeElement?.matches(".verse-line") === true`);
  const status = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="rail"]');
    const stage = document.querySelector(".scripture-reading-stage");
    const rail = root?.querySelector(".marking-rail");
    const panel = root?.querySelector(".marking-rail-status");
    const active = rail?.querySelector('[data-rail-tool="wash"]');
    const inactive = [...(rail?.querySelectorAll("[data-rail-tool]") ?? [])].filter((tool) => tool !== active);
    const panelRect = panel?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const activeGlyphColor = active?.querySelector("svg") ? getComputedStyle(active.querySelector("svg")).color : null;
    return {
      armed: root?.getAttribute("data-tool-armed") ?? null,
      pressed: [...(rail?.querySelectorAll("[data-rail-tool]") ?? [])]
        .filter((tool) => tool.getAttribute("aria-pressed") === "true").map((tool) => tool.dataset.railTool),
      active: [...(rail?.querySelectorAll("[data-rail-tool].active") ?? [])].map((tool) => tool.dataset.railTool),
      tag: panel?.querySelector(".marking-rail-status-tag")?.textContent?.trim() ?? null,
      copy: panel?.querySelector(".marking-rail-status-copy")?.textContent?.trim() ?? null,
      putDown: panel?.querySelector(".marking-rail-put-down")?.textContent?.trim() ?? null,
      trayCount: root?.querySelectorAll(".marking-rail-tray").length ?? -1,
      contained: Boolean(panelRect && stageRect
        && panelRect.left >= stageRect.left - ${GEOMETRY_EPSILON}
        && panelRect.top >= stageRect.top - ${GEOMETRY_EPSILON}
        && panelRect.right <= stageRect.right + ${GEOMETRY_EPSILON}
        && panelRect.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}),
      overflow: panel ? Math.max(0, panel.scrollWidth - panel.clientWidth) : null,
      activeGlyphColor,
      inactiveGlyphColors: inactive.map((tool) => {
        const glyph = tool.querySelector("svg");
        return glyph ? getComputedStyle(glyph).color : null;
      }),
      railBorderColor: rail ? getComputedStyle(rail).borderColor : null,
      statusBorderColor: panel ? getComputedStyle(panel).borderColor : null,
      toneVisible: active?.querySelector(".marking-tool-tone")
        ? getComputedStyle(active.querySelector(".marking-tool-tone")).display
        : null,
      readingFocus: document.activeElement?.matches(".verse-line") ?? false,
    };
  })()`);
  assert.deepEqual(status.pressed, ["wash"], `${label}: Sky was not the sole pressed Rail tool`);
  assert.deepEqual(status.active, ["wash"], `${label}: Sky was not the sole active Rail tool`);
  assert.equal(status.armed, "wash:blue", `${label}: Sky armed seam drifted`);
  assert.equal(status.tag, "Sky highlight", `${label}: Sky status tag drifted`);
  assert.equal(status.copy, "Select words to lay this wash.", `${label}: Sky guidance drifted`);
  assert.equal(status.putDown, "Put tool down", `${label}: Rail status lost Put tool down`);
  assert.equal(status.trayCount, 0, `${label}: tool tray remained behind carried-tool status`);
  assert.equal(status.contained, true, `${label}: carried-tool status escaped its own stage`);
  assert.ok(status.overflow != null && status.overflow <= GEOMETRY_EPSILON, `${label}: carried-tool status overflowed by ${status.overflow}px`);
  assert.equal(status.readingFocus, true, `${label}: carrying Sky did not return focus to the reading canvas`);
  assert.ok(status.inactiveGlyphColors.every((color) => color !== status.activeGlyphColor), `${label}: semantic Sky color leaked to inactive tools`);
  assert.deepEqual(status.inactiveGlyphColors, Array(3).fill(restingGlyphColor), `${label}: inactive Rail glyphs drifted from their neutral resting color`);
  assert.notEqual(status.railBorderColor, status.activeGlyphColor, `${label}: semantic Sky color leaked to the Rail edge`);
  assert.notEqual(status.statusBorderColor, status.activeGlyphColor, `${label}: semantic Sky color leaked to the status edge`);
  assert.equal(status.toneVisible, "none", `${label}: obsolete edge pigment reappeared beside Highlight`);
  const putDown = await driver.evaluate(`(() => {
    const button = document.querySelector(".marking-rail-put-down");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(putDown, true, `${label}: could not put Sky down`);
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="rail"]');
    return Boolean(root
      && root.getAttribute("data-tool-armed") === "false"
      && !root.querySelector(".marking-rail-status")
      && root.querySelectorAll("[data-rail-tool]").length === 4);
  })()`);
}

async function assertToolTrays(driver, cdp) {
  const before = await rangeCounts(driver);
  await openToolTray(driver, "wash");
  const wash = await driver.evaluate(`(() => {
    const tray = document.querySelector('[data-rail-tray-mode="wash"]');
    const grid = tray?.querySelector(".marking-pigment-grid");
    const choices = [...(tray?.querySelectorAll("[data-pigment]") ?? [])];
    const trayRect = tray?.getBoundingClientRect();
    const stageRect = document.querySelector(".scripture-reading-stage")?.getBoundingClientRect();
    return {
      ids: choices.map((choice) => choice.dataset.pigment),
      labels: choices.map((choice) => choice.querySelector(".marking-choice-label")?.textContent?.trim()),
      groupRole: tray?.querySelector(".marking-pigment-grid")?.getAttribute("role") ?? null,
      groupLabel: tray?.querySelector(".marking-pigment-grid")?.getAttribute("aria-label") ?? null,
      describedBy: choices.map((choice) => choice.getAttribute("aria-describedby")),
      tabStops: choices.map((choice, index) => choice.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      pressed: choices.map((choice) => choice.getAttribute("aria-pressed")),
      activeIndex: choices.indexOf(document.activeElement),
      help: tray?.querySelector(".marking-rail-tray-help")?.textContent?.replace(/\\s+/g, " ").trim(),
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(/\\s+/).filter(Boolean).length : 0,
      contained: Boolean(trayRect && stageRect
        && trayRect.left >= stageRect.left - ${GEOMETRY_EPSILON}
        && trayRect.top >= stageRect.top - ${GEOMETRY_EPSILON}
        && trayRect.right <= stageRect.right + ${GEOMETRY_EPSILON}
        && trayRect.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}),
      overflow: tray ? Math.max(0, tray.scrollWidth - tray.clientWidth) : null,
    };
  })()`);
  assert.deepEqual(wash.ids, PIGMENTS, "Rail wash vocabulary drifted");
  assert.deepEqual(wash.labels, PIGMENT_LABELS, "Rail wash labels drifted");
  assert.equal(wash.groupRole, "group", "Rail wash choices lost their group role");
  assert.equal(wash.groupLabel, "Highlight color", "Rail wash group label drifted");
  assert.deepEqual(wash.describedBy, Array(5).fill("marking-rail-help"), "Rail washes lost their stable description target");
  assert.deepEqual(wash.tabStops, [0], "Rail washes need one roving tab stop");
  assert.deepEqual(wash.pressed, Array(5).fill("false"), "browsing washes must not apply one");
  assert.equal(wash.activeIndex, 0, "Rail wash focus did not begin at Amber");
  assert.equal(wash.help, "A warm amber wash.", "Rail wash help did not follow initial focus");
  assert.equal(wash.columns, 5, "Rail washes no longer form the approved five-swatch row");
  assert.equal(wash.contained, true, "Rail wash tray escaped its own stage");
  assert.ok(wash.overflow != null && wash.overflow <= GEOMETRY_EPSILON, `Rail wash tray overflowed by ${wash.overflow}px`);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await driver.waitFor(`(() => {
    const choices = [...document.querySelectorAll('[data-rail-tray-mode="wash"] [data-pigment]')];
    return choices.indexOf(document.activeElement) === 1
      && choices.filter((choice) => choice.tabIndex === 0).length === 1
      && choices.every((choice) => choice.getAttribute("aria-pressed") === "false");
  })()`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-rail-tray-mode="wash"]')
    && document.activeElement?.getAttribute("data-rail-tool") === "wash"`);

  await openToolTray(driver, "connect");
  const connectReport = await driver.evaluate(`(() => {
    const tray = document.querySelector('[data-rail-tray-mode="connect"]');
    const grid = tray?.querySelector(".marking-relationship-grid");
    const choices = [...(tray?.querySelectorAll("[data-relationship-kind]") ?? [])];
    const trayRect = tray?.getBoundingClientRect();
    const stageRect = document.querySelector(".scripture-reading-stage")?.getBoundingClientRect();
    return {
      ids: choices.map((choice) => choice.dataset.relationshipKind),
      labels: choices.map((choice) => choice.querySelector(".marking-choice-label")?.textContent?.trim()),
      groupRole: tray?.querySelector(".marking-relationship-grid")?.getAttribute("role") ?? null,
      groupLabel: tray?.querySelector(".marking-relationship-grid")?.getAttribute("aria-label") ?? null,
      describedBy: choices.map((choice) => choice.getAttribute("aria-describedby")),
      tabStops: choices.map((choice, index) => choice.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      pressed: choices.map((choice) => choice.getAttribute("aria-pressed")),
      activeIndex: choices.indexOf(document.activeElement),
      help: tray?.querySelector(".marking-rail-tray-help")?.textContent?.replace(/\\s+/g, " ").trim(),
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(/\\s+/).filter(Boolean).length : 0,
      contained: Boolean(trayRect && stageRect
        && trayRect.left >= stageRect.left - ${GEOMETRY_EPSILON}
        && trayRect.top >= stageRect.top - ${GEOMETRY_EPSILON}
        && trayRect.right <= stageRect.right + ${GEOMETRY_EPSILON}
        && trayRect.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}),
      overflow: tray ? Math.max(0, tray.scrollWidth - tray.clientWidth) : null,
    };
  })()`);
  assert.deepEqual(connectReport.ids, RELATIONSHIPS, "Rail relationship vocabulary drifted");
  assert.deepEqual(connectReport.labels, RELATIONSHIP_LABELS, "Rail relationship labels drifted");
  assert.equal(connectReport.groupRole, "group", "Rail relationship choices lost their group role");
  assert.equal(connectReport.groupLabel, "Connection type", "Rail relationship group label drifted");
  assert.deepEqual(connectReport.describedBy, Array(6).fill("marking-rail-help"), "Rail relationships lost their stable description target");
  assert.deepEqual(connectReport.tabStops, [0], "Rail relationships need one roving tab stop");
  assert.deepEqual(connectReport.pressed, Array(6).fill("false"), "browsing relationships must not apply one");
  assert.equal(connectReport.activeIndex, 0, "Rail relationship focus did not begin at Parallelism");
  assert.equal(connectReport.help, "The same thought, said again in other words.", "Rail relationship help did not follow initial focus");
  assert.equal(connectReport.columns, 2, "Rail relationships no longer form the approved two-by-three grid");
  assert.equal(connectReport.contained, true, "Rail relationship tray escaped its own stage");
  assert.ok(connectReport.overflow != null && connectReport.overflow <= GEOMETRY_EPSILON, `Rail relationship tray overflowed by ${connectReport.overflow}px`);
  await pressKey(cdp, "End", "End", 0, 35);
  await driver.waitFor(`(() => {
    const choices = [...document.querySelectorAll('[data-rail-tray-mode="connect"] [data-relationship-kind]')];
    return choices.indexOf(document.activeElement) === 5
      && choices.filter((choice) => choice.tabIndex === 0).length === 1
      && choices.every((choice) => choice.getAttribute("aria-pressed") === "false");
  })()`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-rail-tray-mode="connect"]')
    && document.activeElement?.getAttribute("data-rail-tool") === "connect"`);
  assert.deepEqual(await rangeCounts(driver), before, "Rail tray browsing mutated authored records");
}

async function assertToolbarAndStatus(driver, cdp) {
  const before = await rangeCounts(driver);
  const focused = await driver.evaluate(`(() => {
    const tools = [...document.querySelectorAll('[data-marking-surface="rail"] [data-rail-tool]')];
    tools[0]?.focus({ preventScroll: true });
    return tools.length;
  })()`);
  assert.equal(focused, 4, "Pen Rail did not expose exactly four tools");
  const assertToolFocus = async (index, key) => {
    await driver.waitFor(`(() => {
      const tools = [...document.querySelectorAll('[data-marking-surface="rail"] [data-rail-tool]')];
      return tools.indexOf(document.activeElement) === ${index}
        && tools.filter((tool) => tool.tabIndex === 0).length === 1
        && tools[${index}]?.tabIndex === 0;
    })()`);
    const pressed = await driver.evaluate(`[...document.querySelectorAll('[data-marking-surface="rail"] [data-rail-tool]')]
      .filter((tool) => tool.getAttribute("aria-pressed") === "true").length`);
    assert.equal(pressed, 0, `${key}: toolbar browsing armed a tool`);
  };
  await pressKey(cdp, "ArrowDown", "ArrowDown", 0, 40);
  await assertToolFocus(1, "ArrowDown");
  await pressKey(cdp, "End", "End", 0, 35);
  await assertToolFocus(3, "End");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await assertToolFocus(0, "ArrowRight wrap");
  await pressKey(cdp, "Home", "Home", 0, 36);
  await assertToolFocus(0, "Home");

  await pressKey(cdp, "Enter", "Enter", 0, 13);
  await driver.waitFor(`Boolean(document.querySelector('[data-rail-tray-mode="wash"]'))`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-rail-tray-mode="wash"]')
    && document.activeElement?.getAttribute("data-rail-tool") === "wash"`);

  await openToolTray(driver, "wash");
  const choseSky = await driver.evaluate(`(() => {
    const choice = document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]');
    if (!choice) return false;
    choice.click();
    return true;
  })()`);
  assert.equal(choseSky, true, "Rail Sky wash was unavailable");
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="rail"][data-tool-armed="wash:blue"] .marking-rail-status'))`);
  const status = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="rail"]');
    const panel = root?.querySelector(".marking-rail-status");
    return {
      armed: root?.getAttribute("data-tool-armed") ?? null,
      activeTools: root?.querySelectorAll(".marking-rail [data-rail-tool].active").length ?? -1,
      tag: panel?.querySelector(".marking-rail-status-tag")?.textContent?.trim() ?? null,
      copy: panel?.querySelector(".marking-rail-status-copy")?.textContent?.trim() ?? null,
      putDown: panel?.querySelector(".marking-rail-put-down")?.textContent?.trim() ?? null,
      trayCount: root?.querySelectorAll(".marking-rail-tray").length ?? -1,
    };
  })()`);
  assert.deepEqual(status, {
    armed: "wash:blue",
    activeTools: 1,
    tag: "Sky highlight",
    copy: "Select words to lay this wash.",
    putDown: "Put tool down",
    trayCount: 0,
  }, "Rail armed-tool status drifted");
  const putDown = await driver.evaluate(`(() => {
    const button = document.querySelector(".marking-rail-put-down");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(putDown, true, "Rail status lost Put tool down");
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false"
    && !document.querySelector('[data-marking-surface="rail"] .marking-rail-status')`);

  await openToolTray(driver, "connect");
  const choseSeries = await driver.evaluate(`(() => {
    const choice = document.querySelector('[data-rail-tray-mode="connect"] [data-relationship-kind="series"]');
    if (!choice) return false;
    choice.click();
    return true;
  })()`);
  assert.equal(choseSeries, true, "Rail Series relationship was unavailable");
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="rail"][data-tool-armed="connect:series"] .marking-rail-status'))`);
  const relationshipStatus = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="rail"]');
    return {
      tag: root?.querySelector(".marking-rail-status-tag")?.textContent?.trim(),
      copy: root?.querySelector(".marking-rail-status-copy")?.textContent?.trim(),
    };
  })()`);
  assert.deepEqual(relationshipStatus, {
    tag: "Series",
    copy: "Select words to add the next relationship phrase.",
  }, "Rail relationship status drifted");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false"`);
  assert.deepEqual(await rangeCounts(driver), before, "Rail tool/status exercise mutated authored records");
}

async function assertAuthoringDraft(driver, cdp) {
  const before = await rangeCounts(driver);
  await openSelectionIntent(driver, FIXTURE.phrase);
  const rawSelection = await driver.evaluate(`(() => {
    const emphasis = document.querySelector("[data-marking-selection-emphasis]");
    return {
      groups: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      id: emphasis?.getAttribute("data-connection-id") ?? null,
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      resolution: emphasis?.getAttribute("data-anchor-resolution") ?? null,
      washes: emphasis?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      drafts: document.querySelectorAll("[data-authoring-draft]").length,
      routeGroups: document.querySelectorAll(".connection-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      underlines: document.querySelectorAll(".connection-underline").length,
      contacts: document.querySelectorAll(".connection-contact").length,
      hits: document.querySelectorAll(".connection-route-hit").length,
      ticks: document.querySelectorAll("[data-connection-tick]").length,
      cards: document.querySelectorAll("#connection-card-inspector").length,
    };
  })()`);
  assert.equal(rawSelection.groups, 1, "fresh Rail selection did not receive exactly one renderer-only emphasis group");
  assert.match(rawSelection.id ?? "", /^__marking-selection-emphasis__:/, "fresh Rail selection emphasis lost its renderer-only identity");
  assert.equal(rawSelection.paintState, "selection", "fresh Rail selection lost its neutral selection paint state");
  assert.equal(rawSelection.resolution, "exact", "fresh Rail selection emphasis degraded from exact coordinates");
  assert.equal(rawSelection.washes, 1, "fresh Rail selection did not receive exactly one merged emphasis wash");
  assert.deepEqual(
    {
      drafts: rawSelection.drafts,
      routeGroups: rawSelection.routeGroups,
      routes: rawSelection.routes,
      underlines: rawSelection.underlines,
      contacts: rawSelection.contacts,
      hits: rawSelection.hits,
      ticks: rawSelection.ticks,
      cards: rawSelection.cards,
    },
    { drafts: 0, routeGroups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 0, cards: 0 },
    "fresh Rail selection leaked authoring, line, tick, or card artifacts",
  );
  assert.deepEqual(await rangeCounts(driver), before, "fresh Rail selection mutated durable records before a tool choice");
  const connectIntent = await driver.evaluate(`(() => {
    const button = [...document.querySelectorAll(".marking-rail-intents .marking-intent")]
      .find((candidate) => candidate.querySelector("strong")?.textContent?.trim() === "Connect");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(connectIntent, true, "selection intent lost Connect");
  await driver.waitFor(`Boolean(document.querySelector('[data-rail-tray-mode="connect"] [data-relationship-kind="series"]'))`);
  await driver.evaluate(`(() => {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) throw new Error("authoring selection Range is absent");
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    window.__railAuthoringSelectionRect = {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    };
  })()`);
  const captured = await driver.evaluate(`(() => {
    const choice = document.querySelector('[data-rail-tray-mode="connect"] [data-relationship-kind="series"]');
    if (!choice) return false;
    choice.click();
    return true;
  })()`);
  assert.equal(captured, true, "Series did not capture the selected phrase");
  await driver.waitFor(`!document.querySelector('[data-marking-selection-emphasis]')
    && Boolean(document.querySelector('.connection-emphasis-mark[data-authoring-draft] .connection-emphasis-wash'))`);
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
      selectionGroups: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      globalTicks: document.querySelectorAll("[data-connection-tick]").length,
      cards: document.querySelectorAll("#connection-card-inspector").length,
      sessionKind: document.querySelector(".marking-rail-status .marking-session-kind")?.textContent?.trim() ?? null,
      sessionCopy: document.querySelector(".marking-rail-status .marking-session-copy")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      activeToolOpacity: getComputedStyle(document.querySelector('.marking-rail [data-rail-tool="connect"]')).opacity,
      nativeSelection: getSelection()?.toString() ?? "",
      focusedVerse: document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") ?? null,
      selectionRect: window.__railAuthoringSelectionRect ?? null,
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
  assert.equal(report.draftCount, 1, "authoring phrase did not receive exactly one draft emphasis group");
  assert.equal(report.paintState, "authoring", "authoring phrase lost its explicit paint state");
  assert.equal(report.resolution, "exact", "authoring phrase degraded from exact coordinates");
  assert.ok(report.emphasisPaths > 0, "authoring draft did not bring the captured words into focus");
  assert.equal(report.routeGroups, 0, "authoring draft leaked into the route plane");
  assert.equal(report.routes, 0, "authoring draft painted a route before selection");
  assert.equal(report.underlines, 0, "authoring draft painted an underline before selection");
  assert.equal(report.contacts, 0, "authoring draft painted contacts before selection");
  assert.equal(report.hits, 0, "authoring draft created a hit target before selection");
  assert.equal(report.ticks, 0, "authoring draft created a durable connection tick");
  assert.equal(report.selectionGroups, 0, "Series capture left the transient raw-selection emphasis mounted");
  assert.equal(report.globalTicks, 0, "Series capture leaked a connection tick before Done");
  assert.equal(report.cards, 0, "Series capture opened a durable connection card before Done");
  assert.equal(report.sessionKind, "Series", "Rail session lost its relationship kind");
  assert.match(report.sessionCopy, /^1 marked · /, "Rail session did not retain the first phrase");
  assert.equal(report.activeToolOpacity, "1", "captured phrases made the carried Connect tool look disabled");
  assert.equal(report.nativeSelection, "", "captured authoring selection remained native-selected");
  assert.equal(report.focusedVerse, String(FIXTURE.phrase.verse), "authoring capture returned focus to the wrong verse");
  assert.deepEqual(report.globalRoutePlane, { groups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0 }, "authoring capture leaked global line paint");
  assert.ok(report.selectionRect && report.paintRect, "authoring phrase lacked comparable Range/paint geometry");
  assert.ok(Math.abs(report.selectionRect.left - report.paintRect.left) <= 4, "authoring wash began on the wrong words");
  assert.ok(Math.abs(report.selectionRect.right - report.paintRect.right) <= 4, "authoring wash ended on the wrong words");
  assert.ok(
    Math.abs((report.selectionRect.top + report.selectionRect.bottom) / 2 - (report.paintRect.top + report.paintRect.bottom) / 2) <= 6,
    "authoring wash moved to the wrong rendered line",
  );
  assert.deepEqual(await rangeCounts(driver), before, "one held authoring phrase wrote a durable connection");

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector(${JSON.stringify(`[data-connection-id="${DRAFT_ID}"]`)})`);
  const cancelled = await driver.evaluate(`(() => ({
    draft: document.querySelectorAll(${JSON.stringify(`[data-connection-id="${DRAFT_ID}"]`)}).length,
    route: document.querySelectorAll(${JSON.stringify(`.connection-mark[data-connection-id="${DRAFT_ID}"]`)}).length,
    tick: document.querySelectorAll(${JSON.stringify(`[data-connection-tick="${DRAFT_ID}"]`)}).length,
    session: document.querySelectorAll(".marking-session").length,
    armed: document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed"),
    globalLines: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit").length,
  }))()`);
  assert.deepEqual(cancelled, { draft: 0, route: 0, tick: 0, session: 0, armed: "connect:series", globalLines: 0 }, "cancelling a Rail session leaked draft paint or lost the carried tool");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false"`);
  await driver.evaluate(`delete window.__railAuthoringSelectionRect`);
  assert.deepEqual(await rangeCounts(driver), before, "authoring cancellation wrote after its Escape ladder completed");
}

async function assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames = null) {
  const before = await rangeCounts(driver);
  assert.equal(before.connections, 0, "completed-connection fixture inherited a durable connection");
  const expectedAnchors = await Promise.all([
    expectedConnectionAnchor(driver, FIXTURE.phrase),
    expectedConnectionAnchor(driver, FIXTURE.counterpart),
  ]);
  await ensureRailResting(driver, cdp);
  await openSelectionIntent(driver, FIXTURE.phrase);
  await clickSelectionIntent(driver, "Connect");
  await driver.waitFor(`Boolean(document.querySelector('[data-rail-tray-mode="connect"] [data-relationship-kind="series"]'))`);
  await driver.evaluate(`document.querySelector('[data-rail-tray-mode="connect"] [data-relationship-kind="series"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector('[data-authoring-draft]'))`);
  const counterpart = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(counterpart, FIXTURE.counterpart.quote, "Series counterpart selection drifted");
  await driver.waitFor(`Boolean(document.querySelector(".marking-session-action.primary"))`);

  const eventCountBefore = readFileSync(connectionsLog, "utf8").split("\n").filter(Boolean).length;
  // The host commits the UUID command, then deliberately drops its first
  // renderer response. Escape is fired in the same task as Done, proving the
  // synchronous operation token owns it before React publishes busy state.
  await driver.evaluate(`(() => {
    document.querySelector(".marking-session-action.primary")?.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  })()`);
  await driver.waitFor(`document.querySelector(".marking-session-copy")?.textContent?.trim()
    === "The result is not confirmed. Retry this exact change; your selected phrases are still held."`);
  await sleep(300);
  const failed = await driver.evaluate(`(() => ({
    draftGroups: document.querySelectorAll('[data-authoring-draft]').length,
    draftPaths: document.querySelectorAll('[data-authoring-draft] .connection-emphasis-wash').length,
    done: document.querySelectorAll(".marking-session-action.primary").length,
    recoveryRequired: [...document.querySelectorAll(".marking-session-action")]
      .some((button) => button.textContent?.trim() === "Recovery required" && button.disabled),
    busy: document.querySelector(".marking-session")?.getAttribute("aria-busy"),
    nativeSelection: getSelection()?.toString() ?? "",
    rawDiagnosticVisible: /EACCES|EPERM|ENOENT|connections\\.jsonl|\\/var\\/folders|QA simulated/i.test(document.body.innerText),
    connectionToasts: [...document.querySelectorAll(".toast-message")]
      .map((node) => node.textContent?.trim() ?? "")
      .filter((message) => /connection|result is not confirmed|reading index/i.test(message)),
  }))()`);
  assert.equal(failed.draftGroups, 1, "lost save response dropped its held draft");
  assert.ok(failed.draftPaths >= 2, "lost save response dropped one of its held phrases");
  assert.equal(failed.done, 1, "lost save response removed the explicit retry action");
  assert.equal(failed.recoveryRequired, true, "lost save response still exposed cancellation");
  assert.equal(failed.busy, "false", "lost save response never released its busy state");
  assert.equal(failed.nativeSelection, "", "lost save response restored native selection instead of held paint");
  assert.equal(failed.rawDiagnosticVisible, false, "lost Rail response exposed a host path or diagnostic string");
  assert.deepEqual(failed.connectionToasts, [], "lost Rail response duplicated its owned inline recovery state in a toast");
  assert.equal((await rangeCounts(driver)).connections, before.connections + 1,
    "response-loss seam did not land the authoritative event before failing the UI");
  const eventsAfterLoss = readFileSync(connectionsLog, "utf8").split("\n").filter(Boolean);
  assert.equal(eventsAfterLoss.length, eventCountBefore + 1);

  await driver.evaluate(`document.querySelector(".marking-session-action.primary")?.click()`);
  await driver.waitFor(`!document.querySelector('[data-authoring-draft]')
    && document.querySelectorAll(".marking-session").length === 0`);
  await driver.waitFor(`[...document.querySelectorAll(".toast-message")]
    .some((node) => (node.textContent?.trim() ?? "").startsWith("Series")
      && (node.textContent?.trim() ?? "").endsWith(" saved"))`);
  const terminalConnectionToasts = await driver.evaluate(`[...document.querySelectorAll(".toast-message")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter((message) => /series|connection|result is not confirmed|reading index/i.test(message))`);
  assert.equal(terminalConnectionToasts.length, 1, "Rail Retry did not reconcile to one terminal success notice");
  assert.match(terminalConnectionToasts[0], /^Series\b.* saved$/, "Rail terminal success notice lost its authored label");
  assert.equal(
    await driver.evaluate(`/EACCES|EPERM|ENOENT|connections\\.jsonl|\\/var\\/folders|QA simulated/i.test(document.body.innerText)`),
    false,
    "successful Rail Retry retained a raw host diagnostic",
  );
  const eventsAfterRetry = readFileSync(connectionsLog, "utf8").split("\n").filter(Boolean);
  assert.equal(eventsAfterRetry.length, eventCountBefore + 1,
    "MarkingSurface Retry appended a duplicate after the response was lost");
  const connection = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const record = result.connections.at(-1);
    if (!record) return null;
    window.__railCompletedConnectionId = record.id;
    return {
      id: record.id,
      formatVersion: record.format_version,
      kind: record.kind,
      anchors: record.anchors,
    };
  })()`);
  assert.ok(connection?.id, "successful Rail connection did not return a durable id");
  assert.deepEqual(
    { formatVersion: connection.formatVersion, kind: connection.kind, anchors: connection.anchors },
    { formatVersion: 2, kind: "series", anchors: expectedAnchors },
    "successful Rail connection payload drifted from its exact v2 anchors",
  );
  await driver.waitFor(`Boolean(document.querySelector('[data-connection-tick="' + CSS.escape(window.__railCompletedConnectionId) + '"]'))`);
  await settle(driver);

  const dormant = await driver.evaluate(`(() => {
    const id = window.__railCompletedConnectionId;
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
  assert.equal(dormant.paintState, "dormant", "saved connection did not settle into dormant presence paint");
  assert.equal(dormant.resolution, "exact", "saved connection lost its exact active-package paint");
  assert.ok(dormant.washes >= 2, "saved connection did not retain both phrase washes");
  assert.deepEqual(
    { routeGroups: dormant.routeGroups, routes: dormant.routes, underlines: dormant.underlines, contacts: dormant.contacts, hits: dormant.hits, ticks: dormant.ticks },
    { routeGroups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 1 },
    "dormant saved connection leaked line or hit paint",
  );

  await driver.evaluate(`document.querySelector('[data-connection-tick="' + CSS.escape(window.__railCompletedConnectionId) + '"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(window.__railCompletedConnectionId) + '"] .connection-route'))`);
  await settle(driver);
  const selected = await driver.evaluate(`(() => {
    const id = window.__railCompletedConnectionId;
    const group = document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]');
    const emphasis = document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]');
    return {
      groups: document.querySelectorAll('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]').length,
      routes: group?.querySelectorAll(".connection-route").length ?? 0,
      underlines: group?.querySelectorAll(".connection-underline").length ?? 0,
      contacts: group?.querySelectorAll(".connection-contact").length ?? 0,
      hits: group?.querySelectorAll(".connection-route-hit").length ?? 0,
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      veil: document.querySelectorAll(".connection-focus-veil").length,
      card: document.querySelectorAll("#connection-card-inspector").length,
    };
  })()`);
  assert.equal(selected.groups, 1, "selected connection did not produce exactly one route group");
  assert.equal(selected.routes, 1, "selected connection did not produce exactly one bracket centerline");
  assert.ok(selected.underlines >= 2, "selected connection did not underline both member phrases");
  assert.ok(selected.contacts >= 2, "selected connection did not pin both member phrases");
  assert.equal(selected.hits, 1, "selected connection lost its one focused hit target");
  assert.equal(selected.paintState, "selected", "selected connection did not bring its words into focus");
  assert.equal(selected.veil, 1, "selected connection lost the shared reading-focus veil");
  assert.equal(selected.card, 1, "selected connection did not open its Living Margin card");
  if (successFrames) {
    await parkPointer(cdp);
    await settle(driver);
    await bufferSuccessScreenshot(cdp, successFrames, "marking-rail-proof-selected-connection.png");
  }

  await driver.evaluate(`document.querySelector('[data-connection-tick="' + CSS.escape(window.__railCompletedConnectionId) + '"]')?.click()`);
  await driver.waitFor(`!document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(window.__railCompletedConnectionId) + '"]')`);
  const released = await driver.evaluate(`(() => {
    const id = window.__railCompletedConnectionId;
    const emphasis = document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]');
    const report = {
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      lines: document.querySelectorAll('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]').length,
      tick: document.querySelectorAll('[data-connection-tick="' + CSS.escape(id) + '"]').length,
      card: document.querySelectorAll("#connection-card-inspector").length,
    };
    delete window.__railCompletedConnectionId;
    return report;
  })()`);
  assert.deepEqual(released, { paintState: "dormant", lines: 0, tick: 1, card: 0 }, "released connection did not return to quiet dormant presence");
}

function allZeroDurations(value) {
  return value.split(",").every((duration) => Number.parseFloat(duration) === 0);
}

async function assertReducedMotion(driver, cdp) {
  await setMedia(cdp, { reduced: true });
  await openToolTray(driver, "connect");
  await settle(driver, true);
  const trayReport = await driver.evaluate(`(() => {
    const targets = [
      document.querySelector(".marking-rail"),
      document.querySelector(".marking-rail [data-rail-tool]"),
      document.querySelector(".marking-rail-tray"),
      document.querySelector(".marking-rail-tray-close"),
      document.querySelector(".marking-rail-tray .marking-choice"),
    ].filter(Boolean);
    return {
      active: matchMedia("(prefers-reduced-motion: reduce)").matches,
      durations: targets.map((target) => {
        const style = getComputedStyle(target);
        return { animation: style.animationDuration, transition: style.transitionDuration };
      }),
      running: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="rail"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);
  assert.equal(trayReport.active, true, "reduced-motion emulation did not reach the Rail");
  for (const [index, durations] of trayReport.durations.entries()) {
    assert.equal(allZeroDurations(durations.animation), true, `reduced-motion Rail target ${index} retained animation ${durations.animation}`);
    assert.equal(allZeroDurations(durations.transition), true, `reduced-motion Rail target ${index} retained transition ${durations.transition}`);
  }
  assert.equal(trayReport.running, 0, "reduced-motion Rail retained a running animation");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-rail-tray-mode="connect"]')`);

  await openToolTray(driver, "wash");
  await driver.evaluate(`document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="green"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".marking-rail-status"))`);
  const statusDurations = await driver.evaluate(`(() => {
    const status = document.querySelector(".marking-rail-status");
    const style = status ? getComputedStyle(status) : null;
    return { animation: style?.animationDuration ?? "", transition: style?.transitionDuration ?? "" };
  })()`);
  assert.equal(allZeroDurations(statusDurations.animation), true, `reduced-motion status retained animation ${statusDurations.animation}`);
  assert.equal(allZeroDurations(statusDurations.transition), true, `reduced-motion status retained transition ${statusDurations.transition}`);
  await driver.evaluate(`document.querySelector(".marking-rail-put-down")?.click()`);
  await driver.waitFor(`!document.querySelector(".marking-rail-status")`);
  await setMedia(cdp);
}

async function assertForcedColors(driver, cdp) {
  await setMedia(cdp, { forced: true });
  await openToolTray(driver, "wash");
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  const report = await driver.evaluate(`(() => {
    const rail = document.querySelector(".marking-rail");
    const tray = document.querySelector(".marking-rail-tray");
    const firstTool = document.querySelector('.marking-rail [data-rail-tool="wash"]');
    firstTool?.focus({ preventScroll: true });
    const railStyle = rail ? getComputedStyle(rail) : null;
    const trayStyle = tray ? getComputedStyle(tray) : null;
    const focusStyle = firstTool ? getComputedStyle(firstTool) : null;
    return {
      active: matchMedia("(forced-colors: active)").matches,
      codes: [...document.querySelectorAll('[data-rail-tray-mode="wash"] [data-pigment] .marking-pigment')]
        .map((swatch) => getComputedStyle(swatch, "::after").content.replace(/["']/g, "")),
      swatchBorders: [...document.querySelectorAll('[data-rail-tray-mode="wash"] [data-pigment] .marking-pigment')]
        .map((swatch) => getComputedStyle(swatch).borderStyle),
      railShadow: railStyle?.boxShadow ?? null,
      railBorder: railStyle?.borderStyle ?? null,
      trayShadow: trayStyle?.boxShadow ?? null,
      trayBorder: trayStyle?.borderStyle ?? null,
      focusOutline: { style: focusStyle?.outlineStyle ?? null, width: focusStyle?.outlineWidth ?? null },
      choiceCount: document.querySelectorAll('[data-rail-tray-mode="wash"] [data-pigment]').length,
      toolCount: document.querySelectorAll('.marking-rail [data-rail-tool]').length,
    };
  })()`);
  assert.equal(report.active, true, "forced-colors emulation did not reach the Rail");
  assert.deepEqual(report.codes, FORCED_CODES, "forced colors lost A/G/S/R/V wash distinctions");
  assert.deepEqual(report.swatchBorders, Array(5).fill("solid"), "forced colors lost wash sample boundaries");
  assert.equal(report.railShadow, "none", "forced colors retained decorative Rail shadow");
  assert.equal(report.railBorder, "solid", "forced colors lost the Rail boundary");
  assert.equal(report.trayShadow, "none", "forced colors retained decorative tray shadow");
  assert.equal(report.trayBorder, "solid", "forced colors lost the tray boundary");
  assert.equal(report.focusOutline.style, "solid", "forced colors lost Rail keyboard focus");
  assert.equal(report.focusOutline.width, "2px", "forced colors lost Rail focus width");
  assert.equal(report.choiceCount, 5, "forced colors hid wash choices");
  assert.equal(report.toolCount, 4, "forced colors hid Rail tools");
  await driver.evaluate(`document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".marking-rail-status"))`);
  const statusReport = await driver.evaluate(`(() => {
    const status = document.querySelector(".marking-rail-status");
    const active = document.querySelector('.marking-rail [data-rail-tool="wash"]');
    active?.focus({ preventScroll: true });
    const statusStyle = status ? getComputedStyle(status) : null;
    const activeStyle = active ? getComputedStyle(active) : null;
    return {
      shadow: statusStyle?.boxShadow ?? null,
      border: statusStyle?.borderStyle ?? null,
      activeOutline: activeStyle?.outlineStyle ?? null,
      activeOutlineWidth: activeStyle?.outlineWidth ?? null,
    };
  })()`);
  assert.equal(statusReport.shadow, "none", "forced colors retained decorative Rail status shadow");
  assert.equal(statusReport.border, "solid", "forced colors lost the Rail status boundary");
  assert.equal(statusReport.activeOutline, "double", "forced colors lost the distinct active-plus-focused style");
  assert.equal(statusReport.activeOutlineWidth, "3px", "forced colors lost active-plus-focused width");
  await driver.evaluate(`document.querySelector(".marking-rail-put-down")?.click()`);
  await driver.waitFor(`!document.querySelector(".marking-rail-status")`);
  await setMedia(cdp);
}

async function assertNoMotionReplay(driver, cdp) {
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  const listening = await driver.evaluate(`(() => {
    const host = document.querySelector('[data-marking-surface="rail"]');
    if (!host) return false;
    window.__railMotionStarts = [];
    window.__railMotionStartListener = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-marking-surface="rail"]')) return;
      if (!event.animationName.startsWith("marking-rail-")) return;
      window.__railMotionStarts.push({ name: event.animationName, target: event.target.className });
    };
    host.addEventListener("animationstart", window.__railMotionStartListener, true);
    return true;
  })()`);
  assert.equal(listening, true, "Rail motion listener could not attach");
  await openToolTray(driver, "connect");
  await driver.waitFor(`window.__railMotionStarts?.filter((event) => event.name === "marking-rail-in").length === 1`);
  await settle(driver);
  const entranceStarts = await driver.evaluate(`window.__railMotionStarts?.length ?? 0`);
  assert.equal(entranceStarts, 1, "normal Rail tray entrance did not emit exactly one marking-rail-in animationstart");
  await driver.evaluate(`(() => {
    const host = document.querySelector('[data-marking-surface="rail"]');
    const tray = host?.querySelector(".marking-rail-tray");
    window.__railMotionTray = tray;
    window.__railMotionAdditions = 0;
    window.__railMotionObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(".marking-rail-tray")) window.__railMotionAdditions += 1;
          window.__railMotionAdditions += node.querySelectorAll(".marking-rail-tray").length;
        }
      }
    });
    if (host) window.__railMotionObserver.observe(host, { childList: true, subtree: true });
    return Boolean(tray);
  })()`);
  await setViewport(cdp, 900, 900);
  await driver.evaluate(`new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))`);
  await sleep(40);
  const afterResize = await driver.evaluate(`(() => ({
    sameTray: window.__railMotionTray === document.querySelector(".marking-rail-tray"),
    additions: window.__railMotionAdditions,
    starts: window.__railMotionStarts?.length ?? -1,
    running: document.getAnimations({ subtree: true }).filter((animation) => {
      const target = animation.effect?.target;
      return animation instanceof CSSAnimation
        && animation.animationName.startsWith("marking-rail-")
        && target instanceof Element
        && Boolean(target.closest('[data-marking-surface="rail"]'))
        && (animation.playState === "running" || animation.playState === "pending");
    }).length,
  }))()`);
  assert.deepEqual(afterResize, { sameTray: true, additions: 0, starts: entranceStarts, running: 0 }, "same-layout resize replayed or remounted Rail motion");

  await setViewport(cdp, 390, 900);
  await driver.waitFor(`document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-rail-layout") === "bottom"`);
  await driver.evaluate(`new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))`);
  await sleep(40);
  const afterBreakpoint = await driver.evaluate(`(() => ({
    sameTray: window.__railMotionTray === document.querySelector(".marking-rail-tray"),
    additions: window.__railMotionAdditions,
    starts: window.__railMotionStarts?.length ?? -1,
    layout: document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-rail-layout") ?? null,
    running: document.getAnimations({ subtree: true }).filter((animation) => {
      const target = animation.effect?.target;
      return animation instanceof CSSAnimation
        && animation.animationName.startsWith("marking-rail-")
        && target instanceof Element
        && Boolean(target.closest('[data-marking-surface="rail"]'))
        && (animation.playState === "running" || animation.playState === "pending");
    }).length,
  }))()`);
  assert.deepEqual(
    afterBreakpoint,
    { sameTray: true, additions: 0, starts: entranceStarts, layout: "bottom", running: 0 },
    "cross-breakpoint resize replayed or remounted Rail motion",
  );

  await setTheme(driver, "dark");
  await driver.evaluate(`new Promise((resolvePromise) => requestAnimationFrame(resolvePromise))`);
  await sleep(40);
  const afterTheme = await driver.evaluate(`(() => {
    window.__railMotionObserver?.disconnect();
    const host = document.querySelector('[data-marking-surface="rail"]');
    if (host && window.__railMotionStartListener) {
      host.removeEventListener("animationstart", window.__railMotionStartListener, true);
    }
    const result = {
      sameTray: window.__railMotionTray === document.querySelector(".marking-rail-tray"),
      additions: window.__railMotionAdditions,
      starts: window.__railMotionStarts?.length ?? -1,
      running: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return animation instanceof CSSAnimation
          && animation.animationName.startsWith("marking-rail-")
          && target instanceof Element
          && Boolean(target.closest('[data-marking-surface="rail"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
    delete window.__railMotionTray;
    delete window.__railMotionAdditions;
    delete window.__railMotionObserver;
    delete window.__railMotionStarts;
    delete window.__railMotionStartListener;
    return result;
  })()`);
  assert.deepEqual(afterTheme, { sameTray: true, additions: 0, starts: entranceStarts, running: 0 }, "theme change replayed or remounted Rail motion");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-rail-tray-mode="connect"]')`);
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
  assert.ok(dom && Number.isFinite(dom.documents) && Number.isFinite(dom.nodes) && Number.isFinite(dom.jsEventListeners), "CDP returned invalid DOM memory counters");
  assert.ok(Number.isFinite(usedHeap), "CDP returned an invalid renderer heap size");
  return { dom, usedHeap };
}

async function runRailStressBatch(driver, cycles) {
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
      if (!row || !span || !container) throw new Error("Rail stress fixture missing");
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
      if (startOffset < 0 || !start || !end) throw new Error("Rail stress phrase absent");
      span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    };
    for (let cycle = 0; cycle < ${cycles}; cycle += 1) {
      const path = cycle % 5;
      if (path === 0 || path === 4) {
        await select();
        await waitUntil(
          () => Boolean(document.querySelector('[data-marking-surface="rail"] [data-rail-tray-mode="intent"]')),
          "Rail stress selection tray did not mount",
        );
      }
      if (path === 0) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        await waitUntil(() => !document.querySelector(".marking-rail-tray"), "Rail stress selection tray did not unmount");
      } else if (path === 1 || path === 2) {
        const tool = path === 1 ? "wash" : "connect";
        document.querySelector('[data-rail-tool="' + tool + '"]')?.click();
        await waitUntil(
          () => Boolean(document.querySelector('[data-rail-tray-mode="' + tool + '"]')),
          "Rail stress tool tray did not mount: " + tool,
        );
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        await waitUntil(() => !document.querySelector(".marking-rail-tray"), "Rail stress tool tray did not unmount: " + tool);
      } else if (path === 3) {
        document.querySelector('[data-rail-tool="wash"]')?.click();
        await waitUntil(() => Boolean(document.querySelector('[data-rail-tray-mode="wash"]')), "Rail stress wash tray did not mount");
        document.querySelector('[data-rail-tray-mode="wash"] [data-pigment="blue"]')?.click();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "wash:blue"
            && Boolean(document.querySelector(".marking-rail-status")),
          "Rail stress carried wash status did not mount",
        );
        document.querySelector(".marking-rail-put-down")?.click();
        await waitUntil(
          () => document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false"
            && !document.querySelector(".marking-rail-status"),
          "Rail stress carried wash did not clear",
        );
      } else {
        const connectIntent = [...document.querySelectorAll(".marking-rail-intents .marking-intent")]
          .find((button) => button.querySelector("strong")?.textContent?.trim() === "Connect");
        connectIntent?.click();
        await waitUntil(() => Boolean(document.querySelector('[data-rail-tray-mode="connect"]')), "Rail stress connection tray did not mount");
        document.querySelector('[data-rail-tray-mode="connect"] [data-relationship-kind="series"]')?.click();
        await waitUntil(() => Boolean(document.querySelector("[data-authoring-draft]")), "Rail stress authoring draft did not mount");
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        await waitUntil(
          () => !document.querySelector("[data-authoring-draft]") && !document.querySelector(".marking-session"),
          "Rail stress authoring draft did not cancel",
        );
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        await waitUntil(
          () => document.querySelector('[data-marking-surface="rail"]')?.getAttribute("data-tool-armed") === "false",
          "Rail stress carried connection did not clear",
        );
      }
      await frame();
      await frame();
    }
    getSelection()?.removeAllRanges();
    await frame();
    await frame();
    return {
      trays: document.querySelectorAll('[data-marking-surface="rail"] .marking-rail-tray').length,
      hosts: document.querySelectorAll('[data-marking-surface="rail"]').length,
      rails: document.querySelectorAll('[data-marking-surface="rail"] .marking-rail').length,
      tools: document.querySelectorAll('[data-marking-surface="rail"] [data-rail-tool]').length,
      statuses: document.querySelectorAll('[data-marking-surface="rail"] .marking-rail-status').length,
      drafts: document.querySelectorAll('[data-authoring-draft]').length,
      activeMarkingAnimations: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="rail"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);
}

async function assertWarmPlateau(driver, cdp) {
  const expected = { trays: 0, hosts: 1, rails: 1, tools: 4, statuses: 0, drafts: 0, activeMarkingAnimations: 0 };
  const authoredBefore = await rangeCounts(driver);
  // Highlight failure probes may still own app-level notices when this late
  // gate begins. Establish the same terminal UI before both warm batches so
  // notice expiry cannot masquerade as a retained-DOM delta.
  await driver.waitFor(`!document.querySelector(".toast")`, 12_000);
  await settle(driver, true);
  const firstBatch = await runRailStressBatch(driver, STRESS_CYCLES);
  await settle(driver);
  const firstMemory = await collectRendererMemory(cdp);
  const secondBatch = await runRailStressBatch(driver, STRESS_CYCLES);
  await settle(driver);
  const secondMemory = await collectRendererMemory(cdp);
  assert.deepEqual(firstBatch, expected, "first warm Rail batch retained transient state");
  assert.deepEqual(secondBatch, expected, "second warm Rail batch retained transient state");
  assert.deepEqual(await rangeCounts(driver), authoredBefore, "warm Rail lifecycle stress mutated authored records");
  assert.deepEqual(secondMemory.dom, firstMemory.dom, "Rail cycles retained DOM documents, nodes, or listeners");
  const heapGrowth = secondMemory.usedHeap - firstMemory.usedHeap;
  assert.ok(heapGrowth <= MAX_WARM_HEAP_GROWTH, `second Rail batch retained ${heapGrowth} heap bytes`);
  return { heapGrowth, dom: secondMemory.dom };
}

function failureClassification(error, context) {
  if (error?.code === "ELECTRON_RENDERER_BOOTSTRAP_FAILED") return "renderer-bootstrap-failure";
  if (error?.code === "ELECTRON_LAUNCH_BLOCKED" || context.phase === "launch") return "electron-launch-blocked";
  return "rail-contract-failure";
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
      renderer = await driver.evaluate(`(() => ({
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
        rail: document.querySelector('[data-marking-surface="rail"]')?.outerHTML?.slice(0, 16000) ?? null,
        draft: document.querySelector("[data-authoring-draft]")?.outerHTML?.slice(0, 6000) ?? null,
        stage: document.querySelector(".scripture-reading-stage")?.getBoundingClientRect().toJSON?.() ?? null,
        activeElement: document.activeElement?.outerHTML?.slice(0, 2000) ?? null,
      }))()`);
    } catch (stateError) {
      renderer = { stateError: String(stateError) };
    }
  }
  writeFileSync(statePath, `${JSON.stringify({
    classification: failureClassification(error, context),
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack, code: error.code, launchState: error.launchState }
      : String(error),
    context,
    childState,
    screenshotError,
    renderer,
    childLog,
  }, null, 2)}\n`);
  console.error(`Rail failure classification: ${failureClassification(error, context)}`);
  console.error(`Rail failure artifacts: ${screenshotPath}, ${statePath}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-marking-rail-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const highlightsLog = join(libraryPath, "annotations", "highlights.jsonl");
const connectionsLog = join(libraryPath, "annotations", "connections.jsonl");
const port = 10_600 + Math.floor(Math.random() * 500);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = {
  ...process.env,
  LIBRARY_PATH: libraryPath,
  SCRIPTURE_QA_DROP_CONNECTION_RESPONSES: "create",
};
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
let failureContext = { phase: "launch" };
let gatePassed = false;
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
      if (!text(fixture.verse).includes(fixture.quote)) throw new Error("fixture quote is absent: " + fixture.quote);
    }
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
      sidebarCollapsed: true,
      marginVisible: false,
      markingSurface: "rail",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return true;
  })()`);
  assert.equal(fixtureReady, true, "Rail fixture setup failed");

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="rail"] .marking-rail'))`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === "light"`);
  await driver.waitFor(`!document.querySelector(".living-margin")`);
  await setMedia(cdp);
  assert.deepEqual(await rangeCounts(driver), { highlights: 0, connections: 0 }, "isolated Rail library was not empty");
  failureContext = { phase: "renderer-ready" };

  if (CONNECTION_RETRY_ONLY) {
    await setViewport(cdp, 860, 900);
    await ensureRailResting(driver, cdp);
    failureContext = { phase: "completed-connection-response-loss" };
    await assertCompletedConnectionIntegration(driver, cdp, connectionsLog);
    console.log("PASS Pen Rail response-loss Retry: one committed Series event, retained held phrases, zero duplicate append");
  } else {
  const reports = [];
  for (const theme of THEMES) {
    await setViewport(cdp, 1280, 900);
    await setTheme(driver, theme);
    for (const viewport of VIEWPORTS) {
      failureContext = { phase: "matrix", theme, viewport };
      await setViewport(cdp, viewport.width, viewport.height);
      await ensureRailResting(driver, cdp);
      await openSelectionIntent(driver);
      const report = await driver.evaluate(railMatrixReportExpression());
      failureContext = { phase: "matrix", theme, viewport, report };
      assertRailMatrixReport(report, theme, viewport);
      reports.push({ theme, ...viewport, layout: report.layout, stage: report.stageRect });
      console.log(
        `${THEME_LABELS.get(theme).padEnd(11)} ${viewport.label.padStart(8)}  `
        + `${report.layout.padEnd(6)}  4 tools + 6 connect + 5 wash + Sky status  overflow 0`,
      );
      await dismissSelection(driver, cdp);
      await assertSkyStatusInCell(driver, cdp, theme, viewport);
    }
  }
  const expectedMatrixKeys = THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => `${theme}:${viewport.label}`));
  const actualMatrixKeys = reports.map((report) => `${report.theme}:${report.label}`);
  assert.equal(reports.length, THEMES.length * VIEWPORTS.length, "Pen Rail matrix did not execute every declared cell");
  assert.deepEqual(actualMatrixKeys, expectedMatrixKeys, "Pen Rail matrix executed the wrong theme/viewport keys");

  failureContext = { phase: "aesthetic-proofs" };
  await captureRailAestheticProofs(driver, cdp, successFrames);

  failureContext = { phase: "tool-trays" };
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await ensureRailResting(driver, cdp);
  await assertToolTrays(driver, cdp);

  failureContext = { phase: "toolbar-status" };
  await assertToolbarAndStatus(driver, cdp);

  failureContext = { phase: "mutation-retry" };
  await assertRailMutationFlows(driver, cdp, highlightsLog);

  failureContext = { phase: "authoring-draft" };
  await assertAuthoringDraft(driver, cdp);

  failureContext = { phase: "reduced-motion" };
  await assertReducedMotion(driver, cdp);

  failureContext = { phase: "forced-colors" };
  await assertForcedColors(driver, cdp);

  failureContext = { phase: "motion-replay" };
  await assertNoMotionReplay(driver, cdp);

  failureContext = { phase: "warm-plateau" };
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await ensureRailResting(driver, cdp);
  const plateau = await assertWarmPlateau(driver, cdp);

  failureContext = { phase: "completed-connection" };
  await assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames);
  assert.equal(successFrames.length, 5, "Pen Rail proof set did not capture all five representative states");
  assert.equal(new Set(successFrames.map((frame) => frame.name)).size, successFrames.length, "Pen Rail proof names were not unique");

  console.log("PASS Pen Rail keyboard: one four-tool roving path, grouped choice browsing, Escape focus return");
  console.log("PASS Pen Rail mutations: real Highlight/armed auto-apply/Note/Erase with one-shot failure retention and explicit retry");
  console.log("PASS Pen Rail paint: exact authoring emphasis with 0 draft route/underline/contact/hit/tick");
  console.log("PASS Pen Rail connection: durable two-phrase Series, zero dormant lines, one selected bracket, Living Margin card, quiet release");
  console.log("PASS Pen Rail media: reduced motion terminal, forced colors A/G/S/R/V and visible focus");
  console.log("PASS Pen Rail motion: no tray remount or animation replay after same-layout, cross-breakpoint, or theme change");
  console.log("PASS Pen Rail proofs: Paper/Ink rest + exact raw-selection open + selected connection");
  console.log(`PASS Pen Rail warm plateau: ${STRESS_CYCLES * 2} selection cycles, stable DOM/listeners, heap delta ${plateau.heapGrowth} bytes`);
  console.log(`PASS marking Pen Rail: ${reports.length}/20 theme-viewport cells`);
  }
  gatePassed = true;
} catch (error) {
  await captureFailure(cdp, driver, error, failureContext, childLog, childState);
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) {
    await setMedia(cdp).catch(() => undefined);
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    cdp.ws.close();
  }
  if (!childState.exited) child.kill("SIGTERM");
  await sleep(400);
  rmSync(qaRoot, { recursive: true, force: true });
  if (gatePassed) {
    if (!CONNECTION_RETRY_ONLY) writeSuccessScreenshots(successFrames);
    rmSync(FAILURE_SCREENSHOT_PATH, { force: true });
    rmSync(FAILURE_STATE_PATH, { force: true });
  }
}
