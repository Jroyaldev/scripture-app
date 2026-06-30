/**
 * B1 Scripture Package Builder — downloads full WEB and KJV text from
 * public-domain GitHub sources and converts them to the repo's per-chapter
 * JSON format, validated against backbone.json.
 *
 * Sources:
 *   WEB — https://github.com/TehShrike/world-english-bible (Public Domain)
 *   KJV — https://github.com/aruljohn/Bible-kjv (Public Domain)
 *
 * Output format per chapter:
 *   data/scripture/text/{package}/{BOOK}/{CHAPTER}.json
 *   { "verses": [{ "verse": N, "text": "..." }] }
 *
 * Usage: node scripts/build-scripture-packages.mjs
 */
"use strict";

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const dataDir = join(repoRoot, "data", "scripture");

// --- USFM 3-letter book codes in Protestant canon order ---
const BOOKS = [
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
  "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
  "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAH","HAB","ZEP",
  "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
  "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
  "2PE","1JN","2JN","3JN","JUD","REV",
];

// --- Book name → USFM code mapping for each source ---
// TehShrike WEB uses lowercase filenames: genesis.json, 1corinthians.json
const WEB_FILE_MAP = {
  GEN: "genesis", EXO: "exodus", LEV: "leviticus", NUM: "numbers",
  DEU: "deuteronomy", JOS: "joshua", JDG: "judges", RUT: "ruth",
  "1SA": "1samuel", "2SA": "2samuel", "1KI": "1kings", "2KI": "2kings",
  "1CH": "1chronicles", "2CH": "2chronicles", EZR: "ezra", NEH: "nehemiah",
  EST: "esther", JOB: "job", PSA: "psalms", PRO: "proverbs",
  ECC: "ecclesiastes", SNG: "songofsongs", ISA: "isaiah", JER: "jeremiah",
  LAM: "lamentations", EZK: "ezekiel", DAN: "daniel", HOS: "hosea",
  JOL: "joel", AMO: "amos", OBA: "obadiah", JON: "jonah", MIC: "micah",
  NAH: "nahum", HAB: "habakkuk", ZEP: "zephaniah", HAG: "haggai",
  ZEC: "zechariah", MAL: "malachi", MAT: "matthew", MRK: "mark",
  LUK: "luke", JHN: "john", ACT: "acts", ROM: "romans",
  "1CO": "1corinthians", "2CO": "2corinthians", GAL: "galatians",
  EPH: "ephesians", PHP: "philippians", COL: "colossians",
  "1TH": "1thessalonians", "2TH": "2thessalonians",
  "1TI": "1timothy", "2TI": "2timothy", TIT: "titus", PHM: "philemon",
  HEB: "hebrews", JAS: "james", "1PE": "1peter", "2PE": "2peter",
  "1JN": "1john", "2JN": "2john", "3JN": "3john", JUD: "jude",
  REV: "revelation",
};

// aruljohn KJV uses CamelCase filenames: Genesis.json, 1Corinthians.json
const KJV_FILE_MAP = {
  GEN: "Genesis", EXO: "Exodus", LEV: "Leviticus", NUM: "Numbers",
  DEU: "Deuteronomy", JOS: "Joshua", JDG: "Judges", RUT: "Ruth",
  "1SA": "1Samuel", "2SA": "2Samuel", "1KI": "1Kings", "2KI": "2Kings",
  "1CH": "1Chronicles", "2CH": "2Chronicles", EZR: "Ezra", NEH: "Nehemiah",
  EST: "Esther", JOB: "Job", PSA: "Psalms", PRO: "Proverbs",
  ECC: "Ecclesiastes", SNG: "SongofSolomon", ISA: "Isaiah", JER: "Jeremiah",
  LAM: "Lamentations", EZK: "Ezekiel", DAN: "Daniel", HOS: "Hosea",
  JOL: "Joel", AMO: "Amos", OBA: "Obadiah", JON: "Jonah", MIC: "Micah",
  NAH: "Nahum", HAB: "Habakkuk", ZEP: "Zephaniah", HAG: "Haggai",
  ZEC: "Zechariah", MAL: "Malachi", MAT: "Matthew", MRK: "Mark",
  LUK: "Luke", JHN: "John", ACT: "Acts", ROM: "Romans",
  "1CO": "1Corinthians", "2CO": "2Corinthians", GAL: "Galatians",
  EPH: "Ephesians", PHP: "Philippians", COL: "Colossians",
  "1TH": "1Thessalonians", "2TH": "2Thessalonians",
  "1TI": "1Timothy", "2TI": "2Timothy", TIT: "Titus", PHM: "Philemon",
  HEB: "Hebrews", JAS: "James", "1PE": "1Peter", "2PE": "2Peter",
  "1JN": "1John", "2JN": "2John", "3JN": "3John", JUD: "Jude",
  REV: "Revelation",
};

