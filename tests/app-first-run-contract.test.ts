import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("App detects a missing library and renders a WelcomeScreen first-run branch", () => {
  const source = readFileSync(join(repoRoot, "src", "renderer", "app.tsx"), "utf-8");

  // LoadState union must include a "first-run" status carrying a defaultPath.
  assert.match(
    source,
    /\{\s*status:\s*"first-run";\s*defaultPath:\s*string\s*\}/,
    "expected LoadState to include a first-run status with a defaultPath",
  );

  // loadData() must call window.api.library.getInfo (via safeCall, alongside
  // the existing backbone/bookNames/getPath calls).
  const loadDataStart = source.indexOf("const loadData = useCallback");
  assert.notEqual(loadDataStart, -1, "expected loadData callback to exist");
  const loadDataEnd = source.indexOf("}, []);", loadDataStart);
  assert.notEqual(loadDataEnd, -1);
  const loadDataBody = source.slice(loadDataStart, loadDataEnd);

  assert.ok(
    loadDataBody.includes("window.api.library.getInfo()"),
    "expected loadData to call window.api.library.getInfo()",
  );

  // Must check hasLibrary === false and switch to the first-run state.
  assert.ok(
    loadDataBody.includes("hasLibrary === false"),
    "expected loadData to gate on hasLibrary === false",
  );
  assert.ok(
    loadDataBody.includes('setLoadState({ status: "first-run", defaultPath: infoRes.value.path })'),
    "expected loadData to set first-run state with the info's path",
  );

  // The existing backbone/bookNames error handling must remain untouched.
  assert.match(source, /Failed to load backbone: \$\{backboneRes\.error\}/);
  assert.match(source, /Failed to load book names: \$\{bookNamesRes\.error\}/);

  // A render branch must check loadState.status === "first-run" and render
  // WelcomeScreen.
  const renderBranchIdx = source.indexOf('loadState.status === "first-run"');
  assert.notEqual(renderBranchIdx, -1, "expected a render branch checking first-run status");
  const branchSlice = source.slice(renderBranchIdx, renderBranchIdx + 400);
  assert.match(branchSlice, /<WelcomeScreen/, "expected the first-run branch to render WelcomeScreen");

  // WelcomeScreen must be imported.
  assert.match(source, /import \{ WelcomeScreen \} from "\.\/components\/WelcomeScreen\.js";/);
});
