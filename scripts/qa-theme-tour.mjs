/**
 * Desktop-only visual QA for the six reading atmospheres.
 *
 * Requires Electron on --remote-debugging-port=9222. Captures each complete
 * shell plus the atmosphere picker, verifies the selected theme reached the
 * shell, and restores the user's original choice.
 */

import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/theme";
const THEMES = ["porcelain", "light", "dark", "onyx", "glass", "dark-glass"];

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
const app = pages.find((page) => page.title === "Pericope");
if (!app) throw new Error("Pericope is not available on :9222");
const cdp = await connect(app.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 500));
  }
  return response.result?.result?.value;
}

async function screenshot(name) {
  await cdp.send("Page.bringToFront");
  await sleep(250);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await sleep(180);
  const changed = await evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Theme option not found: ${theme}`);
  await sleep(480);
  const applied = await evaluate(`document.querySelector(".app-shell")?.dataset.theme`);
  if (applied !== theme) throw new Error(`Theme did not apply: expected ${theme}, received ${applied}`);
}

const originalTheme = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);

for (const theme of THEMES) {
  await setTheme(theme);
  const metrics = await evaluate(`(() => {
    const shell = document.querySelector(".app-shell");
    const sidebar = document.querySelector(".sidebar");
    const reading = document.querySelector(".scripture-content");
    return {
      theme: shell?.dataset.theme,
      shellBackground: getComputedStyle(shell).backgroundImage,
      sidebarBackground: getComputedStyle(sidebar).backgroundColor,
      readingBackground: getComputedStyle(reading).backgroundColor,
    };
  })()`);
  console.log(theme, metrics);
  await screenshot(`${theme}-shell`);
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await sleep(220);
  await screenshot(`${theme}-picker`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(120);
}

await setTheme("light");
await evaluate(`document.querySelector('[aria-label="Settings (5)"]')?.click()`);
await sleep(420);
await screenshot("light-settings");
await evaluate(`(() => {
  const heading = [...document.querySelectorAll(".settings-section-title")]
    .find((element) => element.textContent?.trim() === "Appearance");
  heading?.closest(".settings-section")?.scrollIntoView({ block: "start" });
})()`);
await sleep(260);
await screenshot("light-appearance");
await evaluate(`document.querySelector('[data-theme-id="glass"]')?.click()`);
await sleep(480);
await screenshot("glass-appearance");
await evaluate(`document.querySelector(".settings-page")?.scrollTo({ top: 0 })`);
await sleep(220);
await screenshot("glass-settings");
await evaluate(`document.querySelector(${JSON.stringify(`[data-theme-id="${originalTheme}"]`)})?.click()`);
await sleep(480);
await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await sleep(240);
cdp.ws.close();
console.log("restored", originalTheme);
