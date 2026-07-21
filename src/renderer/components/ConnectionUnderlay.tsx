import type React from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type ConnectionKind,
  type ConnectionRecord,
} from "../../core/annotations/types.js";
import type { ConnectionDraftModel } from "./MarkingSurface.js";
import type {
  ConnectionPaintAnchor,
  ConnectionPaintProjection,
} from "../utils/connectionPaint.js";
import {
  planRoute,
  type RouteAnnotation,
  type RouteBlock,
  type RouteCorridorClaim,
  type RoutePoint,
  type RouteRect,
  type RouteSegment,
  type RouteSide,
  type RouteSpineClaim,
  type RouteStrandClaim,
} from "../../core/annotations/route-engine.js";
import {
  CONNECTION_ROUTE_QUIET_STROKE,
  CONNECTION_ROUTE_SELECTED_STROKE,
  CONNECTION_UNDERLINE_QUIET_STROKE,
  CONNECTION_UNDERLINE_SELECTED_STROKE,
  clearConnectionFontMetricCache,
  connectionInkSlackFor,
  connectionUnderlineCenter,
  connectionUnderlineDy,
  inkTightOverlayRect,
  rawOverlayRect,
  type ConnectionInkSlack,
} from "../utils/connectionGeometry.js";
import { buildHighlightPath, mergeHighlightLineRects, type LineRect } from "../utils/highlightPath.js";
import {
  connectionRowLayoutSignature,
  encodeConnectionTickMemberIds,
  planConnectionTickLanes,
  reconcileConnectionRows,
  type ConnectionRowLayoutInput,
  type ConnectionRowLayoutMeasurement,
} from "../utils/connectionRowLayout.js";
import { isTopLayer, useLayer } from "../layerStack.js";
import { locateTextOffset } from "../utils/textOffsets.js";
import { phraseCount } from "../utils/relationshipVocabulary.js";
import { useUnderlayMeasurementLifecycle } from "../utils/useUnderlayMeasurementLifecycle.js";

interface PaintedUnderline {
  path: string;
  anchorIndex: number;
  lineIndex: number;
  centerY: number;
  left: number;
  right: number;
}

interface PaintedEmphasis {
  path: string;
  routePath: string;
  bands: LineRect[];
  anchorIndex: number;
}

interface PaintedConnection {
  connection: ConnectionPaintRecord;
  valid: boolean;
  reason: string | null;
  routePath: string;
  underlines: PaintedUnderline[];
  emphases: PaintedEmphasis[];
  contacts: RoutePoint[];
  side: string | null;
  focusY: number;
}

/**
 * Geometry input only. Renderer-authored previews deliberately cannot carry a
 * durable format version, event version, or substrate identity. Queried
 * ConnectionRecords are adapted into the durable arm solely so tick actions
 * can hand the original record back to ScripturePage.
 */
type ConnectionPaintRecord =
  | {
      source: "durable";
      id: string;
      kind: ConnectionKind;
      label: string;
      anchors: readonly ConnectionPaintAnchor[];
      durableRecord: ConnectionRecord;
    }
  | {
      source: "authoring" | "selection";
      id: string;
      kind: ConnectionKind;
      label: string;
      anchors: readonly ConnectionPaintAnchor[];
    };

function isDurablePaintRecord(
  record: ConnectionPaintRecord,
): record is Extract<ConnectionPaintRecord, { source: "durable" }> {
  return record.source === "durable";
}

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  connections: ConnectionRecord[];
  paintProjections: ReadonlyMap<string, ConnectionPaintProjection>;
  draftConnection?: ConnectionDraftModel | null;
  /**
   * Renderer-only exact words that currently belong to a marking surface.
   * They receive one merged neutral wash, but can never plan a connector,
   * create a tick, or cross the authored-event boundary.
   */
  selectionEmphasis?: {
    nonce: number;
    anchors: readonly ConnectionPaintAnchor[];
  } | null;
  book: string;
  chapter: number;
  packageId: string;
  /** Identity of the rendered prose payload; equal-size text replacements must remeasure. */
  contentRevision: unknown;
  themeToken: unknown;
  focusMode: boolean;
  selectedConnectionId: string | null;
  heldConnectionIds: readonly string[];
  /** Exact aggregate tick membership whose chooser is currently mounted. */
  openTickGroupMemberIds: readonly string[] | null;
  onSelectConnection: (connection: ConnectionRecord | null, focusInspector?: boolean) => void;
  /** Dismiss the focused relationship shape without releasing its hold. */
  onDismissFocus: () => void;
  onChooseConnections: (
    connections: readonly ConnectionRecord[],
    anchorRect: DOMRect,
    origin: HTMLButtonElement,
  ) => void;
  wordHitTestRef?: React.MutableRefObject<ConnectionWordHitTest | null>;
}

export interface ConnectionWordHit {
  connection: ConnectionRecord;
  area: number;
}

export type ConnectionWordHitTest = (
  clientX: number,
  clientY: number,
) => readonly ConnectionWordHit[];

interface UnderlaySize {
  width: number;
  height: number;
}

interface MeasuredAnchorFragment {
  routeRect: RouteRect;
  rawRect: RouteRect;
  emphasisRect: RouteRect;
  underlineCenterY: number;
  exact: boolean;
  verse: number;
  localRawRect: RouteRect;
}

interface VerseRowGeometry {
  wordRuns: RouteRect[];
  verseNumberRects: RouteRect[];
}

interface LayoutCache {
  container: HTMLDivElement;
  contextKey: string;
  signature: string;
  block: RouteBlock;
  anchorFragments: Map<string, MeasuredAnchorFragment[]>;
  rows: Map<number, ConnectionRowLayoutMeasurement<HTMLDivElement, VerseRowGeometry>>;
  inkSlack: ConnectionInkSlack;
  fontSize: number;
}

export interface ConnectionLayoutSignatureParts {
  contextKey: string;
  containerWidth: number;
  containerHeight: number;
  stageWidth: number;
  stageHeight: number;
  leftInset: number;
  rightInset: number;
  verseRowCount: number;
  rowGeometry: string;
  fontSize: string;
  lineHeight: string;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: string;
  wordSpacing: string;
  textIndent: string;
  direction: string;
}

const EMPTY_UNDERLAY_SIZE: UnderlaySize = { width: 0, height: 0 };
// Presence paint should read as pigment stitched to the words, not a stack of
// rounded UI pills. A hair of breathing room keeps glyph overshoots covered
// while preserving the lab's phrase-hugging silhouette.
const EMPHASIS_PAD_X = 1;
const EMPHASIS_PAD_Y = 0.35;
const EMPHASIS_RADIUS = 2.5;
const PREVIEW_ENTER_MS = 140;
const PREVIEW_LEAVE_MS = 140;
const CONNECTION_AUTHORING_DRAFT_ID = "__connection-authoring-draft__";
const MARKING_SELECTION_EMPHASIS_PREFIX = "__marking-selection-emphasis__:";

function signatureNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : String(value);
}

/** Viewport top/left are deliberately absent: scrolling translates both the
 * measured prose and its base equally, so their relative route geometry stays
 * valid while anchors are refreshed against the new viewport position. */
export function connectionLayoutSignature(parts: ConnectionLayoutSignatureParts): string {
  return [
    parts.contextKey,
    signatureNumber(parts.containerWidth),
    signatureNumber(parts.containerHeight),
    signatureNumber(parts.stageWidth),
    signatureNumber(parts.stageHeight),
    signatureNumber(parts.leftInset),
    signatureNumber(parts.rightInset),
    String(parts.verseRowCount),
    parts.rowGeometry,
    parts.fontSize,
    parts.lineHeight,
    parts.fontFamily,
    parts.fontWeight,
    parts.fontStyle,
    parts.letterSpacing,
    parts.wordSpacing,
    parts.textIndent,
    parts.direction,
  ].join("\u001f");
}

function relativeRectSignature(rect: DOMRect | null, rowBounds: DOMRect): string {
  if (!rect) return "none";
  return [
    rect.left - rowBounds.left,
    rect.right - rowBounds.left,
    rect.top - rowBounds.top,
    rect.bottom - rowBounds.top,
  ].map(signatureNumber).join(",");
}

