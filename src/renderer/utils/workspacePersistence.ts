import type { StudyWorkspaceStateV2 } from "./studyWorkspace.js";

export interface WorkspacePersistenceStatus {
  phase: "idle" | "saving" | "failed";
  acknowledgedRevision: number;
  pendingRevision: number | null;
  error?: string;
}

export interface WorkspacePersistenceController {
  publishView(state: StudyWorkspaceStateV2): void;
  persistStructure(state: StudyWorkspaceStateV2): Promise<boolean>;
  flush(state: StudyWorkspaceStateV2): Promise<boolean>;
  retry(): Promise<boolean>;
  status(): WorkspacePersistenceStatus;
  dispose(): void;
}

interface WorkspaceSnapshot {
  revision: number;
  state: StudyWorkspaceStateV2;
}

interface RevisionWaiter {
  revision: number;
  resolve(value: boolean): void;
}

export function createWorkspacePersistenceController(options: {
  write(state: StudyWorkspaceStateV2): Promise<unknown>;
  debounceMs: number;
}): WorkspacePersistenceController {
  let revision = 0;
  let acknowledgedRevision = 0;
  let inFlight: WorkspaceSnapshot | null = null;
  let queued: WorkspaceSnapshot | null = null;
  let failed: WorkspaceSnapshot | null = null;
  let phase: WorkspacePersistenceStatus["phase"] = "idle";
  let error: string | undefined;
  let disposed = false;
  let debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let debounced: WorkspaceSnapshot | null = null;
  const waiters: RevisionWaiter[] = [];

  const clone = (state: StudyWorkspaceStateV2): StudyWorkspaceStateV2 => structuredClone(state);

  const newestPendingRevision = (): number | null => {
    return Math.max(
      inFlight?.revision ?? 0,
      queued?.revision ?? 0,
      failed?.revision ?? 0,
      debounced?.revision ?? 0,
    ) || null;
  };

  const settleAcknowledgedWaiters = (): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (waiter.revision > acknowledgedRevision) continue;
      waiters.splice(index, 1);
      waiter.resolve(true);
    }
  };

  const settleFailedWaiters = (throughRevision: number): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (waiter.revision > throughRevision) continue;
      waiters.splice(index, 1);
      waiter.resolve(false);
    }
  };

  const waitForRevision = (targetRevision: number): Promise<boolean> => {
    if (acknowledgedRevision >= targetRevision) return Promise.resolve(true);
    if (failed && failed.revision >= targetRevision) return Promise.resolve(false);
    if (disposed) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      waiters.push({ revision: targetRevision, resolve });
    });
  };

  const runNext = (): void => {
    if (disposed || inFlight || !queued || failed) return;
    const snapshot = queued;
    queued = null;
    inFlight = snapshot;
    phase = "saving";
    error = undefined;
    const handleFailure = (reason: unknown): void => {
      if (inFlight?.revision === snapshot.revision) inFlight = null;
      if (disposed) return;
      let retryable = snapshot;
      if (queued && queued.revision > retryable.revision) retryable = queued;
      if (debounced && debounced.revision > retryable.revision) retryable = debounced;
      if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
      debounced = null;
      queued = null;
      failed = retryable;
      phase = "failed";
      error = reason instanceof Error ? reason.message : String(reason);
      settleFailedWaiters(retryable.revision);
    };
    let pending: Promise<unknown>;
    try {
      pending = options.write(clone(snapshot.state));
    } catch (reason) {
      handleFailure(reason);
      return;
    }
    void Promise.resolve(pending)
      .then(() => {
        if (inFlight?.revision === snapshot.revision) inFlight = null;
        if (disposed) return;
        acknowledgedRevision = Math.max(acknowledgedRevision, snapshot.revision);
        settleAcknowledgedWaiters();
        if (queued) {
          runNext();
        } else {
          phase = "idle";
        }
      })
      .catch(handleFailure);
  };

  const immediatePublication = (state: StudyWorkspaceStateV2): WorkspaceSnapshot => {
    revision += 1;
    const snapshot = { revision, state: clone(state) };
    if (debounceTimer !== null) {
      globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    debounced = null;
    failed = null;
    queued = snapshot;
    runNext();
    return snapshot;
  };

  return {
    publishView(state) {
      if (disposed) return;
      revision += 1;
      debounced = { revision, state: clone(state) };
      if (failed) {
        failed = debounced;
        debounced = null;
        if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
        debounceTimer = null;
        return;
      }
      if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
      debounceTimer = globalThis.setTimeout(() => {
        debounceTimer = null;
        const snapshot = debounced;
        debounced = null;
        if (disposed || !snapshot) return;
        if (failed) {
          failed = snapshot;
          return;
        }
        queued = snapshot;
        runNext();
      }, Math.max(0, options.debounceMs));
    },
    persistStructure(state) {
      if (disposed) return Promise.resolve(false);
      const snapshot = immediatePublication(state);
      return waitForRevision(snapshot.revision);
    },
    flush(state) {
      if (disposed) return Promise.resolve(false);
      const snapshot = immediatePublication(state);
      return waitForRevision(snapshot.revision);
    },
    retry() {
      if (disposed || !failed) return Promise.resolve(false);
      const snapshot = failed;
      failed = null;
      queued = snapshot;
      runNext();
      return waitForRevision(snapshot.revision);
    },
    status() {
      return {
        phase,
        acknowledgedRevision,
        pendingRevision: newestPendingRevision(),
        ...(error !== undefined ? { error } : {}),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
      debounced = null;
      queued = null;
      failed = null;
      phase = "idle";
      error = undefined;
      for (const waiter of waiters.splice(0)) waiter.resolve(false);
    },
  };
}
