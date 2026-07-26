import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  UBS_BIBLE_ROUTES_ATTRIBUTION,
  UBS_BIBLE_ROUTES_CREATOR_CREDIT,
  UBS_LICENSE,
  UBS_LICENSE_URL,
  UBS_PARALLEL_PASSAGES_ATTRIBUTION,
  UbsVersificationError,
  canonicalVerseKeys,
  canonicalVerseKeysOrNull,
  decodeWordSlot,
  decodeWordSlots,
  equirectangularAspect,
  haversineKm,
  parallelGroupPairs,
  parseParallelPassages,
  parseRouteFileStem,
  parseRouteGeoJson,
  parseRouteMetadata,
  parseSvgFrame,
  parseUbsReference,
  routeEndpoints,
  routeJoinKey,
  summarizeWordSlots,
  svgAspect,
  unorderedPairKey,
  type UbsVersificationTables,
} from "../src/core/entities/ubs-routes-parallels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data/scripture/ubs/routes-parallels");
const PARALLEL_DOCTOR = resolve(DATA_DIR, "parallel-passages-doctor-report.json");
const ROUTES_DOCTOR = resolve(DATA_DIR, "routes-doctor-report.json");

/**
 * The verse-count tables the reference parser is checked against.
 *
 * Hand-built rather than loaded, so the unit tests state the divergence they
 * are testing instead of depending on a 93 MB package. Every entry is a real
 * measurement from this repo's own data:
 *
 *   PSA 18  English 50, WLC 51   (Hebrew counts the superscription)
 *   PSA 53  English  6, WLC  7
 *   ISA  8  English 22, WLC 23   (Hebrew Isa 8:23 = English Isa 9:1)
 *   GEN  1  English 31, WLC 31   (agrees — the control)
 *   MAT 19  English 30           (Greek side, agrees by construction)
 */
const ENGLISH: Record<string, number> = {
  "GEN.1": 31, "GEN.2": 25, "PSA.18": 50, "PSA.53": 6, "ISA.8": 22, "ISA.9": 21,
  "MAT.19": 30, "MRK.10": 52, "HOS.2": 23, "2SA.22": 51,
};
const WLC: Record<string, number> = {
  "GEN.1": 31, "GEN.2": 25, "PSA.18": 51, "PSA.53": 7, "ISA.8": 23, "ISA.9": 20,
  "HOS.2": 25, "2SA.22": 51,
};

const tables: UbsVersificationTables = {
  backboneVerseCount: (book, chapter) => ENGLISH[`${book}.${chapter}`] ?? null,
  sourceVerseCount: (sourceText, book, chapter) =>
    sourceText === "GRK" ? ENGLISH[`${book}.${chapter}`] ?? null : WLC[`${book}.${chapter}`] ?? null,
};

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// ────────────────────────────────────────────────────────────────────────────
// Attribution — the strings must survive verbatim
// ────────────────────────────────────────────────────────────────────────────

test("attribution strings are the source's exact bytes", () => {
  assert.equal(
    UBS_PARALLEL_PASSAGES_ATTRIBUTION,
    "(UBS Parallel Passage Database, © 2023 United Bible Societies.)",
  );
  assert.equal(UBS_BIBLE_ROUTES_ATTRIBUTION, "(© United Bible Societies 2023)");
  assert.equal(
    UBS_BIBLE_ROUTES_CREATOR_CREDIT,
    "These routes are part of a collection of data created for UBS by Dr. Leen Ritmeyer.",
  );
  assert.equal(UBS_LICENSE, "CC BY-SA 4.0");
  // The source writes http, not https. Silently upgrading it would be a paraphrase.
  assert.equal(UBS_LICENSE_URL, "http://creativecommons.org/licenses/by-sa/4.0/");
  // ShareAlike is the whole reason these cannot be pooled with the CC-BY
  // OpenBible edges, so the string has to say so.
  assert.match(UBS_LICENSE, /SA/);
});

// ────────────────────────────────────────────────────────────────────────────
// Word-alignment digits
// ────────────────────────────────────────────────────────────────────────────

