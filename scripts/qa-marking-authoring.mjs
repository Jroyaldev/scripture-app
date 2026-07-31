/**
 * Designer-eye captures for the two marking AUTHORING surfaces (2026-07-30).
 *
 * The repo's own recorded lesson is that visual approval is not the same as
 * passing tests, so the two surfaces a reader touches most have to be LOOKED
 * at, in every atmosphere, before they are frozen. This boots the real
 * Electron renderer against an isolated temporary library, drives the real
 * gestures, and writes PNGs to docs/ui-audit/marking-authoring/:
 *
 *   selection      — the bar over a live selection, at rest
 *   swatch-help    — the footer answering the control under the pointer,
 *                    with that control's key beside it
 *   more           — the More list: only what this window can actually do
 *   draft-one      — the connection draft holding its first phrase
 *   draft-two      — two phrases, the six kinds as words, the field
 *   draft-named    — a named, chosen, composed draft ready to save
 *   draft-three    — three phrases: the exact-2 kinds out of reach, dimmed
 *   dock-*         — the same two surfaces on the shelf, for a thumb
 *
 * Paper and Ink carry the full set; Porcelain and Onyx carry the two headline
 * scenes as atmosphere spot checks, and Paper repeats them under forced
 * colors. User data is never touched: the profile and library are temporary.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const WIDTH = 1280;
const HEIGHT = 900;
const OUT_DIR = resolve("docs/ui-audit/marking-authoring");
const FIXTURE = {
  first: { verse: 8, quote: "the kingdom of God" },
  second: { verse: 9, quote: "the Way" },
  third: { verse: 10, quote: "the word of the Lord" },
};
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

async function setMedia(cdp, { forced = false } = {}) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-reduced-motion", value: "no-preference" },
      { name: "forced-colors", value: forced ? "active" : "none" },
    ],
  });
}

async function setSurface(driver, surface) {
  await driver.evaluate(`window.api.settings.set({ markingSurface: ${JSON.stringify(surface)} })`);
  await sleep(220);
}

async function settle(driver, ms = 380) {
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

function selectPhraseExpression(spec) {
  return `(async () => {
    const spec = ${JSON.stringify(spec)};
    const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
    const span = row?.querySelector(".verse-text-span");
    if (!row || !span) throw new Error("missing verse " + spec.verse);
    const text = span.textContent ?? "";
    const startOffset = text.indexOf(spec.quote);
    if (startOffset < 0) throw new Error("phrase absent: " + spec.quote);
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

/** Park the pointer over a control by its own measured box, not by guesswork. */
async function hover(driver, cdp, selector) {
  const box = await driver.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(box, `no control matched ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0, pointerType: "mouse" });
}

async function parkPointer(cdp) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0, pointerType: "mouse" });
}

async function pressKey(cdp, key, code = key, windowsVirtualKeyCode = undefined) {
  const params = { key, code, modifiers: 0 };
  if (windowsVirtualKeyCode != null) params.windowsVirtualKeyCode = windowsVirtualKeyCode;
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function clearDraft(driver, cdp) {
  const cancelled = await driver.evaluate(`(() => {
    const cancel = [...document.querySelectorAll(".marking-connect-actions button")]
      .find((button) => /cancel draft/i.test(button.textContent ?? ""));
    if (!cancel) return false;
    cancel.click();
    return true;
  })()`);
  if (cancelled) {
    await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-scrim"))`, 8_000);
    await driver.evaluate(`(() => {
      const discard = [...document.querySelectorAll(".connection-draft-exit-scrim button")]
        .find((button) => /discard draft/i.test(button.textContent ?? ""));
      discard?.click();
    })()`);
    await driver.waitFor(`!document.querySelector(".connection-draft-exit-scrim") && !document.querySelector(".marking-connect-draft")`);
  }
  await driver.evaluate(`getSelection()?.removeAllRanges()`);
  await pressKey(cdp, "Escape", "Escape", 27);
  await settle(driver, 220);
}

