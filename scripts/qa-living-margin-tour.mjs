/**
 * Desktop-only visual and interaction QA for the Living Margin frame.
 *
 * Requires Electron on --remote-debugging-port=9222. Exercises the deliberate
 * Chapter / In view / Selected scope model; Passage / Connections / Notes tab
 * navigation; progressive disclosure, provenance, focus recovery, preserved
 * tab choice, and all four reading atmospheres. The tour never creates,
 * removes, or recolors authored data.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/living-margin";
// Finish on Paper so the following interaction captures begin from a fully
// repainted opaque surface after the two backdrop-filter atmospheres.
const THEMES = ["dark", "glass", "dark-glass", "light"];
const THEME_NAMES = {
  light: "paper",
  dark: "ink",
  glass: "glass",
  "dark-glass": "candlelight",
};
const leaveThemeArg = process.argv.find((arg) => arg.startsWith("--leave="))?.slice("--leave=".length);
const leaveTheme = leaveThemeArg && THEMES.includes(leaveThemeArg) ? leaveThemeArg : null;
const leavePackage = process.argv.find((arg) => arg.startsWith("--leave-package="))?.slice("--leave-package=".length) ?? null;
const leavePassage = process.argv.find((arg) => arg.startsWith("--leave-passage="))?.slice("--leave-passage=".length) ?? null;

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

async function screenshot(name, selector = null) {
  let clip;
  if (selector) {
    clip = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    })()`);
    if (!clip) throw new Error(`Cannot capture missing element: ${selector}`);
  }
  await cdp.send("Page.bringToFront");
  await sleep(220);
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

async function pressEscape() {
  await pressKey("Escape", "Escape");
}

async function pressKey(key, code = key) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  await sleep(140);
}

async function selectMarginTab(tab) {
  const selector = `#margin-${tab}-tab`;
  const changed = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Margin tab not found: ${tab}`);
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-selected") === "true"`);
  await waitFor(`!document.querySelector(${JSON.stringify(`#margin-${tab}-panel`)})?.hidden`);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await sleep(180);
}

async function parkPointerOverReading() {
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  const point = await evaluate(`(() => {
    const rect = document.querySelector(".scripture-content")?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width * 0.55, y: rect.top + Math.min(160, rect.height * 0.3) } : null;
  })()`);
  if (!point) throw new Error("Reading canvas is not available for pointer parking");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await waitFor(`!document.querySelector('[role="tooltip"]')`);
  await sleep(160);
}

async function setReadingScroll(scrollTop) {
  // Real wheel/trackpad movement emits a stream of events. Two frames keep
  // this programmatic tour equivalent even if a prior scroll RAF is settling.
  for (let frame = 0; frame < 2; frame++) {
    await evaluate(`(() => {
      const content = document.querySelector(".scripture-content");
      if (!content) return;
      content.scrollTop = ${JSON.stringify(scrollTop)};
      content.dispatchEvent(new Event("scroll"));
    })()`);
    await sleep(140);
  }
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
  await sleep(240);
  await evaluate(`document.querySelectorAll(".toast-close").forEach((button) => button.click())`);
  await waitFor(`document.querySelectorAll(".toast").length === 0`);
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
  await sleep(300);
}

async function setMargin(visible) {
  const current = await evaluate(`Boolean(document.querySelector(".living-margin"))`);
  if (current === visible) return;
  await evaluate(`document.querySelector(".margin-toggle-btn")?.click()`);
  await waitFor(`Boolean(document.querySelector(".living-margin")) === ${visible}`);
  await sleep(260);
}

async function setCollapsed(collapsed) {
  const current = await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false`);
  if (current === collapsed) return;
  await evaluate(`document.querySelector(".sidebar-collapse-btn")?.click()`);
  await sleep(260);
}

async function setFocusMode(active) {
  const current = await evaluate(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === "true"`);
  if (current === active) return;
  await evaluate(`document.querySelector(".focus-btn")?.click()`);
  await waitFor(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === ${JSON.stringify(active ? "true" : "false")}`);
  await sleep(260);
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
  await sleep(360);
}

await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`);
await sleep(520);

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
}))()`);

if (await evaluate(`window.innerWidth < 1_500`)) {
  await evaluate(`window.resizeTo(1512, ${JSON.stringify(Math.max(820, originalBounds.height))})`);
  await sleep(650);
}

await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-content"))`);
await setFocusMode(false);
await setCollapsed(false);
await setMargin(true);
await setTheme("light");
await setTranslation("bsb");
await navigatePassage("Acts 19");

await setReadingScroll(0);
await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "chapter"`);
const chapterState = await evaluate(`(() => ({
  title: document.querySelector("#living-margin-title")?.textContent?.trim(),
  mode: document.querySelector(".margin-frame-mode")?.textContent?.trim(),
  view: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view"),
  done: Boolean(document.querySelector(".margin-frame-action")),
  tabs: [...document.querySelectorAll(".margin-tab")].map((tab) => tab.textContent?.trim()),
  activeTab: document.querySelector('.margin-tab[aria-selected="true"]')?.id,
}))()`);
assert.equal(chapterState.title, "Study");
assert.equal(chapterState.mode, "Chapter");
assert.equal(chapterState.view, "chapter");
assert.equal(chapterState.done, false);
assert.equal(chapterState.tabs.length, 3);
assert.match(chapterState.tabs[0] ?? "", /^Passage/);
assert.match(chapterState.tabs[1] ?? "", /^Connections/);
assert.match(chapterState.tabs[2] ?? "", /^Notes/);
assert.equal(chapterState.activeTab, "margin-passage-tab");
console.log("chapter", chapterState);
await screenshot("paper-chapter-overview");
await screenshot("paper-chapter-overview-margin", ".living-margin");

await parkPointerOverReading();
await setReadingScroll(300);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "in-view"`);
const readingState = await evaluate(`(() => ({
  mode: document.querySelector(".margin-frame-mode")?.textContent?.trim(),
  view: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view"),
  reference: document.querySelector(".margin-header-ref")?.textContent?.trim(),
  done: Boolean(document.querySelector(".margin-frame-action")),
}))()`);
assert.equal(readingState.mode, "In view");
assert.equal(readingState.view, "reading");
assert.match(readingState.reference ?? "", /^Acts 19:\d+$/);
assert.equal(readingState.done, false);
console.log("reading", readingState);
await screenshot("paper-reading-eye-line-margin", ".living-margin");

await setReadingScroll(0);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "chapter"`);
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.click()`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 1`);
await evaluate(`document.querySelector('.verse-line[data-verse="7"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 7`);
await pressEscape();
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "selected"`);
await waitFor(`Boolean(document.querySelector(".margin-quote-toggle"))`);
const selectedState = await evaluate(`(() => ({
  mode: document.querySelector(".margin-frame-mode")?.textContent?.trim(),
  view: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view"),
  reference: document.querySelector(".margin-header-ref")?.textContent?.trim(),
  done: document.querySelector(".margin-frame-action")?.textContent?.trim(),
  quoteExpanded: document.querySelector(".margin-quote-toggle")?.getAttribute("aria-expanded"),
  swatches: document.querySelectorAll(".margin-hl-swatch").length,
  activeTab: document.querySelector('.margin-tab[aria-selected="true"]')?.id,
  activePanel: document.querySelector('.margin-tab-panel:not([hidden])')?.id,
}))()`);
assert.deepEqual(selectedState, {
  mode: "Selected",
  view: "selected",
  reference: "Acts 19:1–7",
  done: "Done",
  quoteExpanded: "false",
  swatches: 5,
  activeTab: "margin-passage-tab",
  activePanel: "margin-passage-panel",
});
console.log("selected", selectedState);
await screenshot("paper-selected-context");

for (const theme of THEMES) {
  await setTheme(theme);
  await parkPointerOverReading();
  await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
  await sleep(160);
  await screenshot(`${THEME_NAMES[theme]}-selected-margin`, ".living-margin");
}

await setTheme("light");
await evaluate(`document.querySelector(".margin-quote-toggle")?.click()`);
await waitFor(`document.querySelector(".margin-quote-toggle")?.getAttribute("aria-expanded") === "true"`);
await screenshot("paper-expanded-selection-margin", ".living-margin");
await evaluate(`document.querySelector(".margin-quote-toggle")?.click()`);

await selectMarginTab("passage");
await evaluate(`document.querySelector("#margin-passage-tab")?.focus()`);
await pressKey("ArrowRight", "ArrowRight");
await waitFor(`document.activeElement?.id === "margin-connections-tab"`);
await waitFor(`document.querySelector("#margin-connections-tab")?.getAttribute("aria-selected") === "true"`);
await pressKey("ArrowRight", "ArrowRight");
await waitFor(`document.activeElement?.id === "margin-notes-tab"`);
await pressKey("Home", "Home");
await waitFor(`document.activeElement?.id === "margin-passage-tab"`);
await pressKey("End", "End");
await waitFor(`document.activeElement?.id === "margin-notes-tab"`);
console.log("margin tab keyboard path ok");

await selectMarginTab("connections");
await waitFor(`Boolean(document.querySelector(".crossref-section"))`);
await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
await screenshot("paper-connections-margin");
const crossRefTruth = await evaluate(`(() => ({
  source: document.querySelector(".crossref-attribution span:first-child")?.textContent?.trim(),
  license: document.querySelector(".crossref-attribution span:last-child")?.textContent?.trim(),
  links: document.querySelectorAll(".crossref-row").length,
  title: document.querySelector(".crossref-title")?.textContent?.trim(),
  context: document.querySelector(".crossref-context")?.textContent?.trim(),
}))()`);
assert.equal(crossRefTruth.source, "OpenBible Cross References");
assert.match(crossRefTruth.license ?? "", /CC[- ]BY/i);
assert.ok(crossRefTruth.links >= 1);
assert.equal(crossRefTruth.title, "OpenBible");
assert.equal(crossRefTruth.context, "Cross References·Across this passage");
console.log("cross references", crossRefTruth);
await evaluate(`(() => {
  const margin = document.querySelector(".living-margin");
  const section = document.querySelector(".crossref-section");
  const marginRect = margin.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  margin.scrollTop += sectionRect.top - marginRect.top - 64;
})()`);
await sleep(240);
await screenshot("paper-openbible-connections-margin", ".living-margin");

await selectMarginTab("notes");
await waitFor(`!document.querySelector(".ai-insight-loading")`, 30_000);
await waitFor(`Boolean(document.querySelector(".margin-disclosure-toggle"))`, 30_000);
await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
await screenshot("paper-notes-margin", ".living-margin");
const disclosure = await evaluate(`(() => ({
  label: document.querySelector(".margin-disclosure-title")?.textContent?.trim(),
  detail: document.querySelector(".margin-disclosure-detail")?.textContent?.trim(),
  expanded: document.querySelector(".margin-disclosure-toggle")?.getAttribute("aria-expanded"),
  insightSource: document.querySelector(".ai-insight-source")?.textContent?.trim(),
}))()`);
assert.equal(disclosure.label, "More from your notes");
assert.equal(disclosure.expanded, "false");
assert.equal(disclosure.insightSource, "From your notes");
console.log("note evidence", disclosure);
await evaluate(`document.querySelector(".margin-disclosure-toggle")?.click()`);
await waitFor(`document.querySelector(".margin-disclosure-toggle")?.getAttribute("aria-expanded") === "true"`);
await evaluate(`document.querySelector(".margin-disclosure-toggle")?.scrollIntoView({ block: "start" })`);
await sleep(260);
await screenshot("paper-note-evidence-open-margin", ".living-margin");

await evaluate(`document.querySelector(".margin-frame-action")?.click()`);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "chapter"`);
await waitFor(`document.activeElement?.id === "living-margin-title"`);
assert.equal(await evaluate(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length`), 0);
assert.equal(
  await evaluate(`document.querySelector('.margin-tab[aria-selected="true"]')?.id`),
  "margin-notes-tab",
);
await screenshot("paper-done-focus-margin", ".living-margin");

await selectMarginTab("passage");
await navigatePassage(leavePassage ?? original.passage);
await setTranslation(leavePackage ?? original.packageId);
await setMargin(original.margin);
await setCollapsed(original.collapsed);
await setTheme(leaveTheme ?? original.theme);
await setFocusMode(original.focus);
await evaluate(`window.resizeTo(${JSON.stringify(originalBounds.width)}, ${JSON.stringify(originalBounds.height)}); window.moveTo(${JSON.stringify(originalBounds.left)}, ${JSON.stringify(originalBounds.top)})`);
await sleep(420);
cdp.ws.close();
console.log("Living Margin QA PASS");
