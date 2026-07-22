import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeStudyWorkspaceSetting,
  migrateLegacyStudyWorkspace,
  normalizeStudyWorkspace,
} from "../src/electron/study-workspace-settings.js";

function view(book = "ACT", chapter = 19, packageId = "bsb") {
  return {
    book,
    chapter,
    packageId,
    verse: 2,
    verseOffset: 12,
    scrollTop: 240,
    margin: {
      activeTab: "connections",
      scope: null,
      scrollTopByTab: { overview: 10 },
      wordsVerse: 2,
      wordsFollowingReading: true,
    },
  };
}

function passageTab(id = "home", groupId = "group-1") {
  return {
    kind: "passage",
    id,
    groupId,
    session: { current: view(), history: { back: [], forward: [] } },
  };
}

function entityTab(id = "paul", groupId = "group-1") {
  return {
    kind: "entity",
    id,
    groupId,
    entityId: "person:paul",
    entityKind: "person",
    origin: view(),
    originRange: { start: 2, end: 6 },
    canvas: { current: view("ROM", 8), history: { back: [], forward: [] } },
    returnPassageTabId: "home",
    trail: [{ id: "person:paul", displayName: "Paul", kind: "person" }],
    scrollTop: 33,
    nonce: 7,
  };
}

function workspace() {
  return {
    version: 2,
    groups: [{
      id: "group-1",
      homePassageTabId: "home",
      tabIds: ["home"],
      lastActiveTabId: "home",
      collapsed: false,
      label: { kind: "custom", value: "Acts study" },
    }],
    tabsById: { home: passageTab() },
    activeTabId: "home",
    activationOrder: ["home"],
    recentlyClosed: [],
  };
}

test("explicit null is a valid empty study workspace setting", () => {
  assert.deepEqual(normalizeStudyWorkspace(null), { ok: true, value: null });
});

test("a workspace from a newer format version is refused distinctly", () => {
  assert.deepEqual(normalizeStudyWorkspace({ version: 3, payload: { untouched: true } }), {
    ok: false,
    reason: "newer-version",
  });
});

test("a minimal V2 workspace is reconstructed without unknown fields", () => {
  const input = workspace();
  const home = input.tabsById.home as typeof input.tabsById.home & { noteBody?: string };
  home.noteBody = "must not cross the settings boundary";
  const result = normalizeStudyWorkspace({ ...input, query: "private search" });
  assert.deepEqual(result, { ok: true, value: workspace() });
  assert.doesNotMatch(JSON.stringify(result), /noteBody|private search|query/);
});

test("group membership is canonical and entity research state is preserved", () => {
  const input = workspace();
  input.groups[0] = {
    ...input.groups[0]!,
    homePassageTabId: "paul",
    lastActiveTabId: "missing",
    tabIds: ["home", "paul", "paul"],
  };
  const paul = {
    ...entityTab("wrong-record-id", "wrong-group"),
    noteTitle: "private",
    origin: { ...view(), quote: "private" },
    trail: [{
      id: "person:paul",
      displayName: "Paul",
      kind: "person",
      query: "private",
    }],
  };
  const result = normalizeStudyWorkspace({
    ...input,
    groups: [
      input.groups[0],
      { ...input.groups[0], tabIds: ["unreferenced"] },
    ],
    tabsById: {
      home: { ...passageTab("wrong-home", "wrong-group"), noteBody: "private" },
      paul,
      unreferenced: passageTab("unreferenced", "group-1"),
      orphan: passageTab("orphan", "group-1"),
    },
    activeTabId: "missing",
    activationOrder: ["missing", "paul", "paul"],
  });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.deepEqual(result.value.groups, [{
    id: "group-1",
    homePassageTabId: "home",
    tabIds: ["home", "paul"],
    lastActiveTabId: "home",
    collapsed: false,
    label: { kind: "custom", value: "Acts study" },
  }]);
  assert.deepEqual(Object.keys(result.value.tabsById), ["home", "paul"]);
  assert.equal(result.value.tabsById.home?.id, "home");
  assert.equal(result.value.tabsById.home?.groupId, "group-1");
  assert.deepEqual(result.value.tabsById.paul, entityTab());
  assert.equal(result.value.activeTabId, "paul");
  assert.deepEqual(result.value.activationOrder, ["paul"]);
  assert.doesNotMatch(JSON.stringify(result.value), /noteBody|noteTitle|quote|query|private/);
});

