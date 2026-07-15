/**
 * Import MACULA Greek Nestle1904 Node XML → compact per-book syntax JSON.
 *
 *   npx tsx scripts/import-macula-syntax.ts --input /path/to/macula-greek/Nestle1904/nodes
 *   npx tsx scripts/import-macula-syntax.ts --input /tmp/macula-greek-trees/Nestle1904/nodes
 *
 * Output: data/scripture/syntax/macula-greek-nestle1904/{BOOK}.json
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSyntaxBookIndex,
} from "../src/core/language/syntax-tree.js";
import { parseMaculaNodesXml } from "../src/host/macula-syntax-xml.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_OUT = resolve(ROOT, "data/scripture/syntax/macula-greek-nestle1904");

const FILE_TO_BOOK: Record<string, string> = {
  "01-matthew": "MAT",
  "02-mark": "MRK",
  "03-luke": "LUK",
  "04-john": "JHN",
  "05-acts": "ACT",
  "06-romans": "ROM",
  "07-1corinthians": "1CO",
  "08-2corinthians": "2CO",
  "09-galatians": "GAL",
  "10-ephesians": "EPH",
  "11-philippians": "PHP",
  "12-colossians": "COL",
  "13-1thessalonians": "1TH",
  "14-2thessalonians": "2TH",
  "15-1timothy": "1TI",
  "16-2timothy": "2TI",
  "17-titus": "TIT",
  "18-philemon": "PHM",
  "19-hebrews": "HEB",
  "20-james": "JAS",
  "21-1peter": "1PE",
  "22-2peter": "2PE",
  "23-1john": "1JN",
  "24-2john": "2JN",
  "25-3john": "3JN",
  "26-jude": "JUD",
  "27-revelation": "REV",
};

function parseArgs(argv: string[]): { input: string; out: string; books?: string[] } {
  let input = "";
  let out = DEFAULT_OUT;
  let books: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) input = argv[++i]!;
    else if (a === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (a === "--books" && argv[i + 1]) books = argv[++i]!.split(",").map((s) => s.trim().toUpperCase());
  }
  if (!input) {
    console.error("Usage: npx tsx scripts/import-macula-syntax.ts --input <nodes-dir> [--out dir] [--books MAT,JHN]");
    process.exit(1);
  }
  return { input: resolve(input), out: resolve(out), books };
}

function main(): void {
  const { input, out, books } = parseArgs(process.argv.slice(2));
  if (!existsSync(input)) {
    console.error("Input not found:", input);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });

  const files = readdirSync(input)
    .filter((f) => f.endsWith(".xml"))
    .sort();

  let totalSentences = 0;
  const written: string[] = [];

  for (const file of files) {
    const key = basename(file, ".xml");
    const book = FILE_TO_BOOK[key];
    if (!book) {
      console.warn("Skip unknown file", file);
      continue;
    }
    if (books && !books.includes(book)) continue;

    const path = join(input, file);
    console.log("Parsing", file, "→", book);
    const xml = readFileSync(path, "utf8");
    const sentences = parseMaculaNodesXml(xml, book);
    const index = buildSyntaxBookIndex(book, sentences, {
      source: "MACULA Greek Nestle1904 nodes (Clear Bible / Biblica)",
      language: "grc",
    });
    const outPath = join(out, `${book}.json`);
    writeFileSync(outPath, JSON.stringify(index));
    const mb = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(2);
    console.log(`  ${sentences.length} sentences, ${Object.keys(index.byTokenId).length} tokens, ${mb} MB`);
    totalSentences += sentences.length;
    written.push(book);
  }

  const manifest = {
    id: "macula-greek-nestle1904-syntax",
    name: "MACULA Greek Syntax (Nestle 1904)",
    family: "macula-greek",
    language: "grc",
    edition: "Nestle1904",
    license: {
      spdx: "CC-BY-4.0",
      name: "Creative Commons Attribution 4.0",
      attributionText:
        "MACULA Greek Linguistic Datasets © Biblica, Inc / Clear Bible, https://github.com/Clear-Bible/macula-greek/, CC BY 4.0.",
    },
    books: written,
    sentenceCount: totalSentences,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Done. ${written.length} books, ${totalSentences} sentences → ${out}`);
}

main();
