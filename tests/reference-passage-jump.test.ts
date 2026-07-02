import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePassage } from "../src/renderer/utils/parsePassage.js";
import type { BackboneData, BookNameData } from "../src/renderer/api.js";

// Aliases below (SNG/1SA/JUD/JDG/PHP/PHM) are copied verbatim from
// data/scripture/book-names-en.json for the new prefix-collision / edge-case tests.
const bookNames: BookNameData = {
  REV: ["Revelation", "Rev", "Re", "Apocalypse"],
  PSA: ["Psalms", "Psalm", "Psa", "Ps", "Pss"],
  "1CO": ["1 Corinthians", "1 Cor", "1Cor", "1Co", "I Corinthians", "I Cor"],
  JHN: ["John", "Jhn", "Jn"],
  GEN: ["Genesis", "Gen", "Ge", "Gn"],
  SNG: ["Song of Solomon", "Song of Songs", "Song", "SOS", "So", "Canticles", "Cant"],
  "1SA": ["1 Samuel", "1 Sam", "1Sam", "1Sa", "I Samuel", "I Sam"],
  JUD: ["Jude", "Jud"],
  JDG: ["Judges", "Judg", "Jdg", "Jg"],
  PHP: ["Philippians", "Phil", "Php", "Pp"],
  PHM: ["Philemon", "Phlm", "Phm"],
};

function makeChapters(count: number, verseCount: number): number[] {
  return Array.from({ length: count }, () => verseCount);
}

const backbone: BackboneData = {
  version: "v1",
  books: {
    REV: { chapters: makeChapters(22, 25) },
    PSA: { chapters: makeChapters(150, 25) },
    "1CO": { chapters: makeChapters(16, 25) },
    JHN: { chapters: makeChapters(21, 25) },
    GEN: { chapters: makeChapters(50, 25) },
    // Real chapter counts (Protestant canon):
    SNG: { chapters: makeChapters(8, 25) }, // Song of Songs
    "1SA": { chapters: makeChapters(31, 25) }, // 1 Samuel
    JUD: { chapters: makeChapters(1, 25) }, // Jude
    JDG: { chapters: makeChapters(21, 25) }, // Judges
    PHP: { chapters: makeChapters(4, 25) }, // Philippians
    PHM: { chapters: makeChapters(1, 25) }, // Philemon
  },
};

test("parses 'Rev 14' as REV chapter 14", () => {
  const r = parsePassage("Rev 14", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
});

test("parses 'Revelation 14' as REV chapter 14", () => {
  const r = parsePassage("Revelation 14", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
});

test("parses 'Rev14' (no space) as REV chapter 14", () => {
  const r = parsePassage("Rev14", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
});

test("parses '1 Cor 13' as 1CO chapter 13", () => {
  const r = parsePassage("1 Cor 13", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "1CO", chapter: 13 });
});

test("parses 'Psalm 119' as PSA chapter 119", () => {
  const r = parsePassage("Psalm 119", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "PSA", chapter: 119 });
});

test("parses 'John 3:16' as JHN chapter 3 verse 16", () => {
  const r = parsePassage("John 3:16", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "JHN", chapter: 3, verse: 16 });
});

test("parses bare 'Revelation' as REV chapter 1", () => {
  const r = parsePassage("Revelation", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 1 });
});

test("rejects out-of-range chapter 'Rev 99'", () => {
  const r = parsePassage("Rev 99", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("rejects empty input", () => {
  const r = parsePassage("", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("rejects unknown book 'xyzzy 3'", () => {
  const r = parsePassage("xyzzy 3", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("is case-insensitive: 'rev 14' matches REV chapter 14", () => {
  const r = parsePassage("rev 14", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
});

test("out-of-range verse is silently ignored, chapter still navigates", () => {
  const r = parsePassage("John 3:999", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "JHN", chapter: 3 });
});

test("longer alias wins over shorter prefix ('1 Cor' vs nothing else colliding)", () => {
  const r = parsePassage("1Cor 13", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "1CO", chapter: 13 });
});

test("rejects malformed chapter text", () => {
  const r = parsePassage("Rev abc", bookNames, backbone);
  assert.equal(r.ok, false);
});

// --- Multi-word / roman-numeral-style aliases ---

test("parses 'Song of Songs 2' as SNG chapter 2", () => {
  const r = parsePassage("Song of Songs 2", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "SNG", chapter: 2 });
});

test("parses bare 'Song' as SNG chapter 1", () => {
  const r = parsePassage("Song", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "SNG", chapter: 1 });
});

test("parses '1 Samuel 3' as 1SA chapter 3", () => {
  const r = parsePassage("1 Samuel 3", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "1SA", chapter: 3 });
});

test("parses 'I Corinthians 13' as 1CO chapter 13", () => {
  const r = parsePassage("I Corinthians 13", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "1CO", chapter: 13 });
});

test("parses 'i cor 13' (lowercase roman-numeral alias) as 1CO chapter 13", () => {
  const r = parsePassage("i cor 13", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "1CO", chapter: 13 });
});

// --- Whitespace tolerance ---

test("parses 'Rev  14' (double space) as REV chapter 14", () => {
  const r = parsePassage("Rev  14", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
});

test("parses 'Rev 14 : 5' (spaces around colon) as REV chapter 14 verse 5", () => {
  const r = parsePassage("Rev 14 : 5", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14, verse: 5 });
});

test("parses '   Rev 14   ' (leading/trailing whitespace) as REV chapter 14", () => {
  const r = parsePassage("   Rev 14   ", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
});

// --- Chapter/verse boundary and malformed-numeral rejection ---

test("rejects chapter 0: 'Rev 0'", () => {
  const r = parsePassage("Rev 0", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("rejects a dangling colon with no verse digits: 'Rev 14:'", () => {
  const r = parsePassage("Rev 14:", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("'Rev 14:0' is ok, navigates to REV chapter 14 with no verse key (verse 0 is out of range)", () => {
  const r = parsePassage("Rev 14:0", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "REV", chapter: 14 });
  if (r.ok) {
    assert.equal("verse" in r.value, false);
  }
});

test("rejects a negative chapter: 'Rev -1'", () => {
  const r = parsePassage("Rev -1", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("rejects a decimal chapter: 'Rev 14.5'", () => {
  const r = parsePassage("Rev 14.5", bookNames, backbone);
  assert.equal(r.ok, false);
});

test("rejects a negative verse: 'Rev 14:-1'", () => {
  const r = parsePassage("Rev 14:-1", bookNames, backbone);
  assert.equal(r.ok, false);
});

// --- Prefix collisions (aliases verified against data/scripture/book-names-en.json) ---

test("parses 'Judg 3' as JDG chapter 3 (not confused with Judith/Jude)", () => {
  const r = parsePassage("Judg 3", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "JDG", chapter: 3 });
});

test("parses 'Phil 2' as PHP chapter 2 (not confused with Philemon)", () => {
  const r = parsePassage("Phil 2", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "PHP", chapter: 2 });
});

test("parses 'Phlm 1' as PHM chapter 1", () => {
  const r = parsePassage("Phlm 1", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "PHM", chapter: 1 });
});

test("parses 'Jude 1' as JUD chapter 1", () => {
  const r = parsePassage("Jude 1", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "JUD", chapter: 1 });
});

// 'Jud' is a real alias for JUD in data/scripture/book-names-en.json, so it
// is safe to assert here (not confused with 'Judges'/'Judg'/'Jdg').
test("parses bare short alias 'Jud 1' as JUD chapter 1", () => {
  const r = parsePassage("Jud 1", bookNames, backbone);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { book: "JUD", chapter: 1 });
});