function connectionRowInputs(
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>,
  fontRevision: number,
): ConnectionRowLayoutInput<HTMLDivElement>[] {
  return [...verseRowRefs.current.entries()]
    .sort(([left], [right]) => left - right)
    .map(([verse, row]) => {
      const rowBounds = row.getBoundingClientRect();
      const textSpan = row.querySelector<HTMLElement>(".verse-text-span");
      const number = row.querySelector<HTMLElement>(".verse-num");
      const textBounds = textSpan?.getBoundingClientRect() ?? null;
      const numberBounds = number?.getBoundingClientRect() ?? null;
      const style = getComputedStyle(textSpan ?? row);
      // Viewport position is intentionally absent. It is legal for every row
      // below one reflowed verse to translate without changing its local glyph
      // geometry; those rows are reprojected, not Range-measured again.
      const signature = connectionRowLayoutSignature({
        verse,
        width: signatureNumber(rowBounds.width),
        height: signatureNumber(rowBounds.height),
        textBox: relativeRectSignature(textBounds, rowBounds),
        numberBox: relativeRectSignature(numberBounds, rowBounds),
        text: textSpan?.textContent ?? "",
        font: style.font,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        wordSpacing: style.wordSpacing,
        textIndent: style.textIndent,
        textTransform: style.textTransform,
        direction: style.direction,
        whiteSpace: style.whiteSpace,
        fontKerning: style.fontKerning,
        fontFeatureSettings: style.fontFeatureSettings,
        fontVariationSettings: style.fontVariationSettings,
        fontRevision,
      });
      return { verse, element: row, signature };
    });
}

function measureVerseRowGeometry(
  input: ConnectionRowLayoutInput<HTMLDivElement>,
  inkSlack: ConnectionInkSlack,
): VerseRowGeometry {
  const row = input.element;
  const rowBounds = row.getBoundingClientRect();
  const textSpan = row.querySelector<HTMLElement>(".verse-text-span");
  const measuredWordRuns: RouteRect[] = [];
  if (textSpan) {
    const range = document.createRange();
    const walker = document.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const words = /\S+/g;
      let match = words.exec(text);
      while (match) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0.5 && rect.height > 1) {
            measuredWordRuns.push(inkTightOverlayRect(rect, rowBounds, inkSlack));
          }
        }
        match = words.exec(text);
      }
      node = walker.nextNode();
    }
  }
  const verseNumberRects = Array.from(row.querySelectorAll<HTMLElement>(".verse-num"))
    .map((element) => rawOverlayRect(element.getBoundingClientRect(), rowBounds))
    .filter((rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 1);
  return { wordRuns: measuredWordRuns, verseNumberRects };
}

function projectRowRect(rect: RouteRect, rowBounds: DOMRect, base: DOMRect): RouteRect {
  const x = rowBounds.left - base.left;
  const y = rowBounds.top - base.top;
  return {
    left: rect.left + x,
    right: rect.right + x,
    top: rect.top + y,
    bottom: rect.bottom + y,
  };
}

/**
 * Claim order is visual priority: focused inspector, user-held companions in
 * their authored hold order, then the quiet field by durable id. Build fresh
 * partitions instead of sorting the caller's array so selection never mutates
 * the event-derived input order.
 */
