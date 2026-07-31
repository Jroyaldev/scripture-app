import { isValidBookCode } from "../reference/backbone.js";
import type { BookCode } from "../reference/types.js";
import {
  BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR,
  type BackboneTokenAnchor,
  type BackboneTokenOccurrenceV1,
} from "./backbone-token-anchor.js";

/** Version of one package's canonical-occurrence-to-display-text artifact. */
export const OCCURRENCE_ALIGNMENT_FORMAT_VERSION = 1 as const;

/** Defensive bounds applied before alignment rows are copied or traversed. */
export const MAX_OCCURRENCE_ALIGNMENT_FRAGMENTS_PER_VERSE = 8_192;

/**
 * Compact artifact tuple. Text is intentionally absent: SHA-bound package text
 * is the sole render source and the quote is derived with UTF-16 `slice`.
 */
export type OccurrenceAlignmentFragmentV1 =
  | readonly [
      char_start: number,
      char_end: number,
      occurrence_positions: readonly number[],
    ]
  | readonly [
      char_start: number,
      char_end: number,
      occurrence_positions: readonly number[],
      group: number,
    ];

/**
 * A present target normally omits target_state. `present` is accepted so a
 * future writer can make the default explicit without changing the format.
 */
export type PresentOccurrenceAlignmentVerseV1 = {
  readonly type: "occurrence-alignment-verse";
  readonly format_version: typeof OCCURRENCE_ALIGNMENT_FORMAT_VERSION;
  readonly layer: typeof BACKBONE_TOKEN_LAYER;
  readonly package_id: string;
  readonly ref: string;
  readonly target_state?: "present";
  readonly text_sha256: string;
  readonly text_utf16_length: number;
  readonly fragments: readonly OccurrenceAlignmentFragmentV1[];
};

/**
 * Canonical slots can exist where a package intentionally has no target verse
 * (for example, an edition-critical variant). Absence is data, not a cue to
 * search nearby text or fabricate a projection.
 */
export type AbsentOccurrenceAlignmentVerseV1 = {
  readonly type: "occurrence-alignment-verse";
  readonly format_version: typeof OCCURRENCE_ALIGNMENT_FORMAT_VERSION;
  readonly layer: typeof BACKBONE_TOKEN_LAYER;
  readonly package_id: string;
  readonly ref: string;
  readonly target_state: "absent";
  readonly fragments: readonly [];
};

export type OccurrenceAlignmentVerseV1 =
  | PresentOccurrenceAlignmentVerseV1
  | AbsentOccurrenceAlignmentVerseV1;

/** Core receives hashing as a pure dependency; hosts choose the implementation. */
export type Sha256Text = (text: string) => string;

export type OccurrenceAlignmentExpectation = {
  readonly package_id: string;
  readonly book: BookCode;
  readonly chapter: number;
  readonly verse: number;
  /** Omitted only when the package has no target verse at this reference. */
  readonly text?: string;
  readonly sha256: Sha256Text;
};

export type OccurrenceAlignmentIssueCode =
  | "invalid-validation-context"
  | "invalid-artifact"
  | "unsupported-alignment-format-version"
  | "unsupported-token-layer"
  | "artifact-package-mismatch"
  | "artifact-reference-mismatch"
  | "target-absent"
  | "target-text-missing"
  | "stale-text-length"
  | "stale-text-digest"
  | "digest-unavailable"
  | "invalid-fragment"
  | "fragment-overlap"
  | "fragment-coverage-gap"
  | "invalid-occurrence-position"
  | "invalid-selection"
  | "mixed-selection-passage"
  | "selection-quote-mismatch"
  | "selection-round-trip-mismatch"
  | "selection-splits-unicode"
  | "overlapping-selection"
  | "partial-word-selection"
  | "display-only-selection"
  | "zero-canonical-occurrences"
  | "too-many-canonical-occurrences"
  | "artifact-missing"
  | "ambiguous-verse-evidence"
  | "invalid-anchor"
  | "unsupported-exact-format-version"
  | "occurrence-unavailable";

export type OccurrenceAlignmentIssue = {
  readonly code: OccurrenceAlignmentIssueCode;
  readonly message: string;
};

export type OccurrenceAlignmentValidationResult =
  | {
      readonly ok: true;
      readonly status: "valid";
      readonly value: OccurrenceAlignmentVerseV1;
    }
  | {
      readonly ok: false;
      readonly status: "invalid" | "refused";
      readonly error: OccurrenceAlignmentIssue;
    };

