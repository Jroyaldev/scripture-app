/**
 * Highlight overlap + trim geometry (pure, no DB/IPC — INV-18).
 *
 * Two granularities coexist:
 *  - Verse ranges are INCLUSIVE intervals [verse_start, verse_end] (two
 *    highlights sharing a verse overlap).
 *  - Character ranges within a single verse are HALF-OPEN intervals
 *    [char_start, char_end) — the same convention JS `String.slice` uses,
 *    which is exactly what the renderer's range-to-offset conversion produces
 *    (char_start = index of first selected char, char_end = one-past-last).
 *    So two char ranges that merely touch ([0,5) and [5,10)) do NOT overlap:
 *    they share no character. A `null` char_start means "the verse's start"
 *    (0); a `null` char_end means "the verse's end" (+∞ for comparison).
 *
 * Multi-verse ranges keep character precision at their two endpoints:
 * char_start belongs to verse_start and char_end belongs to verse_end. Every
 * interior verse is covered in full. Comparisons expand both ranges into
 * those per-verse segments so partial endpoint phrases do not accidentally
 * erase unrelated text on the same boundary verse.
 */

export interface OverlapExisting {
  verse_start: number;
  verse_end: number;
  char_start?: number | null;
  char_end?: number | null;
}

export interface OverlapIncoming {
  verseStart: number;
  verseEnd: number;
  charStart?: number | null;
  charEnd?: number | null;
}

export interface HighlightRange {
  verseStart: number;
  verseEnd: number;
  /** Offset in verseStart; null means the verse's beginning. */
  charStart: number | null;
  /** Offset in verseEnd; null means the verse's end. */
  charEnd: number | null;
}

export interface HighlightVerseSegment {
  verse: number;
  charStart: number | null;
  charEnd: number | null;
}

function asRange(range: OverlapExisting | OverlapIncoming): HighlightRange {
  if ("verseStart" in range) {
    return {
      verseStart: range.verseStart,
      verseEnd: range.verseEnd,
      charStart: range.charStart ?? null,
      charEnd: range.charEnd ?? null,
    };
  }
  return {
    verseStart: range.verse_start,
    verseEnd: range.verse_end,
    charStart: range.char_start ?? null,
    charEnd: range.char_end ?? null,
  };
}

/**
 * Expand a continuous highlight range into the per-verse segments consumers
 * render and compare. Character offsets belong to the range's endpoints:
 * charStart scopes only the first verse and charEnd scopes only the last;
 * every verse between them is covered in full.
 */
export function rangeToVerseSegments(range: OverlapIncoming | OverlapExisting): HighlightVerseSegment[] {
  const normalized = asRange(range);
  if (normalized.verseStart > normalized.verseEnd) return [];

  const segments: HighlightVerseSegment[] = [];
  for (let verse = normalized.verseStart; verse <= normalized.verseEnd; verse++) {
    segments.push({
      verse,
      charStart: verse === normalized.verseStart ? normalized.charStart : null,
      charEnd: verse === normalized.verseEnd ? normalized.charEnd : null,
    });
  }
  return segments;
}

/** Inclusive verse-range overlap, the coarse gate for both granularities. */
function verseRangesOverlap(existing: OverlapExisting, incoming: OverlapIncoming): boolean {
  return existing.verse_start <= incoming.verseEnd && existing.verse_end >= incoming.verseStart;
}

/**
 * Overlap test used by create-highlight's replacement/subtraction logic.
 * Character-aware at the first and last verse of either range and whole-verse
 * for interior segments. Callers that pass no char fields retain whole-verse
 * semantics.
 */
export function isHighlightOverlap(existing: OverlapExisting, incoming: OverlapIncoming): boolean {
  if (!verseRangesOverlap(existing, incoming)) return false;

  const existingRange = asRange(existing);
  const incomingRange = asRange(incoming);
  const startVerse = Math.max(existingRange.verseStart, incomingRange.verseStart);
  const endVerse = Math.min(existingRange.verseEnd, incomingRange.verseEnd);
  for (let verse = startVerse; verse <= endVerse; verse++) {
    const eStart = verse === existingRange.verseStart ? existingRange.charStart ?? 0 : 0;
    const eEnd = verse === existingRange.verseEnd ? existingRange.charEnd ?? Infinity : Infinity;
    const iStart = verse === incomingRange.verseStart ? incomingRange.charStart ?? 0 : 0;
    const iEnd = verse === incomingRange.verseEnd ? incomingRange.charEnd ?? Infinity : Infinity;
    if (eStart < iEnd && iStart < eEnd) return true;
  }
  return false;
}

