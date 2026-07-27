/**
 * Trusted-resource card tour over CDP — the Masthead · Bold group in all four
 * appearances, plus the translucent material.
 *
 * Usage (app launched with --remote-debugging-port=9222):
 *   node scripts/qa-resource-cards.mjs "Romans 8:6"
 *
 * Jumps to the passage, opens the margin's Overview, then captures the
 * trusted-resource group per theme: a margin close-up and a full window.
 * Restores the original theme and material when done.
 */

import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/resource-cards";
const passage = process.argv[2] ?? "Romans 8:6";
const THEMES = ["light", "dark", "porcelain", "onyx"];

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  return {
    send: (method, params = {}) =>
      new Promise((res) => {
        const msgId = ++id;
        pending.set(msgId, res);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      }),
  };
}

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((p) => p.title === "Pericope");
if (!app) {
  console.error("FAIL: Pericope not on :9222 (launch with --remote-debugging-port=9222)");
  process.exit(1);
}
const cdp = await connect(app.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const resp = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) throw new Error(JSON.stringify(resp.result.exceptionDetails).slice(0, 400));
  return resp.result?.result?.value;
}

async function waitFor(expression, label, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function shot(name, selector) {
  let clip;
  if (selector) {
    const rect = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.max(0, b.x - 14), y: Math.max(0, b.y - 14), width: b.width + 28, height: b.height + 28, scale: 2 };
    })()`);
    if (rect && rect.width > 40) clip = rect;
  }
  await cdp.send("Page.bringToFront");
  await sleep(clip ? 500 : 250);
  const resp = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(resp.result.data, "base64"));
  console.log("  saved", path);
}

/* ── navigate ───────────────────────────────────────────────── */

// The window holds whatever bundle it booted with; a tour run after a rebuild
// would otherwise photograph the previous build.
await cdp.send("Page.reload", { ignoreCache: true });
await waitFor(`Boolean(document.querySelector(".app-shell"))`, "the app shell after reload");
await sleep(2500);

const originalTheme = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
const originalMaterial = await evaluate(
  `document.querySelector(".app-shell")?.classList.contains("material-translucent") ? "translucent" : "solid"`,
);

// A research tab left open from a previous session owns the margin, and
// closing it returns the reading to that tab's origin passage — so close it
// before the jump, never after, or the cards answer the wrong chapter.
for (let i = 0; i < 6; i += 1) {
  const closed = await evaluate(`(() => {
    const close = document.querySelector(".entity-research-close");
    if (!close) return false;
    close.click();
    return true;
  })()`);
  if (!closed) break;
  await sleep(600);
}

await evaluate(`document.querySelector(".command-palette-trigger")?.click()`);
await waitFor(`Boolean(document.querySelector(".command-palette-input-row input"))`, "the command palette");
await evaluate(`(() => {
  const input = document.querySelector(".command-palette-input-row input");
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  set?.call(input, ${JSON.stringify(passage)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
await waitFor(`document.querySelectorAll(".command-palette-result").length > 0`, "a palette result");
await evaluate(`document.querySelector(".command-palette-result")?.click()`);
await waitFor(`document.querySelectorAll(".verse-line").length > 0`, "the chapter");
await sleep(700);

const verse = passage.match(/:(\d+)\s*$/)?.[1] ?? null;
if (verse) {
  await evaluate(`document.querySelector(${JSON.stringify(`.verse-line[data-verse="${verse}"]`)})?.click()`);
  await sleep(500);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(400);
}

await waitFor(`Boolean(document.querySelector(".trusted-resources"))`, "the trusted-resource group");
await evaluate(`document.querySelector(".trusted-resources")?.scrollIntoView({ block: "center" })`);
await sleep(500);

const cards = await evaluate(`(() => {
  return [...document.querySelectorAll(".trusted-resource-card")].map((el) => ({
    source: el.dataset.source,
    kind: el.dataset.kind,
    featured: el.classList.contains("is-featured"),
    title: el.querySelector(".trusted-resource-title")?.textContent,
  }));
})()`);
console.log("cards:", JSON.stringify(cards, null, 2));

/* ── capture ────────────────────────────────────────────────── */

async function setTheme(theme) {
  if ((await evaluate(`document.querySelector(".app-shell")?.dataset.theme`)) === theme) return;
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await sleep(350);
  await evaluate(`document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)})?.click()`);
  await sleep(500);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(600);
  await evaluate(`document.querySelector(".trusted-resources")?.scrollIntoView({ block: "center" })`);
  await sleep(400);
}

async function setMaterial(material) {
  const current = await evaluate(
    `document.querySelector(".app-shell")?.classList.contains("material-translucent") ? "translucent" : "solid"`,
  );
  if (current === material) return;
  await evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
  await sleep(350);
  // The material is a switch, not a third and fourth theme — see theme.ts.
  const toggled = await evaluate(`(() => {
    const input = document.querySelector(".material-switch input");
    if (!input) return false;
    if (input.checked !== ${material === "translucent"}) input.click();
    return true;
  })()`);
  if (!toggled) throw new Error("the material switch is not in the theme popover");
  await sleep(500);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(600);
  await evaluate(`document.querySelector(".trusted-resources")?.scrollIntoView({ block: "center" })`);
  await sleep(400);
}

async function openImprint(index) {
  await evaluate(`(() => {
    const imprints = [...document.querySelectorAll(".trusted-resource-imprint")];
    const open = document.querySelector('.trusted-resource-imprint[aria-expanded="true"]');
    if (open && open !== imprints[${index}]) open.click();
    const target = imprints[${index}];
    if (!target) return false;
    if (target.getAttribute("aria-expanded") !== "true") target.click();
    return true;
  })()`);
  await sleep(500);
  await evaluate(`document.querySelector(".trusted-resources")?.scrollIntoView({ block: "center" })`);
  await sleep(350);
  return evaluate(`document.querySelector(".trusted-resource-card")?.dataset.source ?? "none"`);
}

async function closeDrawer() {
  await evaluate(`document.querySelector('.trusted-resource-imprint[aria-expanded="true"]')?.click()`);
  await sleep(400);
  await evaluate(`document.querySelector(".trusted-resources")?.scrollIntoView({ block: "center" })`);
  await sleep(300);
}

await setMaterial("solid");
for (const theme of THEMES) {
  console.log(`theme ${theme}`);
  await setTheme(theme);
  await closeDrawer();
  await shot(`${theme}-closed`, ".trusted-resources");
  await shot(`${theme}-window`);
  for (let i = 0; i < 3; i += 1) {
    const source = await openImprint(i);
    console.log(`  opened ${i}: ${source}`);
    await shot(`${theme}-open-${i}-${source}`, ".trusted-resources");
  }
  await closeDrawer();
}

console.log("material translucent");
await setMaterial("translucent");
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await closeDrawer();
  await shot(`${theme}-translucent-closed`, ".trusted-resources");
  await openImprint(0);
  await shot(`${theme}-translucent-open`, ".trusted-resources");
}

await setMaterial(originalMaterial);
await setTheme(originalTheme);
console.log("done — restored", originalTheme, originalMaterial);
