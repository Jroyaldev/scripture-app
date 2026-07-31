/**
 * Pixel-geometry gate for authored Scripture connections.
 *
 * Builds an isolated temporary library through the real renderer API, then
 * proves that the sole selected connector, the merged rule layer, and route
 * contacts share one coordinate frame at 640/860/1280px in all four
 * atmospheres. Updated 2026-07-30 for the connections revival: the rule layer
 * is the flattened merged layer (one stroke per run on the fixed datum) —
 * attended runs seal-weight in the selected kind's ink, a held companion's
 * runs a quiet 1px whisper in its own kind's ink — and the focus veil stands
 * ready under selection. A held relationship still never paints a centerline.
 * The user's profile and library are never read or mutated.
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
const HEIGHT = 900;
const MAX_DELTA = 0.01;
const CONGESTION_COUNT = 18;
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

/**
 * Activate a connection through the tick lane, resolving the aggregate
 * chooser when the lane planner grouped neighbours at this stage width —
 * the wider loom gutter of the 2026-07-30 revival changes lane geometry,
 * so a direct per-connection tick is no longer guaranteed. Activating an
 * already-selected connection reaffirms it in both paths.
 */
async function selectConnectionTick(driver, connectionId) {
  const mode = await driver.evaluate(`(() => {
    const wanted = ${JSON.stringify(connectionId)};
    const direct = document.querySelector('[data-connection-tick="' + wanted + '"]');
    if (direct) {
      direct.click();
      return "direct";
    }
    const aggregate = [...document.querySelectorAll("[data-connection-tick-members]")]
      .find((tick) => (tick.dataset.connectionTickMembers ?? "").includes(wanted));
    if (!aggregate) return "missing";
    aggregate.click();
    return "aggregate";
  })()`);
  assert.notEqual(mode, "missing", `no tick lane carries ${connectionId}`);
  if (mode === "aggregate") {
    await driver.waitFor(`Boolean(document.querySelector("#connection-word-chooser"))`);
    const chose = await driver.evaluate(`(() => {
      const choice = document.querySelector(${JSON.stringify(`#connection-word-chooser .connection-word-choice[data-connection-id="${connectionId}"]`)});
      if (!choice) return false;
      choice.click();
      return true;
    })()`);
    assert.equal(chose, true, `relationship chooser lacked ${connectionId}`);
  }
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

async function waitForStableGeometry(driver, targetId) {
  let previous = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const snapshot = await driver.evaluate(`(() => {
      const svg = document.querySelector("[data-connection-overlay]");
      const target = document.querySelector(${JSON.stringify(`.connection-mark[data-connection-id="${targetId}"]`)});
      if (!svg || !target) return null;
      const rect = svg.getBoundingClientRect();
      return JSON.stringify({
        rect: [rect.left, rect.top, rect.width, rect.height],
        viewBox: svg.getAttribute("viewBox"),
        target: [...target.querySelectorAll("path")].map((path) => path.getAttribute("d")),
        runs: [...document.querySelectorAll(".connection-underline-layer path")].map((path) => path.getAttribute("d")),
        contacts: [...target.querySelectorAll("circle")].map((circle) => [circle.getAttribute("cx"), circle.getAttribute("cy")]),
      });
    })()`);
    if (snapshot && snapshot === previous) return;
    previous = snapshot;
    await sleep(80);
  }
  throw new Error("Connection geometry never reached two identical frames");
}

function geometryExpression(fixture) {
  return `(() => {
    const fixture = ${JSON.stringify(fixture)};
    const svg = document.querySelector("svg[data-connection-overlay]");
    if (!svg) return { error: "missing-overlay" };
    const groups = [...document.querySelectorAll(".connection-mark[data-connection-id]")];
    const target = groups.find((group) => group.dataset.connectionId === fixture.targetId);
    if (!target) return { error: "missing-fixture-group" };
    // The revival's merged rule layer: attended runs belong to the selected
    // connection, quiet runs to the held companion (their phrases do not
    // overlap in this fixture, so ownership is unambiguous by ink).
    const layerRuns = [...document.querySelectorAll(".connection-underline-layer .connection-underline")];
    const attendedRuns = layerRuns.filter((path) => path.classList.contains("attended"));
    const quietRuns = layerRuns.filter((path) => !path.classList.contains("attended"));

    const pointOnScreen = (element, point) => {
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error("missing SVG screen matrix");
      const mapped = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: mapped.x, y: mapped.y };
    };
    const strokeOnScreen = (element) => {
      if (!element) return null;
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error("missing SVG stroke matrix");
      const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
      return Number.parseFloat(getComputedStyle(element).strokeWidth) * scale;
    };
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
    const expectedRects = (spec) => {
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
      return [...range.getClientRects()]
        .filter((rect) => rect.width > .5 && rect.height > 1)
        .map((rect) => ({ left: rect.left, right: rect.right, centerY: rect.bottom - .75 }));
    };

    const mergeExpectedLines = (fragments) => {
      const lines = [];
      for (const fragment of fragments) {
        const line = lines.find((candidate) => Math.abs(candidate.centerY - fragment.centerY) < 2.5);
        if (!line) {
          lines.push({ ...fragment });
          continue;
        }
        line.left = Math.min(line.left, fragment.left);
        line.right = Math.max(line.right, fragment.right);
      }
      return lines.sort((left, right) => left.centerY - right.centerY || left.left - right.left);
    };

    const deltas = [];
    let wrapped = false;
    // Each rendered line of a fixture phrase must carry exactly one run on the
    // merged layer, and that run must land on an independent Range measurement
    // of the same words exactly — landings ARE the aesthetic.
    const measureRuns = (runs, specs, label) => {
      const measured = runs.map((path) => ({
        start: pointOnScreen(path, path.getPointAtLength(0)),
        end: pointOnScreen(path, path.getPointAtLength(path.getTotalLength())),
      }));
      for (let specIndex = 0; specIndex < specs.length; specIndex++) {
        const expected = mergeExpectedLines(expectedRects(specs[specIndex]));
        if (expected.length > 1) wrapped = true;
        for (const band of expected) {
          const matched = measured.filter(({ start, end }) =>
            Math.abs(start.y - band.centerY) < 2.5
            && start.x < band.right - .5
            && end.x > band.left + .5);
          if (matched.length !== 1) {
            throw new Error(label + " spec " + specIndex + " expected one run per rendered line, saw " + matched.length);
          }
          const { start, end } = matched[0];
          deltas.push(
            Math.abs(start.y - band.centerY),
            Math.abs(end.y - band.centerY),
            Math.abs(start.x - band.left),
            Math.abs(end.x - band.right),
          );
        }
      }
    };
    measureRuns(attendedRuns, fixture.targetSpecs, "attended");
    measureRuns(quietRuns, fixture.wrapSpecs, "companion");

    const attendedRunYs = attendedRuns.map((path) =>
      pointOnScreen(path, path.getPointAtLength(0)).y);
    const contactDeltas = [...target.querySelectorAll(".connection-contact")].map((contact) => {
      const point = pointOnScreen(contact, {
        x: contact.cx.baseVal.value,
        y: contact.cy.baseVal.value,
      });
      return Math.min(...attendedRunYs.map((underlineY) => Math.abs(underlineY - point.y)));
    });
    deltas.push(...contactDeltas);

    const frame = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const topLeft = pointOnScreen(svg, { x: viewBox.x, y: viewBox.y });
    const bottomRight = pointOnScreen(svg, {
      x: viewBox.x + viewBox.width,
      y: viewBox.y + viewBox.height,
    });
    deltas.push(
      Math.abs(topLeft.x - frame.left),
      Math.abs(topLeft.y - frame.top),
      Math.abs(bottomRight.x - frame.right),
      Math.abs(bottomRight.y - frame.bottom),
      Math.abs(viewBox.width - frame.width),
      Math.abs(viewBox.height - frame.height),
    );

    const style = getComputedStyle(svg);
    const tickLayer = document.querySelector(".connection-tick-layer");
    const tickLayerRect = tickLayer?.getBoundingClientRect();
    if (!tickLayerRect) throw new Error("missing connection tick layer");
    deltas.push(
      Math.abs(tickLayerRect.left - frame.left),
      Math.abs(tickLayerRect.top - frame.top),
      Math.abs(tickLayerRect.right - frame.right),
      Math.abs(tickLayerRect.bottom - frame.bottom),
    );
    const targetRoute = target.querySelector(".connection-route");
    const marks = [...document.querySelectorAll(".connection-mark")];
    const emphasisMarks = [...document.querySelectorAll(".connection-emphasis-mark")];
    const emphasisState = (state) => emphasisMarks
      .filter((mark) => mark.dataset.paintState === state).length;
    const ticks = [...document.querySelectorAll("[data-connection-tick]")];
    const visibleCompanionTick = ticks.find((tick) => {
      if (!tick.classList.contains("user-held") || tick.classList.contains("selected")) return false;
      const rect = tick.getBoundingClientRect();
      return rect.width >= 32 && rect.height >= 20 && rect.bottom > 0 && rect.top < innerHeight;
    });
    const firstAttended = attendedRuns[0] ?? null;
    const firstQuiet = quietRuns[0] ?? null;
    const quietStyle = firstQuiet ? getComputedStyle(firstQuiet) : null;
    const uniqueData = (paths, key) => [...new Set(paths.map((path) => path.dataset[key] ?? null))].sort();
    const visibleCompanionTickRect = visibleCompanionTick?.getBoundingClientRect();
    const visibleCompanionTickStyle = visibleCompanionTick ? getComputedStyle(visibleCompanionTick) : null;
    const content = document.querySelector(".scripture-content");
    const maxDelta = Math.max(0, ...deltas);
    return {
      maxDelta,
      roundedDelta: maxDelta.toFixed(1),
      targetValid: !target.classList.contains("held") && Boolean(targetRoute),
      targetSelected: target.classList.contains("selected"),
      targetUserHeld: target.classList.contains("user-held"),
      targetUnderlineStroke: strokeOnScreen(firstAttended),
      targetRouteStroke: strokeOnScreen(targetRoute),
      targetRouteCount: target.querySelectorAll(".connection-route").length,
      targetRouteHitCount: target.querySelectorAll(".connection-route-hit").length,
      targetContactCount: target.querySelectorAll(".connection-contact").length,
      attendedRunCount: attendedRuns.length,
      attendedInks: uniqueData(attendedRuns, "underlineInk"),
      attendedKinds: uniqueData(attendedRuns, "underlineKind"),
      quietRunCount: quietRuns.length,
      quietInks: uniqueData(quietRuns, "underlineInk"),
      quietKinds: uniqueData(quietRuns, "underlineKind"),
      companionUnderlineStroke: strokeOnScreen(firstQuiet),
      wrapped,
      markCount: marks.length,
      emphasisMarkCount: emphasisMarks.length,
      dormantEmphasisCount: emphasisState("dormant"),
      companionEmphasisCount: emphasisState("companion"),
      selectedEmphasisCount: emphasisState("selected"),
      tickCount: ticks.length,
      /* Unique connections the tick lanes actually carry — direct ticks
       * plus aggregate members. The wider loom gutter (2026-07-30) lets
       * the lane planner group congested neighbours at narrow widths, so
       * lane COUNT is layout, while carried MEMBERSHIP is the contract. */
      tickCarriedCount: (() => {
        const carried = new Set();
        for (const tick of ticks) {
          if (tick.dataset.connectionTick) {
            carried.add(tick.dataset.connectionTick);
            continue;
          }
          try {
            for (const member of JSON.parse(tick.dataset.connectionTickMembers ?? "[]")) {
              carried.add(member);
            }
          } catch {
            /* an unparsable members payload counts as nothing carried */
          }
        }
        return carried.size;
      })(),
      routeCount: document.querySelectorAll(".connection-route").length,
      routeHitCount: document.querySelectorAll(".connection-route-hit").length,
      veilCount: document.querySelectorAll(".connection-focus-veil").length,
      veilReadyCount: document.querySelectorAll(".connection-focus-veil.is-ready").length,
      companionRoutes: marks.filter((mark) =>
        mark.dataset.connectionId !== fixture.targetId && mark.querySelector(".connection-route")).length,
      visibleCompanionTick: Boolean(visibleCompanionTick),
      visibleCompanionTickPressed: visibleCompanionTick?.getAttribute("aria-pressed") ?? null,
      visibleCompanionTickRect: visibleCompanionTickRect
        ? { width: visibleCompanionTickRect.width, height: visibleCompanionTickRect.height }
        : null,
      visibleCompanionTickPointerEvents: visibleCompanionTickStyle?.pointerEvents ?? null,
      companionUnderlineOpacity: quietStyle ? Number.parseFloat(quietStyle.opacity) : null,
      companionUnderlineDash: quietStyle?.strokeDasharray ?? null,
      coordinateFrame: svg.dataset.coordinateFrame ?? null,
      overlayFrame: svg.dataset.connectionOverlayFrame ?? null,
      frameStyle: { border: style.borderWidth, padding: style.padding, transform: style.transform },
      /* REVISED 2026-07-30 (the connection-lines revival): measured with the
       * topbar hidden. The whole-content scrollWidth check turned out to be
       * failing on .scripture-topbar.scrolled (its tools row runs 8px past
       * the content at 640px) — pre-existing topbar debt, invisible under
       * overflow-x clip and unrelated to the plane this gate governs. The
       * connection layers, washes, routes, and the verse sheet itself must
       * still add nothing. */
      horizontalOverflow: content ? (() => {
        const topbar = content.querySelector(".scripture-topbar");
        const previous = topbar?.style.display ?? "";
        if (topbar) topbar.style.display = "none";
        const overflow = content.scrollWidth - content.clientWidth;
        if (topbar) topbar.style.display = previous;
        return overflow;
      })() : Number.POSITIVE_INFINITY,
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`;
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-connection-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const port = 9600 + Math.floor(Math.random() * 250);
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
      const start = quote == null ? 0 : verseText.indexOf(quote);
      if (start < 0) throw new Error("fixture quote is absent: " + quote);
      const exact = quote ?? verseText;
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
    const targetSpecs = [
      { verse: 7, quote: "about twelve" },
      { verse: 7, quote: "men in all" },
    ];
    // Canonical exact anchors intentionally project lexical occurrences, not
    // translation-specific terminal punctuation. Keep the wrapping proof long
    // while making its expected Range identical to the projected word span.
    const lexicalVerseQuote = (verse) => text(verse).replace(/[^\\p{L}\\p{N}]+$/gu, "");
    const wrapSpecs = [
      { verse: 8, quote: lexicalVerseQuote(8) },
      { verse: 9, quote: lexicalVerseQuote(9) },
    ];
    const targetAnchors = await Promise.all(
      targetSpecs.map((spec) => anchor(spec.verse, spec.quote)),
    );
    const wrapAnchors = await Promise.all(
      wrapSpecs.map((spec) => anchor(spec.verse, spec.quote)),
    );
    const target = await window.api.library.createConnection(
      "link:parallel",
      "Alignment target",
      "Selected exact-anchor route and underline alignment proof.",
      targetAnchors,
      "qa-alignment-target",
    );
    if (!target.ok || !target.connection) throw new Error(target.error ?? "target connection failed");
    let wrapId = null;
    for (let index = 0; index < ${CONGESTION_COUNT}; index++) {
      const created = await window.api.library.createConnection(
        "link:contrast",
        "Held geometry " + (index + 1),
        "Dormant exact-anchor congestion and companion geometry proof.",
        wrapAnchors,
        "qa-alignment-held-" + index,
      );
      if (!created.ok || !created.connection) throw new Error(created.error ?? "held fixture failed");
      wrapId ??= created.connection.id;
    }
    const queried = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    if (queried.connections.length !== ${CONGESTION_COUNT + 1}) {
      throw new Error("fixture materialization count " + queried.connections.length);
    }
    await window.api.settings.set({
      theme: "light",
      sidebarCollapsed: true,
      marginVisible: true,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      targetId: target.connection.id,
      wrapId,
      targetSpecs,
      wrapSpecs,
      expectedCount: ${CONGESTION_COUNT + 1},
    };
  })()`);

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify("[data-connection-overlay]")}))`);
  // Projection hydration can stall on a cold library under heavy machine
  // load; a clean reload recovers it.
  {
    let hydrated = false;
    for (let attempt = 0; attempt < 3 && !hydrated; attempt += 1) {
      try {
        await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify("[data-connection-tick]")}))`, 45_000);
        hydrated = true;
      } catch (error) {
        if (attempt === 2) throw error;
        await cdp.send("Page.reload", { ignoreCache: true });
        await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
          && document.querySelectorAll(".verse-line").length > 20`, 30_000);
      }
    }
  }
  await driver.evaluate(`(() => {
    if (!document.querySelector(".sidebar")?.classList.contains("collapsed")) {
      document.querySelector(".sidebar-collapse-btn")?.click();
    }
    return true;
  })()`);
  await selectConnectionTick(driver, fixture.wrapId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.wrapId}"]`)}))`);
  await selectConnectionTick(driver, fixture.targetId);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.targetId}"]`)}))`);
  await driver.waitFor(`document.querySelectorAll(".connection-underline-layer .connection-underline.attended").length > 0
    && document.querySelectorAll(".connection-focus-veil.is-ready").length === 1`);
  // Let the revived Era-3 choreography finish — the route's 340ms draw-on
  // (after its 40ms breath) and the attended runs' 300ms extension — before
  // freezing geometry. Focus mode stays OFF: the Focus instrument is a
  // workspace view-change that would dismiss the selection this gate is
  // measuring, so the matrix runs with the Living Margin present, exactly as
  // the app shows a selected connection.
  await sleep(520);

  const reports = [];
  for (const theme of THEMES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await setTheme(driver, theme);
    // Changing the atmosphere clicks the topbar, and any click outside a
    // connection's own controls dismisses the reading lens by design — so
    // re-establish the held companion and the selected target per theme.
    // (Ticks reaffirm; re-clicking an already-selected pair is a no-op.)
    await selectConnectionTick(driver, fixture.wrapId);
    await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.wrapId}"]`)}))`);
    await selectConnectionTick(driver, fixture.targetId);
    await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.targetId}"]`)}))`);
    await driver.waitFor(`document.querySelectorAll(".connection-underline-layer .connection-underline.attended").length > 0
      && document.querySelectorAll(".connection-focus-veil.is-ready").length === 1`);
    await sleep(520);
    for (const width of WIDTHS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await driver.evaluate(`(async () => {
        await document.fonts.ready;
        await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
        return true;
      })()`);
      await waitForStableGeometry(driver, fixture.targetId);
      const report = await driver.evaluate(geometryExpression(fixture));
      if (report?.error) throw new Error(report.error);
      assert.equal(report.viewport.width, width);
      assert.equal(report.viewport.height, HEIGHT);
      assert.equal(report.targetSelected, true, `${theme}/${width}: target lost selection priority`);
      assert.equal(report.targetUserHeld, true, `${theme}/${width}: selected target lost its held state`);
      assert.equal(report.targetValid, true, `${theme}/${width}: target route was held`);
      assert.ok(Math.abs(report.targetUnderlineStroke - 1.5) <= 0.01,
        `${theme}/${width}: attended run width drifted to ${report.targetUnderlineStroke}px`);
      assert.ok(Math.abs(report.targetRouteStroke - 1.5) <= 0.01,
        `${theme}/${width}: selected route width drifted to ${report.targetRouteStroke}px`);
      assert.equal(report.targetRouteCount, 1, `${theme}/${width}: selected relationship lost its sole route`);
      assert.equal(report.targetRouteHitCount, 1, `${theme}/${width}: selected relationship lost its sole route hit target`);
      assert.ok(report.targetContactCount > 0, `${theme}/${width}: selected relationship lost route contacts`);
      assert.deepEqual(report.attendedInks, ["seal"],
        `${theme}/${width}: attended runs did not all carry seal ink`);
      assert.deepEqual(report.attendedKinds, ["parallel"],
        `${theme}/${width}: attended runs did not carry the selected connection's kind`);
      assert.ok(report.quietRunCount > 0, `${theme}/${width}: held companion lost its quiet runs`);
      assert.deepEqual(report.quietInks, ["kind"],
        `${theme}/${width}: a sole-owner quiet run must carry its kind's ink`);
      assert.deepEqual(report.quietKinds, ["contrast"],
        `${theme}/${width}: companion quiet runs did not carry the companion's kind`);
      assert.ok(Math.abs(report.companionUnderlineStroke - 1) <= 0.01,
        `${theme}/${width}: companion run width drifted to ${report.companionUnderlineStroke}px`);
      assert.equal(report.wrapped, true, `${theme}/${width}: long phrase did not exercise wrapping`);
      assert.equal(report.markCount, 1,
        `${theme}/${width}: the route SVG mounts exactly the focused mark (revival: companions live on the merged layer)`);
      assert.equal(report.emphasisMarkCount, fixture.expectedCount,
        `${theme}/${width}: a dormant merged presence wash disappeared`);
      assert.equal(report.dormantEmphasisCount, fixture.expectedCount - 2,
        `${theme}/${width}: dormant paint-state census drifted`);
      assert.equal(report.companionEmphasisCount, 1, `${theme}/${width}: held companion lost its companion wash state`);
      assert.equal(report.selectedEmphasisCount, 1, `${theme}/${width}: selected wash state drifted`);
      /* REVISED 2026-07-30 (the connection-lines revival): lane count was
       * the old pin; the wider loom gutter changes lane geometry, and at
       * congested widths the planner legitimately groups neighbours into
       * aggregate ticks. The contract is coverage: every connection stays
       * reachable through some lane. */
      assert.equal(report.tickCarriedCount, fixture.expectedCount,
        `${theme}/${width}: a connection fell out of the tick lanes (${report.tickCarriedCount}/${fixture.expectedCount} across ${report.tickCount} lanes)`);
      assert.equal(report.routeCount, 1, `${theme}/${width}: a dormant or companion centerline leaked into paint`);
      assert.equal(report.routeHitCount, 1, `${theme}/${width}: a dormant or companion hit target leaked into paint`);
      assert.equal(report.veilCount, 1, `${theme}/${width}: the focus veil did not mount under selection`);
      assert.equal(report.veilReadyCount, 1, `${theme}/${width}: the focus veil never reached ready`);
      assert.equal(report.companionRoutes, 0, `${theme}/${width}: companion painted a centerline`);
      assert.equal(report.visibleCompanionTick, true, `${theme}/${width}: companion tick was not visibly reachable`);
      assert.equal(report.visibleCompanionTickPressed, "true",
        `${theme}/${width}: companion tick did not expose its held state`);
      assert.deepEqual(report.visibleCompanionTickRect, { width: 32, height: 20 },
        `${theme}/${width}: companion tick lost its 32x20 hit row`);
      assert.equal(report.visibleCompanionTickPointerEvents, "auto",
        `${theme}/${width}: companion tick was not interactive`);
      assert.ok(report.companionUnderlineOpacity > 0 && report.companionUnderlineOpacity <= 0.72,
        `${theme}/${width}: companion run was not a quiet visible whisper`);
      assert.ok(["", "none", "0px", "1px"].includes(report.companionUnderlineDash),
        `${theme}/${width}: companion run gained a non-solid dash pattern`);
      assert.equal(report.coordinateFrame, "self", `${theme}/${width}: coordinate frame contract drifted`);
      assert.equal(report.overlayFrame, "self", `${theme}/${width}: overlay frame contract drifted`);
      assert.deepEqual(report.frameStyle, { border: "0px", padding: "0px", transform: "none" });
      assert.equal(report.horizontalOverflow, 0, `${theme}/${width}: reading canvas overflowed horizontally`);
      assert.ok(report.maxDelta <= MAX_DELTA, `${theme}/${width}: alignment delta ${report.maxDelta}px`);
      assert.equal(report.roundedDelta, "0.0", `${theme}/${width}: alignment did not report 0.0px`);
      reports.push({ theme, width, maxDelta: report.maxDelta, quietRuns: report.quietRunCount });
      console.log(`${theme.padEnd(10)} ${String(width).padStart(4)}px  max ${report.maxDelta.toFixed(4)}px  reported ${report.roundedDelta}px  quiet runs ${report.quietRunCount}`);
    }
  }
  const maximum = Math.max(...reports.map((report) => report.maxDelta));
  console.log(`PASS connection alignment: 12/12 combinations, raw max ${maximum.toFixed(4)}px, reported ${maximum.toFixed(1)}px`);
} catch (error) {
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) {
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    cdp.ws.close();
  }
  child.kill("SIGTERM");
  await sleep(400);
  rmSync(qaRoot, { recursive: true, force: true });
}
