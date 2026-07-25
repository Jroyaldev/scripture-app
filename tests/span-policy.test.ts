import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySpanPolicy,
  deriveSelectionShape,
  functionSubclass,
  isFunctionWord,
  type TargetWord,
} from "../src/core/annotations/span-policy.ts";

/**
 * Fixtures are the REAL shipped rows for ACT.2.4, extracted from
 * data/scripture/packages/{bsb,kjv}/occurrence-alignments-v1.jsonl. Inlined so the
 * test is fast and deterministic, but they are not invented: this is the verse the
 * defect was reported against.
 *
 * The decisive property is visible in BSB_WORDS below — `the`(30,33) and `Holy`(34,38)
 * BOTH carry position 5, and `Spirit`(39,45) carries 4. So `Holy Spirit` and
 * `the Holy Spirit` select the SAME occurrence set {4,5}. No alignment improvement can
 * ever tell them apart; only the shape of the selection can.
 */
const BSB_TEXT = "And they were all filled with the Holy Spirit and began to speak in other tongues as the Spirit enabled them.";
const BSB_WORDS: [number, number, number[]][] = [[0, 3, [1]], [4, 8, [3]], [9, 13, [3]], [14, 17, [3]], [18, 24, [2]], [25, 29, [2]], [30, 33, [5]], [34, 38, [5]], [39, 45, [4]], [46, 49, [6]], [50, 55, [7]], [56, 58, [8]], [59, 64, [8]], [65, 67, [9]], [68, 73, [9]], [74, 81, [10]], [82, 84, [11]], [85, 88, [12]], [89, 95, [13]], [96, 103, [14]], [104, 108, [16]]];

const KJV_TEXT = "And they were all filled with the Holy Ghost, and began to speak with other tongues, as the Spirit gave them utterance.";
const KJV_WORDS: [number, number, number[]][] = [[0, 3, [1]], [4, 8, [3]], [9, 13, [2]], [14, 17, [3]], [18, 24, [2]], [25, 29, [4]], [30, 33, [5]], [34, 38, [5]], [39, 44, [4]], [46, 49, [6]], [50, 55, [7]], [56, 58, [8]], [59, 64, [8]], [65, 69, [10]], [70, 75, [9]], [76, 83, [10]], [85, 87, [11]], [88, 91, [12]], [92, 98, [13]], [99, 103, [14]], [104, 108, [16]], [109, 118, [15]]];

const words = (raw: [number, number, number[]][], text: string): TargetWord[] =>
  raw.map(([start, end, positions], index) => ({ index, raw: text.slice(start, end), positions }));

const selectByText = (raw: [number, number, number[]][], text: string, phrase: string) => {
  const at = text.indexOf(phrase);
  assert.ok(at >= 0, `fixture must contain ${phrase}`);
  const end = at + phrase.length;
  return raw
    .filter(([start, stop]) => stop > at && start < end)
    .map(([start, stop, positions]) => ({ raw: text.slice(start, stop), positions }));
};

const paint = (target: TargetWord[], text: string, raw: [number, number, number[]][], kept: readonly number[] | null) =>
  kept === null ? null : kept.map((i) => text.slice(raw[i]![0], raw[i]![1])).join(" ");

// ---------------------------------------------------------------- the defect
test("the source position sets for 'Holy Spirit' and 'the Holy Spirit' are identical", () => {
  const without = selectByText(BSB_WORDS, BSB_TEXT, "Holy Spirit");
  const with_ = selectByText(BSB_WORDS, BSB_TEXT, "the Holy Spirit");
  const positions = (sel: { positions: readonly number[] }[]) =>
    [...new Set(sel.flatMap((w) => [...w.positions]))].sort((a, b) => a - b);
  assert.deepEqual(positions(without), [4, 5]);
  assert.deepEqual(positions(with_), [4, 5]);
  // Which is exactly why occurrence positions alone cannot fix this.
});

