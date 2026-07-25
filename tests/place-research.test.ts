import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  PlaceResearchIndex,
  classifyPlaceImageDescription,
  confidenceFromScore,
  type PlaceResearchArtifact,
} from "../src/core/entities/place-research.js";
import { PlaceResearchLoader } from "../src/host/place-research-loader.js";
import type { TipnrIndexFile } from "../src/core/language/tipnr.js";
import {
  comparePleiadesCoordinates,
  PleiadesResearchIndex,
  type PleiadesResearchArtifact,
} from "../src/core/entities/pleiades-research.js";

const root = resolve(import.meta.dirname, "..");
const placeDirectory = resolve(root, "data/scripture/places");
const artifactPath = resolve(placeDirectory, "openbible-places.json");
const naturalEarthPath = resolve(placeDirectory, "natural-earth-50m-land.geojson");
const doctorPath = resolve(placeDirectory, "doctor-report.json");
const tipnrPath = resolve(root, "data/scripture/names/tipnr-index.json");
const pleiadesPath = resolve(placeDirectory, "pleiades-4.1.json");
const pleiadesDoctorPath = resolve(placeDirectory, "pleiades-doctor-report.json");

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

test("place research artifact keeps OpenBible identity, geography, and media provenance", () => {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as PlaceResearchArtifact;
  assert.equal(artifact.meta.formatVersion, 2);
  assert.equal(artifact.meta.placeCount, 917);
  assert.equal(Object.keys(artifact.places).length, artifact.meta.placeCount);
  assert.equal(artifact.meta.license, "CC BY 4.0");
  assert.equal(artifact.meta.naturalEarthLicense, "Public domain");

  const corinth = artifact.places["Corinth@Act.18.1-2Ti=G2882"];
  assert.ok(corinth);
  assert.equal(corinth.ancientName, "Corinth");
  assert.equal(corinth.primary.confidence, "high");
  assert.equal(corinth.primary.wikidataId, "Q1363688");
  assert.equal(corinth.linkedData.pleiadesId, "570182");
  assert.ok(corinth.refs.includes("ACT.18.1"));
  assert.ok(!corinth.refs.includes("ROM.16.27"));
  assert.ok(corinth.image);
  assert.equal(corinth.image.kind, "site");
  assert.equal(corinth.image.depictedLocation, "Corinth");
  assert.equal(corinth.image.alt, "ruins at Corinth");
  assert.equal(corinth.image.license, "CC-BY-SA-4.0");
  assert.equal(
    sha256(readFileSync(resolve(placeDirectory, "media", corinth.image.file))),
    corinth.image.sha256,
  );

  const ahava = artifact.places["Ahava@Ezr.8.15-=H0163"];
  assert.equal(ahava?.image?.kind, "artifact");
  assert.equal(ahava?.image?.depictedLocation, "Babylon");
  const golgotha = artifact.places["Golgotha@Mat.27.33-Jhn=G1115"];
  assert.equal(golgotha?.image?.kind, "reception");
  assert.equal(golgotha?.image?.depictedLocation, "Church of the Holy Sepulchre");
});

test("place research Doctor refuses silent source, coordinate, identity, or license drift", () => {
  const doctor = JSON.parse(readFileSync(doctorPath, "utf8")) as {
    status: string;
    coverage: {
      matchedTipnrPlaceCount: number;
      imageCount: number;
      imageKinds: Record<string, number>;
    };
    checks: Record<string, boolean>;
  };
  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.coverage.matchedTipnrPlaceCount, 917);
  assert.equal(doctor.coverage.imageCount, 604);
  assert.deepEqual(doctor.coverage.imageKinds, {
    site: 223,
    context: 340,
    artifact: 30,
    reception: 11,
  });
  assert.deepEqual(Object.entries(doctor.checks).filter(([, passed]) => !passed), []);
  for (const required of [
    "sourceHashes",
    "identityCoverage",
    "uniqueTipnrIdentity",
    "validCoordinates",
    "licensedMedia",
    "mediaSemanticsComplete",
    "imageKindTotalsMatch",
    "mediaHashes",
    "naturalEarthPublicDomain",
    "sourceLicense",
    "tipnrReferenceParity",
  ]) {
    assert.equal(doctor.checks[required], true, `${required} must remain a passing import gate`);
  }
});

test("place research references stay byte-for-byte aligned with canonical TIPNR refs", () => {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as PlaceResearchArtifact;
  const tipnr = JSON.parse(readFileSync(tipnrPath, "utf8")) as TipnrIndexFile;
  for (const [id, place] of Object.entries(artifact.places)) {
    assert.deepEqual(place.refs, tipnr.entities[id]?.refs, id);
  }
});

test("minimap geometry is deterministic and locates alternatives without a network map", () => {
  const index = new PlaceResearchIndex();
  assert.equal(index.loadArtifact(readFileSync(artifactPath, "utf8")), 917);
  assert.ok(index.loadNaturalEarth(readFileSync(naturalEarthPath, "utf8")) > 1_000);
  const map = index.minimap("Corinth@Act.18.1-2Ti=G2882");
  assert.ok(map);
  assert.ok(map.landPaths.length > 0);
  assert.equal(map.width, 320);
  assert.equal(map.height, 164);
  assert.ok(map.center.x >= 0 && map.center.x <= map.width);
  assert.ok(map.center.y >= 0 && map.center.y <= map.height);
  assert.deepEqual(index.minimap("Corinth@Act.18.1-2Ti=G2882"), map);
  assert.equal(index.minimap("missing"), null);
});

