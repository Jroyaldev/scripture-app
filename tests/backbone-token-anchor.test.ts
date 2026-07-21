import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR,
  backboneTokenAnchorKey,
  backboneTokenOccurrenceKey,
  backboneTokenPassageKey,
  validateBackboneTokenAnchor,
  type BackboneTokenAnchor,
  type BackboneTokenCatalog,
} from "../src/core/annotations/backbone-token-anchor.js";
import type { BackboneData } from "../src/core/reference/types.js";

const backbone: BackboneData = {
  version: "v1",
  psalmSuperscriptionPolicy: "fixture",
  verseSplitMergePolicy: "fixture",
  books: {
    PSA: { chapters: [6] },
  },
};

const counts = new Map<string, number>([
  ["PSA.1.1", 12],
  ["PSA.1.2", 10],
  ["PSA.1.3", 8],
  ["PSA.1.4", 9],
  ["PSA.1.5", 11],
  ["PSA.1.6", 10],
]);

const catalog: BackboneTokenCatalog = {
  layer: BACKBONE_TOKEN_LAYER,
  format_version: BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  tokenCount(book, chapter, verse) {
    return counts.get(`${book}.${chapter}.${verse}`);
  },
};

function anchor(
  occurrences: Array<{ verse: number; position: number }>,
  passage: { start?: number; end?: number } = {},
): unknown {
  return {
    book: "PSA",
    chapter: 1,
    verse_start: passage.start ?? 1,
    verse_end: passage.end ?? 1,
    exact: {
      format_version: 1,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences,
    },
  };
}

function expectInvalid(input: unknown, code: string): void {
  const result = validateBackboneTokenAnchor(input, backbone, catalog);
  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid");
  if (!result.ok) assert.equal(result.error.code, code);
}

function expectRefused(
  input: unknown,
  code: string,
  selectedCatalog: BackboneTokenCatalog | null | undefined = catalog,
): void {
  const result = validateBackboneTokenAnchor(input, backbone, selectedCatalog);
  assert.equal(result.ok, false);
  assert.equal(result.status, "refused");
  if (!result.ok) assert.equal(result.error.code, code);
}

test("contiguous and discontinuous occurrence sets validate without translation evidence", () => {
  const contiguous = validateBackboneTokenAnchor(
    anchor([{ verse: 1, position: 2 }, { verse: 1, position: 3 }, { verse: 1, position: 4 }]),
    backbone,
    catalog,
  );
  assert.equal(contiguous.ok, true);
  if (!contiguous.ok) return;
  assert.equal(contiguous.status, "valid");
  assert.deepEqual(contiguous.value.exact.occurrences, [
    { verse: 1, position: 2 },
    { verse: 1, position: 3 },
    { verse: 1, position: 4 },
  ]);
  assert.equal("package" in contiguous.value, false);
  assert.equal("quote" in contiguous.value.exact, false);

  const discontinuous = validateBackboneTokenAnchor(
    anchor([{ verse: 1, position: 2 }, { verse: 1, position: 5 }, { verse: 1, position: 9 }]),
    backbone,
    catalog,
  );
  assert.equal(discontinuous.ok, true);
  if (discontinuous.ok) {
    assert.deepEqual(discontinuous.value.exact.occurrences.map((item) => item.position), [2, 5, 9]);
  }
});

test("multi-verse occurrence sets remain ordered inside one structured passage", () => {
  const result = validateBackboneTokenAnchor(anchor([
    { verse: 1, position: 12 },
    { verse: 2, position: 1 },
    { verse: 3, position: 4 },
  ], { start: 1, end: 3 }), backbone, catalog);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.exact.occurrences, [
    { verse: 1, position: 12 },
    { verse: 2, position: 1 },
    { verse: 3, position: 4 },
  ]);
  assert.equal(backboneTokenPassageKey(result.value), "bref:v1/PSA.1.1-PSA.1.3");
});

test("property insertion order cannot change normalized identity or keys", () => {
  const ordinary = validateBackboneTokenAnchor(
    anchor([{ verse: 1, position: 2 }, { verse: 1, position: 5 }]),
    backbone,
    catalog,
  );
  const reorderedProperties = validateBackboneTokenAnchor({
    exact: {
      occurrences: [
        { position: 2, verse: 1 },
        { position: 5, verse: 1 },
      ],
      layer: BACKBONE_TOKEN_LAYER,
      format_version: 1,
    },
    verse_end: 1,
    verse_start: 1,
    chapter: 1,
    book: "PSA",
  }, backbone, catalog);
  assert.equal(ordinary.ok, true);
  assert.equal(reorderedProperties.ok, true);
  if (!ordinary.ok || !reorderedProperties.ok) return;
  assert.deepEqual(reorderedProperties.value, ordinary.value);
  assert.equal(backboneTokenAnchorKey(reorderedProperties.value), backboneTokenAnchorKey(ordinary.value));
  assert.equal(
    backboneTokenOccurrenceKey(ordinary.value, ordinary.value.exact.occurrences[0]!),
    "bref:v1/PSA.1.1@backbone-token:v1:2",
  );
  assert.equal(
    backboneTokenAnchorKey(ordinary.value),
    "bref:v1/PSA.1.1#exact:1[bref:v1/PSA.1.1@backbone-token:v1:2,bref:v1/PSA.1.1@backbone-token:v1:5]",
  );
});

