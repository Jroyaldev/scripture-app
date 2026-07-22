import assert from "node:assert/strict";
import { test } from "node:test";
import { createNavigationHistory, pushNavigationHistory } from "../src/renderer/utils/navigationHistory.js";
import {
  appendEntityResearchTrail,
  activeStudyWorkspaceSession,
  activeStudyWorkspaceTab,
  branchEntityWorkspaceTab,
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
  returnEntityWorkspaceToOrigin,
  selectStudyWorkspaceTab,
  studyWorkspaceGroupLabel,
  studyWorkspaceGroupCloseAvailability,
  studyWorkspaceTabCloseAvailability,
  studyWorkspaceTabLabel,
  studyWorkspaceTabType,
  studyWorkspaceTranslationCollisionTabIds,
  visibleStudyWorkspaceTabIds,
  toggleStudyWorkspaceGroup,
  truncateEntityResearchTrail,
  updateEntityWorkspaceTrail,
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

function aliasProbeView(book: string, chapter: number): PassageViewState {
  const state = view(book, chapter, "BSB");
  state.selection = {
    packageId: "BSB",
    pieces: [{ verse: 1, charStart: 2, charEnd: 6 }],
  };
  state.margin.scope = { kind: "selection", start: 2, end: 6 };
  state.margin.scrollTopByTab.overview = 12;
  return state;
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

test("entity trail publication preserves semantic no-op identity and canonically upgrades kind", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    entityKind: "other",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "acts-19",
  }).state;

  const noOp = updateEntityWorkspaceTrail(researched, "paul", (trail) => (
    trail.map((entry) => ({ ...entry }))
  ));
  assert.equal(noOp, researched);

  const upgraded = updateEntityWorkspaceTrail(researched, "paul", (trail) => (
    appendEntityResearchTrail(trail, {
      id: "person:paul",
      displayName: "Paul",
      kind: "person",
    })
  ));
  assert.notEqual(upgraded, researched);
  const tab = upgraded.tabsById["paul"];
  assert.equal(tab?.kind, "entity");
  if (tab?.kind !== "entity") return;
  assert.deepEqual(tab.trail, [{ id: "person:paul", displayName: "Paul", kind: "person" }]);
  assert.equal(tab.entityKind, "person");
  assert.equal(updateEntityWorkspaceTrail(upgraded, "paul", (trail) => [...trail]), upgraded);
});

test("a new entity retains its human name for unavailable-state recovery and reuse", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const opened = openEntityWorkspaceTab(initial, {
    id: "apollos",
    sourceTabId: "acts-19",
    entityId: "person:tipnr:unavailable-apollos",
    displayName: "Apollos",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "acts-19",
  });
  assert.equal(opened.outcome, "opened");
  const entity = opened.state.tabsById["apollos"];
  assert.equal(entity?.kind, "entity");
  if (entity?.kind !== "entity") return;
  assert.deepEqual(entity.trail, [{
    id: "person:tipnr:unavailable-apollos",
    displayName: "Apollos",
    kind: "person",
  }]);

  const reused = openEntityWorkspaceTab(opened.state, {
    id: "ignored-duplicate",
    sourceTabId: "acts-19",
    entityId: "person:tipnr:unavailable-apollos",
    displayName: "Changed lookup label",
    entityKind: "person",
    nonce: 2,
    origin,
    returnPassageTabId: "acts-19",
  });
  assert.equal(reused.outcome, "focused");
  assert.equal(reused.state.tabsById["ignored-duplicate"], undefined);
  assert.equal(reused.state.tabsById["apollos"], entity);
  assert.equal(
    reused.state.tabsById["apollos"]?.kind === "entity"
      ? reused.state.tabsById["apollos"].trail[0]?.displayName
      : undefined,
    "Apollos",
  );
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

test("an explicit entity branch copies provenance and canvas without mutating its parent", () => {
  const origin = aliasProbeView("ACT", 19);
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "acts-19",
  }).state;
  const viewingRomans = updateStudyCanvasSession(researched, "paul", (session) => ({
    current: { ...view("ROM", 6, "BSB"), scrollTop: 720 },
    history: pushNavigationHistory(session.history, session.current),
  }));
  const parentBefore = viewingRomans.tabsById["paul"];
  assert.equal(parentBefore?.kind, "entity");
  if (parentBefore?.kind !== "entity") return;
  const parentBytes = JSON.stringify(parentBefore);

  const branched = branchEntityWorkspaceTab(viewingRomans, {
    id: "barnabas",
    sourceTabId: "paul",
    entry: { id: "person:barnabas", displayName: "Barnabas", kind: "person" },
    nonce: 2,
  });

  assert.equal(branched.outcome, "opened");
  assert.equal(branched.state.tabsById["paul"], parentBefore);
  assert.equal(JSON.stringify(branched.state.tabsById["paul"]), parentBytes);
  assert.deepEqual(branched.state.groups[0]?.tabIds, ["acts-19", "paul", "barnabas"]);
  const child = branched.state.tabsById["barnabas"];
  assert.equal(child?.kind, "entity");
  if (child?.kind !== "entity") return;
  assert.equal(child.entityId, "person:barnabas");
  assert.equal(child.entityKind, "person");
  assert.deepEqual(child.origin, parentBefore.origin);
  assert.notEqual(child.origin, parentBefore.origin);
  assert.deepEqual(child.originRange, parentBefore.originRange);
  assert.notEqual(child.originRange, parentBefore.originRange);
  assert.equal(child.returnPassageTabId, "acts-19");
  assert.deepEqual(child.canvas, parentBefore.canvas);
  assert.notEqual(child.canvas, parentBefore.canvas);
  assert.notEqual(child.canvas.current, parentBefore.canvas.current);
  assert.deepEqual(child.trail.map((entry) => entry.id), ["person:paul", "person:barnabas"]);
  assert.equal(branched.state.activeTabId, "barnabas");
});

