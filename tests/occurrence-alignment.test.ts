import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  type BackboneTokenAnchor,
} from "../src/core/annotations/backbone-token-anchor.js";
import {
  captureOccurrenceAlignedSelection,
  projectBackboneTokenAnchor,
  validateOccurrenceAlignmentVerse,
  type OccurrenceAlignmentVerseEvidence,
  type OccurrenceSelectionPiece,
} from "../src/core/annotations/occurrence-alignment.js";
import type { BookCode } from "../src/core/reference/types.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type Part = {
  quote: string;
  positions?: number[];
  group?: number;
};

function presentAlignment(
  text: string,
  parts: readonly Part[],
  options: {
    packageId?: string;
    book?: BookCode;
    chapter?: number;
    verse?: number;
    digest?: string;
    explicitPresent?: boolean;
  } = {},
): Record<string, unknown> {
  let cursor = 0;
  const fragments = parts.map((part) => {
    const start = cursor;
    cursor += part.quote.length;
    return part.group === undefined
      ? [start, cursor, part.positions ?? []]
      : [start, cursor, part.positions ?? [], part.group];
  });
  assert.equal(cursor, text.length, "fixture fragments must cover the complete UTF-16 text");
  const row: Record<string, unknown> = {
    type: "occurrence-alignment-verse",
    format_version: 1,
    layer: BACKBONE_TOKEN_LAYER,
    package_id: options.packageId ?? "bsb",
    ref: `bref:v1/${options.book ?? "ACT"}.${options.chapter ?? 19}.${options.verse ?? 7}`,
    text_sha256: options.digest ?? sha256(text),
    text_utf16_length: text.length,
    fragments,
  };
  if (options.explicitPresent) row["target_state"] = "present";
  return row;
}

function absentAlignment(
  options: { packageId?: string; book?: BookCode; chapter?: number; verse?: number } = {},
): Record<string, unknown> {
  return {
    type: "occurrence-alignment-verse",
    format_version: 1,
    layer: BACKBONE_TOKEN_LAYER,
    package_id: options.packageId ?? "bsb",
    ref: `bref:v1/${options.book ?? "ACT"}.${options.chapter ?? 19}.${options.verse ?? 7}`,
    target_state: "absent",
    fragments: [],
  };
}

function evidence(
  text: string | undefined,
  alignment: unknown,
  options: { book?: BookCode; chapter?: number; verse?: number } = {},
): OccurrenceAlignmentVerseEvidence {
  return {
    book: options.book ?? "ACT",
    chapter: options.chapter ?? 19,
    verse: options.verse ?? 7,
    ...(text === undefined ? {} : { text }),
    alignment,
  };
}

function selection(
  text: string,
  quote: string,
  options: { book?: BookCode; chapter?: number; verse?: number; after?: number } = {},
): OccurrenceSelectionPiece {
  const start = text.indexOf(quote, options.after ?? 0);
  assert.notEqual(start, -1, `fixture quote ${JSON.stringify(quote)} must exist`);
  return {
    book: options.book ?? "ACT",
    chapter: options.chapter ?? 19,
    verse: options.verse ?? 7,
    char_start: start,
    char_end: start + quote.length,
    quote,
  };
}

function anchor(
  occurrences: Array<{ verse: number; position: number }>,
  options: { book?: BookCode; chapter?: number; start?: number; end?: number } = {},
): BackboneTokenAnchor {
  return {
    book: options.book ?? "ACT",
    chapter: options.chapter ?? 19,
    verse_start: options.start ?? occurrences[0]!.verse,
    verse_end: options.end ?? occurrences[occurrences.length - 1]!.verse,
    exact: {
      format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences,
    },
  };
}

function expectCaptureRefusal(
  result: ReturnType<typeof captureOccurrenceAlignedSelection>,
  code: string,
): void {
  assert.equal(result.ok, false);
  assert.equal(result.status, "refused");
  if (!result.ok) assert.equal(result.error.code, code);
}