/**
 * Subtract one continuous reading range from another. The result is zero, one,
 * or two continuous ranges that exactly preserve every character of the
 * existing highlight outside the incoming range. This is the generalized
 * multi-verse form of computeTrim.
 */
export function subtractHighlightRange(
  existing: OverlapExisting,
  incoming: OverlapIncoming,
): HighlightRange[] {
  const existingRange = asRange(existing);
  if (existingRange.verseStart > existingRange.verseEnd) return [];

  const incomingRange = asRange(incoming);
  const remainingSegments: HighlightVerseSegment[] = [];

  for (const segment of rangeToVerseSegments(existingRange)) {
    if (segment.verse < incomingRange.verseStart || segment.verse > incomingRange.verseEnd) {
      remainingSegments.push(segment);
      continue;
    }

    const existingStart = segment.charStart ?? 0;
    const existingEnd = segment.charEnd ?? Infinity;
    const incomingStart = segment.verse === incomingRange.verseStart ? incomingRange.charStart ?? 0 : 0;
    const incomingEnd = segment.verse === incomingRange.verseEnd ? incomingRange.charEnd ?? Infinity : Infinity;

    if (!(existingStart < incomingEnd && incomingStart < existingEnd)) {
      remainingSegments.push(segment);
      continue;
    }

    if (existingStart < incomingStart) {
      remainingSegments.push({
        verse: segment.verse,
        charStart: existingStart === 0 ? null : existingStart,
        charEnd: incomingStart === Infinity ? null : incomingStart,
      });
    }
    if (incomingEnd < existingEnd) {
      remainingSegments.push({
        verse: segment.verse,
        charStart: incomingEnd === 0 ? null : incomingEnd,
        charEnd: existingEnd === Infinity ? null : existingEnd,
      });
    }
  }

  const ranges: HighlightRange[] = [];
  for (const segment of remainingSegments) {
    const previous = ranges[ranges.length - 1];
    if (
      previous &&
      previous.verseEnd + 1 === segment.verse &&
      previous.charEnd === null &&
      segment.charStart === null
    ) {
      previous.verseEnd = segment.verse;
      previous.charEnd = segment.charEnd;
      continue;
    }
    ranges.push({
      verseStart: segment.verse,
      verseEnd: segment.verse,
      charStart: segment.charStart,
      charEnd: segment.charEnd,
    });
  }
  return ranges;
}

export type TrimOutcome =
  /** Incoming fully covers existing — delete existing outright. */
  | { kind: "delete" }
  /** No real char-level overlap after all — leave existing untouched. */
  | { kind: "none" }
  /** Incoming covers existing's tail — keep existing's head, char_end = value. */
  | { kind: "shrink-before"; charEnd: number }
  /** Incoming covers existing's head — keep existing's tail, char_start = value. */
  | { kind: "shrink-after"; charStart: number }
  /** Incoming lands strictly inside existing — split into two remainders. */
  | { kind: "split"; before: { charEnd: number }; after: { charStart: number } };

/**
 * Legacy single-verse compatibility helper. New persistence code uses
 * subtractHighlightRange for both single- and multi-verse edits; this remains
 * useful to callers/tests that need the older named trim outcomes.
 *
 * The four non-trivial outcomes tile perfectly: for a `split`, the before
 * piece [eStart, incoming.charStart), the incoming [incoming.charStart,
 * incoming.charEnd), and the after piece [incoming.charEnd, eEnd) reconstruct
 * the original existing span with no gap and no overlap.
 */
export function computeTrim(existing: OverlapExisting, incoming: OverlapIncoming): TrimOutcome {
  const eStart = existing.char_start ?? 0;
  const eEnd = existing.char_end ?? Infinity;
  const iStart = incoming.charStart ?? 0;
  const iEnd = incoming.charEnd ?? Infinity;

  // Defensive: no genuine char-level overlap → nothing to trim.
  if (!(eStart < iEnd && iStart < eEnd)) return { kind: "none" };

  // Incoming covers all of existing.
  if (iStart <= eStart && iEnd >= eEnd) return { kind: "delete" };

  // Incoming covers existing's head (but not its tail) → trim the head
  // forward. iEnd is guaranteed finite here (an infinite iEnd combined with
  // iStart <= eStart is the delete case, already returned).
  if (iStart <= eStart) return { kind: "shrink-after", charStart: iEnd };

  // Incoming covers existing's tail (but not its head) → trim the tail back.
  // iStart is guaranteed finite here (iStart > eStart >= 0).
  if (iEnd >= eEnd) return { kind: "shrink-before", charEnd: iStart };

  // Incoming lands strictly inside existing → split. Both bounds finite.
  return { kind: "split", before: { charEnd: iStart }, after: { charStart: iEnd } };
}