test("Return recreates an immutable origin without overwriting a moved passage tab", () => {
  const origin = { ...aliasProbeView("ACT", 19), verse: 6, scrollTop: 540 };
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "opening-passage",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "opening-passage",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "opening-passage",
  }).state;
  const moved = updateStudyCanvasSession(researched, "opening-passage", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  const movedPassageBytes = JSON.stringify(moved.tabsById["opening-passage"]);

  const returned = returnEntityWorkspaceToOrigin(moved, {
    entityTabId: "paul",
    passageTabId: "opening-passage",
  });

  assert.equal(returned.outcome, "opened");
  assert.equal(JSON.stringify(returned.state.tabsById["opening-passage"]), movedPassageBytes);
  assert.equal(returned.state.activeTabId, "opening-passage-2");
  const recreated = returned.state.tabsById["opening-passage-2"];
  assert.equal(recreated?.kind, "passage");
  if (recreated?.kind !== "passage") return;
  assert.deepEqual(recreated.session.current, origin);
  assert.deepEqual(recreated.session.history, createNavigationHistory<PassageViewState>());
  const entity = returned.state.tabsById["paul"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, recreated.id);
  assert.deepEqual(entity?.kind === "entity" ? entity.origin : undefined, origin);
});

test("Return reuses only a matching origin passage in the same study and preserves its Back history", () => {
  const origin = { ...aliasProbeView("ACT", 19), verse: 6, scrollTop: 540 };
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "opening-passage",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "opening-passage",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "opening-passage",
  }).state;
  const moved = updateStudyCanvasSession(researched, "opening-passage", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  const matching = openPassageWorkspaceTab(moved, {
    id: "other-acts",
    sourceTabId: "paul",
    view: { ...origin, verse: 12, scrollTop: 960 },
  }).state;
  const withOtherGroup = createStudyWorkspaceGroup(matching, {
    id: "study-2",
    passageTabId: "foreign-acts",
    view: origin,
  }).state;

  const returned = returnEntityWorkspaceToOrigin(withOtherGroup, {
    entityTabId: "paul",
    passageTabId: "unused-origin",
  });

  assert.equal(returned.outcome, "focused");
  assert.equal(returned.state.activeTabId, "other-acts");
  assert.equal(returned.state.tabsById["unused-origin"], undefined);
  const passage = returned.state.tabsById["other-acts"];
  assert.equal(passage?.kind, "passage");
  if (passage?.kind !== "passage") return;
  assert.deepEqual(passage.session.current, origin);
  assert.equal(passage.session.history.back.at(-1)?.verse, 12);
  assert.equal(passage.session.history.back.at(-1)?.scrollTop, 960);
  const foreign = returned.state.tabsById["foreign-acts"];
  assert.equal(foreign?.kind === "passage" ? foreign.session.history.back.length : -1, 0);
  const entity = returned.state.tabsById["paul"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, "other-acts");
});

test("same-group return pointers are accepted only while the passage matches immutable origin", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "opening-passage",
  });
  const moved = updateStudyCanvasSession(initial, "opening-passage", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  const opened = openEntityWorkspaceTab(moved, {
    id: "paul",
    sourceTabId: "opening-passage",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "opening-passage",
  });

  assert.equal(opened.outcome, "opened");
  const entity = opened.state.tabsById["paul"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, null);
});

test("Return refuses a missing immutable origin at the tab cap without mutating state", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "study-1",
    passageTabId: "opening-passage",
  });
  let full = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "opening-passage",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "opening-passage",
  }).state;
  for (let index = 0; index < 62; index += 1) {
    full = openPassageWorkspaceTab(full, {
      id: `filler-${index}`,
      sourceTabId: "paul",
      view: view("ROM", 8, "BSB"),
      duplicate: true,
    }).state;
  }
  full = updateStudyCanvasSession(full, "opening-passage", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  assert.equal(Object.keys(full.tabsById).length, 64);
  const beforeBytes = JSON.stringify(full);

  const refused = returnEntityWorkspaceToOrigin(full, {
    entityTabId: "paul",
    passageTabId: "opening-passage",
  });

  assert.equal(refused.outcome, "tab-limit");
  assert.equal(refused.state, full);
  assert.equal(JSON.stringify(refused.state), beforeBytes);
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
  assert.deepEqual(visibleStudyWorkspaceTabIds(collapsed), ["paul"]);
  const expanded = toggleStudyWorkspaceGroup(collapsed, "study-1");
  assert.equal(expanded.groups[0]?.collapsed, false);
  assert.equal(expanded.activeTabId, "paul");
});

test("every collapsed study retains its valid last-active tab as a selectable proxy", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "acts-19",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "acts-19",
    entityId: "person:paul",
    displayName: "Paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "acts-19",
  }).state;
  const twoStudies = createStudyWorkspaceGroup(researched, {
    id: "study-2",
    passageTabId: "john-3",
    view: view("JHN", 3, "BSB"),
  }).state;
  const collapsed = toggleStudyWorkspaceGroup(twoStudies, "study-1");

  assert.equal(collapsed.activeTabId, "john-3");
  assert.equal(collapsed.groups[0]?.lastActiveTabId, "paul");
  assert.deepEqual(visibleStudyWorkspaceTabIds(collapsed), ["paul", "john-3"]);

  const selectedProxy = selectStudyWorkspaceTab(collapsed, "paul");
  assert.equal(selectedProxy.activeTabId, "paul");
  assert.equal(selectedProxy.groups[0]?.collapsed, true);
  assert.deepEqual(visibleStudyWorkspaceTabIds(selectedProxy), ["paul", "john-3"]);
});

test("close availability distinguishes direct actions from decisions and impossible closes", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "acts",
  });
  assert.equal(studyWorkspaceTabCloseAvailability(initial, "acts"), "unavailable");
  assert.equal(studyWorkspaceGroupCloseAvailability(initial, "g1"), "unavailable");

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

  assert.equal(studyWorkspaceTabCloseAvailability(grouped, "paul"), "direct");
  assert.equal(studyWorkspaceTabCloseAvailability(grouped, "acts"), "decision");
  assert.equal(studyWorkspaceTabCloseAvailability(grouped, "missing"), "unavailable");
  assert.equal(studyWorkspaceGroupCloseAvailability(grouped, "g1"), "decision");
  assert.equal(studyWorkspaceGroupCloseAvailability(grouped, "g2"), "direct");
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

