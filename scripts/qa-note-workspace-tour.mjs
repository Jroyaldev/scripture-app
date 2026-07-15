/**
 * Desktop-only visual and interaction QA for Write, Notes, and Search.
 *
 * Requires the Electron app on --remote-debugging-port=9222. The tour never
 * saves a note: it exercises an in-memory draft, note selection, keyboard
 * movement, and full-text retrieval; captures all four atmospheres and the
 * 900px desktop floor; then restores theme, draft, and the Read view.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_ENDPOINT = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/note-workspace";
const THEMES = ["light", "dark", "glass", "dark-glass"];
const THEME_NAMES = {
  light: "paper",
  dark: "ink",
  glass: "glass",
  "dark-glass": "candlelight",
};
const DRAFT_TITLE = "The Spirit and faithful ministry";
const DRAFT_BODY = "The Spirit is not an accessory to the church’s life. Luke’s language keeps divine agency at the center of faithful ministry.";
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

function createDriver(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 900));
    }
    return response.result?.result?.value;
  };

  const waitFor = async (expression, timeout = 8_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(80);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };

  const screenshot = async (name) => {
    await cdp.send("Page.bringToFront");
    const viewport = await evaluate(`({ width: window.innerWidth, height: window.innerHeight })`);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.max(1, viewport.width - 24),
      y: Math.max(1, viewport.height - 24),
    });
    await sleep(140);
    const response = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    assert.ok(response.result?.data, `Could not capture ${name}`);
    mkdirSync(OUT_DIR, { recursive: true });
    const path = `${OUT_DIR}/${name}.png`;
    writeFileSync(path, Buffer.from(response.result.data, "base64"));
    console.log("saved", path);
  };

  return { evaluate, screenshot, waitFor };
}

const pages = await (await fetch(CDP_ENDPOINT)).json();
const page = pages.find((candidate) => candidate.title === "Scripture Library");
assert.ok(page, "Scripture Library Electron target was not found on port 9222");
const cdp = await connect(page.webSocketDebuggerUrl);
const driver = createDriver(cdp);

await cdp.send("Page.reload", { ignoreCache: true });
await driver.waitFor(`Boolean(document.querySelector('[aria-label="Write (2)"]'))`);

const originalTheme = await driver.evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
const noteCountBefore = await driver.evaluate(`window.api.library.readAllNotes().then((notes) => notes.length)`);

async function setView(label, shortcut, selector) {
  const clicked = await driver.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(`[aria-label="${label} (${shortcut})"]`)});
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing ${label} navigation`);
  await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await sleep(180);
}

async function setTheme(theme) {
  const current = await driver.evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await setView("Settings", 5, ".settings-page");
  const changed = await driver.evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!(option instanceof HTMLElement)) return false;
    option.click();
    return true;
  })()`);
  assert.equal(changed, true, `Missing theme ${theme}`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
  await sleep(220);
}

async function setInput(selector, value) {
  const changed = await driver.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return false;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Could not fill ${selector}`);
  await sleep(80);
}

async function openRichNote() {
  const opened = await driver.evaluate(`(() => {
    const row = [...document.querySelectorAll(".note-row")]
      .find((candidate) => candidate.querySelector("strong")?.textContent?.trim() === "Acts 19 — Disciples at Ephesus");
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    row.scrollIntoView({ block: "center" });
    return true;
  })()`);
  assert.equal(opened, true, "Expected the seeded Acts 19 note for detail QA");
  await driver.waitFor(`document.querySelector(".note-detail h2")?.textContent?.includes("Acts 19")`);
  await sleep(120);
}

async function openSpiritSearch() {
  await setView("Search", 4, ".note-workspace--search");
  await setInput('[aria-label="Search note content"]', "Spirit");
  await driver.waitFor(`document.querySelector(".note-workspace-count")?.textContent?.includes("result")`);
  await driver.waitFor(`document.querySelectorAll(".note-row").length > 0`);
  const firstTitle = await driver.evaluate(`document.querySelector(".note-row strong")?.textContent?.trim()`);
  assert.ok(firstTitle, "Search results did not expose a title");
  const detailTitle = await driver.evaluate(`document.querySelector(".note-detail h2")?.textContent?.trim()`);
  assert.equal(detailTitle, firstTitle, "Search did not open its leading match in the shared detail surface");
}

const structure = await driver.evaluate(`(() => ({
  alerts: document.querySelectorAll('[role="alert"]').length,
  inlineStyles: document.querySelectorAll('.writing-workspace [style], .note-workspace [style]').length,
  oldFtsCopy: document.body.textContent?.includes("FTS5") ?? false,
}))()`);
assert.equal(structure.alerts, 0);
assert.equal(structure.inlineStyles, 0);
assert.equal(structure.oldFtsCopy, false);

await setView("Write", 2, ".writing-workspace");
await setInput("#note-title", DRAFT_TITLE);
await setInput("#note-body", DRAFT_BODY);
await setView("Notes", 3, ".note-workspace--notes");
await driver.waitFor(`document.querySelectorAll(".note-row").length > 1`);
await setInput('[aria-label="Filter notes"]', "Acts 19 — Disciples");
await driver.waitFor(`document.querySelectorAll(".note-row").length === 1`);
assert.equal(
  await driver.evaluate(`document.querySelector(".note-detail h2")?.textContent?.trim()`),
  "Acts 19 — Disciples at Ephesus",
  "Filtering did not keep list selection and detail in agreement",
);
await setInput('[aria-label="Filter notes"]', "");
await driver.waitFor(`document.querySelectorAll(".note-row").length > 1`);
await setView("Write", 2, ".writing-workspace");
const persistedDraft = await driver.evaluate(`({
  title: document.querySelector("#note-title")?.value,
  body: document.querySelector("#note-body")?.value,
})`);
assert.deepEqual(persistedDraft, { title: DRAFT_TITLE, body: DRAFT_BODY }, "Draft did not survive navigation");
await driver.screenshot("draft-persistence");

await setView("Notes", 3, ".note-workspace--notes");
await openRichNote();
const selectedBefore = await driver.evaluate(`document.querySelector(".note-row.selected")?.getAttribute("data-note-id")`);
await driver.evaluate(`document.querySelector(".note-row.selected")?.focus()`);
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown" });
await sleep(100);
const selectedAfter = await driver.evaluate(`document.querySelector(".note-row.selected")?.getAttribute("data-note-id")`);
assert.notEqual(selectedAfter, selectedBefore, "ArrowDown did not move note selection");
await driver.screenshot("keyboard-note-list");

for (const theme of THEMES) {
  await setTheme(theme);
  await setView("Write", 2, ".writing-workspace");
  await driver.screenshot(`${THEME_NAMES[theme]}-write`);

  await setView("Notes", 3, ".note-workspace--notes");
  await openRichNote();
  await driver.screenshot(`${THEME_NAMES[theme]}-notes`);

  await openSpiritSearch();
  await driver.screenshot(`${THEME_NAMES[theme]}-search`);
}

await setTheme("light");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 900,
  height: 700,
  deviceScaleFactor: 1,
  mobile: false,
});

await setView("Write", 2, ".writing-workspace");
let floor = await driver.evaluate(`({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })`);
assert.equal(floor.viewport, 900);
assert.ok(floor.documentWidth <= floor.viewport, "Write overflowed the 900px desktop floor");
await driver.screenshot("desktop-floor-write");

await setView("Notes", 3, ".note-workspace--notes");
await openRichNote();
floor = await driver.evaluate(`(() => ({
  viewport: innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  listWidth: document.querySelector(".note-workspace-list")?.getBoundingClientRect().width,
  detailWidth: document.querySelector(".note-detail")?.getBoundingClientRect().width,
}))()`);
assert.ok(floor.documentWidth <= floor.viewport, "Notes overflowed the 900px desktop floor");
assert.ok(floor.listWidth >= 200 && floor.detailWidth >= 340, "Notes lost a usable list/detail split at 900px");
await driver.screenshot("desktop-floor-notes");

await openSpiritSearch();
floor = await driver.evaluate(`({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })`);
assert.ok(floor.documentWidth <= floor.viewport, "Search overflowed the 900px desktop floor");
await driver.screenshot("desktop-floor-search");
await cdp.send("Emulation.clearDeviceMetricsOverride");

await setView("Write", 2, ".writing-workspace");
await setInput("#note-title", "");
await setInput("#note-body", "");
await setTheme(originalTheme);
await setView("Read", 1, ".scripture-page");

const noteCountAfter = await driver.evaluate(`window.api.library.readAllNotes().then((notes) => notes.length)`);
assert.equal(noteCountAfter, noteCountBefore, "QA must not create or remove authored notes");
cdp.ws.close();

console.log("note workspace QA passed and restored", {
  originalTheme,
  noteCount: noteCountBefore,
});
