import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  studyWorkspaceDragReorderPosition,
  studyWorkspaceWheelScrollDelta,
} from "../src/renderer/components/ScriptureWorkspaceTabs.js";
import {
  closeStudyWorkspaceTab,
  createStudyWorkspace,
  openPassageWorkspaceTab,
  reopenClosedStudyItem,
  reopenClosedStudyItemAt,
  type PassageViewState,
} from "../src/renderer/utils/studyWorkspace.js";

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

/**
 * This component records a retirement by quoting the code that was retired, so
 * any "this is not here any more" check has to read statements only — otherwise
 * it passes on the very note that proves the branch is gone, which is how a
 * dead keyboard path went a day without being noticed.
 */
const statements = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

function view(book: string, chapter: number): PassageViewState {
  return {
    book,
    chapter,
    packageId: "BSB",
    verse: 1,
    verseOffset: 0,
    scrollTop: 0,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: {},
      wordsFollowingReading: true,
    },
  };
}

test("drag reorder position maps a drop slot to one legal in-group move", () => {
  const ids = ["a", "b", "c", "d"];
  // Dropping onto its own slot (or the slot just after removal) is a no-op.
  assert.equal(studyWorkspaceDragReorderPosition(ids, "a", 0), null);
  assert.equal(studyWorkspaceDragReorderPosition(ids, "b", 1), null);
  assert.equal(studyWorkspaceDragReorderPosition(ids, "b", 2), null);
  // Extremes resolve to the exact end-stops.
  assert.equal(studyWorkspaceDragReorderPosition(ids, "a", 4), "end");
  assert.equal(studyWorkspaceDragReorderPosition(ids, "d", 0), "start");
  // Interior drops resolve to a single directional step.
  assert.equal(studyWorkspaceDragReorderPosition(ids, "a", 2), "right");
  assert.equal(studyWorkspaceDragReorderPosition(ids, "d", 2), "left");
  assert.equal(studyWorkspaceDragReorderPosition(ids, "b", 3), "right");
  // A tab that is not part of the ordering never reorders.
  assert.equal(studyWorkspaceDragReorderPosition(ids, "missing", 0), null);
});

test("vertical wheel is translated to horizontal scroll only when the strip overflows", () => {
  assert.equal(studyWorkspaceWheelScrollDelta(0, 40, true), 40);
  assert.equal(studyWorkspaceWheelScrollDelta(5, -30, true), -30);
  // No overflow, horizontal intent, or zero travel must all stay native.
  assert.equal(studyWorkspaceWheelScrollDelta(0, 40, false), null);
  assert.equal(studyWorkspaceWheelScrollDelta(40, 10, true), null);
  assert.equal(studyWorkspaceWheelScrollDelta(10, 10, true), null);
  assert.equal(studyWorkspaceWheelScrollDelta(0, 0, true), null);
});

test("recently-closed entries reopen by index while the button keeps the most recent", () => {
  const initial = createStudyWorkspace(view("ACT", 19), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const withJohn = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "acts-19",
    view: view("JHN", 3),
  }).state;
  const withRomans = openPassageWorkspaceTab(withJohn, {
    id: "rom-8",
    sourceTabId: "john-3",
    view: view("ROM", 8),
  }).state;
  const afterFirstClose = closeStudyWorkspaceTab(withRomans, "john-3");
  assert.equal(afterFirstClose.outcome, "applied");
  const afterSecondClose = closeStudyWorkspaceTab(afterFirstClose.state, "rom-8");
  assert.equal(afterSecondClose.outcome, "applied");
  const populated = afterSecondClose.state;
  // Stored oldest-first: [john-3, rom-8].
  assert.equal(populated.recentlyClosed.length, 2);

  // Reopening the older index restores john-3 and leaves rom-8 recoverable.
  const olderReopened = reopenClosedStudyItemAt(populated, 0);
  assert.equal(olderReopened.outcome, "opened");
  assert.ok(olderReopened.state.tabsById["john-3"]);
  assert.ok(!olderReopened.state.tabsById["rom-8"]);
  assert.equal(olderReopened.state.recentlyClosed.length, 1);

  // The strip button (no index) reopens the most recent instead.
  const recentReopened = reopenClosedStudyItem(populated);
  assert.equal(recentReopened.outcome, "opened");
  assert.ok(recentReopened.state.tabsById["rom-8"]);
  assert.ok(!recentReopened.state.tabsById["john-3"]);

  // Out-of-range indices are inert.
  assert.equal(reopenClosedStudyItemAt(populated, 5).outcome, "unchanged");
  assert.equal(reopenClosedStudyItemAt(populated, -1).outcome, "unchanged");
});

test("arrow keys move roving focus without committing a transition", () => {
  const keyboard = section("const handleTabKeyDown", "const deferMouseFocus");
  // Arrows/Home/End only move the roving focus stop.
  assert.match(keyboard, /ArrowRight[\s\S]{0,900}setFocusedTabId\(next\)/);
  assert.doesNotMatch(keyboard, /ArrowRight[\s\S]{0,900}handleSelectTab/);
  // aria-selected reflects the active tab, never the roving focus.
  assert.match(source, /aria-selected=\{selected\}/);
  assert.match(source, /tabIndex=\{roving \? 0 : -1\}/);
  assert.match(source, /effectiveRovingTabId === tab\.id/);
});