test("duplicates and unordered occurrence arrays are rejected rather than normalized", () => {
  expectInvalid(
    anchor([{ verse: 1, position: 2 }, { verse: 1, position: 2 }]),
    "duplicate-occurrence",
  );
  expectInvalid(
    anchor([{ verse: 1, position: 5 }, { verse: 1, position: 2 }]),
    "unordered-occurrences",
  );
  expectInvalid(
    anchor([{ verse: 2, position: 1 }, { verse: 1, position: 2 }], { start: 1, end: 2 }),
    "unordered-occurrences",
  );
});

test("occurrences must be positive safe integers inside the passage and catalog count", () => {
  expectInvalid(anchor([{ verse: 2, position: 1 }]), "occurrence-out-of-passage");
  expectInvalid(anchor([{ verse: 1, position: 0 }]), "invalid-occurrence");
  expectInvalid(anchor([{ verse: 1, position: 1.5 }]), "invalid-occurrence");
  expectInvalid(anchor([{ verse: 1.25, position: 1 }]), "invalid-occurrence");
  expectInvalid(anchor([{ verse: 1, position: 13 }]), "occurrence-out-of-range");
});

test("the passage itself is validated against the Scripture Backbone", () => {
  expectInvalid({
    ...(anchor([{ verse: 1, position: 1 }]) as Record<string, unknown>),
    book: "Psalm",
  }, "invalid-passage");
  expectInvalid(anchor([{ verse: 7, position: 1 }], { start: 7, end: 7 }), "invalid-passage");
  expectInvalid(anchor([{ verse: 2, position: 1 }], { start: 3, end: 2 }), "invalid-passage");
});

test("unknown layers, future selector formats, and missing catalogs are typed refusals", () => {
  const unknownLayer = anchor([{ verse: 1, position: 1 }]) as {
    exact: { layer: string };
  };
  unknownLayer.exact.layer = "translation:web";
  expectRefused(unknownLayer, "unsupported-token-layer");

  const future = anchor([{ verse: 1, position: 1 }]) as {
    exact: { format_version: number };
  };
  future.exact.format_version = 2;
  expectRefused(future, "unsupported-exact-format-version");

  expectRefused(anchor([{ verse: 1, position: 1 }]), "catalog-unavailable", null);
  const withoutCatalog = validateBackboneTokenAnchor(
    anchor([{ verse: 1, position: 1 }]),
    backbone,
    undefined,
  );
  assert.equal(withoutCatalog.ok, false);
  assert.equal(withoutCatalog.status, "refused");
  if (!withoutCatalog.ok) assert.equal(withoutCatalog.error.code, "catalog-unavailable");
});

test("incompatible, incomplete, and failing catalogs refuse without throwing", () => {
  expectRefused(anchor([{ verse: 1, position: 1 }]), "catalog-incompatible", {
    ...catalog,
    layer: "backbone-token:v2",
  });
  expectRefused(anchor([{ verse: 1, position: 1 }]), "catalog-incompatible", {
    ...catalog,
    format_version: 2,
  });
  expectRefused(anchor([{ verse: 1, position: 1 }]), "catalog-verse-missing", {
    ...catalog,
    tokenCount: () => undefined,
  });
  expectRefused(anchor([{ verse: 1, position: 1 }]), "catalog-unavailable", {
    ...catalog,
    tokenCount: () => { throw new Error("fixture read failure"); },
  });
  expectRefused(anchor([{ verse: 1, position: 1 }]), "catalog-incompatible", {
    ...catalog,
    tokenCount: () => 1.5,
  });
});

test("closed shapes and occurrence bounds keep render proof out of canonical identity", () => {
  expectInvalid({
    ...(anchor([{ verse: 1, position: 1 }]) as Record<string, unknown>),
    render_locator: { package: "web", char_start: 0, char_end: 7, quote: "Blessed" },
  }, "invalid-anchor");

  const selectorWithDataset = anchor([{ verse: 1, position: 1 }]) as {
    exact: Record<string, unknown>;
  };
  selectorWithDataset.exact["dataset_id"] = "macula-greek-nestle1904";
  expectInvalid(selectorWithDataset, "invalid-exact-selector");

  const occurrenceWithQuote = anchor([{ verse: 1, position: 1 }]) as {
    exact: { occurrences: Array<Record<string, unknown>> };
  };
  occurrenceWithQuote.exact.occurrences[0]!["quote"] = "Blessed";
  expectInvalid(occurrenceWithQuote, "invalid-occurrence");

  expectInvalid(anchor([]), "invalid-occurrence-count");
  expectInvalid(anchor(Array.from(
    { length: MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR + 1 },
    (_, index) => ({ verse: 1, position: index + 1 }),
  )), "invalid-occurrence-count");
});

test("typed validated anchors produce stable keys without time or randomness", () => {
  const exactAnchor: BackboneTokenAnchor = {
    book: "PSA",
    chapter: 1,
    verse_start: 1,
    verse_end: 2,
    exact: {
      format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences: [
        { verse: 1, position: 12 },
        { verse: 2, position: 1 },
      ],
    },
  };
  const first = backboneTokenAnchorKey(exactAnchor);
  const second = backboneTokenAnchorKey(exactAnchor);
  assert.equal(second, first);
  assert.equal(first.includes("web"), false);
  assert.equal(first.includes("macula"), false);
});
