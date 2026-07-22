import assert from "node:assert/strict";
import { test } from "node:test";
import { createNavigationHistory, pushNavigationHistory } from "../src/renderer/utils/navigationHistory.js";
import {
  appendEntityResearchTrail,
  activeStudyWorkspaceSession,
  activeStudyWorkspaceTab,
  closeStudyWorkspaceGroup,
  closeStudyWorkspaceTab,
  createStudyWorkspace,
  createStudyWorkspaceGroup,
  moveStudyWorkspaceTab,
  navigateEntityWorkspaceTab,
  openEntityWorkspaceTab,
  openPassageWorkspaceTab,
  orderedStudyWorkspaceGroups,
  orderedStudyWorkspaceTabs,
  renameStudyWorkspaceGroup,
  reopenClosedStudyItem,
  reorderStudyWorkspaceGroup,
  reorderStudyWorkspaceTab,
  resolveStudyWorkspaceDecision,
  selectStudyWorkspaceTab,
  studyWorkspaceGroupLabel,
  studyWorkspaceTabLabel,
  studyWorkspaceTabType,
  studyWorkspaceTranslationCollisionTabIds,
  toggleStudyWorkspaceGroup,
  truncateEntityResearchTrail,
  updateStudyCanvasSession,
  type EntityWorkspaceTab,
  type PassageViewState,
} from "../src/renderer/utils/studyWorkspace.js";

function view(book: string, chapter: number, packageId: string): PassageViewState {
  return {
    book,
    chapter,
    packageId,
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

test("normal passage open reuses a matching tab but explicit duplicate branches", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const first = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "acts-19",
    view: view("JHN", 3, "BSB"),
  });
  const reused = openPassageWorkspaceTab(first.state, {
    id: "ignored",
    sourceTabId: "acts-19",
    view: { ...view("JHN", 3, "BSB"), verse: 16, scrollTop: 480 },
  });
  const duplicate = openPassageWorkspaceTab(reused.state, {
    id: "john-3-copy",
    sourceTabId: "john-3",
    view: view("JHN", 3, "BSB"),
    duplicate: true,
  });
  assert.equal(first.outcome, "opened");
  assert.equal(reused.outcome, "focused");
  assert.equal(reused.state.activeTabId, "john-3");
  assert.deepEqual(reused.state.groups[0]?.tabIds, ["acts-19", "john-3"]);
  assert.equal(reused.state.tabsById["ignored"], undefined);
  const reusedTab = reused.state.tabsById["john-3"];
  assert.equal(reusedTab?.kind, "passage");
  if (reusedTab?.kind === "passage") {
    assert.equal(reusedTab.session.current.verse, 16);
    assert.equal(reusedTab.session.current.scrollTop, 480);
    assert.equal(reusedTab.session.history.back.at(-1)?.verse, 1);
  }
  assert.deepEqual(duplicate.state.groups[0]?.tabIds, ["acts-19", "john-3", "john-3-copy"]);
});

test("an explicit duplicate inserts immediately after a non-tail source", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const john = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "acts-19",
    view: view("JHN", 3, "BSB"),
  }).state;
  const duplicate = openPassageWorkspaceTab(john, {
    id: "acts-19-copy",
    sourceTabId: "acts-19",
    view: view("ACT", 19, "BSB"),
    duplicate: true,
  });
  assert.deepEqual(duplicate.state.groups[0]?.tabIds, ["acts-19", "acts-19-copy", "john-3"]);
});

test("a first study is a JSON-safe ordered group with one active home passage", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const group = initial.groups[0];
  assert.ok(group);
  assert.equal(initial.version, 2);
  assert.equal(group.homePassageTabId, "acts-19");
  assert.equal(group.lastActiveTabId, "acts-19");
  assert.deepEqual(group.tabIds, ["acts-19"]);
  assert.equal(initial.activeTabId, "acts-19");
  assert.deepEqual(initial.activationOrder, ["acts-19"]);
  assert.deepEqual(initial.recentlyClosed, []);
  assert.equal(activeStudyWorkspaceTab(initial), initial.tabsById["acts-19"]);
  assert.equal(activeStudyWorkspaceSession(initial), initial.tabsById["acts-19"]?.kind === "passage"
    ? initial.tabsById["acts-19"].session
    : null);
  assert.deepEqual(orderedStudyWorkspaceGroups(initial), [group]);
  assert.deepEqual(orderedStudyWorkspaceTabs(initial, group.id), [initial.tabsById["acts-19"]]);
  assert.equal(studyWorkspaceGroupLabel(initial, group), "ACT 19");
  assert.equal(studyWorkspaceTabLabel(initial, initial.tabsById["acts-19"]!), "ACT 19");
  assert.equal(studyWorkspaceTabType(initial.tabsById["acts-19"]!), "passage");
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), initial);
});

