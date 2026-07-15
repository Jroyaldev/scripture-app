import assert from "node:assert/strict";
import { test } from "node:test";
import {
  searchScriptureDocuments,
  type ScriptureSearchDocument,
} from "../src/core/search/scripture-search.js";

const documents: ScriptureSearchDocument[] = [
  { book: "JHN", chapter: 3, verse: 16, text: "For God so loved the world, that He gave His one and only Son", order: 1 },
  { book: "ROM", chapter: 5, verse: 8, text: "But God proves His love for us in this", order: 2 },
  { book: "1CO", chapter: 13, verse: 4, text: "Love is patient, love is kind", order: 3 },
  { book: "ACT", chapter: 19, verse: 1, text: "Paul passed through the interior and came to Ephesus", order: 4 },
];

test("Scripture search ranks phrases ahead of loose terms", () => {
  const results = searchScriptureDocuments(documents, "love is patient", { limit: 4 });
  assert.equal(results[0]?.book, "1CO");
  assert.equal(results[0]?.matchKind, "phrase");
});

test("Scripture search handles natural question words and light inflection", () => {
  const results = searchScriptureDocuments(documents, "where does God love the world", { limit: 4 });
  assert.equal(results[0]?.book, "JHN");
  assert.equal(results[0]?.chapter, 3);
  assert.equal(results[0]?.verse, 16);
});

test("Scripture search uses reading context only as a tie breaker", () => {
  const results = searchScriptureDocuments(documents, "love", {
    currentBook: "1CO",
    currentChapter: 13,
  });
  assert.equal(results[0]?.book, "1CO");
  assert.ok(results.some((result) => result.book === "JHN"));
});