test("moving a passage into a pristine target freezes the target automatic label", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "b",
    sourceTabId: "a",
    view: view("ROM", 8, "BSB"),
  }).state;
  const grouped = createStudyWorkspaceGroup(branched, {
    id: "g2",
    passageTabId: "john",
    view: view("JHN", 3, "BSB"),
  }).state;
  const moved = moveStudyWorkspaceTab(grouped, { tabId: "b", targetGroupId: "g2" });
  assert.equal(moved.outcome, "applied");
  assert.deepEqual(moved.state.groups[1]?.label, {
    kind: "automatic",
    frozenReference: { book: "JHN", chapter: 3 },
  });
  const navigated = updateStudyCanvasSession(moved.state, "john", (session) => ({
    current: view("GEN", 1, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  assert.equal(studyWorkspaceGroupLabel(navigated, navigated.groups[1]!), "JHN 3");
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

test("closing a home passage promotes the nearest remaining passage with a right-side tie break", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "study-1",
    passageTabId: "home",
  });
  const left = openPassageWorkspaceTab(initial, {
    id: "left",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const right = openPassageWorkspaceTab(left, {
    id: "right",
    sourceTabId: "left",
    view: view("ROM", 8, "BSB"),
  }).state;
  const centered = reorderStudyWorkspaceTab(right, { tabId: "home", position: "right" });
  assert.deepEqual(centered.groups[0]?.tabIds, ["left", "home", "right"]);
  const selected = selectStudyWorkspaceTab(centered, "home");
  const closed = closeStudyWorkspaceTab(selected, "home");
  assert.equal(closed.outcome, "applied");
  assert.deepEqual(closed.state.groups[0]?.tabIds, ["left", "right"]);
  assert.equal(closed.state.groups[0]?.homePassageTabId, "right");
  assert.equal(closed.state.activeTabId, "right");
});

test("the final global passage tab can never be removed", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "only-study",
    passageTabId: "only-passage",
  });
  const refused = closeStudyWorkspaceTab(initial, "only-passage");
  assert.equal(refused.outcome, "unchanged");
  assert.equal(refused.state, initial);
  assert.equal(refused.state.tabsById["only-passage"]?.kind, "passage");
  assert.deepEqual(refused.state.groups[0]?.tabIds, ["only-passage"]);
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
    entityNonces: [{ tabId: "nicodemus", nonce: 1 }],
    sourceGroupId: "study-1",
    sourceTabIds: ["home", "john-3", "nicodemus"],
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

test("a stale passage-dependencies confirmation cannot close a branch after it moved groups", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "entity",
    sourceTabId: "branch",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "target-home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const closeRequest = closeStudyWorkspaceTab(grouped, "branch");
  const moveRequest = moveStudyWorkspaceTab(grouped, { tabId: "branch", targetGroupId: "g2" });
  assert.equal(closeRequest.outcome, "needs-confirmation");
  assert.equal(moveRequest.outcome, "needs-confirmation");
  if (closeRequest.outcome !== "needs-confirmation"
    || moveRequest.outcome !== "needs-confirmation") return;
  const moved = resolveStudyWorkspaceDecision(grouped, moveRequest.confirmation, "move-branch");
  assert.equal(moved.outcome, "applied");
  const stale = resolveStudyWorkspaceDecision(
    moved.state,
    closeRequest.confirmation,
    "close-passage-and-research",
  );
  assert.equal(stale.outcome, "unchanged");
  assert.equal(stale.state, moved.state);
  assert.equal(stale.state.tabsById["branch"]?.groupId, "g2");
  assert.equal(stale.state.tabsById["entity"]?.groupId, "g2");
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
    tabIds: ["a"],
    entityNonces: [],
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

test("a stale sole-passage confirmation cannot close research added after the prompt", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "a",
  });
  const grouped = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "b",
    view: view("JHN", 3, "BSB"),
  }).state;
  const requested = closeStudyWorkspaceTab(grouped, "a");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const changed = openEntityWorkspaceTab(grouped, {
    id: "paul",
    sourceTabId: "a",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "a",
  }).state;
  const stale = resolveStudyWorkspaceDecision(changed, requested.confirmation, "close-study");
  assert.equal(stale.outcome, "unchanged");
  assert.equal(stale.state, changed);
  assert.deepEqual(stale.state.groups.find((group) => group.id === "g1")?.tabIds, ["a", "paul"]);
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
    entityNonces: [{ tabId: "paul", nonce: 1 }],
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
    entityNonces: [{ tabId: "nicodemus", nonce: 1 }],
    sourceGroupId: "g1",
    sourceTabIds: ["a", "b", "nicodemus"],
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

test("a stale move-branch confirmation cannot move a branch again from a new source group", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "entity",
    sourceTabId: "branch",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const second = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "p2",
    view: view("ROM", 8, "BSB"),
  }).state;
  const grouped = createStudyWorkspaceGroup(second, {
    id: "g3",
    passageTabId: "p3",
    view: view("GEN", 1, "BSB"),
  }).state;
  const oldRequest = moveStudyWorkspaceTab(grouped, { tabId: "branch", targetGroupId: "g2" });
  const currentRequest = moveStudyWorkspaceTab(grouped, { tabId: "branch", targetGroupId: "g3" });
  assert.equal(oldRequest.outcome, "needs-confirmation");
  assert.equal(currentRequest.outcome, "needs-confirmation");
  if (oldRequest.outcome !== "needs-confirmation"
    || currentRequest.outcome !== "needs-confirmation") return;
  const moved = resolveStudyWorkspaceDecision(
    grouped,
    currentRequest.confirmation,
    "move-branch",
  );
  assert.equal(moved.outcome, "applied");
  const stale = resolveStudyWorkspaceDecision(
    moved.state,
    oldRequest.confirmation,
    "move-branch",
  );
  assert.equal(stale.outcome, "unchanged");
  assert.equal(stale.state, moved.state);
  assert.equal(stale.state.tabsById["branch"]?.groupId, "g3");
  assert.equal(stale.state.tabsById["entity"]?.groupId, "g3");
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
    sourceGroupId: "g1",
    nonce: 1,
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