/** Strictly validate and clone one JSONL verse row without throwing. */
export function validateOccurrenceAlignmentVerse(
  input: unknown,
  expectation: OccurrenceAlignmentExpectation,
): OccurrenceAlignmentValidationResult {
  if (!isValidExpectation(expectation)) {
    return alignmentInvalid(
      "invalid-validation-context",
      "Occurrence-alignment validation requires a package id, canonical verse, optional target text, and SHA-256 function.",
    );
  }
  if (!isRecord(input)) {
    return alignmentInvalid("invalid-artifact", "Occurrence-alignment verse must be an object.");
  }

  const targetState = input["target_state"];
  const isAbsent = targetState === "absent";
  const allowedKeys = isAbsent ? ABSENT_VERSE_KEYS : PRESENT_VERSE_KEYS;
  const requiredKeys = isAbsent ? ABSENT_VERSE_KEYS : PRESENT_REQUIRED_VERSE_KEYS;
  if (!hasRequiredAndOnlyKeys(input, requiredKeys, allowedKeys)) {
    return alignmentInvalid(
      "invalid-artifact",
      isAbsent
        ? "Absent occurrence-alignment verse must contain only its identity, target_state, and empty fragments."
        : "Present occurrence-alignment verse has missing or unknown fields.",
    );
  }
  if (input["type"] !== "occurrence-alignment-verse") {
    return alignmentInvalid("invalid-artifact", "Occurrence-alignment row has an invalid type.");
  }
  if (input["format_version"] !== OCCURRENCE_ALIGNMENT_FORMAT_VERSION) {
    return alignmentRefused(
      "unsupported-alignment-format-version",
      `Occurrence-alignment format ${String(input["format_version"])} is unsupported.`,
    );
  }
  if (input["layer"] !== BACKBONE_TOKEN_LAYER) {
    return alignmentRefused(
      "unsupported-token-layer",
      `Occurrence-alignment layer ${String(input["layer"])} is unsupported.`,
    );
  }
  if (input["package_id"] !== expectation.package_id) {
    return alignmentRefused(
      "artifact-package-mismatch",
      `Occurrence-alignment package ${String(input["package_id"])} does not match ${expectation.package_id}.`,
    );
  }
  const expectedRef = canonicalVerseRef(expectation.book, expectation.chapter, expectation.verse);
  if (input["ref"] !== expectedRef) {
    return alignmentRefused(
      "artifact-reference-mismatch",
      `Occurrence-alignment reference ${String(input["ref"])} does not match ${expectedRef}.`,
    );
  }

  const rawFragments = input["fragments"];
  if (!Array.isArray(rawFragments) || rawFragments.length > MAX_OCCURRENCE_ALIGNMENT_FRAGMENTS_PER_VERSE) {
    return alignmentInvalid(
      "invalid-artifact",
      `Occurrence-alignment fragments must be an array of at most ${MAX_OCCURRENCE_ALIGNMENT_FRAGMENTS_PER_VERSE} entries.`,
    );
  }

  if (isAbsent) {
    if (rawFragments.length !== 0) {
      return alignmentInvalid("invalid-artifact", "An absent target verse cannot contain render fragments.");
    }
    return {
      ok: true,
      status: "valid",
      value: {
        type: "occurrence-alignment-verse",
        format_version: OCCURRENCE_ALIGNMENT_FORMAT_VERSION,
        layer: BACKBONE_TOKEN_LAYER,
        package_id: expectation.package_id,
        ref: expectedRef,
        target_state: "absent",
        fragments: [],
      },
    };
  }

  if (targetState !== undefined && targetState !== "present") {
    return alignmentInvalid("invalid-artifact", `Invalid target_state ${String(targetState)}.`);
  }
  const text = expectation.text;
  if (text === undefined) {
    return alignmentRefused("target-text-missing", `Target text for ${expectedRef} is unavailable.`);
  }
  const textLength = input["text_utf16_length"];
  if (!isNonNegativeSafeInteger(textLength)) {
    return alignmentInvalid("invalid-artifact", "text_utf16_length must be a non-negative safe integer.");
  }
  if (textLength !== text.length) {
    return alignmentRefused(
      "stale-text-length",
      `Occurrence-alignment text length ${textLength} does not match target UTF-16 length ${text.length}.`,
    );
  }
  const storedDigest = input["text_sha256"];
  if (typeof storedDigest !== "string" || !SHA256_HEX.test(storedDigest)) {
    return alignmentInvalid("invalid-artifact", "text_sha256 must be a lowercase SHA-256 hex digest.");
  }
  const digest = digestText(text, expectation.sha256);
  if (!digest.ok) return digest.result;
  if (digest.value !== storedDigest) {
    return alignmentRefused(
      "stale-text-digest",
      `Occurrence-alignment digest does not match target text for ${expectedRef}.`,
    );
  }

  const fragments: OccurrenceAlignmentFragmentV1[] = [];
  let previousEnd = 0;
  for (let index = 0; index < rawFragments.length; index++) {
    const validation = validateFragment(rawFragments[index], index, text, previousEnd);
    if (!validation.ok) return validation.result;
    fragments.push(validation.value);
    previousEnd = validation.value[1];
  }
  if (previousEnd !== text.length) {
    return alignmentInvalid(
      "fragment-coverage-gap",
      `Occurrence-alignment fragments end at ${previousEnd}, not target UTF-16 length ${text.length}.`,
    );
  }

  const base = {
    type: "occurrence-alignment-verse" as const,
    format_version: OCCURRENCE_ALIGNMENT_FORMAT_VERSION,
    layer: BACKBONE_TOKEN_LAYER,
    package_id: expectation.package_id,
    ref: expectedRef,
    text_sha256: storedDigest,
    text_utf16_length: text.length,
    fragments,
  };
  return {
    ok: true,
    status: "valid",
    value: targetState === "present" ? { ...base, target_state: "present" } : base,
  };
}

