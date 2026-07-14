import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRenderingOrbit,
  normalizeOrbitGloss,
  stemEnglishToken,
  isFunctionWordForOrbit,
  donutSegmentPath,
} from "../src/core/language/rendering-orbit.js";

test("normalizeOrbitGloss strips brackets and articles", () => {
  assert.equal(normalizeOrbitGloss("[The] book"), "book");
  assert.equal(normalizeOrbitGloss("of [the] genealogy"), "genealogy");
  assert.equal(normalizeOrbitGloss("-"), null);
  assert.equal(normalizeOrbitGloss(null), null);
});

test("normalizeOrbitGloss merges king/kings/king’s like Logos", () => {
  assert.equal(normalizeOrbitGloss("king"), "king");
  assert.equal(normalizeOrbitGloss("kings"), "king");
  assert.equal(normalizeOrbitGloss("king's"), "king");
  assert.equal(normalizeOrbitGloss("perfected"), "perfect");
  assert.equal(normalizeOrbitGloss("perfectly"), "perfect");
});

test("stemEnglishToken handles common inflections", () => {
  assert.equal(stemEnglishToken("words"), "word");
  assert.equal(stemEnglishToken("accomplished"), "accomplish");
  assert.equal(stemEnglishToken("sons"), "son");
});

test("buildRenderingOrbit sizes segments by gloss frequency", () => {
  const glosses: Record<string, string> = {
    a: "love",
    b: "love",
    c: "Love",
    d: "beloved",
    e: "charity",
    f: "of love",
  };
  const orbit = buildRenderingOrbit({
    lemma: "ἀγάπη",
    strongPrefixed: "G26",
    lemmaCount: 6,
    tokenIds: ["a", "b", "c", "d", "e", "f"],
    glossForId: (id) => glosses[id],
    currentGloss: "love",
  });
  assert.ok(orbit);
  assert.equal(orbit!.kind, "content");
  // love + of love + Love should merge toward "love"
  assert.equal(orbit!.segments[0]!.label.toLowerCase(), "love");
  assert.ok(orbit!.segments[0]!.share > 0.5);
  assert.equal(orbit!.segments[0]!.isCurrent, true);
});

test("function words are detected for orbit suppression", () => {
  assert.equal(isFunctionWordForOrbit({ morphCode: "CONJ", lemma: "καί" }), true);
  assert.equal(isFunctionWordForOrbit({ morph: { pos: "article" }, lemma: "ὁ" }), true);
  assert.equal(
    isFunctionWordForOrbit({ morph: { pos: "noun" }, wordClass: "noun", lemma: "λόγος" }),
    false,
  );
  assert.equal(
    isFunctionWordForOrbit({ morphCode: "N-NSM", wordClass: "noun", lemma: "βασιλεύς" }),
    false,
  );
});

test("suppressAsFunction returns null", () => {
  const orbit = buildRenderingOrbit({
    lemma: "καί",
    lemmaCount: 100,
    tokenIds: ["a"],
    glossForId: () => "and",
    suppressAsFunction: true,
  });
  assert.equal(orbit, null);
});

test("donutSegmentPath returns closed path", () => {
  const p = donutSegmentPath(50, 50, 40, 20, 0, Math.PI / 2);
  assert.match(p, /^M /);
  assert.match(p, /Z$/);
});
