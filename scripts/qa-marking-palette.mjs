/**
 * Permanent visual/interaction gate for the production marking Palette.
 *
 * Runs the real Electron renderer against an isolated profile and library.
 * The matrix proves that the complete two-vocabulary Palette remains usable
 * in every atmosphere and supported viewport, while the focused probes cover
 * keyboard traversal, reduced motion, forced colors, pinned-tool auto-apply,
 * and warm mount/unmount resource stability. User data is never touched.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const FIXTURE = {
  book: "ACT",
  chapter: 19,
  displayBook: "Acts",
  phrase: { verse: 8, quote: "the kingdom of God" },
  nextPhrase: { verse: 9, quote: "the Way" },
  stressPhrase: { verse: 7, quote: "about twelve" },
};
const GEOMETRY_EPSILON = 0.75;
const STRESS_CYCLES = 30;
const MAX_WARM_HEAP_GROWTH = 1024 * 1024;
const FAILURE_DIR = resolve("output/playwright");
const FAILURE_SCREENSHOT_PATH = join(FAILURE_DIR, "marking-palette-failure.png");
const FAILURE_STATE_PATH = join(FAILURE_DIR, "marking-palette-failure.json");
const SUCCESS_PROOF_PREFIX = "marking-palette-proof-";
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    ws.onopen = resolvePromise;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const resolveMessage = pending.get(message.id);
    pending.delete(message.id);
    resolveMessage(message);
  };
  const send = (method, params = {}) => new Promise((resolvePromise) => {
    const messageId = ++id;
    pending.set(messageId, resolvePromise);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ws, send };
}

async function waitForTarget(endpoint, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const pages = await (await fetch(endpoint)).json();
      const page = pages.find((candidate) => candidate.title === "Pericope");
      if (page) return page;
    } catch {
      // The isolated Electron process may still be opening its debug socket.
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${endpoint}`);
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

async function openPalette(driver, spec = FIXTURE.phrase, reduced = false) {
  const selected = await driver.evaluate(selectPhraseExpression(spec));
  assert.equal(selected, spec.quote, `native selection drifted for ${spec.quote}`);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="palette"] .marking-palette.is-placed'))`);
  await settle(driver, reduced);
}

async function pressKey(cdp, key, code = key, modifiers = 0, windowsVirtualKeyCode = undefined) {
  const params = { key, code, modifiers };
  if (windowsVirtualKeyCode != null) params.windowsVirtualKeyCode = windowsVirtualKeyCode;
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function closePalette(driver, cdp) {
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="palette"] .marking-palette')`);
  await settle(driver, true);
}

async function capturePaletteAestheticProofs(driver, cdp, frames) {
  await setMedia(cdp);
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await driver.evaluate(`(() => {
    getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-palette-proof-paper-rest.png");

  await openPalette(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-palette-proof-paper-open.png");
  await closePalette(driver, cdp);

  await setTheme(driver, "dark");
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-palette-proof-ink-rest.png");

  await openPalette(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await parkPointer(cdp);
  await settle(driver);
  await bufferSuccessScreenshot(cdp, frames, "marking-palette-proof-ink-open.png");
  await closePalette(driver, cdp);
  await setTheme(driver, "light");
}

function paletteReportExpression() {
  return `(() => {
    const root = document.querySelector('[data-marking-surface="palette"]');
    const palette = root?.querySelector(".marking-palette");
    const frame = palette?.querySelector(".marking-palette-frame");
    const stage = document.querySelector(".scripture-reading-stage");
    const relationships = [...(palette?.querySelectorAll("[data-relationship-kind]") ?? [])];
    const pigments = [...(palette?.querySelectorAll("[data-pigment]") ?? [])];
    const choices = [...relationships, ...pigments];
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const overflow = (element) => element ? Math.max(0, element.scrollWidth - element.clientWidth) : null;
    const paletteRect = rect(palette);
    const stageRect = rect(stage);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      stageSize: root?.getAttribute("data-stage-size") ?? null,
      layout: root?.getAttribute("data-palette-layout") ?? null,
      armed: root?.getAttribute("data-tool-armed") ?? null,
      paletteVisible: Boolean(palette && getComputedStyle(palette).visibility === "visible"),
      paletteRect,
      stageRect,
      contained: Boolean(
        paletteRect
        && stageRect
        && paletteRect.left >= stageRect.left - ${GEOMETRY_EPSILON}
        && paletteRect.top >= stageRect.top - ${GEOMETRY_EPSILON}
        && paletteRect.right <= stageRect.right + ${GEOMETRY_EPSILON}
        && paletteRect.bottom <= stageRect.bottom + ${GEOMETRY_EPSILON}
      ),
      overflow: {
        document: overflow(document.documentElement),
        body: overflow(document.body),
        scriptureBody: overflow(document.querySelector(".scripture-body")),
        stage: overflow(stage),
        palette: overflow(palette),
        frame: overflow(frame),
      },
      relationshipIds: relationships.map((choice) => choice.dataset.relationshipKind),
      relationshipLabels: relationships.map((choice) => choice.querySelector(".marking-choice-label")?.textContent?.trim()),
      relationshipShortcuts: relationships.map((choice) => choice.getAttribute("aria-keyshortcuts")),
      pigmentIds: pigments.map((choice) => choice.dataset.pigment),
      pigmentLabels: pigments.map((choice) => choice.querySelector(".marking-choice-label")?.textContent?.trim()),
      pigmentShortcuts: pigments.map((choice) => choice.getAttribute("aria-keyshortcuts")),
      describedBy: choices.map((choice) => choice.getAttribute("aria-describedby")),
      tabStops: choices.map((choice, index) => choice.tabIndex === 0 ? index : -1).filter((index) => index >= 0),
      activeIndex: choices.indexOf(document.activeElement),
      focusRing: root?.getAttribute("data-focus-ring") ?? null,
      activeOutlineStyle: document.activeElement instanceof HTMLElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : null,
      pressed: choices.filter((choice) => choice.getAttribute("aria-pressed") === "true").length,
      choiceHeights: choices.map((choice) => choice.getBoundingClientRect().height),
      reference: palette?.querySelector(".marking-palette-title > span")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      quote: palette?.querySelector(".marking-selection-quote")?.textContent?.trim() ?? null,
      quoteTitle: palette?.querySelector(".marking-selection-quote")?.getAttribute("title") ?? null,
      help: palette?.querySelector(".marking-palette-help")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      helpCount: palette?.querySelectorAll(".marking-palette-help").length ?? 0,
      pinPressed: palette?.querySelector(".marking-palette-pin")?.getAttribute("aria-pressed") ?? null,
    };
  })()`;
}

function assertPaletteReport(report, theme, viewport) {
  const label = `${THEME_LABELS.get(theme)}/${viewport.label}`;
  assert.deepEqual(report.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport drifted`);
  assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
  assert.equal(report.paletteVisible, true, `${label}: Palette remained hidden after measurement`);
  assert.equal(report.contained, true, `${label}: Palette escaped its own reading stage`);
  assert.equal(report.armed, "false", `${label}: a fresh selection inherited a stale tool`);
  assert.deepEqual(report.relationshipIds, RELATIONSHIPS, `${label}: relationship vocabulary drifted`);
  assert.deepEqual(report.relationshipLabels, RELATIONSHIP_LABELS, `${label}: relationship labels drifted`);
  assert.deepEqual(report.relationshipShortcuts, ["1", "2", "3", "4", "5", "6"], `${label}: relationship shortcuts drifted`);
  assert.deepEqual(report.pigmentIds, PIGMENTS, `${label}: wash vocabulary drifted`);
  assert.deepEqual(report.pigmentLabels, PIGMENT_LABELS, `${label}: wash labels drifted`);
  assert.deepEqual(report.pigmentShortcuts, ["Shift+1", "Shift+2", "Shift+3", "Shift+4", "Shift+5"], `${label}: wash shortcuts drifted`);
  assert.deepEqual(report.describedBy, Array(11).fill("marking-palette-help"), `${label}: choices lost shared help`);
  assert.deepEqual(report.tabStops, [0], `${label}: Palette must expose exactly one roving tab stop`);
  assert.equal(report.activeIndex, 0, `${label}: initial Palette focus did not reach the first command`);
  assert.equal(report.focusRing, "pointer", `${label}: pointer-open Palette exposed a keyboard focus ring mode`);
  assert.equal(report.activeOutlineStyle, "none", `${label}: programmatic initial focus painted an accent outline`);
  assert.equal(report.pressed, 0, `${label}: a fresh fixture exposed a selected command`);
  assert.equal(report.reference, `Mark selection · ${FIXTURE.displayBook} ${FIXTURE.chapter}:${FIXTURE.phrase.verse}`, `${label}: reference label drifted`);
  assert.equal(report.quote, `“${FIXTURE.phrase.quote}”`, `${label}: visible quote drifted`);
  assert.equal(report.quoteTitle, FIXTURE.phrase.quote, `${label}: complete quote title drifted`);
  assert.equal(report.helpCount, 1, `${label}: dynamic help must have one stable target`);
  assert.ok(
    report.help === "Connect the words — or lay a wash." || /^Parallelism · /.test(report.help),
    `${label}: resting or focused Palette help drifted`,
  );
  assert.equal(report.pinPressed, "false", `${label}: pin state leaked between selections`);
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    assert.ok(overflow != null && overflow <= GEOMETRY_EPSILON, `${label}: ${surface} overflowed horizontally by ${overflow}px`);
  }
  if (viewport.width === 390) {
    assert.equal(report.stageSize, "narrow", `${label}: narrow stage classification drifted`);
    assert.equal(report.layout, "sheet", `${label}: narrow Palette did not become a contained sheet`);
    for (const [index, height] of report.choiceHeights.entries()) {
      assert.ok(height >= 44 - GEOMETRY_EPSILON, `${label}: choice ${index + 1} is only ${height}px tall`);
    }
  }
  if (viewport.width === 860 && viewport.height === 420) {
    assert.equal(report.layout, "sheet", `${label}: short viewport did not become a contained sheet`);
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

async function assertTransientSelectionPaint(driver, cdp) {
  const before = await rangeCounts(driver);
  await openPalette(driver, FIXTURE.phrase);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
  await settle(driver);

  const selected = await driver.evaluate(`(() => {
    const group = document.querySelector("[data-marking-selection-emphasis]");
    const wash = group?.querySelector(".connection-emphasis-wash") ?? null;
    const neutralProbe = document.createElement("span");
    neutralProbe.style.color = "var(--study-gold)";
    document.body.append(neutralProbe);
    const neutralFill = getComputedStyle(neutralProbe).color;
    neutralProbe.remove();
    return {
      groups: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      washes: group?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      rendererOnlyId: group?.getAttribute("data-connection-id")?.startsWith("__marking-selection-emphasis__:") ?? false,
      paintState: group?.getAttribute("data-paint-state") ?? null,
      resolution: group?.getAttribute("data-anchor-resolution") ?? null,
      fill: wash ? getComputedStyle(wash).fill : null,
      neutralFill,
      nativeSelection: getSelection()?.toString() ?? "",
      authoringGroups: document.querySelectorAll("[data-authoring-draft]").length,
      routeGroups: document.querySelectorAll(".connection-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      underlines: document.querySelectorAll(".connection-underline").length,
      contacts: document.querySelectorAll(".connection-contact").length,
      hits: document.querySelectorAll(".connection-route-hit").length,
      ticks: document.querySelectorAll("[data-connection-tick]").length,
      veils: document.querySelectorAll(".connection-focus-veil").length,
      cards: document.querySelectorAll(".connection-card").length,
    };
  })()`);
  assert.equal(selected.groups, 1, "raw selection did not receive exactly one renderer-only emphasis group");
  assert.equal(selected.washes, 1, "raw selection did not receive exactly one merged emphasis wash");
  assert.equal(selected.rendererOnlyId, true, "raw selection emphasis did not retain its renderer-only identity");
  assert.equal(selected.paintState, "selection", "raw selection emphasis lost its neutral paint state");
  assert.equal(selected.resolution, "exact", "raw selection emphasis degraded from exact phrase coordinates");
  assert.equal(selected.fill, selected.neutralFill, "raw selection emphasis did not use the neutral focus ink");
  assert.equal(selected.nativeSelection, FIXTURE.phrase.quote, "raw selection emphasis drifted from the native selection");
  assert.deepEqual({
    authoringGroups: selected.authoringGroups,
    routeGroups: selected.routeGroups,
    routes: selected.routes,
    underlines: selected.underlines,
    contacts: selected.contacts,
    hits: selected.hits,
    ticks: selected.ticks,
    veils: selected.veils,
    cards: selected.cards,
  }, {
    authoringGroups: 0,
    routeGroups: 0,
    routes: 0,
    underlines: 0,
    contacts: 0,
    hits: 0,
    ticks: 0,
    veils: 0,
    cards: 0,
  }, "raw selection leaked connection line, tick, veil, card, or authoring paint");
  assert.deepEqual(await rangeCounts(driver), before, "raw selection changed durable marking records");

  const choseSeries = await driver.evaluate(`(() => {
    const choice = document.querySelector('[data-marking-surface="palette"] [data-relationship-kind="series"]');
    if (!choice) return false;
    choice.click();
    return true;
  })()`);
  assert.equal(choseSeries, true, "Palette Series relationship was unavailable");
  await driver.waitFor(`Boolean(document.querySelector('[data-authoring-draft] .connection-emphasis-wash'))
    && !document.querySelector('[data-marking-selection-emphasis]')`);
  await settle(driver);

  const authoring = await driver.evaluate(`(() => {
    const group = document.querySelector("[data-authoring-draft]");
    return {
      selectionGroups: document.querySelectorAll("[data-marking-selection-emphasis]").length,
      groups: document.querySelectorAll("[data-authoring-draft]").length,
      washes: group?.querySelectorAll(".connection-emphasis-wash").length ?? 0,
      paintState: group?.getAttribute("data-paint-state") ?? null,
      resolution: group?.getAttribute("data-anchor-resolution") ?? null,
      nativeSelection: getSelection()?.toString() ?? "",
      sessionKind: document.querySelector(".marking-session-kind")?.textContent?.trim() ?? null,
      sessionCopy: document.querySelector(".marking-session-copy")?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      routeGroups: document.querySelectorAll(".connection-mark").length,
      routes: document.querySelectorAll(".connection-route").length,
      underlines: document.querySelectorAll(".connection-underline").length,
      contacts: document.querySelectorAll(".connection-contact").length,
      hits: document.querySelectorAll(".connection-route-hit").length,
      ticks: document.querySelectorAll("[data-connection-tick]").length,
      veils: document.querySelectorAll(".connection-focus-veil").length,
      cards: document.querySelectorAll(".connection-card").length,
    };
  })()`);
  assert.equal(authoring.selectionGroups, 0, "Series capture retained stale raw-selection emphasis");
  assert.equal(authoring.groups, 1, "Series capture did not replace selection paint with one authoring group");
  assert.equal(authoring.washes, 1, "Series capture did not retain the exact phrase as one authoring wash");
  assert.equal(authoring.paintState, "authoring", "Series capture lost its authoring paint state");
  assert.equal(authoring.resolution, "exact", "Series authoring emphasis degraded from exact phrase coordinates");
  assert.equal(authoring.nativeSelection, "", "Series capture left native text selection active");
  assert.equal(authoring.sessionKind, "Series", "Series authoring session lost its relationship kind");
  assert.match(authoring.sessionCopy, /^1 marked · /, "Series authoring session did not hold the first phrase");
  assert.deepEqual({
    routeGroups: authoring.routeGroups,
    routes: authoring.routes,
    underlines: authoring.underlines,
    contacts: authoring.contacts,
    hits: authoring.hits,
    ticks: authoring.ticks,
    veils: authoring.veils,
    cards: authoring.cards,
  }, {
    routeGroups: 0,
    routes: 0,
    underlines: 0,
    contacts: 0,
    hits: 0,
    ticks: 0,
    veils: 0,
    cards: 0,
  }, "one held Series phrase leaked line, tick, veil, or card artifacts");
  assert.deepEqual(await rangeCounts(driver), before, "one held Series phrase reached the durable broker path");

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector("[data-authoring-draft]")
    && !document.querySelector(".marking-session")
    && !document.querySelector('[data-marking-surface="palette"]')`);
  assert.deepEqual(await rangeCounts(driver), before, "cancelling transient Palette authoring changed durable records");
}

async function assertRovingNavigation(driver, cdp) {
  const before = await rangeCounts(driver);
  assert.deepEqual(before, { highlights: 0, connections: 0 }, "keyboard fixture was not clean");
  await openPalette(driver);
  const focusChoice = async (index) => {
    const focused = await driver.evaluate(`(() => {
      const choices = [...document.querySelectorAll(
        '[data-marking-surface="palette"] [data-relationship-kind], [data-marking-surface="palette"] [data-pigment]'
      )];
      choices[${index}]?.focus({ preventScroll: true });
      return choices.length === 11;
    })()`);
    assert.equal(focused, true, `missing roving choice ${index}`);
    await driver.waitFor(`(() => {
      const choices = [...document.querySelectorAll(
        '[data-marking-surface="palette"] [data-relationship-kind], [data-marking-surface="palette"] [data-pigment]'
      )];
      return choices.indexOf(document.activeElement) === ${index}
        && choices.filter((choice) => choice.tabIndex === 0).length === 1
        && choices[${index}]?.tabIndex === 0;
    })()`);
  };
  const assertFocus = async (index, key) => {
    await driver.waitFor(`(() => {
      const choices = [...document.querySelectorAll(
        '[data-marking-surface="palette"] [data-relationship-kind], [data-marking-surface="palette"] [data-pigment]'
      )];
      return choices.indexOf(document.activeElement) === ${index}
        && choices.filter((choice) => choice.tabIndex === 0).length === 1
        && choices[${index}]?.tabIndex === 0
        && choices.every((choice) => choice.getAttribute("aria-pressed") === "false");
    })()`);
    const help = await driver.evaluate(`document.querySelector(".marking-palette-help")?.textContent?.replace(/\\s+/g, " ").trim()`);
    assert.match(help, new RegExp(`^${[...RELATIONSHIP_LABELS, ...PIGMENT_LABELS][index]} · `), `${key}: help did not follow roving focus`);
  };

  await focusChoice(5);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  await assertFocus(6, "ArrowRight across vocabulary boundary");
  await pressKey(cdp, "ArrowLeft", "ArrowLeft", 0, 37);
  await assertFocus(5, "ArrowLeft across vocabulary boundary");
  await pressKey(cdp, "End", "End", 0, 35);
  await assertFocus(10, "End");
  await pressKey(cdp, "Home", "Home", 0, 36);
  await assertFocus(0, "Home");
  await pressKey(cdp, "ArrowLeft", "ArrowLeft", 0, 37);
  await assertFocus(10, "ArrowLeft wrap");

  assert.deepEqual(await rangeCounts(driver), before, "roving navigation mutated authored records");
  await closePalette(driver, cdp);
}

function allZeroDurations(value) {
  return value.split(",").every((duration) => Number.parseFloat(duration) === 0);
}

async function assertReducedMotion(driver, cdp) {
  await setMedia(cdp, { reduced: true });
  await openPalette(driver, FIXTURE.phrase, true);
  const report = await driver.evaluate(`(() => {
    const palette = document.querySelector(".marking-palette");
    const targets = [
      palette,
      ...document.querySelectorAll(".marking-palette-action, .marking-palette .marking-choice"),
    ].filter(Boolean);
    return {
      active: matchMedia("(prefers-reduced-motion: reduce)").matches,
      durations: targets.map((target) => {
        const style = getComputedStyle(target);
        return { animation: style.animationDuration, transition: style.transitionDuration };
      }),
      runningAnimations: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="palette"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).map((animation) => {
        const target = animation.effect?.target;
        return {
          target: target instanceof Element ? target.className : null,
          playState: animation.playState,
          animationName: target instanceof Element ? getComputedStyle(target).animationName : null,
          animationDuration: target instanceof Element ? getComputedStyle(target).animationDuration : null,
          transitionDuration: target instanceof Element ? getComputedStyle(target).transitionDuration : null,
        };
      }),
    };
  })()`);
  assert.equal(report.active, true, "reduced-motion emulation did not reach the Palette");
  for (const [index, durations] of report.durations.entries()) {
    assert.equal(allZeroDurations(durations.animation), true, `reduced-motion target ${index} retained animation ${durations.animation}`);
    assert.equal(allZeroDurations(durations.transition), true, `reduced-motion target ${index} retained transition ${durations.transition}`);
  }
  assert.deepEqual(report.runningAnimations, [],
    `reduced-motion Palette retained active animation ${JSON.stringify(report.runningAnimations)}`);
  await closePalette(driver, cdp);
  await setMedia(cdp);
}

async function assertForcedColors(driver, cdp) {
  await setMedia(cdp, { forced: true });
  await openPalette(driver);
  await pressKey(cdp, "ArrowRight", "ArrowRight", 0, 39);
  const report = await driver.evaluate(`(() => {
    const palette = document.querySelector(".marking-palette");
    const first = document.querySelector('[data-marking-surface="palette"] [data-relationship-kind]');
    first?.focus({ preventScroll: true });
    const paletteStyle = palette ? getComputedStyle(palette) : null;
    const firstStyle = first ? getComputedStyle(first) : null;
    return {
      active: matchMedia("(forced-colors: active)").matches,
      codes: [...document.querySelectorAll(".marking-palette [data-pigment] .marking-pigment")]
        .map((swatch) => getComputedStyle(swatch, "::after").content.replace(/[\"']/g, "")),
      swatchBorders: [...document.querySelectorAll(".marking-palette [data-pigment] .marking-pigment")]
        .map((swatch) => getComputedStyle(swatch).borderStyle),
      boxShadow: paletteStyle?.boxShadow ?? null,
      borderStyle: paletteStyle?.borderStyle ?? null,
      focusOutline: {
        style: firstStyle?.outlineStyle ?? null,
        width: firstStyle?.outlineWidth ?? null,
      },
      choiceCount: document.querySelectorAll(
        '.marking-palette [data-relationship-kind], .marking-palette [data-pigment]'
      ).length,
    };
  })()`);
  assert.equal(report.active, true, "forced-colors emulation did not reach the Palette");
  assert.deepEqual(report.codes, FORCED_CODES, "forced colors lost the A/G/S/R/V wash vocabulary");
  assert.deepEqual(report.swatchBorders, Array(5).fill("solid"), "forced colors lost wash sample boundaries");
  assert.equal(report.boxShadow, "none", "forced colors retained decorative Palette shadow");
  assert.equal(report.borderStyle, "solid", "forced colors lost the Palette boundary");
  assert.equal(report.focusOutline.style, "solid", "forced colors lost keyboard focus style");
  assert.equal(report.focusOutline.width, "2px", "forced colors lost keyboard focus width");
  assert.equal(report.choiceCount, 11, "forced colors hid commands");
  await closePalette(driver, cdp);
  await setMedia(cdp);
}

async function collectRendererMemory(cdp) {
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const domResponse = await cdp.send("Memory.getDOMCounters");
  const heapResponse = await cdp.send("Runtime.getHeapUsage");
  return {
    dom: domResponse.result,
    usedHeap: heapResponse.result.usedSize,
  };
}

async function runPaletteStressBatch(driver, cycles) {
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
      if (!row || !span || !container) throw new Error("stress fixture missing");
      const text = span.textContent ?? "";
      const startOffset = text.indexOf(spec.quote);
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const locate = (offset) => {
        walker.currentNode = span;
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
      if (startOffset < 0 || !start || !end) throw new Error("stress phrase absent");
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
      await select();
      await waitUntil(
        () => Boolean(document.querySelector('[data-marking-surface="palette"] .marking-palette.is-placed')),
        "stress Palette did not mount",
      );
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }));
      await waitUntil(
        () => !document.querySelector('[data-marking-surface="palette"] .marking-palette'),
        "stress Palette did not unmount",
      );
    }
    getSelection()?.removeAllRanges();
    await frame();
    await frame();
    return {
      palettes: document.querySelectorAll(".marking-palette").length,
      hosts: document.querySelectorAll('[data-marking-surface="palette"]').length,
      armed: document.querySelectorAll(".marking-armed-status").length,
      activeMarkingAnimations: document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element
          && Boolean(target.closest('[data-marking-surface="palette"]'))
          && (animation.playState === "running" || animation.playState === "pending");
      }).length,
    };
  })()`);
}

async function assertWarmPlateau(driver, cdp) {
  const firstBatch = await runPaletteStressBatch(driver, STRESS_CYCLES);
  await settle(driver);
  const firstMemory = await collectRendererMemory(cdp);
  const secondBatch = await runPaletteStressBatch(driver, STRESS_CYCLES);
  await settle(driver);
  const secondMemory = await collectRendererMemory(cdp);
  assert.deepEqual(firstBatch, { palettes: 0, hosts: 0, armed: 0, activeMarkingAnimations: 0 }, "first warm batch retained Palette state");
  assert.deepEqual(secondBatch, firstBatch, "second warm batch retained Palette state");
  assert.deepEqual(secondMemory.dom, firstMemory.dom, "Palette cycles retained DOM documents, nodes, or listeners");
  const heapGrowth = secondMemory.usedHeap - firstMemory.usedHeap;
  assert.ok(heapGrowth <= MAX_WARM_HEAP_GROWTH, `second Palette batch retained ${heapGrowth} heap bytes`);
  return { heapGrowth, dom: secondMemory.dom };
}

async function assertRelationshipShortcut(driver, cdp) {
  const before = await rangeCounts(driver);
  await openPalette(driver, FIXTURE.stressPhrase);
  await pressKey(cdp, "6", "Digit6", 0, 54);
  await driver.waitFor(`(() => {
    const session = document.querySelector('[data-marking-surface="palette"] .marking-session');
    return Boolean(session
      && session.querySelector(".marking-session-kind")?.textContent?.includes("Hinge")
      && session.querySelector(".marking-session-copy")?.textContent?.includes("1/2"));
  })()`);
  assert.deepEqual(await rangeCounts(driver), before, "first relationship shortcut wrote an incomplete connection");
  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="palette"]')`);
}

async function assertPinnedAutoApply(driver, cdp) {
  const before = await rangeCounts(driver);
  await openPalette(driver, FIXTURE.phrase);
  const pinned = await driver.evaluate(`(() => {
    const pin = document.querySelector(".marking-palette-pin");
    if (!pin) return false;
    pin.click();
    return true;
  })()`);
  assert.equal(pinned, true, "Palette pin is missing");
  await driver.waitFor(`document.querySelector(".marking-palette-pin")?.getAttribute("aria-pressed") === "true"
    && document.querySelector(".marking-palette-help")?.textContent?.includes("remain in your hand")`);

  // Shift+3 exercises the production shortcut, chooses Sky, and must leave a
  // truthful armed-tool status after the first explicit user mutation.
  await pressKey(cdp, "#", "Digit3", 8, 51);
  await driver.waitFor(`Boolean(document.querySelector('.marking-armed-status[data-tool-armed="wash:blue"]'))`);
  await driver.waitFor(`window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)
    .then((result) => result.highlights.filter((record) => record.deleted === 0).length === ${before.highlights + 1})`);
  const armed = await driver.evaluate(`(() => {
    const root = document.querySelector('[data-marking-surface="palette"]');
    const status = root?.querySelector(".marking-armed-status");
    return {
      rootArmed: root?.getAttribute("data-tool-armed") ?? null,
      statusArmed: status?.getAttribute("data-tool-armed") ?? null,
      label: status?.querySelector(".marking-armed-tag")?.textContent?.trim() ?? null,
      guidance: status?.querySelector(".marking-armed-copy")?.textContent?.trim() ?? null,
      putDown: status?.querySelector("button")?.textContent?.trim() ?? null,
      paletteCount: root?.querySelectorAll(".marking-palette").length ?? -1,
    };
  })()`);
  assert.deepEqual(armed, {
    rootArmed: "wash:blue",
    statusArmed: "wash:blue",
    label: "Sky highlight",
    guidance: "Select more words to lay this wash again.",
    putDown: "Put tool down",
    paletteCount: 0,
  }, "armed Sky status drifted");

  await driver.evaluate(`(() => {
    window.__markingPaletteAdditions = 0;
    window.__markingPaletteObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(".marking-palette")) window.__markingPaletteAdditions += 1;
          window.__markingPaletteAdditions += node.querySelectorAll(".marking-palette").length;
        }
      }
    });
    window.__markingPaletteObserver.observe(document.body, { childList: true, subtree: true });
    return true;
  })()`);
  const selected = await driver.evaluate(selectPhraseExpression(FIXTURE.nextPhrase));
  assert.equal(selected, FIXTURE.nextPhrase.quote, "armed auto-apply selected the wrong phrase");
  await driver.waitFor(`window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)
    .then((result) => result.highlights.filter((record) => record.deleted === 0).length === ${before.highlights + 2})`);
  await driver.waitFor(`Boolean(document.querySelector('.marking-armed-status[data-tool-armed="wash:blue"]'))`);
  await settle(driver);
  const autoApply = await driver.evaluate(`(() => {
    window.__markingPaletteObserver?.disconnect();
    const result = {
      additions: window.__markingPaletteAdditions,
      palettes: document.querySelectorAll(".marking-palette").length,
      armed: document.querySelector(".marking-armed-status")?.getAttribute("data-tool-armed") ?? null,
    };
    delete window.__markingPaletteObserver;
    delete window.__markingPaletteAdditions;
    return result;
  })()`);
  assert.deepEqual(autoApply, { additions: 0, palettes: 0, armed: "wash:blue" }, "armed selection flashed or lost its tool");

  await pressKey(cdp, "Escape", "Escape", 0, 27);
  await driver.waitFor(`!document.querySelector('[data-marking-surface="palette"]')`);
  assert.deepEqual(await rangeCounts(driver), {
    highlights: before.highlights + 2,
    connections: before.connections,
  }, "putting down the tool changed authored records");
}

async function capturePaletteSelectedConnectionProof(driver, cdp, frames) {
  await setMedia(cdp);
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  const connection = await driver.evaluate(`(async () => {
    getSelection()?.removeAllRanges();
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const anchor = async (spec) => {
      const verseText = text(spec.verse);
      const start = verseText.indexOf(spec.quote);
      if (start < 0) throw new Error("Palette proof phrase is absent: " + spec.quote);
      const capture = await window.api.library.captureConnectionSelection("bsb", [{
        book: "ACT",
        chapter: 19,
        verse: spec.verse,
        char_start: start,
        char_end: start + spec.quote.length,
        quote: spec.quote,
      }]);
      if (!capture.ok || capture.status !== "exact") {
        throw new Error("Palette exact-anchor capture refused: " + JSON.stringify(capture));
      }
      return capture.anchor;
    };
    const anchors = await Promise.all(
      [${JSON.stringify(FIXTURE.phrase)}, ${JSON.stringify(FIXTURE.nextPhrase)}].map(anchor),
    );
    const created = await window.api.library.createConnection(
      "series",
      "Palette selected connection proof",
      "Two exact phrases prove dormant and selected Palette paint.",
      anchors,
      "qa-palette-selected-connection-proof",
    );
    if (!created.ok || !created.connection) throw new Error(created.error ?? "Palette proof connection failed");
    window.__paletteProofConnectionId = created.connection.id;
    return {
      id: created.connection.id,
      formatVersion: created.connection.format_version,
      observation: created.connection.observation,
      anchors: created.connection.anchors,
    };
  })()`);
  assert.ok(connection?.id, "Palette proof did not create a durable connection");
  assert.equal(connection.formatVersion, 2, "Palette proof did not persist the v2 connection format");
  assert.equal(connection.observation, "Two exact phrases prove dormant and selected Palette paint.", "Palette proof lost its v2 observation");
  assert.equal(connection.anchors.length, 2, "Palette proof connection lost an exact phrase");
  assert.equal(connection.anchors.every((anchor) => anchor.exact?.layer === "backbone-token:v1"), true, "Palette proof lost canonical exact selectors");
  assert.equal(connection.anchors.some((anchor) => Object.hasOwn(anchor, "render_locator")), false, "Palette proof leaked package render locators into v2 durability");
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.evaluate(`window.__paletteProofConnectionId = ${JSON.stringify(connection.id)}`);
  await driver.waitFor(`Boolean(document.querySelector('[data-connection-tick="' + CSS.escape(window.__paletteProofConnectionId) + '"]'))`);
  await driver.evaluate(`document.querySelector('[data-connection-tick="' + CSS.escape(window.__paletteProofConnectionId) + '"]')?.click()`);
  await driver.waitFor(`(() => {
    const id = window.__paletteProofConnectionId;
    return Boolean(
      document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(id) + '"] .connection-route')
      && document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(id) + '"][data-paint-state="selected"]')
      && document.querySelector(".connection-focus-veil")
      && document.querySelector("#connection-card-inspector")
    );
  })()`);
  await parkPointer(cdp);
  await settle(driver);
  const selected = await driver.evaluate(`(() => {
    const id = window.__paletteProofConnectionId;
    const group = document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(id) + '"]');
    return {
      routes: group?.querySelectorAll(".connection-route").length ?? 0,
      underlines: group?.querySelectorAll(".connection-underline").length ?? 0,
      card: document.querySelectorAll("#connection-card-inspector").length,
      veil: document.querySelectorAll(".connection-focus-veil").length,
    };
  })()`);
  assert.equal(selected.routes, 1, "Palette proof selected connection lost its bracket");
  assert.ok(selected.underlines >= 2, "Palette proof selected connection lost phrase underlines");
  assert.deepEqual({ card: selected.card, veil: selected.veil }, { card: 1, veil: 1 }, "Palette proof selected connection lost focus chrome");
  await bufferSuccessScreenshot(cdp, frames, "marking-palette-proof-selected-connection.png");

  await driver.evaluate(`document.querySelector('[data-connection-tick="' + CSS.escape(window.__paletteProofConnectionId) + '"]')?.click()`);
  await driver.waitFor(`!document.querySelector('.connection-mark[data-connection-id="' + CSS.escape(window.__paletteProofConnectionId) + '"]')
    && !document.querySelector("#connection-card-inspector")`);
  await driver.evaluate(`delete window.__paletteProofConnectionId`);
}

async function captureFailure(cdp, driver, error, context, childLog) {
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
        palette: document.querySelector(".marking-palette")?.outerHTML?.slice(0, 12000) ?? null,
        stage: document.querySelector(".scripture-reading-stage")?.getBoundingClientRect().toJSON?.() ?? null,
        activeElement: document.activeElement?.outerHTML?.slice(0, 2000) ?? null,
      }))()`);
    } catch (stateError) {
      renderer = { stateError: String(stateError) };
    }
  }
  writeFileSync(statePath, `${JSON.stringify({
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    context,
    screenshotError,
    renderer,
    childLog,
  }, null, 2)}\n`);
  console.error(`Palette failure artifacts: ${screenshotPath}, ${statePath}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-marking-palette-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const port = 10_100 + Math.floor(Math.random() * 500);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = { ...process.env, LIBRARY_PATH: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
);
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
  const target = await waitForTarget(endpoint);
  cdp = await connect(target.webSocketDebuggerUrl);
  driver = createDriver(cdp);
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);
  await setViewport(cdp, 1280, 900);

  const fixtureReady = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const fixtures = ${JSON.stringify([FIXTURE.phrase, FIXTURE.nextPhrase, FIXTURE.stressPhrase])};
    for (const fixture of fixtures) {
      if (!text(fixture.verse).includes(fixture.quote)) {
        throw new Error("fixture quote is absent: " + fixture.quote);
      }
    }
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
      sidebarCollapsed: true,
      marginVisible: false,
      markingSurface: "palette",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return true;
  })()`);
  assert.equal(fixtureReady, true, "Palette fixture setup failed");

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === "light"`);
  await driver.waitFor(`!document.querySelector(".living-margin")`);
  await setMedia(cdp);
  assert.deepEqual(await rangeCounts(driver), { highlights: 0, connections: 0 }, "isolated Palette library was not empty");

  const reports = [];
  for (const theme of THEMES) {
    failureContext = { phase: "matrix-theme", theme };
    await setViewport(cdp, 1280, 900);
    await setTheme(driver, theme);
    for (const viewport of VIEWPORTS) {
      failureContext = { phase: "matrix", theme, viewport };
      await setViewport(cdp, viewport.width, viewport.height);
      await openPalette(driver);
      const report = await driver.evaluate(paletteReportExpression());
      assertPaletteReport(report, theme, viewport);
      reports.push({ theme, ...viewport, layout: report.layout, palette: report.paletteRect });
      console.log(
        `${THEME_LABELS.get(theme).padEnd(11)} ${viewport.label.padStart(8)}  `
        + `${report.layout.padEnd(8)}  6 connect + 5 wash  overflow 0`,
      );
      await closePalette(driver, cdp);
    }
  }

  failureContext = { phase: "aesthetic-proofs" };
  await capturePaletteAestheticProofs(driver, cdp, successFrames);

  failureContext = { phase: "transient-selection-paint" };
  await assertTransientSelectionPaint(driver, cdp);

  failureContext = { phase: "keyboard-navigation" };
  await setViewport(cdp, 860, 900);
  await setTheme(driver, "light");
  await assertRovingNavigation(driver, cdp);

  failureContext = { phase: "reduced-motion" };
  await assertReducedMotion(driver, cdp);

  failureContext = { phase: "forced-colors" };
  await assertForcedColors(driver, cdp);

  failureContext = { phase: "warm-plateau" };
  const plateau = await assertWarmPlateau(driver, cdp);

  failureContext = { phase: "relationship-shortcut" };
  await assertRelationshipShortcut(driver, cdp);

  failureContext = { phase: "pinned-auto-apply" };
  await assertPinnedAutoApply(driver, cdp);

  failureContext = { phase: "selected-connection-proof" };
  await capturePaletteSelectedConnectionProof(driver, cdp, successFrames);
  assert.equal(successFrames.length, 5, "Palette proof set did not capture all five representative states");
  assert.equal(new Set(successFrames.map((frame) => frame.name)).size, successFrames.length, "Palette proof names were not unique");
  gatePassed = true;

  console.log("PASS Palette keyboard: one 11-command roving path, cross-boundary arrows, Home/End, Digit6 and Shift+Digit3");
  console.log("PASS Palette media: reduced motion terminal, forced colors A/G/S/R/V and visible focus");
  console.log(`PASS Palette warm plateau: ${STRESS_CYCLES * 2} mount/unmount cycles, stable DOM/listeners, heap delta ${plateau.heapGrowth} bytes`);
  console.log("PASS Palette pin: visible Sky status, next phrase auto-applied with 0 Palette additions, Escape put tool down");
  console.log("PASS Palette proofs: Paper/Ink rest + exact raw-selection open + selected connection");
  console.log(`PASS marking Palette: ${reports.length}/20 theme-viewport cells`);
} catch (error) {
  await captureFailure(cdp, driver, error, failureContext, childLog);
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) {
    await setMedia(cdp).catch(() => undefined);
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    cdp.ws.close();
  }
  child.kill("SIGTERM");
  await sleep(400);
  rmSync(qaRoot, { recursive: true, force: true });
  if (gatePassed) {
    writeSuccessScreenshots(successFrames);
    rmSync(FAILURE_SCREENSHOT_PATH, { force: true });
    rmSync(FAILURE_STATE_PATH, { force: true });
  }
}
