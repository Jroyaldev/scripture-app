import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { BackboneData } from "../src/core/reference/types.js";
import {
  rankTrustedResources,
  validateTrustedResourceManifest,
  validateTrustedResourceQuery,
  type TrustedResourceManifestV1,
} from "../src/core/resources/trusted-resources.js";
import { loadTrustedResourceManifests } from "../src/host/trusted-resource-loader.js";

const root = resolve(import.meta.dirname, "..");
const backbone = JSON.parse(readFileSync(join(root, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const sourceIds = ["working-preacher", "bibleproject", "the-gospel-coalition"];

function readManifest(sourceId: string): unknown {
  return JSON.parse(readFileSync(join(root, "data/resources", sourceId, "manifest.json"), "utf8")) as unknown;
}

test("bundled trusted-resource manifests are strict, local, link-only reviewed samples", () => {
  for (const sourceId of sourceIds) {
    const result = validateTrustedResourceManifest(readManifest(sourceId), backbone);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    if (!result.ok) continue;
    assert.equal(result.value.source.id, sourceId);
    assert.deepEqual(result.value.capabilities, ["outbound-link"]);
    assert.equal(result.value.provenance.coverage, "reviewed-sample");
    assert.equal(result.value.provenance.permissions, "outbound-link-only");
    assert.equal(result.value.records.length, 1);
    assert.equal("body" in result.value.records[0]!, false);
    assert.equal("description" in result.value.records[0]!, false);
    assert.equal("artworkUrl" in result.value.records[0]!, false);
  }
});

test("strict manifests refuse unknown versions, fields, foreign URLs, and invalid brefs", () => {
  const original = readManifest("working-preacher") as Record<string, unknown>;
  assert.equal(validateTrustedResourceManifest({ ...original, version: 2 }, backbone).ok, false);
  assert.equal(validateTrustedResourceManifest({ ...original, body: "not allowed" }, backbone).ok, false);

  const foreign = structuredClone(original) as { records: Array<Record<string, unknown>> };
  foreign.records[0]!["officialUrl"] = "https://example.com/commentary";
  assert.equal(validateTrustedResourceManifest(foreign, backbone).ok, false);

  const impossible = structuredClone(original) as { records: Array<Record<string, unknown>> };
  impossible.records[0]!["brefs"] = ["bref:v1/ROM.8.99"];
  assert.equal(validateTrustedResourceManifest(impossible, backbone).ok, false);
});

test("ranking uses explicit exact, overlap, then same-chapter evidence with stable ids", () => {
  const manifests = sourceIds.map((id) => {
    const result = validateTrustedResourceManifest(readManifest(id), backbone);
    assert.equal(result.ok, true);
    return (result as { ok: true; value: TrustedResourceManifestV1 }).value;
  });
  const exact = rankTrustedResources(manifests, { bref: "bref:v1/ROM.8.1-ROM.8.11", limit: 3 });
  assert.equal(exact[0]?.record.id, "working-preacher:commentary:61109");
  assert.equal(exact[0]?.match, "exact-passage");
  assert.deepEqual(exact.map((entry) => entry.source.id), ["working-preacher", "bibleproject", "the-gospel-coalition"]);
  assert.deepEqual(rankTrustedResources(manifests, { bref: "bref:v1/REV.22.1-REV.22.5" }), []);
  assert.equal(validateTrustedResourceQuery({ bref: "bref:v1/ROM.8.99" }, backbone).ok, false);
  assert.equal(validateTrustedResourceQuery({ bref: "bref:v2/ROM.8.1" }, backbone).ok, false);
});

test("installed manifest wins, while a present invalid installed manifest refuses fallback", () => {
  const temp = mkdtempSync(join(tmpdir(), "pericope-resources-"));
  const installedRoot = join(temp, ".artifacts/resources");
  const sourceRoot = join(installedRoot, "working-preacher");
  mkdirSync(sourceRoot, { recursive: true });
  const installed = readManifest("working-preacher") as TrustedResourceManifestV1;
  writeFileSync(join(sourceRoot, "manifest.json"), JSON.stringify(installed));
  const loaded = loadTrustedResourceManifests({ installedRoot, bundledRoot: join(root, "data/resources"), backbone, sourceIds: ["working-preacher"] });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.manifests[0]?.origin, "installed");

  writeFileSync(join(sourceRoot, "manifest.json"), JSON.stringify({ version: 999 }));
  const refused = loadTrustedResourceManifests({ installedRoot, bundledRoot: join(root, "data/resources"), backbone, sourceIds: ["working-preacher"] });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.refusal.code, "invalid-installed-manifest");
});

test("resource runtime is read-only and network-free", () => {
  const core = readFileSync(join(root, "src/core/resources/trusted-resources.ts"), "utf8");
  const loader = readFileSync(join(root, "src/host/trusted-resource-loader.ts"), "utf8");
  assert.doesNotMatch(core, /node:|fetch\(|writeFile|appendFile|RevisionStore/);
  assert.doesNotMatch(loader, /fetch\(|https?:|writeFile|appendFile|mkdir|unlink/);
  assert.match(loader, /invalid-installed-manifest/);
});
