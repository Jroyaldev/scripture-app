import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  TipnrIndex,
  tokenLooksLikeProperName,
  formatTipnrDisplayName,
} from "../src/core/language/tipnr.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "../data/scripture/names/tipnr-index.json");

test("TIPNR index resolves John Baptist at MAT 3:1 not the Apostle", () => {
  assert.ok(existsSync(indexPath), "run npx tsx scripts/import-tipnr.ts first");
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));
  assert.ok(idx.entityCount > 1000);

  const hit = idx.resolve({
    book: "MAT",
    chapter: 3,
    verse: 1,
    strong: "G2491",
    nameHint: "John",
  });
  assert.ok(hit);
  assert.match(hit!.entity.brief + hit!.entity.displayName, /Baptist|prophet|John/i);
  assert.ok(
    /Baptist|prepared the way|prophet/i.test(hit!.entity.brief + (hit!.entity.short ?? "")),
    `expected Baptist-ish brief, got: ${hit!.entity.brief}`,
  );

  const apostle = idx.resolve({
    book: "MAT",
    chapter: 4,
    verse: 21,
    strong: "G2491",
    nameHint: "John",
  });
  assert.ok(apostle);
  assert.notEqual(hit!.entity.id, apostle!.entity.id);
  assert.match(
    apostle!.entity.brief + (apostle!.entity.short ?? ""),
    /apostle|Zebedee|disciple/i,
  );
});

test("tokenLooksLikeProperName detects HNp and Greek proper", () => {
  assert.equal(tokenLooksLikeProperName({ morphCode: "HNp" }), true);
  assert.equal(tokenLooksLikeProperName({ wordType: "proper", morphCode: "N-NSM" }), true);
  assert.equal(tokenLooksLikeProperName({ morphCode: "V-AAI-3S", wordType: "common" }), false);
});

test("formatTipnrDisplayName softens machine ids", () => {
  assert.equal(formatTipnrDisplayName("Olives_Mount"), "Mount of Olives");
  assert.equal(formatTipnrDisplayName("Mary_Magdalene"), "Mary Magdalene");
  assert.equal(formatTipnrDisplayName("Moab_Plains"), "Plains of Moab");
  assert.equal(formatTipnrDisplayName("Halak_Mount"), "Mount Halak");
  assert.equal(formatTipnrDisplayName("Jesus"), "Jesus");
});

test("TIPNR covers people and places across OT and NT", () => {
  assert.ok(existsSync(indexPath), "run npx tsx scripts/import-tipnr.ts first");
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));
  assert.ok(idx.entityCount >= 4000, `expected full TIPNR set, got ${idx.entityCount}`);

  const jesus = idx.resolve({
    book: "ACT",
    chapter: 19,
    verse: 10,
    strong: "G2424",
    nameHint: "Jesus",
  });
  assert.ok(jesus);
  assert.equal(jesus!.entity.displayName, "Jesus");
  assert.match(jesus!.match, /strong|ref/);

  const moses = idx.resolve({
    book: "EXO",
    chapter: 2,
    verse: 10,
    strong: "H4872",
    nameHint: "Moses",
  });
  assert.ok(moses);
  assert.equal(moses!.entity.displayName, "Moses");
  assert.equal(moses!.entity.kind, "person");

  const jerusalem = idx.resolve({
    book: "REV",
    chapter: 21,
    verse: 2,
    strong: "G2419",
    nameHint: "Jerusalem",
  });
  assert.ok(jerusalem);
  assert.equal(jerusalem!.entity.displayName, "Jerusalem");
  assert.equal(jerusalem!.entity.kind, "place");

  const goliath = idx.resolve({
    book: "1SA",
    chapter: 17,
    verse: 4,
    strong: "H1555",
    nameHint: "Goliath",
  });
  assert.ok(goliath);
  assert.equal(goliath!.entity.displayName, "Goliath");
});
