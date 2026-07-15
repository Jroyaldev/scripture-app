import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  duplicateSenseNumbers,
  formatBdbDefinition,
  formatStrongDefinition,
  formatThayerDefinition,
  parseBdbSenses,
} from "../src/core/importer/strongs-plus.js";

describe("formatStrongDefinition", () => {
  it("extracts first sense and full English from StrongsPlus-style plain text", () => {
    const plain = [
      "àá",
      "'âb",
      "awb",
      'A primitive word; father in a literal and immediate, or figurative and remote application: - chief, (fore-) father ([-less]), X patrimony, principal. Compare names in "Abi-"',
      "",
      "LXX related word(s)",
      " G3962 pater, patros",
    ].join("\n");
    const d = formatStrongDefinition("H1", plain);
    assert.ok(d);
    assert.equal(d!.id, "H1");
    assert.match(d!.firstSense, /chief|father/i);
    assert.match(d!.full, /father in a literal/i);
    assert.ok(!d!.full.includes("LXX"));
    assert.equal(d!.source, "Strong's");
  });

  it("handles Greek G25 love entry", () => {
    const plain = [
      "garbage",
      "agapaō",
      "ag-ap-ah'-o",
      "Perhaps from agan (much); to love (in a social or moral sense): - (be-) love (-ed). Compare G5368.",
      "",
      "LXX related word(s)",
      " H157 ahab",
    ].join("\n");
    const d = formatStrongDefinition("G25", plain, "Strong's");
    assert.ok(d);
    assert.match(d!.firstSense, /love/i);
    assert.match(d!.full, /to love/i);
    assert.equal(d!.xlit, "agapaō");
  });
});

describe("lexicon sense integrity", () => {
  it("omits Thayer senses when a nested list repeats a top-level number", () => {
    const definition = formatThayerDefinition(
      "G4054",
      "- Definition:\n1. exceeding measure\na. over and above\n1. abundantly\n2. further",
    );
    assert.ok(definition);
    assert.equal(definition!.senses, undefined);
  });

  it("reports duplicate BDB raw n values and omits the malformed pill data", () => {
    const plain = [
      "BDB Definition:",
      "1) to pitch a tent",
      "1a) (Qal) pitch a tent",
      "1a) (Piel) pitch one's tent",
    ].join("\n");
    const raw = parseBdbSenses(plain);
    assert.deepEqual(duplicateSenseNumbers(raw), ["1a"]);
    const definition = formatBdbDefinition("H167", plain);
    assert.ok(definition);
    assert.equal(definition!.senses, undefined);
    assert.match(definition!.full, /Piel/);
  });
});
