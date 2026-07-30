import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  studyLineActiveStudyId,
  studyLineChips,
  studyLineLandingTabId,
  studyLineRestsMinimal,
} from "../src/renderer/components/StudyLine.js";
import {
  createStudyWorkspace,
  createStudyWorkspaceGroup,
  openPassageWorkspaceTab,
  renameStudyWorkspaceGroup,
  selectStudyWorkspaceTab,
  STUDY_WORKSPACE_GROUP_LIMIT,
  studyWorkspaceGroupCloseAvailability,
  studyWorkspaceOrdinalTabId,
  studyWorkspaceStripTabIds,
  type PassageViewState,
  type StudyWorkspaceStateV2,
} from "../src/renderer/utils/studyWorkspace.js";

/**
 * THE STUDY LINE — the frame's top row, and the only place a study is named.
 *
 * Three devices have carried a study's name in three weeks: a bracket over the
 * first member's wrap, a kicker at the head of its run, and a Manage control in
 * the actions cluster. Each was retired for the same reason in a different
 * costume — a name set among tabs is a name truncated at the moment it is being
 * read, and a name set beside them spends the row on the one study you are
 * already in. Every one of those retirements was defended by a contract, and
 * the device that replaced them was not, which is what this file is for.
 *
 * What is claimed here:
 *   · the line is a row of the FRAME, above the strip, outside the tablist and
 *     outside the toolbar, and it holds the window's drag band;
 *   · it names studies and the strip does not;
 *   · it never leads a selection, only follows one — and it holds no state at
 *     all, which is what makes that structural rather than careful;
 *   · it rests until there is something to choose between;
 *   · the seal marks a study the reader has NAMED, and nothing else.
 */

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

const line = read("src/renderer/components/StudyLine.tsx");
const strip = read("src/renderer/components/ScriptureWorkspaceTabs.tsx");
const page = read("src/renderer/components/ScripturePage.tsx");
const app = read("src/renderer/app.tsx");
const styles = read("src/renderer/styles.css");

/** The sheets and components record a retirement by quoting what was retired. */
const statementsOnly = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const lineStatements = statementsOnly(line);
const stripStatements = statementsOnly(strip);

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

/** Two studies: Acts (three tabs) and John (one), with John's second tab last-active. */
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

test("the study line is a row of the frame: above the strip, outside the tablist and the toolbar", () => {
  /* PLACEMENT, and the one thing it may not be.
     The line stands in the band the frame already reserved above the tabs —
     §05·2's drag band, "24 and nothing else" — and the frame's top edge is
     composed from it: --study-line + --register-strip, held in
     tests/quire-frame-top-edge-contract.test.ts.

     It may NOT stand between the strip and the page, and this is the assertion
     that says so out loud, because the DOM order is the only thing stopping it.
     The active tab's paper fill and its two fillets join it to --bg-reading at
     the strip's baseline, and [data-flush-start] lets the first tab claim the
     page's own top-left corner outright. A row inserted there severs that joint
     and the tab stops being a piece of the page pulled up above the register —
     it becomes a chip floating on canvas, which is the browser idiom this
     register was drawn to refuse. */
  assert.ok(
    page.indexOf("<StudyLine") < page.indexOf("<ScriptureWorkspaceTabs"),
    "the study line stands above the strip, in the band, never between the strip and the page",
  );
  assert.ok(
    page.indexOf("<ScriptureWorkspaceTabs") < page.indexOf('id="scripture-workspace-panel"'),
    "and the strip still meets the page with nothing in between",
  );

  // It is its own component and its own element. Nothing in it is inside the
  // strip's tablist or the strip's toolbar, which the strip's own contracts
  // police from the other side by source range.
  assert.match(line, /className="scripture-study-line"/);
  assert.doesNotMatch(lineStatements, /role="tablist"|role="tab"|aria-selected/,
    "the strip below is the tablist; a second one above it reads as two sets of tabs for one page");
  assert.doesNotMatch(stripStatements, /scripture-study-line|scripture-study-chip/,
    "the line is not rendered inside the strip");
  assert.equal([...strip.matchAll(/role="tablist"/g)].length, 1);

  /* THE ARIA PATTERN, chosen rather than defaulted. A toolbar is APG's shape
     for a row of related controls sharing one tab stop, with the arrows
     travelling it — which is what this is, and it is the one horizontal
     grouping pattern that does not claim a selection. The current study is
     `aria-current`: there is one selection in this frame and it is the tab. */
  assert.match(line, /role="toolbar"/);
  assert.match(line, /aria-label="Studies"/);
  assert.match(line, /aria-orientation="horizontal"/);
  assert.match(line, /aria-current=\{\(!restsMinimal && chip\.current\) \|\| undefined\}/);
  assert.match(line, /tabIndex=\{rovingKey === studyStop\(chip\.groupId\) \? 0 : -1\}/);
  assert.match(line, /if \(event\.key === "ArrowRight"\) index = \(current \+ 1\) % stops\.length;/);
  assert.match(line, /else if \(event\.key === "Home"\) index = 0;/);
  assert.match(line, /else if \(event\.key === "End"\) index = stops\.length - 1;/);
  // One stop for the whole row: the plus is in it, so a keyboard reaches the
  // control that makes a study by the same arrows that reach the studies.
  assert.match(line, /START_STOP,\s*\], \[chips\]\);/);
});

