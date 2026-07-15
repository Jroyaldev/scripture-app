/**
 * Desktop-only interaction and visual QA for study overlays.
 *
 * Requires Electron on --remote-debugging-port=9222. Exercises language word
 * maps, Structure, highlight selection, passage-note capture, and OpenBible
 * previews in Paper/Ink/Glass/Candlelight. It never saves notes or applies,
 * recolors, or removes highlights.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/study-overlays";
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
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 900));
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(90);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function settleFiniteAnimations(selector = null) {
  await evaluate(`(() => {
    const root = ${selector == null ? "document" : `document.querySelector(${JSON.stringify(selector)})`};
    if (!root) return false;
    for (const animation of root.getAnimations({ subtree: true })) {
      const endTime = animation.effect?.getComputedTiming().endTime;
      if (!Number.isFinite(endTime)) continue;
      try { animation.finish(); } catch { /* a cancelled animation is already settled */ }
    }
    return true;
  })()`);
  await sleep(40);
}

async function screenshot(name, selectors = []) {
  let clip;
  if (selectors.length > 0) {
    clip = await evaluate(`(() => {
      const elements = ${JSON.stringify(selectors)}
        .map((selector) => document.querySelector(selector))
        .filter(Boolean);
      if (elements.length !== ${selectors.length}) return null;
      const rects = elements.map((element) => element.getBoundingClientRect());
      const pad = 22;
      const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - pad);
      const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - pad);
      const right = Math.min(window.innerWidth, Math.max(...rects.map((rect) => rect.right)) + pad);
      const bottom = Math.min(window.innerHeight, Math.max(...rects.map((rect) => rect.bottom)) + pad);
      return { x: left, y: top, width: right - left, height: bottom - top, scale: 1 };
    })()`);
    if (!clip) throw new Error(`Cannot capture missing selectors: ${selectors.join(", ")}`);
  }
  await cdp.send("Page.bringToFront");
  // Electron may be visually obscured while this remote tour runs. Chromium
  // then freezes CSS animations at frame zero, so settle finite transitions
  // before visual capture without changing any application state.
  await settleFiniteAnimations();
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

async function pressKey(key, code = key) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  await sleep(150);
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
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
  });
  await sleep(150);
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

async function setMargin(visible) {
  const current = await evaluate(`Boolean(document.querySelector(".living-margin"))`);
  if (current === visible) return;
  await evaluate(`document.querySelector(".margin-toggle-btn")?.click()`);
  await waitFor(`Boolean(document.querySelector(".living-margin")) === ${visible}`);
  await sleep(240);
}

async function setCollapsed(collapsed) {
  const current = await evaluate(`document.querySelector(".sidebar")?.classList.contains("collapsed") ?? false`);
  if (current === collapsed) return;
  await evaluate(`document.querySelector(".sidebar-collapse-btn")?.click()`);
  await sleep(240);
}

async function setFocusMode(active) {
  const current = await evaluate(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === "true"`);
  if (current === active) return;
  await evaluate(`document.querySelector(".focus-btn")?.click()`);
  await waitFor(`document.querySelector(".focus-btn")?.getAttribute("aria-pressed") === ${JSON.stringify(active ? "true" : "false")}`);
  await sleep(240);
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

async function selectVerseAndOpenToolbar() {
  await evaluate(`document.querySelector('.verse-line[data-verse="16"]')?.scrollIntoView({ block: "center" })`);
  await sleep(220);
  const toolbarVisible = `(() => {
    const toolbar = document.querySelector('.hl-toolbar-floating');
    if (!toolbar || toolbar.closest('.hl-palette-leaving')) return false;
    const rect = toolbar.getBoundingClientRect();
    return rect.width > 0;
  })()`;
  if (await evaluate(toolbarVisible)) return;
  await waitFor(`!document.querySelector('.hl-palette-leaving')`);
  // A previous overlay interaction can leave the verse selected while the
  // palette is dismissed. Normalize that toggle state before opening it.
  if (await evaluate(`document.querySelector('.verse-line[data-verse="16"]')?.getAttribute('aria-pressed') === 'true'`)) {
    await clickSelector('.verse-line[data-verse="16"]');
    await waitFor(`document.querySelector('.verse-line[data-verse="16"]')?.getAttribute('aria-pressed') === 'false'`);
  }
  await clickSelector('.verse-line[data-verse="16"]');
  await waitFor(toolbarVisible);
  await settleFiniteAnimations(".hl-toolbar-floating");
  assert.ok(
    Number.parseFloat(await evaluate(`getComputedStyle(document.querySelector('.hl-toolbar-floating')).opacity`)) > 0.9,
    "the settled highlight toolbar must be visible",
  );
  await waitFor(`document.querySelector('.verse-line[data-verse="16"]')?.getAttribute('aria-pressed') === 'true'`);
}

