import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildTokenIndex,
  parseHebrewMorphCode,
  parseOshbLemma,
  parseOshbOsisBook,
  parseOsisVerseId,
} from "../src/core/language/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/oshb-gen1-sample.xml");

test("parseOsisVerseId maps Gen.1.1 to GEN", () => {
  assert.deepEqual(parseOsisVerseId("Gen.1.1"), { book: "GEN", chapter: 1, verse: 1 });
  assert.deepEqual(parseOsisVerseId("1Sam.2.3"), { book: "1SA", chapter: 2, verse: 3 });
  assert.equal(parseOsisVerseId("nope"), null);
});

test("parseOshbLemma extracts Strong's from compound lemmas", () => {
  assert.deepEqual(parseOshbLemma("b/7225"), { strong: "7225", lemmaKey: "b/7225" });
  assert.deepEqual(parseOshbLemma("1254 a"), { strong: "1254", lemmaKey: "1254 a" });
  assert.deepEqual(parseOshbLemma("c/d/776"), { strong: "776", lemmaKey: "c/d/776" });
});

test("parseHebrewMorphCode expands HVqp3ms", () => {
  const { labels, features } = parseHebrewMorphCode("HVqp3ms");
  assert.equal(features.pos, "verb");
  assert.ok(labels.includes("verb"));
  assert.ok(labels.includes("qal"));
  assert.ok(labels.includes("perfect"));
  assert.ok(labels.includes("3rd person"));
  assert.ok(labels.includes("masculine"));
  assert.ok(labels.includes("singular"));
});

test("parseOshbOsisBook imports Gen 1:1 fixture", () => {
  const xml = readFileSync(FIXTURE, "utf8");
  const result = parseOshbOsisBook(xml);
  assert.equal(result.stats.parsed, 7);
  assert.deepEqual(result.stats.books, ["GEN"]);

  const bara = result.tokens.find((t) => t.id === "01Nvk");
  assert.ok(bara);
  assert.equal(bara.surface, "בָּרָ֣א");
  assert.equal(bara.lemma, "1254 a");
  assert.equal(bara.strong, "1254");
  assert.equal(bara.strongPrefixed, "H1254");
  assert.equal(bara.morphCode, "HVqp3ms");
  assert.equal(bara.morph.pos, "verb");
  assert.equal(bara.book, "GEN");
  assert.equal(bara.chapter, 1);
  assert.equal(bara.verse, 1);

  const index = buildTokenIndex(result.tokens);
  assert.equal(tokensForVerseSafe(index, "GEN", 1, 1).length, 7);
});

function tokensForVerseSafe(
  index: ReturnType<typeof buildTokenIndex>,
  book: string,
  chapter: number,
  verse: number,
) {
  return index.byVerse.get(`${book}.${chapter}.${verse}`) ?? [];
}
