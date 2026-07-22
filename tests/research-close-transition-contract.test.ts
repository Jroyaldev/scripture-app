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

test("research close remains async across the margin and Scripture boundary", () => {
  assert.match(margin, /onCloseEntity\?: \(\) => Promise<boolean>;/);
  assert.match(scripture, /onCloseEntity\?: \(\) => Promise<boolean>;/);

  const preflight = section(
    scripture,
    "const requestCanvasResearchExit",
    "const selectStudyScope",
  );
  assert.match(preflight, /activeWorkspaceTabId === SCRIPTURE_WORKSPACE_ID/);
  assert.match(preflight, /if \(!onCloseEntity\) return false;/);
  assert.match(preflight, /return await onCloseEntity\(\);/);
  assert.match(preflight, /catch \{/);
});

test("Study selection waits for research close before every local mutation", () => {
  const study = section(
    scripture,
    "const selectStudyScope",
    "const handleVerseClick",
  );
  const approval = study.indexOf("if (!await requestCanvasResearchExit()) return false;");
  assert.ok(approval >= 0);
  for (const mutation of [
    "handleDismissConnectionFocus()",
    "setPhraseSelection(null)",
    "setShowHighlightPalette(false)",
    "removeAllRanges()",
    "verseSelectionAnchorRef.current = result.anchor",
    "setSelectedVerses(result.selection)",
    "advanceSelectionGeneration()",
    "onEnsureMarginVisible?.()",
  ]) {
    assert.ok(study.indexOf(mutation) > approval, `${mutation} ran before research close approval`);
  }
  assert.doesNotMatch(study, /onCloseEntity\?\./);
});

test("M marking waits for research close before chooser, selection, or palette changes", () => {
  const keyHandler = section(
    scripture,
    "const handleVerseKeyDown",
    "// Connection focus is a temporary reading lens",
  );
  const markingStart = keyHandler.indexOf('event.key.toLowerCase() === "m"');
  const approval = keyHandler.indexOf("if (!await requestCanvasResearchExit()) return;", markingStart);
  assert.ok(markingStart >= 0 && approval > markingStart);
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
    assert.ok(keyHandler.indexOf(mutation, markingStart) > approval, `${mutation} ran before research close approval`);
  }
  assert.doesNotMatch(keyHandler.slice(markingStart), /onCloseEntity\?\./);
});

test("drag marking snapshots its native range and waits for research close before local marking changes", () => {
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
  const approval = drag.indexOf("if (!await requestCanvasResearchExit()) return;");
  assert.ok(drag.indexOf("const phraseSelection =") < approval, "native offsets must be captured before awaiting exit");
  assert.ok(drag.indexOf("const paletteBox =") < approval, "native geometry must be captured before awaiting exit");
  assert.ok(suppression >= 0 && approval > suppression, "the trailing native click must be suppressed while exit approval settles");
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
    assert.ok(drag.indexOf(mutation) > approval, `${mutation} ran before research close approval`);
  }
  assert.doesNotMatch(drag, /positionPaletteForRange\(range\)/, "a live Range cannot be trusted after the async exit boundary");
});

test("document mouseup safely starts the asynchronous drag commit", () => {
  const pointerLifecycle = section(
    scripture,
    "// Commit by gesture origin",
    "// Re-anchor the palette",
  );
  assert.match(pointerLifecycle, /textSelectionGestureRef\.current = false;\s*void handleTextMouseUp\(\);/);
});

test("Research pointer Study defers native row focus until close approval", () => {
  const mouseDown = section(
    scripture,
    "const handleVerseMouseDown",
    "const handleVerseClick",
  );
  assert.match(mouseDown, /activeWorkspaceTabId === SCRIPTURE_WORKSPACE_ID/);
  assert.match(mouseDown, /event\.button !== 0/);
  assert.match(mouseDown, /row\.removeAttribute\("tabindex"\)/);
  assert.match(mouseDown, /if \(row\.isConnected\) row\.tabIndex = 0;/);
  assert.doesNotMatch(mouseDown, /preventDefault\(\)/, "native text drag must remain available");
  assert.match(scripture, /onMouseDown=\{handleVerseMouseDown\}/);

  const click = section(
    scripture,
    "const handleVerseClick",
    "const handleVerseKeyDown",
  );
  const approval = click.indexOf("await selectStudyScope(verse, event.shiftKey)");
  const focus = click.indexOf("verseRowRefs.current.get(verse)?.focus({ preventScroll: true })");
  assert.match(click, /activeWorkspaceTabId !== SCRIPTURE_WORKSPACE_ID/);
  assert.ok(approval >= 0 && focus > approval);
  assert.doesNotMatch(click.slice(0, approval), /verseRowRefs\.current\.get\(verse\)\?\.focus/);
});

test("every rejected pointer intent restores the exact prior Research control", () => {
  const mouseDown = section(
    scripture,
    "const handleVerseMouseDown",
    "const handleVerseClick",
  );
  assert.match(mouseDown, /document\.activeElement/);
  assert.match(mouseDown, /const activeElement = document\.activeElement instanceof HTMLElement\s*\? document\.activeElement\s*:\s*null;/);
  assert.doesNotMatch(mouseDown, /activeElement.*closest|closest.*activeElement/);
  assert.match(mouseDown, /deferredVersePointerFocusRef\.current = \{ verse, activeElement \};/);

  const click = section(
    scripture,
    "const handleVerseClick",
    "const handleVerseKeyDown",
  );
  assert.match(click, /const deferredFocus = takeDeferredVersePointerFocus\(verse\);/);
  assert.match(click, /handleSelectConnection\(ordered\[0\]!\.connection\)\.then\(\(proceed\) => \{[\s\S]{0,140}if \(!proceed\) restoreDeferredVersePointerFocus\(deferredFocus\)/);
  assert.match(click, /if \(!requireSafeConnectionNavigation\(\)\) \{\s*restoreDeferredVersePointerFocus\(deferredFocus\);\s*return;/);
  assert.match(click, /requestScriptureWorkspaceAttention\(\)\.then\(\(proceed\) => \{\s*if \(!proceed\) \{\s*restoreDeferredVersePointerFocus\(deferredFocus\)/);
  assert.match(click, /if \(!await selectStudyScope\(verse, event\.shiftKey\)\) \{\s*restoreDeferredVersePointerFocus\(deferredFocus\);\s*return;/);

  const pointerLifecycle = section(
    scripture,
    "// Commit by gesture origin, not release target",
    "// Re-anchor the palette",
  );
  assert.match(pointerLifecycle, /window\.setTimeout\(\(\) => \{\s*if \(deferredVersePointerFocusRef\.current === deferredFocus\) deferredVersePointerFocusRef\.current = null;/);
  assert.match(pointerLifecycle, /deferredVersePointerFocusRef\.current = null;/);
});
