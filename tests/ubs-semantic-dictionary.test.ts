/**
 * UBS semantic dictionaries — SDBH (Hebrew) and SDGNT (Greek NT).
 *
 * ===========================================================================
 * THE QUESTION THIS FILE EXISTS TO SETTLE
 * ===========================================================================
 * SDGNT reports 7,075 Louw-Nida entry codes. Our MACULA Greek tokens already
 * carry a `louwNida` field (`src/core/language/macula-greek-tsv.ts:237`, from
 * the TSV's `ln` column). A design decision rests on whether those are THE
 * SAME Louw-Nida scheme — same syntax AND the same code meaning the same
 * thing — because if they are, one semantic-domain field can serve both.
 *
 * This file joins real values from both sides and measures. The answer, in the
 * numbers the tests below pin:
 *
 *   SAME SCHEME — yes, on all three tests of sameness.
 *     · Syntax: all 129,823 atomic MACULA `louwNida` values parse with
 *       `parseLouwNidaCode`, 0 unparsed fragments. Both sides use domains
 *       1-93 (93 distinct on each) and sense letters `a`-`i` (9 on each).
 *     · Same tree: of the 665 Louw-Nida domain codes MACULA labels
 *       unambiguously, 664 carry a label byte-identical (after case/punct
 *       folding) to the UBS `LexicalDomains` node, 0 are absent from the tree.
 *     · Same meaning per code, proved WITHOUT relying on label prose: for
 *       117,431 of the 118,307 tokens where an INDEPENDENT Strong's join finds
 *       a UBS entry (99.26%), MACULA's Louw-Nida code is one of the codes
 *       SDGNT itself puts on that same entry. That figure carries its own
 *       control, measured in the same pass: asking the same question of a
 *       RANDOM code scores 0.076%, and of a random code from the same domain
 *       (the tightest confound) 3.078%. The signal is real, not an artefact of
 *       entries carrying many codes.
 *
 *   OVERLAP, PINNED — the code inventories are not identical.
 *     · 7,002 of 7,009 distinct MACULA codes are keys in `byLouwNida` (99.90%).
 *     · 129,185 of 129,823 atomic occurrences resolve (99.509%).
 *     · The 638 that do not decompose into two very different causes, and the
 *       larger one is OURS, not upstream's:
 *         - 635 occurrences / 5 codes (12.5-12.9) ARE in SDGNT. Upstream
 *           writes the entry code with a footnote marker glued on —
 *           `"12.9{N:001}"` on κύριος "Lord, Ruler, One who commands" —
 *           and `parseLouwNidaCode` rejects it, so the importer never keys it.
 *           620 of those 635 occurrences are κύριος. See the test
 *           "the shortfall is 635 occurrences OUR parser drops and only 3
 *           upstream really lacks". The tests below assert the DEFECT, so they
 *           will fail when it is fixed — which is the intent.
 *         - 3 occurrences / 2 codes (3.21 ἄψινθος, 33.403 βλάσφημος) are
 *           genuine holes in SDGNT v1.1's own sequence. Not our bug.
 *     · Separately, 22 SDGNT entry codes sit in a domain `94` that is NOT
 *       Louw-Nida (the tree stops at `093`; SDGNT uses 94 for idioms such as
 *       γυνή "to be married"). Rejecting those is CORRECT and MACULA never
 *       cites them, so the 93-domain cap must stay — asserted, so nobody
 *       "fixes" it while fixing the `{N:001}` bug above.
 *
 *   ONE MORE TRAP, found by a test failing on `'ἀγάπη' !== 'ἀγάπη'`.
 *     UBS ships Greek in a NON-NFC form — U+1F71 OXIA where NFC uses U+03AC
 *     TONOS — on 7,990 of 13,439 lemmas. The strings render identically and
 *     compare unequal. No join in this repo touches the lemma (all of them go
 *     through a Strong's key or a Louw-Nida code), but a future lemma join
 *     would fail silently. Pinned in its own test.
 *
 *   WHAT IT DOES *NOT* LICENSE — one code space across both testaments.
 *     SDBH carries NO entry code at all: 0 of 16,224 meanings, verified here
 *     against the raw 22 MB file and not merely against the doctor report. And
 *     the two domain trees collide on 18 bare digit codes with ZERO label
 *     agreement (`001002` is "Regions On the Earth" in SDBH and "Regions
 *     Above the Earth" in SDGNT). A unified semantic-domain field is licensed
 *     only in the namespaced form the module already uses.
 *
 * ===========================================================================
 * ON VACUOUS ASSERTIONS
 * ===========================================================================
 * Every loop in this file is preceded by a non-zero assertion on the thing it
 * loops over, and every ratio asserts its denominator. A check that passes by
 * finding nothing is a failure to report, not a pass.
 *
 * ===========================================================================
 * ON RUNTIME
 * ===========================================================================
 * These are large files — 22 MB SDBH, 15 MB SDGNT, a 17 MB built index and a
 * 70 MB MACULA token stream. NOTHING IS SLICED: the whole corpus is loaded and
 * scanned ONCE at module scope, measured at 1.5 s wall for all 31 tests, so no
 * test needs to settle for a sample and every count below is a census.
 *
 * The price is memory: peak RSS is ~1.05 GB, because both raw dictionaries,
 * both parses and the built index are held at once. That is well inside Node's
 * default heap here, but it is the one number to watch if this file ever needs
 * to run somewhere smaller — the fix would be to drop `rawHebrew`/`rawGreek`
 * after `parseUbsDictionary` and re-read them in the one test that needs the
 * raw `LEXEntryCode` inventory.
 *
 * A naive version of this file took 116 s. The cost was calling
 * `readUbsMeaning` once per token, which decodes every packed reference on the
 * meaning. Per-key lookups through the public API are now memoised by key
 * (only ~5,400 distinct Greek Strong's keys and 7,009 distinct Louw-Nida codes
 * across 137,779 tokens), so the tests still exercise the real `lookupUbs*`
 * functions rather than a hand-rolled map that could agree with a bug.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  UBS_ATTRIBUTION,
  UBS_DOMAIN_SCHEME_HEADS,
  UBS_DOMAIN_SCHEME_OF,
  UBS_GREEK_JOIN,
  UBS_HEBREW_JOIN,
  UBS_LICENSE,
  UBS_LICENSE_RIDERS,
  UBS_SOURCES,
  buildUbsIndex,
  decodeUbsReference,
  isMultiWordLemma,
  lookupUbsByLouwNida,
  lookupUbsByStrong,
  parseLouwNidaCode,
  parseLouwNidaList,
  parseUbsDictionary,
  parseUbsDomainTree,
  parseUbsProse,
  parseUbsStrongCode,
  parseUbsStrongCodes,
  qualifyUbsDomainCode,
  readUbsEntry,
  readUbsMeaning,
  splitUbsDomainCode,
  ubsDomainAncestry,
  ubsDomainPath,
  type RawUbsEntry,
  type UbsDomainNode,
  type UbsEntryView,
  type UbsIndexFile,
  type UbsMeaningView,
  type UbsParsedDictionary,
} from "../src/core/language/ubs-semantic-dictionary.js";
import {
  baseStrongsKey,
  canonicalStrongsKey,
  padStrongsKey,
} from "../src/core/language/strongs-key.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const UBS_DIR = resolve(ROOT, "data/scripture/lexicons/ubs");
const MACULA_TOKENS = resolve(
  ROOT,
  "data/scripture/packages/macula-greek-nestle1904/tokens.jsonl",
);

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(UBS_DIR, name), "utf8")) as unknown;
}

/* ========================================================================== *
 * Fixtures — loaded once, at module scope
 * ========================================================================== */

const index = loadJson("ubs-semantic-index.json") as UbsIndexFile;

/**
 * The importer's own report. Read, not trusted: every count in it is
 * re-derived below from the raw files or the built index. It is here so the
 * tests pin the same numbers the importer claimed, and a divergence names
 * which side moved.
 */
type DoctorReport = {
  status: string;
  checks: Record<string, boolean>;
  counts: Record<string, number>;
  notes: string[];
};
const doctor = loadJson("ubs-doctor-report.json") as DoctorReport;

const hebrewDomainNodes = parseUbsDomainTree(
  "sdbh",
  loadJson(UBS_SOURCES.sdbh.domainFile),
);
const greekDomainNodes = parseUbsDomainTree(
  "louw-nida",
  loadJson(UBS_SOURCES.sdgnt.domainFile),
);

/** Raw upstream arrays, kept so the parse can be re-run end to end. */
const rawHebrew = loadJson(UBS_SOURCES.sdbh.file) as RawUbsEntry[];
const rawGreek = loadJson(UBS_SOURCES.sdgnt.file) as RawUbsEntry[];

const parsedHebrew: UbsParsedDictionary = parseUbsDictionary("sdbh", rawHebrew, {
  domainTree: new Set(hebrewDomainNodes.map((n) => n.code)),
});
const parsedGreek: UbsParsedDictionary = parseUbsDictionary("sdgnt", rawGreek, {
  domainTree: new Set(greekDomainNodes.map((n) => n.code)),
});

/* ========================================================================== *
 * The MACULA ↔ SDGNT join, measured once
 * ========================================================================== */

/** Fold case and punctuation so "Lord's" and "Lord’s" compare equal. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type MaculaToken = {
  strongPrefixed?: string;
  lemma?: string;
  louwNida?: string;
  domain?: string;
  /**
   * MACULA's own sense tags, carried on our tokens by
   * `scripts/import-macula-greek.ts` from MACULA's SDBG sense-gloss file.
   *
   * PROVENANCE CAVEAT, stated because it limits what the gloss test proves:
   * these labels descend from the same UBS/SDBG line SDGNT does. Agreement
   * between them shows the CODE denotes the same sense on both sides — a
   * renumbering would show up as disagreement — but it is not independent
   * corroboration of the sense itself. The Strong's-triangulation test below
   * is the independent one; it uses no label prose at all.
   */
  semanticSenses?: { id: string; label: string; domain?: string }[];
};

/** Memoised real-API lookups, keyed by the raw value a token carries. */
const strongLookupCache = new Map<
  string,
  { matchedKey: string; matchedOn: "canonical" | "base"; entries: UbsEntryView[] } | null
>();
function lookupStrongMemo(raw: string) {
  if (!strongLookupCache.has(raw)) {
    strongLookupCache.set(raw, lookupUbsByStrong(index, raw));
  }
  return strongLookupCache.get(raw) ?? null;
}

const louwNidaLookupCache = new Map<string, UbsMeaningView[]>();
function lookupLouwNidaMemo(code: string): UbsMeaningView[] {
  let hit = louwNidaLookupCache.get(code);
  if (!hit) {
    hit = lookupUbsByLouwNida(index, code).flatMap((group) => group.meanings);
    louwNidaLookupCache.set(code, hit);
  }
  return hit;
}

