/**
 * One representative desktop acceptance path for D8. It intentionally avoids
 * the theme, surface, and viewport matrices: one isolated library, one width,
 * and the four behaviors changed by this task.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const STUDY_WORKSPACE_TAB_LIMIT = 64;
const STUDY_SELECTORS = Object.freeze({
  bar: "[data-study-workspace-bar]",
  group: "[data-study-group-id]",
  tab: "[data-study-tab-id]",
  tabKind: "[data-study-tab-kind]",
  collapsedProxy: "[data-study-collapsed-proxy]",
  allTabs: "[data-study-all-tabs]",
  allTabsSearch: "[data-study-all-tabs-search]",
  allTabsRow: "[data-study-all-tabs-row]",
  renameGroup: "[data-study-group-rename]",
  moveTab: "[data-study-tab-move]",
  collapseGroup: "[data-study-group-collapse]",
  reopenRecent: "[data-study-reopen-recent]",
  passageFallback: "[data-study-passage-fallback]",
  entityUnavailable: "[data-study-entity-unavailable]",
  persistence: "[data-study-persistence-status]",
  dirty: '[data-dirty="true"]',
});

function parseStudyWorkspaceTrace(log) {
  return log.split(/\r?\n/).filter((line) => (
    line.includes("study-workspace-qa:chapter")
    || line.includes("study-workspace-qa:entity")
  ));
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    pending.set(messageId, (message) => {
      if (message.error) reject(new Error(`CDP ${method}: ${message.error.message}`));
      else resolvePromise(message);
    });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { socket, send };
}

async function waitForTarget(endpoint, childState, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (childState.exited) throw new Error(`Electron exited before CDP was ready (${childState.code})`);
    try {
      const pages = await (await fetch(endpoint)).json();
      const page = pages.find((candidate) => candidate.type === "page" && candidate.title === "Pericope");
      if (page) return page;
    } catch {
      // The debug socket is still starting.
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
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_500));
    }
    return response.result?.result?.value;
  };
  const waitFor = async (expression, timeout = 15_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(75);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  return { evaluate, waitFor };
}

function selectPhraseExpression(spec) {
  return `(async () => {
    const spec = ${JSON.stringify(spec)};
    const row = document.querySelector('.verse-line[data-verse="' + spec.verse + '"]');
    const span = row?.querySelector(".verse-text-span");
    if (!row || !span) throw new Error("Missing phrase verse " + spec.verse);
    row.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)));
    const text = span.textContent ?? "";
    const startOffset = text.indexOf(spec.quote);
    if (startOffset < 0) throw new Error("Phrase is absent: " + spec.quote);
    const locate = (offset) => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let consumed = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (consumed + length >= offset) return { node, offset: offset - consumed };
        consumed += length;
      }
      return null;
    };
    const start = locate(startOffset);
    const end = locate(startOffset + spec.quote.length);
    if (!start || !end) throw new Error("Could not locate phrase offsets");
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    return selection?.toString() ?? "";
  })()`;
}

async function selectPhrase(driver, spec, expectedCapture = "exact") {
  assert.equal(await driver.evaluate(selectPhraseExpression(spec)), spec.quote);
  await driver.waitFor(`Boolean(document.querySelector('[data-marking-surface="palette"] .marking-palette.is-placed'))`);
  await driver.waitFor(`document.querySelector('[data-marking-surface="palette"]')?.getAttribute("data-selection-capture") === ${JSON.stringify(expectedCapture)}`);
}

async function clickButtonByText(driver, selector, text) {
  const clicked = await driver.evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)}
        || candidate.querySelector(":scope > span")?.textContent?.trim() === ${JSON.stringify(text)});
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing ${text} control`);
}

async function setNativeControlValue(driver, selector, value) {
  const changed = await driver.evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    if (!(control instanceof HTMLInputElement
      || control instanceof HTMLTextAreaElement
      || control instanceof HTMLSelectElement)) return false;
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, ${JSON.stringify(value)});
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Missing native control ${selector}`);
}

async function clickStudyControl(driver, selector) {
  const clicked = await driver.evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    if (!(control instanceof HTMLElement)) return false;
    control.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing study control ${selector}`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "pericope-d8-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "Library");
const port = 12_300 + Math.floor(Math.random() * 300);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = {
  ...process.env,
  LIBRARY_PATH: libraryPath,
  SCRIPTURE_QA_STUDY_WORKSPACE_TRACE: "1",
  SCRIPTURE_QA_DROP_CONNECTION_RESPONSES: "update",
};
delete env.ELECTRON_RUN_AS_NODE;

const childState = { exited: false, code: null };
const child = spawn(
  electronPath,
  [resolve("dist/electron/main.cjs"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
);
let childLog = "";
const retainLog = (chunk) => { childLog = (childLog + chunk.toString()).slice(-20_000); };
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);
child.once("exit", (code) => {
  childState.exited = true;
  childState.code = code;
});

let cdp = null;
try {
  const target = await waitForTarget(endpoint, childState);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1180,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && document.querySelector(".scripture-content"))`, 20_000);

  const fixture = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const text = (verse) => chapter.verses.find((item) => item.verse === verse)?.text ?? "";
    const capture = async (spec) => {
      const verseText = text(spec.verse);
      const start = verseText.indexOf(spec.quote);
      if (start < 0) throw new Error("Fixture phrase is absent: " + spec.quote);
      return window.api.library.captureConnectionSelection("bsb", [{
        book: "ACT",
        chapter: 19,
        verse: spec.verse,
        char_start: start,
        char_end: start + spec.quote.length,
        quote: spec.quote,
      }]);
    };
    const exactAnchor = async (spec) => {
      const result = await capture(spec);
      if (!result.ok || result.status !== "exact") {
        throw new Error("Exact phrase refused: " + JSON.stringify({ spec, result }));
      }
      return result.anchor;
    };
    const findExact = async (verse, fromWord = 0) => {
      const verseText = text(verse);
      const words = [...verseText.matchAll(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g)];
      for (let index = fromWord; index < words.length; index += 1) {
        const first = words[index];
        const second = words[index + 1];
        if (!first || first.index == null) continue;
        const end = second?.index == null ? first.index + first[0].length : second.index + second[0].length;
        const spec = { verse, quote: verseText.slice(first.index, end) };
        const result = await capture(spec);
        if (result.ok && result.status === "exact") return { spec, anchor: result.anchor };
      }
      throw new Error("No exact phrase found in Acts 19:" + verse);
    };

    const widening = { verse: 2, quote: "Holy Spirit" };
    const beforeWidening = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    const wideningResult = await capture(widening);
    const afterWidening = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    if (wideningResult.ok || wideningResult.error?.code !== "selection-round-trip-mismatch") {
      throw new Error("Known widening was not refused: " + JSON.stringify(wideningResult));
    }
    if (afterWidening.connections.length !== beforeWidening.connections.length) {
      throw new Error("Widening capture wrote an event");
    }

    const baptism = { verse: 3, quote: "baptism" };
    const spirit = { verse: 6, quote: "Holy Spirit" };
    const third = await findExact(8, 2);
    const lateA = await findExact(20, 0);
    const lateB = await findExact(21, 2);
    const later = await window.api.library.createConnection(
      "series", "Later Acts phrase", "Created first, ordered later.",
      [lateA.anchor, lateB.anchor], "qa-d8-later",
    );
    const earlier = await window.api.library.createConnection(
      "series", "Earlier Acts phrase", "Created second, ordered earlier.",
      [await exactAnchor(baptism), await exactAnchor(spirit)], "qa-d8-earlier",
    );
    if (!later.ok || !later.connection || !earlier.ok || !earlier.connection) {
      throw new Error("Connection fixture creation failed");
    }
    const ordered = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    await window.api.settings.set({
      theme: "light",
      readingWidth: "wide",
      sidebarCollapsed: true,
      marginVisible: true,
      markingSurface: "palette",
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      widening,
      baptism,
      spirit,
      third: third.spec,
      laterId: later.connection.id,
      earlierId: earlier.connection.id,
      orderedIds: ordered.connections.map((connection) => connection.id),
    };
  })()`);
  assert.deepEqual(fixture.orderedIds, [fixture.earlierId, fixture.laterId]);
  const connectionEventLogPath = join(libraryPath, "annotations", "connections.jsonl");
  let connectionEventLogBytes = readFileSync(connectionEventLogPath);

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  // This step used to read the `.margin-authored-connections` strip above the
  // tab row and click a connection by its label. Both are gone: the strip drew
  // the Connections tab's dataset a second time and moved the tab row (§C4·1),
  // and a connection's label is not rendered anywhere now — "the type and the
  // members are the whole claim, and any prose about it is a note."
  //
  // So the tour opens the tab and reads the rows' `data-connection-id`, which
  // asserts canonical order against the fixture's identities rather than
  // against display copy — a stricter check than the label text it replaces.
  await clickStudyControl(driver, "#margin-connections-tab");
  await driver.waitFor(`document.querySelectorAll(".margin-connection-row").length === 2`);
  const visibleOrder = await driver.evaluate(`[...document.querySelectorAll(".margin-connection-row")]
    .map((node) => node.dataset.connectionId)`);
  assert.deepEqual(visibleOrder, [fixture.earlierId, fixture.laterId]);
  // The tab shows connections and nothing the edition wrote.
  assert.equal(
    await driver.evaluate(`document.querySelectorAll(".margin-connections .crossref-row, .margin-connections .note-crossref-row").length`),
    0,
  );

  await clickStudyControl(driver, `.margin-connection-row[data-connection-id="${fixture.laterId}"]`);
  await driver.waitFor(`Boolean(document.querySelector('.connection-mark.selected[data-connection-id="${fixture.laterId}"] .connection-route'))`);
  await sleep(650);
  const attention = await driver.evaluate(`(() => {
    const row = document.querySelector('.verse-line[data-verse="20"]');
    const viewport = document.querySelector(".scripture-content");
    const rowRect = row?.getBoundingClientRect();
    const viewportRect = viewport?.getBoundingClientRect();
    return {
      visible: Boolean(rowRect && viewportRect && rowRect.top >= viewportRect.top && rowRect.bottom <= viewportRect.bottom),
      selectedBrackets: document.querySelectorAll(".connection-mark.selected .connection-route").length,
      inspector: Boolean(document.querySelector("#connection-card-inspector")),
    };
  })()`);
  assert.deepEqual(attention, { visible: true, selectedBrackets: 1, inspector: true });
  await driver.evaluate(`document.querySelector(".connection-card-primary")?.click()`);
  await driver.waitFor(`!document.querySelector("#connection-card-inspector")`);

  // One bounded V2 pastoral workflow: three real passages keep distinct view
  // state, Apollos and Ephesus use real catalog identities, and every group or
  // tab mutation goes through the visible controls rather than settings.
  const pastoral = await driver.evaluate(`(async () => {
    const resolveEntity = async (displayName, expectedKind) => {
      const result = await window.api.language.searchEntities(displayName, 24);
      const matches = (result.entities ?? []).map((entry) => entry.entity ?? entry);
      const entity = matches.find((candidate) => (
        candidate.displayName === displayName && candidate.kind === expectedKind
      ));
      if (!entity) throw new Error("Missing real entity fixture: " + displayName);
      return { id: entity.id, displayName: entity.displayName, kind: entity.kind };
    };
    const [apollos, aquila, ephesus, priscilla] = await Promise.all([
      resolveEntity("Apollos", "person"),
      resolveEntity("Aquila", "person"),
      resolveEntity("Ephesus", "place"),
      resolveEntity("Priscilla", "person"),
    ]);
    const view = (book, chapter, packageId, seed) => ({
      book,
      chapter,
      packageId,
      verse: seed.verse,
      verseOffset: seed.verseOffset,
      scrollTop: seed.scrollTop,
      margin: {
        activeTab: seed.activeTab,
        scope: null,
        scrollTopByTab: seed.scrollTopByTab,
        wordsVerse: seed.wordsVerse,
        wordsFollowingReading: seed.wordsFollowingReading,
      },
    });
    const session = (current, back = [], forward = []) => ({
      current,
      history: { back, forward },
    });
    const actsBase = view("ACT", 19, "bsb", {
      verse: 20,
      verseOffset: 14,
      scrollTop: 420,
      activeTab: "connections",
      scrollTopByTab: { overview: 9, connections: 37, passage: 0, notes: 11 },
      wordsVerse: 20,
      wordsFollowingReading: false,
    });
    const actsSelectionVerse = ${fixture.baptism.verse};
    const acts = {
      ...actsBase,
      margin: {
        ...actsBase.margin,
        scope: { kind: "selection", start: actsSelectionVerse, end: actsSelectionVerse },
      },
    };
    const john = view("JHN", 3, "kjv", {
      verse: 16,
      verseOffset: 7,
      scrollTop: 240,
      activeTab: "passage",
      scrollTopByTab: { overview: 2, connections: 0, passage: 66, notes: 0 },
      wordsVerse: 16,
      wordsFollowingReading: true,
    });
    const romans = view("ROM", 6, "bsb", {
      verse: 4,
      verseOffset: 5,
      scrollTop: 135,
      activeTab: "notes",
      scrollTopByTab: { overview: 0, connections: 18, passage: 0, notes: 53 },
      wordsVerse: 4,
      wordsFollowingReading: false,
    });
    const workspace = {
      version: 2,
      groups: [
        {
          id: "pastoral-acts-study",
          homePassageTabId: "acts-19-bsb",
          tabIds: ["acts-19-bsb", "john-3-kjv", "apollos-entity", "aquila-entity"],
          lastActiveTabId: "aquila-entity",
          collapsed: false,
          label: { kind: "automatic", frozenReference: { book: "ACT", chapter: 19 } },
        },
        {
          id: "pastoral-romans-study",
          homePassageTabId: "romans-6-bsb",
          tabIds: ["romans-6-bsb", "ephesus-entity"],
          lastActiveTabId: "romans-6-bsb",
          collapsed: false,
          label: { kind: "automatic", frozenReference: { book: "ROM", chapter: 6 } },
        },
      ],
      tabsById: {
        "acts-19-bsb": {
          kind: "passage", id: "acts-19-bsb", groupId: "pastoral-acts-study", session: session(acts),
        },
        "john-3-kjv": {
          kind: "passage", id: "john-3-kjv", groupId: "pastoral-acts-study", session: session(john),
        },
        "romans-6-bsb": {
          kind: "passage", id: "romans-6-bsb", groupId: "pastoral-romans-study", session: session(romans),
        },
        "apollos-entity": {
          kind: "entity",
          id: "apollos-entity",
          groupId: "pastoral-acts-study",
          entityId: apollos.id,
          entityKind: apollos.kind,
          origin: acts,
          originRange: { start: 1, end: 10 },
          canvas: session(acts),
          returnPassageTabId: "acts-19-bsb",
          trail: [apollos],
          scrollTop: 31,
          nonce: 101,
        },
        "aquila-entity": {
          kind: "entity",
          id: "aquila-entity",
          groupId: "pastoral-acts-study",
          entityId: aquila.id,
          entityKind: aquila.kind,
          origin: acts,
          originRange: { start: 1, end: 10 },
          canvas: session(acts),
          returnPassageTabId: "acts-19-bsb",
          trail: [aquila],
          scrollTop: 24,
          nonce: 103,
        },
        "ephesus-entity": {
          kind: "entity",
          id: "ephesus-entity",
          groupId: "pastoral-romans-study",
          entityId: ephesus.id,
          entityKind: ephesus.kind,
          origin: romans,
          originRange: { start: 1, end: 14 },
          canvas: session(romans),
          returnPassageTabId: "romans-6-bsb",
          trail: [ephesus],
          scrollTop: 17,
          nonce: 102,
        },
      },
      activeTabId: "aquila-entity",
      activationOrder: ["john-3-kjv", "ephesus-entity", "romans-6-bsb", "acts-19-bsb", "apollos-entity", "aquila-entity"],
      recentlyClosed: [],
    };
    const saved = await window.api.settings.set({
      studyWorkspace: workspace,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
      marginVisible: true,
    });
    if (saved.studyWorkspaceRefusal || saved.studyWorkspace?.version !== 2) {
      throw new Error("V2 pastoral fixture was not acknowledged");
    }
    return { apollos, aquila, ephesus, priscilla, workspace };
  })()`);

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`Boolean(document.querySelector("[data-study-workspace-bar]"))
    && document.querySelector('[data-study-tab-id="aquila-entity"]')?.getAttribute("aria-selected") === "true"
    && document.querySelector("#entity-research-title")?.textContent?.includes("Aquila")`, 20_000);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  await clickStudyControl(driver, ".entity-research-more > summary");
  await driver.waitFor(`[...document.querySelectorAll('.entity-relationship-target-actions button')]
    .some((button) => button.getAttribute("aria-label")?.startsWith("View Priscilla in this research tab"))`);
  await driver.evaluate(`[...document.querySelectorAll('.entity-relationship-target-actions button')]
    .find((button) => button.getAttribute("aria-label")?.startsWith("View Priscilla in this research tab"))?.click()`);
  await driver.waitFor(`document.querySelector("#entity-research-title")?.textContent?.includes("Priscilla")`, 20_000);
  assert.equal(
    await driver.evaluate(`document.querySelector('[data-study-tab-id="apollos-entity"]')?.getAttribute("data-study-tab-kind")`),
    "person",
  );
  await clickStudyControl(driver, '.entity-research-back[aria-label^="Back to Aquila"]');
  await driver.waitFor(`document.querySelector("#entity-research-title")?.textContent?.includes("Aquila")`);
  await driver.evaluate(`[...document.querySelectorAll('.entity-relationship-branch')]
    .find((button) => button.getAttribute("aria-label")?.startsWith("Open Priscilla in a new research tab"))?.click()`);
  await driver.waitFor(`document.querySelectorAll('[data-study-tab-kind="person"]').length >= 2
    && document.querySelector('[data-study-tab-id][aria-selected="true"]')?.getAttribute("data-study-tab-id") !== "aquila-entity"
    && document.querySelector("#entity-research-title")?.textContent?.includes("Priscilla")`, 20_000);
  const priscillaTabId = await driver.evaluate(`document.querySelector('[data-study-tab-id][aria-selected="true"]')?.getAttribute("data-study-tab-id") ?? ""`);
  assert.ok(priscillaTabId.startsWith("research-"));

  const entityCanvasOrigin = await driver.evaluate(`({
    book: document.querySelector(".book-name")?.textContent?.trim(),
    chapter: document.querySelector(".chapter-number")?.textContent?.trim(),
  })`);
  await clickStudyControl(driver, ".entity-reference-actions > button:not(.entity-reference-open-tab)");
  await driver.waitFor(`document.querySelector('button[aria-label="Back"]')?.disabled === false`);
  assert.notDeepEqual(await driver.evaluate(`({
    book: document.querySelector(".book-name")?.textContent?.trim(),
    chapter: document.querySelector(".chapter-number")?.textContent?.trim(),
  })`), entityCanvasOrigin);
  await clickStudyControl(driver, 'button[aria-label="Back"]');
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === ${JSON.stringify(entityCanvasOrigin.book)}
    && document.querySelector(".chapter-number")?.textContent?.trim() === ${JSON.stringify(entityCanvasOrigin.chapter)}`);
  await clickStudyControl(driver, ".entity-research-return");
  await driver.waitFor(`document.querySelector('[data-study-tab-id="acts-19-bsb"]')?.getAttribute("aria-selected") === "true"
    && document.querySelector("#scripture-workspace-panel")?.getAttribute("data-study-canvas-owner") === "acts-19-bsb"
    && document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);

  await clickStudyControl(driver, '[data-study-tab-id="romans-6-bsb"]');
  await driver.waitFor(`document.querySelector('[data-study-tab-id="romans-6-bsb"]')?.getAttribute("aria-selected") === "true"`);
  await clickStudyControl(driver, "[data-study-active-group-manage]");
  await driver.waitFor(`Boolean(document.querySelector("[data-study-group-rename] input"))`);
  await setNativeControlValue(driver, "[data-study-group-rename] input", "Baptism and New Life");
  await clickStudyControl(driver, '[data-study-group-rename] button[type="submit"]');
  await driver.waitFor(`document.querySelector('[data-study-group-tab][data-study-group-id="pastoral-romans-study"]')
    ?.textContent?.trim() === "Baptism and New Life"`);

  await clickStudyControl(driver, "[data-study-all-tabs]");
  await driver.waitFor(`Boolean(document.querySelector("[data-study-all-tabs-search]"))`);
  await clickStudyControl(
    driver,
    '[data-study-all-tabs-row][data-study-tab-id="john-3-kjv"] [data-study-tab-move]',
  );
  await driver.waitFor(`Boolean(document.querySelector(
    '[data-study-workspace-menu] [data-study-menu-item="pastoral-romans-study"]'
  ))`);
  await clickStudyControl(driver, '[data-study-workspace-menu] [data-study-menu-item="pastoral-romans-study"]');
  await driver.waitFor(`Boolean(document.querySelector(
    '[data-study-group-id="pastoral-romans-study"] [data-study-all-tabs-row][data-study-tab-id="john-3-kjv"]'
  ))`);
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await driver.waitFor(`!document.querySelector("[data-study-all-tabs-search]")`);

  await clickStudyControl(driver, "[data-study-active-group-manage]");
  await clickStudyControl(driver, "[data-study-group-collapse]");
  await driver.waitFor(`Boolean(document.querySelector(
    '[data-study-group-id="pastoral-romans-study"] [data-study-collapsed-proxy="true"]'
  ))`);
  await clickStudyControl(driver, "[data-study-active-group-manage]");
  await clickStudyControl(driver, "[data-study-group-collapse]");
  await driver.waitFor(`!document.querySelector('[data-study-group-id="pastoral-romans-study"] [data-study-collapsed-proxy="true"]')`);

  await clickStudyControl(driver, "[data-study-all-tabs]");
  await setNativeControlValue(driver, "[data-study-all-tabs-search]", "Priscilla");
  await driver.waitFor(`document.querySelectorAll("[data-study-all-tabs-row]").length === 1
    && document.querySelector("[data-study-all-tabs-row]")?.textContent?.includes("Priscilla")`);
  await setNativeControlValue(driver, "[data-study-all-tabs-search]", "");
  await driver.evaluate(`(() => {
    const row = document.querySelector('[data-study-all-tabs-row][data-study-tab-id="ephesus-entity"]');
    const button = row ? [...row.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Close Ephesus")) : null;
    button?.click();
    return Boolean(button);
  })()`);
  await driver.waitFor(`!document.querySelector('[data-study-tab-id="ephesus-entity"]')`);
  await driver.evaluate(`(() => {
    if (!document.querySelector("[data-study-all-tabs-search]")) {
      document.querySelector("[data-study-all-tabs]")?.click();
    }
    return true;
  })()`);
  await driver.waitFor(`Boolean(document.querySelector("[data-study-reopen-recent]"))`);
  await clickStudyControl(driver, "[data-study-reopen-recent]");
  await driver.waitFor(`Boolean(document.querySelector('[data-study-tab-id="ephesus-entity"]'))`);
  await clickStudyControl(driver, "[data-study-all-tabs]");
  await clickStudyControl(
    driver,
    'section[data-study-group-id="pastoral-romans-study"] [data-study-group-close]',
  );
  await driver.waitFor(`document.querySelector('[data-study-decision="close-study"]')
    && Boolean(document.querySelector('[data-study-decision-action="close-study"]'))`);
  await clickStudyControl(driver, '[data-study-decision-action="close-study"]');
  await driver.waitFor(`!document.querySelector('[data-study-group-id="pastoral-romans-study"]')`);
  await driver.evaluate(`(() => {
    if (!document.querySelector("[data-study-all-tabs-search]")) {
      document.querySelector("[data-study-all-tabs]")?.click();
    }
    return true;
  })()`);
  await driver.waitFor(`Boolean(document.querySelector("[data-study-reopen-recent]"))`);
  await clickStudyControl(driver, "[data-study-reopen-recent]");
  await driver.waitFor(`Boolean(document.querySelector('[data-study-group-id="pastoral-romans-study"]'))
    && Boolean(document.querySelector('[data-study-tab-id="ephesus-entity"]'))`);
  await driver.waitFor(`document.querySelector("[data-study-persistence-status]")?.getAttribute("data-study-persistence-status") === "idle"`);

  const pastoralPersistedBeforeReload = await driver.evaluate(`(async () => (await window.api.settings.get()).studyWorkspace)()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`Boolean(document.querySelector("[data-study-workspace-bar]"))
    && document.querySelectorAll("[data-study-tab-id]").length === ${Object.keys(pastoral.workspace.tabsById).length + 1}
    && document.querySelector("[data-study-persistence-status]")?.getAttribute("data-study-persistence-status") === "idle"`, 20_000);
  const pastoralPersistedAfterReload = await driver.evaluate(`(async () => (await window.api.settings.get()).studyWorkspace)()`);
  assert.deepEqual(pastoralPersistedAfterReload, pastoralPersistedBeforeReload);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  const screenshotPath = process.env["D8_QA_SCREENSHOT"];
  if (screenshotPath) {
    await cdp.send("Page.bringToFront");
    await sleep(500);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const absoluteScreenshotPath = resolve(screenshotPath);
    mkdirSync(dirname(absoluteScreenshotPath), { recursive: true });
    writeFileSync(absoluteScreenshotPath, Buffer.from(screenshot.result.data, "base64"));
    console.log(`saved ${absoluteScreenshotPath}`);
  }

  // Dirty NoteCapture owns a real BrowserWindow close and a tab switch until
  // the human explicitly keeps writing or discards. No authored bytes move.
  await clickStudyControl(driver, '[data-study-tab-id="acts-19-bsb"]');
  await driver.waitFor(`document.querySelector('[data-study-tab-id="acts-19-bsb"]')?.getAttribute("aria-selected") === "true"
    && Boolean(document.querySelector("#margin-notes-tab"))`);
  await driver.waitFor(`document.querySelector('.verse-line[data-verse="${fixture.baptism.verse}"]')?.getAttribute("aria-pressed") === "true"
    && document.querySelector(".living-margin")?.getAttribute("data-margin-mode") === "selection"`);
  await clickStudyControl(driver, "#margin-notes-tab");
  await driver.waitFor(`document.querySelector("#margin-notes-tab")?.getAttribute("aria-selected") === "true"`);
  // Was `.margin-view-action` reading "Add note" — the one bordered control in
  // the panel, at the head of a three-sentence heading. Quire C4·6 puts verbs
  // in the footer as words, and the empty state offers the same verb inline,
  // so the handle is `.margin-note-verb` reading "Write a note" in both.
  await driver.waitFor(`[...document.querySelectorAll(".margin-note-verb")]
    .some((button) => button.textContent?.trim() === "Write a note")`);
  await clickButtonByText(driver, ".margin-note-verb", "Write a note");
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-root"))`);
  await setNativeControlValue(driver, ".note-capture-title-input", "Pastoral observation");
  await setNativeControlValue(driver, ".note-capture-textarea", "The Spirit forms a patient teaching community.");
  await driver.waitFor(`document.querySelector('.note-capture-root')?.getAttribute("data-dirty") === "true"`);
  await driver.evaluate(`window.api.appWindow.requestClose()`);
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-discard"))`);
  await clickButtonByText(driver, ".note-capture-discard-actions button", "Keep writing");
  assert.equal(childState.exited, false);
  assert.equal(await driver.evaluate(`document.activeElement?.classList.contains("note-capture-textarea")`), true);
  await clickStudyControl(driver, '[data-study-tab-id="john-3-kjv"]');
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-discard"))`);
  await clickButtonByText(driver, ".note-capture-discard-actions button", "Keep writing");
  assert.equal(await driver.evaluate(`document.querySelector('[data-study-tab-id="acts-19-bsb"]')?.getAttribute("aria-selected")`), "true");
  await clickButtonByText(driver, ".note-capture-actions button", "Cancel");
  await driver.waitFor(`Boolean(document.querySelector(".note-capture-discard"))`);
  await clickButtonByText(driver, ".note-capture-discard-actions button", "Discard");
  await driver.waitFor(`!document.querySelector(".note-capture-root")`);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  // A dirty ConnectionCard blocks tab switch, close, move, and collapse. The
  // final Discard approves exactly the requested move without writing JSONL.
  // Entered from the Connections tab's row, by identity — see the note above.
  await clickStudyControl(driver, "#margin-connections-tab");
  await clickStudyControl(driver, `.margin-connection-row[data-connection-id="${fixture.laterId}"]`);
  await driver.waitFor(`Boolean(document.querySelector("#connection-card-inspector"))`);
  await setNativeControlValue(driver, ".connection-card-observation textarea", "Uncommitted pastoral wording");
  await driver.waitFor(`document.querySelector('.connection-card')?.getAttribute("data-dirty") === "true"`);
  await clickStudyControl(driver, '[data-study-tab-id="john-3-kjv"]');
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Keep editing");
  await clickStudyControl(driver, "[data-study-active-group-manage]");
  await clickStudyControl(driver, "[data-study-group-collapse]");
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Keep editing");
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await clickStudyControl(driver, "[data-study-all-tabs]");
  await driver.evaluate(`(() => {
    const row = document.querySelector('[data-study-all-tabs-row][data-study-tab-id="john-3-kjv"]');
    const button = row ? [...row.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith("Close John 3")) : null;
    button?.click();
    return Boolean(button);
  })()`);
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Keep editing");
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await clickStudyControl(driver, "[data-study-all-tabs]");
  await clickStudyControl(
    driver,
    '[data-study-all-tabs-row][data-study-tab-id="john-3-kjv"] [data-study-tab-move]',
  );
  await driver.waitFor(`Boolean(document.querySelector(
    '[data-study-workspace-menu] [data-study-menu-item="pastoral-acts-study"]'
  ))`);
  await clickStudyControl(driver, '[data-study-workspace-menu] [data-study-menu-item="pastoral-acts-study"]');
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Discard");
  await driver.waitFor(`Boolean(document.querySelector(
    '[data-study-group-id="pastoral-acts-study"] [data-study-all-tabs-row][data-study-tab-id="john-3-kjv"]'
  ))`);
  await driver.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  // A same-turn tab switch races a real update request, and the opt-in main
  // fixture drops its first response. In-flight and recovery ownership both
  // keep every workspace transition and BrowserWindow close fail-closed.
  await setNativeControlValue(driver, ".connection-card-observation textarea", "Committed once despite response loss");
  await driver.waitFor(`document.querySelector('.connection-card')?.getAttribute("data-dirty") === "true"
    && document.querySelector('.connection-card-observation textarea')?.value === "Committed once despite response loss"`);
  assert.equal(await driver.evaluate(`(() => {
    const editor = document.querySelector(".connection-card-observation textarea");
    if (!(editor instanceof HTMLTextAreaElement)) return false;
    editor.focus();
    return document.activeElement === editor;
  })()`), true);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await clickStudyControl(driver, '[data-study-tab-id="john-3-kjv"]');
  await driver.waitFor(`document.querySelector('.connection-card')?.getAttribute("data-pending-mutation") === "update"
    && document.querySelector('.connection-card')?.getAttribute("aria-busy") === "false"`, 20_000);
  assert.equal(await driver.evaluate(`document.querySelector('[data-study-tab-id="acts-19-bsb"]')?.getAttribute("aria-selected")`), "true");
  const recoveryConnectionEventLogBytes = readFileSync(connectionEventLogPath);
  assert.notDeepEqual(recoveryConnectionEventLogBytes, connectionEventLogBytes);
  connectionEventLogBytes = recoveryConnectionEventLogBytes;
  await driver.evaluate(`window.api.appWindow.requestClose()`);
  await sleep(250);
  assert.equal(childState.exited, false);
  assert.equal(await driver.evaluate(`document.querySelector('.connection-card')?.getAttribute("data-pending-mutation")`), "update");
  await clickStudyControl(driver, '[data-study-tab-id="john-3-kjv"]');
  await sleep(250);
  assert.equal(await driver.evaluate(`document.querySelector('[data-study-tab-id="acts-19-bsb"]')?.getAttribute("aria-selected")`), "true");
  await driver.waitFor(`document.querySelector(".connection-card-retry")?.textContent?.includes("Retry")`);
  await clickStudyControl(driver, ".connection-card-retry");
  await driver.waitFor(`!document.querySelector('.connection-card')?.getAttribute("data-pending-mutation")`);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  await selectPhrase(driver, fixture.widening, "refused");
  await driver.evaluate(`document.querySelector('[data-marking-surface="palette"] [data-relationship-kind="series"]')?.click()`);
  await sleep(500);
  if (!await driver.evaluate(`document.body.textContent?.includes("This translation cannot preserve those exact words yet")`)) {
    await driver.evaluate(`document.querySelector('[data-marking-surface="palette"] [data-relationship-kind="series"]')?.click()`);
  }
  await driver.waitFor(`document.body.textContent?.includes("This translation cannot preserve those exact words yet")`);
  assert.equal(await driver.evaluate(`Boolean(document.querySelector(".marking-session"))`), false);
  assert.equal(await driver.evaluate(`getSelection()?.toString()`), "Holy Spirit");
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);
  assert.equal(await driver.evaluate(selectPhraseExpression(fixture.baptism)), fixture.baptism.quote);
  await driver.waitFor(`document.querySelector(".marking-session-kind")?.textContent?.includes("1 phrase")
    && !document.querySelector(".marking-session-action.primary")`);
  assert.equal(await driver.evaluate(selectPhraseExpression(fixture.spirit)), fixture.spirit.quote);
  await driver.waitFor(`document.querySelector(".marking-session-kind")?.textContent?.includes("2 phrases")
    && document.querySelector(".marking-session-action.primary")?.textContent?.trim() === "Save connection"`);
  assert.equal(await driver.evaluate(selectPhraseExpression(fixture.third)), fixture.third.quote);
  await driver.waitFor(`document.querySelector(".marking-session-kind")?.textContent?.includes("3 phrases")`);

  await driver.evaluate(`document.querySelector('[aria-label="Next chapter"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Keep editing");
  assert.equal(await driver.evaluate(`document.querySelector(".chapter-number")?.textContent?.trim()`), "19");
  assert.equal(await driver.evaluate(`document.querySelector(".marking-session-kind")?.textContent?.includes("3 phrases")`), true);

  await driver.evaluate(`document.querySelector('[aria-label="Next chapter"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Save connection");
  await driver.waitFor(`document.querySelector(".chapter-number")?.textContent?.trim() === "20"`, 20_000);
  const saved = await driver.evaluate(`window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)`);
  assert.equal(saved.connections.length, 3);
  assert.equal(saved.connections.some((connection) => connection.anchors.length === 3), true);
  const savedConnectionEventLogBytes = readFileSync(connectionEventLogPath);
  assert.notDeepEqual(savedConnectionEventLogBytes, connectionEventLogBytes);
  connectionEventLogBytes = savedConnectionEventLogBytes;

  await driver.evaluate(`document.querySelector('[aria-label="Previous chapter"]')?.click()`);
  await driver.waitFor(`document.querySelector(".chapter-number")?.textContent?.trim() === "19"`);
  await selectPhrase(driver, fixture.baptism);
  await driver.evaluate(`document.querySelector('[data-marking-surface="palette"] [data-relationship-kind="series"]')?.click()`);
  await driver.waitFor(`document.querySelector(".marking-session-kind")?.textContent?.includes("1 phrase")`);
  await driver.evaluate(`(() => { window.api.appWindow.requestClose(); return true; })()`);
  await driver.waitFor(`document.querySelector("#connection-draft-exit-title")?.textContent?.includes("Close with an unfinished connection")`);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Keep editing");
  assert.equal(childState.exited, false);
  assert.equal(await driver.evaluate(`document.querySelector(".marking-session-kind")?.textContent?.includes("1 phrase")`), true);
  await driver.evaluate(`document.querySelector('[aria-label="Next chapter"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".connection-draft-exit-dialog"))`);
  assert.equal(await driver.evaluate(`[...document.querySelectorAll(".connection-draft-exit-actions button")]
    .some((button) => button.textContent?.trim() === "Save connection")`), false);
  await clickButtonByText(driver, ".connection-draft-exit-actions button", "Discard draft");
  await driver.waitFor(`document.querySelector(".chapter-number")?.textContent?.trim() === "20"`);
  const afterDiscard = await driver.evaluate(`window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28)`);
  assert.equal(afterDiscard.connections.length, 3);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  // Separate startup fixture: persist exactly the STUDY_WORKSPACE_TAB_LIMIT
  // with one active passage, one inactive invalid passage, and one inactive
  // missing entity. Only the active chapter may hydrate during reload.
  const activeOnlyStartupFixture = await driver.evaluate(`(async () => {
    const view = (book, chapter, packageId, verse, seed) => ({
      book,
      chapter,
      packageId,
      verse,
      verseOffset: seed,
      scrollTop: seed * 3,
      margin: {
        activeTab: seed % 2 === 0 ? "overview" : "passage",
        scope: null,
        scrollTopByTab: { overview: seed, connections: 0, passage: seed * 2, notes: 0 },
        wordsVerse: verse,
        wordsFollowingReading: seed % 2 === 0,
      },
    });
    const session = (current) => ({ current, history: { back: [], forward: [] } });
    const activeView = view("ACT", 19, "bsb", 20, 1);
    const tabsById = {
      "startup-active": {
        kind: "passage", id: "startup-active", groupId: "startup-study", session: session(activeView),
      },
    };
    const tabIds = ["startup-active"];
    for (let index = 0; index < 61; index += 1) {
      const id = "startup-inactive-" + String(index).padStart(2, "0");
      const book = index % 2 === 0 ? "JHN" : "ROM";
      const chapter = index % 2 === 0 ? 3 : 6;
      const packageId = index % 3 === 0 ? "kjv" : "bsb";
      tabsById[id] = {
        kind: "passage",
        id,
        groupId: "startup-study",
        session: session(view(book, chapter, packageId, index % 2 === 0 ? 16 : 4, index + 2)),
      };
      tabIds.push(id);
    }
    const invalidView = view("ACT", 999, "bsb", 1, 70);
    tabsById["invalid-passage"] = {
      kind: "passage",
      id: "invalid-passage",
      groupId: "startup-study",
      session: session(invalidView),
    };
    tabIds.push("invalid-passage");
    tabsById["missing-entity"] = {
      kind: "entity",
      id: "missing-entity",
      groupId: "startup-study",
      entityId: "qa-missing-entity",
      entityKind: "person",
      origin: activeView,
      canvas: session(activeView),
      returnPassageTabId: "startup-active",
      trail: [{ id: "qa-missing-entity", displayName: "Catalog Missing Shepherd", kind: "person" }],
      scrollTop: 0,
      nonce: 9001,
    };
    tabIds.push("missing-entity");
    const studyWorkspace = {
      version: 2,
      groups: [{
        id: "startup-study",
        homePassageTabId: "startup-active",
        tabIds,
        lastActiveTabId: "startup-active",
        collapsed: false,
        label: { kind: "custom", value: "active-only startup" },
      }],
      tabsById,
      activeTabId: "startup-active",
      activationOrder: [...tabIds.slice(1), "startup-active"],
      recentlyClosed: [],
    };
    const savedSettings = await window.api.settings.set({
      studyWorkspace,
      lastRead: { book: "ACT", chapter: 19, packageId: "bsb" },
    });
    return {
      tabCount: Object.keys(savedSettings.studyWorkspace?.tabsById ?? {}).length,
      activeTabId: savedSettings.studyWorkspace?.activeTabId,
    };
  })()`);
  assert.deepEqual(activeOnlyStartupFixture, {
    tabCount: STUDY_WORKSPACE_TAB_LIMIT,
    activeTabId: "startup-active",
  });

  const startupTraceOffset = parseStudyWorkspaceTrace(childLog).length;
  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector('[data-study-tab-id="startup-active"]')?.getAttribute("aria-selected") === "true"
    && document.querySelectorAll("[data-study-tab-id]").length === ${STUDY_WORKSPACE_TAB_LIMIT}
    && document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"`, 20_000);
  await sleep(300);
  const activeOnlyTrace = parseStudyWorkspaceTrace(childLog).slice(startupTraceOffset);
  assert.equal(activeOnlyTrace.filter((line) => line.includes("study-workspace-qa:chapter")).length, 1);
  assert.equal(activeOnlyTrace.filter((line) => line.includes("study-workspace-qa:entity")).length, 0);

  await clickStudyControl(driver, '[data-study-tab-id="invalid-passage"]');
  await driver.waitFor(`document.querySelector('[data-study-tab-id="invalid-passage"]')?.getAttribute("aria-selected") === "true"
    && document.querySelector("#scripture-workspace-panel")?.getAttribute("data-study-canvas-owner") === "invalid-passage"
    && Boolean(document.querySelector("[data-study-passage-fallback]"))`, 20_000);
  const invalidPassageState = await driver.evaluate(`(async () => {
    const persisted = (await window.api.settings.get()).studyWorkspace;
    const record = persisted?.tabsById?.["invalid-passage"];
    return {
      selected: document.querySelector('[data-study-tab-id="invalid-passage"]')?.getAttribute("aria-selected"),
      fallback: Boolean(document.querySelector("[data-study-passage-fallback]")),
      preserved: record?.kind === "passage"
        && record.session.current.book === "ACT"
        && record.session.current.chapter === 999,
    };
  })()`);
  assert.deepEqual(
    { selected: invalidPassageState.selected, preserved: invalidPassageState.preserved },
    { selected: "true", preserved: true },
  );

  await clickStudyControl(driver, '[data-study-tab-id="missing-entity"]');
  await driver.waitFor(`Boolean(document.querySelector('[data-study-entity-unavailable="qa-missing-entity"]'))
    && document.querySelector('[data-study-entity-unavailable="qa-missing-entity"]')?.textContent?.includes("Catalog Missing Shepherd unavailable")`, 20_000);
  await clickStudyControl(driver, '.entity-research-close[aria-label="Close research tab"]');
  await driver.waitFor(`!document.querySelector('[data-study-tab-id="missing-entity"]')`);
  assert.deepEqual(readFileSync(connectionEventLogPath), connectionEventLogBytes);

  console.log("PASS desktop D8 + V2: exact phrase guard, canonical order + attention, explicit draft exits, pastoral study workflow, active-only hydration");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}\nElectron log:\n${childLog}`);
} finally {
  cdp?.socket.close();
  if (!childState.exited) child.kill("SIGTERM");
  await sleep(300);
  if (!childState.exited) child.kill("SIGKILL");
  rmSync(qaRoot, { recursive: true, force: true });
}
