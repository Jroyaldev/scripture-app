/**
 * Desktop-only visual and interaction QA for the production sidebar.
 *
 * Requires Electron on --remote-debugging-port=9222. Verifies the single
 * chosen density, hover/focus/current states, collapsed navigation, the one
 * footer library trigger, and portal styling in all four atmospheres.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/sidebar";
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
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 600));
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
  await sleep(120);
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

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
  await sleep(180);
  const changed = await evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Theme option not found: ${theme}`);
  await sleep(460);
  assert.equal(await evaluate(`document.querySelector(".app-shell")?.dataset.theme`), theme);
}

async function setCollapsed(collapsed) {
  const current = await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed")`);
  if (current === collapsed) return;
  await evaluate(`document.querySelector(".sidebar-collapse-btn")?.click()`);
  await waitFor(`document.querySelector(".sidebar")?.classList.contains("collapsed") === ${collapsed}`);
  // Remote hidden windows may throttle transition sampling. Finish the finite
  // width/opacity transitions before measuring the settled production state.
  await evaluate(`document.querySelector(".sidebar")?.getAnimations({ subtree: true }).forEach((animation) => {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
  })`);
  assert.equal(
    await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed")`),
    collapsed,
  );
}

await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".theme-toggle-btn"))`);
await sleep(500);

const original = await evaluate(`(() => ({
  theme: document.querySelector(".app-shell")?.dataset.theme ?? "light",
  collapsed: document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false,
  active: document.querySelector('.nav-item[aria-current="page"]')?.getAttribute("aria-label") ?? "Read (1)",
}))()`);

await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await setCollapsed(false);

const structure = await evaluate(`(() => ({
  labCount: document.querySelectorAll(".sidebar-lab").length,
  libraryTriggers: document.querySelectorAll(".library-switcher").length,
  activeCount: document.querySelectorAll('.nav-item[aria-current="page"]').length,
  width: document.querySelector(".sidebar")?.getBoundingClientRect().width,
  status: document.querySelector(".footer-ai-status")?.textContent?.trim(),
}))()`);
assert.equal(structure.labCount, 0);
assert.equal(structure.libraryTriggers, 1);
assert.equal(structure.activeCount, 1);
assert.ok(Math.abs(structure.width - 228) < 1, `expected 228px expanded sidebar, got ${structure.width}`);
assert.ok(
  structure.status === "Local library" || structure.status === "Studying passage…",
  `unexpected library status: ${structure.status}`,
);
console.log("structure", structure);

await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "2", code: "Digit2" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "2", code: "Digit2" });
await sleep(180);
assert.equal(
  await evaluate(`document.querySelector('.nav-item[aria-current="page"]')?.getAttribute("aria-label")`),
  "Write (2)",
);
// Write deliberately focuses its title field. Numeric navigation is scoped
// away from text editing, so return focus to the app chrome before proving
// the global shortcut back to Read.
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "1", code: "Digit1" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "1", code: "Digit1" });
await sleep(180);
assert.equal(
  await evaluate(`document.querySelector('.nav-item[aria-current="page"]')?.getAttribute("aria-label")`),
  "Read (1)",
);

for (const theme of THEMES) {
  await setTheme(theme);
  const colors = await evaluate(`(() => {
    const sidebar = document.querySelector(".sidebar");
    const active = document.querySelector('.nav-item[aria-current="page"]');
    return {
      theme: document.querySelector(".app-shell")?.dataset.theme,
      sidebar: getComputedStyle(sidebar).backgroundColor,
      active: getComputedStyle(active).backgroundColor,
      activeIcon: getComputedStyle(active.querySelector("svg")).color,
    };
  })()`);
  console.log(theme, colors);
  await screenshot(`${theme}-expanded`);
}

await setTheme("light");
await moveTo('[aria-label="Write (2)"]');
const hover = await evaluate(`(() => {
  const item = document.querySelector('[aria-label="Write (2)"]');
  const shortcut = item?.querySelector(".nav-shortcut");
  return {
    hovered: item?.matches(":hover"),
    shortcutOpacity: shortcut ? Number(getComputedStyle(shortcut).opacity) : 0,
  };
})()`);
assert.equal(hover.hovered, true);
assert.ok(hover.shortcutOpacity > 0.6, `shortcut should appear on hover: ${hover.shortcutOpacity}`);
await screenshot("light-hover");

await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
await evaluate(`document.querySelector('[aria-label="Settings (5)"]')?.focus()`);
assert.equal(await evaluate(`document.querySelector('[aria-label="Settings (5)"]')?.matches(":focus-visible")`), true);
await screenshot("light-keyboard-focus");
await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

await setCollapsed(true);
const collapsed = await evaluate(`(() => ({
  width: document.querySelector(".sidebar")?.getBoundingClientRect().width,
  labelOpacity: Number(getComputedStyle(document.querySelector(".nav-label")).opacity),
  collapseLabel: document.querySelector(".sidebar-collapse-btn")?.getAttribute("aria-label"),
}))()`);
assert.ok(Math.abs(collapsed.width - 64) < 1, `expected 64px collapsed sidebar, got ${collapsed.width}`);
assert.equal(collapsed.labelOpacity, 0);
assert.equal(collapsed.collapseLabel, "Expand sidebar");
await screenshot("light-collapsed");

await setCollapsed(false);
await evaluate(`document.querySelector(".library-switcher")?.click()`);
await waitFor(`Boolean(document.querySelector(".library-popover"))`);
assert.equal(await evaluate(`document.querySelector(".library-switcher")?.getAttribute("aria-expanded")`), "true");
await screenshot("light-library-menu");
await pressEscape();

await setTheme("dark-glass");
await evaluate(`document.querySelector(".library-switcher")?.click()`);
await waitFor(`Boolean(document.querySelector(".library-popover"))`);
await screenshot("dark-glass-library-menu");
await pressEscape();

await setTheme(leaveTheme ?? original.theme);
await setCollapsed(original.collapsed);
await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${original.active}"]`)})?.click()`);
await sleep(220);
cdp.ws.close();
console.log(leaveTheme ? "left theme" : "restored", leaveTheme ?? original);