test("an in-place canvas update keeps its owner when two passage tabs converge", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const opened = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "acts-19",
    view: view("JHN", 3, "BSB"),
  });
  const converged = updateStudyCanvasSession(opened.state, "john-3", (session) => ({
    current: { ...view("ACT", 19, "BSB"), scrollTop: 725 },
    history: pushNavigationHistory(session.history, session.current),
  }));
  const acts = converged.tabsById["acts-19"];
  const john = converged.tabsById["john-3"];
  assert.equal(converged.activeTabId, "john-3");
  assert.deepEqual(converged.groups[0]?.tabIds, ["acts-19", "john-3"]);
  assert.equal(acts?.kind, "passage");
  assert.equal(john?.kind, "passage");
  if (acts?.kind !== "passage" || john?.kind !== "passage") return;
  assert.equal(acts.session.current.scrollTop, 0);
  assert.equal(acts.session.history.back.length, 0);
  assert.equal(john.session.current.book, "ACT");
  assert.equal(john.session.current.scrollTop, 725);
  assert.equal(john.session.history.back[0]?.book, "JHN");
});

test("selection, labels, tab types, and translation collisions remain metadata-only", () => {
  const selectedView: PassageViewState = {
    ...view("ACT", 19, "BSB"),
    selection: {
      packageId: "BSB",
      pieces: [{ verse: 2, charStart: 37, charEnd: 48 }],
    },
  };
  const initial = createStudyWorkspace(selectedView, {
    groupId: "study-1",
    passageTabId: "acts-bsb",
  });
  const translated = openPassageWorkspaceTab(initial, {
    id: "acts-kjv",
    sourceTabId: "acts-bsb",
    view: view("ACT", 19, "KJV"),
  }).state;
  assert.deepEqual(studyWorkspaceTranslationCollisionTabIds(translated), ["acts-bsb", "acts-kjv"]);
  assert.equal(studyWorkspaceTabLabel(translated, translated.tabsById["acts-bsb"]!), "ACT 19 · BSB");
  assert.equal(studyWorkspaceTabLabel(translated, translated.tabsById["acts-kjv"]!), "ACT 19 · KJV");

  const entity: EntityWorkspaceTab = {
    kind: "entity",
    id: "paul",
    groupId: "study-1",
    entityId: "person:paul",
    entityKind: "other",
    origin: selectedView,
    canvas: { current: selectedView, history: createNavigationHistory<PassageViewState>() },
    returnPassageTabId: "acts-bsb",
    trail: [{ id: "person:paul", displayName: "Paul", kind: "person" }],
    scrollTop: 180,
    nonce: 1,
  };
  assert.equal(studyWorkspaceTabLabel(translated, entity), "Paul");
  assert.equal(studyWorkspaceTabType(entity), "person");
  const group = translated.groups[0]!;
  const jsonSafeState = {
    ...translated,
    groups: [{ ...group, tabIds: [...group.tabIds, entity.id] }],
    tabsById: { ...translated.tabsById, [entity.id]: entity },
    recentlyClosed: [
      { kind: "tab" as const, tab: entity, index: 2 },
      {
        kind: "group" as const,
        group,
        tabsById: translated.tabsById,
        index: 0,
      },
    ],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(jsonSafeState)), jsonSafeState);
});

