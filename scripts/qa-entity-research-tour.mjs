/**
 * Desktop visual and interaction QA for focused Living Margin entities.
 *
 * Requires Electron on --remote-debugging-port=9222. This tour proves that a
 * Command K name result opens a reversible research object without guessing a
 * Scripture destination, renders local licensed media plus an offline map in
 * every atmosphere, distinguishes direct passage mention from broader global
 * research, and keeps Scripture references navigable in context.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const CDP_HTTP = `http://localhost:${process.env.CDP_PORT ?? "9222"}/json/list`;
const OUT_DIR = "docs/ui-audit/entity-research";
const CAPTURE_SCREENSHOTS = !process.argv.includes("--no-screenshots");
// Glass and Candlelight were never atmospheres: they are Paper and Ink with the
// translucent material on, which Rev 04 makes a material class. Driving them
// clicked a picker option that does not exist. The four real atmospheres are
// temperature crossed with luminance. See scripts/qa-support/app-vocabulary.mjs.
const THEMES = ["light", "dark", "porcelain", "onyx"];
const THEME_NAMES = {
  light: "paper",
  dark: "ink",
  porcelain: "porcelain",
  onyx: "onyx",
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
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 900));
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeout = 16_000) {
  // Vets the gate's vocabulary before waiting, so a condition the app can
  // never satisfy fails at once instead of hanging and reading like a slow
  // app. See scripts/qa-support/app-vocabulary.mjs.
  await waitForState(evaluate, sleep, expression, timeout);
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
  await evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await sleep(260);
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("saved", path);
}

async function press(key, code = key, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(120);
}

async function clickElement(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Cannot click missing element: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(140);
}

async function clickElementWithText(selector, text) {
  const point = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.replace(/\\s+/g, " ").trim() === ${JSON.stringify(text)});
    if (!element) return null;
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Cannot click ${selector} with text ${text}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(140);
}

async function setQuery(query) {
  const entered = await evaluate(`(() => {
    const input = document.querySelector(".command-palette-input-row input");
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  if (!entered) throw new Error("Command palette query input is unavailable");
  await waitFor(`!document.querySelector(".command-palette-state") && document.querySelectorAll(".command-palette-result").length > 0`);
}

async function openEntity(name, kind = null) {
  await press("k", "KeyK", 4);
  await waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
  await setQuery(name);
  await clickElement("#command-tab-names");
  await waitFor(`[...document.querySelectorAll(".command-palette-result")].some((row) =>
    row.querySelector("strong")?.textContent?.trim() === ${JSON.stringify(name)}
    && (!${JSON.stringify(kind)} || row.querySelector(".command-result-meta")?.textContent?.startsWith(${JSON.stringify(kind ?? "")}))
  )`);
  const selector = await evaluate(`(() => {
    const rows = [...document.querySelectorAll(".command-palette-result")];
    const index = rows.findIndex((row) =>
      row.querySelector("strong")?.textContent?.trim() === ${JSON.stringify(name)}
      && (!${JSON.stringify(kind)} || row.querySelector(".command-result-meta")?.textContent?.startsWith(${JSON.stringify(kind ?? "")}))
    );
    return index < 0 ? null : \`.command-palette-result:nth-child(\${index + 1})\`;
  })()`);
  if (!selector) throw new Error(`No exact entity result for ${name}`);
  await clickElement(selector);
  await waitFor(`document.querySelector(".entity-research-identity h2")?.textContent?.trim() === ${JSON.stringify(name)}`);
  await waitFor(`document.activeElement?.id === "entity-research-title"`);
}

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await waitFor(`Boolean(document.querySelector(".theme-picker-popover"))`);
  await evaluate(`document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)})?.click()`);
  await waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await sleep(720);
}

async function navigatePassage(passage) {
  await press("k", "KeyK", 4);
  await waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
  await setQuery(passage);
  await waitFor(`[...document.querySelectorAll(".command-palette-result")].some((row) => row.querySelector(".command-result-meta")?.textContent === "Exact reference")`);
  const opened = await evaluate(`(() => {
    const row = [...document.querySelectorAll(".command-palette-result")].find((candidate) =>
      candidate.querySelector(".command-result-meta")?.textContent === "Exact reference"
    );
    row?.click();
    return Boolean(row);
  })()`);
  if (!opened) throw new Error(`Cannot restore ${passage}`);
  await waitFor(`document.querySelector("#reading-chapter-title")?.textContent?.replace(/\\s+/g, " ").trim() === ${JSON.stringify(passage)}`);
  await sleep(220);
}

await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 920,
  deviceScaleFactor: 1,
  mobile: false,
});
await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".scripture-topbar") && document.querySelector(".command-palette-trigger"))`);
await sleep(460);

const original = await evaluate(`({
  theme: document.querySelector(".app-shell")?.dataset.theme ?? "light",
  passage: document.querySelector("#reading-chapter-title")?.textContent?.replace(/\\s+/g, " ").trim() ?? "Acts 19",
})`);

// A global entity search must retain the reading origin without pretending the
// entity occurs there.
await navigatePassage("Acts 1");
await openEntity("Corinth");
assert.equal(await evaluate(`document.querySelector(".entity-opening-context")?.classList.contains("is-research")`), true);
assert.match(
  await evaluate(`document.querySelector(".entity-opening-context")?.textContent?.replace(/\\s+/g, " ").trim()`),
  /From your reading\s*Acts 1\s*Broader research\s*No TIPNR-indexed mention in this chapter\./,
);
await waitFor(`(() => {
  const image = document.querySelector(".entity-photo img");
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
})()`);
await screenshot("paper-corinth-global-research-context", ".living-margin");
await press("Escape", "Escape");
await waitFor(`!document.querySelector(".entity-research-view")`);

// A selected verse that actually names Corinth earns exact, visible evidence.
await navigatePassage("Acts 18");
await clickElement('.verse-line[data-verse="1"]');
await waitFor(`document.querySelector('.verse-line[data-verse="1"]')?.getAttribute("aria-pressed") === "true"`);
await sleep(260);
const beforeCorinth = await evaluate(`document.querySelector("#reading-chapter-title")?.textContent?.replace(/\\s+/g, " ").trim()`);
await openEntity("Corinth");
const afterCorinth = await evaluate(`document.querySelector("#reading-chapter-title")?.textContent?.replace(/\\s+/g, " ").trim()`);
assert.equal(afterCorinth, beforeCorinth, "opening a place must not guess a destination verse");
assert.equal(await evaluate(`document.querySelector(".entity-opening-context")?.classList.contains("is-direct")`), true);
assert.match(
  await evaluate(`document.querySelector(".entity-opening-context")?.textContent?.replace(/\\s+/g, " ").trim()`),
  /From your reading\s*Acts 18:1\s*Indexed in this selection\s*1 direct reference.*Acts 18:1/,
);
assert.match(
  await evaluate(`document.querySelector(".entity-opening-context blockquote")?.textContent?.replace(/\\s+/g, " ").trim()`),
  /Corinth/i,
);
await waitFor(`(() => {
  const image = document.querySelector(".entity-photo img");
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
})()`);
await screenshot("paper-corinth-direct-passage-context", ".living-margin");

const corinth = await evaluate(`(() => {
  const margin = document.querySelector(".living-margin");
  const image = document.querySelector(".entity-photo img");
  return {
    mode: margin?.getAttribute("data-margin-mode"),
    imageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    imageKind: document.querySelector(".entity-photo-caption > span")?.textContent?.trim(),
    imageCaption: document.querySelector(".entity-photo-caption > strong")?.textContent?.trim(),
    imageDetails: document.querySelector(".entity-photo-provenance summary")?.textContent?.replace(/\\s+/g, " ").trim(),
    mapPaths: document.querySelectorAll(".entity-map-land path").length,
    mapLegend: document.querySelector(".entity-map-legend")?.textContent?.replace(/\\s+/g, " ").trim(),
    pleiadesTitle: document.querySelector(".entity-pleiades-lead strong")?.textContent?.trim(),
    pleiadesNames: document.querySelectorAll(".entity-pleiades-names > div > span").length,
    pleiadesConnections: document.querySelectorAll(".entity-pleiades-connections button").length,
    pleiadesBibliography: document.querySelector(".entity-pleiades-bibliography summary")?.textContent?.replace(/\\s+/g, " ").trim(),
    references: document.querySelectorAll(".entity-reference-list button").length,
    referenceLabels: [...document.querySelectorAll(".entity-reference-list button")].map((node) => node.textContent?.trim()),
    editionSummary: document.querySelector(".entity-edition-notes summary")?.textContent?.replace(/\\s+/g, " ").trim(),
    editionRows: document.querySelectorAll(".entity-edition-note-list > div").length,
    openingContext: document.querySelector(".entity-opening-context")?.textContent?.replace(/\\s+/g, " ").trim(),
    sources: [...document.querySelectorAll(".entity-research-sources span")].map((node) => node.textContent),
    horizontalOverflow: (margin?.scrollWidth ?? 0) > (margin?.clientWidth ?? 0),
  };
})()`);
console.log("Corinth rendered state", corinth);
assert.equal(corinth.mode, "research");
assert.equal(corinth.imageLoaded, true);
assert.equal(corinth.imageKind, "Proposed site view");
assert.equal(corinth.imageCaption, "ruins at Corinth");
assert.match(corinth.imageDetails ?? "", /Image details.*Davide Mauro.*CC-BY-SA-4\.0/);
assert.ok(corinth.mapPaths > 0);
assert.match(corinth.mapLegend ?? "", /OpenBible/);
assert.equal(corinth.pleiadesTitle, "Corinthus/Korinthos");
assert.ok(corinth.pleiadesNames >= 4);
assert.ok(corinth.pleiadesConnections >= 4);
assert.match(corinth.pleiadesBibliography ?? "", /Ancient sources & bibliography/);
assert.ok(corinth.references >= 8);
assert.ok(!corinth.referenceLabels.some((label) => /Romans 16:27/.test(label ?? "")));
assert.match(corinth.editionSummary ?? "", /KJV edition notes.*3 subscriptions/);
assert.equal(corinth.editionRows, 3);
assert.match(corinth.openingContext ?? "", /Acts 18:1.*Indexed in this selection/);
assert.ok(corinth.sources.some((source) => /OpenBible.*CC BY 4\.0/.test(source ?? "")));
assert.ok(corinth.sources.some((source) => /Natural Earth.*Public domain/.test(source ?? "")));
assert.ok(corinth.sources.some((source) => /Pleiades 4\.1.*CC BY 3\.0/.test(source ?? "")));
assert.equal(corinth.horizontalOverflow, false);

for (const theme of THEMES) {
  await setTheme(theme);
  await evaluate(`document.querySelector("#entity-research-title")?.focus()`);
  await evaluate(`document.querySelector(".living-margin")?.scrollTo({ top: 0 })`);
  await screenshot(`${THEME_NAMES[theme]}-corinth-context`);
  await screenshot(`${THEME_NAMES[theme]}-corinth-research`, ".living-margin");
  await evaluate(`document.querySelector("#entity-ancient-record-title")?.scrollIntoView({ block: "start" })`);
  await screenshot(`${THEME_NAMES[theme]}-corinth-ancient-record`, ".living-margin");
}

await setTheme("light");
await evaluate(`document.querySelector(".living-margin")?.scrollTo({ top: 0 })`);
await evaluate(`document.querySelector(".entity-photo-provenance summary")?.click()`);
await waitFor(`document.querySelector(".entity-photo-provenance")?.hasAttribute("open") === true`);
assert.equal(await evaluate(`document.querySelectorAll(".entity-photo-provenance dt").length`), 4);
assert.equal(await evaluate(`document.querySelectorAll(".entity-photo-provenance button").length`), 2);
await screenshot("paper-corinth-image-provenance", ".living-margin");
await evaluate(`document.querySelector(".entity-photo-provenance summary")?.click()`);
await evaluate(`document.querySelector("#entity-ancient-record-title")?.scrollIntoView({ block: "start" })`);
await evaluate(`document.querySelector(".entity-pleiades-bibliography summary")?.click()`);
await waitFor(`document.querySelector(".entity-pleiades-bibliography")?.hasAttribute("open") === true`);
assert.ok(await evaluate(`document.querySelectorAll(".entity-pleiades-bibliography p").length >= 8`));
await screenshot("paper-corinth-ancient-bibliography", ".living-margin");
await evaluate(`document.querySelector(".entity-pleiades-bibliography summary")?.click()`);
const editionNotesOpened = await evaluate(`(() => {
  const details = document.querySelector(".entity-edition-notes");
  const summary = details?.querySelector("summary");
  if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) return false;
  summary.scrollIntoView({ block: "center" });
  summary.click();
  return details.open;
})()`);
assert.equal(editionNotesOpened, true);
await waitFor(`document.querySelector(".entity-edition-notes")?.hasAttribute("open") === true`);
await screenshot("paper-corinth-kjv-edition-notes", ".living-margin");
await evaluate(`document.querySelector(".entity-edition-notes summary")?.click()`);
await clickElementWithText(".entity-reference-list button", "Acts 18:1");
await waitFor(`document.querySelector("#reading-chapter-title")?.textContent?.includes("Acts 18")`);
await waitFor(`document.querySelector('.verse-line[data-verse="1"]')?.getAttribute("aria-pressed") === "true"`);
assert.equal(await evaluate(`document.querySelector(".entity-research-identity h2")?.textContent`), "Corinth");
await screenshot("paper-corinth-reference-opened");

// A later verse reference should not leave the reading canvas parked at the
// chapter heading. The selected row lands near the reader's eye-line while
// entity research remains open and keyboard focus stays with its ref button.
await clickElementWithText(".entity-reference-list button", "2 Corinthians 6:11");
await waitFor(`document.querySelector("#reading-chapter-title")?.textContent?.includes("2 Corinthians 6")`);
await waitFor(`document.querySelector('.verse-line[data-verse="11"]')?.getAttribute("aria-pressed") === "true"`);
await waitFor(`(() => {
  const root = document.querySelector(".scripture-content");
  const row = document.querySelector('.verse-line[data-verse="11"]');
  if (!(root instanceof HTMLElement) || !(row instanceof HTMLElement)) return false;
  const rootRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return root.scrollTop > 0
    && rowRect.top >= rootRect.top
    && rowRect.top <= rootRect.top + rootRect.height * 0.45;
})()`);
assert.equal(await evaluate(`document.querySelector(".entity-research-identity h2")?.textContent`), "Corinth");
assert.equal(await evaluate(`document.activeElement?.closest(".entity-reference-list") != null`), true);
await screenshot("paper-corinth-late-reference-scrolled");

await openEntity("Capernaum");
assert.ok(await evaluate(`document.querySelectorAll(".entity-map-alternatives circle").length >= 1`));
assert.equal(await evaluate(`document.querySelectorAll(".entity-location-alternatives > div").length`), 1);
await screenshot("paper-capernaum-alternative-location", ".living-margin");

await openEntity("Great Sea", "Place");
assert.match(
  await evaluate(`document.querySelector(".entity-coordinate-comparison")?.textContent?.replace(/\\s+/g, " ").trim()`),
  /broad place.*representative points 1,858 km apart/,
);
assert.equal(await evaluate(`document.querySelector(".entity-coordinate-comparison")?.classList.contains("is-broad")`), true);
await screenshot("paper-great-sea-source-divergence", ".living-margin");

await openEntity("Abel", "Place");
assert.equal(await evaluate(`Boolean(document.querySelector(".entity-minimap"))`), false);
assert.match(
  await evaluate(`document.querySelector(".entity-location-unmapped")?.textContent?.replace(/\\s+/g, " ").trim()`),
  /Not mapped.*rather than inventing a location/,
);
await screenshot("paper-abel-unmapped-place", ".living-margin");

for (const imageCase of [
  { name: "Achaia", kind: "Geographic context", file: "paper-achaia-geographic-context" },
  { name: "Ahava", kind: "Associated artifact", file: "paper-ahava-associated-artifact" },
  { name: "Golgotha", kind: "Later reception", file: "paper-golgotha-later-reception" },
]) {
  await openEntity(imageCase.name);
  await waitFor(`document.querySelector(".entity-photo-caption > span")?.textContent?.trim() === ${JSON.stringify(imageCase.kind)}`);
  assert.equal(await evaluate(`Boolean(document.querySelector(".entity-photo-provenance"))`), true);
  await screenshot(imageCase.file, ".living-margin");
}

await openEntity("Aaron");
const aaron = await evaluate(`(() => {
  const margin = document.querySelector(".living-margin");
  return {
    role: document.querySelector(".entity-person-facts strong")?.textContent?.trim(),
    facts: document.querySelector(".entity-person-facts")?.textContent?.replace(/\\s+/g, " ").trim(),
    relationshipRows: document.querySelectorAll(".entity-relationship-row").length,
    relationshipLinks: document.querySelectorAll(".entity-relationship-links button").length,
    footprintBooks: document.querySelectorAll(".entity-footprint-books button").length,
    hasPortrait: Boolean(document.querySelector(".entity-person-portrait")),
    horizontalOverflow: (margin?.scrollWidth ?? 0) > (margin?.clientWidth ?? 0),
  };
})()`);
assert.equal(aaron.role, "High Priest");
assert.match(aaron.facts ?? "", /Egypt and Wilderness/);
assert.match(aaron.facts ?? "", /Tribe of Levi/);
assert.equal(aaron.relationshipRows, 4);
assert.equal(aaron.relationshipLinks, 9);
assert.ok(aaron.footprintBooks >= 1);
assert.equal(aaron.hasPortrait, false);
assert.equal(aaron.horizontalOverflow, false);

for (const theme of THEMES) {
  await setTheme(theme);
  await evaluate(`document.querySelector(".living-margin")?.scrollTo({ top: 0 })`);
  await screenshot(`${THEME_NAMES[theme]}-aaron-person-research`, ".living-margin");
  await evaluate(`document.querySelector("#entity-scripture-title")?.scrollIntoView({ block: "center" })`);
  await screenshot(`${THEME_NAMES[theme]}-aaron-scripture-footprint`, ".living-margin");
}

await setTheme("light");
await evaluate(`document.querySelector(".living-margin")?.scrollTo({ top: 0 })`);
await clickElementWithText(".entity-relationship-links button", "Moses");
await waitFor(`document.querySelector(".entity-research-identity h2")?.textContent?.trim() === "Moses"`);
await waitFor(`document.activeElement?.id === "entity-research-title"`);
assert.match(
  await evaluate(`document.querySelector(".entity-person-facts")?.textContent?.replace(/\\s+/g, " ").trim()`),
  /Egypt and Wilderness/,
);
assert.equal(await evaluate(`document.querySelector(".entity-research-back span:last-child")?.textContent?.trim()`), "Aaron");
await clickElement(".entity-research-back");
await waitFor(`document.querySelector(".entity-research-identity h2")?.textContent?.trim() === "Aaron"`);
assert.equal(await evaluate(`Boolean(document.querySelector(".entity-research-forward"))`), true);
await clickElement(".entity-research-forward");
await waitFor(`document.querySelector(".entity-research-identity h2")?.textContent?.trim() === "Moses"`);

await openEntity("David");
const david = await evaluate(`(() => ({
  total: document.querySelector(".entity-person-relationships .entity-research-section-head > span")?.textContent?.trim(),
  visibleLinks: document.querySelectorAll(".entity-relationship-links button:not(.entity-relationship-more)").length,
  disclosures: document.querySelectorAll(".entity-relationship-more").length,
  horizontalOverflow: (document.querySelector(".living-margin")?.scrollWidth ?? 0)
    > (document.querySelector(".living-margin")?.clientWidth ?? 0),
}))()`);
assert.equal(david.total, "41 named");
assert.ok(david.visibleLinks <= 24);
assert.ok(david.disclosures >= 1);
assert.equal(david.horizontalOverflow, false);
await screenshot("paper-david-dense-relationships", ".living-margin");

await openEntity("Paul");
assert.equal(await evaluate(`Boolean(document.querySelector(".entity-person-portrait"))`), false);
assert.equal(await evaluate(`Boolean(document.querySelector(".entity-minimap"))`), false);
assert.equal(await evaluate(`Boolean(document.querySelector(".entity-person-relationships"))`), false);
assert.equal(await evaluate(`document.querySelector(".entity-person-facts strong")?.textContent?.trim()`), "Apostle");
assert.ok(await evaluate(`document.querySelectorAll(".entity-footprint-books button").length >= 1`));
assert.ok(await evaluate(`document.querySelectorAll(".entity-reference-list button").length >= 12`));
await setTheme("dark");
await evaluate(`document.querySelector("#entity-research-title")?.focus()`);
await screenshot("ink-paul-research", ".living-margin");

const paletteWasOpen = await evaluate(`Boolean(document.querySelector(".command-palette-panel"))`);
await press("Escape", "Escape");
if (paletteWasOpen) {
  await waitFor(`!document.querySelector(".command-palette-panel")`);
  await press("Escape", "Escape");
}
await waitFor(`!document.querySelector(".entity-research-view") && Boolean(document.querySelector(".margin-tabs"))`);
assert.equal(await evaluate(`Boolean(document.querySelector(".living-margin"))`), true);

await setTheme(original.theme);
await navigatePassage(original.passage);
await cdp.send("Emulation.clearDeviceMetricsOverride");
cdp.ws.close();
console.log("entity research QA complete", { corinth, aaron, david, restored: original });
