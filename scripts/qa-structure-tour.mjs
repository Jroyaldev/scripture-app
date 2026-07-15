/**
 * Screenshot tour for the full-page Structure study views.
 *
 * Usage (Electron on --remote-debugging-port=9222):
 *   node scripts/qa-structure-tour.mjs greek  "Luke 4:14" "Spirit"
 *   node scripts/qa-structure-tour.mjs hebrew "Genesis 1:1" "create"
 *   node scripts/qa-structure-tour.mjs repeated "Genesis 1:2" "over" 2
 *   node scripts/qa-structure-tour.mjs greek-phone "Romans 1:5" "received" 1 --mobile
 *   node scripts/qa-structure-tour.mjs luke-detail "Luke 4:14" "Spirit" 1 --phrase
 *   node scripts/qa-structure-tour.mjs luke-detail "Luke 4:14" "Spirit" 1 --phrase --both-detail
 *   node scripts/qa-structure-tour.mjs sentence-nav "Genesis 1:2" "wind" 1 --navigate
 *   node scripts/qa-structure-tour.mjs journey "Romans 1:5" "received" 1 --phrase --progress
 *
 * The tour is read-only: it opens Read, selects the requested language word,
 * captures Clause and the conditional Sentence map in both themes, closes the
 * modal, and restores the original theme. PNGs -> docs/ui-audit/structure/.
 */

import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/structure";
const label = process.argv[2] ?? "structure";
const passage = process.argv[3] ?? "Luke 4:14";
const wordMatch = process.argv[4] ?? "Spirit";
const requestedOccurrence = Number(process.argv[5] ?? 1);
const wordOccurrence = Number.isFinite(requestedOccurrence)
  ? Math.max(1, requestedOccurrence)
  : 1;
const mobile = process.argv.includes("--mobile");
const phraseDetail = process.argv.includes("--phrase");
const bothPhraseViews = process.argv.includes("--both-detail");
const clauseNavigation = process.argv.includes("--navigate");
const embeddedNavigation = process.argv.includes("--embedded");
const journeyNavigation = process.argv.includes("--progress");

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
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const messageId = ++id;
      pending.set(messageId, resolve);
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  return { ws, send };
}

const pages = await (await fetch(CDP_HTTP)).json();
const page = pages.find((candidate) => candidate.title === "Scripture Library");
if (!page) {
  console.error("FAIL: Scripture Library is not available on :9222");
  process.exit(1);
}
const cdp = await connect(page.webSocketDebuggerUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);
}

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 500));
  }
  return response.result?.result?.value;
}

