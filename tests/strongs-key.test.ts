import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  baseStrongsKey,
  canonicalStrongsKey,
  compareStrongsKeys,
  isFunctionMorphemePseudoTag,
  isGkNumber,
  isPlausibleStrongsNumber,
  isSenseSuffixedStrongsKey,
  padStrongsKey,
  parseOshbLemmaKey,
  parseStrongsKey,
  sameStrongsBase,
  senseSuffixOf,
  strongsKeyBounds,
  type StrongsKeyRejection,
} from "../src/core/language/strongs-key.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

/** Assert a rejection and hand back the typed rejection for further checks. */
function rejected(raw: unknown, options?: Parameters<typeof parseStrongsKey>[1]): StrongsKeyRejection {
  const r = parseStrongsKey(raw, options);
  assert.equal(r.ok, false, `expected ${JSON.stringify(raw)} to be rejected`);
  return r as StrongsKeyRejection;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Plain keys
// ───────────────────────────────────────────────────────────────────────────

test("plain keys canonicalise unpadded with an upper-case sigil", () => {
  for (const [input, expected] of [
    ["G749", "G749"],
    ["H175", "H175"],
    ["g749", "G749"],
    ["h175", "H175"],
    ["G1", "G1"],
    ["H8674", "H8674"],
  ] as const) {
    const r = parseStrongsKey(input);
    assert.equal(r.ok, true, `${input} should parse`);
    assert.ok(r.ok);
    assert.equal(r.canonical, expected);
    assert.equal(r.base, expected);
    assert.equal(r.kind, "plain");
    assert.equal(r.senseSuffix, undefined);
  }
});

test("a plain key reports its testament and number", () => {
  const g = parseStrongsKey("G749");
  assert.ok(g.ok);
  assert.equal(g.testament, "G");
  assert.equal(g.number, 749);
  assert.equal(g.testamentInferred, undefined);

  const h = parseStrongsKey("H175");
  assert.ok(h.ok);
  assert.equal(h.testament, "H");
  assert.equal(h.number, 175);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Zero-padded keys — all four paddings named in the brief
// ───────────────────────────────────────────────────────────────────────────

test("every upstream padding collapses to the same unpadded canonical", () => {
  // TIPNR uStrong (4-wide), STEP (4-wide), unfoldingWord translationWords (5-wide).
  assert.equal(canonicalStrongsKey("H0175"), "H175");
  assert.equal(canonicalStrongsKey("G0749"), "G749");
  assert.equal(canonicalStrongsKey("H0054"), "H54");
  assert.equal(canonicalStrongsKey("G00080"), "G80");
  assert.equal(canonicalStrongsKey("H00000175"), "H175");
});

test("padding, sigil case and sense all agree on one base", () => {
  assert.ok(sameStrongsBase("H0175", "H175"));
  assert.ok(sameStrongsBase("h0175", "H175"));
  assert.ok(sameStrongsBase("H1254A", "H1254"));
  assert.ok(sameStrongsBase("H1254A", "H1254B"));
  assert.ok(!sameStrongsBase("H1254", "G1254"));
  // A failure on either side is never silently "same".
  assert.ok(!sameStrongsBase("H175", "not-a-key"));
  assert.ok(!sameStrongsBase("", ""));
});

test("padStrongsKey regenerates the upstream form and keeps the sense", () => {
  assert.equal(padStrongsKey("H175"), "H0175");
  assert.equal(padStrongsKey("G749"), "G0749");
  assert.equal(padStrongsKey("H54", 4), "H0054");
  assert.equal(padStrongsKey("G80", 5), "G00080");
  assert.equal(padStrongsKey("H1254A"), "H1254A");
  assert.equal(padStrongsKey("H2148y"), "H2148y");
  // Padding a compound has no upstream meaning.
  assert.equal(padStrongsKey("G1537+4053"), null);
  assert.equal(padStrongsKey("nonsense"), null);
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Sense-suffixed keys
// ───────────────────────────────────────────────────────────────────────────

test("sense-suffixed keys parse, keep the letter, and expose a base", () => {
  for (const [input, canonical, base, suffix] of [
    ["G4245G", "G4245G", "G4245", "G"],
    ["H1254A", "H1254A", "H1254", "A"],
    ["G0367I", "G367I", "G367", "I"],
    ["H7200N", "H7200N", "H7200", "N"],
    ["H2148y", "H2148y", "H2148", "y"],
    ["H5838w", "H5838w", "H5838", "w"],
  ] as const) {
    const r = parseStrongsKey(input);
    assert.ok(r.ok, `${input} should parse`);
    assert.equal(r.kind, "sense-suffixed");
    assert.equal(r.canonical, canonical);
    assert.equal(r.base, base);
    assert.equal(r.senseSuffix, suffix);
    assert.ok(isSenseSuffixedStrongsKey(input));
    assert.equal(senseSuffixOf(input), suffix);
    assert.equal(baseStrongsKey(input), base);
  }
});

test("suffix case is NEVER folded — the silent-merge failure mode", () => {
  // Proven necessary by data we already ship: tipnr-index.json carries, on
  // base H2148 alone, both members of four case-pairs.
  for (const [upper, lower] of [
    ["H2148V", "H2148v"],
    ["H2148W", "H2148w"],
    ["H2148Y", "H2148y"],
    ["H2148Z", "H2148z"],
    ["H4918Z", "H4918z"],
  ] as const) {
    assert.notEqual(
      canonicalStrongsKey(upper),
      canonicalStrongsKey(lower),
      `${upper} and ${lower} are different senses and must not collapse`,
    );
    assert.equal(canonicalStrongsKey(upper), upper);
    assert.equal(canonicalStrongsKey(lower), lower);
    assert.equal(baseStrongsKey(upper), baseStrongsKey(lower));
  }
});

test("plain keys are not sense-suffixed", () => {
  assert.ok(!isSenseSuffixedStrongsKey("H175"));
  assert.ok(!isSenseSuffixedStrongsKey("G0749"));
  assert.equal(senseSuffixOf("H175"), null);
  // An unparseable input is not "suffixed" either — no fail-open.
  assert.ok(!isSenseSuffixedStrongsKey("G4245GG"));
  assert.ok(!isSenseSuffixedStrongsKey(null));
  assert.equal(senseSuffixOf(""), null);
});

// ───────────────────────────────────────────────────────────────────────────
// 4. OSHB lemma dialect
// ───────────────────────────────────────────────────────────────────────────

test("OSHB lemma forms parse, promoting the lower-case sense letter", () => {
  const bare = parseOshbLemmaKey("1254 a");
  assert.ok(bare.ok);
  assert.equal(bare.canonical, "H1254A");
  assert.equal(bare.base, "H1254");
  assert.equal(bare.senseSuffix, "A");
  assert.equal(bare.oshbPrefixes, undefined);

  const oneprefix = parseOshbLemmaKey("l/1254 b");
  assert.ok(oneprefix.ok);
  assert.equal(oneprefix.canonical, "H1254B");
  assert.deepEqual(oneprefix.oshbPrefixes, ["l"]);

  const conj = parseOshbLemmaKey("c/1254 a");
  assert.ok(conj.ok);
  assert.equal(conj.canonical, "H1254A");
  assert.deepEqual(conj.oshbPrefixes, ["c"]);

  const twoprefix = parseOshbLemmaKey("c/l/3722 a");
  assert.ok(twoprefix.ok);
  assert.equal(twoprefix.canonical, "H3722A");
  assert.deepEqual(twoprefix.oshbPrefixes, ["c", "l"]);

  const nosuffix = parseOshbLemmaKey("c/d/6336");
  assert.ok(nosuffix.ok);
  assert.equal(nosuffix.canonical, "H6336");
  assert.equal(nosuffix.kind, "plain");
  assert.deepEqual(nosuffix.oshbPrefixes, ["c", "d"]);
});

test("the OSHB space-letter shape settles the testament without an assume", () => {
  // No sigil, but a space before a single letter occurs in one source only,
  // and that source is Hebrew.
  const r = parseStrongsKey("1254 a");
  assert.ok(r.ok);
  assert.equal(r.canonical, "H1254A");
  assert.equal(r.testament, "H");
  assert.equal(r.testamentInferred, true);
});

test("bara: the split that changes an answer, not a layout", () => {
  // 53 occurrences of "create" (sense a) vs 1 of the homonym "fatten"
  // (sense b, 1SA 2:29). Plain H1254 cannot tell them apart.
  const create = parseOshbLemmaKey("c/1254 a");
  const fatten = parseOshbLemmaKey("l/1254 b");
  assert.ok(create.ok);
  assert.ok(fatten.ok);
  assert.notEqual(create.canonical, fatten.canonical);
  assert.equal(create.base, fatten.base);
  assert.equal(create.canonical, "H1254A");
  assert.equal(fatten.canonical, "H1254B");
});

test("the OSHB trailing '+' is a compound-name marker, not a sense", () => {
  const r = parseOshbLemmaKey("1177+");
  assert.ok(r.ok);
  assert.equal(r.canonical, "H1177");
  assert.equal(r.kind, "plain");
  assert.equal(r.senseSuffix, undefined);
  assert.equal(r.oshbPlusMarked, true);
  assert.ok(!isSenseSuffixedStrongsKey("1177+"));

  const withPrefixes = parseOshbLemmaKey("c/b/1024+");
  assert.ok(withPrefixes.ok);
  assert.equal(withPrefixes.canonical, "H1024");
  assert.equal(withPrefixes.oshbPlusMarked, true);
  assert.deepEqual(withPrefixes.oshbPrefixes, ["c", "b"]);
});

test("a prefix-only OSHB lemma is rejected, not coerced to a number", () => {
  for (const lemma of ["l", "c/l", "c/b", "m", "i/l"]) {
    const r = rejected(lemma);
    assert.equal(r.reason, "no-strongs-number", `${lemma}: ${r.detail}`);
    assert.equal(canonicalStrongsKey(lemma), null);
  }
});

test("an unknown OSHB prefix segment is reported rather than skipped", () => {
  const r = rejected("z/1254 a");
  assert.equal(r.reason, "unparseable");
  assert.match(r.detail, /Unrecognised OSHB prefix/);
  // And the eight real ones are all accepted.
  for (const p of strongsKeyBounds.oshbPrefixSegments) {
    assert.equal(canonicalStrongsKey(`${p}/1254 a`), "H1254A", `prefix ${p}`);
  }
  assert.equal(strongsKeyBounds.oshbPrefixSegments.size, 8);
});

test("allowOshbDialect: false refuses the dialect instead of half-reading it", () => {
  assert.equal(canonicalStrongsKey("l/1254 b", { allowOshbDialect: false }), null);
  assert.equal(canonicalStrongsKey("1177+", { allowOshbDialect: false }), null);
  // A bare space-letter form loses its testament inference and goes ambiguous.
  const r = rejected("1254 a", { allowOshbDialect: false });
  assert.equal(r.reason, "ambiguous-bare-number");
});

// ───────────────────────────────────────────────────────────────────────────
// 5. GK numbers — a different numbering, detected and refused
// ───────────────────────────────────────────────────────────────────────────

test("GK numbers are detected and never coerced to Strong's", () => {
  for (const input of ["GK4472", "gk4472", "GK 4472", "GK:4472", "gk-4472", "G/K 4472", "Goodrick-Kohlenberger 4472"]) {
    assert.ok(isGkNumber(input), `${input} should read as GK`);
    const r = rejected(input);
    assert.equal(r.reason, "gk-numbering", `${input}: ${r.detail}`);
    assert.equal(r.gkNumber, 4472);
    assert.notEqual(canonicalStrongsKey(input), "G4472");
    assert.equal(canonicalStrongsKey(input), null);
  }
  const bare = rejected("GK");
  assert.equal(bare.reason, "gk-numbering");
  assert.equal(bare.gkNumber, undefined);
});

test("a real Strong's key with a K sense is not mistaken for GK", () => {
  // POSITIVE NEAR-MISS: the letter position is what distinguishes them.
  // G4472K = Strong's 4472, sense K. GK4472 = Goodrick-Kohlenberger 4472.
  assert.ok(!isGkNumber("G4472K"));
  const r = parseStrongsKey("G4472K");
  assert.ok(r.ok);
  assert.equal(r.canonical, "G4472K");
  assert.equal(r.base, "G4472");
  assert.equal(r.senseSuffix, "K");
  assert.notEqual(canonicalStrongsKey("G4472K"), canonicalStrongsKey("GK4472"));
});

test("isGkNumber is false for Strong's keys and for junk", () => {
  for (const input of ["G749", "H175", "G4245G", "1254 a", "", "G", "gnat"]) {
    assert.ok(!isGkNumber(input), `${input} should not read as GK`);
  }
  assert.ok(!isGkNumber(null));
  assert.ok(!isGkNumber(4472));
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Positive near-misses — shapes that LOOK suffixed and are not
// ───────────────────────────────────────────────────────────────────────────

test("near-miss: G1537+4053 is a compound, not a suffixed key", () => {
  // Six shipped Greek tokens carry a '+'-joined multi-Strong's value
  // (ἐκπερισσῶς = G1537+4053). It looks structured; it is not one sense.
  const r = parseStrongsKey("G1537+4053");
  assert.ok(r.ok);
  assert.equal(r.kind, "compound");
  assert.equal(r.senseSuffix, undefined);
  assert.ok(!isSenseSuffixedStrongsKey("G1537+4053"));
  assert.deepEqual(r.components, ["G1537", "G4053"]);
  assert.equal(r.canonical, "G1537+G4053");
  // The canonical form must MISS a single-entry lexicon, not resolve to G1537.
  assert.notEqual(r.canonical, "G1537");
  assert.notEqual(r.base, "G1537");

  const three = parseStrongsKey("G5228+1537+4053");
  assert.ok(three.ok);
  assert.deepEqual(three.components, ["G5228", "G1537", "G4053"]);
});

test("near-miss: '1177+' looks marked but carries no sense", () => {
  assert.ok(!isSenseSuffixedStrongsKey("1177+"));
  assert.equal(senseSuffixOf("1177+"), null);
  assert.equal(canonicalStrongsKey("1177+"), "H1177");
});

test("near-miss: H9003 is a plain pseudo-tag, not a suffixed key", () => {
  assert.ok(!isSenseSuffixedStrongsKey("H9003"));
  assert.equal(canonicalStrongsKey("H9003"), "H9003");
  assert.ok(isFunctionMorphemePseudoTag("H9003"));
  assert.ok(isFunctionMorphemePseudoTag("H9009"));
  assert.ok(isFunctionMorphemePseudoTag("H9020"));
  assert.ok(!isFunctionMorphemePseudoTag("H8674"));
  assert.ok(!isFunctionMorphemePseudoTag("G9003"));
  assert.ok(!isFunctionMorphemePseudoTag("nonsense"));
});

test("near-miss: a trailing digit is not a sense letter", () => {
  // H12540 is Strong's 12540 (out of range but syntactically five digits),
  // NOT H1254 sense "0".
  const r = parseStrongsKey("H12540");
  assert.ok(r.ok);
  assert.equal(r.kind, "plain");
  assert.equal(r.number, 12540);
  assert.equal(r.senseSuffix, undefined);
  assert.ok(!isPlausibleStrongsNumber("H12540"));
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Adversarial input
// ───────────────────────────────────────────────────────────────────────────

test("empty, null, undefined and non-strings are rejected with a reason", () => {
  assert.equal(rejected("").reason, "empty");
  assert.equal(rejected("   ").reason, "empty");
  assert.equal(rejected("\t\n ").reason, "empty");
  assert.equal(rejected(null).reason, "not-a-string");
  assert.equal(rejected(undefined).reason, "not-a-string");
  assert.equal(rejected(1254).reason, "not-a-string");
  assert.equal(rejected({}).reason, "not-a-string");
  assert.equal(rejected([]).reason, "not-a-string");
  assert.equal(canonicalStrongsKey(null), null);
  assert.equal(baseStrongsKey(undefined), null);
});

test("a bare sigil is rejected", () => {
  for (const input of ["G", "H", "g", "h"]) {
    const r = rejected(input);
    assert.equal(r.reason, "no-strongs-number", `${input}: ${r.detail}`);
  }
});

test("out-of-range numbers are rejected, not truncated", () => {
  const big = rejected("H99999999");
  assert.equal(big.reason, "out-of-range");
  assert.match(big.detail, /8 significant digits/);
  assert.equal(canonicalStrongsKey("H99999999"), null);
  assert.equal(rejected("G123456").reason, "out-of-range");
  // Five digits is the syntactic ceiling and it matches the existing gates.
  assert.equal(strongsKeyBounds.maxDigits, 5);
  assert.equal(canonicalStrongsKey("H99999"), "H99999");
});

test("zero is a named sentinel, not junk and not a number", () => {
  // tipnr-index.json ships H0000/G0000 as uStrong and H0/G0 as baseStrong on
  // 13 "Unnamed#N" entities. A reader must skip them knowingly.
  for (const input of ["H0", "G0", "H0000", "G0000", "H00000"]) {
    const r = rejected(input);
    assert.equal(r.reason, "zero-sentinel", `${input}: ${r.detail}`);
    assert.match(r.detail, /sentinel|start at 1/);
    assert.equal(canonicalStrongsKey(input), null);
  }
  assert.equal(rejected("0", { assume: "H" }).reason, "zero-sentinel");
});

test("a multi-letter tail is rejected, not trimmed to one letter", () => {
  const r = rejected("G4245GG");
  assert.equal(r.reason, "malformed-suffix");
  assert.match(r.detail, /2-letter tail/);
  assert.equal(canonicalStrongsKey("G4245GG"), null);
  assert.equal(baseStrongsKey("G4245GG"), null);
  // Crucially it does NOT silently become G4245G, which would merge senses.
  assert.notEqual(canonicalStrongsKey("G4245GG"), "G4245G");
  assert.equal(rejected("H1254ABC").reason, "malformed-suffix");
});

test("an all-lower-case suffixed key is ambiguous and says so", () => {
  const r = rejected("h1254a");
  assert.equal(r.reason, "ambiguous-suffix-case");
  assert.match(r.detail, /H1254A/);
  assert.match(r.detail, /H1254a/);
  assert.equal(canonicalStrongsKey("h1254a"), null);
  // Overridable, explicitly, by a caller who knows the source is faithful.
  assert.equal(canonicalStrongsKey("h1254a", { trustSuffixCase: true }), "H1254a");
  assert.equal(canonicalStrongsKey("h2148y", { trustSuffixCase: true }), "H2148y");
  // A lower-case sigil with an UPPER-case suffix is unambiguous already.
  assert.equal(canonicalStrongsKey("h1254A"), "H1254A");
  // And a lower-case sigil with no suffix has nothing to be ambiguous about.
  assert.equal(canonicalStrongsKey("h1254"), "H1254");
});

test("a bare number is ambiguous without an assume", () => {
  const r = rejected("1254");
  assert.equal(r.reason, "ambiguous-bare-number");
  assert.match(r.detail, /Goodrick-Kohlenberger/);
  assert.equal(canonicalStrongsKey("1254"), null);
  // strongs-hebrew-gloss.json keys are bare; its reader supplies the testament.
  assert.equal(canonicalStrongsKey("1254", { assume: "H" }), "H1254");
  assert.equal(canonicalStrongsKey("430", { assume: "H" }), "H430");
  assert.equal(canonicalStrongsKey("1254", { assume: "G" }), "G1254");
  const inferred = parseStrongsKey("430", { assume: "H" });
  assert.ok(inferred.ok);
  assert.equal(inferred.testamentInferred, true);
});

test("whitespace inside and around a key is tolerated", () => {
  assert.equal(canonicalStrongsKey("  G749  "), "G749");
  assert.equal(canonicalStrongsKey("\tH0175\n"), "H175");
  assert.equal(canonicalStrongsKey("H 1254"), "H1254");
  assert.equal(canonicalStrongsKey("H1254 A"), "H1254A");
  assert.equal(canonicalStrongsKey(" c/l/3722 a "), "H3722A");
});

test("junk that resembles a key is refused", () => {
  for (const input of ["HG749", "G-749", "G749-", "G7.49", "H1254A1", "749G", "--", "G++", "H/1254", "1254//a"]) {
    assert.equal(canonicalStrongsKey(input), null, `${input} should not parse`);
  }
});

test("OSHB syntax alone settles the testament for a bare number", () => {
  // A slash prefix chain or a trailing '+' occurs only in oshb-wlc, which is
  // Hebrew — so these need no `assume`, while a naked "1254" still does.
  assert.equal(canonicalStrongsKey("1177+"), "H1177");
  assert.equal(canonicalStrongsKey("c/d/6336"), "H6336");
  assert.equal(canonicalStrongsKey("1254"), null);
  for (const input of ["1177+", "c/d/6336", "1254 a"]) {
    const r = parseStrongsKey(input);
    assert.ok(r.ok, input);
    assert.equal(r.testament, "H");
    assert.equal(r.testamentInferred, true, `${input} must be flagged as inferred`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Plausibility and ordering
// ───────────────────────────────────────────────────────────────────────────

test("plausibility follows the published ranges", () => {
  assert.equal(strongsKeyBounds.maxHebrew, 8674);
  assert.equal(strongsKeyBounds.maxGreek, 5624);
  assert.ok(isPlausibleStrongsNumber("H1"));
  assert.ok(isPlausibleStrongsNumber("H8674"));
  assert.ok(!isPlausibleStrongsNumber("H8675"));
  assert.ok(isPlausibleStrongsNumber("H9003"));
  assert.ok(!isPlausibleStrongsNumber("H10000"));
  assert.ok(isPlausibleStrongsNumber("G5624"));
  assert.ok(!isPlausibleStrongsNumber("G5625"));
  assert.ok(isPlausibleStrongsNumber("H1254A"));
  assert.ok(!isPlausibleStrongsNumber("junk"));
});

test("keys sort by testament, number, then sense with upper-case first", () => {
  const sorted = ["H2148a", "G749", "H2148Z", "H1254B", "H2148", "H1254A", "H1254"].sort(
    compareStrongsKeys,
  );
  assert.deepEqual(sorted, [
    "H1254",
    "H1254A",
    "H1254B",
    "H2148",
    "H2148Z",
    "H2148a",
    "G749",
  ]);
  // Unparseable inputs sort last rather than throwing.
  const withJunk = ["zzz", "H1"].sort(compareStrongsKeys);
  assert.deepEqual(withJunk, ["H1", "zzz"]);
  assert.equal(compareStrongsKeys("H1254A", "H1254A"), 0);
});

// ───────────────────────────────────────────────────────────────────────────
// 9. Against the shipped data — every loop asserts a non-zero count
// ───────────────────────────────────────────────────────────────────────────

test("every shipped lexicon key canonicalises, and the three formats agree", () => {
  const files = [
    { path: "data/scripture/lexicons/bdb-kjv.json", assume: undefined, expectPrefixed: true },
    { path: "data/scripture/lexicons/strongs-plus.json", assume: undefined, expectPrefixed: true },
    { path: "data/scripture/lexicons/thayer.json", assume: undefined, expectPrefixed: true },
    {
      path: "data/scripture/lexicons/strongs-hebrew-gloss.json",
      assume: "H" as const,
      expectPrefixed: false,
    },
  ];
  let checked = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(resolve(repoRoot, file.path), "utf8")) as
      Record<string, unknown> & { entries?: Record<string, unknown> };
    // Three files wrap their map in `entries`; strongs-hebrew-gloss.json is a
    // flat top-level map. Both shapes are read, neither is assumed.
    const map = raw.entries ?? raw;
    const keys = Object.keys(map).filter((k) => k !== "meta");
    assert.ok(keys.length > 0, `${file.path} yielded no keys`);
    for (const key of keys) {
      const parsed = parseStrongsKey(key, file.assume ? { assume: file.assume } : undefined);
      assert.ok(parsed.ok, `${file.path} key ${key} failed: ${(parsed as StrongsKeyRejection).detail ?? ""}`);
      // Every shipped lexicon key is already unpadded, i.e. canonical.
      if (file.expectPrefixed) {
        assert.equal(parsed.canonical, key.toUpperCase(), `${file.path} key ${key} is not canonical`);
      } else {
        assert.equal(parsed.canonical, `H${key}`, `${file.path} bare key ${key}`);
      }
      assert.equal(parsed.kind, "plain", `${file.path} key ${key} is unexpectedly suffixed`);
      checked++;
    }
  }
  // 8,674 + 14,197 + 5,521 + 8,674.
  assert.equal(checked, 37066, "expected the four shipped lexicons' full key count");
});

test("every TIPNR uStrong and baseStrong canonicalises, suffixes intact", () => {
  const index = JSON.parse(
    readFileSync(resolve(repoRoot, "data/scripture/names/tipnr-index.json"), "utf8"),
  ) as {
    entities: Record<string, { uStrong: string; baseStrong: string; strongs?: string[] }>;
  };
  const entities = Object.values(index.entities);
  assert.ok(entities.length > 0, "tipnr-index.json yielded no entities");

  let suffixed = 0;
  let lowercaseSuffixed = 0;
  let sentinels = 0;
  for (const e of entities) {
    const u = parseStrongsKey(e.uStrong);
    const b = parseStrongsKey(e.baseStrong);
    if (!u.ok) {
      // The only tolerated failure is the unnamed-person sentinel, and it must
      // fail the same way on both fields.
      assert.equal(u.reason, "zero-sentinel", `uStrong ${e.uStrong}: ${u.detail}`);
      assert.ok(!b.ok);
      assert.equal(b.reason, "zero-sentinel", `baseStrong ${e.baseStrong}`);
      sentinels++;
      continue;
    }
    assert.ok(b.ok, `baseStrong ${e.baseStrong} failed`);
    // The padded uStrong and the unpadded baseStrong must land on one base.
    assert.equal(u.base, b.canonical, `${e.uStrong} vs ${e.baseStrong}`);
    if (u.kind === "sense-suffixed") {
      suffixed++;
      assert.ok(u.senseSuffix);
      if (u.senseSuffix === u.senseSuffix.toLowerCase()) lowercaseSuffixed++;
    }
    for (const s of e.strongs ?? []) {
      assert.ok(parseStrongsKey(s).ok, `strongs[] member ${s} failed`);
    }
  }
  assert.equal(entities.length, 4259);
  assert.equal(suffixed, 2380, "measured count of sense-suffixed TIPNR uStrong values");
  assert.equal(lowercaseSuffixed, 5, "TIPNR ships five lower-case overflow suffixes");
  assert.equal(sentinels, 13, "measured count of TIPNR unnamed-person sentinels");
});

test("TIPNR contains case-pairs that folding would merge", () => {
  const index = JSON.parse(
    readFileSync(resolve(repoRoot, "data/scripture/names/tipnr-index.json"), "utf8"),
  ) as { entities: Record<string, { uStrong: string }> };
  const canonical = new Set<string>();
  let skipped = 0;
  for (const e of Object.values(index.entities)) {
    const k = canonicalStrongsKey(e.uStrong);
    if (k === null) {
      // Only the 13 zero sentinels may be skipped.
      assert.equal(parseStrongsKey(e.uStrong).ok, false);
      skipped++;
      continue;
    }
    canonical.add(k);
  }
  assert.equal(skipped, 13, "only the unnamed-person sentinels may be skipped");
  const folded = new Set([...canonical].map((k) => k.toUpperCase()));
  assert.ok(canonical.size > 0, "no canonical keys collected");
  assert.equal(
    canonical.size - folded.size,
    5,
    "upper-casing TIPNR's canonical keys silently merges exactly five distinct senses",
  );
  for (const pair of ["H2148V", "H2148v", "H2148W", "H2148w", "H2148Y", "H2148y", "H2148Z", "H2148z", "H4918Z", "H4918z"]) {
    assert.ok(canonical.has(pair), `${pair} should be present in tipnr-index.json`);
  }
});

/** Stream a .jsonl package. Whole file, not a slice — a slice fails open. */
async function eachToken(
  relPath: string,
  visit: (token: Record<string, unknown>) => void,
): Promise<number> {
  const rl = createInterface({
    input: createReadStream(resolve(repoRoot, relPath), "utf8"),
    crlfDelay: Infinity,
  });
  let lines = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    visit(JSON.parse(line) as Record<string, unknown>);
  }
  return lines;
}

test("every OSHB lemma in the whole shipped package resolves or is a named morpheme", async () => {
  let parsed = 0;
  let suffixed = 0;
  let plus = 0;
  let prefixOnly = 0;
  let disagreesWithStrong = 0;
  const bases = new Set<string>();
  const canonical = new Set<string>();
  const letters = new Set<string>();

  const total = await eachToken("data/scripture/packages/oshb-wlc/tokens.jsonl", (token) => {
    const lemma = token["lemma"];
    if (typeof lemma !== "string") return;
    const r = parseOshbLemmaKey(lemma);
    if (!r.ok) {
      // The ONLY tolerated rejection across 306,774 tokens.
      assert.equal(
        r.reason,
        "no-strongs-number",
        `lemma "${lemma}" rejected for ${r.reason}: ${r.detail}`,
      );
      prefixOnly++;
      return;
    }
    parsed++;
    assert.equal(r.testament, "H");
    bases.add(r.base);
    canonical.add(r.canonical);
    // The base must agree with what oshb-osis.ts already derives into `strong`,
    // or this module would quietly change the Hebrew keys already in use.
    const strong = token["strong"];
    if (typeof strong === "string" && /^\d+$/.test(strong)) {
      if (r.base !== `H${Number.parseInt(strong, 10)}`) disagreesWithStrong++;
    }
    if (r.kind === "sense-suffixed") {
      suffixed++;
      assert.ok(r.senseSuffix);
      letters.add(r.senseSuffix);
    }
    if (r.oshbPlusMarked) plus++;
  });

  assert.equal(total, 306774, "shipped oshb-wlc token count");
  assert.equal(parsed, 300797);
  assert.equal(prefixOnly, 5977, "prefix-only function morphemes with no Strong's number");
  assert.equal(parsed + prefixOnly, total, "every token was classified");
  assert.equal(suffixed, 59282, "OSHB tokens carrying a homonym sense letter (19.3%)");
  assert.equal(plus, 801, "OSHB tokens carrying the '+' compound-name marker");
  assert.equal(disagreesWithStrong, 0, "base must agree with the existing token.strong");
  assert.deepEqual([...letters].sort(), ["A", "B", "C", "D", "E", "F"]);
  // The whole point of step 0, as one number: keying on the sense rather than
  // the plain base distinguishes 623 senses that are merged today.
  assert.equal(bases.size, 8638);
  assert.equal(canonical.size, 9261);
  assert.equal(canonical.size - bases.size, 623, "senses gained by adopting the suffix");
});

test("every Greek strongPrefixed in the whole shipped package resolves", async () => {
  let parsed = 0;
  let compound = 0;
  const sentinels: string[] = [];

  const total = await eachToken(
    "data/scripture/packages/macula-greek-nestle1904/tokens.jsonl",
    (token) => {
      const key = token["strongPrefixed"];
      if (typeof key !== "string") return;
      const r = parseStrongsKey(key);
      if (!r.ok) {
        // Two shipped Greek tokens have no Strong's number at all:
        // LUK 3:33 Ἀρνεὶ and REV 18:13 ἄμωμον both carry strongPrefixed "G0".
        assert.equal(r.reason, "zero-sentinel", `${key}: ${r.detail}`);
        sentinels.push(String(token["id"]));
        return;
      }
      parsed++;
      assert.equal(r.testament, "G");
      assert.equal(r.kind === "sense-suffixed", false, "Greek ships no sense suffixes today");
      if (r.kind === "compound") {
        compound++;
        assert.ok((r.components?.length ?? 0) >= 2);
      } else {
        // Greek tokens ship unpadded, so canonical is byte-identical to input.
        assert.equal(r.canonical, key);
      }
    },
  );

  assert.equal(total, 137779, "shipped macula-greek-nestle1904 token count");
  assert.equal(parsed, 137777);
  assert.equal(compound, 6, "'+'-joined multi-Strong's Greek tokens");
  assert.deepEqual(sentinels.sort(), ["n42003033006", "n66018013004"]);
});
