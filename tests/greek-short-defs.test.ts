import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  parseMounceDictionary,
  parseTbesgLexicon,
  buildGreekShortDefIndex,
  checkGreekShortDefIndex,
  pickCardGloss,
  shortDefWordCount,
  CARD_GLOSS_WORD_BUDGET,
  GREEK_SHORT_DEF_SOURCES,
  MOUNCE_FIELD_SEPARATOR,
  MOUNCE_JSON_IS_LOSSY,
  MOUNCE_REQUIRED_ATTRIBUTION,
  MOUNCE_REQUIRED_ATTRIBUTION_ONE_LINE,
  TBESG_COLUMNS,
  TBESG_FIRST_DATA_LINE,
  TBESG_HEADER_LINE,
  TBESG_MEANING_COLUMN_LABEL,
  TBESG_REDISTRIBUTION_RIDER,
  TBESG_REQUIRED_ATTRIBUTION,
  type GreekShortDefIndex,
} from "../src/core/language/greek-short-defs.js";
import { isGkNumber, parseStrongsKey } from "../src/core/language/strongs-key.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, "../data/scripture/lexicons/greek-short-defs");
const MOUNCE_PATH = resolve(DIR, "Mounce-Concise-Greek-English-Dictionary-teknia.com-NC.txt");
const TBESG_PATH = resolve(DIR, "TBESG-STEPBible-CC-BY.txt");
const INDEX_PATH = resolve(DIR, "greek-short-defs-index.json");
const DOCTOR_PATH = resolve(DIR, "doctor-report.json");

// Real fixtures: the shipped source files themselves, parsed once and shared.
const mounceText = readFileSync(MOUNCE_PATH, "utf8");
const tbesgText = readFileSync(TBESG_PATH, "utf8");
const mounce = parseMounceDictionary(mounceText);
const tbesg = parseTbesgLexicon(tbesgText);
const index = buildGreekShortDefIndex({
  mounce,
  tbesg,
  generatedAt: "2026-07-26T00:00:00.000Z",
  inputs: {
    mounce: {
      file: "test",
      bytes: statSync(MOUNCE_PATH).size,
      sha256: createHash("sha256").update(readFileSync(MOUNCE_PATH)).digest("hex"),
      retrievedFrom: "test",
    },
    tbesg: {
      file: "test",
      bytes: statSync(TBESG_PATH).size,
      sha256: createHash("sha256").update(readFileSync(TBESG_PATH)).digest("hex"),
      retrievedFrom: "test",
    },
  },
});

const NBSP = " ";

// ───────────────────────────────────────────────────────────────────────────
// Provenance and licence — verbatim, and present in the actual files
// ───────────────────────────────────────────────────────────────────────────

test("Mounce required attribution is the exact three-line block from the release", () => {
  assert.equal(
    MOUNCE_REQUIRED_ATTRIBUTION,
    "Mounce Concise Greek-English Dictionary\n" +
      "Copyright 1993 All Rights Reserved\n" +
      "www.teknia.com/greek-dictionary",
  );
  // The one-line form must be the same words, joined, and nothing else — a
  // paraphrase in a footer would not satisfy "made publically visible".
  assert.equal(
    MOUNCE_REQUIRED_ATTRIBUTION_ONE_LINE,
    MOUNCE_REQUIRED_ATTRIBUTION.split("\n").join(" "),
  );
  assert.equal(
    MOUNCE_REQUIRED_ATTRIBUTION_ONE_LINE,
    "Mounce Concise Greek-English Dictionary Copyright 1993 All Rights Reserved www.teknia.com/greek-dictionary",
  );
  // The dictionary's own first line names itself, which is how the file is
  // identified without trusting the filename we chose.
  assert.equal(mounceText.split("\n")[0], "Mounce Concise Greek-English Dictionary");
});

test("TBESG required attribution and its redistribution rider are verbatim from the file", () => {
  const lines = tbesgText.replace(/^﻿/, "").split("\n");
  // Line 12 (1-based): the attribution. Leading/trailing tabs are layout.
  assert.equal(lines[11]?.replace(/^\t/, "").replace(/\t+$/, ""), TBESG_REQUIRED_ATTRIBUTION);
  assert.match(TBESG_REQUIRED_ATTRIBUTION, /www\.STEPBible\.org/);
  // The upstream DOUBLE space after "at" is part of the string.
  assert.ok(TBESG_REQUIRED_ATTRIBUTION.includes("at  Tyndale House"));

  // Line 19 (1-based): a rider inside a file labelled CC BY. Not new — the
  // byte-identical clause already ships in TIPNR/TEGMC/TEHMC — but the parity
  // doc's §5 table records TBESG as a flat "CC BY 4.0", so it is pinned here.
  assert.equal(lines[18]?.replace(/^\t/, "").trimEnd(), TBESG_REDISTRIBUTION_RIDER);
  assert.match(TBESG_REDISTRIBUTION_RIDER, /Please do not redistribute it yourself\./);

  // Column 8's own label, upstream typo and double space intact.
  assert.equal(lines[TBESG_HEADER_LINE - 1]?.split("\t")[7], TBESG_MEANING_COLUMN_LABEL);
  assert.ok(TBESG_MEANING_COLUMN_LABEL.includes("occationally"));
});

