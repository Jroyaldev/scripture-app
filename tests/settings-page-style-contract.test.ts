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
});
