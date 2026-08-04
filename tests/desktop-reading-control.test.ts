import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ConnectionRecordV2 } from "../src/core/annotations/types.js";
import {
  compareConnectionsCanonical,
  canonicalConnectionAnchors,
} from "../src/core/annotations/connection-order.js";
import {
  selectionProjectionRoundTrips,
  selectionSettlesIntoProjection,
} from "../src/core/annotations/occurrence-alignment.js";
import { connectionDraftExitActions } from "../src/renderer/utils/connectionDraftLifecycle.js";
import {
  closeStudyWorkspaceGroup,
  closeStudyWorkspaceTab,
  createStudyWorkspace,
  createStudyWorkspaceGroup,
  openEntityWorkspaceTab,
  resolveStudyWorkspaceDecision,
  selectStudyWorkspaceTab,
  STUDY_WORKSPACE_TAB_LIMIT,
  type PassageViewState,
} from "../src/renderer/utils/studyWorkspace.js";

const repoRoot = process.cwd();

function passage(book: string, chapter: number, packageId = "bsb"): PassageViewState {
  return {
    book,
    chapter,
    packageId,
    scrollTop: 0,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: {},
      wordsFollowingReading: true,
    },
  };
}

function connection(
  id: string,
  anchors: Array<{ verse: number; position: number }>,
): ConnectionRecordV2 {
  return {
    id,
    format_version: 2,
    kind: "series",
    label: id,
    observation: "",
    anchors: anchors.map(({ verse, position }) => ({
      book: "ACT",
      chapter: 19,
      verse_start: verse,
      verse_end: verse,
      exact: {
        format_version: 1,
        layer: "backbone-token:v1",
        occurrences: [{ verse, position }],
      },
    })),
    activeEventId: `event-${id}`,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

/**
 * RESTATED 2026-07-31 by the Old Testament connection fix.
 *
 * This test was titled "active-package connection capture refuses lexical
 * widening" and its first assertion existed to prove that marking "Holy
 * Spirit" where the canonical unit renders "the Holy Spirit" was REFUSED at
 * authoring. That claim is withdrawn. `backbone-token:v1` is the
 * original-language word layer, so widening is what Hebrew does to English by
 * nature: under the old rule 80-90% of single-word marks in Genesis,
 * Deuteronomy, the Psalms and Isaiah were refused in every installed
 * translation, and the reader could not author a connection in the Old
 * Testament at all.
 *
 * `selectionProjectionRoundTrips` is UNCHANGED and still reports widening as
 * inexact — that fact is true and worth naming. What changed is that
 * authoring now admits a settling reprojection (`selectionSettlesIntoProjection`)
 * and refuses only a reprojection that loses or reorders the reader's words.
 */
test("authoring settles a widening reprojection and still refuses a lossy one", () => {
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 2, char_start: 37, quote: "Holy Spirit" }],
    [{ verse: 2, char_start: 33, quote: "the Holy Spirit" }],
  ), false);
  assert.equal(selectionSettlesIntoProjection(
    [{ verse: 2, char_start: 37, quote: "Holy Spirit" }],
    [{ verse: 2, char_start: 33, quote: "the Holy Spirit" }],
  ), true);
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 3, char_start: 55, quote: "baptism" }],
    [{ verse: 3, char_start: 55, quote: "baptism" }],
  ), true);
  assert.equal(selectionSettlesIntoProjection(
    [{ verse: 3, char_start: 55, quote: "baptism" }],
    [{ verse: 3, char_start: 55, quote: "baptism" }],
  ), true);
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 6, char_start: 42, quote: "Holy Spirit" }],
    [{ verse: 6, char_start: 42, quote: "Holy Spirit" }],
  ), true);
  // A reprojection that drops a marked word is still an artifact defect.
  assert.equal(selectionSettlesIntoProjection(
    [{ verse: 2, char_start: 33, quote: "the Holy Spirit" }],
    [{ verse: 2, char_start: 37, quote: "Holy Spirit" }],
  ), false);
  // So is one that reorders them.
  assert.equal(selectionSettlesIntoProjection(
    [{ verse: 2, char_start: 33, quote: "Holy Spirit" }],
    [{ verse: 2, char_start: 33, quote: "Spirit Holy" }],
  ), false);
  // An empty mark can never settle into anything.
  assert.equal(selectionSettlesIntoProjection(
    [{ verse: 2, char_start: 33, quote: "," }],
    [{ verse: 2, char_start: 33, quote: "the Holy Spirit" }],
  ), false);
});

