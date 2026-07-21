import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONNECTION_FORMAT_VERSION,
  CONNECTION_FORMAT_VERSION_V1,
  CONNECTION_FORMAT_VERSION_V2,
  MAX_CONNECTION_OBSERVATION_LENGTH,
  validateConnectionRecord,
  validateLegacyConnectionRecord,
  validateNewConnectionRecord,
} from "../src/core/annotations/index.js";
import {
  BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
  MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR,
} from "../src/core/annotations/backbone-token-anchor.js";
import type { BackboneTokenCatalog } from "../src/core/annotations/backbone-token-anchor.js";
import type {
  ConnectionContentV1,
  ConnectionContentV2,
  ConnectionEventPayload,
  ConnectionRecordV2,
} from "../src/core/annotations/types.js";
import type { BackboneData } from "../src/core/reference/types.js";

const backbone: BackboneData = {
  version: "v1",
  psalmSuperscriptionPolicy: "fixture",
  verseSplitMergePolicy: "fixture",
  books: {
    PSA: { chapters: [6] },
  },
};

const tokenCounts = new Map<string, number>([
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
    return tokenCounts.get(`${book}.${chapter}.${verse}`);
  },
};

function legacyAnchor(verse: number): unknown {
  return {
    book: "PSA",
    chapter: 1,
    verse_start: verse,
    verse_end: verse,
  };
}

function exactAnchor(
  verse: number,
  positions: number[],
  passage: { start?: number; end?: number } = {},
): unknown {
  return {
    book: "PSA",
    chapter: 1,
    verse_start: passage.start ?? verse,
    verse_end: passage.end ?? verse,
    exact: {
      format_version: 1,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences: positions.map((position) => ({ verse, position })),
    },
  };
}

function record(formatVersion: number, anchors: unknown[]): unknown {
  const common = {
    id: "conn_exact",
    format_version: formatVersion,
    kind: "series",
    label: "A translation-free exact relationship",
    anchors,
  };
  return formatVersion === CONNECTION_FORMAT_VERSION_V2
    ? { ...common, observation: "The repeated movement deserves attention." }
    : common;
}

test("v2 is the current new-create format and accepts only exact canonical anchors", () => {
  assert.equal(CONNECTION_FORMAT_VERSION_V1, 1);
  assert.equal(CONNECTION_FORMAT_VERSION_V2, 2);
  assert.equal(CONNECTION_FORMAT_VERSION, CONNECTION_FORMAT_VERSION_V2);

  const result = validateNewConnectionRecord(record(2, [
    exactAnchor(1, [2, 3, 4]),
    exactAnchor(2, [1, 5]),
  ]), backbone, catalog);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.format_version, 2);
  assert.deepEqual(result.value.anchors[0]?.exact.occurrences, [
    { verse: 1, position: 2 },
    { verse: 1, position: 3 },
    { verse: 1, position: 4 },
  ]);
  assert.equal("render_locator" in result.value.anchors[0]!, false);

  const typedContent: ConnectionContentV2 = result.value;
  const typedRecord: ConnectionRecordV2 = {
    ...typedContent,
    activeEventId: "evt_active",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:05:00.000Z",
  };
  const typedEvent: ConnectionEventPayload = {
    format_version: typedContent.format_version,
    kind: typedContent.kind,
    label: typedContent.label,
    observation: typedContent.observation,
    anchors: typedContent.anchors,
  };
  assert.equal(typedEvent.format_version, 2);
  assert.equal(typedContent.observation, "The repeated movement deserves attention.");
  assert.equal("createdAt" in typedEvent, false);
  assert.equal(typedRecord.updatedAt, "2026-07-20T12:05:00.000Z");
});

test("v2 carries a bounded durable observation while v1 remains unchanged", () => {
  const empty = record(2, [exactAnchor(1, [1]), exactAnchor(2, [1])]) as Record<string, unknown>;
  empty["observation"] = "";
  const emptyResult = validateNewConnectionRecord(empty, backbone, catalog);
  assert.equal(emptyResult.ok, true);
  if (emptyResult.ok) assert.equal(emptyResult.value.observation, "");

  const oversized = record(2, [exactAnchor(1, [1]), exactAnchor(2, [1])]) as Record<string, unknown>;
  oversized["observation"] = "x".repeat(MAX_CONNECTION_OBSERVATION_LENGTH + 1);
  const oversizedResult = validateNewConnectionRecord(oversized, backbone, catalog);
  assert.equal(oversizedResult.ok, false);
  if (!oversizedResult.ok) assert.equal(oversizedResult.error.code, "invalid-observation");

  const legacy = record(1, [legacyAnchor(1), legacyAnchor(2)]) as Record<string, unknown>;
  assert.equal("observation" in legacy, false);
  const legacyWithObservation = { ...legacy, observation: "not part of v1" };
  const legacyResult = validateLegacyConnectionRecord(legacyWithObservation, backbone);
  assert.equal(legacyResult.ok, false);
  if (!legacyResult.ok) assert.equal(legacyResult.error.code, "invalid-record");
});

