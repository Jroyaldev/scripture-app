/**
 * Normalize the pinned Pleiades 4.1 JSON resources used by biblical places.
 * Raw release files remain external installed artifacts (INV-13).
 *
 * Usage: npm run import:pleiades -- /tmp/pleiades-4.1
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  PleiadesConnection,
  PleiadesGeometry,
  PleiadesLocation,
  PleiadesName,
  PleiadesPlace,
  PleiadesReference,
  PleiadesResearchArtifact,
} from "../src/core/entities/pleiades-research.js";
import { comparePleiadesCoordinates } from "../src/core/entities/pleiades-research.js";
import type { PlaceResearchArtifact } from "../src/core/entities/place-research.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const INPUT = process.argv[2] ? resolve(process.argv[2]) : "";
const OUTPUT = resolve(ROOT, "data/scripture/places/pleiades-4.1.json");
const DOCTOR_OUTPUT = resolve(ROOT, "data/scripture/places/pleiades-doctor-report.json");
const OPENBIBLE_INPUT = resolve(ROOT, "data/scripture/places/openbible-places.json");
const RELEASE = "4.1";
const RELEASE_DATE = "2025-05-28";
const SOURCE_COMMIT = "b6a6790f71c45e4a4ef60fce296c506f28f458bf";

type SourceManifest = {
  formatVersion: number;
  source: string;
  release: string;
  releaseDate: string;
  sourceCommit: string;
  releaseUrl: string;
  doi: string;
  license: string;
  licenseUrl: string;
  files: Array<{ id: string; sourcePath: string; sourceUrl: string; bytes: number; sha256: string }>;
};

type RawPleiades = {
  id: string | number;
  title?: string;
  description?: string;
  uri?: string;
  placeTypes?: unknown;
  reprPoint?: unknown;
  bbox?: unknown;
  names?: unknown;
  locations?: unknown;
  connections?: unknown;
  references?: unknown;
  provenance?: string;
  rights?: string;
  creators?: unknown;
  contributors?: unknown;
  created?: string;
};

type RawRecord = Record<string, unknown>;

if (!INPUT) throw new Error("Pass the external directory produced by fetch:pleiades");
const manifestPath = resolve(INPUT, "manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Missing Pleiades source manifest: ${manifestPath}`);
if (!existsSync(OPENBIBLE_INPUT)) throw new Error(`Missing OpenBible place artifact: ${OPENBIBLE_INPUT}`);

const manifestRaw = readFileSync(manifestPath);
const manifest = JSON.parse(manifestRaw.toString("utf8")) as SourceManifest;
const openBible = JSON.parse(readFileSync(OPENBIBLE_INPUT, "utf8")) as PlaceResearchArtifact;
const expectedIds = [...new Set(Object.values(openBible.places)
  .map((place) => place.linkedData.pleiadesId)
  .filter((value): value is string => value != null))]
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
const manifestIds = manifest.files.map((file) => file.id)
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

const sourceHashMismatches: Array<{ id: string; expected: string; actual: string }> = [];
const sourceIdMismatches: Array<{ fileId: string; sourceId: string }> = [];
const invalidCoordinates: string[] = [];
const invalidGeometry: string[] = [];
const invalidRights: string[] = [];
const places: Record<string, PleiadesPlace> = {};

for (const file of manifest.files) {
  const path = resolve(INPUT, `${file.id}.json`);
  if (!existsSync(path)) throw new Error(`Missing Pleiades source resource: ${path}`);
  const sourceRaw = readFileSync(path);
  const actualHash = sha256(sourceRaw);
  if (actualHash !== file.sha256) {
    sourceHashMismatches.push({ id: file.id, expected: file.sha256, actual: actualHash });
  }
  const source = JSON.parse(sourceRaw.toString("utf8")) as RawPleiades;
  const sourceId = String(source.id);
  if (sourceId !== file.id) sourceIdMismatches.push({ fileId: file.id, sourceId });
  const place = normalizePlace(source);
  if (place.reprPoint && !validPoint(place.reprPoint)) invalidCoordinates.push(place.id);
  if (place.bbox && !validBbox(place.bbox)) invalidCoordinates.push(`${place.id}:bbox`);
  for (const location of place.locations) {
    if (location.geometry && !validGeometry(location.geometry)) invalidGeometry.push(`${place.id}:${location.id}`);
  }
  if (!/Creative Commons Attribution 3\.0|CC BY 3\.0|cc-by/i.test(place.rights)) {
    invalidRights.push(place.id);
  }
  if (places[place.id]) throw new Error(`Duplicate Pleiades identity: ${place.id}`);
  places[place.id] = place;
}

const list = Object.values(places);
const nameCount = list.reduce((sum, place) => sum + place.names.length, 0);
const locationCount = list.reduce((sum, place) => sum + place.locations.length, 0);
const connectionCount = list.reduce((sum, place) => sum + place.connections.length, 0);
const referenceCount = list.reduce((sum, place) => sum + place.references.length, 0);
const geometryCount = list.reduce(
  (sum, place) => sum + place.locations.filter((location) => location.geometry != null).length,
  0,
);
const sourceManifestSha256 = sha256(manifestRaw);

const artifact: PleiadesResearchArtifact = {
  meta: {
    formatVersion: 1,
    id: "pleiades-place-research",
    name: "Pleiades Gazetteer",
    release: "4.1",
    releaseDate: "2025-05-28",
    sourceCommit: SOURCE_COMMIT,
    sourceUrl: "https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1",
    doi: "10.5281/zenodo.1193921",
    license: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    attribution: "Pleiades Gazetteer release 4.1, CC BY 3.0",
    sourceManifestSha256,
    placeCount: list.length,
    nameCount,
    locationCount,
    connectionCount,
    referenceCount,
    geometryCount,
  },
  places,
};

const openBibleByPleiades = new Map(Object.values(openBible.places)
  .filter((place) => place.linkedData.pleiadesId)
  .map((place) => [place.linkedData.pleiadesId!, place]));
const comparisons = list.flatMap((place) => {
  const openBiblePlace = openBibleByPleiades.get(place.id);
  if (!openBiblePlace) return [];
  const comparison = comparePleiadesCoordinates(
    place,
    openBiblePlace.primary.longitude,
    openBiblePlace.primary.latitude,
  );
  return comparison ? [{ id: place.id, ...comparison }] : [];
});
const checks = {
  manifestPinned:
    manifest.formatVersion === 1
    && manifest.source === "Pleiades Gazetteer"
    && manifest.release === RELEASE
    && manifest.releaseDate === RELEASE_DATE
    && manifest.sourceCommit === SOURCE_COMMIT
    && manifest.license === "CC BY 3.0",
  expectedLinkedCoverage:
    JSON.stringify(manifestIds) === JSON.stringify(expectedIds)
    && expectedIds.every((id) => places[id] != null),
  sourceHashes: sourceHashMismatches.length === 0,
  sourceIdsMatch: sourceIdMismatches.length === 0,
  uniquePlaceIds: list.length === new Set(list.map((place) => place.id)).size,
  validCoordinates: invalidCoordinates.length === 0,
  validGeometry: invalidGeometry.length === 0,
  sourceRights: invalidRights.length === 0,
  richMetadataPreserved:
    nameCount >= 200
    && locationCount >= 50
    && connectionCount >= 100
    && referenceCount >= 300
    && geometryCount >= 40,
  coordinateComparisonComplete:
    comparisons.length === list.filter((place) => (
      place.reprPoint != null && openBibleByPleiades.has(place.id)
    )).length,
};
const normalized = `${JSON.stringify(artifact)}\n`;
const doctor = {
  status: Object.values(checks).every(Boolean) ? "healthy" : "unhealthy",
  source: {
    name: "Pleiades Gazetteer",
    release: RELEASE,
    releaseDate: RELEASE_DATE,
    sourceCommit: SOURCE_COMMIT,
    releaseUrl: manifest.releaseUrl,
    doi: manifest.doi,
    license: manifest.license,
    licenseUrl: manifest.licenseUrl,
    sourceManifestSha256,
  },
  coverage: {
    linkedPleiadesIds: expectedIds.length,
    placeCount: list.length,
    nameCount,
    locationCount,
    connectionCount,
    referenceCount,
    geometryCount,
    comparableCoordinates: comparisons.length,
    coordinatesWithin25Km: comparisons.filter((item) => item.relation === "close").length,
    coordinatesWithin100Km: comparisons.filter((item) => item.relation === "regional").length,
    coordinatesOver100Km: comparisons.filter((item) => item.relation === "divergent").length,
  },
  checks,
  review: {
    sourceHashMismatches,
    sourceIdMismatches,
    invalidCoordinates,
    invalidGeometry,
    invalidRights,
    divergentCoordinates: comparisons
      .filter((item) => item.relation === "divergent")
      .sort((left, right) => right.distanceKm - left.distanceKm),
  },
  artifact: {
    formatVersion: artifact.meta.formatVersion,
    normalizedSha256: sha256(Buffer.from(normalized)),
  },
};

writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);
if (doctor.status !== "healthy") {
  throw new Error(`Pleiades Doctor refused import: ${JSON.stringify(checks)}`);
}
writeFileSync(OUTPUT, normalized);
console.log(`Pleiades ${RELEASE}: ${list.length} linked places, ${nameCount} names, ${connectionCount} connections`);
console.log(`Bibliography: ${referenceCount} references; geometry: ${geometryCount} records`);
console.log(`Coordinate comparisons: ${comparisons.length} (${doctor.coverage.coordinatesOver100Km} over 100 km)`);
console.log(`Wrote ${OUTPUT}`);
console.log(`Doctor: ${DOCTOR_OUTPUT}`);

function normalizePlace(source: RawPleiades): PleiadesPlace {
  const names = recordArray(source.names).map(normalizeName);
  const locations = recordArray(source.locations).map(normalizeLocation);
  const connections = recordArray(source.connections).map(normalizeConnection);
  const references = recordArray(source.references).map(normalizeReference);
  const periodValues = [...names, ...locations, ...connections];
  const starts = periodValues.map((item) => item.start).filter(isNumber);
  const ends = periodValues.map((item) => item.end).filter(isNumber);
  const reprPoint = numberTuple(source.reprPoint, 2);
  const bbox = numberTuple(source.bbox, 4);
  return {
    id: String(source.id),
    title: cleanText(source.title ?? String(source.id)),
    description: cleanText(source.description ?? ""),
    sourceUrl: source.uri ?? `https://pleiades.stoa.org/places/${String(source.id)}`,
    placeTypes: stringArray(source.placeTypes),
    names,
    locations,
    connections,
    references,
    ...(reprPoint ? { reprPoint: [reprPoint[0]!, reprPoint[1]!] } : {}),
    ...(bbox ? { bbox: [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!] } : {}),
    ...(starts.length > 0 && ends.length > 0 ? { period: { start: Math.min(...starts), end: Math.max(...ends) } } : {}),
    ...(source.provenance ? { provenance: cleanText(source.provenance) } : {}),
    rights: cleanText(source.rights ?? ""),
    creators: personNames(source.creators),
    contributors: personNames(source.contributors),
    ...(source.created ? { created: source.created } : {}),
  };
}

function normalizeName(row: RawRecord): PleiadesName {
  const romanized = stringArray(row["romanized"]);
  return {
    id: String(row["id"] ?? ""),
    ...(textValue(row["attested"]) ? { attested: cleanText(textValue(row["attested"])!) } : {}),
    romanized,
    ...(textValue(row["language"]) ? { language: textValue(row["language"])! } : {}),
    ...(textValue(row["nameType"]) ? { nameType: textValue(row["nameType"])! } : {}),
    ...(textValue(row["associationCertainty"]) ? { certainty: textValue(row["associationCertainty"])! } : {}),
    ...(numberValue(row["start"]) != null ? { start: numberValue(row["start"])! } : {}),
    ...(numberValue(row["end"]) != null ? { end: numberValue(row["end"])! } : {}),
  };
}

function normalizeLocation(row: RawRecord): PleiadesLocation {
  const geometry = geometryValue(row["geometry"]);
  return {
    id: String(row["id"] ?? ""),
    title: cleanText(textValue(row["title"]) ?? String(row["id"] ?? "Location")),
    ...(textValue(row["description"]) ? { description: cleanText(textValue(row["description"])!) } : {}),
    featureTypes: stringArray(row["featureType"]),
    locationTypes: stringArray(row["locationType"]),
    ...(textValue(row["associationCertainty"]) ? { certainty: textValue(row["associationCertainty"])! } : {}),
    ...(numberValue(row["start"]) != null ? { start: numberValue(row["start"])! } : {}),
    ...(numberValue(row["end"]) != null ? { end: numberValue(row["end"])! } : {}),
    ...(numberValue(row["accuracy_value"]) != null ? { accuracyMeters: numberValue(row["accuracy_value"])! } : {}),
    ...(textValue(row["accuracy"]) ? { accuracyUri: textValue(row["accuracy"])! } : {}),
    ...(textValue(row["provenance"]) ? { provenance: cleanText(textValue(row["provenance"])!) } : {}),
    ...(geometry ? { geometry } : {}),
  };
}

function normalizeConnection(row: RawRecord): PleiadesConnection {
  const targetUrl = textValue(row["connectsTo"]);
  const targetId = targetUrl?.match(/\/places\/(\d+)/)?.[1];
  return {
    id: String(row["id"] ?? ""),
    ...(targetId ? { targetId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    title: cleanText(textValue(row["title"]) ?? String(row["id"] ?? "Connected place")),
    type: textValue(row["connectionType"]) ?? "connection",
    ...(textValue(row["description"]) ? { description: cleanText(textValue(row["description"])!) } : {}),
    ...(textValue(row["associationCertainty"]) ? { certainty: textValue(row["associationCertainty"])! } : {}),
    ...(numberValue(row["start"]) != null ? { start: numberValue(row["start"])! } : {}),
    ...(numberValue(row["end"]) != null ? { end: numberValue(row["end"])! } : {}),
  };
}

function normalizeReference(row: RawRecord): PleiadesReference {
  const citation = cleanText(textValue(row["formattedCitation"]) ?? textValue(row["shortTitle"]) ?? "Reference");
  return {
    ...(textValue(row["shortTitle"]) ? { shortTitle: cleanText(textValue(row["shortTitle"])!) } : {}),
    ...(textValue(row["citationDetail"]) ? { citationDetail: cleanText(textValue(row["citationDetail"])!) } : {}),
    citation,
    type: textValue(row["type"]) ?? "reference",
    ...(textValue(row["accessURI"]) ? { accessUrl: textValue(row["accessURI"])! } : {}),
    ...(textValue(row["bibliographicURI"]) ? { bibliographyUrl: textValue(row["bibliographicURI"])! } : {}),
  };
}

function recordArray(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawRecord => item != null && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [cleanText(value)] : [];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(cleanText).filter(Boolean)
    : [];
}

function personNames(value: unknown): string[] {
  return [...new Set(recordArray(value)
    .map((item) => textValue(item["name"]))
    .filter((name): name is string => name != null)
    .map(cleanText)
    .filter(Boolean))];
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberTuple(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length || !value.every(isNumber)) return null;
  return value;
}

function geometryValue(value: unknown): PleiadesGeometry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as RawRecord;
  return typeof record["type"] === "string" && record["coordinates"] != null
    ? { type: record["type"], coordinates: record["coordinates"] }
    : null;
}

function validPoint(value: [number, number]): boolean {
  return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function validBbox(value: [number, number, number, number]): boolean {
  return validPoint([value[0], value[1]]) && validPoint([value[2], value[3]])
    && value[0] <= value[2] && value[1] <= value[3];
}

function validGeometry(geometry: PleiadesGeometry): boolean {
  const points: Array<[number, number]> = [];
  collectPoints(geometry.coordinates, points);
  return points.length > 0 && points.every(validPoint);
}

function collectPoints(value: unknown, points: Array<[number, number]>): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && isNumber(value[0]) && isNumber(value[1])) {
    points.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectPoints(item, points);
}

function cleanText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
