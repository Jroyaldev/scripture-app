import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

test("word maps expose one complete roving-tab and tabpanel path", () => {
  const language = read("src/renderer/components/LanguageWordsSection.tsx");

  assert.match(language, /data-study-surface="word-map"/);
  assert.match(language, /role="tablist" aria-label="Word map" aria-orientation="horizontal"/);
  assert.match(language, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(language, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(language, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowUp"/);
  assert.match(language, /event\.key === "Home"/);
  assert.match(language, /event\.key === "End"/);
  assert.match(language, /role="tabpanel"/);
  assert.match(language, /aria-labelledby=\{`\$\{panelId\}-\$\{mode\}-tab`\}/);
});

test("Structure keeps the reading material through its body portal", () => {
  const structure = read("src/renderer/components/StructureModal.tsx");

  assert.match(structure, /name === "dark" \|\| name\.startsWith\("theme-"\)/);
  assert.match(structure, /new MutationObserver\(sync\)/);
  assert.match(structure, /data-floating-layer="dialog"/);
  assert.match(structure, /Sentence structure/);
  assert.match(structure, /phrase and clause map/);
  assert.match(structure, /MACULA \+ Clear Bible/);
  assert.match(structure, /CC BY 4\.0/);
});

test("capture, highlight, and cross-reference overlays state trust and source clearly", () => {
  const note = read("src/renderer/components/NoteCapture.tsx");
  const highlight = read("src/renderer/components/HighlightToolbar.tsx");
  const margin = read("src/renderer/components/LivingMargin.tsx");
  const scripture = read("src/renderer/components/ScripturePage.tsx");

  assert.match(note, /Passage note/);
  assert.match(note, /Plain Markdown · saved locally only when you choose/);
  assert.match(note, /Quote included ·/);
  assert.match(note, /window\.api\.library\.createNote/);

  assert.match(highlight, /role="group" aria-label="Highlight color"/);
  assert.match(highlight, /Add note/);
  assert.match(highlight, /aria-pressed=\{activeColor === color\}/);
  assert.match(scripture, /return createPortal\(/);
  assert.match(scripture, /data-floating-layer="toolbar"/);
  assert.match(scripture, /`theme-\$\{theme\}`/);

  assert.match(margin, /aria-label="OpenBible cross references"/);
  assert.match(margin, /<span>OpenBible<\/span>/);
  assert.match(margin, /For this verse/);
  assert.match(margin, /Across this passage/);
});

test("study surfaces share restrained material styling without malformed blur expressions", () => {
  const css = read("src/renderer/styles.css");

  assert.match(css, /Study overlays — one restrained material and interaction contract/);
  assert.match(css, /\.structure-modal-root\.theme-glass \.structure-modal-panel/);
  assert.match(css, /\.theme-dark-glass \.lang-sense-outline/);
  assert.match(css, /\.theme-dark-glass \.margin-frame-header/);
  assert.match(css, /\.crossref-row:hover,[\s\S]*background: var\(--study-hover-surface\)/);
  assert.match(css, /\.hl-toolbar \{[\s\S]*border-radius: 10px/);
  assert.match(css, /\.note-capture-panel \{[\s\S]*backdrop-filter: blur\(var\(--material-blur\)\)/);
  assert.doesNotMatch(css, /calc\(var\(--material-blur\) \*/);
});
