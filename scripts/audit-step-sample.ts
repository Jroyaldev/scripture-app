/**
 * Sample 16 challenge tokens across the Bible and report STEP overlay presence.
 *
 *   npx tsx scripts/audit-step-sample.ts
 */

import { readFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  StepMorphIndex,
  getSharedStepMorphIndex,
  setSharedStepMorphIndex,
} from "../src/core/language/step-morph.ts";
import { explainMorphCode } from "../src/core/language/morph-explain.ts";
import { morphFeatureLabels, parseMorphCode } from "../src/core/language/morph-labels.ts";
import { hebrewMorphFeatureLabels } from "../src/core/language/hebrew-morph-labels.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MORPH = resolve(ROOT, "data/scripture/morph");

/** Challenge set: mix of easy hits, known hard cases, OT/NT. */
const CHALLENGES: { label: string; book: string; chapter: number; verse: number; want?: string }[] = [
  { label: "Classic future passive", book: "1CO", chapter: 13, verse: 8, want: "καταργ" },
  { label: "Narrative aorist", book: "MAT", chapter: 1, verse: 16 },
  { label: "Personal pronoun gen", book: "MAT", chapter: 1, verse: 2 },
  { label: "Article + particle", book: "JHN", chapter: 1, verse: 1 },
  { label: "Imperative perfect?", book: "MRK", chapter: 4, verse: 39 },
  { label: "Participle dense", book: "ACT", chapter: 19, verse: 1 },
  { label: "Hebrew create", book: "GEN", chapter: 1, verse: 1 },
  { label: "Hebrew construct chain", book: "GEN", chapter: 1, verse: 2 },
  { label: "waw consecutive", book: "GEN", chapter: 1, verse: 3 },
  { label: "Divine name / God", book: "GEN", chapter: 1, verse: 1 },
  { label: "Poetry imperfect", book: "PSA", chapter: 23, verse: 1 },
  { label: "Prophetic hiphil", book: "ISA", chapter: 7, verse: 14 },
  { label: "Aramaic Daniel", book: "DAN", chapter: 2, verse: 8 },
  { label: "Composite prep+noun", book: "1CH", chapter: 1, verse: 10 },
  { label: "Revelation aorist", book: "REV", chapter: 1, verse: 1 },
  { label: "Epistle dense morph", book: "ROM", chapter: 8, verse: 28 },
];

async function loadTokens(
  packageId: string,
  book: string,
  chapter: number,
  verse: number,
): Promise<
  { id: string; surface: string; morphCode?: string; lemma?: string; gloss?: string }[]
