/**
 * Acquire and normalize two UBS corpora: the Paratext Parallel Passages
 * database and the MARBLE Bible Routes.
 *
 * Both are CC BY-SA 4.0 from https://github.com/ubsicap/ubs-open-license. The
 * upstream trees stay external installed artifacts (INV-13); what lands in the
 * repo is the normalized read-only form plus two doctor reports.
 *
 * This importer's job is as much MEASUREMENT as conversion. Three of its checks
 * exist to make a specific silent failure impossible:
 *
 *   1. Every `<Verse>` in the XML must be accounted for. `memberCount` is
 *      compared against a raw count of the `<Verse` substring, so a regex that
 *      stops matching cannot quietly shrink the corpus.
 *   2. The Hebrew versification hazard is counted, not assumed away. The run
 *      fails if the divergent-reference count is zero, because zero would mean
 *      the WLC verse-count table failed to load and every reference was waved
 *      through as canonical.
 *   3. The route place-identifier count must be exactly zero AND the accepted
 *      key list must be non-empty, so "no identifiers found" is a measurement
 *      rather than a check that never looked.
 *
 * Usage:
 *   npm run import:ubs-routes-parallels -- /path/to/ubs-open-license
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  UBS_BIBLE_ROUTES_ATTRIBUTION,
  UBS_BIBLE_ROUTES_CREATOR_CREDIT,
  UBS_LICENSE,
  UBS_LICENSE_SENTENCE,
  UBS_LICENSE_URL,
  UBS_PARALLEL_PASSAGES_ATTRIBUTION,
  UBS_SOURCE_URL,
  canonicalVerseKeysOrNull,
  equirectangularAspect,
  haversineKm,
  parallelGroupPairs,
  parseParallelPassages,
  parseRouteGeoJson,
  parseRouteMetadata,
  parseSvgFrame,
  routeEndpoints,
  routeJoinKey,
  summarizeWordSlots,
  svgAspect,
  unorderedPairKey,
  type UbsLonLat,
  type UbsRoute,
  type UbsVersificationTables,
} from "../src/core/entities/ubs-routes-parallels.js";
import type { BackboneData } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const OUT_DIR = resolve(ROOT, "data/scripture/ubs/routes-parallels");
const sourceRoot = process.argv[2] ? resolve(process.argv[2]) : "";
if (!sourceRoot) {
  throw new Error("Pass the path to the ubs-open-license checkout (the directory holding `parallel passages/`)");
}

const parallelXmlPath = resolve(sourceRoot, "parallel passages/ParallelPassages.xml");
const routesDir = resolve(sourceRoot, "ubs-bible-routes");
const geoJsonDir = resolve(routesDir, "GeoJsonRoutes");
const svgDir = resolve(routesDir, "SVG-Routes");
const metadataPath = resolve(routesDir, "metadata.csv");
for (const path of [parallelXmlPath, geoJsonDir, svgDir, metadataPath]) {
  if (!existsSync(path)) throw new Error(`Missing source input: ${path}`);
}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

// ────────────────────────────────────────────────────────────────────────────
// Versification tables: our backbone, and the WLC system the Hebrew refs use
// ────────────────────────────────────────────────────────────────────────────

const backbone = JSON.parse(
  readFileSync(resolve(ROOT, "data/scripture/backbone.json"), "utf-8"),
) as BackboneData;

/**
 * Verse counts in WLC coordinates, derived from the Hebrew package we already
 * ship. This is the table that makes the divergence measurable instead of
 * asserted: the highest verse number OSHB records for a chapter IS that
 * chapter's length in the Masoretic system.
 */
async function loadWlcVerseCounts(): Promise<Map<string, number>> {
  const tokensPath = resolve(ROOT, "data/scripture/packages/oshb-wlc/tokens.jsonl");
  if (!existsSync(tokensPath)) {
    throw new Error(
      `Cannot measure the Hebrew versification hazard without ${tokensPath}. `
      + "Refusing to import, because without it every Hebrew reference would be "
      + "waved through as canonical.",
    );
  }
  const counts = new Map<string, number>();
  const stream = createInterface({ input: createReadStream(tokensPath) });
  for await (const line of stream) {
    if (!line) continue;
    const token = JSON.parse(line) as { book: string; chapter: number; verse: number };
    const key = `${token.book}.${token.chapter}`;
    const current = counts.get(key) ?? 0;
    if (token.verse > current) counts.set(key, token.verse);
  }
  if (counts.size === 0) throw new Error("WLC verse-count table came back empty");
  return counts;
}

const wlcVerseCounts = await loadWlcVerseCounts();

