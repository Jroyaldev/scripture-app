import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

test("Write is an explicit, recoverable local-note workspace", () => {
  const write = read("src/renderer/components/WritingSheet.tsx");
  const app = read("src/renderer/app.tsx");

  assert.doesNotMatch(write, /style=\{\{/);
  assert.match(write, /Saved only when you choose/);
  assert.match(write, /Plain Markdown/);
  assert.match(write, /safeCall\(\(\) => window\.api\.library\.createNote/);
  assert.match(write, /Note not saved\. Your draft is still here\./);
  assert.match(write, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(write, /<ControlInput/);
  assert.match(write, /<ControlTextarea/);
  assert.match(write, /<Button variant="primary" busy=\{saving\}/);

  assert.match(app, /useState<WritingDraft>/);
  assert.match(app, /draft=\{writingDraft\}/);
  assert.match(app, /onDraftChange=\{setWritingDraft\}/);
  assert.match(app, /WRITING_DRAFT_STORAGE_KEY = "scripture\.writing-draft"/);
  assert.match(app, /useState<WritingDraft>\(recoverWritingDraft\)/);
  assert.match(app, /localStorage\.setItem\(WRITING_DRAFT_STORAGE_KEY/);
  assert.match(app, /localStorage\.removeItem\(WRITING_DRAFT_STORAGE_KEY\)/);
  assert.doesNotMatch(app, /editNoteBody/);
});

test("My notes and Search share a readable, editable detail surface", () => {
  const workspace = read("src/renderer/components/SearchView.tsx");

  assert.doesNotMatch(workspace, /style=\{\{/);
  assert.match(workspace, /type WorkspaceMode = "notes" \| "search"/);
  assert.match(workspace, /aria-label=\{mode === "notes" \? "My notes list" : "Search results"\}/);
  assert.match(workspace, /mode === "notes" \? "My notes" : "Search"/);
  assert.doesNotMatch(workspace, /Local notebook|Note library|Your notebook is ready|your local library/);
  assert.match(workspace, /className="note-detail"/);
  assert.match(workspace, /window\.api\.library\.updateNote/);
  assert.match(workspace, /window\.api\.library\.deleteNote/);
  assert.match(workspace, /window\.api\.library\.restoreNote/);
  assert.match(workspace, /Discard your changes to this note/);
  assert.match(workspace, /Delete permanently/);
  assert.match(workspace, /showToast\("Note deleted\.", "Undo"/);
  assert.match(workspace, /Scripture in this note/);
  assert.match(workspace, /window\.api\.ref\.parseBref\(reference\.bref\)/);
  assert.match(workspace, /event\.key === "ArrowDown"/);
  assert.match(workspace, /event\.key === "ArrowUp"/);
  assert.match(workspace, /event\.key === "Home"/);
  assert.match(workspace, /event\.key === "End"/);
});

test("full-text retrieval refuses stale responses and exposes designed outcomes", () => {
  const workspace = read("src/renderer/components/SearchView.tsx");

  assert.match(workspace, /const seq = \+\+requestSeq\.current/);
  assert.match(workspace, /if \(requestSeq\.current !== seq\) return/);
  assert.match(workspace, /window\.setTimeout\(\(\) =>/);
  assert.match(workspace, /safeCall\(\(\) => window\.api\.library\.search\(trimmed\)\)/);
  assert.match(workspace, /Search is unavailable/);
  assert.match(workspace, /No matching notes/);
  assert.match(workspace, /Recently modified/);
  assert.match(workspace, /aria-label="Clear search"/);
  assert.doesNotMatch(workspace, /Search notes\.\.\. \(FTS5\)/);
});
