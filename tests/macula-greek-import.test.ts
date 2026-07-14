import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildTokenIndex,
  lemmaOccurrencesInBook,
  marksForVerse,
  morphFeatureLabels,
  parseMaculaGreekTsv,
  parseMaculaRef,
  parseMorphCode,
  tokenNeighborhood,
  tokensForVerse,
} from "../src/core/language/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/macula-greek-1co13-sample.tsv");

test("parseMaculaRef accepts MACULA ref form", () => {
  const r = parseMaculaRef("1CO 13:8!8");
  assert.deepEqual(r, { book: "1CO", chapter: 13, verse: 8, position: 8 });
  assert.equal(parseMaculaRef("not-a-ref"), null);
});

test("parseMorphCode expands V-FPI-3P", () => {
  const m = parseMorphCode("V-FPI-3P");
  assert.equal(m.pos, "verb");
  assert.equal(m.tense, "future");
  assert.equal(m.voice, "passive");
  assert.equal(m.mood, "indicative");
  assert.equal(m.person, "3rd person");
  assert.equal(m.number, "plural");
  assert.deepEqual(morphFeatureLabels(m), [
    "verb",
    "future",
    "passive",
    "indicative",
    "3rd person",
    "plural",
  ]);
});

test("parseMorphCode expands N-NSF", () => {
  const m = parseMorphCode("N-NSF");
  assert.equal(m.pos, "noun");
  assert.equal(m.case, "nominative");
  assert.equal(m.number, "singular");
  assert.equal(m.gender, "feminine");
});

test("parseMaculaGreekTsv imports 1 Cor 13 sample", () => {
  const content = readFileSync(FIXTURE, "utf8");
  const result = parseMaculaGreekTsv(content);

  assert.equal(result.stats.skipped, 0);
  assert.ok(result.stats.parsed >= 15);
  assert.deepEqual(result.stats.books, ["1CO"]);
  assert.equal(result.dataset.id, "macula-greek-nestle1904");

  const katarge = result.tokens.find((t) => t.id === "n46013008008");
  assert.ok(katarge);
  assert.equal(katarge.surface, "καταργηθήσονται");
  assert.equal(katarge.lemma, "καταργέω");
  assert.equal(katarge.strong, "2673");
  assert.equal(katarge.strongPrefixed, "G2673");
  assert.equal(katarge.morphCode, "V-FPI-3P");
  assert.equal(katarge.morph.tense, "future");
  assert.equal(katarge.morph.voice, "passive");
  assert.equal(katarge.gloss, "they will be done away");
  assert.equal(katarge.book, "1CO");
  assert.equal(katarge.chapter, 13);
  assert.equal(katarge.verse, 8);
  assert.equal(katarge.position, 8);
});

test("buildTokenIndex supports concordance and counts", () => {
  const content = readFileSync(FIXTURE, "utf8");
  const { tokens } = parseMaculaGreekTsv(content);
  const index = buildTokenIndex(tokens);

  assert.equal(index.lemmaFreqCorpus.get("καταργέω"), 4);
  assert.equal(index.lemmaFreqBook.get("1CO|καταργέω"), 4);
  assert.equal(index.lemmaFreqChapter.get("1CO.13|καταργέω"), 3);

  const inBook = lemmaOccurrencesInBook(index, "1CO", "καταργέω");
  assert.equal(inBook.length, 4);
  // 1:28 precedes 13:8 / 13:10 in reading order
  assert.equal(inBook[0]?.chapter, 1);
  assert.equal(inBook[0]?.verse, 28);
  assert.equal(inBook[1]?.chapter, 13);
  assert.equal(inBook[1]?.verse, 8);

  const v8 = tokensForVerse(index, "1CO", 13, 8);
  assert.ok(v8.length >= 10);
  assert.equal(v8[0]?.position, 1);
});

test("marksForVerse flags lemma repeat for καταργέω", () => {
  const content = readFileSync(FIXTURE, "utf8");
  const { tokens } = parseMaculaGreekTsv(content);
  const index = buildTokenIndex(tokens);
  const marks = marksForVerse(index, "1CO", 13, 8, { repeatVerseWindow: 5 });
  const repeat = marks.filter((m) => m.kind === "repeat" && m.tokenId === "n46013008008");
  assert.equal(repeat.length, 1);
});

test("tokenNeighborhood returns ± neighbors in verse", () => {
  const content = readFileSync(FIXTURE, "utf8");
  const { tokens } = parseMaculaGreekTsv(content);
  const index = buildTokenIndex(tokens);
  const nb = tokenNeighborhood(index, "n46013008008", 1);
  assert.equal(nb.focus?.surface, "καταργηθήσονται");
  assert.ok((nb.before[0]?.surface.length ?? 0) > 0);
  assert.ok((nb.after[0]?.surface.length ?? 0) > 0);
});

test("missing columns produce warning and empty tokens", () => {
  const bad = "foo\tbar\n1\t2\n";
  const result = parseMaculaGreekTsv(bad);
  assert.equal(result.tokens.length, 0);
  assert.ok(result.warnings[0]?.includes("missing required columns"));
});
