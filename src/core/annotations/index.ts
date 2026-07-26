import { isValidBookCode, validateVerse } from "../reference/backbone.js";
import type { BackboneData } from "../reference/types.js";
import {
  validateBackboneTokenAnchor,
} from "./backbone-token-anchor.js";
import type {
  BackboneTokenCatalog,
} from "./backbone-token-anchor.js";
import { migrateRetiredV2AnchorFields } from "./retired-anchor-fields.js";
import {
  CONNECTION_FORMAT_VERSION,
  CONNECTION_FORMAT_VERSION_V1,
  CONNECTION_FORMAT_VERSION_V2,
  CONNECTION_KINDS,
  MAX_CONNECTION_ANCHORS,
  MAX_CONNECTION_LABEL_LENGTH,
  MAX_CONNECTION_OBSERVATION_LENGTH,
  MAX_CONNECTION_PACKAGE_ID_LENGTH,
  MAX_CONNECTION_QUOTE_LENGTH,
} from "./types.js";
import type {
  BinaryConnectionKind,
  ConnectionAnchorV1,
  ConnectionAnchorV2,
  ConnectionKind,
  ConnectionRenderLocator,
  ConnectionValidationIssue,
  ConnectionValidationResult,
  ConnectionValidationResultV1,
  ConnectionValidationResultV2,
} from "./types.js";

const CONNECTION_KIND_SET: ReadonlySet<string> = new Set(CONNECTION_KINDS);
const BINARY_CONNECTION_KINDS: ReadonlySet<ConnectionKind> = new Set([
  "link:contrast",
  "mirror",
  "hinge",
]);

const CONTENT_V1_KEYS = ["id", "format_version", "kind", "label", "anchors"] as const;
const CONTENT_V2_KEYS = [
  "id",
  "format_version",
  "kind",
  "label",
  "observation",
  "anchors",
] as const;
const V1_ANCHOR_KEYS = ["book", "chapter", "verse_start", "verse_end", "render_locator"] as const;
const V1_ANCHOR_REQUIRED_KEYS = ["book", "chapter", "verse_start", "verse_end"] as const;
const RENDER_LOCATOR_KEYS = ["package", "char_start", "char_end", "quote"] as const;

type ValidEnvelope = {
  input: Record<string, unknown>;
  id: string;
  formatVersion: number;
};

/**
 * Which side of the durability boundary a v2 parse is standing on.
 *
 * "existing-history" reads bytes that are already committed to the append-only
 * log, so it applies the named retired-field migrations first. "new-authoring"
 * is the create/update path and applies none of them, so a field retired from
 * the format can never re-enter the log through a new record.
 */
type ConnectionV2ParseOrigin = "existing-history" | "new-authoring";

type ParsedCommonFields = {
  id: string;
  kind: ConnectionKind;
  label: string;
  rawAnchors: unknown[];
};

export function isConnectionKind(value: unknown): value is ConnectionKind {
  return typeof value === "string" && CONNECTION_KIND_SET.has(value);
}

export function isBinaryConnectionKind(kind: ConnectionKind): kind is BinaryConnectionKind {
  return BINARY_CONNECTION_KINDS.has(kind);
}

/**
 * Parse either supported durable format for folding/read paths. The format
 * discriminator is checked before kind, label, or anchors are traversed, so a
 * newer payload is refused without being partially interpreted (INV-17).
 */
export function validateConnectionRecord(
  input: unknown,
  backbone: BackboneData,
  tokenCatalog?: BackboneTokenCatalog | null,
): ConnectionValidationResult {
  const envelope = parseEnvelope(input);
  if (!envelope.ok) return envelope;

  switch (envelope.value.formatVersion) {
    case CONNECTION_FORMAT_VERSION_V1:
      return parseConnectionV1(envelope.value, backbone);
    case CONNECTION_FORMAT_VERSION_V2:
      return parseConnectionV2(envelope.value, backbone, tokenCatalog, "existing-history");
    default:
      return unsupportedVersion(envelope.value.id, envelope.value.formatVersion);
  }
}

