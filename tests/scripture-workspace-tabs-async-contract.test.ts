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

/**
 * This component records a retirement by quoting the code that was retired, so
 * any "this is not here any more" check has to read statements only — otherwise
 * it passes on the very note that proves the branch is gone.
 */
const statementsOnly = (input: string): string => input
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

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
  assert.match(source, /onPromoteTab: \(tabId: string\) => Promise<boolean>/);
  /* ONE CALLBACK HERE IS DELIBERATELY VOID, 2026-07-30, and it is the only one.
     `onTabDragOverStudy` reports which study chip a dragged tab is currently
     over so the row above can paint it. Nothing is committed by hovering, so
     there is no approval to wait for and no state to roll back — giving it the
     intent boundary's shape would claim a decision it does not make. The DROP
     is `onMoveTab`, which has the boundary like every other mutation. */
  assert.match(source, /onTabDragOverStudy: \(groupId: string \| null\) => void;/);
  const promote = section("const handlePromoteTab", "const handleReorderTab");
  assert.match(promote, /await runApprovedIntent\([\s\S]{0,120}onPromoteTab\(tabId\)/);
  assert.match(promote, /scheduleCommittedTabFocus\(tabId, true\)/);
  /* `onToggleGroup` was here and went on 2026-07-30 with the collapse gesture.
     Folding a study got its tabs out of the strip; the strip holds one study's
     tabs by construction now, so nothing in the register reads `collapsed` and
     no surface offered a control whose only effect was writing it. The field
     and `toggleStudyWorkspaceGroup` stay in the model, persisted and unread. */
  assert.doesNotMatch(statementsOnly(source), /onToggleGroup/);

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

  const closeGroup = section("const handleCloseGroup", "const handleRenameGroup");
  assert.match(closeGroup, /await runApprovedIntent\([\s\S]{0,120}onCloseGroup\(groupId\)/);
  assert.match(closeGroup, /setOverflowOpen\(false\)/);
  assert.match(closeGroup, /scheduleCommittedTabFocus/);
});

