import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explainMorphCode,
  kindForMorphLabel,
  lookupStrongGloss,
  orderMorphParts,
  parseStrongGlossJson,
  visibleMorphParts,
  MORPH_CHIP_VISIBLE_MAX,
} from "../src/core/language/index.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("explainMorphCode Hebrew HVqp3ms is pastor-readable", () => {
  const ex = explainMorphCode("HVqp3ms", { language: "hbo" });
  assert.ok(ex);
  assert.equal(ex!.language, "hebrew");
  assert.ok(ex!.parts.some((p) => p.label === "qal"));
  assert.ok(ex!.parts.some((p) => p.label === "perfect"));
  const perfect = ex!.parts.find((p) => p.label === "perfect");
  assert.ok(perfect?.meaning.toLowerCase().includes("complete"));
  assert.equal(perfect?.kind, "tense");
  assert.equal(perfect?.unknown, undefined);
});

test("explainMorphCode Greek V-FPI-3P", () => {
  const ex = explainMorphCode("V-FPI-3P", { language: "grc" });
  assert.ok(ex);
  assert.equal(ex!.language, "greek");
  assert.ok(ex!.parts.some((p) => p.label === "future"));
  assert.ok(ex!.parts.some((p) => p.label === "passive"));
  assert.equal(ex!.parts[0]!.kind, "pos");
  assert.equal(ex!.parts[0]!.label, "verb");
  assert.ok(!ex!.parts.some((p) => p.unknown));
});

test("parts are ordered POS before person/number", () => {
  const ex = explainMorphCode("V-FPI-3P", { language: "grc" });
  assert.ok(ex);
  const kinds = ex!.parts.map((p) => p.kind);
  assert.ok(kinds.indexOf("pos") < kinds.indexOf("tense"));
  assert.ok(kinds.indexOf("tense") < kinds.indexOf("person"));
});

test("kindForMorphLabel classifies stems and cases", () => {
  assert.equal(kindForMorphLabel("hiphil"), "stem");
  assert.equal(kindForMorphLabel("genitive"), "case");
  assert.equal(kindForMorphLabel("construct"), "state");
});

test("unknown label is flagged for correction", () => {
  const ex = explainMorphCode("V-FPI-3P", {
    language: "grc",
    labels: ["verb", "not-a-real-feature"],
  });
  assert.ok(ex);
  const bad = ex!.parts.find((p) => p.label === "not-a-real-feature");
  assert.ok(bad?.unknown);
  assert.match(bad!.meaning, /not yet in our gloss table/i);
});

test("visibleMorphParts caps closed chips", () => {
  const ex = explainMorphCode("V-FPI-3P", { language: "grc" });
  assert.ok(ex);
  // Force many parts
  const many = orderMorphParts([
    ...ex!.parts,
    { label: "masculine", meaning: "…", kind: "gender" as const },
    { label: "nominative", meaning: "…", kind: "case" as const },
    { label: "comparative", meaning: "…", kind: "degree" as const },
  ]);
  const { visible, overflow } = visibleMorphParts(many, MORPH_CHIP_VISIBLE_MAX);
  assert.equal(visible.length, MORPH_CHIP_VISIBLE_MAX);
  assert.ok(overflow >= 1);
  assert.equal(visible[0]!.kind, "pos");
});

test("Strong's Hebrew gloss map loads short strip labels", () => {
  const path = resolve(__dirname, "../data/scripture/lexicons/strongs-hebrew-gloss.json");
  const map = parseStrongGlossJson(readFileSync(path, "utf8"));
  assert.ok(map.size > 8000);
  const bara = lookupStrongGloss(map, "H1254");
  assert.ok(bara?.gloss);
  assert.match((bara!.short ?? bara!.gloss).toLowerCase(), /create/);
  const reshit = lookupStrongGloss(map, "H7225");
  assert.equal(reshit?.short, "beginning");
  const elohim = lookupStrongGloss(map, "H430");
  assert.equal(elohim?.short, "God");
});