test("a stale entity-move confirmation cannot move an entity again from a new source group", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "p1",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "p1",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "p1",
  }).state;
  const second = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "p2",
    view: origin,
  }).state;
  const grouped = createStudyWorkspaceGroup(second, {
    id: "g3",
    passageTabId: "p3",
    view: origin,
  }).state;
  const oldRequest = moveStudyWorkspaceTab(grouped, { tabId: "paul", targetGroupId: "g2" });
  const currentRequest = moveStudyWorkspaceTab(grouped, { tabId: "paul", targetGroupId: "g3" });
  assert.equal(oldRequest.outcome, "needs-confirmation");
  assert.equal(currentRequest.outcome, "needs-confirmation");
  if (oldRequest.outcome !== "needs-confirmation"
    || currentRequest.outcome !== "needs-confirmation") return;
  const moved = resolveStudyWorkspaceDecision(
    grouped,
    currentRequest.confirmation,
    "copy-origin-passage",
  );
  assert.equal(moved.outcome, "applied");
  const stale = resolveStudyWorkspaceDecision(
    moved.state,
    oldRequest.confirmation,
    "copy-origin-passage",
  );
  assert.equal(stale.outcome, "unchanged");
  assert.equal(stale.state, moved.state);
  assert.equal(stale.state.tabsById["paul"]?.groupId, "g3");
});

test("a stale entity-move confirmation cannot move a later in-place entity session", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "p1",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "research",
    sourceTabId: "p1",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "p1",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "p2",
    view: origin,
  }).state;
  const requested = moveStudyWorkspaceTab(grouped, { tabId: "research", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const navigated = navigateEntityWorkspaceTab(grouped, "research", {
    id: "person:barnabas",
    displayName: "Barnabas",
    kind: "person",
  }, 2);
  const stale = resolveStudyWorkspaceDecision(
    navigated,
    requested.confirmation,
    "copy-origin-passage",
  );
  assert.equal(stale.outcome, "unchanged");
  assert.equal(stale.state, navigated);
  const entity = stale.state.tabsById["research"];
  assert.equal(entity?.kind === "entity" ? entity.entityId : null, "person:barnabas");
  assert.equal(entity?.groupId, "g1");
});

test("an entity move reuses an existing origin passage and freezes the pristine target label", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "p1",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "p1",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: "p1",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "existing-origin",
    view: { ...origin, scrollTop: 810 },
  }).state;
  const requested = moveStudyWorkspaceTab(grouped, { tabId: "paul", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const beforeCount = Object.keys(grouped.tabsById).length;
  const moved = resolveStudyWorkspaceDecision(
    grouped,
    requested.confirmation,
    "copy-origin-passage",
  );
  assert.equal(moved.outcome, "applied");
  assert.equal(Object.keys(moved.state.tabsById).length, beforeCount);
  const target = moved.state.groups.find((group) => group.id === "g2")!;
  assert.deepEqual(target.tabIds, ["existing-origin", "paul"]);
  assert.deepEqual(target.label, {
    kind: "automatic",
    frozenReference: { book: "ACT", chapter: 19 },
  });
  const entity = moved.state.tabsById["paul"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : null, "existing-origin");
  const navigated = updateStudyCanvasSession(moved.state, "existing-origin", (session) => ({
    current: view("JHN", 3, "BSB"),
    history: pushNavigationHistory(session.history, session.current),
  }));
  assert.equal(studyWorkspaceGroupLabel(navigated, navigated.groups[1]!), "ACT 19");
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
    sourceTabIds: ["acts", "paul"],
    entityNonces: [{ tabId: "paul", nonce: 1 }],
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

test("a stale move-home confirmation cannot sweep tabs added after the prompt", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "home",
  });
  const grouped = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "target-home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const requested = moveStudyWorkspaceTab(grouped, { tabId: "home", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const changed = openEntityWorkspaceTab(grouped, {
    id: "paul",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "home",
  }).state;
  const stale = resolveStudyWorkspaceDecision(changed, requested.confirmation, "move-study");
  assert.equal(stale.outcome, "unchanged");
  assert.equal(stale.state, changed);
  assert.deepEqual(stale.state.groups.find((group) => group.id === "g1")?.tabIds, ["home", "paul"]);
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

test("reopen refuses at tab and group caps without consuming recently closed recovery", () => {
  const origin = view("ACT", 19, "BSB");
  const initial = createStudyWorkspace(origin, {
    groupId: "g1",
    passageTabId: "home",
  });
  const opened = openEntityWorkspaceTab(initial, {
    id: "restore-me",
    sourceTabId: "home",
    entityId: "person:restore",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "home",
  }).state;
  const closedTab = closeStudyWorkspaceTab(opened, "restore-me").state;
  let atTabLimit = closedTab;
  for (let index = 1; index < 64; index += 1) {
    const id = `filler-${index}`;
    const tab: EntityWorkspaceTab = {
      kind: "entity",
      id,
      groupId: "g1",
      entityId: `person:filler-${index}`,
      entityKind: "person",
      origin,
      canvas: { current: origin, history: createNavigationHistory<PassageViewState>() },
      returnPassageTabId: "home",
      trail: [{ id: `person:filler-${index}`, displayName: `Filler ${index}`, kind: "person" }],
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
  const tabRecovery = atTabLimit.recentlyClosed;
  const refusedTab = reopenClosedStudyItem(atTabLimit);
  assert.equal(refusedTab.outcome, "tab-limit");
  assert.equal(refusedTab.state, atTabLimit);
  assert.equal(refusedTab.state.recentlyClosed, tabRecovery);

  const research = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin,
    returnPassageTabId: "home",
  }).state;
  const second = createStudyWorkspaceGroup(research, {
    id: "g2",
    passageTabId: "p2",
    view: view("JHN", 3, "BSB"),
  }).state;
  const closeRequest = closeStudyWorkspaceGroup(second, "g1");
  assert.equal(closeRequest.outcome, "needs-confirmation");
  if (closeRequest.outcome !== "needs-confirmation") return;
  let atGroupLimit = resolveStudyWorkspaceDecision(
    second,
    closeRequest.confirmation,
    "close-study",
  ).state;
  for (let index = 3; index <= 17; index += 1) {
    atGroupLimit = createStudyWorkspaceGroup(atGroupLimit, {
      id: `g${index}`,
      passageTabId: `p${index}`,
      view: view("ROM", index, "BSB"),
    }).state;
  }
  assert.equal(atGroupLimit.groups.length, 16);
  const groupRecovery = atGroupLimit.recentlyClosed;
  const refusedGroup = reopenClosedStudyItem(atGroupLimit);
  assert.equal(refusedGroup.outcome, "group-limit");
  assert.equal(refusedGroup.state, atGroupLimit);
  assert.equal(refusedGroup.state.recentlyClosed, groupRecovery);
});

