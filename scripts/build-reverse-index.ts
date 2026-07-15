/**
 * Precompute reverse-index.json from a package's alignments.jsonl.
 *
 *   npm run build:reverse-index -- --package bsb
 *   npm run build:reverse-index -- --package akjv-strongs
 *   npm run build:reverse-index -- --all
 *
 * Output: data/scripture/packages/{id}/reverse-index.json
 * Doctor: top-20 words + token count consistency.
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accumulateReverseIndex,
  finalizeReverseIndex,
  topWords,
  type AlignmentVerseIn,
  type ReverseIndexFile,
} from "../src/core/language/reverse-index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packagesDir = join(repoRoot, "data/scripture/packages");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function loadAlignments(path: string): Promise<AlignmentVerseIn[]> {
  const verses: AlignmentVerseIn[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      verses.push(JSON.parse(line) as AlignmentVerseIn);
    } catch {
      /* skip bad line */
    }
  }
  return verses;
}

/** Count raw tokens in alignments (pre-filter) for Doctor cross-check. */
function countRawTokens(verses: AlignmentVerseIn[]): number {
  let n = 0;
  for (const v of verses) n += (v.tokens ?? []).length;
  return n;
}

async function buildOne(packageId: string): Promise<void> {
  const alignPath = join(packagesDir, packageId, "alignments.jsonl");
  if (!existsSync(alignPath)) {
    console.error(`No alignments for ${packageId}: ${alignPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n=== ${packageId} ===`);
  console.log(`Reading ${alignPath}`);
  const verses = await loadAlignments(alignPath);
  const rawTokens = countRawTokens(verses);
  const { words, tokenCount } = accumulateReverseIndex(verses);
  const file = finalizeReverseIndex(packageId, alignPath, words, tokenCount);

  // Doctor
  console.log("=== Doctor ===");
  console.log(`  alignment verses: ${verses.length}`);
  console.log(`  raw tokens:       ${rawTokens}`);
  console.log(`  indexed tokens:   ${file.meta.tokenCount} (after stop/punct filter)`);
  console.log(`  english words:    ${file.meta.wordCount}`);
  console.log(`  strong ids:       ${file.meta.strongCount}`);

  const top = topWords(file, 20);
  console.log("  top-20:");
  for (const t of top) {
    const head = t.strongs
      .slice(0, 4)
      .map((s) => `${s.strongs}:${s.count}`)
      .join(" ");
    console.log(`    ${t.word.padEnd(14)} ${String(t.total).padStart(6)}  ${head}`);
  }

  // Sanity: "love" should split across multiple Strong's when present.
  const love = file.words["love"];
  if (love) {
    const ids = love.map((s) => s.strongs).join(",");
    console.log(`  love → ${love.length} lemmas: ${ids}`);
    const want = ["H157", "H160", "G25", "G26"];
    const hits = want.filter((w) => love.some((s) => s.strongs === w));
    console.log(`  love sanity hits among H157/H160/G25/G26: ${hits.join(",") || "(none)"}`);
  } else {
    console.log(`  love: (not in index — check package language coverage)`);
  }

  if (file.meta.tokenCount === 0) {
    console.error("  FAIL: zero indexed tokens");
    process.exitCode = 1;
    return;
  }
  // Indexed tokens should be ≤ raw (filter removes stopwords).
  if (file.meta.tokenCount > rawTokens) {
    console.error("  FAIL: indexed tokens exceed raw alignments");
    process.exitCode = 1;
    return;
  }

  const outPath = join(packagesDir, packageId, "reverse-index.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(file) + "\n");
  const mb = Buffer.byteLength(JSON.stringify(file)) / 1024 / 1024;
  console.log(`  wrote ${outPath} (${mb.toFixed(2)} MB)`);
}

const all = hasFlag("all");
const pkg = arg("package");
const packages = all ? ["bsb", "akjv-strongs"] : pkg ? [pkg] : ["bsb", "akjv-strongs"];

for (const p of packages) {
  await buildOne(p);
}
console.log("\nDone.");
