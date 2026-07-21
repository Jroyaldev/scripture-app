import { BOOK_CODES } from "../reference/types.js";
import type { ConnectionAnchor, ConnectionAnchorV2, ConnectionRecord } from "./types.js";

const BOOK_ORDER = new Map(BOOK_CODES.map((book, index) => [book, index] as const));

type AnchorOrderKey = readonly [
  book: number,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  occurrenceVerse: number,
  occurrencePosition: number,
];

export type ConnectionPassageScope = {
  readonly book: string;
  readonly chapter: number;
  readonly verseStart?: number;
  readonly verseEnd?: number;
};

function intersectsScope(anchor: ConnectionAnchor, scope: ConnectionPassageScope): boolean {
  const verseStart = scope.verseStart ?? 1;
  const verseEnd = scope.verseEnd ?? Number.MAX_SAFE_INTEGER;
  return anchor.book === scope.book
    && anchor.chapter === scope.chapter
    && anchor.verse_start <= verseEnd
    && anchor.verse_end >= verseStart;
}

function anchorOrderKey(
  connection: ConnectionRecord,
  anchor: ConnectionAnchor,
): AnchorOrderKey {
  const occurrences = connection.format_version === 2
    ? (anchor as ConnectionAnchorV2).exact.occurrences
    : [];
  const occurrence = [...occurrences].sort((left, right) => (
    left.verse - right.verse || left.position - right.position
  ))[0];
  return [
    BOOK_ORDER.get(anchor.book) ?? Number.MAX_SAFE_INTEGER,
    anchor.chapter,
    anchor.verse_start,
    anchor.verse_end,
    occurrence?.verse ?? anchor.verse_start,
    occurrence?.position ?? 0,
  ];
}

function compareKeys(left: AnchorOrderKey, right: AnchorOrderKey): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Return a copy in canonical Scripture order without changing authored order. */
export function canonicalConnectionAnchors(
  connection: ConnectionRecord,
  scope?: ConnectionPassageScope,
): ConnectionAnchor[] {
  const anchors = scope
    ? connection.anchors.filter((anchor) => intersectsScope(anchor, scope))
    : connection.anchors;
  return [...anchors].sort((left, right) => (
    compareKeys(anchorOrderKey(connection, left), anchorOrderKey(connection, right))
  ));
}

/**
 * Passage lists are ordered by their earliest canonical member, never by ULID
 * creation history or the order in which a reader happened to add phrases.
 */
export function compareConnectionsCanonical(
  left: ConnectionRecord,
  right: ConnectionRecord,
  scope?: ConnectionPassageScope,
): number {
  const leftAnchor = canonicalConnectionAnchors(left, scope)[0]
    ?? canonicalConnectionAnchors(left)[0];
  const rightAnchor = canonicalConnectionAnchors(right, scope)[0]
    ?? canonicalConnectionAnchors(right)[0];
  if (!leftAnchor || !rightAnchor) {
    if (leftAnchor) return -1;
    if (rightAnchor) return 1;
    return left.id.localeCompare(right.id);
  }
  return compareKeys(anchorOrderKey(left, leftAnchor), anchorOrderKey(right, rightAnchor))
    || left.id.localeCompare(right.id);
}
