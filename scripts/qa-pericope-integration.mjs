/**
 * Isolated live acceptance gate for the integrated Pericope desktop slices.
 *
 * Proves the fresh-profile splash and explicit library confirmation, all six
 * persisted themes (including Onyx reload semantics), and the real local
 * trusted-resource IPC/cards without touching the user's profile or library.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

// Glass and Candlelight were never atmospheres: they are Paper and Ink with the
// translucent material on, which Rev 04 makes a material class. Driving them
// clicked a picker option that does not exist. The four real atmospheres are
// temperature crossed with luminance. See scripts/qa-support/app-vocabulary.mjs.
const THEMES = ["porcelain", "light", "dark", "onyx"];
const EXPECTED_RESOURCE_SOURCES = ["bibleproject", "the-gospel-coalition", "working-preacher"];
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    pending.set(messageId, (message) => {
      if (message.error) {
        reject(new Error(`CDP ${method} failed: ${message.error.message ?? "unknown error"}`));
        return;
      }
      resolvePromise(message);
    });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return {
    socket,
    send,
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function waitForTarget(endpoint, childState, timeout = 20_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    if (childState.exited) throw new Error(`Electron exited before CDP was ready (${childState.code}, ${childState.signal})`);
    try {
      const pages = await (await fetch(endpoint)).json();
      const target = pages.find((page) => page.type === "page" && page.title === "Pericope");
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for Pericope at ${endpoint}: ${String(lastError ?? "no page")}`);
}

function createDriver(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_500));
    }
    return response.result?.result?.value;
  };
  // Vets the gate's vocabulary before waiting, so a condition the app can
  // never satisfy fails at once instead of hanging and reading like a slow
  // app. See scripts/qa-support/app-vocabulary.mjs.
  const waitFor = async (expression, timeout = 15_000) => {
    await waitForState(evaluate, sleep, expression, timeout);
  };
  return { evaluate, waitFor };
}

async function press(cdp, key, code = key, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await sleep(100);
}

async function waitForChildExit(child, childState, timeout = 3_000) {
  if (childState.exited) return true;
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", finish);
      resolvePromise(childState.exited);
    };
    const timer = setTimeout(finish, timeout);
    child.once("exit", finish);
    if (childState.exited) finish();
  });
}

const qaRoot = mkdtempSync(join(tmpdir(), "pericope-integration-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "Library");
const port = 11_800 + Math.floor(Math.random() * 400);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = { ...process.env, LIBRARY_PATH: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;

const childState = { exited: false, code: null, signal: null };
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
);
child.once("exit", (code, signal) => {
  childState.exited = true;
  childState.code = code;
  childState.signal = signal;
});
let childLog = "";
const retainLog = (chunk) => {
  childLog = (childLog + chunk.toString()).slice(-20_000);
};
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
try {
  const target = await waitForTarget(endpoint, childState);
  assert.equal(target.title, "Pericope");
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  const networkRequests = [];
  cdp.onMessage((message) => {
    if (message.method === "Network.requestWillBeSent") {
      networkRequests.push(message.params?.request?.url ?? "");
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  await driver.waitFor(`Boolean(document.querySelector(".loading-screen"))`, 5_000);
  const splash = await driver.evaluate(`(() => ({
    title: document.querySelector(".loading-title")?.textContent?.trim(),
    mark: Boolean(document.querySelector(".loading-brand-mark svg")),
    observedAt: performance.now(),
  }))()`);
  assert.equal(splash.title, "Pericope");
  assert.equal(splash.mark, true);
  assert.equal(existsSync(libraryPath), false, "fresh profile created a library before confirmation");

  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 8_000);
  const firstRunAt = await driver.evaluate(`performance.now()`);
  assert.ok(firstRunAt >= 2_400, `first-run splash held only ${firstRunAt.toFixed(1)}ms`);
  assert.equal(existsSync(libraryPath), false, "Welcome created a library before confirmation");

  const confirmationStartedAt = await driver.evaluate(`(() => {
    const button = document.querySelector('.welcome-location-choice [data-variant="primary"]');
    if (!(button instanceof HTMLButtonElement)) return null;
    const startedAt = performance.now();
    button.click();
    return startedAt;
  })()`);
  assert.ok(typeof confirmationStartedAt === "number", "Welcome confirmation control is missing");
  await driver.waitFor(`Boolean(document.querySelector(".loading-screen"))`, 5_000);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 12_000);
  const loadedAt = await driver.evaluate(`performance.now()`);
  assert.ok(loadedAt - confirmationStartedAt >= 2_400,
    `successful-load splash held only ${(loadedAt - confirmationStartedAt).toFixed(1)}ms`);
  assert.equal(existsSync(libraryPath), true, "explicit confirmation did not create the chosen library");

  for (const theme of THEMES) {
    const current = await driver.evaluate(`document.querySelector(".app-shell")?.dataset.theme`);
    if (current !== theme) {
      await driver.evaluate(`document.querySelector("[data-instrument=theme]")?.click()`);
      await driver.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)}))`);
      await driver.evaluate(`document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)})?.click()`);
      await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
    }
    await driver.waitFor(`(async () => (await window.api.settings.get()).theme === ${JSON.stringify(theme)})()`);
    const material = await driver.evaluate(`(() => ({
      theme: document.querySelector(".app-shell")?.dataset.theme,
      dark: document.querySelector(".app-shell")?.classList.contains("dark"),
    }))()`);
    assert.equal(material.theme, theme);
    assert.equal(material.dark, theme === "dark" || theme === "onyx");
  }

  // A real reload proves persistence and the full successful-load splash.
  await driver.evaluate(`window.api.settings.set({ theme: "onyx" })`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`Boolean(document.querySelector(".loading-screen"))`, 5_000);
  const reloadStartedAt = await driver.evaluate(`performance.now()`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === "onyx"
    && Boolean(document.querySelector(".scripture-content"))`, 10_000);
  const reloadLoadedAt = await driver.evaluate(`performance.now()`);
  assert.ok(reloadLoadedAt >= 2_400 && reloadLoadedAt - reloadStartedAt >= 2_200,
    `reload splash did not preserve the minimum hold (${reloadLoadedAt.toFixed(1)}ms)`);
  assert.equal(await driver.evaluate(`document.querySelector(".app-shell")?.classList.contains("dark")`), true);

  const resourceQuery = await driver.evaluate(`window.api.trustedResources.query({
    bref: "bref:v1/ROM.8.1-ROM.8.39",
    limit: 3,
  })`);
  assert.equal(resourceQuery.ok, true, resourceQuery.refusal?.message ?? "trusted-resource query refused");
  assert.deepEqual(resourceQuery.resources.map((resource) => resource.source.id).sort(), EXPECTED_RESOURCE_SOURCES);
  assert.deepEqual(resourceQuery.resources.map((resource) => resource.record.title).sort(), [
    "Commentary on Romans 8:1-11",
    "Guide to the Book of Romans",
    "You Do Not Groan Alone",
  ]);

  await press(cdp, "k", "KeyK", 4);
  await driver.waitFor(`Boolean(document.querySelector(".command-palette-panel"))`);
  await driver.evaluate(`(() => {
    const input = document.querySelector(".command-palette-input-row input");
    if (!(input instanceof HTMLInputElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Romans 8");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await driver.waitFor(`[...document.querySelectorAll(".command-palette-result")]
    .some((row) => row.querySelector(".command-result-meta")?.textContent === "Exact reference")`, 15_000);
  await driver.evaluate(`[...document.querySelectorAll(".command-palette-result")]
    .find((row) => row.querySelector(".command-result-meta")?.textContent === "Exact reference")?.click()`);
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Romans"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "8"`, 15_000);
  await driver.waitFor(`document.querySelectorAll(".trusted-resource-card").length === 3`, 15_000);
  const cards = await driver.evaluate(`(() => ({
    featured: document.querySelectorAll(".trusted-resource-card.is-featured").length,
    compact: document.querySelectorAll(".trusted-resource-card.is-compact").length,
    sources: [...document.querySelectorAll(".trusted-resource-card")].map((card) => card.getAttribute("data-source")).sort(),
    titles: [...document.querySelectorAll(".trusted-resource-card h4")].map((title) => title.textContent?.trim()).sort(),
    buttons: [...document.querySelectorAll(".trusted-resource-card button")].map((button) => button.textContent?.trim()),
    saveControls: [...document.querySelectorAll(".trusted-resource-card button")].filter((button) => /save/i.test(button.textContent ?? "")).length,
  }))()`);
  assert.equal(cards.featured, 1);
  assert.equal(cards.compact, 2);
  assert.deepEqual(cards.sources, EXPECTED_RESOURCE_SOURCES);
  assert.deepEqual(cards.titles, resourceQuery.resources.map((resource) => resource.record.title).sort());
  assert.equal(cards.buttons.length, 3);
  assert.equal(cards.saveControls, 0);

  const resourceNetworkRequests = networkRequests.filter((url) => {
    try {
      const host = new URL(url).hostname.toLocaleLowerCase();
      return host === "www.workingpreacher.org"
        || host === "bibleproject.com"
        || host.endsWith(".bibleproject.com")
        || host === "www.thegospelcoalition.org";
    } catch {
      return false;
    }
  });
  assert.deepEqual(resourceNetworkRequests, [],
    `local manifest flow contacted a resource source at runtime: ${resourceNetworkRequests.join(", ")}`);

  console.log("PASS Pericope live acceptance", {
    firstRunSplashMs: Math.round(firstRunAt),
    successfulLoadSplashMs: Math.round(loadedAt - confirmationStartedAt),
    themes: THEMES.length,
    trustedResourceCards: cards.titles.length,
    resourceSourceNetworkRequests: resourceNetworkRequests.length,
  });
} catch (error) {
  if (childLog) console.error(childLog);
  throw error;
} finally {
  cdp?.socket.close();
  if (!childState.exited) {
    child.kill("SIGTERM");
    await waitForChildExit(child, childState);
  }
  if (childState.exited) rmSync(qaRoot, { recursive: true, force: true });
  else console.error(`Pericope integration QA data retained because Electron is still active: ${qaRoot}`);
}
