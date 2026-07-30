import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  studyWorkspacePersistenceReason,
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
const registerSource = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/styles/register.css"),
  "utf8",
);

/**
 * These sheets record a retirement by quoting the rule that was retired, so a
 * "this may not come back" assertion has to read declarations only — otherwise
 * it fails on the very note that proves the device is gone.
 */
const declarationsOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");
const stylesDeclarations = declarationsOnly(stylesSource);
const registerDeclarations = declarationsOnly(registerSource);
const componentStatements = componentSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

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
  /* Ends where the tablist ends, not where the toolbar begins. The inline
     new-tab plus now sits between the two, and it is a button — so a range that
     ran on to the toolbar swept it in and failed the claim below for a control
     that is correctly OUTSIDE the tablist. The claim is unchanged: a tablist
     holds tabs and proxies and nothing else. */
  const tablist = section(componentSource, 'role="tablist"', "{/* The new-tab plus, against the last tab");
  assert.match(tablist, /groups\.flatMap/);
  assert.match(tablist, /role="tab"/);
  assert.match(tablist, /role="presentation"/);
  assert.doesNotMatch(tablist, /role="button"|scripture-workspace-group-manage|scripture-workspace-open/);
  assert.match(tablist, /data-study-collapsed-proxy=/);
  assert.match(tablist, /const visibleLabel = collapsedProxy \? groupLabel : label/);
  // This used to read:
  //   assert.match(tablist, /const expandedGroupLabel = !collapsedProxy && tabIndex === 0 \? groupLabel : undefined/)
  // — the bracket's label, computed inside the member loop because the bracket
  // was anchored to the first member's wrap. Rev 05 §05·2 retires the bracket
  // and makes the group a kicker that is its own element at the head of the
  // members, so the label is decided once per group rather than once per tab.
  // The guarantee is verbatim the same one and it is stated on the new shape.
  /* The kicker's three assertions died with the kicker on 2026-07-29 — the
     `kickered` flag, the head it built, and the flatMap that put the head
     before the members. A study's identity is not in the strip at all now; it
     is in the rail, where a long name fits. What the strip renders for a study
     is its members, and — while folded — one proxy tab carrying its name. */
  assert.match(tablist, /return members;/,
    "the strip renders a study's members and nothing standing for the study");
  /* Declarations only. This file records a retirement by quoting the rule that
     was retired, so a "may not come back" check that reads comments fails on
     the very note proving the device is gone. */
  assert.doesNotMatch(
    section(componentStatements, 'role="tablist"', "const members = visibleTabs.map"),
    /const groupHead|kickered/,
    "the group head belongs to the rail now",
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
  /* Open LEFT this toolbar on 2026-07-29 and now sits inline against the last
     tab, which is where every browser puts the control that makes a tab. It had
     been filed here with the save status and the overflow menu — the one
     control that CREATES a tab, grouped behind a border-left with the two that
     report on tabs — so a reader looking where the pattern says to look found
     nothing there.

     What this test is for survives: the toolbar stays small, and holds exactly
     one active-group menu and one All Tabs. Open's placement is asserted
     against the strip instead, below. */
  assert.doesNotMatch(toolbar, /data-study-open=""/,
    "Open belongs against the tabs now, not in the cluster that reports on them");
  // The standalone reopen button is gone from the at-rest cluster; recovery now
  // lives entirely inside the All Tabs overflow.
  assert.doesNotMatch(toolbar, /data-study-reopen-recent/);
  assert.doesNotMatch(toolbar, /scripture-workspace-reopen/);
  assert.match(toolbar, /data-study-all-tabs/);
  assert.match(componentSource, />Study or question<\/label>/);
});

/**
 * The new-tab control sits against the tabs, and says so without a word.
 *
 * Two claims, and the second is the one that decays: that there is exactly ONE
 * of it — a second Open anywhere would be two answers to "how do I open a tab"
 * — and that it is the glyph alone. The label went with the move: behind a
 * divider "Open" was carrying the meaning, and in the row the plus is already
 * unambiguous, so the word became 38px of chrome repeating the icon. The
 * accessible name is what keeps the sentence, and it is asserted here because
 * an icon-only control that loses its name is unusable rather than merely terse.
 */
