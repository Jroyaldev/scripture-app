import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNavigationHistory,
  pushNavigationHistory,
} from "../src/renderer/utils/navigationHistory.js";
import {
  activeStudyWorkspaceSession,
  createStudyWorkspace,
  openEntityWorkspaceTab,
  openPassageWorkspaceTab,
  selectStudyWorkspaceTab,
  updateActiveStudyCanvasSession,
  updateEntityWorkspaceScrollTop,
  type PassageViewState,
} from "../src/renderer/utils/studyWorkspace.js";

function acts19(overrides: Partial<PassageViewState> = {}): PassageViewState {
  return {
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
    verse: 2,
    verseOffset: 14,
    scrollTop: 120,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: {},
      wordsVerse: 2,
      wordsFollowingReading: true,
    },
    ...overrides,
  };
}

test("duplicate Acts 19 tabs retain independent selection, viewport, lens, words, and history", () => {
  const initial = createStudyWorkspace(acts19(), {
    groupId: "study-acts",
    passageTabId: "acts-a",
  });
  const opened = openPassageWorkspaceTab(initial, {
    id: "acts-b",
    sourceTabId: "acts-a",
    view: acts19(),
    duplicate: true,
  }).state;

  const ownerB = acts19({
    verse: 6,
    verseOffset: 31,
    scrollTop: 880,
    selection: {
      packageId: "bsb",
      pieces: [
        { verse: 5, charStart: 12, charEnd: null },
        { verse: 6, charStart: null, charEnd: 11 },
      ],
    },
    margin: {
      activeTab: "passage",
      scope: { kind: "selection", start: 5, end: 6 },
      scrollTopByTab: { overview: 44, passage: 312 },
      wordsVerse: 6,
      wordsFollowingReading: false,
    },
  });
  const withB = updateActiveStudyCanvasSession(opened, "acts-b", (session) => ({
    current: ownerB,
    history: pushNavigationHistory(session.history, acts19({ scrollTop: 410 })),
  }));
  const selectedA = selectStudyWorkspaceTab(withB, "acts-a");
  const ownerA = acts19({
    verse: 3,
    verseOffset: 5,
    scrollTop: 260,
    selection: {
      packageId: "bsb",
      pieces: [{ verse: 3, charStart: 0, charEnd: 7 }],
    },
    margin: {
      activeTab: "connections",
      scope: { kind: "selection", start: 3, end: 3 },
      scrollTopByTab: { overview: 18, connections: 96 },
      wordsVerse: 3,
      wordsFollowingReading: false,
    },
  });
  const withA = updateActiveStudyCanvasSession(selectedA, "acts-a", () => ({
    current: ownerA,
    history: {
      back: [acts19({ scrollTop: 40 })],
      forward: [acts19({ scrollTop: 620 })],
    },
  }));

  const a = withA.tabsById["acts-a"];
  const b = withA.tabsById["acts-b"];
  assert.equal(a?.kind, "passage");
  assert.equal(b?.kind, "passage");
  if (a?.kind !== "passage" || b?.kind !== "passage") return;
  assert.deepEqual(a.session.current, ownerA);
  assert.deepEqual(a.session.history, {
    back: [acts19({ scrollTop: 40 })],
    forward: [acts19({ scrollTop: 620 })],
  });
  assert.deepEqual(b.session.current, ownerB);
  assert.equal(b.session.history.back[0]?.scrollTop, 410);
  assert.equal(b.session.history.forward.length, 0);
});

test("a delayed publication from owner A cannot mutate active owner B", () => {
  const initial = createStudyWorkspace(acts19(), {
    groupId: "study-acts",
    passageTabId: "acts-a",
  });
  const ownerB = openPassageWorkspaceTab(initial, {
    id: "acts-b",
    sourceTabId: "acts-a",
    view: acts19({
      scrollTop: 780,
      margin: {
        activeTab: "passage",
        scope: null,
        scrollTopByTab: { passage: 220 },
        wordsVerse: 6,
        wordsFollowingReading: false,
      },
    }),
    duplicate: true,
  }).state;
  const before = JSON.stringify(ownerB);

  const stale = updateActiveStudyCanvasSession(ownerB, "acts-a", () => ({
    current: acts19({ scrollTop: 9_999 }),
    history: createNavigationHistory<PassageViewState>(),
  }));

  assert.equal(stale, ownerB);
  assert.equal(JSON.stringify(stale), before);
  assert.equal(activeStudyWorkspaceSession(stale)?.current.scrollTop, 780);
});

test("entity tabs own their canvas session and research scroll independently", () => {
  const origin = acts19();
  const initial = createStudyWorkspace(origin, {
    groupId: "study-acts",
    passageTabId: "acts-a",
  });
  const opened = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-a",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "acts-a",
  }).state;
  const navigatedCanvas = updateActiveStudyCanvasSession(opened, "paul", (session) => ({
    current: acts19({ chapter: 20, verse: 1, scrollTop: 340 }),
    history: pushNavigationHistory(session.history, session.current),
  }));
  const scrolled = updateEntityWorkspaceScrollTop(navigatedCanvas, "paul", 515);
  const entity = scrolled.tabsById["paul"];
  const passage = scrolled.tabsById["acts-a"];

  assert.equal(entity?.kind, "entity");
  assert.equal(passage?.kind, "passage");
  if (entity?.kind !== "entity" || passage?.kind !== "passage") return;
  assert.equal(entity.canvas.current.chapter, 20);
  assert.equal(entity.canvas.history.back[0]?.chapter, 19);
  assert.equal(entity.scrollTop, 515);
  assert.equal(passage.session.current.chapter, 19);
  assert.equal(passage.session.current.scrollTop, 120);
});
