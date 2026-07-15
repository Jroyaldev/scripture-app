import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseUsfmText } from "../src/core/importer/usfm-text.js";

const repoRoot = resolve(import.meta.dirname, "..");
const bsbTextDir = join(repoRoot, "data", "scripture", "text", "bsb");
const bsbManifestPath = join(repoRoot, "data", "scripture", "packages", "bsb", "manifest.json");
const bsbDoctorReportPath = join(repoRoot, "data", "scripture", "packages", "bsb", "doctor-report.json");

type BsbChapter = {
  verses: Array<{ verse: number; text: string }>;
  headings?: Array<{ beforeVerse: number; kind: string; level: number; text: string }>;
};

test("USFM publication structure never becomes canonical verse prose", () => {
  const fixture = String.raw`\id GEN Fixture
\usfm 3.1
\c 1
\s1 The Creation
\r (\ref John 1:1|JHN 1:1\ref*)
\p \v 1 In the beginning.\f + \fr 1:1 \ft A note\f*
\pmo A continuation of verse one.
\s2 The First Day
\p \v 2 Let there be light.
\d A noncanonical description
\qa Aleph
\p \v 3 It was good.
\c 2
\d \v 1 A numbered Psalm superscription.`;

  const parsed = parseUsfmText(fixture);
  const chapter = parsed.chapters.get(1);
  assert.ok(chapter);
  assert.deepEqual(chapter.verses, [
    { verse: 1, text: "In the beginning. A continuation of verse one." },
    { verse: 2, text: "Let there be light." },
    { verse: 3, text: "It was good." },
  ]);
  assert.deepEqual(chapter.headings, [
    { beforeVerse: 1, kind: "section", level: 1, text: "The Creation" },
    { beforeVerse: 2, kind: "section", level: 2, text: "The First Day" },
    { beforeVerse: 3, kind: "description", level: 1, text: "A noncanonical description" },
    { beforeVerse: 3, kind: "acrostic", level: 1, text: "Aleph" },
  ]);
  assert.equal(parsed.structuralLinesDropped, 7);
  assert.deepEqual(parsed.chapters.get(2)?.verses, [
    { verse: 1, text: "A numbered Psalm superscription." },
  ]);
  assert.deepEqual(parsed.chapters.get(2)?.headings, []);
});

test("the committed BSB Genesis 1 text keeps day headings out of verses", () => {
  const chapter = JSON.parse(
    readFileSync(join(bsbTextDir, "GEN", "1.json"), "utf-8"),
  ) as BsbChapter;

  assert.equal(
    chapter.verses.find((verse) => verse.verse === 2)?.text,
    "Now the earth was formless and void, and darkness was over the surface of the deep. And the Spirit of God was hovering over the surface of the waters.",
  );
  assert.equal(
    chapter.verses.find((verse) => verse.verse === 5)?.text,
    "God called the light “day,” and the darkness He called “night.” And there was evening, and there was morning — the first day.",
  );
  assert.ok(chapter.headings?.some((heading) => heading.beforeVerse === 3 && heading.text === "The First Day"));
  assert.ok(chapter.headings?.some((heading) => heading.beforeVerse === 6 && heading.text === "The Second Day"));
});

test("every committed BSB structural heading is separate from adjacent verse prose", () => {
  assert.equal(existsSync(bsbTextDir), true);
  let headingCount = 0;

  for (const book of readdirSync(bsbTextDir)) {
    const bookDir = join(bsbTextDir, book);
    for (const file of readdirSync(bookDir).filter((name) => name.endsWith(".json"))) {
      const chapter = JSON.parse(readFileSync(join(bookDir, file), "utf-8")) as BsbChapter;
      for (const heading of chapter.headings ?? []) {
        headingCount += 1;
        assert.ok(heading.beforeVerse >= 1, `${book}/${file}: invalid heading coordinate`);
        assert.ok(heading.text.trim().length > 0, `${book}/${file}: empty heading`);
        for (const verse of chapter.verses) {
          assert.equal(
            verse.text.endsWith(` ${heading.text}`),
            false,
            `${book}/${file} verse ${verse.verse}: heading leaked into canonical prose: ${heading.text}`,
          );
        }
      }
    }
  }

  assert.equal(headingCount, 3_150, `expected the complete BSB heading structure, got ${headingCount}`);
});

test("the BSB import doctor records complete structure extraction without verse loss", () => {
  const manifest = JSON.parse(readFileSync(bsbManifestPath, "utf-8")) as {
    doctor: {
      totalVerses: number;
      filesWritten: number;
      backboneMismatches: number;
      structuralHeadings: number;
      structuralLinesDropped: number;
    };
  };
  const report = JSON.parse(readFileSync(bsbDoctorReportPath, "utf-8")) as {
    total: number;
    structuralHeadings: number;
    structuralLinesDropped: number;
  };

  assert.deepEqual(
    {
      totalVerses: manifest.doctor.totalVerses,
      filesWritten: manifest.doctor.filesWritten,
      backboneMismatches: manifest.doctor.backboneMismatches,
      structuralHeadings: manifest.doctor.structuralHeadings,
      structuralLinesDropped: manifest.doctor.structuralLinesDropped,
    },
    {
      totalVerses: 31_086,
      filesWritten: 1_189,
      backboneMismatches: 15,
      structuralHeadings: 3_150,
      structuralLinesDropped: 5_004,
    },
  );
  assert.deepEqual(
    {
      total: report.total,
      structuralHeadings: report.structuralHeadings,
      structuralLinesDropped: report.structuralLinesDropped,
    },
    {
      total: 15,
      structuralHeadings: 3_150,
      structuralLinesDropped: 5_004,
    },
  );
});
