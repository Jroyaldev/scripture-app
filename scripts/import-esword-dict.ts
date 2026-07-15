/**
 * Import an e-Sword dictionary/lexicon (.dctx / .lexi) into Strong's-keyed JSON
 * for the language-margin definition pane.
 *
 * Usage:
 *   npm run import:esword-dict -- --input ~/Downloads/StrongsPlus.dctx --out data/scripture/lexicons/strongs-plus.json --source "Strong's" --kind strongs
 *   npm run import:esword-dict -- --input ~/Downloads/"Thayers Unabridged.dctx" --out data/scripture/lexicons/thayer.json --source Thayer --kind thayer --hex cp1253 --letter G
 *   npm run import:esword-dict -- --input ~/Downloads/bdb-kjv.dctx --out data/scripture/lexicons/bdb-kjv.json --source BDB --kind bdb --letter H
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectModuleKind,
  openEswordDb,
  readDetails,
  readDictionaryEntries,
  normalizeStrongTopic,
} from "../src/core/importer/esword.js";
import {
  duplicateSenseNumbers,
  formatLexiconEntry,
  parseBdbSenses,
  type StrongDefinition,
} from "../src/core/importer/strongs-plus.js";
import type { RtfHexEncoding } from "../src/core/importer/rtf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const inputPath = arg("input");
if (!inputPath) {
  console.error(
    `Usage: npm run import:esword-dict -- --input PATH [--out PATH] [--source NAME] [--kind strongs|thayer|bdb] [--hex cp1252|cp1253] [--letter H|G] [--dry-run]`,
  );
  process.exit(1);
}

const absInput = resolve(inputPath);
if (!existsSync(absInput)) {
  console.error(`File not found: ${absInput}`);
  process.exit(1);
}

const kind = (arg("kind") as "strongs" | "thayer" | "bdb" | undefined) ?? "strongs";
const sourceLabel =
  arg("source") ?? (kind === "thayer" ? "Thayer" : kind === "bdb" ? "BDB" : "Strong's");
const outPath = resolve(
  arg("out") ??
    join(
      repoRoot,
      "data/scripture/lexicons",
      kind === "thayer" ? "thayer.json" : kind === "bdb" ? "bdb-kjv.json" : "strongs-plus.json",
    ),
);
const hexEncoding = (arg("hex") as RtfHexEncoding | undefined) ?? (kind === "thayer" ? "cp1253" : "cp1252");
const letterFilter = (arg("letter") ?? (kind === "thayer" ? "G" : kind === "bdb" ? "H" : "")).toUpperCase();
const dryRun = hasFlag("dry-run");

console.log(`Opening ${absInput}`);
const db = openEswordDb(absInput);
const modKind = detectModuleKind(db);
if (modKind !== "dictionary" && modKind !== "lexicon") {
  console.error(`Expected dictionary/lexicon, got kind=${modKind}`);
  process.exit(1);
}
const details = readDetails(db);
console.log("Details:", {
  Title: details.Title ?? details.Description,
  Abbreviation: details.Abbreviation,
  Strong: details.Strong ?? details.Strongs,
  kind,
  hexEncoding,
  letterFilter: letterFilter || "(all)",
});

const raw = readDictionaryEntries(db, { hexEncoding });
db.close();

const byId = new Map<string, StrongDefinition>();
const malformedBdb: Array<{ id: string; duplicates: string[] }> = [];
const malformedThayer: Array<{ id: string; n: string; issue: string }> = [];
let skipped = 0;
let empty = 0;
let letterSkipped = 0;
for (const e of raw) {
  const topic = normalizeStrongTopic(e.topic) ?? e.topic.trim().toUpperCase();
  if (!/^[HG]\d{1,5}$/.test(topic)) {
    skipped++;
    continue;
  }
  if (letterFilter && !topic.startsWith(letterFilter)) {
    letterSkipped++;
    continue;
  }
  if (!e.definitionPlain.trim()) {
    empty++;
    continue;
  }
  if (kind === "bdb") {
    const duplicates = duplicateSenseNumbers(parseBdbSenses(e.definitionPlain));
    if (duplicates.length > 0) malformedBdb.push({ id: topic, duplicates });
  }
  const formatted = formatLexiconEntry(topic, e.definitionPlain, sourceLabel, kind);
  if (!formatted) {
    skipped++;
    continue;
  }
  const outputDuplicates = duplicateSenseNumbers(formatted.senses ?? []);
  if (outputDuplicates.length > 0) {
    throw new Error(
      `Import Doctor: ${formatted.id} emitted duplicate sense numbers: ${outputDuplicates.join(", ")}`,
    );
  }
  if (kind === "thayer") {
    for (const sense of formatted.senses ?? []) {
      const label = sense.label?.trim() ?? "";
      if (!label) malformedThayer.push({ id: topic, n: sense.n, issue: "missing label" });
      if (/…$/.test(sense.text) || /…$/.test(label)) {
        malformedThayer.push({ id: topic, n: sense.n, issue: "generated ellipsis" });
      }
      if (/(?:[1-3])?[A-Z][a-z]{1,8}_\d+$/.test(label)) {
        malformedThayer.push({ id: topic, n: sense.n, issue: "label split inside reference" });
      }
      if (/^(?:properly|figuratively|metaphorically|tropically|absolutely|transitively|intransitively|universally|passively|actively|middle|plural|τί)[,;:.]?$/iu.test(label)) {
        malformedThayer.push({ id: topic, n: sense.n, issue: "structural label" });
      }
      if (/\bLatin(?=[a-z])/.test(sense.text)) {
        malformedThayer.push({ id: topic, n: sense.n, issue: "glued Latin label" });
      }
    }
  }
  byId.set(formatted.id, formatted);
}

if (malformedThayer.length > 0) {
  const sample = malformedThayer
    .slice(0, 12)
    .map((issue) => `${issue.id}.${issue.n}: ${issue.issue}`)
    .join(", ");
  throw new Error(`Import Doctor: ${malformedThayer.length} malformed Thayer displays (${sample})`);
}

const ids = [...byId.keys()].sort((a, b) => {
  const pa = a[0]!;
  const pb = b[0]!;
  if (pa !== pb) return pa.localeCompare(pb);
  return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10);
});

const withSenses = ids.filter((id) => (byId.get(id)?.senses?.length ?? 0) > 0).length;
const emptyRate = raw.length === 0 ? 0 : empty / raw.length;

console.log("\n=== Doctor ===");
console.log(`  raw rows:       ${raw.length}`);
console.log(`  strong keys:    ${ids.length} (H=${ids.filter((i) => i.startsWith("H")).length}, G=${ids.filter((i) => i.startsWith("G")).length})`);
console.log(`  empty:          ${empty} (${(emptyRate * 100).toFixed(2)}%)`);
console.log(`  skipped:        ${skipped} (non-Strong topic / format fail)`);
if (letterFilter) console.log(`  letter filter:  dropped ${letterSkipped} non-${letterFilter}`);
if (kind === "bdb" || kind === "thayer") {
  console.log(`  with senses[]:  ${withSenses}`);
  console.log("  sense n unique: yes");
}
if (kind === "thayer") {
  console.log("  sense display:   complete clauses; labels clean");
}
if (kind === "bdb") {
  console.log(`  malformed sense trees: ${malformedBdb.length}`);
  for (const malformed of malformedBdb) {
    console.log(`    ${malformed.id}: duplicate ${malformed.duplicates.join(", ")} (no senses pill)`);
  }
}

const samples =
  kind === "thayer"
    ? ["G26", "G2316", "G25", "G1"]
    : kind === "bdb"
      ? ["H1", "H7225", "H430", "H1254"]
      : ["H1", "H7225", "G25", "G2316"];

for (const sample of samples) {
  const d = byId.get(sample);
  if (!d) {
    console.log(`  ${sample}: (missing)`);
    continue;
  }
  console.log(`  ${sample}: ${d.firstSense.slice(0, 70)}`);
  if (kind === "thayer" && /[ἀ-῾Α-Ωα-ω]/.test(d.full.slice(0, 80))) {
    console.log(`         greek head: ${d.full.slice(0, 40).replace(/\n/g, " ")}`);
  }
  if (d.senses?.length) {
    console.log(`         senses: ${d.senses.length} (e.g. ${d.senses[0]!.n}) ${d.senses[0]!.text.slice(0, 40)}`);
  }
}

if (dryRun) {
  console.log("\nDry run — nothing written.");
  process.exit(0);
}

const payload = {
  meta: {
    source: sourceLabel,
    kind,
    module: String(details.Title ?? details.Description ?? absInput),
    abbreviation: details.Abbreviation ?? null,
    importedAt: new Date().toISOString(),
    input: absInput,
    count: ids.length,
    emptyRows: empty,
    emptyRate,
    hexEncoding,
    withSenses: kind === "bdb" ? withSenses : undefined,
    malformedSenseEntries: kind === "bdb" ? malformedBdb : undefined,
  },
  entries: Object.fromEntries(ids.map((id) => [id, byId.get(id)!])),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload) + "\n");
console.log(`\nWrote ${ids.length} entries → ${outPath}`);
console.log(`Size: ${(Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(2)} MB`);
