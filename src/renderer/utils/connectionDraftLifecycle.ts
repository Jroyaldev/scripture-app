export type ConnectionDraftExitReason =
  | "chapter-change"
  | "translation-change"
  | "view-change"
  | "library-change"
  | "window-close"
  | "escape";

export interface ConnectionDraftExitController {
  requestExit(reason: ConnectionDraftExitReason): Promise<boolean>;
}

export type ConnectionDraftExitAction = "save" | "discard" | "keep-editing";

export function connectionDraftExitActions(phraseCount: number): readonly ConnectionDraftExitAction[] {
  return phraseCount >= 2
    ? ["save", "discard", "keep-editing"]
    : ["discard", "keep-editing"];
}

export function connectionDraftExitTitle(reason: ConnectionDraftExitReason): string {
  if (reason === "window-close") return "Close with an unfinished connection?";
  if (reason === "translation-change") return "Change translation with an unfinished connection?";
  if (reason === "chapter-change") return "Leave this chapter with an unfinished connection?";
  if (reason === "library-change") return "Switch libraries with an unfinished connection?";
  if (reason === "view-change") return "Leave Read with an unfinished connection?";
  return "Cancel this connection draft?";
}