test("digits decode as three bands of three", () => {
  assert.deepEqual(decodeWordSlot("0"), { match: "none", lineBreaksBefore: 0 });
  assert.deepEqual(decodeWordSlot("1"), { match: "partial", lineBreaksBefore: 0 });
  assert.deepEqual(decodeWordSlot("2"), { match: "full", lineBreaksBefore: 0 });
  assert.deepEqual(decodeWordSlot("3"), { match: "none", lineBreaksBefore: 1 });
  assert.deepEqual(decodeWordSlot("4"), { match: "partial", lineBreaksBefore: 1 });
  assert.deepEqual(decodeWordSlot("5"), { match: "full", lineBreaksBefore: 1 });
  // 6-8 are documented and never used in the shipped snapshot. Decoded anyway.
  assert.deepEqual(decodeWordSlot("6"), { match: "none", lineBreaksBefore: 2 });
  assert.deepEqual(decodeWordSlot("8"), { match: "full", lineBreaksBefore: 2 });
  assert.equal(decodeWordSlot("9"), null);
  assert.equal(decodeWordSlot(""), null);
  assert.equal(decodeWordSlot("22"), null);
  assert.equal(decodeWordSlots("2x2"), null);
  assert.equal(decodeWordSlots("0122")?.length, 4);
});

// ────────────────────────────────────────────────────────────────────────────
// The versification guard — the point of the module
// ────────────────────────────────────────────────────────────────────────────

test("a reference in an agreeing chapter is canonical and yields verse keys", () => {
  const ref = parseUbsReference("GEN 1:27", "HEB", tables);
  assert.equal(ref.kind, "canonical");
  assert.deepEqual(canonicalVerseKeys(ref), ["GEN.1.27"]);
});

test("ranges and comma lists expand, de-duplicate and sort", () => {
  const range = parseUbsReference("MRK 10:7-8", "GRK", tables);
  assert.deepEqual(canonicalVerseKeys(range), ["MRK.10.7", "MRK.10.8"]);
  const list = parseUbsReference("MRK 10:9,7", "GRK", tables);
  assert.deepEqual(canonicalVerseKeys(list), ["MRK.10.7", "MRK.10.9"]);
});

test("PSA 18:51 is refused, not silently resolved to Psalm 18:50", () => {
  const ref = parseUbsReference("PSA 18:51", "HEB", tables);
  assert.equal(ref.kind, "divergent");
  assert.equal(ref.kind === "divergent" ? ref.reason : "", "out-of-backbone-range");
  assert.equal(ref.kind === "divergent" ? ref.backboneVerseCount : null, 50);
  assert.equal(ref.kind === "divergent" ? ref.sourceVerseCount : null, 51);
  // The refusal must be a throw, not a null that a caller can ?? past.
  assert.throws(() => canonicalVerseKeys(ref), UbsVersificationError);
  assert.equal(canonicalVerseKeysOrNull(ref), null);
});

test("the SILENT case is refused too: an in-range verse in a divergent chapter", () => {
  // ISA 8:5 is a perfectly valid English coordinate. It is also wrong, because
  // Hebrew Isaiah 8 has 23 verses to English's 22 and the numbering has already
  // parted company. This is the assertion that separates this module from one
  // that only range-checks.
  const ref = parseUbsReference("ISA 8:5", "HEB", tables);
  assert.equal(ref.kind, "divergent");
  assert.equal(ref.kind === "divergent" ? ref.reason : "", "chapter-verse-count-differs");
  assert.throws(() => canonicalVerseKeys(ref), UbsVersificationError);
});

test("a chapter with no Hebrew verse count is divergent, not waved through", () => {
  // MAT 19 has no WLC entry because it is not Hebrew. Read as a HEB member it
  // must fail: not knowing is not the same as agreeing. This is the fail-open
  // case — if the verse-count table were empty or failed to load, EVERY
  // reference would take this path, and it has to refuse rather than bless them.
  const asHebrew = parseUbsReference("MAT 19:4", "HEB", tables);
  assert.equal(asHebrew.kind, "divergent");
  assert.equal(asHebrew.kind === "divergent" ? asHebrew.reason : "", "source-verse-count-unknown");
  assert.throws(() => canonicalVerseKeys(asHebrew), UbsVersificationError);
  // The same reference as a Greek member is fine, because UBSGNT5 and our NT
  // backbone agree and `sourceText` is what selects the table.
  const asGreek = parseUbsReference("MAT 19:4", "GRK", tables);
  assert.equal(asGreek.kind, "canonical");
  assert.deepEqual(canonicalVerseKeys(asGreek), ["MAT.19.4"]);
});