export type OccurrenceAlignmentVerseEvidence = {
  readonly book: BookCode;
  readonly chapter: number;
  readonly verse: number;
  readonly text?: string;
  readonly alignment?: unknown | null;
};

export type OccurrenceSelectionPiece = {
  readonly book: BookCode;
  readonly chapter: number;
  readonly verse: number;
  readonly char_start: number;
  readonly char_end: number;
  readonly quote: string;
};

export type CaptureOccurrenceSelectionRequest = {
  readonly package_id: string;
  readonly selections: readonly OccurrenceSelectionPiece[];
  readonly verses: readonly OccurrenceAlignmentVerseEvidence[];
  readonly sha256: Sha256Text;
};

export type CaptureOccurrenceSelectionResult =
  | {
      readonly ok: true;
      readonly status: "exact";
      readonly anchor: BackboneTokenAnchor;
      /**
       * Package-local render evidence for the words this anchor actually
       * holds, so the reader is shown the settled phrase before authoring.
       * It is transport-only: it never enters the durable anchor, never
       * reaches an event payload, and no persisted key changes because of it
       * (ANCHOR_KEYS stays closed — see retired-anchor-fields.ts).
       */
      readonly settled?: readonly OccurrenceProjectionFragment[];
    }
  | {
      readonly ok: false;
      readonly status: "refused";
      readonly error: OccurrenceAlignmentIssue;
    };

/**
 * Capture exact package selections as translation-free canonical occurrences.
 * Render text, quotes, character offsets, and package identity never enter the
 * returned durable anchor.
 */
