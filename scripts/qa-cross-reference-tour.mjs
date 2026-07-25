/**
 * Self-driving desktop QA for ranked OpenBible cross-reference surfaces.
 *
 * SUPERSEDED — this tour has no subject left. Do not repair it in place; it
 * needs a decision, not a patch.
 *
 * Every surface it drives was deleted by Quire C·4. `CrossReferenceRow`,
 * `CrossRefsBlock` and `NoteCrossRefsBlock` were removed from LivingMargin,
 * and `.crossref-row` / `.crossref-section` / `.crossref-reference` /
 * `.crossref-context` / `.crossref-support` went with them — the CSS that
 * outlived the markup has since been deleted too. The cause is in C·4: a
 * connection is something the reader made, cross-references are the edition's,
 * and putting the edition's list under the word Connections made third-party
 * data wear the reader's own hand.
 *
 * The list did not go away with that tab. It is in Overview under its own
 * name, marked as the edition's — and the coverage moved with it:
 * `qa-living-margin-tour.mjs` now asserts the same three facts (the corpus,
 * its licence, and that rows are actually drawn) against
 * `.intent-overview .study-ref-row--compact` and the Sources block, in every
 * atmosphere. That tour says so in as many words at its Overview step.
 *
 * It also navigated by typing into `.passage-jump-input`, which Quire F
 * replaced with the word `Search` and the command palette.
 *
 * So the choice is to retire this file or to rewrite it as something that is
 * not a duplicate of the margin tour's Overview coverage. That is a call for
 * whoever owns the QA suite, and it wants someone who can run what they write.
 */

import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/cross-references";

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
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ws, send };
}

const pages = await (await fetch(CDP_HTTP)).json();
const page = pages.find((candidate) => candidate.title === "Pericope");
if (!page) throw new Error("Pericope is not available on :9222");
const cdp = await connect(page.webSocketDebuggerUrl);
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

async function ensureMargin() {
  const visible = await evaluate(`Boolean(document.querySelector(".living-margin"))`);
  if (!visible) {
    await evaluate(`document.querySelector("[data-instrument=margin]")?.click()`);
    await sleep(450);
  }
}

async function ensureBsb() {
  const current = await evaluate(`document.querySelector("[data-instrument=translation]")?.textContent?.trim() ?? ""`);
  if (/BSB/i.test(current)) return;
  await evaluate(`document.querySelector("[data-instrument=translation]")?.click()`);
  await sleep(250);
  await evaluate(`
    [...document.querySelectorAll(".version-picker-item")]
      .find((button) => /BSB/i.test(button.textContent))?.click()
  `);
  await sleep(650);
}

async function jump(passage) {
  await evaluate(`(() => {
    const input = document.querySelector(".passage-jump-input");
    if (!input) throw new Error("passage input missing");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(passage)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.closest("form").requestSubmit();
  })()`);
  await sleep(950);
}

async function selectVerse(verse) {
  const ok = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(`.verse-line[data-verse="${verse}"]`)});
    if (!row) return false;
    const selected = row.classList.contains("selected") || row.classList.contains("is-selected");
    if (!selected) row.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Verse ${verse} is not rendered`);
  await sleep(700);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(250);
}

async function extendSelection(verse) {
  const ok = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(`.verse-line[data-verse="${verse}"]`)});
    if (!row) return false;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Verse ${verse} is not rendered`);
  await sleep(700);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(250);
}

async function waitForRows() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const count = await evaluate(`document.querySelectorAll(".crossref-row").length`);
    if (count > 0) return count;
    await sleep(150);
  }
  throw new Error("Cross-reference rows did not render");
}

