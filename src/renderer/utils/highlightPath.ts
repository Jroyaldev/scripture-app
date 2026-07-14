/*
 * highlightPath.ts — geometry for the SVG highlight underlay.
 *
 * A multiline highlight is measured as one rect per visual line (via
 * Range.getClientRects on the verse text span). CSS can round each line's box,
 * but it cannot join changing line widths without making stacked pills. This
 * module traces the stack as one SVG path: broad exterior caps and compact,
 * lightly eased steps wherever the text rag changes. Exterior shape remains
 * generous while internal junctions stay quiet enough to disappear at normal
 * reading scale.
 *
 * The module is pure: no DOM access. Callers measure and pass rects in any
 * order (sorted here by y0). Output is an SVG `d` string ready for <path>.
 */

export interface LineRect {
  /** left */
  x0: number;
  /** top */
  y0: number;
  /** right */
  x1: number;
  /** bottom */
  y1: number;
}

/**
 * Build the union path of a stack of horizontal line rects.
 *
 * @param rects   one rect per visual line; sorted here by y0 then x0
 * @param radius  corner radius in px; clamped per-corner to fit short edges
 * @returns       SVG path `d` string, or "" for empty input
 */
// Two consecutive lines within this many px of the same width are treated as
// equal. Real getClientRects() output routinely differs by a sub-pixel-to-
// low-single-digit fraction between visually-identical-width wrapped lines
// (font hinting/kerning jitter), which without a tolerance produces a
// spurious, near-sharp corner-pair at a junction that should read as a dead
// straight edge (the radius clamp in roundCorners collapses toward 0 for a
// junction whose step distance is tiny).
const WIDTH_EPSILON = 1.5;

/**
 * Coalesce duplicate/overlapping DOM rects that belong to the same visual text
 * line. Restored or legacy data can contain multiple records covering the same
 * characters; feeding those duplicate rects into the outline tracer creates
 * zero-height steps and tiny spikes. The visual union should contain one clean
 * band per line regardless of record count.
 */
export function mergeHighlightLineRects(rects: LineRect[], tolerance = 1.5): LineRect[] {
  const sorted = [...rects].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const merged: LineRect[] = [];
  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    const sameLine = previous &&
      Math.abs(previous.y0 - rect.y0) <= tolerance &&
      Math.abs(previous.y1 - rect.y1) <= tolerance;
    const horizontallyConnected = previous && rect.x0 <= previous.x1 + tolerance;
    if (previous && sameLine && horizontallyConnected) {
      previous.x0 = Math.min(previous.x0, rect.x0);
      previous.y0 = Math.min(previous.y0, rect.y0);
      previous.x1 = Math.max(previous.x1, rect.x1);
      previous.y1 = Math.max(previous.y1, rect.y1);
    } else {
      merged.push({ ...rect });
    }
  }
  return merged;
}

export interface HighlightPathJoins {
  /** Share the first line's left edge with the preceding color. */
  joinInitialLeft?: boolean;
  /** Share the last line's right edge with the following color. */
  joinTerminalRight?: boolean;
  /** Share the first line's top edge with the preceding stacked color. */
  joinInitialTop?: boolean;
  /** Share the last line's bottom edge with the following stacked color. */
  joinTerminalBottom?: boolean;
  /** Horizontal drift across a same-line color seam. Both colors receive the
   * same value, so they remain perfectly tessellated rather than overlapping. */
  seamLean?: number;
  /** Tiny easing used only at internal text-wrap steps. */
  junctionRadius?: number;
}

const DEFAULT_SEAM_LEAN = 1;
const DEFAULT_JUNCTION_RADIUS = 1.5;

/**
 * Trace a soft marker silhouette around measured text lines.
 *
 * Exterior corners use broad quadratic caps. Internal width changes retain a
 * legible step, but ease each turn within roughly 1.5px. This is deliberately
 * much tighter than the outer radius: using the same generous radius inside
 * produced visible nubs, while broad S-curves made the wash look sculpted.
 */