type JoinMeasurement = {
  tokens: number;
  tokensWithLouwNida: number;
  atomicOccurrences: number;
  multiValueTokens: number;
  unparsedFragments: string[];
  distinctCodes: Set<string>;
  distinctMatched: Set<string>;
  occurrencesMatched: number;
  unmatchedOccurrences: Map<string, number>;
  senseLetters: Map<string, number>;
  domainNumbers: Set<number>;
  /** Strong's triangulation — no label prose involved. */
  strongTried: number;
  strongEntryFound: number;
  strongCodeOnSameEntry: number;
  strongMissSamples: string[];
  /**
   * The null hypothesis for the triangulation, measured in the same pass.
   * `strongRandomBaseline` swaps the token's own code for a random one of the
   * 7,075; `strongSameDomainBaseline` swaps it for a random code from the SAME
   * Louw-Nida domain, which is the strongest confound because a domain holds
   * few entries and chance agreement is correspondingly likelier.
   */
  strongRandomBaseline: number;
  strongSameDomainBaseline: number;
  /** Gloss agreement (see the provenance caveat on `semanticSenses`). */
  glossTried: number;
  glossEveryPartMatched: number;
  glossAnyPartMatched: number;
  glossMissSamples: string[];
  /** Louw-Nida domain code → the labels MACULA gives it, unambiguously. */
  domainLabels: Map<string, Set<string>>;
};

function measureJoin(): JoinMeasurement {
  const m: JoinMeasurement = {
    tokens: 0,
    tokensWithLouwNida: 0,
    atomicOccurrences: 0,
    multiValueTokens: 0,
    unparsedFragments: [],
    distinctCodes: new Set(),
    distinctMatched: new Set(),
    occurrencesMatched: 0,
    unmatchedOccurrences: new Map(),
    senseLetters: new Map(),
    domainNumbers: new Set(),
    strongTried: 0,
    strongEntryFound: 0,
    strongCodeOnSameEntry: 0,
    strongMissSamples: [],
    strongRandomBaseline: 0,
    strongSameDomainBaseline: 0,
    glossTried: 0,
    glossEveryPartMatched: 0,
    glossAnyPartMatched: 0,
    glossMissSamples: [],
    domainLabels: new Map(),
  };

  // Pool for the control, plus a seeded LCG so the baseline is reproducible
  // run to run. Bucketed by domain up front: filtering 7,075 codes inside a
  // 137,779-iteration loop would cost more than the whole rest of this file.
  const codePool = Object.keys(index.byLouwNida);
  assert.ok(codePool.length > 0, "the control has no code pool to draw from");
  const poolByDomain = new Map<number, string[]>();
  for (const code of codePool) {
    const parsed = parseLouwNidaCode(code);
    if (!parsed) continue;
    const bucket = poolByDomain.get(parsed.domain) ?? [];
    bucket.push(code);
    poolByDomain.set(parsed.domain, bucket);
  }
  assert.ok(poolByDomain.size > 0);
  let seed = 12_345;
  const nextRandom = (): number =>
    (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;

  const lines = readFileSync(MACULA_TOKENS, "utf8").split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    const token = JSON.parse(line) as MaculaToken;
    m.tokens += 1;
    if (!token.louwNida) continue;
    m.tokensWithLouwNida += 1;

    const { codes, unparsed } = parseLouwNidaList(token.louwNida);
    if (token.louwNida.trim().split(/\s+/).length > 1) m.multiValueTokens += 1;
    for (const fragment of unparsed) {
      if (m.unparsedFragments.length < 40) m.unparsedFragments.push(fragment);
    }
    for (const code of codes) {
      m.atomicOccurrences += 1;
      m.distinctCodes.add(code.code);
      m.domainNumbers.add(code.domain);
      if (code.sense) {
        m.senseLetters.set(code.sense, (m.senseLetters.get(code.sense) ?? 0) + 1);
      }
      if (lookupLouwNidaMemo(code.code).length > 0) {
        m.distinctMatched.add(code.code);
        m.occurrencesMatched += 1;
      } else {
        m.unmatchedOccurrences.set(
          code.code,
          (m.unmatchedOccurrences.get(code.code) ?? 0) + 1,
        );
      }
    }

    // ── Strong's triangulation. The Strong's number is an independent join
    // key: if the code MACULA writes turns up among the codes SDGNT puts on
    // the very entry Strong's picks out, the two sides mean the same sense by
    // the same number, with no appeal to matching prose.
    const first = codes[0];
    if (first && token.strongPrefixed) {
      m.strongTried += 1;
      const hit = lookupStrongMemo(token.strongPrefixed);
      if (hit) {
        m.strongEntryFound += 1;
        const codesOnEntry = new Set<string>();
        for (const entry of hit.entries) {
          for (const at of entry.meaningIndices) {
            const ln = index.meanings[at]?.ln;
            if (ln) codesOnEntry.add(ln);
          }
        }
        if (codesOnEntry.has(first.code)) m.strongCodeOnSameEntry += 1;
        else if (m.strongMissSamples.length < 8) {
          m.strongMissSamples.push(
            `${token.lemma} ${token.strongPrefixed} macula=${first.code} ` +
              `sdgnt=[${[...codesOnEntry].slice(0, 6).join(",")}]`,
          );
        }
        // The same question asked of a code the token does not carry.
        const anyCode = codePool[Math.floor(nextRandom() * codePool.length)];
        if (anyCode !== undefined && codesOnEntry.has(anyCode)) m.strongRandomBaseline += 1;
        const sameDomain = poolByDomain.get(first.domain) ?? [];
        const nearCode = sameDomain[Math.floor(nextRandom() * sameDomain.length)];
        if (nearCode !== undefined && codesOnEntry.has(nearCode)) {
          m.strongSameDomainBaseline += 1;
        }
      }
    }

    // ── Domain-tree labels. Only tokens carrying exactly one domain code and
    // exactly one sense are used: with several of each, MACULA's ordering of
    // `semanticSenses` does not track the order of the `domain` field, so a
    // positional pairing would manufacture disagreements that are not there.
    const domainCodes = (token.domain ?? "").trim().split(/\s+/).filter(Boolean);
    const senses = token.semanticSenses ?? [];
    const soleDomain = domainCodes[0];
    const soleSense = senses[0];
    if (domainCodes.length === 1 && senses.length === 1 && soleDomain && soleSense?.domain) {
      const qualified = qualifyUbsDomainCode("louw-nida", soleDomain);
      if (qualified) {
        let bag = m.domainLabels.get(qualified);
        if (!bag) {
          bag = new Set<string>();
          m.domainLabels.set(qualified, bag);
        }
        bag.add(soleSense.domain);
      }
    }

    // ── Gloss agreement.
    for (const sense of senses) {
      const parsed = parseLouwNidaCode(sense.id);
      if (!parsed) continue;
      const meanings = lookupLouwNidaMemo(parsed.code);
      if (meanings.length === 0) continue;
      m.glossTried += 1;
      const sdgntGlosses = new Set<string>();
      for (const meaning of meanings) {
        for (const gloss of meaning.glosses) sdgntGlosses.add(fold(gloss));
      }
      const parts = sense.label.split(/[,;]/).map(fold).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => sdgntGlosses.has(p))) {
        m.glossEveryPartMatched += 1;
      }
      if (parts.some((p) => sdgntGlosses.has(p))) m.glossAnyPartMatched += 1;
      else if (m.glossMissSamples.length < 8) {
        m.glossMissSamples.push(
          `${sense.id} macula=${JSON.stringify(sense.label)} ` +
            `sdgnt=[${[...sdgntGlosses].slice(0, 5).join(" | ")}]`,
        );
      }
    }
  }
  return m;
}

const join = measureJoin();

/** Every distinct raw `LEXEntryCode` SDGNT ships, and whether it parses. */
function rawGreekEntryCodes(): {
  distinct: Map<string, number>;
  unparsed: string[];
  meaningsSeen: number;
  meaningsWithEntryCode: number;
} {
  const distinct = new Map<string, number>();
  let meaningsSeen = 0;
  let meaningsWithEntryCode = 0;
  for (const entry of rawGreek) {
    for (const baseForm of entry.BaseForms ?? []) {
      for (const lex of baseForm.LEXMeanings ?? []) {
        meaningsSeen += 1;
        const code = lex.LEXEntryCode;
        if (typeof code !== "string" || code.trim() === "") continue;
        meaningsWithEntryCode += 1;
        distinct.set(code, (distinct.get(code) ?? 0) + 1);
      }
    }
  }
  const unparsed = [...distinct.keys()].filter((c) => parseLouwNidaCode(c) === null);
  return { distinct, unparsed, meaningsSeen, meaningsWithEntryCode };
}
const greekEntryCodes = rawGreekEntryCodes();

const pct = (numerator: number, denominator: number): number => {
  assert.ok(denominator > 0, "percentage denominator must be non-zero");
  return (numerator / denominator) * 100;
};

/* ========================================================================== *
 * 0. The fixtures are real
 *
 * Runs first and asserts every fixture is non-empty, so that no later test can
 * pass by iterating an empty collection.
 * ========================================================================== */

test("every fixture loaded is non-empty, so no later loop can pass vacuously", () => {
  assert.equal(index.version, 1);
  assert.ok(index.entryIds.length > 0, "index has no entries");
  assert.ok(index.meaningIds.length > 0, "index has no meanings");
  assert.equal(index.entryIds.length, index.entries.length);
  assert.equal(index.meaningIds.length, index.meanings.length);
  assert.ok(Object.keys(index.domains).length > 0, "index has no domain nodes");
  assert.ok(Object.keys(index.byStrong).length > 0, "byStrong is empty");
  assert.ok(Object.keys(index.byLouwNida).length > 0, "byLouwNida is empty");
  assert.ok(Object.keys(index.byRef).length > 0, "byRef is empty");
  assert.ok(Object.keys(index.byDomain).length > 0, "byDomain is empty");

  assert.ok(rawHebrew.length > 0, "raw SDBH is empty");
  assert.ok(rawGreek.length > 0, "raw SDGNT is empty");
  assert.ok(hebrewDomainNodes.length > 0, "SDBH domain tree is empty");
  assert.ok(greekDomainNodes.length > 0, "SDGNT domain tree is empty");
  assert.ok(parsedHebrew.entries.length > 0, "SDBH parsed to 0 entries");
  assert.ok(parsedGreek.entries.length > 0, "SDGNT parsed to 0 entries");

  assert.ok(join.tokens > 0, "no MACULA tokens were read");
  assert.ok(join.tokensWithLouwNida > 0, "no MACULA token carried a louwNida value");
  assert.ok(join.atomicOccurrences > 0, "no atomic Louw-Nida occurrence was parsed");
  assert.ok(join.distinctCodes.size > 0, "no distinct Louw-Nida code was seen");
  assert.ok(join.strongTried > 0, "the Strong's triangulation tried nothing");
  assert.ok(join.glossTried > 0, "the gloss comparison tried nothing");
  assert.ok(join.domainLabels.size > 0, "no unambiguous domain label was collected");
  assert.ok(greekEntryCodes.distinct.size > 0, "SDGNT shipped no LEXEntryCode at all");

  assert.equal(doctor.status, "healthy");
  assert.ok(Object.keys(doctor.counts).length > 0, "doctor report carries no counts");
});

