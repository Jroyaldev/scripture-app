/**
 * Desktop-only interaction and visual QA for shared controls/floating layers.
 *
 * Requires Electron on --remote-debugging-port=9222. The tour exercises real
 * reading controls, popovers, keyboard tooltips, and the note-capture dialog in
 * Paper/Ink/Glass/Candlelight. It never saves notes or mutates highlights.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/shared-controls";
const THEMES = ["light", "dark", "glass", "dark-glass"];
const THEME_NAMES = {
  light: "paper",
  dark: "ink",
  glass: "glass",
  "dark-glass": "candlelight",
};

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
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
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ws, send };
}

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((page) => page.title === "Scripture Library");
if (!app) throw new Error("Scripture Library is not available on :9222");
const cdp = await connect(app.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 800));
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeout = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(90);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(name, selectors = []) {
  let clip;
  if (selectors.length > 0) {
    clip = await evaluate(`(() => {
      const elements = ${JSON.stringify(selectors)}.map((selector) => document.querySelector(selector)).filter(Boolean);
      if (elements.length !== ${selectors.length}) return null;
      const rects = elements.map((element) => element.getBoundingClientRect());
      const pad = 24;
      const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - pad);
      const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - pad);
      const right = Math.min(window.innerWidth, Math.max(...rects.map((rect) => rect.right)) + pad);
      const bottom = Math.min(window.innerHeight, Math.max(...rects.map((rect) => rect.bottom)) + pad);
      return { x: left, y: top, width: right - left, height: bottom - top, scale: 1 };
    })()`);
    if (!clip) throw new Error(`Cannot capture missing selectors: ${selectors.join(", ")}`);
  }
  await cdp.send("Page.bringToFront");
  await sleep(180);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  if (!response.result?.data) throw new Error(`Could not capture ${name}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

async function pressKey(key, { code = key, shift = false, meta = false } = {}) {
  await evaluate(`(() => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: ${JSON.stringify(key)},
      code: ${JSON.stringify(code)},
      shiftKey: ${JSON.stringify(shift)},
      metaKey: ${JSON.stringify(meta)},
      bubbles: true,
      cancelable: true,
    }));
    target.dispatchEvent(new KeyboardEvent("keyup", {
      key: ${JSON.stringify(key)},
      code: ${JSON.stringify(code)},
      shiftKey: ${JSON.stringify(shift)},
      metaKey: ${JSON.stringify(meta)},
      bubbles: true,
    }));
  })()`);
  await sleep(150);
}

async function pressEscape() {
  await pressKey("Escape");
}

async function clickSelector(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Cannot click missing selector: ${selector}`);
  await cdp.send("Page.bringToFront");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(120);
}

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
  await waitFor(`Boolean(document.querySelector(".theme-picker-popover"))`);
  const changed = await evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Theme option not found: ${theme}`);
  await waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
  await sleep(220);
}

async function setCollapsed(collapsed) {
  const current = await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false`);
  if (current === collapsed) return;
  await evaluate(`document.querySelector(".sidebar-collapse-btn")?.click()`);
  await sleep(220);
}

async function setMargin(visible) {
  const current = await evaluate(`Boolean(document.querySelector(".living-margin"))`);
  if (current === visible) return;
  await evaluate(`document.querySelector(".margin-toggle-btn")?.click()`);
  await waitFor(`Boolean(document.querySelector(".living-margin")) === ${visible}`);
  await sleep(220);
}

async function setFocusMode(active) {
  const current = await evaluate(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === "true"`);
  if (current === active) return;
  await evaluate(`document.querySelector(".focus-btn")?.click()`);
  await waitFor(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === ${JSON.stringify(active ? "true" : "false")}`);
  await sleep(220);
}

async function setTranslation(code) {
  const current = await evaluate(`document.querySelector(".version-picker-btn")?.textContent?.trim().toLowerCase().split(/\\s+/)[0]`);
  if (current === code) return;
  await evaluate(`document.querySelector(".version-picker-btn")?.click()`);
  await waitFor(`Boolean(document.querySelector(".version-picker-popover"))`);
  const changed = await evaluate(`(() => {
    const option = [...document.querySelectorAll(".version-picker-item")].find((item) =>
      item.querySelector(".version-picker-code")?.textContent?.trim().toLowerCase() === ${JSON.stringify(code)}
    );
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Translation option not found: ${code}`);
  await waitFor(`document.querySelector(".version-picker-btn")?.textContent?.trim().toLowerCase().startsWith(${JSON.stringify(code)})`);
  await sleep(280);
}

async function navigatePassage(passage) {
  await evaluate(`(() => {
    const input = document.querySelector(".passage-jump-input");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(passage)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.closest("form")?.requestSubmit();
    return true;
  })()`);
  await waitFor(`(() => {
    const title = document.querySelector(".chapter-title");
    return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
      .filter(Boolean).join(" ") === ${JSON.stringify(passage)};
  })()`);
  await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
  await sleep(320);
}

async function openReadingLayout() {
  await clickSelector(".reading-comfort-btn");
  await waitFor(`Boolean(document.querySelector(".reading-comfort-popover"))`);
  await sleep(180);
}

async function chooseReadingPreference(groupIndex, value) {
  const changed = await evaluate(`(() => {
    const groups = document.querySelectorAll(".reading-comfort-popover .control-segmented");
    const option = groups[${groupIndex}]?.querySelector(${JSON.stringify(`[data-value="${value}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Reading preference not found: group ${groupIndex}, ${value}`);
  await sleep(120);
}

async function openNoteCapture() {
  await clickSelector('.verse-line[data-verse="1"]');
  await waitFor(`Boolean(document.querySelector('.hl-toolbar-floating .hl-btn-note'))`);
  await clickSelector('.hl-toolbar-floating .hl-btn-note');
  await waitFor(`Boolean(document.querySelector(".note-capture-panel"))`);
  await waitFor(`document.activeElement?.classList.contains("note-capture-textarea")`);
  await sleep(180);
}

await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`);
await cdp.send("Page.bringToFront");
await evaluate(`window.focus()`);
await sleep(480);

const originalBounds = await evaluate(`({
  left: window.screenX,
  top: window.screenY,
  width: window.outerWidth,
  height: window.outerHeight,
})`);
const original = await evaluate(`(() => ({
  theme: document.querySelector(".app-shell")?.dataset.theme ?? "light",
  collapsed: document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false,
  margin: Boolean(document.querySelector(".living-margin")),
  focus: document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === "true",
  packageId: document.querySelector(".version-picker-btn")?.textContent?.trim().toLowerCase().split(/\\s+/)[0] ?? "bsb",
  passage: (() => {
    const title = document.querySelector(".chapter-title");
    return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
      .filter(Boolean).join(" ") || "Genesis 1";
  })(),
  readingSize: [...document.querySelector(".app-shell")?.classList ?? []].find((name) => name.startsWith("reading-size-"))?.slice(13) ?? "m",
  readingWidth: [...document.querySelector(".app-shell")?.classList ?? []].find((name) => name.startsWith("reading-width-"))?.slice(14) ?? "medium",
  verseNumbers: [...document.querySelector(".app-shell")?.classList ?? []].find((name) => name.startsWith("verse-nums-"))?.slice(11) ?? "always",
}))()`);

if (await evaluate(`window.innerWidth < 1_420`)) {
  await evaluate(`window.resizeTo(1440, ${JSON.stringify(Math.max(860, originalBounds.height))})`);
  await sleep(520);
}

await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-content"))`);
await setFocusMode(false);
await setCollapsed(false);
await setMargin(true);
await setTranslation("bsb");
await navigatePassage("Genesis 1");

for (const theme of THEMES) {
  await setTheme(theme);
  await openReadingLayout();
  const popoverState = await evaluate(`(() => ({
    role: document.querySelector(".reading-comfort-popover")?.getAttribute("role"),
    label: document.querySelector(".reading-comfort-popover")?.getAttribute("aria-label"),
    floating: document.querySelector(".reading-comfort-popover")?.dataset.floatingLayer,
    radios: document.querySelectorAll(".reading-comfort-popover [role=radio]").length,
    checked: document.querySelectorAll(".reading-comfort-popover [role=radio][aria-checked=true]").length,
    tabbable: document.querySelectorAll(".reading-comfort-popover [role=radio][tabindex='0']").length,
    focusInside: document.querySelector(".reading-comfort-popover")?.contains(document.activeElement) ?? false,
    scrim: getComputedStyle(document.querySelector(".popover-scrim")).backgroundColor,
  }))()`);
  assert.deepEqual(popoverState, {
    role: "dialog",
    label: "Reading layout",
    floating: "popover",
    radios: 9,
    checked: 3,
    tabbable: 3,
    focusInside: true,
    scrim: "rgba(0, 0, 0, 0)",
  });
  console.log(theme, "popover", popoverState);

  if (theme === "light") {
    const typeSize = `.reading-comfort-popover [role="radiogroup"][aria-label="Type size"] [aria-checked="true"]`;
    const before = await evaluate(`document.querySelector(${JSON.stringify(typeSize)})?.getAttribute("data-value") ?? null`);
    assert.notEqual(before, null);
    await evaluate(`document.querySelector(${JSON.stringify(typeSize)})?.focus()`);
    await pressKey("ArrowRight");
    const after = await evaluate(`document.querySelector(${JSON.stringify(typeSize)})?.getAttribute("data-value") ?? null`);
    assert.notEqual(after, before);
    assert.equal(await evaluate(`document.activeElement?.getAttribute("aria-checked")`), "true");
    await chooseReadingPreference(0, original.readingSize);
  }

  await screenshot(`${THEME_NAMES[theme]}-reading-layout`);

  if (await evaluate(`Boolean(document.querySelector(".reading-comfort-popover"))`)) {
    await pressEscape();
  }
  await waitFor(`!document.querySelector(".reading-comfort-popover")`);
  assert.equal(await evaluate(`document.activeElement?.classList.contains("reading-comfort-btn")`), true);

  await openNoteCapture();
  const dialogState = await evaluate(`(() => ({
    role: document.querySelector(".note-capture-root")?.getAttribute("role"),
    modal: document.querySelector(".note-capture-root")?.getAttribute("aria-modal"),
    floating: document.querySelector(".note-capture-root")?.dataset.floatingLayer,
    focusInside: document.querySelector(".note-capture-panel")?.contains(document.activeElement) ?? false,
    sharedInputs: document.querySelectorAll(".note-capture-panel [data-control=input], .note-capture-panel [data-control=textarea]").length,
    sharedButtons: document.querySelectorAll(".note-capture-panel [data-control=button]").length,
  }))()`);
  assert.deepEqual(dialogState, {
    role: "dialog",
    modal: "true",
    floating: "dialog",
    focusInside: true,
    sharedInputs: 2,
    sharedButtons: 3,
  });
  console.log(theme, "dialog", dialogState);
  await screenshot(`${THEME_NAMES[theme]}-note-dialog`);

  if (theme === "light") {
    await evaluate(`document.querySelector(".note-capture-close")?.focus()`);
    await pressKey("Tab", { code: "Tab", shift: true });
    assert.equal(await evaluate(`document.activeElement?.classList.contains("note-capture-save")`), true);
    await pressKey("Tab", { code: "Tab" });
    assert.equal(await evaluate(`document.activeElement?.classList.contains("note-capture-close")`), true);
  }
  await evaluate(`document.querySelector(".note-capture-cancel")?.click()`);
  await waitFor(`!document.querySelector(".note-capture-panel")`);
  await waitFor(`document.activeElement?.classList.contains("verse-line")`);
}

await setTheme("light");
await evaluate(`document.querySelector(".margin-toggle-btn")?.focus()`);
await waitFor(`Boolean(document.querySelector('[role="tooltip"]'))`);
await waitFor(`Number.parseFloat(getComputedStyle(document.querySelector('[role="tooltip"]')).opacity) > 0.9`);
const tooltipState = await evaluate(`(() => ({
  role: document.querySelector("[role=tooltip]")?.getAttribute("role"),
  text: document.querySelector("[role=tooltip]")?.textContent?.trim(),
  described: document.querySelector(".margin-toggle-btn")?.getAttribute("aria-describedby"),
  visible: Number.parseFloat(getComputedStyle(document.querySelector("[role=tooltip]")).opacity) > 0.9,
}))()`);
assert.equal(tooltipState.role, "tooltip");
assert.match(tooltipState.text ?? "", /Study/);
assert.ok(tooltipState.described);
assert.equal(tooltipState.visible, true);
console.log("tooltip", tooltipState);
await screenshot("paper-keyboard-tooltip", [".margin-toggle-btn", "[role=tooltip]"]);
await pressEscape();
await waitFor(`!document.querySelector('[role="tooltip"]')`);

await evaluate(`document.querySelector(".library-switcher")?.click()`);
await waitFor(`Boolean(document.querySelector(".library-popover"))`);
assert.equal(await evaluate(`document.querySelectorAll(".library-popover .control-menu-item").length`), 3);
await screenshot("paper-library-menu", [".library-switcher", ".library-popover"]);
await pressEscape();

// Non-mutating toast visual fixture: behavior remains covered by the source
// contract test, while this fixture verifies final CSS in every material.
for (const theme of THEMES) {
  await setTheme(theme);
  await evaluate(`(() => {
    const shell = document.querySelector(".app-shell");
    const material = [...shell.classList].filter((name) => name === "dark" || name.startsWith("theme-")).join(" ");
    const host = document.createElement("div");
    host.id = "qa-toast-fixture";
    host.className = "toast-container " + material;
    host.innerHTML = '<div class="toast toast--success" role="status" data-floating-layer="toast" style="--toast-duration:5000ms"><span class="toast-mark"><svg viewBox="0 0 16 16"><path d="M3.2 8.3 6.4 11.2 12.8 4.8"></path></svg></span><span class="toast-message">Note saved to your library</span><button class="toast-action">View</button><button class="toast-close" aria-label="Dismiss notification"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"></path></svg></button><span class="toast-progress"></span></div>';
    document.body.append(host);
  })()`);
  await sleep(180);
  await screenshot(`${THEME_NAMES[theme]}-toast`, ["#qa-toast-fixture"]);
  await evaluate(`document.querySelector("#qa-toast-fixture")?.remove()`);
}

await setTheme(original.theme);
await openReadingLayout();
await chooseReadingPreference(0, original.readingSize);
await chooseReadingPreference(1, original.readingWidth);
await chooseReadingPreference(2, original.verseNumbers);
await pressEscape();
await navigatePassage(original.passage);
await setTranslation(original.packageId);
await setMargin(original.margin);
await setCollapsed(original.collapsed);
await setFocusMode(original.focus);
await evaluate(`window.resizeTo(${JSON.stringify(originalBounds.width)}, ${JSON.stringify(originalBounds.height)}); window.moveTo(${JSON.stringify(originalBounds.left)}, ${JSON.stringify(originalBounds.top)})`);
await sleep(360);
cdp.ws.close();
console.log("Shared controls QA PASS");
