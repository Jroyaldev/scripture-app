/**
 * Permanent visual/interaction gate for the production marking Radial.
 *
 * Runs the real Electron renderer against an isolated profile and library.
 * The exact 20-cell matrix derives wheel/sheet geometry from the Radial's own
 * reading stage. Focused probes cover its vocabulary, modal keyboard
 * ownership, neutral resting material, real mutation and connection seams,
 * media fallbacks, and two warm lifecycle batches. User data is never touched.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  { width: 390, height: 900, label: "390x900", expectedLayout: "sheet" },
  { width: 640, height: 900, label: "640x900", expectedLayout: "sheet" },
  { width: 860, height: 900, label: "860x900", expectedLayout: "wheel" },
  { width: 1280, height: 900, label: "1280x900", expectedLayout: "wheel" },
  { width: 860, height: 420, label: "860x420", expectedLayout: "sheet" },
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
const RELATIONSHIP_DESCRIPTIONS = [
  "The same thought, said again in other words.",
  "Two things set against each other.",
  "A word or phrase that returns from earlier.",
  "Paired halves that answer each other in order.",
  "A phrase or idea recurring as a refrain.",
  "One line that turns or weighs both sides.",
];
const PIGMENTS = ["yellow", "green", "blue", "pink", "purple"];
const PIGMENT_LABELS = ["Amber", "Sage", "Sky", "Rose", "Violet"];
const PIGMENT_DESCRIPTIONS = [
  "A warm amber wash.",
  "A quiet sage wash.",
  "A clear sky wash.",
  "A restrained rose wash.",
  "A soft violet wash.",
];
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
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FAILURE_DIR = resolve("output/playwright");
const FAILURE_SCREENSHOT_PATH = join(FAILURE_DIR, "marking-radial-failure.png");
const FAILURE_STATE_PATH = join(FAILURE_DIR, "marking-radial-failure.json");
const SUCCESS_PROOF_PREFIX = "marking-radial-proof-";
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out opening the Radial QA CDP socket"));
    }, 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Radial QA CDP socket failed during connection"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      reject(new Error("Radial QA CDP socket closed during connection"));
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
  ws.onclose = () => rejectPending(new Error("CDP socket closed while a Radial QA command was pending"));
  ws.onerror = () => rejectPending(new Error("CDP socket failed while a Radial QA command was pending"));
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
      const page = pages.find((candidate) => candidate.title === "Scripture Library");
      if (page) return page;
    } catch {
      // The isolated Electron process may still be opening its debug socket.
    }
    await sleep(120);
  }
  if (observedTitles.length > 0) {
    const error = new Error(`Renderer debug target appeared without Scripture Library: ${observedTitles.join(", ")}`);
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
    // The warm-plateau probe deliberately forces renderer GC. Chromium may
    // otherwise collect the very next pending Runtime.evaluate promise before
    // CDP observes its settlement. Keep exactly the current evaluation rooted;
    // the next call replaces it, so this does not accumulate stress state.
    const rootedExpression = `globalThis.__radialQaPendingEvaluation = Promise.resolve(${expression})`;
    const response = await cdp.send("Runtime.evaluate", {
      expression: rootedExpression,
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
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function movePointerAway(cdp) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, button: "none" });
  await sleep(180);
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

async function waitForRadialTerminal(driver) {
  await settle(driver);
  await driver.waitFor(`(() => {
    for (const animation of document.getAnimations({ subtree: true })) {
      const target = animation.effect?.target;
      if (animation instanceof CSSAnimation
        && target instanceof Element
        && target.closest('[data-marking-surface="radial"]')
        && (animation.playState === "running" || animation.playState === "pending")) return false;
    }
    return true;
  })()`);
}

async function openRadial(driver, spec = FIXTURE.phrase, reduced = false) {
  const selected = await driver.evaluate(selectPhraseExpression(spec));
  assert.equal(selected, spec.quote, `native selection drifted for ${spec.quote}`);
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const radial = root?.querySelector(".marking-radial");
    const first = root?.querySelector('[data-relationship-kind="link:parallel"]');
    return Boolean(root && radial?.classList.contains("is-placed") && first
      && getComputedStyle(radial).visibility === "visible"
      && radial.getBoundingClientRect().width > 0
      && document.activeElement === first);
  })()`);
  if (reduced) await settle(driver, true);
  else await waitForRadialTerminal(driver);
}

async function dismissRadial(driver, cdp, verse = FIXTURE.phrase.verse) {
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === ${JSON.stringify(String(verse))}`);
  await settle(driver, true);
}

async function captureRadialAestheticProofs(driver, cdp, frames) {
  await setMedia(cdp);
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await driver.evaluate(`(() => {
    getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);
  await movePointerAway(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-radial-proof-paper-rest.png");

  await openRadial(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await movePointerAway(cdp);
  await bufferSuccessScreenshot(cdp, frames, "marking-radial-proof-paper-open.png");
  await dismissRadial(driver, cdp);

  await setTheme(driver, "dark");
  await driver.evaluate(`getSelection()?.removeAllRanges()`);
  await movePointerAway(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-radial-proof-ink-rest.png");

  await openRadial(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await movePointerAway(cdp);
  await bufferSuccessScreenshot(cdp, frames, "marking-radial-proof-ink-open.png");
  await dismissRadial(driver, cdp);
  await setTheme(driver, "light");
}

function radialMatrixReportExpression() {
  return `(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const radial = root?.querySelector(".marking-radial");
    const scrim = root?.querySelector(".marking-radial-scrim");
    const stage = document.querySelector(".scripture-reading-stage");
    const hub = radial?.querySelector(".marking-radial-hub");
    const helpCard = radial?.querySelector(".marking-radial-help-card");
    const keep = radial?.querySelector(".marking-radial-keep");
    const close = radial?.querySelector(".marking-radial-close");
    const cardActions = [...(radial?.querySelectorAll(".marking-radial-card-actions button") ?? [])];
    const hubStyle = hub ? getComputedStyle(hub) : null;
    const helpStyle = helpCard ? getComputedStyle(helpCard) : null;
    const relationships = [...(radial?.querySelectorAll("[data-relationship-kind]") ?? [])];
    const pigments = [...(radial?.querySelectorAll("[data-pigment]") ?? [])];
    const commands = [...relationships, ...pigments];
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
    const overflow = (element) => element ? Math.max(0, element.scrollWidth - element.clientWidth) : null;
    const stageRect = rect(stage);
    const radialRect = rect(radial);
    const scrimRect = rect(scrim);
    const selection = getSelection();
    const selectionRect = selection?.rangeCount ? rect(selection.getRangeAt(0)) : null;
    const layout = root?.getAttribute("data-radial-layout") ?? null;
    const focusXRaw = root?.style.getPropertyValue("--mark-radial-focus-x") ?? "";
    const focusYRaw = root?.style.getPropertyValue("--mark-radial-focus-y") ?? "";
    const focusX = Number.parseFloat(focusXRaw);
    const focusY = Number.parseFloat(focusYRaw);
    const scrimBackground = scrim ? getComputedStyle(scrim).backgroundImage : null;
    let scrimFocusProbe = null;
    if (root && scrim && layout === "wheel") {
      root.style.setProperty("--mark-radial-focus-x", "1px");
      root.style.setProperty("--mark-radial-focus-y", "2px");
      const probedBackground = getComputedStyle(scrim).backgroundImage;
      root.style.setProperty("--mark-radial-focus-x", focusXRaw);
      root.style.setProperty("--mark-radial-focus-y", focusYRaw);
      scrimFocusProbe = {
        changed: probedBackground !== scrimBackground,
        // Chromium may normalize absolute gradient coordinates during CSSOM
        // serialization. A changed computed gradient after mutating only the
        // two focus variables is the stable proof that the variables are live.
        usedProbeCoordinates: probedBackground.includes("1px") && probedBackground.includes("2px"),
      };
    }
    const commandRects = commands.map(rect);
    const hubRect = rect(hub);
    const helpRect = rect(helpCard);
    const cardActionRects = cardActions.map(rect);
    const wheelCollision = layout === "wheel"
      ? overlapArea(radialRect, selectionRect) + overlapArea(helpRect, selectionRect)
      : 0;
    const wheelIndividualCollision = layout === "wheel"
      ? [...commandRects, hubRect, rect(keep), helpRect, ...cardActionRects]
        .reduce((total, value) => total + overlapArea(value, selectionRect), 0)
      : 0;
    const wheelStructuralOverlap = layout === "wheel"
      ? commandRects.reduce((total, value) => total + overlapArea(value, hubRect) + overlapArea(value, helpRect), 0)
        + overlapArea(hubRect, helpRect)
      : 0;
    const pairwiseCommandOverlap = commandRects.reduce((total, value, index) => (
      total + commandRects.slice(index + 1).reduce((subtotal, candidate) => subtotal + overlapArea(value, candidate), 0)
    ), 0);
    const initialActiveIndex = commands.indexOf(document.activeElement);
    const initialFocusStyle = document.activeElement instanceof HTMLElement
      ? getComputedStyle(document.activeElement)
      : null;
    const initialHelpLabel = helpCard?.querySelector("strong")?.textContent?.trim() ?? null;
    const initialHelpDescription = helpCard?.querySelector("small")?.textContent?.replace(/\\s+/g, " ").trim() ?? null;
    const neutralRelationships = relationships.filter((choice) => choice !== document.activeElement && !choice.matches(":hover"));
    const relationshipColors = neutralRelationships.map((choice) => getComputedStyle(choice).color);
    const relationshipBorders = neutralRelationships.map((choice) => getComputedStyle(choice).borderColor);
    const relationshipBackgrounds = neutralRelationships.map((choice) => getComputedStyle(choice).backgroundColor);
    const pigmentMaterials = pigments.map((choice) => {
      const swatch = choice.querySelector(".marking-pigment") ?? choice;
      const style = getComputedStyle(swatch);
      return style.backgroundImage + "|" + style.backgroundColor;
    });
    const visibleControls = [hub, helpCard, keep, close, ...commands]
      .filter((element) => {
        if (!element || element.getClientRects().length === 0) return false;
        if (layout === "wheel" || !radialRect) return true;
        const value = element.getBoundingClientRect();
        return value.bottom > radialRect.top && value.top < radialRect.bottom
          && value.right > radialRect.left && value.left < radialRect.right;
      });
    const scrollContentRect = radial && radialRect ? {
      left: radialRect.left - radial.scrollLeft,
      top: radialRect.top - radial.scrollTop,
      right: radialRect.left - radial.scrollLeft + radial.scrollWidth,
      bottom: radialRect.top - radial.scrollTop + radial.scrollHeight,
    } : null;
    const sheetControls = [hub, helpCard, keep, ...commands, ...cardActions].filter(Boolean);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      hostClasses: root ? [...root.classList] : [],
      material: {
        hubBackdrop: hubStyle?.backdropFilter || hubStyle?.webkitBackdropFilter || "none",
        helpBackdrop: helpStyle?.backdropFilter || helpStyle?.webkitBackdropFilter || "none",
      },
      layout,
      expectedLayout: stageRect && (stageRect.width <= 640 || stageRect.height <= 420) ? "sheet" : "wheel",
      armed: root?.getAttribute("data-tool-armed") ?? null,
      counts: {
        hosts: document.querySelectorAll('[data-marking-surface="radial"]').length,
        scrims: root?.querySelectorAll(".marking-radial-scrim").length ?? 0,
        radials: root?.querySelectorAll(".marking-radial").length ?? 0,
        hubs: root?.querySelectorAll(".marking-radial-hub").length ?? 0,
        helpCards: root?.querySelectorAll(".marking-radial-help-card").length ?? 0,
        keep: root?.querySelectorAll(".marking-radial-keep").length ?? 0,
        close: root?.querySelectorAll(".marking-radial-close").length ?? 0,
      },
      role: radial?.getAttribute("role") ?? null,
      modal: radial?.getAttribute("aria-modal") ?? null,
      label: radial?.getAttribute("aria-label") ?? null,
      stageRect,
      radialRect,
      scrimRect,
      selectionRect,
      focusField: {
        x: focusX,
        y: focusY,
        deltaX: stageRect && selectionRect ? Math.abs(focusX - ((selectionRect.left + selectionRect.right) / 2 - stageRect.left)) : null,
        deltaY: stageRect && selectionRect ? Math.abs(focusY - ((selectionRect.top + selectionRect.bottom) / 2 - stageRect.top)) : null,
        scrimBackground,
        scrimFocusProbe,
      },
      radialContained: contained(radialRect, stageRect),
      scrimDelta: stageRect && scrimRect ? {
        left: Math.abs(scrimRect.left - stageRect.left),
        top: Math.abs(scrimRect.top - stageRect.top),
        right: Math.abs(scrimRect.right - stageRect.right),
        bottom: Math.abs(scrimRect.bottom - stageRect.bottom),
      } : null,
      visibleControlsContained: visibleControls.every((element) => contained(rect(element), stageRect)),
      wheelChildrenContained: layout !== "wheel" || [hub, keep, ...commands].every((element) => contained(rect(element), radialRect)),
      helpContained: contained(helpRect, stageRect),
      helpActionsContained: cardActions.every((element) => contained(rect(element), helpRect)),
      sheetControlsContained: layout !== "sheet" || sheetControls.every((element) => contained(rect(element), scrollContentRect)),
      sheetControlsHorizontalContained: layout !== "sheet" || sheetControls.every((element) => {
        const value = rect(element);
        return Boolean(value && radialRect
          && value.left >= radialRect.left - ${GEOMETRY_EPSILON}
          && value.right <= radialRect.right + ${GEOMETRY_EPSILON});
      }),
      commandSizes: commands.map((command) => {
        const style = getComputedStyle(command);
        return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
      }),
      pairwiseCommandOverlap,
      wheelCollision,
      wheelIndividualCollision,
      wheelStructuralOverlap,
      sheet: radialRect && stageRect ? {
        leftInset: radialRect.left - stageRect.left,
        rightInset: stageRect.right - radialRect.right,
        bottomInset: stageRect.bottom - radialRect.bottom,
        maxHeight: stageRect.height - 10,
        expectedWidth: Math.min(420, stageRect.width - 16),
        centerDelta: Math.abs((radialRect.left + radialRect.width / 2) - (stageRect.left + stageRect.width / 2)),
        overflowY: radial ? getComputedStyle(radial).overflowY : null,
      } : null,
      relationshipIds: relationships.map((choice) => choice.dataset.relationshipKind),
      relationshipLabels: relationships.map((choice) => choice.getAttribute("aria-label")),
      relationshipTitles: relationships.map((choice) => choice.getAttribute("title")),
      pigmentIds: pigments.map((choice) => choice.dataset.pigment),
      pigmentLabels: pigments.map((choice) => choice.getAttribute("aria-label")),
      pigmentTitles: pigments.map((choice) => choice.getAttribute("title")),
      commandTabStops: commands.map((choice, index) => choice.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      initialActiveIndex,
      initialFocus: {
        mode: root?.getAttribute("data-focus-ring") ?? null,
        outlineStyle: initialFocusStyle?.outlineStyle ?? null,
      },
      range: radial?.querySelector(".marking-radial-range")?.textContent?.trim() ?? null,
      helpLabel: initialHelpLabel,
      helpDescription: initialHelpDescription,
      keepPressed: keep?.getAttribute("aria-pressed") ?? null,
      closeLabel: close?.getAttribute("aria-label") ?? null,
      nativeSelection: selection?.toString() ?? "",
      neutralRelationshipCount: neutralRelationships.length,
      relationshipColors,
      relationshipBorders,
      relationshipBackgrounds,
      pigmentMaterials,
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
        radial: layout === "sheet" ? overflow(radial) : 0,
      },
    };
  })()`;
}

function assertRadialMatrixReport(report, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  assert.deepEqual(report.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport drifted`);
  assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
  assert.ok(report.hostClasses.includes(`theme-${theme}`), `${label}: portaled Radial lost its own theme class`);
  assert.equal(report.hostClasses.includes("dark"), theme === "dark" || theme === "dark-glass", `${label}: portaled Radial dark material class drifted`);
  if (theme === "glass" || theme === "dark-glass") {
    assert.notEqual(report.material.hubBackdrop, "none", `${label}: Glass hub lost its backdrop material`);
    assert.notEqual(report.material.helpBackdrop, "none", `${label}: Glass help card lost its backdrop material`);
  } else {
    assert.equal(report.material.hubBackdrop, "none", `${label}: non-Glass hub inherited a backdrop filter`);
    assert.equal(report.material.helpBackdrop, "none", `${label}: non-Glass help inherited a backdrop filter`);
  }
  assert.equal(report.layout, report.expectedLayout, `${label}: layout ignored the Radial's own stage dimensions`);
  assert.equal(report.layout, viewport.expectedLayout, `${label}: declared wheel/sheet matrix drifted`);
  assert.equal(report.armed, "false", `${label}: fresh Radial inherited a stale tool`);
  assert.deepEqual(report.counts, { hosts: 1, scrims: 1, radials: 1, hubs: 1, helpCards: 1, keep: 1, close: 1 }, `${label}: Radial anatomy drifted`);
  assert.equal(report.role, "dialog", `${label}: Radial lost its dialog role`);
  assert.equal(report.modal, "true", `${label}: Radial lost modal keyboard ownership`);
  assert.equal(report.label, "Radial marking menu", `${label}: Radial accessible label drifted`);
  assert.equal(report.radialContained, true, `${label}: Radial escaped its own reading stage`);
  assert.ok(report.scrimDelta, `${label}: Radial lost comparable stage/scrim geometry`);
  for (const [edge, delta] of Object.entries(report.scrimDelta)) {
    assert.ok(delta <= GEOMETRY_EPSILON, `${label}: scrim ${edge} missed the stage by ${delta}px`);
  }
  assert.ok(Number.isFinite(report.focusField.x) && Number.isFinite(report.focusField.y), `${label}: scrim focus variables were not numeric`);
  assert.ok(report.focusField.deltaX != null && report.focusField.deltaX <= GEOMETRY_EPSILON, `${label}: scrim focus x missed the selected words by ${report.focusField.deltaX}px`);
  assert.ok(report.focusField.deltaY != null && report.focusField.deltaY <= GEOMETRY_EPSILON, `${label}: scrim focus y missed the selected words by ${report.focusField.deltaY}px`);
  assert.equal(report.visibleControlsContained, true, `${label}: a visible Radial control escaped the reading stage`);
  assert.equal(report.helpContained, true, `${label}: Radial help escaped the reading stage`);
  assert.equal(report.helpActionsContained, true, `${label}: a help-card action escaped its card`);
  assert.equal(report.sheetControlsContained, true, `${label}: a sheet control escaped its scroll content`);
  assert.equal(report.sheetControlsHorizontalContained, true, `${label}: a sheet control escaped horizontally`);
  assert.deepEqual(report.relationshipIds, RELATIONSHIPS, `${label}: relationship vocabulary drifted`);
  assert.deepEqual(report.relationshipTitles, RELATIONSHIP_DESCRIPTIONS, `${label}: relationship descriptions drifted`);
  assert.deepEqual(report.pigmentIds, PIGMENTS, `${label}: pigment vocabulary drifted`);
  assert.deepEqual(report.pigmentTitles, PIGMENT_DESCRIPTIONS, `${label}: pigment descriptions drifted`);
  assert.deepEqual(report.relationshipLabels, RELATIONSHIP_LABELS, `${label}: relationship labels drifted`);
  assert.deepEqual(report.pigmentLabels, PIGMENT_LABELS.map((name) => `${name} highlight`), `${label}: pigment labels drifted`);
  assert.deepEqual(report.commandTabStops, [0], `${label}: Radial must expose one flat roving command stop`);
  assert.equal(report.initialActiveIndex, 0, `${label}: initial focus did not reach Parallelism`);
  assert.deepEqual(report.initialFocus, {
    mode: "pointer",
    outlineStyle: "none",
  }, `${label}: synthetic pointer selection exposed an accent edge on the auto-focused petal`);
  assert.equal(report.range, `${FIXTURE.displayBook} ${FIXTURE.chapter}:${FIXTURE.phrase.verse}`, `${label}: exact reference drifted`);
  assert.equal(report.helpLabel, RELATIONSHIP_LABELS[0], `${label}: initial help did not follow Parallelism focus`);
  assert.equal(report.helpDescription, RELATIONSHIP_DESCRIPTIONS[0], `${label}: initial relationship help drifted`);
  assert.equal(report.keepPressed, "false", `${label}: Keep inherited stale state`);
  assert.equal(report.closeLabel, "Close radial menu", `${label}: Close label drifted`);
  assert.equal(report.nativeSelection, FIXTURE.phrase.quote, `${label}: Radial lost the exact native selection`);
  assert.equal(report.neutralRelationshipCount, 5, `${label}: neutral-rest sample was contaminated by focus or hover`);
  assert.equal(new Set(report.relationshipColors).size, 1, `${label}: relationships leaked permanent semantic color at rest`);
  assert.equal(new Set(report.relationshipBorders).size, 1, `${label}: relationships leaked semantic border color at rest`);
  assert.equal(new Set(report.relationshipBackgrounds).size, 1, `${label}: relationships leaked semantic background color at rest`);
  assert.equal(new Set(report.pigmentMaterials).size, PIGMENTS.length, `${label}: pigment samples lost their five visible hues`);
  assert.deepEqual(report.authoredPaint, { drafts: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 0 }, `${label}: opening Radial painted authored artifacts`);
  assert.ok(report.pairwiseCommandOverlap <= GEOMETRY_EPSILON, `${label}: Radial commands overlap by ${report.pairwiseCommandOverlap}px²`);
  if (report.layout === "wheel") {
    assert.equal(report.focusField.scrimFocusProbe?.changed, true, `${label}: wheel scrim gradient did not consume the selection focus variables`);
    assert.ok(Math.abs(report.radialRect.width - 320) <= GEOMETRY_EPSILON, `${label}: wheel width drifted to ${report.radialRect.width}px`);
    assert.ok(Math.abs(report.radialRect.height - 320) <= GEOMETRY_EPSILON, `${label}: wheel height drifted to ${report.radialRect.height}px`);
    for (const [index, size] of report.commandSizes.entries()) {
      assert.ok(size && Math.abs(size.width - 46) <= GEOMETRY_EPSILON && Math.abs(size.height - 46) <= GEOMETRY_EPSILON, `${label}: wheel command ${index} drifted from 46px`);
    }
    assert.equal(report.wheelChildrenContained, true, `${label}: a petal, hub, or Keep control escaped the wheel`);
    assert.ok(report.wheelCollision <= GEOMETRY_EPSILON, `${label}: wheel controls cover ${report.wheelCollision}px² of the selected words`);
    assert.ok(report.wheelIndividualCollision <= GEOMETRY_EPSILON, `${label}: an escaped wheel child covers ${report.wheelIndividualCollision}px² of the selected words`);
    assert.ok(report.wheelStructuralOverlap <= GEOMETRY_EPSILON, `${label}: wheel children overlap the hub or help by ${report.wheelStructuralOverlap}px²`);
  } else {
    assert.ok(Math.abs(report.radialRect.width - report.sheet.expectedWidth) <= GEOMETRY_EPSILON, `${label}: sheet width drifted to ${report.radialRect.width}px`);
    assert.ok(report.sheet.leftInset >= 8 - GEOMETRY_EPSILON, `${label}: sheet left inset shrank to ${report.sheet.leftInset}px`);
    assert.ok(report.sheet.rightInset >= 8 - GEOMETRY_EPSILON, `${label}: sheet right inset shrank to ${report.sheet.rightInset}px`);
    assert.ok(report.sheet.centerDelta <= GEOMETRY_EPSILON, `${label}: sheet is ${report.sheet.centerDelta}px off stage center`);
    assert.ok(Math.abs(report.sheet.bottomInset) <= GEOMETRY_EPSILON, `${label}: sheet bottom edge missed the stage by ${report.sheet.bottomInset}px`);
    assert.ok(report.radialRect.height <= report.sheet.maxHeight + GEOMETRY_EPSILON, `${label}: sheet exceeded its stage height`);
    assert.match(report.sheet.overflowY ?? "", /auto|scroll/, `${label}: sheet lost its own vertical scroll owner`);
  }
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
      notes: result.notes.length,
    };
  })()`);
}

async function waitForActiveHighlightCount(driver, count) {
  await driver.waitFor(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.highlights.filter((record) => record.deleted === 0).length === ${count};
  })()`);
}

async function expectedPhrasePayload(driver, spec) {
  return driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    const text = chapter?.verses.find((item) => item.verse === spec.verse)?.text ?? "";
    const charStart = text.indexOf(spec.quote);
    if (charStart < 0) throw new Error("missing exact payload fixture: " + spec.quote);
    return {
      book: "ACT",
      chapter: 19,
      verse_start: spec.verse,
      verse_end: spec.verse,
      package: "bsb",
      char_start: charStart,
      char_end: charStart + spec.quote.length,
    };
  })()`);
}

async function expectedConnectionAnchor(driver, spec) {
  return driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    const text = chapter?.verses.find((item) => item.verse === spec.verse)?.text ?? "";
    const charStart = text.indexOf(spec.quote);
    if (charStart < 0) throw new Error("missing exact connection fixture: " + spec.quote);
    const capture = await window.api.library.captureConnectionSelection("bsb", [{
      book: "ACT",
      chapter: 19,
      verse: spec.verse,
      char_start: charStart,
      char_end: charStart + spec.quote.length,
      quote: spec.quote,
    }]);
    if (!capture.ok || capture.status !== "exact") {
      throw new Error("Radial exact-anchor capture refused: " + JSON.stringify(capture));
    }
    return capture.anchor;
  })()`);
}

async function waitForRenderedBlueHighlights(driver, count) {
  const selector = '.hl-blob[data-highlight-color="blue"]:not(.hl-fade-out)';
  await driver.waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length === ${count}`);
  await driver.waitFor(`(() => {
    const paths = [...document.querySelectorAll(${JSON.stringify(selector)})];
    if (paths.length !== ${count} || paths.some((path) => path.classList.contains("hl-sweep"))) return false;
    return !document.getAnimations({ subtree: true }).some((animation) => {
      const target = animation.effect?.target;
      return target instanceof Element
        && target.matches(${JSON.stringify(selector)})
        && (animation.playState === "running" || animation.playState === "pending");
    });
  })()`, 4_000);
  await driver.evaluate(`new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))`);
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

async function clickRadialChoice(driver, selector, description) {
  const clicked = await driver.evaluate(`(() => {
    const choice = document.querySelector(${JSON.stringify(`[data-marking-surface="radial"] ${selector}`)});
    if (!choice) return false;
    choice.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Radial lost ${description}`);
}

async function clickRadialAction(driver, accessibleLabel) {
  const clicked = await driver.evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-marking-surface="radial"] button')]
      .find((candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(accessibleLabel)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Radial lost ${accessibleLabel}`);
}

async function assertRealPointerPressPreservesSelection(driver, cdp, selector, quote) {
  const point = await driver.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(`[data-marking-surface="radial"] ${selector}`)});
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: Boolean(hit && (hit === target || target.contains(hit))) };
  })()`);
  assert.ok(point?.hit, `Radial pointer target ${selector} is not hit-test reachable`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  assert.equal(await driver.evaluate(`getSelection()?.toString() ?? ""`), quote, `Radial pointer-down on ${selector} collapsed the native selection`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, button: "left" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1, y: 1, button: "left", clickCount: 1 });
  assert.equal(await driver.evaluate(`getSelection()?.toString() ?? ""`), quote, `Radial pointer release after ${selector} changed the native selection`);
}

async function putDownRadialTool(driver) {
  const clicked = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const button = [...(root?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.textContent?.trim() === "Put tool down");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, "Radial armed status lost Put tool down");
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);
}

async function assertSheetReachability(driver, cdp, viewport) {
  await setViewport(cdp, viewport.width, viewport.height);
  await openRadial(driver);
  const report = await driver.evaluate(`(async () => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const radial = root?.querySelector(".marking-radial");
    const stage = document.querySelector(".scripture-reading-stage");
    const selectors = [
      '[data-relationship-kind="hinge"]',
      '[data-pigment="purple"]',
      '.marking-radial-keep',
      'button[aria-label="Add note"]',
      '.marking-radial-close',
    ];
    const results = [];
    for (const selector of selectors) {
      const target = radial?.querySelector(selector);
      if (!target) {
        results.push({ selector, missing: true });
        continue;
      }
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
      const value = target.getBoundingClientRect();
      const stageRect = stage?.getBoundingClientRect();
      const radialRect = radial?.getBoundingClientRect();
      const x = Math.min(value.right - 1, Math.max(value.left + 1, value.left + value.width / 2));
      const y = Math.min(value.bottom - 1, Math.max(value.top + 1, value.top + value.height / 2));
      const hit = document.elementFromPoint(x, y);
      results.push({
        selector,
        missing: false,
        width: value.width,
        height: value.height,
        inStage: Boolean(stageRect
          && value.left >= stageRect.left - ${GEOMETRY_EPSILON}
          && value.top >= stageRect.top - ${GEOMETRY_EPSILON}
          && value.right <= stageRect.right + ${GEOMETRY_EPSILON}
          && value.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}),
        inPanel: Boolean(radialRect
          && value.left >= radialRect.left - ${GEOMETRY_EPSILON}
          && value.top >= radialRect.top - ${GEOMETRY_EPSILON}
          && value.right <= radialRect.right + ${GEOMETRY_EPSILON}
          && value.bottom <= radialRect.bottom + ${GEOMETRY_EPSILON}),
        hit: Boolean(hit && (hit === target || target.contains(hit))),
      });
    }
    return {
      layout: root?.getAttribute("data-radial-layout") ?? null,
      coarse: matchMedia("(pointer: coarse)").matches,
      horizontalOverflow: radial ? Math.max(0, radial.scrollWidth - radial.clientWidth) : null,
      results,
    };
  })()`);
  assert.equal(report.layout, "sheet", `${viewport.label}: reachability probe did not open a sheet`);
  assert.equal(report.coarse, true, `${viewport.label}: sheet reachability did not exercise coarse-pointer rules`);
  assert.ok(report.horizontalOverflow != null && report.horizontalOverflow <= GEOMETRY_EPSILON, `${viewport.label}: sheet overflowed horizontally`);
  for (const result of report.results) {
    assert.equal(result.missing, false, `${viewport.label}: sheet lost ${result.selector}`);
    assert.equal(result.inStage, true, `${viewport.label}: ${result.selector} escaped the stage after scrolling`);
    assert.equal(result.inPanel, true, `${viewport.label}: ${result.selector} escaped the sheet viewport after scrolling`);
    assert.equal(result.hit, true, `${viewport.label}: ${result.selector} is not hit-test reachable`);
    assert.ok(result.width >= 44 - GEOMETRY_EPSILON && result.height >= 44 - GEOMETRY_EPSILON, `${viewport.label}: ${result.selector} is only ${result.width}x${result.height}px under coarse pointer`);
  }
  await dismissRadial(driver, cdp);
}

async function assertKeyboardOwnership(driver, cdp) {
  const before = await rangeCounts(driver);
  await setViewport(cdp, 860, 900);
  await movePointerAway(cdp);
  await openRadial(driver);

  const assertCommandFocus = async (index, label, description) => {
    await driver.waitFor(`(() => {
      const choices = [...document.querySelectorAll('[data-marking-surface="radial"] [data-relationship-kind], [data-marking-surface="radial"] [data-pigment]')];
      return choices.indexOf(document.activeElement) === ${index}
        && choices.filter((choice) => choice.tabIndex === 0).length === 1
        && document.querySelector(".marking-radial-help-card strong")?.textContent?.trim() === ${JSON.stringify(label)}
        && document.querySelector(".marking-radial-help-card small")?.textContent?.trim() === ${JSON.stringify(description)};
    })()`);
  };

  await assertCommandFocus(0, RELATIONSHIP_LABELS[0], RELATIONSHIP_DESCRIPTIONS[0]);
  await pressKey(cdp, "ArrowDown", "ArrowDown", 0, 40);
  await assertCommandFocus(1, RELATIONSHIP_LABELS[1], RELATIONSHIP_DESCRIPTIONS[1]);
  const keyboardFocus = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const active = document.activeElement;
    const style = active instanceof HTMLElement ? getComputedStyle(active) : null;
    return {
      mode: root?.getAttribute("data-focus-ring") ?? null,
      kind: active instanceof HTMLElement ? active.dataset.relationshipKind ?? null : null,
      outlineStyle: style?.outlineStyle ?? null,
      outlineWidth: style?.outlineWidth ?? null,
    };
  })()`);
  assert.deepEqual(keyboardFocus, {
    mode: "keyboard",
    kind: RELATIONSHIPS[1],
    outlineStyle: "solid",
    outlineWidth: "2px",
  }, "Radial keyboard navigation did not restore the explicit focus ring");
  await pressKey(cdp, "ArrowUp", "ArrowUp", 0, 38);
  await assertCommandFocus(0, RELATIONSHIP_LABELS[0], RELATIONSHIP_DESCRIPTIONS[0]);
  await pressKey(cdp, "ArrowLeft", "ArrowLeft", 0, 37);
  await assertCommandFocus(10, PIGMENT_LABELS[4], PIGMENT_DESCRIPTIONS[4]);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await assertCommandFocus(0, RELATIONSHIP_LABELS[0], RELATIONSHIP_DESCRIPTIONS[0]);
  await pressKey(cdp, "End", "End", 0, 35);
  await assertCommandFocus(10, PIGMENT_LABELS[4], PIGMENT_DESCRIPTIONS[4]);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  for (let index = 0; index < 6; index += 1) {
    await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  }
  await assertCommandFocus(6, PIGMENT_LABELS[0], PIGMENT_DESCRIPTIONS[0]);
  await pressKey(cdp, "Home", "Home", 0, 36);
  await assertCommandFocus(0, RELATIONSHIP_LABELS[0], RELATIONSHIP_DESCRIPTIONS[0]);
  assert.deepEqual(await rangeCounts(driver), before, "Radial command browsing mutated authored records");

  const tabbableCount = await driver.evaluate(`(() => {
    const radial = document.querySelector(".marking-radial");
    return [...(radial?.querySelectorAll("button:not([disabled])") ?? [])]
      .filter((button) => button.tabIndex >= 0 && button.getClientRects().length > 0).length;
  })()`);
  assert.ok(tabbableCount >= 4, `Radial focus loop exposed only ${tabbableCount} controls`);
  for (let index = 0; index < tabbableCount; index += 1) {
    await pressKey(cdp, "Tab", "Tab", 0, 9);
    await driver.waitFor(`Boolean(document.querySelector(".marking-radial")?.contains(document.activeElement))`);
  }
  await driver.waitFor(`document.activeElement?.getAttribute("data-relationship-kind") === "link:parallel"`);
  await pressKey(cdp, "Tab", "Tab", 8, 9);
  await driver.waitFor(`document.activeElement?.classList.contains("marking-radial-close")`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === "8"`);

  // The compact sheet owns the same focus loop; Close must remain reachable
  // even when the panel itself scrolls.
  await setViewport(cdp, 390, 900);
  await movePointerAway(cdp);
  await openRadial(driver);
  const sheetTabbableCount = await driver.evaluate(`(() => {
    const radial = document.querySelector(".marking-radial");
    return [...(radial?.querySelectorAll("button:not([disabled])") ?? [])]
      .filter((button) => button.tabIndex >= 0 && button.getClientRects().length > 0).length;
  })()`);
  assert.ok(sheetTabbableCount >= 4, `Radial sheet focus loop exposed only ${sheetTabbableCount} controls`);
  for (let index = 0; index < sheetTabbableCount; index += 1) {
    await pressKey(cdp, "Tab", "Tab", 0, 9);
    await driver.waitFor(`Boolean(document.querySelector(".marking-radial")?.contains(document.activeElement))`);
  }
  await driver.waitFor(`document.activeElement?.getAttribute("data-relationship-kind") === "link:parallel"`);
  await pressKey(cdp, "Tab", "Tab", 8, 9);
  await driver.waitFor(`document.activeElement?.classList.contains("marking-radial-close")`);
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === "8"`);

  // True pointer dismissal must share Escape's focus and no-write behavior.
  await setViewport(cdp, 860, 900);
  await movePointerAway(cdp);
  await openRadial(driver);
  const scrimPoint = await driver.evaluate(`(() => {
    const scrim = document.querySelector(".marking-radial-scrim");
    const stage = document.querySelector(".scripture-reading-stage")?.getBoundingClientRect();
    if (!scrim || !stage) return null;
    const candidates = [
      { x: stage.left + 4, y: stage.top + 4 },
      { x: stage.right - 4, y: stage.top + 4 },
      { x: stage.left + 4, y: stage.bottom - 4 },
      { x: stage.right - 4, y: stage.bottom - 4 },
    ];
    return candidates.find((point) => document.elementFromPoint(point.x, point.y) === scrim) ?? null;
  })()`);
  assert.ok(scrimPoint, "Radial did not expose a true scrim pointer target");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: scrimPoint.x, y: scrimPoint.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: scrimPoint.x, y: scrimPoint.y, button: "left", clickCount: 1 });
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === "8"`);
  assert.deepEqual(await rangeCounts(driver), before, "Radial keyboard/scrim dismissal wrote authored records");
}

async function assertMutationAndArmedFlows(driver, cdp, highlightsLog) {
  const baseline = await rangeCounts(driver);
  assert.equal(baseline.highlights, 0, "Radial mutation fixture inherited highlights");
  const expectedPhrase = await expectedPhrasePayload(driver, FIXTURE.phrase);
  const expectedCounterpart = await expectedPhrasePayload(driver, FIXTURE.counterpart);

  // A blocked append must restore the exact selection and remain byte-identical
  // until the user explicitly retries the visible command.
  await openRadial(driver);
  await assertRealPointerPressPreservesSelection(driver, cdp, '[data-pigment="blue"]', FIXTURE.phrase.quote);
  const beforeFailedWash = logFingerprint(highlightsLog);
  await withWriteBlocked(highlightsLog, async () => {
    await clickRadialChoice(driver, '[data-pigment="blue"]', "Sky highlight");
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="radial"]');
      const radial = root?.querySelector(".marking-radial.is-placed");
      const help = root?.querySelector(".marking-radial-help-card");
      return root?.getAttribute("data-tool-armed") === "false"
        && radial?.getAttribute("aria-busy") === "false"
        && getComputedStyle(radial).visibility === "visible"
        && document.activeElement?.getAttribute("data-relationship-kind") === "link:parallel"
        && help?.textContent?.includes("The highlight could not be saved")
        && getSelection()?.toString() === ${JSON.stringify(FIXTURE.phrase.quote)};
    })()`);
    await sleep(300);
    assert.deepEqual(await rangeCounts(driver), baseline, "failed Radial wash retried or wrote a record");
    assert.deepEqual(logFingerprint(highlightsLog), beforeFailedWash, "failed Radial wash changed the append-only log");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeFailedWash, "Radial wash wrote after permissions were restored");
  await clickRadialChoice(driver, '[data-pigment="blue"]', "Sky retry");
  await waitForActiveHighlightCount(driver, 1);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);
  const retryRecord = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const active = result.highlights.filter((record) => record.deleted === 0);
    return active.map((record) => ({
      book: record.book,
      chapter: record.chapter,
      verse_start: record.verse_start,
      verse_end: record.verse_end,
      package: record.package,
      char_start: record.char_start,
      char_end: record.char_end,
      color: record.color,
      kind: record.kind,
    }));
  })()`);
  assert.deepEqual(retryRecord, [{ ...expectedPhrase, color: "blue", kind: "highlight" }], "Radial Sky retry lost its exact highlight payload");
  const afterWashRetry = logFingerprint(highlightsLog);
  assert.equal(afterWashRetry.lines, beforeFailedWash.lines + 1, "explicit Radial Sky retry did not append exactly one event");
  assert.ok(afterWashRetry.bytes > beforeFailedWash.bytes, "explicit Radial Sky retry did not grow the highlight log");
  assert.notEqual(afterWashRetry.sha256, beforeFailedWash.sha256, "explicit Radial Sky retry left the highlight log digest unchanged");
  await openRadial(driver);
  await clickRadialAction(driver, "Remove selected text from highlight");
  await waitForActiveHighlightCount(driver, 0);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);

  // Keep preserves the native Range, produces truthful carried-tool status,
  // and auto-applies once without flashing a Radial for the next selection.
  await openRadial(driver);
  const keepReport = await driver.evaluate(`(() => {
    const keep = document.querySelector(".marking-radial-keep");
    if (!keep) return null;
    const dispatched = keep.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    const selection = getSelection()?.toString() ?? "";
    keep.click();
    return { dispatched, selection };
  })()`);
  assert.deepEqual(keepReport, { dispatched: false, selection: FIXTURE.phrase.quote }, "Radial Keep failed to preserve the native selection on pointer down");
  await driver.waitFor(`document.querySelector(".marking-radial-keep")?.getAttribute("aria-pressed") === "true"`);
  await clickRadialChoice(driver, '[data-pigment="blue"]', "kept Sky highlight");
  await waitForActiveHighlightCount(driver, 1);
  await driver.waitFor(`(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const status = root?.querySelector('[role="status"]');
    return root?.getAttribute("data-tool-armed") === "wash:blue"
      && !root.querySelector(".marking-radial")
      && status?.textContent?.includes("Sky highlight")
      && status.textContent.includes("Select more words")
      && [...status.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Put tool down");
  })()`);
  await waitForRenderedBlueHighlights(driver, 1);
  await driver.evaluate(`(() => {
    window.__radialAutoAdds = 0;
    window.__radialAutoObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".marking-radial, .marking-radial-scrim")) window.__radialAutoAdds += 1;
        window.__radialAutoAdds += node.querySelectorAll(".marking-radial, .marking-radial-scrim").length;
      }
    });
    window.__radialAutoObserver.observe(document.body, { childList: true, subtree: true });
  })()`);
  const autoSelected = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(autoSelected, FIXTURE.counterpart.quote, "armed Radial Sky selection drifted");
  await waitForActiveHighlightCount(driver, 2);
  await waitForRenderedBlueHighlights(driver, 2);
  const autoReport = await driver.evaluate(`(async () => {
    window.__radialAutoObserver?.disconnect();
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const active = result.highlights.filter((record) => record.deleted === 0);
    const report = {
      additions: window.__radialAutoAdds,
      armed: document.querySelector('[data-marking-surface="radial"]')?.getAttribute("data-tool-armed"),
      radials: document.querySelectorAll(".marking-radial, .marking-radial-scrim").length,
      nativeSelection: getSelection()?.toString() ?? "",
      focusedVerse: document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") ?? null,
      records: active
        .map((record) => ({
          book: record.book,
          chapter: record.chapter,
          verse_start: record.verse_start,
          verse_end: record.verse_end,
          package: record.package,
          char_start: record.char_start,
          char_end: record.char_end,
          color: record.color,
          kind: record.kind,
        }))
        .sort((left, right) => left.verse_start - right.verse_start || left.char_start - right.char_start),
    };
    delete window.__radialAutoAdds;
    delete window.__radialAutoObserver;
    return report;
  })()`);
  assert.deepEqual(autoReport.records, [
    { ...expectedPhrase, color: "blue", kind: "highlight" },
    { ...expectedCounterpart, color: "blue", kind: "highlight" },
  ], "armed Radial Sky writes lost their exact ordered payloads");
  assert.equal(autoReport.additions, 0, "armed Radial Sky flashed a wheel or scrim during auto-apply");
  assert.equal(autoReport.radials, 0, "armed Radial Sky retained selection chrome");
  assert.equal(autoReport.armed, "wash:blue", "armed Radial Sky was dropped after auto-apply");
  assert.equal(autoReport.nativeSelection, "", "armed Radial Sky left native selection behind");
  assert.equal(autoReport.focusedVerse, String(FIXTURE.counterpart.verse), "armed Radial Sky returned focus to the wrong verse");
  await putDownRadialTool(driver);

  // Note remains non-writing until Save and receives exact selection context.
  const beforeNote = await rangeCounts(driver);
  await openRadial(driver);
  await clickRadialAction(driver, "Add note");
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-root"))`);
  const note = await driver.evaluate(`(() => ({
    quote: document.querySelector(".note-capture-quote-text")?.textContent?.trim() ?? null,
    reference: document.querySelector(".note-capture-quote-ref")?.textContent?.trim() ?? null,
  }))()`);
  assert.deepEqual(note, { quote: FIXTURE.phrase.quote, reference: "Acts 19:8" }, "Radial Note lost exact selection context");
  await driver.evaluate(`document.querySelector(".note-capture-cancel")?.click()`);
  await driver.waitFor(`!document.querySelector(".note-capture-root")
    && !document.querySelector('[data-marking-surface="radial"]')`);
  assert.deepEqual(await rangeCounts(driver), beforeNote, "cancelled Radial Note wrote authored state");

  // A blocked erase owns same-task Escape, retains the highlighted Range, and
  // remains byte-identical until explicit retry.
  await openRadial(driver, FIXTURE.counterpart);
  const beforeFailedErase = logFingerprint(highlightsLog);
  await withWriteBlocked(highlightsLog, async () => {
    const escapeAllowed = await driver.evaluate(`(() => {
      const beforeClick = document.querySelector(".marking-radial");
      const erase = [...(beforeClick?.querySelectorAll("button") ?? [])]
        .find((button) => button.getAttribute("aria-label")?.startsWith("Remove"));
      if (!beforeClick || !erase) throw new Error("Radial erase action is absent");
      erase.click();
      const owner = document.querySelector(".marking-radial") ?? window;
      return owner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    })()`);
    assert.equal(escapeAllowed, false, "busy Radial erase did not synchronously own Escape");
    await driver.waitFor(`(() => {
      const root = document.querySelector('[data-marking-surface="radial"]');
      const radial = root?.querySelector(".marking-radial.is-placed");
      return radial?.getAttribute("aria-busy") === "false"
        && getComputedStyle(radial).visibility === "visible"
        && document.activeElement?.getAttribute("data-relationship-kind") === "link:parallel"
        && root?.querySelector(".marking-radial-help-card")?.textContent?.includes("The highlight could not be removed")
        && getSelection()?.toString() === ${JSON.stringify(FIXTURE.counterpart.quote)};
    })()`);
    await sleep(300);
    assert.equal((await rangeCounts(driver)).highlights, 2, "failed Radial erase retried or removed a highlight");
    assert.deepEqual(logFingerprint(highlightsLog), beforeFailedErase, "failed Radial erase changed the append-only log");
  });
  assert.deepEqual(logFingerprint(highlightsLog), beforeFailedErase, "Radial erase wrote after permissions were restored");
  await clickRadialAction(driver, "Remove selected text from highlight");
  await waitForActiveHighlightCount(driver, 1);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);
  await openRadial(driver);
  await clickRadialAction(driver, "Remove selected text from highlight");
  await waitForActiveHighlightCount(driver, 0);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);
  assert.deepEqual(await rangeCounts(driver), baseline, "Radial mutation flow did not restore its isolated baseline");
}

async function assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames) {
  const before = await rangeCounts(driver);
  const beforeConnectionLog = logFingerprint(connectionsLog);
  assert.equal(before.connections, 0, "Radial connection fixture inherited a durable connection");
  const expectedAnchors = await Promise.all([
    expectedConnectionAnchor(driver, FIXTURE.phrase),
    expectedConnectionAnchor(driver, FIXTURE.counterpart),
  ]);
  await setViewport(cdp, 860, 900);
  await openRadial(driver);
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
  }, "Radial raw selection did not remain one exact neutral renderer-only emphasis");
  assert.deepEqual(await rangeCounts(driver), before, "Radial raw selection changed durable query counts");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "Radial raw selection changed connection append-log bytes");
  await clickRadialChoice(driver, '[data-relationship-kind="series"]', "Series relationship");
  await driver.waitFor(`Boolean(document.querySelector('[data-authoring-draft][data-connection-id="${DRAFT_ID}"]'))`);
  await settle(driver);
  const draft = await driver.evaluate(`(() => {
    const group = document.querySelector('[data-authoring-draft][data-connection-id="${DRAFT_ID}"]');
    const exact = (selector) => document.querySelectorAll('[data-connection-id="${DRAFT_ID}"] ' + selector).length;
    return {
      groups: document.querySelectorAll('[data-authoring-draft][data-connection-id="${DRAFT_ID}"]').length,
      paintState: group?.getAttribute("data-paint-state") ?? null,
      resolution: group?.getAttribute("data-anchor-resolution") ?? null,
      washes: group?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      routeGroups: document.querySelectorAll('.connection-mark[data-connection-id="${DRAFT_ID}"]').length,
      routes: exact(".connection-route"),
      underlines: exact(".connection-underline"),
      contacts: exact(".connection-contact"),
      hits: exact(".connection-route-hit"),
      ticks: document.querySelectorAll('[data-connection-tick="${DRAFT_ID}"]').length,
      selectionEmphasis: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      cards: document.querySelectorAll(".connection-card").length,
      sessionKind: document.querySelector(".marking-session-kind")?.textContent?.trim() ?? null,
      sessionCopy: document.querySelector(".marking-session-copy")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      radial: document.querySelectorAll(".marking-radial, .marking-radial-scrim").length,
      nativeSelection: getSelection()?.toString() ?? "",
      focusedVerse: document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") ?? null,
      globalLines: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit").length,
    };
  })()`);
  assert.equal(draft.groups, 1, "Radial Series did not create exactly one authoring draft");
  assert.equal(draft.paintState, "authoring", "Radial authoring phrase lost explicit paint state");
  assert.equal(draft.resolution, "exact", "Radial authoring phrase degraded from exact coordinates");
  assert.ok(draft.washes > 0, "Radial authoring phrase did not receive emphasis paint");
  assert.deepEqual(
    {
      routeGroups: draft.routeGroups,
      routes: draft.routes,
      underlines: draft.underlines,
      contacts: draft.contacts,
      hits: draft.hits,
      ticks: draft.ticks,
      selectionEmphasis: draft.selectionEmphasis,
      cards: draft.cards,
    },
    { routeGroups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 0, selectionEmphasis: 0, cards: 0 },
    "Radial authoring draft leaked durable line/tick artifacts",
  );
  assert.equal(draft.sessionKind, "Series", "Radial session lost its relationship kind");
  assert.match(draft.sessionCopy, /^1 marked · /, "Radial session did not retain its first phrase");
  assert.equal(draft.radial, 0, "captured Radial phrase left selection chrome mounted");
  assert.equal(draft.nativeSelection, "", "captured Radial phrase remained native-selected");
  assert.equal(draft.focusedVerse, String(FIXTURE.phrase.verse), "Radial capture returned focus to the wrong verse");
  assert.equal(draft.globalLines, 0, "Radial first capture leaked global connection lines");
  assert.deepEqual(await rangeCounts(driver), before, "one Radial authoring phrase wrote a durable connection");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "one Radial authoring phrase changed connection append-log bytes");

  await driver.evaluate(`(() => {
    window.__radialConnectionAdds = 0;
    window.__radialConnectionObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".marking-radial, .marking-radial-scrim")) window.__radialConnectionAdds += 1;
        window.__radialConnectionAdds += node.querySelectorAll(".marking-radial, .marking-radial-scrim").length;
      }
    });
    window.__radialConnectionObserver.observe(document.body, { childList: true, subtree: true });
  })()`);
  const counterpart = await driver.evaluate(selectPhraseExpression(FIXTURE.counterpart));
  assert.equal(counterpart, FIXTURE.counterpart.quote, "Radial Series counterpart selection drifted");
  await driver.waitFor(`Boolean(document.querySelector(".marking-session-action.primary"))`);
  // The session publishes its second held phrase in the selection event's
  // React commit, while the shared underlay deliberately folds geometry reads
  // into the following animation frame. Wait for that measured paint commit
  // before sampling the authoring state or ending the no-flash observation.
  await driver.waitFor(`document.querySelectorAll('[data-authoring-draft][data-connection-id="${DRAFT_ID}"] .connection-emphasis-wash').length === 2`);
  const noFlash = await driver.evaluate(`(() => {
    window.__radialConnectionObserver?.disconnect();
    const additions = window.__radialConnectionAdds;
    delete window.__radialConnectionAdds;
    delete window.__radialConnectionObserver;
    return additions;
  })()`);
  assert.equal(noFlash, 0, "armed Radial Series flashed selection chrome for its counterpart");
  const beforeDone = await driver.evaluate(`(() => ({
    draftGroups: document.querySelectorAll("[data-authoring-draft]").length,
    draftPaths: document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash").length,
    selectionEmphasis: document.querySelectorAll("[data-marking-selection-emphasis]").length,
    lineOrTickArtifacts: document.querySelectorAll(".connection-mark, .connection-route, .connection-underline, .connection-contact, .connection-route-hit, [data-connection-tick]").length,
    cards: document.querySelectorAll(".connection-card").length,
  }))()`);
  assert.deepEqual(beforeDone, {
    draftGroups: 1,
    draftPaths: 2,
    selectionEmphasis: 0,
    lineOrTickArtifacts: 0,
    cards: 0,
  }, "Radial two-phrase authoring state leaked selection, line, tick, or card artifacts before Done");
  assert.deepEqual(await rangeCounts(driver), before, "Radial two-phrase authoring state wrote before Done");
  assert.deepEqual(logFingerprint(connectionsLog), beforeConnectionLog, "Radial two-phrase authoring state changed connection append-log bytes before Done");

  // Fail the first append at the real log. The renderer cannot prove whether
  // an IPC failure happened before or after the authoritative commit, so it
  // must retain the exact command as unconfirmed until an idempotent retry.
  // Dispatch Escape in the same task as Done to prove operation ownership.
  const beforeFailedSave = logFingerprint(connectionsLog);
  await withWriteBlocked(connectionsLog, async () => {
    const escapeAllowed = await driver.evaluate(`(() => {
      const beforeClick = document.querySelector(".marking-session");
      const done = beforeClick?.querySelector(".marking-session-action.primary");
      if (!beforeClick || !done) throw new Error("Radial Done action is absent");
      done.click();
      const owner = document.querySelector(".marking-session") ?? window;
      return owner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    })()`);
    assert.equal(escapeAllowed, false, "busy Radial connection save did not synchronously own Escape");
    await driver.waitFor(`document.querySelector(".marking-session-copy")?.textContent?.trim()
      === "The result is not confirmed. Retry this exact change; your selected phrases are still held."`);
    await sleep(300);
    const failed = await driver.evaluate(`(() => ({
      draftGroups: document.querySelectorAll("[data-authoring-draft]").length,
      draftPaths: document.querySelectorAll("[data-authoring-draft] .connection-emphasis-wash").length,
      retry: document.querySelectorAll(".marking-session-action.primary").length,
      busy: document.querySelector(".marking-session")?.getAttribute("aria-busy"),
      nativeSelection: getSelection()?.toString() ?? "",
      rawDiagnosticVisible: /EACCES|EPERM|ENOENT|connections\\.jsonl|\\/var\\/folders|QA simulated/i.test(document.body.innerText),
      connectionToasts: [...document.querySelectorAll(".toast-message")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter((message) => /connection|result is not confirmed|reading index/i.test(message)),
    }))()`);
    assert.equal(failed.draftGroups, 1, "failed Radial connection save dropped its held draft");
    assert.ok(failed.draftPaths >= 2, "failed Radial connection save dropped one held phrase");
    assert.equal(failed.retry, 1, "failed Radial connection save removed its retry action");
    assert.equal(failed.busy, "false", "failed Radial connection save never released busy state");
    assert.equal(failed.nativeSelection, "", "failed Radial connection save restored native selection instead of held paint");
    assert.equal(failed.rawDiagnosticVisible, false, "failed Radial connection exposed a host path or diagnostic string");
    assert.deepEqual(failed.connectionToasts, [], "failed Radial connection duplicated its owned inline recovery state in a toast");
    assert.deepEqual(await rangeCounts(driver), before, "failed Radial connection save wrote a durable record");
    assert.deepEqual(logFingerprint(connectionsLog), beforeFailedSave, "failed Radial connection save changed the append-only log");
  });
  assert.deepEqual(logFingerprint(connectionsLog), beforeFailedSave, "Radial connection wrote after permissions were restored");

  const retryClick = await driver.evaluate(`(() => {
    const button = document.querySelector(".marking-session-action.primary");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
    const label = button.textContent?.trim() ?? "";
    button.click();
    return label;
  })()`);
  assert.equal(retryClick, "Retry", "unconfirmed Radial connection did not expose and invoke its exact-command retry action");
  await driver.waitFor(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return result.connections.length === ${before.connections + 1};
  })()`);
  await driver.waitFor(`[...document.querySelectorAll(".toast-message")]
    .some((node) => (node.textContent?.trim() ?? "").startsWith("Series")
      && (node.textContent?.trim() ?? "").endsWith(" saved"))`);
  const terminalConnectionToasts = await driver.evaluate(`[...document.querySelectorAll(".toast-message")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter((message) => /series|connection|result is not confirmed|reading index/i.test(message))`);
  assert.equal(terminalConnectionToasts.length, 1, "Radial Retry did not reconcile to one terminal success notice");
  assert.match(terminalConnectionToasts[0], /^Series\b.* saved$/, "Radial terminal success notice lost its authored label");
  assert.equal(
    await driver.evaluate(`/EACCES|EPERM|ENOENT|connections\\.jsonl|\\/var\\/folders|QA simulated/i.test(document.body.innerText)`),
    false,
    "successful Radial Retry retained a raw host diagnostic",
  );
  const connection = await driver.evaluate(`(async () => {
    const result = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const record = result.connections.at(-1);
    if (!record) return null;
    window.__radialCompletedConnectionId = record.id;
    return {
      id: record.id,
      format_version: record.format_version,
      kind: record.kind,
      anchors: record.anchors,
    };
  })()`);
  assert.ok(connection?.id, "successful Radial connection did not return a durable id");
  assert.deepEqual(
    { format_version: connection.format_version, kind: connection.kind, anchors: connection.anchors },
    { format_version: 2, kind: "series", anchors: expectedAnchors },
    "successful Radial connection lost its exact ordered anchor payload",
  );
  const afterRetrySave = logFingerprint(connectionsLog);
  assert.equal(afterRetrySave.lines, beforeFailedSave.lines + 1, "explicit Radial connection retry did not append exactly one event");
  assert.ok(afterRetrySave.bytes > beforeFailedSave.bytes, "explicit Radial connection retry did not grow the connection log");
  assert.notEqual(afterRetrySave.sha256, beforeFailedSave.sha256, "explicit Radial connection retry left the connection log digest unchanged");
  await sleep(300);
  assert.deepEqual(logFingerprint(connectionsLog), afterRetrySave, "Radial connection appended again without another explicit action");
  assert.equal((await rangeCounts(driver)).connections, before.connections + 1, "Radial connection retry created the wrong durable count");
  await driver.waitFor(`Boolean(document.querySelector('[data-connection-tick="' + CSS.escape(window.__radialCompletedConnectionId) + '"]'))`);
  await settle(driver);

  const dormant = await driver.evaluate(`(() => {
    const id = window.__radialCompletedConnectionId;
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
  assert.equal(dormant.paintState, "dormant", "saved Radial connection did not settle into dormant paint");
  assert.equal(dormant.resolution, "exact", "saved Radial connection lost exact active-package paint");
  assert.ok(dormant.washes >= 2, "saved Radial connection did not retain both phrase washes");
  assert.deepEqual(
    { routeGroups: dormant.routeGroups, routes: dormant.routes, underlines: dormant.underlines, contacts: dormant.contacts, hits: dormant.hits, ticks: dormant.ticks },
    { routeGroups: 0, routes: 0, underlines: 0, contacts: 0, hits: 0, ticks: 1 },
    "dormant Radial connection leaked line or hit paint",
  );

  await driver.evaluate(`document.querySelector('[data-connection-tick="' + CSS.escape(window.__radialCompletedConnectionId) + '"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(window.__radialCompletedConnectionId) + '"] .connection-route'))`);
  await settle(driver);
  const selected = await driver.evaluate(`(() => {
    const id = window.__radialCompletedConnectionId;
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
  assert.equal(selected.groups, 1, "selected Radial connection did not produce one route group");
  assert.equal(selected.routes, 1, "selected Radial connection did not produce one bracket centerline");
  assert.ok(selected.underlines >= 2, "selected Radial connection did not underline both phrases");
  assert.ok(selected.contacts >= 2, "selected Radial connection did not pin both phrases");
  assert.equal(selected.hits, 1, "selected Radial connection lost its focused hit target");
  assert.equal(selected.paintState, "selected", "selected Radial connection did not bring its words into focus");
  assert.equal(selected.veil, 1, "selected Radial connection lost the reading-focus veil");
  assert.equal(selected.card, 1, "selected Radial connection did not open the Living Margin card");
  await movePointerAway(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, successFrames, "marking-radial-proof-selected-connection.png");

  await driver.evaluate(`document.querySelector('[data-connection-tick="' + CSS.escape(window.__radialCompletedConnectionId) + '"]')?.click()`);
  await driver.waitFor(`!document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(window.__radialCompletedConnectionId) + '"]')`);
  const released = await driver.evaluate(`(() => {
    const id = window.__radialCompletedConnectionId;
    const emphasis = document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"]');
    const report = {
      paintState: emphasis?.getAttribute("data-paint-state") ?? null,
      lines: document.querySelectorAll('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]').length,
      tick: document.querySelectorAll('[data-connection-tick="' + CSS.escape(id) + '"]').length,
      card: document.querySelectorAll("#connection-card-inspector").length,
    };
    delete window.__radialCompletedConnectionId;
    return report;
  })()`);
  assert.deepEqual(released, { paintState: "dormant", lines: 0, tick: 1, card: 0 }, "released Radial connection did not return to dormant presence");
  assert.equal((await rangeCounts(driver)).connections, before.connections + 1, "Radial connection integration duplicated or dropped its record");
  assert.deepEqual(logFingerprint(connectionsLog), afterRetrySave, "Radial connection integration changed the log after its explicit retry");
}

function allZeroDurations(value) {
  return value.split(",").every((duration) => Number.parseFloat(duration) === 0);
}

async function assertReducedMotion(driver, cdp) {
  await setMedia(cdp, { reduced: true });
  await setViewport(cdp, 860, 900);
  await openRadial(driver, FIXTURE.phrase, true);
  const report = await driver.evaluate(`(() => {
    const targets = [
      document.querySelector(".marking-radial-scrim"),
      document.querySelector(".marking-radial"),
      document.querySelector(".marking-radial-disc"),
      document.querySelector(".marking-radial-petal"),
      document.querySelector(".marking-radial-hub"),
      document.querySelector(".marking-radial-help-card"),
      document.querySelector(".marking-radial-keep"),
      document.querySelector(".marking-radial-close"),
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
          && Boolean(target.closest('[data-marking-surface="radial"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);
  assert.equal(report.active, true, "reduced-motion emulation did not reach the Radial");
  for (const [index, durations] of report.durations.entries()) {
    assert.equal(allZeroDurations(durations.animation), true, `reduced-motion Radial target ${index} retained animation ${durations.animation}`);
    assert.equal(allZeroDurations(durations.transition), true, `reduced-motion Radial target ${index} retained transition ${durations.transition}`);
  }
  assert.equal(report.running, 0, "reduced-motion Radial retained a running animation");
  await dismissRadial(driver, cdp);
  await setMedia(cdp);
}

async function assertForcedColors(driver, cdp) {
  await setMedia(cdp, { forced: true });
  await setViewport(cdp, 860, 900);
  await openRadial(driver);
  await pressKey(cdp, "ArrowDown", "ArrowDown", 0, 40);
  await driver.waitFor(`document.querySelector('[data-marking-surface="radial"]')?.getAttribute("data-focus-ring") === "keyboard"`);
  const report = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    const radial = document.querySelector(".marking-radial");
    const disc = radial?.querySelector(".marking-radial-disc");
    const help = radial?.querySelector(".marking-radial-help-card");
    const choices = [...(radial?.querySelectorAll("[data-relationship-kind], [data-pigment]") ?? [])];
    const first = choices[0];
    first?.focus({ preventScroll: true });
    const radialStyle = radial ? getComputedStyle(radial) : null;
    const discStyle = disc ? getComputedStyle(disc) : null;
    const helpStyle = help ? getComputedStyle(help) : null;
    const focusStyle = first ? getComputedStyle(first) : null;
    const secondary = [
      radial?.querySelector(".marking-radial-keep"),
      [...(radial?.querySelectorAll("button") ?? [])].find((button) => button.getAttribute("aria-label") === "Add note"),
      radial?.querySelector(".marking-radial-close"),
    ];
    return {
      active: matchMedia("(forced-colors: active)").matches,
      focusRingMode: root?.getAttribute("data-focus-ring") ?? null,
      codes: [...(radial?.querySelectorAll("[data-pigment] .marking-pigment") ?? [])]
        .map((swatch) => getComputedStyle(swatch, "::after").content.replace(/["']/g, "")),
      swatchBorders: [...(radial?.querySelectorAll("[data-pigment] .marking-pigment") ?? [])]
        .map((swatch) => getComputedStyle(swatch).borderStyle),
      commandBorders: choices.map((choice) => getComputedStyle(choice).borderStyle),
      secondaryBorders: secondary.map((button) => {
        if (!button) return null;
        const style = getComputedStyle(button);
        return {
          label: button.getAttribute("aria-label"),
          style: style.borderStyle,
          width: style.borderWidth,
          color: style.borderColor,
        };
      }),
      discDisplay: discStyle?.display ?? null,
      discBackground: discStyle?.backgroundImage ?? null,
      radialShadow: radialStyle?.boxShadow ?? null,
      helpShadow: helpStyle?.boxShadow ?? null,
      helpBorder: helpStyle?.borderStyle ?? null,
      focusOutline: { style: focusStyle?.outlineStyle ?? null, width: focusStyle?.outlineWidth ?? null },
      commandCount: choices.length,
    };
  })()`);
  assert.equal(report.active, true, "forced-colors emulation did not reach the Radial");
  assert.equal(report.focusRingMode, "keyboard", "forced colors lost Radial keyboard focus modality");
  assert.deepEqual(report.codes, FORCED_CODES, "forced colors lost A/G/S/R/V pigment distinctions");
  assert.deepEqual(report.swatchBorders, Array(5).fill("solid"), "forced colors lost pigment boundaries");
  assert.deepEqual(report.commandBorders, Array(11).fill("solid"), "forced colors lost command boundaries");
  assert.deepEqual(report.secondaryBorders.map((border) => border?.label), [
    "Keep next highlight or connection active",
    "Add note",
    "Close radial menu",
  ], "forced colors lost a secondary Radial action");
  for (const border of report.secondaryBorders) {
    assert.equal(border?.style, "solid", `forced colors left ${border?.label ?? "a Radial action"} borderless`);
    assert.equal(border?.width, "1px", `forced colors gave ${border?.label ?? "a Radial action"} the wrong border width`);
    assert.notEqual(border?.color, "rgba(0, 0, 0, 0)", `forced colors made ${border?.label ?? "a Radial action"} boundary transparent`);
  }
  assert.equal(report.discDisplay, "none", "forced colors retained the decorative Radial disc");
  assert.equal(report.radialShadow, "none", "forced colors retained decorative Radial shadow");
  assert.equal(report.helpShadow, "none", "forced colors retained decorative help-card shadow");
  assert.equal(report.helpBorder, "solid", "forced colors lost the help-card boundary");
  assert.equal(report.focusOutline.style, "solid", "forced colors lost Radial keyboard focus");
  assert.equal(report.focusOutline.width, "2px", "forced colors lost Radial focus width");
  assert.equal(report.commandCount, 11, "forced colors hid a Radial command");
  await dismissRadial(driver, cdp);
  await setMedia(cdp);
}

async function assertNoMotionReplay(driver, cdp) {
  await setMedia(cdp);
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  const listening = await driver.evaluate(`(() => {
    window.__radialMotionStarts = [];
    window.__radialMotionStartListener = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-marking-surface="radial"]')) return;
      if (!event.animationName.startsWith("marking-radial-")) return;
      window.__radialMotionStarts.push({ name: event.animationName, target: event.target.className });
    };
    document.body.addEventListener("animationstart", window.__radialMotionStartListener, true);
    return true;
  })()`);
  assert.equal(listening, true, "Radial motion listener could not attach");
  await movePointerAway(cdp);
  await openRadial(driver);
  const entrance = await driver.evaluate(`window.__radialMotionStarts ?? []`);
  const entranceCounts = Object.fromEntries([
    "marking-radial-scrim-in",
    "marking-radial-shell-in",
    "marking-radial-disc-in",
    "marking-radial-item-in",
    "marking-radial-detail-in",
  ].map((name) => [name, entrance.filter((event) => event.name === name).length]));
  assert.deepEqual(entranceCounts, {
    "marking-radial-scrim-in": 1,
    "marking-radial-shell-in": 1,
    "marking-radial-disc-in": 1,
    "marking-radial-item-in": 11,
    "marking-radial-detail-in": 2,
  }, "normal Radial entrance animation vocabulary or count drifted");
  const entranceStarts = entrance.length;
  const tracking = await driver.evaluate(`(() => {
    window.__radialMotionRoot = document.querySelector('[data-marking-surface="radial"]');
    window.__radialMotionScrim = document.querySelector(".marking-radial-scrim");
    window.__radialMotionDialog = document.querySelector(".marking-radial");
    window.__radialMotionAdditions = 0;
    window.__radialMotionObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-marking-surface="radial"], .marking-radial-scrim, .marking-radial')) window.__radialMotionAdditions += 1;
        window.__radialMotionAdditions += node.querySelectorAll('[data-marking-surface="radial"], .marking-radial-scrim, .marking-radial').length;
      }
    });
    window.__radialMotionObserver.observe(document.body, { childList: true, subtree: true });
    return Boolean(window.__radialMotionRoot && window.__radialMotionScrim && window.__radialMotionDialog);
  })()`);
  assert.equal(tracking, true, "Radial motion identity probe could not attach");

  const readState = () => driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="radial"]');
    return {
      sameRoot: window.__radialMotionRoot === root,
      sameScrim: window.__radialMotionScrim === document.querySelector(".marking-radial-scrim"),
      sameDialog: window.__radialMotionDialog === document.querySelector(".marking-radial"),
      additions: window.__radialMotionAdditions,
      starts: window.__radialMotionStarts?.length ?? -1,
      layout: root?.getAttribute("data-radial-layout") ?? null,
      selection: getSelection()?.toString() ?? "",
      running: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return animation instanceof CSSAnimation
          && animation.animationName.startsWith("marking-radial-")
          && target instanceof Element
          && Boolean(target.closest('[data-marking-surface="radial"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);

  await setViewport(cdp, 900, 900);
  await driver.waitFor(`document.querySelector('[data-marking-surface="radial"]')?.getAttribute("data-radial-layout") === "wheel"`);
  await waitForRadialTerminal(driver);
  assert.deepEqual(await readState(), {
    sameRoot: true,
    sameScrim: true,
    sameDialog: true,
    additions: 0,
    starts: entranceStarts,
    layout: "wheel",
    selection: FIXTURE.phrase.quote,
    running: 0,
  }, "same-layout resize replayed or remounted Radial motion");

  await setViewport(cdp, 390, 900);
  await driver.waitFor(`document.querySelector('[data-marking-surface="radial"]')?.getAttribute("data-radial-layout") === "sheet"`);
  await waitForRadialTerminal(driver);
  assert.deepEqual(await readState(), {
    sameRoot: true,
    sameScrim: true,
    sameDialog: true,
    additions: 0,
    starts: entranceStarts,
    layout: "sheet",
    selection: FIXTURE.phrase.quote,
    running: 0,
  }, "cross-breakpoint resize replayed or remounted Radial motion");

  await setTheme(driver, "dark");
  await driver.waitFor(`document.querySelector('[data-marking-surface="radial"]')?.classList.contains("theme-dark")`);
  await waitForRadialTerminal(driver);
  const afterTheme = await readState();
  assert.deepEqual(afterTheme, {
    sameRoot: true,
    sameScrim: true,
    sameDialog: true,
    additions: 0,
    starts: entranceStarts,
    layout: "sheet",
    selection: FIXTURE.phrase.quote,
    running: 0,
  }, "theme change replayed or remounted Radial motion");
  await driver.evaluate(`(() => {
    window.__radialMotionObserver?.disconnect();
    if (window.__radialMotionStartListener) {
      document.body.removeEventListener("animationstart", window.__radialMotionStartListener, true);
    }
    document.querySelector('[data-relationship-kind="link:parallel"]')?.focus({ preventScroll: true });
    delete window.__radialMotionRoot;
    delete window.__radialMotionScrim;
    delete window.__radialMotionDialog;
    delete window.__radialMotionAdditions;
    delete window.__radialMotionObserver;
    delete window.__radialMotionStarts;
    delete window.__radialMotionStartListener;
  })()`);
  await dismissRadial(driver, cdp);
  await setTheme(driver, "light");
  await setViewport(cdp, 860, 900);
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

async function runRadialStressPhase(driver, cycles) {
  return driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(FIXTURE.stressPhrase)};
    const frame = () => new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    const waitUntil = async (predicate, message) => {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (predicate()) return;
        await frame();
      }
      throw new Error(message);
    };
    const select = async () => {
      const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
      const span = row?.querySelector(".verse-text-span");
      const container = document.querySelector(".verse-text");
      if (!row || !span || !container) throw new Error("Radial stress fixture missing");
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
      if (startOffset < 0 || !start || !end) throw new Error("Radial stress phrase absent");
      row.scrollIntoView({ block: "center", inline: "nearest" });
      await frame();
      await frame();
      span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      await waitUntil(
        () => Boolean(document.querySelector('[data-marking-surface="radial"] .marking-radial.is-placed')),
        "Radial stress selection did not mount",
      );
      await waitUntil(
        () => document.activeElement?.getAttribute("data-relationship-kind") === "link:parallel",
        "Radial stress focus did not reach Parallelism",
      );
    };
    const dismiss = async () => {
      const radial = document.querySelector(".marking-radial");
      radial?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      await waitUntil(() => !document.querySelector('[data-marking-surface="radial"]'), "Radial stress Escape did not clean up");
    };
    for (let cycle = 0; cycle < ${cycles}; cycle += 1) {
      await select();
      const path = cycle % 5;
      if (path === 0) {
        await dismiss();
      } else if (path === 1) {
        const mirror = document.querySelector('[data-relationship-kind="mirror"]');
        if (!(mirror instanceof HTMLButtonElement)) throw new Error("Radial stress Mirror command is absent");
        mirror.focus({ preventScroll: true });
        await waitUntil(
          () => document.activeElement === mirror
            && document.querySelector(".marking-radial-help-card strong")?.textContent?.trim() === "Mirror",
          "Radial stress focus and help did not settle on Mirror",
        );
        await frame();
        await frame();
        if (document.activeElement !== mirror
          || document.querySelector(".marking-radial-help-card strong")?.textContent?.trim() !== "Mirror") {
          throw new Error("Radial stress focus/help pairing did not remain stable");
        }
        await dismiss();
      } else if (path === 2) {
        const keep = document.querySelector(".marking-radial-keep");
        keep?.click();
        await waitUntil(() => keep?.getAttribute("aria-pressed") === "true", "Radial stress Keep did not engage");
        keep?.click();
        await waitUntil(() => keep?.getAttribute("aria-pressed") === "false", "Radial stress Keep did not release");
        document.querySelector(".marking-radial-close")?.click();
        await waitUntil(() => !document.querySelector('[data-marking-surface="radial"]'), "Radial stress Close did not clean up");
      } else if (path === 3) {
        document.querySelector('.marking-radial button[aria-label="Add note"]')?.click();
        await waitUntil(() => Boolean(document.querySelector(".note-capture-root")), "Radial stress Note did not open");
        document.querySelector(".note-capture-cancel")?.click();
        await waitUntil(
          () => !document.querySelector(".note-capture-root") && !document.querySelector('[data-marking-surface="radial"]'),
          "Radial stress Note did not clean up",
        );
      } else {
        document.querySelector('[data-relationship-kind="series"]')?.click();
        await waitUntil(
          () => Boolean(document.querySelector("[data-authoring-draft]") && document.querySelector(".marking-session")),
          "Radial stress authoring draft did not mount",
        );
        const cancel = [...document.querySelectorAll(".marking-session-action")]
          .find((button) => button.textContent?.trim() === "Cancel");
        cancel?.click();
        await waitUntil(
          () => !document.querySelector('[data-marking-surface="radial"]') && !document.querySelector("[data-authoring-draft]"),
          "Radial stress authoring draft did not cancel",
        );
      }
      await frame();
      await frame();
    }
    getSelection()?.removeAllRanges();
    await frame();
    await frame();
    return {
      hosts: document.querySelectorAll('[data-marking-surface="radial"]').length,
      scrims: document.querySelectorAll(".marking-radial-scrim").length,
      radials: document.querySelectorAll(".marking-radial").length,
      statuses: document.querySelectorAll('[data-marking-surface="radial"] [role="status"]').length,
      sessions: document.querySelectorAll(".marking-session").length,
      drafts: document.querySelectorAll("[data-authoring-draft]").length,
      notes: document.querySelectorAll(".note-capture-root").length,
      activeMarkingAnimations: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="radial"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);
}

async function runRadialStressBatch(driver, cdp, cycles) {
  const wheelCycles = Math.ceil(cycles / 2);
  const sheetCycles = cycles - wheelCycles;
  await setViewport(cdp, 860, 900);
  const wheel = await runRadialStressPhase(driver, wheelCycles);
  await setViewport(cdp, 390, 900);
  const sheet = await runRadialStressPhase(driver, sheetCycles);
  await setViewport(cdp, 860, 900);
  await settle(driver, true);
  return { wheel, sheet };
}

async function assertWarmPlateau(driver, cdp) {
  const expected = {
    hosts: 0,
    scrims: 0,
    radials: 0,
    statuses: 0,
    sessions: 0,
    drafts: 0,
    notes: 0,
    activeMarkingAnimations: 0,
  };
  const authoredBefore = await rangeCounts(driver);
  const firstBatch = await runRadialStressBatch(driver, cdp, STRESS_CYCLES);
  await settle(driver);
  const firstMemory = await collectRendererMemory(cdp);
  const secondBatch = await runRadialStressBatch(driver, cdp, STRESS_CYCLES);
  await settle(driver);
  const secondMemory = await collectRendererMemory(cdp);
  assert.deepEqual(firstBatch, { wheel: expected, sheet: expected }, "first warm Radial batch retained transient state");
  assert.deepEqual(secondBatch, { wheel: expected, sheet: expected }, "second warm Radial batch retained transient state");
  assert.deepEqual(await rangeCounts(driver), authoredBefore, "warm Radial lifecycle stress mutated authored records");
  assert.equal(secondMemory.dom.documents, firstMemory.dom.documents, "Radial cycles changed the live document count");
  assert.ok(
    secondMemory.dom.nodes <= firstMemory.dom.nodes,
    `second Radial batch retained ${secondMemory.dom.nodes - firstMemory.dom.nodes} additional DOM nodes`,
  );
  assert.ok(
    secondMemory.dom.jsEventListeners <= firstMemory.dom.jsEventListeners,
    `second Radial batch retained ${secondMemory.dom.jsEventListeners - firstMemory.dom.jsEventListeners} additional listeners`,
  );
  const heapGrowth = secondMemory.usedHeap - firstMemory.usedHeap;
  assert.ok(heapGrowth <= MAX_WARM_HEAP_GROWTH, `second Radial batch retained ${heapGrowth} heap bytes`);
  return { heapGrowth, dom: secondMemory.dom };
}

function failureClassification(error, context, childState) {
  if (error?.code === "ELECTRON_RENDERER_BOOTSTRAP_FAILED") return "renderer-bootstrap-failure";
  if (error?.code === "ELECTRON_LAUNCH_BLOCKED" || context.phase === "launch") return "electron-launch-blocked";
  if (childState.exited) return "renderer-runtime-exit";
  return "radial-contract-failure";
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
          };
        } catch (error) {
          authored = { error: String(error) };
        }
        const root = document.querySelector('[data-marking-surface="radial"]');
        const box = (element) => element?.getBoundingClientRect().toJSON?.() ?? null;
        return {
          url: location.href,
          viewport: { width: innerWidth, height: innerHeight },
          theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
          layout: root?.getAttribute("data-radial-layout") ?? null,
          armed: root?.getAttribute("data-tool-armed") ?? null,
          radial: root?.outerHTML?.slice(0, 20_000) ?? null,
          draft: document.querySelector("[data-authoring-draft]")?.outerHTML?.slice(0, 6_000) ?? null,
          geometry: {
            stage: box(document.querySelector(".scripture-reading-stage")),
            scrim: box(document.querySelector(".marking-radial-scrim")),
            dialog: box(document.querySelector(".marking-radial")),
            help: box(document.querySelector(".marking-radial-help-card")),
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
  console.error(`Radial failure classification: ${classification}`);
  console.error(`Radial failure artifacts: ${screenshotPath}, ${statePath}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-marking-radial-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const highlightsLog = join(libraryPath, "annotations", "highlights.jsonl");
const connectionsLog = join(libraryPath, "annotations", "connections.jsonl");
const port = 11_100 + Math.floor(Math.random() * 500);
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
      markingSurface: "radial",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return true;
  })()`);
  assert.equal(fixtureReady, true, "Radial fixture setup failed");

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === "light"`);
  await driver.waitFor(`!document.querySelector(".living-margin")`);
  await setMedia(cdp);
  assert.deepEqual(await rangeCounts(driver), { highlights: 0, connections: 0, notes: 0 }, "isolated Radial library was not empty");
  assert.deepEqual(logFingerprint(highlightsLog), { bytes: 0, lines: 0, sha256: EMPTY_SHA256 }, "isolated highlight log was not empty");
  assert.deepEqual(logFingerprint(connectionsLog), { bytes: 0, lines: 0, sha256: EMPTY_SHA256 }, "isolated connection log was not empty");
  failureContext = { phase: "renderer-ready" };

  const reports = [];
  for (const theme of THEMES) {
    await setViewport(cdp, 1280, 900);
    await setTheme(driver, theme);
    for (const viewport of VIEWPORTS) {
      failureContext = { phase: "matrix", theme, viewport };
      await setViewport(cdp, viewport.width, viewport.height);
      await driver.waitFor(`!document.querySelector('[data-marking-surface="radial"]')`);
      await movePointerAway(cdp);
      await openRadial(driver);
      const report = await driver.evaluate(radialMatrixReportExpression());
      assertRadialMatrixReport(report, theme, viewport);
      reports.push({ theme, ...viewport, layout: report.layout, stage: report.stageRect });
      console.log(
        `${THEME_LABELS.get(theme).padEnd(11)} ${viewport.label.padStart(8)}  `
        + `${report.layout.padEnd(5)}  6 relationships + 5 pigments  contained  overflow 0`,
      );
      await dismissRadial(driver, cdp);
    }
  }
  const expectedMatrixKeys = THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => `${theme}:${viewport.label}`));
  const actualMatrixKeys = reports.map((report) => `${report.theme}:${report.label}`);
  assert.equal(reports.length, THEMES.length * VIEWPORTS.length, "Radial matrix did not execute every declared cell");
  assert.deepEqual(actualMatrixKeys, expectedMatrixKeys, "Radial matrix executed the wrong theme/viewport keys");

  failureContext = { phase: "aesthetic-proofs" };
  await captureRadialAestheticProofs(driver, cdp, successFrames);

  failureContext = { phase: "sheet-reachability", viewport: VIEWPORTS[0] };
  await setTheme(driver, "light");
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    await assertSheetReachability(driver, cdp, VIEWPORTS[0]);
    failureContext = { phase: "sheet-reachability", viewport: VIEWPORTS[4] };
    await assertSheetReachability(driver, cdp, VIEWPORTS[4]);
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
  }

  failureContext = { phase: "keyboard-focus-loop" };
  await assertKeyboardOwnership(driver, cdp);

  failureContext = { phase: "motion-replay" };
  await assertNoMotionReplay(driver, cdp);

  failureContext = { phase: "mutation-retry-armed" };
  await assertMutationAndArmedFlows(driver, cdp, highlightsLog);

  failureContext = { phase: "reduced-motion" };
  await assertReducedMotion(driver, cdp);

  failureContext = { phase: "forced-colors" };
  await assertForcedColors(driver, cdp);

  failureContext = { phase: "warm-plateau" };
  await setTheme(driver, "light");
  const plateau = await assertWarmPlateau(driver, cdp);

  failureContext = { phase: "completed-connection" };
  await assertCompletedConnectionIntegration(driver, cdp, connectionsLog, successFrames);
  assert.equal(successFrames.length, 5, "Radial proof set did not capture all five representative states");
  assert.equal(new Set(successFrames.map((frame) => frame.name)).size, successFrames.length, "Radial proof names were not unique");
  gatePassed = true;

  console.log("PASS Radial keyboard: one 11-command roving path, modal Tab loop, Escape focus return");
  console.log("PASS Radial motion: one entrance, same nodes and no replay after same-layout, breakpoint, or theme changes");
  console.log("PASS Radial mutations: real Highlight/armed auto-apply/Note/Erase with one-shot failure retention and explicit retry");
  console.log("PASS Radial paint: exact authoring emphasis with 0 draft route/underline/contact/hit/tick");
  console.log("PASS Radial connection: durable two-phrase Series, zero dormant lines, one selected bracket, Living Margin card, quiet release");
  console.log("PASS Radial media: reduced motion terminal, forced colors A/G/S/R/V and visible focus");
  console.log("PASS Radial proofs: Paper/Ink rest + exact raw-selection open + selected connection");
  console.log(`PASS Radial warm plateau: ${STRESS_CYCLES * 2} mixed wheel/sheet cycles, stable DOM/listeners, heap delta ${plateau.heapGrowth} bytes`);
  console.log(`PASS marking Radial: ${reports.length}/20 theme-viewport cells`);
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
  const exited = await stopChild(child, childState);
  if (exited) {
    rmSync(qaRoot, { recursive: true, force: true });
    if (gatePassed) {
      writeSuccessScreenshots(successFrames);
      rmSync(FAILURE_SCREENSHOT_PATH, { force: true });
      rmSync(FAILURE_STATE_PATH, { force: true });
    }
  } else {
    console.error(`Radial QA could not confirm Electron exit; retained isolated profile at ${qaRoot}`);
  }
}