test("forged confirmation payloads cannot mutate the workspace", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "john",
    view: view("JHN", 3, "BSB"),
  }).state;
  const forgedClose = resolveStudyWorkspaceDecision(grouped, {
    kind: "close-study",
    groupId: "g1",
    tabIds: ["home"],
    entityNonces: [{ tabId: "paul", nonce: 1 }],
  }, "close-study");
  assert.equal(forgedClose.outcome, "unchanged");
  assert.equal(forgedClose.state, grouped);
  const forgedMove = resolveStudyWorkspaceDecision(grouped, {
    kind: "move-entity-context",
    tabId: "paul",
    sourceGroupId: "g2",
    nonce: 1,
    targetGroupId: "g2",
  }, "copy-origin-passage");
  assert.equal(forgedMove.outcome, "unchanged");
  assert.equal(forgedMove.state, grouped);
});

test("an exact one-tab close-study confirmation is rejected as unissued", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const grouped = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "other-home",
    view: view("JHN", 3, "BSB"),
  }).state;

  const forged = resolveStudyWorkspaceDecision(grouped, {
    kind: "close-study",
    groupId: "g1",
    tabIds: ["home"],
    entityNonces: [],
  }, "close-study");

  assert.equal(forged.outcome, "unchanged");
  assert.equal(forged.state, grouped);
});

test("an exact zero-dependent move-branch confirmation is rejected as unissued", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const grouped = createStudyWorkspaceGroup(branched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("ROM", 8, "BSB"),
  }).state;

  const forged = resolveStudyWorkspaceDecision(grouped, {
    kind: "move-branch",
    tabId: "branch",
    dependentEntityIds: [],
    entityNonces: [],
    sourceGroupId: "g1",
    sourceTabIds: ["home", "branch"],
    targetGroupId: "g2",
  }, "move-branch");

  assert.equal(forged.outcome, "unchanged");
  assert.equal(forged.state, grouped);
});

test("an exact zero-dependent passage-dependencies confirmation is rejected as unissued", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const confirmation = {
    kind: "passage-dependencies" as const,
    tabId: "branch",
    dependentEntityIds: [],
    entityNonces: [],
    sourceGroupId: "g1",
    sourceTabIds: ["home", "branch"],
  };

  const closed = resolveStudyWorkspaceDecision(
    branched,
    confirmation,
    "close-passage-and-research",
  );
  const kept = resolveStudyWorkspaceDecision(branched, confirmation, "keep-research");

  assert.equal(closed.outcome, "unchanged");
  assert.equal(closed.state, branched);
  assert.equal(kept.outcome, "unchanged");
  assert.equal(kept.state, branched);
});

test("a decision reports unchanged when its guarded removal cannot produce a valid state", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "paul",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const refused = resolveStudyWorkspaceDecision(grouped, {
    kind: "passage-dependencies",
    tabId: "home",
    dependentEntityIds: ["paul"],
    entityNonces: [{ tabId: "paul", nonce: 1 }],
    sourceGroupId: "g1",
    sourceTabIds: ["home", "paul"],
  }, "close-passage-and-research");
  assert.equal(refused.outcome, "unchanged");
  assert.equal(refused.state, grouped);
});

test("a passage-dependencies confirmation expires when dependent research navigates", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "entity",
    sourceTabId: "branch",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const requested = closeStudyWorkspaceTab(researched, "branch");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const navigated = navigateEntityWorkspaceTab(
    researched,
    "entity",
    { id: "person:joseph", displayName: "Joseph", kind: "person" },
    2,
  );

  const closed = resolveStudyWorkspaceDecision(
    navigated,
    requested.confirmation,
    "close-passage-and-research",
  );
  const kept = resolveStudyWorkspaceDecision(
    navigated,
    requested.confirmation,
    "keep-research",
  );

  assert.equal(closed.outcome, "unchanged");
  assert.equal(closed.state, navigated);
  assert.equal(kept.outcome, "unchanged");
  assert.equal(kept.state, navigated);
});

test("a move-branch confirmation expires when dependent research navigates", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "entity",
    sourceTabId: "branch",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const requested = moveStudyWorkspaceTab(grouped, { tabId: "branch", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const navigated = navigateEntityWorkspaceTab(
    grouped,
    "entity",
    { id: "person:joseph", displayName: "Joseph", kind: "person" },
    2,
  );

  const moved = resolveStudyWorkspaceDecision(
    navigated,
    requested.confirmation,
    "move-branch",
  );

  assert.equal(moved.outcome, "unchanged");
  assert.equal(moved.state, navigated);
});

test("a move-home confirmation expires when research in the study navigates", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "entity",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const requested = moveStudyWorkspaceTab(grouped, { tabId: "home", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const navigated = navigateEntityWorkspaceTab(
    grouped,
    "entity",
    { id: "person:barnabas", displayName: "Barnabas", kind: "person" },
    2,
  );

  for (const decision of ["move-study", "duplicate-home"] as const) {
    const moved = resolveStudyWorkspaceDecision(navigated, requested.confirmation, decision);
    assert.equal(moved.outcome, "unchanged");
    assert.equal(moved.state, navigated);
  }
});

test("a sole-group-passage confirmation expires when research in the study navigates", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "entity",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const requested = closeStudyWorkspaceTab(grouped, "home");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const navigated = navigateEntityWorkspaceTab(
    grouped,
    "entity",
    { id: "person:barnabas", displayName: "Barnabas", kind: "person" },
    2,
  );

  const closed = resolveStudyWorkspaceDecision(
    navigated,
    requested.confirmation,
    "close-study",
  );

  assert.equal(closed.outcome, "unchanged");
  assert.equal(closed.state, navigated);
});

test("a close-study confirmation expires when research in the study navigates", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "entity",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const requested = closeStudyWorkspaceGroup(grouped, "g1");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const navigated = navigateEntityWorkspaceTab(
    grouped,
    "entity",
    { id: "person:barnabas", displayName: "Barnabas", kind: "person" },
    2,
  );

  const closed = resolveStudyWorkspaceDecision(
    navigated,
    requested.confirmation,
    "close-study",
  );

  assert.equal(closed.outcome, "unchanged");
  assert.equal(closed.state, navigated);
});