const WEB_BASE = "https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json";
const KJV_BASE = "https://raw.githubusercontent.com/aruljohn/Bible-kjv/master";

// --- Load backbone for validation ---
const backbone = JSON.parse(readFileSync(join(dataDir, "backbone.json"), "utf-8"));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Convert TehShrike WEB format (array of paragraph/line entries) to
 * per-chapter verse arrays. A verse can span multiple entries (e.g.,
 * paragraph text + stanza line text); concatenate values in order.
 */
function convertWebBook(data, bookCode) {
  const chapterMap = new Map(); // chapterNum -> Map(verseNum -> string[])

  for (const entry of data) {
    if (entry.type !== "paragraph text" && entry.type !== "line text") continue;
    const ch = entry.chapterNumber;
    const v = entry.verseNumber;
    if (typeof ch !== "number" || typeof v !== "number") continue;

    if (!chapterMap.has(ch)) chapterMap.set(ch, new Map());
    const verseMap = chapterMap.get(ch);
    if (!verseMap.has(v)) verseMap.set(v, []);
    verseMap.get(v).push(entry.value || "");
  }

  return chapterMapToChapters(chapterMap, bookCode, "web");
}

/**
 * Convert aruljohn KJV format (nested chapters/verses) to per-chapter arrays.
 */
function convertKjvBook(data, bookCode) {
  const chapterMap = new Map();

  for (const ch of data.chapters || []) {
    const chNum = parseInt(ch.chapter, 10);
    if (isNaN(chNum)) continue;
    const verseMap = new Map();
    for (const v of ch.verses || []) {
      const vNum = parseInt(v.verse, 10);
      if (isNaN(vNum)) continue;
      verseMap.set(vNum, [v.text || ""]);
    }
    chapterMap.set(chNum, verseMap);
  }

  return chapterMapToChapters(chapterMap, bookCode, "kjv");
}

function chapterMapToChapters(chapterMap, bookCode, pkgId) {
  const expectedChapters = backbone.books[bookCode]?.chapters || [];
  const chapters = [];

  for (let ch = 1; ch <= expectedChapters.length; ch++) {
    const verseMap = chapterMap.get(ch);
    const expectedVerses = expectedChapters[ch - 1];
    const verses = [];

    if (verseMap) {
      for (let v = 1; v <= expectedVerses; v++) {
        const parts = verseMap.get(v);
        if (parts) {
          // Concatenate parts and trim trailing whitespace
          const text = parts.join("").trim();
          verses.push({ verse: v, text });
        }
      }
    }

    chapters.push({ chapter: ch, verses, expectedVerses });
  }

  return chapters;
}

function writeBookChapters(pkgId, bookCode, chapters) {
  const bookDir = join(dataDir, "text", pkgId, bookCode);
  mkdirSync(bookDir, { recursive: true });

  let written = 0;
  let missing = 0;

  for (const ch of chapters) {
    const chapterPath = join(bookDir, `${ch.chapter}.json`);
    if (ch.verses.length === 0) {
      missing++;
      continue;
    }
    writeFileSync(chapterPath, JSON.stringify({ verses: ch.verses }, null, 1) + "\n");
    written++;
  }

  return { written, missing };
}

function validateBook(pkgId, bookCode, chapters) {
  const expected = backbone.books[bookCode]?.chapters || [];
  const issues = [];

  for (let ch = 0; ch < expected.length; ch++) {
    const chapterNum = ch + 1;
    const chapter = chapters[ch];
    if (!chapter || chapter.verses.length === 0) {
      issues.push(`  ${bookCode} ${chapterNum}: MISSING (expected ${expected[ch]} verses)`);
      continue;
    }
    if (chapter.verses.length < expected[ch]) {
      issues.push(`  ${bookCode} ${chapterNum}: ${chapter.verses.length}/${expected[ch]} verses`);
    }
  }

  return issues;
}