/* ========================================================================== *
 * 1. THE LOUW-NIDA QUESTION
 * ========================================================================== */

test("Louw-Nida sameness 1/3 — MACULA and SDGNT use one code SYNTAX", () => {
  // Denominators first.
  assert.equal(join.tokens, 137_779, "MACULA token count moved");
  assert.equal(join.tokensWithLouwNida, 127_291);
  assert.equal(join.atomicOccurrences, 129_823);
  assert.equal(join.multiValueTokens, 2_393, "space-separated multi-value tokens");
  assert.ok(join.atomicOccurrences > join.tokensWithLouwNida);

  // Not one fragment of MACULA's 129,823 atomic values is unrecognised by the
  // parser written for SDGNT's LEXEntryCode. Same grammar, both sides.
  assert.deepEqual(
    join.unparsedFragments,
    [],
    `parseLouwNidaCode rejected MACULA values: ${join.unparsedFragments.join(", ")}`,
  );

  // Same domain range on both sides: exactly the 93 Louw-Nida domains.
  assert.equal(join.domainNumbers.size, 93, "MACULA does not use all 93 domains");
  assert.equal(Math.min(...join.domainNumbers), 1);
  assert.equal(Math.max(...join.domainNumbers), 93);

  const sdgntDomainNumbers = new Set<number>();
  const sdgntSenseLetters = new Set<string>();
  assert.ok(greekEntryCodes.distinct.size > 0);
  for (const raw of greekEntryCodes.distinct.keys()) {
    const parsed = parseLouwNidaCode(raw);
    if (!parsed) continue;
    sdgntDomainNumbers.add(parsed.domain);
    if (parsed.sense) sdgntSenseLetters.add(parsed.sense);
  }
  assert.equal(sdgntDomainNumbers.size, 93, "SDGNT does not use all 93 domains");
  assert.equal(Math.min(...sdgntDomainNumbers), 1);
  assert.equal(Math.max(...sdgntDomainNumbers), 93);

  // Same sense-letter space: `a`-`i`, nine letters, on both sides.
  assert.ok(join.senseLetters.size > 0, "MACULA carried no sense letters");
  const maculaLetters = [...join.senseLetters.keys()].sort();
  assert.deepEqual(maculaLetters, ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
  assert.deepEqual([...sdgntSenseLetters].sort(), maculaLetters);
});

test("Louw-Nida sameness 2/3 — the domain tree is the SAME tree", () => {
  const byId = new Map<string, UbsDomainNode>(greekDomainNodes.map((n) => [n.id, n]));
  assert.ok(byId.size > 0);
  assert.ok(join.domainLabels.size > 0);

  let tried = 0;
  let everyLabelIdentical = 0;
  let ubsLabelPresent = 0;
  let absentFromTree = 0;
  const disagreements: string[] = [];
  for (const [qualified, maculaLabels] of join.domainLabels) {
    tried += 1;
    assert.ok(maculaLabels.size > 0, `${qualified} collected no MACULA label`);
    const node = byId.get(qualified);
    if (!node) {
      absentFromTree += 1;
      disagreements.push(`${qualified} absent from the UBS tree`);
      continue;
    }
    const ubs = fold(node.label);
    const folded = [...maculaLabels].map(fold);
    if (folded.every((l) => l === ubs)) everyLabelIdentical += 1;
    if (folded.includes(ubs)) ubsLabelPresent += 1;
    else {
      disagreements.push(
        `${qualified} macula=${[...maculaLabels].map((l) => JSON.stringify(l)).join("/")} ` +
          `ubs=${JSON.stringify(node.label)}`,
      );
    }
  }

  assert.equal(tried, 665, "the set of unambiguously-labelled domain codes moved");
  assert.equal(absentFromTree, 0, `codes MACULA uses but the tree lacks: ${disagreements.join("; ")}`);
  // 664 of 665 agree outright. The one that does not is not a disagreement:
  // MACULA writes both the full label and the bare word "Time" for 067002, so
  // the UBS label is still one of the two. Hence `ubsLabelPresent` is 665/665.
  assert.equal(everyLabelIdentical, 664, disagreements.join("; "));
  assert.equal(ubsLabelPresent, 665, disagreements.join("; "));
  assert.ok(pct(everyLabelIdentical, tried) > 99.8);

  // And the heads of the tree are Louw-Nida's own heads, verbatim.
  assert.equal(greekDomainNodes.filter((n) => n.code.length === 3).length, 93);
  for (const [code, label] of Object.entries(UBS_DOMAIN_SCHEME_HEADS["louw-nida"])) {
    assert.equal(byId.get(`louw-nida:${code}`)?.label, label);
  }
  assert.equal(byId.get("louw-nida:093")?.label, "Names of Persons and Places");
});

test("Louw-Nida sameness 3/3 — a code means the same sense on both sides (Strong's triangulation, no prose)", () => {
  assert.ok(join.strongTried > 0);
  assert.equal(join.strongTried, 127_291);
  assert.equal(join.strongEntryFound, 118_307, "tokens whose Strong's number reached a UBS entry");
  assert.ok(join.strongEntryFound > 100_000, "the independent join found almost nothing");
  assert.equal(join.strongCodeOnSameEntry, 117_431);

  const agreement = pct(join.strongCodeOnSameEntry, join.strongEntryFound);
  assert.ok(agreement > 99.2, `triangulation agreement fell to ${agreement.toFixed(3)}%`);
  assert.ok(agreement < 100, "a perfect score here would mean the measurement is not measuring");
  assert.equal(agreement.toFixed(3), "99.260");

  // ── THE CONTROL. 99.26% means nothing on its own: if a UBS entry carried
  // most of the 7,075 codes, any code would score well. So the same question
  // is asked of codes the token does NOT carry, in the same pass.
  //
  // Bounds rather than exact counts: the draw is seeded and therefore
  // reproducible, but pinning a count would make this test a hostage to the
  // iteration order rather than to the claim.
  const randomRate = pct(join.strongRandomBaseline, join.strongEntryFound);
  const nearRate = pct(join.strongSameDomainBaseline, join.strongEntryFound);
  assert.ok(randomRate < 1, `random baseline is ${randomRate.toFixed(3)}% — too high to conclude`);
  assert.ok(
    nearRate < 10,
    `same-domain baseline is ${nearRate.toFixed(3)}% — too high to conclude`,
  );
  // Measured: 0.076% random, 3.078% same-domain, against 99.260% real. The
  // signal is three orders of magnitude above chance on the loose control and
  // still 32× above it on the tight one.
  assert.ok(agreement / randomRate > 100, "the real rate is not clear of the random baseline");
  assert.ok(agreement / nearRate > 10, "the real rate is not clear of the same-domain baseline");
  assert.ok(join.strongRandomBaseline > 0, "the control drew nothing — it is not running");

  // The residue is dominated by the {N:001} defect this file pins below —
  // κύριος 12.9 alone — not by any disagreement about what a code means.
  assert.ok(join.strongMissSamples.length > 0, "no miss sample was captured");
  assert.ok(
    join.strongMissSamples.some((s) => s.includes("κύριος") && s.includes("12.9")),
    `expected κύριος/12.9 among the misses, got: ${join.strongMissSamples.join(" ; ")}`,
  );
});

test("Louw-Nida corroboration — MACULA's sense labels are SDGNT's glosses", () => {
  // Weaker evidence than the triangulation above, and deliberately labelled as
  // such: MACULA's sense labels descend from the same UBS/SDBG line as SDGNT's
  // glosses (see the caveat on `MaculaToken.semanticSenses`). What it rules out
  // is a renumbering — if MACULA's `33.38` named a different sense than
  // SDGNT's `33.38`, these strings would not line up.
  assert.ok(join.glossTried > 0);
  assert.equal(join.glossTried, 128_567);
  assert.equal(join.glossEveryPartMatched, 127_836);
  assert.equal(join.glossAnyPartMatched, 128_340);
  assert.ok(pct(join.glossEveryPartMatched, join.glossTried) > 99.4);
  assert.ok(pct(join.glossAnyPartMatched, join.glossTried) > 99.8);

  // The residue is formatting, not disagreement: MACULA writes 71.8 as
  // "-ever (wherever, whatever, whoever, however)" where SDGNT lists those as
  // five separate glosses, and MACULA leaves UBS's `{D:49.5}` marker inside
  // its label where `parseUbsProse` strips it.
  assert.ok(join.glossMissSamples.length > 0);
  assert.ok(
    join.glossMissSamples.some((s) => s.startsWith("71.8 ")),
    `unexpected gloss misses: ${join.glossMissSamples.join(" ; ")}`,
  );
});

test("Louw-Nida OVERLAP is 99.900% of codes and 99.509% of occurrences — pinned, not rounded to agreement", () => {
  assert.ok(join.distinctCodes.size > 0);
  assert.equal(join.distinctCodes.size, 7_009, "distinct MACULA Louw-Nida values");
  assert.equal(join.distinctMatched.size, 7_002, "of those, resolvable in byLouwNida");
  assert.equal(join.occurrencesMatched, 129_185);
  assert.equal(join.atomicOccurrences - join.occurrencesMatched, 638);

  assert.equal(pct(join.distinctMatched.size, join.distinctCodes.size).toFixed(3), "99.900");
  assert.equal(pct(join.occurrencesMatched, join.atomicOccurrences).toFixed(3), "99.509");

  // It is NOT total, and the shortfall is named. Anyone reading only the
  // percentage would assume 100%; these seven codes are why they must not.
  const unmatched = [...join.unmatchedOccurrences.keys()].sort();
  assert.equal(unmatched.length, 7);
  assert.deepEqual(unmatched, ["12.5", "12.6", "12.7", "12.8", "12.9", "3.21", "33.403"]);

  // The module's own recorded measurement must agree with what we just took.
  assert.equal(UBS_GREEK_JOIN.maculaTokensTotal, join.tokens);
  assert.equal(UBS_GREEK_JOIN.maculaTokensWithLouwNida, join.tokensWithLouwNida);
  assert.equal(UBS_GREEK_JOIN.maculaDistinctAtomicLouwNida, join.distinctCodes.size);
  assert.equal(UBS_GREEK_JOIN.louwNidaValuesMatched, join.distinctMatched.size);
  assert.equal(UBS_GREEK_JOIN.louwNidaTokenOccurrencesMatched, join.occurrencesMatched);
  assert.equal(
    UBS_GREEK_JOIN.louwNidaTokenOccurrencePercent,
    Number(pct(join.occurrencesMatched, join.atomicOccurrences).toFixed(2)),
  );
});

test("the shortfall is 635 occurrences OUR parser drops and only 3 upstream really lacks", () => {
  // SDGNT ships 7,102 distinct LEXEntryCode strings; parseLouwNidaCode keys
  // 7,075 of them and silently drops 27.
  assert.ok(greekEntryCodes.distinct.size > 0);
  assert.equal(greekEntryCodes.distinct.size, 7_102);
  assert.equal(greekEntryCodes.distinct.size, UBS_GREEK_JOIN.sdgntDistinctEntryCodes);
  assert.equal(Object.keys(index.byLouwNida).length, 7_075);
  assert.equal(greekEntryCodes.unparsed.length, 27);

  // The 27 split cleanly in two, and only one half is a defect.
  const domain94 = greekEntryCodes.unparsed.filter((c) => c.startsWith("94.")).sort();
  const footnoted = greekEntryCodes.unparsed.filter((c) => c.includes("{N:")).sort();
  assert.equal(domain94.length + footnoted.length, greekEntryCodes.unparsed.length);

  // (a) 22 codes in a domain 94 that is NOT Louw-Nida. Louw-Nida has 93
  //     domains and the shipped LexicalDomains tree stops at `093`; SDGNT uses
  //     94.x as an extra bucket for phrasal and idiomatic senses (γυνή "to be
  //     married", ὄνομα "in the name of", δώδεκα "the twelve disciples").
  //     Rejecting them is CORRECT — and MACULA never cites domain 94, so the
  //     join loses nothing. Asserted so nobody "fixes" the 93 cap.
  assert.equal(domain94.length, 22);
  assert.equal(greekDomainNodes.filter((n) => n.code === "094").length, 0);
  assert.ok(!join.domainNumbers.has(94), "MACULA cites domain 94 after all");
  assert.equal(parseLouwNidaCode("94.1"), null);

  // (b) 5 codes that ARE Louw-Nida, lost to a footnote marker glued into the
  //     entry code. This is our bug, not upstream's: `decodeUbsReference`
  //     strips `{N:nnn}` from a reference string and `parseLouwNidaCode` does
  //     not strip it from an entry code.
  assert.deepEqual(footnoted, [
    "12.5{N:001}",
    "12.6{N:001}",
    "12.7{N:001}",
    "12.8{N:001}",
    "12.9{N:001}",
  ]);
  for (const raw of footnoted) {
    assert.equal(parseLouwNidaCode(raw), null, `${raw} unexpectedly parses`);
    // Strip the marker exactly as decodeUbsReference does and it parses fine —
    // so the code is well-formed Louw-Nida and only the wrapper defeats us.
    const stripped = raw.replace(/\{N:(-?\d+)\}/g, "");
    assert.ok(parseLouwNidaCode(stripped), `${stripped} should parse`);
  }

  // What that costs, in tokens on the page.
  //
  // The "resolves to nothing" assertions below would pass vacuously if the
  // lookup were broken for EVERY code, so a control runs first: 12.10 is the
  // next code up in the same domain and must resolve. Verified to matter — a
  // deliberate mutation that made every Louw-Nida lookup return nothing left
  // this block green until this control was added.
  const control = lookupUbsByLouwNida(index, "12.10");
  assert.equal(control.length, 1);
  assert.ok(
    (control[0]?.meanings.length ?? 0) > 0,
    "the control code 12.10 resolves to nothing — the lookup is broken, so " +
      "the 12.5-12.9 misses below would prove nothing",
  );

  const footnotedCodes = footnoted.map((raw) => raw.replace(/\{N:(-?\d+)\}/g, ""));
  let recoverableOccurrences = 0;
  assert.ok(footnotedCodes.length > 0);
  for (const code of footnotedCodes) {
    const lost = join.unmatchedOccurrences.get(code);
    assert.ok(lost !== undefined && lost > 0, `${code} was expected among the misses`);
    recoverableOccurrences += lost;
    const groups = lookupUbsByLouwNida(index, code);
    assert.equal(groups.length, 1, `${code} should parse to exactly one group`);
    assert.deepEqual(groups[0]?.meanings, [], `${code} is keyed after all`);
  }
  assert.equal(recoverableOccurrences, 635);
  assert.equal(join.unmatchedOccurrences.get("12.9"), 620, "κύριος is the bulk of it");

  // (c) Only 2 codes / 3 occurrences are genuine holes in SDGNT v1.1 — they
  //     sit in interior gaps of SDGNT's own numbering (3.20 and 3.22 exist,
  //     3.21 does not; 33.402 and 33.404 exist, 33.403 does not), so upstream
  //     dropped them rather than renumbering anything.
  const genuinelyAbsent = ["3.21", "33.403"];
  const entriesByDomain = new Map<number, number[]>();
  assert.ok(Object.keys(index.byLouwNida).length > 0);
  for (const code of Object.keys(index.byLouwNida)) {
    const parsed = parseLouwNidaCode(code);
    if (!parsed) continue;
    const bucket = entriesByDomain.get(parsed.domain) ?? [];
    bucket.push(parsed.entry);
    entriesByDomain.set(parsed.domain, bucket);
  }
  assert.ok(entriesByDomain.size > 0);
  let absentOccurrences = 0;
  for (const code of genuinelyAbsent) {
    const parsed = parseLouwNidaCode(code);
    assert.ok(parsed, `${code} should be syntactically valid`);
    assert.ok(
      !greekEntryCodes.distinct.has(code),
      `${code} is in SDGNT after all — it is not an upstream hole`,
    );
    const siblings = entriesByDomain.get(parsed.domain) ?? [];
    assert.ok(siblings.length > 0, `domain ${parsed.domain} has no entries`);
    assert.ok(
      siblings.some((e) => e < parsed.entry) && siblings.some((e) => e > parsed.entry),
      `${code} is not an interior gap; SDGNT may have renumbered instead of dropped`,
    );
    absentOccurrences += join.unmatchedOccurrences.get(code) ?? 0;
  }
  assert.equal(absentOccurrences, 3);
  assert.equal(recoverableOccurrences + absentOccurrences, 638);
});

test("a unified semantic-domain field is licensed for Greek ONLY as a namespaced field", () => {
  // Reason 1: SDBH has no Louw-Nida code to unify with. Measured on the raw
  // 22 MB file, not taken from the doctor report.
  let hebrewMeanings = 0;
  let hebrewWithEntryCode = 0;
  assert.ok(rawHebrew.length > 0);
  for (const entry of rawHebrew) {
    for (const baseForm of entry.BaseForms ?? []) {
      for (const lex of baseForm.LEXMeanings ?? []) {
        hebrewMeanings += 1;
        if (typeof lex.LEXEntryCode === "string" && lex.LEXEntryCode.trim() !== "") {
          hebrewWithEntryCode += 1;
        }
      }
    }
  }
  assert.equal(hebrewMeanings, 16_224);
  assert.equal(hebrewWithEntryCode, 0, "SDBH now carries entry codes — revisit the design");
  assert.ok(parsedHebrew.meanings.length > 0);
  assert.ok(parsedHebrew.meanings.every((m) => m.louwNida === undefined));
  assert.ok(parsedGreek.meanings.length > 0);
  assert.equal(parsedGreek.meanings.filter((m) => m.louwNida !== undefined).length, 9_150);

  // Reason 2: the two trees collide on bare codes and never agree on a label.
  const hebrewByCode = new Map(hebrewDomainNodes.map((n) => [n.code, n]));
  const greekByCode = new Map(greekDomainNodes.map((n) => [n.code, n]));
  assert.ok(hebrewByCode.size > 0 && greekByCode.size > 0);
  const collisions = [...hebrewByCode.keys()].filter((c) => greekByCode.has(c)).sort();
  assert.equal(collisions.length, 18, "the number of colliding bare codes moved");
  const agreeing = collisions.filter(
    (c) => fold(hebrewByCode.get(c)!.label) === fold(greekByCode.get(c)!.label),
  );
  assert.deepEqual(agreeing, [], "a bare code now agrees across trees");
  // The near-miss the module warns about, asserted rather than trusted.
  assert.equal(hebrewByCode.get("001002")?.label, "Regions On the Earth");
  assert.equal(greekByCode.get("001002")?.label, "Regions Above the Earth");
  assert.equal(hebrewByCode.get("004001")?.label, "Affirmers");
  assert.equal(greekByCode.get("004001")?.label, "Animals");

  // Reason 3: therefore every key in the shipped index is namespaced, and the
  // namespace is the only way to make one.
  const domainKeys = Object.keys(index.byDomain);
  assert.ok(domainKeys.length > 0);
  for (const key of domainKeys) {
    const split = splitUbsDomainCode(key);
    assert.ok(split, `byDomain key ${key} is not a qualified domain code`);
    assert.equal(qualifyUbsDomainCode(split.scheme, split.code), key);
  }
  assert.equal(UBS_DOMAIN_SCHEME_OF.sdbh, "sdbh");
  assert.equal(UBS_DOMAIN_SCHEME_OF.sdgnt, "louw-nida");
});

/* ========================================================================== *
 * 2. Keying, and real lookups by Strong's
 * ========================================================================== */

test("the index is keyed exactly as the importer claims", () => {
  assert.equal(Object.keys(index.byStrong).length, doctor.counts.byStrongKeys);
  assert.equal(Object.keys(index.byStrong).length, 14_120);
  assert.equal(Object.keys(index.byStrongConstituent).length, 279);
  assert.equal(Object.keys(index.byLouwNida).length, doctor.counts.byLouwNidaKeys);
  assert.equal(Object.keys(index.byLouwNida).length, 7_075);
  assert.equal(Object.keys(index.byDomain).length, 1_112);
  assert.equal(Object.keys(index.byRef).length, 31_168);
  assert.equal(Object.keys(index.domains).length, 1_149);
  assert.equal(index.entryIds.length, 13_439);
  assert.equal(index.meaningIds.length, 25_402);
});

test("every Strong's key in the index is canonical per strongs-key.ts", () => {
  const keys = Object.keys(index.byStrong);
  assert.ok(keys.length > 0, "byStrong is empty");
  const constituents = Object.keys(index.byStrongConstituent);
  assert.ok(constituents.length > 0, "byStrongConstituent is empty");

  let hebrew = 0;
  let greek = 0;
  for (const key of [...keys, ...constituents]) {
    // The join-key module is the only authority on normalisation, here as in
    // the importer: a key that does not survive its own round trip would
    // silently miss every lookup.
    const canonical = canonicalStrongsKey(key, { trustSuffixCase: true });
    assert.equal(canonical, key, `byStrong key ${key} is not canonical`);
    assert.ok(/^[HG]\d/.test(key), `${key} has no testament sigil`);
    if (key.startsWith("H")) hebrew += 1;
    else greek += 1;
  }
  assert.ok(hebrew > 0, "no Hebrew keys");
  assert.ok(greek > 0, "no Greek keys");

  // Every key resolves to at least one real entry — no dangling indices.
  for (const [key, entryIndices] of Object.entries(index.byStrong)) {
    assert.ok(entryIndices.length > 0, `byStrong[${key}] is empty`);
    for (const at of entryIndices) {
      assert.ok(readUbsEntry(index, at), `byStrong[${key}] points at missing entry ${at}`);
    }
  }
});

test("every Louw-Nida key parses, and points at real meanings", () => {
  const keys = Object.keys(index.byLouwNida);
  assert.ok(keys.length > 0, "byLouwNida is empty");
  for (const [key, meaningIndices] of Object.entries(index.byLouwNida)) {
    const parsed = parseLouwNidaCode(key);
    assert.ok(parsed, `byLouwNida key ${key} does not parse`);
    assert.equal(parsed.code, key, `${key} is not in normalised form`);
    assert.ok(meaningIndices.length > 0, `byLouwNida[${key}] is empty`);
    for (const at of meaningIndices) {
      const meaning = readUbsMeaning(index, at);
      assert.ok(meaning, `byLouwNida[${key}] points at missing meaning ${at}`);
      assert.equal(meaning.dictionary, "sdgnt", `${key} reached a Hebrew meaning`);
    }
  }
});

test("known Hebrew and Greek words resolve to non-empty entries", () => {
  // Four real words, each checked for content and not merely for presence: a
  // lookup that returned an entry with no gloss and no definition would be a
  // false pass.
  const cases: { key: string; lemma: string; gloss: string; louwNida?: string }[] = [
    { key: "H0430", lemma: "אֱלֹהִים", gloss: "heavenly beings" },
    { key: "H1254", lemma: "ברא", gloss: "to create" },
    { key: "G0026", lemma: "ἀγάπη", gloss: "to love", louwNida: "25.43" },
    { key: "G0749", lemma: "ἀρχιερεύς", gloss: "chief priest", louwNida: "53.88" },
  ];
  assert.ok(cases.length > 0);

  for (const expected of cases) {
    // The zero-padded form is what an upstream table would hand us; the join
    // key comes from strongs-key.ts, never from a hand-rolled trim.
    const canonical = canonicalStrongsKey(expected.key, { trustSuffixCase: true });
    assert.ok(canonical, `${expected.key} did not canonicalise`);
    assert.equal(padStrongsKey(canonical, 4), expected.key);

    const hit = lookupUbsByStrong(index, expected.key);
    assert.ok(hit, `no UBS entry for ${expected.key}`);
    assert.equal(hit.matchedKey, canonical);
    assert.equal(hit.matchedOn, "canonical");
    assert.ok(hit.entries.length > 0, `${expected.key} matched with zero entries`);

    const entry = hit.entries[0];
    assert.ok(entry);
    // NFC on both sides. UBS ships Greek in a non-NFC form — see the test
    // "UBS lemmas are not NFC" below — so a naive `===` on lemma strings
    // compares equal-looking strings that differ in bytes.
    assert.equal(entry.lemma.normalize("NFC"), expected.lemma.normalize("NFC"));
    assert.ok(entry.strongKeys.includes(canonical), `${canonical} absent from strongKeys`);
    assert.ok(entry.meaningIndices.length > 0, `${expected.lemma} has no meanings`);

    const meanings = entry.meaningIndices
      .map((at) => readUbsMeaning(index, at))
      .filter((m): m is UbsMeaningView => m !== null);
    assert.equal(meanings.length, entry.meaningIndices.length);
    assert.ok(meanings.length > 0);

    const glosses = meanings.flatMap((m) => m.glosses);
    assert.ok(glosses.length > 0, `${expected.lemma} carries no gloss at all`);
    assert.ok(
      glosses.includes(expected.gloss),
      `${expected.lemma} glosses ${JSON.stringify(glosses.slice(0, 6))} lack ${expected.gloss}`,
    );

    const first = meanings[0];
    assert.ok(first);
    assert.ok(
      (first.definitionShort ?? "").length > 20,
      `${expected.lemma} first meaning has no definition`,
    );
    assert.ok(first.references.length > 0, `${expected.lemma} cites no Scripture`);
    assert.ok(first.domains.length > 0, `${expected.lemma} carries no domain`);
    assert.ok(
      ubsDomainPath(index.domains, first.domains[0]).length > 0,
      `${expected.lemma}'s domain ${first.domains[0]} does not resolve to a label`,
    );

    if (expected.louwNida) {
      assert.equal(first.louwNida?.code, expected.louwNida);
      assert.equal(first.dictionary, "sdgnt");
      assert.equal(first.domains[0], `louw-nida:${String(first.louwNida.domain).padStart(3, "0")}`);
    } else {
      assert.equal(first.louwNida, undefined, "a Hebrew meaning carried a Louw-Nida code");
      assert.equal(first.dictionary, "sdbh");
      assert.ok(first.domains[0]?.startsWith("sdbh:"));
    }
  }
});

test("UBS lemmas are NOT NFC — a lemma join must normalise or it silently misses", () => {
  // Found by this test failing on `'ἀγάπη' !== 'ἀγάπη'`. UBS writes Greek with
  // the precomposed OXIA codepoints (U+1F71 GREEK SMALL LETTER ALPHA WITH
  // OXIA) where NFC uses TONOS (U+03AC). The strings render identically and
  // compare unequal, so this is exactly the defect that looks like clean data.
  //
  // It does not affect any join this repo makes — every UBS join goes through
  // a Strong's key or a Louw-Nida code, never through the lemma — but it is
  // pinned here so that if someone later keys on the lemma they meet the
  // problem in a test rather than in a word card that shows nothing.
  assert.ok(index.entries.length > 0);
  const nonNfc = index.entries.filter((e) => e.l !== e.l.normalize("NFC"));
  assert.ok(nonNfc.length > 0, "UBS lemmas are NFC after all — drop this warning");
  assert.equal(nonNfc.length, 7_990);
  assert.ok(
    nonNfc.length / index.entries.length > 0.5,
    "more than half of all lemmas should be affected",
  );

  const agape = lookupUbsByStrong(index, "G0026");
  assert.ok(agape);
  const shipped = agape.entries[0]!.lemma;
  assert.notEqual(shipped, "ἀγάπη", "the raw lemma unexpectedly equals the NFC form");
  assert.equal(shipped.normalize("NFC"), "ἀγάπη".normalize("NFC"));
  assert.ok(shipped.includes("ά"), "expected the OXIA codepoint U+1F71");

  // Hebrew is unaffected: SDBH's pointed lemmas are already NFC.
  const elohim = lookupUbsByStrong(index, "H0430");
  assert.ok(elohim);
  assert.equal(elohim.entries[0]!.lemma, "אֱלֹהִים");
});

test("elohim and bara land where a reader would expect, with real domain paths", () => {
  const elohim = lookupUbsByStrong(index, "H0430");
  assert.ok(elohim);
  const elohimMeanings = elohim.entries[0]!.meaningIndices
    .map((at) => readUbsMeaning(index, at))
    .filter((m): m is UbsMeaningView => m !== null);
  assert.ok(elohimMeanings.length > 0);
  assert.equal(elohimMeanings.length, 10, "SDBH gives elohim ten meanings");
  assert.deepEqual(ubsDomainPath(index.domains, elohimMeanings[0]!.domains[0]), [
    "Objects",
    "Regions Above the Earth",
    "Deities",
  ]);
  assert.ok(elohimMeanings[0]!.references.length > 100, "elohim cites too little");

  const bara = lookupUbsByStrong(index, "H1254");
  assert.ok(bara);
  const baraMeanings = bara.entries[0]!.meaningIndices
    .map((at) => readUbsMeaning(index, at))
    .filter((m): m is UbsMeaningView => m !== null);
  assert.ok(baraMeanings.length > 0);
  assert.ok(baraMeanings[0]!.glosses.includes("to create"));
  assert.deepEqual(ubsDomainPath(index.domains, baraMeanings[0]!.domains[0]), [
    "Events",
    "Position",
    "Existence",
    "Exist",
  ]);
  // Genesis 1:1 is in bara's reference list, which is the whole point of it.
  assert.ok(
    baraMeanings.some((m) => m.references.some((r) => r.ref === "GEN.1.1")),
    "bara does not cite GEN.1.1",
  );
});

test("the sense-letter fallback is what keeps the Hebrew join honest", () => {
  // OSHB letters H1254 as `1254 a`/`1254 b`; SDBH does not letter it at all.
  // Insisting on the letter would miss; the base fallback is why it does not.
  const exact = lookupUbsByStrong(index, "H1254");
  assert.ok(exact);
  assert.equal(exact.matchedOn, "canonical");

  const lettered = lookupUbsByStrong(index, "H1254a");
  assert.ok(lettered, "H1254a found nothing — the base fallback is gone");
  assert.equal(canonicalStrongsKey("H1254a", { trustSuffixCase: true }), "H1254a");
  assert.equal(baseStrongsKey("H1254a", { trustSuffixCase: true }), "H1254");
  assert.equal(lettered.matchedOn, "base");
  assert.equal(lettered.matchedKey, "H1254");
  assert.deepEqual(
    lettered.entries.map((e) => e.lemma),
    exact.entries.map((e) => e.lemma),
  );

  // And a key SDBH DOES letter resolves on the canonical form, not the base.
  const senseKeyed = Object.keys(index.byStrong).filter((k) => /^H\d+[A-Z]$/.test(k));
  assert.ok(senseKeyed.length > 0, "no sense-suffixed Hebrew key exists to test");
  const sample = senseKeyed[0]!;
  const senseHit = lookupUbsByStrong(index, sample);
  assert.ok(senseHit, `${sample} did not resolve`);
  assert.equal(senseHit.matchedOn, "canonical");
  assert.equal(senseHit.matchedKey, sample);

  // The recorded cost of insisting, re-checked for internal consistency.
  assert.equal(
    UBS_HEBREW_JOIN.baseJoinTokensMatched - UBS_HEBREW_JOIN.exactSuffixJoinTokensMatched,
    UBS_HEBREW_JOIN.suffixInsistenceCostTokens,
  );
  assert.ok(UBS_HEBREW_JOIN.suffixInsistenceCostTokens > 0);
});

test("multi-word headwords make constituent claims, not identity claims", () => {
  // "Ebenezer" must never attach to every occurrence of "stone".
  const folded = parseUbsStrongCodes(["H0068", "H0237"], "אֶבֶן הָאֶזֶל");
  assert.equal(folded.identity.length, 0, "a multi-word lemma claimed an identity");
  assert.equal(folded.constituent.length, 2);
  assert.deepEqual(folded.constituent.map((c) => c.canonical), ["H68", "H237"]);
  assert.ok(isMultiWordLemma("אֶבֶן הָאֶזֶל"));
  assert.ok(isMultiWordLemma("יָם־סוּף"), "the maqqef must count as a word break");
  assert.ok(!isMultiWordLemma("אֱלֹהִים"));

  // A single-word headword does claim identity.
  const single = parseUbsStrongCodes(["H0003", "A0004"], "אֵב");
  assert.equal(single.constituent.length, 0);
  assert.deepEqual(single.identity.map((c) => c.canonical), ["H3", "H4"]);
  assert.equal(single.identity[1]?.aramaic, true, "the A sigil was not recorded");

  // And the compound spelling routes the same way.
  const compound = parseUbsStrongCodes(["H0410+H1285"], "אֵל בְּרִית");
  assert.equal(compound.identity.length, 0);
  assert.deepEqual(compound.constituent[0]?.components, ["H410", "H1285"]);
  assert.equal(compound.constituent[0]?.compound, true);

  // H68 is contested in the shipped index, which is the fact that forced the
  // rule. Assert the entry count rather than trusting the comment.
  const stone = lookupUbsByStrong(index, "H0068");
  assert.ok(stone, "H68 vanished");
  assert.ok(stone.entries.length > 0);
  const containers = index.byStrongConstituent.H68 ?? [];
  assert.ok(containers.length > 0, "no entry merely CONTAINS H68 — the rule is untested");
  const containerLemmas = containers
    .map((at) => readUbsEntry(index, at))
    .filter((e): e is UbsEntryView => e !== null)
    .map((e) => e.lemma);
  assert.ok(containerLemmas.length > 0);
  assert.ok(
    containerLemmas.every((lemma) => isMultiWordLemma(lemma)),
    `a single-word lemma reached byStrongConstituent: ${containerLemmas.join(", ")}`,
  );
  assert.ok(
    !stone.entries.some((e) => isMultiWordLemma(e.lemma)),
    `a multi-word lemma claims H68 as an identity: ${stone.entries.map((e) => e.lemma).join(", ")}`,
  );
});

/* ========================================================================== *
 * 3. The domain hierarchy
 * ========================================================================== */

test("both domain trees load with the reported node counts and shapes", () => {
  assert.equal(hebrewDomainNodes.length, 411);
  assert.equal(hebrewDomainNodes.length, doctor.counts.sdbhDomainNodes);
  assert.equal(greekDomainNodes.length, 738);
  assert.equal(greekDomainNodes.length, doctor.counts.sdgntDomainNodes);
  assert.equal(
    hebrewDomainNodes.length + greekDomainNodes.length,
    Object.keys(index.domains).length,
  );
  assert.equal(Object.keys(index.domains).length, 1_149);

  // SDBH: four heads, up to five levels. Louw-Nida: 93 heads, two levels.
  const hebrewHeads = hebrewDomainNodes.filter((n) => n.code.length === 3);
  assert.equal(hebrewHeads.length, 4);
  for (const [code, label] of Object.entries(UBS_DOMAIN_SCHEME_HEADS.sdbh)) {
    assert.equal(hebrewDomainNodes.find((n) => n.code === code)?.label, label);
  }
  const hebrewDepths = new Set(hebrewDomainNodes.map((n) => n.code.length / 3));
  assert.deepEqual([...hebrewDepths].sort(), [1, 2, 3, 4, 5]);
  const greekDepths = new Set(greekDomainNodes.map((n) => n.code.length / 3));
  assert.deepEqual([...greekDepths].sort(), [1, 2]);
  assert.equal(greekDomainNodes.filter((n) => n.code.length === 3).length, 93);
  assert.equal(greekDomainNodes.filter((n) => n.code.length === 6).length, 645);

  // Every node is labelled, namespaced, and its parent exists.
  assert.ok(hebrewDomainNodes.length > 0 && greekDomainNodes.length > 0);
  for (const nodes of [hebrewDomainNodes, greekDomainNodes]) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    assert.ok(byId.size > 0);
    for (const node of nodes) {
      assert.ok(node.label.length > 0, `${node.id} has an empty label`);
      assert.ok(splitUbsDomainCode(node.id), `${node.id} is not a qualified code`);
      assert.equal(node.level, node.code.length / 3, `${node.id} level disagrees with depth`);
      if (node.parent) {
        assert.ok(byId.has(node.parent), `${node.id} names missing parent ${node.parent}`);
      } else {
        assert.equal(node.code.length, 3, `${node.id} is deep but parentless`);
      }
    }
  }
});

