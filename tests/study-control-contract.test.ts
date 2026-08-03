import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  activeStudyGroupId,
  studyChoices,
  studyLandingTabId,
} from "../src/renderer/components/StudyControl.js";
import {
  createStudyWorkspace,
  createStudyWorkspaceGroup,
  openPassageWorkspaceTab,
  renameStudyWorkspaceGroup,
  selectStudyWorkspaceTab,
  STUDY_WORKSPACE_GROUP_LIMIT,
  studyWorkspaceOrdinalTabId,
  studyWorkspaceTabPromoteAvailability,
  type PassageViewState,
  type StudyWorkspaceStateV2,
} from "../src/renderer/utils/studyWorkspace.js";

/**
 * THE STUDY CONTROL — one object at the end of the register, and the only place
 * a study is named.
 *
 * FOUR DEVICES HAVE CARRIED A STUDY'S NAME NOW. A bracket over the first
 * member's wrap; a kicker at the head of its run; a Manage control in the
 * actions cluster; a row of chips in the drag band. The first three were
 * retired for one reason wearing three costumes — a name given a fixed width is
 * a name truncated at the moment it is being read — and the fourth for a
 * different one, measured on 2026-08-03: chips in the band sat under the
 * window's own buttons at `x 14–66, y 14–26`, made the band ungrabbable because
 * everything standing in it opts out of the drag region, and in fullscreen laid
 * a row of controls flush on the screen's top edge where the menu bar drops.
 *
 * Rev 05 §05·2 had ruled on the placement before any of them: "a label above
 * the strip creates a second strip. It belongs in the strip, at the head of its
 * members." The band's chips WERE that second strip. Its alternative — the head
 * of the members — is the placement that failed twice. This file holds the
 * third position: in the strip, at the END of it, where no fixed width has to
 * be given to a name.
 *
 * What is claimed here:
 *   · the band above the strip is EMPTY and renders nothing interactive;
 *   · the control lives in the register's own row, before the cluster that
 *     reports on tabs, and is passed to the strip rather than built by it;
 *   · the name is never capped, and the count counts the REST;
 *   · no key is printed that the app does not bind;
 *   · it never leads a selection, only follows one — and it holds no state
 *     about which study is current, which makes that structural;
 *   · a tab can still be dragged into another study, because the list is open
 *     for the length of a drag and its rows are the targets;
 *   · the seal marks a study the reader has NAMED, and nothing else.
 */

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

const control = read("src/renderer/components/StudyControl.tsx");
const strip = read("src/renderer/components/ScriptureWorkspaceTabs.tsx");
const page = read("src/renderer/components/ScripturePage.tsx");
const app = read("src/renderer/app.tsx");
const styles = read("src/renderer/styles.css");

/** The sheets and components record a retirement by quoting what was retired. */
const statementsOnly = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const controlStatements = statementsOnly(control);
const pageStatements = statementsOnly(page);

/** The declaration block of a selector, without the sheet's prose around it. */
function rule(selector: string): string {
  const head = styles.indexOf(`${selector} {`);
  assert.notEqual(head, -1, `${selector} is not in the sheet`);
  return styles.slice(head, styles.indexOf("}", head));
}

function view(book: string, chapter: number): PassageViewState {
  return {
    book,
    chapter,
    packageId: "BSB",
    verse: 1,
    verseOffset: 0,
    scrollTop: 0,
    margin: { activeTab: "overview", scope: null, scrollTopByTab: {}, wordsFollowingReading: true },
  };
}

/** Two studies: Acts (two tabs) and John (two), with John's second tab last-active. */
function twoStudies(): StudyWorkspaceStateV2 {
  const base = createStudyWorkspace(view("ACT", 19), {
    groupId: "acts-study",
    passageTabId: "acts-19",
  });
  const withSibling = openPassageWorkspaceTab(base, {
    id: "acts-19-kjv",
    sourceTabId: "acts-19",
    view: view("ACT", 19),
    duplicate: true,
  }).state;
  const second = createStudyWorkspaceGroup(withSibling, {
    id: "john-study",
    passageTabId: "john-3",
    view: view("JHN", 3),
  });
  assert.equal(second.outcome, "opened");
  const withJohnSibling = openPassageWorkspaceTab(second.state, {
    id: "john-3-kjv",
    sourceTabId: "john-3",
    view: view("JHN", 3),
    duplicate: true,
  }).state;
  return selectStudyWorkspaceTab(withJohnSibling, "acts-19");
}

