import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  PlaceResearchIndex,
  confidenceFromScore,
  type PlaceResearchArtifact,
} from "../src/core/entities/place-research.js";
import { PlaceResearchLoader } from "../src/host/place-research-loader.js";
import type { TipnrIndexFile } from "../src/core/language/tipnr.js";

const root = resolve(import.meta.dirname, "..");
const placeDirectory = resolve(root, "data/scripture/places");
const artifactPath = resolve(placeDirectory, "openbible-places.json");
const naturalEarthPath = resolve(placeDirectory, "natural-earth-50m-land.geojson");
const doctorPath = resolve(placeDirectory, "doctor-report.json");
const tipnrPath = resolve(root, "data/scripture/names/tipnr-index.json");

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

test("place research artifact keeps OpenBible identity, geography, and media provenance", () => {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as PlaceResearchArtifact;
  assert.equal(artifact.meta.placeCount, 907);
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
  assert.equal(corinth.image.license, "CC-BY-SA-4.0");
  assert.equal(
    sha256(readFileSync(resolve(placeDirectory, "media", corinth.image.file))),
    corinth.image.sha256,
  );
});

test("place research Doctor refuses silent source, coordinate, identity, or license drift", () => {
  const doctor = JSON.parse(readFileSync(doctorPath, "utf8")) as {
    status: string;
    coverage: { matchedTipnrPlaceCount: number; imageCount: number };
    checks: Record<string, boolean>;
  };
  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.coverage.matchedTipnrPlaceCount, 907);
  assert.ok(doctor.coverage.imageCount >= 590);
  assert.deepEqual(Object.entries(doctor.checks).filter(([, passed]) => !passed), []);
  for (const required of [
    "sourceHashes",
    "identityCoverage",
    "uniqueTipnrIdentity",
    "validCoordinates",
    "licensedMedia",
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
  assert.equal(index.loadArtifact(readFileSync(artifactPath, "utf8")), 907);
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
  assert.equal(loader.load(placeDirectory), 907);

  const paul = tipnr.entities["Paul@Act.7.58-2Pe=G3972G"];
  assert.ok(paul);
  const personResearch = loader.research(paul);
  assert.equal(personResearch.place, null);
  assert.equal(personResearch.minimap, null);
  assert.equal(personResearch.imageDataUrl, null);

  const corinth = tipnr.entities["Corinth@Act.18.1-2Ti=G2882"];
  assert.ok(corinth);
  const placeResearch = loader.research(corinth);
  assert.equal(placeResearch.place?.ancientName, "Corinth");
  assert.ok(placeResearch.minimap?.landPaths.length);
  assert.match(placeResearch.imageDataUrl ?? "", /^data:image\/jpeg;base64,/);
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
