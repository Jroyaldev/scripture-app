import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createStudyWorkspace,
  openEntityWorkspaceTab,
  type PassageViewState,
} from "../src/renderer/utils/studyWorkspace.js";
import {
  createWorkspacePersistenceController,
  decideStudyWorkspaceClose,
  isStudyWorkspaceSnapshotAcknowledged,
} from "../src/renderer/utils/workspacePersistence.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function state(chapter: number) {
  const current: PassageViewState = {
    book: "ACT",
    chapter,
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
  };
  return createStudyWorkspace(current, {
    groupId: `group-${chapter}`,
    passageTabId: `passage-${chapter}`,
  });
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("V2 snapshots carry entity tabs and kept canvas state without a compatibility projection", () => {
  const base = state(19);
  const passage = base.tabsById[base.activeTabId];
  assert.equal(passage?.kind, "passage");
  if (passage?.kind !== "passage") return;
  passage.session.current.margin.scope = {
    kind: "kept",
    book: "GEN",
    chapter: 1,
    verse: 1,
  };
  const opened = openEntityWorkspaceTab(base, {
    id: "entity-paul",
    sourceTabId: passage.id,
    entityId: "person:paul",
    entityKind: "person",
    nonce: 7,
    origin: passage.session.current,
    originRange: { start: 2, end: 6 },
    returnPassageTabId: passage.id,
  });
  assert.equal(opened.outcome, "opened");
  assert.equal(opened.state.activeTabId, "entity-paul");
  const entity = opened.state.tabsById[opened.state.activeTabId];
  assert.equal(entity?.kind, "entity");
  if (entity?.kind !== "entity") return;
  assert.equal(entity.entityId, "person:paul");
  assert.deepEqual(entity.canvas.current.margin.scope, {
    book: "GEN",
    chapter: 1,
    kind: "kept",
    verse: 1,
  });
  assert.equal(
    isStudyWorkspaceSnapshotAcknowledged(opened.state, structuredClone(opened.state)),
    true,
  );
});

test("renderer persistence exposes only the authoritative V2 workspace", () => {
  const source = readFileSync(
    new URL("../src/renderer/utils/workspacePersistence.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /ResearchWorkspaceState|researchWorkspace/);
  assert.doesNotMatch(source, /projectStudyWorkspaceCompatibility|StudyWorkspaceCompatibilityProjection/);
});

test("snapshot acknowledgement is canonical across key order and exact across values", () => {
  const requested = state(19);
  const sameSnapshotDifferentKeyOrder = {
    recentlyClosed: requested.recentlyClosed,
    activationOrder: requested.activationOrder,
    activeTabId: requested.activeTabId,
    tabsById: Object.fromEntries(Object.entries(requested.tabsById).map(([id, tab]) => [
      id,
      Object.fromEntries(Object.entries(tab).reverse()),
    ])),
    groups: requested.groups.map((group) => Object.fromEntries(
      Object.entries(group).reverse(),
    )),
    version: requested.version,
  };
  const staleSnapshot = state(18);

  assert.equal(isStudyWorkspaceSnapshotAcknowledged(requested, sameSnapshotDifferentKeyOrder), true);
  assert.equal(isStudyWorkspaceSnapshotAcknowledged(requested, staleSnapshot), false);
  assert.equal(isStudyWorkspaceSnapshotAcknowledged(requested, null), false);
});

test("close decision approves explicit refusal but vetoes unresolved bootstrap", () => {
  const workspace = state(19);

  assert.deepEqual(decideStudyWorkspaceClose(undefined, "newer-version"), { kind: "approve" });
  assert.deepEqual(decideStudyWorkspaceClose(undefined, null), { kind: "veto" });
  assert.deepEqual(decideStudyWorkspaceClose(null, null), { kind: "approve" });
  assert.deepEqual(decideStudyWorkspaceClose(workspace, null), { kind: "flush", workspace });
});

test("structural publications get monotonic revisions and writes never overlap", async () => {
  const completions: Array<Deferred<unknown>> = [];
  const chapters: number[] = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const controller = createWorkspacePersistenceController({
    debounceMs: 20,
    write(snapshot) {
      const completion = deferred<unknown>();
      completions.push(completion);
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      return completion.promise.finally(() => {
        activeWrites -= 1;
      });
    },
  });

  const first = controller.persistStructure(state(1));
  assert.deepEqual(controller.status(), {
    phase: "saving",
    acknowledgedRevision: 0,
    pendingRevision: 1,
  });
  const second = controller.persistStructure(state(2));
  assert.deepEqual(controller.status(), {
    phase: "saving",
    acknowledgedRevision: 0,
    pendingRevision: 2,
  });
  assert.deepEqual(chapters, [1]);

  completions[0]!.resolve(undefined);
  await settle();
  assert.deepEqual(chapters, [1, 2]);
  assert.deepEqual(controller.status(), {
    phase: "saving",
    acknowledgedRevision: 1,
    pendingRevision: 2,
  });
  completions[1]!.resolve(undefined);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(maximumActiveWrites, 1);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 2,
    pendingRevision: null,
  });
  controller.dispose();
});

