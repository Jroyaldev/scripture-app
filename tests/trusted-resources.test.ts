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
import {
  clearTrustedResourceManifestCache,
  loadTrustedResourceManifests,
} from "../src/host/trusted-resource-loader.js";

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

/**
 * The query IPC loads per call, so an imported catalogue would otherwise be
 * revalidated on every pin and hover. What matters is that the saving is real
 * (the same validated object comes back) and that it never costs correctness
 * (a changed file is picked up without a restart).
 */
test("a validated manifest is reused until its file changes", () => {
  clearTrustedResourceManifestCache();
  const temp = mkdtempSync(join(tmpdir(), "pericope-resource-cache-"));
  const installedRoot = join(temp, ".artifacts/resources");
  const sourceRoot = join(installedRoot, "working-preacher");
  mkdirSync(sourceRoot, { recursive: true });
  const manifestPath = join(sourceRoot, "manifest.json");
  const original = readManifest("working-preacher") as TrustedResourceManifestV1;
  writeFileSync(manifestPath, JSON.stringify(original, null, 2));

  const load = (): TrustedResourceManifestV1 | undefined => {
    const result = loadTrustedResourceManifests({
      installedRoot, bundledRoot: join(root, "data/resources"), backbone, sourceIds: ["working-preacher"],
    });
    assert.equal(result.ok, true);
    return result.ok ? result.manifests[0]?.manifest : undefined;
  };

  const first = load();
  const second = load();
  assert.ok(first);
  assert.equal(first, second, "an unchanged manifest must not be reparsed");

  // A record dropped changes the file size, so the stamp cannot match.
  const trimmed: TrustedResourceManifestV1 = { ...original, records: original.records.slice(0, 1) };
  writeFileSync(manifestPath, JSON.stringify(trimmed, null, 2));
  const third = load();
  assert.notEqual(third, first, "a changed manifest must be reloaded");
  assert.equal(third?.records.length, 1);

  // A refusal must not be cached, or the fix would never be seen.
  writeFileSync(manifestPath, JSON.stringify({ version: 999 }));
  const refused = loadTrustedResourceManifests({
    installedRoot, bundledRoot: join(root, "data/resources"), backbone, sourceIds: ["working-preacher"],
  });
  assert.equal(refused.ok, false);
  writeFileSync(manifestPath, JSON.stringify(original, null, 2));
  assert.equal(load()?.records.length, original.records.length);
});

/**
 * Working Preacher publishes ~14% of its commentaries in Spanish, always beside
 * an English edition and never instead of one. Ranking them as equals handed an
 * English reader the translation about half the time, and both copies the rest.
 */
test("a reader's language breaks ties, and a source may not restate itself", () => {
  const record = (id: string, over: Partial<TrustedResourceManifestV1["records"][number]>) => ({
    id, sourceId: "working-preacher", kind: "commentary" as const,
    title: id, officialUrl: `https://www.workingpreacher.org/${id}`,
    brefs: ["bref:v1/ROM.8.1-ROM.8.11"], matchBasis: "publisher-title" as const, ...over,
  });
  const manifest: TrustedResourceManifestV1 = {
    schema: "pericope.trusted-resource-manifest",
    version: 1,
    source: { id: "working-preacher", name: "Working Preacher", homepageUrl: "https://www.workingpreacher.org/", officialHosts: ["www.workingpreacher.org"] },
    provenance: { publisher: "Luther Seminary", reviewedAt: "2026-07-27", coverage: "reviewed-sample", permissions: "outbound-link-only" },
    capabilities: ["outbound-link"],
    records: [
      // The Spanish id sorts first, so without a preference it wins the tie.
      record("aa-spanish", { metadata: { language: "es" } }),
      record("bb-english", { metadata: { language: "en" } }),
      record("cc-unlabelled", {}),
    ],
  };
  const query = { bref: "bref:v1/ROM.8.1-ROM.8.11", limit: 3 };

  assert.equal(rankTrustedResources([manifest], query)[0]?.record.id, "aa-spanish");
  const preferred = rankTrustedResources([manifest], { ...query, preferLanguage: "en" });
  assert.equal(preferred[0]?.record.id, "bb-english", "the reader's language wins a tie");
  assert.equal(preferred.length, 1, "the same source at the same coordinates may not take a second slot");

  // A record that declares no language is never demoted for it.
  const unlabelledOnly: TrustedResourceManifestV1 = { ...manifest, records: [manifest.records[0] as never, manifest.records[2] as never] };
  assert.equal(
    rankTrustedResources([unlabelledOnly], { ...query, preferLanguage: "en" })[0]?.record.id,
    "cc-unlabelled",
  );

  assert.equal(validateTrustedResourceQuery({ ...query, preferLanguage: "en" }, backbone).ok, true);
  assert.equal(validateTrustedResourceQuery({ ...query, preferLanguage: "english" }, backbone).ok, false);
  assert.equal(validateTrustedResourceQuery({ ...query, preferLanguage: 7 }, backbone).ok, false);
});

test("resource runtime is read-only and network-free", () => {
  const core = readFileSync(join(root, "src/core/resources/trusted-resources.ts"), "utf8");
  const loader = readFileSync(join(root, "src/host/trusted-resource-loader.ts"), "utf8");
  assert.doesNotMatch(core, /node:|fetch\(|writeFile|appendFile|RevisionStore/);
  assert.doesNotMatch(loader, /fetch\(|https?:|writeFile|appendFile|mkdir|unlink/);
  assert.match(loader, /invalid-installed-manifest/);
});
