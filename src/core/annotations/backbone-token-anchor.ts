import { isValidBookCode, validateVerse } from "../reference/backbone.js";
import type { BackboneData, BookCode } from "../reference/types.js";

/**
 * Immutable, app-owned canonical token layer. Changing its tokenization mints a
 * new layer id; existing coordinates are never reinterpreted (INV-5, INV-17).
 */
export const BACKBONE_TOKEN_LAYER = "backbone-token:v1" as const;

/** Version of the immutable reference-data catalog carrying token counts. */
export const BACKBONE_TOKEN_CATALOG_FORMAT_VERSION = 1 as const;

/** Version of the exact-selector payload nested inside a connection anchor. */
export const BACKBONE_TOKEN_EXACT_FORMAT_VERSION = 1 as const;

/**
 * Phrase anchors are deliberately bounded before a host fingerprints or queues
 * them. The aggregate authored-command byte limit remains a second boundary.
 */
export const MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR = 2_048;

/** Verse envelope shared with the existing connection-anchor contract. */
export type BackboneTokenPassage = {
  book: BookCode;
  chapter: number;
  verse_start: number;
  verse_end: number;
};

/** One 1-based occurrence in canonical reading order within a single verse. */
export type BackboneTokenOccurrenceV1 = {
  verse: number;
  position: number;
};

/**
 * Translation-free exact phrase identity. Discontinuous selections are sets of
 * ordered occurrences rather than a range that could capture unrelated words.
 */
export type BackboneTokenExactSelectorV1 = {
  format_version: typeof BACKBONE_TOKEN_EXACT_FORMAT_VERSION;
  layer: typeof BACKBONE_TOKEN_LAYER;
  occurrences: BackboneTokenOccurrenceV1[];
};

/** Canonical portion of a future v2 ConnectionAnchor. */
export type BackboneTokenAnchor = BackboneTokenPassage & {
  exact: BackboneTokenExactSelectorV1;
};

/**
 * Pure injected reference-data boundary. Hosts may load the immutable catalog
 * however they choose; core only asks for the token count of one canonical
 * verse (INV-18).
 */
export type BackboneTokenCatalog = {
  readonly layer: string;
  readonly format_version: number;
  tokenCount(book: BookCode, chapter: number, verse: number): number | undefined;
};

export type BackboneTokenAnchorValidationStatus = "valid" | "invalid" | "refused";

export type BackboneTokenAnchorValidationCode =
  | "invalid-anchor"
  | "invalid-passage"
  | "invalid-exact-selector"
  | "unsupported-exact-format-version"
  | "unsupported-token-layer"
  | "invalid-occurrence-count"
  | "invalid-occurrence"
  | "duplicate-occurrence"
  | "unordered-occurrences"
  | "occurrence-out-of-passage"
  | "occurrence-out-of-range"
  | "catalog-unavailable"
  | "catalog-incompatible"
  | "catalog-verse-missing";

export type BackboneTokenAnchorValidationError = {
  code: BackboneTokenAnchorValidationCode;
  message: string;
};

export type BackboneTokenAnchorValidationResult =
  | {
      ok: true;
      status: "valid";
      value: BackboneTokenAnchor;
    }
  | {
      ok: false;
      status: Exclude<BackboneTokenAnchorValidationStatus, "valid">;
      error: BackboneTokenAnchorValidationError;
    };

const ANCHOR_KEYS = ["book", "chapter", "verse_start", "verse_end", "exact"] as const;
const SELECTOR_KEYS = ["format_version", "layer", "occurrences"] as const;
const OCCURRENCE_KEYS = ["verse", "position"] as const;

/**
 * Strictly validate one canonical exact phrase selector without throwing.
 * Translation render evidence is rejected as an unknown field rather than
 * accidentally becoming part of durable identity.
 */