/** Explicit read path for byte-compatible passage-level v1 records. */
export function validateLegacyConnectionRecord(
  input: unknown,
  backbone: BackboneData,
): ConnectionValidationResultV1 {
  const envelope = parseEnvelope(input);
  if (!envelope.ok) return envelope;
  if (envelope.value.formatVersion !== CONNECTION_FORMAT_VERSION_V1) {
    return unsupportedVersion(envelope.value.id, envelope.value.formatVersion);
  }
  return parseConnectionV1(envelope.value, backbone);
}

/**
 * Explicit new-create path. New authored connections require v2 and a usable
 * immutable token catalog; this helper never falls back to v1.
 *
 * It also never applies the retired-field migrations in
 * ./retired-anchor-fields.js. A newly authored anchor carrying a retired field
 * such as `selection_shape` is refused here, so those migrations stay scoped to
 * history that already exists.
 */
export function validateNewConnectionRecord(
  input: unknown,
  backbone: BackboneData,
  tokenCatalog?: BackboneTokenCatalog | null,
): ConnectionValidationResultV2 {
  const envelope = parseEnvelope(input);
  if (!envelope.ok) return envelope;
  if (envelope.value.formatVersion !== CONNECTION_FORMAT_VERSION_V2) {
    return unsupportedVersion(envelope.value.id, envelope.value.formatVersion);
  }
  return parseConnectionV2(envelope.value, backbone, tokenCatalog, "new-authoring");
}

function parseConnectionV1(
  envelope: ValidEnvelope,
  backbone: BackboneData,
): ConnectionValidationResultV1 {
  const common = parseCommonFields(envelope, CONTENT_V1_KEYS);
  if (!common.ok) return common;

  const anchors: ConnectionAnchorV1[] = [];
  for (let ordinal = 0; ordinal < common.value.rawAnchors.length; ordinal++) {
    const parsed = parseLegacyAnchor(
      common.value.rawAnchors[ordinal],
      backbone,
      common.value.id,
      ordinal,
    );
    if (!parsed.ok) return parsed;
    anchors.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      id: common.value.id,
      format_version: CONNECTION_FORMAT_VERSION_V1,
      kind: common.value.kind,
      label: common.value.label,
      anchors,
    },
  };
}

function parseConnectionV2(
  envelope: ValidEnvelope,
  backbone: BackboneData,
  tokenCatalog: BackboneTokenCatalog | null | undefined,
  origin: ConnectionV2ParseOrigin,
): ConnectionValidationResultV2 {
  const common = parseCommonFields(envelope, CONTENT_V2_KEYS);
  if (!common.ok) return common;

  const observation = envelope.input["observation"];
  if (
    typeof observation !== "string"
    || observation.length > MAX_CONNECTION_OBSERVATION_LENGTH
  ) {
    return invalid(
      "invalid-observation",
      `Connection ${common.value.id} observation must be a string no longer than ${MAX_CONNECTION_OBSERVATION_LENGTH} characters.`,
    );
  }

  const anchors: ConnectionAnchorV2[] = [];
  for (let ordinal = 0; ordinal < common.value.rawAnchors.length; ordinal++) {
    // Committed history may still carry fields that were retired from the v2
    // anchor shape without a migration. Strip those enumerated names here, on
    // the read path only, so validateBackboneTokenAnchor stays closed for
    // everything that constitutes durable identity. New authoring skips this.
    const rawAnchor = origin === "existing-history"
      ? migrateRetiredV2AnchorFields(common.value.rawAnchors[ordinal])
      : common.value.rawAnchors[ordinal];
    const parsed = validateBackboneTokenAnchor(
      rawAnchor,
      backbone,
      tokenCatalog,
    );
    if (!parsed.ok) {
      const code = parsed.status === "refused" ? "exact-anchor-refused" : "invalid-exact-anchor";
      return invalid(
        code,
        `Connection ${common.value.id} anchor ${ordinal}: ${parsed.error.message}`,
        parsed.error.code,
      );
    }
    anchors.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      id: common.value.id,
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind: common.value.kind,
      label: common.value.label,
      observation,
      anchors,
    },
  };
}

function parseEnvelope(
  input: unknown,
): { ok: true; value: ValidEnvelope } | { ok: false; error: ConnectionValidationIssue } {
  if (!isRecord(input)) {
    return invalid("invalid-record", "Connection must be an object.");
  }

  const id = input["id"];
  if (typeof id !== "string" || id.trim().length === 0) {
    return invalid("invalid-id", "Connection id must be a non-empty string.");
  }

  const formatVersion = input["format_version"];
  if (!Number.isSafeInteger(formatVersion)) {
    return unsupportedVersion(id, formatVersion);
  }

  return {
    ok: true,
    value: {
      input,
      id,
      formatVersion: formatVersion as number,
    },
  };
}