test("the line holds the window's drag band, and never eats a press meant for a chip", () => {
  /* The band was the window's before the line stood in it, and it still is:
     `-webkit-app-region: drag` on the row. That is also why every interactive
     thing in it has to opt back out — a drag region swallows the press before
     the element under the pointer ever sees it, so a chip that forgets `no-drag`
     is a chip you cannot click, and it fails silently on the platform where the
     region exists at all. The Tooltip primitive's own anchor wraps the plus, so
     the wrapper opts out too. */
  const row = styles.slice(
    styles.indexOf(".scripture-study-line {"),
    styles.indexOf("}", styles.indexOf(".scripture-study-line {")),
  );
  assert.match(row, /-webkit-app-region: drag;/);
  const controls = styles.slice(
    styles.indexOf(".scripture-study-chip,\n.scripture-study-open,"),
    styles.indexOf("}", styles.indexOf(".scripture-study-chip,\n.scripture-study-open,")),
  );
  assert.match(controls, /-webkit-app-region: no-drag;/);
  assert.match(controls, /\.scripture-study-rename input/);
  assert.match(
    styles,
    /\.scripture-study-line \.control-tooltip-anchor \{\s*-webkit-app-region: no-drag;/,
  );
});

test("the line names studies, and the strip names none", () => {
  /* The claim ae49372 set out to make, at full strength for the first time.
     A study's name is set in one place, in the vocabulary every other surface
     uses: `studyWorkspaceGroupLabel`, which is the custom name when the reader
     has given one and the derived reference — "Acts 19" — when they have not.
     Never "This study": that was the rail switcher's literal, and it made every
     unnamed study identical to every other unnamed study, on the one surface
     whose whole job was telling them apart. */
  assert.match(line, /studyWorkspaceGroupLabel\(workspace, group, bookNames\)/);
  assert.doesNotMatch(lineStatements, /This study/);
  assert.doesNotMatch(
    stripStatements,
    /scripture-workspace-group-tab|scripture-workspace-group-head|scripture-workspace-active-group|data-study-active-group-manage/,
    "no element in the strip stands for a study",
  );

  // Every chip is renameable where it stands — no dialog opens over the page to
  // ask a study for its name — and a study just created is invited to name
  // itself the same way, by request rather than by a synthetic click.
  assert.match(line, /onDoubleClick=\{\(\) => beginRename\(chip\.groupId, chip\.label\)\}/);
  assert.match(line, /aria-keyshortcuts="F2"/);
  assert.match(line, /if \(event\.key !== "F2"\) return;/);
  assert.match(line, /namingNonceRef\.current === namingRequest\.nonce/);
  /* A POPOVER STANDS IN THIS FILE NOW, 2026-07-30, and the claim it was banned
     for is untouched. This read

       assert.doesNotMatch(lineStatements, /Popover|role="dialog"/);

     which was the strongest available form of "a study is renamed where its
     name is" while the line had exactly one surface. It has two: a chip's
     context menu, in the strip's own idiom. The ban was always on the DIALOG —
     a float that opens over the page to ask a study for four words, which is
     what the retired Manage control did — and a menu asks for nothing. What
     matters is that there is still ONE rename, and every gesture reaches it:
     the double-click, F2, the naming request that follows a new study, and the
     menu item all call `beginRename`, which turns the chip into its own field
     in the row. Four gestures, one field, no dialog. */
  assert.doesNotMatch(lineStatements, /role="dialog"/,
    "nothing in the line opens a dialog; a study is named on its own chip");
  assert.equal([...lineStatements.matchAll(/beginRename\(/g)].length, 4,
    "one rename, reached by a double-click, F2, the naming request, and the menu");
  assert.match(line, /data-study-chip-rename=""[\s\S]{0,320}beginRename\(group\.id, label\)/,
    "the menu's Rename is the same field, not a second one");

  const chips = studyLineChips(twoStudies(), bookNames);
  assert.deepEqual(chips.map(({ label, tabCount, current }) => ({ label, tabCount, current })), [
    { label: "Acts 19", tabCount: 2, current: true },
    { label: "John 3", tabCount: 2, current: false },
  ]);
});

test("the seal marks a study the reader has named, and nothing else", () => {
  /* THE MARK RETURNS WITH AN AUTHORING GESTURE — the premium contract left a
     place for this and it lands here.

     The kicker's mark was SLATE, Law 3's ink for something the app INFERRED,
     and it was correct while a study was something the app assembled out of
     whatever you happened to open. It came back as SEAL when studies became
     authored, on every chip — and a mark that is on every chip distinguishes
     nothing: sixteen gold bars in a row saying the same thing sixteen times is
     a texture, not a certification.

     What the reader actually DID is give this study a name. A study still
     wearing its derived reference — "Acts 19", which the app wrote — has been
     made and not yet claimed, and goes unmarked until it is. So the seal marks
     the naming, which is the one act in this row that is unambiguously the
     reader's. */
  const workspace = twoStudies();
  assert.deepEqual(studyLineChips(workspace, bookNames).map((chip) => chip.named), [false, false]);
  const named = renameStudyWorkspaceGroup(workspace, "acts-study", "Sunday evening");
  assert.deepEqual(studyLineChips(named, bookNames).map((chip) => ({
    label: chip.label,
    named: chip.named,
  })), [
    { label: "Sunday evening", named: true },
    { label: "John 3", named: false },
  ]);

  assert.match(line, /named: group\.label\.kind === "custom",/);
  assert.match(line, /\{chip\.named && <span className="scripture-study-chip-seal" aria-hidden="true" \/>\}/);
  assert.match(styles, /\.scripture-study-chip-seal \{[\s\S]{0,140}background: var\(--study-gold\);/);
});

test("a chip lands on the tab its study was last on", () => {
  // The model records it and the line reads it. A study you come back to opens
  // where you left it; the rail's switcher documented this in a comment three
  // lines above code that landed on `tabs[0]` instead, which is the defect that
  // took the switcher out.
  const workspace = twoStudies();
  const john = workspace.groups.find((group) => group.id === "john-study")!;
  assert.equal(john.lastActiveTabId, "john-3-kjv");
  assert.equal(studyLineLandingTabId(workspace, john), "john-3-kjv");

  // Fallbacks, in order, for a group whose record has been trimmed by a close.
  assert.equal(
    studyLineLandingTabId(workspace, { ...john, lastActiveTabId: "gone" }),
    john.homePassageTabId,
  );
  assert.equal(
    studyLineLandingTabId(workspace, { ...john, lastActiveTabId: "gone", homePassageTabId: "gone" }),
    "john-3",
  );
  // Membership is double-booked, and a tab whose two records disagree is inert
  // everywhere else in the model, so it is inert here.
  assert.equal(
    studyLineLandingTabId(workspace, { ...john, tabIds: ["acts-19"], lastActiveTabId: "gone", homePassageTabId: "gone" }),
    null,
  );

  assert.match(line, /const landing = studyLineLandingTabId\(workspace, group\);/);
  /* IT REPORTS WHETHER THE PAGE ARRIVED, 2026-07-30. This read

       assert.match(line, /if \(landing && landing !== workspace\.activeTabId\) await onSelectTab\(landing\);/);

     — the whole of what a chip asks for, and it still is: one selection, no
     filter, nothing else. What changed is that `openStudy` now returns the
     answer instead of discarding it. The chip's own press still ignores it,
     because a refusal leaves the line where the page still is either way. The
     caller that needs it is the menu's "New tab in this study": a tab is
     opened into the study the page is IN, so a refused landing must not be
     followed by opening one somewhere else. */
  assert.match(line, /if \(landing && landing !== workspace\.activeTabId\) return await onSelectTab\(landing\);/);
  assert.match(line, /const openStudy = useCallback\(async \(groupId: string\): Promise<boolean> =>/);
  assert.match(line, /onClick=\{\(\) => \{ void openStudy\(chip\.groupId\); \}\}/,
    "a chip press still discards the answer: a refusal changes nothing anywhere");
  /* A chip asks for ONE thing, and this is the whole of what it asks for.
     An `if (group.collapsed) await onExpandStudy(groupId)` stood in front of it
     for a few hours, because filtering to a folded study would have shown one
     proxy tab repeating the chip's own name. Nothing folds any more — the strip
     holds one study's tabs by construction — so the chip has nothing to
     unfold. */
  assert.doesNotMatch(lineStatements, /onExpandStudy|collapsed/);
});

test("selection leads and the line follows, because there is nothing in between", () => {
  /* Ctrl+Tab, ⌘1–9, an overview row, reopening a closed tab and opening a
     connection into another study all move the active tab, and some of those
     cross studies. The line may never block one, and the strip may never show a
     study that does not contain the page on screen.

     THIS USED TO BE AN EFFECT and it is now a derivation. A `studyFilterId`
     state lived in ScripturePage with a follow effect keyed on the active tab
     having MOVED — carefully not on the filter, so a chip could set it
     optimistically without the effect snapping it back. It worked, and it was
     an invariant maintained by hand. There is no filter now: which study the
     strip shows is `workspace.tabsById[activeTabId].groupId`, so the two cannot
     disagree, a refused selection changes nothing anywhere, and a launch lands
     the reader in the study they were reading because `activeTabId` is
     persisted. The strongest form of "these must agree" is "these are the same
     value". */
  assert.doesNotMatch(statementsOnly(page), /studyFilterId|setStudyFilterId|followedTabIdRef/,
    "the filter state and its follow effect are retired; the derivation replaces both");
  assert.doesNotMatch(lineStatements, /onFilterChange|filterStudyId/,
    "the line holds no state about which study it is standing on");
  // The only state it keeps is about the reader's hands — which stop has focus,
  // whether a chip is currently a field, whether a chip has its menu open — and
  // about the row's own overflow: which edges have chips scrolled past them
  // (2026-07-30, both edges rather than the right alone, matching the strip's
  // fade). None of it is about which study is current; that has no state to
  // hold. `chipMenu` joined the list on 2026-07-30 with the chip's context
  // menu, and it is the same kind of fact as `renameGroupId`: which chip the
  // reader has a surface open on, not which study the strip is showing.
  //
  // The drop target is deliberately NOT here. A tab dragged over a chip is the
  // strip's gesture — the strip owns the pointer, the tab and the mutation —
  // so the line takes `dropTargetStudyId` as a prop and paints it. Holding it
  // here would be the line keeping a fact about a drag it cannot commit.
  assert.deepEqual(
    [...lineStatements.matchAll(/const \[(\w+),/g)].map((match) => match[1]),
    ["focusedKey", "focusIntent", "renameGroupId", "renameDraft", "scrollEdges", "chipMenu"],
  );
  assert.match(line, /dropTargetStudyId: string \| null;/);
  assert.doesNotMatch(lineStatements, /setDropTarget|dragState|onPointer(Down|Move|Up)/,
    "the line paints a drop target; it never runs a drag");
  assert.match(line, /export function studyLineActiveStudyId\(/);
  assert.match(line, /return workspace\.tabsById\[workspace\.activeTabId\]\?\.groupId \?\? null;/);
  assert.match(strip, /const activeStudyId = workspace\.tabsById\[workspace\.activeTabId\]\?\.groupId \?\? null;/);

  const workspace = twoStudies();
  assert.equal(studyLineActiveStudyId(workspace), "acts-study");
  assert.deepEqual(studyLineChips(workspace, bookNames).map((chip) => chip.current), [true, false]);
  // A selection in the other study moves the line with it, with nothing to run.
  const crossed = selectStudyWorkspaceTab(workspace, "john-3-kjv");
  assert.equal(studyLineActiveStudyId(crossed), "john-study");
  assert.deepEqual(studyLineChips(crossed, bookNames).map((chip) => chip.current), [false, true]);
});

test("a chip's menu is the strip's menu one row up, and every item is a mutation that already exists", () => {
  /* THE THIRD AUTHORING GESTURE, 2026-07-30. A chip already IS a study's name,
     its tabs and its life; the menu says so out loud rather than adding
     anything to the model. Three items and not one more:

       Rename            → `beginRename`, the field F2 opens, in place.
       New tab in this study → the study is landed on first, then the palette.
       Close study       → `closeStudyWorkspaceGroup`, which refuses the last
                            study and asks before closing one holding several
                            tabs. The menu adds no exception to either.

     It is the strip's context menu in every particular that a reader or a
     screen reader can tell apart: the same Popover on the same float under the
     same class, a `role="menu"` of plain menuitems, `deferMouseFocus`'s
     preventDefault on each, and the pointer as the anchor. A second menu idiom
     in the same frame would be two ways of doing one thing. */
  assert.match(line, /className="scripture-workspace-context-popover"/);
  assert.match(line, /<div className="scripture-workspace-context-menu" role="menu" data-study-chip-menu="">/);
  assert.match(line, /onContextMenu=\{\(event\) => \{[\s\S]{0,1200}?setChipMenu\(\{/);
  /* NO `aria-haspopup`, and that is a decision rather than an omission — the
     strip's tabs carry none for the same reason. A chip's primary activation
     is a study; announcing a popup on it promises a key that does not exist,
     because Enter switches studies and always will. Both devices reach the
     menu anyway, through one handler: the platform fires `contextmenu` for the
     Menu key and Shift+F10 on the focused element, so the chip the roving stop
     is on opens its own menu with no second key path invented here. */
  assert.doesNotMatch(lineStatements, /aria-haspopup/);
  assert.match(line, /anchor: new DOMRect\(event\.clientX, event\.clientY, 0, 0\),/);
  assert.equal([...line.matchAll(/role="menuitem"/g)].length, 3, "three items, and not one more");
  for (const item of ["data-study-chip-rename", "data-study-chip-new-tab", "data-study-chip-close"]) {
    assert.ok(line.includes(`${item}=""`), `missing menu item: ${item}`);
  }
  assert.match(line, />Rename</);
  assert.match(line, />New tab in this study</);

  /* CLOSE ROUTES THROUGH THE EXISTING MUTATION and wears its own refusal. The
     model's availability selector already knows all three answers — the last
     study cannot be closed at all, a study holding several tabs needs a
     confirmation, one holding a single tab does not — so the item reads them
     rather than re-deriving them, and the ellipsis on the copy is the same
     signal the overview's per-study Close uses for the same reason. */
  assert.match(line, /const closeAvailability = studyWorkspaceGroupCloseAvailability\(workspace, group\.id\);/);
  assert.match(line, /disabled=\{closeAvailability === "unavailable"\}/);
  assert.match(line, /closeAvailability === "decision" \? "Close study…" : "Close study"/);
  assert.match(line, /await onCloseStudy\(group\.id\);/);

  const sole = createStudyWorkspace(view("ACT", 19), { groupId: "only", passageTabId: "acts-19" });
  assert.equal(studyWorkspaceGroupCloseAvailability(sole, "only"), "unavailable",
    "the last study refuses to close, and the item is disabled rather than lying");
  const pair = twoStudies();
  assert.equal(studyWorkspaceGroupCloseAvailability(pair, "john-study"), "decision");

  // A tab opens into the study the page is in, so the landing has to succeed
  // before the palette is asked for one — a tab in a study the reader never
  // reached is worse than no tab.
  assert.match(line, /if \(await openStudy\(group\.id\)\) onNewTab\(\);/);

  // A study that closes under an open menu takes the menu with it, the same
  // rule the rename field has kept since the line was built.
  assert.match(
    line,
    /if \(!chipMenu\) return;\s*if \(workspace\.groups\.some\(\(group\) => group\.id === chipMenu\.groupId\)\) return;\s*setChipMenu\(null\);/,
  );
});

test("a chip is a live drop target in the register's own ink, and the strip is what says so", () => {
  /* DRAG A TAB ONTO A STUDY and it moves there. The gesture spans two
     components — the tab is the strip's, the chip is the line's — and this is
     the seam, stated from the line's side.

     The line paints and does not decide. `dropTargetStudyId` arrives as a prop,
     the chip wears an attribute, and there is no pointer handler anywhere in
     this file: the strip owns the pointer, the tab, and `onMoveTab`. That is
     the same rule the whole line is built on — it never leads, it follows —
     applied to a gesture instead of to a selection. */
  assert.match(line, /data-study-drop-target=\{dropTargetStudyId === chip\.groupId \|\| undefined\}/);

  /* THE INK IS THE STRIP'S OWN. The register already answers "where will this
     land" with a 2px --text-secondary bar standing between two tabs; a chip
     answers the same question with the same bar laid along its baseline. The
     negative half is the point: no fill, no tint, no dashed outline, nothing
     that pulses. A drop target that lights up is a browser announcing it is a
     browser, and this row is the frame's quietest ink on purpose. */
  const dropMark = styles.slice(
    styles.indexOf('.scripture-study-chip[data-study-drop-target]::before {'),
    styles.indexOf('}', styles.indexOf('.scripture-study-chip[data-study-drop-target]::before {')),
  );
  assert.match(dropMark, /height: 2px;/);
  assert.match(dropMark, /background: var\(--text-secondary\);/);
  assert.doesNotMatch(dropMark, /box-shadow|outline|animation|dashed/);
  const stripDropMark = styles.slice(
    styles.indexOf('.scripture-workspace-tab-wrap[data-study-drop="before"]::before,'),
    styles.indexOf('}', styles.indexOf('.scripture-workspace-tab-wrap[data-study-drop="before"]::before,')),
  );
  assert.match(stripDropMark, /background: var\(--text-secondary\);/,
    "the two rows answer the same question in the same ink");
  // Forced colours flattens the hue away, so the bar is redrawn in the system's
  // own ink — and in the selection's ink over the current study's Highlight
  // fill, or the answer vanishes in the one mode that cannot afford to lose it.
  assert.match(styles, /\.scripture-study-chip\[data-study-drop-target\]::before \{ background: CanvasText; \}/);
  assert.match(
    styles,
    /\.scripture-study-chip\[aria-current="true"\]\[data-study-drop-target\]::before \{ background: HighlightText; \}/,
  );
});

test("no renderer state about studies reaches a persisted field", () => {
  /* StudyWorkspaceStateV2 is round-tripped through a canonical-JSON equality
     check on every save, and the Electron validator has to mirror the
     renderer's shape exactly or the write is refused. Which study is on screen
     is a fact the model already holds — `activeTabId` — and the line adds
     nothing to it. */
  const settings = read("src/electron/study-workspace-settings.ts");
  const model = read("src/renderer/utils/studyWorkspace.ts");
  for (const [name, source] of [["the validator", settings], ["the model", model]] as const) {
    assert.doesNotMatch(source, /filterStudyId|studyFilter|studyLine/,
      `${name} must not learn about the study line`);
  }
  /* And `collapsed` is the reverse case, recorded here because the temptation
     is to tidy it away: the field STAYS in both, untouched, so a workspace
     saved with a folded study still round-trips. Nothing in the renderer reads
     or writes it — the strip holds one study's tabs, so folding one has nothing
     to hide — and the model keeps `toggleStudyWorkspaceGroup` with its
     exclusivity ruling, unread. */
  assert.match(settings, /collapsed/);
  assert.match(model, /export function toggleStudyWorkspaceGroup\(/);
  assert.doesNotMatch(statementsOnly(read("src/renderer/app.tsx")), /toggleStudyWorkspaceGroup/);
});

test("the strip holds one study without losing its roving stop or the other studies", () => {
  /* The two things this breaks if it is done naively.

     ROVING FOCUS. `tabIndex={roving ? 0 : -1}` is computed from a list, and a
     roving stop naming a tab that is not rendered leaves the tablist with no
     tabIndex=0 element at all — it drops out of the Tab order, which is an APG
     violation — while an arrow targets a tab `tabRefs` has no node for and
     focus dies silently. Both read `stripTabIds`.

     THE OTHER STUDIES. Six call sites need the whole workspace rather than the
     rendered run: the overview and its search, the "Move to study…" menus,
     rename from a context menu, close-others. The rendered list keeps the name
     `groups`, so a surface that wants every study has to ask for `allGroups` by
     name — which makes the mistake visible instead of quietly hiding a study
     from a menu. */
  assert.match(strip, /const stripTabIds = useMemo\(\s*\(\) => groups\.flatMap/);
  assert.match(strip, /studyWorkspaceRovingTabId\(stripTabIds, workspace\.activeTabId\)/);
  assert.match(strip, /if \(stripTabIds\.length === 0\) return;/);
  assert.match(strip, /const next = stripTabIds\[index\];/);
  assert.match(
    strip,
    /const groups = useMemo<WorkspaceTabGroup\[\]>\(\s*\(\) => allGroups\.filter\(\(\{ group \}\) => group\.id === activeStudyId\),/,
  );
  for (const site of [
    "const entry = allGroups.find((candidate) => candidate.group.id === groupId)",
    "allGroups.find((entry) => entry.group.id === contextGroupId)",
    "{(allGroups.length > 0 || hasMeasuredOverflow) && (",
    "{allGroups.length > 1 && (",
    "const moveTargets = allGroups.filter((entry) => entry.group.id !== target.groupId);",
    "const filteredGroups = useMemo(() => allGroups.flatMap((entry) => {",
  ]) {
    assert.ok(strip.includes(site), `a surface that must reach every study takes the rendered list: ${site}`);
  }

  /* The exit ghosts diff the WORKSPACE's tabs on purpose. A tab that left the
     workspace is a close and gets its ghost; a tab that left the strip because
     the reader changed study is still open, and replaying a row of collapse-out
     animations on every chip press would turn a switch into a demolition. */
  assert.match(strip, /const registerTabIds = useMemo\(\(\) => studyWorkspaceRegisterTabIds\(workspace\), \[workspace\]\)/);
  const ghosts = strip.slice(strip.indexOf("const nextGeometry"), strip.indexOf("}, [registerTabIds]);"));
  assert.doesNotMatch(ghosts, /stripTabIds/);

  // And cycling walks the same run the strip draws.
  const app = read("src/renderer/app.tsx");
  assert.match(app, /const tabIds = studyWorkspaceStripTabIds\(current\);/);
  const workspace = twoStudies();
  assert.deepEqual(studyWorkspaceStripTabIds(workspace), ["acts-19", "acts-19-kjv"]);
  assert.equal(studyWorkspaceOrdinalTabId(workspace, 2), "acts-19-kjv");
  assert.equal(studyWorkspaceOrdinalTabId(workspace, 3), null,
    "an ordinal addresses the study you are reading, not a tab in another one");
});

test("the count is where a count answers a question, not in the frame asking one", () => {
  /* B4 asked for `+n` on the overview control — "a +7 count opens the rest as a
     list" — and it was right while the strip WAS the workspace and "the rest"
     was one number meaning one thing. The register holds one study now, so most
     of the rest is other studies, and those are named on the line above with
     their own counts in their own tooltips. What a badge had left to report was
     a tab or two past the edge of a row you can pan with a wheel.

     Two counts survive and both are answers rather than announcements: the
     overview's accessible name says how many tabs are behind the door, and each
     chip's tooltip and accessible name say how many are in that study. Nothing
     in the frame carries a number at rest. */
  assert.doesNotMatch(statementsOnly(strip), /hiddenTabCount|tabsInStrip|overflow-count/);
  assert.match(strip, /aria-label=\{`Show all \$\{totalTabs\} study tabs in \$\{allGroups\.length\}/);
  assert.doesNotMatch(lineStatements, /<small/,
    "a count on every chip is a dashboard, and this row is chrome");
  assert.match(line, /title=\{`\$\{chip\.label\} — \$\{chip\.tabCount\}/);
  assert.match(line, /\$\{chip\.tabCount\} \$\{chip\.tabCount === 1 \? "tab" : "tabs"\}/);

  /* THE OVERVIEW IS THE ONE DOOR to a study you are not in, and it is the
     surface that already existed: All Tabs, with its search, its per-study
     rows, and the recently-closed list. Nothing was rebuilt for it. */
  assert.match(strip, /data-study-all-tabs=""/);
  assert.match(strip, /data-study-reopen-recent=""/);
  assert.match(strip, /data-study-all-tabs-search=""/);
});

test("the line rests until there is something to choose between", () => {
  /* THERE IS NO "All" CHIP. One was built and removed the same day: the strip
     holds one study's tabs, so All would have been a second arrangement of a
     row that has one, and a chip that is not a study standing first among the
     studies is exactly the filter bar this line is not.

     AND THE FLOOR RESTS. The model guarantees at least one group —
     `closeStudyWorkspaceGroup` refuses the last one and the validator rejects a
     workspace with none — so one study is the floor and not an edge case. At
     the floor there is nothing to choose between, and a row of one chip is a
     menu with one item in it: it advertises a decision the reader does not
     have. So the band keeps its height and its drag region and goes quiet — the
     study's name in resting ink, and the +.

     The frame does not move between the two states. The resting name IS the
     chip it becomes, in the same element at the same size, at the width its
     bold form already reserves; only the ink changes, and the second study
     arrives beside it on the tab strip's own 150ms entrance. That is the line
     waking up rather than re-laying out. */
  assert.equal(studyLineRestsMinimal(1), true);
  assert.equal(studyLineRestsMinimal(2), false);
  assert.doesNotMatch(lineStatements, /data-study-line-all|"All"/,
    "there is no All chip and no all-studies view");

  assert.match(line, /data-study-line-state=\{restsMinimal \? "resting" : "chips"\}/);
  assert.match(line, /aria-current=\{\(!restsMinimal && chip\.current\) \|\| undefined\}/);
  /* 2026-07-30, hand pass: the resting rule grew a second declaration. It used
     to be ink alone — `{ color: var(--text-secondary); }` — but a resting name
     kept the pointer cursor and the hover wash of the chip it becomes, offering
     a click that switches to nothing. At the floor the name states no
     affordance it does not have: no pointer, no wash, while staying a real
     control for the roving stop and F2. */
  assert.match(
    styles,
    /\.scripture-study-line\[data-study-line-state="resting"\] \.scripture-study-chip \{[^}]*color: var\(--text-secondary\);[^}]*cursor: default;\s*\}/,
  );
  assert.match(
    styles,
    /\.scripture-study-line\[data-study-line-state="resting"\] \.scripture-study-chip:hover \{\s*background: transparent;\s*color: var\(--text-secondary\);\s*\}/,
  );
  // The band is the same height in both states, and neither half of the frame's
  // sum is restated for either — held in tests/quire-frame-top-edge-contract.
  const lineRule = styles.slice(
    styles.indexOf(".scripture-study-line {"),
    styles.indexOf("}", styles.indexOf(".scripture-study-line {")),
  );
  assert.match(lineRule, /height: var\(--study-line\);/);
  assert.doesNotMatch(styles, /\[data-study-line-state[^{}]*\{[^}]*height:/);

  const sole = createStudyWorkspace(view("ACT", 19), { groupId: "only", passageTabId: "acts-19" });
  assert.equal(studyLineActiveStudyId(sole), "only");
  assert.equal(studyLineChips(sole, bookNames).length, 1);
  assert.equal(studyLineRestsMinimal(sole.groups.length), true);
  assert.equal(studyLineRestsMinimal(twoStudies().groups.length), false);
});

test("the + starts a study and gauges the 16-study cap the way the tab plus gauges 64", () => {
  // It reuses the palette's own create-a-study path rather than a second one:
  // a study is born holding the passage you are on, with its chip already a
  // field. `createStudyWorkspaceGroup` cannot make an empty study — the
  // signature requires a passage and the label falls back to a raw uuid without
  // one — so "make a study, then drag tabs in" is not expressible and is not
  // pretended at.
  assert.match(app, /onStartStudy=\{startStudyFromCurrentCanvas\}/);
  assert.match(line, /aria-label="Start a new study"/);
  assert.match(line, /const atStudyCapacity = studyCount >= STUDY_WORKSPACE_GROUP_LIMIT;/);
  assert.match(line, /data-study-start-disabled=\{atStudyCapacity \|\| undefined\}/);
  assert.match(line, /aria-disabled=\{atStudyCapacity \|\| undefined\}/);
  assert.match(line, /if \(!atStudyCapacity\) void onStartStudy\(\);/);
  // The copy states the cap in the unit the cap counts. The tab plus said
  // "studies" for its 64 tabs until 2026-07-30; this one is the same shape with
  // the other number, and it may not borrow the wrong noun either.
  assert.match(line, /All \$\{STUDY_WORKSPACE_GROUP_LIMIT\} studies open/);
  assert.match(line, /\$\{studyCount\} of \$\{STUDY_WORKSPACE_GROUP_LIMIT\} studies open/);
  assert.doesNotMatch(lineStatements, /\$\{STUDY_WORKSPACE_GROUP_LIMIT\} tabs/);
  assert.equal(STUDY_WORKSPACE_GROUP_LIMIT, 16);
  // And it stays in the row at capacity rather than leaving it: a control that
  // vanishes at the limit teaches that the limit is a bug.
  assert.match(
    styles,
    /\.scripture-study-open\[data-study-start-disabled\] \{\s*opacity: 0\.38;\s*cursor: default;\s*\}/,
  );
});
