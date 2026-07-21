export interface VerseSelectionResult {
  selection: Set<number>;
  anchor: number | null;
}

/** Whole-verse selection is always one contiguous reading range. */
export function nextVerseSelection(
  _current: ReadonlySet<number>,
  anchor: number | null,
  verse: number,
  extend: boolean,
): VerseSelectionResult {
  if (extend && anchor != null) {
    const selection = new Set<number>();
    const start = Math.min(anchor, verse);
    const end = Math.max(anchor, verse);
    for (let value = start; value <= end; value++) selection.add(value);
    return { selection, anchor };
  }

  // A research click is a stable scope choice, not a toggle. The persistent
  // Living Margin Done action is the explicit way to clear that scope.
  return { selection: new Set([verse]), anchor: verse };
}