test("workspace, navigation, trail, and recently-closed collections are bounded", () => {
  const grouped = workspace();
  grouped.groups = Array.from({ length: 17 }, (_, index) => {
    const suffix = index + 1;
    return {
      ...grouped.groups[0]!,
      id: `group-${suffix}`,
      homePassageTabId: `passage-${suffix}`,
      lastActiveTabId: `passage-${suffix}`,
      tabIds: [`passage-${suffix}`],
    };
  });
  grouped.tabsById = Object.fromEntries(grouped.groups.map((group) => [
    group.homePassageTabId,
    passageTab(group.homePassageTabId, group.id),
  ]));
  grouped.activeTabId = "passage-17";
  grouped.activationOrder = grouped.groups.map((group) => group.homePassageTabId);
  const groupedResult = normalizeStudyWorkspace(grouped);
  assert.equal(groupedResult.ok && groupedResult.value?.groups.length, 16);

  const crowded = workspace();
  crowded.groups[0]!.tabIds = Array.from({ length: 70 }, (_, index) => `tab-${index + 1}`);
  crowded.groups[0]!.homePassageTabId = "tab-1";
  crowded.groups[0]!.lastActiveTabId = "tab-70";
  crowded.tabsById = Object.fromEntries(crowded.groups[0]!.tabIds.map((id) => [
    id,
    passageTab(id),
  ]));
  crowded.activeTabId = "tab-70";
  crowded.activationOrder = [...crowded.groups[0]!.tabIds];
  const crowdedResult = normalizeStudyWorkspace(crowded);
  assert.equal(crowdedResult.ok && Object.keys(crowdedResult.value?.tabsById ?? {}).length, 64);
  assert.equal(crowdedResult.ok && crowdedResult.value?.activeTabId, "tab-64");

  const bounded = workspace();
  const entity = entityTab();
  entity.trail = Array.from({ length: 15 }, (_, index) => ({
    id: `entity-${index + 1}`,
    displayName: `Entity ${index + 1}`,
    kind: "other" as const,
  }));
  entity.canvas.history.back = Array.from({ length: 30 }, (_, index) => view("ACT", index + 1));
  entity.canvas.history.forward = Array.from({ length: 30 }, (_, index) => view("JHN", index + 1));
  bounded.groups[0]!.tabIds.push("paul");
  bounded.tabsById.paul = entity as typeof bounded.tabsById.home;
  bounded.recentlyClosed = Array.from({ length: 12 }, (_, index) => ({
    kind: "tab" as const,
    tab: passageTab(`closed-${index}`, "closed-group"),
    index,
  })) as unknown as typeof bounded.recentlyClosed;
  const boundedResult = normalizeStudyWorkspace(bounded);
  assert.equal(boundedResult.ok, true);
  if (!boundedResult.ok || !boundedResult.value) return;
  const normalizedEntity = boundedResult.value.tabsById.paul;
  assert.equal(normalizedEntity?.kind, "entity");
  if (normalizedEntity?.kind !== "entity") return;
  assert.deepEqual(normalizedEntity.trail.map((entry) => entry.id), [
    "entity-4", "entity-5", "entity-6", "entity-7", "entity-8", "entity-9",
    "entity-10", "entity-11", "entity-12", "entity-13", "entity-14", "entity-15",
  ]);
  assert.deepEqual(normalizedEntity.canvas.history.back.map((entry) => entry.chapter),
    Array.from({ length: 30 }, (_, index) => index + 1));
  assert.deepEqual(normalizedEntity.canvas.history.forward.map((entry) => entry.chapter),
    Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(boundedResult.value.recentlyClosed.map((item) => item.index),
    Array.from({ length: 10 }, (_, index) => index + 2));
});

test("recently closed groups are reconstructed as bounded canonical snapshots", () => {
  const input = workspace();
  input.recentlyClosed = [{
    kind: "group",
    index: 3,
    query: "private",
    group: {
      id: "closed-group",
      homePassageTabId: "closed-home",
      tabIds: ["closed-home", "closed-entity", "closed-entity"],
      lastActiveTabId: "closed-entity",
      collapsed: true,
      label: { kind: "custom", value: "Closed study", noteTitle: "private" },
    },
    tabsById: {
      "closed-home": passageTab("wrong-id", "wrong-group"),
      "closed-entity": {
        ...entityTab("wrong-id", "wrong-group"),
        returnPassageTabId: "closed-home",
      },
      orphan: passageTab("orphan", "closed-group"),
    },
  }] as unknown as typeof input.recentlyClosed;
  const result = normalizeStudyWorkspace(input);
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.deepEqual(result.value.recentlyClosed, [{
    kind: "group",
    index: 3,
    group: {
      id: "closed-group",
      homePassageTabId: "closed-home",
      tabIds: ["closed-home", "closed-entity"],
      lastActiveTabId: "closed-entity",
      collapsed: true,
      label: { kind: "custom", value: "Closed study" },
    },
    tabsById: {
      "closed-home": passageTab("closed-home", "closed-group"),
      "closed-entity": {
        ...entityTab("closed-entity", "closed-group"),
        returnPassageTabId: "closed-home",
      },
    },
  }]);
  assert.doesNotMatch(JSON.stringify(result.value.recentlyClosed), /query|noteTitle|private|orphan/);
});

test("malformed required V2 fields and ranges are rejected instead of guessed", () => {
  const badVersion = { ...workspace(), version: 1 };
  const badView = structuredClone(workspace());
  badView.tabsById.home.session.current.chapter = 0;
  const badMargin = structuredClone(workspace());
  badMargin.tabsById.home.session.current.margin.activeTab = "unknown";
  const badEntity = structuredClone(workspace());
  badEntity.groups[0]!.tabIds.push("paul");
  badEntity.tabsById.paul = { ...entityTab(), nonce: -1 } as typeof badEntity.tabsById.home;
  const noPassage = structuredClone(workspace());
  noPassage.groups[0]!.tabIds = ["paul"];
  noPassage.groups[0]!.homePassageTabId = "paul";
  noPassage.groups[0]!.lastActiveTabId = "paul";
  noPassage.tabsById = { paul: entityTab() as typeof noPassage.tabsById.home };
  noPassage.activeTabId = "paul";
  noPassage.activationOrder = ["paul"];

  for (const candidate of [badVersion, badView, badMargin, badEntity, noPassage]) {
    assert.deepEqual(normalizeStudyWorkspace(candidate), { ok: false, reason: "invalid" });
  }
});

test("signed finite eye-line offsets survive while non-finite offsets are rejected", () => {
  const aboveViewport = workspace();
  aboveViewport.tabsById.home.session.current.verseOffset = -18.5;
  const normalized = normalizeStudyWorkspace(aboveViewport);
  assert.equal(normalized.ok && normalized.value?.tabsById.home?.kind === "passage"
    ? normalized.value.tabsById.home.session.current.verseOffset
    : null, -18.5);

  const nonFinite = workspace();
  nonFinite.tabsById.home.session.current.verseOffset = Number.POSITIVE_INFINITY;
  assert.deepEqual(normalizeStudyWorkspace(nonFinite), { ok: false, reason: "invalid" });
});

test("settings merge distinguishes omission, explicit null, invalid input, and replacement", () => {
  const current = workspace();
  const invalid = { version: 2, groups: "not-an-array" };
  const incoming = { ...workspace(), query: "drop me" };
  assert.equal(mergeStudyWorkspaceSetting(current, undefined, false), current);
  assert.equal(mergeStudyWorkspaceSetting(current, invalid, true), current);
  assert.equal(mergeStudyWorkspaceSetting(current, { version: 3 }, true), current);
  assert.equal(mergeStudyWorkspaceSetting(current, null, true), null);
  assert.deepEqual(mergeStudyWorkspaceSetting(current, incoming, true), workspace());
});

test("legacy migration creates one deterministic last-read home and scopes kept context to it", () => {
  const input = {
    researchWorkspace: null,
    researchSession: null,
    lastRead: {
      book: "JHN",
      chapter: 3,
      packageId: "nrsv",
      verse: 16,
      verseOffset: 24,
    },
    keptContext: {
      book: "GEN",
      chapter: 1,
      verse: 1,
      endVerse: 2,
      label: "Creation",
    },
  };
  const first = migrateLegacyStudyWorkspace(input);
  const second = migrateLegacyStudyWorkspace(input);
  assert.deepEqual(first, second);
  assert.equal(first?.activeTabId, "study-passage-1");
  assert.deepEqual(first?.groups, [{
    id: "study-group-1",
    homePassageTabId: "study-passage-1",
    tabIds: ["study-passage-1"],
    lastActiveTabId: "study-passage-1",
    collapsed: false,
    label: { kind: "automatic" },
  }]);
  assert.deepEqual(first?.tabsById["study-passage-1"], {
    kind: "passage",
    id: "study-passage-1",
    groupId: "study-group-1",
    session: {
      current: {
        book: "JHN",
        chapter: 3,
        packageId: "nrsv",
        verse: 16,
        verseOffset: 24,
        scrollTop: 0,
        margin: {
          activeTab: "overview",
          scope: {
            kind: "kept",
            book: "GEN",
            chapter: 1,
            verse: 1,
            endVerse: 2,
            label: "Creation",
          },
          scrollTopByTab: {},
          wordsFollowingReading: true,
        },
      },
      history: { back: [], forward: [] },
    },
  });

  const fallback = migrateLegacyStudyWorkspace({
    researchWorkspace: null,
    researchSession: null,
    lastRead: null,
    keptContext: null,
  });
  assert.deepEqual(fallback?.tabsById["study-passage-1"]?.kind === "passage"
    ? fallback.tabsById["study-passage-1"].session.current
    : null, {
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
    verse: 1,
    verseOffset: 0,
    scrollTop: 0,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: {},
      wordsFollowingReading: true,
    },
  });
});

