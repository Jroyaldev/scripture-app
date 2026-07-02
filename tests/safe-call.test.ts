import assert from "node:assert/strict";
import { test } from "node:test";
import { safeCall } from "../src/renderer/utils/safeCall.js";

test("resolves to {ok:true, value} on success", async () => {
  const result = await safeCall(async () => 42);
  assert.deepEqual(result, { ok: true, value: 42 });
});

test("catches a thrown Error and returns its message", async () => {
  const result = await safeCall(async () => {
    throw new Error("nope");
  });
  assert.deepEqual(result, { ok: false, error: "nope" });
});

test("catches a thrown plain string", async () => {
  const result = await safeCall(async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw "plain string";
  });
  assert.deepEqual(result, { ok: false, error: "plain string" });
});

test("catches a thrown plain object and stringifies it", async () => {
  const result = await safeCall(async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw { weird: "object" };
  });
  assert.deepEqual(result, { ok: false, error: "[object Object]" });
});

test("catches a rejected promise (no throw, just rejection)", async () => {
  const result = await safeCall(() => Promise.reject(new Error("rej")));
  assert.deepEqual(result, { ok: false, error: "rej" });
});

test("safeCall never rejects, even for all the failure modes above", async () => {
  const calls: Array<() => Promise<unknown>> = [
    async () => {
      throw new Error("nope");
    },
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain string";
    },
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { weird: "object" };
    },
    () => Promise.reject(new Error("rej")),
  ];

  for (const call of calls) {
    await assert.doesNotReject(() => safeCall(call));
  }
});