test("opening research clears a return passage outside the source group", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const grouped = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "other-home",
    view: view("JHN", 3, "BSB"),
  }).state;

  const opened = openEntityWorkspaceTab(grouped, {
    id: "entity",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "other-home",
  });

  assert.equal(opened.outcome, "opened");
  const entity = opened.state.tabsById["entity"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, null);
});

test("reopening research clears a return passage that moved to another group", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "entity",
    sourceTabId: "branch",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const grouped = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "other-home",
    view: view("ROM", 8, "BSB"),
  }).state;
  const closed = closeStudyWorkspaceTab(grouped, "entity");
  assert.equal(closed.outcome, "applied");
  const moved = moveStudyWorkspaceTab(closed.state, { tabId: "branch", targetGroupId: "g2" });
  assert.equal(moved.outcome, "applied");

  const reopened = reopenClosedStudyItem(moved.state);

  assert.equal(reopened.outcome, "opened");
  const entity = reopened.state.tabsById["entity"];
  assert.equal(entity?.groupId, "g1");
  assert.equal(reopened.state.tabsById["branch"]?.groupId, "g2");
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, null);
});

test("reopening a closed passage branch restores its complete canonical tab order", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const withFirst = openEntityWorkspaceTab(branched, {
    id: "first",
    sourceTabId: "branch",
    entityId: "person:first",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const withSecond = openEntityWorkspaceTab(withFirst, {
    id: "second",
    sourceTabId: "branch",
    entityId: "person:second",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const complete = openPassageWorkspaceTab(withSecond, {
    id: "tail",
    sourceTabId: "first",
    view: view("ROM", 8, "BSB"),
  }).state;
  const originalOrder = [...(complete.groups[0]?.tabIds ?? [])];
  assert.deepEqual(originalOrder, ["home", "branch", "second", "first", "tail"]);
  const requested = closeStudyWorkspaceTab(complete, "branch");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  let recovered = resolveStudyWorkspaceDecision(
    complete,
    requested.confirmation,
    "close-passage-and-research",
  ).state;

  for (let index = 0; index < 3; index += 1) {
    const reopened = reopenClosedStudyItem(recovered);
    assert.equal(reopened.outcome, "opened");
    recovered = reopened.state;
  }

  assert.deepEqual(recovered.groups[0]?.tabIds, originalOrder);
  assert.equal(recovered.recentlyClosed.length, 0);
  for (const entityId of ["first", "second"]) {
    const entity = recovered.tabsById[entityId];
    assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, "branch");
  }
});

test("copied origin IDs reserve every live and group-recovery tab ID", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "research",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const targetGroup = createStudyWorkspaceGroup(researched, {
    id: "g2",
    passageTabId: "target-home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const withLiveBase = openPassageWorkspaceTab(targetGroup, {
    id: "research-origin",
    sourceTabId: "target-home",
    view: view("ROM", 8, "BSB"),
    duplicate: true,
  }).state;
  const withReservedGroup = createStudyWorkspaceGroup(withLiveBase, {
    id: "g3",
    passageTabId: "research-origin-2",
    view: view("GAL", 2, "BSB"),
  }).state;
  const closedGroup = closeStudyWorkspaceGroup(withReservedGroup, "g3");
  assert.equal(closedGroup.outcome, "applied");
  const withFiller = openPassageWorkspaceTab(closedGroup.state, {
    id: "filler",
    sourceTabId: "target-home",
    view: view("EPH", 2, "BSB"),
    duplicate: true,
  }).state;
  const buried = closeStudyWorkspaceTab(withFiller, "filler");
  assert.equal(buried.outcome, "applied");
  const requested = moveStudyWorkspaceTab(
    buried.state,
    { tabId: "research", targetGroupId: "g2" },
  );
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;

  const moved = resolveStudyWorkspaceDecision(
    buried.state,
    requested.confirmation,
    "copy-origin-passage",
  );

  assert.equal(moved.outcome, "applied");
  const entity = moved.state.tabsById["research"];
  assert.equal(
    entity?.kind === "entity" ? entity.returnPassageTabId : undefined,
    "research-origin-3",
  );
  assert.equal(moved.state.tabsById["research-origin-3"]?.kind, "passage");
  const fillerReopened = reopenClosedStudyItem(moved.state);
  assert.equal(fillerReopened.outcome, "opened");
  const groupReopened = reopenClosedStudyItem(fillerReopened.state);
  assert.equal(groupReopened.outcome, "opened");
  assert.equal(groupReopened.state.recentlyClosed.length, 0);
  assert.equal(groupReopened.state.tabsById["research-origin-2"]?.groupId, "g3");
});

test("duplicate home IDs reserve every live and tab-recovery tab ID", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const withLiveBase = openPassageWorkspaceTab(initial, {
    id: "home-home",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
    duplicate: true,
  }).state;
  const withReserved = openPassageWorkspaceTab(withLiveBase, {
    id: "home-home-2",
    sourceTabId: "home-home",
    view: view("ROM", 8, "BSB"),
    duplicate: true,
  }).state;
  const closedReserved = closeStudyWorkspaceTab(withReserved, "home-home-2");
  assert.equal(closedReserved.outcome, "applied");
  const withFiller = openPassageWorkspaceTab(closedReserved.state, {
    id: "filler",
    sourceTabId: "home-home",
    view: view("GAL", 2, "BSB"),
    duplicate: true,
  }).state;
  const buried = closeStudyWorkspaceTab(withFiller, "filler");
  assert.equal(buried.outcome, "applied");
  const grouped = createStudyWorkspaceGroup(buried.state, {
    id: "g2",
    passageTabId: "target-home",
    view: view("EPH", 2, "BSB"),
  }).state;
  const requested = moveStudyWorkspaceTab(grouped, { tabId: "home", targetGroupId: "g2" });
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;

  const moved = resolveStudyWorkspaceDecision(
    grouped,
    requested.confirmation,
    "duplicate-home",
  );

  assert.equal(moved.outcome, "applied");
  assert.equal(moved.state.groups.find((group) => group.id === "g1")?.homePassageTabId, "home-home-3");
  const fillerReopened = reopenClosedStudyItem(moved.state);
  assert.equal(fillerReopened.outcome, "opened");
  const reservedReopened = reopenClosedStudyItem(fillerReopened.state);
  assert.equal(reservedReopened.outcome, "opened");
  assert.equal(reservedReopened.state.recentlyClosed.length, 0);
  assert.equal(reservedReopened.state.tabsById["home-home-2"]?.groupId, "g1");
});