test("Enter and Space reach the tab's one commit path, collapse and expand included", () => {
  /* THIS REPLACES A CLAIM THAT WAS TRUE OF THE CODE AND FALSE OF THE PRODUCT,
     2026-07-30. The line that stood here was

       assert.match(keyboard,
         /event\.key === "Enter" \|\| event\.key === " "[\s\S]{0,120}handleSelectTab\(tabId/)

     under the comment "Enter/Space are the only commit path from the keyboard".
     Both halves were accurate and together they hid a defect: that branch
     called `preventDefault()` and then `handleSelectTab`, so it cancelled the
     button's own synthesized click AND made the plain selection the only thing
     a key could do. The tab's click handler has three outcomes — collapse the
     study when the tab is already active, expand-then-select on a collapsed
     study's proxy, select otherwise — and the keyboard could reach exactly one
     of them. Enter on the tab you are already on did nothing at all, because
     the select it routed to early-returns on the active tab.

     The keydown handler no longer touches Enter or Space. A button activates on
     both by itself, so the keyboard arrives at the same handler the pointer
     does and the three outcomes are one set rather than two. The claim is
     therefore stated as parity — the commit path is the tab's click handler and
     both devices reach it — rather than as the shape of a branch. */
  const keyboardStatements = (() => {
    const start = statements.indexOf("const handleTabKeyDown");
    return statements.slice(start, statements.indexOf("const deferMouseFocus", start));
  })();
  assert.ok(keyboardStatements.length > 0, "handleTabKeyDown must still exist");
  assert.doesNotMatch(keyboardStatements, /event\.key === "Enter"|event\.key === " "|Spacebar/,
    "intercepting Enter/Space cancels the click that carries collapse and expand");
  // Delete/Backspace still belong to the keydown handler: no default action of
  // the button's does what they do, so there is nothing to route through.
  assert.match(keyboardStatements, /event\.key === "Delete" \|\| event\.key === "Backspace"/);

  // And the click handler is where all three outcomes live, keyed on whether a
  // keyboard sent the click so focus travels for it and not for the pointer.
  const tablist = section('role="tablist"', "{/* The new-tab plus, against the last tab");
  assert.match(tablist, /const byKeyboard = event\.detail === 0;/);
  assert.match(tablist, /if \(collapsedProxy\) \{\s*await toggleGroup\(group\.id, false, byKeyboard \? trigger : undefined\);/);
  assert.match(tablist, /if \(selected\) \{\s*await toggleGroup\(group\.id, true, byKeyboard \? trigger : undefined\);/);
  assert.match(tablist, /await handleSelectTab\(tab\.id, \{ moveFocus: byKeyboard \}\);/);
});

test("a collapsed proxy ignores middle-click while tabs keep middle-click-close", () => {
  const aux = section("const handleTabAuxClick", "const handleTabKeyDown");
  assert.match(aux, /if \(collapsedProxy\) \{[\s\S]{0,80}return;/);
  assert.match(aux, /await handleCloseTab\(tabId/);
});

test("pointer drag is thresholded and paints a lift plus a drop indicator", () => {
  assert.match(source, /const DRAG_THRESHOLD_PX = 4/);
  assert.match(source, /onPointerDown=\{\(event\) => handleTabPointerDown/);
  assert.match(source, /onPointerMove=\{\(event\) => handleTabPointerMove/);
  assert.match(source, /onPointerUp=\{\(event\) => handleTabPointerUp/);
  assert.match(source, /Math\.hypot\(event\.clientX - origin\.x, event\.clientY - origin\.y\) < DRAG_THRESHOLD_PX/);
  assert.match(source, /studyWorkspaceDragReorderPosition\(orderedIds, tabId, origin\.insertionIndex\)/);
  assert.match(source, /dragging \? " is-dragging" : ""/);
  assert.match(source, /data-study-drop=\{dropBefore \? "before" : dropAfter \? "after" : undefined\}/);
  // A plain click below the threshold is never swallowed as a drag.
  assert.match(source, /suppressTabClickRef/);
});

test("the strip owns wheel panning, double-click new tab, and pointer context menus", () => {
  // Non-passive wheel listener so preventDefault actually pans the strip.
  assert.match(source, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(source, /viewport\.scrollLeft \+= delta/);
  // Double-click on empty strip space opens a new tab via onNewResearch.
  assert.match(source, /onDoubleClick=\{handleViewportDoubleClick\}/);
  assert.match(source, /const handleViewportDoubleClick[\s\S]{0,200}onNewResearch\(\)/);
  // Right-click surfaces context menus for tabs, groups, and empty space.
  assert.match(source, /onContextMenu=\{handleViewportContextMenu\}/);
  assert.match(source, /data-study-context-menu=\{contextMenu\.target\.kind\}/);
  assert.match(source, />Close others in this study</);
  assert.match(source, />Duplicate tab</);
  assert.match(source, /Move to study…/);
  assert.match(source, />Open new tab</);
  assert.match(source, />Reopen closed tab</);
});

test("collapsing a study in the strip has an inverse in the strip", () => {
  const tablist = section('role="tablist"', "{/* The new-tab plus, against the last tab");

  /* THE KICKER IS GONE FROM THE STRIP, 2026-07-29, and this test survives it.
     Two assertions died with it — that the strip contains a
     .scripture-workspace-group-tab, and that its toggle reads
     `!group.collapsed` rather than a literal. Both were about the kicker being
     a two-way control, and there is no kicker here now: the switcher is in the
     rail and collapse, rename and close are in the group's context menu.

     What the test is FOR is untouched, and is the whole of what remains:
     collapsing from the strip must have its inverse in the strip. Pressing the
     tab you are already on folds the study; pressing the proxy that replaces it
     unfolds. That pair is asserted below, and it is the pair that made this
     file necessary in the first place. */
  // This used to assert `await toggleGroup(group.id, true, event.currentTarget)`
  // — the literal `true` that made the kicker collapse-only. That was the whole
  // defect: the kicker renders only while a study is expanded, so once collapsed
  // there was nothing left in the strip to press, and expanding was reachable
  // only from the group menu. A press had no inverse.
  //
  // Two assertions replace it, and neither is the old one weakened. The kicker
  // reads the state rather than assuming it, and the collapsed proxy — the one
  // element standing for a collapsed study — expands before it selects.

  // The blanket ban on a literal `true` that stood here was too broad, and this
  // is the distinction it was missing. A hardcoded direction is a defect on a
  // control whose direction depends on state — the kicker — and is correct on
  // one that only ever goes one way. Pressing the tab you are already on always
  // collapses; its inverse is pressing the proxy that replaces it. So the
  // literal is allowed exactly once, and only behind the `selected` guard that
  // makes it one-way.
  const literalCollapses = [...tablist.matchAll(/toggleGroup\(group\.id, true\b/g)];
  assert.equal(literalCollapses.length, 1,
    "only the already-selected tab may collapse in a fixed direction");
  // Unconditional, and two earlier attempts to condition it are recorded here
  // because the pattern is the lesson. First `group.tabIds.length > 1`, then
  // `|| group.label.kind === "custom"` — each an attempt to predict which folds
  // would look worth doing. Both made one gesture behave differently depending
  // on state the reader is not thinking about, which is a worse defect than a
  // fold that happens to be subtle. A gesture that works sometimes reads as
  // broken; a subtle one only reads as subtle.
  assert.match(tablist, /if \(selected\) \{\s*await toggleGroup\(group\.id, true,/,
    "pressing the active tab folds its study, with no qualifying condition");
  assert.doesNotMatch(tablist, /selected && (group\.tabIds\.length|foldIsVisible|group\.label)/,
    "conditioning the fold on group shape is what made it feel unreliable");
  // The trigger is handed over only for keyboard activation, for the same
  // reason the selection's focus move is: focusing it after a pointer press is
  // what drew a ring the reader never asked for.
  assert.match(tablist, /if \(collapsedProxy\) \{\s*await toggleGroup\(group\.id, false, byKeyboard \? trigger : undefined\);/);
  /* The group's own menu — collapse, rename, close — is reached from the
     collapsed proxy, which IS the study while it is folded. It used to be on
     the kicker as well; with the kicker gone this is the strip's only route to
     it, so the assertion moved from the kicker's call to the proxy's ternary.
     An expanded study's members reach the tab menu, which carries "Rename
     study" and "Move to study…" of its own. */
  assert.match(
    tablist,
    /collapsedProxy\s*\?\s*\{ kind: "group", groupId: group\.id \}\s*:\s*\{ kind: "tab"/,
    "a folded study must still open its own menu from the strip",
  );
  // The last line used to read `title={expandedGroupLabel}`, naming the local
  // that existed only while the group label was a bracket anchored to the first
  // member's wrap. Rev 05 §05·2 makes the label a kicker of its own at the head
  // of the members, so the label it titles itself with is the group's, full
  // stop. What the test protects — that the in-strip label is a real control
  // with a real name, not decoration — is unchanged.
  /* `title={groupLabel}` was the kicker's, and went with it. The collapsed
     proxy carries the study's name now and is the only in-strip element that
     names a study at all — asserted where the proxy is, above. */
});

test("the All Tabs popover lists every retained recently-closed item with a reopen action", () => {
  const overflow = section("{overflowOpen && overflowAnchor", "{contextMenu &&");
  assert.match(overflow, /data-study-recent-list/);
  assert.match(overflow, /recentlyClosedList\.map/);
  assert.match(overflow, /data-study-recent-item/);
  assert.match(overflow, /await handleReopenRecentItem\(index\)/);
});
