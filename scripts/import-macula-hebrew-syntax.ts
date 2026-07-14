/**
 * Import MACULA Hebrew WLC chapter Node XML → per-book syntax JSON.
 *
 *   npm run import:macula-hebrew-syntax -- --input /tmp/macula-hebrew-trees/WLC/nodes
 *   npm run import:macula-hebrew-syntax -- --input …/nodes --books GEN,PSA
 *
 * Output: data/scripture/syntax/macula-hebrew-wlc/{BOOK}.json
 *
 * Leaves use MACULA ids (o…). OSHB packages resolve focus by Strong’s number.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMaculaNodesXml,
  buildSyntaxBookIndex,
  type SyntaxSentence,
} from "../src/core/language/syntax-tree.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_OUT = resolve(ROOT, "data/scripture/syntax/macula-hebrew-wlc");

/** Filename book fragment → app book code */
const HEB_BOOK: Record<string, string> = {
  Gen: "GEN",
  Exo: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deu: "DEU",
  Jos: "JOS",
  Jdg: "JDG",
  Rut: "RUT",
  "1Sa": "1SA",
  "2Sa": "2SA",
  "1Ki": "1KI",
  "2Ki": "2KI",
  "1Ch": "1CH",
  "2Ch": "2CH",
  Ezr: "EZR",
  Neh: "NEH",
  Est: "EST",
  Job: "JOB",
  Psa: "PSA",
  Pro: "PRO",
  Ecc: "ECC",
  Sng: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezk: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Jol: "JOL",
  Amo: "AMO",
  Oba: "OBA",
  Jon: "JON",
  Mic: "MIC",
  Nam: "NAH",
  Hab: "HAB",
  Zep: "ZEP",
  Hag: "HAG",
  Zec: "ZEC",
  Mal: "MAL",
};

function parseArgs(argv: string[]): { input: string; out: string; books?: string[] } {
  let input = "";
  let out = DEFAULT_OUT;
  let books: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) input = argv[++i]!;
    else if (a === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (a === "--books" && argv[i + 1])
      books = argv[++i]!.split(",").map((s) => s.trim().toUpperCase());
  }
  if (!input) {
    console.error(
      "Usage: npx tsx scripts/import-macula-hebrew-syntax.ts --input <WLC/nodes> [--books GEN,PSA]",
    );
    process.exit(1);
  }
  return { input: resolve(input), out: resolve(out), books };
}

/** 01-Gen-001.xml → { book: GEN, chapter: 1 } */
function parseHebrewFilename(file: string): { book: string; chapter: number } | null {
  const m = basename(file, ".xml").match(/^\d+-([A-Za-z0-9]+)-(\d+)$/);
  if (!m) return null;
  const book = HEB_BOOK[m[1]!] ?? m[1]!.toUpperCase();
  return { book, chapter: Number(m[2]) };
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

  const byBook = new Map<string, SyntaxSentence[]>();

  for (const file of files) {
    const meta = parseHebrewFilename(file);
    if (!meta) {
      console.warn("Skip", file);
      continue;
    }
    if (books && !books.includes(meta.book)) continue;

    const path = join(input, file);
    const xml = readFileSync(path, "utf8");
    const sentences = parseMaculaNodesXml(xml, meta.book);
    const list = byBook.get(meta.book) ?? [];
    list.push(...sentences);
    byBook.set(meta.book, list);
    if (sentences.length) {
      process.stdout.write(`  ${file} → ${meta.book} +${sentences.length}\n`);
    }
  }

  let total = 0;
  const written: string[] = [];
  for (const [book, sentences] of [...byBook.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    // stable order by chapter/verse
    sentences.sort(
      (a, b) => a.chapter - b.chapter || a.verseStart - b.verseStart || a.id.localeCompare(b.id),
    );
    const index = buildSyntaxBookIndex(book, sentences, {
      source: "MACULA Hebrew WLC nodes (Clear Bible / Biblica)",
      language: "hbo",
    });
    writeFileSync(join(out, `${book}.json`), JSON.stringify(index));
    const mb = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(2);
    console.log(`Wrote ${book}: ${sentences.length} sentences, ${mb} MB`);
    total += sentences.length;
    written.push(book);
  }

  writeFileSync(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        id: "macula-hebrew-wlc-syntax",
        name: "MACULA Hebrew Syntax (WLC)",
        family: "macula-hebrew",
        language: "hbo",
        edition: "WLC",
        license: {
          spdx: "CC-BY-4.0",
          attributionText:
            "MACULA Hebrew © Biblica / Clear Bible, https://github.com/Clear-Bible/macula-hebrew/, CC BY 4.0.",
        },
        books: written,
        sentenceCount: total,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`Done. ${written.length} books, ${total} sentences → ${out}`);
}

main();
