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
