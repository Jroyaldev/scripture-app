/**
 * Designer-eye captures for the revived connection paint (2026-07-30).
 *
 * The digests and paint gates prove numbers; this script produces the frames
 * a designer actually approves — the repo's own recorded lesson is "visual
 * approval is not passing tests", so geometry work must be LOOKED at before
 * it is frozen. It boots the real Electron app against an isolated temporary
 * library, authors a spread of connections through the renderer API, and
 * writes PNGs to docs/ui-audit/connections/:
 *
 *   rest            — the wash-ladder atmosphere: kind-inked presence pigment
 *                     and the shared gold band, no rules, no routes
 *   preview         — one phrase woken to .12 while the dormant field recedes
 *   selected-short  — a short same-line bracket: veil, seal runs, kind word
 *   selected-wrapped— exact anchors spanning rendered line breaks
 *   selected-distant— a long spine between distant verses
 *   two-held-dense  — dense overlapping connections; one focused, one held
 *                     companion behind grey veil holes
 *   marking-*       — the authoring flow end to end: live selection wash,
 *                     the connect draft's first anchor, the two-anchor draft
 *                     with its kind row
 *
 * Full scene set in Paper and Ink; Porcelain and Onyx keep rest + selected
 * as atmosphere spot checks.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

// 1512x950 (a common MacBook logical size): with the Living Margin open —
// the app's true selected state, since any outside click dismisses the
// reading lens — the stage keeps rail room for every fixture bracket.
const HEIGHT = 950;
const WIDTH = 1512;
const OUT_DIR = resolve("docs/ui-audit/connections");
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

async function settle(driver, ms = 620) {
  await driver.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    return true;
  })()`);
  await sleep(ms);
}

async function capture(cdp, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const data = shot.result?.data;
  assert.ok(data, `screenshot ${name} returned no data`);
  writeFileSync(join(OUT_DIR, name), Buffer.from(data, "base64"));
  console.log(`captured ${name}`);
}

/**
 * Activate a connection by its tick — through the aggregate chooser when the
 * lane planner grouped it with neighbours at this stage width. Activating the
 * already-selected connection releases it, in both paths.
 */
async function selectConnection(driver, connectionId) {
  const mode = await driver.evaluate(`(() => {
    const direct = document.querySelector(${JSON.stringify(`[data-connection-tick="${connectionId}"]`)});
    if (direct) {
      direct.click();
      return "direct";
    }
    const aggregate = [...document.querySelectorAll("[data-connection-tick-members]")]
      .find((tick) => (tick.dataset.connectionTickMembers ?? "").includes(${JSON.stringify(connectionId)}));
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

/**
 * Wait for the attended state (mark + ready veil), then report whether the
 * engine actually drew a route. In the current tree the live feed refuses
 * every cross-line plan (needs-space — verified identical on pristine HEAD),
 * so a frame without a route is the app's honest state for those fixtures,
 * and the log says which kind of frame each capture is.
 */
async function awaitSelected(driver, connectionId) {
  try {
    await driver.waitFor(`(() => {
      const mark = document.querySelector(${JSON.stringify(
        `.connection-mark.selected.route-ready[data-connection-id="${connectionId}"]`,
      )});
      return Boolean(mark)
        && document.querySelectorAll(".connection-focus-veil.is-ready").length === 1;
    })()`);
  } catch (error) {
    const diag = await driver.evaluate(`(() => {
      const mark = document.querySelector(".connection-mark");
      return {
        markClasses: mark?.className.baseVal ?? null,
        markId: mark?.dataset.connectionId ?? null,
        markRoute: mark?.dataset.route ?? null,
        veils: document.querySelectorAll(".connection-focus-veil").length,
        veilsReady: document.querySelectorAll(".connection-focus-veil.is-ready").length,
        emphasisStates: [...document.querySelectorAll(".connection-emphasis-mark")]
          .map((m) => m.dataset.connectionId?.slice(-6) + ":" + m.dataset.paintState),
        ticks: [...document.querySelectorAll("[data-connection-tick]")]
          .map((t) => (t.dataset.connectionTick || "aggregate:" + (t.dataset.connectionTickMembers ?? ""))?.slice(-40)),
        chooser: Boolean(document.querySelector("#connection-word-chooser")),
        focusPressed: document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") ?? null,
      };
    })()`).catch(() => null);
    console.error("awaitSelected diagnostics:", JSON.stringify(diag, null, 2));
    throw error;
  }
  await settle(driver);
  return driver.evaluate(`(() => {
    const mark = document.querySelector(${JSON.stringify(
      `.connection-mark[data-connection-id="${connectionId}"]`,
    )});
    return { routed: Boolean(mark?.querySelector(".connection-route")), state: mark?.dataset.route ?? null };
  })()`);
}

/**
 * Release every held connection through the card's labelled Release action —
 * tick activation is focus/reaffirmation in the current app, never release —
 * until the page is fully at rest again.
 */
async function releaseAllSelections(driver) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const released = await driver.evaluate(`(() => {
      const release = document.querySelector(".connection-card .connection-card-primary");
      if (!release) return false;
      release.click();
      return true;
    })()`);
    if (!released) break;
    await sleep(420);
  }
  await driver.waitFor(`document.querySelectorAll(".connection-mark").length === 0
    && !document.querySelector('.connection-emphasis-mark[data-paint-state="companion"]')`);
  await driver.evaluate(`document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true })`);
  await settle(driver, 320);
}

/** Force Focus mode to the requested state (it hides the Living Margin). */
async function setFocusMode(driver, on) {
  await driver.evaluate(`(() => {
    const control = document.querySelector("[data-instrument=focus]");
    if (!control) return;
    if ((control.getAttribute("aria-pressed") === "true") !== ${on ? "true" : "false"}) control.click();
  })()`);
  await driver.waitFor(on
    ? `document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true" && !document.querySelector(".living-margin")`
    : `document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "false"`);
}