test("creating the first study clones the caller passage view", () => {
  const input = aliasProbeView("ACT", 19);
  const created = createStudyWorkspace(input, { groupId: "g1", passageTabId: "home" });

  input.book = "ROM";
  input.selection?.pieces.splice(0, 1, { verse: 9, charStart: 90, charEnd: 99 });
  if (input.margin.scope?.kind === "selection") input.margin.scope.start = 90;
  input.margin.scrollTopByTab.overview = 90;

  const stored = created.tabsById["home"];
  assert.equal(stored?.kind, "passage");
  if (stored?.kind !== "passage") return;
  assert.equal(stored.session.current.book, "ACT");
  assert.equal(stored.session.current.selection?.pieces[0]?.charStart, 2);
  assert.deepEqual(stored.session.current.margin.scope, { kind: "selection", start: 2, end: 6 });
  assert.equal(stored.session.current.margin.scrollTopByTab.overview, 12);
});

test("creating a study group clones the caller passage view", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const input = aliasProbeView("JHN", 3);
  const created = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "other-home",
    view: input,
  });

  input.selection?.pieces.splice(0, 1, { verse: 9, charStart: 90, charEnd: 99 });
  if (input.margin.scope?.kind === "selection") input.margin.scope.start = 90;
  input.margin.scrollTopByTab.overview = 90;

  const stored = created.state.tabsById["other-home"];
  assert.equal(stored?.kind, "passage");
  if (stored?.kind !== "passage") return;
  assert.equal(stored.session.current.selection?.pieces[0]?.charStart, 2);
  assert.deepEqual(stored.session.current.margin.scope, { kind: "selection", start: 2, end: 6 });
  assert.equal(stored.session.current.margin.scrollTopByTab.overview, 12);
});

test("opening a new passage clones the caller passage view", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const input = aliasProbeView("JHN", 3);
  const opened = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: input,
  });

  input.selection?.pieces.splice(0, 1, { verse: 9, charStart: 90, charEnd: 99 });
  if (input.margin.scope?.kind === "selection") input.margin.scope.start = 90;
  input.margin.scrollTopByTab.overview = 90;

  const stored = opened.state.tabsById["branch"];
  assert.equal(stored?.kind, "passage");
  if (stored?.kind !== "passage") return;
  assert.equal(stored.session.current.selection?.pieces[0]?.charStart, 2);
  assert.deepEqual(stored.session.current.margin.scope, { kind: "selection", start: 2, end: 6 });
  assert.equal(stored.session.current.margin.scrollTopByTab.overview, 12);
});

test("focusing a matching passage isolates the new view and prior history snapshot", () => {
  const initial = createStudyWorkspace(aliasProbeView("ACT", 19), {
    groupId: "g1",
    passageTabId: "home",
  });
  const prior = initial.tabsById["home"];
  assert.equal(prior?.kind, "passage");
  if (prior?.kind !== "passage") return;
  const input = aliasProbeView("ACT", 19);
  if (input.selection) input.selection.pieces[0] = { verse: 1, charStart: 20, charEnd: 26 };
  const focused = openPassageWorkspaceTab(initial, {
    id: "unused",
    sourceTabId: "home",
    view: input,
  });
  assert.equal(focused.outcome, "focused");

  if (input.selection) input.selection.pieces[0] = { verse: 9, charStart: 90, charEnd: 99 };
  if (prior.session.current.selection) {
    prior.session.current.selection.pieces[0] = { verse: 8, charStart: 80, charEnd: 88 };
  }

  const stored = focused.state.tabsById["home"];
  assert.equal(stored?.kind, "passage");
  if (stored?.kind !== "passage") return;
  assert.equal(stored.session.current.selection?.pieces[0]?.charStart, 20);
  assert.equal(stored.session.history.back.at(-1)?.selection?.pieces[0]?.charStart, 2);
});

test("entity navigation clones both incoming and prior trail entries", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "entity",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: view("ACT", 19, "BSB"),
    returnPassageTabId: "home",
  }).state;
  const prior = researched.tabsById["entity"];
  assert.equal(prior?.kind, "entity");
  if (prior?.kind !== "entity") return;
  const entry = { id: "person:barnabas", displayName: "Barnabas", kind: "person" as const };
  const navigated = navigateEntityWorkspaceTab(researched, "entity", entry, 2);

  entry.displayName = "Changed caller";
  const firstPrior = prior.trail[0];
  if (firstPrior) firstPrior.displayName = "Changed prior";

  const stored = navigated.tabsById["entity"];
  assert.equal(stored?.kind, "entity");
  if (stored?.kind !== "entity") return;
  assert.equal(stored.trail[0]?.displayName, "person:paul");
  assert.equal(stored.trail.at(-1)?.displayName, "Barnabas");
});

