import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BackboneData } from "../src/core/reference/types.js";

type ChapterData = {
  verses: Array<{ verse: number; text: string }>;
};

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = join(repoRoot, "data", "scripture");
const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf-8")) as BackboneData;
const bookCodes = Object.keys(backbone.books);
const packageIds = ["web", "kjv"];

let checkedFiles = 0;
let checkedVerses = 0;

function fail(message: string): never {
  throw new Error(message);
}

function readChapter(pkgId: string, book: string, chapter: number): ChapterData {
  const path = join(dataDir, "text", pkgId, book, `${chapter}.json`);
  if (!existsSync(path)) fail(`${pkgId.toUpperCase()} missing ${book} ${chapter}`);
  return JSON.parse(readFileSync(path, "utf-8")) as ChapterData;
}

for (const pkgId of packageIds) {
  console.error(`[verify:data] checking ${pkgId.toUpperCase()}`);

  for (const book of bookCodes) {
    const chapters = backbone.books[book]!.chapters;
    const dir = join(dataDir, "text", pkgId, book);
    if (!existsSync(dir)) fail(`${pkgId.toUpperCase()} missing book directory ${book}`);

    const chapterFiles = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (chapterFiles.length !== chapters.length) {
      fail(`${pkgId.toUpperCase()} ${book}: expected ${chapters.length} chapter files, got ${chapterFiles.length}`);
    }

    for (let index = 0; index < chapters.length; index++) {
      const chapter = index + 1;
      const data = readChapter(pkgId, book, chapter);
      const expected = chapters[index]!;
      const actual = data.verses.length;
      checkedFiles++;
      checkedVerses += actual;

      if (actual !== expected) {
        fail(`${pkgId.toUpperCase()} ${book} ${chapter}: expected ${expected} verses, got ${actual}`);
      }
    }

    console.error(`[verify:data] ${pkgId.toUpperCase()} ${book} ok (${chapters.length} chapters)`);
  }
}

console.log(`Scripture data verified: ${checkedFiles} chapter files, ${checkedVerses} verses.`);
