/**
 * Six-theme visual and computed-style gate for the V2 Study workspace rail.
 *
 * The Electron profile and library are isolated. Every theme receives the
 * same persisted fixture; screenshots remain in memory until every visual,
 * geometry, hit-target, forced-colors, and reduced-motion assertion passes.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import electronPath from "electron";
import {
  ATMOSPHERES,
  ATMOSPHERE_LABELS,
  RETIRED_ATMOSPHERE_MATERIALS,
  waitForState,
} from "./qa-support/app-vocabulary.mjs";

// Six rows, but not six atmospheres. Writing the retired Glass id into settings
// no longer produces a `theme-glass` shell — main.ts migrates the legacy id into
// (light, translucent) — so the wait below on `.theme-glass` could never come
// true and this tour hung at its third capture. Glass and Candlelight were the
// material, so the material is the axis: the four appearances solid, then the
// two the retired ids actually named.
//
// Derived, never hand-listed. This tour and tests/study-workspace-qa-contract
// once kept separate copies of the theme list and drifted apart, which is the
// same asymmetry that let the tours rot: only the test half ever runs. Both
// now read the one exported constant.
const THEMES = [
  ...ATMOSPHERES.map((id) => ({
    id,
    material: "solid",
    label: ATMOSPHERE_LABELS[id],
    file: `${ATMOSPHERE_LABELS[id]}.png`,
  })),
  ...RETIRED_ATMOSPHERE_MATERIALS.map(({ id, material }) => ({
    id,
    material,
    label: `${ATMOSPHERE_LABELS[id]}-${material}`,
    file: `${ATMOSPHERE_LABELS[id]}-${material}.png`,
  })),
];
const OUTPUT_DIR = resolve("output/playwright/study-workspace-bar");
const VIEWPORT = { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false };
const ZOOM_VIEWPORT = { width: 590, height: 450, deviceScaleFactor: 1, mobile: false };
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function availablePort() {
  const server = createServer();
  server.unref();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a workspace-bar QA port");
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening workspace-bar CDP")), 15_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Workspace-bar CDP socket failed"));
    };
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = message.id ? pending.get(message.id) : null;
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message);
  };
  const send = (method, params = {}, timeout = 20_000) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => {
      pending.delete(messageId);
      reject(new Error(`Timed out waiting for CDP ${method}`));
    }, timeout);
    pending.set(messageId, { resolve: resolvePromise, reject, timer });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { socket, send };
}

async function waitForTarget(endpoint, childState, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (childState.spawnError) throw new Error(`Electron spawn failed: ${childState.spawnError}`);
    if (childState.exited) throw new Error(`Electron exited before CDP was ready (${childState.code})`);
    try {
      const pages = await (await fetch(endpoint, { signal: AbortSignal.timeout(1_000) })).json();
      const page = pages.find((candidate) => candidate.type === "page" && candidate.title === "Pericope");
      if (page) return page;
    } catch {
      // The isolated desktop shell is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${endpoint}`);
}

function createDriver(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 2_000));
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

async function dispatchKey(cdp, key, code, virtualKeyCode, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

async function terminateChild(child, childState) {
  if (childState.exited) return;
  let exitPromise = once(child, "exit").catch(() => undefined);
  child.kill("SIGTERM");
  await Promise.race([exitPromise, sleep(2_000)]);
  if (childState.exited) return;
  exitPromise = once(child, "exit").catch(() => undefined);
  child.kill("SIGKILL");
  await Promise.race([exitPromise, sleep(2_000)]);
  if (!childState.exited) throw new Error("Workspace-bar QA Electron process did not terminate");
}

function passageView(book, chapter, packageId, verse, seed) {
  return {
    book,
    chapter,
    packageId,
    verse,
    verseOffset: seed,
    scrollTop: seed * 4,
    margin: {
      activeTab: seed % 2 === 0 ? "overview" : "passage",
      scope: null,
      scrollTopByTab: { overview: seed, connections: seed + 2, passage: seed + 4, notes: seed + 6 },
      wordsVerse: verse,
      wordsFollowingReading: seed % 2 === 0,
    },
  };
}

function session(current) {
  return { current, history: { back: [], forward: [] } };
}

function entityTab({ id, groupId, entity, displayName, origin, returnPassageTabId, nonce }) {
  return {
    kind: "entity",
    id,
    groupId,
    entityId: entity.id,
    entityKind: entity.kind,
    origin,
    originRange: { start: 1, end: Math.max(1, origin.verse ?? 1) },
    canvas: session(origin),
    returnPassageTabId,
    trail: [{ id: entity.id, displayName, kind: entity.kind }],
    scrollTop: nonce,
    nonce,
  };
}

function buildFixture(entities) {
  const actsBsb = passageView("ACT", 19, "bsb", 20, 2);
  const actsKjv = passageView("ACT", 19, "kjv", 8, 3);
  const john = passageView("JHN", 3, "bsb", 16, 4);
  const romans = passageView("ROM", 6, "bsb", 4, 5);
  const activeLongLabel = "Priscilla — patient teacher, fellow worker, and house-church shepherd";
  const tabsById = {
    "acts-19-bsb": {
      kind: "passage", id: "acts-19-bsb", groupId: "named-expanded-study", session: session(actsBsb),
    },
    "acts-19-kjv": {
      kind: "passage", id: "acts-19-kjv", groupId: "named-expanded-study", session: session(actsKjv),
    },
    "john-3-bsb": {
      kind: "passage", id: "john-3-bsb", groupId: "named-expanded-study", session: session(john),
    },
    "apollos-person": entityTab({
      id: "apollos-person",
      groupId: "named-expanded-study",
      entity: entities.apollos,
      displayName: "Apollos",
      origin: actsBsb,
      returnPassageTabId: "acts-19-bsb",
      nonce: 11,
    }),
    "ephesus-place": entityTab({
      id: "ephesus-place",
      groupId: "named-expanded-study",
      entity: entities.ephesus,
      displayName: "Ephesus",
      origin: actsBsb,
      returnPassageTabId: "acts-19-bsb",
      nonce: 12,
    }),
    "active-entity": entityTab({
      id: "active-entity",
      groupId: "named-expanded-study",
      entity: entities.priscilla,
      displayName: activeLongLabel,
      origin: actsBsb,
      returnPassageTabId: "acts-19-bsb",
      nonce: 13,
    }),
    "romans-6-bsb": {
      kind: "passage", id: "romans-6-bsb", groupId: "collapsed-study", session: session(romans),
    },
    "collapsed-priscilla": entityTab({
      id: "collapsed-priscilla",
      groupId: "collapsed-study",
      entity: entities.priscilla,
      displayName: "Priscilla",
      origin: romans,
      returnPassageTabId: "romans-6-bsb",
      nonce: 14,
    }),
  };
  const recentlyClosed = [{
    kind: "tab",
    index: 3,
    tab: entityTab({
      id: "recently-closed-apollos",
      groupId: "named-expanded-study",
      entity: entities.apollos,
      displayName: "Apollos follow-up",
      origin: actsBsb,
      returnPassageTabId: "acts-19-bsb",
      nonce: 15,
    }),
  }];
  return {
    version: 2,
    groups: [
      {
        id: "named-expanded-study",
        homePassageTabId: "acts-19-bsb",
        tabIds: ["acts-19-bsb", "acts-19-kjv", "john-3-bsb", "apollos-person", "ephesus-place", "active-entity"],
        lastActiveTabId: "active-entity",
        collapsed: false,
        label: { kind: "custom", value: "Pastoral Teaching Lab" },
      },
      {
        id: "collapsed-study",
        homePassageTabId: "romans-6-bsb",
        tabIds: ["romans-6-bsb", "collapsed-priscilla"],
        lastActiveTabId: "collapsed-priscilla",
        collapsed: true,
        label: { kind: "custom", value: "Romans Baptism Cohort" },
      },
    ],
    tabsById,
    activeTabId: "active-entity",
    activationOrder: [
      "acts-19-kjv",
      "john-3-bsb",
      "apollos-person",
      "ephesus-place",
      "romans-6-bsb",
      "collapsed-priscilla",
      "acts-19-bsb",
      "active-entity",
    ],
    recentlyClosed,
  };
}

function normalMetricsExpression(themeId, hitTarget, keyboardFocusMetrics) {
  return `(() => {
    const parseColor = (value) => {
      const parts = value.match(/[\\d.]+/g)?.map(Number) ?? [];
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    const splitTopLevel = (value) => {
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] === "(") depth += 1;
        if (value[index] === ")") depth = Math.max(0, depth - 1);
        if (value[index] === "," && depth === 0) {
          parts.push(value.slice(start, index).trim());
          start = index + 1;
        }
      }
      parts.push(value.slice(start).trim());
      return parts.filter(Boolean);
    };
    const composite = (foreground, background) => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return channel(color.r) * 0.2126 + channel(color.g) * 0.7152 + channel(color.b) * 0.0722;
    };
    const contrastRatio = (foreground, background) => {
      const foregroundLum = luminance(composite(foreground, background));
      const backgroundLum = luminance(background);
      return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
    };
    const bar = document.querySelector("[data-study-workspace-bar]");
    const active = document.querySelector('[data-study-tab-id="active-entity"]');
    const inactive = document.querySelector('[data-study-tab-id="acts-19-bsb"]');
    const popover = document.querySelector(".scripture-workspace-overflow-popover");
    if (!(bar instanceof HTMLElement) || !(active instanceof HTMLElement) || !(inactive instanceof HTMLElement)
      || !(popover instanceof HTMLElement)) {
      throw new Error("Workspace-bar metric fixture is incomplete");
    }
    const barStyle = getComputedStyle(bar);
    const activeStyle = getComputedStyle(active);
    const inactiveStyle = getComputedStyle(inactive);
    const label = active.querySelector(".scripture-workspace-tab-label");
    const labelStyle = label ? getComputedStyle(label) : null;
    const mark = active.querySelector(".scripture-workspace-tab-mark");
    const close = active.querySelector(".scripture-workspace-tab-close");
    const groupControl = document.querySelector("[data-study-active-group-manage]");
    const groupLabelOwner = document.querySelector("[data-study-group-tab]");
    const barColor = parseColor(barStyle.backgroundColor);
    const activeBackground = parseColor(activeStyle.backgroundColor);
    const inactiveRect = inactive.getBoundingClientRect();
    const toolbar = bar.querySelector('[role="toolbar"]');
    const fixtureSignature = JSON.stringify({
      tabs: [...bar.querySelectorAll("[data-study-tab-id]")].map((tab) => ({
        id: tab.getAttribute("data-study-tab-id"),
        kind: tab.getAttribute("data-study-tab-kind"),
        selected: tab.getAttribute("aria-selected"),
        collapsed: tab.getAttribute("data-study-collapsed-proxy"),
        label: tab.textContent?.replace(/\\s+/g, " ").trim(),
      })),
      groups: [...document.querySelectorAll("[data-study-all-tabs] ~ * [data-study-group-id]")]
        .map((group) => group.getAttribute("data-study-group-id")),
      allTabsRows: [...document.querySelectorAll("[data-study-all-tabs-row]")]
        .map((row) => row.getAttribute("data-study-tab-id")),
    });
    const backgroundAlpha = barColor.a;
    const activeAlpha = activeBackground.a;
    const popoverAlpha = parseColor(getComputedStyle(popover).backgroundColor).a;
    const popoverOpacity = Number(getComputedStyle(popover).opacity);
    const labelOpacity = Number(labelStyle?.opacity ?? 0);
    const railHeight = bar.getBoundingClientRect().height;
    const backdropFilter = barStyle.backdropFilter || barStyle.webkitBackdropFilter || "none";
    const actionLayerCount = bar.querySelectorAll(".scripture-workspace-actions").length;
    const actionLayerAlpha = toolbar instanceof HTMLElement
      ? parseColor(getComputedStyle(toolbar).backgroundColor).a
      : 1;
    const activeContrast = contrastRatio(parseColor(activeStyle.color), activeBackground);
    const inactiveContrast = contrastRatio(parseColor(inactiveStyle.color), barColor);
    const compactInactive = inactiveRect.width <= 176 && inactiveRect.height >= 24;
    const closeVisible = close instanceof HTMLElement
      && Number(getComputedStyle(close).opacity) >= 0.9
      && close.getBoundingClientRect().width >= 24;
    const typeVisible = mark instanceof HTMLElement
      && Number(getComputedStyle(mark).opacity) >= 0.9
      && mark.getBoundingClientRect().width > 0;
    const groupVisible = groupControl instanceof HTMLElement
      && groupControl.getBoundingClientRect().width >= 24
      && groupLabelOwner instanceof HTMLElement
      && groupLabelOwner.getBoundingClientRect().width >= 24
      && (groupLabelOwner.textContent ?? "").trim().length > 0;
    const activeBoxShadow = activeStyle.boxShadow.trim();
    const neutralHalo = activeBoxShadow === "none"
      || splitTopLevel(activeBoxShadow).every((shadow) => /(^|\\s)inset(\\s|$)/.test(shadow));
    const focusRingWidth = Number.parseFloat(${JSON.stringify(keyboardFocusMetrics.outlineWidth)}) || 0;
    const focusContrast = contrastRatio(parseColor(${JSON.stringify(keyboardFocusMetrics.outlineColor)}), barColor);
    return {
      themeId: ${JSON.stringify(themeId)},
      fixtureSignature,
      backgroundAlpha,
      activeAlpha,
      popoverAlpha,
      popoverOpacity,
      labelOpacity,
      railHeight,
      backdropFilter,
      actionLayerCount,
      actionLayerAlpha,
      hitTarget: ${JSON.stringify(hitTarget)},
      activeContrast,
      inactiveContrast,
      compactInactive,
      closeVisible,
      typeVisible,
      groupVisible,
      neutralHalo,
      activeBoxShadow,
      focusRingWidth,
      focusContrast,
      focusVisible: ${JSON.stringify(keyboardFocusMetrics.focusVisible)},
    };
  })()`;
}

function assertNormalMetrics(theme, metrics, fixtureSignature) {
  assert.equal(metrics.fixtureSignature, fixtureSignature, `${theme.id}: fixture drifted between captures`);
  assert.ok(metrics.backgroundAlpha >= 0.9, `${theme.id}: workspace material is not opaque/composited`);
  assert.ok(metrics.activeAlpha >= 0.9, `${theme.id}: active material alpha is below 0.9`);
  assert.equal(metrics.popoverAlpha, 1, `${theme.id}: All Tabs material is translucent`);
  assert.equal(metrics.popoverOpacity, 1, `${theme.id}: All Tabs capture did not reach settled opacity`);
  assert.equal(metrics.labelOpacity, 1, `${theme.id}: active label opacity is not 1`);
  assert.ok(metrics.railHeight >= 36 && metrics.railHeight <= 40, `${theme.id}: rail is ${metrics.railHeight}px`);
  // The blur belongs to the material, not the atmosphere — that was the whole
  // reason Glass and Candlelight stopped being themes.
  const blurCorrect = theme.material === "translucent"
    ? metrics.backdropFilter.includes("blur(") && !metrics.backdropFilter.includes("blur(0px)")
    : metrics.backdropFilter === "none" || metrics.backdropFilter.includes("blur(0px)");
  assert.equal(blurCorrect, true, `${theme.label}: unexpected blur ${metrics.backdropFilter}`);
  assert.equal(metrics.actionLayerCount, 1, `${theme.id}: a second action layer is visible`);
  assert.equal(metrics.actionLayerAlpha, 0, `${theme.id}: action toolbar paints a second material`);
  assert.equal(metrics.hitTarget, true, `${theme.id}: active tab center is intercepted`);
  assert.ok(metrics.activeContrast >= 3, `${theme.id}: active label contrast ${metrics.activeContrast}`);
  assert.ok(metrics.inactiveContrast >= 3, `${theme.id}: inactive label contrast ${metrics.inactiveContrast}`);
  assert.equal(metrics.compactInactive, true, `${theme.id}: inactive tab is not compact/readable`);
  assert.equal(metrics.closeVisible, true, `${theme.id}: selected close target is not visible`);
  assert.equal(metrics.typeVisible, true, `${theme.id}: selected type mark is not visible`);
  assert.equal(metrics.groupVisible, true, `${theme.id}: named group affordance is not visible`);
  assert.equal(metrics.neutralHalo, true, `${theme.id}: selected tab has a decorative outer halo (${metrics.activeBoxShadow})`);
  assert.ok(metrics.focusVisible && metrics.focusRingWidth >= 2, `${theme.id}: focus ring is below 2px`);
  assert.ok(metrics.focusContrast >= 3, `${theme.id}: focus contrast ${metrics.focusContrast}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "pericope-study-workspace-bar-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "Library");
const port = await availablePort();
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = { ...process.env, LIBRARY_PATH: libraryPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
);
const childState = { exited: false, code: null, signal: null, spawnError: null };
child.once("exit", (code, signal) => {
  childState.exited = true;
  childState.code = code;
  childState.signal = signal;
});
child.once("error", (error) => { childState.spawnError = String(error); });
let childLog = "";
const retainLog = (chunk) => { childLog = (childLog + chunk.toString()).slice(-20_000); };
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
try {
  const target = await waitForTarget(endpoint, childState);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector("[data-study-workspace-bar]"))`, 20_000);

  const entities = await driver.evaluate(`(async () => {
    const resolveEntity = async (name, kind) => {
      const result = await window.api.language.searchEntities(name, 24);
      const entity = (result.entities ?? []).map((entry) => entry.entity ?? entry)
        .find((candidate) => candidate.displayName === name && candidate.kind === kind);
      if (!entity) throw new Error("Missing real workspace-bar entity " + name);
      return { id: entity.id, kind: entity.kind, displayName: entity.displayName };
    };
    const [apollos, ephesus, priscilla] = await Promise.all([
      resolveEntity("Apollos", "person"),
      resolveEntity("Ephesus", "place"),
      resolveEntity("Priscilla", "person"),
    ]);
    return { apollos, ephesus, priscilla };
  })()`);
  const fixture = buildFixture(entities);
  const pendingScreenshots = [];
  let expectedFixtureSignature = null;

  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "forced-colors", value: "none" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ],
  });

  for (const theme of THEMES) {
    await driver.evaluate(`window.api.settings.set({
      theme: ${JSON.stringify(theme.id)},
      material: ${JSON.stringify(theme.material)},
      studyWorkspace: ${JSON.stringify(fixture)},
      sidebarCollapsed: true,
      marginVisible: true,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" }
    })`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await driver.waitFor(`document.querySelector(".app-shell")?.classList.contains(${JSON.stringify(`theme-${theme.id}`)})
      && document.querySelector(".app-shell")?.classList.contains("material-translucent") === ${JSON.stringify(theme.material === "translucent")}
      && document.querySelector('[data-study-tab-id="active-entity"]')?.getAttribute("aria-selected") === "true"
      && document.querySelector('[data-study-group-id="collapsed-study"] [data-study-collapsed-proxy="true"]')
      && document.querySelector("#entity-research-title")?.textContent?.includes("Priscilla")`, 20_000);
    const unobstructedHitTarget = await driver.evaluate(`(() => {
      const active = document.querySelector('[data-study-tab-id="active-entity"]');
      if (!(active instanceof HTMLElement)) return false;
      const rect = active.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(target && active.contains(target));
    })()`);
    assert.equal(await driver.evaluate(`(() => {
      const active = document.querySelector('[data-study-tab-id="active-entity"]');
      if (!(active instanceof HTMLElement)) return false;
      active.focus({ preventScroll: true });
      return document.activeElement === active;
    })()`), true);
    await dispatchKey(cdp, "Tab", "Tab", 9);
    await dispatchKey(cdp, "Tab", "Tab", 9, 8);
    await driver.waitFor(`document.activeElement?.getAttribute("data-study-tab-id") === "active-entity"
      && document.activeElement?.matches(":focus-visible") === true`);
    const keyboardFocusMetrics = await driver.evaluate(`(() => {
      const active = document.querySelector('[data-study-tab-id="active-entity"]');
      if (!(active instanceof HTMLElement)) throw new Error("Active tab is unavailable for focus metrics");
      const style = getComputedStyle(active);
      return {
        focusVisible: active.matches(":focus-visible"),
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      };
    })()`);
    if (theme.id === "light") {
      await driver.evaluate(`(async () => {
        await document.fonts.ready;
        await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
        return true;
      })()`);
      await sleep(180);
      const tabStateScreenshot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      pendingScreenshots.push({ file: "paper-tabs.png", bytes: Buffer.from(tabStateScreenshot.result.data, "base64") });
    }
    await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
    await driver.waitFor(`Boolean(document.querySelector("[data-study-all-tabs-search]"))
      && document.querySelectorAll("[data-study-all-tabs-row]").length === ${Object.keys(fixture.tabsById).length}`);
    await driver.evaluate(`(async () => {
      await document.fonts.ready;
      await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
      return true;
    })()`);
    await sleep(260);
    const metrics = await driver.evaluate(normalMetricsExpression(
      theme.id,
      unobstructedHitTarget,
      keyboardFocusMetrics,
    ));
    expectedFixtureSignature ??= metrics.fixtureSignature;
    assertNormalMetrics(theme, metrics, expectedFixtureSignature);
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    pendingScreenshots.push({ file: theme.file, bytes: Buffer.from(screenshot.result.data, "base64") });
  }

  // A 590 x 450 fine-pointer viewport is the 200%-zoom equivalent of the
  // representative desktop window, not a mobile product surface. All Tabs
  // must own its vertical overflow so the final item remains reachable.
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await driver.waitFor(`!document.querySelector("[data-study-all-tabs-search]")`);
  await cdp.send("Emulation.setDeviceMetricsOverride", ZOOM_VIEWPORT);
  await driver.waitFor(`window.innerWidth === ${ZOOM_VIEWPORT.width}
    && window.innerHeight === ${ZOOM_VIEWPORT.height}
    && getComputedStyle(document.querySelector("[data-study-workspace-bar]")).display !== "none"`);
  await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector("[data-study-all-tabs-search]"))
    && document.querySelectorAll("[data-study-all-tabs-row]").length === ${Object.keys(fixture.tabsById).length}`);
  await sleep(200);
  const zoomMetrics = await driver.evaluate(`(async () => {
    const panel = document.querySelector(".scripture-workspace-overflow-popover");
    const list = document.querySelector(".scripture-workspace-overflow-list");
    const rows = [...document.querySelectorAll("[data-study-all-tabs-row]")];
    const lastRow = rows.at(-1);
    const lastButton = lastRow?.querySelector(":scope > button");
    if (!(panel instanceof HTMLElement) || !(list instanceof HTMLElement) || !(lastButton instanceof HTMLElement)) {
      throw new Error("Zoom fixture is missing its All Tabs scroll owner or final tab");
    }
    list.scrollTop = list.scrollHeight;
    lastButton.focus({ preventScroll: false });
    lastButton.scrollIntoView({ block: "nearest", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const panelRect = panel.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const lastRect = lastRow.getBoundingClientRect();
    const listStyle = getComputedStyle(list);
    return {
      finePointer: !matchMedia("(pointer: coarse)").matches,
      panelWithinViewport: panelRect.top >= 0 && panelRect.bottom <= window.innerHeight,
      panelRect: { top: panelRect.top, bottom: panelRect.bottom, height: panelRect.height },
      viewportHeight: window.innerHeight,
      listScrollable: list.scrollHeight > list.clientHeight,
      listOverflowY: listStyle.overflowY,
      zoomLastTabVisible: lastRect.top >= listRect.top - 1 && lastRect.bottom <= listRect.bottom + 1,
      lastTabFocused: document.activeElement === lastButton,
    };
  })()`);
  assert.equal(zoomMetrics.finePointer, true, "zoom fixture unexpectedly entered the coarse-pointer mobile surface");
  assert.equal(
    zoomMetrics.panelWithinViewport,
    true,
    `All Tabs escaped the 200%-zoom viewport (${JSON.stringify({ panelRect: zoomMetrics.panelRect, viewportHeight: zoomMetrics.viewportHeight })})`,
  );
  assert.equal(zoomMetrics.listScrollable, true, "All Tabs did not expose its vertical overflow at 200% zoom");
  assert.ok(["auto", "scroll"].includes(zoomMetrics.listOverflowY), `All Tabs overflow is ${zoomMetrics.listOverflowY}`);
  assert.equal(zoomMetrics.zoomLastTabVisible, true, "the final study tab remains clipped at 200% zoom");
  assert.equal(zoomMetrics.lastTabFocused, true, "the final study tab is not keyboard focusable at 200% zoom");
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await driver.waitFor(`!document.querySelector("[data-study-all-tabs-search]")`);
  await cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  await driver.waitFor(`window.innerWidth === ${VIEWPORT.width} && window.innerHeight === ${VIEWPORT.height}`);

  // The final fixture also owns the forced-colors and reduced-motion pass.
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "forced-colors", value: "active" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await driver.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    return true;
  })()`);

  const rovingBefore = await driver.evaluate(`(() => ({
    rovingTabCount: document.querySelectorAll('[role="tab"][tabindex="0"]').length,
    activeId: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-study-tab-id"),
  }))()`);
  assert.equal(rovingBefore.rovingTabCount, 1, "forced colors must retain exactly one roving tab");
  await driver.evaluate(`(() => {
    const active = document.querySelector('[role="tab"][aria-selected="true"]');
    active?.focus({ preventScroll: true });
    active?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    return true;
  })()`);
  await driver.waitFor(`document.activeElement?.getAttribute("role") === "tab"
    && document.activeElement?.getAttribute("data-study-tab-id") !== ${JSON.stringify(rovingBefore.activeId)}`);
  const arrowFocus = await driver.evaluate(`({
    id: document.activeElement?.getAttribute("data-study-tab-id") ?? null,
    role: document.activeElement?.getAttribute("role") ?? null,
    managementControl: Boolean(document.activeElement?.closest(".scripture-workspace-actions")),
    selectedId: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-study-tab-id") ?? null,
  })`);
  assert.equal(arrowFocus.role, "tab", "ArrowRight did not land on the next study tab");
  assert.equal(arrowFocus.managementControl, false, "ArrowRight entered a management control");
  assert.equal(
    arrowFocus.selectedId,
    rovingBefore.activeId,
    "ArrowRight must move focus only — selection commits on Enter (manual activation)",
  );
  await driver.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await driver.waitFor(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-study-tab-id") !== ${JSON.stringify(rovingBefore.activeId)}`);

  await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
  await driver.waitFor(`document.activeElement?.matches("[data-study-all-tabs-search]") === true`);
  await driver.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await driver.waitFor(`!document.querySelector("[data-study-all-tabs-search]")
    && document.activeElement?.matches("[data-study-all-tabs]") === true`);

  const forcedMetrics = await driver.evaluate(`(() => {
    const durationMilliseconds = (value) => value.split(",").reduce((maximum, part) => {
      const trimmed = part.trim();
      const valueInMilliseconds = trimmed.endsWith("ms")
        ? Number.parseFloat(trimmed)
        : Number.parseFloat(trimmed) * 1000;
      return Math.max(maximum, Number.isFinite(valueInMilliseconds) ? valueInMilliseconds : 0);
    }, 0);
    const bar = document.querySelector("[data-study-workspace-bar]");
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    selected?.focus({ preventScroll: true });
    const selectedStyle = selected ? getComputedStyle(selected) : null;
    const barStyle = bar ? getComputedStyle(bar) : null;
    const interactive = [...document.querySelectorAll(
      "[data-study-workspace-bar] button, [data-study-workspace-bar] [data-workspace-tab-close]"
    )].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const targetChecks = interactive.map((element) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const viewport = element.closest(".scripture-workspace-viewport");
      const clipRect = viewport?.getBoundingClientRect() ?? bar?.getBoundingClientRect();
      const centerVisible = Boolean(clipRect)
        && centerX >= Math.max(0, clipRect.left)
        && centerX <= Math.min(window.innerWidth, clipRect.right)
        && centerY >= Math.max(0, clipRect.top)
        && centerY <= Math.min(window.innerHeight, clipRect.bottom);
      const center = centerVisible ? document.elementFromPoint(centerX, centerY) : null;
      return {
        width: rect.width,
        height: rect.height,
        centerVisible,
        centerHit: Boolean(center && element.contains(center)),
      };
    });
    const animated = [...document.querySelectorAll(
      ".scripture-workspace-tab-wrap, .scripture-workspace-tab, .scripture-workspace-tab-close, .scripture-workspace-group-title > button, .scripture-workspace-row-tools"
    )];
    const zeroDuration = animated.every((element) => {
      const style = getComputedStyle(element);
      return durationMilliseconds(style.transitionDuration) === 0
        && durationMilliseconds(style.animationDuration) === 0;
    });
    const focusRingWidth = Number.parseFloat(selectedStyle?.outlineWidth ?? "0") || 0;
    const systemSelection = selectedStyle?.forcedColorAdjust === "none"
      && selectedStyle.backgroundColor !== barStyle?.backgroundColor;
    const systemKeyline = Number.parseFloat(barStyle?.borderBottomWidth ?? "0") >= 1
      && barStyle?.borderBottomStyle !== "none";
    const minimumTargetSize = targetChecks.every((target) => target.width >= 24 && target.height >= 24);
    const visibleTargetChecks = targetChecks.filter((target) => target.centerVisible);
    const hitTarget = visibleTargetChecks.length > 0
      && visibleTargetChecks.every((target) => target.centerHit);
    const rovingTabCount = document.querySelectorAll('[role="tab"][tabindex="0"]').length;
    const focusReturn = document.activeElement === selected;
    return {
      forcedColors: matchMedia("(forced-colors: active)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      rovingTabCount,
      focusRingWidth,
      systemSelection,
      systemKeyline,
      minimumTargetSize,
      hitTarget,
      zeroDuration,
      focusReturn,
      Escape: true,
    };
  })()`);
  assert.equal(forcedMetrics.forcedColors, true);
  assert.equal(forcedMetrics.reducedMotion, true);
  assert.equal(forcedMetrics.rovingTabCount, 1);
  assert.ok(forcedMetrics.focusRingWidth >= 2, `forced focus is ${forcedMetrics.focusRingWidth}px`);
  assert.equal(forcedMetrics.systemSelection, true, "forced colors did not expose system selection");
  assert.equal(forcedMetrics.systemKeyline, true, "forced colors did not expose system keylines");
  assert.equal(forcedMetrics.minimumTargetSize, true, "a visible Study control is smaller than 24px");
  assert.equal(forcedMetrics.hitTarget, true, "a Study control center is intercepted");
  assert.equal(forcedMetrics.zeroDuration, true, "reduced motion left a Study transition or animation running");

  mkdirSync(OUTPUT_DIR, { recursive: true });
  // One capture per row of the matrix. Writing an empty list would leave the
  // PASS line below claiming captures that were never taken.
  assert.equal(
    pendingScreenshots.length,
    THEMES.length,
    `expected one capture per atmosphere/material row, got ${pendingScreenshots.length} of ${THEMES.length}`,
  );
  for (const capture of pendingScreenshots) {
    writeFileSync(join(OUTPUT_DIR, capture.file), capture.bytes);
  }
  console.log(`PASS study workspace bar: ${THEMES.length} identical-fixture theme captures + clean tab state + forced-colors/reduced-motion`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}\nElectron log:\n${childLog}`);
} finally {
  cdp?.socket.close();
  await terminateChild(child, childState);
  rmSync(qaRoot, { recursive: true, force: true });
}
