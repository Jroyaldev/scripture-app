import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("ScripturePage dismisses the highlight palette and clears selection before any persistence await", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );

  const handlerStart = source.indexOf("const handleHighlight = async");
  assert.notEqual(handlerStart, -1);

  // The first await in the handler is the first persistence round-trip (either
  // the recolor delete pass or the fresh-highlight create). The palette must be
  // dismissed and the selection cleared before it, so the palette never spins
  // waiting on disk/Git. (There is no longer a loading-spinner state — the
  // optimistic render provides the feedback instead.)
  const firstAwait = source.indexOf("await ", handlerStart);
  const dismissPalette = source.indexOf("setShowHighlightPalette(false);", handlerStart);
  const clearSelection = source.indexOf("setSelectedVerses(new Set());", handlerStart);
  const clearPhrase = source.indexOf("setPhraseSelection(null);", handlerStart);

  assert.ok(firstAwait !== -1);
  assert.ok(dismissPalette !== -1 && dismissPalette < firstAwait);
  assert.ok(clearSelection !== -1 && clearSelection < firstAwait);
  assert.ok(clearPhrase !== -1 && clearPhrase < firstAwait);
});

test("failed highlight mutations restore the exact selection without automatic retry", () => {
  const page = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );
  const marking = readFileSync(
    join(repoRoot, "src", "renderer", "components", "MarkingSurface.tsx"),
    "utf-8",
  );
  const restoreStart = page.indexOf("const restoreMarkingSelection");
  const highlightStart = page.indexOf("const handleHighlight = async", restoreStart);
  const removeStart = page.indexOf("const handleRemoveSelection = async", highlightStart);
  const noteStart = page.indexOf("const handleNoteFromSelection", removeStart);
  const restore = page.slice(restoreStart, highlightStart);
  const highlight = page.slice(highlightStart, removeStart);
  const remove = page.slice(removeStart, noteStart);
  const applyStart = marking.indexOf("const applyTool");
  const chooseStart = marking.indexOf("const chooseWash", applyStart);
  const apply = marking.slice(applyStart, chooseStart);

  assert.match(restore, /currentMarkingContextKeyRef\.current !== snapshot\.contextKey/);
  assert.match(restore, /selectionGenerationRef\.current !== snapshot\.generation/);
  assert.match(restore, /setPhraseSelection\(snapshot\.phrase/);
  assert.match(restore, /setSelectedVerses\(new Set\(snapshot\.verses\)\)/);
  assert.match(restore, /setShowHighlightPalette\(true\)/);
  assert.doesNotMatch(restore, /setSelectionNonce/);
  assert.match(page, /generation: selectionGenerationRef\.current/);
  assert.match(page, /const advanceSelectionGeneration = useCallback[\s\S]*selectionGenerationRef\.current = next;[\s\S]*setSelectionNonce\(next\)/);
  assert.match(page, /const handleSelectConnection = useCallback[\s\S]*advanceSelectionGeneration\(\)/);
  assert.match(page, /const scheduleVerseFocus = useCallback[\s\S]*cancelAnimationFrame\(readingFocusFrameRef\.current\)[\s\S]*currentMarkingContextKeyRef\.current !== ownerContextKey/);
  assert.ok(
    highlight.indexOf("const selectionSnapshot = captureMarkingSelection()")
      < highlight.indexOf("setShowHighlightPalette(false)"),
  );
  assert.match(highlight, /const ok = recolor\.ok && recolor\.value\.ok;[\s\S]*if \(!ok\) restoreMarkingSelection\(selectionSnapshot\)/);
  assert.match(highlight, /await reloadMarginHighlights\(\); \/\/ Revert optimistic update[\s\S]*restoreMarkingSelection\(selectionSnapshot\);[\s\S]*return false/);
  assert.match(remove, /if \(!ok\) restoreMarkingSelection\(selectionSnapshot\)/);
  assert.match(remove, /const ok = await handleDeleteHighlights[\s\S]*if \(!ok\) restoreMarkingSelection\(selectionSnapshot\)/);
  assert.match(apply, /if \(!ok \|\| \(!persistentSurface && !keepActive\)\) setTool\(null\)/);
  assert.match(apply, /if \(!ok \|\| !persistentSurface\) setTool\(null\)/);
});
