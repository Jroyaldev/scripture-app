import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  studyWorkspaceSearchMatches,
  studyWorkspaceRovingTabId,
} from "../src/renderer/components/ScriptureWorkspaceTabs.js";

const componentSource = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScriptureWorkspaceTabs.tsx"),
  "utf8",
);
const stylesSource = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/styles.css"),
  "utf8",
);

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end} after ${start}`);
  return source.slice(startIndex, endIndex);
}

test("the workspace exposes approval-returning callbacks for every tab and group mutation", () => {
  assert.match(componentSource, /onRenameGroup: \(groupId: string, label: string\) => Promise<boolean>/);
  assert.match(componentSource, /onMoveTab: \(tabId: string, targetGroupId: string\) => Promise<boolean>/);
  assert.match(componentSource, /onReorderTab: \(tabId: string, position: WorkspaceReorderPosition\) => Promise<boolean>/);
  assert.match(componentSource, /onReorderGroup: \(groupId: string, position: WorkspaceReorderPosition\) => Promise<boolean>/);
  assert.match(componentSource, /onReopenRecent: \(\) => Promise<boolean>/);

  const imports = section(componentSource, "import {", "function PassageGlyph");
  assert.doesNotMatch(imports, /renameStudyWorkspaceGroup|moveStudyWorkspaceTab|reorderStudyWorkspace|reopenClosedStudyItem/);
});

test("one global APG tablist contains tabs and collapsed proxies with one roving stop", () => {
  assert.equal([...componentSource.matchAll(/role="tablist"/g)].length, 1);
  const tablist = section(componentSource, 'role="tablist"', '<div className="scripture-workspace-actions"');
  assert.match(tablist, /groups\.flatMap/);
  assert.match(tablist, /role="tab"/);
  assert.match(tablist, /role="presentation"/);
  assert.doesNotMatch(tablist, /role="button"|scripture-workspace-group-manage|scripture-workspace-open/);
  assert.match(tablist, /data-study-collapsed-proxy=/);
  assert.match(tablist, /const visibleLabel = collapsedProxy \? groupLabel : label/);
  assert.match(
    tablist,
    /const expandedGroupLabel = !collapsedProxy && tabIndex === 0\s*\? groupLabel\s*: undefined/,
    "every expanded study must expose its group identity before the first tab",
  );
  assert.match(tablist, /const closeAvailability = collapsedProxy/);
  assert.match(tablist, /const canClose = closeAvailability !== "unavailable"/);
  assert.match(tablist, /tabIndex=\{roving \? 0 : -1\}/);

  assert.equal(studyWorkspaceRovingTabId(["acts", "paul"], "paul"), "paul");
  assert.equal(studyWorkspaceRovingTabId(["acts", "paul"], "missing"), "acts");
  assert.equal(studyWorkspaceRovingTabId([], "missing"), null);
});

test("the fixed toolbar stays small and exposes one active-group menu, Open, recent recovery, and All Tabs", () => {
  const toolbar = section(
    componentSource,
    '<div className="scripture-workspace-actions"',
    "{overflowOpen && overflowAnchor",
  );
  assert.match(toolbar, /data-study-active-group-manage/);
  assert.equal([...toolbar.matchAll(/data-study-active-group-manage/g)].length, 1);
  assert.doesNotMatch(toolbar, /groups\.map/);
  assert.match(toolbar, /data-study-open=""/);
  // The Open control now carries an inline stroke glyph, not the "+" character.
  assert.match(toolbar, /<span aria-hidden="true"><PlusGlyph \/><\/span><span>Open<\/span>/);
  // The standalone reopen button is gone from the at-rest cluster; recovery now
  // lives entirely inside the All Tabs overflow.
  assert.doesNotMatch(toolbar, /data-study-reopen-recent/);
  assert.doesNotMatch(toolbar, /scripture-workspace-reopen/);
  assert.match(toolbar, /data-study-all-tabs/);
  assert.match(componentSource, />Study or question<\/label>/);
});

test("the strip and its popovers use custom menus and shared tooltips, never native selects", () => {
  // No native <select> anywhere in the strip or its popovers.
  assert.doesNotMatch(componentSource, /<select/);
  assert.doesNotMatch(componentSource, /<option/);
  // Order/Move controls are custom menus on the Popover primitive.
  assert.match(componentSource, /className="scripture-workspace-menu-trigger"/);
  assert.match(componentSource, /data-study-workspace-menu=/);
  assert.match(componentSource, /role="menu"/);
  assert.match(componentSource, /role="menuitem"/);
  // Strip controls use the shared Tooltip component.
  assert.match(componentSource, /import \{ Tooltip \} from "\.\/Tooltip\.js"/);
  assert.match(componentSource, /<Tooltip label=\{openTooltip\}>/);
  // One glyph system: inline stroke-SVG components, no unicode control glyphs.
  for (const glyph of ["CaretGlyph", "PlusGlyph", "OverflowGlyph", "SearchGlyph", "ReopenGlyph"]) {
    assert.match(componentSource, new RegExp(`function ${glyph}\\(`));
  }
  assert.doesNotMatch(componentSource, /⌄|↶|•••|⌕/);
});

test("the Open control gauges the 64-tab capacity", () => {
  assert.match(componentSource, /const atTabCapacity = totalTabs >= STUDY_WORKSPACE_TAB_LIMIT/);
  assert.match(componentSource, /aria-disabled=\{atTabCapacity \|\| undefined\}/);
  assert.match(componentSource, /if \(!atTabCapacity\) onNewResearch\(\)/);
  // The tooltip surfaces the count when within a few tabs of the cap.
  assert.match(componentSource, /of \$\{STUDY_WORKSPACE_TAB_LIMIT\} studies open/);
});

test("All Tabs is searchable, grouped, and owns tab and group management", () => {
  const allTabs = section(componentSource, "{overflowOpen && overflowAnchor", "</nav>");
  assert.match(allTabs, /type="search"/);
  assert.match(allTabs, /data-study-all-tabs-search/);
  assert.match(allTabs, /filteredGroups\.map/);
  assert.match(allTabs, /data-study-group-rename/);
  assert.match(allTabs, /data-study-group-collapse/);
  assert.match(allTabs, /data-study-group-close/);
  assert.match(allTabs, /data-study-group-reorder/);
  assert.match(allTabs, /data-study-tab-reorder/);
  assert.match(allTabs, /data-study-tab-move/);
  assert.match(allTabs, /data-study-all-tabs-row/);
  assert.match(allTabs, /data-study-empty-search/);

  assert.equal(studyWorkspaceSearchMatches("spirit", "Acts study", "Holy Spirit"), true);
  assert.equal(studyWorkspaceSearchMatches("holy acts", "Acts study", "Holy Spirit"), true);
  assert.equal(studyWorkspaceSearchMatches("paul rome", "Acts study", "Paul"), false);
  assert.equal(studyWorkspaceSearchMatches("  ", "Acts study", "Paul"), true);
});

test("rename, move, reorder, collapse, close, and recovery commit UI state only after approval", () => {
  const approval = section(componentSource, "const runApprovedIntent", "const scheduleCommittedTabFocus");
  assert.match(approval, /if \(pendingWorkspaceIntentCountRef\.current > 0\) return false/);
  assert.match(approval, /const approved = await request\(\)/);
  assert.match(approval, /if \(!approved\) return false;[\s\S]{0,80}commit\(\)/);

  for (const callback of [
    "onRenameGroup(groupId, trimmed)",
    "onMoveTab(tabId, targetGroupId)",
    "onReorderTab(tabId, position)",
    "onReorderGroup(groupId, position)",
    "onReopenRecent()",
  ]) {
    const escaped = callback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(componentSource, new RegExp(`runApprovedIntent\\([\\s\\S]{0,180}${escaped}`));
  }
  assert.match(componentSource, /if \(approved\) setRenameGroupId\(null\)/);
  assert.match(componentSource, /scheduleCommittedTabFocus\(null, true\)/);
});

test("the register is a strip of canvas the active page is pulled up through", () => {
  const rail = section(stylesSource, ".scripture-workspace-bar {", ".topbar-navigation,");

  // 30px tab in a 34px strip, and the strip carries no fill of its own: it is
  // the page's own canvas showing through. The 24px above the tabs is the page
  // inset's top edge, doubling as the window drag region.
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}min-height: 34px;/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}flex: 0 0 auto;/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}padding: var\(--page-inset\) var\(--page-inset\) 0 0;/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}background: transparent;/);
  // No border-bottom: a rule here would fight the fillet, which is the thing
  // actually joining the tab to the page.
  assert.doesNotMatch(rail.slice(0, rail.indexOf("\n}")), /border-bottom/);
  assert.match(rail, /\.scripture-workspace-tab \{[\s\S]{0,420}height: 30px;/);

  // The paper fill IS the mark. The tab is a piece of the page pulled up above
  // the register's baseline, so it takes paper, the page's radius, and no
  // second indicator — instant, because this is the app answering "where am I".
  assert.match(rail, /\.scripture-workspace-tab \{[\s\S]{0,420}border-radius: var\(--radius-page\) var\(--radius-page\) 0 0;/);
  assert.match(
    rail,
    /\.scripture-workspace-tab\[aria-selected="true"\] \{\s*background: var\(--bg-reading\);\s*color: var\(--text-primary\);\s*transition: none;\s*\}/,
  );
  // An inactive tab gets no shape and no hover fill, ever — a hovered shape is
  // a third fill, and re-creates the mush the two-plane rule exists to prevent.
  assert.match(rail, /\.scripture-workspace-tab:hover \{\s*background: transparent;/);
  // Gold survives in the register as ink and as the focus ring, never as a fill.
  assert.doesNotMatch(rail, /background:\s*(?:var\(--study-gold\)|color-mix\([^;]*--study-gold)/);
  assert.match(rail, /\.scripture-workspace-tab\[aria-selected="true"\] \.scripture-workspace-tab-mark \{\s*color: var\(--study-gold\);/);

  assert.match(rail, /\.scripture-workspace-tab-label \{[\s\S]{0,180}opacity: 1/);
  // The group is a bracket, not a chip: a rule over its members carrying a 9px
  // mono label. Mono because a group id is chrome, not something you read.
  assert.match(rail, /\.scripture-workspace-group-tab \{[\s\S]{0,320}font: 500 9px\/1 var\(--font-mono\)/);
  assert.match(rail, /\.scripture-workspace-group-tab::before \{[\s\S]{0,220}height: 1px;/);
  assert.match(rail, /\.scripture-workspace-active-group small \{[\s\S]{0,260}font: 500 9px\/1 var\(--font-ui\);[\s\S]{0,80}font-variant-numeric: tabular-nums/);
  assert.match(rail, /min-width: 24px/);
  assert.match(rail, /min-height: 24px/);
  assert.match(rail, /overflow-x: auto/);
  assert.match(rail, /overscroll-behavior-inline: contain/);
  assert.match(rail, /scroll-padding-inline/);
  // Workspace popovers inherit the shared --bg-float material (no fill override).
  assert.match(
    rail,
    /\.popover-panel\.scripture-workspace-group-popover,\s*\.popover-panel\.scripture-workspace-overflow-popover \{[\s\S]{0,180}background: rgb\(from var\(--bg-float\) r g b \/ 1\);/,
  );
  assert.match(rail, /\.scripture-workspace-overflow-popover \{[\s\S]{0,220}display: grid;[\s\S]{0,180}grid-template-rows: auto auto minmax\(0, 1fr\)/);
  assert.match(rail, /\.scripture-workspace-overflow-list \{[\s\S]{0,220}min-height: 0;[\s\S]{0,120}overflow-y: auto;[\s\S]{0,120}overscroll-behavior: contain;/);
  // Scroll-edge indicators are clean mask fades, never a blurred inset shadow.
  assert.match(rail, /\.scripture-workspace-viewport\.is-scrollable-left \{[\s\S]{0,160}mask-image: linear-gradient/);
  assert.doesNotMatch(rail, /is-scrollable-left \{[\s\S]{0,120}box-shadow/);
  // The viewport may only clip on the x-axis: overflow:hidden would shear the
  // fillets flush against the tab and read as a rendering bug.
  assert.match(rail, /\.scripture-workspace-viewport \{[\s\S]{0,320}overflow-x: auto;\s*overflow-y: visible;/);
  assert.match(rail, /@media \(forced-colors: active\)/);
  assert.match(rail, /@media \(prefers-reduced-motion: reduce\)/);
});
