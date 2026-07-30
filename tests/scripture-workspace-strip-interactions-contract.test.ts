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

test("Enter and Space reach the tab's one commit path, and there is only one", () => {
  /* TWO CLAIMS HAVE BEEN RETIRED HERE IN TWO DAYS, and the second retirement
     is what made the first one moot.

     It began as "Enter/Space are the only commit path from the keyboard",
     pinning

       assert.match(keyboard,
         /event\.key === "Enter" \|\| event\.key === " "[\s\S]{0,120}handleSelectTab\(tabId/)

     — accurate about the code and hiding a defect: that branch called
     `preventDefault()` and then `handleSelectTab`, so it cancelled the button's
     own synthesized click AND made a plain selection the only thing a key could
     do. The tab's click handler had three outcomes and the keyboard reached one.

     It became a PARITY claim on 2026-07-30 — the commit path is the click
     handler, and both devices reach it — which was right, and which is now the
     whole story rather than half of it: the other two outcomes are gone. The
     register holds one study's tabs, so there is no proxy to expand and nothing
     for a fold to hide. A tab press selects a tab, from either device.

     What is asserted is the shape that guarantees it: the keydown handler does
     not touch Enter or Space, so a button activates itself, and the one click
     handler tells the devices apart only to decide whether focus travels. */
  const keyboardStatements = (() => {
    const start = statements.indexOf("const handleTabKeyDown");
    return statements.slice(start, statements.indexOf("const deferMouseFocus", start));
  })();
  assert.ok(keyboardStatements.length > 0, "handleTabKeyDown must still exist");
  assert.doesNotMatch(keyboardStatements, /event\.key === "Enter"|event\.key === " "|Spacebar/,
    "intercepting Enter/Space cancels the click that is the commit path");
  // Delete/Backspace still belong to the keydown handler: no default action of
  // the button's does what they do, so there is nothing to route through.
  assert.match(keyboardStatements, /event\.key === "Delete" \|\| event\.key === "Backspace"/);

  const tablist = section('role="tablist"', "{/* The new-tab plus, against the last tab");
  assert.match(tablist, /const byKeyboard = event\.detail === 0;/);
  assert.match(tablist, /await handleSelectTab\(tab\.id, \{ moveFocus: byKeyboard \}\);/);
  const tablistStatements = (() => {
    const start = statements.indexOf('role="tablist"');
    return statements.slice(start, statements.indexOf("scripture-workspace-actions", start));
  })();
  assert.doesNotMatch(tablistStatements, /toggleGroup|collapsedProxy/,
    "a tab press selects a tab; the two branches in front of that are retired");
  assert.equal([...tablistStatements.matchAll(/await handleSelectTab\(/g)].length, 1,
    "one commit path, reached two ways");
});

test("middle-click closes the tab under the pointer, and every tab is one tab", () => {
  /* This was "a collapsed proxy ignores middle-click while tabs keep
     middle-click-close", pinning

       assert.match(aux, /if \(collapsedProxy\) \{[\s\S]{0,80}return;/);

     — a guard that existed because one tab could stand for a whole study, so
     middle-clicking it would have closed six tabs with a gesture that closes
     one. There are no proxies as of 2026-07-30: the strip holds one study's
     tabs, so nothing folds, so no tab stands for anything but itself. The
     guard is retired and the claim it protected is now structural. */
  const aux = section("const handleTabAuxClick", "const handleTabKeyDown");
  assert.match(aux, /if \(event\.button !== 1\) return;/);
  assert.match(aux, /await handleCloseTab\(tabId/);
  assert.doesNotMatch(
    aux.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    /collapsedProxy/,
  );
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

test("the strip has no gesture that hides a tab, so it needs none that un-hides one", () => {
  /* THIS FILE EXISTED FOR THIS TEST, and the pair it was written about is gone.

     The claim was "collapsing a study in the strip has an inverse in the strip":
     press the tab you are already on and its study folds; press the proxy that
     replaces it and the study comes back. It was made on 2026-07-30 to fix a
     real defect — the kicker that collapsed a study only rendered while the
     study was expanded, so a press had no inverse — and it survived the kicker's
     removal by moving onto the tab and its proxy.

     The register holds one study's tabs as of 2026-07-30. Folding was a way of
     getting a study's tabs out of a row that held several studies; the row holds
     one study by construction now, so there is nothing to fold away from and no
     proxy to fold into. Both halves of the pair are retired together, which is
     the only honest way to retire a pair.

     The claim is therefore stated as the absence: nothing in the strip hides a
     tab. A press selects, an × closes, a drag reorders, and every tab in the
     row is one tab. `collapsed` stays in the model and stays persisted; no
     renderer path reads or writes it. */
  const tablistStatements = (() => {
    const start = statements.indexOf('role="tablist"');
    return statements.slice(start, statements.indexOf("scripture-workspace-actions", start));
  })();
  assert.doesNotMatch(tablistStatements, /collapsed|toggleGroup|data-study-collapsed-proxy/,
    "no tab in the strip stands for more than itself");
  assert.doesNotMatch(statements, /kind: "group"/,
    "the proxy's group menu had exactly one trigger, and it was the proxy");
  // And the one gesture that remains says what it does.
  assert.match(tablistStatements, /await handleSelectTab\(tab\.id, \{ moveFocus: byKeyboard \}\);/);
});

test("the All Tabs popover lists every retained recently-closed item with a reopen action", () => {
  const overflow = section("{overflowOpen && overflowAnchor", "{contextMenu &&");
  assert.match(overflow, /data-study-recent-list/);
  assert.match(overflow, /recentlyClosedList\.map/);
  assert.match(overflow, /data-study-recent-item/);
  assert.match(overflow, /await handleReopenRecentItem\(index\)/);
});
