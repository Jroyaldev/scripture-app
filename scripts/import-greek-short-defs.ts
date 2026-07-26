/**
 * Import the two short-definition Greek lexicons → one merged index.
 *
 *   npm run import:greek-short-defs
 *
 * I/O only. All parsing and merging lives in
 * `src/core/language/greek-short-defs.ts`, per the src/scripts split.
 *
 * INPUTS, both shipped raw beside the built index (the TIPNR precedent:
 * `TIPNR-STEPBible-CC-BY.txt` 8,611,754 b + `tipnr-index.json` 4,951,611 b):
 *
 *   Mounce-Concise-Greek-English-Dictionary-teknia.com-NC.txt   1,041,936 b
 *     from https://github.com/jcuenod/dictionary (dictionary.txt)
 *     byte-identical mirror: https://github.com/OpenBibleSearch/dictionary-1
 *     NOT CC BY — "Attribution-NonCommercial". The filename says so, because
 *     every other raw file in this tree is named `-CC-BY` and a reader would
 *     otherwise assume it.
 *     NOTE: `dictionary.json` from the same repo is NOT used. It is lossy and,
 *     on one entry, wrong. See MOUNCE_JSON_IS_LOSSY.
 *
 *   TBESG-STEPBible-CC-BY.txt                                   4,736,912 b
 *     from https://github.com/STEPBible/STEPBible-Data
 *       Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for
 *       Greek - STEPBible.org CC BY.txt   (percent-encode the spaces)
 *
 * OUTPUT
 *   data/scripture/lexicons/greek-short-defs/greek-short-defs-index.json
 *   data/scripture/lexicons/greek-short-defs/doctor-report.json
 *
 * The manifest carries source, licence, verbatim required attribution, and a
 * sha256 of every input, matching `tipnr-index.json`'s manifest style.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMounceDictionary,
  parseTbesgLexicon,
  buildGreekShortDefIndex,
  checkGreekShortDefIndex,
  pickCardGloss,
  shortDefWordCount,
  MOUNCE_REQUIRED_ATTRIBUTION,
  TBESG_REQUIRED_ATTRIBUTION,
  TBESG_REDISTRIBUTION_RIDER,
  type GreekShortDefIndex,
} from "../src/core/language/greek-short-defs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIR = resolve(ROOT, "data/scripture/lexicons/greek-short-defs");
const MOUNCE_INPUT = resolve(DIR, "Mounce-Concise-Greek-English-Dictionary-teknia.com-NC.txt");
const TBESG_INPUT = resolve(DIR, "TBESG-STEPBible-CC-BY.txt");
const OUTPUT = resolve(DIR, "greek-short-defs-index.json");
const DOCTOR_OUTPUT = resolve(DIR, "doctor-report.json");

/**
 * A source-snapshot date rather than `Date.now()`, so regenerating the index
 * from unchanged inputs is byte-stable (the INV-2 convention
 * `scripts/import-tipnr.ts:42` follows).
 */
const SNAPSHOT_DATE = "2026-07-26";

const MOUNCE_URL = "https://github.com/jcuenod/dictionary → dictionary.txt";
const TBESG_URL =
  "https://github.com/STEPBible/STEPBible-Data → " +
  "Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt";

/**
 * Bytes each input must have. Pinned so a truncated or silently updated
 * download cannot slip through as a smaller-but-still-parsing file.
 * Both measured with `stat` on the retrieved files.
 */