async function selectLovedWord() {
  await waitFor(`document.querySelector(".lang-study-verse")?.textContent?.replace(/\\s+/g, " ").trim() === "JHN 3:16"`, 15_000);
  await waitFor(`document.querySelectorAll(".lang-word").length > 0`, 15_000);
  const selected = await evaluate(`(() => {
    const words = [...document.querySelectorAll(".lang-word")];
    const word = words.find((item) => /loved|ἠγάπησεν/i.test(item.textContent ?? ""));
    if (!word) return false;
    word.click();
    return true;
  })()`);
  if (!selected) {
    const available = await evaluate(`[...document.querySelectorAll(".lang-word")].map((item) => item.textContent?.replace(/\\s+/g, " ").trim())`);
    throw new Error(`Could not select loved / ἠγάπησεν in John 3:16; available: ${JSON.stringify(available)}`);
  }
  await waitFor(`Boolean(document.querySelector(".lang-detail-form"))`, 15_000);
  await waitFor(`!document.querySelector(".lang-detail + .lang-muted")`, 15_000);
  await sleep(260);
}

async function chooseWordMap(label) {
  const picked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.lang-orbit-mode[role="tab"]')]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  if (!picked) throw new Error(`Word-map tab not found: ${label}`);
  await waitFor(`[...document.querySelectorAll('.lang-orbit-mode[role="tab"]')].some((item) => item.textContent?.trim() === ${JSON.stringify(label)} && item.getAttribute('aria-selected') === 'true')`);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await sleep(220);
}

async function scrollMarginTo(selector) {
  const moved = await evaluate(`(() => {
    const margin = document.querySelector(".living-margin");
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!margin || !target) return false;
    const marginRect = margin.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    margin.scrollTop += targetRect.top - marginRect.top - 58;
    return true;
  })()`);
  if (!moved) throw new Error(`Cannot scroll margin to ${selector}`);
  await sleep(260);
}

