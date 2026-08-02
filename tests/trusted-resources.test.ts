import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { BackboneData } from "../src/core/reference/types.js";
import {
  matchTrustedResources,
  rankTrustedResources,
  validateTrustedResourceManifest,
  validateTrustedResourceQuery,
  type TrustedResourceManifestV1,
} from "../src/core/resources/trusted-resources.js";
import {
  allowedTrustedResourceHosts,
  clearTrustedResourceManifestCache,
  loadTrustedResourceManifests,
  TRUSTED_RESOURCE_SOURCES,
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

/**
 * Registering a source used to mean editing two lists in two files. Edit one
 * and the source loads, ranks, and renders a card whose link refuses to open —
 * a failure no test saw and no log mentioned, because everything else worked.
 */
test("a registered source can open its own links", () => {
  const main = readFileSync(join(root, "src/electron/main.ts"), "utf8");
  assert.match(main, /const ALLOWED_TRUSTED_RESOURCE_HOSTS = allowedTrustedResourceHosts\(\)/);
  assert.doesNotMatch(
    main,
    /ALLOWED_TRUSTED_RESOURCE_HOSTS = new Set\(\[/,
    "the runtime allowlist must come from the registry, not a second copy",
  );

  const hosts = allowedTrustedResourceHosts();
  for (const source of TRUSTED_RESOURCE_SOURCES) {
    for (const host of source.officialHosts) {
      assert.ok(hosts.has(host), `${source.id} may not open ${host}`);
    }
  }

  // Where a bundled manifest exists, its hosts must be ones the runtime allows.
  for (const sourceId of sourceIds) {
    const manifest = readManifest(sourceId) as TrustedResourceManifestV1;
    for (const host of manifest.source.officialHosts) {
      assert.ok(hosts.has(host), `bundled ${sourceId} declares unopenable host ${host}`);
    }
  }
});

/**
 * Muting is a preference, so it has to be expressible at the grain a reader
 * actually holds an opinion at: a whole publisher, or one kind from one
 * publisher. Two flat lists could not say the second.
 */
test("mutes silence a publisher, or one kind of one publisher", () => {
  const record = (id: string, kind: "commentary" | "podcast") => ({
    id, sourceId: "working-preacher", kind,
    title: id, officialUrl: `https://www.workingpreacher.org/${id}`,
    brefs: ["bref:v1/ROM.8.1-ROM.8.11"], matchBasis: "publisher-title" as const,
  });
  const manifest: TrustedResourceManifestV1 = {
    schema: "pericope.trusted-resource-manifest",
    version: 1,
    source: { id: "working-preacher", name: "Working Preacher", homepageUrl: "https://www.workingpreacher.org/", officialHosts: ["www.workingpreacher.org"] },
    provenance: { publisher: "Luther Seminary", reviewedAt: "2026-07-27", coverage: "reviewed-sample", permissions: "outbound-link-only" },
    capabilities: ["outbound-link"],
    records: [record("a-commentary", "commentary"), record("b-podcast", "podcast")],
  };
  const ask = (mutes?: string[]) => rankTrustedResources([manifest], {
    bref: "bref:v1/ROM.8.1-ROM.8.11", limit: 5, ...(mutes ? { mutes } : {}),
  }).map((entry) => entry.record.id);

  assert.deepEqual(ask().sort(), ["a-commentary", "b-podcast"]);
  assert.deepEqual(ask(["working-preacher:podcast"]), ["a-commentary"]);
  assert.deepEqual(ask(["working-preacher"]), []);

  // hiddenCount speaks in cards, the same unit as total.
  const muted = matchTrustedResources([manifest], {
    bref: "bref:v1/ROM.8.1-ROM.8.11", limit: 5, mutes: ["working-preacher:podcast"],
  });
  assert.equal(muted.total, 1);
  assert.equal(muted.hiddenCount, 1);

  const q = { bref: "bref:v1/ROM.8.1-ROM.8.11" };
  assert.equal(validateTrustedResourceQuery({ ...q, mutes: ["working-preacher"] }, backbone).ok, true);
  assert.equal(validateTrustedResourceQuery({ ...q, mutes: ["working-preacher:podcast"] }, backbone).ok, true);
  assert.equal(validateTrustedResourceQuery({ ...q, mutes: ["working-preacher:nonsense"] }, backbone).ok, false);
  assert.equal(validateTrustedResourceQuery({ ...q, mutes: ["a:b:c"] }, backbone).ok, false);
  assert.equal(validateTrustedResourceQuery({ ...q, mutes: [""] }, backbone).ok, false);
});

/**
 * Permission to publish a link is not permission to fetch a file, so audio is
 * gated on the source declaring where its media lives — not on the URL merely
 * looking plausible.
 */
test("audio is refused unless its source declared a media host", () => {
  const make = (source: Record<string, unknown>, audioUrl: string): unknown => ({
    schema: "pericope.trusted-resource-manifest",
    version: 1,
    source: { id: "naked-bible", name: "Naked Bible Podcast", homepageUrl: "https://nakedbiblepodcast.com/", officialHosts: ["nakedbiblepodcast.com"], ...source },
    provenance: { publisher: "Naked Bible Podcast", reviewedAt: "2026-07-27", coverage: "reviewed-sample", permissions: "outbound-link-only" },
    capabilities: ["outbound-link"],
    records: [{
      id: "naked-bible:podcast:1", sourceId: "naked-bible", kind: "podcast", title: "An episode",
      officialUrl: "https://nakedbiblepodcast.com/podcast/one/", brefs: ["bref:v1/ROM.8.1"],
      matchBasis: "publisher-title", audioUrl,
    }],
  });
  assert.equal(
    validateTrustedResourceManifest(make({}, "https://nakedbiblepodcast.com/a.mp3"), backbone).ok,
    false,
    "no mediaHosts means no audio",
  );
  assert.equal(
    validateTrustedResourceManifest(make({ mediaHosts: ["nakedbiblepodcast.com"] }, "https://nakedbiblepodcast.com/a.mp3"), backbone).ok,
    true,
  );
  assert.equal(
    validateTrustedResourceManifest(make({ mediaHosts: ["nakedbiblepodcast.com"] }, "https://cdn.example.com/a.mp3"), backbone).ok,
    false,
    "a declared media host does not license every host",
  );
  assert.equal(
    validateTrustedResourceManifest(make({ mediaHosts: ["nakedbiblepodcast.com"] }, "http://nakedbiblepodcast.com/a.mp3"), backbone).ok,
    false,
    "audio must be https",
  );
});

/**
 * The content-security policy is written twice — once in the page the dev server
 * serves, once in the template the production build emits — and only the second
 * ships. A media host added to one and not the other looks right everywhere
 * except in the app.
 */
test("the shipped policy matches the served one, and names the audio host", () => {
  const page = readFileSync(join(root, "src/renderer/index.html"), "utf8");
  const builder = readFileSync(join(root, "scripts/build-renderer.mjs"), "utf8");
  const all = (text: string): string[] =>
    [...text.matchAll(/content="(default-src[^"]+)"/g)].map((match) => match[1] as string);
  const served = all(page);
  assert.equal(served.length, 1, "src/renderer/index.html should declare one policy");
  /* The builder emits two documents — the embedding host and the renderer — so
     the renderer's is identified by matching the served one rather than by
     position. The embedding host has its own policy and no business with media. */
  const shipped = all(builder);
  assert.ok(shipped.length >= 2, "expected the builder to emit both documents");
  assert.ok(
    shipped.includes(served[0] as string),
    "the renderer policy the build ships has drifted from the one the dev server serves",
  );
  const renderer = served[0] as string;
  assert.match(renderer, /media-src 'self' https:\/\/nakedbiblepodcast\.com/);

  /* This once required every media source to be a literal host, which was the
     right rule while every one of them was a file server. Podcast CDNs are not:
     traffic.megaphone.fm 302s to dcs-spotify or dcs-cached, and podbean shards
     across numbered subdomains chosen per request. CSP re-checks the redirect
     target, so a literal-only policy does not narrow anything — it just stops
     the audio playing, which is how this was found.

     What the rule was actually protecting is still protected, and is what is
     asserted now: no source may be a bare scheme or a wildcard loose enough to
     match hosts the publisher does not own. A wildcard must be `*.` followed by
     a registrable domain of at least two labels, and every source must be
     https. `https:`, `*`, `*.com` and `http://…` all still fail. */
  const sources = (/media-src ([^;]+)/.exec(renderer)?.[1] ?? "")
    .trim().split(/\s+/).filter((source) => source !== "'self'");
  assert.ok(sources.length > 0, "the renderer policy must name its media sources");
  for (const source of sources) {
    assert.match(source, /^https:\/\/[^*]/u.test(source) ? /^https:\/\// : /^https:\/\/\*\./,
      `${source} must be an https host or an https subdomain wildcard`);
    const host = source.replace(/^https:\/\//, "");
    if (!host.startsWith("*.")) continue;
    const domain = host.slice(2);
    assert.ok(
      domain.split(".").length >= 2 && !domain.startsWith("*"),
      `${source} widens past a single registrable domain`,
    );
  }
  assert.doesNotMatch(renderer, /media-src[^;]*(?:^|\s)(?:\*|https:)(?:\s|$)/,
    "a bare scheme or bare wildcard would permit any host alive");

  for (const policy of shipped) {
    if (policy === renderer) continue;
    assert.doesNotMatch(policy, /media-src/, "only the renderer needs a media host");
  }
});

/**
 * A wildcard in the policy is a claim about a publisher's delivery network, and
 * the doc is where that claim has to be justified. Left unwritten, the next
 * reader sees `*.something.com` and cannot tell a measured redirect chain from
 * somebody widening the policy until the error stopped.
 */
test("every media wildcard is accounted for in the permissions doc", () => {
  const page = readFileSync(join(root, "src/renderer/index.html"), "utf8");
  const doc = readFileSync(join(root, "docs/trusted-resource-permissions.md"), "utf8");
  /* `[^;]+` ran to END OF FILE, not end of policy: media-src is the last
     directive, so nothing closes it but the attribute's own quote — the
     capture swallowed the rest of the document. Harmless while every wildcard
     sat mid-list; on 2026-08-02 one landed last and arrived as
     `fireside.fm">`, a real host reported as undocumented. Stop at the quote. */
  const policy = /media-src ([^;"]+)/.exec(page)?.[1] ?? "";
  const wildcards = policy.split(/\s+/).filter((source) => source.includes("*."));
  for (const source of wildcards) {
    const domain = source.replace(/^https:\/\/\*\./, "");
    assert.ok(doc.includes(domain), `${source} is in the policy but ${domain} is not explained in the doc`);
  }
});

test("resource runtime is read-only and network-free", () => {
  const core = readFileSync(join(root, "src/core/resources/trusted-resources.ts"), "utf8");
  const loader = readFileSync(join(root, "src/host/trusted-resource-loader.ts"), "utf8");
  assert.doesNotMatch(core, /node:|fetch\(|writeFile|appendFile|RevisionStore/);
  assert.doesNotMatch(loader, /fetch\(|https?:|writeFile|appendFile|mkdir|unlink/);
  assert.match(loader, /invalid-installed-manifest/);
});

/**
 * Breadth before depth was written to stop one publisher taking every slot in a
 * margin that shows three. It was doing more than that: it deleted the extra
 * cards outright, so a reader who opened Working Preacher and asked for
 * everything it had on Psalm 111 was shown one commentary of the twelve it has
 * written — and told the total was one.
 */
test("a publisher's second answer is demoted, never dropped", () => {
  const commentary = (id: string) => ({
    id, sourceId: "working-preacher", kind: "commentary" as const,
    title: `Commentary on Psalm 111 (${id})`,
    officialUrl: `https://www.workingpreacher.org/${id}`,
    brefs: ["bref:v1/PSA.111.1-PSA.111.10"], matchBasis: "publisher-title" as const,
    metadata: { author: id, language: "en" },
  });
  const wp: TrustedResourceManifestV1 = {
    schema: "pericope.trusted-resource-manifest", version: 1,
    source: { id: "working-preacher", name: "Working Preacher", homepageUrl: "https://www.workingpreacher.org/", officialHosts: ["www.workingpreacher.org"] },
    provenance: { publisher: "Luther Seminary", reviewedAt: "2026-07-27", coverage: "reviewed-sample", permissions: "outbound-link-only" },
    capabilities: ["outbound-link"],
    records: [commentary("gafney"), commentary("norton"), commentary("bellinger"), commentary("hannan")],
  };
  const other: TrustedResourceManifestV1 = {
    ...wp,
    source: { id: "bibleproject", name: "BibleProject", homepageUrl: "https://bibleproject.com/", officialHosts: ["bibleproject.com"] },
    records: [{ ...commentary("bp-one"), sourceId: "bibleproject", kind: "podcast" as const, officialUrl: "https://bibleproject.com/podcasts/x/" }],
  };

  const deep = matchTrustedResources([wp, other], { bref: "bref:v1/PSA.111.1-PSA.111.10", limit: 50 });
  assert.equal(deep.total, 5, "every commentary must be counted, or 'see all' lies about what exists");
  assert.equal(deep.resources.filter((entry) => entry.source.id === "working-preacher").length, 4,
    "opening a publisher must reach every card it has for the passage");

  /* And the reason the guard exists still holds: with a margin's worth of room,
     each publisher is heard before either is heard twice. */
  const margin = matchTrustedResources([wp, other], { bref: "bref:v1/PSA.111.1-PSA.111.10", limit: 2 });
  assert.deepEqual(margin.resources.map((entry) => entry.source.id), ["bibleproject", "working-preacher"]);

  // Demoted, not merely present: the repeats sort below anything novel.
  const order = deep.resources.map((entry) => entry.source.id);
  assert.equal(order.slice(0, 2).includes("bibleproject"), true,
    "a second card from one source must not outrank another source's first");
});
