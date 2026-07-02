import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkerEmbeddingProvider } from "../src/host/worker-embeddings.js";

// Stub worker implementing the embed protocol without loading a real model:
// vector = [textLength, kindFlag] (kindFlag 1 for "query", 0 for "document").
const STUB_WORKER = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", (msg) => {
  if (msg.texts[0] === "BOOM") {
    parentPort.postMessage({ id: msg.id, ok: false, error: "boom" });
    return;
  }
  if (msg.texts[0] === "DIE") {
    process.exit(7);
  }
  const vectors = msg.texts.map(
    (t) => new Float32Array([t.length, msg.kind === "query" ? 1 : 0]).buffer,
  );
  parentPort.postMessage({ id: msg.id, ok: true, vectors }, vectors);
});
`;

function makeProvider(dir: string): WorkerEmbeddingProvider {
  const workerPath = join(dir, "stub-worker.cjs");
  writeFileSync(workerPath, STUB_WORKER);
  return new WorkerEmbeddingProvider({ workerPath, modelId: "stub-model" });
}

test("embed round-trips texts and kind through the worker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-emb-"));
  const provider = makeProvider(dir);
  try {
    const docs = await provider.embed(["abc", "hello"], "document");
    assert.equal(docs.length, 2);
    assert.deepEqual([...docs[0]!], [3, 0]);
    assert.deepEqual([...docs[1]!], [5, 0]);

    const queries = await provider.embed(["hi"], "query");
    assert.deepEqual([...queries[0]!], [2, 1]);
  } finally {
    await provider.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent requests resolve to their own ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-emb-"));
  const provider = makeProvider(dir);
  try {
    const [a, b, c] = await Promise.all([
      provider.embed(["a"], "document"),
      provider.embed(["bb"], "query"),
      provider.embed(["ccc"], "document"),
    ]);
    assert.deepEqual([...a![0]!], [1, 0]);
    assert.deepEqual([...b![0]!], [2, 1]);
    assert.deepEqual([...c![0]!], [3, 0]);
  } finally {
    await provider.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker-reported errors reject only that request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-emb-"));
  const provider = makeProvider(dir);
  try {
    await assert.rejects(() => provider.embed(["BOOM"], "document"), /boom/);
    // Provider still usable afterwards.
    const ok = await provider.embed(["fine"], "document");
    assert.deepEqual([...ok[0]!], [4, 0]);
  } finally {
    await provider.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker death rejects pending requests and the next call respawns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-emb-"));
  const provider = makeProvider(dir);
  try {
    await assert.rejects(
      () => provider.embed(["DIE"], "document"),
      /exited with code 7/,
    );
    const revived = await provider.embed(["back"], "document");
    assert.deepEqual([...revived[0]!], [4, 0]);
  } finally {
    await provider.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty input short-circuits without spawning a worker", async () => {
  const provider = new WorkerEmbeddingProvider({
    workerPath: "/nonexistent/worker.cjs",
    modelId: "stub",
  });
  assert.deepEqual(await provider.embed([], "document"), []);
});
