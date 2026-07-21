import type { BookCode } from "../../core/reference/types.js";

/**
 * Package-local paint evidence returned by the host after resolving a durable
 * canonical occurrence anchor. This renderer DTO has no durable format
 * version, package-independent identity, or event envelope and must never
 * cross the mutation broker. `sourceActiveEventId` is transient correlation
 * evidence only: the renderer rejects paint resolved from any other authored
 * head before it reaches the underlay.
 */
export interface ConnectionPaintFragment {
  verse: number;
  char_start: number;
  char_end: number;
  quote: string;
}

export interface ConnectionPaintAnchor {
  book: BookCode;
  chapter: number;
  verse_start: number;
  verse_end: number;
  fragments: readonly ConnectionPaintFragment[];
}

export type ConnectionPaintProjectionStatus =
  | "exact"
  | "legacy-exact"
  | "unavailable";

export interface ConnectionPaintProjection {
  connectionId: string;
  sourceActiveEventId: string | null;
  packageId: string;
  status: ConnectionPaintProjectionStatus;
  anchors: readonly ConnectionPaintAnchor[];
  error?: { code: string; message: string };
}

export interface ConnectionPaintProjectionRequest {
  connectionId: string;
  expectedActiveEventId: string;
}

export interface ConnectionPaintProjectionResponse {
  ok: boolean;
  packageId: string;
  projections: readonly ConnectionPaintProjection[];
  error?: { code: string; message: string };
}