test("every structural publication is written FIFO and acknowledged only by its own revision", async () => {
  const completions: Array<Deferred<unknown>> = [];
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 20,
    write(snapshot) {
      const completion = deferred<unknown>();
      completions.push(completion);
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      return completion.promise;
    },
  });

  let firstSettled = false;
  let secondSettled = false;
  let thirdSettled = false;
  const first = controller.persistStructure(state(1)).then((result) => {
    firstSettled = true;
    return result;
  });
  const second = controller.persistStructure(state(2)).then((result) => {
    secondSettled = true;
    return result;
  });
  const third = controller.persistStructure(state(3)).then((result) => {
    thirdSettled = true;
    return result;
  });
  assert.deepEqual(chapters, [1]);

  completions[0]!.resolve(undefined);
  await settle();
  assert.deepEqual(chapters, [1, 2]);
  assert.equal(firstSettled, true);
  assert.equal(secondSettled, false);
  assert.equal(thirdSettled, false);
  assert.equal(await first, true);

  completions[1]!.resolve(undefined);
  await settle();
  assert.deepEqual(chapters, [1, 2, 3]);
  assert.equal(secondSettled, true);
  assert.equal(thirdSettled, false);
  assert.equal(await second, true);

  completions[2]!.resolve(undefined);
  assert.equal(await third, true);
  assert.equal(thirdSettled, true);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 3,
    pendingRevision: null,
  });
  controller.dispose();
});

test("a fired view debounce cannot replace a queued structural publication", async () => {
  const completions: Array<Deferred<unknown>> = [];
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 5,
    write(snapshot) {
      const completion = deferred<unknown>();
      completions.push(completion);
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      return completion.promise;
    },
  });

  const first = controller.persistStructure(state(1));
  const second = controller.persistStructure(state(2));
  controller.publishView(state(3));
  await new Promise<void>((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(chapters, [1]);

  completions[0]!.resolve(undefined);
  assert.equal(await first, true);
  await settle();
  assert.deepEqual(chapters, [1, 2]);
  completions[1]!.resolve(undefined);
  assert.equal(await second, true);
  await settle();
  assert.deepEqual(chapters, [1, 2, 3]);
  completions[2]!.resolve(undefined);
  await settle();
  assert.equal(controller.status().acknowledgedRevision, 3);
  controller.dispose();
});

test("view publications debounce to the newest snapshot and structure cancels an older view", async () => {
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 10,
    async write(snapshot) {
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
    },
  });

  controller.publishView(state(1));
  controller.publishView(state(2));
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 0,
    pendingRevision: 2,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(chapters, [2]);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 2,
    pendingRevision: null,
  });

  controller.publishView(state(3));
  const persisted = controller.persistStructure(state(4));
  assert.equal(await persisted, true);
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(chapters, [2, 4]);
  assert.equal(controller.status().acknowledgedRevision, 4);
  controller.dispose();
});

test("failure retains only the newest retryable snapshot without mutating caller state", async () => {
  const completions: Array<Deferred<unknown>> = [];
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 5,
    write(snapshot) {
      const completion = deferred<unknown>();
      completions.push(completion);
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      if (tab?.kind === "passage") tab.session.current.chapter = 999;
      return completion.promise;
    },
  });
  const firstState = state(1);
  const first = controller.persistStructure(firstState);
  const latestState = state(2);
  controller.publishView(latestState);
  completions[0]!.reject(new Error("disk unavailable"));
  assert.equal(await first, false);
  assert.deepEqual(controller.status(), {
    phase: "failed",
    acknowledgedRevision: 0,
    pendingRevision: 2,
    error: "disk unavailable",
  });
  assert.equal(firstState.tabsById["passage-1"]?.kind === "passage"
    ? firstState.tabsById["passage-1"].session.current.chapter
    : null, 1);
  assert.equal(latestState.tabsById["passage-2"]?.kind === "passage"
    ? latestState.tabsById["passage-2"].session.current.chapter
    : null, 2);

  const retried = controller.retry();
  assert.deepEqual(chapters, [1, 2]);
  completions[1]!.resolve(undefined);
  assert.equal(await retried, true);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 2,
    pendingRevision: null,
  });
  controller.dispose();
});

