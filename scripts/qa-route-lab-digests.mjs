/**
 * Permanent non-Electron browser gate for the two frozen Route Lab oracles.
 *
 * The command serves the checked-out lab from an isolated loopback server,
 * launches a fresh headless Chrome profile, and compares the browser-produced
 * digests with committed constants. It deliberately has no update/rebaseline
 * mode: changing a baseline must be an explicit reviewed source edit.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForState } from "./qa-support/app-vocabulary.mjs";

const EXPECTED = Object.freeze({
  c03Projection: "8b2dcd67ecc6cdbee5ebabf05810ae4f55ba2e321d7000719fc1f9012b1ca1cb",
  c04Sweep: "3b01cd13a8db1c6b360e956622be1610de416a63ab745bde4aecf3967c5f6b7f",
});

const REPO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function chromeExecutable() {
  const configured = process.env.ROUTE_QA_CHROME;
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("Route Lab digest QA requires Chrome or Chromium; set ROUTE_QA_CHROME to its executable path.");
  }
  return executable;
}

async function availablePort() {
  const server = createServer();
  server.unref();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a Route Lab QA port.");
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function startStaticServer() {
  const server = createServer((request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      const candidate = resolve(REPO_ROOT, `.${pathname}`);
      if (candidate !== REPO_ROOT && !candidate.startsWith(`${REPO_ROOT}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const body = readFileSync(candidate);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": body.byteLength,
        "content-type": MIME.get(extname(candidate)) ?? "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Route Lab QA server did not expose a port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise, reject) =>
      server.close((error) => error ? reject(error) : resolvePromise())),
  };
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out opening the Route Lab CDP socket."));
    }, 15_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Route Lab CDP socket failed during connection."));
    };
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = message.id && pending.get(message.id);
    if (!request) return;
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
  socket.onclose = () => rejectPending(new Error("Route Lab CDP socket closed."));
  socket.onerror = () => rejectPending(new Error("Route Lab CDP socket failed."));
  const send = (method, params = {}, timeout = 30_000) => new Promise((resolvePromise, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => {
      pending.delete(messageId);
      reject(new Error(`Timed out waiting for CDP ${method}.`));
    }, timeout);
    pending.set(messageId, { resolve: resolvePromise, reject, timer });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { socket, send };
}

async function waitForPage(endpoint, childState, expectedUrl, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (childState.spawnError) throw new Error(`Chrome could not be spawned: ${childState.spawnError}`);
    if (childState.exited) {
      throw new Error(`Chrome exited before exposing Route Lab (code ${childState.code}, signal ${childState.signal}).`);
    }
    try {
      const targets = await (await fetch(endpoint, { signal: AbortSignal.timeout(1_000) })).json();
      const page = targets.find((candidate) => candidate.type === "page" && candidate.url === expectedUrl);
      if (page) return page;
    } catch {
      // Chrome may still be opening its isolated debug socket.
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${expectedUrl}.`);
}

function driverFor(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_600));
    }
    return response.result?.result?.value;
  };
  // Vets the gate's vocabulary before waiting, so a condition the app can
  // never satisfy fails at once instead of hanging and reading like a slow
  // app. See scripts/qa-support/app-vocabulary.mjs.
  const waitFor = async (expression, timeout = 30_000) => {
    await waitForState(evaluate, sleep, expression, timeout);
  };
  return { evaluate, waitFor };
}

async function assertRouteFonts(driver) {
  const faces = await driver.evaluate(`[...document.fonts].map((face) => ({ family: face.family, status: face.status }))`);
  for (const family of ["Source Serif 4", "Inter", "JetBrains Mono"]) {
    assert.ok(
      faces.some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded"),
      `Frozen Route Lab geometry requires loaded ${family}; refusing to hash a fallback-font render.`,
    );
  }
}

async function waitForResult(driver, selector, timeout = 12 * 60_000) {
  const started = Date.now();
  let lastProgress = "";
  while (Date.now() - started < timeout) {
    const state = await driver.evaluate(`(() => {
      const output = document.querySelector(${JSON.stringify(selector)});
      return output ? {
        status: output.dataset.status,
        sha256: output.dataset.sha256 || "",
        expectedSha256: output.dataset.expectedSha256 || "",
        legacyProjectionSha256: output.dataset.legacyProjectionSha256 || "",
        states: output.dataset.states || "",
        text: output.textContent || "",
      } : null;
    })()`);
    if (state?.text && state.text !== lastProgress) {
      lastProgress = state.text;
      console.log(state.text);
    }
    if (state?.status === "pass" || state?.status === "fail") return state;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${selector}; last progress: ${lastProgress || "no output"}.`);
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
  if (!childState.exited) throw new Error("Route Lab QA Chrome process did not terminate.");
}

const staticServer = await startStaticServer();
const debugPort = await availablePort();
const qaRoot = mkdtempSync(resolve(tmpdir(), "scripture-route-lab-qa-"));
const firstUrl = `${staticServer.origin}/lab/route.html?qa=c03-projection`;
const sweepUrl = `${staticServer.origin}/lab/route.html?qa=c04-sweep`;
const endpoint = `http://127.0.0.1:${debugPort}/json/list`;
const chrome = spawn(chromeExecutable(), [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${resolve(qaRoot, "profile")}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--force-device-scale-factor=2",
  "--window-size=1440,1200",
  ...(typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : []),
  firstUrl,
], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
const childState = { exited: false, code: null, signal: null, spawnError: null };
chrome.once("exit", (code, signal) => Object.assign(childState, { exited: true, code, signal }));
chrome.once("error", (error) => { childState.spawnError = String(error); });
let chromeLog = "";
const retainLog = (chunk) => { chromeLog = (chromeLog + chunk.toString()).slice(-16_000); };
chrome.stdout.on("data", retainLog);
chrome.stderr.on("data", retainLog);

let cdp = null;
try {
  const target = await waitForPage(endpoint, childState, firstUrl);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = driverFor(cdp);
  await driver.waitFor(`document.readyState === "complete" && Boolean(document.querySelector("#sheet .overlay"))`);
  await driver.waitFor(`Boolean(document.querySelector("#c03-projection-result"))`, 60_000);
  await assertRouteFonts(driver);
  const projection = await waitForResult(driver, "#c03-projection-result");
  assert.equal(projection.status, "pass", projection.text);
  assert.equal(projection.sha256, EXPECTED.c03Projection, "C0.3 projection digest changed.");
  assert.equal(projection.expectedSha256, EXPECTED.c03Projection, "C0.3 browser baseline drifted from the immutable QA command.");
  assert.equal(projection.states, "4515", "C0.3 projection did not cover all 4,515 states.");

  const navigation = await cdp.send("Page.navigate", { url: sweepUrl });
  if (navigation.result?.errorText) throw new Error(`Could not navigate to C0.4 sweep: ${navigation.result.errorText}`);
  await driver.waitFor(`location.href === ${JSON.stringify(sweepUrl)} && document.readyState === "complete"`, 60_000);
  await driver.waitFor(`Boolean(document.querySelector("#c04-sweep-result"))`, 60_000);
  await assertRouteFonts(driver);
  // The sweep renders 5,719 states twice; on a loaded or thermally throttled
  // machine 12 minutes is not enough. The gate's purpose is hash equality,
  // not speed, so the wait budget is generous.
  const sweep = await waitForResult(driver, "#c04-sweep-result", 25 * 60_000);
  assert.equal(sweep.status, "pass", sweep.text);
  assert.equal(sweep.sha256, EXPECTED.c04Sweep, "C0.4/C0.5 rendered sweep digest changed.");
  assert.equal(sweep.expectedSha256, EXPECTED.c04Sweep, "Rendered-sweep browser baseline drifted from the immutable QA command.");
  assert.equal(sweep.legacyProjectionSha256, EXPECTED.c03Projection, "Full sweep regressed the isolated C0.3 projection.");

  console.log(`PASS route-lab frozen digests: projection ${projection.sha256}; sweep ${sweep.sha256}`);
} catch (error) {
  if (chromeLog) console.error(`Chrome log (tail):\n${chromeLog}`);
  throw error;
} finally {
  cdp?.socket.close();
  await terminateChild(chrome, childState).catch((error) => console.error(error));
  await staticServer.close().catch((error) => console.error(error));
  rmSync(qaRoot, { recursive: true, force: true });
}
