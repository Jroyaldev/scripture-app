/**
 * Permanent real-Electron gate for the first-party connection mutation broker.
 * Uses an isolated Library/profile and verifies the preload API, idempotency,
 * causal serialization, projection visibility, and append-only event bytes.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import electronPath from "electron";

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out opening the broker QA CDP socket"));
    }, 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Broker QA CDP socket failed during connection"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      reject(new Error("Broker QA CDP socket closed during connection"));
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
  ws.onclose = () => rejectPending(new Error("Electron CDP socket closed during the broker gate"));
  ws.onerror = () => rejectPending(new Error("Electron CDP socket failed during the broker gate"));
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
      const page = pages.find((candidate) => candidate.title === "Scripture Library");
      if (page) return page;
    } catch {
      // Electron may still be opening its isolated debug socket.
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
  if (!address || typeof address === "string") throw new Error("Could not reserve a broker QA port");
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
  if (!childState.exited) throw new Error("Broker QA Electron process did not terminate");
}

function createDriver(cdp) {
  const evaluate = async (expression, timeout = 20_000) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeout);
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1_200));
    }
    return response.result?.result?.value;
  };
  const waitFor = async (expression, timeout = 15_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await sleep(80);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  return { evaluate, waitFor };
}

function readEvents(libraryPath) {
  const path = join(libraryPath, "annotations/connections.jsonl");
  if (!existsSync(path)) return { bytes: 0, events: [] };
  const content = readFileSync(path, "utf8");
  return {
    bytes: Buffer.byteLength(content),
    events: content.split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}

const qaRoot = mkdtempSync(join(tmpdir(), "scripture-connection-broker-qa-"));
const userData = join(qaRoot, "user-data");
const libraryPath = join(qaRoot, "ScriptureLibrary");
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
child.once("error", (error) => {
  childState.spawnError = String(error);
});
let childLog = "";
const retainLog = (chunk) => {
  childLog = (childLog + chunk.toString()).slice(-20_000);
};
child.stdout.on("data", retainLog);
child.stderr.on("data", retainLog);

let cdp = null;
try {
  const target = await waitForTarget(endpoint, childState);
  cdp = await connect(target.webSocketDebuggerUrl);
  const driver = createDriver(cdp);
  await driver.waitFor(`Boolean(document.querySelector(".welcome-screen"))`);
  await driver.evaluate(`document.querySelector('.welcome-location-choice [data-variant="primary"]')?.click()`);
  await driver.waitFor(`Boolean(document.querySelector(".sidebar") && window.api?.library)`);

  const refusedSetup = await driver.evaluate(`(async () => {
    const chapter = await window.api.scripture.getChapterText("bsb", "ACT", 19);
    if (!chapter) throw new Error("BSB Acts 19 is unavailable");
    const anchor = async (verse, quote) => {
      const verseText = chapter.verses.find((item) => item.verse === verse)?.text ?? "";
      const charStart = verseText.indexOf(quote);
      if (charStart < 0) throw new Error("fixture quote is absent: " + quote);
      const capture = await window.api.library.captureConnectionSelection("bsb", [{
        book: "ACT",
        chapter: 19,
        verse,
        char_start: charStart,
        char_end: charStart + quote.length,
        quote,
      }]);
      if (!capture.ok || capture.status !== "exact") {
        throw new Error("exact fixture capture refused: " + JSON.stringify(capture));
      }
      return capture.anchor;
    };
    const anchors = await Promise.all([
      anchor(8, "the kingdom of God"),
      anchor(9, "the Way"),
    ]);
    const refused = await Promise.all([
      window.api.library.createConnection(null, "bad kind", "bad kind observation", anchors, "qa-malformed-kind"),
      window.api.library.createConnection("series", "missing command", "missing command observation", anchors),
      window.api.library.updateConnection(null, "series", "bad id", "bad id observation", anchors, "qa-malformed-update", "01J00000000000000000000000"),
      window.api.library.deleteConnection(null, "qa-malformed-delete"),
      window.api.library.createConnection("series", "x".repeat(513), "oversized label observation", anchors, "qa-oversized-label"),
      window.api.library.createConnection("series", "too many", "oversized anchors observation", Array.from({ length: 65 }, () => anchors[0]), "qa-oversized-anchors"),
    ]);
    return { anchors, refused };
  })()`);
  const refused = refusedSetup.refused;
  assert.equal(refused.length, 6);
  assert.ok(refused.every((result) => result?.ok === false), JSON.stringify(refused));
  assert.equal(readEvents(libraryPath).bytes, 0, "malformed IPC payload changed Substrate");

  const createdFirst = await driver.evaluate(`(async () => {
    const anchors = ${JSON.stringify(refusedSetup.anchors)};
    const first = await window.api.library.createConnection(
      "series", "Broker create", "Broker create observation.", anchors, "qa-create-command"
    );
    return { first, anchors };
  })()`);
  assert.equal(createdFirst.first.ok, true, createdFirst.first.error);
  const restarted = await driver.evaluate(`(async () => {
    let result = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      result = await window.api.library.init(${JSON.stringify(libraryPath)});
      if (result.ok) return { ...result, qaAttempts: attempt };
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    }
    return { ...result, qaAttempts: 4 };
  })()`, 45_000);
  assert.equal(restarted.ok, true, restarted.error);
  const createdAfterRestart = await driver.evaluate(`(async () => {
    const anchors = ${JSON.stringify(createdFirst.anchors)};
    const retried = await window.api.library.createConnection(
      "series", "Broker create", "Broker create observation.", anchors, "qa-create-command"
    );
    const collision = await window.api.library.createConnection(
      "series", "Different content", "Broker create observation.", anchors, "qa-create-command"
    );
    return { retried, collision };
  })()`);
  const created = {
    first: createdFirst.first,
    anchors: createdFirst.anchors,
    retried: createdAfterRestart.retried,
    collision: createdAfterRestart.collision,
  };
  assert.equal(created.first.ok, true, created.first.error);
  assert.equal(created.retried.ok, true, created.retried.error);
  assert.equal(created.retried.connection.id, created.first.connection.id);
  assert.equal(created.collision.ok, false);
  assert.equal(created.collision.error, "Connection save could not be confirmed.");
  const afterCreate = readEvents(libraryPath);
  assert.equal(afterCreate.events.length, 1, "create Retry appended a duplicate event");

  const updated = await driver.evaluate(`(async () => {
    const id = ${JSON.stringify(created.first.connection.id)};
    const anchors = ${JSON.stringify(created.anchors)};
    const expectedBaseEventId = ${JSON.stringify(created.first.connection.activeEventId)};
    const first = await window.api.library.updateConnection(
      id, "series", "Broker update", "Broker update observation.", anchors, "qa-update-command", expectedBaseEventId
    );
    const retried = await window.api.library.updateConnection(
      id, "series", "Broker update", "Broker update observation.", anchors, "qa-update-command", expectedBaseEventId
    );
    return { first, retried };
  })()`);
  assert.equal(updated.first.ok, true, updated.first.error);
  assert.equal(updated.retried.ok, true, updated.retried.error);
  assert.equal(updated.retried.connection.label, "Broker update");
  const afterUpdate = readEvents(libraryPath);
  assert.ok(afterUpdate.bytes > afterCreate.bytes, "update did not grow the authored log");
  assert.equal(afterUpdate.events.length, 2, "update Retry appended a duplicate event");
  assert.equal(afterUpdate.events[1].baseEventId, afterUpdate.events[0].eventId);
  const restartAfterUpdate = await driver.evaluate(`(async () => {
    let initialized = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      initialized = await window.api.library.init(${JSON.stringify(libraryPath)});
      if (initialized.ok) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    }
    const queried = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return { initialized, label: queried.connections[0]?.label ?? null };
  })()`, 45_000);
  assert.equal(restartAfterUpdate.initialized.ok, true, restartAfterUpdate.initialized.error);
  assert.equal(restartAfterUpdate.label, "Broker update", "runtime restart did not preserve current Derived label");

  const concurrent = await driver.evaluate(`(async () => {
    const id = ${JSON.stringify(created.first.connection.id)};
    const anchors = ${JSON.stringify(created.anchors)};
    const expectedBaseEventId = ${JSON.stringify(updated.first.connection.activeEventId)};
    return Promise.all([
      window.api.library.updateConnection(id, "series", "Concurrent A", "Concurrent A observation.", anchors, "qa-concurrent-a", expectedBaseEventId),
      window.api.library.updateConnection(id, "series", "Concurrent B", "Concurrent B observation.", anchors, "qa-concurrent-b", expectedBaseEventId),
    ]);
  })()`);
  const concurrentWinner = concurrent.find((result) => result.ok);
  const concurrentLoser = concurrent.find((result) => !result.ok);
  assert.ok(concurrentWinner?.connection, JSON.stringify(concurrent));
  assert.equal(concurrentLoser?.conflict, true, JSON.stringify(concurrent));
  const afterConcurrent = readEvents(libraryPath);
  assert.ok(afterConcurrent.bytes > afterUpdate.bytes, "winning concurrent update did not grow the authored log");
  assert.equal(afterConcurrent.events.length, 3, "stale sibling appended an authored event");
  assert.equal(afterConcurrent.events[2].baseEventId, afterConcurrent.events[1].eventId);

  const deleted = await driver.evaluate(`(async () => {
    const id = ${JSON.stringify(created.first.connection.id)};
    const expectedBaseEventId = ${JSON.stringify(concurrentWinner.connection.activeEventId)};
    const first = await window.api.library.deleteConnection(id, "qa-delete-command", expectedBaseEventId);
    const retried = await window.api.library.deleteConnection(id, "qa-delete-command", expectedBaseEventId);
    const queried = await window.api.library.queryRange("ACT", 19, 1, "ACT", 19, 28);
    return { first, retried, connectionCount: queried.connections.length };
  })()`);
  assert.equal(deleted.first.ok, true, deleted.first.error);
  assert.equal(deleted.retried.ok, true, deleted.retried.error);
  assert.equal(deleted.connectionCount, 0, "delete was not visible through Derived query");
  const afterDelete = readEvents(libraryPath);
  assert.ok(afterDelete.bytes > afterConcurrent.bytes, "delete did not grow the authored log");
  assert.equal(afterDelete.events.length, 4, "delete Retry appended a duplicate event");
  assert.equal(afterDelete.events[3].baseEventId, afterDelete.events[2].eventId);
  assert.ok(afterDelete.events.every((event) => event.actor?.kind === "user"));
  assert.deepEqual(afterDelete.events.slice(0, 2).map((event) => event.commandId), [
    "qa-create-command",
    "qa-update-command",
  ]);
  assert.ok(["qa-concurrent-a", "qa-concurrent-b"].includes(afterDelete.events[2].commandId));
  assert.equal(afterDelete.events[3].commandId, "qa-delete-command");
  assert.ok(afterDelete.events.every((event) => /^[a-f0-9]{64}$/.test(event.commandFingerprint)));
  assert.equal(new Set(afterDelete.events.map((event) => event.eventId)).size, 4);
  assert.ok(afterDelete.events.every((event) => event.entityType === "annotation"));
  assert.ok(afterDelete.events.slice(0, 3).every((event) => event.payload?.format_version === 2));
  assert.equal(afterDelete.events[0].payload?.observation, "Broker create observation.");
  assert.equal(afterDelete.events[1].payload?.observation, "Broker update observation.");
  assert.ok(afterDelete.events.slice(0, 3).every((event) =>
    event.payload?.anchors?.every((anchor) => anchor.exact?.layer === "backbone-token:v1")
  ));

  console.log(
    `PASS authored connection broker: 4-event causal chain, stale sibling refused, idempotent create/update/delete, ${afterDelete.bytes} append-only bytes`,
  );
} catch (error) {
  if (childLog) console.error(childLog);
  throw error;
} finally {
  if (cdp) cdp.ws.close();
  try {
    await terminateChild(child, childState);
  } finally {
    rmSync(qaRoot, { recursive: true, force: true });
  }
}
