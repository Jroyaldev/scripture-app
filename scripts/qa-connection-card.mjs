/**
 * Visual/interaction gate for the authored-connection card.
 *
 * The fixture library and Electron profile both live under one mkdtemp root.
 * Fixture creation therefore never reads or mutates the user's current
 * library. The mutation-only mode additionally proves that a real in-flight
 * card command owns relationship/navigation focus, queues a dirty sibling
 * blur, and survives the first dropped post-commit renderer response with an
 * exact-once Retry.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import electronPath from "electron";

const WIDTHS = [640, 860, 1280];
const THEMES = ["light", "dark", "glass", "dark-glass"];
const THEME_LABELS = new Map([
  ["light", "Paper"],
  ["dark", "Ink"],
  ["glass", "Glass"],
  ["dark-glass", "Candlelight"],
]);
const HEIGHT = 900;
const GEOMETRY_EPSILON = 0.5;
const MUTATIONS_ONLY = process.argv.includes("--mutations-only");
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out opening the connection-card QA CDP socket"));
    }, 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Connection-card QA CDP socket failed during connection"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      reject(new Error("Connection-card QA CDP socket closed during connection"));
    };
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    request.resolve(message);
  };
  const rejectPending = (reason) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
  };
  ws.onclose = () => rejectPending(new Error("Electron CDP socket closed during the connection-card gate"));
  ws.onerror = () => rejectPending(new Error("Electron CDP socket failed during the connection-card gate"));
  const send = (method, params = {}, timeout = 20_000) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => {
      pending.delete(messageId);
      reject(new Error(`Timed out waiting for CDP ${method}`));
    }, timeout);
    pending.set(messageId, { resolve: resolvePromise, reject, timer });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ws, send };
}

async function waitForTarget(endpoint, childState, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (childState.spawnError) throw new Error(`Electron could not be spawned: ${childState.spawnError}`);
    if (childState.exited) {
      throw new Error(`Electron exited before exposing the renderer (code ${childState.code}, signal ${childState.signal})`);
    }
    try {
      const pages = await (await fetch(endpoint, { signal: AbortSignal.timeout(1_000) })).json();
      const page = pages.find((candidate) => candidate.title === "Pericope");
      if (page) return page;
    } catch {
      // The isolated Electron process may still be opening its debug socket.
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${endpoint}`);
}

async function availablePort() {
  const server = createServer();
  server.unref();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a connection-card QA port");
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
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
  if (!childState.exited) throw new Error("Connection-card QA Electron process did not terminate");
}

function createDriver(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_200));
    }
    return response.result?.result?.value;
  };

  const waitFor = async (expression, timeout = 10_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(80);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };

  return { evaluate, waitFor };
}

async function setTheme(driver, theme) {
  const current = await driver.evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await driver.evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".theme-picker-popover"))`);
  const changed = await driver.evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  assert.equal(changed, true, `missing theme ${theme}`);
  await driver.waitFor(`document.querySelector(".app-shell")?.dataset.theme === ${JSON.stringify(theme)}`);
}

async function settle(driver) {
  await driver.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    return true;
  })()`);
}

async function waitForStableCard(driver) {
  let previous = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const snapshot = await driver.evaluate(`(() => {
      const card = document.querySelector(".connection-card");
      const inspector = document.querySelector(".margin-connection-inspector");
      const study = document.querySelector(".margin-study-content");
      if (!card || !inspector || !study) return null;
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return [value.left, value.top, value.width, value.height];
      };
      return JSON.stringify({
        viewport: [innerWidth, innerHeight],
        card: rect(card),
        inspector: rect(inspector),
        study: rect(study),
        label: card.querySelector(".connection-card-title")?.value ?? null,
        metadata: card.querySelector(".connection-card-kind")?.textContent ?? null,
      });
    })()`);
    if (snapshot && snapshot === previous) return;
    previous = snapshot;
    await sleep(80);
  }
  throw new Error("Connection card never reached two identical frames");
}

async function mouseClick(cdp, driver, selector) {
  const point = await driver.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  })()`);
  assert.ok(point, `missing mouse target ${selector}`);
  assert.ok(point.x >= 0 && point.x <= point.viewportWidth, `${selector} was outside the horizontal viewport`);
  assert.ok(point.y >= 0 && point.y <= point.viewportHeight, `${selector} was outside the vertical viewport`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

function cardReportExpression(fixture) {
  return `(() => {
    const fixture = ${JSON.stringify(fixture)};
    const card = document.querySelector(".connection-card");
    const cards = [...document.querySelectorAll(".connection-card")];
    const inspector = document.querySelector(".margin-connection-inspector");
    const margin = document.querySelector(".living-margin");
    const study = document.querySelector(".margin-study-content");
    const stage = document.querySelector(".scripture-reading-stage");
    const tabs = study?.querySelector(".margin-tabs");
    const kindMark = card?.querySelector(".connection-card-kind-mark");
    const title = card?.querySelector(".connection-card-title");
    const metadata = card?.querySelector(".connection-card-kind");
    const firstMark = document.querySelector(
      '.connection-mark[data-connection-id="' + CSS.escape(fixture.firstId) + '"]'
    );
    const secondMark = document.querySelector(
      '.connection-mark[data-connection-id="' + CSS.escape(fixture.secondId) + '"]'
    );
    const firstTick = document.querySelector(
      '[data-connection-tick="' + CSS.escape(fixture.firstId) + '"]'
    );
    const secondTick = document.querySelector(
      '[data-connection-tick="' + CSS.escape(fixture.secondId) + '"]'
    );
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const overflow = (element) => element
      ? Math.max(0, element.scrollWidth - element.clientWidth)
      : Number.POSITIVE_INFINITY;
    const cardRect = rect(card);
    const inspectorRect = rect(inspector);
    const marginRect = rect(margin);
    const studyRect = rect(study);
    const stageRect = rect(stage);
    const tabsRect = rect(tabs);
    const markRect = rect(kindMark);
    const titleStyle = title ? getComputedStyle(title) : null;
    const titleFocusVisible = title?.matches(":focus-visible") ?? false;
    const normalizedMetadata = metadata?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.querySelector(".app-shell")?.dataset.theme ?? null,
      cardCount: cards.length,
      title: title?.value ?? null,
      metadata: normalizedMetadata,
      nestedInMargin: Boolean(card && inspector?.contains(card) && margin?.contains(inspector)),
      studyCoexists: Boolean(
        study
        && margin?.contains(study)
        && !study.hidden
        && getComputedStyle(study).display !== "none"
        && studyRect
        && studyRect.height > 0
      ),
      studyHasInspectorClass: study?.classList.contains("has-connection-inspector") ?? false,
      studyFollowsInspector: Boolean(studyRect && inspectorRect && studyRect.top >= inspectorRect.bottom - ${GEOMETRY_EPSILON}),
      cardRect,
      inspectorRect,
      marginRect,
      stageRect,
      tabsRect,
      kindMarkRect: markRect,
      cardFitsInspector: Boolean(
        cardRect
        && inspectorRect
        && cardRect.left >= inspectorRect.left - ${GEOMETRY_EPSILON}
        && cardRect.right <= inspectorRect.right + ${GEOMETRY_EPSILON}
        && cardRect.width <= inspectorRect.width + ${GEOMETRY_EPSILON}
      ),
      cardFitsMargin: Boolean(
        cardRect
        && marginRect
        && cardRect.left >= marginRect.left - ${GEOMETRY_EPSILON}
        && cardRect.right <= marginRect.right + ${GEOMETRY_EPSILON}
      ),
      tabsFitMargin: Boolean(
        tabsRect
        && marginRect
        && tabsRect.left >= marginRect.left - ${GEOMETRY_EPSILON}
        && tabsRect.right <= marginRect.right + ${GEOMETRY_EPSILON}
      ),
      scrollOwnership: {
        margin: margin ? getComputedStyle(margin).overflowY : null,
        inspector: inspector ? getComputedStyle(inspector).overflowY : null,
        study: study ? getComputedStyle(study).overflowY : null,
        card: card ? getComputedStyle(card).overflowY : null,
      },
      horizontalOverflow: {
        document: overflow(document.documentElement),
        body: overflow(document.querySelector(".scripture-body")),
        reading: overflow(document.querySelector(".scripture-content")),
        margin: overflow(margin),
        inspector: overflow(inspector),
        card: overflow(card),
        tabs: overflow(tabs),
      },
      first: {
        selected: firstMark?.classList.contains("selected") ?? false,
        userHeld: firstMark?.classList.contains("user-held") ?? false,
        pressed: firstTick?.getAttribute("aria-pressed") ?? null,
      },
      second: {
        selected: secondMark?.classList.contains("selected") ?? false,
        userHeld: secondMark?.classList.contains("user-held") ?? false,
        pressed: secondTick?.getAttribute("aria-pressed") ?? null,
      },
      titleMouseFocus: {
        active: document.activeElement === title,
        focusVisible: titleFocusVisible,
        outlineStyle: titleStyle?.outlineStyle ?? null,
        outlineWidth: titleStyle?.outlineWidth ?? null,
        visibleRing: Boolean(
          titleFocusVisible
          && titleStyle
          && titleStyle.outlineStyle !== "none"
          && Number.parseFloat(titleStyle.outlineWidth) > 0
        ),
      },
    };
  })()`;
}

function readConnectionEvents(libraryPath) {
  return readFileSync(join(libraryPath, "annotations/connections.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForConnectionEventCount(libraryPath, entityId, count, timeout = 10_000) {
  const started = Date.now();
  let observed = [];
  while (Date.now() - started < timeout) {
    observed = readConnectionEvents(libraryPath).filter((event) => event.entityId === entityId);
    if (observed.length === count) return observed;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${count} authored events for ${entityId}; observed ${JSON.stringify(
    observed.map((event) => ({ op: event.op, commandId: event.commandId, label: event.payload?.label })),
  )}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-connection-card-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
const port = await availablePort();
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = {
  ...process.env,
  LIBRARY_PATH: libraryPath,
  SCRIPTURE_QA_DROP_CONNECTION_RESPONSES: "update,delete",
};
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
child.once("error", (error) => {
  childState.spawnError = String(error);
});
let childLog = "";
const retainLog = (chunk) => {
  childLog = (childLog + chunk.toString()).slice(-16_000);
};
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
try {
  const target = await waitForTarget(endpoint, childState);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`, 15_000);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const fixture = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const anchor = async (verse, quote) => {
      const verseText = text(verse);
      const start = verseText.indexOf(quote);
      if (start < 0) throw new Error("fixture quote is absent: " + quote);
      const capture = await window.api.library.captureConnectionSelection("bsb", [{
        book: "ACT",
        chapter: 19,
        verse,
        char_start: start,
        char_end: start + quote.length,
        quote,
      }]);
      if (!capture.ok || capture.status !== "exact") {
        throw new Error("exact fixture capture refused: " + JSON.stringify(capture));
      }
      return capture.anchor;
    };
    const first = await window.api.library.createConnection(
      "link:contrast",
      "Contrast · First held proof",
      "The first held relationship remains available while another card owns focus.",
      await Promise.all([anchor(7, "about twelve"), anchor(8, "the kingdom of God")]),
      "qa-card-first",
    );
    if (!first.ok || !first.connection) throw new Error(first.error ?? "first connection failed");
    const second = await window.api.library.createConnection(
      "link:parallel",
      "Parallelism · Focused proof",
      "The focused relationship supplies the visual card proof.",
      await Promise.all([anchor(9, "the Way"), anchor(10, "the word of the Lord")]),
      "qa-card-second",
    );
    if (!second.ok || !second.connection) throw new Error(second.error ?? "second connection failed");
    const mutation = await window.api.library.createConnection(
      "series",
      "Series · Mutation proof",
      "A separate fixture owns response-loss recovery.",
      await Promise.all([
        anchor(11, "extraordinary miracles"),
        anchor(12, "handkerchiefs and aprons"),
        anchor(13, "the name of the Lord Jesus"),
      ]),
      "qa-card-mutation",
    );
    if (!mutation.ok || !mutation.connection) throw new Error(mutation.error ?? "mutation connection failed");
    const ownership = await window.api.library.createConnection(
      "link:contrast",
      "Contrast · Ownership proof",
      "Initial ownership observation.",
      await Promise.all([anchor(14, "Seven sons of Sceva"), anchor(15, "Jesus I know")]),
      "qa-card-ownership",
    );
    if (!ownership.ok || !ownership.connection) throw new Error(ownership.error ?? "ownership connection failed");
    const queried = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    if (queried.connections.length !== 4) {
      throw new Error("fixture materialization count " + queried.connections.length);
    }
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
      sidebarCollapsed: true,
      marginVisible: true,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      firstId: first.connection.id,
      secondId: second.connection.id,
      mutationId: mutation.connection.id,
      ownershipId: ownership.connection.id,
    };
  })()`);

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  const postReloadQuery = await driver.evaluate(
    `window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)`,
  );
  assert.equal(
    postReloadQuery.connections.length,
    4,
    `post-reload Derived fixture count drifted: ${JSON.stringify(postReloadQuery.connections.map((connection) => ({
      id: connection.id,
      activeEventId: connection.activeEventId,
      anchors: connection.anchors.length,
    })))}`,
  );
  try {
    await driver.waitFor(
      `document.querySelectorAll("[data-connection-tick]").length === 4`,
      20_000,
    );
  } catch (error) {
    const tickState = await driver.evaluate(`(() => ({
      ticks: [...document.querySelectorAll("[data-connection-tick]")].map((tick) => tick.getAttribute("data-connection-tick")),
      emphasisIds: [...document.querySelectorAll("[data-connection-emphasis-overlay] [data-connection-id]")]
        .map((mark) => mark.getAttribute("data-connection-id")),
      overlay: Boolean(document.querySelector("[data-connection-overlay]")),
      svgRect: (() => {
        const rect = document.querySelector("[data-connection-overlay]")?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
      })(),
    }))()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(tickState)}`);
  }

  // Begin with a normal (non-response-loss) card update. Both fields are made
  // dirty first; focusing then blurring the observation starts the label IPC
  // and queues the sibling observation blur in the same renderer task. IPC
  // cannot resolve until that task yields, so every attempted focus transfer
  // below deterministically runs while the card owns an in-flight command.
  await driver.evaluate(`document.querySelector(
    ${JSON.stringify(`[data-connection-tick="${fixture.ownershipId}"]`)}
  )?.click()`);
  await driver.waitFor(`document.querySelector(".connection-card-title")?.value === "Ownership proof"`);
  const uuidSeam = await driver.evaluate(`(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), "randomUUID");
    const original = crypto.randomUUID.bind(crypto);
    let sequence = 0;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => "qa-card-owned-" + (++sequence),
    });
    globalThis.__qaRestoreConnectionCardRandomUUID = () => {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: original,
      });
      delete globalThis.__qaRestoreConnectionCardRandomUUID;
    };
    return { installed: crypto.randomUUID() === "qa-card-owned-1", prototypeConfigurable: descriptor?.configurable ?? null };
  })()`);
  assert.equal(uuidSeam.installed, true, `could not install the ownership command-id seam: ${JSON.stringify(uuidSeam)}`);

  // Open the translation view before making either field dirty. Pointer-open
  // would otherwise blur the title and start its save before this gate owns
  // the intended same-task window.
  await driver.evaluate(`document.querySelector(".version-picker-btn")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".version-picker-popover .version-picker-item:not(.active)"))`);
  const fieldsEdited = await driver.evaluate(`(() => {
    const title = document.querySelector(".connection-card-title");
    const observation = document.querySelector(".connection-card-observation textarea");
    if (!(title instanceof HTMLInputElement) || !(observation instanceof HTMLTextAreaElement)) return false;
    const titleSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const observationSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    titleSetter?.call(title, "Ownership rename");
    title.dispatchEvent(new Event("input", { bubbles: true }));
    observationSetter?.call(observation, "Queued sibling observation.");
    observation.dispatchEvent(new Event("input", { bubbles: true }));
    title.focus();
    return true;
  })()`);
  assert.equal(fieldsEdited, true, "ownership fixture fields were unavailable");
  await driver.waitFor(`document.querySelector(".connection-card-title")?.value === "Ownership rename"
    && document.querySelector(".connection-card-observation textarea")?.value === "Queued sibling observation."
    && Boolean(document.querySelector(".version-picker-popover .version-picker-item:not(.active)"))`);

  const inFlightOwnership = await driver.evaluate(`(() => {
    const observation = document.querySelector(".connection-card-observation textarea");
    const otherRelationship = document.querySelector(
      ${JSON.stringify(`[data-connection-tick="${fixture.secondId}"]`)}
    );
    const version = document.querySelector(".version-picker-popover .version-picker-item:not(.active)");
    if (!(observation instanceof HTMLTextAreaElement) || !otherRelationship || !version) return null;

    // Title blur begins update 1. Observation blur sees that exact command in
    // flight and must queue update 2 instead of dropping or overwriting it.
    observation.focus();
    observation.blur();
    otherRelationship.click();
    document.querySelector('button[aria-label="Next chapter"]')?.click();
    document.querySelector('.margin-toggle-btn')?.click();
    document.querySelector('.focus-btn')?.click();
    version.click();

    const selected = document.querySelector(".connection-mark.selected")?.getAttribute("data-connection-id") ?? null;
    return {
      selected,
      cardTitle: document.querySelector(".connection-card-title")?.value ?? null,
      chapter: document.querySelector(".chapter-number")?.textContent?.trim() ?? null,
      marginPresent: Boolean(document.querySelector(".living-margin")),
      marginPressed: document.querySelector(".margin-toggle-btn")?.getAttribute("aria-pressed") ?? null,
      focusPressed: document.querySelector(".focus-btn")?.getAttribute("aria-pressed") ?? null,
      packageLabel: document.querySelector(".version-picker-btn")?.textContent?.trim() ?? null,
      ownershipPressed: document.querySelector(
        ${JSON.stringify(`[data-connection-tick="${fixture.ownershipId}"]`)}
      )?.getAttribute("aria-pressed") ?? null,
      otherPressed: otherRelationship.getAttribute("aria-pressed"),
    };
  })()`);
  assert.deepEqual(
    inFlightOwnership,
    {
      selected: fixture.ownershipId,
      cardTitle: "Ownership rename",
      chapter: "19",
      marginPresent: true,
      marginPressed: "true",
      focusPressed: "false",
      packageLabel: "BSB",
      ownershipPressed: "true",
      otherPressed: "false",
    },
    `in-flight card ownership leaked to another relationship or reading view: ${JSON.stringify(inFlightOwnership)}`,
  );

  const ownershipEvents = await waitForConnectionEventCount(libraryPath, fixture.ownershipId, 3, 20_000);
  await driver.waitFor(`document.querySelector(".connection-card")?.getAttribute("aria-busy") === "false"
    && document.querySelector(".connection-card-title")?.value === "Ownership rename"
    && document.querySelector(".connection-card-observation textarea")?.value === "Queued sibling observation."
    && document.querySelector(".connection-card-title")?.disabled === false`, 20_000);
  assert.deepEqual(
    ownershipEvents.map((event) => ({
      commandId: event.commandId,
      label: event.payload?.label,
      observation: event.payload?.observation,
    })),
    [
      {
        commandId: "qa-card-ownership",
        label: "Contrast · Ownership proof",
        observation: "Initial ownership observation.",
      },
      {
        commandId: "qa-card-owned-2",
        label: "Contrast · Ownership rename",
        observation: "Initial ownership observation.",
      },
      {
        commandId: "qa-card-owned-3",
        label: "Contrast · Ownership rename",
        observation: "Queued sibling observation.",
      },
    ],
    "dirty sibling blur was not preserved as one ordered follow-up command",
  );
  const restoredUuid = await driver.evaluate(`(() => {
    const restore = globalThis.__qaRestoreConnectionCardRandomUUID;
    if (typeof restore !== "function") return false;
    restore();
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(crypto.randomUUID());
  })()`);
  assert.equal(restoredUuid, true, "ownership command-id seam did not restore crypto.randomUUID");
  await driver.evaluate(`document.querySelector(".version-picker-popover .version-picker-item.active")?.click()`);
  await driver.waitFor(`!document.querySelector(".version-picker-popover")`);
  const releasedOwnership = await driver.evaluate(`(() => {
    const release = [...document.querySelectorAll(".connection-card-actions button")]
      .find((button) => button.textContent?.trim() === "Release");
    release?.click();
    return Boolean(release);
  })()`);
  assert.equal(releasedOwnership, true, "ownership proof had no Release action after its queued update settled");
  await driver.waitFor(`!document.querySelector(
    ${JSON.stringify(`.connection-mark.user-held[data-connection-id="${fixture.ownershipId}"]`)}
  ) && !document.querySelector(".connection-card")`);
  // Release restores focus to its former tick on the next animation frame.
  // Let that ownership transfer finish before opening the next card so the
  // scheduled focus cannot steal Input.insertText from its title.
  await settle(driver);

  // Exercise the real card against a host seam that commits each UUID command
  // and drops only its first renderer response. A fresh ID on Retry would
  // create a second update (or make the delete unrecoverable), so exact event
  // counts prove the refs survive the visible failure state.
  await driver.evaluate(`document.querySelector(
    ${JSON.stringify(`[data-connection-tick="${fixture.mutationId}"]`)}
  )?.click()`);
  await driver.waitFor(`document.querySelector(".connection-card-title")?.value === "Mutation proof"`);
  const responseLossRenameEdited = await driver.evaluate(`(() => {
    const title = document.querySelector(".connection-card-title");
    if (!(title instanceof HTMLInputElement) || title.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(title, "Response-loss rename");
    title.dispatchEvent(new Event("input", { bubbles: true }));
    title.focus();
    return document.activeElement === title;
  })()`);
  assert.equal(responseLossRenameEdited, true, "response-loss title was not editable or could not take focus");
  await driver.waitFor(`document.querySelector(".connection-card-title")?.value === "Response-loss rename"`);
  await driver.evaluate(`document.querySelector(".connection-card-title")?.focus()`);
  await driver.waitFor(`document.activeElement === document.querySelector(".connection-card-title")`);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  let mutationEvents = await waitForConnectionEventCount(libraryPath, fixture.mutationId, 2);
  await driver.waitFor(`document.querySelector(".connection-card")?.getAttribute("aria-busy") === "false"`);
  const lostUpdateUi = await driver.evaluate(`(() => ({
    error: document.querySelector(".connection-card-error")?.textContent ?? null,
    title: document.querySelector(".connection-card-title")?.value ?? null,
    busy: document.querySelector(".connection-card")?.getAttribute("aria-busy") ?? null,
    pending: document.querySelector(".connection-card")?.getAttribute("data-pending-mutation") ?? null,
    retry: document.querySelector(".connection-card-retry")?.textContent?.trim() ?? null,
    crossActionsLocked: [...document.querySelectorAll(
      ".connection-card-title, .connection-card-observation textarea, .connection-card-jump, .connection-card-remove, .connection-card-actions button:not(.connection-card-retry)"
    )].every((control) => control.disabled),
  }))()`);
  assert.ok(lostUpdateUi.error, `lost update response did not remain retryable: ${JSON.stringify(lostUpdateUi)}`);
  assert.deepEqual(
    { pending: lostUpdateUi.pending, retry: lostUpdateUi.retry, crossActionsLocked: lostUpdateUi.crossActionsLocked },
    { pending: "update", retry: "Retry exact change", crossActionsLocked: true },
    `lost update did not lock every stale-prop action: ${JSON.stringify(lostUpdateUi)}`,
  );
  assert.equal(mutationEvents.length, 2, "lost update response appended more than one authored event");
  assert.equal(mutationEvents.at(-1)?.payload?.label, "Series · Response-loss rename");

  // The recovery owner lives above every view that could unmount or replace
  // the card. Relationship focus, chapter, translation, margin, focus mode,
  // and Escape must all leave the exact command mounted for Retry.
  const recoveryOwnership = await driver.evaluate(`(() => {
    document.querySelector(${JSON.stringify(`[data-connection-tick="${fixture.secondId}"]`)})?.click();
    document.querySelector('button[aria-label="Next chapter"]')?.click();
    document.querySelector('.margin-toggle-btn')?.click();
    document.querySelector('.focus-btn')?.click();
    document.querySelector('.version-picker-btn')?.click();
    return {
      selected: document.querySelector(".connection-mark.selected")?.getAttribute("data-connection-id") ?? null,
      cardTitle: document.querySelector(".connection-card-title")?.value ?? null,
      chapter: document.querySelector(".chapter-number")?.textContent?.trim() ?? null,
      marginPresent: Boolean(document.querySelector(".living-margin")),
      marginPressed: document.querySelector(".margin-toggle-btn")?.getAttribute("aria-pressed") ?? null,
      focusPressed: document.querySelector(".focus-btn")?.getAttribute("aria-pressed") ?? null,
      packageLabel: document.querySelector(".version-picker-btn")?.textContent?.trim() ?? null,
      pending: document.querySelector(".connection-card")?.getAttribute("data-pending-mutation") ?? null,
      nextDisabled: document.querySelector('button[aria-label="Next chapter"]')?.disabled ?? null,
      marginDisabled: document.querySelector('.margin-toggle-btn')?.disabled ?? null,
      passageDisabled: document.querySelector('.passage-picker-btn')?.disabled ?? null,
      versionDisabled: document.querySelector('.version-picker-btn')?.disabled ?? null,
    };
  })()`);
  assert.deepEqual(
    recoveryOwnership,
    {
      selected: fixture.mutationId,
      cardTitle: "Response-loss rename",
      chapter: "19",
      marginPresent: true,
      marginPressed: "true",
      focusPressed: "false",
      packageLabel: "BSB",
      pending: "update",
      nextDisabled: true,
      marginDisabled: true,
      passageDisabled: true,
      versionDisabled: true,
    },
    `recovery ownership leaked to another relationship or reading view: ${JSON.stringify(recoveryOwnership)}`,
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await driver.waitFor(`document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelector(".connection-card")?.getAttribute("data-pending-mutation") === "update"
    && document.querySelector(".connection-card-retry")?.textContent?.trim() === "Retry exact change"`);

  await driver.evaluate(`document.querySelector(".connection-card-retry")?.click()`);
  await driver.waitFor(`!document.querySelector(".connection-card")?.getAttribute("data-pending-mutation")`);
  await driver.waitFor(`!document.querySelector(".connection-card-error")
    && document.querySelector(".connection-card-title")?.value === "Response-loss rename"
    && document.querySelector(".connection-card-remove")?.disabled === false`);
  mutationEvents = readConnectionEvents(libraryPath).filter((event) => event.entityId === fixture.mutationId);
  assert.equal(mutationEvents.length, 2, "label Retry did not reuse its committed command id");

  await driver.evaluate(`document.querySelector(".connection-card-remove")?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".connection-card-error"))`);
  await driver.waitFor(`document.querySelector(".connection-card")?.getAttribute("aria-busy") === "false"`);
  mutationEvents = readConnectionEvents(libraryPath).filter((event) => event.entityId === fixture.mutationId);
  assert.equal(mutationEvents.length, 3, "lost anchor-removal response appended more than one event");
  assert.equal(mutationEvents.at(-1)?.payload?.anchors?.length, 2);
  const pendingAnchorUi = await driver.evaluate(`(() => ({
    pending: document.querySelector(".connection-card")?.getAttribute("data-pending-mutation") ?? null,
    retry: document.querySelector(".connection-card-retry")?.textContent?.trim() ?? null,
    removeLocked: [...document.querySelectorAll(".connection-card-remove")]
      .every((button) => button.disabled),
    releaseLocked: [...document.querySelectorAll(".connection-card-actions button")]
      .find((button) => button.textContent?.trim() === "Release")?.disabled ?? false,
  }))()`);
  assert.deepEqual(
    pendingAnchorUi,
    { pending: "update", retry: "Retry exact change", removeLocked: true, releaseLocked: true },
    `anchor response loss exposed a cross-field mutation: ${JSON.stringify(pendingAnchorUi)}`,
  );
  await driver.evaluate(`document.querySelector(".connection-card-retry")?.click()`);
  await sleep(750);
  const anchorRetryUi = await driver.evaluate(`(() => ({
    error: document.querySelector(".connection-card-error")?.textContent ?? null,
    anchors: document.querySelectorAll(".connection-card-anchors > li").length,
    busy: document.querySelector(".connection-card")?.getAttribute("aria-busy") ?? null,
  }))()`);
  mutationEvents = readConnectionEvents(libraryPath).filter((event) => event.entityId === fixture.mutationId);
  assert.deepEqual(
    anchorRetryUi,
    { error: null, anchors: 2, busy: "false" },
    `anchor-removal Retry did not settle: ${JSON.stringify(mutationEvents.map((event) => ({ op: event.op, commandId: event.commandId })))}`,
  );
  assert.equal(mutationEvents.length, 3, "anchor-removal Retry did not reuse its committed command id");

  const clickCardAction = async (label) => {
    const clicked = await driver.evaluate(`(() => {
      const button = [...document.querySelectorAll(".connection-card-actions button")]
        .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
      button?.click();
      return Boolean(button);
    })()`);
    assert.equal(clicked, true, `missing card action ${label}`);
  };
  await clickCardAction("Delete");
  await driver.waitFor(`[...document.querySelectorAll(".connection-card-actions button")]
    .some((button) => button.textContent?.trim() === "Confirm delete")`);
  await clickCardAction("Confirm delete");
  await driver.waitFor(`Boolean(document.querySelector(".connection-card-error"))`);
  await driver.waitFor(`document.querySelector(".connection-card")?.getAttribute("aria-busy") === "false"`);
  mutationEvents = readConnectionEvents(libraryPath).filter((event) => event.entityId === fixture.mutationId);
  assert.equal(mutationEvents.length, 4, "lost delete response appended more than one tombstone");
  assert.equal(mutationEvents.at(-1)?.op, "delete");
  const pendingDeleteUi = await driver.evaluate(`(() => ({
    pending: document.querySelector(".connection-card")?.getAttribute("data-pending-mutation") ?? null,
    retry: document.querySelector(".connection-card-retry")?.textContent?.trim() ?? null,
    otherActionsLocked: [...document.querySelectorAll(".connection-card-actions button:not(.connection-card-retry)")]
      .every((button) => button.disabled),
  }))()`);
  assert.deepEqual(
    pendingDeleteUi,
    { pending: "delete", retry: "Retry deletion", otherActionsLocked: true },
    `delete response loss did not retain one exact recovery action: ${JSON.stringify(pendingDeleteUi)}`,
  );
  await driver.evaluate(`document.querySelector(".connection-card-retry")?.click()`);
  await driver.waitFor(`!document.querySelector(${JSON.stringify(`[data-connection-tick="${fixture.mutationId}"]`)})
    && document.querySelectorAll("[data-connection-tick]").length === 3`);
  const afterMutationQuery = await driver.evaluate(`window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)`);
  assert.equal(afterMutationQuery.connections.some((connection) => connection.id === fixture.mutationId), false);
  mutationEvents = readConnectionEvents(libraryPath).filter((event) => event.entityId === fixture.mutationId);
  assert.equal(mutationEvents.length, 4, "delete Retry did not reuse its committed command id");
  assert.equal(new Set(mutationEvents.map((event) => event.commandId)).size, 4);

  if (MUTATIONS_ONLY) {
    console.log("PASS connection card mutations: in-flight ownership blocked relationship/view changes; dirty sibling blur queued exactly once; label, anchor removal, and delete Retry stayed exact-once after response loss");
  } else {
  await driver.evaluate(`document.querySelector(
    ${JSON.stringify(`[data-connection-tick="${fixture.firstId}"]`)}
  )?.click()`);
  await driver.waitFor(`document.querySelector(
    ${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.firstId}"]`)}
  ) && document.querySelector(".connection-card-title")?.value === "First held proof"`);
  await driver.evaluate(`document.querySelector(
    ${JSON.stringify(`[data-connection-tick="${fixture.secondId}"]`)}
  )?.click()`);
  await driver.waitFor(`document.querySelector(
    ${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.secondId}"]`)}
  ) && document.querySelector(".connection-card-kind")?.textContent?.includes("1\u00a0more\u00a0held")`);

  const reports = [];
  for (const theme of THEMES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await setTheme(driver, theme);
    for (const width of WIDTHS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await driver.evaluate(`document.querySelector(".margin-connection-inspector")?.scrollIntoView({ block: "start" })`);
      await settle(driver);
      await waitForStableCard(driver);
      await mouseClick(cdp, driver, ".connection-card-title");
      await settle(driver);
      const report = await driver.evaluate(cardReportExpression(fixture));
      const label = `${THEME_LABELS.get(theme)}/${width}`;
      assert.deepEqual(report.viewport, { width, height: HEIGHT }, `${label}: viewport drifted`);
      assert.equal(report.theme, theme, `${label}: atmosphere drifted`);
      assert.equal(report.cardCount, 1, `${label}: expected exactly one in-flow card`);
      assert.equal(report.title, "Focused proof", `${label}: focused relationship did not own the card`);
      assert.match(report.metadata, /Parallelism · 2 moments · 1 more held/i,
        `${label}: held summary was absent`);
      assert.equal(report.nestedInMargin, true, `${label}: card escaped Living Margin`);
      assert.equal(report.studyCoexists, true, `${label}: study content was hidden by the card`);
      assert.equal(report.studyHasInspectorClass, true, `${label}: coexistence seam was absent`);
      assert.equal(report.studyFollowsInspector, true, `${label}: card overlapped study content`);
      assert.equal(report.cardFitsInspector, true, `${label}: card exceeded its inspector`);
      assert.equal(report.cardFitsMargin, true, `${label}: card exceeded Living Margin`);
      assert.ok(report.stageRect?.width >= 300, `${label}: reading stage collapsed below 300px`);
      assert.ok(report.marginRect?.width >= 300, `${label}: Living Margin collapsed below 300px`);
      assert.equal(report.tabsFitMargin, true, `${label}: Study tabs exceeded Living Margin`);
      assert.deepEqual(
        report.scrollOwnership,
        { margin: "auto", inspector: "visible", study: "visible", card: "visible" },
        `${label}: card and Study did not share Living Margin's one scroll owner`,
      );
      assert.deepEqual(
        { width: report.kindMarkRect?.width, height: report.kindMarkRect?.height },
        { width: 6, height: 6 },
        `${label}: the sole semantic hue mark drifted from 6x6`,
      );
      assert.deepEqual(report.first, { selected: false, userHeld: true, pressed: "true" },
        `${label}: previous relationship was not held`);
      assert.deepEqual(report.second, { selected: true, userHeld: true, pressed: "true" },
        `${label}: focused relationship was not held and selected`);
      for (const [surface, overflow] of Object.entries(report.horizontalOverflow)) {
        assert.ok(overflow <= GEOMETRY_EPSILON, `${label}: ${surface} overflowed horizontally by ${overflow}px`);
      }
      assert.equal(report.titleMouseFocus.active, true, `${label}: mouse focus missed the card title`);
      assert.equal(report.titleMouseFocus.visibleRing, false,
        `${label}: a mouse-focused card title showed keyboard-only focus treatment`);
      assert.equal(report.titleMouseFocus.outlineStyle, "none",
        `${label}: mouse focus painted a title outline`);
      assert.equal(report.titleMouseFocus.outlineWidth, "0px",
        `${label}: mouse focus painted a title outline width`);
      reports.push({ theme, width, cardWidth: report.cardRect.width, inspectorWidth: report.inspectorRect.width });
      console.log(
        `${THEME_LABELS.get(theme).padEnd(11)} ${String(width).padStart(4)}px  `
        + `card ${report.cardRect.width.toFixed(1)}/${report.inspectorRect.width.toFixed(1)}px  `
        + `held 2  overflow 0`,
      );
    }
  }

  const released = await driver.evaluate(`(() => {
    const release = [...document.querySelectorAll(".connection-card-actions button")]
      .find((button) => button.textContent?.trim() === "Release");
    if (!release) return false;
    release.click();
    return true;
  })()`);
  assert.equal(released, true, "missing Release action");
  await driver.waitFor(`document.querySelector(
    ${JSON.stringify(`.connection-mark.selected[data-connection-id="${fixture.firstId}"]`)}
  ) && document.querySelector(".connection-card-title")?.value === "First held proof"
    && !document.querySelector(
      ${JSON.stringify(`.connection-mark.user-held[data-connection-id="${fixture.secondId}"]`)}
    )`);
  await settle(driver);
  const fallback = await driver.evaluate(cardReportExpression(fixture));
  assert.equal(fallback.cardCount, 1, "Release removed the remaining held card");
  assert.equal(fallback.title, "First held proof", "Release did not fall back to the previous held relationship");
  assert.doesNotMatch(fallback.metadata, /more held/i, "Release left a stale held summary");
  assert.deepEqual(fallback.first, { selected: true, userHeld: true, pressed: "true" },
    "Release did not preserve and select the previous relationship");
  assert.deepEqual(fallback.second, { selected: false, userHeld: false, pressed: "false" },
    "Release did not remove only the focused relationship");

  const widest = Math.max(...reports.map((report) => report.cardWidth));
  console.log(`PASS connection card: 12/12 combinations, widest card ${widest.toFixed(1)}px; focused Release fell back to previous hold`);
  }
} catch (error) {
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) {
    await cdp.send("Emulation.clearDeviceMetricsOverride", {}, 2_000).catch(() => undefined);
    cdp.ws.close();
  }
  try {
    await terminateChild(child, childState);
  } finally {
    rmSync(qaRoot, { recursive: true, force: true });
  }
}
