/**
 * Visible-paint contract for authored Scripture connections.
 *
 * Runs the real Electron renderer against an isolated temporary library and
 * profile. It proves dormant paint, focused paint, two-held companion paint,
 * release cleanup, merged exact-anchor paths, responsive overflow, ordinary
 * motion, and reduced-motion terminal states without touching user data.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const WIDTHS = [640, 860, 1280];
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
const HEIGHT = 900;
const STRESS_CYCLES = 50;
const OVERFLOW_EPSILON = 0.5;
const FRAME_EPSILON = 0.01;
const MAX_WARM_HEAP_GROWTH = 1024 * 1024;
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
    pending.get(message.id)(message);
    pending.delete(message.id);
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
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_200));
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

async function setReducedMotion(cdp, reduced) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }],
  });
}

async function setForcedColors(cdp, active) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-reduced-motion", value: "no-preference" },
      { name: "forced-colors", value: active ? "active" : "none" },
    ],
  });
}

async function settle(driver, reduced = false) {
  await driver.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    return true;
  })()`);
  await sleep(reduced ? 40 : 480);
}

async function clickTick(driver, connectionId) {
  const clicked = await driver.evaluate(`(() => {
    const tick = document.querySelector(${JSON.stringify(`[data-connection-tick="${connectionId}"]`)});
    if (!tick) return false;
    tick.click();
    return true;
  })()`);
  assert.equal(clicked, true, `missing connection tick ${connectionId}`);
}

async function restoreFocusMode(driver) {
  // Selecting a connection deliberately reveals Living Margin and exits Focus
  // mode. This paint-only gate then restores the full reading canvas before
  // evaluating route availability, matching the alignment harness.
  await driver.waitFor(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "false"`);
  await driver.evaluate(`document.querySelector("[data-instrument=focus]")?.click()`);
  await driver.waitFor(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true"
    && !document.querySelector(".living-margin")`);
}

function paintReportExpression(fixture) {
  return `(() => {
    const fixture = ${JSON.stringify(fixture)};
    const routeOverlay = document.querySelector("svg[data-connection-overlay]");
    const emphasisOverlay = document.querySelector("svg[data-connection-emphasis-overlay]");
    const tickLayer = document.querySelector(".connection-tick-layer");
    if (!routeOverlay || !emphasisOverlay || !tickLayer) return { error: "missing-paint-plane" };

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
    const strokeOnScreen = (element) => {
      if (!element) return null;
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error("missing SVG stroke matrix");
      const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
      return Number.parseFloat(getComputedStyle(element).strokeWidth) * scale;
    };
    const overflow = (element) => element
      ? Math.max(0, element.scrollWidth - element.clientWidth)
      : 0;
    const routeRect = rect(routeOverlay);
    const emphasisRect = rect(emphasisOverlay);
    const tickRect = rect(tickLayer);
    const frameDelta = routeRect && emphasisRect && tickRect
      ? Math.max(
        Math.abs(routeRect.left - emphasisRect.left),
        Math.abs(routeRect.top - emphasisRect.top),
        Math.abs(routeRect.right - emphasisRect.right),
        Math.abs(routeRect.bottom - emphasisRect.bottom),
        Math.abs(routeRect.left - tickRect.left),
        Math.abs(routeRect.top - tickRect.top),
        Math.abs(routeRect.right - tickRect.right),
        Math.abs(routeRect.bottom - tickRect.bottom),
      )
      : Number.POSITIVE_INFINITY;

    const locate = (root, offset) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
    const renderedLineCount = (spec) => {
      const row = [...document.querySelectorAll(".verse-line[data-verse]")]
        .find((candidate) => Number(candidate.dataset.verse) === spec.verse);
      const span = row?.querySelector(".verse-text-span");
      if (!span) throw new Error("missing verse " + spec.verse);
      const text = span.textContent ?? "";
      const startOffset = spec.quote == null ? 0 : text.indexOf(spec.quote);
      if (startOffset < 0) throw new Error("fixture quote not found: " + spec.quote);
      const endOffset = spec.quote == null ? text.length : startOffset + spec.quote.length;
      const start = locate(span, startOffset);
      const end = locate(span, endOffset);
      if (!start || !end) throw new Error("fixture offsets could not be located");
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const lines = [];
      for (const value of range.getClientRects()) {
        if (value.width <= .5 || value.height <= 1) continue;
        const centerY = value.bottom - .75;
        const line = lines.find((candidate) => Math.abs(candidate.centerY - centerY) < 2.5);
        if (!line) lines.push({ centerY, left: value.left, right: value.right });
        else {
          line.left = Math.min(line.left, value.left);
          line.right = Math.max(line.right, value.right);
        }
      }
      return lines.length;
    };

    const specsById = new Map([
      [fixture.firstId, fixture.firstSpecs],
      [fixture.secondId, fixture.secondSpecs],
      [fixture.thirdId, fixture.thirdSpecs],
    ]);
    const lineCounts = {};
    for (const [connectionId, specs] of specsById) {
      lineCounts[connectionId] = specs.map(renderedLineCount);
    }

    const connectionState = (connectionId) => {
      const mark = document.querySelector(
        '.connection-mark[data-connection-id="' + CSS.escape(connectionId) + '"]'
      );
      const emphasis = document.querySelector(
        '.connection-emphasis-mark[data-connection-id="' + CSS.escape(connectionId) + '"]'
      );
      const tick = document.querySelector(
        '[data-connection-tick="' + CSS.escape(connectionId) + '"]'
      );
      const washes = emphasis ? [...emphasis.querySelectorAll(".connection-emphasis-wash")] : [];
      const washCounts = new Map();
      for (const wash of washes) {
        const anchorIndex = Number(wash.dataset.anchorIndex);
        washCounts.set(anchorIndex, (washCounts.get(anchorIndex) ?? 0) + 1);
      }
      const washLineCounts = lineCounts[connectionId].map((_, anchorIndex) => {
        const wash = washes.find((candidate) => Number(candidate.dataset.anchorIndex) === anchorIndex);
        return wash ? Number(wash.dataset.lineCount) : null;
      });
      const underlines = mark ? [...mark.querySelectorAll(".connection-underline")] : [];
      const underlineIndices = lineCounts[connectionId].map((_, anchorIndex) => underlines
        .filter((path) => Number(path.dataset.anchorIndex) === anchorIndex)
        .map((path) => Number(path.dataset.lineIndex))
        .sort((left, right) => left - right));
      const firstWash = washes[0] ?? null;
      const firstUnderline = underlines[0] ?? null;
      const route = mark?.querySelector(".connection-route") ?? null;
      const contact = mark?.querySelector(".connection-contact") ?? null;
      return {
        present: Boolean(mark),
        classes: mark?.className.baseVal ?? "",
        paintState: mark?.dataset.paintState ?? null,
        routeState: mark?.dataset.route ?? null,
        anchorResolution: mark?.dataset.anchorResolution ?? null,
        routeCount: mark?.querySelectorAll(".connection-route").length ?? 0,
        routeHitCount: mark?.querySelectorAll(".connection-route-hit").length ?? 0,
        contactCount: mark?.querySelectorAll(".connection-contact").length ?? 0,
        underlineCount: underlines.length,
        underlineIndices,
        underlineMatchesLines: underlineIndices.every((indices, anchorIndex) =>
          indices.length === lineCounts[connectionId][anchorIndex]
          && indices.every((lineIndex, index) => lineIndex === index)),
        underlineStroke: strokeOnScreen(firstUnderline),
        underlineOpacity: firstUnderline ? Number.parseFloat(getComputedStyle(firstUnderline).opacity) : null,
        routeStroke: strokeOnScreen(route),
        routeOpacity: route ? Number.parseFloat(getComputedStyle(route).opacity) : null,
        washCount: washes.length,
        oneWashPerAnchor: lineCounts[connectionId].every((_, anchorIndex) => washCounts.get(anchorIndex) === 1),
        washLineCounts,
        washLinesMatchRange: washLineCounts.every((lineCount, anchorIndex) =>
          lineCount === lineCounts[connectionId][anchorIndex]),
        validWashPaths: washes.every((wash) => {
          const path = wash.getAttribute("d") ?? "";
          return path.startsWith("M") && /[zZ]\s*$/.test(path) && !path.includes("NaN");
        }),
        washOpacity: firstWash ? Number.parseFloat(getComputedStyle(firstWash).fillOpacity) : null,
        emphasisPaintState: emphasis?.dataset.paintState ?? null,
        emphasisResolution: emphasis?.dataset.anchorResolution ?? null,
        pressed: tick?.getAttribute("aria-pressed") ?? null,
        expanded: tick?.getAttribute("aria-expanded") ?? null,
        transitions: {
          wash: firstWash ? getComputedStyle(firstWash).transitionDuration : null,
          underline: firstUnderline ? getComputedStyle(firstUnderline).transitionDuration : null,
          route: route ? getComputedStyle(route).transitionDuration : null,
          routeDelay: route ? getComputedStyle(route).transitionDelay : null,
          contact: contact ? getComputedStyle(contact).transitionDuration : null,
        },
      };
    };

    const veil = document.querySelector(".connection-focus-veil");
    const allWashes = [...document.querySelectorAll(".connection-emphasis-wash")];
    return {
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      routeMarkCount: document.querySelectorAll(".connection-mark").length,
      routeCount: document.querySelectorAll(".connection-route").length,
      routeHitCount: document.querySelectorAll(".connection-route-hit").length,
      contactCount: document.querySelectorAll(".connection-contact").length,
      underlineCount: document.querySelectorAll(".connection-underline").length,
      veilCount: document.querySelectorAll(".connection-focus-veil").length,
      veilReadyCount: document.querySelectorAll(".connection-focus-veil.is-ready").length,
      veilOpacity: veil ? Number.parseFloat(getComputedStyle(veil).opacity) : null,
      veilTransition: veil ? getComputedStyle(veil).transitionDuration : null,
      emphasisMarkCount: document.querySelectorAll(".connection-emphasis-mark").length,
      washCount: allWashes.length,
      exactEmphasisCount: document.querySelectorAll(
        '.connection-emphasis-mark[data-anchor-resolution="exact"]'
      ).length,
      dormantEmphasisCount: document.querySelectorAll(
        '.connection-emphasis-mark[data-paint-state="dormant"]'
      ).length,
      selectedEmphasisCount: document.querySelectorAll(
        '.connection-emphasis-mark[data-paint-state="selected"]'
      ).length,
      previewEmphasisCount: document.querySelectorAll(
        '.connection-emphasis-mark[data-paint-state="preview"]'
      ).length,
      companionEmphasisCount: document.querySelectorAll(
        '.connection-emphasis-mark[data-paint-state="companion"]'
      ).length,
      cardCount: document.querySelectorAll(".connection-card").length,
      frameDelta,
      frameContracts: {
        route: routeOverlay.dataset.coordinateFrame + ":" + routeOverlay.dataset.connectionOverlayFrame,
        emphasis: emphasisOverlay.dataset.coordinateFrame + ":" + emphasisOverlay.dataset.connectionOverlayFrame,
      },
      overflow: {
        document: overflow(document.documentElement),
        body: overflow(document.querySelector(".scripture-body")),
        stage: overflow(document.querySelector(".scripture-reading-stage")),
        reading: overflow(document.querySelector(".scripture-content")),
        margin: overflow(document.querySelector(".living-margin")),
      },
      lineCounts,
      first: connectionState(fixture.firstId),
      second: connectionState(fixture.secondId),
      third: connectionState(fixture.thirdId),
    };
  })()`;
}

function assertCommon(report, label, width, theme) {
  assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
  assert.deepEqual(report.viewport, { width, height: HEIGHT }, `${label}: viewport drifted`);
  assert.equal(report.emphasisMarkCount, 3, `${label}: a connection presence wash disappeared`);
  assert.equal(report.washCount, 6, `${label}: expected one merged wash per exact anchor`);
  assert.equal(report.exactEmphasisCount, 3, `${label}: an exact anchor degraded to passage paint`);
  assert.equal(report.first.oneWashPerAnchor, true, `${label}: first relationship chopped a wash by line`);
  assert.equal(report.second.oneWashPerAnchor, true, `${label}: second relationship chopped a wash by line`);
  assert.equal(report.first.washLinesMatchRange, true,
    `${label}: first merged wash stopped matching independent Range line geometry`);
  assert.equal(report.second.washLinesMatchRange, true,
    `${label}: second merged wash stopped matching independent Range line geometry`);
  assert.equal(report.third.oneWashPerAnchor, true, `${label}: wrapped proof chopped a wash by line`);
  assert.equal(report.third.washLinesMatchRange, true,
    `${label}: wrapped proof stopped matching independent Range line geometry`);
  assert.equal(report.first.validWashPaths, true, `${label}: first relationship emitted malformed wash geometry`);
  assert.equal(report.second.validWashPaths, true, `${label}: second relationship emitted malformed wash geometry`);
  assert.equal(report.third.validWashPaths, true, `${label}: wrapped proof emitted malformed wash geometry`);
  assert.ok(Math.max(...Object.values(report.lineCounts).flat()) > 1,
    `${label}: fixture did not exercise a wrapped exact anchor`);
  assert.equal(report.frameDelta <= FRAME_EPSILON, true,
    `${label}: paint planes diverged by ${report.frameDelta}px`);
  assert.deepEqual(report.frameContracts, { route: "self:self", emphasis: "self:self" },
    `${label}: a paint plane stopped measuring against itself`);
  for (const [surface, overflow] of Object.entries(report.overflow)) {
    assert.ok(overflow <= OVERFLOW_EPSILON, `${label}: ${surface} overflowed horizontally by ${overflow}px`);
  }
}

function assertRest(report, label, width, theme) {
  assertCommon(report, label, width, theme);
  assert.equal(report.routeMarkCount, 0, `${label}: rest mounted route-plane marks`);
  assert.equal(report.routeCount, 0, `${label}: rest painted a centerline`);
  assert.equal(report.routeHitCount, 0, `${label}: rest mounted an invisible route hit target`);
  assert.equal(report.contactCount, 0, `${label}: rest painted route contacts`);
  assert.equal(report.underlineCount, 0, `${label}: rest painted an underline`);
  assert.equal(report.veilCount, 0, `${label}: rest mounted the focus veil`);
  assert.equal(report.cardCount, 0, `${label}: rest retained a connection card`);
  assert.equal(report.dormantEmphasisCount, 3, `${label}: rest lost dormant presence paint`);
  assert.equal(report.first.pressed, "false", `${label}: first tick stayed held at rest`);
  assert.equal(report.second.pressed, "false", `${label}: second tick stayed held at rest`);
  assert.equal(report.first.expanded, "false", `${label}: first tick stayed expanded at rest`);
  assert.equal(report.second.expanded, "false", `${label}: second tick stayed expanded at rest`);
  assert.equal(report.third.pressed, "false", `${label}: wrapped-proof tick stayed held at rest`);
  assert.equal(report.third.expanded, "false", `${label}: wrapped-proof tick stayed expanded at rest`);
  const expectedOpacity = theme === "dark" || theme === "onyx" ? 0.045 : 0.09;
  assert.equal(report.first.washOpacity, expectedOpacity, `${label}: dormant wash opacity drifted`);
  assert.equal(report.second.washOpacity, expectedOpacity, `${label}: dormant wash opacity drifted`);
  assert.equal(report.third.washOpacity, expectedOpacity, `${label}: dormant wash opacity drifted`);
}

function assertPreview(report, label, width, theme) {
  assertCommon(report, label, width, theme);
  assert.equal(report.routeMarkCount, 0, `${label}: preview mounted route-plane ink`);
  assert.equal(report.routeCount, 0, `${label}: preview painted a centerline before selection`);
  assert.equal(report.routeHitCount, 0, `${label}: preview mounted a hit target before selection`);
  assert.equal(report.contactCount, 0, `${label}: preview painted contacts before selection`);
  assert.equal(report.underlineCount, 0, `${label}: preview painted an underline before selection`);
  assert.equal(report.veilCount, 0, `${label}: preview dimmed the canvas before selection`);
  assert.equal(report.cardCount, 0, `${label}: preview opened the Living Margin card`);
  assert.equal(report.previewEmphasisCount, 1, `${label}: preview did not wake exactly one phrase group`);
  assert.equal(report.dormantEmphasisCount, 2, `${label}: preview changed unrelated emphasis state`);
  assert.equal(report.first.emphasisPaintState, "preview", `${label}: preview state drifted`);
  assert.equal(report.first.washOpacity, 0.12, `${label}: preview wash opacity drifted`);
  assert.equal(report.first.pressed, "false", `${label}: preview falsely held the tick`);
  assert.equal(report.first.expanded, "false", `${label}: preview falsely selected the tick`);
}

function assertSelected(report, label, width, theme, selectedKey, quietKey) {
  assertCommon(report, label, width, theme);
  const selected = report[selectedKey];
  const quiet = report[quietKey];
  assert.equal(report.routeMarkCount, 1, `${label}: selected paint mounted more than its focus mark`);
  assert.equal(report.routeCount, 1,
    `${label}: selected paint did not own exactly one route (${selectedKey} ${selected.classes || "missing"}, ${selected.routeState})`);
  assert.equal(report.routeHitCount, 1, `${label}: selected paint did not own exactly one route hit target`);
  assert.ok(report.contactCount > 0, `${label}: selected paint lost route contacts`);
  assert.equal(report.veilCount, 1, `${label}: selected paint lost its focus veil`);
  assert.equal(report.veilReadyCount, 1, `${label}: selected focus veil did not reach its ready state`);
  assert.ok(report.veilOpacity >= 0.5, `${label}: focus veil did not bring selected words forward`);
  assert.equal(report.selectedEmphasisCount, 1, `${label}: selected emphasis state drifted`);
  assert.equal(report.dormantEmphasisCount, 2, `${label}: quiet emphasis state drifted`);
  assert.equal(selected.present, true, `${label}: selected route mark disappeared`);
  assert.match(selected.classes, /\bfocused\b/, `${label}: selected mark lost focus`);
  assert.match(selected.classes, /\bselected\b/, `${label}: selected mark lost selection`);
  assert.match(selected.classes, /\buser-held\b/, `${label}: selected mark lost its held state`);
  assert.match(selected.classes, /\broute-ready\b/, `${label}: selected route did not finish painting`);
  assert.equal(selected.routeCount, 1, `${label}: selected relationship route count drifted`);
  assert.equal(selected.routeHitCount, 1, `${label}: selected relationship hit target count drifted`);
  assert.ok(selected.contactCount > 0, `${label}: selected relationship contacts disappeared`);
  assert.equal(selected.underlineMatchesLines, true, `${label}: merged underline lines drifted from Range geometry`);
  assert.ok(Math.abs(selected.underlineStroke - 1.5) <= 0.01,
    `${label}: selected underline width drifted to ${selected.underlineStroke}px`);
  assert.ok(Math.abs(selected.routeStroke - 1.5) <= 0.01,
    `${label}: selected route width drifted to ${selected.routeStroke}px`);
  assert.ok(selected.routeOpacity >= 0.9, `${label}: selected route did not reach terminal opacity`);
  assert.equal(selected.emphasisPaintState, "selected", `${label}: selected wash state drifted`);
  assert.equal(selected.washOpacity, 0.16, `${label}: selected wash opacity drifted`);
  assert.equal(selected.pressed, "true", `${label}: selected tick did not expose held state`);
  assert.equal(selected.expanded, "true", `${label}: selected tick did not expose focused state`);
  assert.equal(quiet.present, false, `${label}: dormant relationship mounted route paint`);
  assert.equal(quiet.washOpacity, 0, `${label}: nonmember wash did not recede during focus`);
  assert.equal(quiet.pressed, "false", `${label}: quiet tick became held`);
  assert.equal(quiet.expanded, "false", `${label}: quiet tick became expanded`);
  assert.equal(report.third.present, false, `${label}: wrapped dormant proof mounted route paint`);
  assert.equal(report.third.washOpacity, 0, `${label}: wrapped nonmember wash did not recede during focus`);
  assert.equal(report.third.pressed, "false", `${label}: wrapped dormant tick became held`);
}

function assertTwoHeld(report, label, width, theme) {
  assertCommon(report, label, width, theme);
  assert.equal(report.routeMarkCount, 2, `${label}: focus plus companion route marks drifted`);
  assert.equal(report.routeCount, 1, `${label}: companion leaked a centerline`);
  assert.equal(report.routeHitCount, 1, `${label}: companion leaked an invisible hit target`);
  assert.equal(report.selectedEmphasisCount, 1, `${label}: focused wash state drifted`);
  assert.equal(report.companionEmphasisCount, 1, `${label}: companion wash state drifted`);
  assert.equal(report.dormantEmphasisCount, 1, `${label}: wrapped proof did not remain dormant`);
  assert.equal(report.first.present, true, `${label}: companion paint disappeared`);
  assert.match(report.first.classes, /\bcompanion\b/, `${label}: prior selection was not a companion`);
  assert.doesNotMatch(report.first.classes, /\bfocused\b/, `${label}: companion retained focus`);
  assert.equal(report.first.routeCount, 0, `${label}: companion painted a centerline`);
  assert.equal(report.first.routeHitCount, 0, `${label}: companion painted a hit target`);
  assert.equal(report.first.contactCount, 0, `${label}: companion painted route contacts`);
  assert.equal(report.first.underlineMatchesLines, true, `${label}: companion underlines stopped following rendered lines`);
  assert.ok(Math.abs(report.first.underlineStroke - 1) <= 0.01,
    `${label}: companion underline width drifted to ${report.first.underlineStroke}px`);
  assert.ok(report.first.underlineOpacity > 0 && report.first.underlineOpacity <= 0.72,
    `${label}: companion underline stopped reading as a quiet whisper`);
  assert.equal(report.first.washOpacity, 0.05, `${label}: companion wash opacity drifted`);
  assert.equal(report.second.present, true, `${label}: focused paint disappeared`);
  assert.match(report.second.classes, /\bfocused\b/, `${label}: newest hold did not own focus`);
  assert.match(report.second.classes, /\bselected\b/, `${label}: newest hold did not own selection`);
  assert.equal(report.second.routeCount, 1, `${label}: newest hold lost its sole route`);
  assert.equal(report.second.routeHitCount, 1, `${label}: newest hold lost its sole hit target`);
  assert.equal(report.second.underlineMatchesLines, true, `${label}: focused underlines stopped following rendered lines`);
  assert.ok(Math.abs(report.second.underlineStroke - 1.5) <= 0.01,
    `${label}: focused underline width drifted to ${report.second.underlineStroke}px`);
  assert.ok(Math.abs(report.second.routeStroke - 1.5) <= 0.01,
    `${label}: focused route width drifted to ${report.second.routeStroke}px`);
  assert.equal(report.second.washOpacity, 0.16, `${label}: focused wash opacity drifted`);
  assert.equal(report.first.pressed, "true", `${label}: companion tick lost held state`);
  assert.equal(report.first.expanded, "false", `${label}: companion tick remained expanded`);
  assert.equal(report.second.pressed, "true", `${label}: focus tick lost held state`);
  assert.equal(report.second.expanded, "true", `${label}: focus tick lost expanded state`);
  assert.equal(report.third.present, false, `${label}: dormant wrapped proof mounted route paint`);
  assert.equal(report.third.washOpacity, 0, `${label}: dormant wrapped wash did not recede`);
}

function assertOrdinaryMotion(report, label) {
  assert.equal(report.reducedMotion, false, `${label}: ordinary motion probe inherited reduce`);
  assert.match(report.first.transitions.wash ?? "", /0\.22s/, `${label}: wash transition drifted`);
  assert.match(report.veilTransition ?? "", /0\.18s/, `${label}: veil transition drifted`);
  assert.match(report.first.transitions.underline ?? "", /0\.3s/, `${label}: underline draw transition drifted`);
  assert.match(report.first.transitions.route ?? "", /0\.34s/, `${label}: route growth transition drifted`);
  assert.match(report.first.transitions.routeDelay ?? "", /0\.04s/, `${label}: route growth delay drifted`);
  assert.match(report.first.transitions.contact ?? "", /0\.2s/, `${label}: contact transition drifted`);
}

function assertReducedMotion(report, label) {
  assert.equal(report.reducedMotion, true, `${label}: reduced-motion emulation did not reach the renderer`);
  assertSelected(report, label, 860, report.theme, "first", "second");
  for (const [surface, duration] of Object.entries({
    wash: report.first.transitions.wash,
    veil: report.veilTransition,
    underline: report.first.transitions.underline,
    route: report.first.transitions.route,
    contact: report.first.transitions.contact,
  })) {
    assert.ok(duration == null || duration.split(",").every((part) => part.trim() === "0s"),
      `${label}: ${surface} retained motion duration ${duration}`);
  }
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

async function runFocusStressBatch(driver, fixture, cycles) {
  return driver.evaluate(`(async () => {
    const fixture = ${JSON.stringify(fixture)};
    const frame = () => new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    const assertFocus = (expectedId) => {
      const focused = [...document.querySelectorAll(".connection-mark.focused.selected.route-ready")];
      const emphasis = [...document.querySelectorAll(
        '.connection-emphasis-mark[data-paint-state="selected"]'
      )];
      const expanded = [...document.querySelectorAll('[data-connection-tick][aria-expanded="true"]')];
      if (focused.length !== 1 || focused[0].dataset.connectionId !== expectedId) {
        throw new Error("stress focus drift: " + focused.map((item) => item.dataset.connectionId).join(","));
      }
      if (emphasis.length !== 1 || emphasis[0].dataset.connectionId !== expectedId) {
        throw new Error("stress emphasis drift");
      }
      if (expanded.length !== 1 || expanded[0].dataset.connectionTick !== expectedId) {
        throw new Error("stress expanded tick drift");
      }
      if (document.querySelectorAll(".connection-route").length !== 1
        || document.querySelectorAll(".connection-route-hit").length !== 1
        || document.querySelectorAll(".connection-focus-veil.is-ready").length !== 1
        || document.querySelectorAll(".connection-mark.route-ready:not(.focused)").length !== 0) {
        throw new Error("stress retained stale route paint");
      }
    };
    const switchWithTick = async (tickId, expectedId) => {
      const tick = document.querySelector('[data-connection-tick="' + CSS.escape(tickId) + '"]');
      if (!tick) throw new Error("stress tick missing: " + tickId);
      tick.click();
      await frame();
      await frame();
      assertFocus(expectedId);
    };
    for (let cycle = 0; cycle < ${cycles}; cycle += 1) {
      await switchWithTick(fixture.secondId, fixture.secondId);
      await switchWithTick(fixture.secondId, fixture.firstId);
    }
    return {
      rangeReads: window.__connectionRangeReads,
      nodes: {
        marks: document.querySelectorAll(".connection-mark").length,
        routes: document.querySelectorAll(".connection-route").length,
        hits: document.querySelectorAll(".connection-route-hit").length,
        contacts: document.querySelectorAll(".connection-contact").length,
        underlines: document.querySelectorAll(".connection-underline").length,
        emphasis: document.querySelectorAll(".connection-emphasis-mark").length,
        washes: document.querySelectorAll(".connection-emphasis-wash").length,
        ticks: document.querySelectorAll("[data-connection-tick]").length,
        cards: document.querySelectorAll(".connection-card").length,
        veils: document.querySelectorAll(".connection-focus-veil").length,
      },
    };
  })()`);
}

async function assertFocusStress(driver, cdp, fixture) {
  await setReducedMotion(cdp, false);
  // The theme picker intentionally collapses out of the narrow header, so
  // normalize the atmosphere while the final matrix cell is still wide.
  await setTheme(driver, "light");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 860,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await settle(driver);

  // Leave Living Margin open for this phase. A focus-only state change should
  // not alter the reading stage, so any Range read from here is avoidable work.
  await clickTick(driver, fixture.firstId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(
    `.connection-mark.selected.route-ready[data-connection-id="${fixture.firstId}"]`,
  )}))`);
  await settle(driver);
  await clickTick(driver, fixture.secondId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(
    `.connection-mark.selected.route-ready[data-connection-id="${fixture.secondId}"]`,
  )}))`);
  await settle(driver);
  await clickTick(driver, fixture.secondId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(
    `.connection-mark.selected.route-ready[data-connection-id="${fixture.firstId}"]`,
  )}))`);
  await settle(driver);

  await driver.evaluate(`(() => {
    window.__connectionOriginalGetClientRects ??= Range.prototype.getClientRects;
    window.__connectionRangeReads = 0;
    const original = window.__connectionOriginalGetClientRects;
    Range.prototype.getClientRects = function (...args) {
      window.__connectionRangeReads += 1;
      return Reflect.apply(original, this, args);
    };
    return true;
  })()`);

  const firstBatch = await runFocusStressBatch(driver, fixture, STRESS_CYCLES);
  await settle(driver);
  const firstMemory = await collectRendererMemory(cdp);
  const secondBatch = await runFocusStressBatch(driver, fixture, STRESS_CYCLES);
  await settle(driver);
  const secondMemory = await collectRendererMemory(cdp);

  assert.equal(firstBatch.rangeReads, 0, "warm focus batch re-read DOM Ranges");
  assert.equal(secondBatch.rangeReads, 0, "second warm focus batch re-read DOM Ranges");
  assert.deepEqual(secondBatch.nodes, firstBatch.nodes, "focus cycles retained connection DOM nodes");
  assert.deepEqual(secondMemory.dom, firstMemory.dom, "focus cycles retained DOM documents, nodes, or listeners");
  const heapGrowth = secondMemory.usedHeap - firstMemory.usedHeap;
  assert.ok(heapGrowth <= MAX_WARM_HEAP_GROWTH,
    `second warm focus batch retained ${heapGrowth} heap bytes`);
  const activeAnimations = await driver.evaluate(`document.getAnimations({ subtree: true }).filter((animation) => {
    const target = animation.effect?.target;
    return target instanceof Element
      && Boolean(target.closest(".connection-underlay, .connection-emphasis-underlay"))
      && animation.playState !== "finished";
  }).length`);
  assert.equal(activeAnimations, 0, "focus stress left an active connection animation");
  await driver.evaluate(`(() => {
    Range.prototype.getClientRects = window.__connectionOriginalGetClientRects;
    delete window.__connectionRangeReads;
    return true;
  })()`);

  await driver.evaluate(`(() => {
    window.__connectionReplayEvents = [];
    window.__connectionReplayHandler = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches(".connection-route, .connection-underline")
        && event.propertyName === "stroke-dashoffset") {
        window.__connectionReplayEvents.push(target.className.baseVal + ":" + event.propertyName);
      }
      if (target.matches(".connection-contact")
        && (event.propertyName === "opacity" || event.propertyName === "transform")) {
        window.__connectionReplayEvents.push(target.className.baseVal + ":" + event.propertyName);
      }
    };
    document.addEventListener("transitionrun", window.__connectionReplayHandler, true);
    return true;
  })()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await settle(driver);
  await setTheme(driver, "dark");
  await settle(driver);
  const replay = await driver.evaluate(`(() => {
    document.removeEventListener("transitionrun", window.__connectionReplayHandler, true);
    const focused = document.querySelector(".connection-mark.focused.selected.route-ready");
    const offsets = [...document.querySelectorAll(".connection-route, .connection-underline")]
      .map((path) => Number.parseFloat(getComputedStyle(path).strokeDashoffset) || 0);
    const result = {
      focusedId: focused?.dataset.connectionId ?? null,
      routeCount: document.querySelectorAll(".connection-route").length,
      staleReady: document.querySelectorAll(".connection-mark.route-ready:not(.focused)").length,
      maxDashOffset: Math.max(0, ...offsets.map(Math.abs)),
      events: [...window.__connectionReplayEvents],
    };
    delete window.__connectionReplayEvents;
    delete window.__connectionReplayHandler;
    return result;
  })()`);
  assert.equal(replay.focusedId, fixture.firstId, "resize/theme change replaced selected connection");
  assert.equal(replay.routeCount, 1, "resize/theme change duplicated selected route");
  assert.equal(replay.staleReady, 0, "resize/theme change retained a stale ready route");
  assert.equal(replay.maxDashOffset, 0, "resize/theme change replayed route draw progress");
  assert.deepEqual(replay.events, [], "resize/theme change restarted connection entrance transitions");

  await clickTick(driver, fixture.firstId);
  await driver.waitFor(`document.querySelectorAll(".connection-mark").length === 0`);
  await settle(driver);
  return { heapGrowth, dom: secondMemory.dom };
}

async function assertForcedColors(driver, cdp, fixture) {
  await setForcedColors(cdp, true);
  await clickTick(driver, fixture.firstId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(
    `.connection-mark.selected.route-ready[data-connection-id="${fixture.firstId}"]`,
  )}))`);
  await settle(driver);
  const report = await driver.evaluate(`(() => {
    const wash = document.querySelector(${JSON.stringify(
      `.connection-emphasis-mark[data-connection-id="${fixture.firstId}"] .connection-emphasis-wash`,
    )});
    const veil = document.querySelector(".connection-focus-veil");
    const tick = document.querySelector(${JSON.stringify(
      `[data-connection-tick="${fixture.firstId}"]`,
    )});
    const tickStyle = tick ? getComputedStyle(tick) : null;
    return {
      active: matchMedia("(forced-colors: active)").matches,
      washDisplay: wash ? getComputedStyle(wash).display : null,
      veilDisplay: veil ? getComputedStyle(veil).display : null,
      routeCount: document.querySelectorAll(".connection-route").length,
      underlineCount: document.querySelectorAll(".connection-underline").length,
      contactCount: document.querySelectorAll(".connection-contact").length,
      routeHitCount: document.querySelectorAll(".connection-route-hit").length,
      tickOutlineWidth: tickStyle?.outlineWidth ?? null,
      tickOutlineStyle: tickStyle?.outlineStyle ?? null,
    };
  })()`);
  assert.equal(report.active, true, "forced-colors emulation did not reach the renderer");
  assert.equal(report.washDisplay, "none", "forced colors retained translucent emphasis paint");
  assert.equal(report.veilDisplay, "none", "forced colors retained a translucent focus veil");
  assert.equal(report.routeCount, 1, "forced colors lost the selected route");
  assert.ok(report.underlineCount > 0, "forced colors lost selected underlines");
  assert.ok(report.contactCount > 0, "forced colors lost selected contacts");
  assert.equal(report.routeHitCount, 1, "forced colors lost the selected route hit target");
  assert.equal(report.tickOutlineWidth, "2px", "forced colors lost selected tick outline width");
  assert.equal(report.tickOutlineStyle, "solid", "forced colors lost selected tick outline style");
  await clickTick(driver, fixture.firstId);
  await driver.waitFor(`document.querySelectorAll(".connection-mark").length === 0`);
  await setForcedColors(cdp, false);
  await settle(driver);
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-connection-paint-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const port = 9720 + Math.floor(Math.random() * 100);
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
  childLog = (childLog + chunk.toString()).slice(-16_000);
};
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
try {
  const target = await waitForTarget(endpoint);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const fixture = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const anchor = async (verse, quote = null) => {
      const verseText = text(verse);
      const exact = quote ?? verseText;
      const start = quote == null ? 0 : verseText.indexOf(quote);
      if (start < 0) throw new Error("fixture quote is absent: " + quote);
      const capture = await window.api.library.captureConnectionSelection("bsb", [{
        book: "ACT",
        chapter: 19,
        verse,
        char_start: start,
        char_end: start + exact.length,
        quote: exact,
      }]);
      if (!capture.ok || capture.status !== "exact") {
        throw new Error("exact fixture capture refused: " + JSON.stringify(capture));
      }
      return capture.anchor;
    };
    const firstSpecs = [
      { verse: 7, quote: "about twelve" },
      { verse: 7, quote: "men in all" },
    ];
    // A second independently selectable relationship uses the same known-
    // routable short geometry. Durable ids keep its state distinct while the
    // third fixture below owns the wrapped-paint proof.
    const secondSpecs = [...firstSpecs];
    const thirdSpecs = [{ verse: 8, quote: null }, { verse: 9, quote: null }];
    const first = await window.api.library.createConnection(
      "link:parallel",
      "Merged paint proof",
      "Two exact phrases prove merged selected emphasis and dormant restraint.",
      await Promise.all(firstSpecs.map((spec) => anchor(spec.verse, spec.quote))),
      "qa-paint-first",
    );
    if (!first.ok || !first.connection) throw new Error(first.error ?? "first connection failed");
    const second = await window.api.library.createConnection(
      "link:parallel",
      "Companion paint proof",
      "A second durable relationship proves multi-held companion paint.",
      await Promise.all(secondSpecs.map((spec) => anchor(spec.verse, spec.quote))),
      "qa-paint-second",
    );
    if (!second.ok || !second.connection) throw new Error(second.error ?? "second connection failed");
    const third = await window.api.library.createConnection(
      "link:echo",
      "Wrapped presence proof",
      "Full-verse exact anchors prove wrapped merged emphasis geometry.",
      await Promise.all(thirdSpecs.map((spec) => anchor(spec.verse, spec.quote))),
      "qa-paint-third",
    );
    if (!third.ok || !third.connection) throw new Error(third.error ?? "third connection failed");
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
      sidebarCollapsed: true,
      marginVisible: true,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      firstId: first.connection.id,
      secondId: second.connection.id,
      thirdId: third.connection.id,
      firstSpecs,
      secondSpecs,
      thirdSpecs,
    };
  })()`);

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`document.querySelectorAll("[data-connection-tick]").length === 3`);
  await driver.evaluate(`(() => {
    if (!document.querySelector(".sidebar")?.classList.contains("collapsed")) {
      document.querySelector(".sidebar-collapse-btn")?.click();
    }
    if (document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") !== "true") {
      document.querySelector("[data-instrument=focus]")?.click();
    }
    document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true });
    return true;
  })()`);
  await driver.waitFor(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true"
    && !document.querySelector(".living-margin")`);

  const reportExpression = paintReportExpression(fixture);
  const reports = [];
  for (const theme of THEMES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await setTheme(driver, theme);
    for (const width of WIDTHS) {
      await setReducedMotion(cdp, false);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await settle(driver);
      let report = await driver.evaluate(reportExpression);
      if (report?.error) throw new Error(report.error);
      const label = `${THEME_LABELS.get(theme)}/${width}`;
      assertRest(report, `${label}/rest`, width, theme);

      // Focus/hover is only a quiet preview invitation. It may wake the exact
      // words and tick, but no bracket, underline, contacts, invisible hit
      // target, veil, or inspector may exist before explicit activation.
      const previewFocused = await driver.evaluate(`(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        const tick = document.querySelector(${JSON.stringify(
          `[data-connection-tick="${fixture.firstId}"]`,
        )});
        tick?.focus({ preventScroll: true });
        return document.activeElement === tick;
      })()`);
      assert.equal(previewFocused, true, `${label}/preview: tick did not receive keyboard focus`);
      await driver.waitFor(`document.querySelector(${JSON.stringify(
        `.connection-emphasis-mark[data-connection-id="${fixture.firstId}"]`,
      )})?.getAttribute("data-paint-state") === "preview"`);
      await settle(driver);
      report = await driver.evaluate(reportExpression);
      assertPreview(report, `${label}/preview`, width, theme);
      await driver.evaluate(`document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true })`);
      await driver.waitFor(`!document.querySelector('.connection-emphasis-mark[data-paint-state="preview"]')`);
      await settle(driver);
      assertRest(await driver.evaluate(reportExpression), `${label}/preview-cleared`, width, theme);

      await clickTick(driver, fixture.firstId);
      await restoreFocusMode(driver);
      await driver.waitFor(`(() => {
        const mark = document.querySelector(${JSON.stringify(
          `.connection-mark.selected.route-ready[data-connection-id="${fixture.firstId}"]`,
        )});
        return Boolean(mark && !mark.classList.contains("held") && mark.querySelector(".connection-route"));
      })()`);
      await settle(driver);
      report = await driver.evaluate(reportExpression);
      assertSelected(report, `${label}/selected`, width, theme, "first", "second");
      if (theme === "light" && width === 860) assertOrdinaryMotion(report, `${label}/selected`);

      await clickTick(driver, fixture.secondId);
      await restoreFocusMode(driver);
      await driver.waitFor(`(() => {
        const mark = document.querySelector(${JSON.stringify(
          `.connection-mark.selected.route-ready[data-connection-id="${fixture.secondId}"]`,
        )});
        return Boolean(mark && !mark.classList.contains("held") && mark.querySelector(".connection-route"));
      })() && Boolean(document.querySelector(${JSON.stringify(
        `.connection-mark.companion[data-connection-id="${fixture.firstId}"]`,
      )}))`);
      await settle(driver);
      report = await driver.evaluate(reportExpression);
      assertTwoHeld(report, `${label}/two-held`, width, theme);

      await clickTick(driver, fixture.secondId);
      await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(
        `.connection-mark.selected[data-connection-id="${fixture.firstId}"]`,
      )})) && !document.querySelector(${JSON.stringify(
        `.connection-mark[data-connection-id="${fixture.secondId}"]`,
      )})`);
      await settle(driver);
      report = await driver.evaluate(reportExpression);
      assertSelected(report, `${label}/fallback`, width, theme, "first", "second");

      await clickTick(driver, fixture.firstId);
      await driver.waitFor(`document.querySelectorAll(".connection-mark").length === 0
        && document.querySelectorAll(".connection-route").length === 0
        && document.querySelectorAll(".connection-underline").length === 0
        && document.querySelectorAll(".connection-contact").length === 0
        && document.querySelectorAll(".connection-route-hit").length === 0`);
      await driver.evaluate(`document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true })`);
      await settle(driver);
      report = await driver.evaluate(reportExpression);
      assertRest(report, `${label}/released`, width, theme);

      if (width === 860) {
        await setReducedMotion(cdp, true);
        await clickTick(driver, fixture.firstId);
        await restoreFocusMode(driver);
        await driver.waitFor(`(() => {
          const mark = document.querySelector(${JSON.stringify(
            `.connection-mark.selected.route-ready[data-connection-id="${fixture.firstId}"]`,
          )});
          return Boolean(mark && !mark.classList.contains("held") && mark.querySelector(".connection-route"));
        })()`);
        await settle(driver, true);
        const reducedReport = await driver.evaluate(reportExpression);
        assertReducedMotion(reducedReport, `${label}/reduced-motion`);
        await clickTick(driver, fixture.firstId);
        await driver.waitFor(`document.querySelectorAll(".connection-mark").length === 0`);
        await driver.evaluate(`document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true })`);
        await settle(driver, true);
        assertRest(await driver.evaluate(reportExpression), `${label}/reduced-release`, width, theme);
        await setReducedMotion(cdp, false);
      }

      reports.push({ theme, width });
      console.log(`${THEME_LABELS.get(theme).padEnd(11)} ${String(width).padStart(4)}px  rest/preview 0 routes  selected 1 route  companion 0 routes  overflow 0`);
    }
  }

  const stress = await assertFocusStress(driver, cdp, fixture);
  await assertForcedColors(driver, cdp, fixture);
  console.log(`PASS connection focus stress: ${STRESS_CYCLES * 4} switches, 0 Range reads, DOM/listeners plateau, heap delta ${stress.heapGrowth} bytes`);
  console.log("PASS connection preview: exact words only; 0 route, underline, contact, hit, veil, or card before selection");
  console.log("PASS connection forced colors: emphasis/veil suppressed, selected ink and focus retained");
  console.log(`PASS connection paint: ${reports.length}/12 combinations plus 4 reduced-motion probes at 860px`);
} catch (error) {
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) {
    await setForcedColors(cdp, false).catch(() => undefined);
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    cdp.ws.close();
  }
  child.kill("SIGTERM");
  await sleep(400);
  rmSync(qaRoot, { recursive: true, force: true });
}