test("flush waits through an older write and succeeds only after its newest revision is acknowledged", async () => {
  const completions: Array<Deferred<unknown>> = [];
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 20,
    write(snapshot) {
      const completion = deferred<unknown>();
      completions.push(completion);
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      return completion.promise;
    },
  });

  const first = controller.persistStructure(state(1));
  controller.publishView(state(2));
  let flushSettled = false;
  const flushed = controller.flush(state(3)).then((value) => {
    flushSettled = true;
    return value;
  });
  assert.deepEqual(chapters, [1]);
  assert.equal(controller.status().pendingRevision, 3);

  completions[0]!.resolve(undefined);
  assert.equal(await first, true);
  await settle();
  assert.equal(flushSettled, false);
  assert.deepEqual(chapters, [1, 3]);
  assert.deepEqual(controller.status(), {
    phase: "saving",
    acknowledgedRevision: 1,
    pendingRevision: 3,
  });

  completions[1]!.resolve(undefined);
  assert.equal(await flushed, true);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 3,
    pendingRevision: null,
  });
  controller.dispose();
});

test("a stale V2 acknowledgement makes close flush fail and remains retryable", async () => {
  let attempts = 0;
  const controller = createWorkspacePersistenceController({
    debounceMs: 0,
    async write(snapshot) {
      attempts += 1;
      const persisted = attempts === 1 ? state(18) : structuredClone(snapshot);
      if (!isStudyWorkspaceSnapshotAcknowledged(snapshot, persisted)) {
        throw new Error("Workspace write not acknowledged");
      }
    },
  });

  assert.equal(await controller.flush(state(19)), false);
  assert.deepEqual(controller.status(), {
    phase: "failed",
    acknowledgedRevision: 0,
    pendingRevision: 1,
    error: "Workspace write not acknowledged",
  });
  assert.equal(await controller.retry(), true);
  assert.equal(attempts, 2);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 1,
    pendingRevision: null,
  });
  controller.dispose();
});

test("dispose cancels timers and all later publications without unhandled rejections", async () => {
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 5,
    async write(snapshot) {
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      throw new Error("a disposed timer must never reach this write");
    },
  });
  controller.publishView(state(1));
  controller.dispose();
  controller.publishView(state(2));
  assert.equal(await controller.persistStructure(state(3)), false);
  assert.equal(await controller.flush(state(4)), false);
  assert.equal(await controller.retry(), false);
  await new Promise<void>((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(chapters, []);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 0,
    pendingRevision: null,
  });
});

test("dispose detaches an in-flight write and ignores its eventual rejection", async () => {
  const completion = deferred<unknown>();
  const chapters: number[] = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 5,
    write(snapshot) {
      const tab = snapshot.tabsById[snapshot.activeTabId];
      chapters.push(tab?.kind === "passage" ? tab.session.current.chapter : -1);
      return completion.promise;
    },
  });
  const persisted = controller.persistStructure(state(1));
  controller.persistStructure(state(2)).catch(() => undefined);
  controller.publishView(state(3));

  controller.dispose();
  assert.equal(await persisted, false);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 0,
    pendingRevision: null,
  });
  completion.reject(new Error("late disposed rejection"));
  await settle();
  assert.deepEqual(chapters, [1]);
  assert.deepEqual(controller.status(), {
    phase: "idle",
    acknowledgedRevision: 0,
    pendingRevision: null,
  });
});

test("a synchronous write failure resolves false and remains retryable", async () => {
  let attempts = 0;
  const controller = createWorkspacePersistenceController({
    debounceMs: 0,
    write() {
      attempts += 1;
      if (attempts === 1) throw new Error("synchronous boundary failure");
      return Promise.resolve();
    },
  });
  assert.equal(await controller.persistStructure(state(5)), false);
  assert.deepEqual(controller.status(), {
    phase: "failed",
    acknowledgedRevision: 0,
    pendingRevision: 1,
    error: "synchronous boundary failure",
  });
  assert.equal(await controller.retry(), true);
  assert.equal(attempts, 2);
  controller.dispose();
});

test("persistence status subscriptions report saving, failure, retry, and idle settlement", async () => {
  const attempts: Array<ReturnType<typeof deferred<void>>> = [];
  const controller = createWorkspacePersistenceController({
    debounceMs: 0,
    write: async () => {
      const attempt = deferred<void>();
      attempts.push(attempt);
      return attempt.promise;
    },
  });
  const phases: string[] = [];
  const unsubscribe = controller.subscribe((status) => {
    phases.push(status.phase);
  });

  const first = controller.persistStructure(state(1));
  assert.deepEqual(phases, ["idle", "saving"]);
  attempts[0]?.reject(new Error("disk unavailable"));
  assert.equal(await first, false);
  assert.equal(phases.at(-1), "failed");

  const retry = controller.retry();
  assert.equal(phases.at(-1), "saving");
  attempts[1]?.resolve();
  assert.equal(await retry, true);
  assert.equal(phases.at(-1), "idle");

  unsubscribe();
  const afterUnsubscribe = phases.length;
  const second = controller.persistStructure(state(2));
  attempts[2]?.resolve();
  assert.equal(await second, true);
  assert.equal(phases.length, afterUnsubscribe);
  controller.dispose();
});
