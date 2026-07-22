import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScriptureWorkspaceTabs.tsx"),
  "utf8",
);
const appSource = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/app.tsx"),
  "utf8",
);

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end} after ${start}`);
  return source.slice(startIndex, endIndex);
}

test("workspace strip exposes one async intent boundary for every context mutation", () => {
  assert.match(source, /onSelect: \(tabId: string\) => Promise<boolean>/);
  assert.match(source, /onClose: \(tabId: string\) => Promise<boolean>/);
  assert.match(source, /onCloseGroup: \(groupId: string\) => Promise<boolean>/);
  assert.match(source, /onToggleGroup: \(groupId: string, collapsing: boolean\) => Promise<boolean>/);

  const approval = section("const runApprovedIntent", "const scheduleCommittedTabFocus");
  assert.match(approval, /const approved = await request\(\)/);
  assert.match(approval, /if \(!approved\) return false;[\s\S]{0,80}commit\(\)/);
  assert.match(approval, /catch[\s\S]{0,60}return false/);
});

test("selection and close paths commit overflow, scroll, and focus only after approval", () => {
  const select = section("const handleSelectTab", "const handleCloseTab");
  assert.match(select, /await runApprovedIntent\([\s\S]{0,120}onSelect\(tabId\)/);
  assert.doesNotMatch(select, /setCollapsedGroups/);
  assert.match(select, /setOverflowOpen\(false\)/);
  assert.match(select, /scheduleCommittedTabFocus/);

  const close = section("const handleCloseTab", "const handleCloseGroup");
  assert.match(close, /await runApprovedIntent\([\s\S]{0,120}onClose\(tabId\)/);
  assert.match(close, /setOverflowOpen\(false\)/);
  assert.match(close, /scheduleCommittedTabFocus/);

  const closeGroup = section("const handleCloseGroup", "const toggleGroup");
  assert.match(closeGroup, /await runApprovedIntent\([\s\S]{0,120}onCloseGroup\(groupId\)/);
  assert.match(closeGroup, /setOverflowOpen\(false\)/);
  assert.match(closeGroup, /scheduleCommittedTabFocus/);
});

test("collapse is a single approved group intent and keyboard or middle click await handlers", () => {
  const toggle = section("const toggleGroup", "const handleTabAuxClick");
  assert.match(toggle, /await runApprovedIntent\([\s\S]{0,120}onToggleGroup\(groupId, collapsing\)/);
  assert.doesNotMatch(toggle, /setCollapsedGroups/);
  assert.doesNotMatch(toggle, /onSelect\(/);

  const keyboard = section("const handleTabKeyDown", "const deferMouseFocus");
  assert.match(keyboard, /async/);
  assert.match(keyboard, /await handleCloseTab\(tabId/);
  assert.match(keyboard, /await handleSelectTab\(next/);

  const middleClick = section("const handleTabAuxClick", "const handleTabKeyDown");
  assert.match(middleClick, /async/);
  assert.match(middleClick, /await handleCloseTab\(tabId/);
});

test("desktop pointer actions defer browser focus until their intent is approved", () => {
  assert.match(source, /const deferMouseFocus/);
  assert.ok(
    [...source.matchAll(/onMouseDown=\{deferMouseFocus\}/g)].length >= 4,
    "tab and group mutation controls must suppress optimistic mouse focus",
  );
  assert.match(source, /handleSelectTab\(tab\.id, \{ moveFocus: true \}\)/);
  assert.match(source, /toggleGroup\(group\.id, !group\.collapsed, event\.currentTarget\)/);
});

test("the APG tablist exposes only tabs while group management stays in the adjacent toolbar", () => {
  const tablist = section(
    'role="tablist"',
    '<div className="scripture-workspace-actions"',
  );

  assert.doesNotMatch(tablist, /role="group"/);
  assert.doesNotMatch(tablist, /scripture-workspace-group-toggle/);
  assert.doesNotMatch(tablist, /tabIndex=\{-1\}/);
  assert.match(
    source,
    /<div className="scripture-workspace-actions" role="toolbar" aria-label="Study tab controls">/,
  );
  assert.match(source, /data-study-collapsed-proxy={collapsedProxy \|\| undefined\}/);
  assert.match(source, /tabIndex={roving \? 0 : -1}/);
  assert.match(source, /visibleStudyWorkspaceTabIds\(workspace\)/);
});

test("every group keeps keyboard-reachable collapse and close actions without requiring overflow", () => {
  assert.match(source, /\(groups\.length > 0 \|\| hasMeasuredOverflow\)/);

  const groupManagement = section(
    '<section className="scripture-workspace-overflow-group"',
    '</section>',
  );
  assert.match(groupManagement, /aria-expanded=\{!group\.collapsed\}/);
  assert.match(groupManagement, /await toggleGroup\(group\.id, !group\.collapsed, event\.currentTarget\)/);
  assert.match(groupManagement, /canCloseGroup && \(/);
  assert.match(groupManagement, /await handleCloseGroup\(group\.id\)/);
});

test("close affordances expose direct and decision actions but never unavailable actions", () => {
  assert.match(source, /const canClose = closeAvailability !== "unavailable"/);
  assert.match(source, /const canCloseGroup = groupCloseAvailability !== "unavailable"/);
  assert.match(source, /const canClose = tabCloseAvailability !== "unavailable"/);
  assert.match(source, /confirmation required/);
  assert.match(source, /aria-keyshortcuts={canClose \? "Delete" : undefined\}/);
  assert.match(source, /canClose && \([\s\S]{0,220}?data-workspace-tab-close/);
  assert.match(source, /collapsedProxy[\s\S]{0,180}?handleCloseGroup\(group\.id\)/);
  assert.match(source, /handleCloseTab\(tab\.id/);
});

test("dismissing All Tabs by Escape or scrim returns focus to its trigger", () => {
  const dismiss = section("const dismissOverflow", "const handleSelectTab");
  assert.match(dismiss, /setOverflowOpen\(false\)/);
  assert.match(dismiss, /overflowButtonRef\.current/);
  assert.match(dismiss, /scheduleControlFocus\(overflowButtonRef\.current, overflowButtonRef\)/);
  const focusHelper = section("const scheduleControlFocus", "const dismissOverflow");
  assert.match(focusHelper, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /onClose=\{dismissOverflow\}/);
});

test("collapsing the active study preserves its active tab for the collapsed proxy", () => {
  const start = appSource.indexOf("const toggleWorkspaceGroup");
  const end = appSource.indexOf("const updateEntityResearchTrail", start);
  assert.ok(start >= 0 && end > start);
  const toggle = appSource.slice(start, end);
  assert.match(toggle, /return toggleStudyWorkspaceGroup\(current, groupId\)/);
  assert.doesNotMatch(toggle, /selectStudyWorkspaceTab/);
});