export function validateBackboneTokenAnchor(
  input: unknown,
  backbone: BackboneData,
  catalog?: BackboneTokenCatalog | null,
): BackboneTokenAnchorValidationResult {
  if (!isRecord(input) || !hasOnlyKeys(input, ANCHOR_KEYS)) {
    return invalid("invalid-anchor", "Canonical token anchor must contain only its passage and exact selector.");
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
      "invalid-passage",
      "Canonical token anchor requires an uppercase USFM book and positive integer chapter/verse coordinates.",
    );
  }

  const numericChapter = chapter as number;
  const numericVerseStart = verseStart as number;
  const numericVerseEnd = verseEnd as number;
  if (numericVerseEnd < numericVerseStart) {
    return invalid("invalid-passage", "Canonical token anchor verse_end must not precede verse_start.");
  }

  const startValidation = validateVerse(backbone, {
    book,
    chapter: numericChapter,
    verse: numericVerseStart,
  });
  if (!startValidation.ok) {
    return invalid("invalid-passage", `Canonical token anchor start: ${startValidation.error}`);
  }
  const endValidation = validateVerse(backbone, {
    book,
    chapter: numericChapter,
    verse: numericVerseEnd,
  });
  if (!endValidation.ok) {
    return invalid("invalid-passage", `Canonical token anchor end: ${endValidation.error}`);
  }

  const selectorInput = input["exact"];
  if (!isRecord(selectorInput) || !hasOnlyKeys(selectorInput, SELECTOR_KEYS)) {
    return invalid(
      "invalid-exact-selector",
      "Canonical token exact selector must contain only format_version, layer, and occurrences.",
    );
  }

  const selectorVersion = selectorInput["format_version"];
  if (selectorVersion !== BACKBONE_TOKEN_EXACT_FORMAT_VERSION) {
    return refused(
      "unsupported-exact-format-version",
      `Exact selector format_version ${String(selectorVersion)} is unsupported; this app understands ${BACKBONE_TOKEN_EXACT_FORMAT_VERSION}.`,
    );
  }

  const layer = selectorInput["layer"];
  if (layer !== BACKBONE_TOKEN_LAYER) {
    return refused(
      "unsupported-token-layer",
      `Canonical token layer ${String(layer)} is unsupported; this app understands ${BACKBONE_TOKEN_LAYER}.`,
    );
  }

  const rawOccurrences = selectorInput["occurrences"];
  if (
    !Array.isArray(rawOccurrences)
    || rawOccurrences.length === 0
    || rawOccurrences.length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR
  ) {
    return invalid(
      "invalid-occurrence-count",
      `Exact selector requires 1 to ${MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR} canonical occurrences.`,
    );
  }

  const occurrences: BackboneTokenOccurrenceV1[] = [];
  let previous: BackboneTokenOccurrenceV1 | undefined;
  for (let index = 0; index < rawOccurrences.length; index++) {
    const rawOccurrence = rawOccurrences[index];
    if (!isRecord(rawOccurrence) || !hasOnlyKeys(rawOccurrence, OCCURRENCE_KEYS)) {
      return invalid(
        "invalid-occurrence",
        `Canonical token occurrence ${index} must contain only integer verse and position fields.`,
      );
    }
    const verse = rawOccurrence["verse"];
    const position = rawOccurrence["position"];
    if (!isPositiveSafeInteger(verse) || !isPositiveSafeInteger(position)) {
      return invalid(
        "invalid-occurrence",
        `Canonical token occurrence ${index} requires positive integer verse and position fields.`,
      );
    }

    const occurrence: BackboneTokenOccurrenceV1 = {
      verse: verse as number,
      position: position as number,
    };
    if (occurrence.verse < numericVerseStart || occurrence.verse > numericVerseEnd) {
      return invalid(
        "occurrence-out-of-passage",
        `Canonical token occurrence ${index} is outside the anchor passage.`,
      );
    }
    if (previous) {
      const order = compareOccurrences(previous, occurrence);
      if (order === 0) {
        return invalid("duplicate-occurrence", `Canonical token occurrence ${index} duplicates its predecessor.`);
      }
      if (order > 0) {
        return invalid(
          "unordered-occurrences",
          "Canonical token occurrences must be in strict verse/position order.",
        );
      }
    }
    occurrences.push(occurrence);
    previous = occurrence;
  }

  if (!catalog) {
    return refused("catalog-unavailable", `Canonical token catalog ${BACKBONE_TOKEN_LAYER} is unavailable.`);
  }
  if (
    catalog.layer !== BACKBONE_TOKEN_LAYER
    || catalog.format_version !== BACKBONE_TOKEN_CATALOG_FORMAT_VERSION
  ) {
    return refused(
      "catalog-incompatible",
      `Canonical token catalog ${catalog.layer} format ${catalog.format_version} cannot validate ${BACKBONE_TOKEN_LAYER}.`,
    );
  }

  const tokenCounts = new Map<number, number>();
  for (let index = 0; index < occurrences.length; index++) {
    const occurrence = occurrences[index]!;
    let tokenCount = tokenCounts.get(occurrence.verse);
    if (tokenCount === undefined) {
      try {
        tokenCount = catalog.tokenCount(book, numericChapter, occurrence.verse);
      } catch {
        return refused(
          "catalog-unavailable",
          `Canonical token catalog ${BACKBONE_TOKEN_LAYER} could not read ${book}.${numericChapter}.${occurrence.verse}.`,
        );
      }
      if (tokenCount === undefined) {
        return refused(
          "catalog-verse-missing",
          `Canonical token catalog ${BACKBONE_TOKEN_LAYER} has no entry for ${book}.${numericChapter}.${occurrence.verse}.`,
        );
      }
      if (!isPositiveSafeInteger(tokenCount)) {
        return refused(
          "catalog-incompatible",
          `Canonical token catalog ${BACKBONE_TOKEN_LAYER} has an invalid token count for ${book}.${numericChapter}.${occurrence.verse}.`,
        );
      }
      tokenCounts.set(occurrence.verse, tokenCount);
    }
    if (occurrence.position > tokenCount) {
      return invalid(
        "occurrence-out-of-range",
        `Canonical token occurrence ${index} position ${occurrence.position} exceeds ${book}.${numericChapter}.${occurrence.verse}'s ${tokenCount} tokens.`,
      );
    }
  }

  return {
    ok: true,
    status: "valid",
    value: {
      book,
      chapter: numericChapter,
      verse_start: numericVerseStart,
      verse_end: numericVerseEnd,
      exact: {
        format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
        layer: BACKBONE_TOKEN_LAYER,
        occurrences,
      },
    },
  };
}

