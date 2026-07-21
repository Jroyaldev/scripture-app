/**
 * B1 Verification — full scripture package path.
 *
 * Checks:
 * 1. Every WEB/KJV book has the expected chapter file count.
 * 2. Representative WEB/KJV chapters match backbone verse counts.
 * 3. Package manifests have required license flags and formatVersion.
 * 4. Doctor flags a newer package format version as refusal.
 * 5. Doctor flags missing package content.
 * 6. LICENSES.md covers both packages.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runDoctor } from "../src/core/doctor/index.js";
import { CURRENT_PACKAGE_FORMAT_VERSION } from "../src/core/migration/index.js";
import type { BackboneData } from "../src/core/reference/types.js";

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = join(repoRoot, "data", "scripture");
const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf-8")) as BackboneData;
const bookCodes = Object.keys(backbone.books);
const verseCountSamples = [
  { book: "GEN", chapter: 1 },
  { book: "PSA", chapter: 119 },
  { book: "MAL", chapter: 4 },
  { book: "MAT", chapter: 1 },
  { book: "JHN", chapter: 3 },
  { book: "REV", chapter: 22 },
  // Regression 2026-07-14: backbone had been short; packages truncated to match.
  // Classic KJV counts — module/YLT gold (see docs/esword-import-and-resources.md).
  { book: "1SA", chapter: 23, expected: 29 },
  { book: "JOB", chapter: 41, expected: 34 },
  { book: "JOB", chapter: 42, expected: 17 },
  { book: "1CO", chapter: 16, expected: 24 },
];

function countChapterFiles(pkgId: string, book: string): number {
  const dir = join(dataDir, "text", pkgId, book);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

function getVerseCount(pkgId: string, book: string, chapter: number): number {
  const path = join(dataDir, "text", pkgId, book, `${chapter}.json`);
  if (!existsSync(path)) return 0;
  const data = JSON.parse(readFileSync(path, "utf-8")) as { verses: Array<{ verse: number; text: string }> };
  return data.verses.length;
}

test("WEB covers all 66 books with correct chapter counts", () => {
  let totalChapters = 0;
  let okChapters = 0;
  for (const book of bookCodes) {
    const expected = backbone.books[book]!.chapters.length;
    const actual = countChapterFiles("web", book);
    totalChapters += expected;
    okChapters += Math.min(actual, expected);
    assert.equal(actual, expected, `WEB ${book}: expected ${expected} chapter files, got ${actual}`);
  }
  assert.equal(okChapters, totalChapters, `WEB total: ${okChapters}/${totalChapters} chapters`);
});

test("KJV covers all 66 books with correct chapter counts", () => {
  let totalChapters = 0;
  let okChapters = 0;
  for (const book of bookCodes) {
    const expected = backbone.books[book]!.chapters.length;
    const actual = countChapterFiles("kjv", book);
    totalChapters += expected;
    okChapters += Math.min(actual, expected);
    assert.equal(actual, expected, `KJV ${book}: expected ${expected} chapter files, got ${actual}`);
  }
  assert.equal(okChapters, totalChapters, `KJV total: ${okChapters}/${totalChapters} chapters`);
});

test("backbone uses classic KJV verse totals (31,102)", () => {
  let total = 0;
  for (const book of bookCodes) {
    total += backbone.books[book]!.chapters.reduce((a, n) => a + n, 0);
  }
  assert.equal(total, 31102, `backbone verse total should be classic KJV 31102, got ${total}`);
});

test("hot chapters match classic KJV counts in backbone and all packages", () => {
  const hot = verseCountSamples.filter(
    (s): s is { book: string; chapter: number; expected: number } => "expected" in s,
  );
  for (const sample of hot) {
    const bb = backbone.books[sample.book]!.chapters[sample.chapter - 1]!;
    assert.equal(
      bb,
      sample.expected,
      `backbone ${sample.book} ${sample.chapter}: expected ${sample.expected}, got ${bb}`,
    );
    for (const pkg of ["web", "kjv", "ylt"] as const) {
      const actual = getVerseCount(pkg, sample.book, sample.chapter);
      assert.equal(
        actual,
        sample.expected,
        `${pkg.toUpperCase()} ${sample.book} ${sample.chapter}: expected ${sample.expected} verses, got ${actual}`,
      );
    }
  }
});

test("WEB representative verse counts match backbone", () => {
  for (const sample of verseCountSamples) {
    const expected =
      "expected" in sample && sample.expected != null
        ? sample.expected
        : backbone.books[sample.book]!.chapters[sample.chapter - 1]!;
    const actual = getVerseCount("web", sample.book, sample.chapter);
    assert.equal(actual, expected, `WEB ${sample.book} ${sample.chapter}: expected ${expected} verses, got ${actual}`);
  }
});

test("KJV representative verse counts match backbone", () => {
  for (const sample of verseCountSamples) {
    const expected = backbone.books[sample.book]!.chapters[sample.chapter - 1]!;
    const actual = getVerseCount("kjv", sample.book, sample.chapter);
    assert.equal(actual, expected, `KJV ${sample.book} ${sample.chapter}: expected ${expected} verses, got ${actual}`);
  }
});

test("WEB package manifest has required license flags and formatVersion", () => {
  const manifestPath = join(dataDir, "packages", "web", "manifest.json");
  assert.equal(existsSync(manifestPath), true, "WEB manifest.json should exist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.id, "web");
  assert.equal(typeof manifest.formatVersion, "number");
  assert.equal(manifest.license.permissions.bundle, true);
  assert.equal(manifest.license.permissions.index, true);
  assert.equal(manifest.license.permissions.display, true);
  assert.equal(manifest.license.permissions.quoteInNotes, true);
  assert.equal(manifest.license.permissions.export, true);
  assert.equal(manifest.license.permissions.syncToOwnDevices, true);
  assert.ok(manifest.license.attributionText, "WEB should have attribution text");
});

test("KJV package manifest has required license flags and formatVersion", () => {
  const manifestPath = join(dataDir, "packages", "kjv", "manifest.json");
  assert.equal(existsSync(manifestPath), true, "KJV manifest.json should exist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.id, "kjv");
  assert.equal(typeof manifest.formatVersion, "number");
  assert.equal(manifest.license.permissions.bundle, true);
  assert.equal(manifest.license.permissions.index, true);
  assert.equal(manifest.license.permissions.display, true);
  assert.equal(manifest.license.permissions.quoteInNotes, true);
  assert.equal(manifest.license.permissions.export, true);
  assert.equal(manifest.license.permissions.syncToOwnDevices, true);
  assert.ok(manifest.license.attributionText, "KJV should have attribution text");
});

test("Doctor refuses a newer package format version", () => {
  const report = runDoctor({
    notes: [],
    events: { highlights: [], connections: [], pinnedFacts: [], threads: [], noteChangeLogs: [] },
    manifest: null,
    backbone,
    rebuildHash: null,
    expectedRebuildHash: null,
    packageManifests: [
      { id: "future", formatVersion: CURRENT_PACKAGE_FORMAT_VERSION + 1, license: { name: "Test", attributionText: "Test", permissions: { bundle: true } } },
    ],
    packageContent: [],
    sourceDirs: [],
    installedArtifactPaths: [],
  });
  assert.ok(
    report.diagnostics.some((d) => d.category === "package-version-refused" && d.severity === "error"),
    "Doctor should flag a newer package format as refusal",
  );
});

test("Doctor flags missing package content", () => {
  const report = runDoctor({
    notes: [],
    events: { highlights: [], connections: [], pinnedFacts: [], threads: [], noteChangeLogs: [] },
    manifest: null,
    backbone,
    rebuildHash: null,
    expectedRebuildHash: null,
    packageManifests: [
      { id: "incomplete", formatVersion: 1, license: { name: "Test", attributionText: "Test", permissions: { bundle: true } } },
    ],
    packageContent: [
      { packageId: "incomplete", book: "GEN", chapterCount: 50 },
      // Missing all other books
    ],
    sourceDirs: [],
    installedArtifactPaths: [],
  });
  assert.ok(
    report.diagnostics.some((d) => d.category === "missing-package-content" && d.severity === "error"),
    "Doctor should flag missing package content",
  );
});

test("Doctor reports no errors on complete WEB/KJV packages", () => {
  const packageContent: Array<{ packageId: string; book: string; chapterCount: number }> = [];
  for (const pkgId of ["web", "kjv"]) {
    for (const book of bookCodes) {
      packageContent.push({ packageId: pkgId, book, chapterCount: backbone.books[book]!.chapters.length });
    }
  }

  const webManifest = JSON.parse(readFileSync(join(dataDir, "packages", "web", "manifest.json"), "utf-8"));
  const kjvManifest = JSON.parse(readFileSync(join(dataDir, "packages", "kjv", "manifest.json"), "utf-8"));

  const report = runDoctor({
    notes: [],
    events: { highlights: [], connections: [], pinnedFacts: [], threads: [], noteChangeLogs: [] },
    manifest: { libraryId: "test", createdAt: "2024-01-01T00:00:00Z", appSchemaVersion: 1, eventSchemaVersion: 1, referenceFormatVersion: "bref:v1", pluginApiVersion: "1" },
    backbone,
    rebuildHash: null,
    expectedRebuildHash: null,
    packageManifests: [webManifest, kjvManifest],
    packageContent,
    sourceDirs: [],
    installedArtifactPaths: [],
  });

  const errors = report.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `Doctor should report no errors on complete packages, but got: ${errors.map((e) => e.message).join("; ")}`);
});

test("LICENSES.md covers both WEB and KJV packages", () => {
  const licensesPath = join(repoRoot, "LICENSES.md");
  const content = readFileSync(licensesPath, "utf-8");
  assert.match(content, /World English Bible.*WEB/s, "LICENSES.md should cover WEB");
  assert.match(content, /King James Version.*KJV/s, "LICENSES.md should cover KJV");
  assert.match(content, /TehShrike\/world-english-bible/, "LICENSES.md should cite WEB data source");
  assert.match(content, /aruljohn\/Bible-kjv/, "LICENSES.md should cite KJV data source");
});
