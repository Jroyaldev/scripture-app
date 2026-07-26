/**
 * Desktop-only visual and interaction QA for Settings, first run, and import.
 *
 * Requires the primary Electron app on --remote-debugging-port=9222. The tour
 * captures each Settings domain in all four atmospheres, verifies section and
 * segmented-control keyboard behavior, then launches an isolated temporary
 * Electron profile to capture the real first-run screen without touching the
 * user's library. Theme and reading preferences are restored before exit.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const PRIMARY_CDP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/setup";
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
const SECTIONS = ["Library", "Reading", "Intelligence", "Import", "About"];
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

async function appTarget(endpoint) {
  const pages = await (await fetch(endpoint)).json();
  return pages.find((page) => page.title === "Pericope");
}

async function waitForTarget(endpoint, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const target = await appTarget(endpoint);
      if (target) return target;
    } catch {
      // The isolated Electron process may still be opening its debug socket.
    }
    await sleep(140);
  }
  throw new Error(`Timed out waiting for Pericope at ${endpoint}`);
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

  // Vets the gate's vocabulary before waiting, so a condition the app can
  // never satisfy fails at once instead of hanging and reading like a slow
  // app. See scripts/qa-support/app-vocabulary.mjs.
  const waitFor = async (expression, timeout = 8_000) => {
    await waitForState(evaluate, sleep, expression, timeout);
  };

  const screenshot = async (name) => {
    await cdp.send("Page.bringToFront");
    const viewport = await evaluate(`({ width: window.innerWidth, height: window.innerHeight })`);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.max(1, viewport.width - 36),
      y: Math.max(1, viewport.height - 36),
    });
    await sleep(180);
    const response = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (!response.result?.data) throw new Error(`Could not capture ${name}`);
    mkdirSync(OUT_DIR, { recursive: true });
    const path = `${OUT_DIR}/${name}.png`;
    writeFileSync(path, Buffer.from(response.result.data, "base64"));
    console.log("saved", path);
  };

  return { evaluate, screenshot, waitFor };
}

async function clickSection(driver, label) {
  const clicked = await driver.evaluate(`(() => {
    const button = [...document.querySelectorAll(".settings-rail button")]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `missing Settings section ${label}`);
  await driver.waitFor(`document.querySelector(".settings-rail button.active")?.textContent?.trim() === ${JSON.stringify(label)}`);
  await sleep(520);
}

async function setTheme(driver, theme) {
  const current = await driver.evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  const changed = await driver.evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  assert.equal(changed, true, `missing theme ${theme}`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
  await sleep(280);
}

const primaryTarget = await waitForTarget(PRIMARY_CDP);
const primaryCdp = await connect(primaryTarget.webSocketDebuggerUrl);
const primary = createDriver(primaryCdp);

await primaryCdp.send("Page.reload", { ignoreCache: true });
await primary.waitFor(`Boolean(document.querySelector('[aria-label="Settings (5)"]'))`);
const originalTheme = await primary.evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
await primary.evaluate(`document.querySelector('[aria-label="Settings (5)"]')?.click()`);
await primary.waitFor(`Boolean(document.querySelector(".settings-page"))`);

const structure = await primary.evaluate(`(() => ({
  title: document.querySelector(".settings-hero h1")?.textContent?.trim(),
  sections: [...document.querySelectorAll(".settings-rail button")].map((button) => button.textContent?.trim()),
  packages: [...document.querySelectorAll(".settings-package-code")].map((item) => item.textContent?.trim()),
  alerts: document.querySelectorAll('[role="alert"]').length,
  inlineStyles: document.querySelectorAll('.settings-page [style]').length,
  switches: document.querySelectorAll('.settings-page [role="switch"]').length,
}) )()`);
assert.equal(structure.title, "Settings");
assert.deepEqual(structure.sections, SECTIONS);
assert.deepEqual(structure.packages, ["BSB", "WEB", "KJV", "YLT", "AKJV"]);
assert.equal(structure.alerts, 0);
assert.equal(structure.inlineStyles, 0);
assert.equal(structure.switches, 1);

for (const theme of THEMES) {
  await setTheme(primary, theme);
  for (const section of SECTIONS) {
    await clickSection(primary, section);
    await primary.screenshot(`${THEME_NAMES[theme]}-${section.toLowerCase()}`);
  }
}

await clickSection(primary, "Reading");
// Driven through "Reading text size" rather than the "Reading measure" row
// this used to use. That row is gone: it wrote a class no stylesheet read, and
// reading size is what moves the measure now. The keyboard behaviour under
// test is the segmented control's, so any live segment proves it.
const originalMeasure = await primary.evaluate(`document.querySelector('[aria-label="Reading text size"] [aria-checked="true"]')?.getAttribute("data-value")`);
assert.ok(originalMeasure);
await primary.evaluate(`document.querySelector('[aria-label="Reading text size"] [aria-checked="true"]')?.focus()`);
await primaryCdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
await primaryCdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
await sleep(180);
const movedMeasure = await primary.evaluate(`document.querySelector('[aria-label="Reading text size"] [aria-checked="true"]')?.getAttribute("data-value")`);
assert.notEqual(movedMeasure, originalMeasure, "Reading text size did not respond to ArrowRight");
await primary.screenshot("keyboard-reading-measure");
await primary.evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Reading text size"] [data-value="${originalMeasure}"]`)})?.click()`);
await primary.evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await sleep(180);

await setTheme(primary, "light");
await primaryCdp.send("Emulation.setDeviceMetricsOverride", {
  width: 900,
  height: 700,
  deviceScaleFactor: 1,
  mobile: false,
});
await clickSection(primary, "Library");
const floorMetrics = await primary.evaluate(`(() => ({
  viewport: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  railBottom: document.querySelector(".settings-rail")?.getBoundingClientRect().bottom,
  frameWidth: document.querySelector(".settings-frame")?.getBoundingClientRect().width,
}))()`);
assert.equal(floorMetrics.viewport, 900);
assert.ok(floorMetrics.documentWidth <= floorMetrics.viewport, "Settings overflowed the 900px desktop floor");
assert.ok(floorMetrics.railBottom < 150, "Settings section rail did not compact at the desktop floor");
await primary.screenshot("desktop-floor-library");
await clickSection(primary, "Reading");
await primary.screenshot("desktop-floor-reading");
await primaryCdp.send("Emulation.clearDeviceMetricsOverride");
await sleep(160);

await setTheme(primary, originalTheme);
await primary.evaluate(`document.querySelector('[aria-label="Read (1)"]')?.click()`);
await sleep(220);
primaryCdp.ws.close();

// Launch first run against an isolated profile and an empty temporary path.
const qaRoot = mkdtempSync(join(tmpdir(), "scripture-setup-qa-"));
const userData = join(qaRoot, "user-data");
const emptyLibrary = join(qaRoot, "ScriptureLibrary");
const onboardingPort = 9300 + Math.floor(Math.random() * 300);
const onboardingEndpoint = `http://localhost:${onboardingPort}/json/list`;
const env = { ...process.env, LIBRARY_PATH: emptyLibrary };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${onboardingPort}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: "ignore" },
);

try {
  const onboardingTarget = await waitForTarget(onboardingEndpoint);
  const onboardingCdp = await connect(onboardingTarget.webSocketDebuggerUrl);
  const onboarding = createDriver(onboardingCdp);
  await onboarding.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);

  const welcome = await onboarding.evaluate(`(() => ({
    title: document.querySelector(".welcome-title")?.textContent?.trim(),
    promises: [...document.querySelectorAll(".welcome-trust-grid strong")].map((item) => item.textContent?.trim()),
    path: document.querySelector(".welcome-location-choice code")?.textContent?.trim(),
    primary: document.querySelector('.welcome-location-choice [data-variant="primary"]')?.textContent?.trim(),
    alerts: document.querySelectorAll('[role="alert"]').length,
    inlineStyles: document.querySelectorAll('.welcome-screen [style]').length,
  }))()`);
  assert.equal(welcome.title, "Your study library stays yours.");
  assert.deepEqual(welcome.promises, ["Plain files", "Local by default", "Move anytime"]);
  assert.equal(welcome.path, emptyLibrary);
  assert.equal(welcome.primary, "Use recommended folder");
  assert.equal(welcome.alerts, 0);
  assert.equal(welcome.inlineStyles, 0);

  for (const theme of THEMES) {
    await onboarding.evaluate(`(() => {
      const shell = document.querySelector(".app-shell");
      if (!shell) return false;
      shell.classList.remove("theme-light", "theme-dark", "theme-porcelain", "theme-onyx", "dark");
      shell.classList.add(${JSON.stringify(`theme-${theme}`)});
      if (${JSON.stringify(theme === "dark" || theme === "onyx")}) shell.classList.add("dark");
      shell.dataset.theme = ${JSON.stringify(theme)};
      return true;
    })()`);
    await sleep(240);
    await onboarding.screenshot(`${THEME_NAMES[theme]}-first-run`);
  }
  onboardingCdp.ws.close();
} finally {
  child.kill("SIGTERM");
  await sleep(400);
  rmSync(qaRoot, { recursive: true, force: true });
}

console.log("setup QA passed and restored", { originalTheme, originalMeasure });