test("unknown books and malformed references are refused", () => {
  assert.equal(parseUbsReference("ZZZ 1:1", "HEB", tables).kind, "divergent");
  assert.equal(parseUbsReference("GEN 1", "HEB", tables).kind, "unparsable");
  assert.equal(parseUbsReference("GEN 1:5-2", "HEB", tables).kind, "unparsable");
  assert.equal(parseUbsReference("GEN 1:0", "HEB", tables).kind, "unparsable");
  // No reference in the corpus spans a chapter boundary. If one ever does it
  // must land in `unparsable` rather than be truncated to the first chapter.
  assert.equal(parseUbsReference("GEN 1:30-2:3", "HEB", tables).kind, "unparsable");
});

test("a divergent reference exposes no coordinates at any type position", () => {
  const ref = parseUbsReference("PSA 53:7", "HEB", tables);
  assert.equal(ref.kind, "divergent");
  // The union has no `verses` on the divergent branch — a caller cannot read
  // one even by accident.
  assert.ok(!("verses" in ref));
});

// ────────────────────────────────────────────────────────────────────────────
// Group parsing
// ────────────────────────────────────────────────────────────────────────────

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<Passages>
  <Passage>
    <Verse HEB="000000002222">GEN 1:27</Verse>
    <Verse HEB="22200000000">GEN 2:2</Verse>
  </Passage>
  <Passage>
    <Verse HEB="0000003000052222">GEN 1:27</Verse>
    <Verse GRK="0000300012252222">MAT 19:4</Verse>
    <Verse GRK="202152222">MRK 10:6</Verse>
  </Passage>
  <Passage>
    <Verse HEB="222252252">PSA 18:51</Verse>
    <Verse HEB="2222522520">2SA 22:51</Verse>
  </Passage>
  <Passage>
    <Verse HEB="222">ISA 8:5</Verse>
    <Verse GRK="2222">MRK 10:6</Verse>
  </Passage>
