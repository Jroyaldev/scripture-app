import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkspaceTransitionCoordinator,
  type WorkspaceExitController,
} from "../src/renderer/utils/workspaceTransition.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function owner(
  name: string,
  calls: string[],
  result: boolean | Promise<boolean> = true,
): WorkspaceExitController {
  return {
    async requestExit(reason) {
      calls.push(`${name}:${reason}`);
      return result;
    },
  };
}

test("a clean transition asks owners sequentially before committing", async () => {
  const calls: string[] = [];
  const noteDecision = deferred<boolean>();
  const coordinator = createWorkspaceTransitionCoordinator(() => [
    {
      async requestExit(reason) {
        calls.push(`note:start:${reason}`);
        const approved = await noteDecision.promise;
        calls.push(`note:end:${reason}`);
        return approved;
      },
    },
    owner("marking", calls),
  ]);

  const transition = coordinator.run("tab-change", () => {
    calls.push("commit");
  });

  assert.deepEqual(calls, ["note:start:tab-change"]);
  noteDecision.resolve(true);

  assert.equal(await transition, true);
  assert.deepEqual(calls, [
    "note:start:tab-change",
    "note:end:tab-change",
    "marking:tab-change",
    "commit",
  ]);
});

test("a veto prevents later owners and leaves the commit untouched", async () => {
  const calls: string[] = [];
  const coordinator = createWorkspaceTransitionCoordinator(() => [
    owner("note", calls, false),
    owner("marking", calls),
  ]);
  let committed = false;

  const result = await coordinator.run("tab-close", () => {
    committed = true;
  });

  assert.equal(result, false);
  assert.deepEqual(calls, ["note:tab-close"]);
  assert.equal(committed, false);
});

test("an owner throw or rejection fails closed", async () => {
  const failures: Array<() => Promise<boolean>> = [
    () => {
      throw new Error("synchronous owner failure");
    },
    () => Promise.reject(new Error("asynchronous owner failure")),
  ];

  for (const requestExit of failures) {
    const calls: string[] = [];
    const coordinator = createWorkspaceTransitionCoordinator(() => [
      { requestExit },
      owner("later", calls),
    ]);
    let commits = 0;

    const result = await coordinator.run("group-change", () => {
      commits += 1;
    });

    assert.equal(result, false);
    assert.deepEqual(calls, []);
    assert.equal(commits, 0);
  }
});

test("the commit runs once after approval and a thrown commit fails closed", async () => {
  let commits = 0;
  const coordinator = createWorkspaceTransitionCoordinator(() => []);

  assert.equal(await coordinator.run("chapter-change", () => {
    commits += 1;
  }), true);
  assert.equal(commits, 1);

  assert.equal(await coordinator.run("translation-change", () => {
    commits += 1;
    throw new Error("commit failure");
  }), false);
  assert.equal(commits, 2);
});

test("owners are snapshotted exactly once for a transition", async () => {
  const calls: string[] = [];
  const registeredOwners: WorkspaceExitController[] = [];
  registeredOwners.push({
    async requestExit(reason) {
      calls.push(`note:${reason}`);
      registeredOwners.push(owner("late", calls));
      return true;
    },
  });
  registeredOwners.push(owner("marking", calls));
  let snapshots = 0;
  const coordinator = createWorkspaceTransitionCoordinator(() => {
    snapshots += 1;
    return registeredOwners;
  });

  const result = await coordinator.run("view-change", () => {
    calls.push("commit");
  });

  assert.equal(result, true);
  assert.equal(snapshots, 1);
  assert.deepEqual(calls, ["note:view-change", "marking:view-change", "commit"]);
});

test("a concurrent second run fails without touching owners or its commit", async () => {
  const decision = deferred<boolean>();
  let ownerSnapshots = 0;
  let ownerRequests = 0;
  let firstCommits = 0;
  let secondCommits = 0;
  const coordinator = createWorkspaceTransitionCoordinator(() => {
    ownerSnapshots += 1;
    return [{
      async requestExit() {
        ownerRequests += 1;
        return decision.promise;
      },
    }];
  });

  const first = coordinator.run("library-change", () => {
    firstCommits += 1;
  });
  const second = await coordinator.run("window-close", () => {
    secondCommits += 1;
  });

  assert.equal(second, false);
  assert.equal(ownerSnapshots, 1);
  assert.equal(ownerRequests, 1);
  assert.equal(secondCommits, 0);

  decision.resolve(true);
  assert.equal(await first, true);
  assert.equal(firstCommits, 1);
});
