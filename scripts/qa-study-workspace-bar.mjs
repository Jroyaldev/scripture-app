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
      // Name the expression. "Timed out waiting for CDP Runtime.evaluate" with
      // nothing else is the least useful failure this tour can produce, and it
      // is the one it produces most often on a loaded machine.
      const subject = typeof params.expression === "string"
        ? `: ${params.expression.replace(/\s+/g, " ").slice(0, 160)}`
        : "";
      reject(new Error(`Timed out after ${timeout}ms waiting for CDP ${method}${subject}`));
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
  /* `timeout` is a parameter and not a constant because one call in this tour
     is not like the others: resolving the fixture's three real entities goes
     through the library, and on a cold profile that request queues behind the
     library's own initialise/reinitialise. Everything else here is a DOM read
     that answers in a frame.

     Both ceilings are generous, and the default moved from 20s to 45s on
     2026-07-30 because `waitForState` does not catch a STALLED evaluate — only
     a gate that stays false. A slow answer therefore surfaced as "Timed out
     waiting for CDP Runtime.evaluate" with no gate named, which is the least
     useful failure this tour can produce, and it happened on a machine merely
     under load. The tour reloads the shell once per theme and each reload
     re-opens the library underneath it. */
  const evaluate = async (expression, timeout = 45_000) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeout);
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
  /**
   * Settle the page: fonts loaded, every running animation finished.
   *
   * The tour measures settled states — a popover's opacity, a control's
   * geometry, a screenshot — and it may not wait on a frame clock it does not
   * control. An Electron window that is occluded freezes its animations at the
   * from-keyframe, so `.popover-panel`'s 180ms entrance sits at opacity 0
   * indefinitely and a gate on "has it arrived" waits forever. Finishing the
   * animations is the same end state a visible window reaches, reached
   * deliberately: what the tour is testing is what the register looks like at
   * rest, not how long it takes to get there.
   */
  const settle = async () => {
    // Front first. An occluded window freezes animations AND throttles
    // requestAnimationFrame to never — and the register moves focus in a rAF,
    // so a keyboard gate against a window that has slipped behind another one
    // waits for a frame that is not coming.
    await cdp.send("Page.bringToFront");
    await evaluate(`(async () => {
      await document.fonts.ready;
      for (const animation of document.getAnimations()) {
        try { animation.finish(); } catch { /* an infinite animation cannot finish */ }
      }
      return true;
    })()`);
    await sleep(120);
  };
  return { evaluate, waitFor, settle };
}

/**
 * A real key press, through the input pipeline rather than as a DOM event.
 *
 * `text` matters and is not decoration. A key whose default action runs on
 * keypress — Enter activating a button is the case here — never reaches it from
 * `rawKeyDown` alone, because CDP only synthesises the char event when the key
 * carries text. Passing it makes this the same sequence a keyboard produces:
 * keydown, keypress, the element's own activation, keyup.
 */
async function dispatchKey(cdp, key, code, virtualKeyCode, modifiers = 0, text) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: text === undefined ? "rawKeyDown" : "keyDown",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    ...(text === undefined ? {} : { text, unmodifiedText: text }),
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

/**
 * A workspace of `count` studies, each holding one passage, for the shape pass.
 *
 * The register's fixture is two studies and two long names, which is the shape
 * a reader is usually in. It is not the shape that breaks a row of chips. Those
 * are the floor — one study, where "All" would be a choice between a thing and
 * itself — and the ceiling, sixteen, which is the model's group cap and more
 * names than any window fits.
 */
function shapeFixture(count, labels) {
  const groups = [];
  const tabsById = {};
  for (let index = 0; index < count; index += 1) {
    const groupId = `shape-study-${index}`;
    const tabId = `shape-passage-${index}`;
    tabsById[tabId] = {
      kind: "passage",
      id: tabId,
      groupId,
      session: session(passageView("ACT", 1 + (index % 28), "bsb", 1, index)),
    };
    groups.push({
      id: groupId,
      homePassageTabId: tabId,
      tabIds: [tabId],
      lastActiveTabId: tabId,
      collapsed: false,
      label: labels[index % labels.length] === null
        ? { kind: "automatic" }
        : { kind: "custom", value: labels[index % labels.length] },
    });
  }
  return {
    version: 2,
    groups,
    tabsById,
    activeTabId: "shape-passage-0",
    activationOrder: Object.keys(tabsById),
    recentlyClosed: [],
  };
}

/**
 * Names for the shape pass, and every other study goes UNNAMED.
 *
 * `null` is a study the reader has made and not yet claimed: its label stays
 * `{ kind: "automatic" }` and the line shows the reference the app derived.
 * That is the other half of the seal's claim — the mark certifies the naming,
 * so half of these chips must go unmarked or the assertion proves nothing.
 */