test("entity trail checkpoints retain kind, causal order, and the 12-entry bound", () => {
  let trail = Array.from({ length: 12 }, (_, index) => ({
    id: `entity-${index + 1}`,
    displayName: `Entity ${index + 1}`,
    kind: "other" as const,
  }));
  trail = appendEntityResearchTrail(trail, {
    id: "entity-13",
    displayName: "Entity 13",
    kind: "place",
  });
  assert.equal(trail.length, 12);
  assert.equal(trail[0]?.id, "entity-2");
  const correctedKind = appendEntityResearchTrail(trail, {
    id: "entity-13",
    displayName: "Entity 13",
    kind: "person",
  });
  assert.equal(correctedKind.length, 12);
  assert.equal(correctedKind.at(-1)?.kind, "person");
  assert.equal(truncateEntityResearchTrail(correctedKind, 4).at(-1)?.id, "entity-6");

  const overlong = [
    { id: "entity-0", displayName: "Entity 0", kind: "other" as const },
    ...correctedKind,
  ];
  const reaffirmed = appendEntityResearchTrail(overlong, correctedKind.at(-1)!);
  assert.equal(reaffirmed.length, 12);
  assert.equal(reaffirmed[0]?.id, "entity-2");
});

test("selecting a known tab updates only activation metadata", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const opened = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "acts-19",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(opened, "acts-19");
  assert.equal(selected.activeTabId, "acts-19");
  assert.equal(selected.groups[0]?.lastActiveTabId, "acts-19");
  assert.deepEqual(selected.activationOrder, ["john-3", "acts-19"]);
  assert.equal(selectStudyWorkspaceTab(selected, "missing"), selected);
});

test("an entity keeps its immutable opening origin while passage and entity canvases navigate independently", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const opened = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "acts-19",
  });
  const passageMoved = updateStudyCanvasSession(opened.state, "acts-19", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  const entityMoved = updateStudyCanvasSession(passageMoved, "paul", (session) => ({
    current: view("ROM", 8, "KJV"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  const related = navigateEntityWorkspaceTab(entityMoved, "paul", {
    id: "person:barnabas",
    displayName: "Barnabas",
    kind: "person",
  }, 2);
  const tab = related.tabsById["paul"];
  assert.equal(tab?.kind, "entity");
  if (tab?.kind !== "entity") return;
  assert.deepEqual(tab.origin, origin);
  assert.notEqual(tab.origin, origin);
  assert.deepEqual(tab.originRange, { start: 2, end: 6 });
  assert.equal(tab.canvas.current.book, "ROM");
  assert.equal(tab.entityId, "person:barnabas");
  assert.deepEqual(tab.trail.map((entry) => entry.id), ["person:paul", "person:barnabas"]);
  const passage = related.tabsById["acts-19"];
  assert.equal(passage?.kind, "passage");
  if (passage?.kind === "passage") assert.equal(passage.session.current.book, "JHN");
});

test("entity reuse uses only group, entity, origin context, and range while explicit siblings bypass reuse", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const first = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "acts-19",
  });
  const reused = openEntityWorkspaceTab(first.state, {
    id: "ignored",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 2,
    origin: {
      ...origin,
      verse: 17,
      verseOffset: 0.75,
      scrollTop: 940,
      selection: {
        packageId: "BSB",
        pieces: [{ verse: 17, charStart: 1, charEnd: 4 }],
      },
      margin: {
        ...origin.margin,
        activeTab: "notes",
        scrollTopByTab: { notes: 320 },
      },
    },
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "acts-19",
  });
  assert.equal(reused.outcome, "focused");
  assert.equal(reused.state.activeTabId, "paul");
  assert.equal(reused.state.tabsById["ignored"], undefined);

  const ranged = openEntityWorkspaceTab(reused.state, {
    id: "paul-range",
    sourceTabId: "paul",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 3,
    origin,
    originRange: { start: 7, end: 9 },
    returnPassageTabId: "acts-19",
  });
  const duplicate = openEntityWorkspaceTab(ranged.state, {
    id: "paul-copy",
    sourceTabId: "paul",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 4,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "acts-19",
    duplicate: true,
  });
  assert.equal(ranged.outcome, "opened");
  assert.equal(duplicate.outcome, "opened");
  assert.deepEqual(duplicate.state.groups[0]?.tabIds, [
    "acts-19",
    "paul",
    "paul-copy",
    "paul-range",
  ]);
});