function parseCommonFields(
  envelope: ValidEnvelope,
  contentKeys: readonly string[],
): { ok: true; value: ParsedCommonFields } | { ok: false; error: ConnectionValidationIssue } {
  const { input, id } = envelope;
  if (!hasExactKeys(input, contentKeys)) {
    return invalid(
      "invalid-record",
      `Connection ${id} does not match the closed format_version ${envelope.formatVersion} shape.`,
    );
  }

  const kind = input["kind"];
  if (!isConnectionKind(kind)) {
    return invalid("invalid-kind", `Connection ${id} has an unknown kind.`);
  }

  const label = input["label"];
  if (
    typeof label !== "string"
    || label.length === 0
    || label.length > MAX_CONNECTION_LABEL_LENGTH
    || label.trim().length === 0
  ) {
    return invalid(
      "invalid-label",
      `Connection ${id} must have a non-empty label no longer than ${MAX_CONNECTION_LABEL_LENGTH} characters.`,
    );
  }

  const rawAnchors = input["anchors"];
  if (!Array.isArray(rawAnchors)) {
    return invalid("invalid-anchor-count", `Connection ${id} anchors must be an ordered array.`);
  }
  if (
    rawAnchors.length < 2
    || rawAnchors.length > MAX_CONNECTION_ANCHORS
    || (isBinaryConnectionKind(kind) && rawAnchors.length !== 2)
  ) {
    const expected = isBinaryConnectionKind(kind) ? "exactly two" : "at least two";
    return invalid(
      "invalid-anchor-count",
      `Connection ${id} kind ${kind} requires ${expected} and no more than ${MAX_CONNECTION_ANCHORS} anchors.`,
    );
  }

  return { ok: true, value: { id, kind, label, rawAnchors } };
}

function parseLegacyAnchor(
  input: unknown,
  backbone: BackboneData,
  connectionId: string,
  ordinal: number,
): { ok: true; value: ConnectionAnchorV1 } | { ok: false; error: ConnectionValidationIssue } {
  const prefix = `Connection ${connectionId} anchor ${ordinal}`;
  if (
    !isRecord(input)
    || !hasOnlyKeys(input, V1_ANCHOR_KEYS)
    || !hasEveryKey(input, V1_ANCHOR_REQUIRED_KEYS)
  ) {
    return invalid(
      "invalid-anchor",
      `${prefix} must contain only its passage and optional render_locator.`,
    );
  }

  const book = input["book"];
  const chapter = input["chapter"];
  const verseStart = input["verse_start"];
  const verseEnd = input["verse_end"];
  if (
    typeof book !== "string"
    || !isValidBookCode(book)
    || !isPositiveSafeInteger(chapter)
    || !isPositiveSafeInteger(verseStart)
    || !isPositiveSafeInteger(verseEnd)
  ) {
    return invalid(
      "invalid-anchor",
      `${prefix} must use an uppercase USFM book and positive integer chapter/verse coordinates.`,
    );
  }

  const numericChapter = chapter as number;
  const numericVerseStart = verseStart as number;
  const numericVerseEnd = verseEnd as number;
  if (numericVerseEnd < numericVerseStart) {
    return invalid("invalid-anchor", `${prefix} verse_end must not precede verse_start.`);
  }

  const startResult = validateVerse(backbone, {
    book,
    chapter: numericChapter,
    verse: numericVerseStart,
  });
  if (!startResult.ok) {
    return invalid("invalid-anchor", `${prefix}: ${startResult.error}`);
  }
  const endResult = validateVerse(backbone, {
    book,
    chapter: numericChapter,
    verse: numericVerseEnd,
  });
  if (!endResult.ok) {
    return invalid("invalid-anchor", `${prefix}: ${endResult.error}`);
  }

  const renderLocatorInput = input["render_locator"];
  let renderLocator: ConnectionRenderLocator | undefined;
  if (renderLocatorInput !== undefined) {
    const parsedLocator = parseRenderLocator(renderLocatorInput, prefix);
    if (!parsedLocator.ok) return parsedLocator;
    renderLocator = parsedLocator.value;
  }

  return {
    ok: true,
    value: {
      book,
      chapter: numericChapter,
      verse_start: numericVerseStart,
      verse_end: numericVerseEnd,
      ...(renderLocator ? { render_locator: renderLocator } : {}),
    },
  };
}