async function buildPackage(pkgId, fileMap, baseUrl, convertFn) {
  console.log(`\n=== Building ${pkgId.toUpperCase()} ===`);
  let totalWritten = 0;
  let totalMissing = 0;
  let totalIssues = [];
  let booksOk = 0;

  for (const bookCode of BOOKS) {
    const fileName = fileMap[bookCode];
    if (!fileName) {
      console.error(`  No file mapping for ${bookCode}`);
      totalIssues.push(`  ${bookCode}: no file mapping`);
      continue;
    }

    const url = `${baseUrl}/${fileName}.json`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      // Try alternate name for Song of Solomon
      if (bookCode === "SNG") {
        const altUrl = pkgId === "web"
          ? `${baseUrl}/songofsolomon.json`
          : `${baseUrl}/SongofSongs.json`;
        try {
          data = await fetchJson(altUrl);
        } catch {
          console.error(`  ${bookCode}: FAILED to fetch (${err.message})`);
          totalIssues.push(`  ${bookCode}: fetch failed`);
          continue;
        }
      } else {
        console.error(`  ${bookCode}: FAILED to fetch (${err.message})`);
        totalIssues.push(`  ${bookCode}: fetch failed`);
        continue;
      }
    }

    const chapters = convertFn(data, bookCode);
    const { written, missing } = writeBookChapters(pkgId, bookCode, chapters);
    totalWritten += written;
    totalMissing += missing;

    const issues = validateBook(pkgId, bookCode, chapters);
    if (issues.length === 0) {
      booksOk++;
    } else {
      totalIssues.push(...issues);
    }
    process.stdout.write(`  ${bookCode}: ${written} chapters written`);
    if (missing > 0) process.stdout.write(` (${missing} missing)`);
    process.stdout.write("\n");
  }

  console.log(`\n  ${pkgId.toUpperCase()} summary: ${booksOk}/${BOOKS.length} books OK, ${totalWritten} chapter files written`);
  if (totalIssues.length > 0) {
    console.log(`  Issues (${totalIssues.length}):`);
    for (const issue of totalIssues.slice(0, 20)) console.log(issue);
    if (totalIssues.length > 20) console.log(`  ... and ${totalIssues.length - 20} more`);
  }
  return { booksOk, totalWritten, totalMissing, totalIssues };
}

// --- Main ---
console.log("B1 Scripture Package Builder");
console.log(`Backbone: ${BOOKS.length} books, ${BOOKS.reduce((s, b) => s + (backbone.books[b]?.chapters.length || 0), 0)} chapters total`);

const webResult = await buildPackage("web", WEB_FILE_MAP, WEB_BASE, convertWebBook);
const kjvResult = await buildPackage("kjv", KJV_FILE_MAP, KJV_BASE, convertKjvBook);

// --- Supplement missing WEB ROM 16:25-27 (TehShrike source lacks the doxology) ---
const webRom16Path = join(dataDir, "text", "web", "ROM", "16.json");
if (existsSync(webRom16Path)) {
  const rom16 = JSON.parse(readFileSync(webRom16Path, "utf-8"));
  const existingVerses = new Set(rom16.verses.map((v) => v.verse));
  // Public domain WEB text for the doxology
  const supplements = [
    { verse: 25, text: "Now to him who is able to establish you according to my Good News and the preaching of Jesus Christ, according to the revelation of the mystery which has been kept secret through long ages," },
    { verse: 26, text: "but now is revealed, and by the Scriptures of the prophets, according to the commandment of the eternal God, is made known for obedience of faith to all the nations;" },
    { verse: 27, text: "to the only wise God, through Jesus Christ, to whom be the glory forever! Amen." },
  ];
  let added = 0;
  for (const s of supplements) {
    if (!existingVerses.has(s.verse)) {
      rom16.verses.push(s);
      added++;
    }
  }
  if (added > 0) {
    rom16.verses.sort((a, b) => a.verse - b.verse);
    writeFileSync(webRom16Path, JSON.stringify(rom16, null, 1) + "\n");
    console.log(`\n  Supplemented WEB ROM 16 with ${added} missing verses (doxology).`);
  }
}

console.log("\n=== Final ===");
console.log(`WEB: ${webResult.booksOk}/${BOOKS.length} books, ${webResult.totalWritten} files`);
console.log(`KJV: ${kjvResult.booksOk}/${BOOKS.length} books, ${kjvResult.totalWritten} files`);

if (webResult.booksOk === BOOKS.length && kjvResult.booksOk === BOOKS.length) {
  console.log("\nAll 66 books validated for both packages.");
  process.exit(0);
} else {
  console.log("\nWARNING: Some books have issues. Review output above.");
  process.exit(1);
}