test("every domain code cited by a meaning resolves in its own tree", () => {
  // Referential integrity, from the parse rather than from the report.
  assert.deepEqual(parsedHebrew.diagnostics.domainCodesNotInTree, []);
  assert.deepEqual(parsedGreek.diagnostics.domainCodesNotInTree, []);

  const domainKeys = Object.keys(index.byDomain);
  assert.ok(domainKeys.length > 0);
  let resolved = 0;
  for (const key of domainKeys) {
    const node = index.domains[key];
    assert.ok(node, `byDomain key ${key} has no node in index.domains`);
    assert.ok(node.label.length > 0, `${key} resolves to an unlabelled node`);
    resolved += 1;
  }
  assert.equal(resolved, domainKeys.length);
  assert.equal(resolved, 1_112);
});

test("ancestry and paths walk a real hierarchy, and refuse a bare code", () => {
  assert.deepEqual(ubsDomainAncestry("sdbh:001002004"), [
    "sdbh:001",
    "sdbh:001002",
    "sdbh:001002004",
  ]);
  assert.deepEqual(ubsDomainPath(index.domains, "sdbh:001002004"), [
    "Objects",
    "Regions On the Earth",
    "Vegetation",
  ]);
  assert.deepEqual(ubsDomainAncestry("louw-nida:053005"), [
    "louw-nida:053",
    "louw-nida:053005",
  ]);
  const greekPath = ubsDomainPath(index.domains, "louw-nida:053005");
  assert.equal(greekPath.length, 2);
  assert.equal(greekPath[0], "Religious Activities");

  // A bare code is never a key, and never yields a path.
  assert.deepEqual(ubsDomainAncestry("001002004"), []);
  assert.deepEqual(ubsDomainPath(index.domains, "001002004"), []);
  assert.deepEqual(ubsDomainPath(index.domains, "001"), []);
});

