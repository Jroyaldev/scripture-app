export type WorkspaceTransitionReason =
  | "tab-change"
  | "tab-close"
  | "group-change"
  | "chapter-change"
  | "translation-change"
  | "view-change"
  | "library-change"
  | "window-close";

export interface WorkspaceExitController {
  requestExit(reason: WorkspaceTransitionReason): Promise<boolean>;
}

export interface WorkspaceTransitionCoordinator {
  run(
    reason: WorkspaceTransitionReason,
    commit: () => void | Promise<void>,
  ): Promise<boolean>;
}

export function createWorkspaceTransitionCoordinator(
  owners: () => readonly WorkspaceExitController[],
): WorkspaceTransitionCoordinator {
  let transitionInFlight = false;

  return {
    async run(reason, commit) {
      if (transitionInFlight) return false;
      transitionInFlight = true;

      try {
        const ownerSnapshot = [...owners()];
        for (const owner of ownerSnapshot) {
          if (!await owner.requestExit(reason)) return false;
        }
        await commit();
        return true;
      } catch {
        return false;
      } finally {
        transitionInFlight = false;
      }
    },
  };
}