test("selecting 'Holy Spirit' does NOT acquire the target's article", () => {
  const shape = deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "Holy Spirit"));
  assert.equal(shape.lead_function_words, 0);
  const target = words(KJV_WORDS, KJV_TEXT);
  assert.equal(paint(target, KJV_TEXT, KJV_WORDS, applySpanPolicy(shape, target)), "Holy Ghost");
});

test("selecting 'the Holy Spirit' DOES keep the target's article", () => {
  const shape = deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "the Holy Spirit"));
  assert.equal(shape.lead_function_words, 1);
  const target = words(KJV_WORDS, KJV_TEXT);
  assert.equal(paint(target, KJV_TEXT, KJV_WORDS, applySpanPolicy(shape, target)), "the Holy Ghost");
});

test("the two selections now produce different projections", () => {
  const target = words(KJV_WORDS, KJV_TEXT);
  const a = applySpanPolicy(deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "Holy Spirit")), target);
  const b = applySpanPolicy(deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "the Holy Spirit")), target);
  assert.notDeepEqual(a, b);
});

test("a function word that owns a source token pulls that token's whole rendering", () => {
  // Not every selected function word is a fused article. BSB renders position 2 as
  // `filled`+`with`, so selecting `with` selects part of the VERB's token, not an
  // article. Only `the` is fused here, so the lead budget is 1 rather than 2, and the
  // projection legitimately widens to KJV's rendering of that same token (`filled`).
  // Arithmetically correct many-to-one, not the widening defect.
  const shape = deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "with the Holy Spirit"));
  assert.equal(shape.lead_function_words, 1, "only `the` is fused; `with` owns position 2");
  assert.deepEqual(shape.own_positions, [2]);
  const target = words(KJV_WORDS, KJV_TEXT);
  assert.equal(
    paint(target, KJV_TEXT, KJV_WORDS, applySpanPolicy(shape, target)),
    "filled with the Holy Ghost",
  );
});

// ---------------------------------------------------------------- invariants
test("content words are never trimmed by the policy", () => {
  const shape = deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "Holy Spirit"));
  const target = words(KJV_WORDS, KJV_TEXT);
  const kept = new Set(applySpanPolicy(shape, target) ?? []);
  const core = new Set(shape.content_positions);
  for (const word of target) {
    if (!isFunctionWord(word.raw) && word.positions.some((p) => core.has(p))) {
      assert.ok(kept.has(word.index), `content word ${word.raw} must survive`);
    }
  }
});

test("interior function words are kept so the span does not fragment", () => {
  // A whole-clause selection keeps `and`, `to`, `in` inside the hull.
  const shape = deriveSelectionShape(selectByText(BSB_WORDS, BSB_TEXT, "began to speak"));
  const target = words(BSB_WORDS, BSB_TEXT);
  const kept = applySpanPolicy(shape, target) ?? [];
  const contiguous = kept.every((v, i) => i === 0 || v === kept[i - 1]! + 1);
  assert.ok(contiguous, `expected an unbroken run, got ${JSON.stringify(kept)}`);
});

test("a function-word-only selection abstains when the target has no counterpart", () => {
  const shape = deriveSelectionShape([{ raw: "I", positions: [999] }]);
  const target: TargetWord[] = [{ index: 0, raw: "walked", positions: [999] }];
  assert.equal(applySpanPolicy(shape, target), null, "honest null, not the content word");
});

test("a function-word-only selection prefers the matching sub-class", () => {
  const shape = deriveSelectionShape([{ raw: "the", positions: [7] }]);
  const target: TargetWord[] = [
    { index: 0, raw: "of", positions: [7] },
    { index: 1, raw: "the", positions: [7] },
    { index: 2, raw: "word", positions: [7] },
  ];
  assert.deepEqual(applySpanPolicy(shape, target), [1], "article selects article, not preposition");
});

test("word classification matches the alignment harness", () => {
  assert.equal(isFunctionWord("the"), true);
  assert.equal(isFunctionWord("Spirit"), false);
  assert.equal(functionSubclass("the"), "article");
  assert.equal(functionSubclass("I"), "pronoun");
  assert.equal(functionSubclass("of"), "preposition");
  assert.equal(functionSubclass("Spirit"), undefined);
});
