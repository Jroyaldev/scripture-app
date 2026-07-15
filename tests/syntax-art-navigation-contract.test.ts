import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const source = readFileSync(
  join(repoRoot, "src", "renderer", "components", "SyntaxArt.tsx"),
  "utf-8",
);

test("Structure exposes direct clause and real-phrase navigation", () => {
  assert.match(source, /syntaxStudyPhraseStops/);
  assert.match(source, /kind="clause"/);
  assert.match(source, /kind="phrase"/);
  assert.match(source, /openClause\(previousClause, false\)/);
  assert.match(source, /openClause\(nextClause, false\)/);
  assert.match(source, /openPhraseGroup\(previousPhrase\.clause, previousPhrase\.group\)/);
  assert.match(source, /openPhraseGroup\(nextPhrase\.clause, nextPhrase\.group\)/);
});

test("Structure navigation remains discoverable and keyboard scoped", () => {
  assert.match(source, /aria-keyshortcuts="Alt\+ArrowLeft"/);
  assert.match(source, /aria-keyshortcuts="Alt\+ArrowRight"/);
  assert.match(source, /event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey/);
  assert.match(source, /Return to selected clause/);
  assert.match(source, /Return to selected phrase/);
});

test("Phrase navigation preserves the chosen detail view and restores Clause focus", () => {
  assert.match(source, /useState<PhraseDiagramView>\(\(\) => policy\?\.defaultView \?\? "diagram"\)/);
  assert.doesNotMatch(source, /\[group\.id, policy\]/);
  assert.match(source, /structure-group-\$\{groupId\}/);
  assert.match(source, /sourceGroup \? <span>\{sourceGroup\.label\}<\/span> : null/);
});