test("tab recovery snapshots isolate the closed and reopened entity state", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const researched = openEntityWorkspaceTab(initial, {
    id: "entity",
    sourceTabId: "home",
    entityId: "person:paul",
    entityKind: "person",
    nonce: 1,
    origin: aliasProbeView("ACT", 19),
    returnPassageTabId: "home",
  }).state;
  const prior = researched.tabsById["entity"];
  assert.equal(prior?.kind, "entity");
  if (prior?.kind !== "entity") return;
  const closed = closeStudyWorkspaceTab(researched, "entity");
  assert.equal(closed.outcome, "applied");

  prior.origin.margin.scrollTopByTab.overview = 90;
  if (prior.canvas.current.selection) {
    prior.canvas.current.selection.pieces[0] = { verse: 9, charStart: 90, charEnd: 99 };
  }
  const priorTrail = prior.trail[0];
  if (priorTrail) priorTrail.displayName = "Changed prior";
  const snapshot = closed.state.recentlyClosed.at(-1);
  assert.equal(snapshot?.kind, "tab");
  if (snapshot?.kind !== "tab" || snapshot.tab.kind !== "entity") return;
  assert.equal(snapshot.tab.origin.margin.scrollTopByTab.overview, 12);
  assert.equal(snapshot.tab.canvas.current.selection?.pieces[0]?.charStart, 2);
  assert.equal(snapshot.tab.trail[0]?.displayName, "person:paul");

  const reopened = reopenClosedStudyItem(closed.state);
  assert.equal(reopened.outcome, "opened");
  snapshot.tab.origin.margin.scrollTopByTab.overview = 70;
  if (snapshot.tab.canvas.current.selection) {
    snapshot.tab.canvas.current.selection.pieces[0] = { verse: 7, charStart: 70, charEnd: 77 };
  }
  const snapshotTrail = snapshot.tab.trail[0];
  if (snapshotTrail) snapshotTrail.displayName = "Changed snapshot";

  const restored = reopened.state.tabsById["entity"];
  assert.equal(restored?.kind, "entity");
  if (restored?.kind !== "entity") return;
  assert.equal(restored.origin.margin.scrollTopByTab.overview, 12);
  assert.equal(restored.canvas.current.selection?.pieces[0]?.charStart, 2);
  assert.equal(restored.trail[0]?.displayName, "person:paul");
});

test("group recovery snapshots isolate the closed and reopened group state", () => {
  const initial = renameStudyWorkspaceGroup(
    createStudyWorkspace(aliasProbeView("ACT", 19), {
      groupId: "g1",
      passageTabId: "home",
    }),
    "g1",
    "Acts study",
  );
  const grouped = createStudyWorkspaceGroup(initial, {
    id: "g2",
    passageTabId: "other-home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const priorGroup = grouped.groups.find((group) => group.id === "g1");
  const priorTab = grouped.tabsById["home"];
  assert.ok(priorGroup);
  assert.equal(priorTab?.kind, "passage");
  if (!priorGroup || priorTab?.kind !== "passage") return;
  const closed = closeStudyWorkspaceGroup(grouped, "g1");
  assert.equal(closed.outcome, "applied");

  priorGroup.tabIds.push("changed-prior");
  if (priorGroup.label.kind === "custom") priorGroup.label.value = "Changed prior";
  priorTab.session.current.margin.scrollTopByTab.overview = 90;
  const snapshot = closed.state.recentlyClosed.at(-1);
  assert.equal(snapshot?.kind, "group");
  if (snapshot?.kind !== "group") return;
  assert.deepEqual(snapshot.group.tabIds, ["home"]);
  assert.deepEqual(snapshot.group.label, { kind: "custom", value: "Acts study" });
  const snapshotTab = snapshot.tabsById["home"];
  assert.equal(snapshotTab?.kind, "passage");
  if (snapshotTab?.kind !== "passage") return;
  assert.equal(snapshotTab.session.current.margin.scrollTopByTab.overview, 12);

  const reopened = reopenClosedStudyItem(closed.state);
  assert.equal(reopened.outcome, "opened");
  snapshot.group.tabIds.push("changed-snapshot");
  if (snapshot.group.label.kind === "custom") snapshot.group.label.value = "Changed snapshot";
  snapshotTab.session.current.margin.scrollTopByTab.overview = 70;

  const restoredGroup = reopened.state.groups.find((group) => group.id === "g1");
  const restoredTab = reopened.state.tabsById["home"];
  assert.deepEqual(restoredGroup?.tabIds, ["home"]);
  assert.deepEqual(restoredGroup?.label, { kind: "custom", value: "Acts study" });
  assert.equal(
    restoredTab?.kind === "passage"
      ? restoredTab.session.current.margin.scrollTopByTab.overview
      : undefined,
    12,
  );
});

test("reopening a reordered dependent before its passage restores order and its return link", () => {
  const initial = createStudyWorkspace(view("ACT", 19, "BSB"), {
    groupId: "g1",
    passageTabId: "home",
  });
  const branched = openPassageWorkspaceTab(initial, {
    id: "branch",
    sourceTabId: "home",
    view: view("JHN", 3, "BSB"),
  }).state;
  const researched = openEntityWorkspaceTab(branched, {
    id: "entity",
    sourceTabId: "branch",
    entityId: "person:nicodemus",
    entityKind: "person",
    nonce: 1,
    origin: view("JHN", 3, "BSB"),
    returnPassageTabId: "branch",
  }).state;
  const reordered = reorderStudyWorkspaceTab(researched, {
    tabId: "entity",
    position: "left",
  });
  assert.deepEqual(reordered.groups[0]?.tabIds, ["home", "entity", "branch"]);
  const requested = closeStudyWorkspaceTab(reordered, "branch");
  assert.equal(requested.outcome, "needs-confirmation");
  if (requested.outcome !== "needs-confirmation") return;
  const closed = resolveStudyWorkspaceDecision(
    reordered,
    requested.confirmation,
    "close-passage-and-research",
  );
  assert.equal(closed.outcome, "applied");

  const entityReopened = reopenClosedStudyItem(closed.state);
  assert.equal(entityReopened.outcome, "opened");
  assert.equal(entityReopened.state.tabsById["branch"], undefined);
  const passageReopened = reopenClosedStudyItem(entityReopened.state);
  assert.equal(passageReopened.outcome, "opened");

  assert.deepEqual(passageReopened.state.groups[0]?.tabIds, ["home", "entity", "branch"]);
  const entity = passageReopened.state.tabsById["entity"];
  assert.equal(entity?.kind === "entity" ? entity.returnPassageTabId : undefined, "branch");
  assert.equal(passageReopened.state.recentlyClosed.length, 0);
});
