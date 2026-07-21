import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GitRevisionStore } from "../src/host/git-revision-store.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

test("a tracked deletion commits and does not poison later flushes", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-revision-delete-"));
  try {
    mkdirSync(join(libraryPath, "notes"), { recursive: true });
    const store = new GitRevisionStore(libraryPath);
    writeFileSync(join(libraryPath, "notes", "01X--a.md"), "hello");
    const create = await store.beginTransaction("Create note");
    create.files.push("notes/01X--a.md");
    await store.commit(create);
    await store.flush("Create note");

    rmSync(join(libraryPath, "notes", "01X--a.md"));
    const del = await store.beginTransaction("Delete note");
    del.files.push("notes/01X--a.md");
    await store.commit(del);
    await store.flush("Delete note");
    assert.match(git(libraryPath, "log", "--oneline", "-1"), /Delete note/);
    assert.equal(git(libraryPath, "status", "--porcelain").trim(), "");

    writeFileSync(join(libraryPath, "notes", "01Y--b.md"), "after");
    const later = await store.beginTransaction("Create second note");
    later.files.push("notes/01Y--b.md");
    await store.commit(later);
    await store.flush("Create second note");
    assert.match(git(libraryPath, "log", "--oneline", "-1"), /Create second note/);
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});

test("a never-tracked deletion flushes without an empty commit", async () => {
  const libraryPath = mkdtempSync(join(tmpdir(), "scripture-revision-untracked-"));
  try {
    mkdirSync(join(libraryPath, "notes"), { recursive: true });
    const store = new GitRevisionStore(libraryPath);
    const del = await store.beginTransaction("Delete note");
    del.files.push("notes/never-tracked.md");
    await store.commit(del);
    await store.flush("Delete note");
    assert.doesNotMatch(git(libraryPath, "log", "--oneline", "-1"), /Delete note/);
    assert.equal(git(libraryPath, "status", "--porcelain").trim(), "");
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});
