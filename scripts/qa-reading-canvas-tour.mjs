/**
 * Desktop-only visual and interaction QA for the Scripture reading canvas.
 *
 * Requires Electron on --remote-debugging-port=9222. Exercises the semantic
 * chapter landmark, verse rhythm, hover/focus/selection, source highlights,
 * all four atmospheres, focus mode, chapter-end continuation, and the
 * supported 900px desktop width with the optional Living Margin hidden.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/reading-canvas";
// Glass and Candlelight were never atmospheres: they are Paper and Ink with the
// translucent material on, which Rev 04 makes a material class. Driving them
// clicked a picker option that does not exist. The four real atmospheres are
// temperature crossed with luminance. See scripts/qa-support/app-vocabulary.mjs.
const THEMES = ["light", "dark", "porcelain", "onyx"];
const THEME_CAPTURE_NAMES = {
  light: "paper-reading",
  dark: "ink-reading",
  porcelain: "porcelain-reading",
  onyx: "onyx-reading",
};
const MARKING_SELECTION_CHROME_SELECTOR = [
  '[data-floating-layer="toolbar"]',
  ".marking-radial-scrim",
  ".marking-rail-tray",
  ".marking-dock-selection",
].join(", ");
const leaveThemeArg = process.argv.find((arg) => arg.startsWith("--leave="))?.slice("--leave=".length);
const leaveTheme = leaveThemeArg && THEMES.includes(leaveThemeArg) ? leaveThemeArg : null;
const leavePackageArg = process.argv.find((arg) => arg.startsWith("--leave-package="))?.slice("--leave-package=".length);
const leavePackage = leavePackageArg || null;
const leavePassageArg = process.argv.find((arg) => arg.startsWith("--leave-passage="))?.slice("--leave-passage=".length);
const leavePassage = leavePassageArg || null;

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
  // Vets the gate's vocabulary before waiting, so a condition the app can
  // never satisfy fails at once instead of hanging and reading like a slow
  // app. See scripts/qa-support/app-vocabulary.mjs.
  await waitForState(evaluate, sleep, expression, timeout);
}

async function screenshot(name) {
  await cdp.send("Page.bringToFront");
  await sleep(220);
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (response.result?.data) break;
    await sleep(320);
  }
  if (!response?.result?.data) {
    throw new Error(`Could not capture ${name}: ${JSON.stringify(response?.error ?? response)}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

async function pressKey(key, code = key, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(160);
}

async function pressEscape() {
  await pressKey("Escape", "Escape");
}

async function moveTo(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 24) };
  })()`);
  if (!point) throw new Error(`Cannot hover missing element: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await sleep(180);
}

async function dragText(selector, startOffset = 1, endOffset = 24) {
  const points = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let length = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.length) continue;
      nodes.push({ node, start: length, end: length + node.textContent.length });
      length += node.textContent.length;
    }
    if (length < 2) return null;
    const locate = (rawOffset) => {
      const offset = Math.max(0, Math.min(length - 1, rawOffset));
      const entry = nodes.find((candidate) => offset < candidate.end) ?? nodes.at(-1);
      return entry ? { node: entry.node, offset: offset - entry.start } : null;
    };
    const pointAt = (rawOffset, edge) => {
      const position = locate(rawOffset);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.node, position.offset);
      range.setEnd(position.node, Math.min(position.node.textContent.length, position.offset + 1));
      const rect = [...range.getClientRects()].find((candidate) => candidate.width > 0 && candidate.height > 0);
      if (!rect) return null;
      return {
        x: edge === "end" ? rect.right - Math.min(1, rect.width / 3) : rect.left + Math.min(1, rect.width / 3),
        y: rect.top + rect.height / 2,
      };
    };
    const start = pointAt(${JSON.stringify(startOffset)}, "start");
    const end = pointAt(Math.max(${JSON.stringify(startOffset + 1)}, Math.min(length - 1, ${JSON.stringify(endOffset)})), "end");
    return start && end ? { start, end } : null;
  })()`);
  if (!points) throw new Error(`Cannot drag missing or empty text: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.start.x, y: points.start.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: points.start.x, y: points.start.y, button: "left", buttons: 1, clickCount: 1,
  });
  for (let step = 1; step <= 6; step++) {
    const progress = step / 6;
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: points.start.x + (points.end.x - points.start.x) * progress,
      y: points.start.y + (points.end.y - points.start.y) * progress,
      button: "left",
      buttons: 1,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: points.end.x, y: points.end.y, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(220);
}

async function parkPointer() {
  const point = await evaluate(`({ x: Math.round(window.innerWidth * 0.72), y: Math.round(window.innerHeight * 0.82) })`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await sleep(100);
}

async function blurActiveElement() {
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await sleep(80);
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
  await sleep(260);
}

async function setTranslation(code) {
  const current = await evaluate(`document.querySelector("[data-instrument=translation]")?.textContent?.trim().toLowerCase().split(/\\s+/)[0]`);
  if (current === code) return;
  await evaluate(`document.querySelector("[data-instrument=translation]")?.click()`);
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
  await waitFor(`document.querySelector("[data-instrument=translation]")?.textContent?.trim().toLowerCase().startsWith(${JSON.stringify(code)})`);
  await sleep(320);
}

async function setMargin(visible) {
  const current = await evaluate(`document.querySelector("[data-instrument=margin]")?.getAttribute("aria-pressed") === "true"`);
  if (current === visible) return;
  await evaluate(`document.querySelector("[data-instrument=margin]")?.click()`);
  await sleep(360);
  assert.equal(
    await evaluate(`Boolean(document.querySelector(".living-margin"))`),
    visible,
  );
}

async function setCollapsed(collapsed) {
  const current = await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false`);
  if (current === collapsed) return;
  await evaluate(`document.querySelector(".sidebar-collapse-btn")?.click()`);
  await sleep(300);
}

async function setFocusMode(active) {
  const current = await evaluate(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === "true"`);
  if (current === active) return;
  await evaluate(`document.querySelector("[data-instrument=focus]")?.click()`);
  await waitFor(`document.querySelector("[data-instrument=focus]")?.getAttribute("aria-pressed") === ${JSON.stringify(active ? "true" : "false")}`);
  await sleep(260);
}

async function navigatePassage(passage) {
  const parsed = /^(.*) (\d+)$/.exec(passage);
  if (!parsed) throw new Error(`Cannot navigate picker to ${passage}`);
  const [, bookName, chapterText] = parsed;
  const alreadyThere = await evaluate(`(() => {
    const title = document.querySelector(".chapter-title");
    return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
      .filter(Boolean).join(" ") === ${JSON.stringify(passage)};
  })()`);
  if (alreadyThere) return;

  await evaluate(`document.querySelector(".passage-picker-btn")?.click()`);
  await waitFor(`Boolean(document.querySelector(".passage-picker-popover"))`);
  await evaluate(`document.querySelector(".picker-title-action")?.click()`);
  await waitFor(`Boolean(document.querySelector(".book-grid"))`);
  const bookSelected = await evaluate(`(() => {
    const button = [...document.querySelectorAll(".book-grid-item")].find((item) =>
      item.textContent?.trim() === ${JSON.stringify(bookName)}
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!bookSelected) throw new Error(`Book picker entry not found: ${bookName}`);
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(`[aria-label="Go to ${bookName} ${chapterText}"]`)}))`);
  await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Go to ${bookName} ${chapterText}"]`)})?.click()`);
  await waitFor(`(() => {
    const title = document.querySelector(".chapter-title");
    return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
      .filter(Boolean).join(" ") === ${JSON.stringify(passage)};
  })()`);
  await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
  await sleep(320);
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
const fullDesktopBounds = { ...originalBounds, width: Math.max(1_512, originalBounds.width) };
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

if (await evaluate(`window.innerWidth < 1_200`)) {
  await evaluate(`window.resizeTo(${JSON.stringify(fullDesktopBounds.width)}, ${JSON.stringify(fullDesktopBounds.height)})`);
  await sleep(700);
  assert.ok(await evaluate(`window.innerWidth >= 1_200`), "could not establish full desktop capture width");
}

await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await waitFor(`Boolean(document.querySelector(".scripture-content"))`);
await setFocusMode(false);
await setCollapsed(false);
await setMargin(true);
await setTheme("light");
await setTranslation("web");
await blurActiveElement();
await navigatePassage("Acts 19");
await blurActiveElement();
await parkPointer();

const structure = await evaluate(`(() => {
  const article = document.querySelector("article.scripture-inner");
  const title = document.querySelector("h1.chapter-title");
  const verse = document.querySelector(".verse-line");
  const text = document.querySelector(".verse-text-span");
  const footer = document.querySelector(".chapter-end");
  const titleStyle = title ? getComputedStyle(title) : null;
  const verseStyle = verse ? getComputedStyle(verse) : null;
  const textStyle = text ? getComputedStyle(text) : null;
  return {
    articleLabelledBy: article?.getAttribute("aria-labelledby"),
    titleTag: title?.tagName,
    titleSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0,
    verseDisplay: verseStyle?.display,
    verseColumns: verseStyle?.gridTemplateColumns,
    readingFont: textStyle?.fontFamily,
    themeTags: document.querySelectorAll(".theme-tag-row").length,
    verseCount: document.querySelectorAll(".verse-line").length,
    highlightCount: document.querySelectorAll(".hl-blob").length,
    footer: Boolean(footer),
  };
})()`);
assert.equal(structure.articleLabelledBy, "reading-chapter-title");
assert.equal(structure.titleTag, "H1");
assert.ok(structure.titleSize >= 36, `chapter landmark is too small: ${structure.titleSize}`);
assert.equal(structure.verseDisplay, "grid");
assert.match(structure.readingFont ?? "", /Source Serif/);
assert.equal(structure.themeTags, 0);
assert.ok(structure.verseCount >= 20);
assert.equal(structure.footer, true);
console.log("structure", structure);
await screenshot("paper-default");

await moveTo('.verse-line[data-verse="3"]');
const hover = await evaluate(`(() => {
  const verse = document.querySelector('.verse-line[data-verse="3"]');
  const style = verse ? getComputedStyle(verse) : null;
  return { hovered: verse?.matches(":hover") ?? false, background: style?.backgroundColor };
})()`);
assert.equal(hover.hovered, true);
assert.notEqual(hover.background, "rgba(0, 0, 0, 0)");
await screenshot("paper-hover");

await parkPointer();
await evaluate(`document.querySelector('.verse-line[data-verse="1"]')?.focus()`);
await pressKey("ArrowDown", "ArrowDown");
assert.equal(await evaluate(`document.activeElement?.getAttribute("data-verse")`), "2");
// The rail eases from 0 to 18px; let that intentional micro-motion settle
// before checking the final visual state rather than sampling mid-transition.
await sleep(120);
const focusStyle = await evaluate(`(() => {
  const element = document.activeElement;
  const style = getComputedStyle(element);
  const rail = getComputedStyle(element, "::before");
  return { outline: style.outlineStyle, shadow: style.boxShadow, railHeight: Number.parseFloat(rail.height) };
})()`);
assert.equal(focusStyle.outline, "none");
assert.equal(focusStyle.shadow, "none");
assert.ok(focusStyle.railHeight >= 17.9);
await screenshot("paper-keyboard-focus");

await blurActiveElement();
await evaluate(`(() => {
  const start = document.querySelector('.verse-line[data-verse="2"]');
  const end = document.querySelector('.verse-line[data-verse="4"]');
  start?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  end?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
})()`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 3`);
await waitFor(`!document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)})`);
assert.deepEqual(
  await evaluate(`[...document.querySelectorAll('.verse-line[aria-pressed="true"]')].map((row) => row.getAttribute("data-verse"))`),
  ["2", "3", "4"],
);
await screenshot("paper-range-selection");
await evaluate(`document.querySelector('.verse-line[data-verse="2"]')?.click()`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 1`);
await evaluate(`document.querySelector('.verse-line[data-verse="2"]')?.click()`);
await waitFor(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length === 1`);
assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)}))`), false);

// Native text dragging, not a verse click, owns marking intent. Exercise the
// real CDP pointer path so a programmatic Selection cannot mask regressions in
// mouseup/click arbitration.
await dragText('.verse-line[data-verse="2"] .verse-text-span');
await waitFor(`Boolean(document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)}))`);
assert.equal(await evaluate(`window.getSelection()?.isCollapsed`), false);
assert.equal(await evaluate(`document.querySelectorAll('.verse-line[aria-pressed="true"]').length`), 0);
await screenshot("paper-drag-marking");
await pressEscape();
await waitFor(`!document.querySelector(${JSON.stringify(MARKING_SELECTION_CHROME_SELECTOR)})`, 2_000);

for (const theme of THEMES) {
  await setTheme(theme);
  await blurActiveElement();
  await parkPointer();
  await screenshot(THEME_CAPTURE_NAMES[theme]);
  const material = await evaluate(`(() => {
    const canvas = document.querySelector(".scripture-content");
    const title = document.querySelector(".chapter-title");
    return {
      theme: document.querySelector(".app-shell")?.dataset.theme,
      canvas: canvas ? getComputedStyle(canvas).backgroundColor : null,
      title: title ? getComputedStyle(title).color : null,
    };
  })()`);
  assert.equal(material.theme, theme);
  console.log(theme, material);
}

await setTheme("light");
await blurActiveElement();
await setFocusMode(true);
assert.equal(await evaluate(`Boolean(document.querySelector(".sidebar"))`), false);
assert.equal(await evaluate(`Boolean(document.querySelector(".living-margin"))`), false);
assert.ok(await evaluate(`document.querySelector(".scripture-inner")?.getBoundingClientRect().width >= 650`));
await screenshot("paper-focus-mode");
await setFocusMode(false);
await waitFor(`Boolean(document.querySelector(".sidebar"))`);

await evaluate(`(() => {
  const content = document.querySelector(".scripture-content");
  content.scrollTop = content.scrollHeight;
  content.dispatchEvent(new Event("scroll"));
})()`);
await waitFor(`document.querySelector(".chapter-end")?.getBoundingClientRect().bottom <= window.innerHeight`);
await screenshot("paper-chapter-end");
await evaluate(`document.querySelector(".chapter-continue")?.click()`);
await waitFor(`(() => {
  const title = document.querySelector(".chapter-title");
  return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
    .filter(Boolean).join(" ") === "Acts 20";
})()`);
await waitFor(`document.querySelectorAll(".verse-line").length > 0`);
assert.equal(await evaluate(`document.activeElement?.id`), "reading-chapter-title");
assert.ok(await evaluate(`document.querySelector(".scripture-content")?.scrollTop < 2`));
await screenshot("paper-continued-chapter");
await evaluate(`document.querySelector('[aria-label="Previous chapter"]')?.click()`);
await waitFor(`(() => {
  const title = document.querySelector(".chapter-title");
  return [title?.querySelector(".book-name")?.textContent, title?.querySelector(".chapter-number")?.textContent]
    .filter(Boolean).join(" ") === "Acts 19";
})()`);
await waitFor(`document.querySelectorAll(".verse-line").length > 0`);

await setMargin(false);
await evaluate(`window.resizeTo(900, 700)`);
await sleep(700);
const compact = await evaluate(`(() => {
  const canvas = document.querySelector(".scripture-content")?.getBoundingClientRect();
  const inner = document.querySelector(".scripture-inner")?.getBoundingClientRect();
  const text = document.querySelector(".verse-text-span")?.getBoundingClientRect();
  return {
    viewport: window.innerWidth,
    canvasWidth: canvas?.width ?? 0,
    innerWidth: inner?.width ?? 0,
    textWidth: text?.width ?? 0,
    margin: Boolean(document.querySelector(".living-margin")),
  };
})()`);
assert.ok(compact.viewport <= 900);
assert.equal(compact.margin, false);
assert.ok(compact.innerWidth >= 560, `reading measure collapsed at 900px: ${JSON.stringify(compact)}`);
assert.ok(compact.textWidth >= 500, `verse measure collapsed at 900px: ${JSON.stringify(compact)}`);
console.log("compact", compact);
await screenshot("paper-900-margin-hidden");

await evaluate(`window.resizeTo(${JSON.stringify(fullDesktopBounds.width)}, ${JSON.stringify(fullDesktopBounds.height)}); window.moveTo(${JSON.stringify(fullDesktopBounds.left)}, ${JSON.stringify(fullDesktopBounds.top)})`);
await sleep(700);
assert.ok(await evaluate(`window.innerWidth >= 1_200`), "could not restore full desktop width");

await navigatePassage(leavePassage ?? original.passage);
await setTranslation(leavePackage ?? original.packageId);
await setMargin(original.margin);
await setCollapsed(original.collapsed);
await setTheme(leaveTheme ?? original.theme);
await setFocusMode(original.focus);
await blurActiveElement();
await parkPointer();
cdp.ws.close();
console.log(leaveTheme ? "left theme" : "restored", leaveTheme ?? original);
