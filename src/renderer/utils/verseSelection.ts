export interface VerseSelectionResult {
  selection: Set<number>;
  anchor: number | null;
}

/** Whole-verse selection is always one contiguous reading range. */
export function nextVerseSelection(
  current: ReadonlySet<number>,
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

  if (current.size === 1 && current.has(verse)) {
    return { selection: new Set(), anchor: null };
  }
  return { selection: new Set([verse]), anchor: verse };
}