test("v2 refuses verse-only and render-locator anchors instead of faking exact identity", () => {
  const verseOnly = validateConnectionRecord(record(2, [
    legacyAnchor(1),
    legacyAnchor(2),
  ]), backbone, catalog);
  assert.equal(verseOnly.ok, false);
  if (!verseOnly.ok) {
    assert.equal(verseOnly.error.code, "invalid-exact-anchor");
    assert.equal(verseOnly.error.anchorCode, "invalid-anchor");
  }

  const withRenderLocator = {
    ...(exactAnchor(1, [2]) as Record<string, unknown>),
    render_locator: {
      package: "bsb",
      char_start: 0,
      char_end: 7,
      quote: "Blessed",
    },
  };
  const locatorResult = validateConnectionRecord(record(2, [
    withRenderLocator,
    exactAnchor(2, [1]),
  ]), backbone, catalog);
  assert.equal(locatorResult.ok, false);
  if (!locatorResult.ok) {
    assert.equal(locatorResult.error.code, "invalid-exact-anchor");
    assert.equal(locatorResult.error.anchorCode, "invalid-anchor");
  }
});

test("a connection cannot mix v1 passage anchors and v2 exact anchors", () => {
  const mixedV2 = validateConnectionRecord(record(2, [
    exactAnchor(1, [1]),
    legacyAnchor(2),
  ]), backbone, catalog);
  assert.equal(mixedV2.ok, false);
  if (!mixedV2.ok) assert.equal(mixedV2.error.code, "invalid-exact-anchor");

  const mixedV1 = validateConnectionRecord(record(1, [
    legacyAnchor(1),
    exactAnchor(2, [1]),
  ]), backbone, catalog);
  assert.equal(mixedV1.ok, false);
  if (!mixedV1.ok) assert.equal(mixedV1.error.code, "invalid-anchor");
});

test("v2 delegates exact consistency and occurrence bounds to the canonical validator", () => {
  const outOfRange = validateConnectionRecord(record(2, [
    exactAnchor(1, [13]),
    exactAnchor(2, [1]),
  ]), backbone, catalog);
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) {
    assert.equal(outOfRange.error.code, "invalid-exact-anchor");
    assert.equal(outOfRange.error.anchorCode, "occurrence-out-of-range");
  }

  const tooMany = validateConnectionRecord(record(2, [
    exactAnchor(1, Array.from(
      { length: MAX_BACKBONE_TOKEN_OCCURRENCES_PER_ANCHOR + 1 },
      (_, index) => index + 1,
    )),
    exactAnchor(2, [1]),
  ]), backbone, catalog);
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.equal(tooMany.error.anchorCode, "invalid-occurrence-count");

  const missingCatalog = validateConnectionRecord(record(2, [
    exactAnchor(1, [1]),
    exactAnchor(2, [1]),
  ]), backbone);
  assert.equal(missingCatalog.ok, false);
  if (!missingCatalog.ok) {
    assert.equal(missingCatalog.error.code, "exact-anchor-refused");
    assert.equal(missingCatalog.error.anchorCode, "catalog-unavailable");
  }
});

test("future formats refuse before kind, label, or anchor payload traversal", () => {
  let payloadReads = 0;
  const future: Record<string, unknown> = {
    id: "conn_future",
    format_version: 3,
  };
  for (const key of ["kind", "label", "anchors"] as const) {
    Object.defineProperty(future, key, {
      enumerable: true,
      get() {
        payloadReads += 1;
        throw new Error(`must not read ${key}`);
      },
    });
  }

  const result = validateConnectionRecord(future, backbone, catalog);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unsupported-format-version");
  assert.equal(payloadReads, 0);
});

test("legacy v1 stays explicitly readable while new-create validation rejects it", () => {
  const legacyInput = record(1, [
    {
      ...(legacyAnchor(1) as Record<string, unknown>),
      render_locator: {
        package: "bsb",
        char_start: 0,
        char_end: 7,
        quote: "Blessed",
      },
    },
    legacyAnchor(2),
  ]);

  const unionRead = validateConnectionRecord(legacyInput, backbone, catalog);
  assert.equal(unionRead.ok, true);
  if (!unionRead.ok) return;
  assert.equal(unionRead.value.format_version, 1);

  const legacyRead = validateLegacyConnectionRecord(legacyInput, backbone);
  assert.equal(legacyRead.ok, true);
  if (!legacyRead.ok) return;
  const typedLegacy: ConnectionContentV1 = legacyRead.value;
  assert.equal(typedLegacy.anchors[0]?.render_locator?.package, "bsb");
  assert.equal("exact" in typedLegacy.anchors[0]!, false);

  const createAttempt = validateNewConnectionRecord(legacyInput, backbone, catalog);
  assert.equal(createAttempt.ok, false);
  if (!createAttempt.ok) assert.equal(createAttempt.error.code, "unsupported-format-version");
});

test("recognized formats retain closed durable shapes", () => {
  const extraTopLevel = {
    ...(record(2, [exactAnchor(1, [1]), exactAnchor(2, [1])]) as Record<string, unknown>),
    activeEventId: "derived-only",
  };
  const result = validateConnectionRecord(extraTopLevel, backbone, catalog);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid-record");

  const locatorWithExtra = {
    ...(legacyAnchor(1) as Record<string, unknown>),
    render_locator: {
      package: "bsb",
      char_start: 0,
      char_end: 7,
      quote: "Blessed",
      dataset_id: "forbidden",
    },
  };
  const legacy = validateLegacyConnectionRecord(record(1, [
    locatorWithExtra,
    legacyAnchor(2),
  ]), backbone);
  assert.equal(legacy.ok, false);
  if (!legacy.ok) assert.equal(legacy.error.code, "invalid-render-locator");
});