test("an automatic group follows its lone home then freezes on its first branch and a custom name stays stable", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const navigated = updateStudyCanvasSession(initial, "home", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  assert.equal(studyWorkspaceGroupLabel(navigated, navigated.groups[0]!), "JHN 3");

  const branched = openPassageWorkspaceTab(navigated, {
    id: "romans-8",
    sourceTabId: "home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const homeMoved = updateStudyCanvasSession(branched, "home", (session) => ({
    current: view("GEN", 1, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  assert.deepEqual(homeMoved.groups[0]?.label, {
    kind: "automatic",
    frozenReference: { book: "JHN", chapter: 3 },
  });
  assert.equal(studyWorkspaceGroupLabel(homeMoved, homeMoved.groups[0]!), "JHN 3");

  const renamed = renameStudyWorkspaceGroup(homeMoved, "study-1", "Pauline corpus");
  const movedAgain = updateStudyCanvasSession(renamed, "home", (session) => ({
    current: view("EXO", 2, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  assert.equal(studyWorkspaceGroupLabel(movedAgain, movedAgain.groups[0]!), "Pauline corpus");
});

test("creating a study group appends and activates its new home passage", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const created = createStudyWorkspaceGroup(initial, {
    id: "study-2",
    passageTabId: "john-3",
    view: view("JHN", 3, "KJV"),
  });
  assert.equal(created.outcome, "opened");
  assert.equal(created.state.activeTabId, "john-3");
  assert.deepEqual(created.state.groups.map((group) => group.id), ["study-1", "study-2"]);
  assert.deepEqual(created.state.groups[1]?.tabIds, ["john-3"]);
  assert.equal(created.state.tabsById["john-3"]?.groupId, "study-2");
  assert.deepEqual(created.state.activationOrder, ["acts-19", "john-3"]);
});

test("tab reorder actions move deterministically left, right, start, and end", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "a",
  });
  const withB = openPassageWorkspaceTab(initial, {
    id: "b",
    sourceTabId: "a",
    view: view("JHN", 3, "BSB"),
  }).state;
  const withC = openPassageWorkspaceTab(withB, {
    id: "c",
    sourceTabId: "b",
    view: view("ROM", 8, "BSB"),
  }).state;
  const left = reorderStudyWorkspaceTab(withC, { tabId: "c", position: "left" });
  assert.deepEqual(left.groups[0]?.tabIds, ["a", "c", "b"]);
  const start = reorderStudyWorkspaceTab(left, { tabId: "b", position: "start" });
  assert.deepEqual(start.groups[0]?.tabIds, ["b", "a", "c"]);
  const right = reorderStudyWorkspaceTab(start, { tabId: "b", position: "right" });
  assert.deepEqual(right.groups[0]?.tabIds, ["a", "b", "c"]);
  const end = reorderStudyWorkspaceTab(right, { tabId: "a", position: "end" });
  assert.deepEqual(end.groups[0]?.tabIds, ["b", "c", "a"]);
  assert.equal(reorderStudyWorkspaceTab(end, { tabId: "a", position: "right" }), end);
});

test("group reorder actions move deterministically left, right, start, and end", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const second = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "b",
    view: view("JHN", 3, "BSB"),
  }).state;
  const third = createStudyWorkspaceGroup(second, {
    id: "g3",
    passageTabId: "c",
    view: view("ROM", 8, "BSB"),
  }).state;
  const left = reorderStudyWorkspaceGroup(third, { groupId: "g3", position: "left" });
  assert.deepEqual(left.groups.map((group) => group.id), ["g1", "g3", "g2"]);
  const start = reorderStudyWorkspaceGroup(left, { groupId: "g2", position: "start" });
  assert.deepEqual(start.groups.map((group) => group.id), ["g2", "g1", "g3"]);
  const right = reorderStudyWorkspaceGroup(start, { groupId: "g2", position: "right" });
  assert.deepEqual(right.groups.map((group) => group.id), ["g1", "g2", "g3"]);
  const end = reorderStudyWorkspaceGroup(right, { groupId: "g1", position: "end" });
  assert.deepEqual(end.groups.map((group) => group.id), ["g2", "g3", "g1"]);
  assert.equal(reorderStudyWorkspaceGroup(end, { groupId: "g1", position: "right" }), end);
});

test("collapsing an active group preserves the active tab and its proxy identity", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const opened = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "acts-19",
  }).state;
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), opened);
  const activationOrder = opened.activationOrder;
  const collapsed = toggleStudyWorkspaceGroup(opened, "study-1");
  assert.equal(collapsed.groups[0]?.collapsed, true);
  assert.equal(collapsed.activeTabId, "paul");
  assert.equal(collapsed.groups[0]?.lastActiveTabId, "paul");
  assert.equal(collapsed.activationOrder, activationOrder);
  const expanded = toggleStudyWorkspaceGroup(collapsed, "study-1");
  assert.equal(expanded.groups[0]?.collapsed, false);
  assert.equal(expanded.activeTabId, "paul");
});

