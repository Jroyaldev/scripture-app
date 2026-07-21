/**
 * One representative desktop acceptance path for D8. It intentionally avoids
 * the theme, surface, and viewport matrices: one isolated library, one width,
 * and the four behaviors changed by this task.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

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

async function openResearchByName(driver, name) {
  await driver.evaluate(`document.querySelector(".scripture-workspace-new")?.click()`);
  await driver.waitFor(`document.querySelector('#command-tab-names')?.getAttribute("aria-selected") === "true"`);
  await driver.evaluate(`(() => {
    const input = document.querySelector('.command-palette-input-row input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await driver.waitFor(`[...document.querySelectorAll(".command-palette-result")]
    .some((button) => button.querySelector("strong")?.textContent?.trim() === ${JSON.stringify(name)})`);
  await driver.evaluate(`[...document.querySelectorAll(".command-palette-result")]
    .find((button) => button.querySelector("strong")?.textContent?.trim() === ${JSON.stringify(name)})?.click()`);
  await driver.waitFor(`!document.querySelector(".command-palette-root")`);
}

const qaRoot = mkdtempSync(join(tmpdir(), "pericope-d8-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "Library");
const port = 12_300 + Math.floor(Math.random() * 300);
const endpoint = `http://127.0.0.1:${port}/json/list`;
const env = { ...process.env, LIBRARY_PATH: libraryPath };
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

  await cdp.send("Page.reload", { ignoreCache: true });
  await driver.waitFor(`document.querySelector(".book-name")?.textContent?.trim() === "Acts"
    && document.querySelector(".chapter-number")?.textContent?.trim() === "19"
    && document.querySelectorAll(".verse-line").length > 20`, 20_000);
  await driver.waitFor(`document.querySelectorAll(".margin-authored-connections-list button").length === 2`);
  const visibleOrder = await driver.evaluate(`[...document.querySelectorAll(".margin-authored-connections-list button > span")]
    .map((node) => node.textContent?.trim())`);
  assert.deepEqual(visibleOrder, ["Earlier Acts phrase", "Later Acts phrase"]);

  await clickButtonByText(driver, ".margin-authored-connections-list button", "Later Acts phrase");
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

  await driver.waitFor(`Boolean(document.querySelector(".intent-entity-card"))`, 20_000);
  await driver.evaluate(`document.querySelector(".intent-entity-card")?.click()`);
  await driver.waitFor(`document.querySelectorAll('[id^="research-workspace-tab-"]').length === 1
    && document.querySelector('[id^="research-workspace-tab-"]')?.getAttribute("aria-selected") === "true"
    && Boolean(document.querySelector("#entity-research-title"))`, 20_000);
  const firstResearchTabId = await driver.evaluate(`document.querySelector('[id^="research-workspace-tab-"]')?.id ?? ""`);
  const firstResearchScroll = await driver.evaluate(`(() => {
    const margin = document.querySelector(".living-margin");
    if (!margin) return -1;
    margin.scrollTop = Math.max(1, Math.min(220, margin.scrollHeight - margin.clientHeight));
    margin.dispatchEvent(new Event("scroll"));
    return margin.scrollTop;
  })()`);
  await driver.evaluate(`document.querySelector("#scripture-workspace-tab")?.click()`);
  await driver.waitFor(`document.querySelector('#scripture-workspace-tab')?.getAttribute("aria-selected") === "true"`);
  await openResearchByName(driver, "Paul");
  await driver.waitFor(`document.querySelectorAll('[id^="research-workspace-tab-"]').length === 2
    && document.querySelectorAll('.scripture-workspace-group').length === 1
    && document.querySelector('.scripture-workspace-group-count')?.textContent?.trim() === "2"`, 20_000);
  const secondResearchTabId = await driver.evaluate(`document.querySelector('[id^="research-workspace-tab-"][aria-selected="true"]')?.id ?? ""`);
  assert.notEqual(secondResearchTabId, firstResearchTabId);
  const secondResearchScroll = await driver.evaluate(`(() => {
    const margin = document.querySelector(".living-margin");
    if (!margin) return -1;
    margin.scrollTop = Math.max(1, Math.min(90, margin.scrollHeight - margin.clientHeight));
    margin.dispatchEvent(new Event("scroll"));
    return margin.scrollTop;
  })()`);
  await driver.evaluate(`document.getElementById(${JSON.stringify(firstResearchTabId)})?.click()`);
  await driver.waitFor(`document.getElementById(${JSON.stringify(firstResearchTabId)})?.getAttribute("aria-selected") === "true"`);
  assert.ok(Math.abs(await driver.evaluate(`document.querySelector(".living-margin")?.scrollTop ?? -1`) - firstResearchScroll) <= 2);
  await driver.evaluate(`document.getElementById(${JSON.stringify(secondResearchTabId)})?.click()`);
  await driver.waitFor(`document.getElementById(${JSON.stringify(secondResearchTabId)})?.getAttribute("aria-selected") === "true"`);
  assert.ok(Math.abs(await driver.evaluate(`document.querySelector(".living-margin")?.scrollTop ?? -1`) - secondResearchScroll) <= 2);
  await driver.evaluate(`document.querySelector("#scripture-workspace-tab")?.click()`);
  await driver.waitFor(`document.querySelector('#scripture-workspace-tab')?.getAttribute("aria-selected") === "true"`);
  await driver.evaluate(`document.querySelector("#margin-notes-tab")?.click()`);
  const studyScroll = await driver.evaluate(`(() => {
    const margin = document.querySelector(".living-margin");
    if (!margin) return -1;
    margin.scrollTop = Math.max(1, Math.min(140, margin.scrollHeight - margin.clientHeight));
    margin.dispatchEvent(new Event("scroll"));
    return margin.scrollTop;
  })()`);
  await driver.evaluate(`document.getElementById(${JSON.stringify(secondResearchTabId)})?.click()`);
  await driver.waitFor(`document.getElementById(${JSON.stringify(secondResearchTabId)})?.getAttribute("aria-selected") === "true"`);
  await driver.evaluate(`document.querySelector(".scripture-workspace-tab-wrap.is-selected .scripture-workspace-tab-close")?.click()`);
  await driver.waitFor(`document.querySelectorAll('[id^="research-workspace-tab-"]').length === 1
    && document.querySelector('#scripture-workspace-tab')?.getAttribute("aria-selected") === "true"`);
  assert.ok(Math.abs(await driver.evaluate(`document.querySelector(".living-margin")?.scrollTop ?? -1`) - studyScroll) <= 2);
  assert.equal(await driver.evaluate(`document.querySelector("#margin-notes-tab")?.getAttribute("aria-selected")`), "true");
  for (const name of ["Peter", "Jerusalem", "Moses", "Rome", "Timothy"]) {
    await openResearchByName(driver, name);
  }
  await driver.waitFor(`document.querySelectorAll('[id^="research-workspace-tab-"]').length === 6
    && Boolean(document.querySelector(".scripture-workspace-overflow"))`, 20_000);
  await driver.evaluate(`document.querySelector(".scripture-workspace-group-toggle")?.click()`);
  await driver.waitFor(`document.querySelector(".scripture-workspace-group")?.classList.contains("is-collapsed")
    && document.querySelector('#scripture-workspace-tab')?.getAttribute("aria-selected") === "true"`);
  await driver.evaluate(`document.querySelector(".scripture-workspace-group-toggle")?.click()`);
  await driver.waitFor(`!document.querySelector(".scripture-workspace-group")?.classList.contains("is-collapsed")`);
  await driver.evaluate(`document.querySelector('[id^="research-workspace-tab-"]')?.click()`);
  await driver.waitFor(`document.querySelector('[id^="research-workspace-tab-"]')?.getAttribute("aria-selected") === "true"`);
  await driver.evaluate(`document.querySelector(".scripture-workspace-overflow")?.click()`);
  await driver.waitFor(`document.querySelectorAll(".scripture-workspace-overflow-row").length === 6`);
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
  await driver.evaluate(`document.querySelector(".scripture-workspace-overflow-group > header button")?.click()`);
  await driver.waitFor(`document.querySelectorAll('[id^="research-workspace-tab-"]').length === 0
    && document.querySelector('#scripture-workspace-tab')?.getAttribute("aria-selected") === "true"
    && !document.querySelector("#entity-research-title")
    && !document.querySelector(".scripture-workspace-overflow-popover")`);
  assert.ok(Math.abs(await driver.evaluate(`document.querySelector(".living-margin")?.scrollTop ?? -1`) - studyScroll) <= 2);

  await selectPhrase(driver, fixture.widening, "refused");
  await driver.evaluate(`document.querySelector('[data-marking-surface="palette"] [data-relationship-kind="series"]')?.click()`);
  await sleep(500);
  if (!await driver.evaluate(`document.body.textContent?.includes("This translation cannot preserve those exact words yet")`)) {
    await driver.evaluate(`document.querySelector('[data-marking-surface="palette"] [data-relationship-kind="series"]')?.click()`);
  }
  await driver.waitFor(`document.body.textContent?.includes("This translation cannot preserve those exact words yet")`);
  assert.equal(await driver.evaluate(`Boolean(document.querySelector(".marking-session"))`), false);
  assert.equal(await driver.evaluate(`getSelection()?.toString()`), "Holy Spirit");
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

  console.log("PASS desktop D8: exact phrase guard, canonical order + attention, explicit draft exits, grouped Scripture/Research tabs");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}\nElectron log:\n${childLog}`);
} finally {
  cdp?.socket.close();
  if (!childState.exited) child.kill("SIGTERM");
  await sleep(300);
  if (!childState.exited) child.kill("SIGKILL");
  rmSync(qaRoot, { recursive: true, force: true });
}