test("host research gracefully keeps people and unmapped places useful", () => {
  const tipnr = JSON.parse(readFileSync(tipnrPath, "utf8")) as TipnrIndexFile;
  const loader = new PlaceResearchLoader();
  assert.equal(loader.load(placeDirectory), 917);

  const paul = tipnr.entities["Paul@Act.7.58-2Pe=G3972G"];
  assert.ok(paul);
  const personResearch = loader.research(paul);
  assert.equal(personResearch.place, null);
  assert.equal(personResearch.pleiades, null);
  assert.equal(personResearch.imageDataUrl, null);

  const corinth = tipnr.entities["Corinth@Act.18.1-2Ti=G2882"];
  assert.ok(corinth);
  const placeResearch = loader.research(corinth);
  assert.equal(placeResearch.place?.ancientName, "Corinth");
  assert.equal(placeResearch.pleiades?.place.id, "570182");
  assert.equal(placeResearch.pleiades?.place.title, "Corinthus/Korinthos");
  assert.equal(placeResearch.pleiades?.coordinateComparison?.relation, "close");
  assert.match(placeResearch.imageDataUrl ?? "", /^data:image\/jpeg;base64,/);

  // The loader must not carry the minimap. §C·2 replaced the decorative map
  // with the bearing line, so shipping clipped land polygons across IPC on
  // every place opened bought a reader nothing. The generator is still tested
  // above — this asserts only that nothing is paying for it in the meantime.
  assert.ok(!("minimap" in placeResearch), "research() must not compute the minimap for a reader who cannot see it");
});

test("pinned Pleiades release preserves ancient names, geometry, connections, and bibliography", () => {
  const artifact = JSON.parse(readFileSync(pleiadesPath, "utf8")) as PleiadesResearchArtifact;
  assert.equal(artifact.meta.formatVersion, 1);
  assert.equal(artifact.meta.release, "4.1");
  assert.equal(artifact.meta.releaseDate, "2025-05-28");
  assert.equal(artifact.meta.sourceCommit, "b6a6790f71c45e4a4ef60fce296c506f28f458bf");
  assert.equal(artifact.meta.license, "CC BY 3.0");
  assert.equal(artifact.meta.placeCount, 96);

  const index = new PleiadesResearchIndex();
  assert.equal(index.loadArtifact(readFileSync(pleiadesPath, "utf8")), 96);
  const corinth = index.get("570182");
  assert.ok(corinth);
  assert.ok(corinth.names.some((name) => name.attested === "Κόρινθος"));
  assert.ok(corinth.locations.some((location) => location.geometry != null));
  assert.ok(corinth.connections.some((connection) => connection.title.includes("Achaia")));
  assert.ok(corinth.references.some((reference) => reference.shortTitle?.startsWith("Str.")));
  assert.equal(comparePleiadesCoordinates(corinth, 22.8792, 37.9061)?.relation, "close");
});

test("Pleiades Doctor pins release integrity and reports coordinate disagreement without merging it", () => {
  const doctor = JSON.parse(readFileSync(pleiadesDoctorPath, "utf8")) as {
    status: string;
    coverage: { linkedPleiadesIds: number; coordinatesOver100Km: number };
    checks: Record<string, boolean>;
  };
  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.coverage.linkedPleiadesIds, 96);
  assert.equal(doctor.coverage.coordinatesOver100Km, 19);
  assert.deepEqual(Object.entries(doctor.checks).filter(([, passed]) => !passed), []);
  for (const required of [
    "manifestPinned",
    "expectedLinkedCoverage",
    "sourceHashes",
    "sourceIdsMatch",
    "uniquePlaceIds",
    "validCoordinates",
    "validGeometry",
    "sourceRights",
    "richMetadataPreserved",
    "coordinateComparisonComplete",
  ]) {
    assert.equal(doctor.checks[required], true, `${required} must remain a passing import gate`);
  }
});

test("place image semantics are conservative about site, context, artifact, and reception", () => {
  assert.equal(classifyPlaceImageDescription("ruins at Corinth"), "site");
  assert.equal(classifyPlaceImageDescription("panorama of a valley in Achaia"), "context");
  assert.equal(classifyPlaceImageDescription("Ishtar gate from Babylon"), "artifact");
  assert.equal(classifyPlaceImageDescription("model of Herod's palace"), "reception");
  assert.equal(classifyPlaceImageDescription("exterior of the Church of the Holy Sepulchre"), "reception");
});

test("confidence bands remain grammatical metadata, not invented certainty", () => {
  assert.equal(confidenceFromScore(1_000), "high");
  assert.equal(confidenceFromScore(650), "strong");
  assert.equal(confidenceFromScore(350), "probable");
  assert.equal(confidenceFromScore(1), "tentative");
  assert.equal(confidenceFromScore(0), "disputed");
});

test("place map construction remains pure core TypeScript", () => {
  const source = readFileSync(resolve(root, "src/core/entities/place-research.ts"), "utf8");
  assert.doesNotMatch(source, /from ["']node:/);
  assert.doesNotMatch(source, /electron/i);
});

test("renderer permits packaged entity media without permitting remote images", () => {
  for (const relativePath of ["src/renderer/index.html", "scripts/build-renderer.mjs"]) {
    const html = readFileSync(resolve(root, relativePath), "utf8");
    assert.match(html, /img-src 'self' data:/, relativePath);
    assert.doesNotMatch(html, /img-src[^;]*https:/, relativePath);
  }
});

test("external media provenance uses a narrow HTTPS host allowlist", () => {
  const main = readFileSync(resolve(root, "src/electron/main.ts"), "utf8");
  assert.match(main, /ALLOWED_RESEARCH_LINK_HOSTS/);
  assert.match(main, /parsed\.protocol !== "https:"/);
  assert.match(main, /commons\.wikimedia\.org/);
  assert.match(main, /creativecommons\.org/);
  assert.match(main, /pleiades\.stoa\.org/);
  assert.doesNotMatch(main, /shell\.openExternal\(value\)/);
});
