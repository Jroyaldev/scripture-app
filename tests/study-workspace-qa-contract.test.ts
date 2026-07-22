import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string): string => readFileSync(path, "utf8");

const packageJson = JSON.parse(readRepoFile("package.json")) as {
  scripts?: Record<string, string>;
};
const desktopQa = readRepoFile("scripts/qa-desktop-reading-control.mjs");
const workspaceBarQa = readRepoFile("scripts/qa-study-workspace-bar.mjs");
const electronMain = readRepoFile("src/electron/main.ts");

test("package scripts keep build steps separate from the runnable QA entrypoints", () => {
  assert.equal(
    packageJson.scripts?.["qa:desktop-reading-control:run"],
    "node scripts/qa-desktop-reading-control.mjs",
  );
  assert.equal(
    packageJson.scripts?.["qa:desktop-reading-control"],
    "npm run build && npm run build:renderer && npm run qa:desktop-reading-control:run",
  );
  assert.equal(
    packageJson.scripts?.["qa:study-workspace-bar:run"],
    "node scripts/qa-study-workspace-bar.mjs",
  );
  assert.equal(
    packageJson.scripts?.["qa:study-workspace-bar"],
    "npm run build && npm run build:renderer && npm run qa:study-workspace-bar:run",
  );
});

test("desktop control retains the Acts 19 precision, ordering, attention, and draft-exit oracle", () => {
  for (const marker of [
    "pericope-d8-qa-",
    'getChapterText("bsb", "ACT", 19)',
    'quote: "Holy Spirit"',
    'quote: "baptism"',
    "qa-d8-later",
    "qa-d8-earlier",
    "selectedBrackets",
    "visible",
    "inspector",
    "Keep editing",
    "Save connection",
    "Discard draft",
    "window.api.appWindow.requestClose()",
  ]) {
    assert.ok(desktopQa.includes(marker), `missing preserved desktop marker: ${marker}`);
  }

  assert.match(desktopQa, /readFileSync\(connectionEventLogPath\)/);
  assert.match(desktopQa, /assert\.deepEqual\([^;]*connectionEventLogBytes[^;]*\)/s);
  assert.ok(
    !desktopQa.includes("createHash") && !desktopQa.includes(".digest("),
    "the authored-log oracle must compare actual JSONL bytes, not hashes",
  );
});

