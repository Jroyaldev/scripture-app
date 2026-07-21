import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { LibraryEngine } from "../src/host/library.js";

const dataDir = resolve(import.meta.dirname, "../data/scripture");
const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(dataDir, "book-names-en.json"), "utf8")) as BookNameMap;

function sqliteAvailable(): boolean {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

const sqliteSkip = sqliteAvailable()
  ? false
  : "better-sqlite3 is built for the Electron ABI — run this suite through Electron-as-Node";

test("deferred initialization publishes the manifest only as an atomic final marker", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-init-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary(false);

    const manifestPath = join(root, "config/library-manifest.json");
    assert.equal(existsSync(manifestPath), false);
    assert.equal(existsSync(join(root, "config/library.json")), true,
      "candidate files may be staged without making the Library look complete");

    engine.commitLibraryManifest();
    assert.equal(existsSync(manifestPath), true);
    assert.deepEqual(
      readdirSync(join(root, "config")).filter((name) => name.includes("library-manifest") && name.endsWith(".tmp")),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a deferred candidate can build and verify Derived state before publishing its manifest", { skip: sqliteSkip }, () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-library-staged-build-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames);
    engine.initLibrary(false);
    const manifestPath = join(root, "config/library-manifest.json");

    assert.equal(existsSync(manifestPath), false);
    assert.match(engine.buildSqlite(), /^[a-f0-9]{64}$/);
    assert.equal(engine.isConnectionProjectionCurrent(), true);
    assert.equal(existsSync(manifestPath), false,
      "Derived staging published the manifest before the candidate runtime was complete");

    engine.commitLibraryManifest();
    assert.equal(existsSync(manifestPath), true);
    assert.equal(engine.isConnectionProjectionCurrent(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