export function captureOccurrenceAlignedSelection(
  request: CaptureOccurrenceSelectionRequest,
): CaptureOccurrenceSelectionResult {
  if (!isValidPackageId(request.package_id) || !Array.isArray(request.selections) || request.selections.length === 0) {
    return captureRefused("invalid-selection", "Capture requires a package id and at least one selection piece.");
  }
  const indexedEvidence = indexVerseEvidence(request.verses);
  if (!indexedEvidence.ok) return captureRefused(indexedEvidence.error.code, indexedEvidence.error.message);

  const selections: OccurrenceSelectionPiece[] = [];
  let selectedBook: BookCode | undefined;
  let selectedChapter: number | undefined;
  for (let index = 0; index < request.selections.length; index++) {
    const selection = request.selections[index];
    if (
      !selection
      || !isValidBookCode(selection.book)
      || !isPositiveSafeInteger(selection.chapter)
      || !isPositiveSafeInteger(selection.verse)
      || !isNonNegativeSafeInteger(selection.char_start)
      || !isPositiveSafeInteger(selection.char_end)
      || selection.char_end <= selection.char_start
      || typeof selection.quote !== "string"
    ) {
      return captureRefused("invalid-selection", `Selection piece ${index} is malformed.`);
    }
    if (selectedBook === undefined) {
      selectedBook = selection.book;
      selectedChapter = selection.chapter;
    } else if (selection.book !== selectedBook || selection.chapter !== selectedChapter) {
      return captureRefused(
        "mixed-selection-passage",
        "All exact selection pieces must belong to one book and chapter.",
      );
    }
    selections.push({ ...selection });
  }
  selections.sort(compareSelections);
  for (let index = 1; index < selections.length; index++) {
    const previous = selections[index - 1]!;
    const current = selections[index]!;
    if (current.verse === previous.verse && current.char_start < previous.char_end) {
      return captureRefused(
        "overlapping-selection",
        `Selection pieces overlap in verse ${current.verse}; capture is ambiguous.`,
      );
    }
  }

  const validatedRows = new Map<string, PresentOccurrenceAlignmentVerseV1>();
  const occurrenceKeys = new Set<string>();
  let verseStart = Number.POSITIVE_INFINITY;
  let verseEnd = 0;
  for (const selection of selections) {
    verseStart = Math.min(verseStart, selection.verse);
    verseEnd = Math.max(verseEnd, selection.verse);
    const key = verseEvidenceKey(selection.book, selection.chapter, selection.verse);
    const evidence = indexedEvidence.value.get(key);
    if (!evidence || evidence.alignment === undefined || evidence.alignment === null) {
      return captureRefused("artifact-missing", `Occurrence alignment for ${key} is unavailable.`);
    }
    let alignment = validatedRows.get(key);
    if (!alignment) {
      const validation = validateOccurrenceAlignmentVerse(evidence.alignment, {
        package_id: request.package_id,
        book: selection.book,
        chapter: selection.chapter,
        verse: selection.verse,
        text: evidence.text,
        sha256: request.sha256,
      });
      if (!validation.ok) return captureRefused(validation.error.code, validation.error.message);
      if (validation.value.target_state === "absent") {
        return captureRefused("target-absent", `Package ${request.package_id} has no target verse at ${key}.`);
      }
      alignment = validation.value;
      validatedRows.set(key, alignment);
    }

    if (evidence.text === undefined) {
      return captureRefused("target-text-missing", `Target text for ${key} is unavailable.`);
    }

    const selectionCheck = validateSelectionAgainstText(selection, evidence.text);
    if (!selectionCheck.ok) return captureRefused(selectionCheck.error.code, selectionCheck.error.message);
    for (const fragment of alignment.fragments) {
      const fragmentStart = fragment[0];
      const fragmentEnd = fragment[1];
      const fragmentPositions = fragment[2];
      const fragmentText = evidence.text.slice(fragmentStart, fragmentEnd);
      if (!rangesOverlap(selection.char_start, selection.char_end, fragmentStart, fragmentEnd)) continue;
      if (!hasLexicalContent(fragmentText)) continue;
      if (selection.char_start > fragmentStart || selection.char_end < fragmentEnd) {
        return captureRefused(
          "partial-word-selection",
          `Selection ${key}:${selection.char_start}-${selection.char_end} cuts lexical fragment ${fragmentStart}-${fragmentEnd}.`,
        );
      }
      if (fragmentPositions.length === 0) {
        return captureRefused(
          "display-only-selection",
          `Selection includes display-only lexical text ${JSON.stringify(fragmentText)} with no canonical occurrence.`,
        );
      }
      for (const position of fragmentPositions) {
        occurrenceKeys.add(`${selection.verse}:${position}`);
      }
    }
  }

  if (occurrenceKeys.size === 0) {
    return captureRefused(
      "zero-canonical-occurrences",
      "Selection contains no canonical token occurrences; punctuation and whitespace alone cannot form an exact anchor.",
    );
  }
  if (occurrenceKeys.size > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR) {
    return captureRefused(
      "too-many-canonical-occurrences",
      `Selection exceeds the ${MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR}-occurrence anchor limit.`,
    );
  }
  const occurrences = [...occurrenceKeys]
    .map(parseOccurrenceKey)
    .sort(compareOccurrences);
  return {
    ok: true,
    status: "exact",
    anchor: {
      book: selectedBook!,
      chapter: selectedChapter!,
      verse_start: verseStart,
      verse_end: verseEnd,
      exact: {
        format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
        layer: BACKBONE_TOKEN_LAYER,
        occurrences,
      },
    },
  };
}

export type OccurrenceProjectionFragment = {
  readonly verse: number;
  readonly char_start: number;
  readonly char_end: number;
  readonly quote: string;
};

/**
 * Compare active-package capture and reprojection at the lexical-word level.
 * Character offsets, punctuation, whitespace, and display grouping are render
 * evidence; added or removed words are not. Keeping this in core makes the
 * authoring admission rule deterministic without storing package evidence on
 * a durable anchor (INV-5).
 */
export function lexicalWordsForRoundTrip(text: string): readonly string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
}

export function selectionProjectionRoundTrips(
  selections: readonly Pick<OccurrenceSelectionPiece, "verse" | "char_start" | "quote">[],
  projection: readonly Pick<OccurrenceProjectionFragment, "verse" | "char_start" | "quote">[],
): boolean {
  const comparePiece = (
    left: { verse: number; char_start: number },
    right: { verse: number; char_start: number },
  ): number => left.verse - right.verse || left.char_start - right.char_start;
  const selectedWords = [...selections]
    .sort(comparePiece)
    .flatMap((piece) => lexicalWordsForRoundTrip(piece.quote));
  const projectedWords = [...projection]
    .sort(comparePiece)
    .flatMap((piece) => lexicalWordsForRoundTrip(piece.quote));
  return selectedWords.length === projectedWords.length
    && selectedWords.every((word, index) => word === projectedWords[index]);
}

