import type { StudyWorkspaceStateV2 } from "./studyWorkspace.js";

export interface WorkspacePersistenceStatus {
  phase: "idle" | "saving" | "failed";
  acknowledgedRevision: number;
  pendingRevision: number | null;
  error?: string;
}

function canonicalJson(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value, (_key, current: unknown) => {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return current;
      }
      const record = current as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record).sort().map((key) => [key, record[key]]),
      );
    });
    return serialized ?? null;
  } catch {
    return null;
  }
}

export function isStudyWorkspaceSnapshotAcknowledged(
  requested: StudyWorkspaceStateV2,
  persisted: unknown,
): boolean {
  const requestedCanonical = canonicalJson(requested);
  return requestedCanonical !== null && requestedCanonical === canonicalJson(persisted);
}

export type StudyWorkspaceCloseDecision =
  | { kind: "approve" }
  | { kind: "veto" }
  | { kind: "flush"; workspace: StudyWorkspaceStateV2 };

export function decideStudyWorkspaceClose(
  workspace: StudyWorkspaceStateV2 | null | undefined,
  refusal: "newer-version" | null,
): StudyWorkspaceCloseDecision {
  if (refusal === "newer-version") return { kind: "approve" };
  if (workspace === undefined) return { kind: "veto" };
  return workspace ? { kind: "flush", workspace } : { kind: "approve" };
}

export interface WorkspacePersistenceController {
  publishView(state: StudyWorkspaceStateV2): void;
  persistStructure(state: StudyWorkspaceStateV2): Promise<boolean>;
  flush(state: StudyWorkspaceStateV2): Promise<boolean>;
  retry(): Promise<boolean>;
  status(): WorkspacePersistenceStatus;
  subscribe(listener: (status: WorkspacePersistenceStatus) => void): () => void;
  dispose(): void;
}

interface WorkspaceSnapshot {
  revision: number;
  state: StudyWorkspaceStateV2;
  kind: "view" | "required";
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
  let queue: WorkspaceSnapshot[] = [];
  let failed: WorkspaceSnapshot | null = null;
  let phase: WorkspacePersistenceStatus["phase"] = "idle";
  let error: string | undefined;
  let disposed = false;
  let debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let debounced: WorkspaceSnapshot | null = null;
  const waiters: RevisionWaiter[] = [];
  const listeners = new Set<(status: WorkspacePersistenceStatus) => void>();

  const clone = (state: StudyWorkspaceStateV2): StudyWorkspaceStateV2 => structuredClone(state);

  const newestPendingRevision = (): number | null => {
    return Math.max(
      inFlight?.revision ?? 0,
      ...queue.map((snapshot) => snapshot.revision),
      failed?.revision ?? 0,
      debounced?.revision ?? 0,
    ) || null;
  };

  const currentStatus = (): WorkspacePersistenceStatus => ({
    phase,
    acknowledgedRevision,
    pendingRevision: newestPendingRevision(),
    ...(error !== undefined ? { error } : {}),
  });

  const publishStatus = (): void => {
    const next = currentStatus();
    for (const listener of listeners) listener(next);
  };

  const settleAcknowledgedWaiters = (revisionToAcknowledge: number): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (waiter.revision !== revisionToAcknowledge) continue;
      waiters.splice(index, 1);
      waiter.resolve(true);
    }
  };

  const settleFailedWaiters = (): void => {
    for (const waiter of waiters.splice(0)) waiter.resolve(false);
  };

  const waitForRevision = (targetRevision: number): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    if (failed) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      waiters.push({ revision: targetRevision, resolve });
    });
  };

  const runNext = (): void => {
    if (disposed || inFlight || queue.length === 0 || failed) return;
    const snapshot = queue.shift()!;
    inFlight = snapshot;
    phase = "saving";
    error = undefined;
    const handleFailure = (reason: unknown): void => {
      if (inFlight?.revision === snapshot.revision) inFlight = null;
      if (disposed) return;
      let retryable = snapshot;
      for (const queued of queue) {
        if (queued.revision > retryable.revision) retryable = queued;
      }
      if (debounced && debounced.revision > retryable.revision) retryable = debounced;
      if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
      debounced = null;
      queue = [];
      failed = retryable;
      phase = "failed";
      error = reason instanceof Error ? reason.message : String(reason);
      settleFailedWaiters();
      publishStatus();
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
        if (disposed || inFlight?.revision !== snapshot.revision) return;
        inFlight = null;
        acknowledgedRevision = Math.max(acknowledgedRevision, snapshot.revision);
        settleAcknowledgedWaiters(snapshot.revision);
        if (queue.length > 0) {
          publishStatus();
          runNext();
        } else {
          phase = "idle";
          publishStatus();
        }
      })
      .catch(handleFailure);
  };

  const immediatePublication = (state: StudyWorkspaceStateV2): {
    snapshot: WorkspaceSnapshot;
    completion: Promise<boolean>;
  } => {
    revision += 1;
    const snapshot: WorkspaceSnapshot = { revision, state: clone(state), kind: "required" };
    const completion = waitForRevision(snapshot.revision);
    if (debounceTimer !== null) {
      globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    debounced = null;
    queue = queue.filter((candidate) => candidate.kind === "required");
    if (failed) {
      failed = snapshot;
      publishStatus();
      return { snapshot, completion };
    }
    queue.push(snapshot);
    runNext();
    publishStatus();
    return { snapshot, completion };
  };

  return {
    publishView(state) {
      if (disposed) return;
      revision += 1;
      debounced = { revision, state: clone(state), kind: "view" };
      if (failed) {
        failed = debounced;
        debounced = null;
        if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
        debounceTimer = null;
        publishStatus();
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
        queue = queue.filter((candidate) => candidate.kind === "required");
        queue.push(snapshot);
        runNext();
        publishStatus();
      }, Math.max(0, options.debounceMs));
      publishStatus();
    },
    persistStructure(state) {
      if (disposed) return Promise.resolve(false);
      return immediatePublication(state).completion;
    },
    flush(state) {
      if (disposed) return Promise.resolve(false);
      return immediatePublication(state).completion;
    },
    retry() {
      if (disposed || !failed) return Promise.resolve(false);
      const snapshot = { ...failed, kind: "required" as const };
      failed = null;
      const completion = waitForRevision(snapshot.revision);
      queue.push(snapshot);
      runNext();
      publishStatus();
      return completion;
    },
    status() {
      return currentStatus();
    },
    subscribe(listener) {
      if (disposed) {
        listener(currentStatus());
        return () => undefined;
      }
      listeners.add(listener);
      listener(currentStatus());
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (debounceTimer !== null) globalThis.clearTimeout(debounceTimer);
      debounceTimer = null;
      debounced = null;
      inFlight = null;
      queue = [];
      failed = null;
      phase = "idle";
      error = undefined;
      for (const waiter of waiters.splice(0)) waiter.resolve(false);
      publishStatus();
      listeners.clear();
    },
  };
}
