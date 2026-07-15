/**
 * Desktop Command K interaction and visual QA.
 * Requires Electron on --remote-debugging-port=9222.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/command-palette";
const THEMES = ["light", "dark", "glass", "dark-glass"];

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

async function waitFor(expression, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return Date.now() - started;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(name) {
  await cdp.send("Page.bringToFront");
  await evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await sleep(520);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

async function press(key, code, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(100);
}

async function pressCommandK() {
  await press("k", "KeyK", 4);
  await waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
  await waitFor(`document.activeElement === document.querySelector(".command-palette-input-row input")`);
}

async function closePalette() {
  if (await evaluate(`Boolean(document.querySelector(".command-palette-panel"))`)) {
    await press("Escape", "Escape");
    await waitFor(`!document.querySelector(".command-palette-panel")`);
  }
}

async function setQuery(query) {
  await evaluate(`(() => {
    const input = document.querySelector(".command-palette-input-row input");
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  if (query.length >= 2) {
    await waitFor(`!document.querySelector(".command-palette-state") && document.querySelectorAll(".command-palette-result").length > 0`, 16_000);
  }
}

async function setTheme(theme) {
  await closePalette();
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme`);
  if (current !== theme) {
    await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)}))`);
    await evaluate(`document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)})?.click()`);
    await waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
    await sleep(280);
  }
}

await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".scripture-topbar") && document.querySelector(".command-palette-trigger"))`);
await sleep(450);

const original = await evaluate(`(() => ({
  theme: document.querySelector(".app-shell")?.dataset.theme ?? "light",
  passage: document.querySelector("#reading-chapter-title")?.textContent?.replace(/\\s+/g, " ").trim() ?? "Acts 19",
}))()`);

await setTheme("light");
await pressCommandK();
assert.equal(await evaluate(`document.activeElement === document.querySelector(".command-palette-input-row input")`), true);
assert.equal(await evaluate(`document.querySelectorAll('.command-palette-tabs [role="tab"]').length`), 4);
assert.ok(await evaluate(`document.querySelectorAll(".command-palette-result").length >= 4`));

// Input → active tab → results; arrows move tabs and result focus.
await press("Tab", "Tab");
assert.equal(await evaluate(`document.activeElement?.textContent?.trim()`), "Intelligence");
await press("ArrowRight", "ArrowRight");
assert.equal(await evaluate(`document.activeElement?.textContent?.trim()`), "Scripture");
await press("ArrowLeft", "ArrowLeft");
assert.equal(await evaluate(`document.activeElement?.textContent?.trim()`), "Intelligence");
await press("Tab", "Tab", 8);
assert.equal(await evaluate(`document.activeElement === document.querySelector(".command-palette-input-row input")`), true);

const firstSearchStart = Date.now();
await setQuery("John 3:16");
const firstSearchMs = Date.now() - firstSearchStart;
const exact = await evaluate(`(() => {
  const first = document.querySelector(".command-palette-result");
  return {
    title: first?.querySelector("strong")?.textContent,
    meta: first?.querySelector(".command-result-meta")?.textContent,
    count: document.querySelectorAll(".command-palette-result").length,
  };
})()`);
assert.equal(exact.title, "John 3:16");
assert.equal(exact.meta, "Exact reference");
console.log("first Scripture index search", { firstSearchMs, ...exact });
await screenshot("light-exact-reference");

await evaluate(`document.querySelector(".command-palette-result")?.click()`);
await waitFor(`!document.querySelector(".command-palette-panel") && document.querySelector("#reading-chapter-title")?.textContent?.includes("John")`);
await waitFor(`document.querySelector('.verse-line[data-verse="16"]')?.classList.contains("selected")`);

// A natural phrase uses lexical ranking and remains visibly labelled as such.
await pressCommandK();
await setQuery("love is patient");
await evaluate(`document.querySelector('#command-tab-scripture')?.click()`);
await waitFor(`document.querySelector(".command-palette-result strong")?.textContent?.includes("1 Corinthians 13:4")`);
assert.equal(
  await evaluate(`document.querySelector(".command-palette-result .command-result-meta")?.textContent`),
  "Phrase",
);
await screenshot("light-scripture-phrase");

// Generic roles belong in Names and may return multiple people through
// definition matching, while exact names still rank by name closeness.
await evaluate(`document.querySelector('#command-tab-names')?.click()`);
await setQuery("apostle");
assert.ok(await evaluate(`document.querySelectorAll(".command-palette-result").length >= 3`));
assert.ok(await evaluate(`[...document.querySelectorAll(".command-result-copy span")].some((node) => /apostle/i.test(node.textContent ?? ""))`));
await screenshot("light-names-apostle");

// Notes opens the chosen complete note in the existing deep-reading workspace.
await closePalette();
const noteNeedle = await evaluate(`(async () => {
  const notes = await window.api.library.readAllNotes();
  for (const note of notes) {
    const words = (note.frontmatter.title ?? "").match(/[A-Za-z]{4,}/g) ?? [];
    for (const word of words) {
      const hits = await window.api.library.search(word);
      if (hits.some((hit) => hit.id === note.frontmatter.id)) return word;
    }
  }
  return "";
})()`);
assert.ok(noteNeedle, "expected at least one searchable local note");
await pressCommandK();
await setQuery(noteNeedle);
await evaluate(`document.querySelector('#command-tab-notes')?.click()`);
await waitFor(`[...document.querySelectorAll(".command-result-meta")].some((node) => node.textContent === "Your library")`);
await screenshot("light-notes");
await evaluate(`[...document.querySelectorAll(".command-palette-result")].find((row) => row.querySelector(".command-result-meta")?.textContent === "Your library")?.click()`);
await waitFor(`Boolean(document.querySelector(".note-workspace--notes"))`);
assert.ok(await evaluate(`Boolean(document.querySelector('.note-row[aria-current="true"]'))`));
await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-topbar"))`);

// Command-like intent remains inside Intelligence rather than consuming a
// low-traffic fifth tab.
await pressCommandK();
await setQuery("settings");
assert.equal(await evaluate(`document.querySelector(".command-palette-result strong")?.textContent`), "Open Settings");
await evaluate(`document.querySelector(".command-palette-result")?.click()`);
await waitFor(`Boolean(document.querySelector(".settings-page"))`);
await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-topbar"))`);

// All four themes use the same geometry and readable token-driven material.
for (const theme of THEMES) {
  await setTheme(theme);
  await pressCommandK();
  await setQuery("Paul in Ephesus");
  const layout = await evaluate(`(() => {
    const panel = document.querySelector(".command-palette-panel");
    const rect = panel?.getBoundingClientRect();
    return {
      theme: document.querySelector(".command-palette-root")?.className,
      width: rect?.width ?? 0,
      right: rect?.right ?? 0,
      viewport: window.innerWidth,
      results: document.querySelectorAll(".command-palette-result").length,
      overflow: (panel?.scrollWidth ?? 0) > (panel?.clientWidth ?? 0),
    };
  })()`);
  assert.equal(layout.overflow, false);
  assert.ok(layout.results >= 3);
  assert.ok(layout.width <= 661 && layout.right <= layout.viewport);
  console.log(theme, layout);
  await screenshot(`${theme}-intelligence`);
}

// Restore the user's atmosphere and starting chapter.
await setTheme(original.theme);
await pressCommandK();
await setQuery(original.passage);
await evaluate(`document.querySelector(".command-palette-result")?.click()`);
await waitFor(`!document.querySelector(".command-palette-panel")`);
await sleep(260);

cdp.ws.close();
console.log("Command palette QA passed", { firstSearchMs, original });
