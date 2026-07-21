import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { LibraryManifest } from "../src/core/interfaces.js";
import {
  checkMigration,
  CURRENT_APP_SCHEMA_VERSION,
  CURRENT_EVENT_SCHEMA_VERSION,
} from "../src/core/migration/index.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { LibraryEngine } from "../src/host/library.js";

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = join(repoRoot, "data/scripture");
const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(dataDir, "book-names-en.json"), "utf8")) as BookNameMap;

function manifestAt(appSchemaVersion: number): LibraryManifest {
  return {
    libraryId: "01JTESTLIBRARYIDENTITY0000000",
    createdAt: "2026-07-20T12:34:56.000Z",
    appSchemaVersion,
    eventSchemaVersion: 1,
    referenceFormatVersion: "bref:v1",
    pluginApiVersion: "1",
  };
}

test("schema-v1 dry run exposes a deterministic schema-v2 manifest without mutating input", () => {
  const input = Object.freeze(manifestAt(1));
  const before = JSON.stringify(input);

  const result = checkMigration(input, true);

  assert.equal(result.status, "planned");
  if (result.status !== "planned") return;
  assert.equal(result.fromVersion, 1);
  assert.equal(result.toVersion, 2);
  assert.equal(result.plan.fromVersion, 1);
  assert.equal(result.plan.toVersion, 2);
  assert.deepEqual(result.plan.steps.map((step) => [step.fromVersion, step.toVersion]), [[1, 2]]);
  assert.deepEqual(result.plan.manifest, {
    ...input,
    appSchemaVersion: 2,
  });
  assert.notEqual(result.plan.manifest, input);
  assert.equal(result.manifest, result.plan.manifest);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.plan.manifest.eventSchemaVersion, 1);
  assert.equal(result.plan.manifest.referenceFormatVersion, "bref:v1");
});

test("schema-v2 is current while schema-v3 and event-schema-v2 refuse", () => {
  assert.equal(CURRENT_APP_SCHEMA_VERSION, 2);
  assert.equal(CURRENT_EVENT_SCHEMA_VERSION, 1);

  const currentInput = manifestAt(2);
  const current = checkMigration(currentInput, true);
  assert.equal(current.status, "current");
  if (current.status === "current") {
    assert.deepEqual(current.manifest, currentInput);
    assert.notEqual(current.manifest, currentInput);
  }

  const future = checkMigration(manifestAt(3), true);
  assert.equal(future.status, "refused");
  assert.match(future.message, /newer than the app understands \(2\)/);

  const futureEvent = checkMigration({ ...manifestAt(1), eventSchemaVersion: 2 }, true);
  assert.equal(futureEvent.status, "refused");
  assert.match(futureEvent.message, /event schema version 2 is newer/);
});

test("LibraryEngine explicitly publishes only the migrated manifest and preserves authored bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-migrate-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary();

    const manifestPath = join(root, "config/library-manifest.json");
    const connectionPath = join(root, "annotations/connections.jsonl");
    const legacyManifest = manifestAt(1);
    const authoredBytes = Buffer.from(
      "{\"eventId\":\"evt-v1-authored\",\"schemaVersion\":1,\"entityType\":\"annotation\"}\n",
      "utf8",
    );
    writeFileSync(manifestPath, JSON.stringify(legacyManifest, null, 2));
    writeFileSync(connectionPath, authoredBytes);

    const result = engine.migrateLibraryManifest();

    assert.equal(result.status, "migrated");
    const migrated = engine.readManifest();
    assert.deepEqual(migrated, { ...legacyManifest, appSchemaVersion: 2 });
    assert.equal(migrated?.libraryId, legacyManifest.libraryId);
    assert.equal(migrated?.createdAt, legacyManifest.createdAt);
    assert.deepEqual(readFileSync(connectionPath), authoredBytes);
    assert.deepEqual(
      readdirSync(join(root, "config")).filter((name) => name.startsWith(".library-manifest.")),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("LibraryEngine refuses a future manifest without publishing any bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-refuse-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary();
    const manifestPath = join(root, "config/library-manifest.json");
    const futureBytes = Buffer.from(JSON.stringify(manifestAt(3)), "utf8");
    writeFileSync(manifestPath, futureBytes);

    const result = engine.migrateLibraryManifest();

    assert.equal(result.status, "refused");
    assert.deepEqual(readFileSync(manifestPath), futureBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an atomic manifest publication conflict preserves original and authored bytes and removes its temp file", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-migration-conflict-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary();
    const manifestPath = join(root, "config/library-manifest.json");
    const connectionPath = join(root, "annotations/connections.jsonl");
    const originalManifestBytes = Buffer.from(JSON.stringify(manifestAt(1), null, 2), "utf8");
    const authoredBytes = Buffer.from("{\"eventId\":\"authored-and-untouched\"}\n", "utf8");
    writeFileSync(manifestPath, originalManifestBytes);
    writeFileSync(connectionPath, authoredBytes);

    const atomicPublisher = engine as unknown as {
      publishLibraryManifest(manifest: LibraryManifest, expectedSource: Buffer): void;
    };
    assert.throws(
      () => atomicPublisher.publishLibraryManifest(manifestAt(2), Buffer.from("stale source", "utf8")),
      /manifest changed while its migration was being prepared/,
    );

    assert.deepEqual(readFileSync(manifestPath), originalManifestBytes);
    assert.deepEqual(readFileSync(connectionPath), authoredBytes);
    assert.deepEqual(
      readdirSync(join(root, "config")).filter((name) => name.startsWith(".library-manifest.")),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new libraries begin at schema v2 with event and reference formats still at v1", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-current-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary();

    const manifest = engine.readManifest();
    assert.equal(manifest?.appSchemaVersion, 2);
    assert.equal(manifest?.eventSchemaVersion, 1);
    assert.equal(manifest?.referenceFormatVersion, "bref:v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI dry-run is read-only and explicit migration registers the manifest with RevisionStore", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-cli-migrate-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary();
    const manifestPath = join(root, "config/library-manifest.json");
    const connectionPath = join(root, "annotations/connections.jsonl");
    const legacyManifestBytes = Buffer.from(JSON.stringify(manifestAt(1), null, 2), "utf8");
    const authoredBytes = Buffer.from("authored-v1-connection-log-bytes\n", "utf8");
    writeFileSync(manifestPath, legacyManifestBytes);
    writeFileSync(connectionPath, authoredBytes);

    const dryRun = runCliMigration(root, true);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Status: planned/);
    assert.deepEqual(readFileSync(manifestPath), legacyManifestBytes);
    assert.deepEqual(readFileSync(connectionPath), authoredBytes);
    assert.equal(existsSync(join(root, ".git")), false);

    const migration = runCliMigration(root, false);
    assert.equal(migration.status, 0, migration.stderr);
    assert.match(migration.stdout, /Status: migrated/);
    assert.equal(engine.readManifest()?.appSchemaVersion, 2);
    assert.deepEqual(readFileSync(connectionPath), authoredBytes);

    const registered = spawnSync(
      "git",
      ["ls-files", "--error-unmatch", "config/library-manifest.json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(registered.status, 0, registered.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCliMigration(root: string, dryRun: boolean): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli/index.ts",
      "migrate",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        LIBRARY_PATH: root,
      },
      timeout: 20_000,
    },
  );
}
