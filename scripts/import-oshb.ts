#!/usr/bin/env node
/**
 * CLI: import OSHB WLC OSIS books into tokens.jsonl + package manifest.
 *
 * Usage:
 *   node --import tsx scripts/import-oshb.ts \
 *     --input /path/to/morphhb/wlc \
 *     --out data/scripture/packages/oshb-wlc \
 *     [--version 2.2] \
 *     [--book Gen]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  OSHB_WLC_META,
  buildTokenIndex,
  parseOshbOsisBook,
  type TokenDatasetMeta,
  type TokenRecord,
} from "../src/core/language/index.js";

type Args = {
  input: string;
  out: string;
  version: string;
  book?: string; // OSIS name e.g. Gen
};

function usage(): never {
  console.error(`Usage:
  node --import tsx scripts/import-oshb.ts \\
    --input <morphhb/wlc dir or single .xml> \\
    --out <output-dir> \\
    [--version <tag>] \\
    [--book Gen]
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  let input = "";
  let out = "";
  let version = "unknown";
  let book: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--input" && next) {
      input = next;
      i++;
    } else if (a === "--out" && next) {
      out = next;
      i++;
    } else if (a === "--version" && next) {
      version = next;
      i++;
    } else if (a === "--book" && next) {
      book = next;
      i++;
    } else if (a === "--help" || a === "-h") usage();
  }
  if (!input || !out) usage();
  return { input: resolve(input), out: resolve(out), version, book };
}

function listBookFiles(input: string, bookFilter?: string): string[] {
  if (input.endsWith(".xml") && existsSync(input)) return [input];
  if (!existsSync(input)) {
    console.error(`Input not found: ${input}`);
    process.exit(1);
  }
  let files = readdirSync(input)
    .filter((f) => f.endsWith(".xml") && f !== "VerseMap.xml")
    .map((f) => join(input, f))
    .sort();
  if (bookFilter) {
    const want = bookFilter.toLowerCase();
    files = files.filter((f) => {
      const base = f.split("/").pop()?.replace(/\.xml$/i, "") ?? "";
      return base.toLowerCase() === want;
    });
  }
  return files;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const dataset: TokenDatasetMeta = { ...OSHB_WLC_META, version: args.version };
  const files = listBookFiles(args.input, args.book);
  if (files.length === 0) {
    console.error("No OSIS book XML files found.");
    process.exit(1);
  }

  console.error(`Reading ${files.length} book file(s) from ${args.input} …`);
  const tokens: TokenRecord[] = [];
  const books = new Set<string>();
  let words = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const file of files) {
    const name = file.split("/").pop() ?? file;
    const xml = readFileSync(file, "utf8");
    const result = parseOshbOsisBook(xml, { dataset });
    tokens.push(...result.tokens);
    words += result.stats.words;
    skipped += result.stats.skipped;
    for (const b of result.stats.books) books.add(b);
    for (const w of result.warnings.slice(0, 5)) warnings.push(`${name}: ${w}`);
    console.error(`  ${name}: ${result.stats.parsed} tokens`);
  }

  // Ensure datasetId matches package
  for (const t of tokens) t.datasetId = dataset.id;

  const index = buildTokenIndex(tokens, dataset.id);
  const lemmaFreq = Object.fromEntries(
    [...index.lemmaFreqCorpus.entries()].sort((a, b) => b[1] - a[1]),
  );

  mkdirSync(args.out, { recursive: true });
  const manifest = {
    id: dataset.id,
    name: dataset.name,
    language: dataset.language,
    type: "interlinear-data" as const,
    versification: "wlc",
    canonProfile: "protestant-ot",
    formatVersion: 1,
    family: dataset.family,
    edition: dataset.edition,
    datasetVersion: dataset.version,
    license: {
      spdx: dataset.license.spdx ?? null,
      name: dataset.license.name,
      attributionText: dataset.license.attributionText,
      permissions: {
        bundle: true,
        index: true,
        display: true,
        quoteInNotes: true,
        export: true,
        syncToOwnDevices: true,
      },
    },
    source: dataset.sourceUrl,
    sourceNote:
      "Imported from Open Scriptures Hebrew Bible (OSHB) WLC OSIS. Morph/lemma CC BY 4.0; WLC text public domain.",
    tokenCount: tokens.length,
    books: [...books].sort(),
  };

  writeFileSync(join(args.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(
    join(args.out, "tokens.jsonl"),
    tokens.map((t) => JSON.stringify(t)).join("\n") + (tokens.length ? "\n" : ""),
  );
  writeFileSync(join(args.out, "lemma-freq.json"), JSON.stringify(lemmaFreq, null, 2) + "\n");
  writeFileSync(
    join(args.out, "stats.json"),
    JSON.stringify(
      {
        words,
        parsed: tokens.length,
        skipped,
        books: [...books].sort(),
        files: files.length,
        warningCount: warnings.length,
        warningsSample: warnings.slice(0, 20),
      },
      null,
      2,
    ) + "\n",
  );

  console.error(`Parsed ${tokens.length} tokens (${skipped} skipped) from ${files.length} books.`);
  console.error(`Output: ${args.out}`);
}

main();
