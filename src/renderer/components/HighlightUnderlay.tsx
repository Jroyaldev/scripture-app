import { useEffect, useState, useCallback } from "react";
import type { HighlightRecord } from "../api.js";
import { mergeHighlightLineRects, type LineRect } from "../utils/highlightPath.js";
import { useUnderlayMeasurementLifecycle } from "../utils/useUnderlayMeasurementLifecycle.js";
import { locateTextOffset } from "../utils/textOffsets.js";
import { buildSegments, type HighlightSegment } from "../../core/events/highlightAdjacency.js";

/*
 * HighlightUnderlay — the paint, per G·2.
 *
 * A mark is TWO things and always both: a WASH that makes it findable, and a
 * 2px rule under it at double the wash's chroma. The rule is the colour-
 * blindness accommodation — green and pink at these lightnesses are near
 * identical under deuteranopia and their rules are not — so it is drawn for
 * every marked line, not only the last, and it is never optional.
 *
 * Overlap is the case nobody designs, and it has one rule each way:
 *
 *   WASHES DO NOT MULTIPLY. Two translucent layers make a third colour that
 *   belongs to neither mark and appears in no palette. So the overlap is
 *   resolved as GEOMETRY, not as blending: every stretch of text is painted
 *   exactly once, in the newest mark's hue. Nothing is composited over
 *   anything, which is also why this layer carries no mix-blend-mode.
 *
 *   RULES STACK. Both 2px rules are drawn, newest against the text and the
 *   one beneath it below, so an overlap is 4px tall and visibly reports that
 *   two marks are present. The stack caps at 4px; beyond two marks the
 *   reserved gutter shows a count, because three marks on one phrase is a
 *   filing problem and not a display problem.
 *
 * "Newest" is the order the records arrive in. There is no timestamp on a
 * highlight record (see the note in the report — the table has no `created`
 * column), and SQLite returns this chapter's rows in insertion order, so array
 * position is the only recency signal the renderer is given. ScripturePage
 * appends an optimistic record to the end, which makes the one overlap a
 * reader can actually produce — a fresh wash over an old one, before the host
 * has trimmed it — resolve the right way round.
 *
 * Geometry is measured, never inferred: one rect per visual line from
 * Range.getClientRects, so a marked phrase, a whole verse and a wrapped range
 * all measure identically. Re-measurement is driven by the shared underlay
 * lifecycle (data, reflow, resize, font settlement, theme).
 */

/** The five hues, and the only colours this layer knows how to paint. */
const HUES = new Set(["yellow", "green", "blue", "pink", "purple"]);

/** A hair of air above and below the glyphs. No horizontal bleed: adjacent
 *  hues have to tile exactly, and 2.5px of overhang each side would overlap
 *  them into a third colour at every seam. */
const PAD_V = 1;
/** The rule, at double chroma. Two of them, and no more. */
export const RULE = 2;
export const RULE_CAP = 4;
export const MAX_STACK = RULE_CAP / RULE;
/** Where the count sits: the reserved gutter's trailing lane, clear of both
 *  the verse number and the first glyph. */
const COUNT_INSET = 4;

// Exported so ScripturePage's handleHighlight can clear the just-created ids
// out of animateIds once the entrance would have finished. Without that,
// animateIds is only ever reset on chapter change — it stays populated
// indefinitely after a create, and any LATER re-measure (a resize, or editing
// a different highlight) would recompute the flag fresh and replay the
// entrance on a mark that finished arriving long ago.
export const SWEEP_MS = 180;
// Exported so ScripturePage's removal handlers can delay clearing the deleted
// highlight from local data by exactly this long — long enough for the fade
// (same duration) to actually play before the data disappears under it.
export const FADE_MS = 120;

/** One painted stretch of text: a wash, or one row of the rule stack. */
export interface PaintBand {
  key: string;
  /** Hue id, resolved to ink by marking-actions.css. */
  hue: string;
  /** -1 for the wash; 0 and 1 for the rule rows, newest first. */
  depth: number;
  rects: LineRect[];
  /** Record ids this band speaks for, for entrance/exit hit-testing. */
  ids: string[];
  sweep: boolean;
  fading: boolean;
  /** Outside the active pin range — keep quiet so the pin reads. */
  dimmed: boolean;
}

/** Beyond two marks the gutter states how many, once per visual line. */
export interface GutterCount {
  key: string;
  x: number;
  y: number;
  count: number;
}

interface UnderlayPaint {
  bands: PaintBand[];
  counts: GutterCount[];
}

const EMPTY_PAINT: UnderlayPaint = { bands: [], counts: [] };

interface Props {
  /** The .verse-text container (position: relative). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Live map of verse number → row element, maintained by ScripturePage. */
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  /** All highlight records currently loaded (any book/chapter); filtered here. */
  highlights: HighlightRecord[];
  book: string;
  chapter: number;
  /** Record ids of a just-created highlight — these bands arrive. */
  animateIds: Set<string>;
  /** Record ids of a highlight mid-deletion — these bands leave instead of
   * vanishing instantly (see ScripturePage's grouped removal path). */
  fadingIds: Set<string>;
  /** Bumped on theme toggle so geometry is re-read after any font change. */
  themeToken: unknown;
  /** When set, bands that do not overlap this verse range are dimmed
   * (optional "quiet the page while pinned" mode). */
  pinRange?: { start: number; end: number } | null;
}

