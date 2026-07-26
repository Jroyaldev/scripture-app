import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { threadId } from "node:worker_threads";
import type { RevisionAppend } from "../src/core/interfaces.js";
import {
  RevisionAppendCoordinator,
  appendRevisionJsonl,
} from "../src/host/revision-append.js";

function fixture(commandId: string, fingerprintChar: string, eventId = `event-${commandId}`): RevisionAppend {
  const event = {
    eventId,
    entityType: "annotation",
    entityId: `connection-${commandId}`,
    op: "create",
    commandId,
    commandFingerprint: fingerprintChar.repeat(64),
    createdAt: "2026-07-20T00:00:00.000Z",
  };
  return {
    kind: "append-jsonl",
    path: "annotations/connections.jsonl",
    content: `${JSON.stringify(event)}\n`,
    expectedByteLength: 0,
    commandId,
    commandFingerprint: event.commandFingerprint,
  };
}

async function withRoot(run: (root: string) => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "scripture-append-recovery-"));
  try {
    mkdirSync(join(root, "annotations"), { recursive: true });
    writeFileSync(join(root, "annotations/connections.jsonl"), "");
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function logPath(root: string): string {
  return join(root, "annotations/connections.jsonl");
}

function journalPath(root: string): string {
  return join(root, ".history/revision-append-leases");
}

function journalEntries(root: string, prefix: string): string[] {
  const path = journalPath(root);
  return existsSync(path) ? readdirSync(path).filter((entry) => entry.startsWith(prefix)) : [];
}

function ticketDirectories(root: string): string[] {
  return journalEntries(root, "ticket-").sort();
}

function ticketMarkerCount(root: string, prefix: string): number {
  return ticketDirectories(root).reduce((count, ticket) => {
    const entries = readdirSync(join(journalPath(root), ticket));
    return count + entries.filter((entry) => entry.startsWith(prefix)).length;
  }, 0);
}

type RaceWorkerReply = {
  id: number;
  phase: "ready" | "done";
  ok?: boolean;
  name?: string;
  message?: string;
};

function waitForWorkerReply(worker: ChildProcess, id: number, phase: RaceWorkerReply["phase"]): Promise<RaceWorkerReply> {
  return new Promise((resolveReply, rejectReply) => {
    const onMessage = (reply: RaceWorkerReply): void => {
      if (reply.id !== id || reply.phase !== phase) return;
      cleanup();
      resolveReply(reply);
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectReply(error);
    };
    const cleanup = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
  });
}

async function raceWorkerRound(
  workers: readonly [ChildProcess, ChildProcess],
  id: number,
  root: string,
  appends: readonly [RevisionAppend, RevisionAppend],
): Promise<[RaceWorkerReply, RaceWorkerReply]> {
  const barrier = join(root, `.race-barrier-${id}`);
  const ready = workers.map((worker) => waitForWorkerReply(worker, id, "ready"));
  const done = workers.map((worker) => waitForWorkerReply(worker, id, "done"));
  workers.forEach((worker, index) => worker.send({ id, root, append: appends[index], barrier }));
  await Promise.all(ready);
  writeFileSync(barrier, "go");
  return await Promise.all(done) as [RaceWorkerReply, RaceWorkerReply];
}

test("short writes and pre-fsync failures recover one complete durable line", async () => {
  await withRoot((root) => {
    const shortAppend = fixture("short-write-command", "a");
    let injectedShortFailure = false;
    const shortCoordinator = new RevisionAppendCoordinator({
      maxWriteChunkBytes: 17,
      afterWriteChunk: () => {
        if (injectedShortFailure) return;
        injectedShortFailure = true;
        throw new Error("injected short write interruption");
      },
    });
    const shortResult = shortCoordinator.append(root, shortAppend);
    assert.equal(shortResult.alreadyApplied, false);
    assert.equal(readFileSync(join(root, shortAppend.path), "utf8"), shortAppend.content);

    const fsyncAppend = fixture("pre-fsync-command", "b");
    fsyncAppend.expectedByteLength = statSync(join(root, fsyncAppend.path)).size;
    let injectedFsyncFailure = false;
    const fsyncCoordinator = new RevisionAppendCoordinator({
      beforeInitialFsync: () => {
        if (injectedFsyncFailure) return;
        injectedFsyncFailure = true;
        throw new Error("injected fsync interruption");
      },
    });
    fsyncCoordinator.append(root, fsyncAppend);
    assert.equal(
      readFileSync(join(root, fsyncAppend.path), "utf8"),
      shortAppend.content + fsyncAppend.content,
    );
  });
});

test("corrupt tails, duplicate command events, and oversized lines refuse append", async () => {
  await withRoot((root) => {
    const path = join(root, "annotations/connections.jsonl");
    writeFileSync(path, "{partial");
    assert.throws(() => appendRevisionJsonl(root, fixture("partial-tail-command", "c")), /incomplete event/);

    writeFileSync(path, "{invalid}\n");
    assert.throws(() => appendRevisionJsonl(root, fixture("invalid-line-command", "d")), /invalid event/);

    const first = fixture("duplicate-command-id", "e", "event-duplicate-a");
    const second = fixture("duplicate-command-id", "e", "event-duplicate-b");
    writeFileSync(path, first.content + second.content);
    const next = fixture("next-after-duplicate", "f");
    next.expectedByteLength = statSync(path).size;
    assert.throws(() => appendRevisionJsonl(root, next), /more than one event/);

    const oversized = fixture("oversized-append-command", "0");
    const parsed = JSON.parse(oversized.content) as Record<string, unknown>;
    parsed["payload"] = "x".repeat(512 * 1_024);
    oversized.content = `${JSON.stringify(parsed)}\n`;
    writeFileSync(path, "");
    assert.throws(() => appendRevisionJsonl(root, oversized), /exceeds 524288 bytes/);
  });
});

test("a live candidate wins while a reentrant contender retires without mutual abort", async () => {
  await withRoot((root) => {
    const first = fixture("live-candidate-winner", "1");
    const second = fixture("live-candidate-loser", "2");
    let contenderError: unknown;
    const coordinator = new RevisionAppendCoordinator({
      afterCandidateDurable: () => {
        try {
          appendRevisionJsonl(root, second);
        } catch (error) {
          contenderError = error;
        }
      },
    });
    coordinator.append(root, first);
    assert.match(contenderError instanceof Error ? contenderError.message : "", /Another Scripture Library process/);
    assert.equal(readFileSync(logPath(root), "utf8"), first.content);
  });
});

test("dead candidates never auto-apply and failed terminal cleanup never self-locks", async () => {
  await withRoot((root) => {
    const abandoned = fixture("abandoned-candidate-command", "3");
    assert.throws(
      () => new RevisionAppendCoordinator({
        afterCandidateDurable: () => { throw new Error("candidate owner died"); },
      }).append(root, abandoned),
      /candidate owner died/,
    );
    assert.equal(readFileSync(logPath(root), "utf8"), "");
    assert.equal(ticketDirectories(root).length, 1);

    const landed = fixture("candidate-after-abandon", "4");
    new RevisionAppendCoordinator({
      beforeTerminalCleanup: () => { throw new Error("injected cleanup failure"); },
    }).append(root, landed);
    assert.equal(readFileSync(logPath(root), "utf8"), landed.content);
    assert.equal(ticketMarkerCount(root, "committed-"), 1);

    const retried = appendRevisionJsonl(root, landed);
    assert.equal(retried.alreadyApplied, true);
    assert.equal(readFileSync(logPath(root), "utf8"), landed.content);
  });
});

test("a visible terminal marker cannot be reclaimed before its publisher fsyncs the ticket", async () => {
  await withRoot((root) => {
    const first = fixture("terminal-publisher-command", "4");
    const second = fixture("terminal-reentrant-command", "5");
    second.expectedByteLength = Buffer.byteLength(first.content, "utf8");
    let enteredCut = false;
    new RevisionAppendCoordinator({
      afterTerminalMarkerRenameBeforeFsync: () => {
        if (enteredCut) return;
        enteredCut = true;
        appendRevisionJsonl(root, second);
      },
    }).append(root, first);
    assert.equal(readFileSync(logPath(root), "utf8"), first.content + second.content);

    const third = fixture("terminal-post-cut-command", "6");
    third.expectedByteLength = Buffer.byteLength(first.content + second.content, "utf8");
    appendRevisionJsonl(root, third);
    assert.equal(readFileSync(logPath(root), "utf8"), first.content + second.content + third.content);
    assert.equal(ticketDirectories(root).length, 1);
  });
});

test("a delayed allocator cannot reuse a compacted ticket below newer writers", async () => {
  await withRoot((root) => {
    const delayed = fixture("delayed-ticket-command", "7");
    const first = fixture("ticket-cut-first-command", "8");
    const second = fixture("ticket-cut-second-command", "9");
    second.expectedByteLength = Buffer.byteLength(first.content, "utf8");
    let enteredCut = false;
    assert.throws(
      () => new RevisionAppendCoordinator({
        afterTicketNumberChosenBeforeRename: (ticket) => {
          if (enteredCut) return;
          enteredCut = true;
          assert.equal(ticket, 0);
          appendRevisionJsonl(root, first);
          appendRevisionJsonl(root, second);
        },
      }).append(root, delayed),
      /append conflict/,
    );
    assert.equal(readFileSync(logPath(root), "utf8"), first.content + second.content);
    assert.equal(ticketDirectories(root).length, 1);
    assert.match(ticketDirectories(root)[0]!, /^ticket-0000000000000002-/);
  });
});

test("PID reuse identity retires a live-PID candidate from an older process generation", async () => {
  await withRoot((root) => {
    const abandoned = fixture("pid-generation-abandoned", "5");
    assert.throws(
      () => new RevisionAppendCoordinator({
        processStartIdentity: () => "old-process-generation",
        afterCandidateDurable: () => { throw new Error("old process died"); },
      }).append(root, abandoned),
      /old process died/,
    );
    const candidateDir = join(journalPath(root), ticketDirectories(root)[0]!);
    const candidateFile = join(candidateDir, "candidate.json");
    const candidate = JSON.parse(readFileSync(candidateFile, "utf8")) as {
      owner: { pid: number; threadId: number; processStartIdentity: string };
    };
    candidate.owner.pid = process.pid;
    candidate.owner.threadId = threadId + 1;
    candidate.owner.processStartIdentity = "old-process-generation";
    writeFileSync(candidateFile, JSON.stringify(candidate));

    const next = fixture("pid-generation-next", "6");
    new RevisionAppendCoordinator({
      processStartIdentity: () => "new-process-generation",
    }).append(root, next);
    assert.equal(readFileSync(logPath(root), "utf8"), next.content);
  });
});

test("dead prepared intents recover zero, partial, and full exact targets once", async () => {
  for (const state of ["zero", "partial", "full"] as const) {
    await withRoot((root) => {
      const append = fixture(`prepared-${state}-command`, state === "zero" ? "7" : state === "partial" ? "8" : "9");
      const order: string[] = [];
      const hooks = state === "zero"
        ? { afterIntentPrepared: () => { throw new Error("died at zero bytes"); } }
        : state === "partial"
          ? {
              maxWriteChunkBytes: 23,
              afterTargetWriteChunkWithoutRecovery: () => { throw new Error("died with partial target"); },
            }
          : {
              afterTargetParentFsync: () => { order.push("parent-fsync"); },
              beforeCommittedMarker: () => {
                assert.deepEqual(order, ["parent-fsync"]);
                order.push("committed-transition");
                throw new Error("died with full target");
              },
            };
      assert.throws(
        () => new RevisionAppendCoordinator(hooks).append(root, append),
        state === "zero" ? /zero bytes/ : state === "partial" ? /partial target/ : /full target/,
      );
      assert.equal(ticketMarkerCount(root, "prepared-"), 1);
      if (state === "zero") assert.equal(readFileSync(logPath(root), "utf8"), "");
      if (state === "partial") {
        const partial = readFileSync(logPath(root), "utf8");
        assert.ok(partial.length > 0 && partial.length < append.content.length);
        assert.equal(append.content.startsWith(partial), true);
      }
      if (state === "full") assert.equal(readFileSync(logPath(root), "utf8"), append.content);

      const retried = appendRevisionJsonl(root, append);
      assert.equal(retried.alreadyApplied, true);
      assert.equal(readFileSync(logPath(root), "utf8"), append.content);
      assert.equal(readFileSync(logPath(root), "utf8").split("\n").filter(Boolean).length, 1);
      assert.equal(ticketMarkerCount(root, "prepared-"), 0);
    });
  }
});

test("dead prepared intents refuse shorter or divergent targets byte-identically", async () => {
  for (const corruption of ["shorter", "divergent"] as const) {
    await withRoot((root) => {
      const base = fixture(`base-for-${corruption}`, corruption === "shorter" ? "a" : "b");
      appendRevisionJsonl(root, base);
      const pending = fixture(`pending-${corruption}-command`, corruption === "shorter" ? "c" : "d");
      pending.expectedByteLength = statSync(logPath(root)).size;
      assert.throws(
        () => new RevisionAppendCoordinator({
          afterIntentPrepared: () => { throw new Error("leave prepared intent"); },
        }).append(root, pending),
        /leave prepared intent/,
      );

      const originalBase = Buffer.from(base.content, "utf8");
      const corrupted = corruption === "shorter"
        ? originalBase.subarray(0, originalBase.length - 1)
        : Buffer.concat([Buffer.from(base.content, "utf8"), Buffer.from("unexpected", "utf8")]);
      writeFileSync(logPath(root), corrupted);
      const before = readFileSync(logPath(root));
      assert.throws(
        () => appendRevisionJsonl(root, pending),
        /does not match target.*refusing to alter existing bytes/,
      );
      assert.deepEqual(readFileSync(logPath(root)), before);
      assert.equal(ticketMarkerCount(root, "prepared-"), 1);
    });
  }
});

test("immutable ticket election produces exactly one first winner across 100 concurrent races", async () => {
  await withRoot(async (root) => {
    const workerSource = `
      const { existsSync } = require("node:fs");
      const { setTimeout: delay } = require("node:timers/promises");
      const modulePromise = import(process.env.REVISION_APPEND_MODULE_URL);
      process.on("message", async ({ id, root, append, barrier }) => {
        process.send({ id, phase: "ready" });
        while (!existsSync(barrier)) await delay(1);
        try {
          const { appendRevisionJsonl } = await modulePromise;
          appendRevisionJsonl(root, append);
          process.send({ id, phase: "done", ok: true });
        } catch (error) {
          process.send({
            id,
            phase: "done",
            ok: false,
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    `;
    const moduleUrl = new URL("../src/host/revision-append.ts", import.meta.url).href;
    const workers = [0, 1].map(() => spawn(
      process.execPath,
      ["--import", "tsx", "-e", workerSource],
      {
        env: { ...process.env, REVISION_APPEND_MODULE_URL: moduleUrl },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    )) as [ChildProcess, ChildProcess];
    try {
      for (let round = 0; round < 100; round += 1) {
        const roundRoot = join(root, `race-${String(round).padStart(3, "0")}`);
        mkdirSync(join(roundRoot, "annotations"), { recursive: true });
        writeFileSync(logPath(roundRoot), "");
        const appends = [
          fixture(`stress-${round}-candidate-a`, "e"),
          fixture(`stress-${round}-candidate-b`, "f"),
        ] as const;
        const results = await raceWorkerRound(workers, round, roundRoot, appends);
        // This test has been seen to fail in a full suite run three times and has
        // never reproduced in isolation. Two of the three failures were
        // sub-second, and this assertion sits INSIDE the hundred-round loop, so a
        // sub-second failure means it broke in the first rounds rather than
        // timing out — it was FASTER than any passing run (0.77s and 0.87s
        // against 6-27s). That is a real possibility about election logic in a
        // revision store, not a slow machine.
        //
        // On "load": four copies run concurrently on purpose made it 4x slower
        // and never made it fail — but that was four copies of ONE test file.
        // The observed failures happened while Electron builds, two tsc projects
        // and Vite were running. So homogeneous self-contention is ruled out and
        // HETEROGENEOUS BUILD LOAD IS UNTESTED. Withdrawing an unsupported cause
        // and establishing its absence are different claims, and only the first
        // has been done here.
        //
        // A free diagnostic that was destroyed twice before anyone noticed it:
        // these workers are spawned with stderr INHERITED, so the leading
        // environmental hypothesis — module import failing under load — predicts
        // a visible child stderr trace in the surrounding output. Both
        // investigations grepped for the test name and the duration, and threw
        // that away. Next occurrence, read the output around the failure before
        // anything else.
        //
        // The payload discriminates THREE outcomes below. Worker death is not
        // among them, but only for a SILENT exit: `raceWorkerRound` awaits
        // `Promise.all(done)` with no timeout, so a worker that dies quietly
        // makes this HANG rather than fail fast. `waitForWorkerReply` does also
        // register an `error` handler that rejects — a fast-failure path that
        // bypasses every assertion here. So a failure arriving with NONE of the
        // diagnostics below is not a broken diagnostic; it is the fourth signal,
        // and it means the child errored rather than answered.
        //
        //   two ok:true   — a real election defect; both writers believed they won
        //   two ok:false  — both threw. Module-import-under-load is the leading
        //                   environmental candidate, and it would fail at round 0,
        //                   which matches the sub-second timing exactly. So the
        //                   ROUND INDEX discriminates the two leading hypotheses
        //                   without anyone having to read a payload.
        //   one ok:true,
        //   wrong message — a third, separate bug that looks identical outside.
        const won = results.filter((result) => result.ok).length;
        const shape = won > 1
          ? `ELECTION DEFECT: ${won} winners — both writers believed they appended`
          : won === 0
            ? "BOTH THREW: not worker death, which would hang here. Round 0 points at module import under load; a later round does not."
            : "one winner";
        const detail = `round ${round} of 100 · ${shape} · ${JSON.stringify(results)}`;
        assert.equal(won, 1, detail);
        assert.equal(results.filter((result) => !result.ok).length, 1, detail);
        assert.match(
          results.find((result) => !result.ok)?.message ?? "",
          /append conflict|Another Scripture Library process/,
          `${detail} · THIRD SHAPE: one winner, but the loser threw something other than an append conflict — a separate defect that looks identical from outside`,
        );
        const lines = readFileSync(logPath(roundRoot), "utf8").split("\n").filter(Boolean);
        assert.equal(lines.length, 1);
        assert.doesNotThrow(() => JSON.parse(lines[0]!));
      }
    } finally {
      await Promise.all(workers.map(async (worker) => {
        if (worker.exitCode !== null) return;
        const exited = once(worker, "exit");
        worker.kill("SIGTERM");
        await exited;
      }));
    }
  });
});

test("terminal ticket compaction reaches a bounded storage plateau without ticket reuse", async () => {
  await withRoot((root) => {
    let expectedByteLength = 0;
    for (let index = 0; index < 64; index += 1) {
      const append = fixture(`plateau-command-${index}`, index % 2 === 0 ? "0" : "1");
      append.expectedByteLength = expectedByteLength;
      appendRevisionJsonl(root, append);
      expectedByteLength += Buffer.byteLength(append.content, "utf8");
      assert.ok(ticketDirectories(root).length <= 1);
    }
    const tickets = ticketDirectories(root);
    assert.equal(tickets.length, 1);
    assert.match(tickets[0]!, /^ticket-0000000000000063-/);
    assert.equal(ticketMarkerCount(root, "committed-"), 1);
    assert.equal(readFileSync(logPath(root), "utf8").split("\n").filter(Boolean).length, 64);
  });
});

test("two independent processes permit one stale-CAS winner and an explicit replan", async () => {
  await withRoot(async (root) => {
    const startPath = join(root, "start-workers");
    const workerPath = resolve(import.meta.dirname, "fixtures/revision-append-worker.ts");
    const appends = [fixture("process-race-command-a", "4"), fixture("process-race-command-b", "5")];
    const children = appends.map((append) => spawn(
      process.execPath,
      ["--import", "tsx", workerPath, root, startPath, Buffer.from(JSON.stringify(append)).toString("base64url")],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    ));
    const outputs = children.map((child) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      return once(child, "close").then(([code]) => {
        assert.equal(code, 0, stderr);
        return JSON.parse(stdout) as { ok: boolean; name?: string; message?: string };
      });
    });
    await Promise.all(children.map((child) => once(child, "spawn")));
    writeFileSync(startPath, "go");
    const results = await Promise.all(outputs);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.match(results.find((result) => !result.ok)?.message ?? "", /append conflict|Another Scripture Library process/);

    const logPath = join(root, "annotations/connections.jsonl");
    const landedIds = new Set(readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => (
      (JSON.parse(line) as { commandId: string }).commandId
    )));
    const losing = appends.find((append) => !landedIds.has(append.commandId))!;
    losing.expectedByteLength = statSync(logPath).size;
    appendRevisionJsonl(root, losing);
    const finalLines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    assert.equal(finalLines.length, 2);
    assert.equal(finalLines.every((line) => JSON.parse(line)), true);
  });
});
