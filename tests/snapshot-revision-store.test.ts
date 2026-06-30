import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SnapshotRevisionStore } from "../src/host/snapshot-revision-store.js";

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

function noteContent(noteId: string, body: string): string {
  return `---\nid: ${noteId}\ntitle: Acts 19\ncreated: 2026-06-29T00:00:00.000Z\nmodified: 2026-06-29T00:00:00.000Z\n---\n${body}\n`;
}