test("the strip's one gesture is a selection, and the keyboard reaches the same handler", () => {
  /* THIS TEST WAS ABOUT COLLAPSE and it is rewritten, 2026-07-30, because the
     gesture it guarded is retired rather than moved. It read

       const toggle = section("const toggleGroup", "const handleTabAuxClick");
       assert.match(toggle, /await runApprovedIntent\([\s\S]{0,120}onToggleGroup\(groupId, collapsing\)/);
       assert.doesNotMatch(toggle, /setCollapsedGroups/);
       assert.doesNotMatch(toggle, /onSelect\(/);

     — collapse as one approved group intent, never a local state, never a
     selection in disguise. All three were true and all three are moot: the
     register holds one study's tabs, so folding a study has nothing to get out
     of the row, and `toggleGroup` is gone from this component.

     What is left is the claim underneath it, which is stronger and was never
     asserted: pressing a tab does ONE thing. Two branches used to stand in
     front of the selection — expand-then-select on a collapsed proxy, and
     press-the-tab-you-are-on to fold its study — and the keyboard could reach
     neither until the morning of the same day. There is one outcome now and
     both devices arrive at it. */
  assert.doesNotMatch(statementsOnly(source), /toggleGroup|collapsedProxy|data-study-collapsed-proxy/,
    "the strip does not fold a study, so it has no proxy and no toggle");

  const keyboard = section("const handleTabKeyDown", "const deferMouseFocus");
  assert.match(keyboard, /async/);
  assert.match(keyboard, /await handleCloseTab\(tabId/);
  assert.doesNotMatch(
    keyboard.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    /event\.key === "Enter"|event\.key === " "/,
    "intercepting Enter or Space cancels the button's own click, which is the commit path",
  );
  assert.match(source, /const byKeyboard = event\.detail === 0;/);
  assert.match(keyboard, /setFocusedTabId\(next\)/);
  assert.doesNotMatch(keyboard, /await handleSelectTab\(next/);

  // Middle-click still closes a tab, and there is no longer a kind of tab it
  // must refuse: the guard existed because one tab could stand for a study.
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
  // This used to require `handleSelectTab(tab.id, { moveFocus: true })` — an
  // unconditional programmatic focus, which defeated the deferral this test is
  // named for. `deferMouseFocus` cancels the browser's own mousedown focus, so
  // that call was the FIRST focus the tab received, and Chromium marks a
  // programmatic focus `:focus-visible` when no pointer focus preceded it. A
  // pointer press drew a keyboard ring.
  //
  // Deferring focus and then taking it a frame later is not deferring it. The
  // keyboard still needs focus to travel, so it is gated on activation: a
  // pointer click reports a click count, Enter and Space synthesise one with
  // none.
  assert.match(source, /const byKeyboard = event\.detail === 0;/);
  assert.match(source, /handleSelectTab\(tab\.id, \{ moveFocus: byKeyboard \}\)/);
  assert.doesNotMatch(source, /handleSelectTab\(tab\.id, \{ moveFocus: true \}\)/,
    "an unconditional focus move is the ring this test exists to prevent");
  assert.doesNotMatch(statementsOnly(source), /toggleGroup/);
});

test("the APG tablist exposes only tabs while group management stays in the adjacent toolbar", () => {
  const tablist = section(
    'role="tablist"',
    '<div className="scripture-workspace-actions"',
  );

  assert.doesNotMatch(tablist, /role="group"/);
  assert.doesNotMatch(tablist, /scripture-workspace-group-toggle/);
  // Tabs must rove (never a hardcoded -1); the in-strip collapse control is a
  // deliberate non-roving stop, so scope the check to role="tab".
  assert.doesNotMatch(tablist, /role="tab"[^>]*tabIndex=\{-1\}/);
  assert.match(
    source,
    /<div className="scripture-workspace-actions" role="toolbar" aria-label="Study tab controls">/,
  );
  assert.match(source, /tabIndex={roving \? 0 : -1}/);
  /* The model-wide visible list is still computed — it is what the exit ghosts
     diff against, and a study leaving the strip because the reader switched
     studies is not a tab closing — but the roving stop and the arrows read
     `stripTabIds`, which is what the strip is SHOWING. A roving stop naming a
     tab in a hidden study leaves the tablist with no tabIndex=0 element at all
     and drops it out of the Tab order. */
  /* This required `visibleStudyWorkspaceTabIds(workspace)` — the model-wide
     list that folds each collapsed study down to one proxy. The strip holds one
     study's tabs and nothing folds, so that selector has no reader here. Two
     lists remain and each has one job: `stripTabIds` is what the strip shows,
     which is what the roving stop and the arrows must travel, and the register
     ids are the whole workspace, which is what the exit ghosts diff against so
     that changing study is not mistaken for a row of tabs closing. */
  assert.doesNotMatch(statementsOnly(source), /visibleStudyWorkspaceTabIds/);
  assert.match(source, /studyWorkspaceRovingTabId\(stripTabIds, workspace\.activeTabId\)/);
  assert.match(source, /const registerTabIds = useMemo\(\(\) => studyWorkspaceRegisterTabIds\(workspace\), \[workspace\]\)/);
});

test("every study keeps a keyboard-reachable close in the overview, without requiring the strip", () => {
  /* `groups.length` became `allGroups.length` on 2026-07-30: the strip filters
     to the study the page is in, so `groups` is the RENDERED run and
     `allGroups` is the workspace. The control that opens the surface holding
     every study has to be gated on the workspace having studies, not on the
     strip happening to show any.

     The collapse half of this test went the same day. It read

       assert.match(groupManagement, /aria-expanded=\{!group\.collapsed\}/);
       assert.match(groupManagement, /await toggleGroup\(group\.id, !group\.collapsed, event\.currentTarget\)/);

     and a toggle whose only effect is a field nobody reads is worse than a
     missing one: a reader presses it, nothing happens, and they conclude the
     app is broken. Close is what remains, and it is the action that needed the
     overview in the first place — a study you are not in has no other door. */
  assert.match(source, /\(allGroups\.length > 0 \|\| hasMeasuredOverflow\)/);

  const groupManagement = section(
    '<section className="scripture-workspace-overflow-group"',
    '</section>',
  );
  assert.doesNotMatch(groupManagement, /data-study-group-collapse|group\.collapsed/);
  assert.match(groupManagement, /canCloseGroup && \(/);
  assert.match(groupManagement, /await handleCloseGroup\(group\.id\)/);
  assert.match(groupManagement, /data-study-group-rename/);
});

test("close affordances expose direct and decision actions but never unavailable actions", () => {
  assert.match(source, /const canClose = closeAvailability !== "unavailable"/);
  assert.match(source, /const canCloseGroup = groupCloseAvailability !== "unavailable"/);
  assert.match(source, /const canClose = tabCloseAvailability !== "unavailable"/);
  assert.match(source, /confirmation required/);
  assert.match(source, /aria-keyshortcuts={canClose \? "Delete" : undefined\}/);
  assert.match(source, /canClose && \([\s\S]{0,220}?data-workspace-tab-close/);
  /* A line here read
       assert.match(source, /collapsedProxy[\s\S]{0,180}?handleCloseGroup\(group\.id\)/);
     — closing a collapsed study's proxy closed the whole study, which was the
     only honest reading of an × on a tab standing for six. There are no
     proxies, so an × on a tab closes that tab, and closing a STUDY is the
     overview's, where the thing being closed is named. */
  assert.doesNotMatch(statementsOnly(source), /collapsedProxy/);
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

test("nothing in the renderer writes a study's collapsed field any more", () => {
  /* This asserted the shape of `toggleWorkspaceGroup` in app.tsx — that it
     delegated to `toggleStudyWorkspaceGroup` and never re-selected, so that
     folding the study you were reading kept your tab as its proxy. True while
     folding was a gesture; the gesture is retired on 2026-07-30 and the handler
     with it.

     `collapsed` STAYS in StudyWorkspaceStateV2 and stays persisted: the model
     and the Electron validator are untouched, a workspace saved with a folded
     study still round-trips, and `toggleStudyWorkspaceGroup` still carries its
     exclusivity ruling in the model, unread. What may not come back without a
     surface to justify it is a renderer path that writes the field. */
  assert.doesNotMatch(statementsOnly(appSource), /toggleWorkspaceGroup|toggleStudyWorkspaceGroup/);
  assert.doesNotMatch(statementsOnly(appSource), /onWorkspaceGroupToggle/);
});
