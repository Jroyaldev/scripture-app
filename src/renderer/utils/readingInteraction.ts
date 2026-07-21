export interface ConnectionWordHitCandidate<T> {
  id: string;
  value: T;
  /** Painted phrase area in the underlay's own coordinate space. */
  area: number;
}

/**
 * A word can belong to more than one authored relationship. Preserve an
 * already-focused relationship, then a deliberately held one; otherwise the
 * smallest exact painted phrase wins, with durable id as the final stable tie.
 *
 * Re-clicking a focused phrase is intentionally idempotent. When more than one
 * candidate occupies the same words, this order drives the visible neutral
 * chooser instead of a hidden cycling mode; `chooseConnectionWordHit` remains
 * the deterministic single-best helper for non-chooser consumers.
 */
export function chooseConnectionWordHit<T>(
  candidates: readonly ConnectionWordHitCandidate<T>[],
  selectedConnectionId: string | null,
  heldConnectionIds: readonly string[],
): ConnectionWordHitCandidate<T> | null {
  return orderConnectionWordHits(candidates, selectedConnectionId, heldConnectionIds)[0] ?? null;
}

export function orderConnectionWordHits<T>(
  candidates: readonly ConnectionWordHitCandidate<T>[],
  selectedConnectionId: string | null,
  heldConnectionIds: readonly string[],
): ConnectionWordHitCandidate<T>[] {
  const byId = new Map<string, ConnectionWordHitCandidate<T>>();
  for (const candidate of candidates) {
    const current = byId.get(candidate.id);
    if (!current || candidate.area < current.area) byId.set(candidate.id, candidate);
  }
  if (byId.size === 0) return [];

  const priority = new Map<string, number>();
  let nextPriority = 0;
  if (selectedConnectionId && byId.has(selectedConnectionId)) {
    priority.set(selectedConnectionId, nextPriority++);
  }
  for (let index = heldConnectionIds.length - 1; index >= 0; index -= 1) {
    const heldId = heldConnectionIds[index]!;
    if (byId.has(heldId) && !priority.has(heldId)) priority.set(heldId, nextPriority++);
  }

  return [...byId.values()].sort((left, right) => {
    const leftPriority = priority.get(left.id);
    const rightPriority = priority.get(right.id);
    if (leftPriority != null || rightPriority != null) {
      if (leftPriority == null) return 1;
      if (rightPriority == null) return -1;
      return leftPriority - rightPriority;
    }
    return left.area - right.area || left.id.localeCompare(right.id);
  });
}

export interface ReadingPointerIntent {
  nativeSelectionCollapsed: boolean;
  connectionHitCount: number;
  insideVerse: boolean;
}

export type ReadingInteractionIntent =
  | "marking-selection"
  | "connection"
  | "research"
  | "dismiss";

/** The explicit priority contract shared by the source and its regression gate. */
export function resolveReadingPointerIntent(intent: ReadingPointerIntent): ReadingInteractionIntent {
  if (!intent.nativeSelectionCollapsed) return "marking-selection";
  if (intent.connectionHitCount > 0) return "connection";
  return intent.insideVerse ? "research" : "dismiss";
}