/* ========================================================================== *
 * 4. Scripture references
 * ========================================================================== */

test("references decode to the reported totals, with nothing dropped", () => {
  // From the raw parse.
  const hebrewRefs = parsedHebrew.meanings.reduce((n, m) => n + m.references.length, 0);
  const greekRefs = parsedGreek.meanings.reduce((n, m) => n + m.references.length, 0);
  assert.ok(hebrewRefs > 0 && greekRefs > 0, "the parse decoded no references at all");
  assert.equal(hebrewRefs, 260_813);
  assert.equal(greekRefs, 130_923);
  assert.equal(hebrewRefs, doctor.counts.sdbhReferences);
  assert.equal(greekRefs, doctor.counts.sdgntReferences);
  assert.equal(parsedHebrew.diagnostics.referencesSeen, hebrewRefs);
  assert.equal(parsedGreek.diagnostics.referencesSeen, greekRefs);
  assert.equal(parsedHebrew.diagnostics.referencesUndecodable, 0);
  assert.equal(parsedGreek.diagnostics.referencesUndecodable, 0);
  assert.ok(parsedHebrew.meanings.every((m) => m.unparsedReferences.length === 0));
  assert.ok(parsedGreek.meanings.every((m) => m.unparsedReferences.length === 0));

  // Footnote markers really do appear inside reference strings, and are handled
  // rather than merely absent — assert the count is non-zero.
  assert.equal(parsedHebrew.diagnostics.referenceFootnotesInline, 2_697);
  assert.equal(parsedGreek.diagnostics.referenceFootnotesInline, 264);

  // And again from the built index, which stores them packed.
  let indexHebrew = 0;
  let indexGreek = 0;
  let undecodable = 0;
  const books = new Set<string>();
  assert.ok(index.meanings.length > 0);
  for (let i = 0; i < index.meanings.length; i += 1) {
    const packedList = index.meanings[i]?.r;
    if (!packedList) continue;
    const isGreek = index.meaningIds[i]!.startsWith("sdgnt:");
    for (const packed of packedList.split(" ")) {
      if (!packed) continue;
      const decoded = decodeUbsReference(packed);
      if (!decoded) {
        undecodable += 1;
        continue;
      }
      books.add(decoded.book);
      if (isGreek) indexGreek += 1;
      else indexHebrew += 1;
    }
  }
  assert.equal(undecodable, 0);
  assert.equal(indexHebrew, hebrewRefs);
  assert.equal(indexGreek, greekRefs);
  assert.equal(indexHebrew + indexGreek, 391_736);
  assert.equal(books.size, 66, "the two dictionaries do not span the whole canon");
  assert.equal(Object.keys(index.byRef).length, 31_168);
});