function parseRenderLocator(
  input: unknown,
  prefix: string,
): { ok: true; value: ConnectionRenderLocator } | { ok: false; error: ConnectionValidationIssue } {
  if (!isRecord(input) || !hasExactKeys(input, RENDER_LOCATOR_KEYS)) {
    return invalid(
      "invalid-render-locator",
      `${prefix} render_locator must contain only package, char_start, char_end, and quote.`,
    );
  }
  const packageId = input["package"];
  const charStart = input["char_start"];
  const charEnd = input["char_end"];
  const quote = input["quote"];
  if (
    typeof packageId !== "string"
    || packageId.length === 0
    || packageId.length > MAX_CONNECTION_PACKAGE_ID_LENGTH
    || packageId.trim().length === 0
    || !Number.isSafeInteger(charStart)
    || !Number.isSafeInteger(charEnd)
    || typeof quote !== "string"
    || quote.length > MAX_CONNECTION_QUOTE_LENGTH
  ) {
    return invalid(
      "invalid-render-locator",
      `${prefix} render_locator requires package, integer char_start/char_end, and quote.`,
    );
  }
  const numericCharStart = charStart as number;
  const numericCharEnd = charEnd as number;
  if (numericCharStart < 0 || numericCharEnd < numericCharStart) {
    return invalid(
      "invalid-render-locator",
      `${prefix} render_locator offsets must be non-negative and ordered.`,
    );
  }
  return {
    ok: true,
    value: {
      package: packageId,
      char_start: numericCharStart,
      char_end: numericCharEnd,
      quote,
    },
  };
}

function unsupportedVersion(
  id: string,
  formatVersion: unknown,
): { ok: false; error: ConnectionValidationIssue } {
  return invalid(
    "unsupported-format-version",
    `Connection ${id} uses unsupported format_version ${String(formatVersion)}; this app reads ${CONNECTION_FORMAT_VERSION_V1} and ${CONNECTION_FORMAT_VERSION_V2} and creates ${CONNECTION_FORMAT_VERSION}.`,
  );
}

function invalid(
  code: ConnectionValidationIssue["code"],
  message: string,
  anchorCode?: ConnectionValidationIssue["anchorCode"],
): { ok: false; error: ConnectionValidationIssue } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(anchorCode ? { anchorCode } : {}),
    },
  };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasEveryKey(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && hasEveryKey(value, expected);
}

export {
  RETIRED_CONNECTION_ANCHOR_FIELDS,
  migrateRetiredV2AnchorFields,
} from "./retired-anchor-fields.js";

export type { RetiredConnectionAnchorField } from "./retired-anchor-fields.js";

export {
  CONNECTION_FORMAT_VERSION,
  CONNECTION_FORMAT_VERSION_V1,
  CONNECTION_FORMAT_VERSION_V2,
  CONNECTION_KINDS,
  MAX_CONNECTION_ANCHORS,
  MAX_CONNECTION_LABEL_LENGTH,
  MAX_CONNECTION_OBSERVATION_LENGTH,
  MAX_CONNECTION_PACKAGE_ID_LENGTH,
  MAX_CONNECTION_QUOTE_LENGTH,
} from "./types.js";

export type {
  BinaryConnectionKind,
  ConnectionAnchor,
  ConnectionAnchorV1,
  ConnectionAnchorV2,
  ConnectionContent,
  ConnectionContentV1,
  ConnectionContentV2,
  ConnectionEventPayload,
  ConnectionEventPayloadV1,
  ConnectionEventPayloadV2,
  ConnectionKind,
  ConnectionRecord,
  ConnectionRecordMetadata,
  ConnectionRecordV1,
  ConnectionRecordV2,
  ConnectionRenderLocator,
  ConnectionValidationIssue,
  ConnectionValidationResult,
  ConnectionValidationResultFor,
  ConnectionValidationResultV1,
  ConnectionValidationResultV2,
  CreateConnectionInput,
  LegacyConnectionInputV1,
} from "./types.js";
