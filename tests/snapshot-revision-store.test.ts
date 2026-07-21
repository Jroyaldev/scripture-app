import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SnapshotRevisionStore } from "../src/host/snapshot-revision-store.js";
import { revisionReceiptId } from "../src/host/revision-append.js";

test("snapshot revision store restores note bodies without git", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-revision-"));
  try {
    const noteId = "01JNOTE0000000000000000001";
    const notePath = "notes/acts-19.md";
    const fullNotePath = join(libraryPath, notePath);
    const original = noteContent(noteId, "Original reading");
    const revised = noteContent(noteId, "Revised reading");

    mkdirSync(join(libraryPath, "notes"), { recursive: true });
    writeFileSync(fullNotePath, original);

    const store = new SnapshotRevisionStore(libraryPath);
    const initialTxn = await store.beginTransaction("Initial note");
    initialTxn.files.push(notePath);
    const initialReceipt = await store.commit(initialTxn);

    writeFileSync(fullNotePath, revised);
    const revisedTxn = await store.beginTransaction("Revise note");
    revisedTxn.files.push(notePath);
    await store.commit(revisedTxn);

    const beforeRestore = await store.history(noteId);
    assert.equal(beforeRestore.length, 2);
    assert.deepEqual(beforeRestore.map((receipt) => receipt.label), ["Initial note", "Revise note"]);

    await store.restore(initialReceipt.id);

    const restored = readFileSync(fullNotePath, "utf-8");
    assert.equal(restored, original);
    assert.equal(existsSync(join(libraryPath, ".git")), false);

    const afterRestore = await store.history(noteId);
    assert.equal(afterRestore.length, 3);
    assert.equal(afterRestore[2]?.label, "Restore: Initial note");
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

test("snapshot revision store compare-appends one JSONL event and one receipt", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-append-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    const fullPath = join(libraryPath, relativePath);
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    writeFileSync(fullPath, "");
    const store = new SnapshotRevisionStore(libraryPath);
    const event = {
      eventId: "event-snapshot-append",
      entityType: "annotation",
      entityId: "connection-snapshot-append",
      commandId: "command-snapshot-append",
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
    assert.deepEqual((await store.history()).map((receipt) => receipt.id), [first.id]);

    const staleTxn = await store.beginTransaction("Stale append");
    await assert.rejects(
      store.commitAppend(staleTxn, {
        ...append,
        content: `${JSON.stringify({
          ...event,
          eventId: "event-snapshot-stale",
          commandId: "command-snapshot-stale",
          commandFingerprint: "b".repeat(64),
        })}\n`,
        commandId: "command-snapshot-stale",
        commandFingerprint: "b".repeat(64),
      }),
      /append conflict/,
    );
    assert.equal(readFileSync(fullPath, "utf8"), append.content);
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

test("snapshot append survives a corrupt auxiliary receipt log and rebuilds history from the event", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-corrupt-receipt-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    mkdirSync(join(libraryPath, ".history"), { recursive: true });
    writeFileSync(join(libraryPath, relativePath), "");
    writeFileSync(join(libraryPath, ".history/revisions.jsonl"), "{corrupt receipt");
    const event = {
      eventId: "event-corrupt-receipt",
      entityType: "annotation",
      entityId: "connection-corrupt-receipt",
      op: "create",
      commandId: "command-corrupt-receipt",
      commandFingerprint: "c".repeat(64),
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
    const store = new SnapshotRevisionStore(libraryPath);
    const receipt = await store.commitAppend(
      await store.beginTransaction("Create after corrupt receipt"),
      append,
    );

    assert.equal(readFileSync(join(libraryPath, relativePath), "utf8"), append.content);
    const restartedHistory = await new SnapshotRevisionStore(libraryPath).history(event.entityId);
    assert.deepEqual(restartedHistory.map((entry) => entry.id), [receipt.id]);
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

test("authoritative event history overrides forged receipts and ignores malformed file rows", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-forged-receipt-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    const entityId = "connection-authoritative-history";
    const event = {
      eventId: "event-authoritative-history",
      entityType: "annotation",
      entityId,
      op: "create",
      commandId: "command-authoritative-history",
      commandFingerprint: "9".repeat(64),
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    mkdirSync(join(libraryPath, ".history"), { recursive: true });
    writeFileSync(join(libraryPath, relativePath), `${JSON.stringify(event)}\n`);
    writeFileSync(join(libraryPath, ".history/revisions.jsonl"), [
      JSON.stringify({ id: "malformed-files", label: "bad", timestamp: "", files: [null] }),
      JSON.stringify({
        id: "forged-alternate-receipt-id",
        label: "forged alternate shadow",
        timestamp: "",
        files: [{ path: "annotations/other.jsonl", kind: "event-log", entityId: "forged-alternate-entity" }],
        commandId: event.commandId,
        commandFingerprint: event.commandFingerprint,
        eventId: event.eventId,
      }),
      JSON.stringify({
        id: revisionReceiptId("invalid command id"),
        label: "invalid command",
        timestamp: "",
        files: [{ path: "annotations/other.jsonl", kind: "event-log", entityId: "invalid-command-entity" }],
        commandId: "invalid command id",
        commandFingerprint: event.commandFingerprint,
        eventId: event.eventId,
      }),
      JSON.stringify({
        id: revisionReceiptId("command-invalid-event"),
        label: "invalid event",
        timestamp: "",
        files: [{ path: "annotations/other.jsonl", kind: "event-log", entityId: "invalid-event-entity" }],
        commandId: "command-invalid-event",
        commandFingerprint: event.commandFingerprint,
        eventId: "",
      }),
      JSON.stringify({
        id: revisionReceiptId(event.commandId),
        label: "forged shadow",
        timestamp: "",
        files: [{ path: "annotations/other.jsonl", kind: "event-log", entityId: "forged-entity" }],
        commandId: event.commandId,
        commandFingerprint: event.commandFingerprint,
        eventId: event.eventId,
      }),
      "",
    ].join("\n"));

    const store = new SnapshotRevisionStore(libraryPath);
    const history = await store.history(entityId);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.id, revisionReceiptId(event.commandId));
    assert.equal(history[0]?.entityId, entityId);
    assert.equal(history[0]?.label, "Create connection");
    assert.equal((await store.history()).length, 1);
    assert.deepEqual(await store.history("forged-entity"), []);
    assert.deepEqual(await store.history("forged-alternate-entity"), []);
    assert.deepEqual(await store.history("invalid-command-entity"), []);
    assert.deepEqual(await store.history("invalid-event-entity"), []);
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

test("canonical auxiliary receipt cannot invent a connection absent from its event log", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-empty-event-log-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    const commandId = "command-canonical-forgery";
    const forgedEntityId = "connection-canonical-forgery";
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    mkdirSync(join(libraryPath, ".history"), { recursive: true });
    writeFileSync(join(libraryPath, relativePath), "");
    writeFileSync(join(libraryPath, ".history/revisions.jsonl"), [
      JSON.stringify({
        id: revisionReceiptId(commandId),
        label: "forged canonical receipt",
        timestamp: "2026-07-20T00:00:00.000Z",
        files: [{ path: relativePath, kind: "event-log", entityId: forgedEntityId }],
        commandId,
        commandFingerprint: "7".repeat(64),
        eventId: "event-canonical-forgery",
      }),
      JSON.stringify({
        id: "ghost-no-command",
        label: "forged legacy receipt",
        timestamp: "2026-07-20T00:00:00.000Z",
        files: [{ path: relativePath, kind: "event-log", entityId: "ghost-no-command-entity" }],
      }),
      "",
    ].join("\n"));

    const store = new SnapshotRevisionStore(libraryPath);
    assert.deepEqual(await store.history(), []);
    assert.deepEqual(await store.history(forgedEntityId), []);
    assert.deepEqual(await store.history("ghost-no-command-entity"), []);
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

test("snapshot store refuses one transaction reused for a different append before writing it", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-txn-reuse-"));
  try {
    const relativePath = "annotations/connections.jsonl";
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    writeFileSync(join(libraryPath, relativePath), "");
    const store = new SnapshotRevisionStore(libraryPath);
    const txn = await store.beginTransaction("One append only");
    const firstEvent = appendEvent("event-txn-first", "command-txn-first", "d");
    await store.commitAppend(txn, {
      kind: "append-jsonl",
      path: relativePath,
      content: `${JSON.stringify(firstEvent)}\n`,
      expectedByteLength: 0,
      commandId: firstEvent.commandId,
      commandFingerprint: firstEvent.commandFingerprint,
    });
    const before = readFileSync(join(libraryPath, relativePath), "utf8");
    const secondEvent = appendEvent("event-txn-second", "command-txn-second", "e");
    await assert.rejects(
      store.commitAppend(txn, {
        kind: "append-jsonl",
        path: relativePath,
        content: `${JSON.stringify(secondEvent)}\n`,
        expectedByteLength: Buffer.byteLength(before),
        commandId: secondEvent.commandId,
        commandFingerprint: secondEvent.commandFingerprint,
      }),
      /reused for a different append/,
    );
    assert.equal(readFileSync(join(libraryPath, relativePath), "utf8"), before);
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

test("snapshot transaction identity includes event content and path, not only command fingerprint", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-snapshot-txn-content-"));
  try {
    mkdirSync(join(libraryPath, "annotations"), { recursive: true });
    const firstPath = "annotations/connections.jsonl";
    const secondPath = "annotations/other.jsonl";
    writeFileSync(join(libraryPath, firstPath), "");
    const store = new SnapshotRevisionStore(libraryPath);
    const txn = await store.beginTransaction("Immutable append identity");
    const firstEvent = appendEvent("event-same-command-a", "same-command-content", "8");
    await store.commitAppend(txn, {
      kind: "append-jsonl",
      path: firstPath,
      content: `${JSON.stringify(firstEvent)}\n`,
      expectedByteLength: 0,
      commandId: firstEvent.commandId,
      commandFingerprint: firstEvent.commandFingerprint,
    });
    const secondEvent = { ...firstEvent, eventId: "event-same-command-b" };
    await assert.rejects(
      store.commitAppend(txn, {
        kind: "append-jsonl",
        path: secondPath,
        content: `${JSON.stringify(secondEvent)}\n`,
        expectedByteLength: 0,
        commandId: secondEvent.commandId,
        commandFingerprint: secondEvent.commandFingerprint,
      }),
      /reused for a different append/,
    );
    assert.equal(existsSync(join(libraryPath, secondPath)), false);
  } finally {
    rmSync(libraryPath, { force: true, recursive: true });
  }
});

function appendEvent(eventId: string, commandId: string, fingerprintCharacter: string) {
  return {
    eventId,
    entityType: "annotation",
    entityId: `connection-${eventId}`,
    commandId,
    commandFingerprint: fingerprintCharacter.repeat(64),
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}

function noteContent(noteId: string, body: string): string {
  return `---\nid: ${noteId}\ntitle: Acts 19\ncreated: 2026-06-29T00:00:00.000Z\nmodified: 2026-06-29T00:00:00.000Z\n---\n${body}\n`;
}