test("the packed reference encoding is BBBCCCVVVSSWWW with a MORPHEME word field", () => {
  // The README's own worked example: it calls WWW/2 = 6 "word element 6".
  const readmeExample = decodeUbsReference("00200300100012");
  assert.ok(readmeExample);
  assert.equal(readmeExample.book, "EXO");
  assert.equal(readmeExample.chapter, 3);
  assert.equal(readmeExample.verse, 1);
  assert.equal(readmeExample.segment, 0);
  assert.equal(readmeExample.word, 12);
  assert.equal(readmeExample.morpheme, 6);
  assert.equal(readmeExample.ref, "EXO.3.1");
  assert.equal(readmeExample.wholeUnit, false);
  assert.deepEqual(readmeExample.footnotes, []);

  // The module's verified case: SDBH אֵב (H3) cites SNG 6:11, morpheme 8.
  const av = decodeUbsReference("02200601100016");
  assert.ok(av);
  assert.equal(av.ref, "SNG.6.11");
  assert.equal(av.morpheme, 8);
  const avEntry = lookupUbsByStrong(index, "H0003");
  assert.ok(avEntry, "H3 vanished from the index");
  const avRefs = avEntry.entries
    .flatMap((e) => e.meaningIndices)
    .map((at) => readUbsMeaning(index, at))
    .filter((m): m is UbsMeaningView => m !== null)
    .flatMap((m) => m.references);
  assert.ok(avRefs.length > 0, "H3 cites nothing");
  assert.ok(
    avRefs.some((r) => r.packed === "02200601100016"),
    "the worked SNG 6:11 reference is not in the shipped index",
  );

  // Footnote markers, in all four shapes upstream ships.
  const oneFootnote = decodeUbsReference("00901201500040{N:001}");
  assert.ok(oneFootnote);
  assert.deepEqual(oneFootnote.footnotes, ["001"]);
  assert.equal(oneFootnote.packed.length, 14);
  const negative = decodeUbsReference("01100400700050{N:-033}");
  assert.ok(negative);
  assert.deepEqual(negative.footnotes, ["-033"]);
  const two = decodeUbsReference("01804100700002{N:002}{N:003}");
  assert.ok(two);
  assert.deepEqual(two.footnotes, ["002", "003"]);
  const parenthesised = decodeUbsReference("06300100300004({N:003})");
  assert.ok(parenthesised);
  assert.deepEqual(parenthesised.footnotes, ["003"]);
  // Paratext book 063 is 2JN — the 1-based index into BOOK_CODES, so the
  // Johannine letters sit at 062/063/064 and an off-by-one here would be
  // invisible without naming the book.
  assert.equal(parenthesised.ref, "2JN.1.3");
  const bang = decodeUbsReference("01300202400022!{N:001}");
  assert.ok(bang);
  assert.deepEqual(bang.footnotes, ["001"]);

  // A whole-unit reference is flagged rather than silently read as verse 0.
  const wholeChapter = decodeUbsReference("00100100000000");
  assert.ok(wholeChapter);
  assert.equal(wholeChapter.wholeUnit, true);
  assert.equal(wholeChapter.morpheme, null);
});

