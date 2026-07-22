import assert from "node:assert/strict";
import { test } from "node:test";
import { createStudyWorkspace, type PassageViewState } from "../src/renderer/utils/studyWorkspace.js";
import { createWorkspacePersistenceController } from "../src/renderer/utils/workspacePersistence.js";

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