/**
 * Authoring admission rule (2026-07-31 — the Old Testament connection fix).
 *
 * RESTATES the equality rule above, which authoring used until today. That
 * rule said: a selection is admissible only if reprojecting its anchor
 * reproduces the selected words EXACTLY. Under it the Old Testament was
 * effectively unauthorable — `backbone-token:v1` is the ORIGINAL-LANGUAGE
 * word layer (Hebrew for the OT, Greek for the NT; see
 * data/scripture/backbone-token-v1.jsonl), and a Hebrew word carries its
 * prepositions, articles, conjunctions and pronominal suffixes inside itself.
 * The publisher tables agree: BSB's own alignment row for GEN 1:1 is
 * `{"word":"In the beginning","strongs":["H7225"]}` — three English words,
 * one canonical token. So almost every single English word an OT reader
 * marked reprojected wider than itself and was refused. Measured live on this
 * branch before the fix: single-word admission was 9-21% across BSB/WEB/KJV/
 * YLT in GEN 1, DEU 32, PSA 23 and ISA 53, against 37-65% in JHN 1 and ROM 8.
 *
 * The new rule keeps the same durable identity and the same precision bar and
 * only changes what counts as admissible: the reprojection must CONTAIN every
 * selected word, in order. A wider reprojection is the canonical unit settling
 * around the reader's words, and the host returns those settled words so the
 * surface can show exactly what will be held. A reprojection that DROPS or
 * REORDERS a selected word is still a defect and is still refused — that is
 * the artifact promise this predicate exists to police.
 *
 * This is containment of whole lexical words, never substring or phrase
 * matching: lab-era `indexOf` phrase anchoring is what broke selection in the
 * first place and the backbone-token contract exists to keep it impossible.
 */
export function selectionSettlesIntoProjection(
  selections: readonly Pick<OccurrenceSelectionPiece, "verse" | "char_start" | "quote">[],
  projection: readonly Pick<OccurrenceProjectionFragment, "verse" | "char_start" | "quote">[],
): boolean {
  const comparePiece = (
    left: { verse: number; char_start: number },
    right: { verse: number; char_start: number },
  ): number => left.verse - right.verse || left.char_start - right.char_start;
  const selectedWords = [...selections]
    .sort(comparePiece)
    .flatMap((piece) => lexicalWordsForRoundTrip(piece.quote));
  const projectedWords = [...projection]
    .sort(comparePiece)
    .flatMap((piece) => lexicalWordsForRoundTrip(piece.quote));
  if (selectedWords.length === 0) return false;
  let cursor = 0;
  for (const word of selectedWords) {
    while (cursor < projectedWords.length && projectedWords[cursor] !== word) cursor++;
    if (cursor >= projectedWords.length) return false;
    cursor++;
  }
  return true;
}

export type ProjectBackboneTokenAnchorRequest = {
  readonly anchor: BackboneTokenAnchor;
  readonly target_package_id: string;
  readonly verses: readonly OccurrenceAlignmentVerseEvidence[];
  readonly sha256: Sha256Text;
};

export type ProjectBackboneTokenAnchorResult =
  | {
      readonly ok: true;
      readonly status: "exact";
      readonly package_id: string;
      readonly book: BookCode;
      readonly chapter: number;
      readonly fragments: readonly OccurrenceProjectionFragment[];
    }
  | {
      readonly ok: false;
      readonly status: "unavailable" | "passage";
      readonly package_id: string;
      readonly fragments: readonly [];
      readonly error: OccurrenceAlignmentIssue;
    };

/**
 * Resolve an exact canonical anchor into target-package paint ranges. Results
 * are atomic: one unavailable occurrence discards every provisional fragment.
 */
export function projectBackboneTokenAnchor(
  request: ProjectBackboneTokenAnchorRequest,
): ProjectBackboneTokenAnchorResult {
  if (!isValidPackageId(request.target_package_id)) {
    return projectionUnavailable(request.target_package_id, "invalid-validation-context", "Target package id is invalid.");
  }
  const normalizedAnchor = normalizeAnchor(request.anchor);
  if (!normalizedAnchor.ok) {
    return projectionUnavailable(request.target_package_id, normalizedAnchor.error.code, normalizedAnchor.error.message);
  }
  const indexedEvidence = indexVerseEvidence(request.verses);
  if (!indexedEvidence.ok) {
    return projectionUnavailable(request.target_package_id, indexedEvidence.error.code, indexedEvidence.error.message);
  }

  const anchor = normalizedAnchor.value;
  const requiredByVerse = new Map<number, Set<number>>();
  for (const occurrence of anchor.exact.occurrences) {
    const required = requiredByVerse.get(occurrence.verse) ?? new Set<number>();
    required.add(occurrence.position);
    requiredByVerse.set(occurrence.verse, required);
  }

  const provisional: OccurrenceProjectionFragment[] = [];
  for (const [verse, required] of [...requiredByVerse].sort(([left], [right]) => left - right)) {
    const key = verseEvidenceKey(anchor.book, anchor.chapter, verse);
    const evidence = indexedEvidence.value.get(key);
    if (!evidence || evidence.alignment === undefined || evidence.alignment === null) {
      return projectionUnavailable(request.target_package_id, "artifact-missing", `Occurrence alignment for ${key} is unavailable.`);
    }
    const validation = validateOccurrenceAlignmentVerse(evidence.alignment, {
      package_id: request.target_package_id,
      book: anchor.book,
      chapter: anchor.chapter,
      verse,
      text: evidence.text,
      sha256: request.sha256,
    });
    if (!validation.ok) {
      return projectionUnavailable(request.target_package_id, validation.error.code, validation.error.message);
    }
    if (validation.value.target_state === "absent") {
      return projectionUnavailable(
        request.target_package_id,
        "target-absent",
        `Package ${request.target_package_id} explicitly has no target verse at ${key}.`,
      );
    }
    const text = evidence.text!;
    const selectedFragments: Array<{ index: number; fragment: OccurrenceAlignmentFragmentV1 }> = [];
    const represented = new Set<number>();
    for (let index = 0; index < validation.value.fragments.length; index++) {
      const fragment = validation.value.fragments[index]!;
      let selected = false;
      for (const position of fragment[2]) {
        if (required.has(position)) {
          represented.add(position);
          selected = true;
        }
      }
      if (selected) selectedFragments.push({ index, fragment });
    }
    for (const position of required) {
      if (!represented.has(position)) {
        return projectionPassage(
          request.target_package_id,
          "occurrence-unavailable",
          `${key} has no target fragment for canonical occurrence ${position}; exact projection is unavailable.`,
        );
      }
    }
    provisional.push(...mergeProjectionFragments(
      verse,
      text,
      validation.value.fragments,
      selectedFragments,
    ));
  }

  return {
    ok: true,
    status: "exact",
    package_id: request.target_package_id,
    book: anchor.book,
    chapter: anchor.chapter,
    fragments: provisional,
  };
}