const EXPECTED_BYTES = { mounce: 1_041_936, tbesg: 4_736_912 } as const;
const EXPECTED_SHA256 = {
  mounce: "760b5431c3710fe6770f668440fd5506b71086f0d9e12381f26732b015fceb89",
  tbesg: "312f723d7b8ef263bbdfb0451c9b8057125804dfff390b6f8544cff2a84b57f4",
} as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function main(): void {
  for (const path of [MOUNCE_INPUT, TBESG_INPUT]) {
    if (!existsSync(path)) {
      throw new Error(
        `Missing Greek short-definition input: ${path}\n` +
          "  Mounce: curl -sL -o '" +
          basename(MOUNCE_INPUT) +
          "' https://raw.githubusercontent.com/jcuenod/dictionary/master/dictionary.txt\n" +
          "  TBESG:  curl -sL -o '" +
          basename(TBESG_INPUT) +
          "' 'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/" +
          "TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt'",
      );
    }
  }

  console.log("Reading", MOUNCE_INPUT);
  const mounceBytes = readFileSync(MOUNCE_INPUT);
  console.log("Reading", TBESG_INPUT);
  const tbesgBytes = readFileSync(TBESG_INPUT);

  const inputs: GreekShortDefIndex["inputs"] = {
    mounce: {
      file: `data/scripture/lexicons/greek-short-defs/${basename(MOUNCE_INPUT)}`,
      bytes: statSync(MOUNCE_INPUT).size,
      sha256: sha256(mounceBytes),
      retrievedFrom: MOUNCE_URL,
    },
    tbesg: {
      file: `data/scripture/lexicons/greek-short-defs/${basename(TBESG_INPUT)}`,
      bytes: statSync(TBESG_INPUT).size,
      sha256: sha256(tbesgBytes),
      retrievedFrom: TBESG_URL,
    },
  };

  const mounce = parseMounceDictionary(mounceBytes.toString("utf8"));
  const tbesg = parseTbesgLexicon(tbesgBytes.toString("utf8"));

  // FAIL-OPEN GUARD. A zero-entry parse of a million-byte file is a separator
  // bug, not an empty dictionary — the Mounce field separator is three U+00A0
  // and the upstream compile.rb's three ASCII spaces produce exactly this.
  if (mounce.entries.length === 0) {
    throw new Error(
      `Parsed 0 Mounce entries from ${inputs.mounce.bytes} bytes. ` +
        "Check the field separator: it is three U+00A0 NO-BREAK SPACEs, not three spaces.",
    );
  }
  if (tbesg.rows.length === 0) {
    throw new Error(
      `Parsed 0 TBESG rows from ${inputs.tbesg.bytes} bytes. ` +
        `Data starts at line 91; records are single-line, 8 tab-separated columns, NOT $-separated.`,
    );
  }

  const index = buildGreekShortDefIndex({
    mounce,
    tbesg,
    generatedAt: `${SNAPSHOT_DATE}T00:00:00.000Z`,
    inputs,
  });

  // Which source actually wins the 25-word card slot, per key. This is the
  // deliverable question ("which is better for a 25-word card gloss") answered
  // as a count rather than an opinion.
  const cardGlossSource: Record<string, number> = {};
  const cardGlossMissingKeys: Array<{ key: string; greek: string | null; why: string }> = [];
  const cardGlossOverBudgetKeys: Array<{
    key: string;
    words: number;
    hadTbesgAlternative: boolean;
    mounceExtensionLetter: string | null;
  }> = [];
  let cardGlossBaseSense = 0;
  for (const entry of Object.values(index.entries)) {
    const picked = pickCardGloss(entry);
    if (!picked) {
      cardGlossMissingKeys.push({
        key: entry.key,
        greek: entry.tbesg?.greek ?? entry.mounce?.lemma ?? null,
        why:
          entry.tbesg === undefined
            ? "no TBESG row"
            : entry.tbesg.gloss.trim() === ""
              ? "TBESG Gloss (col 7) is empty and there is no Mounce entry"
              : "unknown",
      });
      continue;
    }
    cardGlossSource[picked.field] = (cardGlossSource[picked.field] ?? 0) + 1;
    if (picked.overBudget) {
      cardGlossOverBudgetKeys.push({
        key: entry.key,
        words: picked.wordCount,
        hadTbesgAlternative: entry.tbesg !== undefined,
        mounceExtensionLetter: entry.mounce?.mounceExtensionLetter ?? null,
      });
    }
    if (picked.sense === "base") cardGlossBaseSense += 1;
  }
  const cardGlossMissing = cardGlossMissingKeys.length;
  const cardGlossOverBudget = cardGlossOverBudgetKeys.length;

  const checks = {
    ...checkGreekShortDefIndex(index),
    // Both sources must actually win the card slot somewhere, or one of them
    // is dead weight and the "complements, not duplicates" claim is false.
    cardGlossUsesMounce: (cardGlossSource["mounce-definition"] ?? 0) > 0,
    cardGlossUsesTbesgGloss: (cardGlossSource["tbesg-gloss"] ?? 0) > 0,
    /**
     * Exactly one key cannot fill the slot: G21370 πλάνης, the single TBESG
     * row with an empty col-7 Gloss, in the G20000+ LXX-only range so Mounce
     * (an NT dictionary) has nothing either. Drawing no block there is right;
     * pinning the count means a second such key would be noticed.
     */
    cardGlossGapsAccountedFor: cardGlossMissing === 1,
    /**
     * Every over-budget pick must be one where there was genuinely no
     * in-budget alternative — a Mounce-extension key, which by construction
     * has no TBESG half to fall back on. This is the structural invariant; the
     * count (3: G2492a, G3608a, G4091a) is pinned alongside it.
     */
    cardGlossOverBudgetOnlyWhenUnavoidable: cardGlossOverBudgetKeys.every(
      (k) => !k.hadTbesgAlternative && k.mounceExtensionLetter !== null,
    ),
    cardGlossOverBudgetCountPinned: cardGlossOverBudget === 3,
    mounceBytesPinned: inputs.mounce.bytes === EXPECTED_BYTES.mounce,
    tbesgBytesPinned: inputs.tbesg.bytes === EXPECTED_BYTES.tbesg,
    mounceSha256Pinned: inputs.mounce.sha256 === EXPECTED_SHA256.mounce,
    tbesgSha256Pinned: inputs.tbesg.sha256 === EXPECTED_SHA256.tbesg,
  };

  // Four worked examples, written into the report so the numbers in the
  // Doctor are checkable by eye and by test rather than only in prose.
  const samples = ["G749", "G4245G", "G4245H", "G2673", "G26"].map((key) => {
    const entry = index.entries[key];
    const picked = entry ? pickCardGloss(entry) : null;
    return {
      key,
      greek: entry?.tbesg?.greek ?? entry?.mounce?.lemma ?? null,
      tbesgGloss: entry?.tbesg?.gloss ?? null,
      tbesgMeaningChars: entry?.tbesg?.meaning.length ?? null,
      tbesgMeaningWords: entry?.tbesg ? shortDefWordCount(entry.tbesg.meaning) : null,
      tbesgMeaningSharedAcrossSenses: entry?.tbesg?.meaningSharedAcrossSenses ?? false,
      tbesgAttribution: entry?.tbesg?.attribution ?? null,
      mounceDefinition: entry?.mounce?.definition ?? null,
      mounceWords: entry?.mounce ? shortDefWordCount(entry.mounce.definition) : null,
      mounceAppliesToWholeBase: entry?.mounce?.appliesToWholeBase ?? false,
      cardGloss: picked,
    };
  });

  const collidingMounceKeys: Array<{ key: string; lemmas: string[] }> = [];
  const lemmasByKey = new Map<string, string[]>();
  for (const entry of mounce.entries) {
    for (const ref of entry.strongs) {
      const list = lemmasByKey.get(ref.canonical) ?? [];
      list.push(entry.lemma);
      lemmasByKey.set(ref.canonical, list);
    }
  }
  for (const [key, lemmas] of lemmasByKey) {
    if (new Set(lemmas).size > 1) collidingMounceKeys.push({ key, lemmas: [...new Set(lemmas)] });
  }
  collidingMounceKeys.sort((a, b) => a.key.localeCompare(b.key));

  const doctor = {
    status: Object.values(checks).every(Boolean) ? "healthy" : "unhealthy",
    sources: {
      mounce: {
        name: "Mounce Concise Greek-English Dictionary",
        url: MOUNCE_URL,
        license: "Attribution-NonCommercial — free for non-commercial, non-revenue-bearing use",
        requiredAttribution: MOUNCE_REQUIRED_ATTRIBUTION,
        snapshotDate: SNAPSHOT_DATE,
        rawSha256: inputs.mounce.sha256,
        rawBytes: inputs.mounce.bytes,
      },
      tbesg: {
        name: "STEPBible TBESG (Abbott-Smith / Middle Liddell / STEPBible)",
        url: TBESG_URL,
        license: "CC BY 4.0",
        requiredAttribution: TBESG_REQUIRED_ATTRIBUTION,
        rider: TBESG_REDISTRIBUTION_RIDER,
        snapshotDate: SNAPSHOT_DATE,
        rawSha256: inputs.tbesg.sha256,
        rawBytes: inputs.tbesg.bytes,
      },
    },
    coverage: {
      entryCount: index.entryCount,
      mounceKeyCount: index.mounceKeyCount,
      tbesgKeyCount: index.tbesgKeyCount,
      bothKeyCount: index.bothKeyCount,
      splitBases: tbesg.stats.splitBases,
      cardGloss: {
        budgetWords: 25,
        bySource: cardGlossSource,
        missing: cardGlossMissing,
        overBudget: cardGlossOverBudget,
        /** Keys whose card gloss speaks to the base, not to this sense. */
        baseSense: cardGlossBaseSense,
      },
      ...index.stats,
      mounceParse: mounce.stats,
      tbesgParse: {
        dataRows: tbesg.stats.dataRows,
        distinctDStrong: tbesg.stats.distinctDStrong,
        distinctBases: tbesg.stats.distinctBases,
        suffixedDStrong: tbesg.stats.suffixedDStrong,
        meaningNonEmpty: tbesg.stats.meaningNonEmpty,
        byRelation: tbesg.stats.byRelation,
        combinationUStrong: tbesg.stats.combinationUStrong,
      },
    },
    checks,
    samples,
    review: {
      mounceRejections: mounce.rejections,
      tbesgRejections: tbesg.rejections,
      /**
       * Strong's keys claimed by more than one Mounce lemma. Reported, never
       * silently merged — Σαλαμίς and Σαλείμ both claim G4529, and the
       * upstream dictionary.json resolves that collision by printing the wrong
       * city's definition.
       */
      collidingMounceStrongsKeys: collidingMounceKeys,
      /** Keys where the card must draw no Meaning block at all. */
      cardGlossMissingKeys,
      /** Keys where the only available gloss exceeds the 25-word budget. */
      cardGlossOverBudgetKeys,
    },
    artifact: {
      formatVersion: index.version,
      normalizedSha256: sha256(JSON.stringify(index)),
    },
  };

  if (doctor.status !== "healthy") {
    writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    throw new Error(`Greek short-def Doctor refused import. Failed checks: ${failed.join(", ")}`);
  }

  const normalized = JSON.stringify(index);
  writeFileSync(OUTPUT, normalized);
  writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);

  console.log(`Wrote ${OUTPUT}`);
  console.log(`  entries: ${index.entryCount}`);
  console.log(
    `  Mounce keys: ${index.mounceKeyCount}  TBESG keys: ${index.tbesgKeyCount}  both: ${index.bothKeyCount}`,
  );
  console.log(`  Mounce attached at base level (sense-suffixed keys): ${index.stats.mounceAttachedAtBaseLevel}`);
  console.log(`  Mounce's own extension-letter keys, kept separate: ${index.stats.mounceExtensionLetterKeys}`);
  console.log(
    `  TBESG col-8 attribution: AS ${index.stats.byTbesgAttribution["abbott-smith"]}` +
      ` · ML ${index.stats.byTbesgAttribution["middle-liddell"]}` +
      ` · STEPBible ${index.stats.byTbesgAttribution.stepbible}`,
  );
  console.log(
    `  25-word card slot won by: Mounce ${cardGlossSource["mounce-definition"] ?? 0}` +
      ` · TBESG Gloss ${cardGlossSource["tbesg-gloss"] ?? 0}` +
      ` · none ${cardGlossMissing} · over budget ${cardGlossOverBudget}` +
      ` · base-sense ${cardGlossBaseSense}`,
  );
  console.log(`  Mounce Strong's keys claimed by >1 lemma: ${collidingMounceKeys.length}`);
  console.log(`  Doctor: ${DOCTOR_OUTPUT} (${doctor.status})`);
  console.log(`  size: ~${(Buffer.byteLength(normalized) / 1024 / 1024).toFixed(2)} MB`);
  for (const sample of samples) {
    console.log(
      `  ${sample.key} ${sample.greek ?? "?"}` +
        `\n      Mounce (${sample.mounceWords} words): ${sample.mounceDefinition ?? "—"}` +
        `\n      TBESG gloss: ${sample.tbesgGloss ?? "—"}` +
        `   article: ${sample.tbesgMeaningWords ?? "—"} words [${sample.tbesgAttribution ?? "—"}]`,
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
