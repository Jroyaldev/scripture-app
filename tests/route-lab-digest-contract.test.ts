import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");

const C03_PROJECTION = "8b2dcd67ecc6cdbee5ebabf05810ae4f55ba2e321d7000719fc1f9012b1ca1cb";
const C04_C05_SWEEP = "3b01cd13a8db1c6b360e956622be1610de416a63ab745bde4aecf3967c5f6b7f";

test("Route Lab keeps both frozen browser digests as failing, non-rebaselining gates", () => {
  const lab = read("lab", "route-lab.js");
  const runner = read("scripts", "qa-route-lab-digests.mjs");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

  assert.match(lab, new RegExp(`LEGACY_C03_PROJECTION_SHA256 = "${C03_PROJECTION}"`));
  assert.match(lab, new RegExp(`FROZEN_ROUTE_SWEEP_SHA256 = "${C04_C05_SWEEP}"`));
  assert.match(
    lab,
    /gate === "c04" && digest !== FROZEN_ROUTE_SWEEP_SHA256[\s\S]*recordFailure\(\{ renderedSweep: "regressed"/,
  );
  assert.match(lab, /output\.dataset\.sha256 = digest/);
  assert.match(lab, /output\.dataset\.expectedSha256 = FROZEN_ROUTE_SWEEP_SHA256/);

  assert.match(runner, new RegExp(`c03Projection: "${C03_PROJECTION}"`));
  assert.match(runner, new RegExp(`c04Sweep: "${C04_C05_SWEEP}"`));
  assert.match(runner, /assert\.equal\(projection\.sha256, EXPECTED\.c03Projection/);
  assert.match(runner, /assert\.equal\(sweep\.sha256, EXPECTED\.c04Sweep/);
  assert.match(runner, /refusing to hash a fallback-font render/);
  assert.doesNotMatch(runner, /writeFile|appendFile|renameSync/);
  assert.equal(pkg.scripts?.["qa:route-lab-digests"], "node scripts/qa-route-lab-digests.mjs");
});
