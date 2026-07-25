/**
 * Fresh-build Electron/CDP gate for reading-canvas pointer and keyboard intent.
 *
 * The package command builds both Electron and renderer bundles before this
 * file runs. Every renderer instance uses an isolated profile and library, so
 * the gate can prove that navigation-only gestures do not append authored
 * events. Two exact v2 relationships share one phrase while retaining one
 * unique phrase each; a separate 12-record exact overlap makes bounded chooser
 * scrolling, roving focus, and final-row activation real without synthetic
 * renderer state. The same matrix proves chooser/shape/Focus Escape ownership.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";

const HEIGHT = 900;
const VIEWPORTS = [390, 860];
const GEOMETRY_EPSILON = 0.75;
const SURFACES = [
  { id: "palette", activeSelector: ".marking-palette", quoteSelector: ".marking-selection-quote" },
  { id: "rail", activeSelector: '.marking-rail-tray[data-rail-tray-mode="intent"]', quoteSelector: ".marking-rail-tray-copy q" },
  { id: "radial", activeSelector: ".marking-radial", quoteSelector: ".marking-radial-context q" },
  { id: "dock", activeSelector: ".marking-dock-selection", quoteSelector: ".marking-dock-quote" },
];
const FIXTURE = {
  shared: { verse: 7, quote: "about twelve" },
  alphaUnique: { verse: 7, quote: "men in all" },
  betaUnique: { verse: 8, quote: "the kingdom of God" },
  studyStart: 10,
  studyEnd: 12,
  alphaLabel: "Alpha exact relationship",
  betaLabel: "Beta exact relationship",
};
const FAILURE_DIR = resolve("docs/ui-audit/reading-interactions");
const FAILURE_STATE_PATH = join(FAILURE_DIR, "reading-interactions-failure.json");
const FAILURE_SCREENSHOT_PATH = join(FAILURE_DIR, "reading-interactions-failure.png");
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    ws.onopen = resolvePromise;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    pending.set(messageId, (message) => {
      if (message.error) {
        const error = new Error(`CDP ${method} failed: ${message.error.message ?? "unknown protocol error"}`);
        error.code = "QA_CDP_PROTOCOL_ERROR";
        error.protocolError = message.error;
        reject(error);
        return;
      }
      resolvePromise(message);
    });
    try {
      ws.send(JSON.stringify({ id: messageId, method, params }));
    } catch (error) {
      pending.delete(messageId);
      reject(error);
    }
  });
  return {
    ws,
    send,
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function waitForTarget(endpoint, childState, timeout = 25_000) {
  const started = Date.now();
  let lastFetchError = null;
  while (Date.now() - started < timeout) {
    if (childState.spawnError) {
      const error = new Error(`Electron could not be spawned: ${childState.spawnError}`);
      error.code = "QA_GUI_LAUNCH_BLOCKED";
      error.launchState = { ...childState, endpoint };
      throw error;
    }
    if (childState.exited) {
      const error = new Error(`Electron exited before exposing CDP (code ${childState.code}, signal ${childState.signal})`);
      error.code = "QA_GUI_LAUNCH_FAILED";
      error.launchState = { ...childState, endpoint };
      throw error;
    }
    try {
      const pages = await (await fetch(endpoint)).json();
      const page = pages.find((candidate) => candidate.title === "Pericope");
      if (page) return page;
    } catch (error) {
      lastFetchError = String(error);
    }
    await sleep(120);
  }
  const error = new Error(`Electron stayed alive but did not expose the Pericope CDP target at ${endpoint}`);
  error.code = "QA_GUI_LAUNCH_TIMEOUT";
  error.launchState = { ...childState, endpoint, lastFetchError };
  throw error;
}

function createDriver(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_500));
    }
    return response.result?.result?.value;
  };

  const waitFor = async (expression, timeout = 12_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(80);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };

  return { evaluate, waitFor };
}

async function installEscapeDiagnostics(driver) {
  await driver.evaluate(`(() => {
    window["__qaEscapeInterceptions"] = [];
    if (window["__qaEscapeInstrumentationInstalled"]) return;
    window["__qaEscapeInstrumentationInstalled"] = true;
    for (const method of ["preventDefault", "stopPropagation", "stopImmediatePropagation"]) {
      const original = Event.prototype[method];
      Event.prototype[method] = function (...args) {
        if (this instanceof KeyboardEvent && this.type === "keydown" && this.key === "Escape") {
          window["__qaEscapeInterceptions"].push({ method, stack: new Error(method).stack });
        }
        return original.apply(this, args);
      };
    }
  })()`);
}

async function settle(driver, milliseconds = 120) {
  await driver.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    return true;
  })()`);
  await sleep(milliseconds);
}

async function setViewport(cdp, width, height = HEIGHT) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function waitForChildExit(child, childState, timeoutMilliseconds = 2_500) {
  if (childState.exited) return true;
  await new Promise((resolvePromise) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.off("exit", finish);
      resolvePromise();
    };
    const timeout = setTimeout(finish, timeoutMilliseconds);
    child.once("exit", finish);
    // Cover the narrow race where the shared exit listener ran between the
    // first state check and this bounded listener being installed.
    if (childState.exited) finish();
  });
  return childState.exited;
}

async function pressKey(cdp, key, code = key, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(100);
}

async function clickPoint(cdp, point, modifiers = 0) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, modifiers });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
  await sleep(120);
}

async function selectorPoint(driver, selector, verticalRatio = 0.5) {
  const point = await driver.evaluate(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const rect = element.getBoundingClientRect();
    const x = rect.left + Math.max(1, rect.width / 2);
    const y = rect.top + Math.max(1, rect.height * ${JSON.stringify(verticalRatio)});
    const owner = document.elementFromPoint(x, y);
    return {
      x,
      y,
      ownsPoint: owner === element || element.contains(owner),
      owner: owner ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "") : "none",
    };
  })()`);
  if (!point) throw new Error(`Cannot locate pointer target ${selector}`);
  assert.equal(point.ownsPoint, true, `${selector}: dispatched point is owned by ${point.owner}`);
  return point;
}

async function textPoint(driver, spec, position = "middle") {
  const point = await driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
    const span = row?.querySelector(".verse-text-span");
    if (!span) return null;
    row.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const text = span.textContent ?? "";
    const phraseStart = text.indexOf(spec.quote);
    if (phraseStart < 0) throw new Error("Phrase is absent from rendered verse: " + spec.quote);
    const targetOffset = ${JSON.stringify(position)} === "start"
      ? phraseStart + Math.min(1, Math.max(0, spec.quote.length - 1))
      : phraseStart + Math.floor(spec.quote.length / 2);
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (targetOffset < consumed + length) {
        const offset = targetOffset - consumed;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, Math.min(length, offset + 1));
        const rect = [...range.getClientRects()].find((candidate) => candidate.width > 0 && candidate.height > 0);
        if (!rect) return null;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const owner = document.elementFromPoint(x, y);
        return {
          x,
          y,
          ownsSpan: owner === span || span.contains(owner),
          owner: owner ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "") : "none",
        };
      }
      consumed += length;
    }
    return null;
  })()`);
  if (!point) throw new Error(`Cannot locate phrase pointer target ${spec.verse}:${spec.quote}`);
  assert.equal(point.ownsSpan, true, `${spec.verse}:${spec.quote}: phrase point is owned by ${point.owner}`);
  return point;
}

async function dragConnectedWords(driver, cdp, spec) {
  const points = await driver.evaluate(`(async () => {
    const spec = ${JSON.stringify(spec)};
    const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
    const span = row?.querySelector(".verse-text-span");
    if (!span) return null;
    row.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const text = span.textContent ?? "";
    const phraseStart = text.indexOf(spec.quote);
    if (phraseStart < 0) throw new Error("Drag fixture is absent: " + spec.quote);
    const nodes = [];
    let consumed = 0;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (length > 0) nodes.push({ node, start: consumed, end: consumed + length });
      consumed += length;
    }
    const pointAt = (absoluteOffset, edge) => {
      const entry = nodes.find((candidate) => absoluteOffset < candidate.end) ?? nodes.at(-1);
      if (!entry) return null;
      const offset = Math.max(0, Math.min(entry.node.textContent.length - 1, absoluteOffset - entry.start));
      const range = document.createRange();
      range.setStart(entry.node, offset);
      range.setEnd(entry.node, Math.min(entry.node.textContent.length, offset + 1));
      const rect = [...range.getClientRects()].find((candidate) => candidate.width > 0 && candidate.height > 0);
      if (!rect) return null;
      return {
        x: edge === "end" ? rect.right - Math.min(1, rect.width / 3) : rect.left + Math.min(1, rect.width / 3),
        y: rect.top + rect.height / 2,
      };
    };
    const dragLength = Math.max(4, Math.min(spec.quote.length - 1, 10));
    const start = pointAt(phraseStart + 1, "start");
    const end = pointAt(phraseStart + dragLength, "end");
    const containerRect = span.closest(".verse-text")?.getBoundingClientRect();
    const releaseCandidates = containerRect ? [
      { x: containerRect.right + 6, y: end?.y ?? start?.y ?? 1 },
      { x: containerRect.left - 6, y: end?.y ?? start?.y ?? 1 },
      { x: end?.x ?? start?.x ?? 1, y: containerRect.top - 6 },
      { x: end?.x ?? start?.x ?? 1, y: containerRect.bottom + 6 },
    ] : [];
    const release = releaseCandidates.find((point) => point.x >= 1 && point.x <= innerWidth - 1
      && point.y >= 1 && point.y <= innerHeight - 1
      && (point.x < containerRect.left || point.x > containerRect.right
        || point.y < containerRect.top || point.y > containerRect.bottom)
      && !document.elementFromPoint(point.x, point.y)?.closest(".verse-text")) ?? null;
    const ownsSpan = (point) => {
      const owner = point ? document.elementFromPoint(point.x, point.y) : null;
      return owner === span || span.contains(owner);
    };
    return start && end && release ? {
      start,
      end,
      release,
      startOwnsSpan: ownsSpan(start),
      endOwnsSpan: ownsSpan(end),
    } : null;
  })()`);
  if (!points) throw new Error(`Cannot build real drag for ${spec.verse}:${spec.quote}`);
  assert.equal(points.startOwnsSpan, true, `${spec.verse}:${spec.quote}: drag start is not owned by the exact verse span`);
  assert.equal(points.endOwnsSpan, true, `${spec.verse}:${spec.quote}: drag end is not owned by the exact verse span`);

  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.start.x, y: points.start.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: points.start.x,
    y: points.start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: points.start.x + (points.end.x - points.start.x) * progress,
      y: points.start.y + (points.end.y - points.start.y) * progress,
      button: "left",
      buttons: 1,
    });
  }
  // Establish the exact text range first, then leave the text container while
  // the button remains held. This proves gesture-origin ownership rather than
  // relying on a mouseup that happens to bubble through `.verse-text`.
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: points.release.x,
    y: points.release.y,
    button: "left",
    buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: points.release.x,
    y: points.release.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await sleep(180);
  return driver.evaluate(`window.getSelection()?.toString() ?? ""`);
}

function authoredLedgerSnapshot(annotationsRoot) {
  if (!existsSync(annotationsRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  visit(annotationsRoot);
  return files.sort().map((path) => {
    const bytes = readFileSync(path);
    const text = bytes.toString("utf8");
    return {
      file: relative(annotationsRoot, path),
      bytes: statSync(path).size,
      records: text.split("\n").filter(Boolean).length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
}

function interactionReportExpression(fixture) {
  return `(() => {
    const fixture = ${JSON.stringify(fixture)};
    const selectedRows = [...document.querySelectorAll('.verse-line[aria-pressed="true"]')]
      .map((row) => Number(row.getAttribute("data-verse")))
      .sort((left, right) => left - right);
    const selectedTicks = [...document.querySelectorAll("[data-selected-connection-id]")]
      .map((tick) => tick.getAttribute("data-selected-connection-id"));
    const heldTicks = [...document.querySelectorAll("[data-held-connection-ids]")]
      .flatMap((tick) => {
        try {
          return JSON.parse(tick.getAttribute("data-held-connection-ids") ?? "[]");
        } catch {
          return [];
        }
      });
    const chooserPanel = document.querySelector(".connection-word-chooser");
    const chooserList = chooserPanel?.querySelector(".connection-word-choices");
    const chooserChoices = chooserList
      ? [...chooserList.querySelectorAll(".connection-word-choice")]
      : [];
    const focusedChooserIndex = chooserChoices.findIndex((choice) => choice === document.activeElement);
    const readingStage = document.querySelector(".scripture-reading-stage");
    const chooserRect = chooserPanel?.getBoundingClientRect();
    const stageRect = readingStage?.getBoundingClientRect();
    return {
      selectedRows,
      studySelected: Boolean(document.querySelector('.living-margin [data-margin-view="selected"]')),
      palette: document.querySelectorAll(".marking-palette").length,
      railSelection: document.querySelectorAll('.marking-rail-tray[data-rail-tray-mode="intent"]').length,
      radial: document.querySelectorAll(".marking-radial").length,
      dockSelection: document.querySelectorAll(".marking-dock-selection").length,
      selectionEmphasis: document.querySelectorAll(".marking-selection-emphasis").length,
      authoringDrafts: document.querySelectorAll("[data-authoring-draft]").length,
      cards: document.querySelectorAll(".connection-card").length,
      cardLabel: document.querySelector(".connection-card-title")?.value ?? null,
      selectedTicks,
      heldTicks,
      routes: document.querySelectorAll(".connection-route").length,
      routeHits: document.querySelectorAll(".connection-route-hit").length,
      underlines: document.querySelectorAll(".connection-underline").length,
      contacts: document.querySelectorAll(".connection-contact").length,
      veils: document.querySelectorAll("[data-connection-focus-veil]").length,
      chooser: document.querySelectorAll(".connection-word-chooser").length,
      chooserModal: chooserPanel?.getAttribute("aria-modal") === "true",
      chooserLabels: [...document.querySelectorAll(".connection-word-choice > span")]
        .map((element) => element.textContent?.trim() ?? ""),
      focusedChooserIndex,
      focusedChooserLabel: focusedChooserIndex >= 0
        ? chooserChoices[focusedChooserIndex]?.querySelector("span")?.textContent?.trim() ?? null
        : null,
      activeVerse: document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") ?? null,
      inspectorFocused: Boolean(document.activeElement?.closest(".living-margin")),
      focusMode: document.querySelector(".app-shell")?.classList.contains("focus-mode") ?? false,
      chooserGeometry: chooserPanel && chooserRect && stageRect ? {
        boundary: chooserPanel.getAttribute("data-position-boundary"),
        leftInset: chooserRect.left - stageRect.left,
        topInset: chooserRect.top - stageRect.top,
        rightInset: stageRect.right - chooserRect.right,
        bottomInset: stageRect.bottom - chooserRect.bottom,
        listClientHeight: chooserList?.clientHeight ?? null,
        listScrollHeight: chooserList?.scrollHeight ?? null,
      } : null,
      alphaSelected: Boolean(document.querySelector('[data-selected-connection-id="' + CSS.escape(fixture.alphaId) + '"]')),
      betaSelected: Boolean(document.querySelector('[data-selected-connection-id="' + CSS.escape(fixture.betaId) + '"]')),
    };
  })()`;
}

function assertNoMarking(report, label) {
  assert.equal(report.palette, 0, `${label}: Palette opened for a Study gesture`);
  assert.equal(report.railSelection, 0, `${label}: Pen Rail selection tray opened for a Study gesture`);
  assert.equal(report.radial, 0, `${label}: Radial opened for a Study gesture`);
  assert.equal(report.dockSelection, 0, `${label}: Dock entered marking selection for a Study gesture`);
  assert.equal(report.selectionEmphasis, 0, `${label}: Study gesture painted marking emphasis`);
  assert.equal(report.authoringDrafts, 0, `${label}: Study gesture created transient connection authoring paint`);
}

function assertFocusedConnection(report, expectedId, expectedLabel, fixture, label) {
  assert.equal(report.cards, 1, `${label}: exact-word activation did not open one card`);
  assert.ok(report.cardLabel?.includes(expectedLabel), `${label}: wrong relationship card opened (${report.cardLabel})`);
  assert.deepEqual(report.selectedTicks, [expectedId], `${label}: wrong tick owns focus`);
  assert.equal(report.routes, 1, `${label}: selected relationship must paint exactly one route`);
  assert.equal(report.routeHits, 1, `${label}: selected relationship must expose exactly one hit path`);
  assert.ok(report.underlines > 0, `${label}: selected relationship lost its exact underlines`);
  assert.ok(report.contacts > 0, `${label}: selected relationship lost route contacts`);
  assert.equal(report.veils, 1, `${label}: selected relationship must paint one focus veil`);
  if (expectedId === fixture.alphaId) {
    assert.equal(report.alphaSelected, true, `${label}: expected Alpha selection flag is absent`);
  } else if (expectedId === fixture.betaId) {
    assert.equal(report.betaSelected, true, `${label}: expected Beta selection flag is absent`);
  }
}

function assertDismissedFocus(report, expectedHeldIds, label) {
  assert.equal(report.cards, 0, `${label}: relationship card remained visible`);
  assert.deepEqual(report.selectedTicks, [], `${label}: dismissal selected a fallback relationship`);
  assert.equal(report.routes, 0, `${label}: relationship route remained after dismissal`);
  assert.equal(report.routeHits, 0, `${label}: invisible route hit remained after dismissal`);
  assert.equal(report.underlines, 0, `${label}: relationship underline remained after dismissal`);
  assert.equal(report.contacts, 0, `${label}: relationship contact remained after dismissal`);
  assert.equal(report.veils, 0, `${label}: focus veil remained after dismissal`);
  assert.deepEqual([...report.heldTicks].sort(), [...expectedHeldIds].sort(), `${label}: dismissal released a held relationship`);
}

async function clickVerse(driver, cdp, verse, shift = false) {
  const point = await selectorPoint(driver, `.verse-line[data-verse="${verse}"] .verse-text-span`);
  await clickPoint(cdp, point, shift ? 8 : 0);
}

async function clickWords(driver, cdp, spec) {
  await clickPoint(cdp, await textPoint(driver, spec));
}

async function chooseOverlapConnection(driver, cdp, label) {
  const point = await driver.evaluate(`(async () => {
    const choice = [...document.querySelectorAll(".connection-word-choice")]
      .find((button) => button.querySelector("span")?.textContent?.trim() === ${JSON.stringify(label)});
    if (!choice) return null;
    choice.scrollIntoView({ block: "nearest", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const rect = choice.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const owner = document.elementFromPoint(x, y);
    return {
      x,
      y,
      ownsPoint: owner === choice || choice.contains(owner),
      owner: owner ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "") : "none",
    };
  })()`);
  if (!point) throw new Error(`Overlap chooser lost ${label}`);
  assert.equal(point.ownsPoint, true, `${label}: chooser point is owned by ${point.owner}`);
  await clickPoint(cdp, point);
}

async function activateConnectionTick(driver, cdp, connectionId) {
  const target = await driver.evaluate(`(async () => {
    const connectionId = ${JSON.stringify(connectionId)};
    const tick = [...document.querySelectorAll("[data-connection-tick-side]")].find((candidate) => {
      if (candidate.getAttribute("data-connection-tick") === connectionId) return true;
      try {
        return JSON.parse(candidate.getAttribute("data-connection-tick-members") ?? "[]").includes(connectionId);
      } catch {
        return false;
      }
    });
    if (!tick) return null;
    tick.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const rect = tick.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const owner = document.elementFromPoint(x, y);
    return {
      x,
      y,
      aggregate: tick.hasAttribute("data-connection-tick-aggregate"),
      ownsPoint: owner === tick || tick.contains(owner),
      owner: owner ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "") : "none",
    };
  })()`);
  if (!target) throw new Error(`No direct or grouped tick represents ${connectionId}`);
  assert.equal(target.ownsPoint, true, `${connectionId}: tick point is owned by ${target.owner}`);
  await clickPoint(cdp, target);
  if (!target.aggregate) return;
  const choiceSelector = `.connection-word-choice[data-connection-id="${connectionId}"]`;
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(choiceSelector)}))`);
  await clickPoint(cdp, await selectorPoint(driver, choiceSelector));
}

async function clickCardAction(driver, cdp, label) {
  const point = await driver.evaluate(`(async () => {
    const action = [...document.querySelectorAll(".connection-card-actions button")]
      .find((button) => button.textContent?.trim() === ${JSON.stringify(label)});
    if (!action) return null;
    action.scrollIntoView({ block: "nearest", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const rect = action.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const owner = document.elementFromPoint(x, y);
    return {
      x,
      y,
      ownsPoint: owner === action || action.contains(owner),
      owner: owner ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "") : "none",
    };
  })()`);
  if (!point) throw new Error(`Connection card lost ${label}`);
  assert.equal(point.ownsPoint, true, `${label}: card action point is owned by ${point.owner}`);
  await clickPoint(cdp, point);
}

async function assertLedgerUnchanged(annotationsRoot, baseline, label) {
  assert.deepEqual(authoredLedgerSnapshot(annotationsRoot), baseline, `${label}: navigation-only interaction appended or rewrote authored JSONL`);
}

async function ensureCellReady(driver, cdp, surface, width, fixture) {
  await setViewport(cdp, width);
  await driver.evaluate(`window.api.settings.set({
    theme: "light",
    readingWidth: "wide",
    sidebarCollapsed: true,
    marginVisible: true,
    markingSurface: ${JSON.stringify(surface.id)},
    lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
  })`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await installEscapeDiagnostics(driver);
  await driver.waitFor(`(() => {
    const represented = [...document.querySelectorAll("[data-connection-tick-side]")].flatMap((tick) => {
      if (tick.hasAttribute("data-connection-tick-aggregate")) {
        try {
          return JSON.parse(tick.getAttribute("data-connection-tick-members") ?? "[]");
        } catch {
          return [];
        }
      }
      const id = tick.getAttribute("data-connection-tick");
      return id ? [id] : [];
    });
    return represented.length === ${fixture.connectionCount}
      && new Set(represented).size === ${fixture.connectionCount};
  })()`, 30_000);
  await driver.evaluate(`(() => {
    if (!document.querySelector(".sidebar")?.classList.contains("collapsed")) {
      document.querySelector(".sidebar-collapse-btn")?.click();
    }
    if (document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true") {
      document.querySelector("[data-instrument=focus]")?.click();
    }
    window.getSelection()?.removeAllRanges();
    return true;
  })()`);
  await driver.waitFor(`Boolean(document.querySelector(".living-margin"))`);
  if (surface.id === "rail" || surface.id === "dock") {
    await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface=${JSON.stringify(surface.id)}]'))`);
  }
  await settle(driver);
  const paneGeometry = await driver.evaluate(`(() => {
    const stage = document.querySelector(".scripture-reading-stage")?.getBoundingClientRect();
    const margin = document.querySelector(".living-margin")?.getBoundingClientRect();
    if (!stage || !margin) return null;
    return {
      stage: { width: stage.width, height: stage.height },
      margin: { width: margin.width, height: margin.height },
      overlapX: Math.max(0, Math.min(stage.right, margin.right) - Math.max(stage.left, margin.left)),
      overlapY: Math.max(0, Math.min(stage.bottom, margin.bottom) - Math.max(stage.top, margin.top)),
    };
  })()`);
  assert.ok(paneGeometry, `${surface.id}/${width}: reading panes are absent`);
  assert.ok(
    paneGeometry.overlapX <= 0.75 || paneGeometry.overlapY <= 0.75,
    `${surface.id}/${width}: reading stage and Living Margin overlap by ${paneGeometry.overlapX.toFixed(2)}x${paneGeometry.overlapY.toFixed(2)}px`,
  );
  if (width === 390) {
    assert.ok(paneGeometry.stage.width >= 300, `${surface.id}/${width}: compact Scripture pane is too narrow`);
    assert.ok(paneGeometry.stage.height >= 300, `${surface.id}/${width}: compact Scripture pane is too short`);
    assert.ok(paneGeometry.margin.width >= 300, `${surface.id}/${width}: compact Living Margin is too narrow`);
    assert.ok(paneGeometry.margin.height >= 300, `${surface.id}/${width}: compact Living Margin is too short`);
  }
  const result = await driver.evaluate(`window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)`);
  assert.equal(result.connections.length, fixture.connectionCount, `${surface.id}/${width}: durable fixture count drifted`);
  assert.equal(result.highlights.length, 0, `${surface.id}/${width}: isolated library inherited highlights`);
  const report = await driver.evaluate(interactionReportExpression(fixture));
  assertDismissedFocus(report, [], `${surface.id}/${width}/rest`);
  assertNoMarking(report, `${surface.id}/${width}/rest`);
}

async function runCoarseDenseTickOverflowGate(driver, cdp, fixture, annotationsRoot, ledgerBaseline) {
  const label = "coarse-dense-ticks";
  const fixtureConnections = [
    { id: fixture.alphaId, label: FIXTURE.alphaLabel },
    { id: fixture.betaId, label: FIXTURE.betaLabel },
    ...fixture.denseConnections,
  ];
  const expectedIds = fixtureConnections.map((connection) => connection.id).sort();
  const denseExpectedIds = fixture.denseConnections.map((connection) => connection.id).sort();
  await ensureCellReady(driver, cdp, SURFACES[0], 860, fixture);
  const baselineEnvironment = await driver.evaluate(`({
    coarse: matchMedia("(any-pointer: coarse)").matches,
    viewport: { width: innerWidth, height: innerHeight },
  })`);
  let gateError = null;

  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await settle(driver);
    assert.equal(
      await driver.evaluate(`matchMedia("(any-pointer: coarse)").matches`),
      true,
      `${label}: CDP touch emulation did not expose any-pointer coarse`,
    );
    // The 12 authored relationships share one exact phrase. The production
    // collision planner must therefore expose that natural local pile-up as a
    // group on the unmodified chapter sheet; no QA-only rail geometry is used.
    await driver.waitFor(`(() => {
      const expected = new Set(${JSON.stringify(denseExpectedIds)});
      const represented = [...document.querySelectorAll("[data-connection-tick-aggregate]")].flatMap((button) => {
        try {
          return JSON.parse(button.getAttribute("data-connection-tick-members") ?? "[]")
            .filter((id) => expected.has(id));
        } catch {
          return [];
        }
      });
      return represented.length === expected.size
        && new Set(represented).size === expected.size
        && represented.every((id) => expected.has(id));
    })()`);
    await settle(driver);

    const tickReport = await driver.evaluate(`(async () => {
      const describeOwner = (owner) => owner
        ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "")
        : "none";
      const buttons = [...document.querySelectorAll("[data-connection-tick-side]")];
      const controls = [];
      for (let domIndex = 0; domIndex < buttons.length; domIndex += 1) {
        const button = buttons[domIndex];
        button.scrollIntoView({ block: "center", inline: "nearest" });
        await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
        const underlayRect = document.querySelector(".connection-underlay")?.getBoundingClientRect() ?? null;
        if (!underlayRect) throw new Error("Connection underlay disappeared during tick measurement");
        const aggregate = button.hasAttribute("data-connection-tick-aggregate");
        const memberIds = aggregate
          ? JSON.parse(button.getAttribute("data-connection-tick-members") ?? "[]")
          : [button.getAttribute("data-connection-tick")];
        const rect = button.getBoundingClientRect();
        const before = getComputedStyle(button, "::before");
        const beforeTop = Number.parseFloat(before.top);
        const beforeBottom = Number.parseFloat(before.bottom);
        const viewportHitTop = rect.top + beforeTop;
        const viewportHitBottom = rect.bottom - beforeBottom;
        const hitTop = viewportHitTop - underlayRect.top;
        const hitBottom = viewportHitBottom - underlayRect.top;
        const hitX = rect.left + rect.width / 2;
        const topOwner = document.elementFromPoint(hitX, viewportHitTop + 1.5);
        const bottomOwner = document.elementFromPoint(hitX, viewportHitBottom - 1.5);
        controls.push({
          domIndex,
          aggregate,
          side: button.getAttribute("data-connection-tick-side"),
          memberIds,
          buttonTop: rect.top - underlayRect.top,
          buttonBottom: rect.bottom - underlayRect.top,
          buttonLeft: rect.left - underlayRect.left,
          buttonRight: rect.right - underlayRect.left,
          beforePosition: before.position,
          beforeTop,
          beforeBottom,
          beforePointerEvents: before.pointerEvents,
          hitTop,
          hitBottom,
          topOwnsHit: topOwner === button || button.contains(topOwner),
          bottomOwnsHit: bottomOwner === button || button.contains(bottomOwner),
          topOwner: describeOwner(topOwner),
          bottomOwner: describeOwner(bottomOwner),
          underlayWidth: underlayRect.width,
          underlayHeight: underlayRect.height,
        });
      }
      const underlayRect = document.querySelector(".connection-underlay")?.getBoundingClientRect() ?? null;
      return {
        coarse: matchMedia("(any-pointer: coarse)").matches,
        underlay: underlayRect ? {
          width: underlayRect.width,
          height: underlayRect.height,
        } : null,
        selectedControls: document.querySelectorAll("[data-selected-connection-id]").length,
        pressedControls: document.querySelectorAll('[data-connection-tick-side][aria-pressed="true"]').length,
        routes: document.querySelectorAll(".connection-route").length,
        cards: document.querySelectorAll(".connection-card").length,
        choosers: document.querySelectorAll(".connection-word-chooser").length,
        controls,
      };
    })()`);
    assert.equal(tickReport.coarse, true, `${label}: coarse media query dropped before measurement`);
    assert.ok(tickReport.underlay, `${label}: connection underlay is absent`);
    assert.ok(tickReport.underlay.height > 0, `${label}: production chapter rail has no vertical geometry`);
    assert.ok(tickReport.underlay.width > 0, `${label}: production chapter rail has no horizontal geometry`);
    assert.ok(tickReport.controls.some((control) => control.aggregate), `${label}: dense rail did not produce an aggregate`);
    assert.equal(tickReport.selectedControls, 0, `${label}: grouping selected a relationship before activation`);
    assert.equal(tickReport.pressedControls, 0, `${label}: grouping held a relationship before activation`);
    assert.equal(tickReport.routes, 0, `${label}: grouping painted a route before activation`);
    assert.equal(tickReport.cards, 0, `${label}: grouping opened a card before activation`);
    assert.equal(tickReport.choosers, 0, `${label}: grouping opened a chooser before activation`);

    for (const control of tickReport.controls) {
      assert.ok(control.side === "left" || control.side === "right", `${label}: tick lost its side`);
      assert.ok(Array.isArray(control.memberIds) && control.memberIds.length > 0, `${label}: tick lost its durable members`);
      assert.ok(control.memberIds.every((id) => typeof id === "string" && id.length > 0), `${label}: tick exposed an invalid durable id`);
      assert.equal(control.aggregate, control.memberIds.length > 1, `${label}: aggregate marker disagrees with its member JSON`);
      assert.equal(control.beforePosition, "absolute", `${label}: coarse hit pseudo-element is not absolutely positioned`);
      assert.ok(Number.isFinite(control.beforeTop), `${label}: coarse hit pseudo-element has no computed top`);
      assert.ok(Number.isFinite(control.beforeBottom), `${label}: coarse hit pseudo-element has no computed bottom`);
      assert.ok(Math.abs(control.beforeTop + 10) <= GEOMETRY_EPSILON, `${label}: coarse hit pseudo-element top inset drifted`);
      assert.ok(Math.abs(control.beforeBottom + 10) <= GEOMETRY_EPSILON, `${label}: coarse hit pseudo-element bottom inset drifted`);
      assert.notEqual(control.beforePointerEvents, "none", `${label}: coarse hit pseudo-element rejects pointer input`);
      assert.ok(
        Math.abs((control.hitBottom - control.hitTop) - 44) <= GEOMETRY_EPSILON,
        `${label}: effective coarse hit interval is not 44px`,
      );
      assert.ok(
        control.hitTop >= -GEOMETRY_EPSILON
          && control.hitBottom <= control.underlayHeight + GEOMETRY_EPSILON,
        `${label}: coarse hit interval escaped its vertical rail`,
      );
      assert.ok(
        control.buttonLeft >= -GEOMETRY_EPSILON
          && control.buttonRight <= control.underlayWidth + GEOMETRY_EPSILON,
        `${label}: coarse tick escaped its horizontal rail`,
      );
      assert.equal(control.topOwnsHit, true, `${label}: expanded top hit is owned by ${control.topOwner}`);
      assert.equal(control.bottomOwnsHit, true, `${label}: expanded bottom hit is owned by ${control.bottomOwner}`);
    }
    for (const side of ["left", "right"]) {
      const intervals = tickReport.controls
        .filter((control) => control.side === side)
        .sort((left, right) => left.hitTop - right.hitTop || left.domIndex - right.domIndex);
      for (let index = 1; index < intervals.length; index += 1) {
        assert.ok(
          intervals[index].hitTop >= intervals[index - 1].hitBottom - GEOMETRY_EPSILON,
          `${label}: ${side} effective hit intervals overlap`,
        );
      }
    }

    const representedIds = tickReport.controls.flatMap((control) => control.memberIds);
    assert.equal(new Set(representedIds).size, representedIds.length, `${label}: one durable fixture appears in multiple tick controls`);
    assert.deepEqual([...representedIds].sort(), expectedIds, `${label}: singles and aggregates do not cover every durable fixture exactly once`);

    const denseIdSet = new Set(denseExpectedIds);
    const denseAggregateControls = tickReport.controls
      .filter((control) => control.aggregate && control.memberIds.some((id) => denseIdSet.has(id)))
      .sort((left, right) =>
        left.side.localeCompare(right.side)
        || [...left.memberIds].sort()[0].localeCompare([...right.memberIds].sort()[0]));
    const denseAggregateIds = denseAggregateControls.flatMap((control) =>
      control.memberIds.filter((id) => denseIdSet.has(id)));
    assert.equal(new Set(denseAggregateIds).size, denseAggregateIds.length, `${label}: a dense fixture appears in multiple natural aggregates`);
    assert.deepEqual([...denseAggregateIds].sort(), denseExpectedIds, `${label}: every dense fixture must remain in one side-local aggregate`);
    assert.ok(
      tickReport.controls
        .filter((control) => control.memberIds.some((id) => denseIdSet.has(id)))
        .every((control) => control.aggregate),
      `${label}: a same-area dense fixture escaped into a single tick`,
    );
    const aggregate = denseAggregateControls[0];
    assert.ok(aggregate, `${label}: no deterministic natural dense aggregate remained for activation`);
    const aggregatePoint = await driver.evaluate(`(async () => {
      const expected = new Set(${JSON.stringify(aggregate.memberIds)});
      const element = [...document.querySelectorAll("[data-connection-tick-aggregate]")].find((button) => {
        try {
          const members = JSON.parse(button.getAttribute("data-connection-tick-members") ?? "[]");
          return members.length === expected.size && members.every((id) => expected.has(id));
        } catch {
          return false;
        }
      });
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const owner = document.elementFromPoint(x, y);
      return {
        x,
        y,
        ownsPoint: owner === element || element.contains(owner),
        owner: owner ? owner.tagName.toLowerCase() + (owner.className ? "." + String(owner.className).trim().replace(/\\s+/g, ".") : "") : "none",
      };
    })()`);
    assert.ok(aggregatePoint, `${label}: natural dense aggregate disappeared before activation`);
    assert.equal(aggregatePoint.ownsPoint, true, `${label}: aggregate point is owned by ${aggregatePoint.owner}`);
    await clickPoint(cdp, aggregatePoint);
    await driver.waitFor(`document.querySelectorAll(".connection-word-chooser").length === 1
      && document.querySelectorAll(".connection-word-choice").length === ${aggregate.memberIds.length}
      && document.querySelector(".connection-word-chooser")?.getAttribute("aria-modal") === "true"`);
    const chooserReport = await driver.evaluate(`(() => ({
      ids: [...document.querySelectorAll(".connection-word-choice[data-connection-id]")]
        .map((choice) => choice.getAttribute("data-connection-id")),
      choosers: document.querySelectorAll(".connection-word-chooser").length,
      modal: document.querySelector(".connection-word-chooser")?.getAttribute("aria-modal") === "true",
      expandedGroups: document.querySelectorAll('[data-connection-tick-aggregate][aria-expanded="true"]').length,
      expandedGroupControls: document.querySelector('[data-connection-tick-aggregate][aria-expanded="true"]')?.getAttribute("aria-controls") ?? null,
      selectedControls: document.querySelectorAll("[data-selected-connection-id]").length,
      pressedControls: document.querySelectorAll('[data-connection-tick-side][aria-pressed="true"]').length,
      routes: document.querySelectorAll(".connection-route").length,
      cards: document.querySelectorAll(".connection-card").length,
    }))()`);
    assert.deepEqual(chooserReport.ids, aggregate.memberIds, `${label}: chooser rows drifted from aggregate member JSON`);
    assert.equal(chooserReport.choosers, 1, `${label}: aggregate activation opened multiple choosers`);
    assert.equal(chooserReport.modal, true, `${label}: aggregate chooser lost modal ownership`);
    assert.equal(chooserReport.expandedGroups, 1, `${label}: chooser did not expose exactly one expanded aggregate`);
    assert.equal(chooserReport.expandedGroupControls, "connection-word-chooser", `${label}: expanded aggregate does not own its chooser`);
    assert.equal(chooserReport.selectedControls, 0, `${label}: aggregate click selected a member before chooser choice`);
    assert.equal(chooserReport.pressedControls, 0, `${label}: aggregate click held a member before chooser choice`);
    assert.equal(chooserReport.routes, 0, `${label}: aggregate chooser painted a route before chooser choice`);
    assert.equal(chooserReport.cards, 0, `${label}: aggregate chooser opened a card before chooser choice`);

    const chosen = fixtureConnections.find((connection) => connection.id === aggregate.memberIds[0]);
    assert.ok(chosen, `${label}: aggregate chooser exposed an unknown durable fixture`);
    await clickPoint(cdp, await selectorPoint(driver, `.connection-word-choice[data-connection-id="${chosen.id}"]`));
    const selectedTickSelector = `[data-selected-connection-id="${chosen.id}"]`;
    await driver.waitFor(`document.querySelector(${JSON.stringify(selectedTickSelector)})?.getAttribute("aria-pressed") === "true"
      && document.querySelector(${JSON.stringify(selectedTickSelector)})?.getAttribute("aria-expanded") === "false"
      && !document.querySelector(".connection-word-chooser")
      && document.querySelectorAll(".connection-route").length === 1
      && document.querySelectorAll(".connection-card").length === 1`);
    const selectedReport = await driver.evaluate(`(() => ({
      selectedId: document.querySelector(${JSON.stringify(selectedTickSelector)})?.getAttribute("data-selected-connection-id") ?? null,
      held: document.querySelector(${JSON.stringify(selectedTickSelector)})?.getAttribute("aria-pressed") === "true",
      chooserExpanded: document.querySelector(${JSON.stringify(selectedTickSelector)})?.getAttribute("aria-expanded") === "true",
      heldControls: document.querySelectorAll('[data-connection-tick-side][aria-pressed="true"]').length,
      heldIds: [...document.querySelectorAll("[data-held-connection-ids]")]
        .flatMap((tick) => JSON.parse(tick.getAttribute("data-held-connection-ids") ?? "[]")),
      choosers: document.querySelectorAll(".connection-word-chooser").length,
      routes: document.querySelectorAll(".connection-route").length,
      routeOwnerId: document.querySelector(".connection-route")?.closest("[data-connection-id]")?.getAttribute("data-connection-id") ?? null,
      cards: document.querySelectorAll(".connection-card").length,
      cardLabel: document.querySelector(".connection-card-title")?.value ?? null,
    }))()`);
    assert.equal(selectedReport.selectedId, chosen.id, `${label}: chooser selected the wrong durable relationship`);
    assert.equal(selectedReport.held, true, `${label}: chooser selection did not enter held comparison state`);
    assert.equal(selectedReport.chooserExpanded, false, `${label}: aggregate stayed expanded after its chooser closed`);
    assert.equal(selectedReport.heldControls, 1, `${label}: chooser selection held more than the chosen relationship`);
    assert.deepEqual(selectedReport.heldIds, [chosen.id], `${label}: chooser selection held the wrong durable relationship`);
    assert.equal(selectedReport.choosers, 0, `${label}: chooser remained open after an explicit choice`);
    assert.equal(selectedReport.routes, 1, `${label}: aggregate choice did not paint exactly one route`);
    assert.equal(selectedReport.routeOwnerId, chosen.id, `${label}: visible route belongs to the wrong durable relationship`);
    assert.equal(selectedReport.cards, 1, `${label}: aggregate choice did not open exactly one card`);
    assert.ok(selectedReport.cardLabel?.includes(chosen.label), `${label}: aggregate choice opened the wrong card`);

    await clickCardAction(driver, cdp, "Release");
    await driver.waitFor(`!document.querySelector(".connection-card")
      && document.querySelectorAll(".connection-route").length === 0
      && !document.querySelector("[data-selected-connection-id]")
      && document.querySelectorAll('[data-connection-tick-side][aria-pressed="true"]').length === 0
      && !document.querySelector("[data-held-connection-ids]")`);
    await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, label);
  } catch (error) {
    gateError = error;
    throw error;
  } finally {
    let cleanupError = null;
    try {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
      await setViewport(cdp, baselineEnvironment.viewport.width, baselineEnvironment.viewport.height);
      await settle(driver);
      const restoredEnvironment = await driver.evaluate(`({
        coarse: matchMedia("(any-pointer: coarse)").matches,
        viewport: { width: innerWidth, height: innerHeight },
      })`);
      // Hybrid hardware may have been coarse before emulation. Restore and
      // compare that baseline instead of assuming every machine is fine-only.
      assert.equal(restoredEnvironment.coarse, baselineEnvironment.coarse, `${label}: pointer media state did not return to baseline`);
      assert.deepEqual(restoredEnvironment.viewport, baselineEnvironment.viewport, `${label}: viewport did not return to baseline`);
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError) {
      if (gateError instanceof Error) {
        gateError.message = `${gateError.message}; cleanup also failed: ${String(cleanupError)}`;
        gateError.cleanupError = String(cleanupError);
      } else if (gateError != null) {
        throw new AggregateError([gateError, cleanupError], `${label}: gate and cleanup both failed`);
      } else {
        throw cleanupError;
      }
    }
  }
}

async function runInteractionCell(driver, cdp, surface, width, fixture, annotationsRoot, ledgerBaseline) {
  const label = `${surface.id}/${width}`;
  const report = () => driver.evaluate(interactionReportExpression(fixture));
  await ensureCellReady(driver, cdp, surface, width, fixture);

  // Ordinary click belongs to Study. It selects one verse and cannot open any
  // of the four authoring systems or append authored events.
  await clickVerse(driver, cdp, FIXTURE.studyStart);
  await driver.waitFor(`document.querySelector('.verse-line[data-verse="${FIXTURE.studyStart}"]')?.getAttribute("aria-pressed") === "true"
    && Boolean(document.querySelector('.living-margin [data-margin-view="selected"]'))`);
  let state = await report();
  assert.deepEqual(state.selectedRows, [FIXTURE.studyStart], `${label}/click-study: wrong Study scope`);
  assert.equal(state.studySelected, true, `${label}/click-study: Living Margin did not enter selected Study state`);
  assertNoMarking(state, `${label}/click-study`);
  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/click-study`);

  // Shift-click extends the Study scope; it is still not a marking gesture.
  await clickVerse(driver, cdp, FIXTURE.studyEnd, true);
  await driver.waitFor(`document.querySelector('.verse-line[data-verse="${FIXTURE.studyEnd}"]')?.getAttribute("aria-pressed") === "true"`);
  state = await report();
  assert.deepEqual(state.selectedRows, [10, 11, 12], `${label}/shift-study: range did not extend continuously`);
  assertNoMarking(state, `${label}/shift-study`);
  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/shift-study`);

  // A dense exact overlap must stay inside the reading stage, take modal
  // keyboard ownership at its first decision, and make every candidate
  // reachable without turning the whole page into its scroll owner.
  await clickWords(driver, cdp, fixture.denseShared);
  await driver.waitFor(`document.querySelectorAll(".connection-word-choice").length === ${fixture.denseConnections.length}
    && document.querySelector(".connection-word-chooser")?.getAttribute("aria-modal") === "true"
    && document.activeElement === document.querySelector(".connection-word-choice")`);
  state = await report();
  assert.deepEqual(
    [...state.chooserLabels].sort(),
    fixture.denseConnections.map((connection) => connection.label).sort(),
    `${label}/dense-overlap: chooser lost a candidate`,
  );
  assert.equal(state.chooserGeometry?.boundary, "custom", `${label}/dense-overlap: chooser lost stage ownership`);
  for (const edge of ["leftInset", "topInset", "rightInset", "bottomInset"]) {
    assert.ok(state.chooserGeometry?.[edge] >= -0.75, `${label}/dense-overlap: chooser escaped the reading stage at ${edge}`);
  }
  assert.ok(
    state.chooserGeometry.listScrollHeight > state.chooserGeometry.listClientHeight,
    `${label}/dense-overlap: long candidate list did not receive its own scroll region`,
  );
  assert.equal(state.chooserModal, true, `${label}/dense-overlap: chooser did not expose modal semantics`);
  assert.equal(state.focusedChooserIndex, 0, `${label}/dense-overlap: initial focus did not enter the first relationship`);
  assert.equal(state.focusedChooserLabel, state.chooserLabels[0], `${label}/dense-overlap: first focus label drifted`);

  // Roving keys must reach both boundaries and the adjacent rows without
  // handing Arrow/Home/End back to chapter navigation.
  await pressKey(cdp, "End", "End");
  state = await report();
  assert.equal(state.focusedChooserIndex, fixture.denseConnections.length - 1, `${label}/dense-roving-end: End missed the final relationship`);
  assert.equal(state.focusedChooserLabel, state.chooserLabels.at(-1), `${label}/dense-roving-end: final focus label drifted`);
  await pressKey(cdp, "ArrowUp", "ArrowUp");
  state = await report();
  assert.equal(state.focusedChooserIndex, fixture.denseConnections.length - 2, `${label}/dense-roving-up: ArrowUp missed the preceding relationship`);
  await pressKey(cdp, "Home", "Home");
  state = await report();
  assert.equal(state.focusedChooserIndex, 0, `${label}/dense-roving-home: Home missed the first relationship`);
  await pressKey(cdp, "ArrowDown", "ArrowDown");
  state = await report();
  assert.equal(state.focusedChooserIndex, 1, `${label}/dense-roving-down: ArrowDown missed the second relationship`);

  // Escape closes only this floating decision and restores its Scripture row.
  // It must not pick, hold, release, or otherwise author a relationship.
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(".connection-word-chooser")
    && document.activeElement?.closest(".verse-line")?.getAttribute("data-verse") === ${JSON.stringify(String(fixture.denseShared.verse))}`);
  state = await report();
  assert.equal(state.activeVerse, String(fixture.denseShared.verse), `${label}/dense-chooser-escape: focus did not return to the originating verse`);
  assertDismissedFocus(state, [], `${label}/dense-chooser-escape`);
  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/dense-chooser-escape`);

  // Reopen, reach the real final row with End, and activate it from the
  // keyboard. Programmatic button activation has detail=0, so focus should
  // deliberately transfer to the Living Margin inspector.
  await clickWords(driver, cdp, fixture.denseShared);
  await driver.waitFor(`document.querySelectorAll(".connection-word-choice").length === ${fixture.denseConnections.length}
    && document.activeElement === document.querySelector(".connection-word-choice")`);
  state = await report();
  const denseKeyboardLabel = state.chooserLabels.at(-1);
  const denseKeyboardTarget = fixture.denseConnections.find((connection) => connection.label === denseKeyboardLabel);
  assert.ok(denseKeyboardTarget, `${label}/dense-keyboard-choice: final chooser row is not a durable fixture relationship`);
  await pressKey(cdp, "End", "End");
  state = await report();
  assert.equal(state.focusedChooserLabel, denseKeyboardTarget.label, `${label}/dense-keyboard-choice: End did not focus the final row`);
  await pressKey(cdp, "Enter", "Enter");
  await driver.waitFor(`!document.querySelector(".connection-word-chooser")
    && Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${denseKeyboardTarget.id}"]`)}))
    && Boolean(document.activeElement?.closest(".living-margin"))`);
  state = await report();
  assertFocusedConnection(state, denseKeyboardTarget.id, denseKeyboardTarget.label, fixture, `${label}/dense-keyboard-choice`);
  assert.equal(state.inspectorFocused, true, `${label}/dense-keyboard-choice: keyboard activation did not enter the inspector`);

  // Reopen the overlap while that relationship is selected. The first Escape
  // belongs only to the chooser; the next belongs to the visible shape/card.
  await clickWords(driver, cdp, fixture.denseShared);
  await driver.waitFor(`document.querySelectorAll(".connection-word-choice").length === ${fixture.denseConnections.length}
    && document.activeElement === document.querySelector(".connection-word-choice")`);
  state = await report();
  assertFocusedConnection(state, denseKeyboardTarget.id, denseKeyboardTarget.label, fixture, `${label}/chooser-over-selected`);
  assert.equal(state.chooser, 1, `${label}/chooser-over-selected: selected relationship lost its chooser`);
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(".connection-word-chooser")
    && Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${denseKeyboardTarget.id}"]`)}))`);
  assertFocusedConnection(await report(), denseKeyboardTarget.id, denseKeyboardTarget.label, fixture, `${label}/chooser-first-escape`);
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(".connection-card")
    && document.querySelectorAll(".connection-route").length === 0
    && !document.querySelector("[data-selected-connection-id]")`);
  assertDismissedFocus(await report(), [denseKeyboardTarget.id], `${label}/chooser-second-escape`);
  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/chooser-escape-ladder`);

  // Focus mode intentionally unmounts the card but retains the selected
  // reading shape. Its first Escape must clear only that shape; a second
  // Escape may then restore the full study desk.
  await activateConnectionTick(driver, cdp, denseKeyboardTarget.id);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${denseKeyboardTarget.id}"]`)}))
    && document.querySelectorAll(".connection-route").length === 1`);
  await pressKey(cdp, "f", "KeyF");
  await driver.waitFor(`document.querySelector(".app-shell")?.classList.contains("focus-mode")
    && !document.querySelector(".connection-card")
    && document.querySelectorAll(".connection-route").length === 1`);
  state = await report();
  assert.equal(state.focusMode, true, `${label}/focus-mode: Focus mode did not engage`);
  assert.deepEqual(state.selectedTicks, [denseKeyboardTarget.id], `${label}/focus-mode: selected shape vanished before Escape`);
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`document.querySelector(".app-shell")?.classList.contains("focus-mode")
    && document.querySelectorAll(".connection-route").length === 0
    && !document.querySelector("[data-selected-connection-id]")`);
  state = await report();
  assert.equal(state.focusMode, true, `${label}/focus-first-escape: shape dismissal also exited Focus mode`);
  assertDismissedFocus(state, [denseKeyboardTarget.id], `${label}/focus-first-escape`);
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(".app-shell")?.classList.contains("focus-mode")
    && Boolean(document.querySelector(".living-margin"))`);
  state = await report();
  assert.equal(state.focusMode, false, `${label}/focus-second-escape: Focus mode did not exit`);
  assertDismissedFocus(state, [denseKeyboardTarget.id], `${label}/focus-second-escape`);

  // Release remains a separate explicit action after both dismissal ladders.
  await activateConnectionTick(driver, cdp, denseKeyboardTarget.id);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${denseKeyboardTarget.id}"]`)}))`);
  await clickCardAction(driver, cdp, "Release");
  await driver.waitFor(`!document.querySelector(".connection-card")
    && !document.querySelector("[data-selected-connection-id]")
    && !document.querySelector("[data-held-connection-ids]")`);
  assertDismissedFocus(await report(), [], `${label}/dense-overlap-release`);
  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/dense-overlap`);

  // A real native drag starts on words already owned by Alpha, then releases in
  // the gutter. The completed noncollapsed selection must beat word activation
  // and open this cell's authoring system without requiring mouseup to remain
  // inside `.verse-text`, or creating a durable record merely by opening it.
  const dragSelection = await dragConnectedWords(driver, cdp, FIXTURE.alphaUnique);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(surface.activeSelector)}))`);
  await driver.waitFor(`document.querySelectorAll(".marking-selection-emphasis").length > 0`);
  const capturedDragQuote = await driver.evaluate(`document.querySelector(${JSON.stringify(surface.quoteSelector)})?.getAttribute("title") ?? ""`);
  state = await report();
  assert.ok(dragSelection.trim().length > 0, `${label}/drag: outside release lost the native phrase`);
  assert.equal(capturedDragQuote, dragSelection.replace(/\s+/g, " ").trim(), `${label}/drag: marking model drifted from the exact native selection at release`);
  assert.equal(state.cards, 0, `${label}/drag: connected start words stole the drag and opened a card`);
  assert.equal(state.routes, 0, `${label}/drag: connected start words painted a route during authoring`);
  assert.ok(state.selectionEmphasis > 0, `${label}/drag: selected words were not brought into marking focus`);
  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/drag`);
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(${JSON.stringify(surface.activeSelector)})
    && document.querySelectorAll(".marking-selection-emphasis").length === 0`);

  // Unique exact words open Alpha. Repeating the same click is idempotent:
  // the relationship remains selected and no duplicate held entry appears.
  await clickWords(driver, cdp, FIXTURE.alphaUnique);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.alphaId}"]`)}))
    && document.querySelectorAll(".connection-route").length === 1
    && document.querySelectorAll(".connection-card").length === 1`);
  await settle(driver, 180);
  state = await report();
  assertFocusedConnection(state, fixture.alphaId, FIXTURE.alphaLabel, fixture, `${label}/alpha-words`);
  assert.deepEqual(state.heldTicks, [fixture.alphaId], `${label}/alpha-words: first activation did not hold exactly Alpha`);
  await clickWords(driver, cdp, FIXTURE.alphaUnique);
  await settle(driver, 120);
  state = await report();
  assertFocusedConnection(state, fixture.alphaId, FIXTURE.alphaLabel, fixture, `${label}/alpha-repeat`);
  assert.deepEqual(state.heldTicks, [fixture.alphaId], `${label}/alpha-repeat: repeated word click duplicated or released hold`);

  // Clicking Beta's distinct words switches the single visible shape while
  // preserving Alpha as a quiet held companion.
  await clickWords(driver, cdp, FIXTURE.betaUnique);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.betaId}"]`)}))
    && document.querySelectorAll(".connection-route").length === 1`);
  await settle(driver, 180);
  state = await report();
  assertFocusedConnection(state, fixture.betaId, FIXTURE.betaLabel, fixture, `${label}/beta-words`);
  assert.deepEqual([...state.heldTicks].sort(), [fixture.alphaId, fixture.betaId].sort(), `${label}/beta-words: switch lost ordered held comparison`);

  // Ordinary card chrome is inside the focus boundary. The companion tick is
  // also inside and performs its explicit switch instead of click-away.
  await clickPoint(cdp, await selectorPoint(driver, ".connection-card-kind"));
  await settle(driver, 80);
  assertFocusedConnection(await report(), fixture.betaId, FIXTURE.betaLabel, fixture, `${label}/card-inside`);
  await activateConnectionTick(driver, cdp, fixture.alphaId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.alphaId}"]`)}))`);
  assertFocusedConnection(await report(), fixture.alphaId, FIXTURE.alphaLabel, fixture, `${label}/tick-inside`);
  await clickWords(driver, cdp, FIXTURE.betaUnique);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.betaId}"]`)}))`);

  // Escape hides focus without invoking Release and, critically, without
  // selecting the older Alpha fallback.
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(".connection-card")
    && document.querySelectorAll(".connection-route").length === 0
    && !document.querySelector("[data-selected-connection-id]")`);
  state = await report();
  assertDismissedFocus(state, [fixture.alphaId, fixture.betaId], `${label}/escape-dismiss`);

  // Blank reading chrome has the same non-release dismissal contract.
  await clickWords(driver, cdp, FIXTURE.alphaUnique);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.alphaId}"]`)}))`);
  await clickPoint(cdp, await selectorPoint(driver, ".chapter-header", 0.12));
  await driver.waitFor(`!document.querySelector(".connection-card") && document.querySelectorAll(".connection-route").length === 0`);
  assertDismissedFocus(await report(), [fixture.alphaId, fixture.betaId], `${label}/blank-dismiss`);

  // One click on an unconnected verse both dismisses the shape and completes
  // the requested Study selection. There is no two-click dead gesture.
  await clickWords(driver, cdp, FIXTURE.betaUnique);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.betaId}"]`)}))`);
  await clickVerse(driver, cdp, FIXTURE.studyStart);
  await driver.waitFor(`!document.querySelector(".connection-card")
    && document.querySelector('.verse-line[data-verse="${FIXTURE.studyStart}"]')?.getAttribute("aria-pressed") === "true"
    && Boolean(document.querySelector('.living-margin [data-margin-view="selected"]'))`);
  state = await report();
  assertDismissedFocus(state, [fixture.alphaId, fixture.betaId], `${label}/unconnected-study-dismiss`);
  assert.deepEqual(state.selectedRows, [FIXTURE.studyStart], `${label}/unconnected-study-dismiss: click did not select Study in the same gesture`);
  assertNoMarking(state, `${label}/unconnected-study-dismiss`);

  // The intentionally shared exact phrase must expose a neutral chooser. A
  // real pointer choice then opens the requested relationship and no other.
  await clickWords(driver, cdp, FIXTURE.shared);
  await driver.waitFor(`document.querySelectorAll(".connection-word-choice").length === 2`);
  state = await report();
  assert.equal(state.chooser, 1, `${label}/overlap: expected one chooser`);
  assert.deepEqual([...state.chooserLabels].sort(), [FIXTURE.alphaLabel, FIXTURE.betaLabel].sort(), `${label}/overlap: chooser lost a relationship`);
  assert.equal(state.cards, 0, `${label}/overlap: chooser arbitrarily selected before user choice`);
  assert.equal(state.chooserGeometry?.boundary, "custom", `${label}/overlap: chooser is not owned by the reading-stage boundary`);
  for (const edge of ["leftInset", "topInset", "rightInset", "bottomInset"]) {
    assert.ok(state.chooserGeometry?.[edge] >= -0.75, `${label}/overlap: chooser escaped the reading stage at ${edge}`);
  }
  assert.ok(state.chooserGeometry.listClientHeight <= state.chooserGeometry.listScrollHeight, `${label}/overlap: chooser scroll metrics are invalid`);
  await chooseOverlapConnection(driver, cdp, FIXTURE.alphaLabel);
  await driver.waitFor(`!document.querySelector(".connection-word-chooser")
    && Boolean(document.querySelector(${JSON.stringify(`[data-selected-connection-id="${fixture.alphaId}"]`)}))`);
  assertFocusedConnection(await report(), fixture.alphaId, FIXTURE.alphaLabel, fixture, `${label}/overlap-choice`);
  await pressKey(cdp, "Escape", "Escape");
  await driver.waitFor(`!document.querySelector(".connection-card") && document.querySelectorAll(".connection-route").length === 0`);
  assertDismissedFocus(await report(), [fixture.alphaId, fixture.betaId], `${label}/overlap-final-dismiss`);

  await assertLedgerUnchanged(annotationsRoot, ledgerBaseline, `${label}/complete`);
  console.log(`PASS ${label.padEnd(12)} click/shift Study · connected drag ${surface.id} · modal chooser keys · Focus Escape ladder · authored logs unchanged`);
}

function classifyFailure(error, context, childState) {
  if (error?.code === "QA_GUI_LAUNCH_BLOCKED") return "gui-launch-blocked";
  if (error?.code === "QA_GUI_LAUNCH_FAILED") return "gui-launch-failed";
  if (error?.code === "QA_GUI_LAUNCH_TIMEOUT") return "gui-launch-timeout";
  if (childState.exited && context.phase !== "cleanup") return "electron-process-crash";
  if (context.phase === "build") return "fresh-build-failure";
  return "reading-interaction-contract-failure";
}

async function writeFailureArtifacts(error, context, childState, childLog, driver, cdp) {
  mkdirSync(FAILURE_DIR, { recursive: true });
  let screenshotError = null;
  if (cdp) {
    try {
      const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      if (response.result?.data) writeFileSync(FAILURE_SCREENSHOT_PATH, Buffer.from(response.result.data, "base64"));
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
        activeElement: document.activeElement?.outerHTML?.slice(0, 2_000) ?? null,
        selectedVerses: [...document.querySelectorAll('.verse-line[aria-pressed="true"]')].map((row) => row.getAttribute("data-verse")),
        markingSurface: document.querySelector("[data-marking-surface]")?.getAttribute("data-marking-surface") ?? null,
        layerStack: typeof window.__pericopeLayerStack === "function" ? window.__pericopeLayerStack() : null,
        card: document.querySelector(".connection-card")?.outerHTML?.slice(0, 12_000) ?? null,
        chooser: document.querySelector(".connection-word-chooser")?.outerHTML?.slice(0, 8_000) ?? null,
        ticks: [...document.querySelectorAll("[data-connection-tick-side]")].map((tick) => ({
          id: tick.getAttribute("data-connection-tick"),
          members: tick.getAttribute("data-connection-tick-members"),
          aggregate: tick.hasAttribute("data-connection-tick-aggregate"),
          side: tick.getAttribute("data-connection-tick-side"),
          top: tick.style.top,
        })),
        paintPlanes: {
          route: Boolean(document.querySelector("[data-connection-overlay]")),
          emphasis: Boolean(document.querySelector("[data-connection-emphasis-overlay]")),
          tickLayer: Boolean(document.querySelector(".connection-tick-layer")),
          routeCount: document.querySelectorAll("[data-route-connection-id]").length,
        },
        floatingLayers: [...document.querySelectorAll('[data-floating-layer], .command-palette-root')].map((layer) => ({
          kind: layer.getAttribute("data-floating-layer") ?? "command-palette",
          className: layer.className,
          hidden: layer.hidden,
          ariaHidden: layer.getAttribute("aria-hidden"),
          text: layer.textContent?.trim().slice(0, 240) ?? "",
        })),
        escapeInterceptions: window["__qaEscapeInterceptions"] ?? [],
      }))()`);
    } catch (stateError) {
      renderer = { stateError: String(stateError) };
    }
  }
  const classification = classifyFailure(error, context, childState);
  writeFileSync(FAILURE_STATE_PATH, `${JSON.stringify({
    classification,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack, code: error.code, launchState: error.launchState }
      : String(error),
    context,
    childState,
    childLog,
    screenshotError,
    renderer,
  }, null, 2)}\n`);
  console.error(`Reading-interaction failure classification: ${classification}`);
  console.error(`Reading-interaction failure artifact: ${FAILURE_STATE_PATH}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-reading-interactions-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const annotationsRoot = join(libraryPath, "annotations");
const port = 11_300 + Math.floor(Math.random() * 500);
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
  childLog = (childLog + chunk.toString()).slice(-24_000);
};
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
let driver = null;
let failureContext = { phase: "launch" };
let gatePassed = false;
let runError = null;
try {
  const target = await waitForTarget(endpoint, childState);
  cdp = await connect(target.webSocketDebuggerUrl);
  driver = createDriver(cdp);
  const rendererDiagnostics = [];
  cdp.onMessage((message) => {
    if (message.method === "Runtime.exceptionThrown") {
      rendererDiagnostics.push({ type: "exception", detail: message.params?.exceptionDetails?.text ?? "Renderer exception" });
    } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      rendererDiagnostics.push({
        type: "console.error",
        detail: (message.params.args ?? []).map((argument) => argument.value ?? argument.description ?? "").join(" "),
      });
    } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      rendererDiagnostics.push({ type: "log.error", detail: message.params.entry.text });
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  failureContext = { phase: "renderer-bootstrap" };
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);
  // Library initialization reloads the renderer, so install event ownership
  // diagnostics only after the production reading shell is present.
  await installEscapeDiagnostics(driver);
  await setViewport(cdp, 860);

  failureContext = { phase: "exact-fixture-seed" };
  const fixture = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const wordsForVerse = (verse) => {
      const verseText = text(verse);
      const words = [...verseText.matchAll(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g)];
      if (words.length < 3) throw new Error("Dense chooser fixture verse is too short: " + verse);
      return words;
    };
    const phraseWindow = (verse, firstWord, wordCount) => {
      const verseText = text(verse);
      const words = wordsForVerse(verse);
      const first = words[firstWord];
      const last = words[firstWord + wordCount - 1];
      if (!first || !last || first.index == null || last.index == null) {
        throw new Error("Dense chooser phrase window is unavailable: " + verse + ":" + firstWord);
      }
      const charStart = first.index;
      const charEnd = last.index + last[0].length;
      return {
        verse,
        charStart,
        charEnd,
        quote: verseText.slice(charStart, charEnd),
      };
    };
    const capture = async (spec) => {
      const verseText = text(spec.verse);
      const start = Number.isInteger(spec.charStart) ? spec.charStart : verseText.indexOf(spec.quote);
      const end = Number.isInteger(spec.charEnd) ? spec.charEnd : start + spec.quote.length;
      if (start < 0) throw new Error("Fixture phrase is absent: " + spec.quote);
      if (verseText.slice(start, end) !== spec.quote) throw new Error("Fixture phrase offset drifted: " + spec.quote);
      const result = await window.api.library.captureConnectionSelection("bsb", [{
        book: "ACT",
        chapter: 19,
        verse: spec.verse,
        char_start: start,
        char_end: end,
        quote: spec.quote,
      }]);
      if (!result.ok || result.status !== "exact") {
        throw new Error("Exact fixture capture refused: " + JSON.stringify(result));
      }
      return result.anchor;
    };
    const occurrenceKeys = (anchor) => new Set(
      anchor.exact.occurrences.map((occurrence) => occurrence.verse + ":" + occurrence.position),
    );
    const sharesOccurrence = (left, right) => {
      const rightKeys = occurrenceKeys(right);
      return [...occurrenceKeys(left)].some((key) => rightKeys.has(key));
    };
    const closedThreeWordPhrase = async (verse) => {
      const words = wordsForVerse(verse);
      for (let firstWord = 0; firstWord <= words.length - 3; firstWord += 1) {
        const spec = phraseWindow(verse, firstWord, 3);
        const anchor = await capture(spec);
        const before = firstWord > 0 ? await capture(phraseWindow(verse, firstWord - 1, 1)) : null;
        const after = firstWord + 3 < words.length ? await capture(phraseWindow(verse, firstWord + 3, 1)) : null;
        if ((!before || !sharesOccurrence(anchor, before)) && (!after || !sharesOccurrence(anchor, after))) {
          return { spec, anchor };
        }
      }
      throw new Error("No occurrence-closed three-word phrase exists in verse " + verse);
    };
    const source = ${JSON.stringify(FIXTURE)};
    const alpha = await window.api.library.createConnection(
      "link:parallel",
      source.alphaLabel,
      "Unique Alpha words plus a deliberately shared phrase.",
      await Promise.all([capture(source.shared), capture(source.alphaUnique)]),
      "qa-reading-interactions-alpha",
    );
    if (!alpha.ok || !alpha.connection) throw new Error(alpha.error ?? "Alpha connection failed");
    const beta = await window.api.library.createConnection(
      "link:echo",
      source.betaLabel,
      "Unique Beta words plus a deliberately shared phrase.",
      await Promise.all([capture(source.shared), capture(source.betaUnique)]),
      "qa-reading-interactions-beta",
    );
    if (!beta.ok || !beta.connection) throw new Error(beta.error ?? "Beta connection failed");
    const denseSharedFixture = await closedThreeWordPhrase(13);
    const denseShared = denseSharedFixture.spec;
    const denseAnchor = denseSharedFixture.anchor;
    // Give every dense relationship the same two exact moments. This keeps the
    // 12-choice word overlap and its tick focus genuinely co-located, allowing
    // production collision grouping to be proven on the natural chapter rail.
    const denseCounterpartFixture = await closedThreeWordPhrase(14);
    const denseKinds = ["link:parallel", "link:contrast", "link:echo", "mirror", "series", "hinge"];
    const denseConnections = [];
    const denseProjectionRequests = [];
    const denseProjectionExpectations = [];
    for (let index = 0; index < 12; index += 1) {
      const label = "Dense overlap " + String(index + 1).padStart(2, "0");
      const created = await window.api.library.createConnection(
        denseKinds[index % denseKinds.length],
        label,
        "A dense overlap fixture that proves bounded chooser scrolling.",
        [denseAnchor, denseCounterpartFixture.anchor],
        "qa-reading-interactions-dense-" + (index + 1),
      );
      if (!created.ok || !created.connection) throw new Error(created.error ?? "Dense connection " + (index + 1) + " failed");
      if (typeof created.connection.activeEventId !== "string" || created.connection.activeEventId.length === 0) {
        throw new Error("Dense projection fixture has no active event id");
      }
      denseProjectionRequests.push({
        connectionId: created.connection.id,
        expectedActiveEventId: created.connection.activeEventId,
      });
      denseProjectionExpectations.push({
        connectionId: created.connection.id,
        anchors: [denseShared, denseCounterpartFixture.spec],
      });
      denseConnections.push({ id: created.connection.id, label });
    }
    const denseProjectionResponse = await window.api.library.projectConnections("bsb", denseProjectionRequests);
    if (!denseProjectionResponse.ok || denseProjectionResponse.projections.length !== denseProjectionExpectations.length) {
      throw new Error("Dense fixture projection batch failed: " + JSON.stringify(denseProjectionResponse));
    }
    for (const expected of denseProjectionExpectations) {
      const projection = denseProjectionResponse.projections.find((item) => item.connectionId === expected.connectionId);
      if (!projection || projection.status !== "exact" || projection.anchors.length !== expected.anchors.length) {
        throw new Error("Dense fixture projection is incomplete: " + expected.connectionId);
      }
      expected.anchors.forEach((spec, anchorIndex) => {
        const fragments = projection.anchors[anchorIndex]?.fragments ?? [];
        const fragment = fragments[0];
        if (
          fragments.length !== 1
          || !fragment
          || fragment.verse !== spec.verse
          || fragment.char_start !== spec.charStart
          || fragment.char_end !== spec.charEnd
          || fragment.quote !== spec.quote
        ) {
          throw new Error("Dense fixture did not round-trip byte-exactly: " + JSON.stringify({ expected: spec, fragments }));
        }
      });
    }
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
      sidebarCollapsed: true,
      marginVisible: true,
      markingSurface: "palette",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      alphaId: alpha.connection.id,
      betaId: beta.connection.id,
      denseShared,
      denseConnections,
      connectionCount: 2 + denseConnections.length,
    };
  })()`);
  assert.notEqual(fixture.alphaId, fixture.betaId, "fixture ids collided");
  assert.equal(fixture.denseConnections.length, 12, "dense overlap fixture count drifted");
  const ledgerBaseline = authoredLedgerSnapshot(annotationsRoot);
  assert.ok(ledgerBaseline.some((entry) => entry.file.endsWith("connections.jsonl") && entry.records === fixture.connectionCount), "fixture did not append every connection event");

  const completed = [];
  for (const surface of SURFACES) {
    for (const width of VIEWPORTS) {
      failureContext = { phase: "interaction-matrix", surface: surface.id, width };
      await runInteractionCell(driver, cdp, surface, width, fixture, annotationsRoot, ledgerBaseline);
      completed.push({ surface: surface.id, width });
    }
  }

  failureContext = { phase: "coarse-dense-tick-overflow" };
  await runCoarseDenseTickOverflowGate(driver, cdp, fixture, annotationsRoot, ledgerBaseline);

  failureContext = { phase: "renderer-diagnostics" };
  assert.deepEqual(rendererDiagnostics, [], `renderer emitted console/exception errors: ${JSON.stringify(rendererDiagnostics)}`);
  assert.equal(childState.exited, false, "Electron exited during the interaction matrix");
  gatePassed = true;
  console.log(`PASS reading interactions: ${completed.length}/8 Palette/Rail/Radial/Dock × 390/860 cells`);
  console.log("PASS exact-word overlap: two-choice pointer decision plus 12-choice modal roving and keyboard activation");
  console.log("PASS coarse tick overflow: natural side-local groups, nonoverlapping 44px lanes, chooser selection, explicit Release");
  console.log("PASS Escape ownership: chooser → selected shape → Focus mode, without implicit Release");
  console.log("PASS navigation integrity: click/Shift-click/Escape/click-away preserved authored JSONL byte-for-byte");
} catch (error) {
  runError = error;
  await writeFailureArtifacts(error, failureContext, childState, childLog, driver, cdp);
  if (childLog) console.error(childLog);
  throw error;
} finally {
  failureContext = { phase: "cleanup" };
  if (cdp) {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 }).catch(() => undefined);
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    cdp.ws.close();
  }
  let terminationError = null;
  if (!childState.exited) {
    try {
      child.kill("SIGTERM");
      if (!(await waitForChildExit(child, childState))) {
        terminationError = new Error(`Electron did not exit within the bounded SIGTERM window; isolated QA data remains at ${qaRoot}`);
      }
    } catch (error) {
      terminationError = error;
    }
  }
  if (childState.exited) {
    rmSync(qaRoot, { recursive: true, force: true });
  } else {
    console.error(`Reading-interaction cleanup preserved active QA data at ${qaRoot}`);
  }
  if (gatePassed) {
    // These exact files are generated solely by this isolated gate. A green
    // rerun retires stale red-run evidence without touching any other audit
    // artifacts that may belong to the worktree owner.
    rmSync(FAILURE_STATE_PATH, { force: true });
    rmSync(FAILURE_SCREENSHOT_PATH, { force: true });
  }
  if (terminationError) {
    if (runError instanceof Error) {
      runError.message = `${runError.message}; process cleanup also failed: ${String(terminationError)}`;
      runError.cleanupError = String(terminationError);
    } else if (runError != null) {
      throw new AggregateError([runError, terminationError], "Reading interaction gate and Electron cleanup both failed");
    } else {
      throw terminationError;
    }
  }
}
