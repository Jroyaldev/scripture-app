/**
 * Task A1 smoke test — verifies the native build workflow is wired up.
 *
 * Intentionally ABI-independent: this test must pass regardless of whether
 * `better-sqlite3` is currently built for Electron (ABI 133) or Node (ABI 137).
 * It checks that the rebuild/preflight scripts are declared, the preflight
 * script is syntactically valid, and the developer note exists — i.e. the
 * scaffolding that makes the ABI split reproducible.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const pkgPath = join(repoRoot, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
  scripts: Record<string, string>;
};

test("package.json declares the two native rebuild scripts", () => {
  assert.equal(typeof pkg.scripts["rebuild:node"], "string");
  assert.equal(typeof pkg.scripts["rebuild:electron"], "string");
  assert.match(pkg.scripts["rebuild:node"], /better-sqlite3/);
  assert.match(pkg.scripts["rebuild:electron"], /electron-rebuild.*better-sqlite3/);
});

test("package.json declares the electron preflight script and wires it into start", () => {
  assert.equal(typeof pkg.scripts["preflight:electron"], "string");
  assert.match(pkg.scripts["preflight:electron"], /preflight-native\.cjs/);
  assert.match(pkg.scripts["start"], /preflight:electron/);
});

test("package.json exposes typecheck halves", () => {
  assert.equal(typeof pkg.scripts["typecheck"], "string");
  assert.equal(typeof pkg.scripts["typecheck:renderer"], "string");
  assert.match(pkg.scripts["typecheck:renderer"], /tsconfig\.renderer\.json/);
});

test("preflight-native.cjs exists and is syntactically valid", () => {
  const preflightPath = join(repoRoot, "scripts/preflight-native.cjs");
  assert.equal(existsSync(preflightPath), true, "scripts/preflight-native.cjs should exist");
  const result = spawnSync("node", ["--check", preflightPath], { cwd: repoRoot });
  assert.equal(result.status, 0, `preflight syntax check failed: ${result.stderr?.toString()}`);
});

test("docs/native-build.md documents the ABI split", () => {
  const docPath = join(repoRoot, "docs/native-build.md");
  assert.equal(existsSync(docPath), true, "docs/native-build.md should exist");
  const doc = readFileSync(docPath, "utf-8");
  assert.match(doc, /rebuild:node/);
  assert.match(doc, /rebuild:electron/);
  assert.match(doc, /133/);
  assert.match(doc, /137/);
});
