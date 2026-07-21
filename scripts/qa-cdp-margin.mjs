/**
 * Live-app QA over CDP (B3.5 Gate R3): drives the RUNNING Electron app's
 * renderer through its remote-debugging endpoint and verifies the shipping
 * IPC path end-to-end (preload → main → hidden-renderer embeddings → hybrid
 * retrieval), plus captures a screenshot for visual review.
 * Temporary QA driver; requires the app launched with --remote-debugging-port=9222.
 */

const CDP_HTTP = "http://localhost:9222/json/list";

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

async function evaluate(cdp, expression) {
  const resp = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (resp.result?.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(resp.result.exceptionDetails).slice(0, 300)}`);
  }
  return resp.result?.result?.value;
}

const pages = await (await fetch(CDP_HTTP)).json();
const app = pages.find((p) => p.title === "Pericope");
if (!app) {
  console.error("QA FAIL: Pericope page not found on :9222");
  process.exit(1);
}
const cdp = await connect(app.webSocketDebuggerUrl);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// 1. ACT 19:1-7 through the real preload/IPC path.
const act = await evaluate(
  cdp,
  `window.api.ai.semanticMargin({book:"ACT",startChapter:19,startVerse:1,endChapter:19,endVerse:7,passageText:${JSON.stringify(
    "Paul, having passed through the upper country, came to Ephesus and found certain disciples. He said to them, Did you receive the Holy Spirit when you believed? They said, No, we haven't even heard whether there is a Holy Spirit. He said, Into what then were you baptized? They said, Into John's baptism. Paul said, John indeed baptized with the baptism of repentance, saying to the people that they should believe in the one who would come after him, that is, in Jesus. When they heard this, they were baptized in the name of the Lord Jesus. When Paul had laid his hands on them, the Holy Spirit came on them and they spoke with other languages and prophesied.",
  )}})`,
);
console.log("\nACT 19:1-7 (live app):");
check("semantic notes surfaced", (act?.semanticNotes?.length ?? 0) > 0, `${act?.semanticNotes?.length}`);
check(
  "every surfaced note has a reason (M4)",
  (act?.semanticNotes ?? []).every((n) => n.reasons?.length > 0),
);
check(
  "crossref evidence present",
  (act?.semanticNotes ?? []).some((n) => n.reasons?.some((r) => r.kind === "reference")),
);
check("claims-v2 surfaced with note evidence", (act?.claims ?? []).some((c) => c.sources?.some((s) => s.kind === "note" && s.quote)));
for (const n of act?.semanticNotes ?? []) {
  console.log(`    · ${n.title} [${n.reasons.map((r) => r.label).join(" | ")}]`);
}

// 2. LEV 13:1-8 must be silent (M1).
const lev = await evaluate(
  cdp,
  `window.api.ai.semanticMargin({book:"LEV",startChapter:13,startVerse:1,endChapter:13,endVerse:8,passageText:${JSON.stringify(
    "When a man shall have a rising in his body's skin, or a scab, or a bright spot, and it becomes in the skin of his body the plague of leprosy, then he shall be brought to Aaron the priest, or to one of his sons, the priests; and the priest shall examine the plague in the skin of the body.",
  )}})`,
);
console.log("\nLEV 13:1-8 (live app):");
check("M1 silence: zero semantic notes", (lev?.semanticNotes?.length ?? 0) === 0, `${lev?.semanticNotes?.length}`);
check("no circular suggested cross-refs", !(lev?.suggestedCrossRefs ?? []).some((x) => x.targetBref.includes("LEV.13")));

// 3. Screenshot for the visual record.
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/qa-margin-screenshot.png", Buffer.from(shot.result.data, "base64"));
  console.log("\nscreenshot: /tmp/qa-margin-screenshot.png");
}

cdp.ws.close();
console.log(failures === 0 ? "\nQA PASS" : `\nQA FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