export function buildHighlightPath(rects: LineRect[], radius = 5, joins: HighlightPathJoins = {}): string {
  if (rects.length === 0) return "";
  const sorted = [...rects].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const n = sorted.length;
  const outerRadius = Math.max(0, radius);
  const seamLean = Math.max(0, joins.seamLean ?? DEFAULT_SEAM_LEAN);
  const junctionRadius = Math.max(0, joins.junctionRadius ?? DEFAULT_JUNCTION_RADIUS);

  const cornerRadius = (rect: LineRect): number => Math.min(
    outerRadius,
    Math.max(0, (rect.x1 - rect.x0) / 2),
    Math.max(0, (rect.y1 - rect.y0) / 2),
  );
  const verticalJoinX = (rect: LineRect, y: number, baseX: number, joined: boolean): number => {
    if (!joined || rect.y1 <= rect.y0) return baseX;
    const progress = Math.max(0, Math.min(1, (y - rect.y0) / (rect.y1 - rect.y0)));
    return baseX + seamLean * (progress * 2 - 1);
  };
  const leftX = (index: number, y: number): number => verticalJoinX(
    sorted[index]!,
    y,
    sorted[index]!.x0,
    joins.joinInitialLeft === true && index === 0,
  );
  const rightX = (index: number, y: number): number => verticalJoinX(
    sorted[index]!,
    y,
    sorted[index]!.x1,
    joins.joinTerminalRight === true && index === n - 1,
  );
  const junction = (a: LineRect, b: LineRect, delta: number): number => {
    const available = Math.max(0, Math.min(
      (a.y1 - a.y0) / 4,
      (b.y1 - b.y0) / 4,
      Math.abs(delta) / 2,
    ));
    return Math.min(junctionRadius, available);
  };

  const first = sorted[0]!;
  const last = sorted[n - 1]!;
  const top = first.y0;
  const bottom = last.y1;
  const topLeftRadius = joins.joinInitialLeft || joins.joinInitialTop ? 0 : cornerRadius(first);
  const topRightRadius = joins.joinInitialTop || (joins.joinTerminalRight && n === 1) ? 0 : cornerRadius(first);
  const bottomRightRadius = joins.joinTerminalRight || joins.joinTerminalBottom ? 0 : cornerRadius(last);
  const bottomLeftRadius = joins.joinTerminalBottom || (joins.joinInitialLeft && n === 1) ? 0 : cornerRadius(last);

  let d = `M${fmt(leftX(0, top) + topLeftRadius)},${fmt(top)}`;
  d += `L${fmt(rightX(0, top) - topRightRadius)},${fmt(top)}`;
  if (topRightRadius > 0) {
    d += `Q${fmt(first.x1)},${fmt(top)} ${fmt(first.x1)},${fmt(top + topRightRadius)}`;
  }

  // Trace the right side from top to bottom. The natural text rag remains a
  // step; only the two turns receive a compact quadratic ease.
  for (let i = 0; i < n - 1; i++) {
    const upper = sorted[i]!;
    const lower = sorted[i + 1]!;
    const seam = (upper.y1 + lower.y0) / 2;
    const delta = lower.x1 - upper.x1;
    if (Math.abs(delta) <= WIDTH_EPSILON) {
      d += `L${fmt(rightX(i + 1, seam))},${fmt(seam)}`;
    } else {
      const r = junction(upper, lower, delta);
      const direction = Math.sign(delta);
      const upperAtSeam = rightX(i, seam);
      const lowerAtSeam = rightX(i + 1, seam);
      d += `L${fmt(rightX(i, seam - r))},${fmt(seam - r)}`;
      d += `Q${fmt(upperAtSeam)},${fmt(seam)} ${fmt(upperAtSeam + direction * r)},${fmt(seam)}`;
      d += `L${fmt(lowerAtSeam - direction * r)},${fmt(seam)}`;
      d += `Q${fmt(lowerAtSeam)},${fmt(seam)} ${fmt(rightX(i + 1, seam + r))},${fmt(seam + r)}`;
    }
  }

  d += `L${fmt(rightX(n - 1, bottom - bottomRightRadius))},${fmt(bottom - bottomRightRadius)}`;
  if (bottomRightRadius > 0) {
    d += `Q${fmt(last.x1)},${fmt(bottom)} ${fmt(last.x1 - bottomRightRadius)},${fmt(bottom)}`;
  } else {
    d += `L${fmt(rightX(n - 1, bottom))},${fmt(bottom)}`;
  }

  d += `L${fmt(leftX(n - 1, bottom) + bottomLeftRadius)},${fmt(bottom)}`;
  if (bottomLeftRadius > 0) {
    d += `Q${fmt(last.x0)},${fmt(bottom)} ${fmt(last.x0)},${fmt(bottom - bottomLeftRadius)}`;
  }

  // Mirror the compact step construction up the left side.
  for (let i = n - 2; i >= 0; i--) {
    const upper = sorted[i]!;
    const lower = sorted[i + 1]!;
    const seam = (upper.y1 + lower.y0) / 2;
    const delta = upper.x0 - lower.x0;
    if (Math.abs(delta) <= WIDTH_EPSILON) {
      d += `L${fmt(leftX(i, seam))},${fmt(seam)}`;
    } else {
      const r = junction(upper, lower, delta);
      const direction = Math.sign(delta);
      const lowerAtSeam = leftX(i + 1, seam);
      const upperAtSeam = leftX(i, seam);
      d += `L${fmt(leftX(i + 1, seam + r))},${fmt(seam + r)}`;
      d += `Q${fmt(lowerAtSeam)},${fmt(seam)} ${fmt(lowerAtSeam + direction * r)},${fmt(seam)}`;
      d += `L${fmt(upperAtSeam - direction * r)},${fmt(seam)}`;
      d += `Q${fmt(upperAtSeam)},${fmt(seam)} ${fmt(leftX(i, seam - r))},${fmt(seam - r)}`;
    }
  }

  d += `L${fmt(leftX(0, top + topLeftRadius))},${fmt(top + topLeftRadius)}`;
  if (topLeftRadius > 0) {
    d += `Q${fmt(first.x0)},${fmt(top)} ${fmt(first.x0 + topLeftRadius)},${fmt(top)}`;
  } else {
    d += `L${fmt(leftX(0, top))},${fmt(top)}`;
  }
  return d + "Z";
}

function fmt(n: number): string {
  // Round to 2 decimals and strip trailing zeros for compact path output.
  return (Math.round(n * 100) / 100).toString();
}
