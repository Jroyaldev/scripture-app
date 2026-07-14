#!/usr/bin/env node
/**
 * CLI: import MACULA Greek Nestle1904 (or SBLGNT) TSV into JSONL + package manifest.
 *
 * Usage:
 *   node --import tsx scripts/import-macula-greek.ts \
 *     --input path/to/macula-greek-Nestle1904.tsv \
 *     --out data/scripture/packages/macula-greek-nestle1904 \
 *     [--edition nestle1904|sblgnt] \
 *     [--version 24.06.17] \
 *     [--book 1CO]
 *
 * Core parsing is pure (src/core/language); this script owns Node I/O.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  MACULA_GREEK_NESTLE1904_META,
  MACULA_GREEK_SBLGNT_META,
  buildTokenIndex,
  parseMaculaGreekTsv,
  type TokenDatasetMeta,
  type TokenRecord,
} from "../src/core/language/index.js";

type Args = {
  input: string;
  out: string;
  edition: "nestle1904" | "sblgnt";
  version: string;
  book?: string;
};

function usage(): never {
  console.error(`Usage:
  node --import tsx scripts/import-macula-greek.ts \\
    --input <macula-greek.tsv> \\
    --out <output-dir> \\
    [--edition nestle1904|sblgnt] \\
    [--version <tag>] \\
    [--book 1CO]

Writes:
  <out>/manifest.json
  <out>/tokens.jsonl          # one TokenRecord per line
  <out>/lemma-freq.json       # corpus lemma counts
  <out>/stats.json
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  let input = "";
  let out = "";
  let edition: Args["edition"] = "nestle1904";
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
    } else if (a === "--edition" && next) {
      if (next !== "nestle1904" && next !== "sblgnt") usage();
      edition = next;
      i++;
    } else if (a === "--version" && next) {
      version = next;
      i++;
    } else if (a === "--book" && next) {
      book = next.toUpperCase();
      i++;
    } else if (a === "--help" || a === "-h") {
      usage();
    }
  }

  if (!input || !out) usage();
  return { input: resolve(input), out: resolve(out), edition, version, book };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const base =
    args.edition === "sblgnt" ? MACULA_GREEK_SBLGNT_META : MACULA_GREEK_NESTLE1904_META;
  const dataset: TokenDatasetMeta = { ...base, version: args.version };

  console.error(`Reading ${args.input} …`);
  const content = readFileSync(args.input, "utf8");
  const result = parseMaculaGreekTsv(content, { dataset });

  let tokens: TokenRecord[] = result.tokens;
  if (args.book) {
    tokens = tokens.filter((t) => t.book === args.book);
  }

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
    versification: "kjv",
    canonProfile: "protestant-nt",
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
    sourceNote: `Imported from MACULA Greek ${dataset.edition} TSV. Attribute Clear Bible / Biblica CC BY 4.0.`,
    tokenCount: tokens.length,
    books: result.stats.books.filter((b) => !args.book || b === args.book),
  };

  writeFileSync(join(args.out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const jsonlPath = join(args.out, "tokens.jsonl");
  const streamChunks: string[] = [];
  for (const t of tokens) {
    streamChunks.push(JSON.stringify(t));
  }
  writeFileSync(jsonlPath, streamChunks.join("\n") + (streamChunks.length ? "\n" : ""));

  writeFileSync(join(args.out, "lemma-freq.json"), JSON.stringify(lemmaFreq, null, 2) + "\n");
  writeFileSync(
    join(args.out, "stats.json"),
    JSON.stringify(
      {
        ...result.stats,
        filteredBook: args.book ?? null,
        tokenCount: tokens.length,
        warningCount: result.warnings.length,
        warningsSample: result.warnings.slice(0, 20),
      },
      null,
      2,
    ) + "\n",
  );

  console.error(`Parsed ${result.stats.parsed} tokens (${result.stats.skipped} skipped).`);
  if (args.book) console.error(`Wrote ${tokens.length} tokens for book ${args.book}.`);
  console.error(`Output: ${args.out}`);
  console.error(`  manifest.json, tokens.jsonl, lemma-freq.json, stats.json`);
  if (result.warnings.length) {
    console.error(`Warnings: ${result.warnings.length} (see stats.json)`);
  }

  // Touch parent so tools notice
  void dirname(args.out);
}

main();