export function orderActiveConnections<T extends Pick<ConnectionPaintRecord, "id" | "anchors">>(
  connections: readonly T[],
  book: string,
  chapter: number,
  selectedConnectionId: string | null,
  heldConnectionIds: readonly string[] = [],
): T[] {
  const active = connections.filter((connection) =>
    connection.anchors.some((anchor) => anchor.book === book && anchor.chapter === chapter));
  const activeById = new Map(active.map((connection) => [connection.id, connection]));
  const claimed = new Set<string>();
  const ordered: T[] = [];
  const append = (connection: T | undefined): void => {
    if (!connection || claimed.has(connection.id)) return;
    claimed.add(connection.id);
    ordered.push(connection);
  };

  append(selectedConnectionId ? activeById.get(selectedConnectionId) : undefined);
  for (const connectionId of heldConnectionIds) append(activeById.get(connectionId));
  const quiet = active
    .filter((connection) => !claimed.has(connection.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  return [...ordered, ...quiet];
}

/** Tick tab order follows measured reading order, not SVG paint priority. */
export function orderConnectionTicks<T extends { connection: { id: string }; focusY: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort((left, right) =>
    left.focusY - right.focusY || left.connection.id.localeCompare(right.connection.id));
}

function mergeRenderedLines(wordRuns: RouteRect[]): RouteRect[] {
  const sorted = [...wordRuns].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: RouteRect[] = [];
  for (const run of sorted) {
    const center = (run.top + run.bottom) / 2;
    const line = lines.find((candidate) => Math.abs((candidate.top + candidate.bottom) / 2 - center) < 2.5);
    if (!line) {
      lines.push({ ...run });
      continue;
    }
    line.left = Math.min(line.left, run.left);
    line.right = Math.max(line.right, run.right);
    line.top = Math.min(line.top, run.top);
    line.bottom = Math.max(line.bottom, run.bottom);
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

function mergeUnderlineFragments(
  fragments: readonly MeasuredAnchorFragment[],
  anchorIndex: number,
): PaintedUnderline[] {
  const lines: Array<{ left: number; right: number; centerY: number }> = [];
  for (const fragment of fragments) {
    const existing = lines.find((line) => Math.abs(line.centerY - fragment.underlineCenterY) < 2.5);
    if (!existing) {
      lines.push({
        left: fragment.rawRect.left,
        right: fragment.rawRect.right,
        centerY: fragment.underlineCenterY,
      });
      continue;
    }
    existing.left = Math.min(existing.left, fragment.rawRect.left);
    existing.right = Math.max(existing.right, fragment.rawRect.right);
  }
  return lines
    .sort((left, right) => left.centerY - right.centerY || left.left - right.left)
    .map((line, lineIndex) => ({
      path: `M ${line.left.toFixed(2)} ${line.centerY.toFixed(2)} H ${line.right.toFixed(2)}`,
      anchorIndex,
      lineIndex,
      centerY: line.centerY,
      left: line.left,
      right: line.right,
    }));
}

function emphasisPaintForFragments(
  fragments: readonly MeasuredAnchorFragment[],
  coordinateFrame: "emphasis" | "route",
): { path: string; bands: LineRect[] } {
  const exactRects: LineRect[] = fragments
    .filter((fragment) => fragment.exact)
    .map((fragment) => {
      const rect = coordinateFrame === "emphasis" ? fragment.emphasisRect : fragment.rawRect;
      return {
        x0: rect.left - EMPHASIS_PAD_X,
        y0: rect.top - EMPHASIS_PAD_Y,
        x1: rect.right + EMPHASIS_PAD_X,
        y1: rect.bottom + EMPHASIS_PAD_Y,
      };
    });
  const bands = mergeHighlightLineRects(exactRects, 2);
  for (let index = 0; index < bands.length - 1; index++) {
    const seam = (bands[index]!.y1 + bands[index + 1]!.y0) / 2;
    bands[index]!.y1 = seam;
    bands[index + 1]!.y0 = seam;
  }
  return {
    path: buildHighlightPath(bands, EMPHASIS_RADIUS, { junctionRadius: 1.5 }),
    bands,
  };
}

interface SharedEmphasisPaint {
  key: string;
  path: string;
}

function sharedEmphasisPaint(painted: readonly PaintedConnection[]): SharedEmphasisPaint[] {
  const shared: SharedEmphasisPaint[] = [];
  for (let leftIndex = 0; leftIndex < painted.length; leftIndex++) {
    const left = painted[leftIndex]!;
    const leftBands = left.emphases.flatMap((emphasis) => emphasis.bands);
    if (leftBands.length === 0) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < painted.length; rightIndex++) {
      const right = painted[rightIndex]!;
      const rightBands = right.emphases.flatMap((emphasis) => emphasis.bands);
      const intersections: LineRect[] = [];
      for (const leftBand of leftBands) {
        for (const rightBand of rightBands) {
          const x0 = Math.max(leftBand.x0, rightBand.x0);
          const x1 = Math.min(leftBand.x1, rightBand.x1);
          const y0 = Math.max(leftBand.y0, rightBand.y0);
          const y1 = Math.min(leftBand.y1, rightBand.y1);
          if (x1 - x0 > 1 && y1 - y0 > 2) intersections.push({ x0, y0, x1, y1 });
        }
      }
      const bands = mergeHighlightLineRects(intersections, 2);
      if (bands.length === 0) continue;
      const runs: LineRect[][] = [];
      for (const band of bands) {
        const run = runs[runs.length - 1];
        const previous = run?.[run.length - 1];
        const sameLine = previous != null
          && Math.abs((previous.y0 + previous.y1) / 2 - (band.y0 + band.y1) / 2) < 2.5;
        const connected = previous != null && (
          (!sameLine && band.y0 - previous.y1 < 8)
          || (sameLine && band.x0 <= previous.x1 + 2)
        );
        if (!run || !connected) runs.push([{ ...band }]);
        else run.push({ ...band });
      }
      runs.forEach((run, runIndex) => {
        for (let index = 0; index < run.length - 1; index++) {
          const seam = (run[index]!.y1 + run[index + 1]!.y0) / 2;
          run[index]!.y1 = seam;
          run[index + 1]!.y0 = seam;
        }
        shared.push({
          key: `${left.connection.id}:${right.connection.id}:${runIndex}`,
          path: buildHighlightPath(run, EMPHASIS_RADIUS, { junctionRadius: 1.5 }),
        });
      });
    }
  }
  return [...new Map(shared.map((item) => [item.path, item])).values()];
}

function segmentPath(segments: RouteSegment[]): string {
  if (segments.length === 0) return "";
  let path = "";
  let lastX: number | null = null;
  let lastY: number | null = null;
  for (const segment of segments) {
    if (lastX == null || lastY == null || Math.abs(lastX - segment.x1) > 0.1 || Math.abs(lastY - segment.y1) > 0.1) {
      path += `${path ? " " : ""}M ${segment.x1.toFixed(2)} ${segment.y1.toFixed(2)}`;
    }
    if (segment.type === "L") {
      path += ` L ${segment.x2.toFixed(2)} ${segment.y2.toFixed(2)}`;
    } else {
      path += ` C ${segment.c1x.toFixed(2)} ${segment.c1y.toFixed(2)} ${segment.c2x.toFixed(2)} ${segment.c2y.toFixed(2)} ${segment.x2.toFixed(2)} ${segment.y2.toFixed(2)}`;
    }
    lastX = segment.x2;
    lastY = segment.y2;
  }
  return path;
}

function samePoints(left: RoutePoint[], right: RoutePoint[]): boolean {
  return left.length === right.length
    && left.every((point, index) => point.x === right[index]?.x && point.y === right[index]?.y);
}

function sameUnderlines(left: PaintedUnderline[], right: PaintedUnderline[]): boolean {
  return left.length === right.length && left.every((underline, index) => {
    const candidate = right[index];
    return candidate != null
      && underline.path === candidate.path
      && underline.anchorIndex === candidate.anchorIndex
      && underline.lineIndex === candidate.lineIndex
      && underline.centerY === candidate.centerY
      && underline.left === candidate.left
      && underline.right === candidate.right;
  });
}

function sameEmphases(left: PaintedEmphasis[], right: PaintedEmphasis[]): boolean {
  return left.length === right.length && left.every((emphasis, index) => {
    const candidate = right[index];
    return candidate != null
      && emphasis.path === candidate.path
      && emphasis.routePath === candidate.routePath
      && emphasis.bands.length === candidate.bands.length
      && emphasis.bands.every((band, bandIndex) => {
        const next = candidate.bands[bandIndex];
        return next != null
          && band.x0 === next.x0 && band.y0 === next.y0
          && band.x1 === next.x1 && band.y1 === next.y1;
      })
      && emphasis.anchorIndex === candidate.anchorIndex;
  });
}

function samePaintedConnections(left: PaintedConnection[], right: PaintedConnection[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const candidate = right[index];
    return candidate != null
      && item.connection === candidate.connection
      && item.valid === candidate.valid
      && item.reason === candidate.reason
      && item.routePath === candidate.routePath
      && sameUnderlines(item.underlines, candidate.underlines)
      && sameEmphases(item.emphases, candidate.emphases)
      && samePoints(item.contacts, candidate.contacts)
      && item.side === candidate.side
      && item.focusY === candidate.focusY;
  });
}

function sameUnderlaySize(
  left: UnderlaySize,
  right: UnderlaySize,
): boolean {
  return left.width === right.width
    && left.height === right.height;
}

function verseRowGeometrySignature(
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>,
  containerBounds: DOMRect,
): string {
  let firstVerse = Number.POSITIVE_INFINITY;
  let lastVerse = Number.NEGATIVE_INFINITY;
  let firstRow: HTMLDivElement | null = null;
  let lastRow: HTMLDivElement | null = null;
  for (const [verse, row] of verseRowRefs.current) {
    if (verse < firstVerse) {
      firstVerse = verse;
      firstRow = row;
    }
    if (verse > lastVerse) {
      lastVerse = verse;
      lastRow = row;
    }
  }
  const relative = (row: HTMLDivElement | null): string => {
    if (!row) return "none";
    const rect = row.getBoundingClientRect();
    return [
      rect.left - containerBounds.left,
      rect.right - containerBounds.left,
      rect.top - containerBounds.top,
      rect.bottom - containerBounds.top,
    ].map(signatureNumber).join(",");
  };
  return `${relative(firstRow)}:${relative(lastRow)}`;
}

function rangeRectsForAnchor(
  connection: ConnectionPaintRecord,
  anchorIndex: number,
  routeOverlayRect: DOMRect,
  emphasisOverlayRect: DOMRect,
  inkSlack: ConnectionInkSlack,
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>,
  chapter: number,
): MeasuredAnchorFragment[] {
  const anchor = connection.anchors[anchorIndex];
  if (!anchor || anchor.chapter !== chapter) return [];
  const fragments: MeasuredAnchorFragment[] = [];
  const measureRect = (
    rect: DOMRect,
    rowBounds: DOMRect,
    verse: number,
    id: string,
  ): MeasuredAnchorFragment => {
    const localRawRect = rawOverlayRect(rect, rowBounds, id);
    const rawRect = projectRowRect(localRawRect, rowBounds, routeOverlayRect);
    return {
      rawRect,
      routeRect: {
        ...rawRect,
        top: rawRect.top + inkSlack.top,
        bottom: rawRect.bottom - inkSlack.bottom,
      },
      emphasisRect: projectRowRect(localRawRect, rowBounds, emphasisOverlayRect),
      underlineCenterY: connectionUnderlineCenter(rawRect.bottom),
      exact: true,
      verse,
      localRawRect,
    };
  };
  for (let fragmentIndex = 0; fragmentIndex < anchor.fragments.length; fragmentIndex += 1) {
    const paintFragment = anchor.fragments[fragmentIndex]!;
    const verse = paintFragment.verse;
    const row = verseRowRefs.current.get(verse);
    const span = row?.querySelector<HTMLElement>(".verse-text-span");
    if (!row || !span) continue;
    const text = span.textContent ?? "";
    const packageExact = paintFragment.char_start >= 0
      && paintFragment.char_end > paintFragment.char_start
      && paintFragment.char_end <= text.length
      && text.slice(paintFragment.char_start, paintFragment.char_end) === paintFragment.quote;
    if (!packageExact) continue;
    const range = document.createRange();
    const start = locateTextOffset(span, paintFragment.char_start);
    const end = locateTextOffset(span, paintFragment.char_end);
    if (!start || !end) continue;
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0.5 && rect.height > 1)
      .map((rect, lineIndex) => measureRect(
        rect,
        row.getBoundingClientRect(),
        verse,
        `${connection.id}:${anchorIndex}:${verse}:${fragmentIndex}:${lineIndex}`,
      ));
    fragments.push(...rects);
  }
  return fragments;
}

function reprojectAnchorFragments(
  fragments: readonly MeasuredAnchorFragment[],
  routeOverlayRect: DOMRect,
  emphasisOverlayRect: DOMRect,
  inkSlack: ConnectionInkSlack,
  verseRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>,
): MeasuredAnchorFragment[] {
  return fragments.flatMap((fragment) => {
    const row = verseRowRefs.current.get(fragment.verse);
    if (!row) return [];
    const rowBounds = row.getBoundingClientRect();
    const rawRect = projectRowRect(fragment.localRawRect, rowBounds, routeOverlayRect);
    return [{
      ...fragment,
      rawRect,
      routeRect: {
        ...rawRect,
        top: rawRect.top + inkSlack.top,
        bottom: rawRect.bottom - inkSlack.bottom,
      },
      emphasisRect: projectRowRect(fragment.localRawRect, rowBounds, emphasisOverlayRect),
      underlineCenterY: connectionUnderlineCenter(rawRect.bottom),
    }];
  });
}

function anchorMeasurementKey(
  connection: ConnectionPaintRecord,
  anchorIndex: number,
  packageId: string,
): string {
  const anchor = connection.anchors[anchorIndex];
  if (!anchor) return `${connection.id}:${anchorIndex}:missing`;
  return JSON.stringify([
    connection.id,
    anchorIndex,
    anchor.book,
    anchor.chapter,
    anchor.verse_start,
    anchor.verse_end,
    packageId,
    anchor.fragments,
  ]);
}

export function ConnectionUnderlay({
  containerRef,
  verseRowRefs,
  connections,
  paintProjections,
  draftConnection = null,
  selectionEmphasis = null,
  book,
  chapter,
  packageId,
  contentRevision,
  themeToken,
  focusMode,
  selectedConnectionId,
  heldConnectionIds,
  openTickGroupMemberIds,
  onSelectConnection,
  onDismissFocus,
  onChooseConnections,
  wordHitTestRef,
}: Props): React.JSX.Element | null {
  const [painted, setPainted] = useState<PaintedConnection[]>([]);
  const [size, setSize] = useState<UnderlaySize>(EMPTY_UNDERLAY_SIZE);
  const [previewConnectionId, setPreviewConnectionId] = useState<string | null>(null);
  // A woken hover preview is a transient layer: dialogs, choosers, and all
  // marking chrome outrank it in the shared registry, and a selected shape
  // suppresses preview entirely.
  const previewLayerRef = useLayer(
    !focusMode && previewConnectionId != null && selectedConnectionId == null ? "preview" : null,
  );
  const [readyRouteId, setReadyRouteId] = useState<string | null>(null);
  const [veilReady, setVeilReady] = useState(false);
  const [rovingTickId, setRovingTickId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [coarsePointer, setCoarsePointer] = useState(false);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const emphasisRef = useRef<SVGSVGElement | null>(null);
  const layoutCacheRef = useRef<LayoutCache | null>(null);
  const fontRevisionRef = useRef(0);
  const previewEnterTimerRef = useRef<number | null>(null);
  const previewLeaveTimerRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const veilFrameRef = useRef<number | null>(null);
  const tickRefs = useRef(new Map<string, HTMLButtonElement>());
  const rawMaskId = useId();
  const focusMaskId = `connection-focus-${rawMaskId.replace(/:/g, "")}`;
  const sharedMaskId = `connection-shared-${rawMaskId.replace(/:/g, "")}`;
  // Preview is an invitation, not a selection: it may wake the exact words
  // and tick, but only an explicitly selected id is allowed to bloom route
  // ink, contacts, a hit target, or the focus veil.
  const visualFocusId = selectedConnectionId ?? (focusMode ? null : previewConnectionId);
  const durablePaintRecords = useMemo<ConnectionPaintRecord[]>(() => connections.flatMap((connection) => {
    const projection = paintProjections.get(connection.id);
    if (!projection || projection.status === "unavailable" || projection.anchors.length === 0) return [];
    return [{
      source: "durable" as const,
      id: connection.id,
      kind: connection.kind,
      label: connection.label,
      anchors: projection.anchors,
      durableRecord: connection,
    }];
  }), [connections, paintProjections]);
  const currentDurableConnectionById = useMemo<ReadonlyMap<string, ConnectionRecord>>(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const syncPointerMode = (): void => setCoarsePointer(media.matches);
    syncPointerMode();
    media.addEventListener("change", syncPointerMode);
    return () => media.removeEventListener("change", syncPointerMode);
  }, []);
  const draftPaintRecord = useMemo<ConnectionPaintRecord | null>(() => draftConnection
    ? {
        // This renderer-only subject exists solely for the shared phrase
        // measurement plane. Its type has no durable format or event fields.
        source: "authoring",
        id: CONNECTION_AUTHORING_DRAFT_ID,
        kind: draftConnection.kind,
        label: draftConnection.label,
        anchors: [...draftConnection.anchors],
      }
    : null, [draftConnection]);
  const selectionEmphasisPaintRecord = useMemo<ConnectionPaintRecord | null>(() => {
    if (!selectionEmphasis || selectionEmphasis.anchors.length === 0) return null;
    return {
      source: "selection",
      id: `${MARKING_SELECTION_EMPHASIS_PREFIX}${selectionEmphasis.nonce}`,
      kind: "link:parallel",
      label: "Current marking selection",
      anchors: [...selectionEmphasis.anchors],
    };
  }, [selectionEmphasis]);
  const paintRecords = useMemo<ConnectionPaintRecord[]>(
    () => [
      ...durablePaintRecords,
      ...(draftPaintRecord ? [draftPaintRecord] : []),
      ...(selectionEmphasisPaintRecord ? [selectionEmphasisPaintRecord] : []),
    ],
    [draftPaintRecord, durablePaintRecords, selectionEmphasisPaintRecord],
  );

  useLayoutEffect(() => {
    if (!wordHitTestRef) return;
    const hitTest: ConnectionWordHitTest = (clientX, clientY) => {
      const overlay = emphasisRef.current;
      if (!overlay || size.width <= 0 || size.height <= 0) return [];
      const bounds = overlay.getBoundingClientRect();
      if (
        bounds.width <= 0
        || bounds.height <= 0
        || clientX < bounds.left
        || clientX > bounds.right
        || clientY < bounds.top
        || clientY > bounds.bottom
      ) return [];
      const x = (clientX - bounds.left) * (size.width / bounds.width);
      const y = (clientY - bounds.top) * (size.height / bounds.height);
      const hits: ConnectionWordHit[] = [];
      for (const item of painted) {
        if (!isDurablePaintRecord(item.connection)) continue;
        const currentConnection = currentDurableConnectionById.get(item.connection.id);
        if (!currentConnection) continue;
        let exactArea = Number.POSITIVE_INFINITY;
        for (const emphasis of item.emphases) {
          const containsPoint = emphasis.bands.some((band) =>
            x >= band.x0 && x <= band.x1 && y >= band.y0 && y <= band.y1);
          if (!containsPoint) continue;
          const area = emphasis.bands.reduce(
            (total, band) => total + Math.max(0, band.x1 - band.x0) * Math.max(0, band.y1 - band.y0),
            0,
          );
          exactArea = Math.min(exactArea, area);
        }
        if (Number.isFinite(exactArea)) {
          hits.push({ connection: currentConnection, area: exactArea });
        }
      }
      return hits;
    };
    wordHitTestRef.current = hitTest;
    return () => {
      if (wordHitTestRef.current === hitTest) wordHitTestRef.current = null;
    };
  }, [currentDurableConnectionById, painted, size.height, size.width, wordHitTestRef]);

  const invalidateLayout = useCallback((): void => {
    layoutCacheRef.current = null;
  }, []);

  const handleFontsSettled = useCallback((): void => {
    clearConnectionFontMetricCache();
    fontRevisionRef.current += 1;
    // A webfont can replace fallback glyph metrics without changing any
    // computed CSS string or row box. Font settlement is therefore the one
    // lifecycle event that must force every local row measurement fresh.
    invalidateLayout();
  }, [invalidateLayout]);

  const measure = useCallback((): void => {
    // A chapter with no authored relationship has no routing work. Keep this
    // gate ahead of every DOM bound, TreeWalker, Range, and computed-style read
    // so the dormant underlay is effectively free.
    const active = orderActiveConnections(paintRecords, book, chapter, visualFocusId, heldConnectionIds);
    if (active.length === 0) {
      layoutCacheRef.current = null;
      setPainted((current) => current.length === 0 ? current : []);
      setSize((current) => sameUnderlaySize(current, EMPTY_UNDERLAY_SIZE) ? current : EMPTY_UNDERLAY_SIZE);
      return;
    }

    const container = containerRef.current;
    const overlay = overlayRef.current;
    const emphasisOverlay = emphasisRef.current;
    if (!container || !overlay || !emphasisOverlay) {
      invalidateLayout();
      setPainted((current) => current.length === 0 ? current : []);
      setSize((current) => sameUnderlaySize(current, EMPTY_UNDERLAY_SIZE) ? current : EMPTY_UNDERLAY_SIZE);
      return;
    }
    const containerBounds = container.getBoundingClientRect();
    // The painted SVG is the sole coordinate datum. CSS expands the verse
    // sheet into real page-gutter air; JavaScript must never synthesize a
    // larger rectangle around the prose (the lab's exact 1px-drop lesson).
    const base = overlay.getBoundingClientRect();
    const emphasisBase = emphasisOverlay.getBoundingClientRect();
    if (base.width <= 0 || base.height <= 0 || emphasisBase.width <= 0 || emphasisBase.height <= 0) {
      invalidateLayout();
      setPainted((current) => current.length === 0 ? current : []);
      setSize((current) => sameUnderlaySize(current, EMPTY_UNDERLAY_SIZE) ? current : EMPTY_UNDERLAY_SIZE);
      return;
    }
    const leftInset = containerBounds.left - base.left;
    const rightInset = base.right - containerBounds.right;
    const computedStyle = getComputedStyle(container);
    const layoutContextKey = `${book}:${chapter}:${packageId}`;
    const signature = connectionLayoutSignature({
      contextKey: [
        book,
        chapter,
        packageId,
        signatureNumber(emphasisBase.left - base.left),
        signatureNumber(emphasisBase.top - base.top),
        signatureNumber(emphasisBase.width),
        signatureNumber(emphasisBase.height),
      ].join(":"),
      containerWidth: containerBounds.width,
      containerHeight: containerBounds.height,
      stageWidth: base.width,
      stageHeight: base.height,
      leftInset,
      rightInset,
      verseRowCount: verseRowRefs.current.size,
      rowGeometry: verseRowGeometrySignature(verseRowRefs, base),
      fontSize: computedStyle.fontSize,
      lineHeight: computedStyle.lineHeight,
      fontFamily: computedStyle.fontFamily,
      fontWeight: computedStyle.fontWeight,
      fontStyle: computedStyle.fontStyle,
      letterSpacing: computedStyle.letterSpacing,
      wordSpacing: computedStyle.wordSpacing,
      textIndent: computedStyle.textIndent,
      direction: computedStyle.direction,
    });
    let cachedLayout = layoutCacheRef.current;
    if (!cachedLayout || cachedLayout.container !== container || cachedLayout.contextKey !== layoutContextKey) {
      cachedLayout = null;
    }
    const inkSlack = connectionInkSlackFor(container.querySelector<HTMLElement>(".verse-text-span") ?? container);
    const rowInputs = connectionRowInputs(verseRowRefs, fontRevisionRef.current);
    const reconciledRows = reconcileConnectionRows(
      cachedLayout?.rows ?? new Map<number, ConnectionRowLayoutMeasurement<HTMLDivElement, VerseRowGeometry>>(),
      rowInputs,
      (input) => measureVerseRowGeometry(input, inkSlack),
    );
    const wordRuns: RouteRect[] = [];
    const verseNumberRects: RouteRect[] = [];
    for (const measurement of reconciledRows.rows.values()) {
      const rowBounds = measurement.element.getBoundingClientRect();
      wordRuns.push(...measurement.value.wordRuns.map((rect) => projectRowRect(rect, rowBounds, base)));
      verseNumberRects.push(...measurement.value.verseNumberRects.map((rect) => projectRowRect(rect, rowBounds, base)));
    }
    const renderedLines = mergeRenderedLines(wordRuns);
    const textLeft = renderedLines.length > 0 ? Math.min(...renderedLines.map((line) => line.left)) : 44;
    const textRight = renderedLines.length > 0 ? Math.max(...renderedLines.map((line) => line.right)) : Math.max(44, base.width - 12);
    const availableLeft = Math.max(16, textLeft - 5);
    const availableRight = Math.max(12, base.width - textRight - 5);
    const fontSize = Number.parseFloat(computedStyle.fontSize) || 17;
    const block: RouteBlock = {
      bounds: { left: 0, right: base.width, top: 0, bottom: base.height },
      renderedLines,
      wordRuns,
      verseNumberRects,
      additionalObstacles: [],
      lineHeight: Number.parseFloat(computedStyle.lineHeight) || 28,
      preferredMargin: availableRight > availableLeft + 18 ? "right" : "left",
      availableLeftMargin: availableLeft,
      availableRightMargin: availableRight,
    };
    cachedLayout = {
      container,
      contextKey: layoutContextKey,
      signature,
      block,
      anchorFragments: cachedLayout?.anchorFragments ?? new Map(),
      rows: reconciledRows.rows,
      inkSlack,
      fontSize,
    };
    layoutCacheRef.current = cachedLayout;

    const corridorClaims: RouteCorridorClaim[] = [];
    const spineClaims: RouteSpineClaim[] = [];
    const strandClaims: RouteStrandClaim[] = [];
    const result: PaintedConnection[] = [];
    const activeAnchorKeys = new Set<string>();
    // The route engine—not a coarse host-side width threshold—owns legal
    // margin clearance. Even a narrow 4–8px outer rail can be valid; pruning
    // that side here made compact selected connections report needs-space.
    const sides: RouteSide[] = block.preferredMargin === "right"
      ? ["right", "left"]
      : ["left", "right"];

    for (const connection of active) {
      const focused = selectedConnectionId === connection.id;
      const anchors = connection.anchors
        .map((anchor, anchorIndex) => ({ anchor, anchorIndex }))
        .filter(({ anchor }) => anchor.book === book && anchor.chapter === chapter)
        .map(({ anchorIndex }, documentOrder) => {
          const measurementKey = anchorMeasurementKey(connection, anchorIndex, packageId);
          activeAnchorKeys.add(measurementKey);
          let fragments = cachedLayout.anchorFragments.get(measurementKey);
          const anchorVerses = connection.anchors[anchorIndex]?.fragments
            .filter((fragment) => fragment.verse >= 0)
            .map((fragment) => fragment.verse) ?? [];
          const anchorRowChanged = anchorVerses.some((verse) => reconciledRows.remeasuredVerses.has(verse));
          if (!fragments || anchorRowChanged) {
            fragments = rangeRectsForAnchor(
              connection,
              anchorIndex,
              base,
              emphasisBase,
              inkSlack,
              verseRowRefs,
              chapter,
            );
            cachedLayout.anchorFragments.set(measurementKey, fragments);
          } else {
            fragments = reprojectAnchorFragments(
              fragments,
              base,
              emphasisBase,
              inkSlack,
              verseRowRefs,
            );
            cachedLayout.anchorFragments.set(measurementKey, fragments);
          }
          const renderedFragments = mergeRenderedLines(fragments.map((fragment) => fragment.routeRect));
          return {
            id: `${connection.id}:${anchorIndex}`,
            fragments: renderedFragments,
            measuredFragments: fragments,
            anchorIndex,
            documentOrder,
          };
        })
        .filter((anchor) => anchor.fragments.length > 0);
      const annotation: RouteAnnotation = { id: connection.id, kind: connection.kind, focused, anchors };
      const underlines = anchors.flatMap((anchor) =>
        mergeUnderlineFragments(anchor.measuredFragments, anchor.anchorIndex));
      const emphases = anchors
        .map((anchor) => {
          const emphasisPaint = emphasisPaintForFragments(anchor.measuredFragments, "emphasis");
          const routePaint = emphasisPaintForFragments(anchor.measuredFragments, "route");
          return {
            path: emphasisPaint.path,
            routePath: routePaint.path,
            bands: emphasisPaint.bands,
            anchorIndex: anchor.anchorIndex,
          };
        })
        .filter((emphasis) => emphasis.path.length > 0);
      if (anchors.length === 0) continue;
      const fragmentCenters = anchors.flatMap((anchor) => anchor.fragments.map((fragment) => (fragment.top + fragment.bottom) / 2));
      const fallbackFocusY = fragmentCenters.reduce((sum, value) => sum + value, 0) / fragmentCenters.length;
      if (!focused) {
        result.push({
          connection,
          valid: true,
          reason: null,
          routePath: "",
          underlines,
          emphases,
          contacts: [],
          side: block.preferredMargin ?? "right",
          focusY: fallbackFocusY,
        });
        continue;
      }
      let plan: ReturnType<typeof planRoute>;
      try {
        plan = planRoute(block, annotation, {
          fontSize,
          // Ink-tight bottom + measured descent − half the 1.5px stroke
          // cancels to the painted raw line-band bottom − 0.75px exactly.
          underlineDy: connectionUnderlineDy(inkSlack.bottom),
          corridorClaims,
          spineClaims,
          strandClaims,
          // Let the engine derive the nearest legal rails from the complete
          // obstacle set. Explicit text-relative rails can become illegal when
          // the compact canvas leaves only a narrow—but still valid—outer loom.
          sides,
          focused: true,
          allowMiddle: false,
          claimPad: 0.25,
        });
      } catch {
        result.push({
          connection,
          valid: false,
          reason: "engine-error",
          routePath: "",
          underlines,
          emphases,
          contacts: [],
          side: block.preferredMargin ?? "right",
          focusY: fallbackFocusY,
        });
        continue;
      }
      if (plan.valid) {
        corridorClaims.push(...plan.claimsOut);
        if (plan.spineClaimOut) spineClaims.push(plan.spineClaimOut);
        if (plan.strandClaimOut) strandClaims.push(plan.strandClaimOut);
        // Tick placement follows measured anchor position rather than the
        // selected route's claimed rail, so changing inspector focus cannot
        // reorder the tick layer's DOM/tab sequence.
        result.push({
          connection,
          valid: true,
          reason: null,
          routePath: segmentPath(plan.centerline),
          underlines,
          emphases,
          contacts: plan.contacts,
          side: plan.side,
          focusY: fallbackFocusY,
        });
      } else {
        result.push({
          connection,
          valid: false,
          reason: plan.reason,
          routePath: "",
          underlines,
          emphases,
          contacts: [],
          side: block.preferredMargin ?? "right",
          focusY: fallbackFocusY,
        });
      }
    }
    for (const measurementKey of cachedLayout.anchorFragments.keys()) {
      if (!activeAnchorKeys.has(measurementKey)) cachedLayout.anchorFragments.delete(measurementKey);
    }
    // Planning is front-to-back priority, while SVG siblings paint in DOM
    // order. Restore a deterministic back-to-front order so the connection
    // that claimed space first also remains the topmost visible ink.
    const claimPriority = new Map(active.map((connection, index) => [connection.id, index]));
    const paintResult = [...result].sort((left, right) =>
      (claimPriority.get(right.connection.id) ?? 0) - (claimPriority.get(left.connection.id) ?? 0));
    const nextSize = { width: base.width, height: base.height };
    setSize((current) => sameUnderlaySize(current, nextSize) ? current : nextSize);
    setPainted((current) => samePaintedConnections(current, paintResult) ? current : paintResult);
  }, [book, chapter, containerRef, heldConnectionIds, invalidateLayout, packageId, paintRecords, selectedConnectionId, verseRowRefs, visualFocusId]);

  const scheduleMeasure = useUnderlayMeasurementLifecycle({
    containerRef,
    measure,
    onFontsSettled: handleFontsSettled,
    observeStage: true,
  });

  useLayoutEffect(() => {
    invalidateLayout();
    scheduleMeasure();
  }, [book, chapter, invalidateLayout, packageId, scheduleMeasure]);

  useLayoutEffect(() => {
    // Row text and computed metric signatures decide which local scans are
    // stale. Equal-size content replacement and theme changes must schedule a
    // pass, but must not discard every unaffected verse.
    scheduleMeasure();
  }, [contentRevision, scheduleMeasure, themeToken]);

  useLayoutEffect(() => {
    // Verse rows use callback refs and follow this component in the sibling
    // tree. During the layout-effect phase those refs may still be detached,
    // so measuring synchronously can cache an empty result until the next
    // resize. A frame boundary guarantees every row ref is attached first.
    scheduleMeasure();
  }, [measure, scheduleMeasure]);

  const cancelPreviewTimer = useCallback((timerRef: React.MutableRefObject<number | null>): void => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearPreview = useCallback((withGrace = false): void => {
    cancelPreviewTimer(previewEnterTimerRef);
    cancelPreviewTimer(previewLeaveTimerRef);
    if (!withGrace) {
      setPreviewConnectionId(null);
      return;
    }
    previewLeaveTimerRef.current = window.setTimeout(() => {
      previewLeaveTimerRef.current = null;
      setPreviewConnectionId(null);
    }, PREVIEW_LEAVE_MS);
  }, [cancelPreviewTimer]);

  const previewPointerIntent = useCallback((connectionId: string): void => {
    if (focusMode || selectedConnectionId != null) return;
    cancelPreviewTimer(previewLeaveTimerRef);
    cancelPreviewTimer(previewEnterTimerRef);
    previewEnterTimerRef.current = window.setTimeout(() => {
      previewEnterTimerRef.current = null;
      setPreviewConnectionId(connectionId);
    }, PREVIEW_ENTER_MS);
  }, [cancelPreviewTimer, focusMode, selectedConnectionId]);

  const previewKeyboardFocus = useCallback((connectionId: string): void => {
    if (focusMode || selectedConnectionId != null) return;
    cancelPreviewTimer(previewEnterTimerRef);
    cancelPreviewTimer(previewLeaveTimerRef);
    setPreviewConnectionId(connectionId);
  }, [cancelPreviewTimer, focusMode, selectedConnectionId]);

  useEffect(() => {
    if (selectedConnectionId != null) clearPreview(false);
  }, [clearPreview, selectedConnectionId]);

  useEffect(() => {
    if (focusMode) clearPreview(false);
  }, [clearPreview, focusMode]);

  useEffect(() => {
    if (focusMode || previewConnectionId == null || selectedConnectionId != null) return undefined;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // The registry already ranks every dialog, chooser, and marking chrome
      // (including the radial) above a hover preview.
      if (!isTopLayer(previewLayerRef.current)) return;
      event.preventDefault();
      clearPreview(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [clearPreview, focusMode, previewConnectionId, previewLayerRef, selectedConnectionId]);

  useEffect(() => {
    if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current);
    setReadyRouteId(null);
    if (selectedConnectionId == null) return undefined;
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      setReadyRouteId(selectedConnectionId);
    });
    return () => {
      if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    };
  }, [selectedConnectionId]);

  const hasSelectedRoute = selectedConnectionId != null;
  useEffect(() => {
    if (veilFrameRef.current != null) window.cancelAnimationFrame(veilFrameRef.current);
    if (!hasSelectedRoute) {
      setVeilReady(false);
      return undefined;
    }
    // A -> B changes the mask holes without pulsing the entire reading field
    // off and on. Only the null -> selected transition fades the veil in.
    veilFrameRef.current = window.requestAnimationFrame(() => {
      veilFrameRef.current = null;
      setVeilReady(true);
    });
    return () => {
      if (veilFrameRef.current != null) window.cancelAnimationFrame(veilFrameRef.current);
      veilFrameRef.current = null;
    };
  }, [hasSelectedRoute]);

  useEffect(() => () => {
    cancelPreviewTimer(previewEnterTimerRef);
    cancelPreviewTimer(previewLeaveTimerRef);
    if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current);
    if (veilFrameRef.current != null) window.cancelAnimationFrame(veilFrameRef.current);
  }, [cancelPreviewTimer]);

  const hasActiveConnections = paintRecords.some((connection) =>
    connection.anchors.some((anchor) => anchor.book === book && anchor.chapter === chapter));
  if (!hasActiveConnections) return null;
  // Measurement is scheduled, so one stale paint frame can survive a cancel
  // while durable connections keep this component mounted. Remove the draft
  // synchronously from every visible/interactive collection as soon as its
  // renderer-only model disappears.
  const visiblePainted = painted.filter((item) => {
    if (item.connection.source === "authoring") return draftPaintRecord != null;
    if (item.connection.source === "selection") {
      return item.connection.id === selectionEmphasisPaintRecord?.id;
    }
    return currentDurableConnectionById.has(item.connection.id);
  });
  const tickPainted = orderConnectionTicks(
    visiblePainted.filter((item) => isDurablePaintRecord(item.connection)),
  );
  const tickPaintedById = new Map(tickPainted.map((item) => [item.connection.id, item]));
  // Coarse input uses one uncompressed 38x44 hit target per physical control. When
  // that cannot fit, the lane planner returns a neutral aggregate whose
  // members remain individually available through the existing chooser.
  const tickLanes = planConnectionTickLanes(
    tickPainted.map((item) => ({
      id: item.connection.id,
      side: item.side === "left" ? "left" : "right",
      focusY: item.focusY,
    })),
    size.height,
    coarsePointer ? 45 : 25,
    coarsePointer ? 10 : 2,
  );
  const tickControlKeys = tickLanes.map((lane) => lane.key);
  const selectedTickControlKey = selectedConnectionId == null
    ? null
    : tickLanes.find((lane) => lane.memberIds.includes(selectedConnectionId))?.key ?? null;
  const effectiveRovingTickId = rovingTickId != null && tickControlKeys.includes(rovingTickId)
    ? rovingTickId
    : selectedTickControlKey ?? tickControlKeys[0] ?? null;
  const overlayStyle = {
    "--connection-underline-quiet-width": `${CONNECTION_UNDERLINE_QUIET_STROKE}px`,
    "--connection-underline-selected-width": `${CONNECTION_UNDERLINE_SELECTED_STROKE}px`,
    "--connection-route-quiet-width": `${CONNECTION_ROUTE_QUIET_STROKE}px`,
    "--connection-route-selected-width": `${CONNECTION_ROUTE_SELECTED_STROKE}px`,
  } as React.CSSProperties;
  const focusItem = visiblePainted.find((item) => item.connection.id === selectedConnectionId) ?? null;
  const focusHasExactPaint = (focusItem?.emphases.length ?? 0) > 0;
  const sharedPaint = sharedEmphasisPaint(
    visiblePainted.filter((item) => isDurablePaintRecord(item.connection)),
  );
  return (
    <>
      <svg
        ref={emphasisRef}
        className={`connection-emphasis-underlay${visualFocusId ? " is-awake" : ""}`}
        width="100%"
        height="100%"
        viewBox={size.width > 0 && size.height > 0 ? `0 0 ${size.width} ${size.height}` : undefined}
        preserveAspectRatio="none"
        data-connection-emphasis-overlay=""
        data-connection-overlay-frame="self"
        data-coordinate-frame="self"
        aria-hidden="true"
      >
        {sharedPaint.length > 0 && <defs>
          <mask
            id={sharedMaskId}
            className="connection-shared-mask"
            x="0"
            y="0"
            width={size.width}
            height={size.height}
            maskUnits="userSpaceOnUse"
          >
            <rect x="0" y="0" width={size.width} height={size.height} fill="white" />
            {sharedPaint.map((shared) => <path key={shared.key} d={shared.path} fill="black" />)}
          </mask>
        </defs>}
        {visiblePainted.map((item) => {
          const focused = item.connection.id === selectedConnectionId;
          const previewed = !focusMode && selectedConnectionId == null && item.connection.id === previewConnectionId;
          const userHeld = heldConnectionIds.includes(item.connection.id);
          const companion = userHeld && !focused;
          const authoring = item.connection.source === "authoring";
          const markingSelection = item.connection.source === "selection";
          const paintState = markingSelection ? "selection"
            : authoring ? "authoring"
              : focused ? (item.valid ? "selected" : "needs-space")
                : previewed ? "preview"
                  : companion ? "companion" : "dormant";
          return (
            <g
              key={item.connection.id}
              className={`connection-emphasis-mark connection-kind-${item.connection.kind.replace("link:", "")}${markingSelection ? " marking-selection-emphasis" : ""}`}
              data-connection-id={item.connection.id}
              data-authoring-draft={authoring ? "" : undefined}
              data-marking-selection-emphasis={markingSelection ? "" : undefined}
              data-paint-state={paintState}
              data-anchor-resolution={item.emphases.length > 0 ? "exact" : "passage"}
              style={paintState === "dormant" && sharedPaint.length > 0
                ? { mask: `url(#${sharedMaskId})` }
                : undefined}
            >
              {item.emphases.map((emphasis) => <path
                key={`e-${emphasis.anchorIndex}`}
                className="connection-emphasis-wash"
                d={emphasis.path}
                data-anchor-index={emphasis.anchorIndex}
                data-line-count={emphasis.bands.length}
              />)}
            </g>
          );
        })}
        {sharedPaint.map((shared) => <path
          key={`shared-${shared.key}`}
          className="connection-emphasis-shared"
          d={shared.path}
          data-shared-connection-emphasis=""
        />)}
      </svg>
      <svg
        ref={overlayRef}
        className={`connection-underlay${selectedConnectionId ? " is-awake" : ""}`}
        width="100%"
        height="100%"
        viewBox={size.width > 0 && size.height > 0 ? `0 0 ${size.width} ${size.height}` : undefined}
        preserveAspectRatio="none"
        style={overlayStyle}
        data-connection-overlay=""
        data-connection-overlay-frame="self"
        data-coordinate-frame="self"
        aria-hidden="true"
      >
        {selectedConnectionId && focusHasExactPaint && <defs>
          <mask
            id={focusMaskId}
            className="connection-focus-mask"
            x="0"
            y="0"
            width={size.width}
            height={size.height}
            maskUnits="userSpaceOnUse"
          >
            <rect x="0" y="0" width={size.width} height={size.height} fill="white" />
            {visiblePainted
              .filter((item) => heldConnectionIds.includes(item.connection.id) && item.connection.id !== selectedConnectionId)
              .flatMap((item) => item.emphases.map((emphasis) => <path
                key={`held-hole-${item.connection.id}-${emphasis.anchorIndex}`}
                d={emphasis.routePath}
                fill="rgb(164 164 164)"
              />))}
            {focusItem?.emphases.map((emphasis) => <path
              key={`focus-hole-${emphasis.anchorIndex}`}
              d={emphasis.routePath}
              fill="black"
            />)}
          </mask>
        </defs>}
        {selectedConnectionId && focusHasExactPaint && <rect
          className={`connection-focus-veil${veilReady ? " is-ready" : ""}`}
          x="0"
          y="0"
          width={size.width}
          height={size.height}
          mask={`url(#${focusMaskId})`}
          data-connection-focus-veil=""
        />}
        {visiblePainted.filter((item) =>
          selectedConnectionId != null
          && isDurablePaintRecord(item.connection)
          && (item.connection.id === selectedConnectionId || heldConnectionIds.includes(item.connection.id))).map((item) => {
          const focused = item.connection.id === selectedConnectionId;
          const selected = item.connection.id === selectedConnectionId;
          const userHeld = heldConnectionIds.includes(item.connection.id);
          const companion = userHeld && !focused;
          const ready = focused && readyRouteId === item.connection.id;
          const paintState = focused ? (item.valid ? "selected" : "needs-space") : "companion";
          const companionLevel = companion
            ? Math.max(1, heldConnectionIds.filter((id) => id !== visualFocusId).indexOf(item.connection.id) + 1)
            : 0;
          return (
            <g
              key={item.connection.id}
              className={`connection-mark connection-kind-${item.connection.kind.replace("link:", "")}${focused ? " focused" : ""}${selected ? " selected" : ""}${companion ? " companion" : ""}${userHeld ? " user-held" : ""}${ready ? " route-ready" : ""}${focused && !item.valid ? " held" : ""}`}
              data-connection-id={item.connection.id}
              data-user-held={userHeld ? "" : undefined}
              data-paint-state={paintState}
              data-route={focused && !item.valid ? item.reason ?? "needs-space" : item.side ?? "local"}
              data-anchor-resolution={item.emphases.length > 0 ? "exact" : "passage"}
            >
              {item.underlines.map((underline) => {
                const overlapsFocus = companion && focusItem?.underlines.some((focusUnderline) =>
                  Math.abs(focusUnderline.centerY - underline.centerY) < 2.5
                  && focusUnderline.left < underline.right
                  && focusUnderline.right > underline.left) === true;
                const offsetY = overlapsFocus ? -3 * companionLevel : 0;
                return <path
                  key={`u-${underline.anchorIndex}-${underline.lineIndex}`}
                  className="connection-underline"
                  d={underline.path}
                  pathLength="1"
                  transform={offsetY === 0 ? undefined : `translate(0 ${offsetY})`}
                  data-anchor-underline=""
                  data-anchor-index={underline.anchorIndex}
                  data-line-index={underline.lineIndex}
                  data-underline-level={overlapsFocus ? companionLevel : 0}
                  data-underline-center={(underline.centerY + offsetY).toFixed(2)}
                />;
              })}
              {focused && item.valid && item.routePath && <path
                className="connection-route"
                data-route-centerline=""
                d={item.routePath}
                pathLength="1"
              />}
              {focused && item.valid && item.routePath && <path
                className="connection-route-hit"
                d={item.routePath}
                onClick={(event) => {
                  event.stopPropagation();
                  clearPreview(false);
                  if (!isDurablePaintRecord(item.connection)) return;
                  // The trace is the one canvas element that clearly belongs
                  // to the focused relationship: clicking it toggles that
                  // focus back off. The held comparison set is untouched —
                  // Release stays a deliberate card action.
                  onDismissFocus();
                  setAnnouncement(`${item.connection.label} focus dismissed. It remains held for comparison.`);
                }}
              />}
              {focused && item.valid && item.contacts.map((point, index) => <circle
                key={`c-${index}`}
                className="connection-contact"
                cx={point.x}
                cy={point.y}
                r={1.8}
                data-contact-index={index}
                data-pin-y={point.y.toFixed(2)}
              />)}
            </g>
          );
        })}
      </svg>
      <div
        className="connection-tick-layer"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Connections in this passage"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearPreview(true);
        }}
      >
        {tickLanes.map((lane) => {
          const memberItems = lane.memberIds.flatMap((connectionId) => {
            const item = tickPaintedById.get(connectionId);
            return item ? [item] : [];
          });
          const item = memberItems[0];
          if (!item) return null;
          const aggregate = memberItems.length > 1;
          const aggregateExpanded = aggregate
            && openTickGroupMemberIds != null
            && openTickGroupMemberIds.length === lane.memberIds.length
            && lane.memberIds.every((connectionId) => openTickGroupMemberIds.includes(connectionId));
          const selected = selectedConnectionId != null && lane.memberIds.includes(selectedConnectionId);
          const heldMemberIds = lane.memberIds.filter((connectionId) => heldConnectionIds.includes(connectionId));
          const userHeld = heldMemberIds.length > 0;
          const focused = visualFocusId != null && lane.memberIds.includes(visualFocusId);
          const focusedItem = visualFocusId == null ? null : tickPaintedById.get(visualFocusId) ?? null;
          const needsSpace = focused && focusedItem != null && !focusedItem.valid;
          const vertical = lane.top;
          const sideStyle = lane.side === "left" ? { left: 1 } : { right: 1 };
          const kindClass = aggregate
            ? " connection-tick-aggregate"
            : ` connection-kind-${item.connection.kind.replace("link:", "")}`;
          const aggregateLabel = `${memberItems.length} relationships near this reading position. Open relationship chooser.`;
          return (
            <button
              key={lane.key}
              type="button"
              ref={(node) => {
                if (node) tickRefs.current.set(lane.key, node);
                else tickRefs.current.delete(lane.key);
              }}
              className={`connection-tick${kindClass}${focused ? " focused" : ""}${selected ? " selected" : ""}${userHeld ? " user-held" : ""}${needsSpace ? " needs-space" : ""}`}
              style={{ top: vertical, ...sideStyle }}
              data-connection-tick={aggregate ? "" : item.connection.id}
              data-connection-tick-members={aggregate ? encodeConnectionTickMemberIds(lane.memberIds) : undefined}
              data-connection-tick-aggregate={aggregate ? "" : undefined}
              data-connection-tick-side={lane.side}
              data-held-connection-ids={userHeld ? encodeConnectionTickMemberIds(heldMemberIds) : undefined}
              data-selected-connection-id={selected ? selectedConnectionId ?? undefined : undefined}
              tabIndex={effectiveRovingTickId === lane.key ? 0 : -1}
              aria-label={aggregate
                ? `${aggregateLabel}${selected && focusedItem ? ` ${focusedItem.connection.label} is selected.` : ""}`
                : `${item.connection.label}. ${phraseCount(item.connection.anchors.length)}${userHeld && !selected ? ". Held" : ""}${needsSpace ? ". Line unavailable at this width" : ""}`}
              aria-pressed={userHeld}
              aria-expanded={aggregate ? aggregateExpanded : selected}
              aria-controls={aggregate
                ? aggregateExpanded ? "connection-word-chooser" : undefined
                : selected ? "connection-card-inspector" : undefined}
              aria-haspopup={aggregate ? "dialog" : undefined}
              onPointerEnter={() => {
                if (aggregate) clearPreview(false);
                else previewPointerIntent(item.connection.id);
              }}
              onPointerMove={() => {
                // An Escape-cleared preview must not leave a dead zone under
                // a resting pointer: any fresh movement re-arms hover intent.
                if (!aggregate && previewConnectionId == null) previewPointerIntent(item.connection.id);
              }}
              onPointerLeave={() => clearPreview(true)}
              onFocus={() => {
                setRovingTickId(lane.key);
                if (aggregate) clearPreview(false);
                else previewKeyboardFocus(item.connection.id);
              }}
              onKeyDown={(event) => {
                const currentIndex = tickControlKeys.indexOf(lane.key);
                let nextIndex: number | null = null;
                if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tickControlKeys.length;
                else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tickControlKeys.length) % tickControlKeys.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = tickControlKeys.length - 1;
                if (nextIndex == null || tickControlKeys.length === 0) return;
                event.preventDefault();
                const nextKey = tickControlKeys[nextIndex];
                if (!nextKey) return;
                setRovingTickId(nextKey);
                tickRefs.current.get(nextKey)?.focus({ preventScroll: true });
              }}
              onClick={(event) => {
                event.stopPropagation();
                clearPreview(false);
                if (aggregate) {
                  const records = memberItems.flatMap((member) => isDurablePaintRecord(member.connection)
                    ? [member.connection.durableRecord]
                    : []);
                  onChooseConnections(records, event.currentTarget.getBoundingClientRect(), event.currentTarget);
                  setAnnouncement(`Relationship chooser opened for ${records.length} nearby relationships.`);
                  return;
                }
                if (!isDurablePaintRecord(item.connection)) return;
                // Tick activation is focus/reaffirmation. Releasing an
                // intentional hold belongs only to the explicitly labelled
                // Release action in the Living Margin card.
                onSelectConnection(item.connection.durableRecord, event.detail === 0);
                setAnnouncement(selected
                  ? `${item.connection.label} remains selected. Connection details are open in Study.`
                  : `${item.connection.label} selected. ${phraseCount(item.connection.anchors.length)}. Connection details opened in Study.`);
              }}
            >
              <span className="connection-tick-dash" aria-hidden="true" />
              {aggregate && <span className="connection-tick-dash" aria-hidden="true" />}
              {needsSpace && selected && (
                <span className="connection-tick-note" aria-hidden="true">Line hidden at this width</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}
