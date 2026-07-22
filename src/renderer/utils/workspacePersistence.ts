import type { StudyWorkspaceStateV2 } from "./studyWorkspace.js";
import type { ResearchWorkspaceState } from "./researchWorkspace.js";

export interface StudyWorkspaceCompatibilityProjection {
  researchWorkspace: ResearchWorkspaceState;
  keptContext: {
    book: string;
    chapter: number;
    verse: number;
    endVerse?: number;
    label?: string;
  } | null;
}

/**
 * Read-only bridge for the pre-V2 tab strip and kept-subject props. Task 5 can
 * remove this projection when those components consume StudyWorkspaceStateV2
 * directly; persisted authority remains V2 throughout the transition.
 */
export function projectStudyWorkspaceCompatibility(
  workspace: StudyWorkspaceStateV2 | null,
): StudyWorkspaceCompatibilityProjection {
  if (!workspace) {
    return {
      researchWorkspace: {
        tabs: [],
        activeTabId: "scripture",
        lastResearchTabId: null,
        activationOrder: ["scripture"],
      },
      keptContext: null,
    };
  }
  const tabs = workspace.groups.flatMap((group) => group.tabIds.flatMap((tabId) => {
    const tab = workspace.tabsById[tabId];
    if (tab?.kind !== "entity") return [];
    return [{
      id: tab.id,
      entityId: tab.entityId,
      origin: {
        book: tab.origin.book,
        chapter: tab.origin.chapter,
        packageId: tab.origin.packageId,
        ...(tab.originRange
          ? { verseStart: tab.originRange.start, verseEnd: tab.originRange.end }
          : {}),
      },
      trail: tab.trail.map((entry) => ({ ...entry })),
      nonce: tab.nonce,
    }];
  }));
  const entityIds = new Set(tabs.map((tab) => tab.id));
  const activeTabId = entityIds.has(workspace.activeTabId)
    ? workspace.activeTabId
    : "scripture";
  const activationOrder: string[] = [];
  const activated = new Set<string>();
  for (const tabId of workspace.activationOrder) {
    const compatibilityId = entityIds.has(tabId) ? tabId : "scripture";
    if (activated.has(compatibilityId)) continue;
    activated.add(compatibilityId);
    activationOrder.push(compatibilityId);
  }
  if (!activated.has("scripture")) activationOrder.unshift("scripture");
  const normalizedActivationOrder = [
    ...activationOrder.filter((tabId) => tabId !== activeTabId),
    activeTabId,
  ];
  const lastResearchTabId = [...normalizedActivationOrder].reverse().find(
    (tabId) => entityIds.has(tabId),
  ) ?? null;
  const activeTab = workspace.tabsById[workspace.activeTabId];
  const activeScope = activeTab?.kind === "passage"
    ? activeTab.session.current.margin.scope
    : activeTab?.canvas.current.margin.scope;
  const keptContext: StudyWorkspaceCompatibilityProjection["keptContext"] =
    activeScope?.kind === "kept"
      ? {
          book: activeScope.book,
          chapter: activeScope.chapter,
          verse: activeScope.verse,
          ...(activeScope.endVerse !== undefined ? { endVerse: activeScope.endVerse } : {}),
          ...(activeScope.label !== undefined ? { label: activeScope.label } : {}),
        }
      : null;
  return {
    researchWorkspace: {
      tabs,
      activeTabId,
      lastResearchTabId,
      activationOrder: normalizedActivationOrder,
    },
    keptContext,
  };
}

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

  const clone = (state: StudyWorkspaceStateV2): StudyWorkspaceStateV2 => structuredClone(state);

  const newestPendingRevision = (): number | null => {
    return Math.max(
      inFlight?.revision ?? 0,
      ...queue.map((snapshot) => snapshot.revision),
      failed?.revision ?? 0,
      debounced?.revision ?? 0,
    ) || null;
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
          runNext();
        } else {
          phase = "idle";
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
      return { snapshot, completion };
    }
    queue.push(snapshot);
    runNext();
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
      }, Math.max(0, options.debounceMs));
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
      return completion;
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
      inFlight = null;
      queue = [];
      failed = null;
      phase = "idle";
      error = undefined;
      for (const waiter of waiters.splice(0)) waiter.resolve(false);
    },
  };
}
