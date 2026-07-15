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

/**
 * Minimal USFM verse extractor: tracks \c N and \v N text until next marker.
 * Strips footnotes \f … \f*, cross-refs, and character markers for plain reading text.
 */
function parseUsfm(content: string): Map<number, Array<{ verse: number; text: string }>> {
  const chapters = new Map<number, Array<{ verse: number; text: string }>>();
  let chapter = 0;
  // Normalize: put markers on predictable boundaries
  const flat = content.replace(/\r\n/g, "\n");

  // Split keeping markers roughly by scanning with regex
  const re = /\\c\s+(\d+)|\\v\s+(\d+)\s+/g;
  const parts: Array<{ kind: "c" | "v"; n: number; start: number; markEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    if (m[1]) parts.push({ kind: "c", n: parseInt(m[1], 10), start: m.index, markEnd: re.lastIndex });
    else if (m[2]) parts.push({ kind: "v", n: parseInt(m[2], 10), start: m.index, markEnd: re.lastIndex });
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.kind === "c") {
      chapter = p.n;
      if (!chapters.has(chapter)) chapters.set(chapter, []);
      continue;
    }
    if (chapter === 0) continue;
    const end = i + 1 < parts.length ? parts[i + 1]!.start : flat.length;
    let text = flat.slice(p.markEnd, end);
    text = stripUsfmMarkup(text);
    if (!text) continue;
    const list = chapters.get(chapter) ?? [];
    // Merge multi-chunk same verse if USFM repeats (rare)
    const existing = list.find((v) => v.verse === p.n);
    if (existing) existing.text = `${existing.text} ${text}`.trim();
    else list.push({ verse: p.n, text });
    chapters.set(chapter, list);
  }

  for (const list of chapters.values()) list.sort((a, b) => a.verse - b.verse);
  return chapters;
}

function stripUsfmMarkup(raw: string): string {
  let s = raw;
  // Footnotes and cross-refs
  s = s.replace(/\\f\s+[\s\S]*?\\f\*/g, "");
  s = s.replace(/\\x\s+[\s\S]*?\\x\*/g, "");
  s = s.replace(/\\ref\s+[\s\S]*?\\ref\*/g, "");
  // Character styles: \add …\add*, \wj …\wj*, \nd …\nd*, \qt …, \bk …, \tl …, \fqa …
  s = s.replace(/\\[a-zA-Z]+\d*\s*\*/g, ""); // closing markers
  s = s.replace(/\\[a-zA-Z]+\d*\s+/g, ""); // opening markers with space
  s = s.replace(/\\[a-zA-Z]+\d*/g, "");
  // Remaining backslash junk
  s = s.replace(/\\[^\s]*/g, "");
  // HTML leftovers
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\s+/g, " ").trim();
  // Smart quotes normalize lightly
  return s;
}

let totalVerses = 0;
let filesWritten = 0;
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
  const chapters = parseUsfm(content);
  const expected = backbone.books[book]!.chapters;
  const bookDir = join(outText, book);
  mkdirSync(bookDir, { recursive: true });

  for (let ch = 1; ch <= expected.length; ch++) {
    const verses = chapters.get(ch) ?? [];
    const exp = expected[ch - 1]!;
    if (verses.length !== exp) {
      mismatches.push(`${book} ${ch}: ${verses.length}/${exp}`);
    }
    if (verses.length === 0) continue;
    writeFileSync(join(bookDir, `${ch}.json`), JSON.stringify({ verses }, null, 1) + "\n");
    filesWritten++;
    totalVerses += verses.length;
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
    importedAt: new Date().toISOString(),
  },
};
writeFileSync(join(outPkg, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(outPkg, "doctor-report.json"), JSON.stringify({ mismatches: mismatches.slice(0, 50), total: mismatches.length }, null, 2) + "\n");

console.log("\n=== Doctor ===");
console.log(`  chapter files: ${filesWritten}`);
console.log(`  verses:        ${totalVerses}`);
console.log(`  backbone Δ:    ${mismatches.length}`);
if (mismatches.length) {
  for (const m of mismatches.slice(0, 15)) console.log(`    ${m}`);
  if (mismatches.length > 15) console.log(`    … +${mismatches.length - 15} more`);
}
console.log(`\nWrote package ${packageId} → ${outText}`);
console.log("Done.");