const PRESENT_REQUIRED_VERSE_KEYS = [
  "type",
  "format_version",
  "layer",
  "package_id",
  "ref",
  "text_sha256",
  "text_utf16_length",
  "fragments",
] as const;
const PRESENT_VERSE_KEYS = [...PRESENT_REQUIRED_VERSE_KEYS, "target_state"] as const;
const ABSENT_VERSE_KEYS = [
  "type",
  "format_version",
  "layer",
  "package_id",
  "ref",
  "target_state",
  "fragments",
] as const;
const ANCHOR_KEYS = ["book", "chapter", "verse_start", "verse_end", "exact"] as const;
const EXACT_KEYS = ["format_version", "layer", "occurrences"] as const;
const OCCURRENCE_KEYS = ["verse", "position"] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const LEXICAL = /[\p{L}\p{M}\p{N}]/u;

type FragmentValidation =
  | { ok: true; value: OccurrenceAlignmentFragmentV1 }
  | { ok: false; result: OccurrenceAlignmentValidationResult };

function validateFragment(
  input: unknown,
  index: number,
  text: string,
  previousEnd: number,
): FragmentValidation {
  if (!Array.isArray(input) || (input.length !== 3 && input.length !== 4)) {
    return fragmentFailure("invalid-fragment", `Occurrence-alignment fragment ${index} must be a 3- or 4-item tuple.`);
  }
  const start = input[0];
  const end = input[1];
  const rawPositions = input[2];
  const group = input[3];
  if (
    !isNonNegativeSafeInteger(start)
    || !isPositiveSafeInteger(end)
    || end <= start
    || end > text.length
    || !Array.isArray(rawPositions)
    || rawPositions.length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR
    || (group !== undefined && !isPositiveSafeInteger(group))
  ) {
    return fragmentFailure("invalid-fragment", `Occurrence-alignment fragment ${index} is malformed.`);
  }
  if (start < previousEnd) {
    return fragmentFailure("fragment-overlap", `Occurrence-alignment fragment ${index} overlaps its predecessor.`);
  }
  if (start > previousEnd) {
    return fragmentFailure(
      "fragment-coverage-gap",
      `Occurrence-alignment fragment ${index} leaves target text ${previousEnd}-${start} uncovered.`,
    );
  }
  if (!isUtf16Boundary(text, start) || !isUtf16Boundary(text, end)) {
    return fragmentFailure("invalid-fragment", `Occurrence-alignment fragment ${index} splits a UTF-16 surrogate pair.`);
  }
  const positions: number[] = [];
  let previousPosition = 0;
  for (let positionIndex = 0; positionIndex < rawPositions.length; positionIndex++) {
    const position = rawPositions[positionIndex];
    if (!isPositiveSafeInteger(position) || position <= previousPosition) {
      return fragmentFailure(
        "invalid-occurrence-position",
        `Fragment ${index} occurrence position ${positionIndex} must be a positive, strictly ordered integer.`,
      );
    }
    positions.push(position);
    previousPosition = position;
  }
  const value: OccurrenceAlignmentFragmentV1 = group === undefined
    ? [start, end, positions]
    : [start, end, positions, group];
  return { ok: true, value };
}

