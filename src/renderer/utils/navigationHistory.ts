export const NAVIGATION_HISTORY_LIMIT = 50;

export type NavigationMarginTab = "overview" | "connections" | "passage" | "notes";

export type NavigationMarginScope =
  | { kind: "kept"; book: string; chapter: number; verse: number; endVerse?: number; label?: string }
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

export interface NavigationHistoryState<
  T extends NavigationHistoryEntry = NavigationHistoryEntry,
> {
  back: T[];
  forward: T[];
}

export interface NavigationHistoryMove<
  T extends NavigationHistoryEntry = NavigationHistoryEntry,
> {
  history: NavigationHistoryState<T>;
  target: T | null;
}

export function createNavigationHistory<
  T extends NavigationHistoryEntry = NavigationHistoryEntry,
>(): NavigationHistoryState<T> {
  return { back: [], forward: [] };
}

export function pushNavigationHistory<
  T extends NavigationHistoryEntry = NavigationHistoryEntry,
>(
  history: NavigationHistoryState<T>,
  current: T,
  limit = NAVIGATION_HISTORY_LIMIT,
): NavigationHistoryState<T> {
  return {
    back: [...history.back, current].slice(-Math.max(1, limit)),
    forward: [],
  };
}

export function backNavigationHistory<
  T extends NavigationHistoryEntry = NavigationHistoryEntry,
>(
  history: NavigationHistoryState<T>,
  current: T,
  limit = NAVIGATION_HISTORY_LIMIT,
): NavigationHistoryMove<T> {
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

export function forwardNavigationHistory<
  T extends NavigationHistoryEntry = NavigationHistoryEntry,
>(
  history: NavigationHistoryState<T>,
  current: T,
  limit = NAVIGATION_HISTORY_LIMIT,
): NavigationHistoryMove<T> {
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
