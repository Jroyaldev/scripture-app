import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ConnectionRecordV2 } from "../src/core/annotations/types.js";
import {
  compareConnectionsCanonical,
  canonicalConnectionAnchors,
} from "../src/core/annotations/connection-order.js";
import { selectionProjectionRoundTrips } from "../src/core/annotations/occurrence-alignment.js";
import { connectionDraftExitActions } from "../src/renderer/utils/connectionDraftLifecycle.js";
import {
  closeResearchWorkspaceGroup,
  closeResearchWorkspaceTab,
  createResearchWorkspaceState,
  MAX_RESEARCH_WORKSPACE_TABS,
  openResearchWorkspaceTab,
  researchOriginGroupKey,
  SCRIPTURE_WORKSPACE_ID,
  selectResearchWorkspaceTab,
} from "../src/renderer/utils/researchWorkspace.js";

const repoRoot = process.cwd();

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

test("active-package connection capture refuses lexical widening", () => {
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 2, char_start: 37, quote: "Holy Spirit" }],
    [{ verse: 2, char_start: 33, quote: "the Holy Spirit" }],
  ), false);
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 3, char_start: 55, quote: "baptism" }],
    [{ verse: 3, char_start: 55, quote: "baptism" }],
  ), true);
  assert.equal(selectionProjectionRoundTrips(
    [{ verse: 6, char_start: 42, quote: "Holy Spirit" }],
    [{ verse: 6, char_start: 42, quote: "Holy Spirit" }],
  ), true);
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

test("Scripture and grouped Research tabs preserve sessions and recent return order", () => {
  const acts = { book: "ACT", chapter: 19, packageId: "bsb" };
  const john = { book: "JHN", chapter: 3, packageId: "bsb" };
  let state = createResearchWorkspaceState();
  state = openResearchWorkspaceTab(state, { id: "paul", entityId: "paul", origin: acts, nonce: 1 });
  state = openResearchWorkspaceTab(state, { id: "ephesus", entityId: "ephesus", origin: acts, nonce: 2 });
  state = openResearchWorkspaceTab(state, { id: "nicodemus", entityId: "nicodemus", origin: john, nonce: 3 });
  assert.equal(state.activeTabId, "nicodemus");
  assert.equal(new Set(state.tabs.map((tab) => researchOriginGroupKey(tab.origin))).size, 2);
  state = selectResearchWorkspaceTab(state, "paul");
  state = selectResearchWorkspaceTab(state, SCRIPTURE_WORKSPACE_ID);
  assert.equal(state.lastResearchTabId, "paul");
  state = selectResearchWorkspaceTab(state, "ephesus");
  state = closeResearchWorkspaceTab(state, "ephesus");
  assert.equal(state.activeTabId, SCRIPTURE_WORKSPACE_ID);
  state = closeResearchWorkspaceGroup(state, researchOriginGroupKey(acts));
  assert.deepEqual(state.tabs.map((tab) => tab.id), ["nicodemus"]);
});

test("Research tabs evict the least-recent session at the validated desktop bound", () => {
  const origin = { book: "ACT", chapter: 19, packageId: "bsb" };
  let state = createResearchWorkspaceState();
  for (let index = 0; index <= MAX_RESEARCH_WORKSPACE_TABS; index += 1) {
    state = openResearchWorkspaceTab(state, {
      id: `tab-${index}`,
      entityId: `entity-${index}`,
      origin,
      nonce: index,
    });
  }
  assert.equal(state.tabs.length, MAX_RESEARCH_WORKSPACE_TABS);
  assert.equal(state.tabs.some((tab) => tab.id === "tab-0"), false);
  assert.equal(state.activeTabId, `tab-${MAX_RESEARCH_WORKSPACE_TABS}`);
});

test("desktop integration owns one draft rail, exit controller, attention scroll, and APG tabs", () => {
  const marking = readFileSync(join(repoRoot, "src/renderer/components/MarkingSurface.tsx"), "utf8");
  const scripture = readFileSync(join(repoRoot, "src/renderer/components/ScripturePage.tsx"), "utf8");
  const workspaceTabs = readFileSync(join(repoRoot, "src/renderer/components/ScriptureWorkspaceTabs.tsx"), "utf8");
  const margin = readFileSync(join(repoRoot, "src/renderer/components/LivingMargin.tsx"), "utf8");
  const app = readFileSync(join(repoRoot, "src/renderer/app.tsx"), "utf8");
  const main = readFileSync(join(repoRoot, "src/electron/main.ts"), "utf8");
  assert.match(marking, /Select more text to keep adding\./);
  assert.match(marking, />Save connection<\/button>/);
  assert.match(marking, />Cancel draft<\/button>/);
  assert.match(marking, /requestDraftExit\("escape"\)/);
  assert.doesNotMatch(marking, /inactivity|countdown|auto.?save/i);
  assert.match(scripture, /scrollIntoView\(\{[\s\S]{0,180}block: "center"/);
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
  assert.match(workspaceTabs, /aria-expanded=\{!group\.collapsed\}/);
  assert.match(workspaceTabs, /Show all \$\{totalTabs\} study tabs/);
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
  assert.match(tabs, /onToggleGroup: \(groupId: string, collapsing: boolean\) => Promise<boolean>/);
});
