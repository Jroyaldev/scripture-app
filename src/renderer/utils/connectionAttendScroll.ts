/**
 * Rev 04 §5: "Attending happens three ways and is one behaviour: clicking a
 * member, its gutter tick, or its row in the Connections tab. All three scroll
 * the least distance that brings every member into view."
 *
 * Three verbs, one behaviour, so the scroll is computed once here and every
 * caller uses the same answer. Two things follow from "the least distance":
 *
 *   - A connection already wholly on screen does not scroll at all. Attending
 *     something you can already see must not move the page under your eye.
 *   - When it must move, it moves by the smallest delta that lands every
 *     member inside the viewport — not to a centre, not to an eye-line. A
 *     member below the fold is the real case Rev 04 §8 keeps ("the departure
 *     row… the real case is a member below the fold, which is a scroll
 *     problem"), and this is that scroll.
 *
 * When the members span more than the viewport there is no delta that shows
 * them all, so the least-wrong thing is to show the first: align the span's
 * top with the viewport's top and let the reader scroll on.
 */

export interface AttendScrollInput {
  /** Current scroll offset of the reading container. */
  scrollTop: number;
  /** Visible height of the reading container. */
  viewportHeight: number;
  /** Top of the union of every member, in the same space as scrollTop. */
  spanTop: number;
  /** Bottom of the union of every member, in the same space as scrollTop. */
  spanBottom: number;
  /** Largest legal scroll offset; the delta never proposes past it. */
  maxScrollTop: number;
  /**
   * Air kept between a member and the viewport edge it was brought in from, so
   * an underline never lands flush against the fold.
   */
  margin?: number;
}

/* @quire derived · kin: reading canvas · 24px is the top of §9's 4–24 space
   scale, and matches the interval the canvas already uses to separate panes. */
const DEFAULT_ATTEND_MARGIN = 24;

/**
 * The least scrollTop that brings [spanTop, spanBottom] into view, or the
 * current one when nothing needs to move.
 */
export function leastScrollForMembers(input: AttendScrollInput): number {
  const {
    scrollTop,
    viewportHeight,
    spanTop,
    spanBottom,
    maxScrollTop,
    margin = DEFAULT_ATTEND_MARGIN,
  } = input;
  if (!Number.isFinite(spanTop) || !Number.isFinite(spanBottom)) return scrollTop;
  if (viewportHeight <= 0) return scrollTop;

  const clamp = (value: number): number => Math.max(0, Math.min(Math.max(0, maxScrollTop), value));
  const span = spanBottom - spanTop;

  // Taller than the viewport: no offset shows every member, so show the first.
  if (span + margin * 2 > viewportHeight) return clamp(spanTop - margin);

  const visibleTop = scrollTop + margin;
  const visibleBottom = scrollTop + viewportHeight - margin;
  // Already whole on screen — attending must not move the page.
  if (spanTop >= visibleTop && spanBottom <= visibleBottom) return scrollTop;
  // Otherwise close the smaller of the two gaps; only one can be open, because
  // the span is known to fit.
  if (spanTop < visibleTop) return clamp(spanTop - margin);
  return clamp(spanBottom + margin - viewportHeight);
}

/** The union of every measured member rect, or null when none measured. */
export function memberSpan(
  rects: readonly { top: number; bottom: number }[],
): { top: number; bottom: number } | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
    if (rect.top < top) top = rect.top;
    if (rect.bottom > bottom) bottom = rect.bottom;
  }
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}
