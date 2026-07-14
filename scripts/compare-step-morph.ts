/**
 * Offline audit: our morph expanders vs STEPBible TEGMC/TEHMC.
 *
 * Usage:
 *   npx tsx scripts/compare-step-morph.ts
 *   npx tsx scripts/compare-step-morph.ts --sample 40 --seed 7
 */

import { readFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { explainMorphCode } from "../src/core/language/morph-explain.ts";
import { morphFeatureLabels, parseMorphCode } from "../src/core/language/morph-labels.ts";
import { hebrewMorphFeatureLabels } from "../src/core/language/hebrew-morph-labels.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MORPH_DIR = resolve(ROOT, "data/scripture/morph");

type StepEntry = {
  code: string;
  fields: string;
  phrase: string;
  explanation: string;
  example: string;
};

function parseStepFullTable(text: string): Map<string, StepEntry> {
  const map = new Map<string, StepEntry>();
  const start = text.search(/^FULL MORPHOLOGY CODES:/m);
  if (start < 0) return map;
  const body = text.slice(start);
  const blocks = body.split(/\n\$\s*\n/);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, "").trimEnd())
      .filter((l) => l.trim().length > 0);

    let codeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (/^[A-Za-z0-9][A-Za-z0-9\-_/]*Function=/.test(l)) {
        codeLineIdx = i;
        break;
      }
      if (/^[A-Za-z0-9][A-Za-z0-9\-_/]*\s+Function=/.test(l)) {
        codeLineIdx = i;
        break;
      }
      if (
        /^[A-Za-z0-9][A-Za-z0-9\-_/]{1,24}$/.test(l.trim()) &&
        lines[i + 1]?.includes("Function=")
      ) {
        codeLineIdx = i;
        break;
      }
    }
    if (codeLineIdx < 0) continue;

    let code: string;
    let fields: string;
    const raw0 = lines[codeLineIdx]!;
    const glued = raw0.match(/^([A-Za-z0-9][A-Za-z0-9\-_/]*)(Function=.*)$/);
    if (glued) {
      code = glued[1]!;
      fields = glued[2]!;
    } else {
      const spaced = raw0.match(/^([A-Za-z0-9][A-Za-z0-9\-_/]*)\s+(Function=.*)$/);
      if (spaced) {
        code = spaced[1]!;
        fields = spaced[2]!;
      } else if (/^[A-Za-z0-9][A-Za-z0-9\-_/]+$/.test(raw0.trim())) {
        code = raw0.trim();
        fields = lines[codeLineIdx + 1] ?? "";
        codeLineIdx += 1;
      } else {
        continue;
      }
    }

    if (code.includes("CODE") || code.length < 2) continue;

    const rest = lines.slice(codeLineIdx + 1);
    const phrase = (rest[0] ?? "").replace(/^"+|"+$/g, "").trim();
    const explanation = (rest[1] ?? "").replace(/^"+|"+$/g, "").trim();
    const example = (rest[2] ?? "").replace(/^"+|"+$/g, "").trim();

    if (!fields.includes("Function=") && !phrase) continue;

    const entry: StepEntry = { code, fields, phrase, explanation, example };
    map.set(code, entry);
    map.set(code.toUpperCase(), entry);
  }
  return map;
}

function stepLookup(map: Map<string, StepEntry>, code: string): StepEntry | null {
  const c = code.trim();
  return map.get(c) ?? map.get(c.toUpperCase()) ?? map.get(c.toLowerCase()) ?? null;
}

async function collectCodes(
  jsonlPath: string,
  limitScan: number,
): Promise<
  { code: string; sampleSurface: string; book: string; chapter: number; verse: number }[]
> {
  const byCode = new Map<
    string,
    { code: string; sampleSurface: string; book: string; chapter: number; verse: number }
  >();
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    n++;
    if (n > limitScan) break;
    try {
      const t = JSON.parse(line) as {
        morphCode?: string;
        surface?: string;
        book?: string;
        chapter?: number;
        verse?: number;
      };
      const code = t.morphCode?.trim();
      if (!code || byCode.has(code)) continue;
      byCode.set(code, {
        code,
        sampleSurface: t.surface ?? "",
        book: t.book ?? "",
        chapter: t.chapter ?? 0,
        verse: t.verse ?? 0,
      });
    } catch {
      /* skip bad line */
    }
  }
  return [...byCode.values()];
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(arr: T[], k: number, rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.min(k, a.length));
}

