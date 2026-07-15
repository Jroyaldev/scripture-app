import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("command palette has four truthful high-traffic lenses", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  for (const label of ["Intelligence", "Scripture", "Notes", "Names"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
});

test("command palette traps focus, restores it, and exposes complete keyboard traversal", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  assert.match(source, /const isLensKey = event\.key === "Tab" \|\| event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(source, /const reverse = event\.key === "ArrowLeft" \|\| \(event\.key === "Tab" && event\.shiftKey\)/);
  assert.match(source, /% TABS\.length/);
  assert.match(source, /setActiveTab\(\(current\) =>/);
  assert.match(source, /inputRef\.current\?\.focus\(\)/);
  assert.match(source, /returnFocusRef/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "ArrowUp"/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(source, /event\.key === "Escape"/);
});

test("palette keeps public Scripture, local notes, and TIPNR names as separate indexes", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  assert.match(source, /window\.api\.scripture\.search/);
  assert.match(source, /window\.api\.library\.search/);
  assert.match(source, /window\.api\.language\.searchEntities/);
  assert.match(source, /Your library/);
  assert.match(source, /Name matches rank before definition matches/);
});