function expectProjectionFallback(
  result: ReturnType<typeof projectBackboneTokenAnchor>,
  status: "unavailable" | "passage",
  code: string,
): void {
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  if (!result.ok) {
    assert.equal(result.error.code, code);
    assert.deepEqual(result.fragments, []);
  }
}

test("Acts-style target reordering captures sorted canonical occurrences without durable render evidence", () => {
  const text = "There were about twelve men in all.";
  const row = presentAlignment(text, [
    { quote: "There", positions: [1] },
    { quote: " " },
    { quote: "were", positions: [2] },
    { quote: " " },
    { quote: "about", positions: [3] },
    { quote: " " },
    { quote: "twelve", positions: [4] },
    { quote: " " },
    { quote: "men", positions: [6] },
    { quote: " " },
    { quote: "in", positions: [8] },
    { quote: " " },
    { quote: "all", positions: [7] },
    { quote: "." },
  ]);
  const result = captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, "men in all")],
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.anchor.exact.occurrences, [
    { verse: 7, position: 6 },
    { verse: 7, position: 7 },
    { verse: 7, position: 8 },
  ]);
  assert.deepEqual(Object.keys(result.anchor).sort(), ["book", "chapter", "exact", "verse_end", "verse_start"]);
  assert.deepEqual(Object.keys(result.anchor.exact).sort(), ["format_version", "layer", "occurrences"]);
  const durableJson = JSON.stringify(result.anchor);
  assert.equal(durableJson.includes("bsb"), false);
  assert.equal(durableJson.includes("quote"), false);
  assert.equal(durableJson.includes("char_"), false);
  assert.equal(durableJson.includes("package"), false);
});

