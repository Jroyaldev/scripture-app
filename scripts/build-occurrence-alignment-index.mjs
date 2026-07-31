#!/usr/bin/env node
/**
 * Rebuild the byte-offset index for a package's occurrence-alignment artifact
 * (2026-07-30, the connection-lines revival).
 *
 *   node scripts/build-occurrence-alignment-index.mjs web kjv ylt
 *
 * WHY THIS EXISTS. d3712ab shipped WEB/KJV/YLT occurrence alignments whose
 * index files carried only {artifact_sha256, verses} — the store's closed
 * index shape (type, format_version, provenance, meta range, offset unit)
 * was never written, so OccurrenceAlignmentStore refused the artifacts and
 * every non-BSB exact-word capture failed with artifact-missing. The index
 * is declared `derived / rebuildable_from: jsonl-artifact`, and this script
 * is that rebuild: it scans the JSONL once, records the meta row's byte
 * range and every verse row's range keyed by its bref, digests the whole
 * file, and writes the full closed shape atomically.
 *
 * PROVENANCE NOTE, SAID LOUDLY: bootstrap-dialect artifacts (meta
 * `alignment_provenance: "bootstrap-v1"`) carry no frozen-source SHA — they
 * were not built from the BSB tables TSV — so `source_sha256` here is the
 * artifact's own digest (self-provenance). The store admits that exact
 * combination only for the bootstrap dialect; the BSB artifact keeps its
 * true source provenance and this script refuses to touch it.
 */
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const packages = process.argv.slice(2);
if (packages.length === 0) {
  console.error("usage: node scripts/build-occurrence-alignment-index.mjs <packageId>...");
  process.exit(2);
}

for (const packageId of packages) {
  if (packageId === "bsb") {
    console.error("bsb carries true frozen-source provenance; its index is written by its own builder.");
    process.exit(2);
  }
  const jsonlPath = resolve(`data/scripture/packages/${packageId}/occurrence-alignments-v1.jsonl`);
  const indexPath = jsonlPath.replace(/\.jsonl$/u, ".index.json");
  const bytes = readFileSync(jsonlPath);
  const artifactSha256 = createHash("sha256").update(bytes).digest("hex");

  let metaRange = null;
  const verses = {};
  let offset = 0;
  while (offset < bytes.length) {
    let end = bytes.indexOf(0x0a, offset);
    if (end === -1) end = bytes.length;
    const line = bytes.subarray(offset, end);
    if (line.length > 0) {
      const row = JSON.parse(line.toString("utf8"));
      if (row.type === "occurrence-alignment-meta") {
        if (metaRange) throw new Error(`${packageId}: duplicate meta row`);
        if (row.package_id !== packageId) throw new Error(`${packageId}: meta package mismatch`);
        metaRange = [offset, line.length];
      } else if (row.type === "occurrence-alignment-verse") {
        if (typeof row.ref !== "string" || !/^bref:v1\/[0-9A-Z]{3}\.[1-9]\d*\.[1-9]\d*$/u.test(row.ref)) {
          throw new Error(`${packageId}: invalid ref at byte ${offset}`);
        }
        if (verses[row.ref]) throw new Error(`${packageId}: duplicate ref ${row.ref}`);
        verses[row.ref] = [offset, line.length];
      } else {
        throw new Error(`${packageId}: unknown row type ${row.type} at byte ${offset}`);
      }
    }
    offset = end + 1;
  }
  if (!metaRange) throw new Error(`${packageId}: no meta row`);

  const index = {
    type: "jsonl-byte-offset-index",
    format_version: 1,
    derived: true,
    rebuildable_from: "jsonl-artifact",
    artifact_type: `${packageId}-occurrence-alignments-v1`,
    layer: "backbone-token:v1",
    source_sha256: artifactSha256,
    artifact_sha256: artifactSha256,
    offset_unit: "utf8-byte",
    meta: metaRange,
    verses,
  };
  const tempPath = `${indexPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(index)}\n`);
  renameSync(tempPath, indexPath);
  console.log(`${packageId}: indexed ${Object.keys(verses).length} verses, artifact ${artifactSha256.slice(0, 12)}…`);
}
