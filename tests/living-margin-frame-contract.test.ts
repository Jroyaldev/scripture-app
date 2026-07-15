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

test("Passage, Connections, and Notes are stable keyboard tabs over the current scope", () => {
  assert.match(margin, /type MarginTab = "passage" \| "connections" \| "notes"/);
  assert.match(margin, /role="tablist" aria-label="Study views" aria-orientation="horizontal"/);
  assert.match(margin, /aria-selected=\{selected\}/);
  assert.match(margin, /aria-controls=\{`margin-\$\{tab\.id\}-panel`\}/);
  assert.match(margin, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(margin, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(margin, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowUp"/);
  assert.match(margin, /event\.key === "Home"/);
  assert.match(margin, /event\.key === "End"/);
  assert.match(margin, /role="tabpanel"/);
  assert.match(margin, /hidden=\{activeTab !== "passage"\}/);
  assert.match(margin, /hidden=\{activeTab !== "connections"\}/);
  assert.match(margin, /hidden=\{activeTab !== "notes"\}/);
  assert.match(margin, /tabScrollPositionsRef/);
  assert.match(css, /\.margin-tabs\s*\{[\s\S]*position: sticky/);
  assert.match(css, /\.margin-tab\.is-active::after/);
});

test("tab content preserves public and personal trust boundaries", () => {
  const passageStart = margin.lastIndexOf('id="margin-passage-panel"');
  const connectionsStart = margin.lastIndexOf('id="margin-connections-panel"');
  const notesStart = margin.lastIndexOf('id="margin-notes-panel"');
  const passagePanel = margin.slice(
    passageStart,
    connectionsStart,
  );
  const connectionsPanel = margin.slice(
    connectionsStart,
    notesStart,
  );
  const notesPanel = margin.slice(notesStart);

  assert.match(passagePanel, /LanguageWordsSection/);
  assert.match(connectionsPanel, /CrossRefsBlock/);
  assert.match(connectionsPanel, /NoteCrossRefsBlock/);
  assert.match(connectionsPanel, /Public cross references and personal connections, kept visibly separate/);
  assert.match(notesPanel, /Passage insight/);
  assert.match(notesPanel, /More from your notes/);
  assert.doesNotMatch(notesPanel, /NoteCrossRefsBlock/);
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
