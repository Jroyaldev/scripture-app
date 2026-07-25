/**
 * Desktop-only visual and interaction QA for the Living Margin frame.
 *
 * Requires Electron on --remote-debugging-port=9222. Exercises the deliberate
 * Chapter / In view / Selected scope model; compact Overview plus complete
 * Refs / Passage / Notes navigation; entity provenance, deep-note disclosure,
 * focus recovery, preserved tab choice, and all four reading atmospheres. The
 * tour never creates, removes, or recolors authored data.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = `http://localhost:${process.env.CDP_PORT ?? "9222"}/json/list`;
const OUT_DIR = "docs/ui-audit/living-margin";
const CAPTURE_SCREENSHOTS = !process.argv.includes("--no-screenshots");
// Finish on Paper so the following interaction captures begin from a fully
// repainted opaque surface after the two backdrop-filter atmospheres.
const THEMES = ["dark", "glass", "dark-glass", "light"];
const THEME_NAMES = {
  light: "paper",
  dark: "ink",
  glass: "glass",
  "dark-glass": "candlelight",
};
const MARKING_SELECTION_CHROME_SELECTOR = [
  '[data-floating-layer="toolbar"]',
  ".marking-radial-scrim",
  ".marking-rail-tray",
  ".marking-dock-selection",
].join(", ");
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
  if (!CAPTURE_SCREENSHOTS) return;
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

async function pressKey(key, code = key, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(140);
}

async function clickPoint(point) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(140);
}

async function clickElement(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Clickable element not found: ${selector}`);
  await clickPoint(point);
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
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
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
  const current = await evaluate(`document.querySelector("[data-instrument=translation]")?.textContent?.trim().toLowerCase().split(/\\s+/)[0]`);
  if (current === code) return;
  await clickElement("[data-instrument=translation]");
  await waitFor(`Boolean(document.querySelector(".version-picker-popover"))`);
  const optionPoint = await evaluate(`(() => {
    const option = [...document.querySelectorAll(".version-picker-item")].find((item) =>
      item.querySelector(".version-picker-code")?.textContent?.trim().toLowerCase() === ${JSON.stringify(code)}
    );
    if (!option) return null;
    const rect = option.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!optionPoint) throw new Error(`Translation option not found: ${code}`);
  await clickPoint(optionPoint);
  await waitFor(`document.querySelector("[data-instrument=translation]")?.textContent?.trim().toLowerCase().startsWith(${JSON.stringify(code)})`);
  await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
  await sleep(300);
}

async function setMargin(visible) {
  const current = await evaluate(`Boolean(document.querySelector(".living-margin"))`);
  if (current === visible) return;
  await evaluate(`document.querySelector("[data-instrument=margin]")?.click()`);
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
  const current = await evaluate(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true"`);
  if (current === active) return;
  await evaluate(`document.querySelector("[data-instrument=focus]")?.click()`);
  await waitFor(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === ${JSON.stringify(active ? "true" : "false")}`);
  await sleep(260);
}

async function navigatePassage(passage) {
  await evaluate(`document.querySelector(".command-palette-trigger")?.click()`);
  await waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
  const entered = await evaluate(`(() => {
    const input = document.querySelector(".command-palette-input-row input");
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(passage)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  if (!entered) throw new Error("Command palette query is unavailable");
  await waitFor(`[...document.querySelectorAll(".command-palette-result")].some((row) => row.querySelector(".command-result-meta")?.textContent === "Exact reference")`);
  const opened = await evaluate(`(() => {
    const row = [...document.querySelectorAll(".command-palette-result")].find((candidate) =>
      candidate.querySelector(".command-result-meta")?.textContent === "Exact reference"
    );
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (!opened) throw new Error(`Exact passage result not found: ${passage}`);
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
  focus: document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true",
  packageId: document.querySelector("[data-instrument=translation]")?.textContent?.trim().toLowerCase().split(/\\s+/)[0] ?? "bsb",
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
assert.equal(chapterState.tabs.length, 4);
assert.match(chapterState.tabs[0] ?? "", /^Overview/);
assert.match(chapterState.tabs[1] ?? "", /^Refs/);
assert.match(chapterState.tabs[2] ?? "", /^Passage/);
assert.match(chapterState.tabs[3] ?? "", /^Notes/);
assert.equal(chapterState.activeTab, "margin-overview-tab");
console.log("chapter", chapterState);
// The cross-reference tour lives here now. It used to run on the Connections
// tab against `.crossref-section` — the OpenBible source, the licence and the
// row count — which is the defect Quire C·4 exists for. The list did not go
// away with that tab: it is in Overview under its own name, marked as the
// edition's, so the same three facts are asserted against the head that says
// so and the Sources block that names the corpus.
await waitFor(
  `!document.querySelector('.intent-overview .surface-state[data-surface-state="loading"]')`,
  30_000,
);
const overviewState = await evaluate(`(() => {
  const heads = [...document.querySelectorAll(".intent-section-head")];
  const headFor = (label) => heads.find((node) => node.querySelector("h3")?.textContent?.trim() === label);
  return {
    crossRefHead: headFor("Cross-references")?.querySelector("h3")?.textContent?.trim(),
    crossRefCount: headFor("Cross-references")?.querySelector(".intent-section-count")?.textContent?.trim(),
    crossRefRows: document.querySelectorAll(".intent-overview .study-ref-row--compact").length,
    crossRefAll: [...document.querySelectorAll(".intent-overview .intent-more-toggle")]
      .map((node) => node.textContent?.trim()).join(" | "),
    entityHead: headFor("People & places")?.querySelector("h3")?.textContent?.trim(),
    entityCount: headFor("People & places")?.querySelector(".intent-section-count")?.textContent?.trim(),
    entities: document.querySelectorAll(".intent-entity-row").length,
    entityNameSize: document.querySelector(".intent-entity-name")
      ? getComputedStyle(document.querySelector(".intent-entity-name")).fontSize
      : null,
    library: document.querySelectorAll(".intent-note-lead").length,
    sourcesLast: document.querySelector(".intent-overview > :last-child")?.classList.contains("margin-sources"),
    sources: [...document.querySelectorAll(".intent-overview .margin-source-copy")]
      .map((node) => node.textContent?.replace(/\\s+/g, " ").trim()).join(" | "),
    mono: [...document.querySelectorAll(".intent-overview *")]
      .filter((node) => /mono/i.test(getComputedStyle(node).fontFamily)).length,
  };
}) ()`);
assert.equal(overviewState.crossRefHead, "Cross-references");
assert.match(overviewState.crossRefCount ?? "", /^\\d[\\d,]*\\s·\\sedition$/);
// Three rows at every scope: "a section never changes its shape because the
// scope changed size."
assert.ok(overviewState.crossRefRows > 0 && overviewState.crossRefRows <= 3);
assert.match(overviewState.crossRefAll ?? "", /All \\d/);
assert.equal(overviewState.entityHead, "People & places");
assert.match(overviewState.entityCount ?? "", /^\\d[\\d,]*\\shere$/);
assert.ok(overviewState.entities > 0 && overviewState.entities <= 4);
assert.equal(overviewState.entityNameSize, "16px");
// The edition's cross-references and TIPNR's identities are both named, in
// the same block the research pane uses, and it is the last thing drawn.
assert.equal(overviewState.sourcesLast, true);
assert.match(overviewState.sources ?? "", /OpenBible/i);
assert.match(overviewState.sources ?? "", /CC[- ]BY/i);
assert.match(overviewState.sources ?? "", /STEPBible TIPNR/);
// C4·6: no mono on this surface.
assert.equal(overviewState.mono, 0);
console.log("overview", overviewState);
await screenshot("paper-default-overview", ".living-margin");
await screenshot("paper-overview-context");
await selectMarginTab("passage");
await screenshot("paper-chapter-overview");
await screenshot("paper-chapter-overview-margin", ".living-margin");

await parkPointerOverReading();
await setReadingScroll(300);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "in-view"`);
const readingState = await evaluate(`(() => ({
  mode: document.querySelector(".margin-frame-mode")?.textContent?.trim(),
  view: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view"),
  reference: document.querySelector(".margin-frame-ref")?.textContent?.trim(),
  done: Boolean(document.querySelector(".margin-frame-verb .margin-frame-action")),
}))()`);
assert.equal(readingState.mode, "In view");
assert.equal(readingState.view, "reading");
assert.match(readingState.reference ?? "", /^Acts 19:\d+$/);
assert.equal(readingState.done, false);
console.log("reading", readingState);
await screenshot("paper-reading-eye-line-margin", ".living-margin");

await setReadingScroll(0);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "chapter"`);
// §C4·1 · the tab row must sit at exactly the same y before and after a verse
// is chosen. That is the section's whole claim — shipped, selecting a verse
// pushed the row down roughly 300px — so the tour measures it rather than
// photographing it.
const tabRowBeforeSelection = await evaluate(`document.querySelector(".margin-tabs")?.getBoundingClientRect().top ?? null`);
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.click()`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 1`);
await evaluate(`document.querySelector('.verse-line[data-verse="7"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 7`);
await waitFor(`!document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)})`);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode === "selected"`);
const tabRowAfterSelection = await evaluate(`document.querySelector(".margin-tabs")?.getBoundingClientRect().top ?? null`);
assert.equal(tabRowAfterSelection, tabRowBeforeSelection,
  "the tab row moved when a verse was chosen — §C4·1 says it never does");
const selectedState = await evaluate(`(() => ({
  mode: document.querySelector(".margin-frame-mode")?.textContent?.trim(),
  view: document.querySelector("[data-margin-view]")?.getAttribute("data-margin-view"),
  reference: document.querySelector(".margin-frame-ref")?.textContent?.trim(),
  done: document.querySelector(".margin-frame-verb .margin-frame-action")?.textContent?.trim(),
  swatches: document.querySelectorAll(".margin-hl-swatch").length,
  activeTab: document.querySelector('.margin-tab[aria-selected="true"]')?.id,
  activePanel: document.querySelector('.margin-tab-panel:not([hidden])')?.id,
}))()`);
assert.deepEqual(selectedState, {
  mode: "Selected",
  view: "selected",
  reference: "Acts 19:1–7",
  done: "Done",
  swatches: 5,
  activeTab: "margin-passage-tab",
  activePanel: "margin-passage-panel",
});
console.log("selected", selectedState);
await screenshot("paper-selected-context");

// The reading canvas owns two non-overlapping keyboard paths: Tab/Shift-Tab
// cycles study lenses without moving focus, while plain Left/Right traverses
// chapters. Arrow keys inside the tablist keep their conventional local role.
await selectMarginTab("overview");
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.focus()`);
await pressKey("Tab", "Tab");
await waitFor(`document.querySelector("#margin-connections-tab")?.getAttribute("aria-selected") === "true"`);
assert.equal(await evaluate(`document.activeElement?.getAttribute("data-verse")`), "1");
await pressKey("Tab", "Tab", 8);
await waitFor(`document.querySelector("#margin-overview-tab")?.getAttribute("aria-selected") === "true"`);
assert.equal(await evaluate(`document.activeElement?.getAttribute("data-verse")`), "1");

await pressKey("ArrowRight", "ArrowRight");
await waitFor(`(() => {
  const title = document.querySelector(".chapter-title");
  return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
    .filter(Boolean).join(" ") === "Acts 20";
})()`);
await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.focus()`);
await pressKey("ArrowLeft", "ArrowLeft");
await waitFor(`(() => {
  const title = document.querySelector(".chapter-title");
  return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
    .filter(Boolean).join(" ") === "Acts 19";
})()`);
await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
console.log("reading lens and chapter keyboard paths ok");

// Chapter traversal intentionally clears chapter-scoped study state. Restore
// the range with the same click/Shift-click contract before continuity checks.
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.click()`);
await evaluate(`document.querySelector('.verse-line[data-verse="7"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 7`);
await waitFor(`!document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)})`);

// A translation is another rendering of the same canonical passage. Preserve
// both its selected range and the eye-line anchor through text reflow.
await selectMarginTab("passage");
await evaluate(`(() => {
  const root = document.querySelector(".scripture-content");
  const row = document.querySelector('.verse-line[data-verse="7"]');
  if (!root || !row) return;
  root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight * 0.32;
  root.dispatchEvent(new Event("scroll"));
})()`);
await sleep(220);
const translationAnchor = await evaluate(`(() => {
  const root = document.querySelector(".scripture-content");
  const row = document.querySelector('.verse-line[data-verse="7"]');
  if (!root || !row) return null;
  return { offset: row.getBoundingClientRect().top - root.getBoundingClientRect().top, scrollTop: root.scrollTop };
})()`);
assert.ok(translationAnchor && translationAnchor.scrollTop > 0);
// Quire §C4·1 deleted the margin's quoted selection, so the probe for "the
// panel's copy of the text followed the translation" has nothing to read: the
// scope bar carries a reference and no wording. What the probe was really
// guarding — the canonical range and the reading anchor surviving a package
// swap — is asserted below on the canvas itself, which is where the text is.
const scopeBeforeTranslation = await evaluate(`document.querySelector(".margin-frame-ref")?.textContent?.trim() ?? ""`);
assert.equal(scopeBeforeTranslation, "Acts 19:1–7");
// Translation controls are outside the reading canvas. Their real pointer
// path must retain the canonical Study range without synthesizing marking UI.
assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)}))`), false);
await setTranslation("web");
const translatedState = await evaluate(`(() => {
  const root = document.querySelector(".scripture-content");
  const row = document.querySelector('.verse-line[data-verse="7"]');
  return {
    selected: [...document.querySelectorAll('.verse-line[aria-pressed="true"]')].map((node) => Number(node.getAttribute("data-verse"))),
    activeTab: document.querySelector('.margin-tab[aria-selected="true"]')?.id,
    offset: root && row ? row.getBoundingClientRect().top - root.getBoundingClientRect().top : null,
    scrollTop: root?.scrollTop ?? 0,
    scope: document.querySelector(".margin-frame-ref")?.textContent?.trim() ?? "",
  };
})()`);
assert.deepEqual(translatedState.selected, [1, 2, 3, 4, 5, 6, 7]);
assert.equal(translatedState.activeTab, "margin-passage-tab");
assert.ok(translatedState.scrollTop > 0);
assert.ok(Math.abs(translatedState.offset - translationAnchor.offset) < 3);
// The scope is canonical, so it is the one thing a translation change must
// not touch.
assert.equal(translatedState.scope, scopeBeforeTranslation);
await setTranslation("bsb");
assert.equal(await evaluate(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length`), 7);
console.log("translation continuity ok", { before: translationAnchor, translated: translatedState });

await selectMarginTab("overview");
await waitFor(
  `!document.querySelector('.intent-overview .surface-state[data-surface-state="loading"]')`,
  30_000,
);
await waitFor(`Boolean(document.querySelector(".intent-overview .study-ref-row--compact, .intent-note-lead, .intent-entity-row"))`);
const selectedOverview = await evaluate(`(() => ({
  crossRefRows: document.querySelectorAll(".intent-overview .study-ref-row--compact").length,
  library: document.querySelectorAll(".intent-note-lead").length,
  entities: document.querySelectorAll(".intent-entity-row").length,
}))()`);
// Narrowing to a selection narrows the numbers, never the shape.
assert.ok(selectedOverview.crossRefRows <= 3);
assert.ok(selectedOverview.entities > 0 && selectedOverview.entities <= 4);
await screenshot("paper-intent-overview");
await evaluate(`document.querySelector(".intent-entity-name")?.click()`);
await waitFor(`Boolean(document.querySelector(".entity-research-view"))`);
assert.ok(await evaluate(`document.querySelectorAll(".entity-reference-list button").length > 0`));
assert.ok(await evaluate(`[...document.querySelectorAll(".entity-research-sources span")].some((node) => /STEPBible TIPNR/.test(node.textContent ?? ""))`));
await screenshot("paper-contextual-entity-research", ".living-margin");
await evaluate(`document.querySelector(".entity-research-back")?.click()`);
await waitFor(`Boolean(document.querySelector(".margin-tabs")) && !document.querySelector(".entity-research-view")`);

for (const theme of THEMES) {
  await setTheme(theme);
  await selectMarginTab("overview");
  await parkPointerOverReading();
  await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
  await sleep(160);
  await screenshot(`${THEME_NAMES[theme]}-intent-overview-margin`, ".living-margin");
  await selectMarginTab("passage");
  await parkPointerOverReading();
  await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
  await sleep(160);
  await screenshot(`${THEME_NAMES[theme]}-selected-margin`, ".living-margin");
}

await setTheme("light");
// The "Read full selection ↓" disclosure and its expanded screenshot are gone
// with the quotation (§C4·1): there is no long state of the scope bar to
// photograph, because the bar is one fixed band in both scope modes.

await selectMarginTab("overview");
await evaluate(`document.querySelector("#margin-overview-tab")?.focus()`);
await pressKey("ArrowRight", "ArrowRight");
await waitFor(`document.activeElement?.id === "margin-connections-tab"`);
await waitFor(`document.querySelector("#margin-connections-tab")?.getAttribute("aria-selected") === "true"`);
await pressKey("ArrowRight", "ArrowRight");
await waitFor(`document.activeElement?.id === "margin-passage-tab"`);
await pressKey("ArrowRight", "ArrowRight");
await waitFor(`document.activeElement?.id === "margin-notes-tab"`);
await pressKey("Home", "Home");
await waitFor(`document.activeElement?.id === "margin-overview-tab"`);
await pressKey("End", "End");
await waitFor(`document.activeElement?.id === "margin-notes-tab"`);
console.log("margin tab keyboard path ok");

// This step used to open the Connections tab and read `.crossref-section` —
// its OpenBible source, licence, row count and title. That was the defect
// Quire C·4 exists for: "A connection in this app is a thing you made…
// Cross-references are the edition's. Putting the edition's list under the word
// Connections makes third-party data wear the reader's own hand." The
// cross-reference tour moves to Overview with the list; this tab is toured for
// what it now holds — typed, seal-marked connections with their member phrases,
// and no cross-reference of any provenance.
await selectMarginTab("connections");
await waitFor(`Boolean(document.querySelector(".margin-connections"))`);
await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
await screenshot("paper-connections-margin");
const connectionsTruth = await evaluate(`(() => ({
  label: document.querySelector(".margin-connections")?.getAttribute("aria-label"),
  head: document.querySelector(".margin-connection-head h3")?.textContent?.trim(),
  count: document.querySelector(".margin-connection-count")?.textContent?.replace(/\\s+/g, " ").trim(),
  rows: document.querySelectorAll(".margin-connection-row").length,
  types: [...document.querySelectorAll(".margin-connection-type")].map((node) => node.textContent?.trim()),
  crossRefs: document.querySelectorAll(".margin-connections .crossref-row, .margin-connections .note-crossref-row").length,
  verb: document.querySelector(".margin-connection-verb")?.textContent?.trim(),
  state: document.querySelector(".margin-connection-state")?.textContent?.trim(),
}))()`);
assert.equal(connectionsTruth.label, "Your connections");
assert.equal(connectionsTruth.head, "In this passage");
assert.match(connectionsTruth.count ?? "", /·\s*yours$/);
assert.equal(connectionsTruth.crossRefs, 0);
assert.equal(connectionsTruth.verb, "Connect a phrase");
assert.equal(connectionsTruth.state, "Threads shown");
for (const type of connectionsTruth.types) {
  assert.ok(
    ["Parallelism", "Echo", "Series", "Contrast", "Mirror", "Hinge"].includes(type),
    `unexpected connection type ${type}`,
  );
}
console.log("connections", connectionsTruth);
await evaluate(`(() => {
  const margin = document.querySelector(".living-margin");
  const section = document.querySelector(".margin-connections");
  const marginRect = margin.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  margin.scrollTop += sectionRect.top - marginRect.top - 64;
})()`);
await sleep(240);
await screenshot("paper-authored-connections-margin", ".living-margin");

await selectMarginTab("notes");
// The two spinner classes this used to wait on are gone: Rev 03b's seal
// segment is the only loading device in the language, so the wait is on the
// state itself.
await waitFor(
  `!document.querySelector('#margin-notes-panel .surface-state[data-surface-state="loading"]')`,
  30_000,
);
await waitFor(
  `Boolean(document.querySelector(".notes-deep-dive, .deep-note-card, .ai-insight-block, .margin-notes-empty"))`,
  30_000,
);
await evaluate(`document.querySelector(".living-margin").scrollTop = 0`);
await screenshot("paper-notes-margin", ".living-margin");
const notesDeepDive = await evaluate(`(() => ({
  cards: document.querySelectorAll(".deep-note-card").length,
  collapsedGate: Boolean(document.querySelector(".margin-disclosure-toggle")),
  insightSource: document.querySelector(".ai-insight-source")?.textContent?.trim(),
  // C4·6: the bordered Add note is gone and the verb is a word.
  borderedAction: document.querySelectorAll(".margin-view-action").length,
  footerVerb: document.querySelector(".margin-note-footer .margin-note-verb")?.textContent?.trim(),
  // Empty is never blank: one sentence, then the notes written elsewhere.
  emptySentences: [...document.querySelectorAll(".margin-notes-empty-sentence")]
    .map((node) => node.textContent?.trim()),
  elsewhere: document.querySelectorAll(".margin-note-elsewhere .margin-note-row").length,
}))()`);
assert.equal(notesDeepDive.collapsedGate, false);
assert.equal(notesDeepDive.borderedAction, 0);
for (const sentence of notesDeepDive.emptySentences) {
  assert.match(sentence ?? "", /^You have not written anything .*\\.$/);
}
if (notesDeepDive.cards > 0) {
  assert.equal(notesDeepDive.insightSource, "From your notes");
  assert.equal(notesDeepDive.footerVerb, "Write a note");
}
console.log("note evidence", notesDeepDive);
if (notesDeepDive.cards > 0) {
  await evaluate(`document.querySelector(".deep-note-card:not([open]) summary")?.click()`);
  await waitFor(`Boolean(document.querySelector(".deep-note-card[open] .deep-note-body"))`);
}
await evaluate(`document.querySelector(".notes-deep-dive, .deep-note-card")?.scrollIntoView({ block: "start" })`);
await sleep(260);
await screenshot("paper-notes-deep-margin", ".living-margin");

await evaluate(`document.querySelector(".margin-frame-action")?.click()`);
await waitFor(`document.querySelector(".living-margin")?.dataset.marginMode !== "selected"`);
await waitFor(`document.activeElement?.id === "living-margin-title"`);
assert.equal(await evaluate(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length`), 0);
assert.equal(
  await evaluate(`document.querySelector('.margin-tab[aria-selected="true"]')?.id`),
  "margin-notes-tab",
);
await screenshot("paper-done-focus-margin", ".living-margin");

await selectMarginTab("overview");
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
