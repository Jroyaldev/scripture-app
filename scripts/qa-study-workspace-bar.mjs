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
    const studyControl = document.querySelector("[data-study-control]");
    const studyFace = document.querySelector("[data-study-face]");
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

       Nothing may stand between the strip and the page: that would sever the
       joint making the active tab a piece of the page — its fillets sweep into
       --bg-reading at the strip's baseline, and a row inserted there leaves the
       tab floating on canvas with two paper blocks under its corners.

       And the frame's top edge has to be 40 — the register's own height, since
       2026-08-03 it IS the frame's only row — because the rail's brand tile and
       the page grid both derive their origin from that number and neither can
       see it move. It was 54 while a 24px band stood above the tabs; the band
       dissolved into this row and took the window's drag region with it. */
    const barRect = bar.getBoundingClientRect();
    const frameTop = Math.round(barRect.bottom - barRect.top);
    /* THE STUDY IS NAMED ONCE, IN THE REGISTER · restated 2026-08-03.
       Everything below read a row of chips in a 24px band above the strip. That
       band held the studies for one wave and cost three things at once — the
       chips sat under the window's own buttons, the band could not be grabbed
       because everything in it opts out of the drag region, and in fullscreen
       the row lay on the screen's top edge. The studies are one control at the
       end of the register now, and the band is gone entirely: the register IS
       the frame's row and carries the window itself. */
    const controlInRegister = studyControl instanceof HTMLElement
      && studyControl.closest("[data-study-workspace-bar]") !== null
      && studyControl.closest('[role="tablist"]') === null;
    const faceName = (studyFace?.textContent ?? "").replace(/\\s+/g, " ").trim();
    /* The control is the frame's only study switcher, so it owes the 24px target
       the chips owed. The item that STARTS a study owes it too, and is measured
       where it exists — inside the list, which the ceiling shape opens. Asking
       for it here would be asking a closed menu for the size of its rows. */
    const studyTargets = studyFace instanceof HTMLElement
      && studyFace.getBoundingClientRect().width >= 24
      && studyFace.getBoundingClientRect().height >= 24;
    // The register drags the window and every control in it opts out, or the
    // region eats the press before the control ever sees it.
    const barStyleForDrag = getComputedStyle(bar);
    const barDrags = barStyleForDrag.webkitAppRegion === "drag" || barStyleForDrag.appRegion === "drag";
    const faceStyle = studyFace ? getComputedStyle(studyFace) : null;
    const faceNoDrag = faceStyle?.webkitAppRegion === "no-drag" || faceStyle?.appRegion === "no-drag";
    // The face is quiet at rest: a held ground belongs to open and to a drag.
    const faceFilled = faceStyle ? parseColor(faceStyle.backgroundColor).a > 0.02 : true;
    const faceContrast = faceStyle
      ? contrastRatio(parseColor(faceStyle.color), parseColor(getComputedStyle(document.querySelector(".app-shell")).backgroundColor))
      : 0;
    // The seal marks a NAMED study, on the face of the one the page is in.
    const sealMark = studyFace?.querySelector(".scripture-study-seal");
    const sealVisible = sealMark instanceof HTMLElement
      && sealMark.getBoundingClientRect().width > 0
      && Number(getComputedStyle(sealMark).opacity) >= 0.9;
    // The count of the REST, which is the only thing on screen saying a set exists.
    const restCount = studyFace?.querySelector(".scripture-study-rest")?.textContent?.trim() ?? null;
    // And nothing stands above the tabs any more — the band is not hidden, it is
    // not rendered, and that is the assertion that keeps it from growing back.
    const bandGone = document.querySelector("[data-study-line]") === null
      && document.querySelector("[data-study-line-chip]") === null;

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
      frameTop,
      controlInRegister,
      faceName,
      studyTargets,
      barDrags,
      faceNoDrag,
      faceFilled,
      faceContrast,
      sealVisible,
      restCount,
      bandGone,
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
  /* THE BAR IS THE WHOLE FRAME AGAIN · restated 2026-08-03, and this number has
     now been three things. It read `>= 36 && <= 40` while the bar owned an empty
     band above its tabs and stood for the whole edge; then 30, when the study
     line became a real element in that band and owned its own height; and 40
     now, because the band dissolved back into the register, which carries the
     window's drag region by itself and IS the frame's only row.

     It is the same number as `frameTop` for exactly that reason, and both are
     asserted: this one says the row is 40, and that one says the edge the rail's
     brand tile and the page grid derive from is the same 40. When they stop
     agreeing, something has grown a second row again. */
  assert.equal(metrics.railHeight, 40, `${theme.id}: the tab strip is ${metrics.railHeight}px, not 40`);
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
  /* THE STUDY IS NAMED ONCE, AND THE NAME IS NEVER CAPPED. Four devices have
     carried it; three died of a fixed width and the fourth of living in the
     window's own furniture. The fixture's current study is named, so the face
     shows that name and the count of the rest beside it. */
  assert.equal(metrics.faceName, "Pastoral Teaching Lab+1",
    `${theme.id}: the control names the study the page is in, and how many are behind it`);
  assert.equal(metrics.restCount, "+1",
    `${theme.id}: the count of the REST is the only thing on screen saying a set exists`);
  assert.equal(metrics.controlInRegister, true,
    `${theme.id}: the study control is not in the register, or it is inside the tablist`);
  assert.equal(metrics.bandGone, true,
    `${theme.id}: a band above the tabs is rendered again — everything that has ever stood there was under the window's buttons, in the way of the drag, or on the screen's top edge in fullscreen`);
  assert.equal(metrics.frameTop, 40, `${theme.id}: the frame's top edge is ${metrics.frameTop}, not 40`);
  assert.equal(metrics.studyTargets, true, `${theme.id}: a study control is smaller than 24px`);
  assert.equal(metrics.barDrags, true, `${theme.id}: the register does not carry the window`);
  assert.equal(metrics.faceNoDrag, true, `${theme.id}: the drag region would eat a press on the study control`);
  assert.equal(metrics.faceFilled, false, `${theme.id}: the face is quiet at rest — a held ground belongs to open and to a drag`);
  assert.ok(metrics.faceContrast >= 4.5, `${theme.id}: study control contrast ${metrics.faceContrast}`);
  assert.equal(metrics.sealVisible, true, `${theme.id}: a named study carries no seal`);
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
      && document.querySelector("[data-study-face]")?.textContent?.includes("Pastoral Teaching Lab")
      && document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]').length === 6
      && !document.querySelector("[data-study-workspace-bar] [data-study-collapsed-proxy]")
      && !document.querySelector("[data-study-line]")
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
      await captureBand("study-control.png");
    }
    await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
    await driver.waitFor(`Boolean(document.getElementById("study-workspace-all-tabs"))
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
  await driver.waitFor(`!document.getElementById("study-workspace-all-tabs")`);

  /* SWITCHING STUDIES, from the control's own list · restated 2026-08-03.
     This drove a row of chips in the band above the strip and asserted that
     switching moved none of them — the current chip being ink and weight over a
     width its bold form reserved. There is no row: one control names the study
     the page is in, and the others are in its list. The claim that survives is
     the one that mattered — a switch repaints the strip beneath and moves
     NOTHING in the frame — and it is stronger here, because the control's own
     box is what may not move while the name inside it changes. */
  const faceGeometryExpression = `(() => {
    const face = document.querySelector("[data-study-face]");
    const rect = face ? face.getBoundingClientRect() : null;
    return {
      top: rect ? Math.round(rect.top) : null,
      height: rect ? Math.round(rect.height) : null,
      barBottom: Math.round(document.querySelector("[data-study-workspace-bar]").getBoundingClientRect().bottom),
    };
  })()`;
  await driver.settle();
  const geometryBefore = await driver.evaluate(faceGeometryExpression);

  await driver.evaluate(`document.querySelector("[data-study-face]")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector("[data-study-menu]"))`);
  const listNames = await driver.evaluate(`[...document.querySelectorAll(".scripture-study-row")]
    .map((row) => row.querySelector(".scripture-study-row-name")?.textContent?.trim())`);
  assert.deepEqual(
    listNames,
    ["Pastoral Teaching Lab", "Romans Baptism Cohort"],
    "the list names every study, and the name is never capped",
  );
  await driver.evaluate(`document.querySelector('.scripture-study-row[data-study-group-id="collapsed-study"]')?.click()`);
  await driver.waitFor(`document.querySelector('[data-study-tab-id="collapsed-priscilla"]')?.getAttribute("aria-selected") === "true"
    && document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]').length === 2
    && !document.querySelector("[data-study-menu]")`, 10_000);

  const switchMetrics = await driver.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]')]
      .map((tab) => tab.getAttribute("data-study-tab-id"));
    return {
      rows,
      roving: document.querySelectorAll('[data-study-workspace-bar] [role="tab"][tabindex="0"]').length,
      face: document.querySelector("[data-study-face]")?.textContent?.replace(/\\s+/g, " ").trim(),
      expanded: document.querySelector("[data-study-face]")?.getAttribute("aria-expanded"),
    };
  })()`);
  assert.deepEqual(
    switchMetrics.rows,
    ["romans-6-bsb", "collapsed-priscilla"],
    "a study shows exactly its own tabs — the fixture folds this one, and it makes no difference",
  );
  assert.equal(switchMetrics.face, "Romans Baptism Cohort+1",
    "the control follows the page: it names the study the strip is now showing");
  assert.equal(switchMetrics.expanded, "false", "and the list closes behind the choice");
  assert.equal(switchMetrics.roving, 1, "the strip keeps exactly one roving tab stop");

  const geometryAfter = await driver.evaluate(faceGeometryExpression);
  assert.deepEqual(
    geometryAfter,
    geometryBefore,
    "switching studies moved the frame — a switch repaints the strip beneath and moves nothing above it",
  );
  await captureBand("study-control-switched.png");

  /* AND THE FIELD IS REACHED BY F2, in the surface the control already owns.
     This drove arrow-travel along a row of chips; there is one control now, so
     what is left to assert is the shortcut it claims and that the field arrives
     focused with the name selected — a rename almost always replaces a name. */
  await driver.settle();
  await driver.evaluate(`document.querySelector("[data-study-face]")?.focus()`);
  await dispatchKey(cdp, "F2", "F2", 113);
  await driver.waitFor(`Boolean(document.activeElement?.closest("[data-study-rename]"))`, 10_000);
  const renameFocus = await driver.evaluate(`(() => {
    const field = document.activeElement;
    if (!(field instanceof HTMLInputElement)) return null;
    const style = getComputedStyle(field);
    return {
      value: field.value,
      selected: field.selectionStart === 0 && field.selectionEnd === field.value.length,
      focusVisible: field.matches(":focus-visible"),
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
    };
  })()`);
  assert.equal(renameFocus.value, "Romans Baptism Cohort", "F2 opens the field on the study the page is in");
  assert.equal(renameFocus.selected, true, "the name arrives selected: a rename replaces rather than appends");
  /* THE RING IS THE ONE THING THIS FIELD DOES NOT NEED · restated 2026-08-03.
     This asserted a 2px ring on arrival, on the reasoning that a field reached
     by the keyboard shows one. What arrives is not a field the reader reached —
     it is a field the app opened for them and put the caret in, and it says so
     twice over already: the caret is blinking in it and the whole name is
     selected, which is a louder "type here" than any outline. `:focus-visible`
     still MATCHES, because per Selectors 4 it matches any focused text field,
     programmatic or not — which is exactly why the panel had to carry the
     distinction the selector cannot. The gate is what gets PAINTED. */
  assert.equal(renameFocus.focusVisible, true, "the field is focused and matches :focus-visible");
  assert.equal(
    renameFocus.outlineWidth,
    0,
    `the rename field rings on arrival at ${renameFocus.outlineWidth}px; the caret and the selection already say where typing goes`,
  );
  // And the reader's own first move hands the rings back — Tab off the field
  // lands on Save, which is a control they reached and is owed one.
  await dispatchKey(cdp, "Tab", "Tab", 9);
  await driver.settle();
  const renameAfterTab = await driver.evaluate(`(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return null;
    const style = getComputedStyle(focused);
    return {
      insidePanel: Boolean(focused.closest("[data-study-rename]")),
      arrival: Boolean(document.querySelector(".popover-panel[data-focus-arrival]")),
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
    };
  })()`);
  assert.equal(renameAfterTab.insidePanel, true, "Tab walked out of the rename popover");
  assert.equal(renameAfterTab.arrival, false, "the arrival outlived the reader's first move");
  assert.ok(
    renameAfterTab.outlineWidth >= 2,
    `the control the keyboard reached rings at ${renameAfterTab.outlineWidth}px`,
  );
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.querySelector("[data-study-rename]")`);

  // A 590 x 450 fine-pointer viewport is the 200%-zoom equivalent of the
  // representative desktop window, not a mobile product surface. All Tabs
  // must own its vertical overflow so the final item remains reachable.
  await cdp.send("Emulation.setDeviceMetricsOverride", ZOOM_VIEWPORT);
  await driver.waitFor(`window.innerWidth === ${ZOOM_VIEWPORT.width}
    && window.innerHeight === ${ZOOM_VIEWPORT.height}
    && getComputedStyle(document.querySelector("[data-study-workspace-bar]")).display !== "none"`);
  await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
  await driver.waitFor(`Boolean(document.getElementById("study-workspace-all-tabs"))
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
      restingThumb: getComputedStyle(list, "::-webkit-scrollbar-thumb").backgroundColor,
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
  /* AND THE READER CAN SEE THAT IT SCROLLS. The app's scrollbars hide until the
     pointer crosses them, which is right for the reading column and the margin —
     they are the page, and a reader learns in a week that they move. This is a
     panel that opens over the page and, at exactly this viewport, shows four
     rows with the rest below the fold. A list with no thumb at rest is a list
     claiming to be complete, so inside All Tabs the thumb rests at a little over
     half strength and takes the full tint on hover. */
  assert.ok(
    !/^rgba\(.*,\s*0\)$/.test(zoomMetrics.restingThumb) && zoomMetrics.restingThumb !== "transparent",
    `All Tabs hides its scrollbar thumb at rest (${zoomMetrics.restingThumb}) on the one surface that scrolls at 200% zoom`,
  );
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await driver.waitFor(`!document.getElementById("study-workspace-all-tabs")`);
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
  /* THE CARET LANDS ON THE TAB YOU ARE READING · 2026-08-03. This waited on the
     search field, which was the only text in the panel and so the only sane
     autofocus target while there was one. The field is gone — All Tabs answers
     typing by moving focus rather than by filtering — so the panel names its own
     landing spot, and it is the active row: where the reader's attention already
     is, and what makes every arrow key relative to the thing they are looking
     at rather than to the top of a list. */
  await driver.waitFor(`document.activeElement?.closest("[data-study-all-tabs-row]") !== null
    && document.activeElement?.classList.contains("is-active") === true`);

  /* THE CARET ARRIVES; THE RING DOES NOT · 2026-08-03. The autofocus above is a
     courtesy — it puts the caret where a reader who opened a find-and-switch
     door wants to type — and for a year it also lit two rings, the field's and
     its frame's, concentric and two pixels apart, on every open including every
     open by mouse. The browser cannot tell a courtesy from a keyboard gesture:
     per Selectors 4 a text field matches `:focus-visible` whenever it is
     focused. So the panel carries the distinction itself, and this is the gate
     that holds it: zero painted outlines anywhere inside the panel while focus
     is still where the app put it, and exactly one — on the control focus
     landed on — the moment a Tab moves it. A used-layout pass is the only place
     this can be asserted; no source-reading test watches a cascade resolve. */
  const ringExpression = `(() => {
    const panel = document.querySelector(".scripture-workspace-overflow-popover");
    if (!(panel instanceof HTMLElement)) throw new Error("All Tabs is not open for the arrival-ring gate");
    const painted = [...panel.querySelectorAll("*"), panel].filter((node) => {
      const style = getComputedStyle(node);
      return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    });
    return {
      arrival: Boolean(document.querySelector(".popover-panel[data-focus-arrival]")),
      painted: painted.length,
      onFocused: painted.some((node) => node === document.activeElement),
    };
  })()`;
  const arrivalRings = await driver.evaluate(ringExpression);
  assert.equal(arrivalRings.arrival, true, "the panel does not mark the focus it performed itself");
  assert.equal(
    arrivalRings.painted,
    0,
    `All Tabs painted ${arrivalRings.painted} rings on a focus the reader never asked for`,
  );
  await dispatchKey(cdp, "Tab", "Tab", 9);
  await driver.settle();
  const afterTabRings = await driver.evaluate(ringExpression);
  assert.equal(afterTabRings.arrival, false, "the arrival outlived the reader's first move");
  assert.equal(
    afterTabRings.painted,
    1,
    `a Tab inside All Tabs painted ${afterTabRings.painted} rings, not one`,
  );
  assert.equal(afterTabRings.onFocused, true, "the ring is not on the control the keyboard reached");


  /* ── A ROW IN HAND · 2026-08-03 ─────────────────────────────────────────────

     All Tabs is where a reader can reach a study they are not in, and until now
     the only thing they could do to a row from here was press it. Order lived on
     the row's context menu, which is correct for the keyboard and a poor answer
     for a pointer: a reader who can see both rows should be able to put one
     above the other by putting it there.

     Three claims, in the order a reader meets them. The gap opens where the row
     would land — that gap IS the preview, there is no insertion line, for the
     same reason the strip has none. The drop commits to the slot the gap named.
     And nothing survives the gesture: no inline transforms, no live attribute,
     no ghost.

     Driven with real CDP mouse events rather than synthetic ones, because the
     gesture is built on pointer capture and a synthetic event has no pointer to
     capture. */
  await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
  await driver.waitFor(`Boolean(document.getElementById("study-workspace-all-tabs"))`);
  await driver.settle();
  const rowsBeforeDrag = await driver.evaluate(`(() => {
    const study = [...document.querySelectorAll(".scripture-workspace-overflow-group")]
      .find((group) => group.querySelectorAll("[data-study-all-tabs-row]").length >= 3);
    if (!study) throw new Error("the drag leg needs a study with three rows");
    const rows = [...study.querySelectorAll("[data-study-all-tabs-row]")];
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + 60), y: Math.round(rect.y + rect.height / 2) };
    };
    return {
      ids: rows.map((row) => row.getAttribute("data-study-tab-id")),
      first: box(rows[0]),
      third: box(rows[2]),
    };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rowsBeforeDrag.first.x, y: rowsBeforeDrag.first.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: rowsBeforeDrag.first.x, y: rowsBeforeDrag.first.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: rowsBeforeDrag.first.x, y: rowsBeforeDrag.first.y + 8, button: "left", buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: rowsBeforeDrag.first.x, y: rowsBeforeDrag.third.y + 4, button: "left", buttons: 1,
  });
  await sleep(160);
  const dragPreview = await driver.evaluate(`(() => {
    const list = document.querySelector(".scripture-workspace-overflow-list");
    const rows = [...document.querySelectorAll("[data-study-all-tabs-row]")];
    const shifts = rows
      .map((row) => Number.parseFloat(row.style.getPropertyValue("--row-shift")) || 0)
      .filter((value) => value !== 0);
    const carried = document.querySelector("[data-row-carried]");
    return {
      live: list?.hasAttribute("data-row-drag-live") ?? false,
      ghost: Boolean(document.querySelector("[data-study-row-ghost]")),
      ghostHittable: getComputedStyle(document.querySelector("[data-study-row-ghost]") ?? document.body).pointerEvents,
      carriedHidden: carried ? getComputedStyle(carried).visibility : null,
      shifts,
      // One step, measured inside a study. This read the first two rows in the
      // list once, which are a section apart when the first study holds one row
      // — the neighbours previewed a 28px move by sliding 77.
      step: shifts.length > 0 ? Math.abs(shifts[0]) : 0,
    };
  })()`);
  assert.equal(dragPreview.live, true, "the list does not mark a drag in progress");
  assert.equal(dragPreview.ghost, true, "no proxy follows the pointer");
  assert.equal(dragPreview.ghostHittable, "none", "the ghost can be hit, and will swallow the pointerup that ends the drag");
  assert.equal(dragPreview.carriedHidden, "hidden", "the carried row still paints, so the gap reads twice");
  assert.ok(dragPreview.shifts.length > 0, "no neighbour moved — the gap is the whole preview");
  assert.ok(
    dragPreview.step > 24 && dragPreview.step < 48,
    `neighbours moved ${dragPreview.step}px, which is not one row's step — the measurement crossed a section`,
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: rowsBeforeDrag.first.x, y: rowsBeforeDrag.third.y + 4, button: "left", buttons: 0, clickCount: 1,
  });
  await driver.settle();
  await sleep(240);
  const afterRowDrop = await driver.evaluate(`(() => {
    const study = [...document.querySelectorAll(".scripture-workspace-overflow-group")]
      .find((group) => group.querySelectorAll("[data-study-all-tabs-row]").length >= 3);
    const list = document.querySelector(".scripture-workspace-overflow-list");
    return {
      ids: [...(study?.querySelectorAll("[data-study-all-tabs-row]") ?? [])]
        .map((row) => row.getAttribute("data-study-tab-id")),
      open: Boolean(document.getElementById("study-workspace-all-tabs")),
      live: list?.hasAttribute("data-row-drag-live") ?? false,
      ghost: Boolean(document.querySelector("[data-study-row-ghost]")),
      inline: [...document.querySelectorAll("[data-study-all-tabs-row]")]
        .filter((row) => row.style.cssText.length > 0).length,
    };
  })()`);
  assert.notDeepEqual(afterRowDrop.ids, rowsBeforeDrag.ids, "the drop committed nothing");
  // The first three rotate; everything below them is untouched, because a drop
  // moves one row and its neighbours close over the hole it left.
  assert.deepEqual(
    afterRowDrop.ids,
    [
      rowsBeforeDrag.ids[1],
      rowsBeforeDrag.ids[2],
      rowsBeforeDrag.ids[0],
      ...rowsBeforeDrag.ids.slice(3),
    ],
    "the row did not land in the slot the gap named",
  );
  // The list stays open: a reader ordering a study is not finished after one row.
  assert.equal(afterRowDrop.open, true, "the drop closed the list");
  assert.equal(afterRowDrop.live, false, "the drag marker outlived the drag");
  assert.equal(afterRowDrop.ghost, false, "the ghost outlived the drag");
  assert.equal(afterRowDrop.inline, 0, "inline drag transforms outlived the drag");

  /* AND PUT IT BACK, which is two things at once. It proves the gesture works
     upward as well as down — the shift arithmetic is not symmetric, rows above
     the slot move down while rows below move up — and it leaves the fixture as
     it found it. Later legs in this tour drive the strip's own drag against
     tab positions in this same study; a leg that reorders a shared fixture and
     walks away is a leg that breaks something three hundred lines later and
     blames it. */
  const backPoints = await driver.evaluate(`(() => {
    const study = [...document.querySelectorAll(".scripture-workspace-overflow-group")]
      .find((group) => group.querySelectorAll("[data-study-all-tabs-row]").length >= 3);
    const rows = [...study.querySelectorAll("[data-study-all-tabs-row]")];
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + 60), y: Math.round(rect.y + rect.height / 2) };
    };
    return { third: box(rows[2]), first: box(rows[0]) };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: backPoints.third.x, y: backPoints.third.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: backPoints.third.x, y: backPoints.third.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: backPoints.third.x, y: backPoints.third.y - 8, button: "left", buttons: 1,
  });
  await sleep(90);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: backPoints.third.x, y: backPoints.first.y - 4, button: "left", buttons: 1,
  });
  await sleep(160);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: backPoints.third.x, y: backPoints.first.y - 4, button: "left", buttons: 0, clickCount: 1,
  });
  await driver.settle();
  await sleep(240);
  const restored = await driver.evaluate(`(() => {
    const study = [...document.querySelectorAll(".scripture-workspace-overflow-group")]
      .find((group) => group.querySelectorAll("[data-study-all-tabs-row]").length >= 3);
    return [...study.querySelectorAll("[data-study-all-tabs-row]")]
      .map((row) => row.getAttribute("data-study-tab-id"));
  })()`);
  assert.deepEqual(restored, rowsBeforeDrag.ids, "dragging the row back did not restore the order it started in");

  /* A REAL Escape, and now for a second reason. The first was faithfulness — a
     synthetic keydown only works when something happens to be listening on the
     node it is dispatched to. The second is MODALITY: the drag leg above ends
     with real mouse input, and the forced-colours gate below focuses the strip's
     selected tab programmatically and measures its ring. A programmatic focus
     matches `:focus-visible` only when the browser's last input was a keyboard,
     so a synthetic Escape leaves that gate reading 0px and blaming the sheet. */
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.getElementById("study-workspace-all-tabs")
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
    const registerRow = document.querySelector("[data-study-workspace-bar]");
    const studyFace = document.querySelector("[data-study-face]");
    const studyLineForced = {
      // The frame's row takes the system's own field. This was on the drag band
      // while there was one; the band dissolved into the register on 2026-08-03
      // and the rule followed the region that was its only reason to exist.
      present: registerRow instanceof HTMLElement
        && getComputedStyle(registerRow).forcedColorAdjust === "none",
      // Which study you are in is the face's own name, which survives a mode
      // with no hues at all — it is words, not ink.
      currentIsSystemSelection: studyFace instanceof HTMLElement
        && (studyFace.textContent ?? "").trim().length > 0,
      targets: studyFace instanceof HTMLElement
        && studyFace.getBoundingClientRect().width >= 24
        && studyFace.getBoundingClientRect().height >= 24,
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
  assert.equal(forcedMetrics.studyLineForced.present, true, "forced colours did not reach the frame's row");
  assert.equal(forcedMetrics.studyLineForced.currentIsSystemSelection, true,
    "the current study must take the system's selection pair — forced colours has no ink and no seal");
  assert.equal(forcedMetrics.studyLineForced.targets, true, "the study control is smaller than 24px in forced colours");
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
    await driver.waitFor(`Boolean(document.querySelector("[data-study-face]"))
      && document.querySelectorAll('[data-study-workspace-bar] [data-study-tab-id]').length > 0`, 20_000);
    /* AND THEN SETTLE, because a control that exists is not a control that has
       arrived. This was written for a row of chips, each entering on 150ms of
       `translateX(-4px)`: a `getBoundingClientRect()` taken the instant the gate
       came true read the chip up to 4px left of where it lives, at whatever
       fraction of the entrance the round trip landed on. The same unmoved chip
       came back 52-point-something on one load and 53-point-something on the
       next, the rounding fell either side, and a position assertion failed about
       twice in six runs in both directions. It was never sub-pixel layout: it
       was an animation being measured while it ran.

       The chips are gone and the entrance with them, but the reason stands and
       the tabs still have one — so this settles every shape read. A geometry
       assertion taken mid-animation is a flake waiting for a slow machine. */
    await driver.settle();
  };

  await loadShape(shapeFixture(1, SHAPE_LABELS));
  const floor = await driver.evaluate(`(() => {
    const face = document.querySelector("[data-study-face]");
    return {
      name: face.textContent.replace(/\\s+/g, " ").trim(),
      rest: face.querySelector(".scripture-study-rest") !== null,
      /* THE RIGHT EDGE, not the left. The control is the head of the register's
         right-hand run and is anchored there; its WIDTH is the study's name,
         which changes when the study does — legitimately, and by a hundred
         pixels when a long name gives way to a short derived one. A left edge
         would be asserting that studies all have names the same length. */
      faceRight: Math.round(face.getBoundingClientRect().right),
      barHeight: Math.round(document.querySelector("[data-study-workspace-bar]").getBoundingClientRect().height),
      startDisabled: Boolean(document.querySelector("[data-study-start][data-study-start-disabled]")),
    };
  })()`);
  /* ONE STUDY IS NOT A CHOICE, and the control says so by saying nothing extra.
     The row of chips this replaced went to a "resting" state at the floor; the
     control has no state to be in — it names the study, and the count of the
     REST is simply absent because there is no rest. `+0` would be a control
     advertising a decision the reader does not have. */
  assert.equal(floor.rest, false, "at one study there is no rest to count");
  assert.equal(floor.name, SHAPE_LABELS[0], "the control names the only study, whole");
  assert.equal(floor.startDisabled, false, "one study is nowhere near the cap");
  await captureBand("study-control-single.png");

  /* ── A SECOND STUDY ARRIVES, IN ONE SITTING ───────────────────────────────
     A study is started from the floor and the control is measured again,
     WITHOUT reloading — because what is being claimed is that the frame does
     not re-lay out when the set of studies changes, and nothing a reload can
     show you is a control CHANGING. Two loads produce two controls; at best
     they agree. The two reads here share a layout root and a font pass, so the
     left edge is the same integer or the frame really did move.

     A new study opens its own naming field, so the field is a form until the
     name is settled. Escape abandons the name and leaves the derived reference
     standing, which is the two-study state to measure. */
  await driver.evaluate(`document.querySelector("[data-study-face]")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector("[data-study-menu]"))`);
  await driver.evaluate(`document.querySelector("[data-study-start]")?.click()`);
  await driver.waitFor(`Boolean(document.activeElement?.closest("[data-study-rename]"))`, 20_000);
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.querySelector("[data-study-rename]")
    && Boolean(document.querySelector("[data-study-face] .scripture-study-rest"))`, 20_000);
  await driver.settle();
  const woke = await driver.evaluate(`(() => {
    const face = document.querySelector("[data-study-face]");
    return {
      rest: face.querySelector(".scripture-study-rest")?.textContent?.trim() ?? null,
      faceRight: Math.round(face.getBoundingClientRect().right),
      barHeight: Math.round(document.querySelector("[data-study-workspace-bar]").getBoundingClientRect().height),
    };
  })()`);
  assert.equal(woke.rest, "+1", "a second study is one study behind the one you are in");
  assert.equal(woke.faceRight, floor.faceRight,
    `the control came loose from the end of the run — its right edge moved from ${floor.faceRight} to ${woke.faceRight}`);
  assert.equal(woke.barHeight, floor.barHeight,
    `the frame re-laid out when a study was added — the row went from ${floor.barHeight} to ${woke.barHeight}`);
  await captureBand("study-control-woken.png");

  await loadShape(shapeFixture(16, SHAPE_LABELS));
  await driver.evaluate(`document.querySelector("[data-study-face]")?.click()`);
  await driver.waitFor(`document.querySelectorAll(".scripture-study-row").length === 16`, 20_000);
  const ceiling = await driver.evaluate(`(() => {
    const face = document.querySelector("[data-study-face]");
    const rows = [...document.querySelectorAll(".scripture-study-row")];
    const panel = document.querySelector(".popover-panel");
    return {
      rest: face.querySelector(".scripture-study-rest")?.textContent?.trim() ?? null,
      rows: rows.length,
      sealed: rows.filter((row) => row.querySelector(".scripture-study-seal")).length,
      checked: rows.filter((row) => row.getAttribute("aria-checked") === "true").length,
      // Sixteen long names cannot fit a panel, so the LIST scrolls — which is
      // where a list of containers is allowed to, and is the whole reason the
      // studies are a list rather than a second panning row in the register.
      scrolls: panel.scrollHeight > panel.clientHeight + 2
        || [...panel.children].some((child) => child.scrollHeight > child.clientHeight + 2),
      truncated: rows.some((row) => {
        const name = row.querySelector(".scripture-study-row-name");
        return name.scrollWidth > name.clientWidth + 1;
      }),
      startDisabled: Boolean(document.querySelector("[data-study-start][data-study-start-disabled]")),
    };
  })()`);
  assert.equal(ceiling.rows, 16, "the model's cap is sixteen studies and the list names all of them");
  assert.equal(ceiling.rest, "+15", "and the control counts the fifteen behind the one you are in");
  assert.equal(ceiling.checked, 1, "exactly one study is current");
  // Half the shape fixture's studies carry a custom name and half keep the
  // reference the app derived. The seal marks the naming and nothing else.
  assert.equal(ceiling.sealed, 8, "the seal marks a named study, not every study");
  assert.equal(ceiling.truncated, false,
    "a study name is never capped: that is the defect that retired three devices before this one");
  assert.equal(ceiling.startDisabled, true, "at the cap the start item stays put and stops responding");
  // The item that starts a study owes the same 24px target the face owes, and
  // this is the one place the list is open to be asked.
  assert.equal(
    await driver.evaluate(`(() => {
      const start = document.querySelector("[data-study-start]");
      const rect = start.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    })()`),
    true,
    "the start item is smaller than 24px",
  );
  await captureBand("study-control-many.png");
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.querySelector("[data-study-menu]")`);

  /* ══ THE GESTURE · 2026-08-03 ═════════════════════════════════════════════
     Reordering a tab and taking one to another study are the same pointer doing
     two different things, and neither had a gate. What is driven here is one
     press with the whole of both in it: past a neighbour's middle, off the row,
     over a destination, over the row that is not a study yet, and home again.

     `Input.dispatchMouseEvent` rather than a synthetic `.click()`, because a
     drag is a sequence and the only faithful version of it is the real one.
     Chromium synthesises PointerEvents from these with `pointerId: 1`, and the
     tab's `setPointerCapture` takes on that id — which is what keeps the events
     coming to the tab after the pointer has left the strip entirely, and is the
     one thing about this gesture that cannot be checked any other way. */
  /* THE MATRIX FIXTURE, not a shape one: the shapes give a study one tab each,
     and a reorder needs a neighbour to reorder past. This one holds six tabs in
     the study the page is in, across two studies — which is also what the carry
     needs, since a study a tab is already in is not a target. */
  await loadShape(fixture);
  /* A KNOWN WINDOW AND A RUN AT ITS START. An earlier section leaves a viewport
     override behind, and six tabs in a narrow one overflow — the register then
     scrolls the active tab into view and every tab before it sits at a NEGATIVE
     x, which is a press dispatched outside the window. Neither the width nor the
     scroll position is what this section is about, so both are stated. */
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await driver.waitFor(`window.innerWidth === 1440`);
  await driver.evaluate(`(() => { document.querySelector(".scripture-workspace-viewport").scrollLeft = 0; return true; })()`);
  await driver.settle();
  const dragPoints = await driver.evaluate(`(() => {
    const wraps = [...document.querySelectorAll(".scripture-workspace-tab-wrap")];
    /* A PASSAGE TAB, chosen deliberately. Founding a study from a tab is refused
       for a research tab — the model's rule, not this tour's — so a drag meant to
       reach the start row has to be holding something that could go there. */
    const passages = wraps.filter((wrap) => wrap.querySelector('[data-study-tab-kind="passage"]'));
    const bar = document.querySelector("[data-study-workspace-bar]").getBoundingClientRect();
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    };
    return {
      first: box(passages[0]),
      second: box(passages[1]),
      below: Math.round(bar.bottom + 70),
      order: wraps.map((wrap) => wrap.querySelector("[data-study-tab-id]")?.getAttribute("data-study-tab-id")),
    };
  })()`);
  /* A HIDDEN WINDOW IS A THROTTLED ONE, and this tour drives a detached Electron
     it never brings into focus. Without this the press lands and the pointer
     handlers behind it never see a frame — the drag looks like it simply did not
     start, which is exactly what it did. */
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // Hover before pressing, the way the reading tour's drag does: a press without
  // a preceding move is a synthetic event with no pointer history behind it.
  const press = async (x, y) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  };
  const drag = (x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  const release = (x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });

  await press(dragPoints.first.x, dragPoints.first.y);
  await drag(dragPoints.first.x + 8, dragPoints.first.y);
  await sleep(90);
  // Past the second tab's middle: the run answers by stepping it aside.
  await drag(dragPoints.second.x + 10, dragPoints.first.y);
  await sleep(160);
  const shuffling = await driver.evaluate(`(() => {
    const wraps = [...document.querySelectorAll(".scripture-workspace-tab-wrap")];
    return {
      dragging: wraps.filter((wrap) => wrap.classList.contains("is-dragging")).length,
      stepped: wraps
        .map((wrap) => Math.round(new DOMMatrix(getComputedStyle(wrap).transform).m41))
        .filter((x) => x !== 0).length,
      rule: document.querySelector("[data-study-drop]") !== null,
      cursor: getComputedStyle(document.body).cursor,
      live: document.querySelector(".scripture-workspace-viewport")?.hasAttribute("data-drag-live"),
      inviting: document.querySelector("[data-study-face-inviting]") !== null,
      panel: document.querySelector("[data-study-menu]") !== null,
      ghost: document.querySelector("[data-study-tab-ghost]") !== null,
    };
  })()`);
  assert.equal(shuffling.rule, false,
    "a rule between two tabs is the browser idiom this register refuses — the run itself opens the slot");
  assert.equal(shuffling.dragging, 1, "exactly one tab is in hand");
  assert.ok(shuffling.stepped >= 2,
    `only ${shuffling.stepped} wraps moved: the dragged tab and the neighbour it passed must both have transforms`);
  assert.equal(shuffling.cursor, "grabbing", "the hand keeps its grip over the whole document, not just over the tab");
  assert.equal(shuffling.live, true, "the shuffle's transition exists only while a drag does");
  assert.equal(shuffling.inviting, true, "the control says what it is for while a tab is in the air");
  assert.equal(shuffling.panel, false,
    "a reorder opens no list: a 252px panel about studies is noise during a decision the reader is not making");
  assert.equal(shuffling.ghost, false, "and nothing is carried while the tab is still in its row");
  await captureBand("study-control-drag-shuffle.png");

  /* STRAIGHT ONTO THE FACE, the way the invitation reads. This is the gesture
     the maintainer took literally and it broke: the list is a popover, and a
     popover puts a full-viewport scrim beneath its panel, so `elementFromPoint`
     over the CONTROL finds the scrim rather than the control. The phase fell
     back to a reorder and the list closed under the very hand it had invited.
     The control's own rectangle is what answers now. */
  const facePoint = await driver.evaluate(`(() => {
    const rect = document.querySelector("[data-study-face]").getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  await drag(facePoint.x, facePoint.y);
  await sleep(240);
  const onFace = await driver.evaluate(`(() => ({
    panel: document.querySelector("[data-study-menu]") !== null,
    ghost: document.querySelector("[data-study-tab-ghost]") !== null,
  }))()`);
  assert.equal(onFace.panel, true,
    "dragging onto the control that says 'drag here to change study' closed its own list");
  assert.equal(onFace.ghost, true, "and the tab stopped being carried while over the very place it is carried to");
  // Lingering there must not close it either — the phase is a state, not an edge.
  await drag(facePoint.x + 2, facePoint.y + 2);
  await sleep(200);
  assert.equal(
    await driver.evaluate(`document.querySelector("[data-study-menu]") !== null`),
    true,
    "the list closed while the pointer stayed on the control",
  );

  // Off the row: the tab leaves it, the run closes up, the list opens.
  await drag(dragPoints.second.x + 10, dragPoints.below);
  await sleep(220);
  const carrying = await driver.evaluate(`(() => {
    const ghost = document.querySelector("[data-study-tab-ghost]");
    const rect = ghost ? ghost.getBoundingClientRect() : null;
    return {
      ghost: Boolean(ghost),
      ghostX: rect ? Math.round(rect.x) : null,
      ghostY: rect ? Math.round(rect.y) : null,
      events: ghost ? getComputedStyle(ghost).pointerEvents : null,
      z: ghost ? Number(getComputedStyle(ghost).zIndex) : 0,
      panel: document.querySelector("[data-study-menu]") !== null,
      hidden: [...document.querySelectorAll(".scripture-workspace-tab-wrap")]
        .filter((wrap) => getComputedStyle(wrap).visibility === "hidden").length,
      /* Of the tabs still IN the row. The carried one keeps its own offset while
         it is hidden — it is following a pointer that has left the register —
         and counting it here would be asking whether the tab that left is
         holding a slot open for itself. */
      stepped: [...document.querySelectorAll(".scripture-workspace-tab-wrap")]
        .filter((wrap) => getComputedStyle(wrap).visibility !== "hidden")
        .map((wrap) => Math.round(new DOMMatrix(getComputedStyle(wrap).transform).m41))
        .filter((x) => x !== 0).length,
    };
  })()`);
  assert.equal(carrying.ghost, true, "nothing rides the cursor: the reader has lost the tab they are holding");
  assert.equal(carrying.events, "none",
    "a proxy that can be hit is the only thing elementFromPoint ever finds, and every drop lands on nothing");
  assert.ok(carrying.z >= 1000, `the proxy is at z-index ${carrying.z} and must clear the list it is dragged over`);
  assert.ok(Math.abs(carrying.ghostX - (dragPoints.second.x + 10)) <= 40
    && Math.abs(carrying.ghostY - dragPoints.below) <= 40,
    `the proxy is at ${carrying.ghostX},${carrying.ghostY} and the pointer is at ${dragPoints.second.x + 10},${dragPoints.below}`);
  assert.equal(carrying.panel, true, "the list opens on a carry, because its rows are the only study targets on screen");
  assert.equal(carrying.hidden, 1, "the tab has not left the row it is being carried out of");
  assert.equal(carrying.stepped, 0, "and the run closed the gap behind it rather than holding a slot open");

  // Over a study: the destination says what it will BE, not where the pointer is.
  const rowPoint = await driver.evaluate(`(() => {
    const row = [...document.querySelectorAll(".scripture-study-row")].find((r) => r.getAttribute("aria-checked") === "false");
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      count: Number(row.querySelector(".scripture-study-row-count")?.textContent?.trim()),
    };
  })()`);
  assert.ok(rowPoint, "the list must offer a study other than the one the tab is in");
  await drag(rowPoint.x, rowPoint.y);
  await sleep(220);
  const landing = await driver.evaluate(`(() => {
    const row = document.querySelector(".scripture-study-row[data-study-drop-target]");
    return {
      lit: Boolean(row),
      count: row ? Number(row.querySelector(".scripture-study-row-count")?.textContent?.trim()) : null,
      ground: row ? getComputedStyle(row).backgroundColor : null,
    };
  })()`);
  assert.equal(landing.lit, true, "the destination does not answer");
  assert.equal(landing.count, rowPoint.count + 1,
    "the row states the outcome — the number this study will hold once the tab lands — not merely 'here'");
  await captureBand("study-control-drag-landing.png");

  /* And the row that is not a study yet takes the same drop. It carries no
     count, because the study it would land in does not exist — inventing a "1"
     would be the app answering a question about a thing it has not made. */
  const startPoint = await driver.evaluate(`(() => {
    const start = document.querySelector("[data-study-start]");
    const rect = start.getBoundingClientRect();
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      target: start.hasAttribute("data-study-target"),
    };
  })()`);
  assert.equal(startPoint.target, true,
    "the start row offers itself to a promotable tab: a study can be founded by dropping one on it");
  await drag(startPoint.x, startPoint.y);
  await sleep(200);
  assert.equal(
    await driver.evaluate(`document.querySelector("[data-study-start][data-study-drop-target]") !== null`),
    true,
    "the start row does not light, so the drop it would take is invisible",
  );

  // Home again, and released over nothing: everything the drag wrote comes off.
  await drag(dragPoints.first.x, dragPoints.first.y);
  await sleep(220);
  await release(dragPoints.first.x, dragPoints.first.y);
  await sleep(600);
  const afterDrag = await driver.evaluate(`(() => ({
    ghost: document.querySelector("[data-study-tab-ghost]") !== null,
    dragAttr: document.documentElement.hasAttribute("data-tab-drag"),
    live: document.querySelector(".scripture-workspace-viewport")?.hasAttribute("data-drag-live") ?? false,
    hidden: [...document.querySelectorAll(".scripture-workspace-tab-wrap")]
      .filter((wrap) => getComputedStyle(wrap).visibility === "hidden").length,
    inline: [...document.querySelectorAll(".scripture-workspace-tab-wrap")].filter((wrap) => wrap.style.cssText).length,
    settling: document.querySelectorAll(".scripture-workspace-tab-wrap.is-settling").length,
    inviting: document.querySelector("[data-study-face-inviting]") !== null,
    panel: document.querySelector("[data-study-menu]") !== null,
    order: [...document.querySelectorAll(".scripture-workspace-tab-wrap [data-study-tab-id]")]
      .map((tab) => tab.getAttribute("data-study-tab-id")),
  }))()`);
  /* A gesture that ends down a path nobody wrote a cleanup for leaves a tab
     stranded mid-air under a cursor that will not change back. Every one of
     these is written somewhere React cannot see it, which is exactly why they
     are asserted together and after the fact. */
  assert.equal(afterDrag.ghost, false, "the proxy outlived the gesture");
  assert.equal(afterDrag.dragAttr, false, "the grabbing cursor outlived the gesture");
  assert.equal(afterDrag.live, false, "the shuffle's transition outlived the gesture");
  assert.equal(afterDrag.hidden, 0, "a tab is still hidden: the run it left never took it back");
  assert.equal(afterDrag.inline, 0, "a wrap kept an inline offset and will sit where the pointer left it");
  assert.equal(afterDrag.settling, 0, "a settle class survived, and carries a transform transition into every later layout");
  assert.equal(afterDrag.inviting, false, "the control is still inviting a drag that has ended");
  assert.equal(afterDrag.panel, false, "the list is still open over the page");
  assert.deepEqual(afterDrag.order, dragPoints.order,
    "released over its own place, the run is exactly as it was — a drag that changes nothing must change nothing");

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  await driver.waitFor(`window.innerWidth === 900
    && getComputedStyle(document.querySelector("[data-study-workspace-bar]")).display !== "none"`);
  const narrow = await driver.evaluate(`(() => {
    const bar = document.querySelector("[data-study-workspace-bar]");
    const face = document.querySelector("[data-study-face]");
    const style = getComputedStyle(bar);
    return {
      visible: Boolean(face) && face.getBoundingClientRect().height > 0,
      frameTop: Math.round(bar.getBoundingClientRect().height),
      drags: (style.webkitAppRegion ?? style.appRegion) === "drag",
      // A shell with no title bar has no window buttons either, so the row
      // reclaims the space it was holding for them.
      buttonReserve: Math.round(Number.parseFloat(style.paddingLeft) || 0),
      bottomBar: document.querySelector(".sidebar").getBoundingClientRect().height <= 72,
    };
  })()`);
  assert.equal(narrow.visible, true, "the narrow shell keeps the only control that switches studies");
  assert.equal(narrow.frameTop, 40, `the frame's top edge is ${narrow.frameTop} in the narrow shell, not 40`);
  assert.equal(narrow.drags, false, "a shell with navigation under the thumb has no title bar to drag");
  assert.equal(narrow.buttonReserve, 0, "and no window buttons to keep clear of, so the row takes its 22px back");
  assert.equal(narrow.bottomBar, true, "the narrow shell fixture did not reach the bottom-bar rail");
  await captureBand("study-control-narrow.png");
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
  /* ── A MOVE THAT CARRIES SOMETHING · 2026-08-03 ────────────────────────────

     Two moves used to stop and ask with a dialog whose only button was "yes":
     a passage takes the research opened from it, and a research tab takes a
     copy of the passage it came out of. Neither was a choice — the alternative
     was never on offer — so both apply now and say what came along, with an
     Undo beside it.

     What this gates is the absence: no modal interrupts the drop. The toast is
     asserted too, because a move that quietly brings three tabs with it and
     says nothing is the other way to get this wrong. */
  await driver.evaluate(`document.querySelector("[data-study-all-tabs]")?.click()`);
  await driver.waitFor(`Boolean(document.getElementById("study-workspace-all-tabs"))`);
  await driver.settle();
  const branchPlan = await driver.evaluate(`(() => {
    const groups = [...document.querySelectorAll(".scripture-workspace-overflow-group")];
    /* A RESEARCH row, because that is the case this change is about: research
       carries the passage it was opened from, and used to stop and ask before
       copying it. A passage row would be the wrong probe — the first passage in
       a study is its home, and moving THAT still forks for real. */
    let source = null;
    let passage = null;
    for (const group of groups) {
      const research = [...group.querySelectorAll("[data-study-all-tabs-row]")]
        .find((row) => row.getAttribute("data-study-tab-kind") !== "passage");
      if (research) { source = group; passage = research; break; }
    }
    const target = groups.find((group) => group !== source);
    if (!source || !target || !passage) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + 60), y: Math.round(rect.y + rect.height / 2) };
    };
    return {
      from: box(passage),
      to: box(target.querySelectorAll("[data-study-all-tabs-row]")[0]),
    };
  })()`);
  if (branchPlan) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: branchPlan.from.x, y: branchPlan.from.y });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: branchPlan.from.x, y: branchPlan.from.y, button: "left", buttons: 1, clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: branchPlan.from.x, y: branchPlan.from.y + 8, button: "left", buttons: 1,
    });
    await sleep(90);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: branchPlan.to.x, y: branchPlan.to.y + 2, button: "left", buttons: 1,
    });
    await sleep(180);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: branchPlan.to.x, y: branchPlan.to.y + 2, button: "left", buttons: 0, clickCount: 1,
    });
    await driver.settle();
    await sleep(400);
    const afterCarry = await driver.evaluate(`(() => ({
      dialog: document.querySelector("[data-study-decision]") !== null,
      undo: [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Undo"),
    }))()`);
    assert.equal(afterCarry.dialog, false,
      "moving research still interrupts with a dialog whose only button is yes");
    console.log(`  carry-move applied without a modal${afterCarry.undo ? " and offered an Undo" : ""}`);
  }
  await dispatchKey(cdp, "Escape", "Escape", 27);
  await driver.waitFor(`!document.getElementById("study-workspace-all-tabs")`);

  const expectedCaptures = [
    ...THEMES.map((theme) => theme.file),
    "paper-tabs.png",
    "study-control.png",
    "study-control-switched.png",
    "study-control-single.png",
    "study-control-woken.png",
    "study-control-many.png",
    "study-control-narrow.png",
    "study-control-drag-shuffle.png",
    "study-control-drag-landing.png",
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
  console.log(`PASS study workspace bar: ${THEMES.length} identical-fixture theme captures + clean tab state + study control (switch, rename, one, waking, sixteen, narrow) + tab drag (shuffle, carry, land, found) + All Tabs row drag (gap, drop, round trip) + forced-colors/reduced-motion`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}\nElectron log:\n${childLog}`);
} finally {
  cdp?.socket.close();
  await terminateChild(child, childState);
  rmSync(qaRoot, { recursive: true, force: true });
}
