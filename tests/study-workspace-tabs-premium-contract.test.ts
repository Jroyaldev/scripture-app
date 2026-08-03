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

test("one global APG tablist contains one study's tabs, with one roving stop", () => {
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
  /* THE COLLAPSED PROXY IS RETIRED, 2026-07-30, and these two lines went with
     it:
       assert.match(tablist, /data-study-collapsed-proxy=/);
       assert.match(tablist, /const visibleLabel = collapsedProxy \? groupLabel : label/);
     A proxy was a whole study folded into one tab so its siblings could get out
     of the row. The register holds one study's tabs by construction now, so
     there is nothing to fold away from — and a tab wearing a STUDY's name was
     also the last thing in the strip that stood for a study, which is the claim
     restated at full strength further down this file. */
  assert.doesNotMatch(componentStatements, /collapsedProxy|data-study-collapsed-proxy/);
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
  /* `return members;` was the shape this claim was stated on — the flatMap
     returned a study's member tabs and nothing else, after the kicker that used
     to precede them was retired. The loop has one thing left to return as of
     2026-07-30, because there is one study in the strip and it has no head, no
     proxy and no interval to another study; `members` was a name for "what is
     left over", and what is left over is the tabs. */
  /* The index binding went with the insertion rule on 2026-08-03: it existed to
     compare a tab's position against the drop slot, and the slot is not drawn as
     a rule between two tabs any more — the run opens a gap instead, and which
     tab has stepped aside is looked up by id. The claim is unchanged. */
  assert.match(tablist, /return tabs\.map\(\(tab\) => \{/,
    "the strip renders one study's tabs and nothing standing for the study");
  /* Declarations only. This file records a retirement by quoting the rule that
     was retired, so a "may not come back" check that reads comments fails on
     the very note proving the device is gone. */
  assert.doesNotMatch(
    section(componentStatements, 'role="tablist"', "return tabs.map"),
    /const groupHead|kickered|const members/,
    "nothing is built ahead of the tabs: the head and the proxy are both retired",
  );
  /* `const closeAvailability = collapsedProxy ? …group… : …tab…` — an × on a
     proxy closed the whole study it stood for, which was the only honest
     reading of one tab standing for six. Every tab in the strip is one tab, so
     an × closes one tab; closing a STUDY is the overview's, where the thing
     being closed is named. */
  assert.match(tablist, /const closeAvailability = studyWorkspaceTabCloseAvailability\(workspace, tab\.id\)/);
  assert.match(tablist, /const canClose = closeAvailability !== "unavailable"/);
  assert.match(tablist, /tabIndex=\{roving \? 0 : -1\}/);

  assert.equal(studyWorkspaceRovingTabId(["acts", "paul"], "paul"), "paul");
  assert.equal(studyWorkspaceRovingTabId(["acts", "paul"], "missing"), "acts");
  assert.equal(studyWorkspaceRovingTabId([], "missing"), null);
});

test("the fixed toolbar reports on tabs and names no study", () => {
  const toolbar = section(
    componentSource,
    '<div className="scripture-workspace-actions"',
    "{overflowOpen && overflowAnchor",
  );
  /* THE ACTIVE-GROUP MENU LEFT THIS CLUSTER ON 2026-07-30, and these two lines
     went with it:

       assert.match(toolbar, /data-study-active-group-manage/);
       assert.equal([...toolbar.matchAll(/data-study-active-group-manage/g)].length, 1);

     It was a 132px control carrying the current study's name, its tab count and
     a caret onto a popover with rename, order, collapse and close. ae49372's
     whole argument for taking the study's label out of the tab row was that a
     strip "truncates the name at exactly the moment the name is what is being
     read" — and this control was that same truncation, filed one divider to the
     right, where it also put a name among two controls whose entire job is
     reporting on tabs.

     The study line names studies now: all of them, not only the one you are in;
     whole names with a count and a seal; renamed in place on the chip. Order,
     collapse and close are per-study in All Tabs, which is also the only place
     that can reach a study you are not in.

     So the claim is inverted rather than deleted. What is left in the cluster
     is the save status and All Tabs — two controls that report, and nothing
     that names — and the assertion is that it stays that way. */
  assert.doesNotMatch(
    section(componentStatements, 'className="scripture-workspace-actions"', "{overflowOpen && overflowAnchor"),
    /data-study-active-group-manage|scripture-workspace-active-group/,
    "the cluster reports on tabs; naming a study is the study line's",
  );
  assert.doesNotMatch(toolbar, /groups\.map|allGroups\.map/);
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
  /* This line read `assert.match(componentSource, />Study or question<\/label>/)`
     — the visible label above the group popover's rename field, and the one
     place the strip said out loud what a study is FOR. Both the popover and the
     control that opened it are gone. The sentence survives in the palette row
     that creates a study ("Create a separate sermon, question, or class study",
     pinned in tests/study-open-orchestration-contract) and in the field the
     chip becomes, whose accessible name asks for the same thing in the same
     words the reader would use. */
  assert.doesNotMatch(componentStatements, />Study or question<\/label>/);
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
  assert.match(inline, /height: 30px;/);
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
  /* `data-study-group-collapse` was here, per study. A toggle whose only effect
     is a field nobody reads is worse than a missing control — a reader presses
     it, nothing moves, and they conclude the app is broken — so it went with
     the proxy on 2026-07-30. Order, rename, move and close all remain, which is
     everything that has a visible effect. */
  assert.doesNotMatch(allTabs, /data-study-group-collapse/);
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
  /* The bar is the STRIP's half of the frame as of 2026-07-30. These two lines
     read `height: var(--frame-top)` and
     `padding: var(--page-inset) var(--page-inset) 0 0`, from when the band above
     the tabs was the bar's own empty top padding and the bar therefore stood
     for the whole edge. The study line is a real element in that band now and
     states its own height, so a bar still claiming --frame-top would claim it
     twice. The frame's sum is held in tests/quire-frame-top-edge-contract. */
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,2600}height: var\(--register-strip\);/);
  assert.doesNotMatch(rail, /\.scripture-workspace-bar \{[\s\S]{0,2600}min-height:/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,2600}flex: 0 0 auto;/);
  /* THE ROW KEEPS ROOM FOR THE SYSTEM'S OWN BUTTONS · 2026-08-03. It read
     `padding: 0 var(--page-inset) 0 0` while a 24px drag band stood above it and
     the register began at the page's own edge. The band dissolved into this row
     and the row became the window's, so it reserves macOS's button zone at its
     left — minus whatever the rail is already standing in, which is why the
     expression subtracts rather than repeating a number. `max()` makes the open
     rail fall out of the same expression, and fullscreen is the same rule with
     the reserve at zero. */
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,2600}padding: 0 var\(--page-inset\) 0 max\(0px, calc\(var\(--os-buttons\) - var\(--rail-flow-w\)\)\);/);
  assert.match(rail, /\.scripture-workspace-bar \{[\s\S]{0,2600}background: transparent;/);
  // No border-bottom: a rule here would fight the fillet, which is the thing
  // actually joining the tab to the page.
  assert.doesNotMatch(rail.slice(0, rail.indexOf("\n}")), /border-bottom/);
  assert.match(rail, /\.scripture-workspace-tab \{[\s\S]{0,2000}height: 32px;/);

  // The paper fill IS the mark. The tab is a piece of the page pulled up above
  // the register's baseline, so it takes paper, the page's radius, and no
  // second indicator — instant, because this is the app answering "where am I".
  assert.match(rail, /\.scripture-workspace-tab \{[\s\S]{0,2000}border-radius: var\(--radius-page\) var\(--radius-page\) 0 0;/);
  assert.match(
    rail,
    /\.scripture-workspace-tab\[aria-selected="true"\] \{\s*background: var\(--bg-reading\);\s*color: var\(--text-primary\);\s*transition: none;\s*\}/,
  );
  // An inactive tab gets no shape and no hover fill, ever — a hovered shape is
  // a third fill, and re-creates the mush the two-plane rule exists to prevent.
  assert.match(rail, /\.scripture-workspace-tab:hover \{\s*background: transparent;/);
  /* Gold survives in the register as ink, as the focus ring, and as a MARK —
     never as a fill. This line used to forbid the token from `background`
     outright, which was the same claim while nothing in the register carried a
     mark; the study line's chips carry the seal, and a mark is drawn by
     painting a 2px box. So the sweep is stated the way Law 2 states it: a
     selection or provenance mark may take the seal, a control's surface may
     not, and the difference is whether the subject is a mark. Anything that
     takes a gold background and is not one fails here. */
  for (const [selector, body] of [...rail.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (match): [string, string] => [
      match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim(),
      match[2]!,
    ],
  )) {
    if (!/background:\s*(?:var\(--study-gold\)|color-mix\([^;]*--study-gold)/.test(body)) continue;
    assert.match(
      selector,
      /(?:-seal|-mark)\b|::(?:before|after)/,
      `${selector} gives a control a gold fill; seal marks a thing, it does not fill one`,
    );
    const box = /width:\s*([\d.]+)px/.exec(body);
    assert.ok(box && Number.parseFloat(box[1]!) <= 2,
      `${selector} paints seal wider than a mark`);
  }
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
  /* The kicker's 9px mono went to the rail with the kicker, came back on
     2026-07-30 to the actions cluster's Manage control when the rail's switcher
     was removed, and left the strip altogether later the same day when that
     control did. A study's name is set in the study line now, in the frame's
     own row above the tabs — 11px UI type with a tabular count beside it — and
     the strip sets no study's name at all. Both assertions below are about the
     STRIP and both are negative, which is the strongest form this claim has
     taken: it used to name a place the label had gone to, and it now says the
     label is not in the register's tab bar under any class name it has worn. */
  assert.doesNotMatch(rail, /\.scripture-workspace-group-tab\b/,
    "no study label is drawn among the tabs any more");
  assert.doesNotMatch(declarationsOnly(rail), /\.scripture-workspace-active-group\b/,
    "and none is drawn beside them either");
  /* A count was set here in the register's own chrome type — `.scripture-study-chip
     small`, 9px tabular — and it is gone as of 2026-07-30. A row of names each
     carrying a number turns the frame's quietest row into a readout, and the
     number is not what a reader chooses by. Each chip's tooltip and accessible
     name still carry it, which is where a number belongs when it answers a
     question you have to ask. */
  assert.doesNotMatch(stylesDeclarations, /\.scripture-study-face small/,
    "a count on every chip is a dashboard");
  assert.match(rail, /min-width: 24px/);
  assert.match(rail, /min-height: 24px/);
  assert.match(rail, /overflow-x: auto/);
  assert.match(rail, /overscroll-behavior-inline: contain/);
  assert.match(rail, /scroll-padding-inline/);
  /* The workspace popover inherits the shared --bg-float material (no fill
     override). There were two of them until 2026-07-30 and the selector named
     both; the group popover left the strip with the Manage control that was the
     only thing that opened it, so All Tabs is the register's one float and the
     claim is stated on it. */
  assert.match(
    rail,
    /\.popover-panel\.scripture-workspace-overflow-popover \{[\s\S]{0,180}background: rgb\(from var\(--bg-float\) r g b \/ 1\);/,
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
  assert.match(stylesSource, /\.scripture-workspace-tab \{[\s\S]{0,2000}min-width: 104px;/);
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

test("no dialog opens over the page to ask a study for its name", () => {
  /* THIS TEST USED TO DEFEND A FIX INSIDE A DIALOG THAT NO LONGER EXISTS.
     It was named "the group popover opens on its heading, not inside the rename
     field" and it pinned five things: `initialFocusRef={groupMenuHeadingRef}`,
     the absence of `initialFocusRef={groupRenameInputRef}`, the heading's
     `tabIndex={-1}` markup, its `:focus-visible` seal ring, and the field's own
     ring a Tab away.

     The defect it was written for was real and worth recording. The owner
     reported a keyboard focus ring drawn on the rename box the instant the
     manage dropdown opened on a MOUSE click; the ring rule was already
     `:focus-visible`, so the selector was not the bug — a focused text input
     matches :focus-visible however focus arrived, which is the HTML spec's own
     heuristic for controls that take keyboard input. The only fix was to stop
     putting focus in the field, so the popover landed focus on a tabindex="-1"
     heading instead, which rings only when the last interaction really was a
     keyboard one.

     Both the popover and the Manage control that opened it left the strip on
     2026-07-30. Renaming a study is on its chip in the study line: the chip
     becomes the field, in place, at its own size, and the field is focused
     because the reader asked for it — a double-click, F2, or the naming step
     that follows creating a study. There is no dialog and therefore no
     initial-focus decision to get wrong, which is the strongest available form
     of the fix.

     So the assertions are inverted. Nothing may open a dialog to name a study
     again, and the field the rename does use still answers a click the way §4
     says every field in the register does — with a caret and a wash, held in
     tests/focus-ring-modality-contract.test.ts. */
  assert.doesNotMatch(componentStatements, /groupMenuHeadingRef|groupMenuButtonRef|groupMenuOpen/,
    "the group popover is gone; nothing in the strip opens one");
  assert.doesNotMatch(componentStatements, /scripture-workspace-group-popover|scripture-workspace-popover-heading/);
  assert.doesNotMatch(stylesDeclarations, /scripture-workspace-group-popover|scripture-workspace-popover-heading/,
    "styling a popover the strip cannot open describes a product that does not exist");

  const line = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/components/StudyControl.tsx"),
    "utf8",
  );
  assert.match(line, /className="scripture-study-rename"/);
  /* 2026-07-30, the authoring gestures. This read

       assert.doesNotMatch(line, /Popover|role="dialog"/,
         "a study is renamed where its name is, not in a float over the page");

     and the reason stands while the regex no longer can: the line grew a
     chip context menu, in the strip's own idiom, holding Rename / New tab in
     this study / Close study. A menu is not what this test was written
     against. What it was written against is a float that OPENS OVER THE PAGE
     TO ASK A STUDY FOR ITS NAME — the retired Manage control's dialog, whose
     initial-focus decision was the defect above — and there is still no such
     thing anywhere: the menu's Rename lands in `beginRename`, which turns the
     chip into a field in the row, exactly where a double-click and F2 land.
     So the claim is restated as the two facts that carry it. */
  assert.doesNotMatch(line, /role="dialog"/,
    "no float in the line asks a study for its name");
  /* RESTATED 2026-08-03. The hook was `data-study-chip-rename` landing in
     `beginRename`, which turned a chip into a field in the row. There is no chip
     and no row: growing the control into a field would push the save status and
     the All Tabs door sideways for the length of a rename, which is the one real
     cost of putting the studies in a shared row. So the field opens in the
     surface the control already owns — anchored to the name, pre-filled and
     selected — and the two gestures that reach it are the menu's item and F2.
     Still nothing over the page asking a study for its name. */
  assert.match(line, /data-study-rename-open=""[\s\S]{0,240}setMode\("rename"\)/,
    "the list offers the rename, and it opens where the control already is");
  assert.match(line, /if \(event\.key !== "F2"\) return;[\s\S]{0,160}openMenu\("rename"\)/,
    "and F2 reaches the same field without opening the list first");
  /* The field's own ring, now one selector in the control's grouped rule rather
     than the last one before the brace — the list of focusable things grew when
     the chips became a control with a list and a two-button field, and the ring
     is declared once for all of them. */
  assert.match(
    stylesSource,
    /\.scripture-study-rename input:focus-visible,[\s\S]{0,120}outline: 2px solid var\(--study-gold\);/,
  );
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
  /* AT FULL STRENGTH, 2026-07-30. This read

       assert.doesNotMatch(componentStatements, /scripture-workspace-group-tab|scripture-workspace-group-head/,
         "no element among the TABS stands for a study");
       assert.match(componentSource, /className="scripture-workspace-active-group"/,
         "a study is named by the control that manages it");
       assert.match(componentSource, /aria-label=\{`Manage \$\{activeGroup\.label\}`\}/);

     and the narrowing — "among the TABS" — was doing real work: the actions
     cluster still held a control that carried the current study's name, so the
     unqualified claim would have been false. It was left narrow deliberately,
     with a note saying the smaller claim was the honest one until the study
     line arrived.

     It has arrived, and the qualification comes off. Nothing in the strip
     stands for a study under any class name the device has worn — not among the
     tabs, not beside them. Every one of the three is banned by name, because
     three different elements have carried this label in three weeks and the
     next one will have a fourth name.

     The one apparent exception is stated rather than exempted: a COLLAPSED study
     renders as a single proxy tab wearing its own name. That is not a label in
     the strip, it is a study that has folded itself into a tab, which is the one
     case where a study genuinely belongs among them. */
  assert.doesNotMatch(
    componentStatements,
    /scripture-workspace-group-tab|scripture-workspace-group-head|scripture-workspace-active-group/,
    "no element in the strip stands for a study",
  );
  assert.doesNotMatch(componentStatements, /data-study-active-group-manage/);
  /* The last exception closed on 2026-07-30. This read
       assert.match(componentSource, /const visibleLabel = collapsedProxy \? groupLabel : label/,
         "except a folded study, which IS a tab and wears its own name on it");
     — a collapsed study rendered as a single proxy tab wearing the STUDY's
     name, which was the one honest case of a study among the tabs. The register
     holds one study's tabs, so nothing folds and no tab stands for anything but
     itself. The claim needs no exception now: nothing in the strip names a
     study, in any state. */
  assert.doesNotMatch(componentStatements, /groupLabel : label|collapsedProxy/);

  /* And where the guarantee lands now. The bracket cost a 15px band above the
     row; the kicker cost a slot inside it; the Manage control cost 132px of the
     cluster and truncated the name there. The study line costs the tab row
     nothing at all — it is a second row in the frame's own band, which the page
     was already reserving as the window's drag region — and it names EVERY
     study rather than only the one you are in, which is more than the row ever
     did at any of its three prices. */
  const studyLine = readFileSync(
    resolve(import.meta.dirname, "../src/renderer/components/StudyControl.tsx"),
    "utf8",
  );
  assert.match(studyLine, /studyWorkspaceGroupLabel\(workspace, group, bookNames\)/,
    "a study is named by the control, in the same vocabulary every other surface uses");
  assert.doesNotMatch(
    studyLine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    /This study/,
    "the rail's placeholder is not coming back: every study has a name it can be told apart by",
  );

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

  /* AND THIS IS WHERE IT RETURNED, 2026-07-30 — the note above said to assert it
     here when it did. The kicker's mark was SLATE, Law 3's ink for something the
     app inferred, and that was correct while a study was something the app
     assembled out of whatever you happened to open. The only way a study comes
     into being now is a reader pressing the + on the study line, so the mark is
     SEAL, Law 3's ink for authorship, and the claim it makes is true.

     It is provenance and not state: every study chip carries it at one strength,
     because every study was made the same way. Which study you are in is told by
     the label's ink. "All" carries none — it is not a study, and a provenance
     mark on it would certify a thing nobody authored. */
  assert.match(stylesDeclarations, /\.scripture-study-seal \{[\s\S]{0,140}background: var\(--study-gold\);/,
    "an authored study wears the seal");
  assert.match(studyLine, /<span className="scripture-study-seal" aria-hidden="true" \/>/);
  /* RESTATED 2026-08-03. This read `.scripture-study-chip-seal` and checked that
     the retired "All" chip did not carry one. There is no chip and no All; the
     mark is on the control's own face and, in the list, in a column reserved
     whether or not it draws — an unnamed study's row must not hang two pixels
     left of every other one. */
  assert.match(studyLine, /<span className="scripture-study-row-seal" aria-hidden="true">/);

  /* "Separated from the ungrouped tabs by 24px of canvas rather than by a rule
     — the same argument that removed the Research divider." The ARGUMENT is
     general and holds; the rule that applied it is retired, because it opened
     each study's run after the first and the strip never holds two studies at
     once. It is asserted as the negative so it cannot come back as dead CSS. */
  assert.doesNotMatch(stylesDeclarations, /data-study-group-start/,
    "the interval between studies is the whole strip now: they are never in it together");
  /* THE INTERVAL HAS NOTHING LEFT TO SEPARATE, 2026-07-30. These two lines read

       assert.match(componentStatements, /const groupStart = tabIndex === 0 && groupIndex > 0;/);
       assert.match(componentSource, /data-study-group-start=\{groupStart \|\| undefined\}/);

     — 24px of canvas opening each study's run after the first, which is §05·2's
     "separated from the ungrouped tabs by 24px of canvas rather than by a rule".
     It was the last device in the strip that knew there was more than one study
     in it. The register holds one study's tabs, so there is no second run to
     open and `groupIndex > 0` can never be true; a rule that can only ever be
     false is a rule that describes a product that does not exist.

     The 24px survives in the SHEET, unreferenced, because the argument it
     carries — separate with interval, never with a line — is the general rule
     and outlives the one place it was applied. */
  assert.doesNotMatch(componentStatements, /groupStart|data-study-group-start/,
    "one study in the strip has no second run to open");

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
  /* The family lost `.scripture-workspace-active-group` on 2026-07-30, and for
     the opposite reason it lost `.scripture-workspace-reopen`: that control was
     rendered, and it was the last element in the strip that stood for a study.
     Two controls remain and both report on tabs. */
  const controls = /\.scripture-workspace-open,\s*\.scripture-workspace-overflow \{([^}]*)\}/
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
       again. .scripture-workspace-active-group:focus-visible was here too, and
       left with the Manage control later the same day. Every ring the STRIP
       owes is in this list; the study line's three are asserted below, in the
       same width and the same offset, because the line and the strip are one
       surface as far as a keyboard is concerned. */
    ".scripture-workspace-context-menu button:focus-visible",
    ".scripture-workspace-open:focus-visible",
    ".scripture-workspace-overflow:focus-visible",
    ".scripture-workspace-persistence button:focus-visible",
  ]) {
    assert.ok(focusSelectors.includes(selector), `${selector} must carry the register's focus mark`);
  }
  const lineFocusStart = rail.indexOf(".scripture-study-face:focus-visible");
  assert.ok(lineFocusStart > 0, "the study control must declare a focus ring");
  const lineFocus = rail.slice(lineFocusStart, rail.indexOf("}", lineFocusStart) + 1);
  /* Four now rather than three, and the list is longer because the control is
     smaller: what was a row of chips plus a + is one face, the rows of its list,
     the field, and the field's two buttons. Every one of them is reachable by a
     keyboard, so every one of them owes the register's mark at the same width
     and the same offset — the control and the strip are one surface as far as a
     keyboard is concerned. */
  for (const selector of [
    ".scripture-study-face:focus-visible",
    ".scripture-study-row:focus-visible",
    ".scripture-study-rename input:focus-visible",
    ".scripture-study-rename-actions button:focus-visible",
  ]) {
    assert.ok(lineFocus.includes(selector), `${selector} must carry the register's focus mark`);
  }
  assert.match(lineFocus, /outline: 2px solid var\(--study-gold\);\s*outline-offset: 2px;/);
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
  /* The end marker was `{activeGroup &&` — the Manage control that used to
     follow the status region in the cluster, and which left the strip on
     2026-07-30. The region is still the cluster's first child, so the slice now
     ends at the control that follows it. */
  const status = section(componentSource, 'className="scripture-workspace-actions"', "{(allGroups.length > 0");
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

test("the overview is a door, not a readout, and the ordinals live inside it", () => {
  /* B4 asked for a count on this control — "a +7 count opens the rest as a
     list" — and these two lines pinned it:

       assert.match(componentSource, /const hiddenTabCount = tabsInStrip === null \? 0 : Math\.max\(0, registerSize - tabsInStrip\)/);
       assert.match(componentSource, /className="scripture-workspace-overflow-count">\{`\+\$\{hiddenTabCount\}`\}/);

     They were right while the strip WAS the workspace and "the rest" was one
     number meaning one thing. The register holds one study at a time as of
     2026-07-30, so most of "the rest" is other studies — named on the study
     line above, each with its own count in its own tooltip — and what a badge
     had left to report was a tab or two past the edge of a row you can pan with
     a wheel. That is chrome reporting on chrome.

     So the control goes back to being what it is: the quiet door to every tab
     in every study. The count survives in its accessible name, where a number
     answers a question rather than sitting in the frame asking one. */
  assert.doesNotMatch(componentStatements, /hiddenTabCount|tabsInStrip|scripture-workspace-overflow-count/);
  assert.doesNotMatch(declarationsOnly(registerSource), /scripture-workspace-overflow-count/,
    "styling a badge the strip does not render describes a product that does not exist");
  assert.match(componentSource, /aria-label=\{`Show all \$\{totalTabs\} study tabs in \$\{allGroups\.length\}/);
  assert.match(componentSource, /<span aria-hidden="true"><OverflowGlyph \/><\/span>/);

  // B5: numbers appear in the overview's list, never on the tabs.
  assert.match(componentSource, /const ordinal = studyWorkspaceTabOrdinal\(workspace, tab\.id\)/);
  assert.match(componentSource, /className="scripture-workspace-overflow-shortcut"/);
  assert.match(componentSource, /data-study-tab-ordinal=\{ordinal\}/);
  const tablist = section(componentSource, 'role="tablist"', '<div className="scripture-workspace-actions"');
  assert.doesNotMatch(tablist, /⌘/);
});
