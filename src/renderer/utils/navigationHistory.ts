export const NAVIGATION_HISTORY_LIMIT = 50;

export type NavigationMarginTab = "overview" | "connections" | "passage" | "notes";

export type NavigationMarginScope =
  | { kind: "selection"; start: number; end: number }
  | null;

export interface NavigationHistoryEntry {
  book: string;
  chapter: number;
  packageId: string;
  verse?: number;
  verseOffset?: number;
  scrollTop?: number;
  margin: {
    activeTab: NavigationMarginTab;
    scope: NavigationMarginScope;
  };
}

export interface NavigationHistoryState {
  back: NavigationHistoryEntry[];
  forward: NavigationHistoryEntry[];
}

export interface NavigationHistoryMove {
  history: NavigationHistoryState;
  target: NavigationHistoryEntry | null;
}

export function createNavigationHistory(): NavigationHistoryState {
  return { back: [], forward: [] };
}

export function pushNavigationHistory(
  history: NavigationHistoryState,
  current: NavigationHistoryEntry,
  limit = NAVIGATION_HISTORY_LIMIT,
): NavigationHistoryState {
  return {
    back: [...history.back, current].slice(-Math.max(1, limit)),
    forward: [],
  };
}

export function backNavigationHistory(
  history: NavigationHistoryState,
  current: NavigationHistoryEntry,
  limit = NAVIGATION_HISTORY_LIMIT,
): NavigationHistoryMove {
  const target = history.back.at(-1) ?? null;
  if (!target) return { history, target: null };
  return {
    history: {
      back: history.back.slice(0, -1),
      forward: [current, ...history.forward].slice(0, Math.max(1, limit)),
    },
    target,
  };
}

export function forwardNavigationHistory(
  history: NavigationHistoryState,
  current: NavigationHistoryEntry,
  limit = NAVIGATION_HISTORY_LIMIT,
): NavigationHistoryMove {
  const target = history.forward[0] ?? null;
  if (!target) return { history, target: null };
  return {
    history: {
      back: [...history.back, current].slice(-Math.max(1, limit)),
      forward: history.forward.slice(1),
    },
    target,
  };
}
