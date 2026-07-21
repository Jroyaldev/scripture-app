import type { RouteRect } from "../../core/annotations/route-engine.js";

/** The approved trace grammar has one fixed center datum. Selection changes
 * stroke width symmetrically around this line; it never moves the geometry. */
export const CONNECTION_UNDERLINE_HEIGHT = 1.5;
export const CONNECTION_UNDERLINE_CENTER_OFFSET = CONNECTION_UNDERLINE_HEIGHT / 2;
export const CONNECTION_UNDERLINE_QUIET_STROKE = 1;
export const CONNECTION_UNDERLINE_SELECTED_STROKE = CONNECTION_UNDERLINE_HEIGHT;
export const CONNECTION_ROUTE_QUIET_STROKE = 1.25;
export const CONNECTION_ROUTE_SELECTED_STROKE = CONNECTION_UNDERLINE_HEIGHT;
export const CONNECTION_UNDERLINE_LEVEL_GAP = 3;

export interface ConnectionInkSlack {
  top: number;
  bottom: number;
}

const ZERO_INK_SLACK: ConnectionInkSlack = { top: 0, bottom: 0 };
const inkSlackCache = new Map<string, ConnectionInkSlack>();
let metricsCanvas: HTMLCanvasElement | null = null;

function finiteMetric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Measure the line-box air above and below actual glyph ink. The cache key is
 * the complete computed font identity: the CSS family string alone does not
 * change when a webfont replaces its fallback, so font-settlement events must
 * explicitly clear this cache.
 */
export function connectionInkSlackFor(element: Element): ConnectionInkSlack {
  const style = getComputedStyle(element);
  const key = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontStretch,
    style.fontSize,
    style.fontFamily,
  ].join("|");
  const cached = inkSlackCache.get(key);
  if (cached) return cached;

  metricsCanvas ??= document.createElement("canvas");
  const context = metricsCanvas.getContext("2d");
  if (!context) return ZERO_INK_SLACK;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const metrics = context.measureText("Mahglpqy");
  const fontAscent = finiteMetric(metrics.fontBoundingBoxAscent);
  const actualAscent = finiteMetric(metrics.actualBoundingBoxAscent);
  const fontDescent = finiteMetric(metrics.fontBoundingBoxDescent);
  const actualDescent = finiteMetric(metrics.actualBoundingBoxDescent);
  const measured = {
    top: fontAscent == null || actualAscent == null ? 0 : Math.max(0, fontAscent - actualAscent),
    bottom: fontDescent == null || actualDescent == null ? 0 : Math.max(0, fontDescent - actualDescent),
  };
  inkSlackCache.set(key, measured);
  return measured;
}

export function clearConnectionFontMetricCache(): void {
  inkSlackCache.clear();
}

export function rawOverlayRect(rect: DOMRect, base: DOMRect, id?: string): RouteRect & { id?: string } {
  return {
    left: rect.left - base.left,
    right: rect.right - base.left,
    top: rect.top - base.top,
    bottom: rect.bottom - base.top,
    ...(id ? { id } : {}),
  };
}

export function inkTightOverlayRect(
  rect: DOMRect,
  base: DOMRect,
  slack: ConnectionInkSlack,
  id?: string,
): RouteRect & { id?: string } {
  const raw = rawOverlayRect(rect, base, id);
  return {
    ...raw,
    top: raw.top + slack.top,
    bottom: raw.bottom - slack.bottom,
  };
}

export function connectionUnderlineCenter(rawBottom: number, level = 0): number {
  return rawBottom - CONNECTION_UNDERLINE_CENTER_OFFSET - Math.max(0, level) * CONNECTION_UNDERLINE_LEVEL_GAP;
}

export function connectionUnderlineDy(bottomSlack: number, level = 0): number {
  return bottomSlack - CONNECTION_UNDERLINE_CENTER_OFFSET - Math.max(0, level) * CONNECTION_UNDERLINE_LEVEL_GAP;
}
