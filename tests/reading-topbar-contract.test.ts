import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("reading topbar has stable location and tool zones without margin-width coupling", () => {
  const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
  const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");

  assert.match(page, /role="toolbar" aria-label="Reading toolbar"/);
  assert.match(page, /className="topbar-navigation"/);
  assert.match(page, /className="topbar-tools"/);
  assert.doesNotMatch(page, /topbar-margin-slot/);
  assert.doesNotMatch(css, /\.topbar-margin-slot/);
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*\.passage-jump\s*\{\s*width: 36px;/);
});

test("reading topbar exposes passage movement, picker state, and a discoverable jump shortcut", () => {
  const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");

  assert.match(page, /aria-label="Previous chapter"/);
  assert.match(page, /aria-label="Next chapter"/);
  assert.match(page, /aria-haspopup="dialog"[\s\S]*aria-expanded=\{passageOpen\}/);
  assert.match(page, /aria-haspopup="dialog"[\s\S]*aria-expanded=\{versionOpen\}/);
  assert.match(app, /event\.key\.toLocaleLowerCase\(\) !== "k"/);
  assert.match(app, /setCommandOpen\(true\)/);
  assert.match(page, /className="passage-jump command-palette-trigger"/);
  assert.match(page, /onClick=\{onOpenCommandPalette\}/);
  assert.match(page, /<kbd className="passage-jump-shortcut"/);
  assert.match(page, /aria-haspopup="dialog"/);
});

test("topbar popovers are named and return focus through their trigger refs", () => {
  const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
  const comfort = readFileSync(join(repoRoot, "src", "renderer", "components", "ReadingComfort.tsx"), "utf-8");
  const theme = readFileSync(join(repoRoot, "src", "renderer", "components", "ThemePicker.tsx"), "utf-8");

  assert.match(page, /ariaLabel="Choose passage"/);
  assert.match(page, /ariaLabel="Choose Bible translation"/);
  assert.match(page, /passageShouldReturnFocus\.current = false;\s*passageBtnRef\.current\?\.focus\(\)/);
  assert.match(page, /versionShouldReturnFocus\.current = false;\s*versionBtnRef\.current\?\.focus\(\)/);
  assert.match(comfort, /ariaLabel="Reading layout"/);
  assert.match(comfort, /shouldReturnFocus\.current = false;\s*btnRef\.current\?\.focus\(\)/);
  assert.match(theme, /ariaLabel="Reading atmosphere"/);
  assert.match(theme, /shouldReturnFocus\.current = false;\s*buttonRef\.current\?\.focus\(\)/);
});
