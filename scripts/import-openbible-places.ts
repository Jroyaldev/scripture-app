/**
 * Join the OpenBible Bible Geocoding snapshot to the shipped TIPNR entities.
 * Raw JSONL and the original thumbnail archive remain external installed
 * artifacts (INV-13). The compact normalized index, exact selected thumbnail
 * files, Natural Earth geometry, and Doctor report are committed read-only
 * reference artifacts.
 *
 * Usage:
 *   npm run import:openbible-places -- /path/to/openbible-data /path/to/thumbnails.zip /path/to/ne_50m_land.geojson
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type {
  PlaceLocation,
  PlaceResearchArtifact,
  PlaceResearchImage,
  PlaceResearchRecord,
  PlaceImageKind,
} from "../src/core/entities/place-research.js";
import {
  classifyPlaceImageDescription,
  confidenceFromScore,
} from "../src/core/entities/place-research.js";
import type { TipnrEntity, TipnrIndexFile } from "../src/core/language/tipnr.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const sourceDir = process.argv[2] ? resolve(process.argv[2]) : "";
const thumbnailZip = process.argv[3] ? resolve(process.argv[3]) : "";
const naturalEarthInput = process.argv[4] ? resolve(process.argv[4]) : "";
const outputDir = resolve(ROOT, "data/scripture/places");
const mediaDir = join(outputDir, "media");
const outputPath = join(outputDir, "openbible-places.json");
const doctorPath = join(outputDir, "doctor-report.json");
const naturalEarthOutput = join(outputDir, "natural-earth-50m-land.geojson");

const SOURCE_COMMIT = "7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f";
const EXPECTED_SOURCE_SHA256: Record<string, string> = {
  "ancient.jsonl": "b8187aa4737e8517ccc090f765d2be11da4c548cd2a59d3cdcb62e952cb8c0f2",
  "modern.jsonl": "da731f6e110bac4ea66a9f037a0a31cfb11c4f1efc1206aa9e109092b2c60087",
  "image.jsonl": "d3f99729eac6ac47553594f765dad5fec6e9025f93e5054cb2f63ac1b07bcc3a",
};
const APPROVED_IMAGE_LICENSES = new Set([
  "PD", "CC-PD-Mark", "CC-Zero", "attribution", "OGL-1.0", "FAL",
  "CC-BY-2.0", "CC-BY-2.5", "CC-BY-3.0", "CC-BY-4.0",
  "CC-BY-SA-1.0", "CC-BY-SA-2.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0",
  "CC-BY-SA-3.0-DE", "CC-BY-SA-3.0-FR", "CC-BY-SA-3.0-IGO", "CC-BY-SA-4.0",
]);

if (!sourceDir || !thumbnailZip || !naturalEarthInput) {
  throw new Error("Pass the OpenBible data directory, thumbnails.zip, and Natural Earth 50m land GeoJSON path");
}
for (const file of Object.keys(EXPECTED_SOURCE_SHA256)) {
  if (!existsSync(join(sourceDir, file))) throw new Error(`Missing ${join(sourceDir, file)}`);
}
if (!existsSync(thumbnailZip)) throw new Error(`Missing ${thumbnailZip}`);
if (!existsSync(naturalEarthInput)) throw new Error(`Missing ${naturalEarthInput}`);

type OpenBibleThumbnail = {
  credit?: string;
  credit_url?: string;
  description?: string;
  file?: string;
  image_id?: string;
  placeholder?: string;
  quality?: "low";
  role?: string;
};

type OpenBibleAncient = {
  id: string;
  friendly_id: string;
  url_slug: string;
  types?: string[];
  linked_data?: Record<string, { id?: string }>;
  modern_associations?: Record<string, {
    name: string;
    score: number;
    thumbnail?: OpenBibleThumbnail;
  }>;
  verses?: Array<{ usx?: string }>;
};

type OpenBibleModern = {
  id: string;
  friendly_id: string;
  type?: string;
  lonlat?: string;
  precision?: { description?: string };
  coordinates_source?: { id?: string; source_id?: string; type?: string };
  media?: { thumbnail?: OpenBibleThumbnail };
};

type OpenBibleImage = {
  id: string;
  author?: string;
  credit?: string;
  credit_url?: string;
  file_url?: string;
  height?: number;
  width?: number;
  license?: string;
  thumbnail_url_pattern?: string;
  url?: string;
};

type Candidate = {
  entity: TipnrEntity;
  ancient: OpenBibleAncient;
  modern: OpenBibleModern;
  primaryScore: number;
  matchScore: number;
};

const sourceHashes: Record<string, string> = {};
for (const [file, expected] of Object.entries(EXPECTED_SOURCE_SHA256)) {
  const actual = sha256(readFileSync(join(sourceDir, file)));
  sourceHashes[file] = actual;
  if (actual !== expected) throw new Error(`${file} snapshot hash changed: ${actual}`);
}

const tipnr = JSON.parse(
  readFileSync(resolve(ROOT, "data/scripture/names/tipnr-index.json"), "utf8"),
) as TipnrIndexFile;
const tipnrPlaces = Object.values(tipnr.entities).filter((entity) => entity.kind === "place");
const ancientRows = readJsonLines<OpenBibleAncient>(join(sourceDir, "ancient.jsonl"));
const modernRows = readJsonLines<OpenBibleModern>(join(sourceDir, "modern.jsonl"));
const imageRows = readJsonLines<OpenBibleImage>(join(sourceDir, "image.jsonl"));
const modernById = new Map(modernRows.map((row) => [row.id, row]));
const imageById = new Map(imageRows.map((row) => [row.id, row]));

const byName = new Map<string, TipnrEntity[]>();
const byTokens = new Map<string, TipnrEntity[]>();
for (const entity of tipnrPlaces) {
  for (const value of [entity.displayName, entity.id.split("@")[0] ?? entity.displayName]) {
    addIndex(byName, nameKey(value), entity);
    addIndex(byTokens, tokenKey(value), entity);
  }
}

const candidatesByEntity = new Map<string, Candidate[]>();
const unmatchedLinks: Array<{ ancientId: string; ancientName: string; tipnrId: string }> = [];
const ambiguousLinks: Array<{ ancientId: string; ancientName: string; tipnrId: string; candidates: string[] }> = [];
let linkedAncientCount = 0;

for (const ancient of ancientRows) {
  const linkedTipnrId = ancient.linked_data?.s3b25cf?.id;
  if (!linkedTipnrId) continue;
  linkedAncientCount++;
  const linkedName = linkedTipnrId.split("@")[0]?.replaceAll("_", " ") ?? linkedTipnrId;
  const candidates = uniqueEntities([
    ...(byName.get(nameKey(linkedName)) ?? []),
    ...(byTokens.get(tokenKey(linkedName)) ?? []),
  ]);
  const openBibleRefs = new Set((ancient.verses ?? []).map((verse) => usxToRef(verse.usx)).filter(isString));
  const withVerseOverlap = candidates.filter((entity) => entity.refs.some((ref) => openBibleRefs.has(ref)));
  const resolvedPool = withVerseOverlap.length > 0 ? withVerseOverlap : candidates;
  const ranked = resolvedPool
    .map((entity) => ({ entity, score: entityMatchScore(entity, linkedName, openBibleRefs) }))
    .sort((left, right) => right.score - left.score || left.entity.id.localeCompare(right.entity.id));
  const best = ranked[0];
  if (!best) {
    unmatchedLinks.push({ ancientId: ancient.id, ancientName: ancient.friendly_id, tipnrId: linkedTipnrId });
    continue;
  }
  if (ranked[1] && ranked[1].score === best.score) {
    ambiguousLinks.push({
      ancientId: ancient.id,
      ancientName: ancient.friendly_id,
      tipnrId: linkedTipnrId,
      candidates: ranked.filter((item) => item.score === best.score).map((item) => item.entity.id),
    });
    continue;
  }

  const associations = Object.entries(ancient.modern_associations ?? {})
    .map(([modernId, association]) => ({ modernId, ...association }))
    .filter((association) => modernById.get(association.modernId)?.lonlat)
    .sort((left, right) => right.score - left.score || left.modernId.localeCompare(right.modernId));
  const primaryAssociation = associations[0];
  const modern = primaryAssociation ? modernById.get(primaryAssociation.modernId) : null;
  if (!primaryAssociation || !modern) continue;

  const candidate: Candidate = {
    entity: best.entity,
    ancient,
    modern,
    primaryScore: primaryAssociation.score,
    matchScore: best.score,
  };
  const current = candidatesByEntity.get(best.entity.id) ?? [];
  current.push(candidate);
  candidatesByEntity.set(best.entity.id, current);
}

const selected = [...candidatesByEntity.values()]
  .map((rows) => rows.sort(compareCandidates)[0]!)
  .sort((left, right) => left.entity.id.localeCompare(right.entity.id));

mkdirSync(outputDir, { recursive: true });
rmSync(mediaDir, { recursive: true, force: true });
mkdirSync(mediaDir, { recursive: true });

const desiredFiles = new Set<string>();
for (const candidate of selected) {
  const thumbnail = candidate.modern.media?.thumbnail;
  const image = thumbnail?.image_id ? imageById.get(thumbnail.image_id) : null;
  if (!thumbnail?.file || !image?.license || !APPROVED_IMAGE_LICENSES.has(image.license)) continue;
  desiredFiles.add(thumbnail.file);
}

const zipEntries = execFileSync("unzip", ["-Z1", thumbnailZip], { maxBuffer: 16 * 1024 * 1024 })
  .toString("utf8")
  .split("\n")
  .filter(Boolean);
const entryByBasename = new Map(zipEntries.map((entry) => [basename(entry), entry]));
const missingArchiveFiles = [...desiredFiles].filter((file) => !entryByBasename.has(file));
if (missingArchiveFiles.length > 0) {
  throw new Error(`Thumbnail archive is missing ${missingArchiveFiles.length} selected files`);
}
const selectedEntries = [...desiredFiles].map((file) => entryByBasename.get(file)!);
for (let index = 0; index < selectedEntries.length; index += 100) {
  execFileSync("unzip", ["-j", "-o", thumbnailZip, ...selectedEntries.slice(index, index + 100), "-d", mediaDir], {
    stdio: "ignore",
  });
}

const places: Record<string, PlaceResearchRecord> = {};
let imageCount = 0;
const imageKindCounts: Record<PlaceImageKind, number> = {
  site: 0,
  context: 0,
  artifact: 0,
  reception: 0,
};
const usedMedia = new Set<string>();
const invalidCoordinates: string[] = [];
const invalidLicenses: string[] = [];

for (const candidate of selected) {
  const { entity, ancient, modern } = candidate;
  const associations = Object.entries(ancient.modern_associations ?? {})
    .map(([modernId, association]) => ({ modernId, ...association }))
    .filter((association) => modernById.get(association.modernId)?.lonlat)
    .sort((left, right) => right.score - left.score || left.modernId.localeCompare(right.modernId));
  const locations = associations.map((association) => toLocation(modernById.get(association.modernId)!, association.score));
  const primary = locations[0];
  if (!primary || !validCoordinate(primary.longitude, primary.latitude)) {
    invalidCoordinates.push(entity.id);
    continue;
  }

  const thumbnail = modern.media?.thumbnail;
  const sourceImage = thumbnail?.image_id ? imageById.get(thumbnail.image_id) : null;
  let image: PlaceResearchImage | undefined;
  if (thumbnail?.file && sourceImage?.license && APPROVED_IMAGE_LICENSES.has(sourceImage.license)) {
    const mediaPath = join(mediaDir, thumbnail.file);
    if (existsSync(mediaPath)) {
      const sourceWidth = sourceImage.width ?? 512;
      const sourceHeight = sourceImage.height ?? 512;
      const description = cleanMarkup(
        thumbnail.description ?? `View associated with ${modern.friendly_id}`,
      );
      const imageKind = classifyPlaceImageDescription(description);
      image = {
        file: thumbnail.file,
        mimeType: mimeFromExtension(thumbnail.file),
        sha256: sha256(readFileSync(mediaPath)),
        width: 512,
        height: Math.max(1, Math.round(512 * sourceHeight / sourceWidth)),
        kind: imageKind,
        depictedLocation: modern.friendly_id,
        alt: description,
        placeholder: thumbnail.placeholder,
        credit: sourceImage.credit ?? sourceImage.author ?? thumbnail.credit ?? "Wikimedia Commons contributor",
        creditUrl: sourceImage.credit_url ?? thumbnail.credit_url,
        sourceUrl: sourceImage.url ?? sourceImage.file_url ?? thumbnail.credit_url ?? "https://commons.wikimedia.org/",
        license: sourceImage.license,
        licenseUrl: licenseUrl(sourceImage.license),
      };
      imageCount++;
      imageKindCounts[imageKind] += 1;
      usedMedia.add(thumbnail.file);
    }
  } else if (sourceImage?.license && !APPROVED_IMAGE_LICENSES.has(sourceImage.license)) {
    invalidLicenses.push(`${entity.id}: ${sourceImage.license}`);
  }

  places[entity.id] = {
    tipnrId: entity.id,
    ancientId: ancient.id,
    ancientName: ancient.friendly_id,
    type: ancient.types?.join(", ") || modern.type || "place",
    openBibleUrl: `https://www.openbible.info/geo/ancient/${ancient.id}/${ancient.url_slug}`,
    refs: entity.refs,
    primary,
    alternatives: locations.slice(1, 4),
    linkedData: {
      wikidataId: ancient.linked_data?.s7cc8b2?.id,
      pleiadesId: ancient.linked_data?.s2428ed?.id,
    },
    image,
  };
}

for (const file of readdirSync(mediaDir)) {
  if (!usedMedia.has(file)) rmSync(join(mediaDir, file));
}

const naturalEarthRaw = readFileSync(naturalEarthInput);
const naturalEarth = JSON.parse(naturalEarthRaw.toString("utf8")) as { type?: string; features?: unknown[] };
if (naturalEarth.type !== "FeatureCollection" || !Array.isArray(naturalEarth.features) || naturalEarth.features.length < 1) {
  throw new Error("Natural Earth input is not a populated GeoJSON FeatureCollection");
}
copyFileSync(naturalEarthInput, naturalEarthOutput);

const placeCount = Object.keys(places).length;
const artifact: PlaceResearchArtifact = {
  meta: {
    formatVersion: 2,
    id: "openbible-place-research",
    name: "OpenBible Bible Geocoding",
    sourceUrl: "https://github.com/openbibleinfo/Bible-Geocoding-Data",
    sourceCommit: SOURCE_COMMIT,
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "OpenBible Bible Geocoding, CC BY 4.0",
    naturalEarthVersion: "5.1.2 (50m land)",
    naturalEarthLicense: "Public domain",
    placeCount,
    imageCount,
    imageKinds: imageKindCounts,
  },
  places,
};

const normalized = `${JSON.stringify(artifact)}\n`;
writeFileSync(outputPath, normalized);
const mediaBytes = [...usedMedia].reduce((sum, file) => sum + statSync(join(mediaDir, file)).size, 0);
const doctor = {
  status: "healthy",
  source: {
    name: "OpenBible Bible Geocoding",
    commit: SOURCE_COMMIT,
    license: "CC BY 4.0",
    rawSha256: sourceHashes,
    thumbnailArchive: basename(thumbnailZip),
    naturalEarth: {
      version: "5.1.2",
      license: "Public domain",
      sha256: sha256(naturalEarthRaw),
      featureCount: naturalEarth.features.length,
    },
  },
  coverage: {
    tipnrPlaceCount: tipnrPlaces.length,
    openBibleAncientCount: ancientRows.length,
    linkedAncientCount,
    matchedTipnrPlaceCount: placeCount,
    unmatchedTipnrPlaceCount: tipnrPlaces.length - placeCount,
    imageCount,
    imageKinds: imageKindCounts,
    mediaBytes,
  },
  checks: {
    sourceHashes: Object.entries(EXPECTED_SOURCE_SHA256).every(([file, expected]) => sourceHashes[file] === expected),
    identityCoverage: placeCount >= 900,
    uniqueTipnrIdentity: placeCount === new Set(Object.keys(places)).size,
    validCoordinates: invalidCoordinates.length === 0,
    licensedMedia: Object.values(places).every((place) => (
      !place.image || APPROVED_IMAGE_LICENSES.has(place.image.license)
    )),
    mediaSemanticsComplete: Object.values(places).every((place) => (
      !place.image
      || (place.image.depictedLocation.trim().length > 0
        && place.image.alt.trim().length > 0
        && ["site", "context", "artifact", "reception"].includes(place.image.kind))
    )),
    imageKindTotalsMatch:
      Object.values(imageKindCounts).reduce((sum, count) => sum + count, 0) === imageCount,
    mediaHashes: Object.values(places).every((place) => !place.image || place.image.sha256 === sha256(readFileSync(join(mediaDir, place.image.file)))),
    naturalEarthPublicDomain: true,
    sourceLicense: true,
    tipnrReferenceParity: Object.entries(places).every(([id, place]) => (
      JSON.stringify(place.refs) === JSON.stringify(tipnr.entities[id]?.refs ?? [])
    )),
  },
  review: {
    unmatchedLinks: unmatchedLinks.slice(0, 100),
    ambiguousLinks: ambiguousLinks.slice(0, 100),
    invalidCoordinates,
    invalidLicenses,
  },
  normalizedSha256: sha256(Buffer.from(normalized)),
};

const failedChecks = Object.entries(doctor.checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failedChecks.length > 0) throw new Error(`OpenBible place import refused: ${failedChecks.join(", ")}`);
writeFileSync(doctorPath, `${JSON.stringify(doctor, null, 2)}\n`);

console.log(`OpenBible places: ${placeCount.toLocaleString()} / ${tipnrPlaces.length.toLocaleString()} TIPNR place identities`);
console.log(`Local photographs: ${imageCount.toLocaleString()} (${(mediaBytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Unmatched links: ${unmatchedLinks.length}; ambiguous links: ${ambiguousLinks.length}`);
console.log(`Wrote ${outputPath}`);
console.log(`Doctor: ${doctorPath}`);

function compareCandidates(left: Candidate, right: Candidate): number {
  const leftExact = nameKey(left.ancient.friendly_id) === nameKey(left.entity.displayName) ? 1 : 0;
  const rightExact = nameKey(right.ancient.friendly_id) === nameKey(right.entity.displayName) ? 1 : 0;
  return rightExact - leftExact
    || right.matchScore - left.matchScore
    || right.primaryScore - left.primaryScore
    || right.ancient.verses!.length - left.ancient.verses!.length
    || left.ancient.id.localeCompare(right.ancient.id);
}

function entityMatchScore(entity: TipnrEntity, linkedName: string, refs: Set<string>): number {
  const rawName = entity.id.split("@")[0] ?? entity.displayName;
  let score = 0;
  if (nameKey(rawName) === nameKey(linkedName)) score += 1_000;
  if (nameKey(entity.displayName) === nameKey(linkedName)) score += 800;
  if (tokenKey(entity.displayName) === tokenKey(linkedName)) score += 500;
  const overlap = entity.refs.filter((ref) => refs.has(ref)).length;
  score += overlap * 20;
  if (entity.firstRef && refs.has(entity.firstRef)) score += 100;
  return score;
}

function toLocation(modern: OpenBibleModern, score: number): PlaceLocation {
  const [longitude, latitude] = (modern.lonlat ?? "0,0").split(",").map(Number);
  return {
    modernId: modern.id,
    name: modern.friendly_id,
    type: modern.type ?? "location",
    longitude: longitude ?? 0,
    latitude: latitude ?? 0,
    score,
    confidence: confidenceFromScore(score),
    precision: modern.precision?.description,
    wikidataId: modern.coordinates_source?.type === "wikidata" ? modern.coordinates_source.id : undefined,
  };
}

function readJsonLines<T>(path: string): T[] {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function addIndex(index: Map<string, TipnrEntity[]>, key: string, entity: TipnrEntity): void {
  if (!key) return;
  const rows = index.get(key) ?? [];
  if (!rows.some((row) => row.id === entity.id)) rows.push(entity);
  index.set(key, rows);
}

function uniqueEntities(entities: TipnrEntity[]): TipnrEntity[] {
  return [...new Map(entities.map((entity) => [entity.id, entity])).values()];
}

function nameKey(value: string): string {
  return value.toLocaleLowerCase()
    .replaceAll("_", " ")
    .replace(/mount of /g, "")
    .replace(/mount /g, "")
    .replace(/ mountains?/g, "")
    .replace(/plains? of /g, "")
    .replace(/[^a-z0-9]/g, "");
}

function tokenKey(value: string): string {
  return value.toLocaleLowerCase()
    .replaceAll("_", " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !["the", "of", "mount", "mountain", "mountains", "plain", "plains", "river"].includes(token))
    .sort()
    .join(":");
}

function usxToRef(value: string | undefined): string | null {
  const match = /^([1-3A-Z]{3}) (\d+):(\d+)$/.exec(value ?? "");
  return match ? `${match[1]}.${Number(match[2])}.${Number(match[3])}` : null;
}

function cleanMarkup(value: string): string {
  return value.replace(/<\/?(?:modern|ancient)(?:\s+id="[^"]+")?>/g, "").replace(/\s+/g, " ").trim();
}

function licenseUrl(license: string): string {
  if (license === "PD" || license === "CC-PD-Mark") return "https://creativecommons.org/publicdomain/mark/1.0/";
  if (license === "CC-Zero") return "https://creativecommons.org/publicdomain/zero/1.0/";
  const match = /^CC-BY(-SA)?-(\d\.\d)(?:-[A-Z]+)?$/.exec(license);
  if (match) return `https://creativecommons.org/licenses/by${match[1] ? "-sa" : ""}/${match[2]}/`;
  if (license === "OGL-1.0") return "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/1/";
  if (license === "FAL") return "https://artlibre.org/licence/lal/en/";
  return "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia";
}

function mimeFromExtension(file: string): string {
  const extension = extname(file).toLocaleLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

function validCoordinate(longitude: number, latitude: number): boolean {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isString(value: string | null): value is string {
  return value != null;
}
