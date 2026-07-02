import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("ScripturePage guards the chapter-text load effect against out-of-order responses", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );

  const effectStart = source.indexOf("// Load chapter text");
  assert.notEqual(effectStart, -1);

  const cancelledDeclared = source.indexOf("let cancelled = false", effectStart);
  const cancelledGuard = source.indexOf("if (cancelled) return;", effectStart);
  const setChapterData = source.indexOf("setChapterData(res.value)", effectStart);
  const cleanup = source.indexOf("cancelled = true", effectStart);

  assert.ok(cancelledDeclared !== -1);
  assert.ok(cancelledGuard !== -1 && cancelledGuard < setChapterData);
  assert.ok(cleanup !== -1 && cleanup > cancelledDeclared);
});
