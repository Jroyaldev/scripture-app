import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accumulateReverseIndex,
  buildReverseOrbitDetailed,
  finalizeReverseIndex,
  filterReverseEntriesForOrbit,
  normalizeEnglishWord,
  topWords,
  resolveReverseIndexPackage,
  type AlignmentVerseIn,
} from "../src/core/language/reverse-index.js";
import { donutSegmentPath } from "../src/core/language/rendering-orbit.js";
import { parseThayerSenses } from "../src/core/importer/strongs-plus.js";

describe("normalizeEnglishWord", () => {
  it("lowercases and strips punctuation", () => {
    assert.equal(normalizeEnglishWord("Love!"), "love");
    assert.equal(normalizeEnglishWord("  God's  "), "god's");
    assert.equal(normalizeEnglishWord("In the beginning,"), "in the beginning");
  });
});

describe("reverse-index build", () => {
  const verses: AlignmentVerseIn[] = [
    {
      book: "JHN",
      chapter: 3,
      verse: 16,
      tokens: [
        { word: "loved", strongs: ["G25"] },
        { word: "God", strongs: ["G2316"] },
        { word: "world", strongs: ["G2889"] },
      ],
    },
    {
      book: "GEN",
      chapter: 1,
      verse: 1,
      tokens: [
        { word: "God", strongs: ["H430"] },
        { word: "created", strongs: ["H1254"] },
      ],
    },
    {
      book: "1JN",
      chapter: 4,
      verse: 8,
      tokens: [
        { word: "Love", strongs: ["G26"] },
        { word: "God", strongs: ["G2316"] },
      ],
    },
    {
      book: "GEN",
      chapter: 29,
      verse: 20,
      tokens: [{ word: "love", strongs: ["H160"] }],
    },
  ];

  it("counts by lowercase key and aggregates strongs", () => {
    const { words, tokenCount } = accumulateReverseIndex(verses);
    const file = finalizeReverseIndex("test", "test.jsonl", words, tokenCount);
    assert.ok(file.words["god"]);
    const god = file.words["god"]!;
    assert.ok(god.some((s) => s.strongs === "G2316" && s.count === 2));
    assert.ok(god.some((s) => s.strongs === "H430" && s.count === 1));
    assert.ok(file.words["love"]);
    const love = file.words["love"]!;
    assert.ok(love.some((s) => s.strongs === "G26"));
    assert.ok(love.some((s) => s.strongs === "H160"));
    // "loved" is a different key (no stemming)
    assert.ok(file.words["loved"]?.some((s) => s.strongs === "G25"));
    assert.equal(tokenCount, file.meta.tokenCount);
  });

  it("topWords ranks by total", () => {
    const { words, tokenCount } = accumulateReverseIndex(verses);
    const file = finalizeReverseIndex("test", "x", words, tokenCount);
    const top = topWords(file, 5);
    assert.equal(top[0]!.word, "god");
    assert.equal(top[0]!.total, 3);
  });

  it("buildReverseOrbitDetailed marks current and keeps full ring for single lemma", () => {
    const orbit = buildReverseOrbitDetailed({
      englishWord: "light",
      key: "light",
      packageId: "bsb",
      entries: [{ strongs: "H216", count: 42 }],
      currentStrong: "H216",
      labelForStrong: (s) => (s === "H216" ? "אוֹר" : s),
    });
    assert.ok(orbit);
    assert.equal(orbit!.segments.length, 1);
    assert.equal(orbit!.segments[0]!.share, 1);
    assert.equal(orbit!.segments[0]!.label, "אוֹר");
    assert.equal(orbit!.segments[0]!.isCurrent, true);
    assert.equal(orbit!.segments[0]!.strongs, "H216");
    assert.equal(orbit!.scopeHint, "whole Bible · BSB");
  });

  it("drops only singleton bands below one percent when building a ring", () => {
    assert.deepEqual(
      filterReverseEntriesForOrbit([
        { strongs: "G25", count: 198 },
        { strongs: "G2532", count: 1 },
      ]),
      [{ strongs: "G25", count: 198 }],
    );
    assert.deepEqual(
      filterReverseEntriesForOrbit([
        { strongs: "G25", count: 99 },
        { strongs: "G2532", count: 1 },
      ]),
      [
        { strongs: "G25", count: 99 },
        { strongs: "G2532", count: 1 },
      ],
    );
  });

  it("resolveReverseIndexPackage prefers BSB except for active AKJV", () => {
    assert.equal(resolveReverseIndexPackage("web"), "bsb");
    assert.equal(resolveReverseIndexPackage("ylt"), "bsb");
    assert.equal(resolveReverseIndexPackage("kjv"), "bsb");
    assert.equal(resolveReverseIndexPackage("bsb"), "bsb");
    assert.equal(resolveReverseIndexPackage(undefined), "bsb");
    assert.equal(resolveReverseIndexPackage("akjv-strongs"), "akjv-strongs");
  });

  it("same-testament bands lead, then Other (n) casing", () => {
    const orbit = buildReverseOrbitDetailed({
      englishWord: "love",
      key: "love",
      packageId: "bsb",
      preferTestament: "G",
      entries: [
        { strongs: "H157", count: 100 },
        { strongs: "G25", count: 50 },
        { strongs: "G26", count: 40 },
        { strongs: "H160", count: 30 },
        { strongs: "G5368", count: 5 },
        { strongs: "H2617", count: 4 },
        { strongs: "G1", count: 3 },
        { strongs: "H2", count: 2 },
        { strongs: "G3", count: 2 },
        { strongs: "H4", count: 2 },
      ],
      labelForStrong: (s) => s,
    });
    assert.ok(orbit);
    // First bands should be Greek (prefer G)
    assert.ok(orbit!.segments[0]!.strongs?.startsWith("G"));
    const other = orbit!.segments.find((s) => s.strongs === null);
    assert.ok(other);
    assert.match(other!.label, /^Other \(/);
  });
});

describe("orbit full-circle SVG path (single-lemma reverse ring)", () => {
  it("does not emit a degenerate single-arc for a full sweep", () => {
    const path = donutSegmentPath(74, 74, 64, 36, 0, Math.PI * 2);
    // Two half-arcs: path should contain two outer arcs (two "A 64" runs at least)
    const arcs = path.match(/A 64 64/g) ?? [];
    assert.ok(arcs.length >= 2, `expected two half-arcs, got path: ${path}`);
    assert.ok(path.length > 40);
  });
});

describe("parseThayerSenses", () => {
  it("emits senses for clean 1. 2. structure", () => {
    const plain = [
      "λόγος, ου, ὁ",
      "I. As respects speech:",
      "1. a word, yet not in the grammatical sense",
      "2. a saying; of the sayings of God",
      "3. discourse",
    ].join("\n");
    const senses = parseThayerSenses(plain);
    assert.equal(senses.length, 3);
    assert.equal(senses[0]!.n, "1");
    assert.match(senses[0]!.text, /word/i);
    assert.match(senses[0]!.label ?? "", /word/i);
  });

  it("turns structural first lines into complete, readable display sentences", () => {
    const senses = parseThayerSenses([
      "1. properly,",
      "",
      "a. with the names of things made, to produce, construct, form, fashion: Act_1:1",
      "2. metaphorically,",
      "",
      "a. of Christ's invisible return from heaven, i. e. of his power: Joh_14:18",
    ].join("\n"));
    assert.deepEqual(senses, [
      { n: "1", label: "Produce, construct, form, fashion", text: "To produce, construct, form, fashion." },
      { n: "2", label: "Christ's invisible return from heaven", text: "Of Christ's invisible return from heaven." },
    ]);
  });

  it("uses Roman semantic heads instead of their numbered children", () => {
    const senses = parseThayerSenses([
      "I. to take, i. e.:",
      "1. to take with the hand",
      "2. to carry away",
      "II. to receive (what is given); to gain, get, obtain: Rom_1:5",
    ].join("\n"));
    assert.equal(senses.length, 2);
    assert.deepEqual(senses.map((sense) => sense.n), ["1", "2"]);
    assert.equal(senses[0]!.label, "Take");
    assert.equal(senses[0]!.text, "To take.");
    assert.equal(senses[1]!.label, "Receive");
    assert.match(senses[1]!.text, /^To receive/);
  });

  it("never caps a Thayer display in the middle of a word or reference", () => {
    const long = `to receive: ${"supporting explanation ".repeat(30)}Joh_6:55.`;
    const senses = parseThayerSenses(`1. ${long}\n2. to carry away: Mat_8:17.`);
    assert.equal(senses.length, 2);
    assert.ok(!senses[0]!.text.endsWith("…"));
    assert.ok(!senses[0]!.label!.endsWith("Joh_6"));
    assert.match(senses[0]!.text, /\.$/);
  });

  it("returns empty when only a single numbered sense", () => {
    const plain = "ἀγάπη, ης, ἡ, affection.\n1. affection, good-will, love";
    assert.equal(parseThayerSenses(plain).length, 0);
  });

  it("returns empty when numbering does not start at 1", () => {
    assert.equal(parseThayerSenses("2. something\n3. else").length, 0);
  });

  it("returns empty for duplicate top-level numbers", () => {
    const malformed = [
      "- Definition:",
      "1. exceeding some number or measure",
      "a. over and above",
      "1. exceeding abundantly",
      "2. something further",
    ].join("\n");
    assert.deepEqual(parseThayerSenses(malformed), []);
  });
});