function validateSelectionAgainstText(
  selection: OccurrenceSelectionPiece,
  text: string,
): { ok: true } | { ok: false; error: OccurrenceAlignmentIssue } {
  if (selection.char_end > text.length) {
    return issueFailure("invalid-selection", "Selection character range exceeds its target verse text.");
  }
  if (!isUtf16Boundary(text, selection.char_start) || !isUtf16Boundary(text, selection.char_end)) {
    return issueFailure("selection-splits-unicode", "Selection boundary splits a UTF-16 surrogate pair.");
  }
  if (text.slice(selection.char_start, selection.char_end) !== selection.quote) {
    return issueFailure("selection-quote-mismatch", "Selection quote does not exactly match its target text range.");
  }
  return { ok: true };
}

function normalizeAnchor(
  input: unknown,
): { ok: true; value: BackboneTokenAnchor } | { ok: false; error: OccurrenceAlignmentIssue } {
  if (!isRecord(input) || !hasExactKeys(input, ANCHOR_KEYS)) {
    return issueFailure("invalid-anchor", "Canonical token anchor has missing or unknown fields.");
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
    || verseEnd < verseStart
  ) {
    return issueFailure("invalid-anchor", "Canonical token anchor has an invalid passage envelope.");
  }
  const exact = input["exact"];
  if (!isRecord(exact) || !hasExactKeys(exact, EXACT_KEYS)) {
    return issueFailure("invalid-anchor", "Canonical token anchor has an invalid exact selector.");
  }
  if (exact["format_version"] !== BACKBONE_TOKEN_EXACT_FORMAT_VERSION) {
    return issueFailure("unsupported-exact-format-version", "Canonical token selector format is unsupported.");
  }
  if (exact["layer"] !== BACKBONE_TOKEN_LAYER) {
    return issueFailure("unsupported-token-layer", "Canonical token selector layer is unsupported.");
  }
  const rawOccurrences = exact["occurrences"];
  if (
    !Array.isArray(rawOccurrences)
    || rawOccurrences.length === 0
    || rawOccurrences.length > MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR
  ) {
    return issueFailure("invalid-anchor", "Canonical token anchor has an invalid occurrence count.");
  }
  const occurrences: BackboneTokenOccurrenceV1[] = [];
  let previous: BackboneTokenOccurrenceV1 | undefined;
  for (let index = 0; index < rawOccurrences.length; index++) {
    const rawOccurrence = rawOccurrences[index];
    if (!isRecord(rawOccurrence) || !hasExactKeys(rawOccurrence, OCCURRENCE_KEYS)) {
      return issueFailure("invalid-anchor", `Canonical token occurrence ${index} is malformed.`);
    }
    const verse = rawOccurrence["verse"];
    const position = rawOccurrence["position"];
    if (
      !isPositiveSafeInteger(verse)
      || !isPositiveSafeInteger(position)
      || verse < verseStart
      || verse > verseEnd
    ) {
      return issueFailure("invalid-anchor", `Canonical token occurrence ${index} is outside the passage or malformed.`);
    }
    const occurrence = { verse, position };
    if (previous && compareOccurrences(previous, occurrence) >= 0) {
      return issueFailure("invalid-anchor", "Canonical token occurrences must be unique and strictly ordered.");
    }
    occurrences.push(occurrence);
    previous = occurrence;
  }
  return {
    ok: true,
    value: {
      book,
      chapter,
      verse_start: verseStart,
      verse_end: verseEnd,
      exact: {
        format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
        layer: BACKBONE_TOKEN_LAYER,
        occurrences,
      },
    },
  };
}

function mergeProjectionFragments(
  verse: number,
  text: string,
  allFragments: readonly OccurrenceAlignmentFragmentV1[],
  selected: readonly { index: number; fragment: OccurrenceAlignmentFragmentV1 }[],
): OccurrenceProjectionFragment[] {
  const merged: OccurrenceProjectionFragment[] = [];
  let current: { index: number; start: number; end: number } | undefined;
  for (const item of selected) {
    if (!current) {
      current = { index: item.index, start: item.fragment[0], end: item.fragment[1] };
      continue;
    }
    if (canBridgeProjectionGap(text, allFragments, current.index, item.index)) {
      current.index = item.index;
      current.end = Math.max(current.end, item.fragment[1]);
      continue;
    }
    merged.push(renderFragment(verse, text, current.start, current.end));
    current = { index: item.index, start: item.fragment[0], end: item.fragment[1] };
  }
  if (current) merged.push(renderFragment(verse, text, current.start, current.end));
  return merged;
}

function canBridgeProjectionGap(
  text: string,
  fragments: readonly OccurrenceAlignmentFragmentV1[],
  previousIndex: number,
  nextIndex: number,
): boolean {
  if (nextIndex <= previousIndex + 1) return true;
  for (let index = previousIndex + 1; index < nextIndex; index++) {
    const fragment = fragments[index]!;
    if (fragment[2].length > 0 || hasLexicalContent(text.slice(fragment[0], fragment[1]))) return false;
  }
  return true;
}

function renderFragment(verse: number, text: string, start: number, end: number): OccurrenceProjectionFragment {
  return { verse, char_start: start, char_end: end, quote: text.slice(start, end) };
}