test("a non-home passage moves between groups without changing its active identity", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "b",
    sourceTabId: "a",
    view: view("JHN", 3, "BSB"),
  }).state;
  const grouped = createStudyWorkspaceGroup(branched, {
    id: "g2",
    passageTabId: "c",
    view: view("ROM", 8, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "b");
  const moved = moveStudyWorkspaceTab(selected, { tabId: "b", targetGroupId: "g2" });
  assert.equal(moved.outcome, "applied");
  assert.deepEqual(moved.state.groups[0]?.tabIds, ["a"]);
  assert.deepEqual(moved.state.groups[1]?.tabIds, ["c", "b"]);
  assert.equal(moved.state.tabsById["b"]?.groupId, "g2");
  assert.equal(moved.state.activeTabId, "b");
  assert.equal(moved.state.groups[0]?.lastActiveTabId, "a");
  assert.equal(moved.state.groups[1]?.lastActiveTabId, "b");
});

test("closing the active tab chooses the nearest sibling and records a recoverable snapshot", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const first = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const second = openEntityWorkspaceTab(first, {
    id: "barnabas",
    sourceTabId: "paul",
    entityId: "person:barnabas",
    entityKind: "person",
    nonce: 2,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const selected = selectStudyWorkspaceTab(second, "paul");
  const closed = closeStudyWorkspaceTab(selected, "paul");
  assert.equal(closed.outcome, "applied");
  assert.equal(closed.state.activeTabId, "barnabas");
  assert.equal(closed.state.groups[0]?.lastActiveTabId, "barnabas");
  assert.deepEqual(closed.state.groups[0]?.tabIds, ["home", "barnabas"]);
  assert.deepEqual(closed.state.activationOrder, ["home", "barnabas"]);
  assert.equal(closed.state.recentlyClosed.at(-1)?.kind, "tab");
  assert.equal(closed.state.recentlyClosed.at(-1)?.kind === "tab"
    ? closed.state.recentlyClosed.at(-1)?.tab.id
    : null, "paul");
});

test("closing a passage with dependent research requires an explicit branch decision", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "nicodemus",
    sourceTabId: "john-3",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "john-3",
  }).state;
  const selected = selectStudyWorkspaceTab(researched, "john-3");
  const requested = closeStudyWorkspaceTab(selected, "john-3");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  assert.equal(requested.state, selected);
  assert.deepEqual(requested.confirmation, {
    kind: "passage-dependencies",
    tabId: "john-3",
    dependentEntityIds: ["nicodemus"],
  });
  const cancelled = resolveStudyWorkspaceDecision(
    selected,
    requested.confirmation,
    "cancel",
  );
  assert.equal(cancelled.state, selected);
  assert.equal(cancelled.outcome, "unchanged");

  const closed = resolveStudyWorkspaceDecision(
    selected,
    requested.confirmation,
    "close-passage-and-research",
  );
  assert.equal(closed.outcome, "applied");
  assert.deepEqual(closed.state.groups[0]?.tabIds, ["home"]);
  assert.equal(closed.state.tabsById["john-3"], undefined);
  assert.equal(closed.state.tabsById["nicodemus"], undefined);
  assert.equal(closed.state.activeTabId, "home");
});

test("keep-research closes only the passage and clears dependent return targets", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "john-3",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "nicodemus",
    sourceTabId: "john-3",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    originRange: { start: 1, end: 21 },
    returnPassageTabId: "john-3",
  }).state;
  const selected = selectStudyWorkspaceTab(researched, "john-3");
  const requested = closeStudyWorkspaceTab(selected, "john-3");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const kept = resolveStudyWorkspaceDecision(selected, requested.confirmation, "keep-research");
  assert.equal(kept.outcome, "applied");
  assert.deepEqual(kept.state.groups[0]?.tabIds, ["home", "nicodemus"]);
  const entity = kept.state.tabsById["nicodemus"];
  assert.equal(entity?.kind, "entity");
  if (entity?.kind !== "entity") return;
  assert.equal(entity.returnPassageTabId, null);
  assert.deepEqual(entity.originRange, { start: 1, end: 21 });
  assert.equal(entity.origin.book, "JHN");
  assert.equal(kept.state.activeTabId, "nicodemus");
});

