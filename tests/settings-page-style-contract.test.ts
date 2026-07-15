import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("SettingsPage uses stylesheet classes instead of inline styles", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "SettingsPage.tsx"),
    "utf-8",
  );

  assert.doesNotMatch(source, /style=\{\{/, "SettingsPage should not contain inline style objects");
  assert.match(source, /<h1>Settings<\/h1>/, "expected one clear Settings page title");
  assert.match(source, /aria-label="Settings sections"/, "expected navigable settings sections");
  assert.match(source, /<SegmentedControl/, "expected keyboard-complete shared segmented controls");
  assert.doesNotMatch(source, /alert\(/, "settings outcomes should use the shared toast system");
  assert.doesNotMatch(source, /className="rc-segmented/, "legacy segmented controls should not return");
});

test("ImportPage stages the source before importing and has designed outcomes", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ImportPage.tsx"),
    "utf-8",
  );

  assert.doesNotMatch(source, /style=\{\{/);
  assert.match(source, /Selected vault/);
  assert.match(source, /Import complete/);
  assert.match(source, /Import could not finish/);
  assert.match(source, /Try again/);
  assert.match(source, /safeCall\(\(\) => window\.api\.library\.importVault\(vaultPath\)\)/);
});
