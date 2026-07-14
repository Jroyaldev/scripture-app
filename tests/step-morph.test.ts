import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  StepMorphIndex,
  parseStepFullTable,
} from "../src/core/language/step-morph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const morphDir = resolve(__dirname, "../data/scripture/morph");

test("parseStepFullTable finds V-FPI-3P with phrase and explanation", () => {
  const text = readFileSync(resolve(morphDir, "TEGMC-STEPBible-CC-BY.txt"), "utf8");
  const entries = parseStepFullTable(text, "STEPBible TEGMC");
  const hit = entries.find((e) => e.code === "V-FPI-3P");
  assert.ok(hit, "V-FPI-3P should parse");
  assert.match(hit!.phrase, /Future/i);
  assert.match(hit!.phrase, /Passive/i);
  assert.ok(hit!.explanation.length > 10);
  assert.equal(hit!.source, "STEPBible TEGMC");
});

test("parseStepFullTable finds Hebrew HVqp3ms", () => {
  const text = readFileSync(resolve(morphDir, "TEHMC-STEPBible-CC-BY.txt"), "utf8");
  const entries = parseStepFullTable(text, "STEPBible TEHMC");
  const hit = entries.find((e) => e.code === "HVqp3ms");
  assert.ok(hit, "HVqp3ms should parse");
  assert.match(hit!.phrase, /Qal/i);
});

test("StepMorphIndex lookup is case-tolerant and returns null for miss", () => {
  const index = new StepMorphIndex();
  const greek = readFileSync(resolve(morphDir, "TEGMC-STEPBible-CC-BY.txt"), "utf8");
  index.loadTable(greek, "STEPBible TEGMC");
  assert.ok(index.size > 500);
  const a = index.lookup("V-FPI-3P");
  const b = index.lookup("v-fpi-3p");
  assert.ok(a);
  assert.equal(a!.code, b!.code);
  assert.equal(index.lookup("NOT-A-REAL-CODE-XYZ"), null);
});

test("Greek strip trailing superlative -S before STEP lookup", () => {
  const index = new StepMorphIndex();
  index.loadTable(
    readFileSync(resolve(morphDir, "TEGMC-STEPBible-CC-BY.txt"), "utf8"),
    "STEPBible TEGMC",
  );
  // MACULA often tags superlative with trailing -S not always in TEGMC
  const hit = index.lookup("A-NPM-S");
  const base = index.lookupExact("A-NPM");
  if (base) {
    assert.ok(hit, "A-NPM-S should fall back to A-NPM when base exists");
  }
});

test("Hebrew composite re-prefixes last segment HC/Ncmpc → HNcmpc", () => {
  const index = new StepMorphIndex();
  index.loadTable(
    readFileSync(resolve(morphDir, "TEHMC-STEPBible-CC-BY.txt"), "utf8"),
    "STEPBible TEHMC",
  );
  const exact = index.lookupExact("HNcmpc");
  assert.ok(exact, "fixture expects HNcmpc in TEHMC");
  const composite = index.lookup("HC/Ncmpc");
  assert.ok(composite, "composite should resolve via last segment re-prefix");
  assert.equal(composite!.phrase, exact!.phrase);
});

test("Hebrew proper name HNp gets deterministic stub", () => {
  const index = new StepMorphIndex();
  index.loadTable(
    readFileSync(resolve(morphDir, "TEHMC-STEPBible-CC-BY.txt"), "utf8"),
    "STEPBible TEHMC",
  );
  const stub = index.lookup("HNp");
  assert.ok(stub);
  assert.match(stub!.phrase, /proper name/i);
});