async function hoverFirstRow() {
  const rect = await evaluate(`(() => {
    const row = document.querySelector(".crossref-row");
    if (!row) return null;
    const box = row.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  if (!rect) throw new Error("No cross-reference row to hover");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await sleep(300);
}

async function scrollCrossReferencesIntoView() {
  const rect = await evaluate(`(() => {
    const element = document.querySelector(".crossref-section");
    const margin = element?.closest(".living-margin");
    if (!element || !margin) return null;
    const elementBox = element.getBoundingClientRect();
    const marginBox = margin.getBoundingClientRect();
    margin.scrollTop += elementBox.top - marginBox.top - (margin.clientHeight - elementBox.height) / 2;
    const visibleBox = element.getBoundingClientRect();
    return { top: visibleBox.top, bottom: visibleBox.bottom, height: visibleBox.height };
  })()`);
  if (!rect || rect.bottom <= 0 || rect.top >= await evaluate("window.innerHeight")) {
    throw new Error(`Cross-reference section did not enter the viewport: ${JSON.stringify(rect)}`);
  }
  await sleep(350);
}

async function capture(name, selector = ".living-margin", padding = 0) {
  const clip = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const padding = ${padding};
    return {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y - padding),
      width: Math.min(window.innerWidth - Math.max(0, box.x - padding), box.width + padding * 2),
      height: Math.min(window.innerHeight - Math.max(0, box.y - padding), box.height + padding * 2),
      scale: 1,
    };
  })()`);
  if (!clip) throw new Error(`Missing capture target: ${selector}`);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    clip,
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log(`saved ${path}`);
}

async function toggleTheme() {
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await sleep(350);
}

await ensureMargin();
await ensureBsb();
const originallyDark = await evaluate(`document.querySelector(".app-shell")?.classList.contains("dark") ?? false`);
if (originallyDark) await toggleTheme();

await jump("John 3:16");
await selectVerse(16);
const verseCount = await waitForRows();
const verseTop = await evaluate(`
  [...document.querySelectorAll(".crossref-reference")].map((element) => element.textContent.trim())
`);
if (verseCount !== 3 || verseTop[0] !== "Romans 5:8") {
  throw new Error(`Unexpected verse preview: count=${verseCount}, first=${verseTop[0]}`);
}
await scrollCrossReferencesIntoView();
await capture("john-3-16-light", ".crossref-section", 16);
await hoverFirstRow();
await capture("john-3-16-light-hover", ".crossref-section", 16);
await toggleTheme();
await scrollCrossReferencesIntoView();
await hoverFirstRow();
await capture("john-3-16-dark-hover", ".crossref-section", 16);
await toggleTheme();

// The second result is a range. Clicking it must navigate and pin both target
// verses, proving that range preservation is behavioral rather than metadata-only.
await evaluate(`document.querySelectorAll(".crossref-row")[1]?.click()`);
await sleep(850);
const rangeNavigation = await evaluate(`({
  header: document.querySelector(".margin-frame-ref")?.textContent?.trim(),
  selected: [...document.querySelectorAll(".verse-line.selected")].map((row) => row.dataset.verse),
})`);
if (!/1 John 4:9/.test(rangeNavigation.header ?? "") || rangeNavigation.selected.join(",") !== "9,10") {
  throw new Error(`Destination range was not preserved: ${JSON.stringify(rangeNavigation)}`);
}

await jump("Acts 19");
await selectVerse(1);
await extendSelection(7);
await waitForRows();
const passageState = await evaluate(`({
  context: document.querySelector(".crossref-context")?.textContent?.trim(),
  first: document.querySelector(".crossref-reference")?.textContent?.trim(),
  support: document.querySelector(".crossref-support")?.textContent?.trim(),
})`);
if (passageState.context !== "Across this passage" || passageState.first !== "Acts 8:16" || !/2 verses/.test(passageState.support ?? "")) {
  throw new Error(`Unexpected passage aggregation: ${JSON.stringify(passageState)}`);
}
await scrollCrossReferencesIntoView();
await capture("acts-19-1-7-light", ".crossref-section", 16);
await toggleTheme();
await scrollCrossReferencesIntoView();
await capture("acts-19-1-7-dark", ".crossref-section", 16);

if (!originallyDark) await toggleTheme();
cdp.ws.close();
console.log("cross-reference QA pass");