test("repeated target words resolve by occurrence position rather than quote search", () => {
  const text = "light became light";
  const row = presentAlignment(text, [
    { quote: "light", positions: [4] },
    { quote: " " },
    { quote: "became", positions: [5] },
    { quote: " " },
    { quote: "light", positions: [6] },
  ]);
  const secondLight = selection(text, "light", { after: 1 });
  const captured = captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [secondLight],
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(captured.ok, true);
  if (!captured.ok) return;
  assert.deepEqual(captured.anchor.exact.occurrences, [{ verse: 7, position: 6 }]);

  const projected = projectBackboneTokenAnchor({
    anchor: captured.anchor,
    target_package_id: "bsb",
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  assert.deepEqual(projected.fragments, [{
    verse: 7,
    char_start: secondLight.char_start,
    char_end: secondLight.char_end,
    quote: "light",
  }]);
});

test("one source occurrence shared by 'of God' permits whole-word God capture and deterministic phrase projection", () => {
  const text = "the Spirit of God moved";
  const row = presentAlignment(text, [
    { quote: "the", positions: [9], group: 26 },
    { quote: " " },
    { quote: "Spirit", positions: [9], group: 26 },
    { quote: " " },
    { quote: "of", positions: [10], group: 27 },
    { quote: " " },
    { quote: "God", positions: [10], group: 27 },
    { quote: " " },
    { quote: "moved", positions: [11], group: 28 },
  ]);
  const captured = captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, "God")],
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(captured.ok, true);
  if (!captured.ok) return;
  assert.deepEqual(captured.anchor.exact.occurrences, [{ verse: 7, position: 10 }]);

  const projected = projectBackboneTokenAnchor({
    anchor: captured.anchor,
    target_package_id: "bsb",
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  const phraseStart = text.indexOf("of God");
  assert.deepEqual(projected.fragments, [{
    verse: 7,
    char_start: phraseStart,
    char_end: phraseStart + "of God".length,
    quote: "of God",
  }]);
});

test("punctuation gaps can join selected lexical words but display-only words block paint merging", () => {
  const text = "faith, hope";
  const row = presentAlignment(text, [
    { quote: "faith", positions: [1] },
    { quote: ", " },
    { quote: "hope", positions: [2] },
  ]);
  const captured = captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, text)],
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(captured.ok, true);
  if (!captured.ok) return;
  assert.deepEqual(captured.anchor.exact.occurrences, [
    { verse: 7, position: 1 },
    { verse: 7, position: 2 },
  ]);
  const projected = projectBackboneTokenAnchor({
    anchor: captured.anchor,
    target_package_id: "bsb",
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(projected.ok, true);
  if (projected.ok) assert.deepEqual(projected.fragments.map((fragment) => fragment.quote), ["faith, hope"]);

  const glossText = "faith truly hope";
  const glossRow = presentAlignment(glossText, [
    { quote: "faith", positions: [1] },
    { quote: " " },
    { quote: "truly" },
    { quote: " " },
    { quote: "hope", positions: [2] },
  ]);
  const split = projectBackboneTokenAnchor({
    anchor: captured.anchor,
    target_package_id: "bsb",
    verses: [evidence(glossText, glossRow)],
    sha256,
  });
  assert.equal(split.ok, true);
  if (split.ok) assert.deepEqual(split.fragments.map((fragment) => fragment.quote), ["faith", "hope"]);
});

test("multi-verse projection is all-or-nothing and returns no partial exact fragments", () => {
  const firstText = "alpha";
  const secondText = "beta";
  const first = presentAlignment(firstText, [{ quote: firstText, positions: [1] }], { verse: 7 });
  const missingSecond = presentAlignment(secondText, [{ quote: secondText, positions: [1] }], { verse: 8 });
  const exactAnchor = anchor([
    { verse: 7, position: 1 },
    { verse: 8, position: 2 },
  ], { start: 7, end: 8 });
  const unavailable = projectBackboneTokenAnchor({
    anchor: exactAnchor,
    target_package_id: "bsb",
    verses: [
      evidence(firstText, first, { verse: 7 }),
      evidence(secondText, missingSecond, { verse: 8 }),
    ],
    sha256,
  });
  expectProjectionFallback(unavailable, "passage", "occurrence-unavailable");

  const exactSecond = presentAlignment(secondText, [{ quote: secondText, positions: [2] }], { verse: 8 });
  const exact = projectBackboneTokenAnchor({
    anchor: exactAnchor,
    target_package_id: "bsb",
    verses: [
      evidence(firstText, first, { verse: 7 }),
      evidence(secondText, exactSecond, { verse: 8 }),
    ],
    sha256,
  });
  assert.equal(exact.ok, true);
  if (exact.ok) assert.deepEqual(exact.fragments.map((fragment) => [fragment.verse, fragment.quote]), [
    [7, "alpha"],
    [8, "beta"],
  ]);
});

test("display-only lexical selections and mid-word cuts are refused", () => {
  const text = "God truly speaks";
  const row = presentAlignment(text, [
    { quote: "God", positions: [1] },
    { quote: " " },
    { quote: "truly" },
    { quote: " " },
    { quote: "speaks", positions: [2] },
  ]);
  expectCaptureRefusal(captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, "truly")],
    verses: [evidence(text, row)],
    sha256,
  }), "display-only-selection");
  expectCaptureRefusal(captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, "Go")],
    verses: [evidence(text, row)],
    sha256,
  }), "partial-word-selection");
  expectCaptureRefusal(captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, " ")],
    verses: [evidence(text, row)],
    sha256,
  }), "zero-canonical-occurrences");
});

test("stale digest, reference, and package identity are typed refusals", () => {
  const text = "God";
  const stale = presentAlignment(text, [{ quote: text, positions: [1] }], { digest: "0".repeat(64) });
  const staleResult = validateOccurrenceAlignmentVerse(stale, {
    package_id: "bsb", book: "ACT", chapter: 19, verse: 7, text, sha256,
  });
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error.code, "stale-text-digest");

  const ordinary = presentAlignment(text, [{ quote: text, positions: [1] }]);
  const wrongRef = validateOccurrenceAlignmentVerse(ordinary, {
    package_id: "bsb", book: "ACT", chapter: 19, verse: 8, text, sha256,
  });
  assert.equal(wrongRef.ok, false);
  if (!wrongRef.ok) assert.equal(wrongRef.error.code, "artifact-reference-mismatch");
  const wrongPackage = validateOccurrenceAlignmentVerse(ordinary, {
    package_id: "web", book: "ACT", chapter: 19, verse: 7, text, sha256,
  });
  assert.equal(wrongPackage.ok, false);
  if (!wrongPackage.ok) assert.equal(wrongPackage.error.code, "artifact-package-mismatch");
});

