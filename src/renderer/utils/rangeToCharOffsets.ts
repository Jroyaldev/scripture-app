/**
 * Convert a DOM Range to half-open character offsets [start, end) into a verse
 * span's plain text string — the convention char_start/char_end use (and what
 * String.slice expects). Works by measuring the length of the text BEFORE the
 * range's start and end via cloned ranges, so it stays correct even if the
 * span's markup ever splits into multiple text/element nodes (it walks DOM
 * structure via the cloned range rather than assuming a single text node).
 *
 * Returns null for a degenerate/empty range (end <= start after resolving).
 *
 * A selection that actually reaches the verse's true start or end is
 * normalized to `null` on that side — the same sentinel whole-verse
 * highlights use for "unbounded." This isn't just cosmetic: the run-merging
 * adjacency check (src/core/events/highlightAdjacency.ts) looks for that
 * null sentinel specifically to decide whether a highlight bridges into an
 * adjacent verse. A phrase that visibly runs to the last character of its
 * verse must be indistinguishable from a whole-verse highlight for that
 * purpose, or it silently fails to connect to a same-color highlight in the
 * next verse even though there's no actual gap of unhighlighted text.
 */
export function rangeToVerseCharOffsets(range: Range, verseSpan: HTMLElement): { start: number | null; end: number | null } | null {
  const preStart = document.createRange();
  preStart.selectNodeContents(verseSpan);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = document.createRange();
  preEnd.selectNodeContents(verseSpan);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  if (end <= start) return null;
  const total = verseSpan.textContent?.length ?? end;
  return { start: start <= 0 ? null : start, end: end >= total ? null : end };
}
