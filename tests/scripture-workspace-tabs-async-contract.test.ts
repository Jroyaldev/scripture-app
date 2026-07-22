import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScriptureWorkspaceTabs.tsx"),
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
  assert.match(source, /onCloseGroup: \(groupKey: string\) => Promise<boolean>/);
  assert.match(source, /onToggleGroup: \(groupKey: string, collapsing: boolean\) => Promise<boolean>/);

  const approval = section("const runApprovedIntent", "const scheduleCommittedTabFocus");
  assert.match(approval, /const approved = await request\(\)/);
  assert.match(approval, /if \(!approved\) return false;[\s\S]{0,80}commit\(\)/);
  assert.match(approval, /catch[\s\S]{0,60}return false/);
});

test("selection and close paths commit overflow, scroll, and focus only after approval", () => {
  const select = section("const handleSelectTab", "const handleCloseTab");
  assert.match(select, /await runApprovedIntent\([\s\S]{0,120}onSelect\(tabId\)/);
  assert.match(select, /setCollapsedGroups/);
  assert.match(select, /setOverflowOpen\(false\)/);
  assert.match(select, /scheduleCommittedTabFocus/);

  const close = section("const handleCloseTab", "const handleCloseGroup");
  assert.match(close, /await runApprovedIntent\([\s\S]{0,120}onClose\(tabId\)/);
  assert.match(close, /setOverflowOpen\(false\)/);
  assert.match(close, /scheduleCommittedTabFocus/);

  const closeGroup = section("const handleCloseGroup", "const handleTabKeyDown");
  assert.match(closeGroup, /await runApprovedIntent\([\s\S]{0,120}onCloseGroup\(group\.key\)/);
  assert.match(closeGroup, /setOverflowOpen\(false\)/);
  assert.match(closeGroup, /scheduleCommittedTabFocus/);
});

test("collapse is a single approved group intent and keyboard or middle click await handlers", () => {
  const toggle = section("const toggleGroup", "const openOverflow");
  assert.match(toggle, /await runApprovedIntent\([\s\S]{0,120}onToggleGroup\(group\.key, collapsing\)/);
  assert.match(toggle, /setCollapsedGroups/);
  assert.doesNotMatch(toggle, /onSelect\(/);

  const keyboard = section("const handleTabKeyDown", "const handleTabAuxClick");
  assert.match(keyboard, /async/);
  assert.match(keyboard, /await handleCloseTab\(tabId/);
  assert.match(keyboard, /await handleSelectTab\(next/);

  const middleClick = section("const handleTabAuxClick", "const toggleGroup");
  assert.match(middleClick, /async/);
  assert.match(middleClick, /await handleCloseTab\(tabId/);
});

test("desktop pointer actions defer browser focus until their intent is approved", () => {
  assert.match(source, /const deferMouseFocus/);
  assert.equal(
    [...source.matchAll(/onMouseDown=\{deferMouseFocus\}/g)].length,
    6,
    "every tab, group, and overflow mutation control must suppress optimistic mouse focus",
  );
  assert.match(source, /handleSelectTab\(SCRIPTURE_WORKSPACE_ID, \{ moveFocus: true \}\)/);
  assert.match(source, /handleSelectTab\(tab\.id, \{ moveFocus: true \}\)/);
  assert.match(source, /toggleGroup\(group, focusTarget\)/);
});

test("the APG tablist exposes only tabs while group management stays in the adjacent toolbar", () => {
  const tablist = section(
    'role="tablist" aria-label="Open workspaces"',
    '<div className="scripture-workspace-actions"',
  );

  assert.doesNotMatch(tablist, /role="group"/);
  assert.doesNotMatch(tablist, /scripture-workspace-group-toggle/);
  assert.doesNotMatch(tablist, /tabIndex=\{-1\}/);
  assert.match(
    source,
    /<div className="scripture-workspace-actions" role="toolbar" aria-label="Workspace tab controls">/,
  );
});

test("every group keeps keyboard-reachable collapse and close actions without requiring overflow", () => {
  assert.match(source, /const showOverflow = groups\.length > 0 \|\| hasMeasuredOverflow/);

  const groupManagement = section(
    '<section className="scripture-workspace-overflow-group"',
    '</section>',
  );
  assert.match(groupManagement, /aria-expanded=\{!collapsedGroups\.has\(group\.key\)\}/);
  assert.match(groupManagement, /await toggleGroup\(group, focusTarget\)/);
  assert.match(groupManagement, /await handleCloseGroup\(group\)/);
  assert.match(groupManagement, /aria-label=\{`Close \$\{group\.label\} group`\}/);
});