test("passage connections and their anchors ignore creation and authoring order", () => {
  const laterCreated = connection("01-later-created", [{ verse: 6, position: 8 }, { verse: 2, position: 7 }]);
  const earlierCreated = connection("99-earlier-created", [{ verse: 3, position: 9 }]);
  const sameVerseEarlierWord = connection("50-same-verse", [{ verse: 3, position: 2 }]);
  assert.deepEqual(
    [laterCreated, earlierCreated, sameVerseEarlierWord]
      .sort(compareConnectionsCanonical)
      .map((item) => item.id),
    ["01-later-created", "50-same-verse", "99-earlier-created"],
  );
  assert.deepEqual(
    canonicalConnectionAnchors(laterCreated).map((anchor) => anchor.verse_start),
    [2, 6],
  );
  const crossPassage = connection("00-cross-passage", [{ verse: 18, position: 1 }, { verse: 3, position: 1 }]);
  crossPassage.anchors[0] = { ...crossPassage.anchors[0]!, chapter: 18 };
  assert.deepEqual(
    [crossPassage, sameVerseEarlierWord]
      .sort((left, right) => compareConnectionsCanonical(left, right, {
        book: "ACT",
        chapter: 19,
        verseStart: 1,
        verseEnd: 10,
      }))
      .map((item) => item.id),
    ["00-cross-passage", "50-same-verse"],
  );
});

test("draft exits never invent save or timer behavior", () => {
  assert.deepEqual(connectionDraftExitActions(1), ["discard", "keep-editing"]);
  assert.deepEqual(connectionDraftExitActions(2), ["save", "discard", "keep-editing"]);
  assert.deepEqual(connectionDraftExitActions(4), ["save", "discard", "keep-editing"]);
});

test("passage-first Study groups preserve Scripture and Research return order", () => {
  const acts = passage("ACT", 19);
  const john = passage("JHN", 3);
  let state = createStudyWorkspace(acts, { groupId: "acts-study", passageTabId: "acts-19" });
  state = openEntityWorkspaceTab(state, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    displayName: "Paul",
    entityKind: "person",
    nonce: 1,
    origin: acts,
    returnPassageTabId: "acts-19",
  }).state;
  state = openEntityWorkspaceTab(state, {
    id: "ephesus",
    sourceTabId: "acts-19",
    entityId: "place:ephesus",
    displayName: "Ephesus",
    entityKind: "place",
    nonce: 2,
    origin: acts,
    returnPassageTabId: "acts-19",
  }).state;
  state = createStudyWorkspaceGroup(state, {
    id: "john-study",
    passageTabId: "john-3",
    view: john,
  }).state;
  state = openEntityWorkspaceTab(state, {
    id: "nicodemus",
    sourceTabId: "john-3",
    entityId: "person:nicodemus",
    displayName: "Nicodemus",
    entityKind: "person",
    nonce: 3,
    origin: john,
    returnPassageTabId: "john-3",
  }).state;

  assert.equal(state.activeTabId, "nicodemus");
  assert.deepEqual(state.groups.map((group) => group.tabIds), [
    ["acts-19", "ephesus", "paul"],
    ["john-3", "nicodemus"],
  ]);
  state = selectStudyWorkspaceTab(state, "paul");
  state = selectStudyWorkspaceTab(state, "acts-19");
  assert.deepEqual(state.activationOrder.slice(-2), ["paul", "acts-19"]);
  state = selectStudyWorkspaceTab(state, "ephesus");
  const closedEntity = closeStudyWorkspaceTab(state, "ephesus");
  assert.equal(closedEntity.outcome, "applied");
  assert.equal(closedEntity.state.activeTabId, "paul");

  const closeStudy = closeStudyWorkspaceGroup(closedEntity.state, "acts-study");
  assert.equal(closeStudy.outcome, "needs-confirmation");
  if (closeStudy.outcome !== "needs-confirmation") return;
  const resolved = resolveStudyWorkspaceDecision(
    closedEntity.state,
    closeStudy.confirmation,
    "close-study",
  );
  assert.equal(resolved.outcome, "applied");
  assert.deepEqual(resolved.state.groups.map((group) => group.id), ["john-study"]);
  assert.deepEqual(resolved.state.groups[0]?.tabIds, ["john-3", "nicodemus"]);
});