test("byRef resolves a verse to meanings that really cite it", () => {
  const hits = index.byRef["GEN.1.1"];
  assert.ok(hits && hits.length > 0, "no meaning cites GEN.1.1");
  const meanings = hits
    .map((at) => readUbsMeaning(index, at))
    .filter((m): m is UbsMeaningView => m !== null);
  assert.equal(meanings.length, hits.length);
  assert.ok(meanings.length > 0);
  for (const meaning of meanings) {
    assert.ok(
      meaning.references.some((r) => r.ref === "GEN.1.1"),
      `${meaning.id} is indexed under GEN.1.1 but does not cite it`,
    );
  }
  assert.ok(
    meanings.some((m) => m.lemma === "ברא"),
    "GEN.1.1 does not reach bara",
  );

  const greekHits = index.byRef["JHN.1.1"];
  assert.ok(greekHits && greekHits.length > 0, "no meaning cites JHN.1.1");
  const greekMeanings = greekHits
    .map((at) => readUbsMeaning(index, at))
    .filter((m): m is UbsMeaningView => m !== null);
  assert.ok(greekMeanings.length > 0);
  assert.ok(greekMeanings.every((m) => m.references.some((r) => r.ref === "JHN.1.1")));
});

/* ========================================================================== *
 * 5. Adversarial input invents nothing
 * ========================================================================== */

test("adversarial Strong's input returns null rather than inventing an entry", () => {
  const rubbish: unknown[] = [
    null,
    undefined,
    "",
    "   ",
    "H",
    "G",
    "banana",
    "H0",
    "0430",
    "430",
    "H430 H1254",
    "H430;DROP TABLE",
    "sdbh:000396000000000",
    "H99999",
    "G99999",
    "H-1",
    "H1.5",
    "{N:001}",
    "12.9",
    42,
    {},
    [],
    ["H430"],
    Number.NaN,
    "H430 ",
  ];
  assert.ok(rubbish.length > 0);
  for (const value of rubbish) {
    assert.equal(
      lookupUbsByStrong(index, value),
      null,
      `lookupUbsByStrong invented an entry for ${JSON.stringify(value)}`,
    );
  }
  // The control: the shape these all fail is a shape that DOES work, so the
  // test is not passing because the lookup is broken for everything.
  assert.ok(lookupUbsByStrong(index, "H430"), "the control lookup failed");
});

test("adversarial Louw-Nida input returns null or an empty list", () => {
  const bad = [
    null,
    undefined,
    "",
    " ",
    "12",
    "12.",
    ".5",
    "0.5",
    "94.1",
    "99.1",
    "-1.2",
    "12.9A",
    "12.9aa",
    "12.9{N:001}",
    "12.5 12.6",
    "twelve.nine",
    42,
    {},
  ];
  assert.ok(bad.length > 0);
  for (const value of bad) {
    assert.equal(
      parseLouwNidaCode(value),
      null,
      `parseLouwNidaCode accepted ${JSON.stringify(value)}`,
    );
  }
  assert.ok(parseLouwNidaCode("12.9"), "the control code failed to parse");
  assert.equal(parseLouwNidaCode(" 12.9 ")?.code, "12.9", "trimming stopped working");

  // Where the parser is LENIENT, recorded so nobody relies on it being strict:
  // a zero-padded entry code is accepted and normalised to the unpadded form.
  // This is safe precisely because it normalises — `012.009` and `12.9` cannot
  // both become keys — but it means the input is not a canonical-form check.
  assert.equal(parseLouwNidaCode("012.009")?.code, "12.9");
  assert.equal(parseLouwNidaCode("012.009")?.qualifiedDomain, "louw-nida:012");
  // And the domain digits are a different namespace from the entry code: the
  // qualified domain is zero-padded to three, the entry code never is.
  assert.equal(parseLouwNidaCode("12.9")?.qualifiedDomain, "louw-nida:012");

  // A list keeps what it recognised and reports the rest; it never guesses.
  const list = parseLouwNidaList("10.24 33.19 banana 94.1");
  assert.deepEqual(list.codes.map((c) => c.code), ["10.24", "33.19"]);
  assert.deepEqual(list.unparsed, ["banana", "94.1"]);

  assert.deepEqual(lookupUbsByLouwNida(index, "banana"), []);
  assert.deepEqual(lookupUbsByLouwNida(index, null), []);
  const unknown = lookupUbsByLouwNida(index, "93.9999");
  assert.equal(unknown.length, 1, "a syntactically valid code should still be reported");
  assert.deepEqual(unknown[0]?.meanings, [], "an unknown code invented meanings");
  // Control.
  assert.ok(lookupUbsByLouwNida(index, "25.43")[0]!.meanings.length > 0);
});

test("adversarial domain codes and references are refused", () => {
  for (const value of ["01", "0012", "1", "abc", "", "001 002", "001-002", null, 1, "0010021"]) {
    assert.equal(
      qualifyUbsDomainCode("sdbh", value),
      null,
      `qualifyUbsDomainCode accepted ${JSON.stringify(value)}`,
    );
    assert.equal(qualifyUbsDomainCode("louw-nida", value), null);
  }
  assert.equal(qualifyUbsDomainCode("sdbh", "001002004"), "sdbh:001002004");
  assert.equal(qualifyUbsDomainCode("louw-nida", " 053005 "), "louw-nida:053005");

  for (const value of ["001002", "sdgnt:001002", "hebrew:001", "louw-nida:12", "sdbh:", ":001", null, 7]) {
    assert.equal(
      splitUbsDomainCode(value),
      null,
      `splitUbsDomainCode accepted ${JSON.stringify(value)}`,
    );
  }
  assert.deepEqual(splitUbsDomainCode("louw-nida:053005"), {
    scheme: "louw-nida",
    code: "053005",
  });

  for (const value of [
    "",
    "abc",
    "0020030010001",
    "002003001000123",
    "09900100100002",
    "00000100100002",
    "06700100100002",
    null,
    12,
  ]) {
    assert.equal(
      decodeUbsReference(value),
      null,
      `decodeUbsReference accepted ${JSON.stringify(value)}`,
    );
  }
  assert.ok(decodeUbsReference("00200300100012"), "the control reference failed");
});

test("upstream data defects in StrongCodes are named, never guessed", () => {
  const notAString = parseUbsStrongCode(null);
  assert.equal(notAString.ok, false);
  assert.equal(notAString.ok === false && notAString.reason, "not-a-string");

  const empty = parseUbsStrongCode("");
  assert.equal(empty.ok, false);
  assert.equal(empty.ok === false && empty.reason, "empty");

  const prose = parseUbsStrongCode("Reinier de Blois");
  assert.equal(prose.ok, false);
  assert.equal(prose.ok === false && prose.reason, "prose-not-a-code");

  // A sigil-less number is refused by default and settled only on request.
  const bare = parseUbsStrongCode("2062");
  assert.equal(bare.ok, false);
  assert.equal(bare.ok === false && bare.reason, "bare-number");
  const settled = parseUbsStrongCode("2062", { assumeTestament: "H" });
  assert.equal(settled.ok, true);
  assert.equal(settled.ok && settled.canonical, "H2062");

  // The A sigil is a language tag, not a numbering.
  const aramaic = parseUbsStrongCode("A0004");
  assert.equal(aramaic.ok, true);
  assert.equal(aramaic.ok && aramaic.canonical, "H4");
  assert.equal(aramaic.ok && aramaic.aramaic, true);

  // A lower-case sense letter is canonicalised upward, base kept separately.
  const sense = parseUbsStrongCode("H0205a");
  assert.equal(sense.ok, true);
  assert.equal(sense.ok && sense.canonical, "H205A");
  assert.equal(sense.ok && sense.base, "H205");
  assert.equal(sense.ok && sense.senseSuffix, "A");

  // The compound that strongs-key.ts refuses whole, split by this module.
  const compound = parseUbsStrongCode("H1237+H0205a");
  assert.equal(compound.ok, true);
  assert.deepEqual(compound.ok && compound.components, ["H1237", "H205A"]);

  // These rejections are exactly the ones the shipped parse recorded.
  assert.deepEqual(parsedHebrew.diagnostics.strongCodesRejected, {
    empty: 26,
    "prose-not-a-code": 3,
    "bare-number": 2,
  });
  assert.deepEqual(parsedGreek.diagnostics.strongCodesRejected, {});
  assert.ok(parsedHebrew.diagnostics.strongCodeRejectionSamples.length > 0);
});

test("a malformed dictionary throws instead of parsing to a well-formed nothing", () => {
  for (const value of [null, undefined, {}, "", 0, { entries: [] }]) {
    assert.throws(
      () => parseUbsDictionary("sdbh", value),
      /expected a top-level JSON array/,
      `parseUbsDictionary accepted ${JSON.stringify(value)}`,
    );
    assert.throws(
      () => parseUbsDomainTree("sdbh", value),
      /expected a top-level JSON array/,
      `parseUbsDomainTree accepted ${JSON.stringify(value)}`,
    );
  }
  // An empty array is a legal array and a nonsense dictionary; the guard that
  // catches it lives in buildUbsIndex, so check it there.
  assert.throws(() => buildUbsIndex({ generatedAt: "x", parts: [] }), /no dictionaries supplied/);
  const emptyParse = parseUbsDictionary("sdbh", []);
  assert.equal(emptyParse.entries.length, 0);
  assert.throws(
    () =>
      buildUbsIndex({
        generatedAt: "x",
        parts: [
          {
            parsed: emptyParse,
            domainNodes: hebrewDomainNodes,
            sourceSha256: "x",
            sourceBytes: 1,
            domainSha256: "x",
            domainBytes: 1,
          },
        ],
      }),
    /parsed 0 entries/,
  );
  // And a real dictionary with no domain tree is refused too.
  assert.throws(
    () =>
      buildUbsIndex({
        generatedAt: "x",
        parts: [
          {
            parsed: parsedGreek,
            domainNodes: [],
            sourceSha256: "x",
            sourceBytes: 1,
            domainSha256: "x",
            domainBytes: 1,
          },
        ],
      }),
    /parsed 0 domain nodes/,
  );
});