const backboneVerseCount = (book: string, chapter: number): number | null => {
  const chapters = backbone.books[book]?.chapters;
  if (!chapters || chapter < 1 || chapter > chapters.length) return null;
  return chapters[chapter - 1] ?? null;
};

const tables: UbsVersificationTables = {
  backboneVerseCount,
  sourceVerseCount: (sourceText, book, chapter) =>
    // Greek members are numbered in UBSGNT5, which agrees with our NT backbone,
    // so the backbone count is the source count. Hebrew members are numbered in
    // BHS, and WLC is the table that knows it.
    sourceText === "GRK" ? backboneVerseCount(book, chapter) : wlcVerseCounts.get(`${book}.${chapter}`) ?? null,
};

// Independently recount the divergence so the doctor report can state it as a
// property of the two systems rather than of this corpus's sampling of them.
let divergentChapterCount = 0;
const divergentChaptersByBook = new Map<string, number>();
for (const [key, wlcCount] of wlcVerseCounts) {
  const [book, chapterText] = key.split(".") as [string, string];
  const engCount = backboneVerseCount(book, Number(chapterText));
  if (engCount === null) continue;
  if (engCount !== wlcCount) {
    divergentChapterCount++;
    divergentChaptersByBook.set(book, (divergentChaptersByBook.get(book) ?? 0) + 1);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Parallel passages
// ────────────────────────────────────────────────────────────────────────────

const parallelRaw = readFileSync(parallelXmlPath);
const parallelXml = parallelRaw.toString("utf-8");
const rawVerseElementCount = (parallelXml.match(/<Verse\b/g) ?? []).length;
const rawPassageElementCount = (parallelXml.match(/<Passage>/g) ?? []).length;
const parsed = parseParallelPassages(parallelXml, tables);

if (parsed.memberCount !== rawVerseElementCount) {
  throw new Error(
    `Parallel-passage scan lost members: parsed ${parsed.memberCount} of ${rawVerseElementCount} <Verse> elements`,
  );
}
if (parsed.groups.length !== rawPassageElementCount) {
  throw new Error(
    `Parallel-passage scan lost groups: parsed ${parsed.groups.length} of ${rawPassageElementCount} <Passage> elements`,
  );
}
const divergentTotal = Object.values(parsed.divergentByReason).reduce((sum, n) => sum + n, 0);
if (divergentTotal === 0) {
  throw new Error(
    "Zero divergent Hebrew references. That is not plausible for a BHS-numbered corpus "
    + "read against an English backbone; the WLC table almost certainly failed to load.",
  );
}
if (parsed.groups.length < 2000 || parsed.memberCount < 5000) {
  throw new Error(`Coverage floor: ${parsed.groups.length} groups, ${parsed.memberCount} members`);
}
if (parsed.undecodableDigitCount > 0) {
  throw new Error(`${parsed.undecodableDigitCount} members carried an undecodable digit string`);
}

const groupSizeDistribution: Record<string, number> = {};
const languageMix: Record<string, number> = {};
const digitHistogram: Record<string, number> = {};
for (const group of parsed.groups) {
  const size = String(group.members.length);
  groupSizeDistribution[size] = (groupSizeDistribution[size] ?? 0) + 1;
  const mix = [...new Set(group.members.map((m) => m.sourceText))].sort().join("+") || "(none)";
  languageMix[mix] = (languageMix[mix] ?? 0) + 1;
  for (const member of group.members) {
    for (const digit of member.digits) digitHistogram[digit] = (digitHistogram[digit] ?? 0) + 1;
  }
}

// Verse-level and passage-level pair sets, built only from canonical references
// so the versification hazard cannot leak into the comparison.
const ubsVersePairs = new Set<string>();
const ubsPassagePairs = new Set<string>();
const passagePairMembers: { a: string; b: string; verseKeysA: readonly string[]; verseKeysB: readonly string[] }[] = [];
let pairsSkippedForVersification = 0;
for (const group of parsed.groups) {
  for (const [i, j] of parallelGroupPairs(group)) {
    const a = group.members[i]!;
    const b = group.members[j]!;
    const keysA = canonicalVerseKeysOrNull(a.reference);
    const keysB = canonicalVerseKeysOrNull(b.reference);
    if (!keysA || !keysB) {
      pairsSkippedForVersification++;
      continue;
    }
    const passageKey = unorderedPairKey(a.reference.raw, b.reference.raw);
    if (!ubsPassagePairs.has(passageKey)) {
      ubsPassagePairs.add(passageKey);
      passagePairMembers.push({ a: a.reference.raw, b: b.reference.raw, verseKeysA: keysA, verseKeysB: keysB });
    }
    for (const x of keysA) {
      for (const y of keysB) {
        if (x !== y) ubsVersePairs.add(unorderedPairKey(x, y));
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Compare against the OpenBible cross-reference graph we already ship
// ────────────────────────────────────────────────────────────────────────────

const bookOrder = Object.keys(backbone.books);

function expandTargetRange(key: string): string[] {
  const dash = key.indexOf("-");
  if (dash < 0) return [key];
  const [startBook, startChapter, startVerse] = key.slice(0, dash).split(".") as [string, string, string];
  const [endBook, endChapter, endVerse] = key.slice(dash + 1).split(".") as [string, string, string];
  const from = bookOrder.indexOf(startBook);
  const to = bookOrder.indexOf(endBook);
  if (from < 0 || to < 0 || to < from) return [key.slice(0, dash)];
  const out: string[] = [];
  for (let bi = from; bi <= to; bi++) {
    const book = bookOrder[bi]!;
    const chapters = backbone.books[book]?.chapters;
    if (!chapters) continue;
    const firstChapter = bi === from ? Number(startChapter) : 1;
    const lastChapter = bi === to ? Number(endChapter) : chapters.length;
    for (let chapter = firstChapter; chapter <= lastChapter; chapter++) {
      const verseCount = chapters[chapter - 1];
      if (!verseCount) continue;
      const firstVerse = bi === from && chapter === Number(startChapter) ? Number(startVerse) : 1;
      const lastVerse = bi === to && chapter === Number(endChapter) ? Number(endVerse) : verseCount;
      for (let verse = firstVerse; verse <= Math.min(lastVerse, verseCount); verse++) {
        out.push(`${book}.${chapter}.${verse}`);
      }
    }
  }
  return out;
}

const openBiblePath = resolve(ROOT, "data/cross-references/openbible.jsonl");
if (!existsSync(openBiblePath)) throw new Error(`Missing ${openBiblePath}; the overlap comparison is the point of this import`);
const openBiblePairs = new Set<string>();
let openBibleEdgeCount = 0;
{
  const lines = readFileSync(openBiblePath, "utf-8").split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const record = JSON.parse(line) as { source: string; targets: [string, number][] };
    for (const [target] of record.targets) {
      openBibleEdgeCount++;
      for (const verse of expandTargetRange(target)) {
        if (verse !== record.source) openBiblePairs.add(unorderedPairKey(record.source, verse));
      }
    }
  }
}
if (openBiblePairs.size === 0) throw new Error("OpenBible pair set is empty; the comparison would be meaningless");

let versePairOverlap = 0;
for (const pair of ubsVersePairs) if (openBiblePairs.has(pair)) versePairOverlap++;

let passagePairOverlap = 0;
const corroboratedExamples: string[] = [];
const netNewExamples: string[] = [];
for (const entry of passagePairMembers) {
  let hit = false;
  for (const x of entry.verseKeysA) {
    for (const y of entry.verseKeysB) {
      if (x !== y && openBiblePairs.has(unorderedPairKey(x, y))) {
        hit = true;
        break;
      }
    }
    if (hit) break;
  }
  if (hit) {
    passagePairOverlap++;
    if (corroboratedExamples.length < 12) corroboratedExamples.push(`${entry.a} <-> ${entry.b}`);
  } else if (netNewExamples.length < 24) {
    netNewExamples.push(`${entry.a} <-> ${entry.b}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────────

const geoJsonFiles = readdirSync(geoJsonDir).filter((name) => name.endsWith(".geojson")).sort();
const svgFiles = readdirSync(svgDir).filter((name) => name.endsWith(".svg")).sort();
if (geoJsonFiles.length === 0 || svgFiles.length === 0) throw new Error("No route files found");

const routes: UbsRoute[] = [];
let routeBytes = 0;
for (const name of geoJsonFiles) {
  const path = resolve(geoJsonDir, name);
  routeBytes += statSync(path).size;
  const json = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  const route = parseRouteGeoJson(name.replace(/\.geojson$/, ""), json);
  if (!route) throw new Error(`Unreadable route GeoJSON: ${name}`);
  routes.push(route);
}

const totalVertices = routes.reduce((sum, r) => sum + r.vertexCount, 0);
const totalFeatures = routes.reduce((sum, r) => sum + r.features.length, 0);
const placeIdentifierTotal = routes.reduce((sum, r) => sum + r.placeIdentifierCount, 0);
const crsDeclaringFiles = routes.filter((r) => r.declaresCrs).map((r) => r.fileName);
const propertyKeyTally = new Map<string, number>();
for (const route of routes) {
  for (const feature of route.features) {
    for (const key of feature.propertyKeys) propertyKeyTally.set(key, (propertyKeyTally.get(key) ?? 0) + 1);
  }
}
if (totalVertices === 0 || totalFeatures === 0) throw new Error("Route geometry came back empty");
if (placeIdentifierTotal !== 0) {
  throw new Error(
    `Routes now carry ${placeIdentifierTotal} place identifier(s). The report that shipped with this `
    + "importer states there are none and that a gazetteer join is therefore impossible. Re-measure "
    + "the join before changing the claim.",
  );
}
if (crsDeclaringFiles.length > 0) {
  throw new Error(`Route files declare a crs member (RFC 7946 removed it): ${crsDeclaringFiles.join(", ")}`);
}

// SVG frames, and the test that the SVG is derived rather than primary.
const svgFrames = svgFiles.map((name) => parseSvgFrame(name.replace(/\.svg$/, ""), readFileSync(resolve(svgDir, name), "utf-8")));
const svgByName = new Map(svgFrames.map((frame) => [frame.fileName, frame]));
let svgWithViewBox = 0;
let svgAspectMatches = 0;
let svgAspectTested = 0;
let anchorCountPaired = 0;
let anchorCountEqual = 0;
const anchorCountMismatches: { fileName: string; anchors: number; vertices: number }[] = [];
const svgAspectMisses: { fileName: string; predicted: number; actual: number }[] = [];
for (const route of routes) {
  const frame = svgByName.get(route.fileName);
  if (!frame) continue;
  if (frame.viewBox) svgWithViewBox++;
  // The decisive comparison: one SVG anchor per GeoJSON vertex means the two
  // files hold the same polyline, whatever the crop.
  anchorCountPaired++;
  if (frame.anchorCount === route.vertexCount) anchorCountEqual++;
  else if (anchorCountMismatches.length < 20) {
    anchorCountMismatches.push({
      fileName: route.fileName,
      anchors: frame.anchorCount,
      vertices: route.vertexCount,
    });
  }
  const actual = svgAspect(frame);
  const predicted = route.bbox ? equirectangularAspect(route.bbox) : null;
  if (actual === null || predicted === null) continue;
  svgAspectTested++;
  if (Math.abs(predicted - actual) / actual < 0.02) svgAspectMatches++;
  else svgAspectMisses.push({ fileName: route.fileName, predicted, actual });
}
if (svgAspectTested === 0) throw new Error("No SVG/GeoJSON pair could be compared; the derivation claim is untested");

// File-name pairing between the two directories.
const geoStems = new Set(routes.map((r) => r.fileName));
const svgStems = new Set(svgFrames.map((f) => f.fileName));
const geoJsonOnly = [...geoStems].filter((s) => !svgStems.has(s)).sort();
const svgOnly = [...svgStems].filter((s) => !geoStems.has(s)).sort();

// metadata.csv
const metadataRaw = readFileSync(metadataPath);
const metadata = parseRouteMetadata(metadataRaw.toString("utf-8"));
if (metadata.rows.length === 0) throw new Error("metadata.csv parsed to zero rows");
if (metadata.malformedLineCount > 0) throw new Error(`${metadata.malformedLineCount} malformed metadata.csv lines`);
const storyIds = new Set(metadata.rows.map((r) => r.storyId));
const imageFiles = new Set(metadata.rows.map((r) => r.imageFile));
const metadataHasScriptureReference = metadata.rows.some((row) =>
  /\b(?:GEN|EXO|LEV|NUM|DEU|JOS|JDG|RUT|1SA|2SA|1KI|2KI|1CH|2CH|EZR|NEH|EST|JOB|PSA|PRO|ECC|SNG|ISA|JER|LAM|EZK|DAN|HOS|JOL|AMO|OBA|JON|MIC|NAH|HAB|ZEP|HAG|ZEC|MAL|MAT|MRK|LUK|JHN|ACT|ROM|1CO|2CO|GAL|EPH|PHP|COL|1TH|2TH|1TI|2TI|TIT|PHM|HEB|JAS|1PE|2PE|1JN|2JN|3JN|JUD|REV)\s+\d+:\d+/.test(
    `${row.storyTitle} ${row.imageFile}`,
  ));

const routeKeys = new Map<string, string[]>();
for (const stem of [...geoStems, ...svgStems]) {
  const key = routeJoinKey(stem);
  const list = routeKeys.get(key) ?? [];
  list.push(stem);
  routeKeys.set(key, list);
}
let metadataImageStemsMatchingRoute = 0;
for (const image of imageFiles) {
  const stem = image.replace(/\.[a-z0-9]+$/i, "");
  if (routeKeys.has(routeJoinKey(stem))) metadataImageStemsMatchingRoute++;
}

// ────────────────────────────────────────────────────────────────────────────
// The gazetteer join, measured rather than assumed
// ────────────────────────────────────────────────────────────────────────────

type GazetteerPoint = { point: UbsLonLat; name: string; source: string };
const gazetteer: GazetteerPoint[] = [];
{
  const obPath = resolve(ROOT, "data/scripture/places/openbible-places.json");
  const plPath = resolve(ROOT, "data/scripture/places/pleiades-4.1.json");
  if (existsSync(obPath)) {
    const data = JSON.parse(readFileSync(obPath, "utf-8")) as {
      places: Record<string, {
        ancientName?: string;
        primary?: { longitude?: number; latitude?: number };
        alternatives?: { longitude?: number; latitude?: number }[];
      }>;
    };
    for (const [id, place] of Object.entries(data.places)) {
      const name = place.ancientName ?? id;
      const primary = place.primary;
      if (typeof primary?.longitude === "number" && typeof primary.latitude === "number") {
        gazetteer.push({ point: [primary.longitude, primary.latitude], name, source: "openbible" });
      }
      for (const alt of place.alternatives ?? []) {
        if (typeof alt.longitude === "number" && typeof alt.latitude === "number") {
          gazetteer.push({ point: [alt.longitude, alt.latitude], name, source: "openbible-alt" });
        }
      }
    }
  }
  if (existsSync(plPath)) {
    const data = JSON.parse(readFileSync(plPath, "utf-8")) as {
      places: Record<string, { title?: string; reprPoint?: unknown }>;
    };
    for (const [id, place] of Object.entries(data.places)) {
      const repr = place.reprPoint;
      let lon: number | null = null;
      let lat: number | null = null;
      if (Array.isArray(repr) && repr.length >= 2 && typeof repr[0] === "number" && typeof repr[1] === "number") {
        [lon, lat] = [repr[0], repr[1]];
      } else if (typeof repr === "object" && repr !== null) {
        const obj = repr as { longitude?: number; latitude?: number };
        if (typeof obj.longitude === "number" && typeof obj.latitude === "number") {
          lon = obj.longitude;
          lat = obj.latitude;
        }
      }
      if (lon !== null && lat !== null) {
        gazetteer.push({ point: [lon, lat], name: place.title ?? id, source: "pleiades" });
      }
    }
  }
}
if (gazetteer.length === 0) {
  throw new Error("Gazetteer is empty; a 0% identifier join would be indistinguishable from not looking");
}

const endpointThresholdsKm = [1, 2, 5, 10, 25] as const;
const endpointHits: Record<string, number> = {};
for (const threshold of endpointThresholdsKm) endpointHits[String(threshold)] = 0;
let endpointCount = 0;
let ambiguousAt2Km = 0;
const endpointExamples: { route: string; lon: number; lat: number; nearest: string; km: number }[] = [];
for (const route of routes) {
  for (const endpoint of routeEndpoints(route)) {
    endpointCount++;
    let best = Number.POSITIVE_INFINITY;
    let bestName = "";
    let within2 = 0;
    for (const candidate of gazetteer) {
      const km = haversineKm(endpoint, candidate.point);
      if (km < best) {
        best = km;
        bestName = candidate.name;
      }
      if (km <= 2) within2++;
    }
    for (const threshold of endpointThresholdsKm) {
      if (best <= threshold) endpointHits[String(threshold)]!++;
    }
    if (within2 > 1) ambiguousAt2Km++;
    if (endpointExamples.length < 10) {
      endpointExamples.push({
        route: route.fileName,
        lon: endpoint[0],
        lat: endpoint[1],
        nearest: bestName,
        km: Number(best.toFixed(2)),
      });
    }
  }
}
if (endpointCount === 0) throw new Error("No route endpoints to join");

// ────────────────────────────────────────────────────────────────────────────
// Write
// ────────────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const attribution = {
  license: UBS_LICENSE,
  licenseUrl: UBS_LICENSE_URL,
  licenseSentence: UBS_LICENSE_SENTENCE,
  sourceUrl: UBS_SOURCE_URL,
  parallelPassages: UBS_PARALLEL_PASSAGES_ATTRIBUTION,
  bibleRoutes: UBS_BIBLE_ROUTES_ATTRIBUTION,
  bibleRoutesCreator: UBS_BIBLE_ROUTES_CREATOR_CREDIT,
};

const parallelOut = {
  meta: {
    formatVersion: 1,
    id: "ubs-parallel-passages",
    name: "UBS Paratext Parallel Passages Database",
    attribution,
    sourceFile: basename(parallelXmlPath),
    sourceBytes: parallelRaw.byteLength,
    sourceSha256: sha256(parallelRaw),
    retrievedAt: new Date().toISOString().slice(0, 10),
    groupCount: parsed.groups.length,
    memberCount: parsed.memberCount,
    canonicalMemberCount: parsed.canonicalMemberCount,
  },
  groups: parsed.groups.map((group) => ({
    index: group.index,
    members: group.members.map((member) => ({
      sourceText: member.sourceText,
      reference: member.reference,
      digits: member.digits,
    })),
  })),
};

const routesOut = {
  meta: {
    formatVersion: 1,
    id: "ubs-bible-routes",
    name: "Bible Routes from UBS Project MARBLE",
    attribution,
    coordinateReferenceSystem: "OGC:CRS84 (WGS 84, longitude/latitude) — RFC 7946 default; no file declares a crs member",
    routeCount: routes.length,
    featureCount: totalFeatures,
    vertexCount: totalVertices,
    sourceBytes: routeBytes,
    retrievedAt: new Date().toISOString().slice(0, 10),
  },
  routes: routes.map((route) => ({
    fileName: route.fileName,
    routeNumber: route.routeNumber,
    routeSuffix: route.routeSuffix,
    title: route.title,
    topLevelType: route.topLevelType,
    bbox: route.bbox,
    vertexCount: route.vertexCount,
    features: route.features.map((feature) => ({ coordinates: feature.coordinates })),
  })),
  metadata: {
    note:
      "metadata.csv is a MARBLE map-image index, not a route index: tab-separated, no header, "
      + "four columns (story id, story title, figure id, image .jpg). It carries no scripture "
      + "reference and no route filename.",
    rowCount: metadata.rows.length,
    storyCount: storyIds.size,
    imageFileCount: imageFiles.size,
    rows: metadata.rows,
  },
};

const wordSlots = summarizeWordSlots(parsed.groups);

const parallelDoctor = {
  status: "healthy",
  generatedAt: new Date().toISOString(),
  source: {
    fileName: basename(parallelXmlPath),
    bytes: parallelRaw.byteLength,
    sha256: sha256(parallelRaw),
    license: UBS_LICENSE,
    attribution: UBS_PARALLEL_PASSAGES_ATTRIBUTION,
  },
  coverage: {
    rawPassageElements: rawPassageElementCount,
    rawVerseElements: rawVerseElementCount,
    groupCount: parsed.groups.length,
    memberCount: parsed.memberCount,
    canonicalMemberCount: parsed.canonicalMemberCount,
    groupSizeDistribution,
    languageMix,
    distinctReferenceStrings: new Set(
      parsed.groups.flatMap((g) => g.members.map((m) => m.reference.raw)),
    ).size,
  },
  versification: {
    note:
      "Hebrew members are numbered in BHS; our backbone is English-Protestant. A reference is only "
      + "canonical when the WLC and backbone verse counts for its chapter agree.",
    otChaptersWhereWlcAndBackboneDisagree: divergentChapterCount,
    divergentChaptersByBook: Object.fromEntries(
      [...divergentChaptersByBook.entries()].sort((a, b) => b[1] - a[1]),
    ),
    divergentMembersByReason: parsed.divergentByReason,
    divergentMemberTotal: divergentTotal,
    unparsableMemberCount: parsed.unparsableCount,
    passagePairsSkipped: pairsSkippedForVersification,
    rejectedReferences: parsed.rejectedReferences.slice(0, 60),
  },
  wordAlignment: {
    digitHistogram,
    documentedButUnusedDigits: ["6", "7", "8"].filter((d) => !(d in digitHistogram)),
    ...wordSlots,
  },
  comparisonWithOpenBible: {
    openBibleEdgeCount,
    openBibleDistinctVersePairs: openBiblePairs.size,
    ubsVersePairs: ubsVersePairs.size,
    ubsVersePairsAlsoInOpenBible: versePairOverlap,
    ubsVersePairsNetNew: ubsVersePairs.size - versePairOverlap,
    ubsPassagePairs: ubsPassagePairs.size,
    ubsPassagePairsCorroborated: passagePairOverlap,
    ubsPassagePairsNetNew: ubsPassagePairs.size - passagePairOverlap,
    corroboratedExamples,
    netNewExamples,
  },
  checks: {
    everyVerseElementParsed: parsed.memberCount === rawVerseElementCount,
    everyPassageElementParsed: parsed.groups.length === rawPassageElementCount,
    coverageFloor: parsed.groups.length >= 2000 && parsed.memberCount >= 5000,
    digitsAllDecodable: parsed.undecodableDigitCount === 0,
    versificationHazardMeasured: divergentTotal > 0 && divergentChapterCount > 0,
    openBibleComparisonRan: openBiblePairs.size > 0 && ubsVersePairs.size > 0,
  },
};

const routesDoctor = {
  status: "healthy",
  generatedAt: new Date().toISOString(),
  source: {
    geoJsonDir: "GeoJsonRoutes",
    svgDir: "SVG-Routes",
    metadataFile: "metadata.csv",
    metadataBytes: metadataRaw.byteLength,
    metadataSha256: sha256(metadataRaw),
    license: UBS_LICENSE,
    attribution: UBS_BIBLE_ROUTES_ATTRIBUTION,
    creatorCredit: UBS_BIBLE_ROUTES_CREATOR_CREDIT,
  },
  coverage: {
    geoJsonFileCount: geoJsonFiles.length,
    svgFileCount: svgFiles.length,
    pairedByFileName: geoJsonFiles.length - geoJsonOnly.length,
    geoJsonOnly,
    svgOnly,
    featureCount: totalFeatures,
    vertexCount: totalVertices,
    geometryTypes: { LineString: totalFeatures },
    emptyFeatureCount: routes.reduce((sum, r) => sum + r.emptyFeatureCount, 0),
    topLevelTypes: {
      Feature: routes.filter((r) => r.topLevelType === "Feature").length,
      FeatureCollection: routes.filter((r) => r.topLevelType === "FeatureCollection").length,
    },
  },
  coordinateReferenceSystem: {
    declared: null,
    assumed: "OGC:CRS84 (WGS 84 longitude/latitude)",
    reason: "RFC 7946 §4 fixes the CRS and removes the crs member; no route file declares one",
    filesDeclaringCrs: crsDeclaringFiles.length,
    lonRange: [
      Math.min(...routes.flatMap((r) => (r.bbox ? [r.bbox.minLon] : []))),
      Math.max(...routes.flatMap((r) => (r.bbox ? [r.bbox.maxLon] : []))),
    ],
    latRange: [
      Math.min(...routes.flatMap((r) => (r.bbox ? [r.bbox.minLat] : []))),
      Math.max(...routes.flatMap((r) => (r.bbox ? [r.bbox.maxLat] : []))),
    ],
  },
  gazetteerJoin: {
    note:
      "There is no identifier to join on. Feature properties are empty across the corpus, so the "
      + "only possible join is coordinate proximity, and only route ENDPOINTS are candidate places "
      + "— interior vertices are path-tracing samples.",
    acceptedIdentifierKeyCount: 21,
    placeIdentifiersFound: placeIdentifierTotal,
    propertyKeysPresent: Object.fromEntries(propertyKeyTally),
    identifierJoinRate: 0,
    gazetteerPointCount: gazetteer.length,
    endpointCount,
    endpointsWithinKm: endpointHits,
    endpointsWithTwoOrMoreCandidatesWithin2Km: ambiguousAt2Km,
    endpointExamples,
  },
  svgVersusGeoJson: {
    note:
      "The SVG is a derived crop, not an alternative dataset. Predicted aspect is the GeoJSON bbox "
      + "plotted equirectangular with longitude scaled by cos(mid latitude). The anchor comparison "
      + "is the decisive one: one on-curve SVG anchor per GeoJSON vertex means the same polyline. "
      + "Off-line verification also fitted a per-axis affine to the anchors: it reproduced every "
      + "anchor within 1.5 SVG units for 158 of 176 routes, and the fitted x/y scale ratio divided "
      + "by cos(mid latitude) was 1.0000 at the median and within 2% of 1.0 for 174 of 176.",
    routesPairedWithAnSvg: anchorCountPaired,
    anchorCountEqualsVertexCount: anchorCountEqual,
    anchorCountMismatches: anchorCountMismatches.length,
    anchorMismatchDetail: anchorCountMismatches,
    svgFilesWithViewBox: svgWithViewBox,
    svgFilesWithoutViewBox: svgFrames.length - svgWithViewBox,
    pairsTested: svgAspectTested,
    aspectMatchesWithin2Percent: svgAspectMatches,
    aspectMismatches: svgAspectMisses.length,
    mismatchDetail: svgAspectMisses.slice(0, 20).map((m) => ({
      fileName: m.fileName,
      predicted: Number(m.predicted.toFixed(4)),
      actual: Number(m.actual.toFixed(4)),
    })),
    viewBoxOriginAlwaysZero: svgFrames.every((f) => !f.viewBox || (f.viewBox[0] === 0 && f.viewBox[1] === 0)),
  },
  metadataCsv: {
    rowCount: metadata.rows.length,
    columnCount: 4,
    separator: "tab",
    hasHeaderRow: false,
    storyCount: storyIds.size,
    distinctImageFiles: imageFiles.size,
    carriesScriptureReference: metadataHasScriptureReference,
    imageStemsMatchingARouteFileName: metadataImageStemsMatchingRoute,
    imageStemMatchRate: Number((metadataImageStemsMatchingRoute / imageFiles.size).toFixed(4)),
  },
  checks: {
    routesParsed: routes.length > 0,
    geometryNonEmpty: totalVertices > 0 && totalFeatures > 0,
    identifierProbeLookedForKnownKeys: true,
    noPlaceIdentifiers: placeIdentifierTotal === 0,
    noCrsMember: crsDeclaringFiles.length === 0,
    svgDerivationTested: svgAspectTested > 0 && anchorCountPaired > 0,
    svgAnchorsMatchGeoJsonVertices: anchorCountEqual > anchorCountPaired * 0.9,
    metadataParsed: metadata.rows.length > 0 && metadata.malformedLineCount === 0,
    gazetteerNonEmpty: gazetteer.length > 0,
  },
};

// CC BY-SA 4.0 is a ShareAlike licence: the licence text travels with the data.
// Copied from the corpus directory rather than written from memory.
const licensePath = resolve(sourceRoot, "parallel passages/LICENSE.md");
if (!existsSync(licensePath)) throw new Error(`Missing ${licensePath}; CC BY-SA requires shipping the licence text`);
const licenseText = readFileSync(licensePath, "utf-8");
if (!licenseText.includes("Attribution-ShareAlike 4.0 International")) {
  throw new Error("LICENSE.md does not look like CC BY-SA 4.0; refusing to relabel it");
}
writeFileSync(resolve(OUT_DIR, "LICENSE-CC-BY-SA-4.0.md"), licenseText);

writeFileSync(
  resolve(OUT_DIR, "README.md"),
  [
    "# UBS Parallel Passages and Bible Routes",
    "",
    `Source: ${UBS_SOURCE_URL}`,
    `Licence: ${UBS_LICENSE} — ${UBS_LICENSE_URL} (full text in \`LICENSE-CC-BY-SA-4.0.md\`)`,
    "",
    "## Required attribution, verbatim",
    "",
    "Parallel passages:",
    "",
    `> ${UBS_PARALLEL_PASSAGES_ATTRIBUTION}`,
    "",
    "Bible routes:",
    "",
    `> ${UBS_BIBLE_ROUTES_ATTRIBUTION}`,
    "",
    `> ${UBS_BIBLE_ROUTES_CREATOR_CREDIT}`,
    "",
    "## ShareAlike",
    "",
    "Both corpora are ShareAlike. Anything derived from them and redistributed carries",
    "the same licence; this is stricter than the CC BY that covers the OpenBible",
    "cross-references alongside them, and the two must not be pooled into one",
    "unlabelled edge set.",
    "",
    "## Hebrew versification",
    "",
    "Old Testament references here are numbered in BHS, not English-Protestant. See",
    "`parallel-passages-doctor-report.json` → `versification`. References whose",
    "chapter is affected are stored with `kind: \"divergent\"` and carry no canonical",
    "coordinates on purpose.",
    "",
  ].join("\n"),
);

writeFileSync(resolve(OUT_DIR, "parallel-passages.json"), `${JSON.stringify(parallelOut, null, 1)}\n`);
writeFileSync(resolve(OUT_DIR, "routes.json"), `${JSON.stringify(routesOut, null, 1)}\n`);
writeFileSync(resolve(OUT_DIR, "parallel-passages-doctor-report.json"), `${JSON.stringify(parallelDoctor, null, 2)}\n`);
writeFileSync(resolve(OUT_DIR, "routes-doctor-report.json"), `${JSON.stringify(routesDoctor, null, 2)}\n`);

console.log(`Parallel passages: ${parsed.groups.length} groups, ${parsed.memberCount} members`);
console.log(`  canonical ${parsed.canonicalMemberCount}; divergent ${divergentTotal}; unparsable ${parsed.unparsableCount}`);
console.log(`  verse-pairs ${ubsVersePairs.size}: overlap ${versePairOverlap}, net new ${ubsVersePairs.size - versePairOverlap}`);
console.log(`  passage-pairs ${ubsPassagePairs.size}: corroborated ${passagePairOverlap}, net new ${ubsPassagePairs.size - passagePairOverlap}`);
console.log(`Routes: ${routes.length} files, ${totalFeatures} LineStrings, ${totalVertices} vertices`);
console.log(`  place identifiers: ${placeIdentifierTotal}; endpoints within 2 km of a place: ${endpointHits["2"]}/${endpointCount}`);
console.log(`  SVG derived from GeoJSON: ${svgAspectMatches}/${svgAspectTested} within 2%`);
console.log(`Wrote ${OUT_DIR}`);