const bookNames = { ACT: ["Acts"], JHN: ["John"] } as Record<string, string[]>;

test("there is no band above the register, and that is the whole of the repair", () => {
  /* THE ASSERTION THAT WOULD HAVE CAUGHT ALL THREE FAULTS, and the one that
     stops them coming back. The chips lived in a 24px row the window was dragged
     by; the fix was to get them out of it, and this test first held the row to
     being a LEAF — nothing in it, so nothing in it could be under the window's
     buttons or in the way of the drag.

     Then the row itself went, hours later and for the reason the leaf assertion
     made visible: once it was empty its only job was to be dragged by, and a
     drag region is not a row. It is a property a row can carry, and the register
     carries it — same width, the row a hand is already near, and its controls at
     the two ENDS with most of the window free between them. The frame went from
     54 to 40 and the tabs came up to within 8px of the window's own top edge.

     So the claim is stronger than a leaf: there is no row to fill. */
  assert.doesNotMatch(page, /scripture-study-line/, "nothing renders a band");
  assert.doesNotMatch(styles, /\.scripture-study-line\b/, "and the sheet declares none");
  assert.ok(
    page.indexOf("<ScriptureWorkspaceTabs") < page.indexOf('id="scripture-workspace-panel"'),
    "the register meets the page with nothing in between: the fillets join there",
  );

  /* THE FRAME'S TOP EDGE IS THE REGISTER, and the register keeps room for the
     system's own buttons — minus whatever the rail is already standing in. In
     fullscreen macOS hides them and the reserve is zero, which is the same rule
     rather than an exception to it. The arithmetic is held in
     tests/quire-frame-top-edge-contract; what is claimed here is that the studies
     did not simply move into a second problem. */
  assert.match(styles, /--register-strip: 40px;/);
  assert.match(styles, /--frame-top: var\(--register-strip\);/);
  assert.match(rule(".scripture-workspace-bar"), /-webkit-app-region: drag;/);
  assert.match(
    rule(".scripture-workspace-bar"),
    /padding: 0 var\(--page-inset\) 0 max\(0px, calc\(var\(--os-buttons\) - var\(--rail-flow-w\)\)\);/,
  );
  assert.match(styles, /\.app-shell\[data-fullscreen\] \.scripture-workspace-bar \{\s*padding-left: 0;\s*\}/);

  /* AND THE WINDOW IS THE ONLY THING THAT KNOWS whether it is fullscreen. The
     three things that look like they could answer it from the DOM cannot:
     `document.fullscreenElement` reports only JS-initiated fullscreen, the
     display-mode media query is for installed web apps, and innerHeight against
     screen.height is wrong on any display with a notch — measured 949 against
     982 while fullscreen on this machine. */
  const main = read("src/electron/main.ts");
  assert.match(main, /win\.on\("enter-full-screen", reportFullScreen\);/);
  assert.match(main, /win\.on\("leave-full-screen", reportFullScreen\);/);
  assert.match(main, /ipcMain\.on\("app-window-fullscreen-ready"/,
    "a renderer that reloads while fullscreen must not start out laying out for buttons that are not there");
  assert.match(app, /window\.api\.appWindow\.onFullScreenChange\(setWindowFullScreen\)/);
  assert.match(app, /data-fullscreen=\{windowFullScreen \|\| undefined\}/);
});

test("the control stands in the register, before the cluster that reports on tabs", () => {
  /* PLACEMENT, and the two positions it may not have.

     Not at the head of the members: an earlier 96px box there "clipped the
     study name and shouldered a flush-start tab off the page's corner", and
     [data-flush-start] still lets the first tab claim the page's own top-left
     corner outright.

     Not between the strip and the page: the active tab's paper fill and its two
     fillets join it to --bg-reading at the strip's baseline, and anything
     inserted there severs that joint. The DOM order below is what stops it. */
  assert.ok(
    page.indexOf('className="scripture-study-line"') < page.indexOf("<ScriptureWorkspaceTabs"),
    "the drag band stands above the strip",
  );
  assert.ok(
    page.indexOf("<ScriptureWorkspaceTabs") < page.indexOf('id="scripture-workspace-panel"'),
    "and the strip still meets the page with nothing in between",
  );

  /* IT IS A SLOT, and the reason is layout rather than taste. The control
     right-aligns beside the cluster, and that is a fact about the strip's own
     flexbox — a sibling positioned over the row would have to measure a cluster
     whose width changes with the save status. So the strip holds the node and
     knows nothing about studies; every prop it needs is passed where the rest
     of the workspace props are. */
  assert.match(page, /studies=\{\(\s*<StudyControl/);
  assert.match(strip, /studies\?: React\.ReactNode;/);
  assert.ok(
    strip.indexOf("{studies}") < strip.indexOf('<div className="scripture-workspace-actions"'),
    "the study comes before the controls that report on its tabs: the reader reads outward from the page",
  );
  assert.doesNotMatch(statementsOnly(strip), /studyChoices|activeStudyGroupId|StudyControl/,
    "the strip renders the node and does not construct it");

  /* TWO AUTO MARGINS IN ONE ROW ARE NOT TWICE ONE AUTO MARGIN: the free space
     is SPLIT and the pair is flung to opposite ends. The end-margin moves onto
     the control and the cluster's own is cancelled, in the sheet, where the two
     can be read together. */
  assert.match(rule(".scripture-study-control"), /margin-left: auto;/);
  assert.match(styles, /\.scripture-study-control ~ \.scripture-workspace-actions \{\s*margin-left: 0;\s*\}/);

  /* IT IS CENTRED WHILE THE TABS SIT ON THE BASELINE. A tab is a piece of the
     page pulled up above the register and its fillets join it to the paper
     there; this has no fillet and no business pretending to. Vertical alignment
     is the second signal, after the sheet's existing sans-against-mono, that
     stops the row reading as one long strip of the same kind of thing. */
  assert.match(rule(".scripture-study-control"), /align-items: center;/);
  assert.match(rule(".scripture-workspace-bar"), /align-items: flex-end;/);
});

test("the name is never given a fixed width, which is what retired three devices", () => {
  const face = rule(".scripture-study-face");
  const name = rule(".scripture-study-name");
  assert.doesNotMatch(face, /max-width: \d+px/,
    "a study name capped at a pixel width is the defect that killed the 96px box and the 132px cluster label");
  assert.doesNotMatch(name, /max-width|width: \d+px/);
  assert.match(face, /max-width: 100%/, "it may only be bounded by the room the row actually has");

  /* AND IT IS ONE OBJECT RATHER THAN A ROW, which is what buys the width. A row
     of chips in the register would compete with the tabs for the same
     horizontal space and would have to pan — a second sideways-scrolling region
     inside a 30px strip, which is the argument against putting them here at
     all. Nothing in this control scrolls. */
  assert.doesNotMatch(rule(".scripture-study-control"), /overflow-x: auto|scrollbar-width/);
  assert.doesNotMatch(styles, /\.scripture-study-line-chips/,
    "the panning chip row is gone, not hidden");
});

test("the count counts the rest, and it is the only thing saying a set exists", () => {
  /* `+5` means five OTHER studies. The `+n` tab count retired on 2026-07-30
     failed because its number meant two things at once — some of it was a
     scroll you could pan away and the rest was other studies entirely — and a
     count with two meanings is worse than no count.

     It is also the whole affordance. Without it nothing on screen says there is
     a list behind this control, which is exactly how the playlist menu in the
     Listen room came to be a feature that was not there. */
  assert.match(control, /const others = Math\.max\(0, choices\.length - 1\);/);
  assert.match(control, /className="scripture-study-rest" aria-hidden="true">\{`\+\$\{others\}`\}/);
  assert.match(control, /const otherWord = `\$\{others\} other \$\{others === 1 \? "study" : "studies"\}`;/);

  // At one study there is no rest, so nothing is drawn: `+0` is a control
  // advertising a decision the reader does not have.
  const one = createStudyWorkspace(view("ACT", 19), { groupId: "acts-study", passageTabId: "acts-19" });
  assert.equal(studyChoices(one, bookNames).length, 1);
  assert.equal(studyChoices(twoStudies(), bookNames).length, 2);
  assert.match(control, /\{others > 0 && \(/);

  /* The number a screen reader hears is the same number, in words — except
     while a tab is in the air, when the visible copy is an invitation and the
     accessible name is the same sentence. They are one sentence and a screen
     reader is in the middle of the same gesture. */
  assert.match(control, /aria-label=\{inviting/);
  assert.match(control, /`Study: \$\{label\}, \$\{tabs\}, \$\{otherWord\}`/);
  assert.match(control, /const hint = "Drag here to change study";/);
  assert.match(control, /const inviting = dragPhase !== null;/);
  assert.match(control, /data-study-face-inviting=\{inviting \|\| undefined\}/);
  /* It says it ONCE. A hint that repeats itself does not trust the reader to
     have read it, and this app refuses a pulse everywhere else. */
  assert.doesNotMatch(
    rule(".scripture-study-invite"),
    /infinite|alternate/,
    "no loop and no pulse: the invitation is stated, not insisted on",
  );

  /* PER-STUDY COUNTS MOVED INTO THE LIST, which is where a count answers a
     question rather than asking one. On a row of chips a number beside every
     name turned the frame's quietest row into a readout; in a list it is the
     second column every list of containers has. */
  assert.match(control, /<span className="scripture-study-row-count" aria-hidden="true">/);
  assert.match(rule(".scripture-study-row-count"), /font-variant-numeric: tabular-nums;/);
});

test("no key is printed that the app does not bind", () => {
  /* ⌘1–9 selects a TAB. app.tsx binds it through `studyWorkspaceOrdinalTabId`,
     and printing it beside a study — which is what the first drawing of this
     list did — promises a key that would take the reader somewhere else. It is
     the same fault the chips refused `aria-haspopup` over: announcing a
     shortcut that does not exist is worse than announcing nothing. */
  assert.match(app, /studyWorkspaceOrdinalTabId\(current, Number\(event\.key\)\)/);
  assert.equal(studyWorkspaceOrdinalTabId(twoStudies(), 1), "acts-19");
  assert.doesNotMatch(controlStatements, /⌘/, "no command key is drawn on a study row");

  // F2 is real and is the one this control claims: it opens the field.
  assert.match(control, /aria-keyshortcuts="F2"/);
  assert.match(control, /if \(event\.key !== "F2"\) return;/);
});

test("the study it names is the study the page is in, and it holds no state about that", () => {
  /* Ctrl+Tab, ⌘1–9, an overview row, reopening a closed tab and opening a
     connection into another study all move the active tab, and some of those
     cross studies. The control may never block one, and it may never disagree
     with the page.

     THE STRONGEST FORM OF "THESE MUST AGREE" IS "THESE ARE THE SAME VALUE".
     Which study this names is `workspace.tabsById[activeTabId].groupId`. There
     is no filter, no follow effect, and no optimistic write to snap back. */
  const workspace = twoStudies();
  assert.equal(activeStudyGroupId(workspace), "acts-study");
  assert.equal(activeStudyGroupId(selectStudyWorkspaceTab(workspace, "john-3-kjv")), "john-study");
  assert.match(control, /return workspace\.tabsById\[workspace\.activeTabId\]\?\.groupId \?\? null;/);
  assert.doesNotMatch(controlStatements, /studyFilterId|studyFilter/);
  assert.doesNotMatch(pageStatements, /studyFilterId|studyFilter/);

  // The only state it owns is about its own surface — which list is open, which
  // mode it is in, and what is in the field — and none of it outlives the
  // popover. Three, and a fourth would be a study fact kept in a component.
  assert.equal(
    [...controlStatements.matchAll(/useState[<(]/g)].length,
    3,
    "anchor, mode and the rename draft: nothing about which study is current",
  );
});

test("a study opens on the tab it was last on", () => {
  // The model records it and the control reads it. A study you come back to
  // opens where you left it; the rail's switcher documented this in a comment
  // three lines above code that landed on `tabs[0]` instead, which is the
  // defect that took the switcher out.
  const workspace = twoStudies();
  const john = workspace.groups.find((group) => group.id === "john-study")!;
  assert.equal(john.lastActiveTabId, "john-3-kjv");
  assert.equal(studyLandingTabId(workspace, john), "john-3-kjv");

  // Fallbacks, in order, for a group whose record has been trimmed by a close.
  assert.equal(
    studyLandingTabId(workspace, { ...john, lastActiveTabId: "gone" }),
    john.homePassageTabId,
  );
  assert.equal(
    studyLandingTabId(workspace, { ...john, lastActiveTabId: "gone", homePassageTabId: "gone" }),
    "john-3",
  );
  // Membership is double-booked, and a tab whose two records disagree is inert
  // everywhere else in the model, so it is inert here.
  assert.equal(
    studyLandingTabId(workspace, { ...john, tabIds: ["acts-19"], lastActiveTabId: "gone", homePassageTabId: "gone" }),
    null,
  );

  assert.match(control, /const landing = studyLandingTabId\(workspace, group\);/);
  assert.match(control, /if \(landing && landing !== workspace\.activeTabId\) return await onSelectTab\(landing\);/);
  /* The return value is for "New tab in this study" alone: a tab opens into the
     study the page is IN, so a refused landing must not be followed by opening
     one somewhere else. A row's own press ignores it, because a refusal leaves
     the control where the page still is either way. */
  assert.match(control, /if \(groupId && await openStudy\(groupId\)\) onNewTab\(\);/);
  assert.doesNotMatch(controlStatements, /onExpandStudy|collapsed/);
});

test("a tab can still be dragged into another study, and the open list is why", () => {
  /* THE REGRESSION THIS DESIGN WOULD OTHERWISE HAVE SHIPPED. A tab is moved
     between studies by dragging it onto a target, and `studyDropTargetId`
     hit-tests the document for one, because the drag sets pointer capture on
     the tab and a captured pointer routes every event to the capturing element.
     With the chips gone there was exactly ONE target on screen — the study the
     tab is already in — which that function excludes by design. The gesture
     would have died silently, with nothing failing anywhere.

     So the list opens for the length of a drag and its rows ARE the targets.
     Nothing about the mechanism changed, and the attribute is why: what is
     hit-tested is "a thing that stands for a study". */
  assert.match(control, /dragPhase: "reorder" \| "carry" \| null;/);
  /* AND IT OPENS ON CARRY, NOT ON REORDER · 2026-08-03. It used to open the
     moment any drag began, so sliding a tab two places along its own row hung a
     252px panel over the page — about a decision the reader was not making. The
     run answers a reorder by itself; this waits until the tab has left it. */
  assert.match(control, /if \(dragPhase !== "carry"\) return;\s*openMenu\("list"\);/);
  assert.match(control, /return \(\) => \{ setAnchor\(null\); setMode\("list"\); \};/);
  assert.match(control, /data-study-target=""/);
  assert.match(control, /data-study-group-id=\{choice\.groupId\}/);
  assert.match(strip, /const target = element\?\.closest\("\[data-study-target\]"\);/);

  /* IT TAKES NO FOCUS WHILE IT DOES. A pointer drag has not asked for the
     keyboard, and pulling focus mid-gesture leaves it somewhere arbitrary once
     the tab lands. */
  assert.match(control, /initialFocus=\{dragPhase === null\}/);

  /* AND THE DESTINATION SAYS WHAT IT WILL BE, not where the pointer is. A rule
     under a row only repeats what the pointer already said; the count is
     already on the row, so the row states the outcome instead — and everything
     drawn was already there, which is what keeps this from becoming the browser
     drop-well the register was drawn to refuse. */
  assert.match(control, /const landing = dropTargetStudyId === choice\.groupId;/);
  assert.match(control, /\{landing \? choice\.tabCount \+ 1 : choice\.tabCount\}/);
  /* THE GROUND IS NEUTRAL AND THE MARK IS GOLD, which is Law 3 and not a
     preference: the seal's hue MARKS a thing and never fills one. It was drawn
     as a warm wash first and tests/study-workspace-tabs-premium-contract caught
     it within the hour, which is the whole reason that sweep exists. */
  assert.match(
    rule('.scripture-study-row[data-study-drop-target]'),
    /background: color-mix\(in srgb, var\(--text-primary\) 10%, transparent\);/,
  );
  assert.match(
    rule('.scripture-study-row[data-study-drop-target] .scripture-study-row-count'),
    /color: var\(--study-gold\);/,
  );
  assert.doesNotMatch(styles, /\.scripture-study-row\[data-study-drop-target\]::before/,
    "the 2px rule was carried over from the chips and says less than the count does");
});

test("a picked-up tab is lifted, not greyed out", () => {
  /* It used to go to `opacity: 0.55` and stay exactly where the layout put it,
     which says the wrong thing twice. Half opacity is this app's own idiom for
     DISABLED — the tab plus at its cap, a menu item that cannot run — so taking
     hold of a tab made it look like the one thing you could no longer act on.
     And a tab that does not move while the pointer does is not being dragged. */
  const dragging = rule(".scripture-workspace-tab-wrap.is-dragging");
  assert.match(dragging, /opacity: 1;/);
  assert.match(dragging, /transform: translate\(var\(--tab-drag-x, 0px\), -1px\);/);
  assert.match(dragging, /filter: drop-shadow/);
  assert.doesNotMatch(dragging, /scale\(/,
    "this tab's fillets sweep into the paper at the strip's baseline; a scaled tab tears that joint open");

  /* AND IT HANDS OVER. Once the pointer is on a study the destination is doing
     the talking, so the tab eases out of the way: two things claiming the eye
     at the moment of a drop is one too many, and the one that should win is the
     one that says what will happen. */
  assert.match(strip, /data-drag-away=\{\(dragging && overStudy\) \|\| undefined\}/);
  assert.match(rule(".scripture-workspace-tab-wrap.is-dragging[data-drag-away]"), /opacity: 0\.5;/);
});

test("a carried tab can found a study, on the row that is not a study yet", () => {
  /* THE SAME DROP, ROUTED TO A MUTATION THAT ALREADY EXISTS. "New study from
     this tab" is in the tab's own context menu; what it did not have was a way
     to reach it with the tab in hand — Safari's drag-a-tab-out-to-a-new-window,
     mapped onto studies.

     The row has no group id, because the group is what the drop would create, so
     it borrows a sentinel. That sentinel travels every pipe the real ids travel
     — the hit-test, the strip's report, the landing paint — and is read back at
     exactly one place, the drop. A second callback for "and also this row" would
     be a second drag gesture to keep in step with the first. */
  assert.match(strip, /export const START_STUDY_TARGET = "start-a-new-study";/);
  assert.match(control, /"data-study-group-id": START_STUDY_TARGET,/);
  assert.match(strip, /if \(origin\.studyId === START_STUDY_TARGET\) \{\s*await handlePromoteTab\(tabId\);/);

  /* GATED ON THE MODEL'S OWN ANSWER, because a target that lights up and then
     refuses is worse than one that never lights. The model says no to a research
     tab and to the last passage in a study — a study with nothing left in it is
     not a study — and that answer is its to give. */
  assert.match(control, /studyWorkspaceTabPromoteAvailability\(workspace, draggedTabId\) === "direct"/);
  assert.match(control, /dragPhase === "carry"/);
  const workspace = twoStudies();
  const acts = workspace.groups.find((group) => group.id === "acts-study")!;
  assert.equal(studyWorkspaceTabPromoteAvailability(workspace, acts.tabIds[0]!), "direct");
  const single = createStudyWorkspace(view("ACT", 19), { groupId: "solo", passageTabId: "acts-19" });
  assert.equal(
    studyWorkspaceTabPromoteAvailability(single, "acts-19"),
    "unavailable",
    "the last passage in a study cannot leave it: what is left would not be a study",
  );

  /* IT KEEPS ITS OWN LABEL when it lights. There is no count to tick up — the
     study it would land in does not exist yet — and inventing a "1" would be the
     app answering a question about a thing it has not made. */
  assert.match(styles, /\[data-study-start\]\[data-study-drop-target\] \{[\s\S]{0,200}background: color-mix\(in srgb, var\(--text-primary\) 10%, transparent\);/);
  assert.doesNotMatch(control, /data-study-start[\s\S]{0,400}tabCount \+ 1/);
});

test("renaming happens in the control's own surface, never in a dialog over the page", () => {
  /* Every question this app asks, it asks in its own window, in its own type,
     on the reader's own page. The chip became its own field in place, which was
     what replaced a dialog asking a study for four words.

     There is no chip now, and growing this control into a field would push the
     save status and the All Tabs door sideways for the length of a rename — the
     one real cost of putting the studies in a shared row. So the field opens in
     the surface the control already owns, anchored to it, pre-filled and
     selected: beside the name rather than on it, and still nothing over the
     page asking a question. */
  assert.doesNotMatch(controlStatements, /window\.prompt|window\.confirm|window\.alert/);
  assert.match(control, /type MenuMode = "list" \| "rename";/);
  /* THE NAME ARRIVES SELECTED, so the first keystroke replaces it — a study is
     usually being named rather than edited. ON FOCUS rather than in a layout
     effect, and the difference is a race this lost: the popover focuses the
     field in its own layout effect, and a parent selecting in one of its own is
     only correct while the two run in that order. They stopped. Selecting where
     focus actually lands cannot be out of order with focus. */
  assert.match(control, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(control, /maxLength=\{60\}/);
  // Escape abandons the name and leaves the study as it was. An unnamed study
  // keeps its derived reference — "Acts 19" — which is a true name.
  assert.match(control, /if \(event\.key !== "Escape"\) return;/);
  // Disabled on a blank name rather than allowed and ignored: the store trims
  // and returns silently, so a live button would close the field, change
  // nothing, and leave the reader having watched a control succeed at that.
  assert.match(control, /disabled=\{renameDraft\.trim\(\)\.length === 0\}/);

  // A study is born unnamed and is invited to name itself at once, by nonce
  // rather than by a synthetic click on a control in another component.
  assert.match(control, /namingNonceRef\.current === namingRequest\.nonce/);
  assert.match(control, /openMenu\("rename"\);/);
});

test("the seal marks a study the reader has named, and nothing else", () => {
  /* Law 3's ink certifies an AUTHORED thing. Every study is authored, so a seal
     on every one distinguishes nothing. What the reader actually did is give
     this study a NAME; a study still wearing its derived reference has been
     made and not yet claimed, and goes unmarked until it is. */
  const workspace = twoStudies();
  assert.deepEqual(studyChoices(workspace, bookNames).map((choice) => choice.named), [false, false]);
  const named = renameStudyWorkspaceGroup(workspace, "acts-study", "Sunday evening");
  assert.deepEqual(studyChoices(named, bookNames).map((choice) => choice.named), [true, false]);
  assert.match(control, /named: group\.label\.kind === "custom",/);
  assert.match(control, /\{current\.named && <span className="scripture-study-seal" aria-hidden="true" \/>\}/);

  /* BOTH MARKS KEEP THEIR COLUMN. The seal draws on named studies only, so
     rendering it inline left an unnamed row's name hanging two pixels left of
     every other one — a ragged left edge in a list of four words, which reads
     as a rendering fault rather than as an absence of provenance. */
  assert.match(control, /<span className="scripture-study-row-seal" aria-hidden="true">/);
  assert.match(rule(".scripture-study-row-seal"), /width: 2px;/);
  assert.match(rule(".scripture-study-row-tick"), /width: 12px;/);
});

test("every item in the list routes to a mutation that already exists", () => {
  /* Nothing here is a second way to do something the model does not already do,
     and nothing here adds an exception to a refusal. Close study goes through
     `closeStudyWorkspaceGroup`, which refuses the last study and demands a
     confirmation for one holding several tabs. */
  for (const hook of [
    "data-study-rename-open=\"\"",
    "data-study-new-tab=\"\"",
    "data-study-close=\"\"",
    "data-study-start=\"\"",
  ]) assert.ok(control.includes(hook), `${hook} is missing`);
  assert.match(control, /data-study-close-availability=\{closeAvailability\}/);
  assert.match(control, /disabled=\{closeAvailability === "unavailable"\}/);
  assert.match(control, /closeAvailability === "decision" \? "Close study…" : "Close study"/);

  /* THE CURRENT STUDY IS `aria-checked` ON A `menuitemradio`, not `aria-current`
     on a plain item. This is a list of places with exactly one of them chosen,
     which is what that role is for; the chips used `aria-current` because they
     were a toolbar, and there is one selection in this frame — the tab. A list
     is a different shape and takes the role that fits it. */
  assert.match(control, /role="menuitemradio"/);
  assert.match(control, /aria-checked=\{choice\.current\}/);
  assert.match(control, /aria-haspopup="menu"/);
  assert.match(control, /aria-expanded=\{open\}/);
});

test("the start item gauges the 16-study cap the way the tab plus gauges 64", () => {
  // It reuses the palette's own create-a-study path rather than a second one: a
  // study is born holding the passage you are on, with its name already a
  // field. `createStudyWorkspaceGroup` cannot make an empty study — the
  // signature requires a passage — so "make a study, then drag tabs in" is not
  // expressible and is not pretended at.
  assert.match(app, /onStartStudy=\{startStudyFromCurrentCanvas\}/);
  assert.match(control, /const atStudyCapacity = studyCount >= STUDY_WORKSPACE_GROUP_LIMIT;/);
  assert.match(control, /data-study-start-disabled=\{atStudyCapacity \|\| undefined\}/);
  assert.match(control, /aria-disabled=\{atStudyCapacity \|\| undefined\}/);
  assert.match(control, /if \(atStudyCapacity\) return;/);
  // The copy states the cap in the unit the cap counts. The tab plus said
  // "studies" for its 64 tabs until 2026-07-30; this one is the same shape with
  // the other number, and it may not borrow the wrong noun either.
  assert.match(control, /All \$\{STUDY_WORKSPACE_GROUP_LIMIT\} studies open/);
  assert.match(control, /\$\{studyCount\} of \$\{STUDY_WORKSPACE_GROUP_LIMIT\} open/);
  assert.doesNotMatch(controlStatements, /\$\{STUDY_WORKSPACE_GROUP_LIMIT\} tabs/);
  assert.equal(STUDY_WORKSPACE_GROUP_LIMIT, 16);
  // And it stays in the list at capacity rather than leaving it: a control that
  // vanishes at the limit teaches that the limit is a bug.
  assert.match(
    styles,
    /\[data-study-start\]\[data-study-start-disabled\] \{\s*opacity: 0\.38;\s*cursor: default;\s*\}/,
  );
});

test("no renderer state about studies reaches a persisted field", () => {
  /* StudyWorkspaceStateV2 is round-tripped through a canonical-JSON equality
     check on every save, and the Electron validator has to mirror the
     renderer's shape exactly or the write is refused. Which study is on screen
     is a fact the model already holds — `activeTabId` — and this control adds
     nothing to it. */
  const settings = read("src/electron/study-workspace-settings.ts");
  const model = read("src/renderer/utils/studyWorkspace.ts");
  for (const [name, source] of [["the validator", settings], ["the model", model]] as const) {
    assert.doesNotMatch(source, /filterStudyId|studyFilter|studyLine/,
      `${name} must not learn about the study control`);
  }
  /* And `collapsed` is the reverse case, recorded here because the temptation
     is to tidy it away: the field STAYS in both, untouched, so a workspace
     saved with a folded study still round-trips. */
  assert.match(settings, /collapsed/);
  assert.match(model, /export function toggleStudyWorkspaceGroup\(/);
  assert.doesNotMatch(statementsOnly(app), /toggleStudyWorkspaceGroup/);
});
