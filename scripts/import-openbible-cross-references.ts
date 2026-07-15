/**
 * Normalize the complete OpenBible cross-reference TSV into a deterministic,
 * scored JSONL artifact. The source ZIP/TXT remains an external installed
 * artifact (INV-13); the normalized read-only reference graph is committed.
 *
 * Usage:
 *   npm run import:openbible-crossrefs -- /path/to/cross_references.txt
 *   npm run import:openbible-crossrefs -- /path/to/cross_references.zip
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import type { BackboneData, BookCode, CanonicalVerse } from "../src/core/reference/types.js";
import type {
  CrossReferenceEdge,
  CrossReferenceMeta,
} from "../src/core/cross-references/index.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const inputPath = process.argv[2] ? resolve(process.argv[2]) : "";
const outputPath = resolve(ROOT, "data/cross-references/openbible.jsonl");
const doctorPath = resolve(ROOT, "data/cross-references/openbible-doctor-report.json");
const backbone = JSON.parse(
  readFileSync(resolve(ROOT, "data/scripture/backbone.json"), "utf-8"),
) as BackboneData;
const bookOrder = new Map(Object.keys(backbone.books).map((book, index) => [book, index]));

if (!inputPath) {
  throw new Error("Pass the OpenBible cross_references.txt or .zip path");
}

const OPEN_BIBLE_TO_USFM: Record<string, BookCode> = {
  Gen: "GEN", Exod: "EXO", Lev: "LEV", Num: "NUM", Deut: "DEU",
  Josh: "JOS", Judg: "JDG", Ruth: "RUT", "1Sam": "1SA", "2Sam": "2SA",
  "1Kgs": "1KI", "2Kgs": "2KI", "1Chr": "1CH", "2Chr": "2CH",
  Ezra: "EZR", Neh: "NEH", Esth: "EST", Job: "JOB", Ps: "PSA",
  Prov: "PRO", Eccl: "ECC", Song: "SNG", Isa: "ISA", Jer: "JER",
  Lam: "LAM", Ezek: "EZK", Dan: "DAN", Hos: "HOS", Joel: "JOL",
  Amos: "AMO", Obad: "OBA", Jonah: "JON", Mic: "MIC", Nah: "NAH",
  Hab: "HAB", Zeph: "ZEP", Hag: "HAG", Zech: "ZEC", Mal: "MAL",
  Matt: "MAT", Mark: "MRK", Luke: "LUK", John: "JHN", Acts: "ACT",
  Rom: "ROM", "1Cor": "1CO", "2Cor": "2CO", Gal: "GAL", Eph: "EPH",
  Phil: "PHP", Col: "COL", "1Thess": "1TH", "2Thess": "2TH",
  "1Tim": "1TI", "2Tim": "2TI", Titus: "TIT", Phlm: "PHM", Heb: "HEB",
  Jas: "JAS", "1Pet": "1PE", "2Pet": "2PE", "1John": "1JN",
  "2John": "2JN", "3John": "3JN", Jude: "JUD", Rev: "REV",
};

// OpenBible follows a 15-verse numbering for 3 John; our translation-free
// backbone follows the common 14-verse scheme. Preserve every edge through
// this explicit one-point mapping rather than dropping out-of-backbone rows.
const OPEN_BIBLE_POINT_OVERRIDES: Record<string, CanonicalVerse> = {
  "3John.1.15": { book: "3JN", chapter: 1, verse: 14 },
};

type ImportIssue = { row: number; value: string; reason: string };
type ParsedRange = { start: CanonicalVerse; end: CanonicalVerse; key: string };

const raw = extname(inputPath).toLowerCase() === ".zip"
  ? execFileSync("unzip", ["-p", inputPath], { maxBuffer: 32 * 1024 * 1024 })
  : readFileSync(inputPath);
const rawSha256 = createHash("sha256").update(raw).digest("hex");
const lines = raw.toString("utf-8").replace(/\r\n/g, "\n").split("\n");
const header = lines.shift() ?? "";
const headerMatch = /^From Verse\tTo Verse\tVotes\t#www\.openbible\.info CC-BY (\d{4}-\d{2}-\d{2})$/.exec(header);
if (!headerMatch) {
  throw new Error(`Unexpected OpenBible header/license: ${header}`);
}
const snapshotDate = headerMatch[1]!;

const refs = new Map<string, CrossReferenceEdge[]>();
const duplicateKeys = new Set<string>();
const seenEdges = new Set<string>();
const malformedRows: ImportIssue[] = [];
const invalidSources: ImportIssue[] = [];
const invalidTargets: ImportIssue[] = [];
const reversedRanges: ImportIssue[] = [];
let rawRowCount = 0;
let targetRangeCount = 0;
let crossBookRangeCount = 0;
let nonPositiveScoreCount = 0;
let scoreMin = Number.POSITIVE_INFINITY;
let scoreMax = Number.NEGATIVE_INFINITY;
let scoreSum = 0;
let mappedCoordinateOccurrences = 0;
const mappedCoordinateValues = new Set<string>();

for (let index = 0; index < lines.length; index++) {
  const line = lines[index]!;
  if (!line) continue;
  rawRowCount++;
  const rowNumber = index + 2;
  const [sourceText, targetText, scoreText, extra] = line.split("\t");
  if (!sourceText || !targetText || !scoreText || extra !== undefined) {
    malformedRows.push({ row: rowNumber, value: line, reason: "expected exactly three TSV columns" });
    continue;
  }
  const source = parseRange(sourceText);
  if (!source || source.start.book !== source.end.book || source.start.chapter !== source.end.chapter || source.start.verse !== source.end.verse) {
    invalidSources.push({ row: rowNumber, value: sourceText, reason: "source must be one valid canonical verse" });
    continue;
  }
  const target = parseRange(targetText);
  if (!target) {
    invalidTargets.push({ row: rowNumber, value: targetText, reason: "target must be a valid canonical verse or range" });
    continue;
  }
  if (compareVerse(target.start, target.end) > 0) {
    reversedRanges.push({ row: rowNumber, value: targetText, reason: "range end precedes range start" });
    continue;
  }
  const score = Number(scoreText);
  if (!Number.isInteger(score)) {
    malformedRows.push({ row: rowNumber, value: scoreText, reason: "score is not an integer" });
    continue;
  }

  if (target.start.book !== target.end.book) crossBookRangeCount++;
  if (target.start.book !== target.end.book || target.start.chapter !== target.end.chapter || target.start.verse !== target.end.verse) {
    targetRangeCount++;
  }
  if (score <= 0) nonPositiveScoreCount++;
  scoreMin = Math.min(scoreMin, score);
  scoreMax = Math.max(scoreMax, score);
  scoreSum += score;

  const sourceKey = source.key;
  const edgeKey = `${sourceKey}\t${target.key}`;
  if (seenEdges.has(edgeKey)) {
    duplicateKeys.add(edgeKey);
    continue;
  }
  seenEdges.add(edgeKey);
  const targets = refs.get(sourceKey) ?? [];
  targets.push([target.key, score]);
  refs.set(sourceKey, targets);
}

const sources = [...refs.keys()].sort((a, b) => compareKey(a, b));
for (const source of sources) {
  refs.get(source)!.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const sourceBooks = new Set(sources.map((source) => source.split(".")[0]!));
const storedRowCount = sources.reduce((sum, source) => sum + refs.get(source)!.length, 0);
const coverageHealthy = storedRowCount >= 300_000 && sources.length >= 29_000 && sourceBooks.size === 66;
const hasStructuralErrors = malformedRows.length > 0
  || invalidSources.length > 0
  || invalidTargets.length > 0
  || reversedRanges.length > 0
  || duplicateKeys.size > 0;
if (hasStructuralErrors || !coverageHealthy || storedRowCount !== rawRowCount) {
  console.error(JSON.stringify({
    malformedRows: malformedRows.slice(0, 10),
    invalidSources: invalidSources.slice(0, 10),
    invalidTargets: invalidTargets.slice(0, 10),
    reversedRanges: reversedRanges.slice(0, 10),
    duplicateEdges: [...duplicateKeys].slice(0, 10),
  }, null, 2));
  throw new Error(
    `OpenBible import refused: rows=${storedRowCount}/${rawRowCount}, sources=${sources.length}, books=${sourceBooks.size}, `
    + `malformed=${malformedRows.length}, invalidSource=${invalidSources.length}, invalidTarget=${invalidTargets.length}, `
    + `reversed=${reversedRanges.length}, duplicates=${duplicateKeys.size}`,
  );
}

const sourceLines = sources.map((source) => JSON.stringify({ source, targets: refs.get(source)! }));
const normalizedSha256 = createHash("sha256").update(sourceLines.join("\n")).digest("hex");
const meta: CrossReferenceMeta = {
  formatVersion: 1,
  id: "openbible-cross-references",
  name: "OpenBible Cross References",
  source: "OpenBible.info cross-reference dataset",
  sourceUrl: "https://www.openbible.info/labs/cross-references/",
  license: "CC-BY",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: `OpenBible Cross References, CC-BY 4.0, snapshot ${snapshotDate}`,
  snapshotDate,
  rowCount: storedRowCount,
  sourceVerseCount: sources.length,
  sourceBookCount: sourceBooks.size,
  targetRangeCount,
  scoreMin,
  scoreMax,
  scoreSum,
  rawSha256,
  normalizedSha256,
};

const doctor = {
  status: "healthy",
  generatedAt: new Date().toISOString(),
  source: {
    fileName: basename(inputPath),
    header,
    snapshotDate,
    license: "CC-BY",
    rawSha256,
  },
  coverage: {
    rawRowCount,
    storedRowCount,
    sourceVerseCount: sources.length,
    sourceBookCount: sourceBooks.size,
    targetRangeCount,
    crossBookRangeCount,
    nonPositiveScoreCount,
    mappedCoordinateOccurrences,
    mappedCoordinateValues: [...mappedCoordinateValues],
  },
  scores: { min: scoreMin, max: scoreMax, sum: scoreSum, normalizedSha256 },
  checks: {
    coverageFloor: coverageHealthy,
    canonicalCoordinates: invalidSources.length === 0 && invalidTargets.length === 0,
    uniqueEdges: duplicateKeys.size === 0,
    rangeIntegrity: reversedRanges.length === 0,
    license: header.includes("CC-BY"),
    snapshotDate: /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate),
    scoresPreserved: storedRowCount === rawRowCount && Number.isFinite(scoreSum),
  },
  issues: {
    malformedRows: malformedRows.slice(0, 25),
    invalidSources: invalidSources.slice(0, 25),
    invalidTargets: invalidTargets.slice(0, 25),
    reversedRanges: reversedRanges.slice(0, 25),
    duplicateEdges: [...duplicateKeys].slice(0, 25),
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ meta })}\n${sourceLines.join("\n")}\n`);
writeFileSync(doctorPath, `${JSON.stringify(doctor, null, 2)}\n`);

console.log(`OpenBible cross references: ${storedRowCount.toLocaleString()} edges`);
console.log(`Sources: ${sources.length.toLocaleString()} verses across ${sourceBooks.size} books`);
console.log(`Target ranges: ${targetRangeCount.toLocaleString()}; non-positive retained: ${nonPositiveScoreCount.toLocaleString()}`);
console.log(`Snapshot: ${snapshotDate}; license: CC-BY`);
console.log(`Wrote ${outputPath}`);
console.log(`Doctor: ${doctorPath}`);

function parseRange(value: string): ParsedRange | null {
  const [startText, endText, extra] = value.split("-");
  if (!startText || extra !== undefined) return null;
  const start = parsePoint(startText);
  const end = endText ? parsePoint(endText) : start;
  if (!start || !end) return null;
  const key = pointKey(start) === pointKey(end) ? pointKey(start) : `${pointKey(start)}-${pointKey(end)}`;
  return { start, end, key };
}

function parsePoint(value: string): CanonicalVerse | null {
  const override = OPEN_BIBLE_POINT_OVERRIDES[value];
  if (override) {
    mappedCoordinateOccurrences++;
    mappedCoordinateValues.add(`${value} -> ${pointKey(override)}`);
    return override;
  }
  const match = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  const book = OPEN_BIBLE_TO_USFM[match[1]!];
  if (!book) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  const chapterData = backbone.books[book]?.chapters;
  if (!chapterData || chapter < 1 || chapter > chapterData.length) return null;
  const verseCount = chapterData[chapter - 1];
  if (!verseCount || verse < 1 || verse > verseCount) return null;
  return { book, chapter, verse };
}

function pointKey(value: CanonicalVerse): string {
  return `${value.book}.${value.chapter}.${value.verse}`;
}

function compareVerse(a: CanonicalVerse, b: CanonicalVerse): number {
  return (bookOrder.get(a.book) ?? 999) - (bookOrder.get(b.book) ?? 999)
    || a.chapter - b.chapter
    || a.verse - b.verse;
}

function compareKey(a: string, b: string): number {
  const parse = (value: string): CanonicalVerse => {
    const [book, chapter, verse] = value.split(".") as [BookCode, string, string];
    return { book, chapter: Number(chapter), verse: Number(verse) };
  };
  return compareVerse(parse(a), parse(b));
}
