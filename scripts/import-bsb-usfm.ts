/**
 * Build a BSB scripture package from bereanbible.com USFM zip.
 *
 *   npm run import:bsb -- --input ~/Downloads/bsb_usfm.zip
 *
 * Writes data/scripture/text/bsb/{BOOK}/{N}.json + packages/bsb/manifest.json
 * License: CC0 (https://berean.bible/licensing.htm)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import type { BackboneData } from "../src/core/reference/types.js";
import { parseUsfmText } from "../src/core/importer/usfm-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const dataDir = join(repoRoot, "data", "scripture");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const inputPath = resolve(arg("input") ?? join(process.env.HOME ?? "", "Downloads/bsb_usfm.zip"));
if (!existsSync(inputPath)) {
  console.error(`BSB USFM zip not found: ${inputPath}`);
  process.exit(1);
}

const packageId = arg("id") ?? "bsb";
const outText = join(dataDir, "text", packageId);
const outPkg = join(dataDir, "packages", packageId);

const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf-8")) as BackboneData;

// Extract to temp dir
const tmpDir = join(repoRoot, ".tmp-bsb-usfm");
mkdirSync(tmpDir, { recursive: true });
console.log(`Extracting ${inputPath} → ${tmpDir}`);
execFileSync("unzip", ["-o", "-q", inputPath, "-d", tmpDir], { stdio: "inherit" });

// Find .usfm files
function findUsfm(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...findUsfm(p));
    else if (name.name.toLowerCase().endsWith(".usfm")) out.push(p);
  }
  return out;
}

const files = findUsfm(tmpDir);
console.log(`Found ${files.length} USFM files`);

let totalVerses = 0;
let filesWritten = 0;
let totalHeadings = 0;
let structuralLinesDropped = 0;
const mismatches: string[] = [];

/** Occasional BSB filename quirks → our USFM codes. */
const BOOK_FILE_ALIASES: Record<string, string> = {
  NAM: "NAH", // Nahum ships as NAM.usfm in some BSB USFM zips
  SOS: "SNG",
  SONG: "SNG",
};

for (const file of files) {
  const base = file.split("/").pop()!.replace(/\.usfm$/i, "").toUpperCase();
  const book = BOOK_FILE_ALIASES[base] ?? base;
  if (!backbone.books[book]) {
    console.warn(`  skip unknown book code ${base}→${book}`);
    continue;
  }
  const content = readFileSync(file, "utf-8");
  const parsed = parseUsfmText(content);
  const chapters = parsed.chapters;
  structuralLinesDropped += parsed.structuralLinesDropped;
  const expected = backbone.books[book]!.chapters;
  const bookDir = join(outText, book);
  mkdirSync(bookDir, { recursive: true });

  for (let ch = 1; ch <= expected.length; ch++) {
    const parsedChapter = chapters.get(ch) ?? { verses: [], headings: [] };
    const { verses, headings } = parsedChapter;
    const exp = expected[ch - 1]!;
    if (verses.length !== exp) {
      mismatches.push(`${book} ${ch}: ${verses.length}/${exp}`);
    }
    if (verses.length === 0) continue;
    const chapterData = headings.length > 0 ? { verses, headings } : { verses };
    writeFileSync(join(bookDir, `${ch}.json`), JSON.stringify(chapterData, null, 1) + "\n");
    filesWritten++;
    totalVerses += verses.length;
    totalHeadings += headings.length;
  }
  process.stdout.write(`  ${book}: ${chapters.size} ch\n`);
}

mkdirSync(outPkg, { recursive: true });
const manifest = {
  id: packageId,
  name: "Berean Standard Bible",
  language: "en",
  type: "translation",
  versification: "kjv",
  canonProfile: "protestant",
  formatVersion: 1,
  license: {
    spdx: "CC0-1.0",
    name: "CC0 1.0 Universal",
    attributionText:
      "Berean Standard Bible (BSB). The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain. Free, unrestricted use. See https://berean.bible/licensing.htm",
    permissions: {
      bundle: true,
      index: true,
      display: true,
      quoteInNotes: true,
      export: true,
      syncToOwnDevices: true,
    },
  },
  source: "https://bereanbible.com/bsb_usfm.zip",
  sourceNote: `Imported from ${inputPath}. License: https://berean.bible/licensing.htm`,
  doctor: {
    totalVerses,
    filesWritten,
    backboneMismatches: mismatches.length,
    structuralHeadings: totalHeadings,
    structuralLinesDropped,
    importedAt: (() => {
      try {
        const previous = JSON.parse(readFileSync(join(outPkg, "manifest.json"), "utf-8")) as { doctor?: { importedAt?: string } };
        return previous.doctor?.importedAt ?? new Date().toISOString();
      } catch {
        return new Date().toISOString();
      }
    })(),
  },
};
writeFileSync(join(outPkg, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(outPkg, "doctor-report.json"), JSON.stringify({
  mismatches: mismatches.slice(0, 50),
  total: mismatches.length,
  structuralHeadings: totalHeadings,
  structuralLinesDropped,
}, null, 2) + "\n");

console.log("\n=== Doctor ===");
console.log(`  chapter files: ${filesWritten}`);
console.log(`  verses:        ${totalVerses}`);
console.log(`  headings:      ${totalHeadings} (preserved separately)`);
console.log(`  structure:     ${structuralLinesDropped} nonverse lines removed from prose`);
console.log(`  backbone Δ:    ${mismatches.length}`);
if (mismatches.length) {
  for (const m of mismatches.slice(0, 15)) console.log(`    ${m}`);
  if (mismatches.length > 15) console.log(`    … +${mismatches.length - 15} more`);
}
console.log(`\nWrote package ${packageId} → ${outText}`);
console.log("Done.");
