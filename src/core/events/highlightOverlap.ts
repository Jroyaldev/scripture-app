/** Inclusive verse-range overlap test used by create-highlight replace-on-overlap. */
export function isHighlightOverlap(
  existing: { verse_start: number; verse_end: number },
  incoming: { verseStart: number; verseEnd: number },
): boolean {
  return existing.verse_start <= incoming.verseEnd && existing.verse_end >= incoming.verseStart;
}
