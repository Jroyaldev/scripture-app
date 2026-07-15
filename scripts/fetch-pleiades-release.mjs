/**
 * Fetch only the Pleiades 4.1 place resources linked by the committed
 * OpenBible artifact. Raw source files stay outside the repository (INV-13).
 *
 * Usage: node scripts/fetch-pleiades-release.mjs /tmp/pleiades-4.1
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = process.argv[2] ? resolve(process.argv[2]) : "";
const RELEASE = "4.1";
const RELEASE_DATE = "2025-05-28";
const RELEASE_COMMIT = "b6a6790f71c45e4a4ef60fce296c506f28f458bf";
const RAW_ROOT = `https://raw.githubusercontent.com/isawnyu/pleiades.datasets/${RELEASE_COMMIT}/data/json`;

if (!OUTPUT) throw new Error("Pass an external output directory for the pinned Pleiades source files");

const openBible = JSON.parse(readFileSync(
  resolve(ROOT, "data/scripture/places/openbible-places.json"),
  "utf8",
));
const ids = [...new Set(Object.values(openBible.places)
  .map((place) => place.linkedData?.pleiadesId)
  .filter((value) => typeof value === "string" && /^\d+$/.test(value)))]
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

const files = [];
for (let start = 0; start < ids.length; start += 8) {
  const batch = ids.slice(start, start + 8);
  const downloaded = await Promise.all(batch.map(async (id) => {
    const sourcePath = `${id.slice(0, -2).split("").join("/")}/${id}.json`;
    const sourceUrl = `${RAW_ROOT}/${sourcePath}`;
    const response = await fetch(sourceUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`Pleiades ${id} download failed: ${response.status} ${sourceUrl}`);
    const body = Buffer.from(await response.arrayBuffer());
    const parsed = JSON.parse(body.toString("utf8"));
    if (String(parsed.id) !== id) throw new Error(`Pleiades ${id} returned source id ${String(parsed.id)}`);
    writeFileSync(resolve(OUTPUT, `${id}.json`), body);
    return {
      id,
      sourcePath,
      sourceUrl,
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  }));
  files.push(...downloaded);
  console.log(`Pleiades source: ${Math.min(start + batch.length, ids.length)} / ${ids.length}`);
}

const manifest = {
  formatVersion: 1,
  source: "Pleiades Gazetteer",
  release: RELEASE,
  releaseDate: RELEASE_DATE,
  sourceCommit: RELEASE_COMMIT,
  releaseUrl: "https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1",
  doi: "10.5281/zenodo.1193921",
  license: "CC BY 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
  generatedAt: `${RELEASE_DATE}T20:54:57.000Z`,
  files,
};
writeFileSync(resolve(OUTPUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Fetched ${files.length} pinned Pleiades 4.1 resources to ${OUTPUT}`);