test("a sole group passage offers keep-open or close-study without invalidating the workspace", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const grouped = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "b",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "a");
  const requested = closeStudyWorkspaceTab(selected, "a");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  assert.deepEqual(requested.confirmation, {
    kind: "sole-group-passage",
    groupId: "g1",
    tabId: "a",
  });
  const kept = resolveStudyWorkspaceDecision(selected, requested.confirmation, "keep-open");
  assert.equal(kept.state, selected);
  assert.equal(kept.outcome, "unchanged");
  const closed = resolveStudyWorkspaceDecision(selected, requested.confirmation, "close-study");
  assert.equal(closed.outcome, "applied");
  assert.deepEqual(closed.state.groups.map((group) => group.id), ["g2"]);
  assert.equal(closed.state.tabsById["a"], undefined);
  assert.equal(closed.state.activeTabId, "b");
  assert.equal(closed.state.recentlyClosed.at(-1)?.kind, "group");

  const finalRefusal = closeStudyWorkspaceGroup(closed.state, "g2");
  assert.equal(finalRefusal.state, closed.state);
  assert.equal(finalRefusal.outcome, "unchanged");
});

test("closing a multi-tab study requires one close-study confirmation", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "a",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "a",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "b",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "paul");
  const requested = closeStudyWorkspaceGroup(selected, "g1");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  assert.deepEqual(requested.confirmation, {
    kind: "close-study",
    groupId: "g1",
    tabIds: ["a", "paul"],
  });
  assert.equal(resolveStudyWorkspaceDecision(selected, requested.confirmation, "cancel").state, selected);
  const closed = resolveStudyWorkspaceDecision(selected, requested.confirmation, "close-study");
  assert.equal(closed.outcome, "applied");
  assert.deepEqual(closed.state.groups.map((group) => group.id), ["g2"]);
  assert.equal(closed.state.activeTabId, "b");
  assert.equal(closed.state.tabsById["paul"], undefined);
});

test("moving a passage branch requires and applies an atomic move-branch decision", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "b",
    sourceTabId: "a",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "nicodemus",
    sourceTabId: "b",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "b",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "c",
    view: view("ROM", 8, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "nicodemus");
  const requested = moveStudyWorkspaceTab(selected, { tabId: "b", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  assert.deepEqual(requested.confirmation, {
    kind: "move-branch",
    tabId: "b",
    dependentEntityIds: ["nicodemus"],
    targetGroupId: "g2",
  });
  assert.equal(resolveStudyWorkspaceDecision(selected, requested.confirmation, "cancel").state, selected);
  const moved = resolveStudyWorkspaceDecision(selected, requested.confirmation, "move-branch");
  assert.equal(moved.outcome, "applied");
  assert.deepEqual(moved.state.groups[0]?.tabIds, ["a"]);
  assert.deepEqual(moved.state.groups[1]?.tabIds, ["c", "b", "nicodemus"]);
  assert.equal(moved.state.tabsById["b"]?.groupId, "g2");
  const entity = moved.state.tabsById["nicodemus"];
  assert.equal(entity?.groupId, "g2");
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : null, "b");
  assert.equal(moved.state.activeTabId, "nicodemus");
});

test("moving an entity copies its immutable origin context before changing groups", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "acts",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "acts",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "john",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "paul");
  const requested = moveStudyWorkspaceTab(selected, { tabId: "paul", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  assert.deepEqual(requested.confirmation, {
    kind: "move-entity-context",
    tabId: "paul",
    targetGroupId: "g2",
  });
  const moved = resolveStudyWorkspaceDecision(
    selected,
    requested.confirmation,
    "copy-origin-passage",
  );
  assert.equal(moved.outcome, "applied");
  const target = moved.state.groups.find((group) => group.id === "g2")!;
  const copied = target.tabIds
    .map((id) => moved.state.tabsById[id])
    .find((tab) => tab?.kind === "passage" && tab.session.current.book === "ACT");
  assert.equal(copied?.kind, "passage");
  const entity = moved.state.tabsById["paul"];
  assert.equal(entity?.kind, "entity");
  if (entity?.kind !== "entity" || copied?.kind !== "passage") return;
  assert.equal(entity.groupId, "g2");
  assert.equal(entity.returnPassageTabId, copied.id);
  assert.deepEqual(entity.origin, origin);
  assert.deepEqual(entity.originRange, { start: 2, end: 6 });
  assert.deepEqual(moved.state.groups.find((group) => group.id === "g1")?.tabIds, ["acts"]);
});