> {
  const path = resolve(ROOT, `data/scripture/packages/${packageId}/tokens.jsonl`);
  const out: { id: string; surface: string; morphCode?: string; lemma?: string; gloss?: string }[] =
    [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as {
        id: string;
        book: string;
        chapter: number;
        verse: number;
        surface: string;
        morphCode?: string;
        lemma?: string;
        gloss?: string;
      };
      if (t.book === book && t.chapter === chapter && t.verse === verse) {
        out.push(t);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function pickToken(
  tokens: { id: string; surface: string; morphCode?: string; lemma?: string; gloss?: string }[],
  want?: string,
) {
  if (want) {
    const hit = tokens.find((t) => t.surface.includes(want) || (t.lemma ?? "").includes(want));
    if (hit) return hit;
  }
  // Prefer content-ish: has morph and not ultra short
  const content = tokens.filter((t) => t.morphCode && t.surface.replace(/\//g, "").length > 1);
  return content[Math.floor(content.length / 3)] ?? content[0] ?? tokens[0];
}

async function main(): Promise<void> {
  const index = new StepMorphIndex();
  index.loadTable(
    readFileSync(resolve(MORPH, "TEGMC-STEPBible-CC-BY.txt"), "utf8"),
    "STEPBible TEGMC",
  );
  index.loadTable(
    readFileSync(resolve(MORPH, "TEHMC-STEPBible-CC-BY.txt"), "utf8"),
    "STEPBible TEHMC",
  );
  setSharedStepMorphIndex(index);

  console.log(`STEP index: ${index.size} codes\n`);
  console.log("=== 16 challenge samples ===\n");

  let stepYes = 0;
  let stepNo = 0;
  let unknownChip = 0;

  for (const c of CHALLENGES) {
    const isNt = ![
      "GEN",
      "EXO",
      "LEV",
      "NUM",
      "DEU",
      "JOS",
      "JDG",
      "RUT",
      "1SA",
      "2SA",
      "1KI",
      "2KI",
      "1CH",
      "2CH",
      "EZR",
      "NEH",
      "EST",
      "JOB",
      "PSA",
      "PRO",
      "ECC",
      "SNG",
      "ISA",
      "JER",
      "LAM",
      "EZK",
      "DAN",
      "HOS",
      "JOL",
      "AMO",
      "OBA",
      "JON",
      "MIC",
      "NAH",
      "HAB",
      "ZEP",
      "HAG",
      "ZEC",
      "MAL",
    ].includes(c.book);
    // crude OT list — use package pick
    const otBooks = new Set([
      "GEN",
      "1CH",
      "PSA",
      "ISA",
      "DAN",
      "EXO",
      "JER",
      "1SA",
      "1KI",
      "2SA",
      "2KI",
    ]);
    const pkg = otBooks.has(c.book) || (!isNt && c.book.length <= 3 && !["MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"].includes(c.book))
      ? "oshb-wlc"
      : "macula-greek-nestle1904";
    // Fix: use explicit NT set
    const NT = new Set(["MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"]);
    const packageId = NT.has(c.book) ? "macula-greek-nestle1904" : "oshb-wlc";

    const tokens = await loadTokens(packageId, c.book, c.chapter, c.verse);
    if (tokens.length === 0) {
      console.log(`✗ ${c.label}  ${c.book} ${c.chapter}:${c.verse}`);
      console.log(`    no tokens in ${packageId}\n`);
      stepNo++;
      continue;
    }
    const t = pickToken(tokens, c.want)!;
    const step = index.lookup(t.morphCode ?? "");
    const isHeb = packageId === "oshb-wlc";
    const labels = isHeb
      ? hebrewMorphFeatureLabels(t.morphCode)
      : morphFeatureLabels(parseMorphCode(t.morphCode));
    const ex = explainMorphCode(t.morphCode, {
      language: isHeb ? "hbo" : "grc",
      labels,
    });
    const unk = ex?.parts.filter((p) => p.unknown).length ?? 0;
    if (unk) unknownChip++;
    if (step) stepYes++;
    else stepNo++;

    console.log(`${step ? "●" : "○"} ${c.label}`);
    console.log(`    ${c.book} ${c.chapter}:${c.verse}  “${t.surface}”  code=${t.morphCode ?? "—"}`);
    console.log(`    chips: ${ex?.summary ?? "(none)"}${unk ? `  unknowns=${unk}` : ""}`);
    if (step) {
      console.log(`    STEP:  ${step.phrase.slice(0, 90)}`);
      console.log(`           ${(step.explanation || "").slice(0, 100)}`);
    } else {
      console.log(`    STEP:  — no overlay (composite or rare code)`);
    }
    console.log("");
  }

  console.log("=== Summary ===");
  console.log(`STEP shows: ${stepYes}/${CHALLENGES.length}`);
  console.log(`STEP missing: ${stepNo}/${CHALLENGES.length}`);
  console.log(`Samples with unknown chip labels: ${unknownChip}`);
  console.log(`
Challenges for manual UI audit:
1. Ambient scroll while form notes open — verse must NOT jump (sticky fix)
2. Pin a verse, open STEP — stays on pin
3. Greek hit (1 Cor 13:8) — STEP block under chip meanings
4. Hebrew composite (1Ch 1:10 earth) — often no STEP; chips still work
5. Switch word in strip while notes open — notes close, new card
6. Dark mode STEP block contrast
`);

  setSharedStepMorphIndex(null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
