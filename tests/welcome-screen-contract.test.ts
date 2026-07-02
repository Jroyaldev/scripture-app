import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const welcomeScreenPath = join(repoRoot, "src", "renderer", "components", "WelcomeScreen.tsx");

test("WelcomeScreen.tsx exists and wires the folder picker + confirm flow", () => {
  assert.ok(existsSync(welcomeScreenPath), "expected WelcomeScreen.tsx to exist");
  const source = readFileSync(welcomeScreenPath, "utf-8");

  // Uses the native folder picker.
  assert.ok(
    source.includes("window.api.dialog.openDirectory()"),
    "expected WelcomeScreen to call window.api.dialog.openDirectory()",
  );

  // Calls the onConfirm prop (for both the default-location path and the
  // chosen-folder confirm path).
  assert.ok(source.includes("onConfirm(defaultPath)"), "expected onConfirm to be called with defaultPath");
  assert.ok(source.includes("onConfirm(chosenPath)"), "expected onConfirm to be called with the chosen path");

  // Renderer self-containment: must not import from src/core.
  assert.doesNotMatch(source, /from ["'].*\/core\//, "WelcomeScreen must not import from src/core");

  // Must not fabricate hardcoded scripture/library data — no inline verse
  // text or book-name arrays; content is limited to the welcome copy.
  assert.doesNotMatch(source, /Genesis|Exodus|Leviticus|Matthew|Psalm/i);
  assert.doesNotMatch(source, /backbone|bookNames/i);
});
