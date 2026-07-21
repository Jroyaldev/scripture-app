import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { parseNote } from "../src/core/notes/parser.js";
import { LibraryEngine } from "../src/host/library.js";

const repoRoot = resolve(import.meta.dirname, "..");
const backbone = JSON.parse(readFileSync(join(repoRoot, "data/scripture/backbone.json"), "utf-8"));
const bookNames = JSON.parse(readFileSync(join(repoRoot, "data/scripture/book-names-en.json"), "utf-8"));

function makeEngine(): { engine: LibraryEngine; root: string } {
  const root = join(tmpdir(), `note-edit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  const engine = new LibraryEngine(root, backbone, bookNames);
  engine.initLibrary();
  return { engine, root };
}

test("updateNote rewrites content in place while preserving durable metadata", () => {
  const { engine, root } = makeEngine();
  try {
    const path = engine.createNote("01JTESTULID000000000000001", "Original title", "Original body", {
      type: "user",
      tags: ["psalms", "lament"],
    });
    const created = /created: (.+)/.exec(readFileSync(path, "utf-8"))?.[1];
    assert.equal(engine.updateNote("01JTESTULID000000000000001", "Better title", "Better body"), path);
    const after = readFileSync(path, "utf-8");
    assert.match(after, /title: "Better title"/);
    assert.match(after, /type: user/);
    assert.match(after, /tags: \[psalms, lament\]/);
    assert.ok(after.includes(`created: ${created}`));
    assert.ok(after.endsWith("Better body"));
    assert.ok(!after.includes("Original body"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing note updates and deletes refuse instead of creating files", () => {
  const { engine, root } = makeEngine();
  try {
    assert.equal(engine.updateNote("01JDOESNOTEXIST000000000000", "x", "y"), null);
    assert.equal(engine.deleteNote("01JDOESNOTEXIST000000000001"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delete returns exact bytes and restore brings the note back verbatim", () => {
  const { engine, root } = makeEngine();
  try {
    const path = engine.createNote("01JTESTULID000000000000002", "Do not lose me", "Precious body", {
      tags: ["keeps"],
    });
    const original = readFileSync(path, "utf-8");
    const removed = engine.deleteNote("01JTESTULID000000000000002");
    assert.ok(removed);
    assert.equal(removed.content, original);
    assert.equal(existsSync(path), false);
    assert.equal(engine.restoreNote(removed.filename, removed.content), path);
    assert.equal(readFileSync(path, "utf-8"), original);
    assert.equal(engine.restoreNote(removed.filename, "overwrite"), null, "restore never overwrites authored data");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restoreNote refuses path tricks", () => {
  const { engine, root } = makeEngine();
  try {
    assert.equal(engine.restoreNote("../evil.md", "x"), null);
    assert.equal(engine.restoreNote("notes/evil.md", "x"), null);
    assert.equal(engine.restoreNote("no-ulid-prefix.md", "x"), null);
    assert.equal(existsSync(join(root, "evil.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quoted and backslashed titles round-trip across repeated saves", () => {
  const { engine, root } = makeEngine();
  try {
    const original = 'Say "Amen" to C:\\paths';
    const path = engine.createNote("01JTESTULID000000000000009", original, "Body one");
    assert.equal(parseNote(readFileSync(path, "utf-8"), bookNames, backbone).frontmatter.title, original);
    const updated = '"Quoted" start and \\ end"';
    engine.updateNote("01JTESTULID000000000000009", updated, "Body two");
    const parsed = parseNote(readFileSync(path, "utf-8"), bookNames, backbone);
    assert.equal(parsed.frontmatter.title, updated);
    engine.updateNote("01JTESTULID000000000000009", parsed.frontmatter.title, "Body three");
    assert.equal(parseNote(readFileSync(path, "utf-8"), bookNames, backbone).frontmatter.title, updated);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