function indexVerseEvidence(
  input: readonly OccurrenceAlignmentVerseEvidence[],
): { ok: true; value: Map<string, OccurrenceAlignmentVerseEvidence> } | { ok: false; error: OccurrenceAlignmentIssue } {
  if (!Array.isArray(input)) {
    return issueFailure("invalid-validation-context", "Verse evidence must be an array.");
  }
  const indexed = new Map<string, OccurrenceAlignmentVerseEvidence>();
  for (let index = 0; index < input.length; index++) {
    const evidence = input[index];
    if (
      !evidence
      || !isValidBookCode(evidence.book)
      || !isPositiveSafeInteger(evidence.chapter)
      || !isPositiveSafeInteger(evidence.verse)
      || (evidence.text !== undefined && typeof evidence.text !== "string")
    ) {
      return issueFailure("invalid-validation-context", `Verse evidence ${index} is malformed.`);
    }
    const key = verseEvidenceKey(evidence.book, evidence.chapter, evidence.verse);
    if (indexed.has(key)) {
      return issueFailure("ambiguous-verse-evidence", `Verse evidence for ${key} is duplicated.`);
    }
    indexed.set(key, evidence);
  }
  return { ok: true, value: indexed };
}

function isValidExpectation(expectation: OccurrenceAlignmentExpectation): boolean {
  return isValidPackageId(expectation.package_id)
    && isValidBookCode(expectation.book)
    && isPositiveSafeInteger(expectation.chapter)
    && isPositiveSafeInteger(expectation.verse)
    && (expectation.text === undefined || typeof expectation.text === "string")
    && typeof expectation.sha256 === "function";
}

function digestText(
  text: string,
  sha256: Sha256Text,
): { ok: true; value: string } | { ok: false; result: OccurrenceAlignmentValidationResult } {
  try {
    const digest = sha256(text);
    if (!SHA256_HEX.test(digest)) {
      return {
        ok: false,
        result: alignmentRefused("digest-unavailable", "SHA-256 dependency returned an invalid digest."),
      };
    }
    return { ok: true, value: digest };
  } catch {
    return {
      ok: false,
      result: alignmentRefused("digest-unavailable", "SHA-256 dependency could not digest target text."),
    };
  }
}

function parseOccurrenceKey(key: string): BackboneTokenOccurrenceV1 {
  const separator = key.indexOf(":");
  return {
    verse: Number(key.slice(0, separator)),
    position: Number(key.slice(separator + 1)),
  };
}

function compareOccurrences(left: BackboneTokenOccurrenceV1, right: BackboneTokenOccurrenceV1): number {
  if (left.verse !== right.verse) return left.verse - right.verse;
  return left.position - right.position;
}

function compareSelections(left: OccurrenceSelectionPiece, right: OccurrenceSelectionPiece): number {
  if (left.verse !== right.verse) return left.verse - right.verse;
  if (left.char_start !== right.char_start) return left.char_start - right.char_start;
  return left.char_end - right.char_end;
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function hasLexicalContent(text: string): boolean {
  return LEXICAL.test(text);
}

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function isValidPackageId(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_ID.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function canonicalVerseRef(book: BookCode, chapter: number, verse: number): string {
  return `bref:v1/${book}.${chapter}.${verse}`;
}

function verseEvidenceKey(book: BookCode, chapter: number, verse: number): string {
  return `${book}.${chapter}.${verse}`;
}

function projectionUnavailable(
  packageId: string,
  code: OccurrenceAlignmentIssueCode,
  message: string,
): ProjectBackboneTokenAnchorResult {
  return { ok: false, status: "unavailable", package_id: packageId, fragments: [], error: { code, message } };
}

function projectionPassage(
  packageId: string,
  code: OccurrenceAlignmentIssueCode,
  message: string,
): ProjectBackboneTokenAnchorResult {
  return { ok: false, status: "passage", package_id: packageId, fragments: [], error: { code, message } };
}

function captureRefused(
  code: OccurrenceAlignmentIssueCode,
  message: string,
): CaptureOccurrenceSelectionResult {
  return { ok: false, status: "refused", error: { code, message } };
}

function fragmentFailure(code: OccurrenceAlignmentIssueCode, message: string): FragmentValidation {
  return { ok: false, result: alignmentInvalid(code, message) };
}

function issueFailure(
  code: OccurrenceAlignmentIssueCode,
  message: string,
): { ok: false; error: OccurrenceAlignmentIssue } {
  return { ok: false, error: { code, message } };
}

function alignmentInvalid(
  code: OccurrenceAlignmentIssueCode,
  message: string,
): OccurrenceAlignmentValidationResult {
  return { ok: false, status: "invalid", error: { code, message } };
}

function alignmentRefused(
  code: OccurrenceAlignmentIssueCode,
  message: string,
): OccurrenceAlignmentValidationResult {
  return { ok: false, status: "refused", error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasRequiredAndOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.includes(key));
}