async function screenshot(name) {
  const modalOpen = await evaluate(`Boolean(document.querySelector(".structure-modal-panel"))`);
  if (!modalOpen) throw new Error("Structure modal is not open");
  await cdp.send("Page.bringToFront");
  await sleep(500);
  const capture = () => cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(mobile ? { fromSurface: false } : {}),
  });
  // Electron can hand back stale/black compositor tiles immediately after a
  // tab or theme switch. Prime the painted surface and keep the next frame.
  await capture();
  await sleep(mobile ? 180 : 100);
  const response = await capture();
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${label}-${name}.png`;
  writeFileSync(path, Buffer.from(response.result.data, "base64"));
  console.log("  saved", path);
}

// Always return to the read surface. This avoids depending on previous QA state.
await evaluate(`(() => {
  const read = [...document.querySelectorAll(".nav-item")]
    .find((item) => item.textContent?.trim().startsWith("Read"));
  read?.click();
})()`);
await sleep(800);

const marginOpen = await evaluate(
  `document.querySelector(".margin-toggle-btn")?.classList.contains("active") ?? false`,
);
if (!marginOpen) {
  await evaluate(`document.querySelector(".margin-toggle-btn")?.click()`);
  await sleep(500);
}

// Use BSB where available so the visible passage and source glosses are stable.
const version = await evaluate(`document.querySelector(".version-picker-btn")?.textContent ?? ""`);
if (!/BSB/i.test(version)) {
  await evaluate(`document.querySelector(".version-picker-btn")?.click()`);
  await sleep(250);
  await evaluate(`
    [...document.querySelectorAll(".version-picker-item")]
      .find((button) => /BSB/i.test(button.textContent ?? ""))?.click()
  `);
  await sleep(600);
}

await evaluate(`(() => {
  const input = document.querySelector(".passage-jump-input");
  if (!input) throw new Error("Passage jump input not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(passage)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.closest("form")?.requestSubmit();
})()`);
await sleep(1000);

const requestedVerse = passage.match(/:(\d+)\s*$/)?.[1];
if (requestedVerse) {
  const pinned = await evaluate(`(() => {
    const verse = document.querySelector(${JSON.stringify(`.verse-line[data-verse="${requestedVerse}"]`)});
    if (!verse) return false;
    const selected = verse.classList.contains("is-selected") || verse.classList.contains("selected");
    if (!selected) verse.click();
    return true;
  })()`);
  if (!pinned) throw new Error(`Verse ${requestedVerse} was not rendered`);
  await sleep(900);
}

await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
await sleep(250);

const selected = await evaluate(`(() => {
  const normalize = (value) => (value ?? "").normalize("NFC").toLowerCase();
  const wanted = normalize(${JSON.stringify(wordMatch)});
  const words = [...document.querySelectorAll(".lang-word")];
  const matches = words.filter((candidate) => normalize(candidate.textContent).includes(wanted));
  const word = matches[${JSON.stringify(wordOccurrence - 1)}];
  if (!word) return { ok: false, words: words.map((candidate) => candidate.textContent?.trim()).slice(0, 20) };
  word.click();
  return { ok: true, word: word.textContent?.trim() };
})()`);
if (!selected.ok) {
  throw new Error(`Language word not found: ${JSON.stringify(selected.words)}`);
}
console.log("word:", selected.word);
await sleep(700);

await evaluate(`document.querySelector(".lang-syntax-toggle")?.click()`);
await sleep(800);
if (!(await evaluate(`Boolean(document.querySelector(".structure-modal-panel"))`))) {
  throw new Error("Structure modal did not open");
}

const originallyDark = await evaluate(
  `document.querySelector(".app-shell")?.classList.contains("dark") ?? false`,
);
const themes = originallyDark ? ["dark", "light"] : ["light", "dark"];

for (let themeIndex = 0; themeIndex < themes.length; themeIndex += 1) {
  if (themeIndex > 0) {
    await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
    await sleep(350);
  }
  const modeLabels = await evaluate(`
    [...document.querySelectorAll(".lang-syntax-mode")]
      .map((button) => button.textContent?.trim())
      .filter(Boolean)
  `);
  const modes = modeLabels.length ? modeLabels : ["Clause"];
  for (const mode of modes) {
    await cdp.send("Page.bringToFront");
    await evaluate(`
      [...document.querySelectorAll(".lang-syntax-mode")]
        .find((button) => button.textContent?.trim() === ${JSON.stringify(mode)})?.click()
    `);
    await evaluate(`document.body.getBoundingClientRect(); true`);
    await sleep(850);
    await screenshot(`${themes[themeIndex]}-${mode.toLowerCase().replace(/\s+/g, "-")}`);

    if (journeyNavigation && mode === "Clause") {
      const advanced = await evaluate(`(() => {
        const next = document.querySelector(
          '.lang-study-nav-step.is-next:not([aria-disabled="true"])',
        );
        if (!next) return false;
        next.click();
        return true;
      })()`);
      if (advanced) {
        await sleep(350);
        await screenshot(`${themes[themeIndex]}-direct-next-clause`);
        await evaluate(`document.querySelector(".lang-study-nav-return")?.click()`);
        await sleep(250);
      }
    }

    if (phraseDetail && mode === "Clause") {
      const opened = await evaluate(`(() => {
        const candidates = [...document.querySelectorAll("button.lang-flow-group.has-detail")];
        const group = candidates.find((candidate) => candidate.classList.contains("is-focus"))
          ?? candidates[0];
        if (!group) return null;
        group.click();
        return group.textContent?.trim() ?? "phrase";
      })()`);
      if (opened) {
        await sleep(450);
        await screenshot(`${themes[themeIndex]}-phrase-detail`);
        if (bothPhraseViews) {
          for (const detailView of ["Diagram", "Outline"]) {
            await evaluate(`
              [...document.querySelectorAll(".lang-phrase-detail-views button")]
                .find((button) => button.textContent?.trim() === ${JSON.stringify(detailView)})?.click()
            `);
            await sleep(450);
            await screenshot(
              `${themes[themeIndex]}-phrase-${detailView.toLowerCase()}`,
            );
          }
        }
        if (journeyNavigation) {
          await evaluate(`
            [...document.querySelectorAll(".lang-phrase-detail-views button")]
              .find((button) => button.textContent?.trim() === "Diagram")?.click()
          `);
          await sleep(200);
          const advanced = await evaluate(`(() => {
            const next = document.querySelector(
              '.lang-study-nav-step.is-next:not([aria-disabled="true"])',
            );
            if (!next) return false;
            next.click();
            return true;
          })()`);
          if (advanced) {
            await sleep(350);
            await screenshot(`${themes[themeIndex]}-direct-next-phrase`);
            await evaluate(`
              document.querySelector(
                '.lang-study-nav-step.is-previous:not([aria-disabled="true"])',
              )?.click()
            `);
            await sleep(250);
          }
        }
        if (embeddedNavigation) {
          await evaluate(`
            [...document.querySelectorAll(".lang-phrase-detail-views button")]
              .find((button) => button.textContent?.trim() === "Diagram")?.click()
          `);
          await sleep(250);
          const navigated = await evaluate(`(() => {
            const target = document.querySelector(
              "button.lang-phrase-diagram-node.kind-clause, .lang-phrase-open-clause",
            );
            if (!target) return false;
            target.click();
            return true;
          })()`);
          if (navigated) {
            await sleep(350);
            await screenshot(`${themes[themeIndex]}-embedded-clause-navigation`);
            await evaluate(`document.querySelector("#structure-tab-sentence")?.click()`);
            await sleep(160);
            await evaluate(`document.querySelector("button.lang-outline-clause.is-focus")?.click()`);
            await sleep(200);
          } else {
            await evaluate(`document.querySelector(".lang-phrase-detail-close")?.click()`);
          }
        } else {
          await evaluate(`document.querySelector(".lang-phrase-detail-close")?.click()`);
        }
        await sleep(200);
      }
    }

    if (clauseNavigation && mode === "Sentence map") {
      const opened = await evaluate(`(() => {
        const clause = document.querySelector("button.lang-outline-clause:not(.is-focus)");
        if (!clause) return false;
        clause.click();
        return true;
      })()`);
      if (opened) {
        await sleep(350);
        await screenshot(`${themes[themeIndex]}-clause-navigation`);
        await evaluate(`document.querySelector("#structure-tab-sentence")?.click()`);
        await sleep(200);
        // Restore the source-selected clause so the next theme starts from the
        // same state instead of inheriting the clause used for navigation QA.
        await evaluate(`document.querySelector("button.lang-outline-clause.is-focus")?.click()`);
        await sleep(200);
      }
    }
  }
}

await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
await sleep(250);
await evaluate(`document.querySelector(".structure-modal-close")?.click()`);
await sleep(180);
if (mobile) await cdp.send("Emulation.clearDeviceMetricsOverride");
cdp.ws.close();
console.log("done");
