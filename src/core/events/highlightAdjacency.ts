/**
 * Highlight blob adjacency (pure — INV-18). The single source of truth for
 * "which highlight records form one continuous visual blob," shared by the
 * SVG renderer (HighlightUnderlay) and the whole-blob remove/recolor logic in
 * ScripturePage. Keeping one predicate here is deliberate: if "what looks
 * merged" and "what gets removed as one unit" ever used different adjacency
 * rules, that divergence would itself be a subtle version of the very bug this
 * feature fixes.
 *
 * A record is flattened into one SEGMENT per verse it covers. A single-verse,
 * char-scoped record yields one segment carrying its char range. A multi-verse
 * record carries char_start on its first verse and char_end on its last verse;
 * every verse between them is covered in full.
 * Segments are grouped into RUNS by reading-order adjacency + same color.
 */

import { rangeToVerseSegments } from "./highlightOverlap.js";

export interface HighlightLike {
  id: string;
  verse_start: number;
  verse_end: number;
  char_start: number | null;
  char_end: number | null;
  color: string;
}

export interface HighlightSegment {
  /** Source record id — several segments can share one id (multi-verse record). */
  id: string;
  color: string;
  verse: number;
  /** null = "from the verse's start" (0). */
  charStart: number | null;
  /** null = "to the verse's end". */
  charEnd: number | null;
}

export interface HighlightRun {
  color: string;
  segments: HighlightSegment[];
}

/** Flatten records into per-verse segments, sorted in reading order. */
export function buildSegments(highlights: HighlightLike[]): HighlightSegment[] {
  const segs: HighlightSegment[] = [];
  for (const h of highlights) {
    for (const segment of rangeToVerseSegments(h)) {
      segs.push({
        id: h.id,
        color: h.color,
        verse: segment.verse,
        charStart: segment.charStart,
        charEnd: segment.charEnd,
      });
    }
  }
  // Reading order: verse asc, then char_start asc (null = 0, sorts first),
  // then id for a stable, deterministic tie-break.
  segs.sort(
    (a, b) => a.verse - b.verse || (a.charStart ?? 0) - (b.charStart ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return segs;
}

/**
 * Whether two reading-order-consecutive segments should merge into one blob.
 * `a` precedes `b` in sorted order.
 *  - Same verse: `a` must reach or pass `b`'s start (touching/overlapping) —
 *    a gap of unhighlighted text between them keeps them separate.
 *  - Next verse: bridging forward requires BOTH sides to actually touch the
 *    verse boundary with no gap — `a` must run to its verse's end
 *    (charEnd === null) AND `b` must start at its verse's beginning
 *    (charStart === null). Checking only one side is a bug: a segment that
 *    reaches its own verse's end can still leave a gap if the next verse's
 *    segment doesn't start until partway through its text (a phrase that
 *    starts mid-verse), and the reverse is equally true.
 */
export function isAdjacent(a: HighlightSegment, b: HighlightSegment): boolean {
  if (a.verse === b.verse) {
    return (a.charEnd ?? Infinity) >= (b.charStart ?? 0);
  }
  if (b.verse === a.verse + 1) {
    return a.charEnd === null && b.charStart === null;
  }
  return false;
}

function compareSegments(a: HighlightSegment, b: HighlightSegment): number {
  return a.verse - b.verse || (a.charStart ?? 0) - (b.charStart ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Order-independent connectivity used when a segment bridges existing runs. */
function segmentsConnect(a: HighlightSegment, b: HighlightSegment): boolean {
  return compareSegments(a, b) <= 0 ? isAdjacent(a, b) : isAdjacent(b, a);
}

/**
 * Group segments into connected same-color runs. This is intentionally a
 * connected-component fold, not a tail-only scan: an imported/restored record
 * may span around another same-color segment, and whichever record id a user
 * clicks must still resolve to the same complete visual blob.
 */
export function buildRuns(segments: HighlightSegment[]): HighlightRun[] {
  const runs: HighlightRun[] = [];
  for (const seg of segments) {
    const connectedIndexes: number[] = [];
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index]!;
      if (run.color === seg.color && run.segments.some((existing) => segmentsConnect(existing, seg))) {
        connectedIndexes.push(index);
      }
    }

    if (connectedIndexes.length === 0) {
      runs.push({ color: seg.color, segments: [seg] });
      continue;
    }

    const targetIndex = connectedIndexes[0]!;
    const target = runs[targetIndex]!;
    target.segments.push(seg);
    for (let i = connectedIndexes.length - 1; i >= 1; i--) {
      const mergeIndex = connectedIndexes[i]!;
      target.segments.push(...runs[mergeIndex]!.segments);
      runs.splice(mergeIndex, 1);
    }
    target.segments.sort(compareSegments);
  }
  runs.sort((a, b) => compareSegments(a.segments[0]!, b.segments[0]!));
  return runs;
}

/**
 * Given all active highlights for a chapter and a starting record id, return
 * the distinct record ids of the full connected same-color blob that record
 * belongs to (walking outward through adjacent segments). Used to make
 * "remove"/"recolor" act on the whole visual blob, not just the one record
 * under the cursor. Returns just [startId] if it isn't found (defensive).
 */
export function resolveBlobExtent(highlights: HighlightLike[], startId: string): string[] {
  const runs = buildRuns(buildSegments(highlights));
  for (const run of runs) {
    if (run.segments.some((s) => s.id === startId)) {
      const ids = new Set<string>();
      for (const s of run.segments) ids.add(s.id);
      return [...ids];
    }
  }
  return [startId];
}
