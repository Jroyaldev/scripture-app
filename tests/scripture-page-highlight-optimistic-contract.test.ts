import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("ScripturePage dismisses the highlight palette before waiting for persistence", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );

  const handlerStart = source.indexOf("const handleHighlight = async");
  assert.notEqual(handlerStart, -1);

  const awaitSave = source.indexOf("const res = await safeCall", handlerStart);
  const stopLoading = source.indexOf("setHighlightLoading(false);", handlerStart);
  const dismissPalette = source.indexOf("setShowHighlightPalette(false);", handlerStart);
  const clearSelection = source.indexOf("setSelectedVerses(new Set());", handlerStart);

  assert.ok(stopLoading !== -1 && stopLoading < awaitSave);
  assert.ok(dismissPalette !== -1 && dismissPalette < awaitSave);
  assert.ok(clearSelection !== -1 && clearSelection < awaitSave);
});
