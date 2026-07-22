import assert from "node:assert/strict";
import { test } from "node:test";
import { createNavigationHistory, pushNavigationHistory } from "../src/renderer/utils/navigationHistory.js";
import {
  appendEntityResearchTrail,
  activeStudyWorkspaceSession,
  activeStudyWorkspaceTab,
  createStudyWorkspace,
  openPassageWorkspaceTab,
  orderedStudyWorkspaceGroups,
  orderedStudyWorkspaceTabs,
  selectStudyWorkspaceTab,
  studyWorkspaceGroupLabel,
  studyWorkspaceTabLabel,
  studyWorkspaceTabType,
  studyWorkspaceTranslationCollisionTabIds,
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
