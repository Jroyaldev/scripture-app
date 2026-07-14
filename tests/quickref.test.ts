import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScriptureRefs } from "../src/core/notes/parser.js";
import { damerauDistance1, resolveBookToken } from "../src/core/notes/quickref.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data/scripture");
const backbone = JSON.parse(readFileSync(join(DATA_DIR, "backbone.json"), "utf-8")) as BackboneData;
const bookNames = JSON.parse(readFileSync(join(DATA_DIR, "book-names-en.json"), "utf-8")) as BookNameMap;

function refs(body: string): string[] {
  return parseScriptureRefs(body, bookNames, backbone).map(
    (r) => `${r.ref.start.book}.${r.ref.start.chapter}.${r.ref.start.verse}-${r.ref.end.chapter}.${r.ref.end.verse}`,
  );
}

// --- Quick-capture forms that must now resolve ---

test("compact refs: ps23, jn3:16, 1cor13, 2tim1:7", () => {
  assert.deepEqual(refs("ps23 vibes today"), ["PSA.23.1-23.6"]);
  assert.deepEqual(refs("jn3:16 changed everything"), ["JHN.3.16-3.16"]);
  assert.deepEqual(refs("read 1cor13 at the wedding"), ["1CO.13.1-13.13"]);
  assert.deepEqual(refs("2tim1:7 not fear"), ["2TI.1.7-1.7"]);
});

test("lowercase spaced abbrevs: gen 1:1, rom 8:28", () => {
  assert.deepEqual(refs("gen 1:1 in the beginning"), ["GEN.1.1-1.1"]);
  assert.deepEqual(refs("cling to rom 8:28"), ["ROM.8.28-8.28"]);
});

test("chapter-only refs anchor the whole chapter", () => {
  assert.deepEqual(refs("john 3 tonight"), ["JHN.3.1-3.36"]);
  assert.deepEqual(refs("acts 2 sermon idea"), ["ACT.2.1-2.47"]);
});

test("dot separator: gen 1.2", () => {
  assert.deepEqual(refs("gen 1.2 the Spirit hovers"), ["GEN.1.2-1.2"]);
});

test("verse ranges, including cross-chapter", () => {
  assert.deepEqual(refs("jn 3:16-18"), ["JHN.3.16-3.18"]);
  assert.deepEqual(refs("gen 1:31-2:3 sabbath frame"), ["GEN.1.31-2.3"]);
});

test("misspellings resolve: pslam, phillipians, galations, revelations", () => {
  assert.deepEqual(refs("pslam 23"), ["PSA.23.1-23.6"]);
  assert.deepEqual(refs("phillipians 4:6"), ["PHP.4.6-4.6"]);
  assert.deepEqual(refs("galations 2:20"), ["GAL.2.20-2.20"]);
  assert.deepEqual(refs("revelations 21:4"), ["REV.21.4-21.4"]);
});

test("edit-distance-1 typos on full names: roman 8, pslams 23", () => {
  assert.deepEqual(refs("roman 8:1 no condemnation"), ["ROM.8.1-8.1"]);
  assert.deepEqual(refs("pslams 23 again"), ["PSA.23.1-23.6"]);
});

test("digit-prefixed books: 1 john 4:19, 2john 1:5", () => {
  assert.deepEqual(refs("1 john 4:19 we love because"), ["1JN.4.19-4.19"]);
  assert.deepEqual(refs("2john 1:5 walk in love"), ["2JN.1.5-1.5"]);
});

// --- Guards: a wrong anchor is worse than a missed one ---

test("lowercase common words never match chapter-only", () => {
  assert.deepEqual(refs("act 2 of the play"), []);
  assert.deepEqual(refs("did a good job 1 time"), []);
  assert.deepEqual(refs("he 3 things to say"), []);
});

test("capitalized forms and verse-bearing forms still resolve", () => {
  assert.deepEqual(refs("Act 2 begins"), ["ACT.2.1-2.47"]);
  assert.deepEqual(refs("job 1:21 the LORD gives"), ["JOB.1.21-1.21"]);
});

test("unresolvable and out-of-range tokens never match", () => {
  assert.deepEqual(refs("worked 12 hours"), []);
  assert.deepEqual(refs("grace 2 people showed up"), []);
  assert.deepEqual(refs("windows 11 update"), []);
  assert.deepEqual(refs("jud 3 candles"), [], "Jude has 1 chapter — backbone rejects chapter 3");
  assert.deepEqual(refs("Philippians 9-3 vote result"), [], "chapter 9 out of range");
});

test("strict citations still parse and are not duplicated by the quick pass", () => {
  const result = refs("Acts 19:1-7 and again acts 19:1-7");
  assert.deepEqual(result, ["ACT.19.1-19.7"]);
});

test("mixed quick-note body extracts everything it should, nothing it should not", () => {
  const body = "ps23 + jn 10 shepherd thread. also pslam 100? worked 8 hours on the deck.";
  assert.deepEqual(refs(body), ["PSA.23.1-23.6", "JHN.10.1-10.42", "PSA.100.1-100.5"]);
});

// --- Unit-level checks ---

test("resolveBookToken layers report themselves", () => {
  assert.deepEqual(resolveBookToken(undefined, "ps", bookNames), { code: "PSA", layer: "exact" });
  assert.deepEqual(resolveBookToken(undefined, "phillipians", bookNames), { code: "PHP", layer: "misspelling" });
  assert.deepEqual(resolveBookToken(undefined, "roman", bookNames), { code: "ROM", layer: "fuzzy" });
  assert.equal(resolveBookToken(undefined, "xyzzy", bookNames), null);
});

test("numbered misspellings need their prefix: corinthains", () => {
  assert.deepEqual(resolveBookToken("1", "corinthains", bookNames), { code: "1CO", layer: "misspelling" });
  assert.equal(resolveBookToken(undefined, "corinthains", bookNames), null);
});

test("damerauDistance1 counts transpositions as one edit", () => {
  assert.equal(damerauDistance1("pslam", "psalm"), true);
  assert.equal(damerauDistance1("galations", "galatians"), true);
  assert.equal(damerauDistance1("totally", "psalm"), false);
});
