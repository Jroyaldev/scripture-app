import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitRevisionStore } from "../src/host/git-revision-store.js";

test("GitRevisionStore schedules small commits without synchronously initializing git", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-revision-"));
  try {
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    writeFileSync(join(libraryPath, "annotations", "highlights.jsonl"), "");

    const store = new GitRevisionStore(libraryPath);
    const txn = await store.beginTransaction("Create highlight");
    txn.files.push("annotations/highlights.jsonl");
    await store.commit(txn);

    assert.equal(
      existsSync(join(libraryPath, ".git")),
      false,
      "small commits should not initialize git before the debounced flush runs",
    );
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});

test("GitRevisionStore owns an idempotent compare-and-append without eagerly invoking Git", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-revision-append-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    const fullPath = join(libraryPath, relativePath);
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    writeFileSync(fullPath, "");
    const store = new GitRevisionStore(libraryPath);
    const event = {
      eventId: "event-git-append",
      entityType: "annotation",
      commandId: "command-git-append",
      commandFingerprint: "a".repeat(64),
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    const append = {
      kind: "append-jsonl" as const,
      path: relativePath,
      content: `${JSON.stringify(event)}\n`,
      expectedByteLength: 0,
      commandId: event.commandId,
      commandFingerprint: event.commandFingerprint,
    };
    const txn = await store.beginTransaction("Create connection");

    const first = await store.commitAppend(txn, append);
    const retried = await store.commitAppend(txn, append);
    assert.equal(retried.id, first.id);
    assert.equal(readFileSync(fullPath, "utf8"), append.content);
    assert.equal(existsSync(join(libraryPath, ".git")), false);

    const staleTxn = await store.beginTransaction("Stale append");
    await assert.rejects(
      store.commitAppend(staleTxn, {
        ...append,
        content: `${JSON.stringify({
          ...event,
          eventId: "event-git-stale",
          commandId: "command-git-stale",
          commandFingerprint: "b".repeat(64),
        })}\n`,
        commandId: "command-git-stale",
        commandFingerprint: "b".repeat(64),
      }),
      /append conflict/,
    );
    assert.equal(readFileSync(fullPath, "utf8"), append.content);
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});

test("RevisionStore refuses an append while another live process owns the library lease", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-revision-lease-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    const leaseDir = join(libraryPath, ".history/revision-append-leases");
    mkdirSync(leaseDir, { recursive: true });
    writeFileSync(join(libraryPath, relativePath), "");
    writeFileSync(
      join(leaseDir, `p${process.ppid}-00000000-0000-4000-8000-000000000001.lease`),
      JSON.stringify({ pid: process.ppid, token: "other-live-process" }),
    );
    const event = {
      eventId: "event-live-lease",
      entityType: "annotation",
      commandId: "command-live-lease",
      commandFingerprint: "f".repeat(64),
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    const store = new GitRevisionStore(libraryPath);
    await assert.rejects(
      store.commitAppend(await store.beginTransaction("Blocked append"), {
        kind: "append-jsonl",
        path: relativePath,
        content: `${JSON.stringify(event)}\n`,
        expectedByteLength: 0,
        commandId: event.commandId,
        commandFingerprint: event.commandFingerprint,
      }),
      /Another Scripture Library process/,
    );
    assert.equal(readFileSync(join(libraryPath, relativePath), "utf8"), "");
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});
