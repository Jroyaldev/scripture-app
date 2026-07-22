import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const read = (path: string): string => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const scripture = read("src/renderer/components/ScripturePage.tsx");
const margin = read("src/renderer/components/LivingMargin.tsx");

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  return source.slice(startIndex, source.indexOf(end, startIndex));
}

test("entity close remains an explicit async margin action", () => {
  assert.match(margin, /onCloseEntity\?: \(\) => Promise<boolean>;/);
  assert.match(scripture, /onCloseEntity\?: \(\) => Promise<boolean>;/);
  assert.doesNotMatch(scripture, /requestCanvasResearchExit/);
});

test("Study selection mutates the active canvas without deleting an entity tab", () => {
  const study = section(
    scripture,
    "const selectStudyScope",
    "const handleVerseClick",
  );
  assert.match(study, /const result = nextVerseSelection/);
  assert.match(study, /setSelectedVerses\(result\.selection\)/);
  assert.match(study, /onEnsureMarginVisible\?\.\(\)/);
  assert.doesNotMatch(study, /onCloseEntity|onWorkspaceTabClose/);
});

test("M marking stays in the active canvas", () => {
  const keyHandler = section(
    scripture,
    "const handleVerseKeyDown",
    "// Connection focus is a temporary reading lens",
  );
  const markingStart = keyHandler.indexOf('event.key.toLowerCase() === "m"');
  assert.ok(markingStart >= 0);
  for (const mutation of [
    "handleDismissConnectionFocus()",
    "closeConnectionWordChooser(false)",
    "setPhraseSelection(null)",
    "verseSelectionAnchorRef.current = verse",
    "setSelectedVerses(next)",
    "advanceSelectionGeneration()",
    "positionPalette(next)",
    "setShowHighlightPalette(true)",
  ]) {
    assert.ok(keyHandler.indexOf(mutation, markingStart) > markingStart, `${mutation} is missing from marking`);
  }
  assert.doesNotMatch(keyHandler.slice(markingStart), /onCloseEntity|onWorkspaceTabClose/);
});

test("drag marking snapshots its native range and commits in the active canvas", () => {
  const drag = section(
    scripture,
    "const handleTextMouseUp",
    "// Commit by gesture origin",
  );
  assert.match(drag, /const rangeRects = Array\.from\(range\.getClientRects\(\)\);/);
  assert.match(drag, /const phraseSelection = \{ verseStart, verseEnd, charStart, charEnd \};/);
  assert.match(drag, /const paletteBox = \{/);
  assert.match(drag, /const paletteFocusBox = focusRect/);

  const suppression = drag.indexOf("suppressTrailingDragClick();");
  assert.ok(suppression >= 0, "the trailing native click must be suppressed");
  for (const mutation of [
    "removeAllRanges()",
    "closeConnectionWordChooser(false)",
    "setSelectedConnectionId(null)",
    "verseSelectionAnchorRef.current = null",
    "setSelectedVerses(new Set())",
    "setPhraseSelection(phraseSelection)",
    "advanceSelectionGeneration()",
    "positionPaletteForBox(paletteBox, paletteFocusBox)",
    "setShowHighlightPalette(true)",
  ]) {
    assert.ok(drag.indexOf(mutation) > suppression, `${mutation} ran before drag suppression`);
  }
  assert.doesNotMatch(drag, /onCloseEntity|onWorkspaceTabClose/);
});

test("document mouseup safely starts the asynchronous drag commit", () => {
  const pointerLifecycle = section(
    scripture,
    "// Commit by gesture origin",
    "// Re-anchor the palette",
  );
  assert.match(pointerLifecycle, /textSelectionGestureRef\.current = false;\s*void handleTextMouseUp\(\);/);
});

test("entity-canvas pointer Study keeps ordinary native row focus", () => {
  const click = section(
    scripture,
    "const handleVerseClick",
    "const handleVerseKeyDown",
  );
  assert.match(click, /await selectStudyScope\(verse, event\.shiftKey\)/);
  assert.doesNotMatch(scripture, /DeferredVersePointerFocus|handleVerseMouseDown|deferredVersePointerFocusRef/);
  assert.doesNotMatch(click, /focusVerseAfterApproval|restoreDeferredVersePointerFocus/);
});

test("rejected pointer intents leave the active tab intact", () => {
  const click = section(
    scripture,
    "const handleVerseClick",
    "const handleVerseKeyDown",
  );
  assert.match(click, /if \(!requireSafeConnectionNavigation\(\)\) return;/);
  assert.match(click, /if \(!await selectStudyScope\(verse, event\.shiftKey\)\) return;/);
  assert.doesNotMatch(click, /onCloseEntity|onWorkspaceTabClose/);
});
