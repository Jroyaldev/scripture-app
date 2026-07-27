/**
 * Reading a publisher's stated references out of their own prose.
 *
 * The scanner exists because BibleProject tags its episodes with passages and
 * titles them with themes, so the coordinates are there to be read and the
 * title is a trap. The tests below are mostly about the trap: a scanner that
 * finds references in sentences is one bad alias away from inventing them, and
 * an invented one is not a near miss — it is a card a reader opens *from a
 * passage*, having trusted that the passage is what the card is about.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { extractStatedReferences } from "../src/core/resources/scripture-scan.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const root = resolve(import.meta.dirname, "..");
const backbone = JSON.parse(readFileSync(resolve(root, "data/scripture/backbone.json"), "utf8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(resolve(root, "data/scripture/book-names-en.json"), "utf8")) as BookNameMap;

const scan = (text: string): string[] =>
  extractStatedReferences(text, bookNames, backbone).map((bref) => bref.replace("bref:v1/", ""));

test("the four shapes a publisher writes are all read", () => {
  assert.deepEqual(scan("Exodus 20:1-2"), ["EXO.20.1-EXO.20.2"]);
  assert.deepEqual(scan("Micah 6:8"), ["MIC.6.8"]);
  assert.deepEqual(scan("Genesis 11:27-12:4"), ["GEN.11.27-GEN.12.4"]);

  // A chapter is expanded to the length the backbone actually gives it, not to
  // a guess and not to the whole book.
  assert.deepEqual(scan("Exodus 16"), ["EXO.16.1-EXO.16.36"]);
  assert.deepEqual(scan("Deuteronomy 12-26"), ["DEU.12.1-DEU.26.19"]);

  // "Philippians chapter 2" is the same claim as "Philippians 2"; publishers
  // write both and there is no reason to read only one.
  assert.deepEqual(scan("Philippians chapter 2"), scan("Philippians 2"));
});

test("a colon is the whole difference between a chapter run and a verse", () => {
  // One character apart, two different claims. If these ever agree, the
  // expansion branch has swallowed the verse branch.
  assert.deepEqual(scan("Genesis 1-2"), ["GEN.1.1-GEN.2.25"]);
  assert.deepEqual(scan("Genesis 1:2"), ["GEN.1.2"]);
});

test("abbreviations are never read out of prose, because they are also words", () => {
  /* Every one of these is a real alias in our name map, and every one of them
     is also an ordinary word or a person's name. These are not hypothetical:
     the first two are the actual output of running a title parser over
     BibleProject's catalogue, and `Jon` is the name of one of the two men
     talking on every episode of it. */
  assert.deepEqual(scan("What Forgiveness Is and Isn't (The Lord's Prayer Pt. 4)"), [],
    "`Is` was read as Isaiah");
  assert.deepEqual(scan("The Dragon of Revelation – Chaos Dragon E18"), [],
    "an episode number was read as a chapter");
  assert.deepEqual(scan("Tim and Jon 5 discuss the theme"), [],
    "`Jon` was read as Jonah");
  assert.deepEqual(scan("Act 2 of the play"), [],
    "`Act` was read as Acts");
  assert.deepEqual(scan("So 3 things follow"), [], "`So` was read as Song of Solomon");
  assert.deepEqual(scan("Re 4 of the series"), [], "`Re` was read as Revelation");

  // The spelled-out names still work, which is the point of the trade.
  assert.deepEqual(scan("Isaiah 4"), ["ISA.4.1-ISA.4.6"]);
  assert.deepEqual(scan("Jonah 1"), ["JON.1.1-JON.1.17"]);
  assert.deepEqual(scan("Acts 15"), ["ACT.15.1-ACT.15.41"]);
});

test("a coordinate the backbone rejects is dropped rather than repaired", () => {
  // A publisher's typo is not a coordinate. Silence is the only safe answer,
  // because the alternative is inventing a passage to stand in for one that
  // does not exist.
  assert.deepEqual(scan("Genesis 99:1"), []);
  assert.deepEqual(scan("Genesis 99"), []);
  assert.deepEqual(scan("Romans 8:99"), []);
  assert.deepEqual(scan("Obadiah 2"), [], "Obadiah has one chapter");
});

test("a real reference list reads end to end, deduplicated, in order", () => {
  // Lifted from the publisher's own Scripture References block on
  // bibleproject.com/podcasts/purpose-law/.
  const stated = [
    "Exodus 16", "Deuteronomy 12-26", "Exodus 20:1-2", "Exodus 20:3",
    "Deuteronomy 6:4-9", "Micah 6:8", "Acts 15", "Exodus 16",
  ];
  assert.deepEqual(scan(stated.join(" ")), [
    "EXO.16.1-EXO.16.36",
    "DEU.12.1-DEU.26.19",
    "EXO.20.1-EXO.20.2",
    "EXO.20.3",
    "DEU.6.4-DEU.6.9",
    "MIC.6.8",
    "ACT.15.1-ACT.15.41",
  ]);
});
