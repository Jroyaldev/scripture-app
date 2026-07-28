import assert from "node:assert/strict";
import test from "node:test";
import {
  execFileSyncInterruptible,
  readFileSyncInterruptible,
  wasInterrupted,
} from "../src/host/exec-sync.js";
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

const OPTIONS = { encoding: "utf-8" } as ExecFileSyncOptionsWithStringEncoding;

function interruption(): NodeJS.ErrnoException {
  const error = new Error("EINTR: interrupted system call, read") as NodeJS.ErrnoException;
  error.code = "EINTR";
  return error;
}

/**
 * The bug this guards: `execFileSync` is `spawnSync`, which reads the child's
 * stdout through a pipe and reports EINTR as a failure. In Electron's main
 * process — where every helper is a child and SIGCHLD is routine — that turned
 * a signal arriving mid-read into "The library engine could not start", because
 * the engine shells out to git while opening the revision store.
 */
test("an interrupted syscall is retried rather than reported as a failure", () => {
  let calls = 0;
  const output = execFileSyncInterruptible("git", ["status"], OPTIONS, () => {
    calls += 1;
    if (calls < 3) throw interruption();
    return "clean\n";
  });
  assert.equal(output, "clean\n");
  assert.equal(calls, 3, "it must ask again rather than give up on the first interruption");
});

/** Narrowness is the whole safety of the retry: only EINTR may be repeated. */
test("a real failure is rethrown untouched and never repeated", () => {
  for (const [label, build] of [
    ["timeout", () => Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })],
    ["missing binary", () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })],
    ["non-zero exit", () => Object.assign(new Error("Command failed"), { status: 1 })],
  ] as const) {
    let calls = 0;
    assert.throws(
      () => execFileSyncInterruptible("git", ["status"], OPTIONS, () => {
        calls += 1;
        throw build();
      }),
      `${label} must reach the caller`,
    );
    assert.equal(calls, 1, `${label} is an answer, not an interruption — it must run once`);
  }
});

/** A signal storm has to end as an error rather than spinning forever. */
test("unrelenting interruption gives up, and gives up with the interruption", () => {
  let calls = 0;
  assert.throws(
    () => execFileSyncInterruptible("git", ["status"], OPTIONS, () => {
      calls += 1;
      throw interruption();
    }),
    (error: unknown) => wasInterrupted(error),
  );
  assert.ok(calls > 1 && calls <= 8, `bounded retries, saw ${calls}`);
});

test("interruption is recognised from the code or from the message alone", () => {
  assert.ok(wasInterrupted(interruption()));
  assert.ok(wasInterrupted(new Error("EINTR: interrupted system call, read")));
  assert.ok(!wasInterrupted(new Error("ETIMEDOUT")));
  assert.ok(!wasInterrupted(null));
  assert.ok(!wasInterrupted("EINTR"));
});

/**
 * The second call site this bit. `fs.readFileSync` surfaces EINTR straight out
 * of node:fs — the engine's own failure came back as `at readFileSync
 * (node:fs:442:20)` while reading the library manifest — so file reads need the
 * same retry the exec wrapper has.
 */
test("an interrupted file read is retried, in both text and binary form", () => {
  let calls = 0;
  const text = readFileSyncInterruptible("manifest.json", "utf-8", ((): string => {
    calls += 1;
    if (calls < 3) throw interruption();
    return "{}";
  }) as never);
  assert.equal(text, "{}");
  assert.equal(calls, 3);

  let binaryCalls = 0;
  const bytes = readFileSyncInterruptible("snapshot.bin", undefined, ((): Buffer => {
    binaryCalls += 1;
    if (binaryCalls < 2) throw interruption();
    return Buffer.from([1, 2, 3]);
  }) as never);
  assert.equal(bytes.byteLength, 3, "binary reads need the retry as much as text ones");
});

/** A missing file is an answer the callers branch on, not an interruption. */
test("a file read that genuinely fails is rethrown once", () => {
  let calls = 0;
  assert.throws(() => readFileSyncInterruptible("gone.json", "utf-8", ((): string => {
    calls += 1;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }) as never));
  assert.equal(calls, 1, "callers routinely branch on absence — it must not be retried");
});
