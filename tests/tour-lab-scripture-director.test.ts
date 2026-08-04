import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DIRECTOR_REFERENCE_MAX_VERSES,
  TRANSLATION,
  readPassage,
  resolveDirectorPassageReference,
  resolveDirectorPassageReferences,
} from "../lab/tour-lab/scripture.mjs";

function resolved(input: string) {
  const result = resolveDirectorPassageReference(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function refused(input: unknown, reason: string) {
  const result = resolveDirectorPassageReference(input);
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error(`expected ${String(input)} to be refused`);
  assert.equal(result.code, "DIRECTOR_REFERENCE_REFUSED");
  assert.equal(result.reason, reason);
  assert.equal(typeof result.message, "string");
  assert.ok(result.message.length > 0);
  return result;
}

test("director references resolve exact aliases and one-to-three canonical WEB verses", () => {
  assert.equal(DIRECTOR_REFERENCE_MAX_VERSES, 3);

  const single = resolved("JHN 3:16");
  assert.deepEqual(
    {
      ref: single.ref,
      book: single.book,
      bookName: single.bookName,
      chapter: single.chapter,
      fromVerse: single.fromVerse,
      toVerse: single.toVerse,
      translation: single.translation,
    },
    {
      ref: "John 3:16",
      book: "JHN",
      bookName: "John",
      chapter: 3,
      fromVerse: 16,
      toVerse: 16,
      translation: TRANSLATION,
    },
  );
  assert.deepEqual(single.verses.map((verse: { verse: number }) => verse.verse), [16]);
  assert.match(single.text, /^For God so loved the world/);

  const expected = readPassage({ book: "JHN", chapter: 3, fromVerse: 16, toVerse: 18 });
  assert.equal("error" in expected, false);
  const expectedText = expected.verses.map((verse: { text: string }) => verse.text).join(" ");
  for (const reference of ["John 3:16-18", "Jn 3:16–18", "JHN 3:16—18"]) {
    const range = resolved(reference);
    assert.equal(range.ref, "John 3:16–18");
    assert.deepEqual(range.verses.map((verse: { verse: number }) => verse.verse), [16, 17, 18]);
    assert.equal(range.text, expectedText);
    assert.match(range.text, /He who doesn’t believe has been judged already/);
  }

  assert.equal(resolved("John 3:16-16").ref, "John 3:16", "redundant one-verse ranges normalize to one verse");
});

test("director references refuse fuzzy books and malformed or unsafe ranges precisely", () => {
  refused("Jo 3:16", "unknown-book");
  refused("John 3", "unparsable-reference");
  refused("", "unparsable-reference");
  refused("John 3:36–4:1", "cross-chapter-range");
  refused("John 0:1", "invalid-chapter");
  refused("John 99:1", "invalid-chapter");
  refused("John 3:0", "invalid-verse");
  refused("John 3:18-16", "reversed-range");

  const wide = refused("John 3:16-19", "range-too-wide");
  assert.equal(wide.rangeSize, 4);
  assert.equal(wide.maxVerses, 3);

  refused("John 3:40", "range-out-of-bounds");
  const overshoot = refused("John 3:35-37", "range-out-of-bounds");
  assert.equal(overshoot.verseCount, 36);
});

test("strict resolution cannot inherit readPassage clamping", () => {
  const clampedZero = readPassage({ book: "John", chapter: 3, fromVerse: 0, toVerse: 2 });
  const clampedReverse = readPassage({ book: "John", chapter: 3, fromVerse: 18, toVerse: 16 });
  const clampedEnd = readPassage({ book: "John", chapter: 3, fromVerse: 35, toVerse: 37 });
  assert.deepEqual(clampedZero.verses.map((verse: { verse: number }) => verse.verse), [1, 2]);
  assert.deepEqual(clampedReverse.verses.map((verse: { verse: number }) => verse.verse), [18]);
  assert.deepEqual(clampedEnd.verses.map((verse: { verse: number }) => verse.verse), [35, 36]);

  refused("John 3:0-2", "invalid-verse");
  refused("John 3:18-16", "reversed-range");
  refused("John 3:35-37", "range-out-of-bounds");
});

test("director reference lists resolve atomically and preserve canonical order", () => {
  const accepted = resolveDirectorPassageReferences([
    "Isaiah 53:1-3",
    "John 12:38–40",
    "Romans 10:16—18",
  ]);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  if (!accepted.ok) throw new Error(accepted.message);
  assert.deepEqual(accepted.values.map((value: { ref: string }) => value.ref), [
    "Isaiah 53:1–3",
    "John 12:38–40",
    "Romans 10:16–18",
  ]);
  assert.ok(accepted.values.every((value: { text: string }) => value.text.length > 0));

  const rejected = resolveDirectorPassageReferences([
    "Isaiah 53:1-3",
    "John 12:38-42",
    "Romans 10:16-18",
  ]);
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw new Error("expected the list to be refused");
  assert.equal(rejected.index, 1);
  assert.equal(rejected.code, "DIRECTOR_REFERENCE_REFUSED");
  assert.equal(rejected.reason, "range-too-wide");
  assert.equal("values" in rejected, false, "a rejected list exposes no partial canonical result");

  const malformed = resolveDirectorPassageReferences("John 3:16");
  assert.equal(malformed.ok, false);
  if (malformed.ok) throw new Error("expected a non-array list to be refused");
  assert.equal(malformed.reason, "invalid-reference-list");
});