test("desktop control covers the bounded V2 pastoral workflow and active-only startup fixture", () => {
  for (const marker of [
    'view("ACT", 19',
    'view("JHN", 3',
    'view("ROM", 6',
    "Apollos",
    "Ephesus",
    "Priscilla",
    "[data-study-workspace-bar]",
    "[data-study-group-id]",
    "[data-study-tab-id]",
    "[data-study-tab-kind]",
    "[data-study-collapsed-proxy]",
    "[data-study-all-tabs]",
    "[data-study-all-tabs-search]",
    "[data-study-all-tabs-row]",
    "[data-study-group-rename]",
    "[data-study-tab-move]",
    "[data-study-group-collapse]",
    "[data-study-reopen-recent]",
    "[data-study-passage-fallback]",
    "[data-study-entity-unavailable]",
    "[data-study-persistence-status]",
    "STUDY_WORKSPACE_TAB_LIMIT",
    "64",
    "invalid-passage",
    "missing-entity",
    "active-only",
    '[data-dirty="true"]',
    "data-pending-mutation",
    "recovery",
  ]) {
    assert.ok(desktopQa.includes(marker), `missing V2 desktop marker: ${marker}`);
  }

  assert.match(desktopQa, /SCRIPTURE_QA_STUDY_WORKSPACE_TRACE/);
  assert.match(desktopQa, /study-workspace-qa:chapter/);
  assert.match(desktopQa, /study-workspace-qa:entity/);
  assert.match(desktopQa, /Page\.reload/);
  assert.doesNotMatch(
    desktopQa,
    /driver\.evaluate\(`\(await /,
    "CDP Runtime.evaluate does not accept an unwrapped top-level await",
  );
});

test("the request trace is an exact opt-in with no production-side behavior", () => {
  assert.match(
    electronMain,
    /process\.env\["SCRIPTURE_QA_STUDY_WORKSPACE_TRACE"\] === "1"/,
  );
  assert.match(electronMain, /if \(!studyWorkspaceQaTraceEnabled\) return;/);
  assert.match(electronMain, /study-workspace-qa:chapter/);
  assert.match(electronMain, /study-workspace-qa:entity/);
  assert.match(electronMain, /traceStudyWorkspaceQa\("chapter"/);
  assert.match(electronMain, /traceStudyWorkspaceQa\("entity"/);
});

test("workspace-bar QA captures one identical fixture across the six product themes", () => {
  const expectedThemes = [
    ["light", "paper.png"],
    ["dark", "ink.png"],
    ["glass", "glass.png"],
    ["dark-glass", "candlelight.png"],
    ["porcelain", "porcelain.png"],
    ["onyx", "onyx.png"],
  ] as const;
  for (const [theme, file] of expectedThemes) {
    assert.ok(workspaceBarQa.includes(`id: "${theme}"`), `missing theme ${theme}`);
    assert.ok(workspaceBarQa.includes(`file: "${file}"`), `missing capture ${file}`);
  }

  for (const marker of [
    "output/playwright/study-workspace-bar",
    "paper-tabs.png",
    "width: 1180",
    "height: 900",
    "ZOOM_VIEWPORT",
    "width: 590",
    "height: 450",
    "scrollHeight",
    "scrollIntoView",
    "zoomLastTabVisible",
    "named-expanded-study",
    "collapsed-study",
    "bsb",
    "kjv",
    "person",
    "place",
    "patient teacher, fellow worker",
    "active-entity",
    "data-study-all-tabs-search",
    "document.fonts.ready",
    "requestAnimationFrame(() => requestAnimationFrame",
    "pendingScreenshots",
  ]) {
    assert.ok(workspaceBarQa.includes(marker), `missing bar-fixture marker: ${marker}`);
  }
  assert.match(workspaceBarQa, /passageView\("ACT", 19, "bsb"/);
  assert.match(workspaceBarQa, /passageView\("ACT", 19, "kjv"/);
  assert.ok(!workspaceBarQa.includes("createHash") && !workspaceBarQa.includes(".digest("));
});

test("workspace-bar QA computes geometry, material, focus, and accessibility assertions", () => {
  for (const marker of [
    "backgroundAlpha",
    "activeAlpha",
    "popoverAlpha",
    "labelOpacity",
    "railHeight",
    "backdropFilter",
    "elementFromPoint",
    "contrastRatio",
    "hitTarget",
    "neutralHalo",
    "forced-colors",
    "prefers-reduced-motion",
    "rovingTabCount",
    "ArrowRight",
    "managementControl",
    "focusRingWidth",
    "systemSelection",
    "systemKeyline",
    "minimumTargetSize",
    "centerVisible",
    "Escape",
    "focusReturn",
    "zeroDuration",
  ]) {
    assert.ok(workspaceBarQa.includes(marker), `missing computed bar check: ${marker}`);
  }
  const unobstructedProbe = workspaceBarQa.indexOf("const unobstructedHitTarget");
  const keyboardFocusProbe = workspaceBarQa.indexOf("const keyboardFocusMetrics");
  const openAllTabs = workspaceBarQa.indexOf('document.querySelector("[data-study-all-tabs]")?.click()');
  assert.ok(
    unobstructedProbe >= 0 && openAllTabs > unobstructedProbe,
    "tab hit testing must run before the All Tabs popover mounts its intentional full-viewport scrim",
  );
  assert.ok(
    keyboardFocusProbe >= 0 && openAllTabs > keyboardFocusProbe,
    "keyboard focus styling must be measured before All Tabs intentionally moves focus to search",
  );
  assert.match(
    workspaceBarQa,
    /normalMetricsExpression\(\s*theme\.id,\s*unobstructedHitTarget,\s*keyboardFocusMetrics,?\s*\)/,
  );
});
