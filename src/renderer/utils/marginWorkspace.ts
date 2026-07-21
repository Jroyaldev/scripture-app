export type MarginWorkspace = "study" | "research";

export type MarginWorkspaceEvent =
  | { type: "open-research" }
  | { type: "close-research" }
  | { type: "select"; workspace: MarginWorkspace; hasResearch: boolean };

/** Pure workspace transition used by pointer, keyboard, and entity events. */
export function reduceMarginWorkspace(
  current: MarginWorkspace,
  event: MarginWorkspaceEvent,
): MarginWorkspace {
  if (event.type === "open-research") return "research";
  if (event.type === "close-research") return "study";
  if (event.workspace === "research" && !event.hasResearch) return current;
  return event.workspace;
}