test("one new-tab control, inline with the strip, glyph only, and still named", () => {
  const opens = [...componentSource.matchAll(/data-study-open=""/g)];
  assert.equal(opens.length, 1, "exactly one control opens a tab");

  const strip = section(
    componentSource,
    "{/* The new-tab plus, against the last tab",
    '<div className="scripture-workspace-actions"',
  );
  assert.match(strip, /data-study-open=""/, "it is rendered in the strip, before the toolbar");
  assert.match(strip, /className="scripture-workspace-open is-inline"/);
  assert.match(strip, /<span aria-hidden="true"><PlusGlyph \/><\/span>/);
  assert.doesNotMatch(strip, /<span>Open<\/span>/, "the glyph carries it; the word repeated it");
  assert.match(strip, /aria-label="Open a new study tab"/, "an icon-only control keeps its name");
  assert.match(strip, /data-study-open-disabled=\{atTabCapacity \|\| undefined\}/);

  // And it is a square seated on the tabs' own baseline, not a pill in the band.
  const inline = section(stylesSource, ".scripture-workspace-open.is-inline {", "}");
  assert.match(inline, /align-self: flex-end;/);
  assert.match(inline, /width: 28px;/);
  assert.match(inline, /height: 28px;/);
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
  // The tooltip surfaces the count when within a few tabs of the cap, and names
  // the thing being counted. It read "studies open" until 2026-07-30, which was
  // the wrong unit for this limit: STUDY_WORKSPACE_TAB_LIMIT counts tabs, the
  // group cap is a different number entirely, and a reader with two studies was
  // being told all 64 of them were open.
  assert.match(componentSource, /of \$\{STUDY_WORKSPACE_TAB_LIMIT\} tabs open/);
  assert.match(componentSource, /All \$\{STUDY_WORKSPACE_TAB_LIMIT\} tabs open/);
  assert.doesNotMatch(componentStatements, /\$\{STUDY_WORKSPACE_TAB_LIMIT\} studies/);
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

  // A 30px tab strip under 24px of canvas, and the strip carries no fill of its
  // own: it is the page's own canvas showing through. The 24px above the tabs is
  // the page inset's top edge, doubling as the window drag region.
  //
  // The first line used to read `min-height: 34px`. Rev 05 §05·2 replaces the
  // floor with a stated height, because a floor is exactly what let the band
  // grow: a 15px bracket band opened above the tabs whenever a study was on
  // screen, so the page's top edge moved between 54 and 69 with the register's
  // CONTENTS. The height is now the frame's own composition and the strip is
  // half of it — see tests/quire-frame-top-edge-contract.test.ts for the sum.
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}height: var\(--frame-top\);/);
  assert.doesNotMatch(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}min-height:/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}flex: 0 0 auto;/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}padding: var\(--page-inset\) var\(--page-inset\) 0 0;/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,320}background: transparent;/);
  // No border-bottom: a rule here would fight the fillet, which is the thing
  // actually joining the tab to the page.
  assert.doesNotMatch(rail.slice(0, rail.indexOf("\n}")), /border-bottom/);
  assert.match(rail, /\.scripture-workspace-tab \{[\s\S]{0,420}height: var\(--register-strip\);/);

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
  // This line used to read:
  //   assert.match(rail, /\.scripture-workspace-tab\[aria-selected="true"\] \.scripture-workspace-tab-mark \{\s*color: var\(--study-gold\);/);
  // Rev 04 §8 retires that mark — "the gold underline on the active tab; the
  // paper fill is the mark." The tab already answers "where am I" by being a
  // piece of the page; a seal glyph that lit only while the tab was selected
  // stated the same thing twice, in the ink Law 3 reserves for authorship. The
  // assertion is inverted rather than deleted so the mark cannot come back.
  assert.doesNotMatch(
    rail,
    /\.scripture-workspace-tab\[aria-selected="true"\][^{}]*\.scripture-workspace-tab-mark\b/,
  );

  assert.match(rail, /\.scripture-workspace-tab-label \{[\s\S]{0,180}opacity: 1/);
  // The group's name is set in 9px mono, and that survives every change of
  // device: a study id is chrome, not something you read. The second line used
  // to be `.scripture-workspace-group-tab::before { … height: 1px }` — the
  // bracket's hairline over the first member — and Rev 05 §05·2 retires it, so
  // the assertion is inverted rather than dropped: no pseudo-element of the
  // group label may draw a rule again.
  /* The kicker's 9px mono went to the rail with the kicker, and came back on
     2026-07-30 when the rail's switcher was removed for not being able to tell
     two studies apart. A study's name is set in the register again, and in the
     register's own chrome type — but in the ACTIONS CLUSTER, on the control
     that manages it, never among the tabs. The assertion below is about the
     kicker's class name and is unchanged; only the sentence about where the
     name went had to be corrected. */
  assert.doesNotMatch(rail, /\.scripture-workspace-group-tab\b/,
    "no study label is drawn among the tabs any more");
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
  /* Read from the rule's own body rather than from a 320-character window after
     its selector. The claim is that the viewport scrolls on x and never clips
     on y — the fillets hang below the tab and `overflow: hidden` would slice
     them off — and that claim has nothing to do with how far into the rule the
     declarations happen to fall. The window broke on a comment. */
  const viewportRule = section(rail, ".scripture-workspace-viewport {", "\n}");
  assert.match(viewportRule, /overflow-x: auto;/);
  assert.match(viewportRule, /overflow-y: visible;/);
  assert.match(rail, /@media \(forced-colors: active\)/);
  assert.match(rail, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the fillets reserve their own 16px of footprint, dropped on the flush side", () => {
  // B·2 case 1: "The 8px fillets add 16px to the tab's footprint, which is why
  // the neighbouring tabs sit 8px further out." Without the margin the fillets
  // paint over the neighbouring tab instead of pushing it clear.
  assert.match(
    registerSource,
    /\.scripture-workspace-viewport \.scripture-workspace-tab-wrap\.is-selected \{\s*margin-inline: var\(--radius-page\);\s*\}/,
  );
  // At the START the tab becomes the page's corner, so that side has no fillet
  // and reserves nothing for one. There is no matching end-side rule, because
  // the end side always keeps its fillet — see the retirement test below.
  assert.match(registerSource, /\[data-flush-start\][\s\S]{0,140}\.is-selected \{\s*margin-inline-start: 0;/);
  assert.doesNotMatch(registerSource, /margin-inline-end: 0;/);
  // 104px min width leaves a flat run of 104 - 8 - 8 = 88px between the two top
  // curves, comfortably over the 40px floor the study sets.
  assert.match(stylesSource, /\.scripture-workspace-tab \{[\s\S]{0,420}min-width: 104px;/);
});

test("flush-END is retired: the actions never move and the last tab keeps its right fillet", () => {
  // This test used to assert the opposite, and it is rewritten rather than
  // deleted because the behaviour it guarded was DECIDED against, not merely
  // dropped. B·2 case 3 asked where + PASSAGE goes when the last tab claims the
  // page's top-right corner. The register answered by docking right so the
  // controls sat left of the flush tab. The owner ruled that out: Open, the
  // search and the group control changed position every time the selection
  // moved to or from the last tab, and controls that relocate between
  // selections cost more than a squared corner is worth. "Right becomes an
  // impossibility and that is okay." Flush-START is untouched and still liked.
  //
  // So the assertions below are deliberately negative. If flush-end is ever
  // reintroduced, this test is where it will be caught, and the reason it was
  // retired is written above so nobody has to reconstruct it.
  assert.doesNotMatch(componentSource, /flushEnd/);
  assert.doesNotMatch(componentSource, /data-flush-end/);
  assert.doesNotMatch(componentSource, /before-flush-tab/);
  assert.doesNotMatch(registerSource, /data-flush-end/);
  assert.doesNotMatch(stylesSource, /data-flush-end/);

  // The placement is a constant, and it is the strip's end in every selection.
  assert.match(componentSource, /const actionsPlacement = "strip-end";/);
  assert.match(componentSource, /data-study-actions=\{actionsPlacement\}/);
  // Nothing in the register may reverse or re-dock the row to make room for a
  // flush-right tab: those two declarations were the whole mechanism.
  assert.doesNotMatch(registerSource, /justify-content: flex-end/);
  assert.doesNotMatch(registerSource, /\.scripture-workspace-actions \{[^}]*order: -1/);

  // Flush-START survives intact — it is the half of B·2 case 2 the ruling keeps.
  //
  // These two lines used to read:
  //   assert.match(componentSource, /const flushStart = activeRegisterIndex === 0 && !leadKickered/);
  //   assert.match(componentSource, /const leadKickered = leadGroup \? !leadGroup\.group\.collapsed : false/);
  // — Rev 05 §05·2's qualification, which said a first tab standing behind the
  // group's kicker does not reach the page's corner and may not square it. The
  // kicker left the strip on 2026-07-29 and the qualification stayed, so
  // `leadKickered` was true for every expanded study and flush-start was dead:
  // the first tab never squared the page's corner again. Pinning the expression
  // verbatim is what let a dead condition read as a live rule for a day, so it
  // is restated as the behaviour rather than as the text — the rule fires when
  // the active tab is first, and no retired object may re-enter the condition.
  assert.match(componentSource, /const flushStart = activeRegisterIndex === 0;/);
  assert.doesNotMatch(componentStatements, /leadKickered|leadGroup/,
    "the kicker is gone; nothing in front of the first tab is left to guard against");
  assert.match(componentSource, /data-flush-start=\{flushStart \|\| undefined\}/);

  // Separate with interval, not with lines: the controls' keyline is gone.
  assert.match(
    registerSource,
    /\.scripture-workspace-bar \.scripture-workspace-actions \{[\s\S]{0,120}border-left: 0;/,
  );
});

test("the group popover opens on its heading, not inside the rename field", () => {
  // The owner reported a focus ring drawn on the rename box the moment the
  // "manage group" dropdown opens. The ring rule was already :focus-visible, so
  // the selector was not the bug: a focused text input matches :focus-visible
  // however focus arrived, which is the HTML spec's own heuristic for controls
  // that accept keyboard input. The only way to stop painting a keyboard ring
  // after a mouse click was to stop putting focus in the field.
  //
  // Focus still enters the dialog — it lands on the heading, which is not a
  // text-entry control and therefore rings only when the last interaction
  // really was a keyboard one. Removing the ring instead would have been an
  // accessibility regression, so it is still declared, on the heading and on
  // the field a Tab away.
  assert.match(componentSource, /initialFocusRef=\{groupMenuHeadingRef\}/);
  assert.doesNotMatch(componentSource, /initialFocusRef=\{groupRenameInputRef\}/);
  assert.match(
    componentSource,
    /ref=\{groupMenuHeadingRef\}\s*className="scripture-workspace-popover-heading"\s*tabIndex=\{-1\}/,
  );
  assert.match(
    stylesSource,
    /\.scripture-workspace-group-popover \.scripture-workspace-popover-heading:focus-visible \{\s*outline: 2px solid var\(--study-gold\);/,
  );
  // The field's own ring is untouched: a Tab into it still rings.
  assert.match(stylesSource, /\.scripture-workspace-group-popover input:focus-visible,/);
});

test("the group is a kicker at the head of its members, separated by canvas and never by a rule", () => {
  const rail = section(stylesSource, ".scripture-workspace-bar {", ".topbar-navigation,");

  // WHAT THIS TEST USED TO ASSERT, and why it no longer may.
  //
  // It was named "the bracket names its members' span from above and takes no
  // width from the tab row", and it pinned the device built earlier in this
  // cycle: a 15px band above the tabs — `[data-study-group-bracket] {
  // padding-top: 15px }` — holding an absolutely-positioned 15px label and a
  // 1px `.scripture-workspace-group-rule` carried in segments by every member,
  // trimmed at `[data-study-group-end]`. That was itself a correction of an
  // earlier 96px box beside the first member, which clipped the study name and
  // shouldered a flush-start tab off the page corner it exists to supply.
  //
  // Rev 05 §05·2 retires the whole device, and not because the band was wrong:
  //
  //   "A rule that brackets a group must end exactly where the group ends; this
  //    one cannot, because tabs move. Spacing and one kicker say the same thing
  //    and cannot drift."
  //
  // The band was also a second strip above the strip — "a label above the strip
  // creates a second strip. It belongs in the strip, at the head of its
  // members" — and the rule and the label were two of the four datums the
  // section counts in the top 100px of the window (B, "a hairline that starts
  // at the tabs' left and stops at no edge in the layout"; C, "the study siglum
  // floats in the drag band, at a third x").
  //
  // So the assertions below are the same guarantee — a group is NAMED, and its
  // name costs the tab row nothing — restated on the device that replaced it,
  // plus negative assertions so the retired one cannot return.

  // Nothing above the tab row. The reserved band and the rule are gone from the
  // sheet, the component and the narrow shell alike.
  assert.doesNotMatch(stylesDeclarations, /data-study-group-bracket/);
  assert.doesNotMatch(stylesDeclarations, /data-study-group-end/);
  assert.doesNotMatch(stylesDeclarations, /scripture-workspace-group-rule/);
  assert.doesNotMatch(registerDeclarations, /scripture-workspace-group-rule/);
  assert.doesNotMatch(componentStatements, /scripture-workspace-group-rule/);
  assert.doesNotMatch(componentStatements, /data-study-group-bracket|data-study-group-end/);

  /* THE GUARANTEE, AND WHERE IT NOW LANDS.
     "A group is NAMED, and its name costs the tab row nothing." The bracket
     cost a 15px band above the row; the kicker cost a slot inside it; neither
     is here, and the row pays nothing for a study's name.

     These two lines used to read
       assert.match(railSheet, /\.rail-studies-item \{/, "a study is named in the rail instead");
       assert.match(railSheet, /\.rail-studies-count \{/, "and says how much is inside");
     and they were true for one day. The rail's switcher is removed — it could
     not tell two studies apart, which was its only job — so "in the rail
     instead" is no longer where the guarantee lands, and asserting it would be
     asserting a device that is gone.

     Where it lands instead is stated below and both halves are in the strip,
     outside the tab row: the actions cluster's Manage control carries the
     current study's own name, and a folded study wears its name on the proxy
     tab that stands for it. That is a smaller claim than the rail made — no
     count on an unselected study, no way to name a study you are not in — and
     it is the honest one until the study line arrives.

     The 176px cap went with the kicker and is not missed: it existed because an
     unbounded run of 9px caps across a horizontal strip was the defect the whole
     family of devices was drawn to replace. */
  assert.doesNotMatch(componentStatements, /scripture-workspace-group-tab|scripture-workspace-group-head/,
    "no element among the TABS stands for a study");
  assert.match(componentSource, /className="scripture-workspace-active-group"/,
    "a study is named by the control that manages it");
  assert.match(componentSource, /aria-label=\{`Manage \$\{activeGroup\.label\}`\}/);
  assert.match(componentSource, /const visibleLabel = collapsedProxy \? groupLabel : label/,
    "and a folded study wears its own name on the proxy that stands for it");

  /* The slate mark went with the kicker it sat on. It was Law 2's mark at the
     smallest scale it appears — 2 x 11 — in Law 3's ink for something the app
     INFERRED, and that reading was correct while a study was something the app
     assembled from what you opened.

     Nothing takes its place yet, and that is deliberate rather than an
     oversight: the rail's switcher carries no provenance mark at all until
     studies are authored, because seal would claim the reader made a thing they
     did not yet make, and slate would repeat a claim about a device that no
     longer exists. The mark returns with the authoring gesture, and this is
     where it should be asserted when it does. */
  assert.doesNotMatch(componentStatements, /scripture-workspace-group-mark/,
    "the kicker's mark went with the kicker");

  // Separated by canvas, and by the strip's own number: "separated from the
  // ungrouped tabs by 24px of canvas rather than by a rule — the same argument
  // that removed the Research divider."
  assert.match(
    rail,
    /\.scripture-workspace-tab-wrap\[data-study-group-start="true"\] \{\s*margin-left: var\(--page-inset\);/,
  );
  /* The interval belongs to whichever element opens the run, and there is only
     one candidate now. The `!kickered` term existed to hand the 24px to the
     kicker where a study had one and to the first member otherwise; with no
     kicker the first member always carries it, so the term went and the claim
     — a study's run is opened by exactly one interval, never two — is stated
     on what remains. */
  assert.match(
    componentStatements,
    /const groupStart = tabIndex === 0 && groupIndex > 0;/,
  );
  /* The marker was on the head and is on the first member now — the head was
     the element that opened a run while it existed. */
  assert.match(componentSource, /data-study-group-start=\{groupStart \|\| undefined\}/);

  /* B3's recede was the kicker dimming to 72% for a study with no active tab —
     "present, never a second ink". It goes with the kicker. The rail says the
     same thing in the same place it says everything else: the current study
     takes the page's ink and the others keep the rail's, which is one
     declaration rather than an opacity. */
  assert.doesNotMatch(stylesDeclarations, /data-study-group-active/,
    "the recede belonged to the kicker");
  assert.doesNotMatch(
    registerDeclarations,
    /\[data-study-group-active="false"\]/,
  );
});

test("the strip's right-hand cluster sits on the strip's row, not centred in the band", () => {
  const rail = section(stylesSource, ".scripture-workspace-bar {", ".topbar-navigation,");

  // Rev 05 §05·2's one addition, and ruling 4·6 applied to the last place that
  // was not obeying it: "The right-hand cluster in the strip — reference,
  // count, + Open, overflow — sits on the tab strip's baseline datum, not its
  // vertical centre… the strip is the last place still centring."
  //
  // The cluster used to be `align-items: center` with no height, so it centred
  // 28px controls inside a band whose height moved with the register's
  // contents. It now takes the strip's own row, and every control in it is one
  // box of one height — which is the datum stated as geometry rather than as a
  // nudge that can drift when a label's size changes.
  assert.match(rail, /\.scripture-workspace-actions \{[\s\S]{0,420}height: var\(--register-strip\);/);
  assert.match(rail, /\.scripture-workspace-actions \{[\s\S]{0,420}align-items: flex-end;/);
  const actionsRule = rail.slice(
    rail.indexOf(".scripture-workspace-actions {"),
    rail.indexOf("}", rail.indexOf(".scripture-workspace-actions {")),
  );
  assert.doesNotMatch(actionsRule, /align-items: center/);
  // No control may carry a height of its own again: a second height in the
  // cluster is a second datum, which is the fault the whole section is about.
  // 24px stays, because it is the pointer target rather than a shape.
  /* The family lost a member on 2026-07-30 and this selector had to be
     re-canonned with it. It read
       .scripture-workspace-active-group, .scripture-workspace-open,
       .scripture-workspace-reopen, .scripture-workspace-overflow
     and `.scripture-workspace-reopen` had no element behind it in any state:
     the standalone reopen button left the strip when recovery moved into All
     Tabs, and eight rules across this sheet went on styling it. Naming it here
     is what kept them alive — the selector could not be tidied without editing
     a passing test, which is the shape of a contract holding dead code in
     place. The claim is unchanged: every control in the cluster is sized as one
     family and none carries a height of its own. */
  assert.doesNotMatch(stylesDeclarations, /scripture-workspace-reopen/,
    "styling a control the strip does not render describes a product that does not exist");
  const controls = /\.scripture-workspace-active-group,\s*\.scripture-workspace-open,\s*\.scripture-workspace-overflow \{([^}]*)\}/
    .exec(rail);
  assert.ok(controls, "the cluster's controls must still be sized as one family");
  assert.doesNotMatch(controls[1], /(?:^|[\s;])height\s*:/);
  assert.match(controls[1], /min-height: 24px/);
  // And the failure line joins the datum instead of nudging itself onto it.
  assert.match(
    registerSource,
    /\.scripture-workspace-persistence\.is-failed \{[\s\S]{0,160}align-items: baseline;/,
  );
  assert.doesNotMatch(
    registerSource,
    /\.scripture-workspace-persistence\.is-failed \{[\s\S]{0,160}padding-bottom:/,
  );
});

test("no control in the register is left to the platform to draw", () => {
  const rail = section(stylesSource, ".scripture-workspace-bar {", ".topbar-navigation,");

  /* The bracket used to be missing from this reset and kept the UA's `2px
     outset` button border — a hard black rectangle on all four sides,
     permanently, reading as a focus ring that never cleared. It is not in the
     register at all now, so there is nothing here to reset; the claim survives
     as the negative, which is the stronger form of it. */
  const reset = rail.slice(rail.indexOf(".scripture-workspace-tab,"));
  assert.doesNotMatch(
    reset.slice(0, reset.indexOf("}")),
    /\.scripture-workspace-group-tab,/,
    "the bracket is gone; nothing in the register should still be resetting it",
  );

  // And every focusable control carries the register's own mark. The bracket
  // and the context menu's items both fell through to the platform ring.
  const focusStart = rail.indexOf(".scripture-workspace-tab:focus-visible");
  const focusSelectors = rail.slice(focusStart, rail.indexOf("{", focusStart));
  for (const selector of [
    /* .scripture-workspace-group-tab:focus-visible was here and went with the
       kicker. A note followed it pointing at .rail-studies-item:focus-visible
       as the ring the switcher carried in the rail's stead; the switcher was
       removed on 2026-07-30 and the rail has no focusable control of its own
       again. Every ring the register owes is in this list. */
    ".scripture-workspace-context-menu button:focus-visible",
    ".scripture-workspace-active-group:focus-visible",
    ".scripture-workspace-open:focus-visible",
    ".scripture-workspace-overflow:focus-visible",
    ".scripture-workspace-persistence button:focus-visible",
  ]) {
    assert.ok(focusSelectors.includes(selector), `${selector} must carry the register's focus mark`);
  }
});

test("a derived tab wears the machine hue whether or not you are reading it", () => {
  const rail = section(stylesSource, ".scripture-workspace-bar {", ".topbar-navigation,");

  // Provenance: B1 calls the two kinds of tab apart by who made them — a
  // passage is one you chose, a Research tab is one "the app derived — slate
  // mark". This mark is NOT retired: Rev 04 §8 struck the gold STATE mark on
  // the active tab, and slate is a PROVENANCE signal that Law 3 requires.
  const machineIndex = rail.indexOf(".scripture-workspace-tab .scripture-workspace-tab-mark.is-person,");
  assert.ok(machineIndex > 0, "a derived tab's mark must name the machine hue");
  assert.match(
    rail.slice(machineIndex, rail.indexOf("}", machineIndex)),
    /\.scripture-workspace-tab-mark\.is-place \{\s*color: var\(--accent-machine\);/,
  );

  // The same glyph is drawn in the All Tabs list, and the strip-scoped selector
  // did not reach it there, so a derived tab read slate in the strip and
  // unmarked in the list. That is the one place forty tabs are told apart, so
  // it is the place the mark matters most; provenance belongs to the tab, not
  // to the surface the tab happens to be drawn on.
  assert.match(componentSource, /className="scripture-workspace-overflow-row"[\s\S]{0,700}<TabMark tab=\{tab\} \/>/);
  const overflowRule = rail.slice(machineIndex, rail.indexOf("}", machineIndex));
  for (const selector of [
    ".scripture-workspace-overflow-row .scripture-workspace-tab-mark.is-person",
    ".scripture-workspace-overflow-row .scripture-workspace-tab-mark.is-place",
  ]) {
    assert.ok(
      overflowRule.includes(selector),
      `${selector} must wear --accent-machine: a derived tab cannot go unmarked in the All Tabs list`,
    );
  }

  // These two lines used to read:
  //   const selectedIndex = rail.indexOf('.scripture-workspace-tab[aria-selected="true"] .scripture-workspace-tab-mark {');
  //   assert.ok(machineIndex > selectedIndex, "the machine hue must be declared after the selected mark or selection will repaint it seal");
  // They policed source order between slate and a seal-on-selected rule. With
  // that rule retired there is no order left to police, and an index-vs-(-1)
  // comparison would pass for the wrong reason forever. What the check is
  // really for — selection must not repaint provenance — is now stated as the
  // absence of any selected-tab rule that reaches the glyph at all.
  assert.equal(
    rail.indexOf('.scripture-workspace-tab[aria-selected="true"] .scripture-workspace-tab-mark'),
    -1,
    "selection must not reach the provenance glyph: the paper fill is the mark",
  );
});

test("a save is announced and never drawn, and its live region is never removed", () => {
  /* ADDED 2026-07-30, because the claim existed and nothing held it.
     The commit that made saving visually silent said "the live region is why
     this is clipped rather than display:none: a screen reader following the
     workspace still hears Saving…" — while leaving
     `.scripture-workspace-persistence:not(.is-saving):not(.is-failed) {
     display: none }` in the sheet. So the region was torn out of the
     accessibility tree between every write and rebuilt on the next one, which
     is not a quieter announcement but no announcement: a live region has to be
     in the tree BEFORE its content changes for the change to be spoken.

     The claim is unchanged and now has a test. The region is always rendered
     and always in the tree; the sheet hides it in every phase but failed; and
     it is out of FLOW while hidden, which is the other half — a save that
     reflows the strip is the twitch this whole treatment was drawn to stop. */
  const status = section(componentSource, 'className="scripture-workspace-actions"', "{activeGroup &&");
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  // Rendered in every phase: the phase is a class on it, never a condition
  // around it.
  assert.match(status, /className=\{`scripture-workspace-persistence is-\$\{persistenceStatus\.phase\}`\}/);
  assert.doesNotMatch(status, /persistenceStatus\.phase !== "idle" &&/);

  // Hidden by the sheet, in every phase but failed, and out of flow while it is.
  const hidden = section(stylesSource, ".scripture-workspace-persistence:not(.is-failed) {", "}");
  assert.match(hidden, /position: absolute;/);
  assert.match(hidden, /clip: rect\(0, 0, 0, 0\);/);
  assert.match(hidden, /width: 1px;/);
  assert.match(hidden, /height: 1px;/);

  // And nothing anywhere may take it out of the tree again. Declarations only:
  // the note above quotes the rule that was removed.
  for (const [, body] of stylesDeclarations.matchAll(
    /\.scripture-workspace-persistence(?![-\w])[^{}]*\{([^}]*)\}/g,
  )) {
    assert.doesNotMatch(body, /display\s*:\s*none/,
      "a live region that is display:none between saves announces nothing at all");
  }
  assert.doesNotMatch(registerDeclarations, /\.scripture-workspace-persistence[^{}]*\{[^}]*display\s*:\s*none/);

  // The failure line is the one phase that is drawn, and it is in flow.
  assert.match(
    registerSource,
    /\.scripture-workspace-bar \.scripture-workspace-persistence\.is-failed \{[\s\S]{0,160}display: inline-flex;/,
  );
});

test("a persistence failure seals the strip's baseline and states four words beside the retry", () => {
  // B4: nothing closes, nothing greys out — the baseline turns seal across the
  // page's width and the reason is four words. A failure to save the workspace
  // must never look like a failure to open a passage.
  assert.match(componentSource, /data-study-persistence=\{persistenceStatus\.phase\}/);
  assert.match(
    registerSource,
    /\.scripture-workspace-bar\[data-study-persistence="failed"\]::after \{[\s\S]{0,260}background: var\(--study-gold\);/,
  );
  assert.match(
    registerSource,
    /\.scripture-workspace-bar\[data-study-persistence="failed"\]::after \{[\s\S]{0,260}height: 1px;/,
  );
  // The baseline is the page's top edge, so it stops where the page stops.
  assert.match(registerSource, /left: var\(--page-inset\);\s*right: var\(--page-inset\);/);
  assert.match(componentSource, /data-study-persistence-reason=""/);
  assert.match(componentSource, /<span className="scripture-workspace-persistence-reason"/);

  for (const [error, reason] of [
    ["EACCES: permission denied", "Library is read only"],
    ["the library is read-only", "Library is read only"],
    ["ENOSPC: no space left on device", "Disk has no room"],
    ["refused: newer version on disk", "Another window saved first"],
    ["ENOENT: no such file", "Library file went missing"],
    [undefined, "Library did not answer"],
    ["something nobody mapped", "Library did not answer"],
  ] as ReadonlyArray<[string | undefined, string]>) {
    assert.equal(studyWorkspacePersistenceReason(error), reason);
    assert.equal(
      studyWorkspacePersistenceReason(error).split(" ").length,
      4,
      `"${studyWorkspacePersistenceReason(error)}" is not four words`,
    );
  }
});

test("overflow counts the rest and the register's ordinals live in that list", () => {
  // B4: "a +7 count opens the rest as a list" — the count is the part you can
  // act on. And B5: numbers appear in the overflow list, never on the tabs.
  assert.match(componentSource, /const hiddenTabCount = tabsInStrip === null \? 0 : Math\.max\(0, registerSize - tabsInStrip\)/);
  assert.match(componentSource, /className="scripture-workspace-overflow-count">\{`\+\$\{hiddenTabCount\}`\}/);
  assert.match(componentSource, /const ordinal = studyWorkspaceTabOrdinal\(workspace, tab\.id\)/);
  assert.match(componentSource, /className="scripture-workspace-overflow-shortcut"/);
  assert.match(componentSource, /data-study-tab-ordinal=\{ordinal\}/);
  // The tabs themselves stay clean: no shortcut hint is rendered in the strip.
  const tablist = section(componentSource, 'role="tablist"', '<div className="scripture-workspace-actions"');
  assert.doesNotMatch(tablist, /⌘/);
});
