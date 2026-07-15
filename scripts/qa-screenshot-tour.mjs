/**
 * Screenshot tour over CDP for visual design review — self-driving.
 *
 * Usage (app launched with --remote-debugging-port=9222):
 *   node scripts/qa-screenshot-tour.mjs greek  "John 3:16"  "ἀγαπ"
 *   node scripts/qa-screenshot-tour.mjs hebrew "Genesis 1:1" "ברא"
 *
 * Drives: version → BSB, jump to passage, pin verse, tap the matching word
 * in the margin strip, then captures every orbit pill in all four themes
 * (full window + margin close-up). PNGs → docs/ui-audit/screens/.
 * Restores the original theme when done.
 */

import { mkdirSync, writeFileSync } from "node:fs";

const CDP_HTTP = "http://localhost:9222/json/list";
const OUT_DIR = "docs/ui-audit/screens";
const label = process.argv[2] ?? "card";
const passage = process.argv[3] ?? null;
const wordMatch = process.argv[4] ?? null;

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
  const send = (method, params = {}) =>
    new Promise((res) => {
      const msgId = ++id;
      pending.set(msgId, res);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  return { ws, send };
}

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((p) => p.title === "Scripture Library");
if (!app) {
  console.error("FAIL: Scripture Library not on :9222 (launch with --remote-debugging-port=9222)");
  process.exit(1);
}
const cdp = await connect(app.webSocketDebuggerUrl);

async function evaluate(expression) {
  const resp = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (resp.result?.exceptionDetails) {
    throw new Error(JSON.stringify(resp.result.exceptionDetails).slice(0, 400));
  }
  return resp.result?.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, clipSel) {
  let clip;
  if (clipSel) {
    const r = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(clipSel)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, scale: 1 };
    })()`);
    if (r && r.width > 40) clip = r;
  }
  // Chromium can return black compositor tiles for a clipped, scrollable
  // Electron panel when captureBeyondViewport defaults true. The margin is
  // already viewport-sized; keep the capture on painted surface tiles only.
  await cdp.send("Page.bringToFront");
  if (clip) await sleep(500);
  const resp = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${label}-${name}.png`;
  writeFileSync(path, Buffer.from(resp.result.data, "base64"));
  console.log("  saved", path);
}

/* ── navigation ─────────────────────────────────────────────── */

if (passage) {
  // 1. Version → BSB (skip if already BSB)
  const cur = await evaluate(`document.querySelector(".version-picker-btn")?.textContent?.trim() ?? ""`);
  if (!/BSB/i.test(cur)) {
    await evaluate(`document.querySelector(".version-picker-btn")?.click()`);
    await sleep(350);
    await evaluate(`
      [...document.querySelectorAll(".version-picker-item")]
        .find((b) => /BSB/i.test(b.textContent))?.click()
    `);
    await sleep(600);
  }

  // 2. Jump — requestSubmit (synthetic Enter does not submit React forms)
  await evaluate(`(() => {
    const inp = document.querySelector(".passage-jump-input");
    if (!inp) throw new Error("no .passage-jump-input");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(inp, ${JSON.stringify(passage)});
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.closest("form").requestSubmit();
  })()`);
  await sleep(1200);

  // A same-chapter jump (e.g. already in John 3, request John 3:16) does not
  // remount the chapter, so explicitly pin the requested verse after submit.
  // This also makes the tour's “pin verse” step deterministic on repeat runs.
  const requestedVerse = passage.match(/:(\d+)\s*$/)?.[1] ?? null;
  if (requestedVerse) {
    const pinned = await evaluate(`(() => {
      const verse = document.querySelector(
        ${JSON.stringify(`.verse-line[data-verse="${requestedVerse}"]`)},
      );
      if (!verse) return false;
      const alreadyPinned =
        verse.classList.contains("is-selected") || verse.classList.contains("selected");
      if (!alreadyPinned) verse.click();
      return true;
    })()`);
    if (!pinned) {
      console.error(`FAIL: verse ${requestedVerse} was not rendered after passage jump`);
      process.exit(1);
    }
    await sleep(500);
  }

  // 3. Dismiss the highlight palette if the jump's verse-select opened it
  //    (Escape keeps the verse pin, hides the floating toolbar).
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(400);
}

if (wordMatch) {
  const hit = await evaluate(`(() => {
    const norm = (s) => (s || "").normalize("NFC");
    const want = norm(${JSON.stringify(wordMatch)});
    const words = [...document.querySelectorAll(".lang-word")];
    const el = words.find((w) => {
      const form = norm(w.querySelector(".lang-word-form")?.textContent);
      const eng = norm(w.querySelector(".lang-word-eng")?.textContent);
      return form.includes(want) || eng.toLowerCase().includes(want.toLowerCase());
    });
    if (!el) return { ok: false, forms: words.slice(0, 12).map((w) => w.textContent.trim()) };
    el.click();
    return { ok: true, form: el.querySelector(".lang-word-form")?.textContent };
  })()`);
  if (!hit?.ok) {
    console.error("FAIL: word not found in strip. Strip had:", JSON.stringify(hit?.forms));
    process.exit(1);
  }
  console.log("word card:", hit.form);
  await sleep(900);
}

/* ── capture: pills × themes ────────────────────────────────── */

const pills = await evaluate(
  `[...document.querySelectorAll(".lang-orbit-mode")].map((b) => b.textContent.trim())`,
);
if (!pills || pills.length === 0) {
  console.error("FAIL: no orbit pills — is a word card open in the margin?");
  process.exit(1);
}
console.log("pills:", pills.join(" · "));

const originalTheme = await evaluate(
  `document.querySelector(".app-shell")?.dataset.theme ?? "light"`,
);
const allThemes = ["light", "dark", "glass", "dark-glass"];
const themes = [originalTheme, ...allThemes.filter((theme) => theme !== originalTheme)];

async function clickPill(text) {
  await evaluate(`
    [...document.querySelectorAll(".lang-orbit-mode")]
      .find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click()
  `);
  await sleep(300);
}

async function setTheme(theme) {
  const current = await evaluate(`document.querySelector(".app-shell")?.dataset.theme ?? "light"`);
  if (current === theme) return;
  await evaluate(`document.querySelector(".theme-toggle-btn")?.click()`);
  await sleep(200);
  const changed = await evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(`[data-theme-id="${theme}"]`)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  if (!changed) throw new Error(`Theme choice not found: ${theme}`);
  await sleep(500);
}

for (let t = 0; t < themes.length; t++) {
  await setTheme(themes[t]);
  for (const pill of pills) {
    await clickPill(pill);
    const slug = pill.toLowerCase().replace(/\s+/g, "-");
    await shot(`${themes[t]}-${slug}-full`);
    await shot(`${themes[t]}-${slug}-margin`, ".living-margin");
  }
}
await setTheme(originalTheme); // restore

console.log("done —", OUT_DIR);
cdp.ws.close();
process.exit(0);