/** The scene set. `full` adds the three-phrase and composed-draft frames. */
async function scenes(driver, cdp, prefix, { full, dock = false }) {
  const host = dock ? '[data-marking-surface="dock"]' : '[data-marking-surface="palette"]';
  const ready = dock
    ? `Boolean(document.querySelector('${host} .marking-bar'))`
    : `Boolean(document.querySelector('${host} .marking-palette.is-placed'))`;

  await clearDraft(driver, cdp);
  await parkPointer(cdp);

  const first = await driver.evaluate(selectPhraseExpression(FIXTURE.first));
  assert.equal(first, FIXTURE.first.quote, `${prefix}: selection drifted`);
  await driver.waitFor(ready);
  await settle(driver);
  await capture(cdp, `${prefix}-selection.png`);

  if (!dock) {
    // The footer answers the control under the pointer, and shows that
    // control's key beside it. Nothing is printed at rest.
    // Focus rather than hover: a CDP screenshot can drop a synthetic :hover
    // between the assertion and the frame, and focus survives the capture.
    // Both routes reach the same help handler, so the frame is honest.
    await driver.evaluate(`document.querySelector('${host} .marking-bar-swatch[data-pigment="blue"]')?.focus()`);
    await settle(driver, 240);
    const help = await driver.evaluate(`(() => ({
      line: document.querySelector(".marking-palette-help")?.textContent?.trim() ?? null,
      key: document.querySelector(".marking-palette-key kbd")?.textContent?.trim() ?? null,
    }))()`);
    assert.equal(help.key, "3", `${prefix}: the hovered swatch did not show its own key (${JSON.stringify(help)})`);
    await capture(cdp, `${prefix}-swatch-help.png`);
    await parkPointer(cdp);
    await settle(driver, 220);
  }

  // More: only what this window can actually do, and no row carrying a reason.
  await driver.evaluate(`document.querySelector('${host} [data-bar-action="more"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector('${host} .marking-more'))`);
  await settle(driver, 260);
  const more = await driver.evaluate(`(() => {
    const panel = document.querySelector('${host} .marking-more');
    const items = [...(panel?.querySelectorAll("[data-more-action]") ?? [])];
    return {
      ids: items.map((item) => item.getAttribute("data-more-action")),
      disabled: items.filter((item) => item.disabled).length,
      reasons: panel?.querySelectorAll(".marking-more-reason").length ?? 0,
      scope: panel?.querySelector(".marking-more-scope")?.textContent?.trim() ?? null,
    };
  })()`);
  assert.ok(more.ids.length >= 1, `${prefix}: More opened onto nothing`);
  assert.equal(more.disabled, 0, `${prefix}: More offered a row it cannot run`);
  assert.equal(more.reasons, 0, `${prefix}: More printed an apology beside a row`);
  console.log(`  ${prefix} More: ${more.ids.join(" · ")}  scope "${more.scope}"`);
  await capture(cdp, `${prefix}-more.png`);
  await pressKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.querySelector('${host} .marking-more')`);
  await settle(driver, 200);

  // The draft, phrase by phrase.
  await driver.evaluate(`document.querySelector('${host} [data-bar-action="connect"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector('.marking-connect-draft[data-connect-state="one-anchor"]'))`);
  await settle(driver);
  await capture(cdp, `${prefix}-draft-one.png`);

  const second = await driver.evaluate(selectPhraseExpression(FIXTURE.second));
  assert.equal(second, FIXTURE.second.quote, `${prefix}: second selection drifted`);
  await driver.waitFor(`Boolean(document.querySelector('.marking-connect-draft[data-connect-state="two-anchors"] .marking-connect-kinds'))`);
  await settle(driver);
  const kinds = await driver.evaluate(`(() => {
    const nodes = [...document.querySelectorAll(".marking-connect-kinds [data-relationship-kind]")];
    return {
      labels: nodes.map((node) => node.textContent?.trim()),
      glyphs: document.querySelectorAll(".marking-connect-kinds svg").length,
      blocked: nodes.filter((node) => node.hasAttribute("data-arity-blocked")).length,
    };
  })()`);
  assert.deepEqual(kinds.labels, ["Parallelism", "Contrast", "Echo", "Mirror", "Series", "Hinge"],
    `${prefix}: the kinds are not the six words`);
  assert.equal(kinds.glyphs, 0, `${prefix}: a pictogram survived in the kind row`);
  assert.equal(kinds.blocked, 0, `${prefix}: two phrases put an exact-2 kind out of reach`);
  await capture(cdp, `${prefix}-draft-two.png`);

  if (full) {
    // Named, chosen and composed: what the reader actually saves.
    await driver.evaluate(`document.querySelector('.marking-connect-kinds [data-relationship-kind="link:parallel"]')?.click()`);
    await driver.waitFor(`document.querySelector('.marking-connect-kinds [data-relationship-kind="link:parallel"]')?.getAttribute("aria-checked") === "true"`);
    await driver.evaluate(`(() => {
      const field = document.querySelector(".marking-connect-field textarea");
      if (!field) throw new Error("no draft field");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Both name the same road\\nPaul argues it in the synagogue; Luke calls it the Way.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
      return true;
    })()`);
    await settle(driver);
    await capture(cdp, `${prefix}-draft-named.png`);

    // A third phrase puts the exact-2 kinds out of reach — dimmed, with the
    // reason on the control rather than printed beside it.
    const third = await driver.evaluate(selectPhraseExpression(FIXTURE.third));
    assert.equal(third, FIXTURE.third.quote, `${prefix}: third selection drifted`);
    await driver.waitFor(`document.querySelectorAll(".marking-connect-anchors .marking-connect-ref").length === 3`);
    await settle(driver);
    const arity = await driver.evaluate(`(() => {
      const nodes = [...document.querySelectorAll(".marking-connect-kinds [data-relationship-kind]")];
      return nodes.filter((node) => node.hasAttribute("data-arity-blocked"))
        .map((node) => node.getAttribute("data-relationship-kind"));
    })()`);
    assert.deepEqual(arity.sort(), ["hinge", "link:contrast", "mirror"],
      `${prefix}: arity is not read off the kind at three phrases`);
    await capture(cdp, `${prefix}-draft-three.png`);
  }

  await clearDraft(driver, cdp);
}

mkdirSync(OUT_DIR, { recursive: true });
const qaRoot = mkdtempSync(join(tmpdir(), "scripture-marking-authoring-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const port = 9640 + Math.floor(Math.random() * 120);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = { ...process.env, LIBRARY_PATH: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
);
let childLog = "";
child.stdout.on("data", (chunk) => { childLog = (childLog + chunk.toString()).slice(-16_000); });
child.stderr.on("data", (chunk) => { childLog = (childLog + chunk.toString()).slice(-16_000); });

let cdp = null;
try {
  const target = await waitForTarget(endpoint);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await setMedia(cdp);

  const ready = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    for (const fixture of ${JSON.stringify(Object.values(FIXTURE))}) {
      if (!text(fixture.verse).includes(fixture.quote)) throw new Error("fixture absent: " + fixture.quote);
    }
    await window.api.settings.set({
      theme: "light",
      sidebarCollapsed: true,
      marginVisible: false,
      markingSurface: "palette",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return true;
  })()`);
  assert.equal(ready, true, "fixture setup failed");

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`!document.querySelector(".living-margin")`);
  await settle(driver);

  await setTheme(driver, "light");
  await scenes(driver, cdp, "light", { full: true });

  await setTheme(driver, "dark");
  await scenes(driver, cdp, "dark", { full: true });

  await setTheme(driver, "porcelain");
  await scenes(driver, cdp, "porcelain", { full: false });

  await setTheme(driver, "onyx");
  await scenes(driver, cdp, "onyx", { full: false });

  // Forced colors, on Paper: every mark here has to survive a system palette.
  await setTheme(driver, "light");
  await setMedia(cdp, { forced: true });
  await settle(driver);
  await scenes(driver, cdp, "forced", { full: true });
  await setMedia(cdp);

  // The shelf: the same two surfaces under a thumb.
  await setTheme(driver, "light");
  await setSurface(driver, "dock");
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="dock"]'))`, 20_000);
  await settle(driver);
  await scenes(driver, cdp, "light-dock", { full: false, dock: true });
  await setSurface(driver, "palette");

  console.log("\nmarking authoring captures complete");
} catch (error) {
  console.error(childLog.slice(-3_000));
  throw error;
} finally {
  cdp?.ws.close();
  child.kill("SIGTERM");
  await sleep(500);
  child.kill("SIGKILL");
  rmSync(qaRoot, { recursive: true, force: true });
}