await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`);
await cdp.send("Page.bringToFront");
await evaluate(`window.focus()`);
await sleep(500);

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
const substrateBefore = await evaluate(`window.api.library.getSummary()`);

let failure;
try {
  if (await evaluate(`window.innerWidth < 1_440 || window.innerHeight < 820`)) {
    await evaluate(`window.resizeTo(1440, 900)`);
    await sleep(600);
  }

  await evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
  await waitFor(`Boolean(document.querySelector(".scripture-content"))`);
  await setFocusMode(false);
  await setCollapsed(false);
  await setMargin(true);
  await setTranslation("bsb");
  await navigatePassage("John 3");

  for (const theme of THEMES) {
    const name = THEME_NAMES[theme];
    await setTheme(theme);
    await clickSelector("#margin-passage-tab");
    await waitFor(`document.querySelector("#margin-passage-tab")?.getAttribute("aria-selected") === "true"`);

    await selectVerseAndOpenToolbar();
    const toolbarState = await evaluate(`(() => ({
      role: document.querySelector(".hl-toolbar-floating")?.getAttribute("role"),
      label: document.querySelector(".hl-toolbar-floating")?.getAttribute("aria-label"),
      swatches: document.querySelectorAll(".hl-toolbar-floating .hl-swatch-group button").length,
      note: document.querySelector(".hl-toolbar-floating .hl-btn-note")?.textContent?.trim(),
    }))()`);
    assert.deepEqual(toolbarState, {
      role: "toolbar",
      label: "Highlight selection",
      swatches: 5,
      note: "Add note",
    });
    await screenshot(`${name}-highlight-toolbar`, ['.verse-line[data-verse="16"]', ".hl-toolbar-floating"]);

    await clickSelector(".hl-toolbar-floating .hl-btn-note");
    await waitFor(`Boolean(document.querySelector(".note-capture-panel"))`);
    await waitFor(`document.activeElement?.classList.contains("note-capture-textarea")`);
    assert.equal(
      await evaluate(`document.querySelector(".note-capture-trust")?.textContent?.trim()`),
      "Plain Markdown · saved locally only when you choose",
    );
    await screenshot(`${name}-passage-note`);
    await clickSelector(".note-capture-cancel");
    await waitFor(`!document.querySelector(".note-capture-panel")`);

    // Opening note capture deliberately clears its source selection. Re-pin
    // the verse, then dismiss only the floating chrome so study can continue.
    await selectVerseAndOpenToolbar();
    await pressKey("Escape");
    await waitFor(`!document.querySelector(".hl-toolbar-floating")`);
    assert.equal(
      await evaluate(`document.querySelector('.verse-line[data-verse="16"]')?.getAttribute('aria-pressed')`),
      "true",
    );

    await selectLovedWord();
    await chooseWordMap("Senses");
    await scrollMarginTo(".lang-detail");

    if (theme === "light") {
      const before = await evaluate(`document.querySelector('.lang-orbit-mode[aria-selected="true"]')?.textContent?.trim()`);
      await evaluate(`document.querySelector('.lang-orbit-mode[aria-selected="true"]')?.focus()`);
      await pressKey("ArrowRight");
      const after = await evaluate(`document.querySelector('.lang-orbit-mode[aria-selected="true"]')?.textContent?.trim()`);
      assert.notEqual(after, before, "ArrowRight must change the word-map tab");
      assert.equal(
        await evaluate(`document.activeElement?.classList.contains("lang-orbit-mode") && document.activeElement?.getAttribute("aria-selected") === "true"`),
        true,
        "the newly selected word-map tab must receive focus",
      );
      await chooseWordMap("Senses");
    }

    const languageState = await evaluate(`(() => ({
      surface: document.querySelector("[data-study-surface=word-map]")?.dataset.studySurface,
      tabs: document.querySelectorAll('.lang-orbit-mode[role="tab"]').length,
      selected: document.querySelectorAll('.lang-orbit-mode[aria-selected="true"]').length,
      tabPanels: document.querySelectorAll('.lang-orbit-panel[role="tabpanel"]').length,
      topSenses: document.querySelectorAll(".lang-sense-primary").length,
    }))()`);
    assert.equal(languageState.surface, "word-map");
    assert.ok(languageState.tabs >= 2);
    assert.equal(languageState.selected, 1);
    assert.equal(languageState.tabPanels, 1);
    assert.ok(languageState.topSenses >= 1);
    await screenshot(`${name}-language-senses`, [".living-margin"]);

    await scrollMarginTo(".lang-syntax-toggle");
    await clickSelector(".lang-syntax-toggle");
    await waitFor(`Boolean(document.querySelector(".structure-modal-root"))`);
    await waitFor(`!document.querySelector(".structure-modal-loading")`, 15_000);
    const structureState = await evaluate(`(() => {
      const root = document.querySelector(".structure-modal-root");
      const panel = document.querySelector(".structure-modal-panel");
      return {
        theme: root?.classList.contains(${JSON.stringify(`theme-${theme}`)}),
        dark: root?.classList.contains("dark") ?? false,
        floating: root?.dataset.floatingLayer,
        role: panel?.getAttribute("role"),
        title: document.querySelector("#structure-modal-title")?.textContent?.trim(),
        hasResult: Boolean(document.querySelector(".lang-syntax--modal, .structure-modal-empty")),
      };
    })()`);
    assert.equal(structureState.theme, true, `Structure must mirror theme-${theme}`);
    assert.equal(structureState.dark, theme === "dark" || theme === "dark-glass");
    assert.equal(structureState.floating, "dialog");
    assert.equal(structureState.role, "dialog");
    assert.equal(structureState.title, "Sentence structure");
    assert.equal(structureState.hasResult, true);
    await screenshot(`${name}-sentence-structure`);
    await clickSelector(".structure-modal-done");
    await waitFor(`!document.querySelector(".structure-modal-root")`);

    await clickSelector("#margin-connections-tab");
    await waitFor(`document.querySelector("#margin-connections-tab")?.getAttribute("aria-selected") === "true"`);
    await waitFor(`Boolean(document.querySelector(".crossref-section"))`, 15_000);
    await scrollMarginTo(".crossref-section");
    const crossRefState = await evaluate(`(() => ({
      label: document.querySelector(".crossref-section")?.getAttribute("aria-label"),
      context: document.querySelector(".crossref-context")?.textContent?.replace(/\\s+/g, " ").trim(),
      rows: document.querySelectorAll(".crossref-row").length,
      source: document.querySelector(".crossref-attribution span:first-child")?.textContent?.trim(),
    }))()`);
    assert.equal(crossRefState.label, "OpenBible cross references");
    assert.match(crossRefState.context ?? "", /^Cross References\s*·\s*For this verse$/);
    assert.ok(crossRefState.rows >= 1);
    assert.equal(crossRefState.source, "OpenBible Cross References");
    await screenshot(`${name}-openbible-preview`, [".living-margin"]);
  }

  await setTheme("light");
  await evaluate(`window.resizeTo(900, 700)`);
  await sleep(650);
  await clickSelector("#margin-passage-tab");
  await waitFor(`document.querySelector("#margin-passage-tab")?.getAttribute("aria-selected") === "true"`);
  await selectLovedWord();
  await chooseWordMap("Senses");
  await scrollMarginTo(".lang-detail");
  const compactLanguage = await evaluate(`(() => {
    const margin = document.querySelector(".living-margin");
    return {
      viewport: [window.innerWidth, window.innerHeight],
      overflow: margin ? margin.scrollWidth - margin.clientWidth : 999,
    };
  })()`);
  assert.ok(compactLanguage.viewport[0] >= 880 && compactLanguage.viewport[0] <= 920);
  assert.ok(compactLanguage.overflow <= 1, "Study margin must not overflow horizontally at the desktop floor");
  await screenshot("paper-900x700-language-floor");

  await scrollMarginTo(".lang-syntax-toggle");
  await clickSelector(".lang-syntax-toggle");
  await waitFor(`Boolean(document.querySelector(".structure-modal-root"))`);
  await waitFor(`!document.querySelector(".structure-modal-loading")`, 15_000);
  const compactStructure = await evaluate(`(() => {
    const rect = document.querySelector(".structure-modal-panel")?.getBoundingClientRect();
    return rect ? {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    } : null;
  })()`);
  assert.ok(compactStructure);
  assert.ok(compactStructure.left >= 0 && compactStructure.top >= 0);
  assert.ok(compactStructure.right <= compactStructure.innerWidth + 1);
  assert.ok(compactStructure.bottom <= compactStructure.innerHeight + 1);
  await screenshot("paper-900x700-structure-floor");
  await clickSelector(".structure-modal-done");
  await waitFor(`!document.querySelector(".structure-modal-root")`);
} catch (error) {
  failure = error;
} finally {
  try {
    await evaluate(`document.querySelector(".note-capture-cancel")?.click(); document.querySelector(".structure-modal-done")?.click()`);
    await sleep(220);
    await evaluate(`window.resizeTo(${JSON.stringify(originalBounds.width)}, ${JSON.stringify(originalBounds.height)}); window.moveTo(${JSON.stringify(originalBounds.left)}, ${JSON.stringify(originalBounds.top)})`);
    await sleep(420);
    await setTheme(original.theme);
    await navigatePassage(original.passage);
    await setTranslation(original.packageId);
    await setMargin(original.margin);
    await setCollapsed(original.collapsed);
    await setFocusMode(original.focus);
  } catch (restoreError) {
    failure ??= restoreError;
  }
}

const substrateAfter = await evaluate(`window.api.library.getSummary()`);
assert.equal(substrateAfter?.notesFound, substrateBefore?.notesFound, "QA must not create or remove notes");
assert.equal(substrateAfter?.highlightsFound, substrateBefore?.highlightsFound, "QA must not create, recolor, or remove highlights");
cdp.ws.close();

if (failure) throw failure;
console.log("Study overlays QA PASS", {
  notes: substrateBefore?.notesFound ?? 0,
  highlights: substrateBefore?.highlightsFound ?? 0,
  themes: THEMES.length,
});