test("the V2 tab bound refuses overflow without evicting the home passage", () => {
  const origin = passage("ACT", 19);
  let state = createStudyWorkspace(origin, { groupId: "acts-study", passageTabId: "acts-19" });
  for (let index = 1; index < STUDY_WORKSPACE_TAB_LIMIT; index += 1) {
    const opened = openEntityWorkspaceTab(state, {
      id: `tab-${index}`,
      sourceTabId: "acts-19",
      entityId: `person:entity-${index}`,
      displayName: `Entity ${index}`,
      entityKind: "person",
      origin,
      nonce: index,
      returnPassageTabId: "acts-19",
    });
    assert.equal(opened.outcome, "opened");
    state = opened.state;
  }
  const overflow = openEntityWorkspaceTab(state, {
    id: "overflow",
    sourceTabId: "acts-19",
    entityId: "person:overflow",
    displayName: "Overflow",
    entityKind: "person",
    origin,
    nonce: STUDY_WORKSPACE_TAB_LIMIT,
    returnPassageTabId: "acts-19",
  });
  assert.equal(Object.keys(state.tabsById).length, STUDY_WORKSPACE_TAB_LIMIT);
  assert.equal(overflow.outcome, "tab-limit");
  assert.equal(overflow.state, state);
  assert.equal(state.tabsById["acts-19"]?.kind, "passage");
});

test("desktop renderer has no legacy Research workspace module or state path", () => {
  const legacyPath = join(repoRoot, "src/renderer/utils/researchWorkspace.ts");
  const persistence = readFileSync(join(repoRoot, "src/renderer/utils/workspacePersistence.ts"), "utf8");
  assert.equal(existsSync(legacyPath), false);
  assert.doesNotMatch(persistence, /researchWorkspace|SCRIPTURE_WORKSPACE_ID/);
});

