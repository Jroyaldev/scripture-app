import { useEffect, useState, useRef, useCallback } from "react";
import type { HighlightRecord } from "../api.js";
import { buildHighlightPath, mergeHighlightLineRects, type LineRect } from "../utils/highlightPath.js";
import { useUnderlayMeasurementLifecycle } from "../utils/useUnderlayMeasurementLifecycle.js";
import { locateTextOffset } from "../utils/textOffsets.js";
import { buildSegments, buildRuns, isAdjacent, type HighlightRun } from "../../core/events/highlightAdjacency.js";

/*
 * HighlightUnderlay — the SVG layer that paints highlights as one continuous
 * rounded blob per contiguous same-color run, instead of N independent pills.
 *
 * Why this exists (see the design note in highlightPath.ts): the verse row is
 * a flex container, so `.verse-text-span` is blockified — box-decoration-break:
 * clone cannot fragment it per visual line, and CSS border-radius cannot draw
 * a continuous shoulder where a wider wrapped line meets a narrower one. So
 * we measure each segment's rect via Range.getClientRects (one rect
 * per visual line, and works identically for a whole verse or a sub-verse
 * character range), hand the stack to buildHighlightPath, and draw a single
 * <path> per run behind the text.
 *
 * The unit of input is a HIGHLIGHT RECORD, not a verse. Records are flattened
 * into per-verse (or per-char-range) segments and grouped into runs by the
 * shared adjacency logic in core/events/highlightAdjacency.ts — the same logic
 * the whole-blob remove/recolor path uses, so "what looks merged" and "what
 * acts as one unit" can never diverge. This is deliberately NOT a
 * color-per-verse projection: that projection is exactly what let N separate
 * records render as one indivisible-looking blob (the original bug).
 *
 * Re-measurement is triggered on: highlight data change, container reflow,
 * window resize, font settlement, and theme change (colors are read
 * from computed CSS vars each pass, so dark mode is free).
 */

export interface BlobData {
  /** Stable key — the distinct record ids in this run. */
  key: string;
  color: string;
  path: string;
  sweep: boolean;
  fading: boolean;
  /** Outside the active pin range — keep quiet so the pin reads. */
  dimmed: boolean;
  /** Record ids this blob spans, for sweep/fade hit-testing. */
  ids: string[];
}

interface Props {
  /** The .verse-text container (position: relative). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Live map of verse number → row element, maintained by ScripturePage. */
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  /** All highlight records currently loaded (any book/chapter); filtered here. */
  highlights: HighlightRecord[];
  book: string;
  chapter: number;
  /** Record ids of a just-created highlight — blobs of these sweep in. */
  animateIds: Set<string>;
  /** Record ids of a highlight mid-deletion — blobs of these fade out instead
   * of vanishing instantly (see ScripturePage's grouped removal path). */
  fadingIds: Set<string>;
  /** Bumped on theme toggle so colors are re-read from CSS. */
  themeToken: unknown;
  /** When set, blobs that do not overlap this verse range are dimmed
   * (optional “quiet the page while pinned” mode). */
  pinRange?: { start: number; end: number } | null;
}

