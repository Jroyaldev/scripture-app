/**
 * Live-app QA over CDP (B3.6 Gate E4): drives the RUNNING Electron app's
 * WritingSheet like a user — types a ref-free quick note, saves, waits for
 * the capture echo, anchors a suggestion, verifies the note gained a real
 * user-authored ref line, then undoes it (A-5 symmetry).
 * Requires the app launched with --remote-debugging-port=9222 and the demo
 * library's budget envelope set to backgroundAI: "cloud".
 */

const CDP_HTTP = "http://localhost:9222/json/list";

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}

const evaluate = async (cdp, expression) => {
  const resp = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) throw new Error(JSON.stringify(resp.result.exceptionDetails).slice(0, 300));
  return resp.result?.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((p) => p.title === "Scripture Library");
if (!app) { console.error("QA FAIL: app not found"); process.exit(1); }
const cdp = await connect(app.webSocketDebuggerUrl);

// 1. Open the writing sheet (nav differs; find any control that mounts it).
const opened = await evaluate(cdp, `(() => {
  const byText = (txt) => [...document.querySelectorAll("button, [role=button], a, .nav-item, .sidebar-item")]
    .find((e) => e.textContent && e.textContent.trim().toLowerCase().includes(txt));
  const target = byText("write") ?? byText("new note") ?? byText("notes");
  if (!target) return "no nav control found";
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return "clicked: " + target.textContent.trim().slice(0, 24);
})()`);
console.log(`nav: ${opened}`);
await sleep(800);

const hasSheet = await evaluate(cdp, `Boolean(document.querySelector(".writing-sheet"))`);
check("writing sheet mounted", hasSheet);
if (!hasSheet) { cdp.ws.close(); process.exit(1); }

// 2. Type a ref-free quick note using native setters (React-controlled inputs).
await evaluate(cdp, `(() => {
  const setValue = (el, value, proto) => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setValue(document.querySelector(".note-title-input"), "qa echo test", HTMLInputElement.prototype);
  setValue(document.querySelector(".note-body-editor"), "The vine grows fruit only on branches that stay connected.", HTMLTextAreaElement.prototype);
  return "typed";
})()`);
await evaluate(cdp, `(() => {
  const btn = [...document.querySelectorAll(".note-meta button")].find((b) => b.textContent.includes("Save"));
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return "saved";
})()`);

// 3. Wait for the echo (enrichment can take up to ~60s on the DEEP tier).
let echo = null;
for (let i = 0; i < 30; i++) {
  await sleep(3000);
  echo = await evaluate(cdp, `(() => {
    const e = document.querySelector(".capture-echo");
    if (!e) return null;
    return {
      listening: Boolean(e.querySelector(".echo-listening")),
      pills: [...e.querySelectorAll(".echo-pill-anchor")].map((p) => p.textContent.trim()),
      provenance: e.querySelector(".echo-provenance")?.textContent ?? "",
    };
  })()`);
  if (echo && !echo.listening && echo.pills.length > 0) break;
}
check("capture echo appeared with suggestions", Boolean(echo && echo.pills.length > 0), JSON.stringify(echo?.pills));
check("echo declares AI provenance", Boolean(echo && /AI-inferred/.test(echo.provenance)));
console.log(`  suggestions: ${echo?.pills.join(" · ")}`);

// 4. Anchor the first suggestion; verify the note gained the ref line.
const firstPill = echo?.pills[0];
if (firstPill) {
  await evaluate(cdp, `(() => {
    const p = [...document.querySelectorAll(".echo-pill-anchor")][0];
    p.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return "anchored";
  })()`);
  const anchoredState = await evaluate(cdp, `(() => ({
    anchored: [...document.querySelectorAll(".echo-pill.anchored")].map((p) => p.textContent.trim()),
  }))()`);
  check("pill moved to anchored state", anchoredState.anchored.length === 1, JSON.stringify(anchoredState.anchored));

  // Poll: confirm writes the note file, commits, and rebuilds — allow up to 30s.
  let hasRelated = false;
  for (let i = 0; i < 10 && !hasRelated; i++) {
    await sleep(3000);
    hasRelated = await evaluate(cdp, `(async () => {
      const notes = await window.api.library.readAllNotes();
      const note = notes.find((n) => n.frontmatter.title === "qa echo test");
      return note ? note.body.includes("Related: ") : false;
    })()`);
  }
  check("note file gained the user-authored ref line (INV-11)", hasRelated);

  // 5. Undo (A-5): the line must vanish again.
  await evaluate(cdp, `(() => {
    const u = document.querySelector(".echo-pill-undo");
    u.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return "undone";
  })()`);
  let stillRelated = true;
  for (let i = 0; i < 10 && stillRelated; i++) {
    await sleep(3000);
    stillRelated = await evaluate(cdp, `(async () => {
      const notes = await window.api.library.readAllNotes();
      const note = notes.find((n) => n.frontmatter.title === "qa echo test");
      return note ? note.body.includes("Related:") : true;
    })()`);
  }
  check("undo removed the ref line (A-5 symmetry)", !stillRelated);
}

cdp.ws.close();
console.log(failures === 0 ? "\nQA PASS" : `\nQA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
