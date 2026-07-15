import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { BackboneData } from "../src/core/reference/types.js";
import { loadOpenBibleCrossReferences } from "../src/host/cross-reference-loader.js";
import { parseCrossReferenceKey } from "../src/core/cross-references/index.js";

type ChapterData = {
  verses: Array<{ verse: number; text: string }>;
  headings?: Array<{ beforeVerse: number; kind: string; level: number; text: string }>;
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
let checkedBsbHeadings = 0;

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

      if (pkgId === "bsb") {
        for (const heading of data.headings ?? []) {
          if (
            !Number.isInteger(heading.beforeVerse)
            || heading.beforeVerse < 1
            || heading.beforeVerse > expected
            || !heading.text.trim()
            || !["section", "major-section", "description", "speaker", "acrostic"].includes(heading.kind)
          ) {
            fail(`BSB ${book} ${chapter}: malformed structural heading`);
          }
          for (const verse of data.verses) {
            if (verse.text.endsWith(` ${heading.text}`)) {
              fail(`BSB ${book} ${chapter}:${verse.verse}: structural heading leaked into verse prose: ${heading.text}`);
            }
          }
          checkedBsbHeadings++;
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

if (checkedBsbHeadings < 3_000) {
  fail(`BSB structural heading coverage is incomplete: ${checkedBsbHeadings}`);
}
console.error(`[verify:data] BSB: ${checkedBsbHeadings} noncanonical headings preserved outside verse prose`);

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

// OpenBible reference graph Doctor: verify the committed artifact rather than
// trusting importer prose. The raw ZIP stays external (INV-13), while every
// normalized coordinate, range, score and duplicate invariant is rechecked.
const crossReferenceDir = join(repoRoot, "data", "cross-references");
const crossReferencePath = join(crossReferenceDir, "openbible.jsonl");
const crossReferenceDoctorPath = join(crossReferenceDir, "openbible-doctor-report.json");
if (!existsSync(crossReferencePath) || !existsSync(crossReferenceDoctorPath)) {
  fail("OpenBible cross-reference artifact or Doctor report is missing");
}
const crossReferenceText = readFileSync(crossReferencePath, "utf-8").trimEnd();
const crossReferenceLines = crossReferenceText.split("\n");
const crossReferenceData = loadOpenBibleCrossReferences(crossReferencePath);
const crossReferenceDoctor = JSON.parse(readFileSync(crossReferenceDoctorPath, "utf-8")) as {
  status: string;
  checks: Record<string, boolean>;
  scores: { normalizedSha256: string };
};
if (crossReferenceDoctor.status !== "healthy" || Object.values(crossReferenceDoctor.checks).some((value) => !value)) {
  fail("OpenBible Doctor report is not healthy");
}
if (
  crossReferenceData.meta.license !== "CC-BY"
  || !/^\d{4}-\d{2}-\d{2}$/.test(crossReferenceData.meta.snapshotDate)
  || crossReferenceData.meta.rowCount < 300_000
  || crossReferenceData.meta.sourceVerseCount < 29_000
  || crossReferenceData.meta.sourceBookCount !== 66
) {
  fail("OpenBible coverage/license/snapshot metadata is below the required floor");
}
const normalizedSha256 = createHash("sha256")
  .update(crossReferenceLines.slice(1).join("\n"))
  .digest("hex");
if (
  normalizedSha256 !== crossReferenceData.meta.normalizedSha256
  || normalizedSha256 !== crossReferenceDoctor.scores.normalizedSha256
) {
  fail("OpenBible normalized dataset checksum does not match metadata/Doctor");
}

const crossReferenceBookOrder = new Map(bookCodes.map((book, index) => [book, index]));
const coordinateOrdinal = (book: string, chapter: number, verse: number): number =>
  (crossReferenceBookOrder.get(book) ?? 999) * 1_000_000 + chapter * 1_000 + verse;
const validCoordinate = (book: string, chapter: number, verse: number): boolean => {
  const chapters = backbone.books[book]?.chapters;
  return !!chapters
    && chapter >= 1
    && chapter <= chapters.length
    && verse >= 1
    && verse <= (chapters[chapter - 1] ?? 0);
};

for (const [sourceKey, edges] of Object.entries(crossReferenceData.refs)) {
  const source = parseCrossReferenceKey(sourceKey);
  if (
    !source
    || source.start.book !== source.end.book
    || source.start.chapter !== source.end.chapter
    || source.start.verse !== source.end.verse
    || !validCoordinate(source.start.book, source.start.chapter, source.start.verse)
  ) {
    fail(`OpenBible invalid source coordinate: ${sourceKey}`);
  }
  const seenTargets = new Set<string>();
  for (const [targetKey, score] of edges) {
    if (seenTargets.has(targetKey)) fail(`OpenBible duplicate edge: ${sourceKey} -> ${targetKey}`);
    seenTargets.add(targetKey);
    if (!Number.isInteger(score)) fail(`OpenBible non-integer score: ${sourceKey} -> ${targetKey}`);
    const target = parseCrossReferenceKey(targetKey);
    if (
      !target
      || !validCoordinate(target.start.book, target.start.chapter, target.start.verse)
      || !validCoordinate(target.end.book, target.end.chapter, target.end.verse)
      || coordinateOrdinal(target.start.book, target.start.chapter, target.start.verse)
        > coordinateOrdinal(target.end.book, target.end.chapter, target.end.verse)
    ) {
      fail(`OpenBible invalid target range: ${targetKey}`);
    }
  }
}
console.error(
  `[verify:data] OpenBible: ${crossReferenceData.meta.rowCount} scored edges, `
  + `${crossReferenceData.meta.sourceVerseCount} sources, ${crossReferenceData.meta.targetRangeCount} target ranges, CC-BY`,
);

console.log(`Scripture data verified: ${checkedFiles} chapter files, ${checkedVerses} verses.`);