/** One record's claim on one stretch of one verse. */
export interface Mark {
  id: string;
  hue: string;
  /** Array position of the record. Higher is newer. */
  recency: number;
}

/** A stretch of one verse over which the set of covering marks is constant. */
export interface Interval {
  start: number;
  end: number;
  /** Newest first. */
  marks: Mark[];
}

/**
 * Cut a verse's segments into the maximal stretches over which the covering
 * set does not change. Every boundary of every segment is a cut, so each
 * stretch has one answer to "which marks cover this?" — which is what makes
 * the wash paintable exactly once and the stack countable.
 */
export function elementaryIntervals(
  segments: readonly HighlightSegment[],
  total: number,
  recencyOf: ReadonlyMap<string, number>,
): Interval[] {
  const bounds = new Set<number>();
  for (const segment of segments) {
    bounds.add(Math.max(0, Math.min(segment.charStart ?? 0, total)));
    bounds.add(Math.max(0, Math.min(segment.charEnd ?? total, total)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const intervals: Interval[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (end <= start) continue;
    const marks: Mark[] = [];
    for (const segment of segments) {
      const segStart = segment.charStart ?? 0;
      const segEnd = segment.charEnd ?? total;
      if (segStart <= start && segEnd >= end) {
        marks.push({ id: segment.id, hue: segment.color, recency: recencyOf.get(segment.id) ?? 0 });
      }
    }
    if (marks.length === 0) continue;
    // Newest first: the wash is marks[0]'s, and the stack reads downward.
    marks.sort((a, b) => b.recency - a.recency || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    intervals.push({ start, end, marks });
  }
  return intervals;
}

/**
 * Merge neighbouring intervals that would paint the same ink at this depth, so
 * a wash that happens to be overlapped halfway along is still ONE run of paint
 * rather than two rectangles meeting at a seam.
 */
export function runsAtDepth(intervals: readonly Interval[], depth: number): { start: number; end: number; hue: string; ids: string[] }[] {
  const runs: { start: number; end: number; hue: string; ids: string[] }[] = [];
  for (const interval of intervals) {
    const mark = interval.marks[depth];
    if (!mark) continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.hue === mark.hue && previous.end === interval.start) {
      previous.end = interval.end;
      if (!previous.ids.includes(mark.id)) previous.ids.push(mark.id);
      continue;
    }
    runs.push({ start: interval.start, end: interval.end, hue: mark.hue, ids: [mark.id] });
  }
  return runs;
}

export function HighlightUnderlay({
  containerRef,
  verseRowRefs,
  highlights,
  book,
  chapter,
  animateIds,
  fadingIds,
  themeToken,
  pinRange = null,
}: Props): React.JSX.Element | null {
  const [paint, setPaint] = useState<UnderlayPaint>(EMPTY_PAINT);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const doMeasure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setPaint(EMPTY_PAINT);
      return;
    }
    const cRect = container.getBoundingClientRect();

    const active = highlights.filter((h) => h.deleted === 0 && h.book === book && h.chapter === chapter);
    const recencyOf = new Map<string, number>();
    active.forEach((record, index) => recencyOf.set(record.id, index));

    const byVerse = new Map<number, HighlightSegment[]>();
    for (const segment of buildSegments(active)) {
      if (!HUES.has(segment.color)) continue; // an unknown hue is not painted a wrong one
      const bucket = byVerse.get(segment.verse);
      if (bucket) bucket.push(segment);
      else byVerse.set(segment.verse, [segment]);
    }

    /** Measure one char range of one verse as one rect per visual line. The
     *  wash and its rule ask for the same stretch, so the answer is cached
     *  per verse rather than re-measured for each. */
    const rectCache = new Map<string, LineRect[]>();
    const measureRange = (span: HTMLElement, total: number, start: number, end: number): LineRect[] => {
      const cacheKey = `${start}:${end}`;
      const hit = rectCache.get(cacheKey);
      if (hit) return hit;
      const range = document.createRange();
      const from = locateTextOffset(span, start);
      const to = locateTextOffset(span, end);
      if (!from || !to) {
        if (start === 0 && end === total) range.selectNodeContents(span);
        else return [];
      } else {
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
      }
      const lines: LineRect[] = [];
      const lineRects = range.getClientRects();
      for (let index = 0; index < lineRects.length; index++) {
        const lr = lineRects[index]!;
        if (lr.width <= 0) continue;
        lines.push({
          x0: lr.left - cRect.left,
          y0: lr.top - cRect.top - PAD_V,
          x1: lr.right - cRect.left,
          y1: lr.bottom - cRect.top + PAD_V,
        });
      }
      const rects = mergeHighlightLineRects(lines);
      // Consecutive lines may not overlap: two translucent washes sharing a
      // strip is the very compositing this design forbids. A gap is fine — a
      // mark is per line — but an overlap is split down the middle.
      for (let index = 0; index < rects.length - 1; index++) {
        const current = rects[index]!;
        const next = rects[index + 1]!;
        if (current.y1 <= next.y0) continue;
        const seam = (current.y1 + next.y0) / 2;
        current.y1 = seam;
        next.y0 = seam;
      }
      rectCache.set(cacheKey, rects);
      return rects;
    };

    const bands: PaintBand[] = [];
    const counts: GutterCount[] = [];

    for (const [verse, segments] of [...byVerse.entries()].sort((a, b) => a[0] - b[0])) {
      const row = verseRowRefs.current.get(verse);
      if (!row) continue;
      const span = row.querySelector<HTMLElement>(".verse-text-span");
      if (!span) continue;
      const total = span.textContent?.length ?? 0;
      if (total === 0) continue;
      rectCache.clear(); // offsets are verse-local, so the cache is too

      const intervals = elementaryIntervals(segments, total, recencyOf);
      if (intervals.length === 0) continue;

      const dimmed = pinRange != null && !(verse >= pinRange.start && verse <= pinRange.end);

      // Depth -1 is the wash; depths 0…MAX_STACK-1 are the rule stack. Each
      // is merged independently so same-ink neighbours never meet at a seam.
      for (let depth = -1; depth < MAX_STACK; depth++) {
        for (const run of runsAtDepth(intervals, Math.max(depth, 0))) {
          const rects = measureRange(span, total, run.start, run.end);
          if (rects.length === 0) continue;
          bands.push({
            key: `${verse}:${depth}:${run.start}:${run.end}:${run.hue}`,
            hue: run.hue,
            depth,
            rects,
            ids: run.ids,
            sweep: run.ids.every((id) => animateIds.has(id)),
            fading: run.ids.every((id) => fadingIds.has(id)),
            dimmed,
          });
        }
      }

      // Beyond two marks the gutter says how many. The gutter is measured off
      // the row and the text, not derived from a token, so it stays right at
      // both gutter widths and under any reading measure.
      const gutterX = span.getBoundingClientRect().left - cRect.left - COUNT_INSET;
      const perLine = new Map<number, GutterCount>();
      for (const interval of intervals) {
        if (interval.marks.length <= MAX_STACK) continue;
        for (const rect of measureRange(span, total, interval.start, interval.end)) {
          const y = Math.round((rect.y0 + rect.y1) / 2);
          const existing = perLine.get(y);
          if (existing && existing.count >= interval.marks.length) continue;
          perLine.set(y, {
            key: `${verse}:${y}`,
            x: gutterX,
            y,
            count: interval.marks.length,
          });
        }
      }
      counts.push(...perLine.values());
    }

    setPaint({ bands, counts });
    setSize({ w: cRect.width, h: cRect.height });
  }, [containerRef, verseRowRefs, highlights, book, chapter, animateIds, fadingIds, pinRange]);

  const measure = useUnderlayMeasurementLifecycle({
    containerRef,
    measure: doMeasure,
  });

  // Re-measure when highlight data, chapter, animation sets, pin, or theme change.
  useEffect(() => {
    measure();
  }, [highlights, book, chapter, animateIds, fadingIds, themeToken, pinRange, measure]);

  // Clear the entrance flag once it has played, so a later re-measure (a
  // resize, say) does not replay it.
  useEffect(() => {
    if (!paint.bands.some((band) => band.sweep)) return;
    const timer = window.setTimeout(() => {
      setPaint((previous) => ({
        ...previous,
        bands: previous.bands.map((band) => (band.sweep ? { ...band, sweep: false } : band)),
      }));
    }, SWEEP_MS);
    return () => window.clearTimeout(timer);
  }, [paint]);

  if (paint.bands.length === 0) return null;

  return (
    <svg
      className="highlight-underlay"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
    >
      {paint.bands.map((band) => {
        const classNames = [band.depth < 0 ? "quire-hl-wash" : "quire-hl-rule"];
        if (band.sweep) classNames.push("hl-arriving");
        if (band.fading) classNames.push("hl-leaving");
        if (band.dimmed) classNames.push("hl-dimmed");
        return (
          <g key={band.key} className={classNames.join(" ")} data-hl={band.hue} data-hl-depth={band.depth}>
            {band.rects.map((rect, index) => (
              <rect
                key={index}
                x={rect.x0}
                y={band.depth < 0 ? rect.y0 : rect.y1 + band.depth * RULE}
                width={Math.max(0, rect.x1 - rect.x0)}
                height={band.depth < 0 ? Math.max(0, rect.y1 - rect.y0) : RULE}
              />
            ))}
          </g>
        );
      })}
      {paint.counts.map((count) => (
        <text
          key={count.key}
          className="quire-hl-count"
          x={count.x}
          y={count.y}
          textAnchor="end"
          dominantBaseline="middle"
        >{count.count}</text>
      ))}
    </svg>
  );
}