test("reading past the end of the index returns null, not a blank record", () => {
  assert.equal(readUbsEntry(index, -1), null);
  assert.equal(readUbsEntry(index, index.entries.length), null);
  assert.equal(readUbsEntry(index, 1e9), null);
  assert.equal(readUbsMeaning(index, -1), null);
  assert.equal(readUbsMeaning(index, index.meanings.length), null);
  // Controls.
  assert.ok(readUbsEntry(index, 0), "entry 0 does not read");
  assert.ok(readUbsMeaning(index, 0), "meaning 0 does not read");
});

/* ========================================================================== *
 * 6. The parse reproduces the importer's counts from the raw bytes
 * ========================================================================== */

test("re-parsing the raw files reproduces every count the importer reported", () => {
  assert.equal(parsedHebrew.entries.length, 7_932);
  assert.equal(parsedHebrew.entries.length, doctor.counts.sdbhEntries);
  assert.equal(parsedHebrew.meanings.length, 16_224);
  assert.equal(parsedHebrew.meanings.length, doctor.counts.sdbhMeanings);
  assert.equal(parsedGreek.entries.length, 5_507);
  assert.equal(parsedGreek.entries.length, doctor.counts.sdgntEntries);
  assert.equal(parsedGreek.meanings.length, 9_178);
  assert.equal(parsedGreek.meanings.length, doctor.counts.sdgntMeanings);

  const hebrewStrongKeys = new Set(parsedHebrew.entries.flatMap((e) => e.strongKeys));
  assert.ok(hebrewStrongKeys.size > 0);
  assert.equal(hebrewStrongKeys.size, 8_728);
  assert.equal(hebrewStrongKeys.size, doctor.counts.sdbhStrongKeys);

  const greekLouwNida = new Set(
    parsedGreek.meanings.map((m) => m.louwNida?.code).filter((c): c is string => Boolean(c)),
  );
  assert.ok(greekLouwNida.size > 0);
  assert.equal(greekLouwNida.size, 7_075);
  assert.equal(greekLouwNida.size, doctor.counts.sdgntLouwNidaCodes);
  assert.deepEqual([...greekLouwNida].sort(), Object.keys(index.byLouwNida).sort());

  // The entry counts in the index match the parse, per dictionary.
  const hebrewInIndex = index.entryIds.filter((id) => id.startsWith("sdbh:")).length;
  const greekInIndex = index.entryIds.filter((id) => id.startsWith("sdgnt:")).length;
  assert.equal(hebrewInIndex, parsedHebrew.entries.length);
  assert.equal(greekInIndex, parsedGreek.entries.length);
  assert.equal(hebrewInIndex + greekInIndex, doctor.counts.entriesTotal);

  // Diagnostics that are claims: a zero here means something was checked.
  assert.equal(parsedHebrew.diagnostics.meaningsWithoutSense, 0);
  assert.equal(parsedGreek.diagnostics.meaningsWithoutSense, 0);
  assert.deepEqual(parsedHebrew.diagnostics.unknownInlineTags, {});
  assert.deepEqual(parsedGreek.diagnostics.unknownInlineTags, {});
  assert.deepEqual(parsedHebrew.diagnostics.senseLanguages, { en: 16_224 });
  assert.deepEqual(parsedGreek.diagnostics.senseLanguages, { en: 9_178 });
  assert.equal(parsedHebrew.diagnostics.entriesWithoutStrongCode, 5);
  assert.equal(parsedGreek.diagnostics.entriesWithoutStrongCode, 110);
  assert.equal(parsedHebrew.diagnostics.aramaicSigilCodes, 655);
  assert.deepEqual(parsedHebrew.diagnostics.aramaicHebrewNumberClashes, [
    "H3879",
    "H6211",
    "H8412",
  ]);
  assert.equal(parsedHebrew.diagnostics.contestedIdentityKeys.length, 38);
  assert.equal(parsedGreek.diagnostics.contestedIdentityKeys.length, 4);
  assert.equal(parsedHebrew.diagnostics.htmlEscapedLinks, 1);

  // Inline markers really were found — non-zero before any conclusion.
  assert.ok((parsedHebrew.diagnostics.inlineMarkerCounts.link ?? 0) > 0);
  assert.equal(parsedHebrew.diagnostics.inlineMarkerCounts.link, 9_599);
  assert.ok((parsedGreek.diagnostics.inlineMarkerCounts["domain-xref"] ?? 0) > 0);
  assert.equal(parsedGreek.diagnostics.inlineMarkerCounts["domain-xref"], 2_362);

  // Every doctor check passed, and there is more than one of them.
  const checks = Object.entries(doctor.checks);
  assert.ok(checks.length > 20, `only ${checks.length} doctor checks exist`);
  for (const [name, ok] of checks) assert.equal(ok, true, `doctor check ${name} failed`);
});

test("the undocumented {D:} marker is modelled, and prose markers round-trip", () => {
  // `{D:}` is the second-commonest marker in SDGNT and appears in no README.
  const prose = parseUbsProse("to love {D:25.44} deeply {N:001} see {S:04000500900012}");
  assert.ok(prose.markers.length > 0);
  assert.equal(prose.markers.length, 3);
  const xref = prose.markers.find((m) => m.kind === "domain-xref");
  assert.ok(xref && xref.kind === "domain-xref");
  assert.equal(xref.code, "25.44");
  assert.equal(xref.louwNida?.code, "25.44");
  const ref = prose.markers.find((m) => m.kind === "reference");
  assert.ok(ref && ref.kind === "reference");
  assert.equal(ref.reference?.ref, "MAT.5.9");
  assert.ok(!prose.text.includes("{"), `markers survived stripping: ${prose.text}`);
  assert.ok(prose.text.includes("to love"), "stripping ate the prose");

  // The two link shapes, which differ by dictionary and are documented nowhere.
  const hebrewLink = parseUbsProse("see {L:Ahasuerus<SDBH:אֲחַשְׁוֵרֹושׁ>}").markers[0];
  assert.ok(hebrewLink && hebrewLink.kind === "link");
  assert.equal(hebrewLink.dictionary, "SDBH");
  assert.equal(hebrewLink.target, "אֲחַשְׁוֵרֹושׁ");
  assert.equal(hebrewLink.targetId, undefined);
  const greekLink = parseUbsProse("see {L:ἀγάπη<SDBG:ἀγάπη:000000>}").markers[0];
  assert.ok(greekLink && greekLink.kind === "link");
  assert.equal(greekLink.dictionary, "SDBG", "the inner Greek tag is SDBG, not SDGNT");
  assert.equal(greekLink.targetId, "000000");

  // The one HTML-escaped link upstream ships is repaired AND flagged.
  const escaped = parseUbsProse("{L:Israel&lt;SDBH:יִשְׂרָאֵל&gt;}").markers[0];
  assert.ok(escaped && escaped.kind === "link");
  assert.equal(escaped.htmlEscaped, true);
  assert.equal(escaped.target, "יִשְׂרָאֵל");

  // An unknown tag is surfaced, never dropped.
  const unknown = parseUbsProse("{Z:whatever}").markers[0];
  assert.ok(unknown && unknown.kind === "unknown");
  assert.equal(unknown.tag, "Z");
});

/* ========================================================================== *
 * 7. Attribution — CC BY-SA is not optional paperwork
 * ========================================================================== */

test("both attribution strings appear VERBATIM in the shipped upstream READMEs", () => {
  const dictionariesReadme = readFileSync(resolve(UBS_DIR, "dictionaries-README.md"), "utf8");
  const hebrewReadme = readFileSync(resolve(UBS_DIR, "hebrew-README.md"), "utf8");
  const greekReadme = readFileSync(resolve(UBS_DIR, "greek-README.md"), "utf8");
  assert.ok(dictionariesReadme.length > 0 && hebrewReadme.length > 0 && greekReadme.length > 0);

  // Byte-for-byte, in two places each. If the transcription had been tidied
  // these would fail, which is the point.
  assert.ok(
    dictionariesReadme.includes(UBS_ATTRIBUTION.sdbh),
    "the SDBH attribution is not verbatim in dictionaries-README.md",
  );
  assert.ok(hebrewReadme.includes(UBS_ATTRIBUTION.sdbh));
  assert.ok(
    dictionariesReadme.includes(UBS_ATTRIBUTION.sdgnt),
    "the SDGNT attribution is not verbatim in dictionaries-README.md",
  );
  assert.ok(greekReadme.includes(UBS_ATTRIBUTION.sdgnt));

  // The two transcription hazards, asserted by codepoint so a "tidy" fails.
  assert.ok(
    UBS_ATTRIBUTION.sdbh.includes("United Bible Societies, 2023.  Adapted"),
    "the SDBH double space after 2023. was normalised away",
  );
  // The soft hyphen is inside the LEXICON TITLE only — "Greek-English Lexicon
  // of the New Testa­ment" — while the dictionary's own title two clauses
  // earlier spells "New Testament" plainly. So the assertion is on the count
  // and the position, not on the absence of the plain spelling.
  assert.equal(
    (UBS_ATTRIBUTION.sdgnt.match(/­/g) ?? []).length,
    1,
    "the SDGNT attribution should carry exactly one soft hyphen",
  );
  assert.ok(
    UBS_ATTRIBUTION.sdgnt.includes("of the New Testa­ment: Based on Semantic Domains"),
    "the soft hyphen moved out of the lexicon title",
  );
  assert.ok(
    UBS_ATTRIBUTION.sdgnt.startsWith("UBS Dictionary of New Testament Greek,"),
    "the plain spelling in the dictionary's own title was altered",
  );

  // The Greek notice is a three-link chain; citing only "UBS" drops Louw and Nida.
  for (const fragment of ["United Bible Societies", "Louw", "Nida", "1988, 1989"]) {
    assert.ok(UBS_ATTRIBUTION.sdgnt.includes(fragment), `chain link ${fragment} is missing`);
  }

  // The index carries the licence and the riders forward.
  assert.equal(index.license, UBS_LICENSE);
  assert.equal(index.license, "CC BY-SA 4.0");
  assert.deepEqual(index.attribution, UBS_ATTRIBUTION);
  assert.ok(index.licenseRiders.length > 0, "the index dropped the licence riders");
  assert.equal(index.licenseRiders.length, UBS_LICENSE_RIDERS.length);
  assert.ok(
    index.licenseRiders.some((r) => r.includes("ShareAlike")),
    "the ShareAlike rider is gone",
  );
  // The SIL rider, and the sentence in the shipped README it rests on.
  assert.ok(index.licenseRiders.some((r) => r.includes("Summer Institute of Linguistics")));
  assert.ok(
    greekReadme.includes("kindly made available by the Summer Institute of Linguistics (SIL)"),
    "the SIL credit is not where the rider says it is",
  );
  assert.ok(index.domainSchemeWarning.includes("NAMESPACED"));
  assert.ok(index.readme.length > 0, "the index ships no self-description");
});
