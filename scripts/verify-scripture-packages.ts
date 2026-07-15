import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BackboneData } from "../src/core/reference/types.js";

type ChapterData = {
  verses: Array<{ verse: number; text: string }>;
};

type SyntaxNodeData = {
  tokenId?: string;
  surface?: string;
  children?: SyntaxNodeData[];
};

type SyntaxSentenceData = {
  id: string;
  refLabel: string;
  tokenIds: string[];
  root: SyntaxNodeData;
};

type SyntaxBookData = {
  sentenceCount: number;
  sentences: SyntaxSentenceData[];
};

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = join(repoRoot, "data", "scripture");
const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf-8")) as BackboneData;
const bookCodes = Object.keys(backbone.books);
const packageIds = ["web", "kjv", "ylt", "akjv-strongs", "bsb"];


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

// BSB (and some modern critical texts) omit a handful of KJV-tradition verses
// (e.g. Mat 17:21, Acts 8:37). Allow shorter chapters for those packages only;
// never allow empty chapters or *more* verses than backbone.
const allowShort = new Set(["bsb"]);

for (const pkgId of packageIds) {
  console.error(`[verify:data] checking ${pkgId.toUpperCase()}`);
  let shortChapters = 0;

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

      if (actual === 0) {
        fail(`${pkgId.toUpperCase()} ${book} ${chapter}: empty chapter`);
      }
      if (actual > expected) {
        fail(`${pkgId.toUpperCase()} ${book} ${chapter}: ${actual} verses > backbone ${expected}`);
      }
      if (actual !== expected) {
        if (allowShort.has(pkgId) && actual < expected) {
          shortChapters++;
        } else {
          fail(`${pkgId.toUpperCase()} ${book} ${chapter}: expected ${expected} verses, got ${actual}`);
        }
      }
    }

    console.error(`[verify:data] ${pkgId.toUpperCase()} ${book} ok (${chapters.length} chapters)`);
  }
  if (shortChapters > 0) {
    console.error(
      `[verify:data] ${pkgId.toUpperCase()}: ${shortChapters} chapter(s) shorter than KJV backbone (allowed for this package)`,
    );
  }
}

function collectSyntaxLeaves(node: SyntaxNodeData, out: SyntaxNodeData[]): void {
  if (node.tokenId) out.push(node);
  for (const child of node.children ?? []) collectSyntaxLeaves(child, out);
}

for (const syntaxId of ["macula-greek-nestle1904", "macula-hebrew-wlc"]) {
  const dir = join(dataDir, "syntax", syntaxId);
  let sentencesChecked = 0;
  let leavesChecked = 0;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "manifest.json")) {
    const book = JSON.parse(readFileSync(join(dir, file), "utf8")) as SyntaxBookData;
    if (book.sentences.length !== book.sentenceCount) {
      fail(`${syntaxId}/${file}: sentenceCount does not match sentences`);
    }
    for (const sentence of book.sentences) {
      const leaves: SyntaxNodeData[] = [];
      collectSyntaxLeaves(sentence.root, leaves);
      const ids = leaves.flatMap((leaf) => (leaf.tokenId ? [leaf.tokenId] : []));
      if (JSON.stringify(ids) !== JSON.stringify(sentence.tokenIds)) {
        fail(`${syntaxId}/${file} ${sentence.refLabel}: tokenIds do not match tree leaves`);
      }
      for (const leaf of leaves) {
        if (/[<>]/.test(leaf.surface ?? "")) {
          fail(`${syntaxId}/${file} ${sentence.refLabel}: XML markup leaked into ${leaf.tokenId}`);
        }
      }
      sentencesChecked += 1;
      leavesChecked += leaves.length;
    }
  }
  console.error(
    `[verify:data] ${syntaxId}: ${sentencesChecked} sentences, ${leavesChecked} leaves clean`,
  );
}

console.log(`Scripture data verified: ${checkedFiles} chapter files, ${checkedVerses} verses.`);
