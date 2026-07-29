/**
 * Does selecting a verse actually change what the margin offers?
 *
 *   node --import tsx scripts/probe-verse-ranking.ts [BOOK] [CHAPTER]
 *
 * Three quarters of references carry a verse range, and the first version of
 * the index threw all of them away — every moment was pinned to verse 1 and the
 * range survived only as display text. So a reader on Romans 8:28 saw exactly
 * the list a reader on 8:1 saw, which is most of what a passage index exists to
 * tell apart.
 *
 * Verses now promote rather than filter. A moment with no range covers the
 * chapter and bears on every verse in it; hiding those would empty the list on
 * any verse nobody addressed specifically, and a list that empties when you
 * click a line reads as a fault rather than an answer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { momentsFor, readPassageIndex } from "../src/core/passage-index.js";

const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const book = process.argv[2] ?? "ROM";
const chapter = Number(process.argv[3] ?? "8");

const parsed = JSON.parse(readFileSync(join(LIBRARY, ".artifacts/passage-index.json"), "utf-8"));
const result = readPassageIndex(parsed);
if (!result.ok) {
  console.error(`index refused: ${result.reason}`);
  process.exit(1);
}

const extent = (s: number): string => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)}s`);

function show(verse: number | null): void {
  const moments = momentsFor(result.ok ? result.index : ({} as never), book, chapter, [], verse);
  console.log(`\n  ${book} ${chapter}${verse ? `:${verse}` : " (whole chapter)"} — ${moments.length} moments`);
  for (const m of moments.slice(0, 5)) {
    console.log(
      `    ${extent(m.seconds).padStart(7)}  ${String(m.verses ?? "whole ch").padEnd(12)}`
      + `${m.episode.slice(0, 40)}`,
    );
  }
}

show(null);
show(1);
show(28);
console.log(`\n  A verse promotes the moments that address it and keeps the rest below,`);
console.log(`  so selecting a line sharpens the list without ever emptying it.`);
