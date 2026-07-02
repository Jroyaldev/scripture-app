import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("ScripturePage does not load cross-refs or semantic margin while the margin is hidden", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );

  const deterministicEffect = source.indexOf("// Phase 1: Load deterministic margin data");
  const hiddenBranch = source.indexOf("if (!marginVisible)", deterministicEffect);
  const crossRefs = source.indexOf("window.api.scripture.getCrossRefsForChapter", deterministicEffect);

  assert.ok(hiddenBranch !== -1);
  assert.ok(crossRefs !== -1 && crossRefs > hiddenBranch);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /window\.clearTimeout\(timer\)/);
});

test("ScripturePage refreshes chapter highlights even while the margin is hidden", () => {
  const source = readFileSync(
    join(repoRoot, "src", "renderer", "components", "ScripturePage.tsx"),
    "utf-8",
  );

  const effectStart = source.indexOf("// Phase 1: Load deterministic margin data");
  assert.notEqual(effectStart, -1);

  const queryRange = source.indexOf("window.api.library.queryRange", effectStart);
  const hiddenBranch = source.indexOf("if (!marginVisible)", effectStart);

  assert.ok(queryRange !== -1 && queryRange < hiddenBranch);
});
