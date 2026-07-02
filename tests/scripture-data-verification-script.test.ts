import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("package.json exposes an explicit exhaustive scripture data verification gate", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(
    pkg.scripts["verify:data"],
    "node --import tsx scripts/verify-scripture-packages.ts",
  );
  assert.equal(
    existsSync(join(repoRoot, "scripts", "verify-scripture-packages.ts")),
    true,
    "scripts/verify-scripture-packages.ts should exist",
  );
});