const SHAPE_LABELS = [
  "Deuteronomy 32 worldview",
  null,
  "Sunday evening — the riot in Ephesus",
  null,
  "Baptism",
  null,
  "Hospitality in the Pastorals",
  null,
];

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
    const studyLine = document.querySelector("[data-study-line]");
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
    // The strip's own new-tab control. This used to be
    // \`document.querySelector("[data-study-group-tab]")\` — the group kicker,
    // which left the strip on 2026-07-29 — so the gate below was asserting the
    // visibility of an element the app no longer renders and could not pass.
    const openControl = document.querySelector("[data-study-open]");
    const studyChips = [...document.querySelectorAll("[data-study-line-chip]")];
    const startControl = document.querySelector("[data-study-start]");
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
    /* THE STUDY LINE — the frame's top row, measured in a used layout because
       the two things that can go wrong with it are both geometric and neither
       is visible to a source-reading test.

       It has to be ABOVE the strip. Between the strip and the page it would
       sever the joint that makes the active tab a piece of the page: the tab's
       fillets sweep into --bg-reading at the strip's baseline, and a 24px row
       inserted there leaves the tab floating on canvas with two paper blocks
       under its corners.

       And the frame's top edge has to be the composed 54 — the line's band plus
       the strip — because the rail's brand tile and the page grid both derive
       their origin from that number and neither can see it move. */
    const lineRect = studyLine instanceof HTMLElement ? studyLine.getBoundingClientRect() : null;
    const barRect = bar.getBoundingClientRect();
    const lineStyle = studyLine instanceof HTMLElement ? getComputedStyle(studyLine) : null;
    const lineAboveStrip = Boolean(lineRect) && lineRect.bottom <= barRect.top + 0.5;
    const frameTop = Boolean(lineRect) ? barRect.bottom - lineRect.top : 0;
    const lineOutsideRegister = studyLine instanceof HTMLElement
      && studyLine.closest("[data-study-workspace-bar]") === null
      && studyLine.closest('[role="tablist"]') === null
      && studyLine.getAttribute("role") === "toolbar";
    // Every study is named, once, on a control big enough to press, and the one
    // the strip is showing is the one marked current.
    // The chip's own label, not its whole text: a chip also carries a count.
    const chipName = (chip) => (chip.querySelector(".scripture-study-chip-label")?.textContent ?? "")
      .replace(/\\s+/g, " ").trim();
    const chipNames = studyChips.map(chipName);
    const currentChips = studyChips.filter((chip) => chip.getAttribute("aria-current") === "true");
    const chipTargets = [...studyChips, startControl].every((control) => {
      if (!(control instanceof HTMLElement)) return false;
      const rect = control.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    });
    const chipsOutsideTablist = studyChips.every((chip) => chip.closest('[role="tablist"]') === null
      && chip.closest("[data-study-workspace-bar]") === null);
    // The band drags the window and the chips do not, or the region eats the
    // press before the chip ever sees it.
    const lineDrags = lineStyle?.webkitAppRegion === "drag" || lineStyle?.appRegion === "drag";
    const chipStyle = studyChips[0] ? getComputedStyle(studyChips[0]) : null;
    const chipsNoDrag = chipStyle?.webkitAppRegion === "no-drag" || chipStyle?.appRegion === "no-drag";
    // Current is ink and weight over the frame's own canvas, never a fill.
    const currentChipStyle = currentChips[0] ? getComputedStyle(currentChips[0]) : null;
    const currentChipFilled = currentChipStyle
      ? parseColor(currentChipStyle.backgroundColor).a > 0.02
      : true;
    const lineAlpha = lineStyle ? parseColor(lineStyle.backgroundColor).a : 1;
    const chipContrast = currentChipStyle
      ? contrastRatio(parseColor(currentChipStyle.color), parseColor(getComputedStyle(document.querySelector(".app-shell")).backgroundColor))
      : 0;
    // The seal marks a NAMED study. Both of the fixture's studies carry custom
    // labels, so both chips wear one; the shape pass drives the other half,
    // where an automatic label goes unmarked.
    const sealMark = studyChips[0]?.querySelector(".scripture-study-chip-seal");
    const sealVisible = sealMark instanceof HTMLElement
      && sealMark.getBoundingClientRect().width > 0
      && Number(getComputedStyle(sealMark).opacity) >= 0.9;
    const sealedChips = studyChips.filter((chip) => chip.querySelector(".scripture-study-chip-seal")).length;
    const lineState = studyLine?.getAttribute("data-study-line-state") ?? null;

    const activeContrast = contrastRatio(parseColor(activeStyle.color), activeBackground);
    const inactiveContrast = contrastRatio(parseColor(inactiveStyle.color), barColor);
    const compactInactive = inactiveRect.width <= 176 && inactiveRect.height >= 24;
    const closeVisible = close instanceof HTMLElement
      && Number(getComputedStyle(close).opacity) >= 0.9
      && close.getBoundingClientRect().width >= 24;
    const typeVisible = mark instanceof HTMLElement
      && Number(getComputedStyle(mark).opacity) >= 0.9
      && mark.getBoundingClientRect().width > 0;
    // Nothing in the strip stands for a study any more. The kicker went on
    // 2026-07-29, the Manage control on 2026-07-30, and the study line above
    // carries every study's name — so the check here is the negative, and the
    // naming claim is measured on the line, below.
    const groupNamedInStrip = bar.querySelector(
      "[data-study-active-group-manage], .scripture-workspace-active-group, [data-study-group-tab]",
    ) !== null;
    // And the control that makes a tab is in the strip rather than the toolbar,
    // seated inside the tab row rather than overhanging it into the drag band.
    // The margin box was 31px in a 30px row until 2026-07-30, which put its top
    // edge a pixel above every tab — invisible to a source-reading test and
    // exactly what a used-layout gate is for.
    const openRect = openControl instanceof HTMLElement
      ? openControl.getBoundingClientRect()
      : null;
    const tabTop = Math.min(active.getBoundingClientRect().top, inactiveRect.top);
    const openInStrip = openControl instanceof HTMLElement
      && openRect.width >= 24
      && openRect.height >= 24
      && openControl.closest("[data-study-workspace-bar]") === bar
      && openControl.closest('[role="toolbar"]') === null
      && openControl.closest('[role="tablist"]') === null
      && openRect.top >= tabTop - 0.5
      && openRect.bottom <= bar.getBoundingClientRect().bottom + 0.5;
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
      groupNamedInStrip,
      openInStrip,
      lineAboveStrip,
      frameTop,
      lineOutsideRegister,
      chipNames,
      currentChipNames: currentChips.map(chipName),
      chipTargets,
      chipsOutsideTablist,
      lineDrags,
      chipsNoDrag,
      currentChipFilled,
      lineAlpha,
      chipContrast,
      sealVisible,
      sealedChips,
      lineState,
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
  /* THE REGISTER PAINTS NOTHING OF ITS OWN, re-canonned 2026-07-30.
     This read `assert.ok(metrics.backgroundAlpha >= 0.9, "workspace material is
     not opaque/composited")`, from when the strip was a material with the tabs
     sitting on it. Rev 05 §05·2 made it canvas — "the register is a strip of
     canvas the active page is pulled up through", `background: transparent`,
     pinned in tests/study-workspace-tabs-premium-contract — so the alpha has
     been 0 in every theme since, and this gate could not pass. It is inverted
     rather than dropped: a fill here would put a third plane between the page
     and the window, and the opacity claim it used to make now belongs to the
     ACTIVE TAB, which is the piece of page and is asserted on the next line. */
  assert.equal(metrics.backgroundAlpha, 0, `${theme.id}: the register paints a material of its own`);
  assert.ok(metrics.activeAlpha >= 0.9, `${theme.id}: active material alpha is below 0.9`);
  assert.equal(metrics.popoverAlpha, 1, `${theme.id}: All Tabs material is translucent`);
  assert.equal(metrics.popoverOpacity, 1, `${theme.id}: All Tabs capture did not reach settled opacity`);
  assert.equal(metrics.labelOpacity, 1, `${theme.id}: active label opacity is not 1`);
  /* The bar is the STRIP's half of the frame, 30px. This read `>= 36 && <= 40`
     from when the bar also owned the empty band above the tabs and therefore
     stood for the whole top edge; the study line is a real element in that band
     now and states its own height. The edge itself is measured as `frameTop`
     below — line top to strip bottom — which is the number the rail and the
     page grid actually read, and it is the one that must not move. */
  assert.equal(metrics.railHeight, 30, `${theme.id}: the tab strip is ${metrics.railHeight}px, not 30`);
  /* The blur belongs to the material, not the atmosphere — that was the whole
     reason Glass and Candlelight stopped being themes. It no longer belongs to
     the REGISTER at all, and this is the same re-canon as the alpha above: a
     backdrop-filter has nothing to filter through a strip with no fill, and it
     would blur the page the active tab is continuous with. The line used to
     require a blur on the two translucent rows and forbid it on the four solid
     ones; measured on 2026-07-30 it is "none" in all six, which is the strip
     being canvas rather than a material failing to arrive. The material axis
     still earns its rows — six atmospheres of contrast, geometry and focus, and
     six screenshots — but the register's answer to it is the same every time. */
  assert.equal(
    metrics.backdropFilter === "none" || metrics.backdropFilter.includes("blur(0px)"),
    true,
    `${theme.label}: the register filters the page behind it (${metrics.backdropFilter})`,
  );
  assert.equal(metrics.actionLayerCount, 1, `${theme.id}: a second action layer is visible`);
  assert.equal(metrics.actionLayerAlpha, 0, `${theme.id}: action toolbar paints a second material`);
  assert.equal(metrics.hitTarget, true, `${theme.id}: active tab center is intercepted`);
  assert.ok(metrics.activeContrast >= 3, `${theme.id}: active label contrast ${metrics.activeContrast}`);
  assert.ok(metrics.inactiveContrast >= 3, `${theme.id}: inactive label contrast ${metrics.inactiveContrast}`);
  assert.equal(metrics.compactInactive, true, `${theme.id}: inactive tab is not compact/readable`);
  assert.equal(metrics.closeVisible, true, `${theme.id}: selected close target is not visible`);
  assert.equal(metrics.typeVisible, true, `${theme.id}: selected type mark is not visible`);
  /* THE STUDY IS NAMED ONCE, AND NOT IN THE STRIP.
     This read `metrics.groupVisible` against `[data-study-active-group-manage]`
     — the actions cluster's Manage control, which carried the current study's
     name at a 132px cap and left the strip on 2026-07-30 with the rest of a
     study's identity. Before that it read `[data-study-group-tab]`, the kicker,
     and went a day pointing at an element the app no longer rendered. Three
     devices, three selectors, one claim; it is stated on the study line now,
     and it is stated as a property rather than as a selector — EVERY study is
     named, exactly one is current, and the strip names none. */
  assert.equal(metrics.groupNamedInStrip, false, `${theme.id}: an element in the strip stands for a study`);
  assert.deepEqual(
    metrics.chipNames,
    ["Pastoral Teaching Lab", "Romans Baptism Cohort"],
    `${theme.id}: the study line does not name every study`,
  );
  assert.deepEqual(
    metrics.currentChipNames,
    ["Pastoral Teaching Lab"],
    `${theme.id}: exactly one chip is current, and it is the study the strip is showing`,
  );
  assert.equal(metrics.lineAboveStrip, true,
    `${theme.id}: the study line is not above the strip — between it and the page it severs the tab's joint with the page`);
  assert.equal(metrics.frameTop, 54, `${theme.id}: the frame's top edge is ${metrics.frameTop}, not 54`);
  assert.equal(metrics.lineOutsideRegister, true, `${theme.id}: the study line is inside the register's tablist or bar`);
  assert.equal(metrics.chipsOutsideTablist, true, `${theme.id}: a chip is inside the strip's tablist`);
  assert.equal(metrics.chipTargets, true, `${theme.id}: a study line control is smaller than 24px`);
  assert.equal(metrics.lineDrags, true, `${theme.id}: the study line does not carry the window's drag band`);
  assert.equal(metrics.chipsNoDrag, true, `${theme.id}: the drag band would eat a chip press`);
  assert.equal(metrics.lineAlpha, 0, `${theme.id}: the study line paints a material of its own`);
  assert.equal(metrics.currentChipFilled, false, `${theme.id}: the current study is a fill, not ink and weight`);
  assert.ok(metrics.chipContrast >= 4.5, `${theme.id}: current study contrast ${metrics.chipContrast}`);
  assert.equal(metrics.sealVisible, true, `${theme.id}: a named study carries no seal`);
  assert.equal(metrics.sealedChips, 2, `${theme.id}: both of the fixture's studies are named and both must be marked`);
  assert.equal(metrics.lineState, "chips", `${theme.id}: two studies is a choice, so the line draws chips`);
  assert.equal(metrics.openInStrip, true, `${theme.id}: the new-tab plus is not seated in the tab row`);
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

  // Two minutes: this is the one call that waits on the library rather than on
  // the DOM. See the note on `evaluate`.
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
  })()`, 120_000);
  const fixture = buildFixture(entities);

  const captureBand = async (file) => {
    await driver.settle();
    const clip = await driver.evaluate(`(() => {
      const body = document.querySelector(".scripture-body");
      if (!(body instanceof HTMLElement)) return null;
      const rect = body.getBoundingClientRect();
      return { x: 0, y: 0, width: Math.round(rect.right), height: Math.round(rect.top + 24) };
    })()`);
    assert.ok(clip, `${file}: the frame's top band must be measurable`);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { ...clip, scale: 3 },
    });
    pendingScreenshots.push({ file, bytes: Buffer.from(shot.result.data, "base64") });
  };

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
    /* Bring the window forward after every reload. An occluded Electron window
       stops running CSS transitions and throttles rAF to never, so a tour that
       measures settled opacity and captures screenshots has to be looking at a
       window that is actually being drawn — otherwise the first theme passes,
       something else takes focus, and every theme after it fails at whatever
       gate happens to depend on a frame. */
    await cdp.send("Page.bringToFront");
    /* THE STRIP IS ONE STUDY'S TABS. The fixture's active tab is in the first
       study, so the strip holds that study's six and the second study is on the
       line rather than in the row — which is also what a launch does, because
       the study the strip shows is read off the persisted `activeTabId`.

       This used to wait on `[data-study-group-id="collapsed-study"]
       [data-study-collapsed-proxy="true"]`, the folded second study's proxy
       tab. The fixture still marks that study `collapsed: true` and the assertion
       is now that it changes NOTHING: the field stays in the model, stays
       persisted, and no surface reads it. There is no "All" chip either — one
       was built and removed the same day, because a row that has one
       arrangement does not need a control for choosing it. */
    await driver.waitFor(`document.querySelector(".app-shell")?.classList.contains(${JSON.stringify(`theme-${theme.id}`)})
      && document.querySelector(".app-shell")?.classList.contains("material-translucent") === ${JSON.stringify(theme.material === "translucent")}
      && document.querySelector('[data-study-tab-id="active-entity"]')?.getAttribute("aria-selected") === "true"
      && document.querySelectorAll("[data-study-line-chip]").length === 2
      && document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]').length === 6
      && !document.querySelector("[data-study-workspace-bar] [data-study-collapsed-proxy]")
      && !document.querySelector("[data-study-line-all]")
      && document.querySelector("#entity-research-title")?.textContent?.includes("Priscilla")`, 20_000);
    /* The active tab's centre must be the active tab. When it is not, the useful
       thing is WHAT is on top of it — a scrim, a control that has grown, a row
       that has been inserted over the strip — so the probe says so rather than
       returning a bare false and leaving the next hand to guess. */
    /* Bring the active tab in first, in its own evaluate, and let the scroll
       settle on the HOST's clock rather than the page's. The fixture's active
       tab is the last of six in an overflowing strip, so whether it has finished
       being scrolled into view when the probe runs is a race with font metrics
       settling — and a tab scrolled past the strip's 36px cut is not a
       hit-target failure, it is a tab that is not on screen yet.

       NO rAF INSIDE AN EVALUATE, anywhere in this tour as of 2026-07-30. An
       Electron window that is occluded throttles requestAnimationFrame to
       never, so an evaluate that awaits one does not time out at the gate it
       belongs to — it hangs the CDP call and reports as the tour losing the
       renderer, with no gate named. Five settle blocks were written that way
       and all five are host sleeps now; `document.fonts.ready` stays, because a
       font promise resolves whether or not the window is on screen. */
    await driver.evaluate(`(() => {
      document.querySelector('[data-study-tab-id="active-entity"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    })()`);
    await sleep(160);
    const hitProbe = await driver.evaluate(`(() => {
      const active = document.querySelector('[data-study-tab-id="active-entity"]');
      if (!(active instanceof HTMLElement)) return { ok: false, why: "no active tab" };
      const rect = active.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      const describe = (node) => node instanceof Element
        ? node.tagName.toLowerCase() + (node.className && typeof node.className === "string" ? "." + node.className.trim().split(/\\s+/).join(".") : "")
        : String(node);
      return {
        ok: Boolean(target && active.contains(target)),
        why: JSON.stringify({
          point: [Math.round(x), Math.round(y)],
          tab: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
          hit: describe(target),
          stack: document.elementsFromPoint(x, y).slice(0, 4).map(describe),
        }),
      };
    })()`);
    const unobstructedHitTarget = hitProbe.ok;
    if (!unobstructedHitTarget) console.log(`  hit-test miss (${theme.label}): ${hitProbe.why}`);
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
    // The clean tab state, once. Keyed on the ROW rather than on the id: two
    // rows carry the id "light" — the solid atmosphere and the material the
    // retired Glass id migrates to — so an id test captured this twice and the
    // second write landed on the first.
    if (theme.label === ATMOSPHERE_LABELS.light) {
      await driver.settle();
      const tabStateScreenshot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      pendingScreenshots.push({ file: "paper-tabs.png", bytes: Buffer.from(tabStateScreenshot.result.data, "base64") });
      // And the frame's top band on its own, at 3x, because the study line is
      // 24px of 11px type and a full-viewport capture is not something a
      // designer can read it in.
      await captureBand("study-line.png");
    }
    await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
    await driver.waitFor(`Boolean(document.querySelector("[data-study-all-tabs-search]"))
      && document.querySelectorAll("[data-study-all-tabs-row]").length === ${Object.keys(fixture.tabsById).length}`);
    await driver.settle();
    await driver.waitFor(`getComputedStyle(document.querySelector(".scripture-workspace-overflow-popover")).opacity === "1"`);
    await sleep(120);
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
    console.log(`  captured ${theme.label}`);
  }

  /* ── THE STUDY LINE, DRIVEN ────────────────────────────────────────────────
     Six themes prove the line is drawn. This proves it WORKS, once, in the last
     theme the loop left standing — and it is a used-layout pass because every
     claim in it is about what moves and what does not, which no source-reading
     test can see.

     Three things are asserted, in the order a reader meets them:
       1. a chip lands on the tab that study was LAST ON, not its first. The
          rail's switcher documented that rule in a comment three lines above
          code that did the opposite, which is the defect that took it out;
       2. the strip underneath becomes that study's tabs, all of them — the
          second study is marked `collapsed: true` in the fixture and it makes
          no difference, because nothing reads the field;
       3. nothing above the strip moves while it happens. The line's geometry
          may not depend on which chip is current: the current study is told by
          ink and weight over a width the label reserves in every state, so the
          chips are in the same places before and after. */
  /* A REAL Escape. The synthetic `window.dispatchEvent` this used works only
     when something happens to be listening on `window`; the overview's dismissal
     is the Popover primitive's, and pressing the key is both more faithful and
     the one form that cannot go stale when the primitive changes where it
     listens. Fronted first, because a key goes to the focused window. */
  await driver.settle();
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.querySelector("[data-study-all-tabs-search]")`);

  const chipGeometryExpression = `(() => {
    const line = document.querySelector("[data-study-line]");
    const chips = [...document.querySelectorAll("[data-study-line-chip], [data-study-start]")];
    return {
      line: line ? [line.getBoundingClientRect().top, line.getBoundingClientRect().height] : null,
      chips: chips.map((chip) => {
        const rect = chip.getBoundingClientRect();
        return [Math.round(rect.left), Math.round(rect.width)];
      }),
    };
  })()`;
  await driver.settle();
  const geometryBefore = await driver.evaluate(chipGeometryExpression);

  await driver.evaluate(`document.querySelector('[data-study-line-chip][data-study-group-id="collapsed-study"]')?.click()`);
  await driver.waitFor(`document.querySelector('[data-study-tab-id="collapsed-priscilla"]')?.getAttribute("aria-selected") === "true"
    && document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]').length === 2
    && document.querySelector('[data-study-line-chip][data-study-group-id="collapsed-study"]')?.getAttribute("aria-current") === "true"`, 10_000);

  const switchMetrics = await driver.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]')]
      .map((tab) => tab.getAttribute("data-study-tab-id"));
    return {
      rows,
      roving: document.querySelectorAll('[data-study-workspace-bar] [role="tab"][tabindex="0"]').length,
      stops: document.querySelectorAll("[data-study-line] [tabindex='0']").length,
      current: [...document.querySelectorAll('[data-study-line-chip][aria-current="true"]')]
        .map((chip) => chip.getAttribute("data-study-group-id")),
    };
  })()`);
  assert.deepEqual(
    switchMetrics.rows,
    ["romans-6-bsb", "collapsed-priscilla"],
    "a chip shows exactly its own study's tabs — the fixture folds this one, and it makes no difference",
  );
  assert.deepEqual(switchMetrics.current, ["collapsed-study"], "exactly one chip is current");
  assert.equal(switchMetrics.roving, 1, "the strip keeps exactly one roving tab stop");
  assert.equal(switchMetrics.stops, 1, "the study line is one tab stop, and the arrows travel it");

  const geometryAfter = await driver.evaluate(chipGeometryExpression);
  assert.deepEqual(
    geometryAfter,
    geometryBefore,
    "switching studies moved the study line — the current chip must be ink and weight over a reserved width",
  );
  await captureBand("study-line-switched.png");

  // The arrows travel the line, and Enter on a chip commits — the same manual
  // activation the strip below uses, reached the same way.
  await driver.settle();
  await driver.evaluate(`document.querySelector('[data-study-line-chip][data-study-group-id="collapsed-study"]')?.focus()`);
  await dispatchKey(cdp, "ArrowLeft", "ArrowLeft", 37);
  await driver.waitFor(`document.activeElement?.getAttribute("data-study-group-id") === "named-expanded-study"
    && document.querySelector('[data-study-tab-id="collapsed-priscilla"]')?.getAttribute("aria-selected") === "true"`, 20_000);
  await dispatchKey(cdp, "Enter", "Enter", 13, 0, "\r");
  await driver.waitFor(`document.querySelector('[data-study-tab-id="active-entity"]')?.getAttribute("aria-selected") === "true"
    && document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]').length === 6`, 10_000);
  const lineFocus = await driver.evaluate(`(() => {
    const chip = document.activeElement;
    if (!(chip instanceof HTMLElement)) return null;
    const style = getComputedStyle(chip);
    return {
      id: chip.getAttribute("data-study-group-id"),
      focusVisible: chip.matches(":focus-visible"),
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
    };
  })()`);
  assert.equal(lineFocus.id, "named-expanded-study", "Enter commits on the focused chip and focus stays there");
  assert.equal(lineFocus.focusVisible, true, "a chip reached by the keyboard shows a focus ring");
  assert.ok(lineFocus.outlineWidth >= 2, `study line focus ring is ${lineFocus.outlineWidth}px`);

  // A 590 x 450 fine-pointer viewport is the 200%-zoom equivalent of the
  // representative desktop window, not a mobile product surface. All Tabs
  // must own its vertical overflow so the final item remains reachable.
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
  await driver.settle();

  /* Scoped to the REGISTER, 2026-07-30. This counted `[role="tab"][tabindex="0"]`
     across the whole document and asserted exactly one, which was only ever true
     by luck: the living margin is a second, entirely legitimate tablist with its
     own roving stop, and whether it is on screen depends on what kind of tab the
     canvas is showing. The claim is about the strip — one tablist, one stop,
     forced colours included — so it is asked of the strip. */
  const rovingBefore = await driver.evaluate(`(() => ({
    rovingTabCount: document.querySelectorAll('[data-study-workspace-bar] [role="tab"][tabindex="0"]').length,
    rovingTabs: [...document.querySelectorAll('[data-study-workspace-bar] [role="tab"][tabindex="0"]')]
      .map((tab) => tab.getAttribute("data-study-tab-id")),
    activeId: document.querySelector('[data-study-workspace-bar] [role="tab"][aria-selected="true"]')?.getAttribute("data-study-tab-id"),
  }))()`);
  assert.equal(rovingBefore.rovingTabCount, 1,
    `forced colors must retain exactly one roving tab (${JSON.stringify(rovingBefore.rovingTabs)})`);
  await driver.evaluate(`(() => {
    const active = document.querySelector('[data-study-workspace-bar] [role="tab"][aria-selected="true"]');
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
    selectedId: document.querySelector('[data-study-workspace-bar] [role="tab"][aria-selected="true"]')?.getAttribute("data-study-tab-id") ?? null,
  })`);
  assert.equal(arrowFocus.role, "tab", "ArrowRight did not land on the next study tab");
  assert.equal(arrowFocus.managementControl, false, "ArrowRight entered a management control");
  assert.equal(
    arrowFocus.selectedId,
    rovingBefore.activeId,
    "ArrowRight must move focus only — selection commits on Enter (manual activation)",
  );
  /* A REAL Enter, 2026-07-30. This dispatched a synthetic KeyboardEvent, which
     worked only because the tab's keydown handler used to intercept Enter and
     commit the selection itself. That interception was also what made collapse
     and expand pointer-only — it cancelled the button's own activation, and the
     click handler is where all three outcomes live — so it is gone, and the
     keyboard now reaches the same handler the pointer does. An untrusted DOM
     event has no default action to run, so the gate has to press the key rather
     than describe it. This is the more faithful test either way: what it asserts
     now is that a reader's Enter commits, not that one branch exists. */
  await dispatchKey(cdp, "Enter", "Enter", 13, 0, "\r");
  await driver.waitFor(`document.querySelector('[data-study-workspace-bar] [role="tab"][aria-selected="true"]')?.getAttribute("data-study-tab-id") !== ${JSON.stringify(rovingBefore.activeId)}`);

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
    const selected = document.querySelector('[data-study-workspace-bar] [role="tab"][aria-selected="true"]');
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
    /* The register's answer to forced colours is a FIELD, not a keyline.
       This read
         Number.parseFloat(barStyle?.borderBottomWidth ?? "0") >= 1
           && barStyle?.borderBottomStyle !== "none"
       and there has been no border under the strip since Rev 05 §05·2: a rule
       there fights the fillet, which is the thing actually joining the tab to
       the page, and the premium contract forbids one by name. Nothing else in
       the register draws a line either — the actions cluster's border-left is
       zeroed in register.css, "separate with interval, not with lines" — so the
       old check could not pass and was asking for a device the design removed.
       What has to be true in this mode is that the forced-colours rules REACH
       the register at all: the bar takes the system's own field with
       forced-color-adjust off, and the selected tab takes Highlight, which is
       the line above. */
    const barFill = barStyle?.backgroundColor ?? "";
    const systemField = barStyle?.forcedColorAdjust === "none"
      && barFill !== "transparent"
      && barFill !== "rgba(0, 0, 0, 0)";
    const minimumTargetSize = targetChecks.every((target) => target.width >= 24 && target.height >= 24);
    const visibleTargetChecks = targetChecks.filter((target) => target.centerVisible);
    const hitTarget = visibleTargetChecks.length > 0
      && visibleTargetChecks.every((target) => target.centerHit);
    const rovingTabCount = document.querySelectorAll('[data-study-workspace-bar] [role="tab"][tabindex="0"]').length;
    const focusReturn = document.activeElement === selected;
    /* Forced colours flattens every hue, so neither the label's ink nor the
       seal survives it and "which study" has to be said in the system's own
       selection pair — the same answer the active tab gives one row down. */
    const studyLine = document.querySelector("[data-study-line]");
    const lineControls = [...document.querySelectorAll("[data-study-line] button")];
    const currentChip = document.querySelector('[data-study-line-chip][aria-current="true"]');
    const currentChipStyle = currentChip ? getComputedStyle(currentChip) : null;
    const studyLineForced = {
      present: studyLine instanceof HTMLElement
        && getComputedStyle(studyLine).forcedColorAdjust === "none",
      currentIsSystemSelection: Boolean(currentChipStyle)
        && currentChipStyle.backgroundColor !== getComputedStyle(studyLine).backgroundColor,
      targets: lineControls.length > 0 && lineControls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width >= 24 && rect.height >= 24;
      }),
    };
    return {
      forcedColors: matchMedia("(forced-colors: active)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      rovingTabCount,
      focusRingWidth,
      systemSelection,
      systemField,
      minimumTargetSize,
      hitTarget,
      zeroDuration,
      focusReturn,
      studyLineForced,
      Escape: true,
    };
  })()`);
  assert.equal(forcedMetrics.forcedColors, true);
  assert.equal(forcedMetrics.reducedMotion, true);
  assert.equal(forcedMetrics.rovingTabCount, 1);
  assert.ok(forcedMetrics.focusRingWidth >= 2, `forced focus is ${forcedMetrics.focusRingWidth}px`);
  assert.equal(forcedMetrics.systemSelection, true, "forced colors did not expose system selection");
  assert.equal(forcedMetrics.systemField, true, "forced colors did not reach the register's own field");
  assert.equal(forcedMetrics.minimumTargetSize, true, "a visible Study control is smaller than 24px");
  assert.equal(forcedMetrics.hitTarget, true, "a Study control center is intercepted");
  assert.equal(forcedMetrics.zeroDuration, true, "reduced motion left a Study transition or animation running");
  assert.equal(forcedMetrics.studyLineForced.present, true, "forced colours did not reach the study line");
  assert.equal(forcedMetrics.studyLineForced.currentIsSystemSelection, true,
    "the current study must take the system's selection pair — forced colours has no ink and no seal");
  assert.equal(forcedMetrics.studyLineForced.targets, true, "a study line control is smaller than 24px in forced colours");
  const forcedShot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  pendingScreenshots.push({ file: "forced-colors.png", bytes: Buffer.from(forcedShot.result.data, "base64") });

  /* ── THE SHAPES A ROW OF CHIPS HAS TO SURVIVE ─────────────────────────────
     The floor, the ceiling and the narrow shell, each captured so the decisions
     about them can be LOOKED at rather than argued about.

       · one study — "All" does not appear, because a choice between a thing and
         itself teaches that the choice does not matter;
       · that same line waking, in the same session, when a second study is
         started from it — the one shape that cannot be reached by loading a
         fixture, because waking is something that happens to a line already on
         screen;
       · sixteen, the model's group cap, with names long enough to need the row
         to scroll and the + to refuse;
       · the narrow shell at 900px, where the rail becomes a bottom bar and the
         study line is the only control that switches studies at all. */
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "forced-colors", value: "none" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ],
  });

  const loadShape = async (workspace) => {
    await driver.evaluate(`window.api.settings.set({
      theme: "light",
      material: "solid",
      studyWorkspace: ${JSON.stringify(workspace)},
      sidebarCollapsed: true,
      marginVisible: true,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" }
    })`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await cdp.send("Page.bringToFront");
    await driver.waitFor(`document.querySelectorAll("[data-study-line-chip]").length === ${workspace.groups.length}`, 20_000);
    /* AND THEN SETTLE, because a chip that exists is not a chip that has
       arrived. Every chip enters on `scripture-study-chip-in`, 150ms of
       `translateX(-4px)` — so a `getBoundingClientRect()` taken the instant the
       gate above comes true reads the chip up to 4px LEFT of where it lives,
       at whatever fraction of the entrance the round trip happened to land on.

       That is what the first chip's position flaked on until 2026-07-30. The
       shape reads each measured their own load mid-entrance, so the same
       unmoved chip came back 52-point-something on one load and 53-point-
       something on the next, the rounding fell either side, and the assertion
       failed about twice in six runs in both directions. It was never sub-pixel
       layout: it was an animation being measured while it ran. `settle()`
       finishes it, which is the position the chip holds for the rest of its
       life and the only one worth asserting on. */
    await driver.settle();
  };

  await loadShape(shapeFixture(1, SHAPE_LABELS));
  const floor = await driver.evaluate(`(() => {
    const chip = document.querySelector("[data-study-line-chip]");
    const line = document.querySelector("[data-study-line]");
    return {
      state: line.getAttribute("data-study-line-state"),
      current: chip.getAttribute("aria-current"),
      lineHeight: line.getBoundingClientRect().height,
      chipLeft: chip.getBoundingClientRect().left,
      startDisabled: Boolean(document.querySelector("[data-study-start][data-study-start-disabled]")),
      ink: getComputedStyle(chip).color,
      weight: getComputedStyle(chip).fontWeight,
    };
  })()`);
  assert.equal(floor.state, "resting", "one study is not a choice, so the line rests");
  assert.equal(floor.current, null, "a resting line states no selection: there is nothing to be current among");
  assert.equal(floor.lineHeight, 24, "the band keeps its height at the floor — the frame does not move");
  assert.equal(floor.startDisabled, false, "one study is nowhere near the cap");
  await captureBand("study-line-single.png");

  /* ── THE LINE WAKES, IN ONE SITTING ───────────────────────────────────────
     A study is started from the floor and the first name is measured again,
     WITHOUT reloading. That is the claim as the component states it — "chips
     become chips when a second study is born; the line wakes up rather than
     re-laying out" — and waking is something that happens to a line that is
     already on screen. Two page loads cannot witness it: they witness two
     lines that were never the same line.

     Until 2026-07-30 this was asked across the two `loadShape` reloads below,
     comparing the sixteen-study row's first chip against the resting name from
     the previous load. Two things were wrong with that and only one of them was
     the flake. The flake was the entrance animation — see `loadShape`, which
     settles now — and it is fixed there, for every shape read.

     The other was this comparison itself. Two loads produce two lines, and
     nothing a reload can show you is a line WAKING; at best it is two lines
     that agree. So the claim is put the way the component states it, to the
     line that is on screen: start a study from the floor and look again. The
     two reads then share a layout root and a font pass, so `left` is the same
     float or the line really did move. There is no tolerance here and none is
     wanted — a tolerance would only have hidden the animation. */
  await driver.evaluate(`document.querySelector("[data-study-start]")?.click()`);
  /* A new study opens its own chip's naming field — see `namingRequest` in
     StudyLine.tsx — so the second chip is a form, not a chip, until the name is
     settled. Escape abandons the name and leaves the derived reference
     standing, which is the two-study line at rest and the state to measure. */
  await driver.waitFor(`Boolean(document.activeElement?.closest("[data-study-line-rename]"))`);
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.querySelector("[data-study-line-rename]")
    && document.querySelectorAll("[data-study-line-chip]").length === 2`);
  await driver.settle();
  const woke = await driver.evaluate(`(() => {
    const line = document.querySelector("[data-study-line]");
    const chips = [...document.querySelectorAll("[data-study-line-chip]")];
    return {
      state: line.getAttribute("data-study-line-state"),
      chips: chips.length,
      current: chips.filter((chip) => chip.getAttribute("aria-current") === "true").length,
      chipLeft: chips[0].getBoundingClientRect().left,
      lineHeight: line.getBoundingClientRect().height,
    };
  })()`);
  assert.equal(woke.chips, 2, "starting a study from the floor did not give the line a second chip");
  assert.equal(woke.state, "chips", "a second study is a choice, so the resting line becomes chips");
  assert.equal(woke.current, 1, "the study just started is the one the page is in, and it is the only current one");
  assert.equal(woke.lineHeight, 24, "the band keeps its height when it wakes — the frame does not move");
  assert.equal(woke.chipLeft, floor.chipLeft,
    `the line wakes up rather than re-laying out — the first name moved from ${floor.chipLeft} to ${woke.chipLeft}`);
  await captureBand("study-line-woken.png");

  await loadShape(shapeFixture(16, SHAPE_LABELS));
  const ceiling = await driver.evaluate(`(() => {
    const row = document.querySelector(".scripture-study-line-chips");
    const chips = [...document.querySelectorAll("[data-study-line-chip]")];
    return {
      state: document.querySelector("[data-study-line]").getAttribute("data-study-line-state"),
      chips: chips.length,
      sealed: chips.filter((chip) => chip.querySelector(".scripture-study-chip-seal")).length,
      current: chips.filter((chip) => chip.getAttribute("aria-current") === "true").length,
      scrolls: row.scrollWidth > row.clientWidth + 2,
      fades: row.classList.contains("is-scrollable-right"),
      startDisabled: Boolean(document.querySelector("[data-study-start][data-study-start-disabled]")),
      truncated: chips.some((chip) => {
        const label = chip.querySelector(".scripture-study-chip-label");
        return label.scrollWidth > label.clientWidth + 1;
      }),
      lineHeight: document.querySelector("[data-study-line]").getBoundingClientRect().height,
    };
  })()`);
  assert.equal(ceiling.state, "chips", "sixteen studies is a choice, so the line draws chips");
  assert.equal(ceiling.chips, 16, "the model's cap is sixteen studies and the line draws all of them");
  assert.equal(ceiling.current, 1, "exactly one study is current");
  // Half the shape fixture's studies carry a custom name and half keep the
  // reference the app derived. The seal marks the naming and nothing else.
  assert.equal(ceiling.sealed, 8, "the seal marks a named study, not every study");
  /* THE FIRST CHIP'S POSITION IS NOT ASKED HERE. It used to be — this row's
     first chip against the resting name from the previous load — and that is
     the comparison that flaked; it moved above on 2026-07-30, to the one
     session where the line actually wakes. What sixteen studies is for is what
     follows: a row that pans, a fade that says so, and a + that refuses. */
  assert.equal(ceiling.scrolls, true, "sixteen names do not fit; the row pans rather than squeezing them");
  assert.equal(ceiling.fades, true, "an overflowing row says so with the strip's own edge fade");
  assert.equal(ceiling.startDisabled, true, "at the cap the + stays in the row and stops responding");
  assert.equal(ceiling.lineHeight, 24, "the row may not grow to fit its contents");
  await captureBand("study-line-many.png");

  // The narrow shell. The rail becomes a 56px bottom bar with no switcher in
  // it, so the line is the only way left to change study — it stays, it sheds
  // the drag band a bottom-bar shell has no title bar for, and the frame's top
  // edge is the same 54 it is at every other width.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  await driver.waitFor(`window.innerWidth === 900
    && getComputedStyle(document.querySelector("[data-study-line]")).display !== "none"`);
  const narrow = await driver.evaluate(`(() => {
    const line = document.querySelector("[data-study-line]");
    const bar = document.querySelector("[data-study-workspace-bar]");
    const style = getComputedStyle(line);
    return {
      visible: line.getBoundingClientRect().height > 0,
      frameTop: bar.getBoundingClientRect().bottom - line.getBoundingClientRect().top,
      drags: (style.webkitAppRegion ?? style.appRegion) === "drag",
      bottomBar: document.querySelector(".sidebar").getBoundingClientRect().height <= 72,
    };
  })()`);
  assert.equal(narrow.visible, true, "the narrow shell keeps the only control that switches studies");
  assert.equal(narrow.frameTop, 54, `the frame's top edge is ${narrow.frameTop} in the narrow shell, not 54`);
  assert.equal(narrow.drags, false, "a shell with navigation under the thumb has no title bar to drag");
  assert.equal(narrow.bottomBar, true, "the narrow shell fixture did not reach the bottom-bar rail");
  await captureBand("study-line-narrow.png");
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  mkdirSync(OUTPUT_DIR, { recursive: true });
  /* One capture per row of the matrix, plus the one named state capture.
     Writing an empty list would leave the PASS line below claiming captures
     that were never taken — that is what this is for, and it stands.

     It compared `pendingScreenshots.length` against `THEMES.length` alone until
     2026-07-30, which had not been reachable since the paper-tabs capture was
     added: the matrix has two "light" rows (solid and translucent), so the
     `theme.id === "light"` guard fired twice, one write overwrote the other,
     and the tally read 8 against 6. Counting is what let a duplicate pass for
     coverage, so the check is on the FILENAMES now — a row that captures twice
     and a row that never captures are both visible in a sorted list, and
     neither is visible in a total. */
  const expectedCaptures = [
    ...THEMES.map((theme) => theme.file),
    "paper-tabs.png",
    "study-line.png",
    "study-line-switched.png",
    "study-line-single.png",
    "study-line-woken.png",
    "study-line-many.png",
    "study-line-narrow.png",
    "forced-colors.png",
  ].sort();
  assert.deepEqual(
    pendingScreenshots.map((capture) => capture.file).sort(),
    expectedCaptures,
    "every atmosphere/material row must capture exactly once, plus the clean tab state",
  );
  for (const capture of pendingScreenshots) {
    writeFileSync(join(OUTPUT_DIR, capture.file), capture.bytes);
  }
  console.log(`PASS study workspace bar: ${THEMES.length} identical-fixture theme captures + clean tab state + study line (switch, one, waking, sixteen, narrow) + forced-colors/reduced-motion`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}\nElectron log:\n${childLog}`);
} finally {
  cdp?.socket.close();
  await terminateChild(child, childState);
  rmSync(qaRoot, { recursive: true, force: true });
}
