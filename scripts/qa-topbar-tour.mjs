/**
 * Desktop-only visual and interaction QA for the reading topbar.
 *
 * Requires Electron on --remote-debugging-port=9222. Exercises both toolbar
 * zones, every picker, the Command K entry point, focus mode,
 * margin stability, scroll depth, all four atmospheres, and the supported
 * 900px minimum desktop width.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/topbar";
const THEMES = ["light", "dark", "glass", "dark-glass"];
const leaveThemeArg = process.argv.find((arg) => arg.startsWith("--leave="))?.slice("--leave=".length);
const leaveTheme = leaveThemeArg && THEMES.includes(leaveThemeArg) ? leaveThemeArg : null;

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
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 700));
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeout = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(name) {
  await cdp.send("Page.bringToFront");
  await sleep(220);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

async function pressEscape() {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(180);
}

async function pressCommandK() {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 4 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", modifiers: 4 });
  await sleep(180);
}

async function moveTo(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Cannot hover missing element: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await sleep(180);
}

async function parkPointer() {
  const point = await evaluate(`({
    x: Math.round(window.innerWidth * 0.58),
    y: Math.min(500, Math.round(window.innerHeight * 0.64)),
  })`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await sleep(120);
}

async function blurActiveElement() {
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await sleep(100);
}

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
  await sleep(160);
  const changed = await evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Theme option not found: ${theme}`);
  await sleep(440);
  assert.equal(await evaluate(`document.querySelector(".app-shell")?.dataset.theme`), theme);
}

async function setMargin(visible) {
  const current = await evaluate(`document.querySelector(".margin-toggle-btn")?.classList.contains("active")`);
  if (current === visible) return;
  await evaluate(`document.querySelector(".margin-toggle-btn")?.click()`);
  await sleep(360);
  assert.equal(
    await evaluate(`document.querySelector(".margin-toggle-btn")?.classList.contains("active")`),
    visible,
  );
}

async function setCollapsed(collapsed) {
  const current = await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed")`);
  if (current === collapsed) return;
  await evaluate(`document.querySelector(".sidebar-collapse-btn")?.click()`);
  await sleep(300);
}

await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-topbar"))`);
await sleep(520);

const originalBounds = await evaluate(`({
  left: window.screenX,
  top: window.screenY,
  width: window.outerWidth,
  height: window.outerHeight,
})`);
const fullDesktopBounds = {
  ...originalBounds,
  width: Math.max(1_512, originalBounds.width),
};
const original = await evaluate(`(() => ({
  theme: document.querySelector(".app-shell")?.dataset.theme ?? "light",
  collapsed: document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false,
  active: document.querySelector('.nav-item[aria-current="page"]')?.getAttribute("aria-label") ?? "Read (1)",
  margin: document.querySelector(".margin-toggle-btn")?.classList.contains("active") ?? true,
}))()`);

if (await evaluate(`window.innerWidth < 1_200`)) {
  await evaluate(`window.resizeTo(${JSON.stringify(fullDesktopBounds.width)}, ${JSON.stringify(fullDesktopBounds.height)})`);
  await sleep(700);
  assert.ok(await evaluate(`window.innerWidth >= 1_200`), "could not establish full desktop capture width");
}

await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-topbar"))`);
await setCollapsed(false);
await setMargin(true);
await setTheme("light");

const structure = await evaluate(`(() => {
  const bar = document.querySelector(".scripture-topbar");
  const nav = document.querySelector(".topbar-navigation");
  const tools = document.querySelector(".topbar-tools");
  return {
    toolbarRole: bar?.getAttribute("role"),
    toolbarLabel: bar?.getAttribute("aria-label"),
    navRight: nav?.getBoundingClientRect().right,
    toolsLeft: tools?.getBoundingClientRect().left,
    oldSlotCount: document.querySelectorAll(".topbar-margin-slot").length,
    jumpShortcut: document.querySelector(".passage-jump-shortcut")?.textContent,
    layoutIcon: Boolean(document.querySelector(".reading-layout-icon")),
    straySizeTag: document.querySelectorAll(".reading-comfort-size-tag").length,
    innerWidth: window.innerWidth,
  };
})()`);
assert.equal(structure.toolbarRole, "toolbar");
assert.equal(structure.toolbarLabel, "Reading toolbar");
assert.equal(structure.oldSlotCount, 0);
assert.equal(structure.jumpShortcut, "⌘K");
assert.equal(structure.layoutIcon, true);
assert.equal(structure.straySizeTag, 0);
assert.ok(structure.navRight < structure.toolsLeft, "topbar zones must not overlap");
console.log("structure", structure);

for (const theme of THEMES) {
  await setTheme(theme);
  await blurActiveElement();
  await parkPointer();
  await sleep(260);
  await screenshot(`${theme}-toolbar`);
  const material = await evaluate(`(() => {
    const bar = document.querySelector(".scripture-topbar");
    const location = document.querySelector(".passage-picker-group");
    return {
      theme: document.querySelector(".app-shell")?.dataset.theme,
      bar: getComputedStyle(bar).backgroundColor,
      location: getComputedStyle(location).backgroundColor,
    };
  })()`);
  console.log(theme, material);
}

await setTheme("light");
await blurActiveElement();
await moveTo(".version-picker-btn");
assert.equal(await evaluate(`document.querySelector(".version-picker-btn")?.matches(":hover")`), true);
await screenshot("light-hover");

await parkPointer();
await evaluate(`document.querySelector(".passage-picker-btn")?.click()`);
await waitFor(`Boolean(document.querySelector(".passage-picker-popover"))`);
await screenshot("light-passage-picker");
await evaluate(`document.querySelector(".picker-title-action")?.click()`);
await waitFor(`document.activeElement === document.querySelector(".popover-search input")`);
await screenshot("light-book-picker");
await pressEscape();
assert.equal(await evaluate(`document.activeElement === document.querySelector(".passage-picker-btn")`), true);
await blurActiveElement();

await evaluate(`document.querySelector(".version-picker-btn")?.click()`);
await waitFor(`Boolean(document.querySelector(".version-picker-popover"))`);
await evaluate(`document.querySelector(".version-picker-item")?.focus()`);
await screenshot("light-translation-picker");
await pressEscape();
assert.equal(await evaluate(`document.activeElement === document.querySelector(".version-picker-btn")`), true);
await blurActiveElement();

await evaluate(`document.querySelector('[aria-label="Reading size and layout"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".reading-comfort-popover"))`);
await screenshot("light-reading-layout");
await pressEscape();
assert.equal(await evaluate(`document.activeElement === document.querySelector('[aria-label="Reading size and layout"]')`), true);
await blurActiveElement();

await pressCommandK();
assert.equal(await evaluate(`document.activeElement === document.querySelector(".command-palette-input-row input")`), true);
assert.equal(await evaluate(`document.querySelectorAll(".command-palette-tabs [role=tab]").length`), 4);
await screenshot("light-command-palette-entry");
await pressEscape();
assert.equal(await evaluate(`Boolean(document.querySelector(".command-palette-panel"))`), false);

const beforeMargin = await evaluate(`(() => {
  const tools = document.querySelector(".topbar-tools").getBoundingClientRect();
  const nav = document.querySelector(".topbar-navigation").getBoundingClientRect();
  return { toolsLeft: tools.left, toolsRight: tools.right, navLeft: nav.left, navRight: nav.right };
})()`);
await setMargin(false);
const afterMargin = await evaluate(`(() => {
  const tools = document.querySelector(".topbar-tools").getBoundingClientRect();
  const nav = document.querySelector(".topbar-navigation").getBoundingClientRect();
  return { toolsLeft: tools.left, toolsRight: tools.right, navLeft: nav.left, navRight: nav.right };
})()`);
assert.ok(Math.abs(beforeMargin.toolsLeft - afterMargin.toolsLeft) < 1, "tools moved when margin visibility changed");
assert.ok(Math.abs(beforeMargin.navRight - afterMargin.navRight) < 1, "navigation moved when margin visibility changed");
await screenshot("light-margin-hidden");
await setMargin(true);

await evaluate(`document.querySelector(".focus-btn")?.click()`);
await waitFor(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === "true"`);
assert.equal(await evaluate(`Boolean(document.querySelector(".sidebar"))`), false);
assert.equal(await evaluate(`Boolean(document.querySelector(".living-margin"))`), false);
await screenshot("light-focus-mode");
await evaluate(`document.querySelector(".focus-btn")?.click()`);
await waitFor(`Boolean(document.querySelector(".sidebar"))`);

await evaluate(`(() => {
  const content = document.querySelector(".scripture-content");
  content.scrollTop = 180;
  content.dispatchEvent(new Event("scroll"));
})()`);
await waitFor(`document.querySelector(".scripture-topbar")?.classList.contains("scrolled")`);
await screenshot("light-scrolled");
await evaluate(`(() => {
  const content = document.querySelector(".scripture-content");
  content.scrollTop = 0;
  content.dispatchEvent(new Event("scroll"));
})()`);
await sleep(180);

// Electron ignores window.resizeTo while the human has the app maximized.
// Device-metric emulation proves the same renderer breakpoint without
// changing or unmaximizing their window.
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 900,
  height: 700,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 900,
  screenHeight: 700,
});
await waitFor(`window.innerWidth === 900`, 5_000);
await sleep(180);
const minimum = await evaluate(`(() => {
  const bar = document.querySelector(".scripture-topbar").getBoundingClientRect();
  const nav = document.querySelector(".topbar-navigation").getBoundingClientRect();
  const tools = document.querySelector(".topbar-tools").getBoundingClientRect();
  const jump = document.querySelector(".passage-jump").getBoundingClientRect();
  return {
    viewport: window.innerWidth,
    barLeft: bar.left,
    barRight: bar.right,
    navRight: nav.right,
    toolsLeft: tools.left,
    toolsRight: tools.right,
    jumpWidth: jump.width,
  };
})()`);
assert.ok(minimum.viewport <= 900);
assert.ok(minimum.navRight <= minimum.toolsLeft, `minimum-width zones overlap: ${JSON.stringify(minimum)}`);
assert.ok(minimum.toolsRight <= minimum.barRight + 0.5);
assert.ok(minimum.jumpWidth <= 37, `dormant jump did not compact: ${minimum.jumpWidth}`);
console.log("minimum", minimum);
await screenshot("light-minimum-width");

await pressCommandK();
const minimumFocused = await evaluate(`(() => {
  const nav = document.querySelector(".topbar-navigation").getBoundingClientRect();
  const tools = document.querySelector(".topbar-tools").getBoundingClientRect();
  const jump = document.querySelector(".passage-jump").getBoundingClientRect();
  const palette = document.querySelector(".command-palette-panel").getBoundingClientRect();
  return {
    navRight: nav.right,
    toolsLeft: tools.left,
    jumpWidth: jump.width,
    paletteLeft: palette.left,
    paletteRight: palette.right,
  };
})()`);
assert.ok(minimumFocused.jumpWidth <= 37);
assert.ok(minimumFocused.navRight <= minimumFocused.toolsLeft, `focused minimum-width zones overlap: ${JSON.stringify(minimumFocused)}`);
assert.ok(minimumFocused.paletteLeft >= 0 && minimumFocused.paletteRight <= 900);
await screenshot("light-minimum-command-palette");
await pressEscape();

await cdp.send("Emulation.clearDeviceMetricsOverride");
await sleep(220);

const restoredBounds = leaveTheme ? fullDesktopBounds : originalBounds;
await evaluate(`window.resizeTo(${JSON.stringify(restoredBounds.width)}, ${JSON.stringify(restoredBounds.height)}); window.moveTo(${JSON.stringify(restoredBounds.left)}, ${JSON.stringify(restoredBounds.top)})`);
await sleep(620);
if (leaveTheme) assert.ok(await evaluate(`window.innerWidth >= 1_200`), "could not restore full desktop width");

await setMargin(original.margin);
await setCollapsed(original.collapsed);
await setTheme(leaveTheme ?? original.theme);
await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${original.active}"]`)})?.click()`);
await sleep(220);
cdp.ws.close();
console.log(leaveTheme ? "left theme" : "restored", leaveTheme ?? original);