type Row = {
  lang: string;
  code: string;
  ref: string;
  surface: string;
  our: string;
  ourUnknown: number;
  stepPhrase: string;
  stepExpl: string;
  stepExample: string;
  verdict: string;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sampleN = Number(args[args.indexOf("--sample") + 1] || 25);
  const seed = Number(args[args.indexOf("--seed") + 1] || 42);

  const tegmc = parseStepFullTable(
    readFileSync(resolve(MORPH_DIR, "TEGMC-STEPBible-CC-BY.txt"), "utf8"),
  );
  const tehmc = parseStepFullTable(
    readFileSync(resolve(MORPH_DIR, "TEHMC-STEPBible-CC-BY.txt"), "utf8"),
  );

  const unique = (m: Map<string, StepEntry>) =>
    new Set([...m.values()].map((e) => e.code)).size;

  console.log("STEP tables loaded");
  console.log(`  TEGMC unique codes: ${unique(tegmc)}`);
  console.log(`  TEHMC unique codes: ${unique(tehmc)}`);

  const greekCodes = await collectCodes(
    resolve(ROOT, "data/scripture/packages/macula-greek-nestle1904/tokens.jsonl"),
    250_000,
  );
  const hebCodes = await collectCodes(
    resolve(ROOT, "data/scripture/packages/oshb-wlc/tokens.jsonl"),
    250_000,
  );
  console.log(`  Unique Greek morphCodes in package: ${greekCodes.length}`);
  console.log(`  Unique Hebrew morphCodes in package: ${hebCodes.length}`);

  let gHit = 0;
  const gMissList: string[] = [];
  for (const c of greekCodes) {
    if (stepLookup(tegmc, c.code)) gHit++;
    else if (gMissList.length < 20) gMissList.push(c.code);
  }
  let hHit = 0;
  const hMissList: string[] = [];
  for (const c of hebCodes) {
    if (stepLookup(tehmc, c.code)) hHit++;
    else if (hMissList.length < 20) hMissList.push(c.code);
  }

  console.log("\n=== Coverage (exact morphCode → STEP) ===");
  console.log(
    `Greek:  ${gHit}/${greekCodes.length} (${((100 * gHit) / Math.max(1, greekCodes.length)).toFixed(1)}%)`,
  );
  console.log(
    `Hebrew: ${hHit}/${hebCodes.length} (${((100 * hHit) / Math.max(1, hebCodes.length)).toFixed(1)}%)`,
  );
  console.log("Greek miss sample:", gMissList.slice(0, 12).join(", ") || "(none)");
  console.log("Hebrew miss sample:", hMissList.slice(0, 12).join(", ") || "(none)");

  const rnd = mulberry32(seed);
  const gHitPool = greekCodes.filter((c) => stepLookup(tegmc, c.code));
  const hHitPool = hebCodes.filter((c) => stepLookup(tehmc, c.code));
  const gMissPool = greekCodes.filter((c) => !stepLookup(tegmc, c.code));
  const hMissPool = hebCodes.filter((c) => !stepLookup(tehmc, c.code));

  const rows: Row[] = [];

  const pushCompare = (
    lang: "grc" | "hbo",
    item: (typeof greekCodes)[0],
    map: Map<string, StepEntry> | null,
  ) => {
    const labels =
      lang === "hbo"
        ? hebrewMorphFeatureLabels(item.code)
        : morphFeatureLabels(parseMorphCode(item.code));
    const ex = explainMorphCode(item.code, { language: lang, labels });
    const step = map ? stepLookup(map, item.code) : null;
    const unk = ex?.parts.filter((p) => p.unknown).length ?? 0;

    let verdict: string;
    if (!step) {
      verdict = "STEP miss (we still expand)";
    } else if (!ex?.parts.length) {
      verdict = "improve (we had nothing)";
    } else if (unk > 0) {
      verdict = "improve (fill unknowns + STEP phrase)";
    } else {
      verdict = "enrich (STEP phrase/example; our chips OK)";
    }
    if (
      step &&
      (/past\/present/i.test(step.phrase) ||
        /past or present/i.test(step.explanation) ||
        /Tense=Past/i.test(step.fields))
    ) {
      verdict += " | caution: STEP tense stronger than ours";
    }

    rows.push({
      lang,
      code: item.code,
      ref: `${item.book} ${item.chapter}:${item.verse}`,
      surface: item.sampleSurface,
      our: ex?.summary ?? "(none)",
      ourUnknown: unk,
      stepPhrase: step?.phrase.slice(0, 120) ?? "— no STEP entry —",
      stepExpl: step?.explanation.slice(0, 140) ?? "—",
      stepExample: step?.example.slice(0, 100) ?? "—",
      verdict,
    });
  };

  for (const c of sample(gHitPool, sampleN, rnd)) pushCompare("grc", c, tegmc);
  for (const c of sample(hHitPool, sampleN, rnd)) pushCompare("hbo", c, tehmc);
  for (const c of sample(gMissPool, 5, rnd)) pushCompare("grc", c, tegmc);
  for (const c of sample(hMissPool, 5, rnd)) pushCompare("hbo", c, tehmc);

  console.log(`\n=== Random sample (seed=${seed}, ~${sampleN} hits each + 5 misses each) ===\n`);
  for (const r of rows) {
    console.log("─".repeat(72));
    console.log(`[${r.lang}] ${r.code}  @ ${r.ref}  “${r.surface}”`);
    console.log(`  OURS:  ${r.our}${r.ourUnknown ? `  (unknowns: ${r.ourUnknown})` : ""}`);
    console.log(`  STEP:  ${r.stepPhrase}`);
    if (r.stepExpl !== "—") console.log(`        ${r.stepExpl}`);
    if (r.stepExample && r.stepExample !== "—") console.log(`  e.g.   ${r.stepExample}`);
    console.log(`  → ${r.verdict}`);
  }

  const tally = new Map<string, number>();
  for (const r of rows) {
    const k = r.verdict.split(" | ")[0]!;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  console.log("\n=== Verdict tally ===");
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}\t${k}`);
  }

  console.log(`
=== Takeaway ===
• Adding STEP lookup is easy for exact codes (same Robinson / OSHB-style keys).
• Main gain: open-notes prose (phrase + functional sentence + example), not better chips.
• Hebrew STEP often maps Perfect → “Past/present” — can *regress* our careful aspect wording if used as default.
• Recommended: keep our chips; optionally show STEP explanation when notes are open,
  or only use STEP to fill unknown labels / add example line.
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
