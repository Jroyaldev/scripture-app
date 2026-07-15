import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const margin = readFileSync(join(repoRoot, "src", "renderer", "components", "LivingMargin.tsx"), "utf-8");
const page = readFileSync(join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"), "utf-8");
const css = readFileSync(join(repoRoot, "src", "renderer", "styles.css"), "utf-8");

test("Living Margin is one labelled frame with truthful chapter, reading, and selected modes", () => {
  assert.match(margin, /aria-labelledby="living-margin-title"/);
  assert.match(margin, /const marginMode = isPinned \? "Selected" : isNear \? "In view" : "Chapter"/);
  assert.match(margin, /data-margin-mode=\{marginMode\.toLowerCase\(\)\.replace\(" ", "-"\)\}/);
  assert.match(margin, /data-margin-view="chapter"/);
  assert.match(margin, /data-margin-view="reading"/);
  assert.match(margin, /data-margin-view="selected"/);
  assert.match(css, /\.margin-frame-header\s*\{[\s\S]*position: sticky/);
});

test("chapter top remains an overview before the margin follows the reading eye-line", () => {
  assert.match(page, /if \(root\.scrollTop < 72\) \{[\s\S]*setNearVerse/);
  assert.match(page, /const marginHasPointer = document\.querySelector\("\.living-margin"\)\?\.matches\(":hover"\) \?\? false/);
  assert.match(page, /if \(studyLockVerseRef\.current != null\) studyLockVerseRef\.current = null/);
  assert.match(page, /const eyeY = rootRect\.top \+ rootRect\.height \* 0\.32/);
  assert.match(page, /nearVerse=\{pinnedRange \? null : nearVerse\}/);
});

test("selected-passage note evidence never falls back to chapter-wide semantic data", () => {
  assert.match(margin, /const pinnedSemantic = pinnedAiResult \?\? null/);
  assert.doesNotMatch(margin, /pinnedAiResult \?\? semanticData/);
  assert.match(margin, /Passage insight from your notes/);
  assert.match(margin, /From your notes/);
});

test("long selections and secondary note material disclose progressively", () => {
  assert.match(margin, /const canExpand = text\.length > 220/);
  assert.match(margin, /Read full selection/);
  assert.match(margin, /aria-expanded=\{expanded\}/);
  assert.match(margin, /function MarginDisclosure/);
  assert.match(margin, /label="More from your notes"/);
  assert.match(css, /\.margin-focus-quote\.is-collapsed[\s\S]*-webkit-line-clamp: 4/);
});

test("Done clears selection and restores focus to the persistent Study heading", () => {
  assert.match(margin, /window\.setTimeout\(\(\) => frameTitleRef\.current\?\.focus\(\), 0\)/);
  assert.match(margin, /ref=\{frameTitleRef\}[\s\S]*tabIndex=\{-1\}/);
  assert.match(page, /const handleClearMarginSelection = useCallback\(\(\) => \{[\s\S]*setSelectedVerses\(new Set\(\)\)/);
  assert.match(page, /onClearSelection=\{handleClearMarginSelection\}/);
});