const PAD_H = 2.5; // enough ink beyond glyphs without reading as a full-width field
const PAD_V = 1.5;
const RADIUS = 5;
// Exported so ScripturePage's handleHighlight can clear the just-created ids
// out of animateIds once the sweep would have finished. Without that,
// animateIds is only ever reset on chapter change — it stays populated
// indefinitely after a create, and any LATER re-measure (a resize, or editing
// a different highlight) would recompute sweep fresh and replay the reveal on
// a highlight that finished sweeping long ago.
export const SWEEP_MS = 450;
// Exported so ScripturePage's removal handlers can delay clearing the
// deleted highlight from local data by exactly this long — long enough for
// the CSS fade-out (same duration) to actually play before the blob's data
// disappears out from under it.
export const FADE_MS = 320;

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
  const [blobs, setBlobs] = useState<BlobData[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** Per-color resolved gradient stops, read from computed CSS vars. */
  const colorsRef = useRef<Record<string, { a: string; mid: string; b: string }>>({});

  const doMeasure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setBlobs([]);
      return;
    }
    const cRect = container.getBoundingClientRect();

    const active = highlights.filter((h) => h.deleted === 0 && h.book === book && h.chapter === chapter);
    const segments = buildSegments(active);
    const runs = buildRuns(segments);

    // Resolve gradient stops for each color present from CSS vars on every
    // pass, so a theme switch reflects immediately.
    const cs = getComputedStyle(container);
    const colors: Record<string, { a: string; mid: string; b: string }> = {};
    for (const c of new Set(active.map((h) => h.color))) {
      colors[c] = {
        a: cs.getPropertyValue(`--hl-${c}-a`).trim(),
        mid: cs.getPropertyValue(`--hl-${c}-mid`).trim(),
        b: cs.getPropertyValue(`--hl-${c}-b`).trim(),
      };
    }
    colorsRef.current = colors;

    interface MeasuredRun {
      run: HighlightRun;
      rects: LineRect[];
      ids: string[];
      sweep: boolean;
      fading: boolean;
      dimmed: boolean;
      joinInitialLeft: boolean;
      joinTerminalRight: boolean;
      joinInitialTop: boolean;
      joinTerminalBottom: boolean;
    }

    const measuredRuns: MeasuredRun[] = [];
    for (const run of runs) {
      const measured: LineRect[] = [];
      for (const seg of run.segments) {
        const row = verseRowRefs.current.get(seg.verse);
        if (!row) continue;
        const span = row.querySelector<HTMLElement>(".verse-text-span");
        if (!span) continue;

        const range = document.createRange();
        if (seg.charStart == null && seg.charEnd == null) {
          range.selectNodeContents(span);
        } else {
          const total = span.textContent?.length ?? 0;
          const start = locateTextOffset(span, seg.charStart ?? 0);
          const end = locateTextOffset(span, seg.charEnd ?? total);
          if (!start || !end) range.selectNodeContents(span);
          else {
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
          }
        }

        const lineRects = range.getClientRects();
        for (let i = 0; i < lineRects.length; i++) {
          const lr = lineRects[i]!;
          measured.push({
            x0: lr.left - cRect.left - PAD_H,
            y0: lr.top - cRect.top - PAD_V,
            x1: lr.right - cRect.left + PAD_H,
            y1: lr.bottom - cRect.top + PAD_V,
          });
        }
      }
      if (measured.length === 0) continue;

      // Preserve the actual rag of the text instead of extending every
      // interior line to the reading column's edge. Duplicate/overlapping
      // records on one line collapse to one band before the outline is traced.
      const rects = mergeHighlightLineRects(measured);

      // Consecutive lines in one color share the exact midpoint of their
      // padded edges. No overlap means no dark band; no gap means one boundary.
      for (let i = 0; i < rects.length - 1; i++) {
        const seam = (rects[i]!.y1 + rects[i + 1]!.y0) / 2;
        rects[i]!.y1 = seam;
        rects[i + 1]!.y0 = seam;
      }

      const ids = [...new Set(run.segments.map((s) => s.id))];
      const sweep = ids.length > 0 && ids.every((id) => animateIds.has(id));
      const fading = ids.length > 0 && ids.every((id) => fadingIds.has(id));
      // Dim when a pin is active and this run never touches the pin range.
      const dimmed = pinRange != null && !run.segments.some(
        (s) => s.verse >= pinRange.start && s.verse <= pinRange.end,
      );
      measuredRuns.push({
        run,
        rects,
        ids,
        sweep,
        fading,
        dimmed,
        joinInitialLeft: false,
        joinTerminalRight: false,
        joinInitialTop: false,
        joinTerminalBottom: false,
      });
    }

    // Different colors that meet with no unhighlighted character between them
    // share one exact seam. Horizontal seams remove the two ranges' padding
    // overlap; vertical seams remove the old deliberate pullback gap. The later
    // SVG path paints last, producing one crisp color handoff with no muddy
    // blended strip.
    for (let index = 0; index < measuredRuns.length - 1; index++) {
      const current = measuredRuns[index]!;
      const next = measuredRuns[index + 1]!;
      const lastSegment = current.run.segments[current.run.segments.length - 1]!;
      const firstSegment = next.run.segments[0]!;
      if (!isAdjacent(lastSegment, firstSegment)) continue;

      const lastRect = current.rects[current.rects.length - 1]!;
      const firstRect = next.rects[0]!;
      const overlapY = Math.min(lastRect.y1, firstRect.y1) - Math.max(lastRect.y0, firstRect.y0);
      const sameVisualLine = lastSegment.verse === firstSegment.verse && overlapY > 2;
      if (sameVisualLine) {
        const seam = (lastRect.x1 + firstRect.x0) / 2;
        lastRect.x1 = seam;
        firstRect.x0 = seam;
        current.joinTerminalRight = true;
        next.joinInitialLeft = true;
      } else {
        const seam = (lastRect.y1 + firstRect.y0) / 2;
        lastRect.y1 = seam;
        firstRect.y0 = seam;
        current.joinTerminalBottom = true;
        next.joinInitialTop = true;
      }
    }

    const built: BlobData[] = measuredRuns.map(({
      run,
      rects,
      ids,
      sweep,
      fading,
      dimmed,
      joinInitialLeft,
      joinTerminalRight,
      joinInitialTop,
      joinTerminalBottom,
    }) => ({
      key: [...ids].sort().join("_"),
      color: run.color,
      path: buildHighlightPath(rects, RADIUS, {
        joinInitialLeft,
        joinTerminalRight,
        joinInitialTop,
        joinTerminalBottom,
        seamLean: 0.3,
        junctionRadius: 1.5,
      }),
      sweep,
      fading,
      dimmed,
      ids,
    }));

    setBlobs(built);
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

  // Clear the sweep flag after the animation finishes so a re-measure (e.g.
  // on resize) doesn't replay it.
  useEffect(() => {
    if (!blobs.some((b) => b.sweep)) return;
    const t = setTimeout(() => {
      setBlobs((prev) => prev.map((b) => (b.sweep ? { ...b, sweep: false } : b)));
    }, SWEEP_MS);
    return () => clearTimeout(t);
  }, [blobs]);

  if (blobs.length === 0) return null;

  const colors = colorsRef.current;
  const gradIds = new Set(blobs.map((b) => b.color));

  return (
    <svg
      className="highlight-underlay"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
    >
      <defs>
        {Array.from(gradIds).map((c) => {
          const stops = colors[c] ?? { a: "transparent", mid: "transparent", b: "transparent" };
          return (
            <linearGradient id={`hl-grad-${c}`} key={c} x1="0" y1="0" x2="1" y2="0.14">
              <stop offset="0%" style={{ stopColor: stops.a }} />
              <stop offset="46%" style={{ stopColor: stops.mid }} />
              <stop offset="100%" style={{ stopColor: stops.b }} />
            </linearGradient>
          );
        })}
      </defs>
      {blobs.map((b) => {
        const classNames = ["hl-blob"];
        if (b.sweep) classNames.push("hl-sweep");
        if (b.fading) classNames.push("hl-fade-out");
        if (b.dimmed) classNames.push("hl-dimmed");
        return (
          <path
            key={b.key}
            d={b.path}
            fill={`url(#hl-grad-${b.color})`}
            className={classNames.join(" ")}
            data-highlight-color={b.color}
          />
        );
      })}
    </svg>
  );
}