test("moving a home passage offers an explicit move-study decision that keeps the whole study intact", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "acts",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "acts",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "john",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "paul");
  const requested = moveStudyWorkspaceTab(selected, { tabId: "acts", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  assert.deepEqual(requested.confirmation, {
    kind: "move-home-passage",
    tabId: "acts",
    groupId: "g1",
    targetGroupId: "g2",
  });
  const moved = resolveStudyWorkspaceDecision(selected, requested.confirmation, "move-study");
  assert.equal(moved.outcome, "applied");
  assert.deepEqual(moved.state.groups.map((group) => group.id), ["g2"]);
  assert.deepEqual(moved.state.groups[0]?.tabIds, ["john", "acts", "paul"]);
  assert.equal(moved.state.tabsById["acts"]?.groupId, "g2");
  assert.equal(moved.state.tabsById["paul"]?.groupId, "g2");
  assert.equal(moved.state.activeTabId, "paul");
});

test("duplicate-home leaves a valid source home while moving the requested branch and dependents", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "acts",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "acts",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "john",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "paul");
  const requested = moveStudyWorkspaceTab(selected, { tabId: "acts", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const moved = resolveStudyWorkspaceDecision(selected, requested.confirmation, "duplicate-home");
  assert.equal(moved.outcome, "applied");
  const source = moved.state.groups.find((group) => group.id === "g1")!;
  const target = moved.state.groups.find((group) => group.id === "g2")!;
  assert.equal(source.tabIds.length, 1);
  assert.equal(source.homePassageTabId, source.tabIds[0]);
  assert.notEqual(source.homePassageTabId, "acts");
  const duplicate = moved.state.tabsById[source.homePassageTabId];
  assert.equal(duplicate?.kind, "passage");
  assert.equal(duplicate?.kind === "passage" ? duplicate.session.current.book : null, "ACT");
  assert.deepEqual(target.tabIds.slice(-2), ["acts", "paul"]);
  const entity = moved.state.tabsById["paul"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : null, "acts");
  assert.equal(moved.state.activeTabId, "paul");
});

test("reopening a recently closed tab restores its canonical position and activates it", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const paul = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const barnabas = openEntityWorkspaceTab(paul, {
    id: "barnabas",
    sourceTabId: "paul",
    entityId: "person:barnabas",
    entityKind: "person",
    nonce: 2,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const closed = closeStudyWorkspaceTab(barnabas, "paul");
  const reopened = reopenClosedStudyItem(closed.state);
  assert.equal(reopened.outcome, "opened");
  assert.deepEqual(reopened.state.groups[0]?.tabIds, ["home", "paul", "barnabas"]);
  assert.equal(reopened.state.activeTabId, "paul");
  assert.equal(reopened.state.recentlyClosed.length, 0);
  assert.equal(reopened.state.tabsById["paul"]?.kind, "entity");
});

test("reopening a recently closed study restores its group order, tabs, and last active tab", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "a",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "a",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "b",
    view: view("JHN", 3, "BSB"),
  }).state;
  const selected = selectStudyWorkspaceTab(grouped, "paul");
  const requested = closeStudyWorkspaceGroup(selected, "g1");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const closed = resolveStudyWorkspaceDecision(selected, requested.confirmation, "close-study");
  const reopened = reopenClosedStudyItem(closed.state);
  assert.equal(reopened.outcome, "opened");
  assert.deepEqual(reopened.state.groups.map((group) => group.id), ["g1", "g2"]);
  assert.deepEqual(reopened.state.groups[0]?.tabIds, ["a", "paul"]);
  assert.equal(reopened.state.activeTabId, "paul");
  assert.equal(reopened.state.tabsById["a"]?.groupId, "g1");
  assert.equal(reopened.state.tabsById["paul"]?.groupId, "g1");
  assert.equal(reopened.state.recentlyClosed.length, 0);
});

