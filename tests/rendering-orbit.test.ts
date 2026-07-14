import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRenderingOrbit,
  normalizeOrbitGloss,
  donutSegmentPath,
} from "../src/core/language/rendering-orbit.js";

test("normalizeOrbitGloss strips brackets and articles", () => {
  assert.equal(normalizeOrbitGloss("[The] book"), "book");
  assert.equal(normalizeOrbitGloss("of [the] genealogy"), "genealogy");
  assert.equal(normalizeOrbitGloss(null), null);
});

test("buildRenderingOrbit sizes segments by gloss frequency", () => {
  const glosses: Record<string, string> = {
    a: "love",
    b: "love",
    c: "love",
    d: "beloved",
    e: "charity",
  };
  const orbit = buildRenderingOrbit({
    lemma: "ἀγάπη",
    strongPrefixed: "G26",
    lemmaCount: 5,
    tokenIds: ["a", "b", "c", "d", "e"],
    glossForId: (id) => glosses[id],
    currentGloss: "love",
  });
  assert.ok(orbit);
  assert.equal(orbit!.total, 5);
  assert.equal(orbit!.segments[0]!.label.toLowerCase(), "love");
  assert.ok(orbit!.segments[0]!.share > 0.5);
  assert.equal(orbit!.segments[0]!.isCurrent, true);
});

test("donutSegmentPath returns closed path", () => {
  const p = donutSegmentPath(50, 50, 40, 20, 0, Math.PI / 2);
  assert.match(p, /^M /);
  assert.match(p, /Z$/);
});