/** Canonical passage envelope used by caches, projections, and diagnostics. */
export function backboneTokenPassageKey(passage: BackboneTokenPassage): string {
  const start = `${passage.book}.${passage.chapter}.${passage.verse_start}`;
  if (passage.verse_start === passage.verse_end) return `bref:v1/${start}`;
  return `bref:v1/${start}-${passage.book}.${passage.chapter}.${passage.verse_end}`;
}

/** Stable identity for one token occurrence; contains no translation evidence. */
export function backboneTokenOccurrenceKey(
  anchor: BackboneTokenAnchor,
  occurrence: BackboneTokenOccurrenceV1,
): string {
  return `bref:v1/${anchor.book}.${anchor.chapter}.${occurrence.verse}@${anchor.exact.layer}:${occurrence.position}`;
}

/** Stable identity for the complete passage plus its ordered occurrence set. */
export function backboneTokenAnchorKey(anchor: BackboneTokenAnchor): string {
  const occurrenceKeys = anchor.exact.occurrences
    .map((occurrence) => backboneTokenOccurrenceKey(anchor, occurrence))
    .join(",");
  return `${backboneTokenPassageKey(anchor)}#exact:${anchor.exact.format_version}[${occurrenceKeys}]`;
}

function compareOccurrences(
  left: BackboneTokenOccurrenceV1,
  right: BackboneTokenOccurrenceV1,
): number {
  if (left.verse !== right.verse) return left.verse - right.verse;
  return left.position - right.position;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalid(
  code: BackboneTokenAnchorValidationCode,
  message: string,
): BackboneTokenAnchorValidationResult {
  return { ok: false, status: "invalid", error: { code, message } };
}

function refused(
  code: BackboneTokenAnchorValidationCode,
  message: string,
): BackboneTokenAnchorValidationResult {
  return { ok: false, status: "refused", error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length
    && allowed.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