test("the 64-tab and 16-group limits refuse without changing the prior state object", () => {
  const origin = view("ACT", 19, "BSB");
  let atTabLimit = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "home",
  });
  for (let index = 1; index < 64; index += 1) {
    const id = `entity-${index}`;
    const tab: EntityWorkspaceTab = {
      kind: "entity",
      id,
      groupId: "g1",
      entityId: `person:${index}`,
      entityKind: "person",
      origin,
      canvas: { current: origin, history: createNavigationHistory<PassageViewState>() },
      returnPassageTabId: "home",
      trail: [{ id: `person:${index}`, displayName: `Person ${index}`, kind: "person" }],
      scrollTop: 0,
      nonce: index,
    };
    const group = atTabLimit.groups[0]!;
    atTabLimit = {
      ...atTabLimit,
      groups: [{ ...group, tabIds: [...group.tabIds, id] }],
      tabsById: { ...atTabLimit.tabsById, [id]: tab },
      activationOrder: [...atTabLimit.activationOrder, id],
    };
  }
  const entityRefusal = openEntityWorkspaceTab(atTabLimit, {
    id: "overflow-entity",
    sourceTabId: "home",
    entityId: "person:overflow",
    entityKind: "person",
    nonce: 65,
    origin,
    returnPassageTabId: "home",
  });
  assert.equal(entityRefusal.outcome, "tab-limit");
  assert.equal(entityRefusal.state, atTabLimit);
  const passageRefusal = openPassageWorkspaceTab(atTabLimit, {
    id: "overflow-passage",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
    duplicate: true,
  });
  assert.equal(passageRefusal.outcome, "tab-limit");
  assert.equal(passageRefusal.state, atTabLimit);
  const groupAtTabLimit = createStudyWorkspaceGroup(atTabLimit, {
    id: "g2",
    passageTabId: "overflow-group-passage",
    view: view("ROM", 8, "BSB"),
  });
  assert.equal(groupAtTabLimit.outcome, "tab-limit");
  assert.equal(groupAtTabLimit.state, atTabLimit);

  let atGroupLimit = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "p1",
  });
  for (let index = 2; index <= 16; index += 1) {
    atGroupLimit = createStudyWorkspaceGroup(atGroupLimit, {
      id: `g${index}`,
      passageTabId: `p${index}`,
      view: view("JHN", index, "BSB"),
    }).state;
  }
  const groupRefusal = createStudyWorkspaceGroup(atGroupLimit, {
    id: "g17",
    passageTabId: "p17",
    view: view("ROM", 17, "BSB"),
  });
  assert.equal(groupRefusal.outcome, "group-limit");
  assert.equal(groupRefusal.state, atGroupLimit);
});

test("recently closed recovery keeps only the newest ten items", () => {
  const origin = view("ACT", 19, "BSB");
  let state = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "home",
  });
  for (let index = 1; index <= 11; index += 1) {
    state = openEntityWorkspaceTab(state, {
      id: `entity-${index}`,
      sourceTabId: index === 1 ? "home" : `entity-${index - 1}`,
      entityId: `person:${index}`,
      entityKind: "person",
      nonce: index,
      origin,
      returnPassageTabId: "home",
    }).state;
  }
  for (let index = 1; index <= 11; index += 1) {
    state = closeStudyWorkspaceTab(state, `entity-${index}`).state;
  }
  assert.equal(state.recentlyClosed.length, 10);
  assert.equal(state.recentlyClosed[0]?.kind === "tab"
    ? state.recentlyClosed[0].tab.id
    : null, "entity-2");
  assert.equal(state.recentlyClosed.at(-1)?.kind === "tab"
    ? state.recentlyClosed.at(-1)?.tab.id
    : null, "entity-11");
});

test("workspace session updates cap combined back and forward history at fifty", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const updated = updateStudyCanvasSession(initial, "home", (session) => ({
    current: session.current,
    history: {
      back: Array.from({ length: 40 }, (_, index) => view("ACT", index + 1, "BSB")),
      forward: Array.from({ length: 40 }, (_, index) => view("JHN", index + 1, "BSB")),
    },
  }));
  const tab = updated.tabsById["home"];
  assert.equal(tab?.kind, "passage");
  if (tab?.kind !== "passage") return;
  assert.equal(tab.session.history.back.length + tab.session.history.forward.length, 50);
  assert.equal(tab.session.history.back.length, 40);
  assert.equal(tab.session.history.forward.length, 10);
});