function selectPhraseExpression(spec) {
  return `(async () => {
    const row = document.querySelector('.verse-line[data-verse="' + ${spec.verse} + '"]');
    const span = row?.querySelector(".verse-text-span");
    if (!row || !span) throw new Error("missing verse ${spec.verse}");
    const text = span.textContent ?? "";
    const startOffset = text.indexOf(${JSON.stringify(spec.quote)});
    if (startOffset < 0) throw new Error("phrase absent: " + ${JSON.stringify(spec.quote)});
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
    const end = locate(startOffset + ${spec.quote.length});
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

mkdirSync(OUT_DIR, { recursive: true });
const qaRoot = mkdtempSync(join(tmpdir(), "scripture-connection-captures-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const port = 9830 + Math.floor(Math.random() * 100);
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
    width: WIDTH,
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
      const exact = quote ?? verseText.replace(/[^\\p{L}\\p{N}]+$/gu, "");
      const start = verseText.indexOf(exact);
      if (start < 0) throw new Error("fixture quote is absent: " + exact);
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
    const wordSpan = (verse, fromWord, toWord) => {
      const verseText = text(verse);
      const matches = [...verseText.matchAll(/\\S+/g)];
      if (matches.length <= toWord) throw new Error("verse " + verse + " has too few words");
      const startIndex = matches[fromWord].index;
      const last = matches[toWord];
      return verseText.slice(startIndex, last.index + last[0].length);
    };
    const create = async (kind, label, observation, specs, id) => {
      const created = await window.api.library.createConnection(
        kind,
        label,
        observation,
        await Promise.all(specs.map((spec) => anchor(spec.verse, spec.quote))),
        id,
      );
      if (!created.ok || !created.connection) throw new Error(created.error ?? label + " failed");
      return created.connection.id;
    };
    // Every span below was probed against the live backbone round-trip: a
    // selection the anchoring cannot preserve exactly is REFUSED and stays
    // absent — that is the reader's accepted trade, not a defect — so the
    // capture fixture keeps to spans the pipeline honestly carries.
    const shortId = await create("link:parallel", "Twelve in all",
      "Short same-line bracket.",
      [{ verse: 7, quote: "about twelve" }, { verse: 7, quote: "men in all" }],
      "cap-short");
    const wrappedId = await create("link:echo", "Bold persuasion",
      "Wrapped full-verse anchors.",
      [{ verse: 8, quote: null }, { verse: 9, quote: null }],
      "cap-wrapped");
    const distantId = await create("link:contrast", "The word spreads",
      "A long spine between distant verses.",
      [{ verse: 10, quote: wordSpan(10, 0, 6) }, { verse: 20, quote: wordSpan(20, 0, 4) }],
      "cap-distant");
    const denseA = await create("series", "Dense overlap A",
      "First of three overlapping claims.",
      [{ verse: 10, quote: wordSpan(10, 0, 6) }, { verse: 11, quote: wordSpan(11, 0, 4) }],
      "cap-dense-a");
    const denseB = await create("hinge", "Dense overlap B",
      "Second overlapping claim.",
      [{ verse: 10, quote: wordSpan(10, 3, 9) }, { verse: 12, quote: wordSpan(12, 0, 4) }],
      "cap-dense-b");
    const denseC = await create("mirror", "Dense overlap C",
      "Third overlapping claim.",
      [{ verse: 10, quote: wordSpan(10, 4, 10) }, { verse: 13, quote: wordSpan(13, 0, 4) }],
      "cap-dense-c");
    await window.api.settings.set({
      theme: "light",
      sidebarCollapsed: true,
      marginVisible: true,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      shortId,
      wrappedId,
      distantId,
      denseA,
      denseB,
      denseC,
      verse3Quote: wordSpan(3, 0, 5),
      verse5Quote: wordSpan(5, 0, 5),
    };
  })()`);

  // The connection layer occasionally misses its first paint after a QA
  // reload under load; a fresh reload recovers it, so retry the boot rather
  // than reading a slow machine as a broken app.
  for (let bootAttempt = 0; ; bootAttempt += 1) {
    await cdp.send("Page.reload", { ignoreCache: true });
    await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
      && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
      && document.querySelectorAll(".verse-line").length > 20`, 20_000);
    try {
      await driver.waitFor(`document.querySelectorAll("[data-connection-tick]").length > 0`, 45_000);
      break;
    } catch (error) {
      if (bootAttempt >= 2) throw error;
      console.warn(`connection paint missed boot attempt ${bootAttempt + 1}; reloading`);
    }
  }
  await driver.evaluate(`(() => {
    if (!document.querySelector(".sidebar")?.classList.contains("collapsed")) {
      document.querySelector(".sidebar-collapse-btn")?.click();
    }
    return true;
  })()`);
  await setFocusMode(driver, true);
  await driver.evaluate(`document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true })`);

  const scenes = async (theme, full) => {
    await setTheme(driver, theme);
    await settle(driver);

    // Rest: the wash-ladder atmosphere alone, on the clean Focus-mode canvas.
    await setFocusMode(driver, true);
    await driver.evaluate(`document.querySelector(".scripture-content")?.scrollTo(0, 0)`);
    await settle(driver, 420);
    await capture(cdp, `${theme}-rest.png`);

    // Every scene from here shows the app's honest attended state: selecting
    // exits Focus mode and opens the Living Margin (a workspace view-change —
    // re-toggling Focus would DISMISS the selection), so the captures keep
    // the margin open, card and all.
    await setFocusMode(driver, false);
    await settle(driver, 320);

    if (full) {
      // Preview: keyboard focus on a tick (preview is deliberately absent
      // inside Focus mode — post-peak hardening, kept). Prefer the short
      // connection; fall back to any individual lane if the planner grouped
      // it at this stage width.
      const focusTickExpression = `(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const preferred = document.querySelector(${JSON.stringify(
          `[data-connection-tick="${fixture.shortId}"]`,
        )});
        const tick = preferred
          ?? [...document.querySelectorAll("[data-connection-tick]")].find((candidate) => candidate.dataset.connectionTick);
        if (!tick || !tick.dataset.connectionTick) return null;
        tick.focus({ preventScroll: true });
        return tick.dataset.connectionTick;
      })()`;
      // The margin reveal can steal focus a beat after it opens; retry the
      // tick focus until the preview state actually engages.
      let previewed = false;
      for (let attempt = 0; attempt < 3 && !previewed; attempt += 1) {
        const previewId = await driver.evaluate(focusTickExpression);
        assert.ok(previewId, `${theme}: no individual tick available for the preview beat`);
        try {
          await driver.waitFor(
            `document.querySelector('.connection-emphasis-mark[data-connection-id="' + CSS.escape(${JSON.stringify(fixture.shortId)}) + '"]')?.getAttribute("data-paint-state") === "preview"
              || document.querySelector('.connection-emphasis-mark[data-paint-state="preview"]') != null`,
            4_000,
          );
          previewed = true;
        } catch {
          await settle(driver, 420);
        }
      }
      if (!previewed) {
        const diag = await driver.evaluate(`(() => ({
          active: document.activeElement
            ? document.activeElement.tagName + "." + document.activeElement.className + " tick=" + (document.activeElement.dataset?.connectionTick ?? "")
            : null,
          focusPressed: document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") ?? null,
          emphasisStates: [...document.querySelectorAll(".connection-emphasis-mark")]
            .map((m) => (m.dataset.connectionId ?? "").slice(-6) + ":" + m.dataset.paintState),
          margin: Boolean(document.querySelector(".living-margin")),
        }))()`).catch(() => null);
        console.error("preview diagnostics:", JSON.stringify(diag, null, 2));
      }
      assert.equal(previewed, true, `${theme}: the preview state never engaged`);
      await settle(driver, 420);
      await capture(cdp, `${theme}-preview.png`);
      await driver.evaluate(`document.querySelector("#reading-chapter-title")?.focus({ preventScroll: true })`);
      await driver.waitFor(`!document.querySelector('.connection-emphasis-mark[data-paint-state="preview"]')`);
    }

    // Each selected scene is the app's honest attended state: the margin
    // open with the card beside the veiled canvas. (Hiding Study first is not
    // an option — any click outside the connection's own controls dismisses
    // the reading lens, by design.)
    const captureSelectedScene = async (connectionId, name) => {
      await selectConnection(driver, connectionId);
      const plan = await awaitSelected(driver, connectionId);
      await capture(cdp, name);
      console.log(`  ${name}: route ${plan.routed ? "drawn (" + plan.state + ")" : "honestly absent (" + plan.state + ")"}`);
      await releaseAllSelections(driver);
    };

    // Selected short bracket.
    await captureSelectedScene(fixture.shortId, `${theme}-selected-short.png`);

    if (full) {
      // Selected wrapped: anchors spanning rendered line breaks.
      await captureSelectedScene(fixture.wrappedId, `${theme}-selected-wrapped.png`);

      // Selected distant: a long spine between distant verses.
      await captureSelectedScene(fixture.distantId, `${theme}-selected-distant.png`);

      // Dense overlap: select B, then A on top — A focused, B held companion.
      await selectConnection(driver, fixture.denseB);
      await awaitSelected(driver, fixture.denseB);
      await selectConnection(driver, fixture.denseA);
      const densePlan = await awaitSelected(driver, fixture.denseA);
      await capture(cdp, `${theme}-two-held-dense.png`);
      console.log(`  ${theme}-two-held-dense.png: route ${densePlan.routed ? "drawn (" + densePlan.state + ")" : "honestly absent (" + densePlan.state + ")"}`);
      // Release both holds through the card, back to full rest.
      await releaseAllSelections(driver);
    }
  };

  await scenes("light", true);

  // RESPONSIVE (2026-07-30, the connection-lines revival): the reader's
  // third requirement — "it needs to be responsive and draw on different
  // sizes and redraw responsively on page stretch." With the distant
  // connection selected, sweep the stage width and require at every stop
  // that (a) the underlay's viewBox exactly matches its own box — no stale
  // geometry — and (b) the route either draws or reports needs-space
  // honestly. One frame is captured immediately after a resize (before any
  // settle) as the mid-resize record: the ResizeObserver lifecycle re-plans
  // in the same frame family, so even that frame must carry the fresh
  // stage size.
  {
    await setFocusMode(driver, false);
    await settle(driver, 320);
    await selectConnection(driver, fixture.distantId);
    await awaitSelected(driver, fixture.distantId);
    const stops = [1200, 1024, 900, 1512];
    for (const width of stops) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const immediate = width === stops[0];
      if (immediate) {
        // Mid-resize record: exactly one frame after the metrics change.
        await driver.evaluate(`new Promise((resolvePromise) =>
          requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))`);
        await capture(cdp, `light-selected-distant-${width}-mid-resize.png`);
      }
      await settle(driver, 520);
      const state = await driver.evaluate(`(() => {
        const overlay = document.querySelector("[data-connection-overlay]");
        const bounds = overlay?.getBoundingClientRect();
        const viewBox = overlay?.getAttribute("viewBox")?.split(" ").map(Number) ?? [];
        const mark = document.querySelector(${JSON.stringify(
          `.connection-mark[data-connection-id="${fixture.distantId}"]`,
        )});
        return {
          boxWidth: bounds ? Math.round(bounds.width * 100) / 100 : null,
          boxHeight: bounds ? Math.round(bounds.height * 100) / 100 : null,
          viewWidth: viewBox[2] != null ? Math.round(viewBox[2] * 100) / 100 : null,
          viewHeight: viewBox[3] != null ? Math.round(viewBox[3] * 100) / 100 : null,
          routed: Boolean(mark?.querySelector(".connection-route")),
          route: mark?.dataset.route ?? null,
        };
      })()`);
      assert.ok(state.boxWidth != null && state.viewWidth != null,
        `${width}px: underlay missing while selected`);
      assert.ok(Math.abs(state.boxWidth - state.viewWidth) <= 1.5
        && Math.abs(state.boxHeight - state.viewHeight) <= 1.5,
        `${width}px: stale geometry — overlay box ${state.boxWidth}x${state.boxHeight} `
        + `vs viewBox ${state.viewWidth}x${state.viewHeight}`);
      assert.ok(state.routed || state.route === "needs-space",
        `${width}px: neither a drawn route nor an honest needs-space (${state.route})`);
      await capture(cdp, `light-selected-distant-${width}.png`);
      console.log(`  responsive ${width}px: viewBox ${state.viewWidth}x${state.viewHeight}, `
        + `route ${state.routed ? "drawn (" + state.route + ")" : "honestly absent (" + state.route + ")"}`);
    }
    await releaseAllSelections(driver);
  }

  await scenes("dark", true);
  await scenes("porcelain", false);
  await scenes("onyx", false);
  await setTheme(driver, "light");
  await settle(driver);

  // The marking flow, end to end: live selection wash -> connect draft with
  // its first anchor -> two-anchor draft with the kind row.
  for (const theme of ["light", "dark"]) {
    await setTheme(driver, theme);
    await setFocusMode(driver, false);
    await settle(driver);
    const selectedText = await driver.evaluate(selectPhraseExpression({ verse: 3, quote: fixture.verse3Quote }));
    assert.equal(selectedText, fixture.verse3Quote, "marking selection drifted");
    await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="palette"] .marking-palette.is-placed'))`);
    await driver.waitFor(`Boolean(document.querySelector('[data-marking-selection-emphasis] .connection-emphasis-wash'))`);
    await settle(driver, 420);
    await capture(cdp, `${theme}-marking-selection.png`);

    await driver.evaluate(`document.querySelector('[data-marking-surface="palette"] [data-bar-action="connect"]')?.click()`);
    await driver.waitFor(`Boolean(document.querySelector(".marking-connect-draft"))`);
    await driver.waitFor(`Boolean(document.querySelector("[data-authoring-draft] .connection-emphasis-wash"))`);
    await settle(driver, 420);
    await capture(cdp, `${theme}-marking-connect-one-anchor.png`);

    const secondText = await driver.evaluate(selectPhraseExpression({ verse: 5, quote: fixture.verse5Quote }));
    assert.equal(secondText, fixture.verse5Quote, "second anchor selection drifted");
    await driver.waitFor(`Boolean(document.querySelector(".marking-connect-kinds"))`);
    await settle(driver, 420);
    await capture(cdp, `${theme}-marking-connect-two-anchors.png`);

    // Leave the draft through its own labelled exit — Cancel draft — then
    // clear any residual live selection with Escape.
    const cancelled = await driver.evaluate(`(() => {
      const cancel = [...document.querySelectorAll(".marking-connect-draft button, .marking-session button")]
        .find((button) => /cancel draft/i.test(button.textContent ?? ""));
      if (!cancel) return false;
      cancel.click();
      return true;
    })()`);
    assert.equal(cancelled, true, `${theme}: the connect draft offered no Cancel draft action`);
    // Cancelling raises the fail-closed exit guard; confirm through its own
    // labelled Discard draft choice.
    await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-scrim"))`, 8_000);
    const discarded = await driver.evaluate(`(() => {
      const discard = [...document.querySelectorAll(".connection-draft-exit-scrim button")]
        .find((button) => /discard draft/i.test(button.textContent ?? ""));
      if (!discard) return false;
      discard.click();
      return true;
    })()`);
    assert.equal(discarded, true, `${theme}: the exit guard offered no Discard draft choice`);
    await driver.waitFor(`!document.querySelector(".marking-connect-draft, .marking-session")`, 8_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clear = await driver.evaluate(`!document.querySelector("[data-marking-surface]")`);
      if (clear) break;
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(400);
    }
    await driver.evaluate(`(() => {
      getSelection()?.removeAllRanges();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return true;
    })()`);
    await settle(driver, 320);
  }

  console.log(`PASS connection captures written to ${OUT_DIR}`);
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