test("desktop integration owns one draft rail, exit controller, attention scroll, and APG tabs", () => {
  const marking = readFileSync(join(repoRoot, "src/renderer/components/MarkingSurface.tsx"), "utf8");
  const scripture = readFileSync(join(repoRoot, "src/renderer/components/ScripturePage.tsx"), "utf8");
  const workspaceTabs = readFileSync(join(repoRoot, "src/renderer/components/ScriptureWorkspaceTabs.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src/renderer/components/LivingMargin.tsx"), "utf8");
  const app = readFileSync(join(repoRoot, "src/renderer/app.tsx"), "utf8");
  const main = readFileSync(join(repoRoot, "src/electron/main.ts"), "utf8");
  // RESTATED 2026-07-30 — was `Select more text to keep adding.`, a standing
  // hint in its own column of the old draft strip, where it wrapped to four
  // lines and repeated an instruction the reader had already followed twice.
  // The affordance is now the anchor list's own next-numbered line: the shape
  // of the act, drawn in the lane the held phrases are already in.
  assert.match(marking, /"Select more words to add another"/);
  assert.match(marking, /<li className="marking-connect-next">/);
  assert.match(marking, />Save connection<\/button>/);
  assert.match(marking, />Cancel draft<\/button>/);
  assert.match(marking, /requestDraftExit\("escape"\)/);
  assert.doesNotMatch(marking, /inactivity|countdown|auto.?save/i);
  // This used to assert `scrollIntoView({ … block: "center" … })`, which was
  // the Connections tab's own attention scroll: it centred the ONE member
  // nearest the reading eye-line, and only the tab did it — a tick click and a
  // member click scrolled nothing at all. Rev 04 §5 withdraws both halves:
  // "Attending happens three ways and is one behaviour: clicking a member, its
  // gutter tick, or its row in the Connections tab. All three scroll the least
  // distance that brings every member into view." So the scroll moved into the
  // one function all three paths call, and centring is gone — least distance
  // means a connection already on screen does not move the page at all.
  assert.match(scripture, /scrollAttendedConnectionIntoView\(visibleConnection, ownerContextKey\)/);
  assert.match(scripture, /leastScrollForMembers\(\{[\s\S]{0,320}spanTop: span\.top,[\s\S]{0,120}spanBottom: span\.bottom/);
  assert.doesNotMatch(scripture, /scrollIntoView\(\{[\s\S]{0,180}block: "center"/,
    "attending centres nothing; it closes the smallest gap that shows every member");
  assert.match(scripture, /onSelectAuthoredConnection=\{handleSelectAuthoredConnection\}/);
  assert.match(app, /runWorkspaceTransition\("view-change"/);
  assert.match(app, /runWorkspaceTransition\("library-change"/);
  assert.match(app, /runWorkspaceTransition\("window-close"/);
  assert.doesNotMatch(app, /\.requestExit\(/);
  assert.match(app, /appWindow\.resolveCloseRequest\(request\.requestId, proceed\)/);
  assert.match(main, /win\.on\("close", \(event\) => \{[\s\S]{0,700}event\.preventDefault\(\)[\s\S]{0,700}requestRendererCloseAcknowledgement\("window"\)/);
  assert.doesNotMatch(marking, /beforeunload/);
  assert.match(scripture, /<ScriptureWorkspaceTabs/);
  assert.match(workspaceTabs, /role="tablist"[\s\S]{0,80}aria-label="Open study tabs"/);
  assert.match(workspaceTabs, /role="toolbar" aria-label="Study tab controls"/);
  /* `aria-expanded={!group.collapsed}` was the All Tabs collapse toggle's
     state, and both it and the strip's collapsed proxy are retired on
     2026-07-30: the register holds one study's tabs, so folding a study has
     nothing to get out of the row and the toggle's only remaining effect was
     writing a field nobody reads. `collapsed` stays in the model and stays
     persisted. */
  assert.doesNotMatch(workspaceTabs, /aria-expanded=\{!group\.collapsed\}/);
  // Renamed 2026-08-03 for the jobs the surface kept once overflow,
  // study-switching and ordinal jumps moved out from under it — and shortened
  // again the same day when the search field left and typing became a jump.
  assert.match(workspaceTabs, /All tabs — switch, reopen; \$\{totalTabs\} open in /);
  assert.match(workspaceTabs, /event\.key === "Delete"/);
  assert.doesNotMatch(margin, /margin-workspace-tabs/);
  assert.doesNotMatch(margin, /workspaceScrollPositionsRef|tabScrollPositionsRef/);
  assert.match(margin, /marginSession\.scrollTopByTab\[activeTab\]/);
});

test("App is the sole workspace transition authority and Scripture aggregates authored owners", () => {
  const app = readFileSync(join(repoRoot, "src/renderer/app.tsx"), "utf8");
  const scripture = readFileSync(join(repoRoot, "src/renderer/components/ScripturePage.tsx"), "utf8");
  const card = readFileSync(join(repoRoot, "src/renderer/components/ConnectionCard.tsx"), "utf8");
  const tabs = readFileSync(join(repoRoot, "src/renderer/components/ScriptureWorkspaceTabs.tsx"), "utf8");

  assert.match(app, /createWorkspaceTransitionCoordinator/);
  assert.match(app, /const runWorkspaceTransition/);
  assert.match(app, /canvasOwnerTabIdRef/);
  assert.match(app, /captureCurrentStudyWorkspace/);
  assert.match(app, /captured\.ownerTabId !== canvasOwnerTabIdRef\.current/);
  assert.match(app, /updateActiveStudyCanvasSession\(current, captured\.ownerTabId/);
  assert.match(app, /studyWorkspaceRef\.current = next;[\s\S]{0,100}setStudyWorkspace\(next\)/);
  assert.match(app, /onRequestWorkspaceTransition=\{runWorkspaceTransition\}/);
  assert.match(app, /onWorkspaceExitControllerChange=\{handleWorkspaceExitControllerChange\}/);
  assert.match(app, /onStudyCanvasControllerChange=\{handleStudyCanvasControllerChange\}/);
  assert.match(scripture, /noteExitControllerRef/);
  assert.match(scripture, /markingExitControllerRef/);
  assert.match(scripture, /cardExitControllerRef/);
  assert.match(scripture, /\[noteExitControllerRef\.current, markingExitControllerRef\.current, cardExitControllerRef\.current\]/);
  assert.match(card, /onExitControllerChange\?:/);
  assert.match(card, /label,[\s\S]{0,120}observation: draftObservationRef\.current/);
  assert.match(tabs, /onSelect: \(tabId: string\) => Promise<boolean>/);
  assert.match(tabs, /onClose: \(tabId: string\) => Promise<boolean>/);
  assert.match(tabs, /onCloseGroup: \(groupId: string\) => Promise<boolean>/);
  assert.doesNotMatch(tabs, /onToggleGroup:/);
});
