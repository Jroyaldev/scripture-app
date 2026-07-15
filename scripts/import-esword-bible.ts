/**
 * Import an e-Sword Bible module (.bblx / .bbli / .BBLX) into a Margin
 * scripture package:
 *   data/scripture/text/{id}/{BOOK}/{CHAPTER}.json
 *   data/scripture/packages/{id}/manifest.json
 *
 * Usage:
 *   npm run import:esword-bible -- --input ~/Downloads/"YLT (1898).bbli" --id ylt --name "Young's Literal Translation (1898)"
 *   npm run import:esword-bible -- --input ~/Downloads/AKJV+2.bblx --id akjv-strongs --name "AKJV + Strong's" --alignments
 *
 * Doctor prints row count vs KJV 31,102 and backbone chapter mismatches.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BackboneData } from "../src/core/reference/types.js";
import {
  doctorBible,
  groupIntoChapters,
  openEswordDb,
  readBibleVerses,
  readDetails,
  detectModuleKind,
  type BibleVerseRow,
} from "../src/core/importer/esword.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const dataDir = join(repoRoot, "data", "scripture");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error(`Usage: npm run import:esword-bible -- --input PATH --id PACKAGE_ID [options]

Options:
  --input PATH       e-Sword .bblx / .bbli file (case-insensitive extension)
  --id ID            package id (e.g. ylt, akjv, akjv-strongs)
  --name NAME        display name for manifest
  --alignments       capture RTF \\super Strong's tags into alignments.jsonl
  --mode auto|plain|rtf   Scripture cell parse mode (default auto)
  --dry-run          Doctor only, write nothing
`);
  process.exit(1);
}

const inputPath = arg("input");
const packageId = arg("id");
if (!inputPath || !packageId) usage();

const absInput = resolve(inputPath!);
if (!existsSync(absInput)) {
  console.error(`File not found: ${absInput}`);
  process.exit(1);
}

const ext = absInput.split(".").pop()?.toLowerCase() ?? "";
// Case-insensitive: .bblx / .bbli / .BBLX all accepted.
if (ext !== "bblx" && ext !== "bbli") {
  console.warn(`Warning: unexpected extension ".${ext}" — expected .bblx / .bbli`);
}

const displayName =
  arg("name") ??
  packageId!
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
const captureAlignments = hasFlag("alignments");
const mode = (arg("mode") as "auto" | "plain" | "rtf" | undefined) ?? "auto";
const dryRun = hasFlag("dry-run");

const backbonePath = join(dataDir, "backbone.json");
const backbone = JSON.parse(readFileSync(backbonePath, "utf-8")) as BackboneData;

console.log(`Opening ${absInput}`);
const db = openEswordDb(absInput);
const kind = detectModuleKind(db);
if (kind !== "bible") {
  console.error(`Expected a Bible module, got kind=${kind}`);
  process.exit(1);
}
const details = readDetails(db);
console.log(`Details:`, {
  Title: details.Title ?? details.Description,
  Abbreviation: details.Abbreviation,
  Version: details.Version,
  Strongs: details.Strongs ?? details.Strong,
});

const verses = readBibleVerses(db, { mode, captureAlignments });
db.close();

const report = doctorBible(verses, backbone);
console.log("\n=== Doctor ===");
console.log(`  rows:        ${report.totalRows} (KJV expected ${report.expectedKjvTotal}, delta ${report.vsKjvDelta})`);
console.log(`  empty:       ${report.emptyRows} (${(report.emptyRate * 100).toFixed(2)}%)`);
console.log(`  books:       ${report.booksPresent}/66`);
console.log(`  backbone Δ:  ${report.backboneMismatches.length} chapters differ`);
if (report.backboneMismatches.length > 0) {
  for (const m of report.backboneMismatches.slice(0, 12)) {
    console.log(
      `    ${m.book} ${m.chapter}: module=${m.moduleVerses} backbone=${m.backboneVerses}`,
    );
  }
  if (report.backboneMismatches.length > 12) {
    console.log(`    … +${report.backboneMismatches.length - 12} more`);
  }
}
console.log("  samples:");
for (const s of report.sample) {
  console.log(`    ${s.ref}: ${s.text}`);
}

if (report.totalRows === 0) {
  console.error("No verses read — aborting.");
  process.exit(1);
}
if (report.emptyRate > 0.01) {
  console.warn("Warning: empty-entry rate > 1%.");
}

if (dryRun) {
  console.log("\nDry run — nothing written.");
  process.exit(0);
}

// --- Write chapter JSON ---
const chapters = groupIntoChapters(verses);
let filesWritten = 0;
for (const [book, chMap] of chapters) {
  const bookDir = join(dataDir, "text", packageId!, book);
  mkdirSync(bookDir, { recursive: true });
  for (const [chapter, verseList] of chMap) {
    const path = join(bookDir, `${chapter}.json`);
    writeFileSync(path, JSON.stringify({ verses: verseList }, null, 1) + "\n");
    filesWritten++;
  }
}

// Optional alignment side-car for reverse-ring fuel (AKJV+2).
let alignmentRows = 0;
if (captureAlignments) {
  const alignPath = join(dataDir, "packages", packageId!, "alignments.jsonl");
  mkdirSync(dirname(alignPath), { recursive: true });
  const lines: string[] = [];
  for (const v of verses) {
    if (!v.alignments || v.alignments.length === 0) continue;
    lines.push(
      JSON.stringify({
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        tokens: v.alignments,
      }),
    );
    alignmentRows++;
  }
  writeFileSync(alignPath, lines.join("\n") + (lines.length ? "\n" : ""));
  console.log(`  alignments:  ${alignmentRows} verses → ${alignPath}`);
}

const licenseName =
  arg("license-name") ??
  (details.Abbreviation ? String(details.Abbreviation) : displayName);
const attribution =
  arg("attribution") ??
  `${displayName}. Public domain. Imported from e-Sword module.`;

const manifest = {
  id: packageId,
  name: displayName,
  language: "en",
  type: "translation",
  versification: "kjv",
  canonProfile: "protestant",
  formatVersion: 1,
  license: {
    spdx: null,
    name: "Public Domain",
    attributionText: attribution,
    permissions: {
      bundle: true,
      index: true,
      display: true,
      quoteInNotes: true,
      export: true,
      syncToOwnDevices: true,
    },
  },
  source: absInput,
  sourceNote: `Imported from e-Sword Bible module (${kind}). Title: ${details.Title ?? details.Description ?? "?"}. Rows: ${report.totalRows}.`,
  doctor: {
    totalRows: report.totalRows,
    emptyRows: report.emptyRows,
    vsKjvDelta: report.vsKjvDelta,
    backboneMismatchCount: report.backboneMismatches.length,
    importedAt: new Date().toISOString(),
  },
};

const manifestDir = join(dataDir, "packages", packageId!);
mkdirSync(manifestDir, { recursive: true });
writeFileSync(join(manifestDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Doctor report sidecar for humans.
writeFileSync(
  join(manifestDir, "doctor-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);

console.log(`\nWrote ${filesWritten} chapter files → data/scripture/text/${packageId}/`);
console.log(`Manifest → data/scripture/packages/${packageId}/manifest.json`);
console.log(`Done: ${packageId} (${displayName})`);

// Ensure TypeScript sees alignments on the row type when flag set
void (null as unknown as BibleVerseRow);
