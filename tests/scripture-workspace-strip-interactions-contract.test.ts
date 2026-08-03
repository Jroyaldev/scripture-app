import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  studyDropTargetId,
  studyWorkspaceDragShuffle,
  studyWorkspaceDragReorderPosition,
  studyWorkspaceWheelScrollDelta,
} from "../src/renderer/components/ScriptureWorkspaceTabs.js";
import {
  closeStudyWorkspaceTab,
  createStudyWorkspace,
  openEntityWorkspaceTab,
  openPassageWorkspaceTab,
  reopenClosedStudyItem,
  reopenClosedStudyItemAt,
  studyWorkspaceTabPromoteAvailability,
  type PassageViewState,
} from "../src/renderer/utils/studyWorkspace.js";

const source = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScriptureWorkspaceTabs.tsx"),
  "utf8",
);
/* Both sheets, because the register's drag rules live in two files: styles.css
   declares them and styles/register.css overrode the retired insertion rule to
   repaint it gold. A "this is gone" check that read only one of them would pass
   on the half that was deleted. */
const styles = readFileSync(resolve(import.meta.dirname, "../src/renderer/styles.css"), "utf8")
  + readFileSync(resolve(import.meta.dirname, "../src/renderer/styles/register.css"), "utf8");

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

test("pointer drag is thresholded, and the run itself opens the slot", () => {
  const onMoveHandler = section("const handleTabPointerMove", "const handleTabPointerUp");
  assert.match(source, /const DRAG_THRESHOLD_PX = 4/);
  assert.match(source, /onPointerDown=\{\(event\) => handleTabPointerDown/);
  assert.match(source, /onPointerMove=\{\(event\) => handleTabPointerMove/);
  assert.match(source, /onPointerUp=\{\(event\) => handleTabPointerUp/);
  assert.match(source, /Math\.hypot\(event\.clientX - origin\.x, event\.clientY - origin\.y\) < DRAG_THRESHOLD_PX/);
  assert.match(source, /studyWorkspaceDragReorderPosition\(orderedIds, tabId, origin\.insertionIndex\)/);
  assert.match(source, /dragging \? " is-dragging" : ""/);

  /* THE RUN ANSWERS, RATHER THAN A RULE BETWEEN TWO TABS · 2026-08-03.
     This pinned `data-study-drop={dropBefore ? "before" : dropAfter ? "after"
     : undefined}` — a 2px seal hairline at a wrap's edge, from B2. The
     maintainer read it as what it looks like: "a rather ugly random vertical
     line", with nothing responding to the hand that summoned it. A rule is a
     LABEL for a decision; a run that moves IS the decision. Pass a neighbour's
     middle and it steps aside, and the gap that opens is the slot.

     What replaces the pin is the arithmetic, tested directly below, and the
     three properties that keep it honest. */
  assert.doesNotMatch(source, /data-study-drop=/, "the insertion rule is gone from the render");
  assert.doesNotMatch(styles, /\[data-study-drop="(?:before|after)"\]/,
    "and from the sheet — both of them, since register.css repainted it gold");

  /* THE RUN IS MEASURED ONCE, at the threshold. Measuring live would measure
     the consequence of the previous frame — a sibling that has stepped aside is
     no longer where the layout put it — which is a feedback loop, not a
     measurement, and it reads as tabs shuddering under the pointer. */
  assert.match(onMoveHandler, /origin\.slots = \(entry\?\.tabs \?\? \[\]\)\.flatMap/);

  /* AND THE BAND IS SNAPSHOTTED WITH IT. Whether the pointer has left the row is
     the whole of the reorder/carry distinction, and the bar does not move under
     a drag — asking it every frame would be a layout read per frame for an
     answer that cannot change. */
  assert.match(onMoveHandler, /origin\.band = \{ top: rect\.top - CARRY_SLACK_PX, bottom: rect\.bottom \+ CARRY_SLACK_PX \};/);
  assert.match(onMoveHandler, /origin\.draggedIndex = origin\.slots\.findIndex/);
  assert.match(onMoveHandler, /held\.left \+ \(event\.clientX - origin\.x\) \+ held\.width \/ 2/,
    "the dragged centre comes from the snapshot plus pointer travel, never its live rect");

  /* AND THE STRIP RENDERS ONLY WHEN THE SLOT CHANGES. It used to build a fresh
     state object every pointermove, so every frame re-rendered the whole strip —
     676 rows in a long study, to move one tab — which is the cost the
     `--tab-drag-x` write exists to avoid, paid anyway one line later. The tab's
     travel stays imperative and touches one node; which slot the pointer is in
     changes a handful of times in a whole gesture. */
  assert.match(onMoveHandler, /if \(phase === settledPhase\s*&& studyId === settledStudyId\s*&& insertionIndex === settledIndex\) return;/);
  /* TWO GESTURES WEARING ONE POINTER. In the row a tab is being placed among its
     siblings and the run answers by opening a slot; off the row it is being
     TAKEN somewhere, the run closes back up, and what the reader is holding
     rides the cursor. A pointer over a study target is carrying by definition. */
  assert.match(onMoveHandler, /\? "carry"\s*: "reorder";/);
  assert.match(onMoveHandler, /if \(phase !== settledPhase\) \{/);
  assert.match(source, /onTabDragPhase\("reorder", origin\.tabId\);/,
    "the tab travels with the phase: the study control asks the model whether it could found a study with it");
  assert.match(source, /if \(origin\?\.started\) onTabDragPhase\(null, null\);/);

  assert.match(source, /insertionIndex: -1,/,
    "-1, because 0 is a real slot and a first frame landing on it must still paint");

  /* THE TRANSITION EXISTS ONLY WHILE A DRAG DOES. A wrap carries a 150ms
     entrance animation on mount, and a transform transition declared at rest
     would run against it every time a tab opens — two motions on one property.
     Reduced motion still reaches it through the wrap rule it already kills. */
  assert.match(source, /data-drag-live=\{dragState \? "" : undefined\}/);
  assert.match(styles, /\.scripture-workspace-viewport\[data-drag-live\] \.scripture-workspace-tab-wrap \{\s*transform: translateX\(var\(--tab-shift, 0px\)\);\s*transition: transform var\(--transition-normal\);/);

  /* A SIBLING STEPS BY A POSITIONAL DELTA, never a tab width. Tabs are 2px
     apart except across the SELECTED one, which carries 14px of fillet margin on
     each side and drops the start side at [data-flush-start] — so a run's gaps
     are genuinely uneven and a constant would land a tab between two slots. */
  const runToSlotTwo = studyWorkspaceDragShuffle(
    [{ id: "a", left: 0, width: 100 }, { id: "b", left: 102, width: 100 }, { id: "c", left: 230, width: 100 }],
    0,
    300,
  );
  assert.deepEqual([...runToSlotTwo.shifts], [["b", -102], ["c", -128]],
    "each sibling steps to the position the one before it is giving up");
  assert.equal(runToSlotTwo.insertionIndex, 3);
  const stayPut = studyWorkspaceDragShuffle(
    [{ id: "a", left: 0, width: 100 }, { id: "b", left: 102, width: 100 }],
    0,
    60,
  );
  assert.equal(stayPut.shifts.size, 0, "under half way is not a move");
  /* ONE, NOT ZERO, and the difference is the whole reason the conversion is on
     this side. `insertionIndex` is "insert before index i in the run as it
     stands, dragged tab included" — so a tab at slot 0 that has not moved is
     inserted before slot 1. `studyWorkspaceDragReorderPosition` subtracts the
     one back off and returns null, which is the no-op this is. A shuffle that
     redefined that argument would be a change to reordering wearing a drop
     indicator's clothes. */
  assert.equal(stayPut.insertionIndex, 1);
  assert.equal(
    studyWorkspaceDragReorderPosition(["a", "b"], "a", stayPut.insertionIndex),
    null,
    "and the helper it feeds reads that as staying put",
  );
  const leftward = studyWorkspaceDragShuffle(
    [{ id: "a", left: 0, width: 100 }, { id: "b", left: 102, width: 100 }],
    1,
    40,
  );
  assert.deepEqual([...leftward.shifts], [["a", 102]], "and it works in the other direction");
  assert.equal(leftward.insertionIndex, 0);

  /* THE LAST OF THE DISTANCE IS TRAVELLED, not skipped. A drop commits a
     reorder and React re-lays the run out; without this the tab vanishes from
     under the pointer and reappears in its slot, in the one frame where the app
     knows exactly where the reader is looking. */
  assert.match(source, /settleRef\.current = \{ tabId: origin\.tabId, left: wrap\.getBoundingClientRect\(\)\.left \};/);
  assert.match(source, /wrap\.classList\.add\("is-settling"\);/);
  assert.match(styles, /\.scripture-workspace-tab-wrap\.is-settling \{\s*transform: translateX\(var\(--tab-drag-x, 0px\)\);/,
    "the settle must RESTATE the transform: .is-dragging has already been taken off by the time it runs");
  assert.match(source, /const fallback = window\.setTimeout\(done, 400\);/,
    "transitionend does not fire on a coalesced recalc, and a stranded class carries a transition into every later layout");
  /* A PICKED-UP TAB TRAVELS WITH THE POINTER · 2026-08-03. It used to sit still
     at `opacity: .55`, which said the wrong thing twice: half opacity is this
     app's idiom for DISABLED, and a tab that does not move while the pointer
     does is not being dragged. The offset is written straight onto the node
     because a pointer move fires every frame and a state update per frame
     re-renders every tab in the strip to move one of them. */
  assert.match(source, /dragged\.style\.setProperty\("--tab-drag-x", `\$\{event\.clientX - origin\.x\}px`\)/);
  assert.match(source, /data-drag-away=\{\(dragging && overStudy\) \|\| undefined\}/);
  // A plain click below the threshold is never swallowed as a drag.
  assert.match(source, /suppressTabClickRef/);
});

test("a drag that reaches a study is asking for a study, not for a slot", () => {
  /* THE SECOND AUTHORING GESTURE. The studies are in another component and the
     drag cannot be handed to them: it sets pointer capture on the tab so it
     survives leaving the strip, and a captured pointer routes every event to the
     capturing element — a target never sees one. So the strip hit-tests the
     document it can see, and reports what it found.

     RESTATED 2026-08-03 with the move off the drag band. The targets used to be
     a row of chips above the strip and are now the rows of the study control's
     own list, which opens for the length of a drag precisely so that they exist
     to be dropped on. Nothing about the mechanism changed, and the attribute is
     why: what is hit-tested is "a thing that stands for a study", never "a chip
     in a row". The rename from `data-study-line-chip` to `data-study-target` is
     the assertion that this stayed true when the furniture moved.

     A target standing for the tab's OWN study is not a target. There is no move
     to make and lighting it would promise one. */
  const target = (groupId: string | null): Element => ({
    closest: (selector: string) => (selector === "[data-study-target]" && groupId !== null
      ? { getAttribute: (name: string) => (name === "data-study-group-id" ? groupId : null) }
      : null),
  }) as unknown as Element;
  assert.equal(studyDropTargetId(target("john-study"), "acts-study"), "john-study");
  assert.equal(studyDropTargetId(target("acts-study"), "acts-study"), null);
  assert.equal(studyDropTargetId(target(null), "acts-study"), null);
  assert.equal(studyDropTargetId(null, "acts-study"), null);

  /* THE LIST HAS TO BE OPEN OR THERE IS NOWHERE TO DROP. With one control in
     place of a row of chips there is exactly one target on screen at rest, and
     it is the study the tab is already in — which the function above excludes by
     design. So the strip announces the drag itself, at the THRESHOLD and not at
     pointerdown, or a plain click on a tab would open a list. */
  const onMove = section("const handleTabPointerMove", "const handleTabPointerUp");
  assert.match(onMove, /origin\.started = true;/);
  assert.ok(
    onMove.indexOf('onTabDragPhase("reorder", origin.tabId)') > onMove.indexOf("origin.started = true"),
    "the drag is announced once it IS a drag, inside the threshold branch",
  );

  // The drop is `onMoveTab` — the same mutation the "Move to study…" menus
  // make, with the same confirmations and the same refusals. A second gesture
  // for changing a tab's study may never be a second set of rules for it.
  const up = section("const handleTabPointerUp", "const handleTabPointerCancel");
  assert.match(up, /if \(origin\.studyId\) \{\s*await handleMoveTab\(tabId, origin\.studyId, event\.currentTarget\);/);
  assert.match(up, /studyWorkspaceDragReorderPosition\(orderedIds, tabId, origin\.insertionIndex\)/);
  assert.ok(
    up.indexOf("handleMoveTab") < up.indexOf("studyWorkspaceDragReorderPosition"),
    "a study outranks the slot: the row's question has been left behind",
  );

  /* AND EVERY EXIT FROM A DRAG ENDS IT. Both the drop and the cancel announce
     the end and put the tab's offset back — the offset is written on the node,
     so React has no idea it is there and nothing in a re-render clears it. A
     drag that ends down a path nobody wrote a cleanup for is a tab left hanging
     in mid-air and a list left open over the page. */
    /* ONE WAY OUT · restated 2026-08-03. It was `releaseDragTransform`, which put
     the tab's offset back. A drag now also leaves a `grabbing` cursor on the
     document, so the cleanup is one function every path takes — a gesture that
     ends down a path nobody wrote a cleanup for strands a tab mid-air under a
     cursor that will not change back. */
  assert.match(up, /endDrag\(origin\?\.tabId\);/);
  assert.match(source, /document\.documentElement\.removeAttribute\("data-tab-drag"\);/);
  assert.match(source, /document\.documentElement\.setAttribute\("data-tab-drag", ""\);/);
  assert.match(styles, /html\[data-tab-drag\],\s*html\[data-tab-drag\] \* \{\s*cursor: grabbing !important;/,
    "an overlay would break elementFromPoint and a pointer-events:none layer carries no cursor");
  assert.match(up, /if \(origin\?\.started\) onTabDragPhase\(null, null\);/);
  const ended = section("const handleTabPointerCancel", "const handleTabAuxClick");
  assert.match(ended, /endDrag\(dragPointerRef\.current\?\.tabId\);/);
  assert.match(ended, /if \(dragPointerRef\.current\?\.started\) onTabDragPhase\(null, null\);/);

  /* AND WHILE A STUDY IS THE TARGET THE RUN STOPS ANSWERING, so exactly one
     thing on screen says where this lands and it is the surface under the
     pointer. The run closes back up rather than holding a slot open for a drop
     that is going somewhere else entirely. */
  assert.match(source, /const overStudy = dragState\?\.studyId != null;/);
  assert.match(source, /const shift = dragState\?\.phase === "carry" \? 0 : dragState\?\.shifts\.get\(tab\.id\) \?\? 0;/);

  /* THE TAB LEAVES THE ROW WHEN IT IS CARRIED OFF IT, and the run closes over
     the gap. Hidden rather than unmounted: the move may still be refused or need
     a confirmation the reader declines, and a tab that had really left would
     have to be put back by a component that no longer had it. */
  assert.match(source, /const carriedOff = dragging && dragState\?\.phase === "carry";/);
  assert.match(source, /data-carried=\{carriedOff \|\| undefined\}/);
  assert.match(styles, /\.scripture-workspace-tab-wrap\[data-carried\] \{\s*visibility: hidden;\s*\}/,
    "visibility keeps the node, its ref and its geometry — the snap-back is the attribute coming off");

  /* AND WHAT THE READER IS HOLDING RIDES THE CURSOR. `pointer-events: none` is
     not politeness: the drop target is found with `elementFromPoint` AT the
     cursor, which is exactly where this card is, so a proxy that could be hit
     would be the only thing any drag ever found. */
  assert.match(source, /createPortal\(/);
  assert.match(source, /data-study-tab-ghost=""/);
  assert.match(styles, /\.scripture-workspace-tab-ghost \{[\s\S]{0,400}z-index: 1400;/,
    "it has to clear the study list it is dragged over, which is a fixed layer of its own");
  assert.match(styles, /\.scripture-workspace-tab-ghost \{[\s\S]{0,700}pointer-events: none;/);
  assert.doesNotMatch(styles, /\.scripture-workspace-tab-ghost \{[\s\S]{0,700}--study-gold/,
    "a proxy in the app's authorship ink would claim the drag had already done something");
  // Positioned before its first paint, not after: the proxy is mounted by the
  // render that FOLLOWS the move which decided to mount it, so without this it
  // paints once at the document's top-left corner — the opposite corner of the
  // screen from the thing being dragged.
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*if \(!carried \|\| !carriedRef\.current\) return;/);

  // The mark is strictly transient: cleared on drop and on cancel, so it can
  // never be mistaken for state by a reader or by a screenshot.
  const move = section("const handleTabPointerMove", "const handleTabPointerUp");
  assert.match(move, /if \(studyId !== settledStudyId\) onTabDragOverStudy\(studyId\);/);
  assert.match(up, /if \(origin\?\.studyId\) onTabDragOverStudy\(null\);/);
  const cancel = section("const handleTabPointerCancel", "const handleTabAuxClick");
  assert.match(cancel, /if \(dragPointerRef\.current\?\.studyId\) onTabDragOverStudy\(null\);/);
});

test("a tab can found a study of its own, and the shapes that refuse it are the model's", () => {
  /* THE FIRST AUTHORING GESTURE — and the word that separates it from the item
     above it in the same menu is LEAVES. Duplicate copies; this moves. A study
     born here holds the tab you pressed, the tab is gone from the study it was
     in, and the strip follows because the model activates it.

     The refusals are shapes the persisted model cannot hold rather than
     policy, so they are computed in the model and only READ here. */
  assert.match(source, /const promoteAvailability = studyWorkspaceTabPromoteAvailability\(workspace, target\.tabId\);/);
  assert.match(source, /data-study-context-promote=""/);
  assert.match(source, /disabled=\{promoteAvailability !== "direct"\}/);
  assert.match(source, />New study from this tab</);
  assert.match(source, /await handlePromoteTab\(target\.tabId\)/);

  const study = createStudyWorkspace(view("ACT", 19), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  // A study's ONLY passage cannot leave it: the study it left would have none,
  // which the validator rejects, and the act would rename the study you are in
  // rather than make a new one.
  assert.equal(studyWorkspaceTabPromoteAvailability(study, "acts-19"), "unavailable");
  const withSecond = openPassageWorkspaceTab(study, {
    id: "john-3",
    sourceTabId: "acts-19",
    view: view("JHN", 3),
  }).state;
  assert.equal(studyWorkspaceTabPromoteAvailability(withSecond, "acts-19"), "direct");
  assert.equal(studyWorkspaceTabPromoteAvailability(withSecond, "john-3"), "direct");
  // An entity tab cannot found one at all — every group must own a passage.
  const withEntity = openEntityWorkspaceTab(withSecond, {
    id: "paul",
    sourceTabId: "john-3",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3),
    returnPassageTabId: "john-3",
  }).state;
  assert.equal(studyWorkspaceTabPromoteAvailability(withEntity, "paul"), "unavailable");
  assert.equal(studyWorkspaceTabPromoteAvailability(withEntity, "missing"), "unavailable");
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
