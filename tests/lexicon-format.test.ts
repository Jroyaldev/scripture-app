import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBdbDefinition, formatThayerDefinition } from "../src/core/importer/strongs-plus.js";
import { parseEswordRtf } from "../src/core/importer/rtf.js";

describe("Thayer CP1253 Greek", () => {
  it("decodes ἀγάπη (G26) head with windows-1253 hex bytes", () => {
    // Minimal RTF: unicode ἀ + CP1253 γάπη
    const raw = "\\u7936?\\'e3\\'dc\\'f0\\'e7, (\\'e7\\'f2";
    const plain = parseEswordRtf(raw, { hexEncoding: "cp1253" }).text;
    assert.match(plain, /ἀγάπη/);
  });

  it("decodes Θεός (G2316) with cp1253", () => {
    const raw = "\\'c8\\'e5\\'fc\\'f2, \\'c8\\'e5\\'ef";
    const plain = parseEswordRtf(raw, { hexEncoding: "cp1253" }).text;
    assert.match(plain, /Θεός/);
  });

  it("formatThayer keeps Greek in full body", () => {
    const plain =
      "ἀγάπη, (ης, ἡ, a purely Biblical and ecclesiastical word… to love in the Christian sense.";
    const d = formatThayerDefinition("G26", plain);
    assert.ok(d);
    assert.match(d!.full, /ἀγάπη/);
    assert.equal(d!.source, "Thayer");
  });

  it("preserves the complete Thayer article instead of imposing a 4k cap", () => {
    const longBody = `ἀγάπη, ${"complete source prose ".repeat(260)}`;
    const d = formatThayerDefinition("G26", longBody);
    assert.ok(d);
    assert.equal(d!.full, longBody.trim());
    assert.ok(!d!.full.endsWith("…"));
  });
});

describe("BDB sense structure", () => {
  it("emits numbered senses without flattening", () => {
    const plain = [
      "rê'shı̂yth",
      "BDB Definition:",
      "1) first, beginning, best, chief",
      "1a) beginning",
      "1b) first",
      "1c) chief",
      "1d) choice part",
      "Part of Speech: noun feminine",
      "Total KJV Occurrences: 53",
      "beginning, 18",
      "Gen_1:1 (2)",
    ].join("\n");
    const d = formatBdbDefinition("H7225", plain);
    assert.ok(d);
    assert.ok(d!.senses);
    assert.equal(d!.senses!.length, 5);
    assert.equal(d!.senses![0]!.n, "1");
    assert.equal(d!.senses![0]!.text, "first, beginning, best, chief");
    assert.equal(d!.senses![1]!.n, "1a");
    assert.match(d!.full, /1\) first/);
    assert.ok(!d!.full.includes("Total KJV"));
    assert.equal(d!.firstSense, "first, beginning, best, chief");
  });
});
