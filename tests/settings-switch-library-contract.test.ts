import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("SettingsPage wires Switch Library and Reveal in Finder actions", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "SettingsPage.tsx"),
    "utf-8",
  );

  // Switch library: picker -> init -> reload, in that order.
  const dialogIdx = source.indexOf("window.api.dialog.openDirectory()");
  assert.notEqual(dialogIdx, -1, "expected SettingsPage to call window.api.dialog.openDirectory()");

  const initIdx = source.indexOf("window.api.library.init(chosen)", dialogIdx);
  assert.notEqual(initIdx, -1, "expected window.api.library.init(chosen) to follow the folder picker");

  const reloadIdx = source.indexOf("window.location.reload()", initIdx);
  assert.notEqual(reloadIdx, -1, "expected window.location.reload() to follow a successful init");

  // Failure path must report through the shared toast system and NOT reload.
  const switchBlockEnd = source.indexOf("const rebuildIndex", dialogIdx);
  const switchBlock = source.slice(dialogIdx, switchBlockEnd);
  assert.match(switchBlock, /showToast\(/);
  assert.match(switchBlock, /tone: "error"/);
  assert.doesNotMatch(switchBlock, /alert\(/);

  // Reveal in Finder action.
  assert.ok(
    source.includes("window.api.library.revealInFinder()"),
    "expected SettingsPage to call window.api.library.revealInFinder()",
  );
  assert.match(source, /Show in Finder/);

  assert.match(source, /Open another Scripture Library folder/);
  assert.match(source, /Authored files are not changed/);
});