test("unversioned workspace migration keeps tab identity, grouping, kinds, trails, and active order", () => {
  const longTrail = Array.from({ length: 15 }, (_, index) => ({
    id: `paul-${index + 1}`,
    displayName: `Paul ${index + 1}`,
    kind: index === 14 ? "person" : "other",
  }));
  const origin = {
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
    chapterEndVerse: 41,
    verseStart: 2,
    verseEnd: 6,
  };
  const migrated = migrateLegacyStudyWorkspace({
    lastRead: { book: "JHN", chapter: 3, packageId: "nrsv", verse: 16, verseOffset: 4 },
    keptContext: { book: "GEN", chapter: 1, verse: 1 },
    researchSession: {
      origin: { book: "MRK", chapter: 1, packageId: "bsb" },
      trail: [{ id: "ignored", displayName: "Ignored", kind: "other" }],
    },
    researchWorkspace: {
      tabs: [
        { id: "legacy-paul", entityId: "person:paul", origin, trail: longTrail, nonce: 91 },
        {
          id: "legacy-john",
          entityId: "person:nicodemus",
          origin: { book: "JHN", chapter: 3, packageId: "nrsv", verseStart: 16, verseEnd: 16 },
          trail: [{ id: "person:nicodemus", displayName: "Nicodemus", kind: "person" }],
          nonce: 7,
        },
        {
          id: "legacy-athens",
          entityId: "place:athens",
          origin,
          trail: [{ id: "place:athens", displayName: "Athens", kind: "place" }],
          nonce: 8,
        },
        { id: "legacy-paul", entityId: "duplicate", origin, trail: [], nonce: 0 },
      ],
      activeTabId: "legacy-paul",
      lastResearchTabId: "legacy-athens",
      activationOrder: [
        "scripture",
        "legacy-athens",
        "legacy-paul",
        "legacy-john",
        "legacy-paul",
        "missing",
      ],
    },
  });
  assert.ok(migrated);
  assert.deepEqual(migrated.groups.map((group) => group.tabIds), [
    ["study-passage-1", "legacy-john"],
    ["study-passage-2", "legacy-paul", "legacy-athens"],
  ]);
  assert.equal(migrated.groups[0]?.lastActiveTabId, "legacy-john");
  assert.equal(migrated.groups[1]?.lastActiveTabId, "legacy-paul");
  assert.equal(migrated.activeTabId, "legacy-paul");
  assert.deepEqual(migrated.activationOrder, [
    "study-passage-1",
    "legacy-athens",
    "legacy-john",
    "legacy-paul",
  ]);
  assert.deepEqual(Object.keys(migrated.tabsById), [
    "study-passage-1",
    "study-passage-2",
    "legacy-paul",
    "legacy-john",
    "legacy-athens",
  ]);
  const paul = migrated.tabsById["legacy-paul"];
  assert.equal(paul?.kind, "entity");
  if (paul?.kind !== "entity") return;
  assert.equal(paul.entityKind, "person");
  assert.equal(paul.nonce, 91);
  assert.deepEqual(paul.originRange, { start: 2, end: 6 });
  assert.equal(paul.returnPassageTabId, "study-passage-2");
  assert.deepEqual(paul.trail.map((entry) => entry.id),
    Array.from({ length: 12 }, (_, index) => `paul-${index + 4}`));
  assert.equal(paul.origin.margin.scope, null);
  const home = migrated.tabsById["study-passage-1"];
  assert.equal(home?.kind, "passage");
  if (home?.kind !== "passage") return;
  assert.deepEqual(home.session.current.margin.scope, {
    kind: "kept",
    book: "GEN",
    chapter: 1,
    verse: 1,
  });
});

test("legacy single-session origin precedes the default passage even with no active entity", () => {
  const migrated = migrateLegacyStudyWorkspace({
    researchWorkspace: { tabs: "invalid" },
    researchSession: {
      origin: { book: "PSA", chapter: 23, packageId: "bsb", verseStart: 1, verseEnd: 4 },
      trail: [],
    },
    lastRead: null,
    keptContext: null,
  });
  const home = migrated?.tabsById[migrated.groups[0]!.homePassageTabId];
  assert.equal(home?.kind, "passage");
  if (home?.kind !== "passage") return;
  assert.deepEqual(home.session.current, {
    book: "PSA",
    chapter: 23,
    packageId: "bsb",
    verse: 1,
    verseOffset: 0,
    scrollTop: 0,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: {},
      wordsFollowingReading: true,
    },
  });
  assert.deepEqual(migrated?.groups[0]?.tabIds, ["study-passage-1"]);
});
