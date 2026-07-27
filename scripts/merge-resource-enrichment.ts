/**
 * Fold enrichment answers back into a manifest, refusing anything unusable.
 *
 * This is the half that makes the packet worth issuing: an answer file is only
 * as good as the thing that checks it. Every row is validated on its own, the
 * whole manifest is validated at the end, and nothing is written unless it
 * would load. Rejections are reported per row with a reason, so a worker can
 * fix twelve rows rather than redo four hundred.
 *
 * Usage:
 *   node --import tsx scripts/merge-resource-enrichment.ts --source the-gospel-coalition
 *        [--in enrichment/<source>] [--manifest <path>] [--dry-run]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveManifestPath } from "./resource-import-target.js";
import {
  validateTrustedResourceManifest,
  type TrustedResourceKind,
  type TrustedResourceManifestV1,
  type TrustedResourceRecordV1,
} from "../src/core/resources/trusted-resources.js";
import { parseBref, validateRef } from "../src/core/reference/parser.js";
import type { BackboneData } from "../src/core/reference/types.js";

const ROOT = resolve(import.meta.dirname, "..");
const KINDS = new Set<TrustedResourceKind>(["article", "commentary", "guide", "podcast", "sermon", "video"]);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sourceId = arg("source") ?? "the-gospel-coalition";
const inDir = arg("in") ?? join(ROOT, "enrichment", sourceId);
const manifestPath = arg("manifest") ?? resolveManifestPath(sourceId).path;
const dryRun = process.argv.includes("--dry-run");

const backbone = JSON.parse(readFileSync(join(ROOT, "data/scripture/backbone.json"), "utf8")) as BackboneData;

if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}. Run the importer for ${sourceId} first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TrustedResourceManifestV1;
const byId = new Map(manifest.records.map((record) => [record.id, record]));

/* The task file is the authority on what a record is: an answer may say where
   it belongs, never rename it or move it to another publisher. */
const tasks = new Map<string, { id: string; sourceId: string; kind: string; title: string; url: string; publishedAt?: string }>();
for (const file of readdirSync(inDir).filter((name) => /^tasks-\d+\.jsonl$/.test(name))) {
  for (const line of readFileSync(join(inDir, file), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const task = JSON.parse(line) as { id: string; sourceId: string; kind: string; title: string; url: string; publishedAt?: string };
    tasks.set(task.id, task);
  }
}

type Reject = { file: string; line: number; id: string; reason: string };
const rejects: Reject[] = [];
const added: TrustedResourceRecordV1[] = [];
let skipped = 0;
let seenAnswers = 0;
const answeredIds = new Set<string>();

for (const file of readdirSync(inDir).filter((name) => /^answers-\d+\.jsonl$/.test(name)).sort()) {
  const lines = readFileSync(join(inDir, file), "utf8").split("\n");
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const at = (reason: string): void => { rejects.push({ file, line: index + 1, id: "?", reason }); };
    let answer: Record<string, unknown>;
    try { answer = JSON.parse(raw) as Record<string, unknown>; } catch { at("not valid JSON"); return; }
    seenAnswers += 1;

    const id = typeof answer["id"] === "string" ? answer["id"] : "";
    const fail = (reason: string): void => { rejects.push({ file, line: index + 1, id: id || "?", reason }); };
    if (!id) { fail("missing id"); return; }
    const task = tasks.get(id);
    if (!task) { fail("id is not in any tasks file for this source"); return; }
    if (answeredIds.has(id)) { fail("answered twice"); return; }
    answeredIds.add(id);
    if (byId.has(id)) { fail("already in the manifest — nothing to add"); return; }

    if (answer["decision"] === "skip") { skipped += 1; return; }
    if (answer["decision"] !== "link") { fail(`decision must be "link" or "skip"`); return; }

    const brefs = answer["brefs"];
    if (!Array.isArray(brefs) || brefs.length === 0) { fail("link needs at least one bref"); return; }
    const checked: string[] = [];
    for (const bref of brefs) {
      if (typeof bref !== "string") { fail("bref is not a string"); return; }
      const parsed = parseBref(bref);
      if (!parsed.ok) { fail(`bref ${bref}: ${parsed.error}`); return; }
      if (parsed.value.tokenNarrowing) { fail(`bref ${bref}: must be verse-level, not token-level`); return; }
      const valid = validateRef(parsed.value, backbone);
      if (!valid.ok) { fail(`bref ${bref}: ${valid.error}`); return; }
      checked.push(bref);
    }

    const kind = typeof answer["kind"] === "string" ? answer["kind"] : task.kind;
    if (!KINDS.has(kind as TrustedResourceKind)) { fail(`unknown kind ${kind}`); return; }

    /* A human or an agent read a page and decided; that is not the publisher's
       own claim, and the manifest has to keep the difference visible. */
    added.push({
      id,
      sourceId: manifest.source.id,
      kind: kind as TrustedResourceKind,
      title: task.title.slice(0, 300),
      officialUrl: task.url,
      brefs: [...new Set(checked)],
      matchBasis: "publisher-title",
      ...(task.publishedAt ? { metadata: { publishedAt: task.publishedAt, language: "en" } } : {}),
    });
  });
}

const merged: TrustedResourceManifestV1 = {
  ...manifest,
  provenance: {
    ...manifest.provenance,
    reviewedAt: new Date().toISOString().slice(0, 10),
    note: `${manifest.provenance.note ?? ""} ${added.length} records added by enrichment review.`.trim(),
  },
  records: [...manifest.records, ...added],
};

const validated = validateTrustedResourceManifest(merged, backbone);

console.log(`answers read:     ${seenAnswers.toLocaleString()}`);
console.log(`  linked:         ${added.length.toLocaleString()}`);
console.log(`  skipped:        ${skipped.toLocaleString()}`);
console.log(`  rejected:       ${rejects.length.toLocaleString()}`);
for (const reject of rejects.slice(0, 25)) {
  console.log(`    ${reject.file}:${reject.line}  ${reject.id}  — ${reject.reason}`);
}
if (rejects.length > 25) console.log(`    …and ${rejects.length - 25} more`);

if (!validated.ok) {
  console.error(`\nFAIL: merged manifest does not validate: ${validated.error}`);
  process.exit(1);
}
if (dryRun) {
  console.log(`\nDry run — nothing written. Manifest would hold ${merged.records.length.toLocaleString()} records.`);
  process.exit(rejects.length > 0 ? 1 : 0);
}
writeFileSync(manifestPath, `${JSON.stringify(validated.value, null, 2)}\n`);
console.log(`\nwritten: ${manifestPath} (${validated.value.records.length.toLocaleString()} records)`);
process.exit(rejects.length > 0 ? 1 : 0);
