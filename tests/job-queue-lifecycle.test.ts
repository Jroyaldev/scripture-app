import assert from "node:assert/strict";
import { test } from "node:test";
import type { BudgetManager } from "../src/host/budget-manager.js";
import type { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { JobQueue } from "../src/host/job-queue.js";

type JobRecord = {
  id: string;
  kind: string;
  status: string;
  created: string;
  finished: string | null;
  tokensUsed: number;
  error: string | null;
};

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("shutdown drains the running job before its embeddings store may close", async () => {
  const records: JobRecord[] = [];
  let storeClosed = false;
  const store = {
    insertJob(record: JobRecord): void {
      assert.equal(storeClosed, false, "queue wrote after its old store was closed");
      records.push(record);
    },
  } as unknown as EmbeddingsStore;
  const spends: number[] = [];
  const budget = {
    recordSpend(tokens: number): void {
      spends.push(tokens);
    },
  } as unknown as BudgetManager;
  const queue = new JobQueue(budget, store);
  const running = deferred();
  const started = deferred();

  queue.enqueue("embed-notes", async () => {
    started.resolve();
    await running.promise;
    return { tokensUsed: 7, error: null };
  });
  await started.promise;
  const canceledId = queue.enqueue("extract-claims", async () => ({
    tokensUsed: 11,
    error: null,
  }));

  let shutdownSettled = false;
  const shutdown = queue.shutdown().then(() => {
    shutdownSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownSettled, false, "shutdown must wait for the active job");
  assert.throws(
    () => queue.enqueue("suggest-xrefs", async () => ({ tokensUsed: 0, error: null })),
    /shutting down/,
  );

  running.resolve();
  await shutdown;
  storeClosed = true;
  await queue.shutdown();

  assert.deepEqual(spends, [7]);
  assert.ok(records.some((record) => record.id === canceledId
    && record.status === "failed"
    && record.error?.includes("shutting down")));
  assert.equal(records.at(-1)?.status, "done");
});

test("a reversible pause preserves queued work and resumes the same queue", async () => {
  const records: JobRecord[] = [];
  const store = {
    insertJob(record: JobRecord): void {
      records.push(record);
    },
  } as unknown as EmbeddingsStore;
  const spends: number[] = [];
  const budget = {
    recordSpend(tokens: number): void {
      spends.push(tokens);
    },
  } as unknown as BudgetManager;
  const queue = new JobQueue(budget, store);
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const secondStarted = deferred();

  queue.enqueue("embed-notes", async () => {
    firstStarted.resolve();
    await releaseFirst.promise;
    return { tokensUsed: 3, error: null };
  });
  await firstStarted.promise;
  const secondId = queue.enqueue("extract-claims", async () => {
    secondStarted.resolve();
    return { tokensUsed: 5, error: null };
  });

  let paused = false;
  const pause = queue.pauseAndWait().then(() => {
    paused = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(paused, false, "pause waits for the current writer");
  releaseFirst.resolve();
  await pause;
  assert.deepEqual(spends, [3]);
  assert.throws(
    () => queue.enqueue("suggest-xrefs", async () => ({ tokensUsed: 0, error: null })),
    /paused/,
  );
  assert.equal(records.some((record) => record.id === secondId && record.status === "failed"), false);

  queue.resume();
  await secondStarted.promise;
  await queue.pauseAndWait();
  assert.deepEqual(spends, [3, 5]);
  assert.equal(records.some((record) => record.id === secondId && record.status === "done"), true);
  await queue.shutdown();
});