</Passages>`;

test("parsing keeps every member, including the ones it refuses", () => {
  const result = parseParallelPassages(SAMPLE_XML, tables);
  assert.equal(result.groups.length, 4);
  assert.equal(result.memberCount, 9);
  // A refused reference still occupies its slot in the group; dropping it would
  // silently renumber the group and change what the digits describe.
  assert.equal(result.groups[2]?.members.length, 2);
  assert.equal(result.groups[3]?.members.length, 2);
  assert.equal(result.canonicalMemberCount, 7);
  assert.equal(result.divergentByReason["out-of-backbone-range"], 1);
  assert.equal(result.divergentByReason["chapter-verse-count-differs"], 1);
  assert.equal(result.unparsableCount, 0);
  assert.equal(result.undecodableDigitCount, 0);
  assert.ok(result.rejectedReferences.length >= 2);
});

test("a BOM does not eat the first group", () => {
  const withBom = `﻿${SAMPLE_XML}`;
  assert.equal(parseParallelPassages(withBom, tables).groups.length, 4);
});

test("group pairs are unordered and complete", () => {
  const result = parseParallelPassages(SAMPLE_XML, tables);
  assert.deepEqual(parallelGroupPairs(result.groups[0]!), [[0, 1]]);
  assert.deepEqual(parallelGroupPairs(result.groups[1]!), [[0, 1], [0, 2], [1, 2]]);
  assert.equal(unorderedPairKey("B", "A"), unorderedPairKey("A", "B"));
});

test("word-slot summary counts every digit", () => {
  const result = parseParallelPassages(SAMPLE_XML, tables);
  const summary = summarizeWordSlots(result.groups);
  const digitCount = result.groups
    .flatMap((g) => g.members)
    .reduce((sum, m) => sum + m.digits.length, 0);
  assert.equal(summary.total, digitCount);
  assert.equal(summary.total, summary.full + summary.partial + summary.none);
  assert.ok(summary.full > 0);
  assert.ok(summary.withLineBreak > 0);
});

// ────────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────────

test("a bare Feature and a FeatureCollection both parse", () => {
  const bare = parseRouteGeoJson("001. Abram's Journey to Haran", {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[39, 36.9], [39.1, 36.5]] },
    properties: {},
  });
  assert.ok(bare);
  assert.equal(bare.topLevelType, "Feature");
  assert.equal(bare.features.length, 1);
  assert.equal(bare.vertexCount, 2);
  assert.equal(bare.routeNumber, 1);
  assert.equal(bare.title, "Abram's Journey to Haran");
  assert.equal(bare.placeIdentifierCount, 0);
  assert.equal(bare.declaresCrs, false);

  const collection = parseRouteGeoJson("015. GEN 16 Hagar", {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: [[34.7, 31.2], [34.6, 31.1]] }, properties: {} },
      { type: "Feature", geometry: null, properties: {} },
    ],
  });
  assert.ok(collection);
  assert.equal(collection.features.length, 1);
  assert.equal(collection.emptyFeatureCount, 1);
});

test("the place-identifier probe actually looks for keys it would recognise", () => {
  // The corpus finding is "zero identifiers". A probe that recognised nothing
  // would report the same zero, so prove the probe fires on a key it should.
  const withId = parseRouteGeoJson("x", {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[35, 31], [36, 32]] },
    properties: { pleiadesId: "687928", tipnrId: "Abana@2Ki.5.12=H0071" },
  });
  assert.equal(withId?.placeIdentifierCount, 2);
  // And that the Illustrator layer label the real corpus carries is NOT one.
  const overlay = parseRouteGeoJson("y", {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[35, 31], [36, 32]] },
    properties: { name: "Overlay (Copy)" },
  });
  assert.equal(overlay?.placeIdentifierCount, 0);
  assert.deepEqual(overlay?.features[0]?.propertyKeys, ["name"]);
});

test("out-of-range and non-numeric coordinates are dropped", () => {
  const route = parseRouteGeoJson("z", {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[35, 31], [999, 31], ["a", 2], [36, 32]] },
    properties: {},
  });
  assert.equal(route?.vertexCount, 2);
  assert.deepEqual(route?.bbox, { minLon: 35, minLat: 31, maxLon: 36, maxLat: 32 });
});

test("route file stems split into number, suffix and title", () => {
  assert.deepEqual(parseRouteFileStem("001. Abram's Journey to Haran"), {
    routeNumber: 1, routeSuffix: null, title: "Abram's Journey to Haran",
  });
  assert.deepEqual(parseRouteFileStem("107a. Rehoboam to Shechem"), {
    routeNumber: 107, routeSuffix: "a", title: "Rehoboam to Shechem",
  });
  // The one file whose GeoJSON lost its title while the SVG kept it.
  assert.deepEqual(parseRouteFileStem("100"), { routeNumber: 100, routeSuffix: null, title: "" });
});

test("the join key folds the curly apostrophe the two directories disagree on", () => {
  assert.equal(routeJoinKey("5. Abram's Journey to Egypt"), routeJoinKey("005. Abram’s Journey to Egypt"));
  assert.notEqual(routeJoinKey("5. Abram's Journey"), routeJoinKey("6. Abram's Journey"));
});

test("endpoints are the first and last vertex of every feature", () => {
  const route = parseRouteGeoJson("t", {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: [[35, 31], [35.5, 31.5], [36, 32]] }, properties: {} },
      { type: "Feature", geometry: { type: "LineString", coordinates: [[30, 30], [31, 31]] }, properties: {} },
    ],
  });
  assert.deepEqual(routeEndpoints(route!), [[35, 31], [36, 32], [30, 30], [31, 31]]);
});

test("haversine is calibrated against a known separation", () => {
  // One degree of latitude at the equator is ~111.2 km.
  assert.ok(Math.abs(haversineKm([0, 0], [0, 1]) - 111.19) < 0.5);
  assert.equal(haversineKm([35, 31], [35, 31]), 0);
});

// ────────────────────────────────────────────────────────────────────────────
// SVG is derived, not primary
// ────────────────────────────────────────────────────────────────────────────

test("the SVG aspect equals the cos-latitude plot of the GeoJSON bbox", () => {
  // Route 001's real numbers: bbox 38.9599..46.1230 lon, 30.9598..36.9596 lat,
  // and the shipped SVG declares viewBox "0 0 594 600".
  const bbox = { minLon: 38.959865534, maxLon: 46.122951461, minLat: 30.959759443, maxLat: 36.959594438 };
  const predicted = equirectangularAspect(bbox);
  assert.ok(predicted !== null);
  const frame = parseSvgFrame("001", '<svg viewBox="0 0 594 600"><path class="st0" d="M18.5,15"/></svg>');
  const actual = svgAspect(frame);
  assert.ok(actual !== null);
  assert.ok(
    Math.abs(predicted - actual) / actual < 0.02,
    `predicted ${predicted} vs declared ${actual}`,
  );
});

test("anchor counting handles implicit command repetition", () => {
  // One M plus three implicit-repeat cubic groups: four anchors, not two.
  const repeated = parseSvgFrame("r", '<svg><path d="M1,1c1,1 2,2 3,3 1,1 2,2 3,3 1,1 2,2 3,3"/></svg>');
  assert.equal(repeated.anchorCount, 4);
  // Mixed absolute/relative line and shorthand commands.
  const mixed = parseSvgFrame("m", '<svg><path d="M0,0L1,1l2,2H5V6z"/></svg>');
  assert.equal(mixed.anchorCount, 5);
  // Anchors accumulate across paths, which is what makes the corpus-wide
  // comparison against the GeoJSON vertex count meaningful.
  const two = parseSvgFrame("t", '<svg><path d="M0,0L1,1"/><path d="M2,2L3,3L4,4"/></svg>');
  assert.equal(two.anchorCount, 5);
  assert.equal(parseSvgFrame("e", "<svg></svg>").anchorCount, 0);
});

test("svg frames report a missing viewBox rather than inventing one", () => {
  const frame = parseSvgFrame("n", '<svg><path d="M0,0"/><path d="M1,1"/></svg>');
  assert.equal(frame.viewBox, null);
  assert.equal(svgAspect(frame), null);
  assert.equal(frame.pathCount, 2);
  const styled = parseSvgFrame("s", '<svg viewBox="0 0 10 5"><style>.st0{stroke:#E42A29;}</style><path d=""/></svg>');
  assert.deepEqual(styled.strokeColors, ["#E42A29"]);
  assert.equal(svgAspect(styled), 2);
});

test("a degenerate bbox has no aspect", () => {
  assert.equal(equirectangularAspect({ minLon: 35, maxLon: 35, minLat: 31, maxLat: 32 }), null);
  assert.equal(equirectangularAspect({ minLon: 35, maxLon: 36, minLat: 31, maxLat: 31 }), null);
});

// ────────────────────────────────────────────────────────────────────────────
// metadata.csv
// ────────────────────────────────────────────────────────────────────────────

test("metadata.csv is tab-separated with no header", () => {
  const parsed = parseRouteMetadata(
    "2\tThe Garden of Eden\t2.1\tEden_location.jpg\n"
    + "5\tAbram in the Land \t5.1\t1. Abram's Journey to Haran.jpg\n",
  );
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.malformedLineCount, 0);
  assert.deepEqual(parsed.rows[0], {
    storyId: "2", storyTitle: "The Garden of Eden", figureId: "2.1", imageFile: "Eden_location.jpg",
  });
  // Trailing space in the source title is trimmed, not preserved as data.
  assert.equal(parsed.rows[1]?.storyTitle, "Abram in the Land");
  // A comma-separated line is NOT four tab columns; it must be counted, not guessed at.
  const commas = parseRouteMetadata("2,The Garden of Eden,2.1,Eden_location.jpg\n");
  assert.equal(commas.rows.length, 0);
  assert.equal(commas.malformedLineCount, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// The shipped artifacts — every assertion below names a non-zero floor
// ────────────────────────────────────────────────────────────────────────────

type ParallelDoctor = {
  status: string;
  source: { sha256: string; bytes: number; attribution: string };
  coverage: {
    rawPassageElements: number; rawVerseElements: number;
    groupCount: number; memberCount: number; canonicalMemberCount: number;
    groupSizeDistribution: Record<string, number>;
    languageMix: Record<string, number>;
  };
  versification: {
    otChaptersWhereWlcAndBackboneDisagree: number;
    divergentMembersByReason: Record<string, number>;
    divergentMemberTotal: number;
  };
  wordAlignment: { total: number; full: number; partial: number; none: number; digitHistogram: Record<string, number> };
  comparisonWithOpenBible: {
    openBibleDistinctVersePairs: number;
    ubsVersePairs: number; ubsVersePairsAlsoInOpenBible: number; ubsVersePairsNetNew: number;
    ubsPassagePairs: number; ubsPassagePairsCorroborated: number; ubsPassagePairsNetNew: number;
  };
  checks: Record<string, boolean>;
};

type RoutesDoctor = {
  status: string;
  source: { attribution: string; creatorCredit: string };
  coverage: { geoJsonFileCount: number; svgFileCount: number; featureCount: number; vertexCount: number; geometryTypes: Record<string, number> };
  coordinateReferenceSystem: { declared: null; filesDeclaringCrs: number; lonRange: [number, number]; latRange: [number, number] };
  gazetteerJoin: {
    acceptedIdentifierKeyCount: number; placeIdentifiersFound: number; identifierJoinRate: number;
    gazetteerPointCount: number; endpointCount: number;
    endpointsWithinKm: Record<string, number>;
    endpointsWithTwoOrMoreCandidatesWithin2Km: number;
  };
  svgVersusGeoJson: {
    pairsTested: number; aspectMatchesWithin2Percent: number; viewBoxOriginAlwaysZero: boolean;
    routesPairedWithAnSvg: number; anchorCountEqualsVertexCount: number;
  };
  metadataCsv: { rowCount: number; storyCount: number; carriesScriptureReference: boolean; imageStemsMatchingARouteFileName: number };
  checks: Record<string, boolean>;
};

const artifactsPresent = existsSync(PARALLEL_DOCTOR) && existsSync(ROUTES_DOCTOR);

test("parallel-passage artifact accounts for every element in the source", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<ParallelDoctor>(PARALLEL_DOCTOR);
  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.coverage.groupCount, 2193);
  assert.equal(doctor.coverage.memberCount, 5266);
  // The scan must not have lost anything to a regex that stopped matching.
  assert.equal(doctor.coverage.memberCount, doctor.coverage.rawVerseElements);
  assert.equal(doctor.coverage.groupCount, doctor.coverage.rawPassageElements);
  // Group sizes: mostly pairs, but 494 groups hold three or more, and one holds
  // 39. No group is empty or singular — every member kept its slot.
  assert.equal(doctor.coverage.groupSizeDistribution["2"], 1699);
  assert.equal(doctor.coverage.groupSizeDistribution["39"], 1);
  assert.equal(doctor.coverage.groupSizeDistribution["0"], undefined);
  assert.equal(doctor.coverage.groupSizeDistribution["1"], undefined);
  const threeOrMore = Object.entries(doctor.coverage.groupSizeDistribution)
    .filter(([size]) => Number(size) >= 3)
    .reduce((sum, [, count]) => sum + count, 0);
  assert.equal(threeOrMore, 494);
  // Both base texts are present, and 249 groups mix them (OT quoted in NT).
  assert.ok(doctor.coverage.languageMix["HEB"]! > 0);
  assert.ok(doctor.coverage.languageMix["GRK"]! > 0);
  assert.equal(doctor.coverage.languageMix["GRK+HEB"], 249);
  for (const [name, passed] of Object.entries(doctor.checks)) {
    assert.equal(passed, true, `check ${name} did not pass`);
  }
});

test("the Hebrew versification hazard is measured, and non-zero", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<ParallelDoctor>(PARALLEL_DOCTOR);
  // 137 chapters is the figure this repo already carries as an open defect.
  assert.equal(doctor.versification.otChaptersWhereWlcAndBackboneDisagree, 137);
  assert.equal(doctor.versification.divergentMemberTotal, 337);
  // A zero here would mean the WLC table failed to load and every Hebrew
  // reference was waved through — the exact failure this asserts against.
  assert.ok(doctor.versification.divergentMemberTotal > 0);
  assert.equal(doctor.versification.divergentMembersByReason["out-of-backbone-range"], 14);
  assert.equal(doctor.versification.divergentMembersByReason["chapter-verse-count-differs"], 323);
  // Zero here is a real finding, not a skipped check: it proves the WLC table
  // covered every chapter the corpus references, so all 337 refusals are
  // measured disagreements rather than gaps in our own data.
  assert.equal(doctor.versification.divergentMembersByReason["source-verse-count-unknown"], 0);
  assert.equal(doctor.versification.divergentMembersByReason["unknown-book"], 0);
  assert.equal(
    Object.values(doctor.versification.divergentMembersByReason).reduce((a, b) => a + b, 0),
    doctor.versification.divergentMemberTotal,
  );
  // The loud 14 are a fraction of the problem; most of it is silent.
  assert.ok(
    doctor.versification.divergentMembersByReason["chapter-verse-count-differs"]!
      > doctor.versification.divergentMembersByReason["out-of-backbone-range"]! * 20,
  );
});

test("word-alignment digits are all decoded and 6-8 are absent", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<ParallelDoctor>(PARALLEL_DOCTOR);
  const { total, full, partial, none, digitHistogram } = doctor.wordAlignment;
  assert.equal(total, 93419);
  assert.equal(total, full + partial + none);
  assert.ok(full > 0 && partial > 0 && none > 0);
  for (const digit of ["0", "1", "2", "3", "4", "5"]) {
    assert.ok(digitHistogram[digit]! > 0, `digit ${digit} missing`);
  }
  for (const digit of ["6", "7", "8"]) {
    assert.equal(digitHistogram[digit], undefined, `digit ${digit} appeared`);
  }
});

test("the OpenBible comparison ran against a non-empty graph and found both overlap and net new", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<ParallelDoctor>(PARALLEL_DOCTOR);
  const c = doctor.comparisonWithOpenBible;
  // A comparison against an empty graph would report 100% net new and be a lie.
  assert.ok(c.openBibleDistinctVersePairs > 500_000);
  assert.ok(c.ubsVersePairs > 6000);
  assert.equal(c.ubsVersePairsAlsoInOpenBible + c.ubsVersePairsNetNew, c.ubsVersePairs);
  assert.equal(c.ubsPassagePairsCorroborated + c.ubsPassagePairsNetNew, c.ubsPassagePairs);
  // Both sides must be non-trivial: substantial corroboration AND substantial
  // new material. Either one collapsing would change the verdict.
  assert.ok(c.ubsVersePairsAlsoInOpenBible > 4000);
  assert.ok(c.ubsVersePairsNetNew > 2000);
  assert.ok(c.ubsPassagePairsNetNew > 1400);
  const corroborationRate = c.ubsPassagePairsCorroborated / c.ubsPassagePairs;
  assert.ok(corroborationRate > 0.6 && corroborationRate < 0.8, `rate ${corroborationRate}`);
});

test("routes artifact: geometry present, and exactly zero place identifiers", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<RoutesDoctor>(ROUTES_DOCTOR);
  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.coverage.geoJsonFileCount, 179);
  assert.equal(doctor.coverage.svgFileCount, 179);
  assert.equal(doctor.coverage.featureCount, 508);
  assert.equal(doctor.coverage.vertexCount, 23951);
  // Every feature is a LineString: there are no Point waypoints to be places.
  assert.equal(doctor.coverage.geometryTypes["LineString"], doctor.coverage.featureCount);
  // The zero is only meaningful because the probe knew what to look for and
  // the gazetteer it would have joined to is non-empty.
  assert.ok(doctor.gazetteerJoin.acceptedIdentifierKeyCount >= 20);
  assert.ok(doctor.gazetteerJoin.gazetteerPointCount > 2000);
  assert.equal(doctor.gazetteerJoin.placeIdentifiersFound, 0);
  assert.equal(doctor.gazetteerJoin.identifierJoinRate, 0);
  for (const [name, passed] of Object.entries(doctor.checks)) {
    assert.equal(passed, true, `check ${name} did not pass`);
  }
});

test("coordinates are WGS84 lon/lat in the biblical world, with no crs member", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<RoutesDoctor>(ROUTES_DOCTOR);
  assert.equal(doctor.coordinateReferenceSystem.declared, null);
  assert.equal(doctor.coordinateReferenceSystem.filesDeclaringCrs, 0);
  const [minLon, maxLon] = doctor.coordinateReferenceSystem.lonRange;
  const [minLat, maxLat] = doctor.coordinateReferenceSystem.latRange;
  // Longitude first: the span runs Rome to Persia, latitude Sheba to the Black
  // Sea. Reversed axes would put these outside the valid latitude range.
  assert.ok(minLon > 12 && maxLon < 49, `lon ${minLon}..${maxLon}`);
  assert.ok(minLat > 12 && maxLat < 42, `lat ${minLat}..${maxLat}`);
  assert.ok(maxLon - minLon > 30);
});

test("the proximity join is possible but ambiguous, which is why it is not an identification", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<RoutesDoctor>(ROUTES_DOCTOR);
  const join = doctor.gazetteerJoin;
  assert.equal(join.endpointCount, 1016);
  // Endpoints do land near known places — so the corpus is georeferenced
  // correctly and the zero identifier count is not a symptom of bad geometry.
  assert.ok(join.endpointsWithinKm["1"]! > 300);
  assert.ok(join.endpointsWithinKm["5"]! > 800);
  // But most endpoints that have a candidate within 2 km have MORE than one, so
  // proximity cannot name a place. This is the number that settles it.
  const within2 = join.endpointsWithinKm["2"]!;
  assert.ok(join.endpointsWithTwoOrMoreCandidatesWithin2Km > within2 * 0.7,
    `${join.endpointsWithTwoOrMoreCandidatesWithin2Km} of ${within2} ambiguous`);
});

test("the SVGs are a derived crop of the GeoJSON, not a second dataset", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<RoutesDoctor>(ROUTES_DOCTOR);
  const svg = doctor.svgVersusGeoJson;
  assert.ok(svg.pairsTested > 150, `only ${svg.pairsTested} pairs tested`);
  assert.equal(svg.aspectMatchesWithin2Percent, 148);
  assert.ok(svg.aspectMatchesWithin2Percent / svg.pairsTested > 0.9);
  // The decisive one: one on-curve SVG anchor per GeoJSON vertex. 176 of the
  // 178 routes that have an SVG sibling match exactly, so the two files hold
  // the same polyline and the SVG adds no geometry.
  assert.equal(svg.routesPairedWithAnSvg, 178);
  assert.equal(svg.anchorCountEqualsVertexCount, 176);
  assert.ok(svg.anchorCountEqualsVertexCount / svg.routesPairedWithAnSvg > 0.98);
  // Every viewBox starts at 0 0, so the crop's position on the globe is not
  // recorded — the SVG cannot be placed on a map without the GeoJSON.
  assert.equal(svg.viewBoxOriginAlwaysZero, true);
});

test("metadata.csv is a map-image index and carries no scripture reference", { skip: !artifactsPresent }, () => {
  const doctor = loadJson<RoutesDoctor>(ROUTES_DOCTOR);
  const meta = doctor.metadataCsv;
  assert.equal(meta.rowCount, 257);
  assert.equal(meta.storyCount, 139);
  // The claim in the report is that this file cannot link a route to a passage.
  assert.equal(meta.carriesScriptureReference, false);
  // Its only bridge to the routes is a filename coincidence, not a key.
  assert.ok(meta.imageStemsMatchingARouteFileName > 150);
});

test("both artifacts carry the verbatim attribution the licence requires", { skip: !artifactsPresent }, () => {
  const parallel = loadJson<ParallelDoctor>(PARALLEL_DOCTOR);
  const routes = loadJson<RoutesDoctor>(ROUTES_DOCTOR);
  assert.equal(parallel.source.attribution, UBS_PARALLEL_PASSAGES_ATTRIBUTION);
  assert.equal(routes.source.attribution, UBS_BIBLE_ROUTES_ATTRIBUTION);
  assert.equal(routes.source.creatorCredit, UBS_BIBLE_ROUTES_CREATOR_CREDIT);
  // ShareAlike obliges us to ship the licence text with the data.
  const licensePath = resolve(DATA_DIR, "LICENSE-CC-BY-SA-4.0.md");
  assert.ok(existsSync(licensePath), "CC BY-SA licence text is not shipped beside the data");
  const license = readFileSync(licensePath, "utf8");
  assert.match(license, /Attribution-ShareAlike 4\.0 International/);
  const readme = readFileSync(resolve(DATA_DIR, "README.md"), "utf8");
  assert.ok(readme.includes(UBS_PARALLEL_PASSAGES_ATTRIBUTION));
  assert.ok(readme.includes(UBS_BIBLE_ROUTES_CREATOR_CREDIT));
});

test("the stored parallel-passage records keep divergent references coordinate-free", { skip: !artifactsPresent }, () => {
  type Stored = {
    meta: { groupCount: number; memberCount: number; attribution: { parallelPassages: string } };
    groups: { members: { reference: { kind: string; verses?: number[] } }[] }[];
  };
  const stored = loadJson<Stored>(resolve(DATA_DIR, "parallel-passages.json"));
  assert.equal(stored.meta.attribution.parallelPassages, UBS_PARALLEL_PASSAGES_ATTRIBUTION);
  assert.equal(stored.groups.length, stored.meta.groupCount);
  let canonical = 0;
  let divergent = 0;
  for (const group of stored.groups) {
    for (const member of group.members) {
      if (member.reference.kind === "canonical") {
        canonical++;
        assert.ok(Array.isArray(member.reference.verses) && member.reference.verses.length > 0);
      } else {
        divergent++;
        // The on-disk form must not carry coordinates either, or a consumer that
        // reads the JSON directly would sail straight past the guard.
        assert.equal(member.reference.verses, undefined);
      }
    }
  }
  assert.equal(canonical + divergent, stored.meta.memberCount);
  assert.equal(divergent, 337);
  assert.ok(canonical > 4900);
});
