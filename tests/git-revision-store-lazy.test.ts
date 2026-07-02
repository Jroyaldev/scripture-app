import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitRevisionStore } from "../src/host/git-revision-store.js";

test("GitRevisionStore schedules small commits without synchronously initializing git", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-revision-"));
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
});