test("every source record carries a non-empty required attribution and a licence", () => {
  const ids = Object.keys(GREEK_SHORT_DEF_SOURCES);
  assert.equal(ids.length, 4);
  assert.deepEqual(ids.sort(), [
    "mounce",
    "tbesg-abbott-smith",
    "tbesg-middle-liddell",
    "tbesg-stepbible",
  ]);
  for (const [id, source] of Object.entries(GREEK_SHORT_DEF_SOURCES)) {
    assert.ok(source.requiredAttribution.trim().length > 0, `${id} has no attribution`);
    assert.ok(source.license.trim().length > 0, `${id} has no licence`);
    assert.ok(source.url.trim().length > 0, `${id} has no url`);
  }
  // Mounce is NOT CC BY, and the record must not imply it is.
  assert.ok(!/CC BY/i.test(GREEK_SHORT_DEF_SOURCES.mounce.license));
  assert.match(GREEK_SHORT_DEF_SOURCES.mounce.license, /Attribution-NonCommercial/);
  // Every TBESG-derived source carries CC BY *and* the rider.
  for (const id of ["tbesg-abbott-smith", "tbesg-middle-liddell", "tbesg-stepbible"] as const) {
    assert.equal(GREEK_SHORT_DEF_SOURCES[id].license, "CC BY 4.0");
    assert.equal(GREEK_SHORT_DEF_SOURCES[id].rider, TBESG_REDISTRIBUTION_RIDER);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Mounce format
// ───────────────────────────────────────────────────────────────────────────

test("Mounce parses 5,389 entries, every one with a definition", () => {
  // EXACT, not "> 0". A parse that finds nothing must fail, and a parse that
  // finds fewer than the file holds must fail too.
  assert.equal(mounce.entries.length, 5389);
  assert.equal(mounce.stats.headers, 5389);
  assert.deepEqual(mounce.rejections, []);
  assert.equal(
    mounce.entries.filter((e) => e.definition.trim().length > 0).length,
    5389,
    "every Mounce entry must carry a definition",
  );
  assert.equal(mounce.stats.entriesWithStrongs, 5386);
  assert.equal(mounce.stats.gkOnlyEntries, 3);
  assert.equal(mounce.stats.strongsTokens, 5481);
  assert.equal(mounce.stats.distinctStrongsKeys, 5446);
  assert.equal(mounce.stats.extensionLetterTokens, 123);
  assert.equal(mounce.stats.piMarkedTokens, 16);
  assert.equal(mounce.stats.expositoryCrossReferences, 1085);
  assert.equal(mounce.stats.alphabetDividers, 24);
  // 9, not 8. Eight are real "☞ MOUNCE | NIV | ESV | …" hyperlink rows, and the
  // ninth is line 78 — the preamble LEGEND that explains the ☞ symbol itself.
  // The counter is documented as lines skipped by that branch, and the legend is
  // skipped by it too, so 9 is the honest figure. Verified by counting lines whose
  // trimmed start is ☞ directly in the source file.
  assert.equal(mounce.stats.wordStudyLines, 9);
});

test("the Mounce field separator is three U+00A0, and three ASCII spaces parse nothing", () => {
  assert.equal(MOUNCE_FIELD_SEPARATOR, NBSP + NBSP + NBSP);
  assert.notEqual(MOUNCE_FIELD_SEPARATOR, "   ");
  // The whole file is separated with NBSP; there is not one ASCII-space header.
  assert.ok(mounceText.includes(`GK G797 | S G749${MOUNCE_FIELD_SEPARATOR}ἀρχι`));

  // This is the failure mode the importer's guard exists for: the upstream
  // compile.rb splits on three ASCII spaces, so on this revision of the file it
  // finds zero entries — and a check that only asked "any errors?" would pass.
  const asciiVariant = mounceText.split(MOUNCE_FIELD_SEPARATOR).join("   ");
  const broken = parseMounceDictionary(asciiVariant);
  assert.equal(broken.entries.length, 0, "the ASCII-space dialect must yield zero, provably");
  assert.equal(broken.stats.headers, 0);
});

test("Mounce header grammar covers every shape in the file, including the odd ones", () => {
  const byLine = new Map(mounce.entries.map((e) => [e.line, e]));

  // Ordinary: `GK G797 | S G749   ἀρχιερεύς   archiereus   122x`
  const archiereus = mounce.entries.find((e) => e.lemma === "ἀρχιερεύς");
  assert.ok(archiereus);
  assert.equal(archiereus.gk, "797");
  assert.equal(archiereus.transliteration, "archiereus");
  assert.equal(archiereus.frequency, 122);
  assert.deepEqual(archiereus.strongs.map((s) => s.canonical), ["G749"]);

  // Comma-separated alternatives, up to 13 on one entry.
  const hagios = mounce.entries.find((e) => e.lemma === "ἅγιος");
  assert.deepEqual(hagios?.strongs.map((s) => s.canonical), ["G39", "G40"]);
  assert.equal(Math.max(...mounce.entries.map((e) => e.strongs.length)), 13);
  assert.equal(mounce.entries.filter((e) => e.strongs.length > 1).length, 50);

  // The single `+` compound: ἀμφιβάλλω = G906 + G293.
  const amphiballo = mounce.entries.find((e) => e.lemma === "ἀμφιβάλλω");
  assert.deepEqual(amphiballo?.strongs.map((s) => s.canonical), ["G906", "G293"]);

  // The undocumented `π` marker: recorded, digits still joinable.
  const apistia = mounce.entries.find((e) => e.lemma === "ἀπιστία");
  assert.equal(apistia?.strongs[0]?.raw, "Gπ570");
  assert.equal(apistia?.strongs[0]?.canonical, "G570");
  assert.equal(apistia?.strongs[0]?.piMarked, true);
  // And the marker is not silently accepted by the Strong's parser — it must
  // be stripped deliberately, which is why the ref keeps `raw`.
  assert.equal(parseStrongsKey("Gπ570").ok, false);

  // Comma-separated frequency: `1,840x` → 1840.
  const hymeis = mounce.entries.find((e) => e.lemma === "ὑμεῖς");
  assert.equal(hymeis?.frequency, 1840);

  // The three GK-only entries: GK number, NO Strong's, definition inline.
  const gkOnly = mounce.entries.filter((e) => e.strongs.length === 0);
  assert.deepEqual(gkOnly.map((e) => e.gk).sort(), ["7000", "7005", "7007"]);
  assert.deepEqual(gkOnly.map((e) => e.lemma).sort(), ["αὐτοῦ", "ἡμεῖς", "ὑμεῖς"].sort());
  for (const entry of gkOnly) assert.ok(entry.definition.trim().length > 0);

  // The one entry whose header is `\t[4887.5] | S G4529`, no `GK G` at all.
  // Upstream's compile.rb skips this line, never updates its `lastLine`, and
  // then attaches this <def> to the PREVIOUS entry — see MOUNCE_JSON_IS_LOSSY.
  const saleim = mounce.entries.find((e) => e.gk === "4887.5");
  assert.ok(saleim, "the fractional bracketed GK header must parse");
  assert.equal(saleim.lemma, "Σαλείμ");
  assert.deepEqual(saleim.strongs.map((s) => s.canonical), ["G4529"]);
  assert.match(saleim.definition, /^Saleim, also formed as/);
  // …and the neighbour it corrupts upstream is a different city, here intact.
  const salamis = mounce.entries.find((e) => e.lemma === "Σαλαμίς");
  assert.match(salamis?.definition ?? "", /^Salamis, a city in the island of Cyprus/);
  assert.notEqual(salamis?.definition, saleim.definition);

  assert.ok(byLine.size === mounce.entries.length, "entry lines must be unique");
});

test("Mounce definitions are plain text: zero HTML in 5,389 entries", () => {
  const withTags = mounce.entries.filter((e) => /<[a-zA-Z/]/.test(e.definition));
  assert.deepEqual(withTags.map((e) => e.lemma), []);
  const withRefs = mounce.entries.filter((e) => e.definition.includes("<ref"));
  assert.deepEqual(withRefs.map((e) => e.lemma), []);
  // …and none of them still carries the <def> wrapper.
  assert.equal(mounce.entries.filter((e) => e.definition.includes("</def>")).length, 0);
});

test("the → expository cross-reference is captured, not folded into the definition", () => {
  const agape = mounce.entries.find((e) => e.lemma === "ἀγάπη");
  assert.equal(agape?.definition, "love, generosity, kindly concern, devotedness; pl. love-feasts, Jude 12");
  assert.equal(agape?.expositoryCrossReference, "→ love.");
  assert.ok(!agape?.definition.includes("→"));
  assert.equal(mounce.stats.expositoryCrossReferences, 1085);
  // Every captured tail starts with the symbol the file's own table defines.
  for (const entry of mounce.entries) {
    if (!entry.expositoryCrossReference) continue;
    assert.match(entry.expositoryCrossReference, /^[→☞]/, `unexpected tail on ${entry.lemma}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GK is a different numbering system
// ───────────────────────────────────────────────────────────────────────────

test("Mounce keys on BOTH GK and Strong's, and the two agree almost nowhere", () => {
  // Every integral GK is confirmed GK by the join-key module's own predicate,
  // reached by normalising Mounce's `GK G797` to the `GK797` the predicate
  // recognises. `isGkNumber("G797")` is false — the sigil is the whole trap.
  const integral = mounce.entries.filter((e) => !e.gk.includes("."));
  assert.equal(integral.length, 5388);
  for (const entry of integral) {
    assert.equal(entry.gkIsNotStrongs, true, `GK ${entry.gk} was not recognised as GK`);
    assert.equal(isGkNumber(`GK${entry.gk}`), true);
  }
  assert.equal(isGkNumber("G797"), false, "a bare Strong's key must not read as GK");

  // GK equals the sole Strong's number on 13 of 5,386 entries — 0.24%.
  const agree = mounce.entries.filter(
    (e) => e.strongs.length === 1 && e.strongs[0]?.canonical === `G${e.gk}`,
  );
  assert.equal(agree.length, 13);
  assert.ok(
    agree.length / mounce.stats.entriesWithStrongs < 0.01,
    "if GK and Strong's mostly agreed, conflating them would be survivable; they do not",
  );

  // ἀρχιερεύς: GK 797, Strong's 749. Joining on GK would serve the wrong word.
  const archiereus = mounce.entries.find((e) => e.lemma === "ἀρχιερεύς");
  assert.equal(archiereus?.gk, "797");
  assert.equal(archiereus?.strongs[0]?.canonical, "G749");
  assert.notEqual(`G${archiereus?.gk}`, archiereus?.strongs[0]?.canonical);

  // The merged index must never key on GK: no entry key equals `G<gk>` for an
  // entry whose Strong's number differs.
  for (const entry of mounce.entries) {
    if (entry.strongs.length !== 1) continue;
    const strong = entry.strongs[0]?.canonical;
    if (strong === `G${entry.gk}`) continue;
    const wrong = index.entries[`G${entry.gk}`];
    if (!wrong?.mounce) continue;
    assert.notEqual(
      wrong.mounce.definition,
      entry.definition,
      `GK ${entry.gk} leaked in as a Strong's key for ${entry.lemma}`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Mounce's suffixes are NOT STEPBible's — the wrong-word hazard
// ───────────────────────────────────────────────────────────────────────────

test("Mounce's lowercase extension letters are disjoint from TBESG's dStrong letters", () => {
  const mounceSuffixed = new Set(
    mounce.entries.flatMap((e) =>
      e.strongs.filter((s) => s.mounceExtensionLetter).map((s) => s.canonical),
    ),
  );
  assert.equal(mounceSuffixed.size, 121);
  // 120 carry `a`, exactly 1 carries `b`.
  const letters = mounce.entries.flatMap((e) =>
    e.strongs.map((s) => s.mounceExtensionLetter).filter((l): l is string => l !== undefined),
  );
  assert.equal(letters.filter((l) => l === "a").length, 122);
  assert.equal(letters.filter((l) => l === "b").length, 1);
  assert.deepEqual([...new Set(letters)].sort(), ["a", "b"]);

  // TBESG's Greek dStrong letters run G…O and are ALL upper-case — the file's
  // own preamble line 48 says they "start at G". Zero lower-case.
  const dLetters = new Set(
    tbesg.rows
      .filter((r) => r.dStrong !== r.dStrongBase)
      .map((r) => r.dStrong.slice(-1)),
  );
  assert.deepEqual([...dLetters].sort(), ["G", "H", "I", "J", "K", "L", "M", "N", "O"]);
  for (const letter of dLetters) assert.equal(letter, letter.toUpperCase());

  // The two namespaces do not intersect, verbatim OR case-folded. So there is
  // no upper-casing that would "reconcile" them; they are different systems.
  const dStrongs = new Set(tbesg.rows.map((r) => r.dStrong));
  for (const key of mounceSuffixed) {
    assert.equal(dStrongs.has(key), false, `${key} unexpectedly present in TBESG dStrong`);
    const upper = key.slice(0, -1) + key.slice(-1).toUpperCase();
    assert.equal(dStrongs.has(upper), false, `${key} would collide with TBESG ${upper}`);
  }
});

test("dropping Mounce's letter would attach a verb's definition to a noun's number", () => {
  // THE failure this whole design exists to prevent, on a real pair.
  const angello = mounce.entries.find((e) => e.lemma === "ἀγγέλλω");
  const angelos = mounce.entries.find((e) => e.lemma === "ἄγγελος");
  assert.equal(angello?.strongs[0]?.raw, "G32a");
  assert.equal(angello?.strongs[0]?.canonical, "G32a");
  assert.equal(angello?.strongs[0]?.base, "G32");
  assert.equal(angello?.definition, "to tell, to announce, Jn. 20:18*");
  assert.equal(angelos?.strongs[0]?.canonical, "G32");
  assert.equal(angelos?.definition, "one sent, a messenger, angel");

  // Same base, two different words, two different keys in the index.
  assert.notEqual(angello?.strongs[0]?.canonical, angelos?.strongs[0]?.canonical);
  assert.equal(index.entries["G32a"]?.mounce?.definition, "to tell, to announce, Jn. 20:18*");
  assert.equal(index.entries["G32"]?.mounce?.definition, undefined);
  // G32 splits in TBESG into G32G/G32H, both ἄγγελος — never the verb.
  assert.equal(index.entries["G32G"]?.mounce?.definition, "one sent, a messenger, angel");
  assert.equal(index.entries["G32H"]?.mounce?.definition, "one sent, a messenger, angel");
  assert.equal(index.entries["G32G"]?.tbesg?.greek, "ἄγγελος");
  assert.equal(index.entries["G32H"]?.tbesg?.greek, "ἄγγελος");
  // And ἀγγέλλω's key has no TBESG half at all — a correct miss, not a merge.
  assert.equal(index.entries["G32a"]?.tbesg, undefined);
});

test("MOUNCE_JSON_IS_LOSSY records why dictionary.txt is the source, not dictionary.json", () => {
  assert.equal(MOUNCE_JSON_IS_LOSSY.textEntries, mounce.entries.length);
  assert.ok(MOUNCE_JSON_IS_LOSSY.jsonEntries < MOUNCE_JSON_IS_LOSSY.textEntries);
  assert.equal(
    MOUNCE_JSON_IS_LOSSY.suffixesDestroyed,
    new Set(
      mounce.entries.flatMap((e) =>
        e.strongs.filter((s) => s.mounceExtensionLetter).map((s) => s.canonical),
      ),
    ).size,
  );
  assert.equal(MOUNCE_JSON_IS_LOSSY.piMarkersZeroed, mounce.stats.piMarkedTokens);
  assert.equal(MOUNCE_JSON_IS_LOSSY.entriesMisattributed, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// TBESG format
// ───────────────────────────────────────────────────────────────────────────

test("TBESG is 4,736,912 bytes, UTF-8 with BOM, 11,035 single-line 8-column records", () => {
  assert.equal(statSync(TBESG_PATH).size, 4_736_912);
  const raw = readFileSync(TBESG_PATH);
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], "TBESG ships a UTF-8 BOM");
  assert.equal(raw.includes(Buffer.from("\r\n")), false, "LF endings, no CR");

  assert.equal(tbesg.rows.length, 11_035);
  assert.deepEqual(tbesg.rejections, []);
  assert.equal(tbesg.stats.dataRows, 11_035);
  assert.equal(TBESG_COLUMNS.length, 8);
  assert.deepEqual([...TBESG_COLUMNS], [
    "eStrong", "dStrong", "uStrong", "Greek", "Transliteration", "Morph", "Gloss", "Meaning",
  ]);

  // Every data line has exactly 8 tab-separated columns. Asserted over the raw
  // text, not over the parse, so a parser that dropped rows cannot pass.
  const lines = tbesgText.replace(/^﻿/, "").split("\n");
  const dataLines = lines.slice(TBESG_FIRST_DATA_LINE - 1).filter((l) => l.trim().length > 0);
  assert.equal(dataLines.length, 11_035);
  const columnCounts = new Set(dataLines.map((l) => l.split("\t").length));
  assert.deepEqual([...columnCounts], [8]);
});

test("TBESG records are single-line: the $========== form is preamble example, not data", () => {
  const lines = tbesgText.replace(/^﻿/, "").split("\n");
  // The STEPBible README describes a `$`-separated multi-line record form, and
  // TIPNR really uses it. TBESG does not: its three `$==========` lines sit at
  // 54/57/61, inside the field documentation, as the three-Herods example of
  // dStrong disambiguation.
  const dollarLines = lines
    .map((l, i) => (l.startsWith("$==========") ? i + 1 : 0))
    .filter((n) => n > 0);
  assert.deepEqual(dollarLines, [54, 57, 61]);
  for (const n of dollarLines) assert.ok(n < TBESG_FIRST_DATA_LINE);
  // No `$` begins any line in the data region.
  const strays = lines
    .map((l, i) => (i + 1 >= TBESG_FIRST_DATA_LINE && l.startsWith("$") ? i + 1 : 0))
    .filter((n) => n > 0);
  assert.deepEqual(strays, []);
  // Header on 88, rule on 89, data from 91.
  assert.equal(TBESG_HEADER_LINE, 88);
  assert.equal(TBESG_FIRST_DATA_LINE, 91);
  assert.ok(lines[TBESG_HEADER_LINE - 1]?.startsWith("eStrong\tdStrong\tuStrong"));
  assert.match(lines[TBESG_HEADER_LINE]!, /^=+$/);
  assert.equal(lines[TBESG_HEADER_LINE + 1]?.trim(), "");
  assert.ok(lines[TBESG_FIRST_DATA_LINE - 1]?.startsWith("G0001\t"));
});

test("column 8 is the definition, and column 2 carries the key plus a relation phrase", () => {
  // Column 8, 100% populated.
  assert.equal(tbesg.stats.meaningNonEmpty, 11_035);
  const meaningLengths = tbesg.rows.map((r) => r.meaning.length);
  assert.equal(Math.min(...meaningLengths) > 0, true);
  const meanRaw = Math.round(meaningLengths.reduce((a, b) => a + b, 0) / tbesg.rows.length);
  assert.equal(meanRaw, 333, "mean raw col-8 length, matching docs/step-word-card-parity.md");

  // Column 2 = `dStrong` + ` = ` + optional relation phrase. Nine values.
  const relations = Object.entries(tbesg.stats.byRelation).sort((a, b) => b[1] - a[1]);
  assert.deepEqual(relations, [
    ["", 10_451],
    ["the Greek of", 184],
    ["a Form of", 90],
    ["a Spelling of", 74],
    ["a Meaning of", 72],
    ["a Name of", 64],
    ["a Combination of", 55],
    ["a Group member of", 37],
    ["a Part of", 8],
  ]);
  assert.equal(relations.reduce((sum, [, n]) => sum + n, 0), 11_035);

  // Column 3's combination rows keep raw text and a null canonical key, rather
  // than resolving to the first of two numbers.
  //
  // WAS 37 — the wrong population, not a drifted count. 37 is how many rows
  // carry the EXACT two-key shape `Gnnnn (Gnnnn+Gnnnn)` that the module
  // docstring quotes; `stats.combinationUStrong` counts every row whose col 3
  // matches /\(.*\+.*\)/, which is 54: the 37 plus 17 that add a dStrong sense
  // letter, a third-to-eighth number, or a trailing `#;`. Recounted off the raw
  // file below, so this is not the parser being asked to confirm itself. The
  // shipped doctor-report.json already records combinationUStrong: 54, i.e. the
  // parser and the artefact agreed all along and only this line was stale.
  const rawCol3 = tbesgText
    .replace(/^﻿/, "")
    .split("\n")
    .slice(TBESG_FIRST_DATA_LINE - 1)
    .filter((l) => l.trim().length > 0)
    .map((l) => (l.split("\t")[2] ?? "").trim());
  assert.equal(rawCol3.length, 11_035);
  assert.equal(rawCol3.filter((c) => /\(.*\+.*\)/.test(c)).length, 54);
  assert.equal(rawCol3.filter((c) => /^G\d+ \(G\d+\+G\d+\)$/.test(c)).length, 37);
  assert.equal(tbesg.stats.combinationUStrong, 54);
  const combos = tbesg.rows.filter((r) => /\(.*\+.*\)/.test(r.uStrongRaw));
  assert.equal(combos.length, 54);
  for (const row of combos) assert.equal(row.uStrong, null);
  // The col-3 shape and the col-2 relation phrase are NOT the same population,
  // which is the other half of why 37 looked plausible: 55 rows say
  // `= a Combination of`, and exactly one of them (G4275 → G4308) names a
  // single key with no parentheses, so it keeps a non-null uStrong.
  assert.equal(tbesg.stats.byRelation["a Combination of"], 55);
  const relationWithoutShape = tbesg.rows.filter(
    (r) => r.relation === "a Combination of" && !/\(.*\+.*\)/.test(r.uStrongRaw),
  );
  assert.equal(relationWithoutShape.length, 1);
  assert.equal(relationWithoutShape[0]?.dStrong, "G4275");
  assert.equal(relationWithoutShape[0]?.uStrong, "G4308");
  assert.equal(
    tbesg.rows.filter(
      (r) => /\(.*\+.*\)/.test(r.uStrongRaw) && r.relation !== "a Combination of",
    ).length,
    0,
    "every parenthesised-plus col 3 is also declared a Combination in col 2",
  );

  // eStrong (col 1) is the base and never suffixed; dStrong (col 2) is where
  // the sense lives.
  assert.equal(tbesg.rows.filter((r) => /[A-Za-z]$/.test(r.eStrong)).length, 0);
  assert.equal(tbesg.stats.suffixedDStrong, 295);
});

test("TBESG is keyed to EXTENDED Strong's and splits exactly 109 Greek bases", () => {
  assert.equal(tbesg.stats.distinctDStrong, 11_035, "dStrong is unique per row");
  assert.equal(tbesg.stats.distinctBases, 10_847);
  assert.equal(tbesg.stats.splitBases, 109, "the parity doc's 109, recomputed");

  // Every dStrong round-trips through the join-key module unchanged.
  for (const row of tbesg.rows) {
    const parsed = parseStrongsKey(row.dStrong);
    assert.equal(parsed.ok, true, `dStrong ${row.dStrong} did not parse`);
    if (!parsed.ok) continue;
    assert.equal(parsed.canonical, row.dStrong);
    assert.equal(parsed.base, row.dStrongBase);
    assert.equal(parsed.testament, "G");
  }
  // And canonicalisation really did strip upstream padding: `G0026` → `G26`.
  assert.ok(tbesg.rows.some((r) => r.dStrong === "G26"));
  assert.equal(tbesg.rows.filter((r) => /^G0/.test(r.dStrong)).length, 0);
});

test("a sense split in column 2 does NOT split column 8 — 105 of the 109 bases", () => {
  const byBase = new Map<string, typeof tbesg.rows>();
  for (const row of tbesg.rows) {
    const list = byBase.get(row.dStrongBase) ?? [];
    list.push(row);
    byBase.set(row.dStrongBase, list);
  }
  const split = [...byBase.values()].filter((rows) => rows.length > 1);
  assert.equal(split.length, 109);
  // ALL siblings byte-identical: 105. That is the figure in this test's title,
  // and the stat it belongs to is `identicalMeaningSplitBases`.
  const identicalMeaning = split.filter((rows) => new Set(rows.map((r) => r.meaning)).size === 1);
  assert.equal(identicalMeaning.length, 105);
  const glossDiffers = identicalMeaning.filter(
    (rows) => new Set(rows.map((r) => r.gloss)).size > 1,
  );
  assert.equal(glossDiffers.length, 69);
  // So col 7 Gloss is the only sense-precise short string in either source.
  //
  // WAS `assert.equal(index.stats.sharedMeaningSplitBases, 105)` — the wrong
  // FIELD, not a wrong number, and the 105 in the title was right all along.
  // The index reports both readings of "shares its article" and they differ:
  // `sharedMeaningSplitBases` = at least two siblings share one (108),
  // `identicalMeaningSplitBases` = all of them do (105). Both are now asserted,
  // each against a figure recomputed from the rows in this test, so the two
  // cannot be swapped silently again. doctor-report.json records 108 and 105.
  assert.equal(index.stats.identicalMeaningSplitBases, 105);
  const atLeastTwoShare = split.filter((rows) => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.meaning, (counts.get(row.meaning) ?? 0) + 1);
    return [...counts.values()].some((n) => n > 1);
  });
  assert.equal(atLeastTwoShare.length, 108);
  assert.equal(index.stats.sharedMeaningSplitBases, 108);
  // 109 = 105 where every sibling shares one article, + 3 where SOME do and
  // some do not (Ἰησοῦς 4 of 5, Ἰωάννης 4 of 5, Ἰωσήφ 8 of 9), + 1 where no two
  // siblings share anything at all: G1, whose two senses are different words,
  // α "Alpha" and ἆ "ah!". A card keyed on G1 must never be told its article is
  // per-base, which is what the per-row flag is for.
  const baseOf = (rows: typeof tbesg.rows): string => rows[0]?.dStrongBase ?? "";
  assert.deepEqual(
    atLeastTwoShare.filter((rows) => !identicalMeaning.includes(rows)).map(baseOf).sort(),
    ["G2424", "G2491", "G2501"],
  );
  assert.deepEqual(split.filter((rows) => !atLeastTwoShare.includes(rows)).map(baseOf), ["G1"]);
  // And the flag really is PER ROW, not per base: across the 297 rows that sit
  // on a split base, exactly the 292 whose article is duplicated within the base
  // carry it, and the 5 that own their article do not.
  let flagged = 0;
  let unflagged = 0;
  for (const rows of split) {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.meaning, (counts.get(row.meaning) ?? 0) + 1);
    for (const row of rows) {
      const duplicated = (counts.get(row.meaning) ?? 0) > 1;
      assert.equal(
        index.entries[row.dStrong]?.tbesg?.meaningSharedAcrossSenses,
        duplicated ? true : undefined,
        row.dStrong,
      );
      if (duplicated) flagged += 1;
      else unflagged += 1;
    }
  }
  assert.equal(flagged, 292);
  assert.equal(unflagged, 5);
  assert.equal(flagged + unflagged, 297);
});

test("column 8's attribution varies per row, so one blanket credit would misattribute", () => {
  assert.deepEqual(tbesg.stats.byMeaningAttribution, {
    "abbott-smith": 5708,
    "middle-liddell": 2305,
    stepbible: 3022,
  });
  const total = 5708 + 2305 + 3022;
  assert.equal(total, 11_035);
  // TBESG is Abbott-Smith 1922 (public domain) on 51.7% of rows — the majority,
  // but crediting the whole column to Abbott-Smith would misattribute 5,327.
  assert.equal(total - 5708, 5327);
  for (const row of tbesg.rows) {
    const tail = row.meaning.trimEnd();
    if (row.meaningAttribution === "abbott-smith") assert.ok(tail.endsWith("(AS)"));
    else if (row.meaningAttribution === "middle-liddell") assert.ok(tail.endsWith("(ML)"));
    else assert.ok(!tail.endsWith("(AS)") && !tail.endsWith("(ML)"));
  }
  // Only Abbott-Smith and Middle Liddell are public domain; the STEPBible rows
  // are CC BY 4.0 and their source record must not claim otherwise.
  assert.match(GREEK_SHORT_DEF_SOURCES["tbesg-abbott-smith"].work ?? "", /public domain/);
  assert.match(GREEK_SHORT_DEF_SOURCES["tbesg-middle-liddell"].work ?? "", /public domain/);
  assert.ok(!/public domain/.test(GREEK_SHORT_DEF_SOURCES["tbesg-stepbible"].work ?? ""));
});

// ───────────────────────────────────────────────────────────────────────────
// The merge: separately attributed, never blended
// ───────────────────────────────────────────────────────────────────────────

test("the merged index keeps 11,157 keys and both sources overlap without merging", () => {
  assert.equal(index.entryCount, 11_157);
  assert.equal(index.tbesgKeyCount, 11_035);
  assert.equal(index.mounceKeyCount, 5626);
  assert.equal(index.bothKeyCount, 5504);
  // 122 keys are Mounce-only: the 121 extension keys plus G5992, whose number
  // falls in the G5627–G5799 morphology-code band TBESG excludes by design.
  assert.equal(index.entryCount - index.tbesgKeyCount, 122);
  assert.equal(index.stats.mounceExtensionLetterKeys, 121);
  assert.ok(index.entries["G5992"]?.mounce);
  assert.equal(index.entries["G5992"]?.tbesg, undefined);
  assert.equal(index.entries["G5992"]?.mounce?.lemma, "Τρεῖς ταβέρναι");

  const checks = checkGreekShortDefIndex(index);
  assert.deepEqual(Object.entries(checks).filter(([, ok]) => !ok), []);
  assert.ok(Object.keys(checks).length >= 20);
});

test("no entry ever blends the two sources into one string", () => {
  for (const entry of Object.values(index.entries)) {
    // The two halves are distinct objects with distinct attribution ids.
    if (entry.mounce) assert.equal(entry.mounce.attribution, "mounce");
    if (entry.tbesg) assert.notEqual(entry.tbesg.attribution as string, "mounce");
    if (!entry.mounce || !entry.tbesg) continue;
    // Mounce's prose must not appear inside a TBESG field, or vice versa.
    const mounceDef = entry.mounce.definition;
    if (mounceDef.length > 20) {
      assert.equal(
        entry.tbesg.meaning.includes(mounceDef),
        false,
        `${entry.key}: Mounce prose leaked into tbesg.meaning`,
      );
      assert.equal(entry.tbesg.gloss.includes(mounceDef), false);
    }
    if (entry.tbesg.meaning.length > 20) {
      assert.equal(
        mounceDef.includes(entry.tbesg.meaning),
        false,
        `${entry.key}: TBESG prose leaked into mounce.definition`,
      );
    }
  }
  // Every attribution id on every half resolves to a source record.
  const ids = new Set(Object.keys(index.sources));
  for (const entry of Object.values(index.entries)) {
    if (entry.mounce) assert.ok(ids.has(entry.mounce.attribution));
    if (entry.tbesg) assert.ok(ids.has(entry.tbesg.attribution));
  }
});

test("Mounce attached to a sense key is flagged, because Mounce did not choose the sense", () => {
  assert.equal(index.stats.mounceAttachedAtBaseLevel, 404);
  assert.ok(index.stats.mounceAttachedAtBaseLevel > 0);
  for (const entry of Object.values(index.entries)) {
    if (!entry.mounce) continue;
    if (entry.key === entry.base) {
      assert.equal(entry.mounce.appliesToWholeBase, undefined, entry.key);
    } else {
      assert.equal(entry.mounce.appliesToWholeBase, true, entry.key);
    }
  }
  // πρεσβύτερος: one Mounce entry, two TBESG senses, both flagged.
  for (const key of ["G4245G", "G4245H"]) {
    assert.equal(index.entries[key]?.mounce?.appliesToWholeBase, true);
    assert.equal(index.entries[key]?.mounce?.lemma, "πρεσβύτερος");
  }
  assert.deepEqual(index.senseSiblingsByBase["G4245"], ["G4245G", "G4245H"]);
  assert.deepEqual(index.entries["G4245G"]?.senseSiblings, ["G4245H"]);
});

// ───────────────────────────────────────────────────────────────────────────
// The four worked examples, and the 25-word verdict
// ───────────────────────────────────────────────────────────────────────────

test("G0749 ἀρχιερεύς — Mounce is 3 words, TBESG's article is 53", () => {
  const entry = index.entries["G749"];
  assert.ok(entry);
  assert.equal(entry.tbesg?.greek, "ἀρχιερεύς");
  assert.equal(entry.tbesg?.transliteration, "archiereus");
  assert.equal(entry.tbesg?.morph, "G:N-M");
  assert.equal(entry.tbesg?.gloss, "high-priest");
  assert.equal(entry.mounce?.definition, "a high-priest, chief-priest");
  assert.equal(entry.mounce?.frequency, 122);
  // The parity doc records STEP's live mediumDef for this word as
  // "chief priest, high priest <br /><b>a high-priest, chief-priest</b>".
  // Mounce's string is that bolded second line, byte for byte — which is the
  // evidence that STEP's "Meaning" block is Mounce.
  assert.equal(shortDefWordCount(entry.mounce!.definition), 3);
  assert.equal(shortDefWordCount(entry.tbesg!.meaning), 53);
  // WAS `assert.match(entry.tbesg!.meaning, /^\s*<b>ἀρχιερεύς<\/b>/)`, which
  // matched nothing. The cause is NOT a mangled parse and NOT NFC-vs-NFD: col 8
  // spells the word with U+1F7B GREEK SMALL LETTER UPSILON WITH OXIA, one of the
  // Unicode presentation forms TBESG uses throughout, and NFC folds that
  // singleton to U+03CD (…WITH TONOS) — which is what every Greek literal in
  // this file is written in. The bytes in `meaning` are exactly upstream's, on
  // purpose. So the fix belongs at the COMPARISON, never in the regex: see
  // "Greek in the index has one normal form" below, which pins the whole rule.
  assert.match(entry.tbesg!.meaning.normalize("NFC"), /^\s*<b>ἀρχιερεύς<\/b>/);
  // Un-normalised is the contract, not an accident, and here is the trap it
  // sets: raw col 8 does not contain the NFC spelling of its own headword.
  // The NFC spelling, as an escape so it cannot be confused with the oxia one:
  assert.equal(
    entry.tbesg!.meaning.includes("\u1F00\u03C1\u03C7\u03B9\u03B5\u03C1\u03B5\u03CD\u03C2"),
    false,
  );
  assert.equal(entry.tbesg!.meaning.includes(entry.tbesg!.greek), false);
  assert.equal(entry.tbesg!.meaning.normalize("NFC").includes(entry.tbesg!.greek), true);
  assert.equal(entry.tbesg?.attribution, "tbesg-abbott-smith");

  const picked = pickCardGloss(entry);
  assert.equal(picked?.text, "a high-priest, chief-priest");
  assert.equal(picked?.attribution, "mounce");
  assert.equal(picked?.field, "mounce-definition");
  assert.equal(picked?.sense, "this-sense");
  assert.equal(picked?.overBudget, undefined);
});

test("G4245 πρεσβύτερος, both senses — only TBESG can tell them apart", () => {
  const elder = index.entries["G4245G"];
  const old = index.entries["G4245H"];
  assert.ok(elder && old);
  assert.equal(elder.tbesg?.gloss, "elder: Elder");
  assert.equal(old.tbesg?.gloss, "elder: old");
  assert.equal(elder.tbesg?.relation, "");
  assert.equal(old.tbesg?.relation, "a Meaning of");
  assert.equal(old.tbesg?.uStrong, "G4245G", "the H sense points back at the G sense");

  // The two rows carry BYTE-IDENTICAL col-8 articles: 2,173 chars each.
  assert.equal(elder.tbesg?.meaning, old.tbesg?.meaning);
  assert.equal(elder.tbesg?.meaning.length, 2173);
  assert.equal(elder.tbesg?.meaningSharedAcrossSenses, true);
  assert.equal(old.tbesg?.meaningSharedAcrossSenses, true);

  // Mounce has ONE entry for the lemma, 75 words, covering both senses.
  assert.equal(elder.mounce?.definition, old.mounce?.definition);
  assert.equal(shortDefWordCount(elder.mounce!.definition), 75);
  assert.match(elder.mounce!.definition, /^elder, senior; older, more advanced in years/);
  assert.equal(elder.mounce?.appliesToWholeBase, true);

  // So the 25-word card slot goes to TBESG's Gloss, and it is sense-correct.
  assert.equal(pickCardGloss(elder)?.text, "elder: Elder");
  assert.equal(pickCardGloss(old)?.text, "elder: old");
  assert.equal(pickCardGloss(elder)?.field, "tbesg-gloss");
  assert.equal(pickCardGloss(old)?.sense, "this-sense");
  // Mounce's 75-word paragraph is still there, for the expander.
  //
  // WAS `> 500` characters, which was never true of this string: it is 428. The
  // threshold was invented rather than measured, and it would not have tested
  // what the comment claims either — only 83 of Mounce's 5,389 definitions
  // exceed 500 chars, so "> 500" is a test for "freakishly long", not for "a
  // paragraph". Pinned exactly, plus the property that actually matters here:
  // it blows the card budget and dwarfs the gloss that beat it.
  assert.equal(elder.mounce!.definition.length, 428);
  assert.ok(
    shortDefWordCount(elder.mounce!.definition) > CARD_GLOSS_WORD_BUDGET,
    "the expander block must be the thing that could not fit the card",
  );
  assert.ok(
    elder.mounce!.definition.length > pickCardGloss(elder)!.text.length * 10,
    `Mounce ${elder.mounce!.definition.length} chars vs gloss ${pickCardGloss(elder)!.text.length}`,
  );
});

test("G2673 καταργέω and G0026 ἀγάπη — the budget decides, and it splits the two ways", () => {
  const katargeo = index.entries["G2673"];
  assert.equal(katargeo?.tbesg?.greek, "καταργέω");
  assert.equal(katargeo?.tbesg?.gloss, "to abate");
  assert.match(katargeo?.mounce?.definition ?? "", /^to render useless or unproductive/);
  assert.equal(shortDefWordCount(katargeo!.mounce!.definition), 64);
  assert.equal(shortDefWordCount(katargeo!.tbesg!.meaning), 92);
  // Mounce is the shorter of the two prose blocks, but 64 words still misses a
  // 25-word slot, so the Gloss wins and Mounce moves to the expander.
  assert.equal(pickCardGloss(katargeo!)?.text, "to abate");
  assert.equal(pickCardGloss(katargeo!)?.field, "tbesg-gloss");
  assert.equal(pickCardGloss(katargeo!)?.overBudget, undefined);

  const agape = index.entries["G26"];
  assert.equal(agape?.tbesg?.greek, "ἀγάπη");
  assert.equal(agape?.tbesg?.gloss, "love");
  assert.equal(
    agape?.mounce?.definition,
    "love, generosity, kindly concern, devotedness; pl. love-feasts, Jude 12",
  );
  assert.equal(shortDefWordCount(agape!.mounce!.definition), 9);
  assert.equal(shortDefWordCount(agape!.tbesg!.meaning), 230);
  // 9 words: Mounce wins, and says far more than the one-word Gloss "love".
  assert.equal(pickCardGloss(agape!)?.field, "mounce-definition");
  assert.equal(
    pickCardGloss(agape!)?.text,
    "love, generosity, kindly concern, devotedness; pl. love-feasts, Jude 12",
  );
  assert.equal(agape?.mounce?.expositoryCrossReference, "→ love.");
});

test("Mounce is the better 25-word source, measured, and TBESG covers the rest", () => {
  const mounceWords = mounce.entries.map((e) => shortDefWordCount(e.definition));
  const withinBudget = mounceWords.filter((w) => w <= 25).length;
  assert.equal(withinBudget, 4293);
  assert.equal(mounce.entries.length, 5389);
  assert.ok(withinBudget / mounce.entries.length > 0.79, "79.7% of Mounce fits a 25-word slot");
  const meanMounce = mounceWords.reduce((a, b) => a + b, 0) / mounceWords.length;
  assert.ok(meanMounce > 19 && meanMounce < 20, `mean Mounce words ${meanMounce}`);

  const tbesgMeaningWords = tbesg.rows.map((r) => shortDefWordCount(r.meaning));
  const tbesgWithin = tbesgMeaningWords.filter((w) => w <= 25).length;
  assert.equal(tbesgWithin, 6149);
  const meanTbesg = tbesgMeaningWords.reduce((a, b) => a + b, 0) / tbesgMeaningWords.length;
  assert.ok(meanTbesg > 37 && meanTbesg < 38, `mean TBESG col-8 words ${meanTbesg}`);
  assert.ok(
    withinBudget / mounce.entries.length > tbesgWithin / tbesg.rows.length,
    "Mounce fits the slot more often than TBESG col 8 does",
  );
  // 73.5% of col 8 is HTML; Mounce is 0%.
  const htmlRows = tbesg.rows.filter((r) => /<[a-zA-Z/]/.test(r.meaning)).length;
  assert.equal(htmlRows, 8106);
  // TBESG col 7 Gloss is always in budget — that is why it is the fallback.
  assert.equal(tbesg.rows.filter((r) => shortDefWordCount(r.gloss) > 25).length, 0);

  // Across the whole index, both sources genuinely win the slot somewhere.
  let byMounce = 0;
  let byGloss = 0;
  let none = 0;
  let over = 0;
  for (const entry of Object.values(index.entries)) {
    const picked = pickCardGloss(entry);
    if (!picked) { none += 1; continue; }
    if (picked.field === "mounce-definition") byMounce += 1; else byGloss += 1;
    if (picked.overBudget) over += 1;
  }
  assert.equal(byMounce, 4383);
  assert.equal(byGloss, 6773);
  assert.equal(byMounce + byGloss + none, index.entryCount);
  // Exactly one key can fill nothing: G21370 πλάνης, TBESG's only empty Gloss,
  // in the LXX-only G20000+ range where an NT dictionary has nothing either.
  assert.equal(none, 1);
  assert.equal(pickCardGloss(index.entries["G21370"]!), null);
  assert.equal(index.entries["G21370"]?.tbesg?.gloss, "");
  assert.equal(index.entries["G21370"]?.mounce, undefined);
  // The 3 over-budget picks are all Mounce-extension keys with no alternative.
  assert.equal(over, 3);
  for (const key of ["G2492a", "G3608a", "G4091a"]) {
    const picked = pickCardGloss(index.entries[key]!);
    assert.equal(picked?.overBudget, true, key);
    assert.equal(index.entries[key]?.tbesg, undefined, key);
    assert.ok(index.entries[key]?.mounce?.mounceExtensionLetter, key);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Unicode normal form — the rule every Greek lookup depends on
// ───────────────────────────────────────────────────────────────────────────

test("Greek in the index has one normal form: NFC identifiers, verbatim prose", () => {
  // THE RULE. Written down here because the ἀρχιερεύς regex above tripped over
  // its absence, and pinned here because every future Greek lookup — search,
  // token join, highlight, note capture — depends on it.
  //
  //   Greek that is an IDENTIFIER — TBESG col 4 `greek`, Mounce's `lemma` — is
  //   normalised to NFC by the parser. It gets compared and indexed, so it must
  //   have exactly one spelling.
  //
  //   Greek inside PROSE — TBESG col 8 `meaning`, Mounce's `definition` — is
  //   kept byte-identical to the source. It is attributed third-party text, and
  //   TBESG's terms permit reformatting "without changing the data"; NFC would
  //   rewrite 6,809 of its 11,035 articles.
  //
  //   So CALLERS normalise at the point of comparison, on BOTH sides. The
  //   importer must not normalise prose to make lookups convenient, and nobody
  //   may loosen a pattern to work around this — normalise the haystack.
  const rawDataLines = tbesgText
    .replace(/^﻿/, "")
    .split("\n")
    .slice(TBESG_FIRST_DATA_LINE - 1)
    .filter((l) => l.trim().length > 0);
  assert.equal(rawDataLines.length, 11_035);
  const rawGreek = rawDataLines.map((l) => (l.split("\t")[3] ?? "").trim());
  const rawMeaning = rawDataLines.map((l) => l.split("\t")[7] ?? "");

  // 1. The upstream file is NOT NFC, so nothing below can pass by finding
  //    nothing: 9,666 col-4 values and 6,809 col-8 values change under NFC.
  //    TBESG writes the Unicode "oxia" presentation forms — U+1F71, 1F73, 1F75,
  //    1F77, 1F79, 1F7B, 1F7D, U+1FD3, U+1FE3 — plus U+037E GREEK QUESTION
  //    MARK, each of which NFC folds to its tonos/ASCII equivalent.
  assert.equal(rawGreek.filter((g) => g !== g.normalize("NFC")).length, 9666);
  assert.equal(rawMeaning.filter((m) => m !== m.normalize("NFC")).length, 6809);

  // 2. col 4 comes out NFC on every row. col 8 comes out byte-identical to the
  //    file, row for row in file order, and stays un-normalised on 6,809 rows.
  assert.equal(tbesg.rows.filter((r) => r.greek === r.greek.normalize("NFC")).length, 11_035);
  assert.equal(tbesg.rows.filter((r, i) => r.meaning === rawMeaning[i]).length, 11_035);
  assert.equal(tbesg.rows.filter((r) => r.meaning !== r.meaning.normalize("NFC")).length, 6809);

  // 3. Mounce, same rule, same evidence. The raw file spells ἀγάπη with U+1F71
  //    exactly once and never in NFC, and the parser emits the NFC form. Both
  //    spellings are written as ESCAPES here, never as literals: they are
  //    indistinguishable on screen, so a literal would let a future "normalise
  //    the sources" pass turn this pin into a tautology with nobody the wiser.
  const AGAPE_OXIA = "\u1F00\u03B3\u1F71\u03C0\u03B7"; // as the source file has it
  const AGAPE_NFC = "\u1F00\u03B3\u03AC\u03C0\u03B7"; // as the parser must emit it
  assert.notEqual(AGAPE_OXIA, AGAPE_NFC);
  assert.equal(AGAPE_OXIA.normalize("NFC"), AGAPE_NFC);
  assert.equal(mounceText.split(AGAPE_OXIA).length - 1, 1);
  assert.equal(mounceText.includes(AGAPE_NFC), false);
  const agapeEntry = mounce.entries.find((e) => e.strongs[0]?.canonical === "G26");
  assert.ok(agapeEntry);
  assert.equal(agapeEntry.lemma, AGAPE_NFC);
  assert.equal(mounce.entries.filter((e) => e.lemma === e.lemma.normalize("NFC")).length, 5389);
  assert.equal(
    mounce.entries.filter((e) => e.definition !== e.definition.normalize("NFC")).length,
    586,
    "Mounce definitions are prose and keep their oxia forms, like TBESG col 8",
  );

  // 4. And it survives the merge, on every key: identifiers NFC, prose still the
  //    source's bytes.
  const rowByKey = new Map(tbesg.rows.map((r) => [r.dStrong, r]));
  let tbesgGreekNfc = 0;
  let meaningVerbatim = 0;
  let mounceLemmaNfc = 0;
  for (const entry of Object.values(index.entries)) {
    if (entry.tbesg) {
      assert.equal(entry.tbesg.greek, entry.tbesg.greek.normalize("NFC"), entry.key);
      tbesgGreekNfc += 1;
      assert.equal(entry.tbesg.meaning, rowByKey.get(entry.key)?.meaning, entry.key);
      meaningVerbatim += 1;
    }
    if (entry.mounce) {
      assert.equal(entry.mounce.lemma, entry.mounce.lemma.normalize("NFC"), entry.key);
      mounceLemmaNfc += 1;
    }
  }
  assert.equal(tbesgGreekNfc, index.tbesgKeyCount);
  assert.equal(meaningVerbatim, 11_035);
  assert.equal(mounceLemmaNfc, index.mounceKeyCount);

  // 5. The word this repo will look up first, pinned codepoint by codepoint in
  //    both fields — because "they looked identical on screen" is exactly how
  //    the broken regex above got written.
  const codepoints = (s: string): string =>
    [...s].map((c) => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
  const g749 = index.entries["G749"];
  assert.equal(codepoints(g749!.tbesg!.greek), "1F00 03C1 03C7 03B9 03B5 03C1 03B5 03CD 03C2");
  assert.equal(
    codepoints(g749!.tbesg!.meaning.slice(0, 17)),
    "0020 003C 0062 003E 1F00 03C1 03C7 03B9 03B5 03C1 03B5 1F7B 03C2 003C 002F 0062 003E",
    "raw col 8 opens ` <b>` + the OXIA spelling, and must stay that way",
  );
  assert.equal(g749!.tbesg!.greek.includes("\u1F7B"), false, "col 4 holds only the NFC form");
  assert.equal(g749!.tbesg!.meaning.includes("\u03CD"), false, "col 8 holds only the oxia form");
});

// ───────────────────────────────────────────────────────────────────────────
// Adversarial input
// ───────────────────────────────────────────────────────────────────────────

test("both parsers survive adversarial input without inventing entries", () => {
  // A raw NUL byte used to sit in this list as a literal character, which made
  // the whole test file read as BINARY to grep, git diff and every reviewer
  // tool that sniffs for one. Same input, written as an escape.
  for (const bad of ["", "\n\n\n", "not a lexicon", "\t\t\t\t\t\t\t\t", "\u0000"]) {
    const m = parseMounceDictionary(bad);
    assert.equal(m.entries.length, 0);
    const t = parseTbesgLexicon(bad);
    assert.equal(t.rows.length, 0);
    assert.equal(t.stats.dataRows, 0);
  }

  // A TBESG-shaped file whose data rows are malformed: rejected with reasons,
  // never silently coerced.
  const preamble = `${"x\n".repeat(TBESG_FIRST_DATA_LINE - 1)}`;
  const wrongColumns = parseTbesgLexicon(`${preamble}G0001\tG0001G =\tG0001G\tα\n`);
  assert.equal(wrongColumns.rows.length, 0);
  assert.equal(wrongColumns.rejections.length, 1);
  assert.equal(wrongColumns.rejections[0]?.reason, "column-count");

  const gkInEstrong = parseTbesgLexicon(
    `${preamble}GK4472\tG0001G =\tG0001G\tα\tAlpha\tG:N-LI\tAlpha\tx\n`,
  );
  assert.equal(gkInEstrong.rows.length, 0);
  assert.equal(gkInEstrong.rejections[0]?.reason, "estrong-unparseable");
  assert.equal(gkInEstrong.rejections[0]?.strongsKeyReason, "gk-numbering");

  const bareNumber = parseTbesgLexicon(
    `${preamble}26\tG0026 =\tG0026\tἀγάπη\tagape\tG:N-F\tlove\tx\n`,
  );
  assert.equal(bareNumber.rows.length, 0);
  assert.equal(bareNumber.rejections[0]?.strongsKeyReason, "ambiguous-bare-number");

  // A valid synthetic row parses, so the negatives above are not vacuous.
  const ok = parseTbesgLexicon(
    `${preamble}G0026\tG0026 = a Meaning of\tG0027\tἀγάπη\tagape\tG:N-F\tlove\t <b>x</b> (AS)\n`,
  );
  assert.equal(ok.rows.length, 1);
  assert.equal(ok.rejections.length, 0);
  assert.equal(ok.rows[0]?.dStrong, "G26");
  assert.equal(ok.rows[0]?.relation, "a Meaning of");
  assert.equal(ok.rows[0]?.uStrong, "G27");
  assert.equal(ok.rows[0]?.meaningAttribution, "abbott-smith");
});

test("a Mounce Strong's token that is unparseable is rejected with a reason, not dropped", () => {
  const header = `GK G1 | S GG999${MOUNCE_FIELD_SEPARATOR}λ${MOUNCE_FIELD_SEPARATOR}l${MOUNCE_FIELD_SEPARATOR}1x`;
  const result = parseMounceDictionary(`${"x\n".repeat(98)}${header}\n<def>test</def>\n`);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.strongs.length, 0);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0]?.reason, "strongs-token-unparseable");

  // A header with no <def> line is reported, not silently left definitionless.
  const orphan = parseMounceDictionary(
    `${"x\n".repeat(98)}GK G1 | S G1${MOUNCE_FIELD_SEPARATOR}λ${MOUNCE_FIELD_SEPARATOR}l${MOUNCE_FIELD_SEPARATOR}1x\n`,
  );
  assert.equal(orphan.rejections[0]?.reason, "header-without-definition");

  // A <def> with no header is reported too.
  const stray = parseMounceDictionary(`${"x\n".repeat(98)}<def>orphan</def>\n`);
  assert.equal(stray.entries.length, 0);
  assert.equal(stray.rejections[0]?.reason, "definition-without-header");
});

// ───────────────────────────────────────────────────────────────────────────
// The shipped artefacts
// ───────────────────────────────────────────────────────────────────────────

test("the shipped index and Doctor report match a fresh build of the shipped sources", () => {
  const shipped = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as GreekShortDefIndex;
  assert.equal(shipped.version, 1);
  assert.equal(shipped.entryCount, index.entryCount);
  assert.equal(shipped.mounceKeyCount, index.mounceKeyCount);
  assert.equal(shipped.tbesgKeyCount, index.tbesgKeyCount);
  assert.equal(shipped.bothKeyCount, index.bothKeyCount);
  assert.deepEqual(shipped.stats, index.stats);
  // Provenance: every input hashed, sized, and named.
  assert.equal(shipped.inputs.mounce.bytes, 1_041_936);
  assert.equal(shipped.inputs.tbesg.bytes, 4_736_912);
  assert.equal(
    shipped.inputs.mounce.sha256,
    createHash("sha256").update(readFileSync(MOUNCE_PATH)).digest("hex"),
  );
  assert.equal(
    shipped.inputs.tbesg.sha256,
    createHash("sha256").update(readFileSync(TBESG_PATH)).digest("hex"),
  );
  // Attribution survives serialisation verbatim, newlines and all.
  assert.equal(shipped.sources.mounce.requiredAttribution, MOUNCE_REQUIRED_ATTRIBUTION);
  assert.equal(
    shipped.sources["tbesg-abbott-smith"].requiredAttribution,
    TBESG_REQUIRED_ATTRIBUTION,
  );
  assert.equal(shipped.sources["tbesg-stepbible"].rider, TBESG_REDISTRIBUTION_RIDER);

  const doctor = JSON.parse(readFileSync(DOCTOR_PATH, "utf8")) as {
    status: string;
    checks: Record<string, boolean>;
    coverage: Record<string, unknown>;
    review: Record<string, unknown[]>;
  };
  assert.equal(doctor.status, "healthy");
  assert.deepEqual(Object.entries(doctor.checks).filter(([, ok]) => !ok), []);
  assert.ok(Object.keys(doctor.checks).length >= 25);
  assert.deepEqual(doctor.review.mounceRejections, []);
  assert.deepEqual(doctor.review.tbesgRejections, []);
  // Reported, not hidden: 33 Strong's keys are claimed by two Mounce lemmas.
  assert.equal(doctor.review.collidingMounceStrongsKeys.length, 33);
});
