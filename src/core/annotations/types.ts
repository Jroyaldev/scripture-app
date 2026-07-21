import type { BackboneTokenAnchor, BackboneTokenAnchorValidationCode } from "./backbone-token-anchor.js";
import type { BookCode } from "../reference/types.js";

/** First, passage-only durable connection payload (read-only legacy support). */
export const CONNECTION_FORMAT_VERSION_V1 = 1 as const;

/** Current durable connection payload with translation-free exact anchors. */
export const CONNECTION_FORMAT_VERSION_V2 = 2 as const;

/** Version emitted by new connection creation (INV-17). */
export const CONNECTION_FORMAT_VERSION = CONNECTION_FORMAT_VERSION_V2;

/** Bounded authored payloads keep IPC, hashing, and hot indexes predictable. */
export const MAX_CONNECTION_LABEL_LENGTH = 512;
export const MAX_CONNECTION_OBSERVATION_LENGTH = 32 * 1_024;
export const MAX_CONNECTION_ANCHORS = 64;
export const MAX_CONNECTION_PACKAGE_ID_LENGTH = 128;
export const MAX_CONNECTION_QUOTE_LENGTH = 8_192;

/**
 * Closed relationship vocabulary shared with the marking-surface lab.
 * These identifiers are durable and must not be renamed for display copy.
 */
export const CONNECTION_KINDS = [
  "link:parallel",
  "link:contrast",
  "link:echo",
  "mirror",
  "series",
  "hinge",
] as const;

export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export type BinaryConnectionKind = Extract<
  ConnectionKind,
  "link:contrast" | "mirror" | "hinge"
>;

/**
 * Package-specific phrase recovery hint retained only for legacy v1 reads.
 * It is never canonical identity and is not admitted by v2 (INV-5).
 */
export type ConnectionRenderLocator = {
  package: string;
  char_start: number;
  char_end: number;
  quote: string;
};

/** One ordered member of a legacy passage-level relationship. */
export type ConnectionAnchorV1 = {
  book: BookCode;
  chapter: number;
  verse_start: number;
  verse_end: number;
  render_locator?: ConnectionRenderLocator;
  /** Statically prevent exact selectors from leaking into a v1 payload. */
  exact?: never;
};

/**
 * One ordered member of a current exact relationship. Render evidence is
 * deliberately absent from the durable v2 shape.
 */
export type ConnectionAnchorV2 = BackboneTokenAnchor & {
  /** Keeps common readers source-compatible while forbidding v2 locators. */
  render_locator?: never;
};

/** Anchor union for readers that intentionally support both durable formats. */
export type ConnectionAnchor = ConnectionAnchorV1 | ConnectionAnchorV2;

/** Byte-compatible legacy payload. New creation must never emit this shape. */
export type ConnectionContentV1 = {
  id: string;
  format_version: typeof CONNECTION_FORMAT_VERSION_V1;
  kind: ConnectionKind;
  label: string;
  anchors: ConnectionAnchorV1[];
};

/** Current payload: every member has immutable Backbone occurrence identity. */
export type ConnectionContentV2 = {
  id: string;
  format_version: typeof CONNECTION_FORMAT_VERSION_V2;
  kind: ConnectionKind;
  label: string;
  /** User-authored card body. Empty is a deliberate, durable state. */
  observation: string;
  anchors: ConnectionAnchorV2[];
};

/** Durable authored connection content, excluding its event envelope. */
export type ConnectionContent = ConnectionContentV1 | ConnectionContentV2;

/**
 * Current folded/materialized connection records.
 *
 * These fields are projected from authoritative LibraryEvent envelopes and
 * MUST NOT be serialized into that event's durable payload. activeEventId is
 * also the Derived optimistic-concurrency version.
 */
export type ConnectionRecordMetadata = {
  activeEventId: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionRecordV1 = ConnectionContentV1 & ConnectionRecordMetadata;
export type ConnectionRecordV2 = ConnectionContentV2 & ConnectionRecordMetadata;
export type ConnectionRecord = ConnectionRecordV1 | ConnectionRecordV2;

/** Input admitted for a new explicit user-authored connection. */
export type CreateConnectionInput = Omit<ConnectionContentV2, "id" | "format_version">;

/** Explicit legacy input type for readers/tools; not a new-create contract. */
export type LegacyConnectionInputV1 = Omit<ConnectionContentV1, "id" | "format_version">;

/** Payloads stored inside the common LibraryEvent envelope. */
export type ConnectionEventPayloadV1 = Omit<ConnectionContentV1, "id">;
export type ConnectionEventPayloadV2 = Omit<ConnectionContentV2, "id">;
export type ConnectionEventPayload = ConnectionEventPayloadV1 | ConnectionEventPayloadV2;

export type ConnectionValidationIssue = {
  code:
    | "invalid-record"
    | "invalid-id"
    | "unsupported-format-version"
    | "invalid-kind"
    | "invalid-label"
    | "invalid-observation"
    | "invalid-anchor-count"
    | "invalid-anchor"
    | "invalid-render-locator"
    | "invalid-exact-anchor"
    | "exact-anchor-refused";
  message: string;
  /** Preserves the exact canonical-anchor refusal/validation reason. */
  anchorCode?: BackboneTokenAnchorValidationCode;
};

export type ConnectionValidationResultFor<T extends ConnectionContent> =
  | { ok: true; value: T }
  | { ok: false; error: ConnectionValidationIssue };

export type ConnectionValidationResultV1 = ConnectionValidationResultFor<ConnectionContentV1>;
export type ConnectionValidationResultV2 = ConnectionValidationResultFor<ConnectionContentV2>;
export type ConnectionValidationResult = ConnectionValidationResultFor<ConnectionContent>;
