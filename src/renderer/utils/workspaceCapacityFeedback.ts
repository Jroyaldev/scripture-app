import type { WorkspaceMutationOutcome } from "./studyWorkspace.js";

export type WorkspaceCapacityOutcome = Extract<
  WorkspaceMutationOutcome,
  "tab-limit" | "group-limit"
>;

export type WorkspaceCapacityToast = (
  message: string,
  actionLabel?: string,
  onAction?: () => void,
  options?: { tone?: "warning" },
) => void;

const CAPACITY_MESSAGES: Record<WorkspaceCapacityOutcome, string> = {
  "tab-limit": "You’ve reached the open-tab limit. Close a tab, then try again.",
  "group-limit": "You’ve reached the study-group limit. Close a study, then try again.",
};

/** Reports structural capacity refusals through the app's shared polite toast lane. */
export function notifyWorkspaceCapacity(
  outcome: WorkspaceMutationOutcome,
  showToast: WorkspaceCapacityToast | null,
): outcome is WorkspaceCapacityOutcome {
  if (outcome !== "tab-limit" && outcome !== "group-limit") return false;
  showToast?.(CAPACITY_MESSAGES[outcome], undefined, undefined, { tone: "warning" });
  return true;
}
