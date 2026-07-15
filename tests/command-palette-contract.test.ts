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
  assert.match(source, /returnFocusRef\.current = null/);
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

test("name results open reversible Living Margin research instead of guessing a verse", () => {
  const command = readFileSync(join(repoRoot, "src", "renderer", "components", "CommandPalette.tsx"), "utf8");
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf8");
  assert.match(command, /activate: \(\) => closeAnd\(\(\) => onOpenEntity\(entity\.id\)\)/);
  assert.doesNotMatch(command, /bestEntityRef|parseEntityRef/);
  assert.match(app, /setEntityIntent\(\{ id: entityId, nonce: Date\.now\(\), origin \}\)/);
  assert.match(app, /setMarginVisible\(true\)/);
  assert.match(margin, /window\.api\.language\.getEntityResearch\(entityIntent\.id\)/);
  assert.match(margin, /data-margin-mode="research"/);
  assert.match(margin, /window\.addEventListener\("keydown", closeResearch, true\)/);
  assert.match(margin, /onCloseEntity/);
});

test("entity research preserves its exact opening passage and labels evidence truthfully", () => {
  const app = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf8");
  const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf8");

  assert.match(app, /setCommandContext\(readingContext\)/);
  assert.match(app, /context=\{commandContext\}/);
  assert.match(app, /onOpenEntity=\{openCommandEntityResearch\}/);
  assert.match(page, /chapterEndVerse: backbone\.books\[book\]\?\.chapters\[chapter - 1\]/);
  assert.match(margin, /deriveEntityOpeningContext\(data\.entity\.refs, openingOrigin\)/);
  assert.match(margin, /From your reading/);
  assert.match(margin, /Broader research/);
  assert.match(margin, /No TIPNR-indexed mention in \{scopeLabel\}/);
});