test("missing and explicitly absent artifacts never produce guessed exact paint", () => {
  const exactAnchor = anchor([{ verse: 7, position: 1 }]);
  expectProjectionFallback(projectBackboneTokenAnchor({
    anchor: exactAnchor,
    target_package_id: "bsb",
    verses: [],
    sha256,
  }), "unavailable", "artifact-missing");

  const absent = absentAlignment();
  const validated = validateOccurrenceAlignmentVerse(absent, {
    package_id: "bsb", book: "ACT", chapter: 19, verse: 7, sha256,
  });
  assert.equal(validated.ok, true);
  if (validated.ok) assert.equal(validated.value.target_state, "absent");
  expectProjectionFallback(projectBackboneTokenAnchor({
    anchor: exactAnchor,
    target_package_id: "bsb",
    verses: [evidence(undefined, absent)],
    sha256,
  }), "unavailable", "target-absent");
});

test("Unicode offsets remain UTF-16 based and surrogate-splitting selections refuse", () => {
  const text = "😀 Ἰησοῦ spoke";
  const greek = "Ἰησοῦ";
  const row = presentAlignment(text, [
    { quote: "😀 " },
    { quote: greek, positions: [3] },
    { quote: " " },
    { quote: "spoke", positions: [4] },
  ]);
  const greekSelection = selection(text, greek);
  assert.equal(greekSelection.char_start, 3, "astral emoji occupies two UTF-16 code units");
  const captured = captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [greekSelection],
    verses: [evidence(text, row)],
    sha256,
  });
  assert.equal(captured.ok, true);
  if (captured.ok) assert.deepEqual(captured.anchor.exact.occurrences, [{ verse: 7, position: 3 }]);

  expectCaptureRefusal(captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [{
      book: "ACT",
      chapter: 19,
      verse: 7,
      char_start: 0,
      char_end: 1,
      quote: text.slice(0, 1),
    }],
    verses: [evidence(text, row)],
    sha256,
  }), "selection-splits-unicode");
});

test("overlapping selection pieces and corrupt fragment overlap refuse without throwing", () => {
  const text = "God speaks";
  const row = presentAlignment(text, [
    { quote: "God", positions: [1] },
    { quote: " " },
    { quote: "speaks", positions: [2] },
  ]);
  expectCaptureRefusal(captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [selection(text, "God"), selection(text, "God speaks")],
    verses: [evidence(text, row)],
    sha256,
  }), "overlapping-selection");

  const corrupt = structuredClone(row);
  const fragments = corrupt["fragments"] as Array<unknown[]>;
  fragments[1]![0] = 2;
  const validation = validateOccurrenceAlignmentVerse(corrupt, {
    package_id: "bsb", book: "ACT", chapter: 19, verse: 7, text, sha256,
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.error.code, "fragment-overlap");
});

test("quote mismatch and duplicate verse evidence are explicit rather than first-match guesses", () => {
  const text = "God";
  const row = presentAlignment(text, [{ quote: text, positions: [1] }], { explicitPresent: true });
  expectCaptureRefusal(captureOccurrenceAlignedSelection({
    package_id: "bsb",
    selections: [{ ...selection(text, text), quote: "god" }],
    verses: [evidence(text, row)],
    sha256,
  }), "selection-quote-mismatch");

  expectProjectionFallback(projectBackboneTokenAnchor({
    anchor: anchor([{ verse: 7, position: 1 }]),
    target_package_id: "bsb",
    verses: [evidence(text, row), evidence(text, row)],
    sha256,
  }), "unavailable", "ambiguous-verse-evidence");
});
