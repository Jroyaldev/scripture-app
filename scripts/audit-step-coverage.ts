/**
 * Diagnose STEP morph overlay coverage across full packages.
 * Categorizes misses and projects coverage after low-effort fix classes.
 *
 *   npx tsx scripts/audit-step-coverage.ts
 */

import { readFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StepMorphIndex } from "../src/core/language/step-morph.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MORPH = resolve(ROOT, "data/scripture/morph");

type Bucket = { nCodes: number; nTokens: number; examples: string[] };

async function collect(
  packageId: string,
): Promise<{ counts: Map<string, number>; sample: Map<string, string> }> {
  const path = resolve(ROOT, `data/scripture/packages/${packageId}/tokens.jsonl`);
  const counts = new Map<string, number>();
  const sample = new Map<string, string>();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as {
        morphCode?: string;
        book?: string;
        chapter?: number;
        verse?: number;
        surface?: string;
      };
      const c = (t.morphCode ?? "").trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      if (!sample.has(c)) {
        sample.set(c, `${t.book} ${t.chapter}:${t.verse} “${t.surface}”`);
      }
    } catch {
      /* skip */
    }
  }
  return { counts, sample };
}

function classifyGreek(index: StepMorphIndex, code: string): string {
  if (index.lookup(code)) return "HIT";

  // A-NPM-S, V-PAI-3P-ATT, N-NSF-LG …
  const stripExtra = code.replace(
    /-(?:ATT|C|S|N|K|L|LG|PG|T|P|I|M|F|ABB|I|C)+$/i,
    "",
  );
  if (stripExtra !== code && index.lookup(stripExtra)) return "FIX_strip_trailing_extra";

  // Multi -X-Y: try drop last segment
  const parts = code.split("-");
  if (parts.length >= 3) {
    const base = parts.slice(0, -1).join("-");
    if (index.lookup(base)) return "FIX_drop_last_segment";
  }

  // V-2AAI-3S → V-AAI-3S already often hit; if not
  if (/^V-2/.test(code)) {
    const no2 = code.replace(/^V-2/, "V-");
    if (index.lookup(no2)) return "FIX_second_aorist_2";
  }

  // Repeated strip of trailing extras
  let cur = code;
  for (let i = 0; i < 3; i++) {
    const next = cur.replace(/-[A-Z0-9]{1,4}$/i, "");
    if (next === cur) break;
    if (index.lookup(next)) return "FIX_strip_trailing_extra";
    cur = next;
  }

  if (code === "HEB" || code === "ARAM" || /^HEB/i.test(code) || /^ARAM/i.test(code)) {
    return "FIX_foreign_token";
  }

  if (code.includes(" ") || code.includes("----")) return "FIX_padded_morphgnt";

  // Short function codes: PREP, CONJ, COND-K
  if (!code.includes("-") || /^[A-Z]{2,6}(-[A-Z])?$/.test(code)) {
    if (index.lookup(code)) return "HIT";
    // try as PRT / PREP family in STEP
    return "FIX_short_or_function_code";
  }

  return "HARD_greek";
}

function classifyHebrew(index: StepMorphIndex, code: string): string {
  if (index.lookup(code)) return "HIT";

  if (code.includes("/")) {
    const segs = code.split("/").filter(Boolean);
    const last = segs[segs.length - 1]!;
    if (index.lookup(last)) return "FIX_composite_use_last_segment";

    // Pronominal suffix on last segment: …/Ncmsc/Sp3ms or NcmscSp3ms
    const lastNoSuf = last.replace(/S[pfd][123][a-z]{1,2}$/i, "");
    if (lastNoSuf !== last && index.lookup(lastNoSuf)) {
      return "FIX_strip_pronominal_suffix";
    }

    for (const s of segs) {
      if (index.lookup(s)) return "FIX_composite_partial_segment";
      const sNo = s.replace(/S[pfd][123][a-z]{1,2}$/i, "");
      if (sNo !== s && index.lookup(sNo)) return "FIX_strip_pronominal_suffix";
    }

    // Prefix particles HC, HR, HTd, HRd alone rarely need STEP prose
    if (segs.length >= 2 && index.lookup(segs[0]!)) {
      return "FIX_composite_use_first_segment";
    }

    return "FIX_composite_unresolved";
  }

  // Atomic with pronominal suffix glued
  const noSuf = code.replace(/S[pfd][123][a-z]{1,2}$/i, "");
  if (noSuf !== code && index.lookup(noSuf)) return "FIX_strip_pronominal_suffix";

  if (code === "HNp" || code === "ANp" || /^[HA]Np$/.test(code)) {
    return "FIX_proper_name_stub";
  }

  // Proper names with extras HNcmsa sometimes hit; HNp doesn't

  return "HARD_hebrew";
}

async function analyze(
  index: StepMorphIndex,
  packageId: string,
  lang: "grc" | "hbo",
): Promise<{
  totalCodes: number;
  totalTokens: number;
  hitCodes: number;
  hitTokens: number;
  missCodes: number;
  missTokens: number;
  buckets: Map<string, Bucket>;
}> {
  const { counts, sample } = await collect(packageId);
  const buckets = new Map<string, Bucket>();
  let hitCodes = 0;
  let hitTokens = 0;
  let missCodes = 0;
  let missTokens = 0;

  for (const [code, n] of counts) {
    const hit = !!index.lookup(code);
    const cat = hit
      ? "HIT"
      : lang === "grc"
        ? classifyGreek(index, code)
        : classifyHebrew(index, code);
    if (hit) {
      hitCodes++;
      hitTokens += n;
    } else {
      missCodes++;
      missTokens += n;
    }
    const b = buckets.get(cat) ?? { nCodes: 0, nTokens: 0, examples: [] };
    b.nCodes++;
    b.nTokens += n;
    if (b.examples.length < 6) {
      b.examples.push(`${code} (×${n}) · ${sample.get(code)}`);
    }
    buckets.set(cat, b);
  }

  const totalCodes = counts.size;
  const totalTokens = [...counts.values()].reduce((a, b) => a + b, 0);
  return { totalCodes, totalTokens, hitCodes, hitTokens, missCodes, missTokens, buckets };
}

function pct(n: number, d: number): string {
  return d ? ((100 * n) / d).toFixed(1) : "0.0";
}

function printReport(
  name: string,
  r: Awaited<ReturnType<typeof analyze>>,
): void {
  console.log("\n" + "=".repeat(72));
  console.log(name);
  console.log("=".repeat(72));
  console.log(`Unique codes: ${r.totalCodes}  |  token instances: ${r.totalTokens.toLocaleString()}`);
  console.log(
    `HIT  codes: ${r.hitCodes} (${pct(r.hitCodes, r.totalCodes)}%)  tokens: ${r.hitTokens.toLocaleString()} (${pct(r.hitTokens, r.totalTokens)}%)`,
  );
  console.log(
    `MISS codes: ${r.missCodes} (${pct(r.missCodes, r.totalCodes)}%)  tokens: ${r.missTokens.toLocaleString()} (${pct(r.missTokens, r.totalTokens)}%)`,
  );
  console.log("\nBy category (token impact):");
  const rows = [...r.buckets.entries()].sort((a, b) => b[1].nTokens - a[1].nTokens);
  for (const [cat, b] of rows) {
    console.log(`\n  ${cat}`);
    console.log(
      `    codes=${b.nCodes}  tokens=${b.nTokens.toLocaleString()} (${pct(b.nTokens, r.totalTokens)}%)`,
    );
    for (const ex of b.examples) console.log(`      · ${ex}`);
  }
}

function project(r: Awaited<ReturnType<typeof analyze>>, cats: string[]): number {
  let add = 0;
  for (const c of cats) add += r.buckets.get(c)?.nTokens ?? 0;
  return (100 * (r.hitTokens + add)) / r.totalTokens;
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
  console.log(`STEP index size: ${index.size} unique codes`);

  const g = await analyze(index, "macula-greek-nestle1904", "grc");
  const h = await analyze(index, "oshb-wlc", "hbo");
  printReport("GREEK — macula-greek-nestle1904", g);
  printReport("HEBREW — oshb-wlc", h);

  const gFix = [...g.buckets.keys()].filter((k) => k.startsWith("FIX_"));
  const hFix = [...h.buckets.keys()].filter((k) => k.startsWith("FIX_"));

  console.log("\n" + "=".repeat(72));
  console.log("PROJECTED TOKEN COVERAGE (if fix class fully applied)");
  console.log("=".repeat(72));

  console.log("\nGreek");
  console.log(`  baseline exact:     ${pct(g.hitTokens, g.totalTokens)}%`);
  console.log(
    `  + strip trailing:   ${project(g, ["FIX_strip_trailing_extra"]).toFixed(1)}%`,
  );
  console.log(
    `  + drop last / 2aor: ${project(g, ["FIX_strip_trailing_extra", "FIX_drop_last_segment", "FIX_second_aorist_2"]).toFixed(1)}%`,
  );
  console.log(`  + all FIX_* :       ${project(g, gFix).toFixed(1)}%`);
  console.log(
    `  HARD remaining:     ${pct(g.buckets.get("HARD_greek")?.nTokens ?? 0, g.totalTokens)}% tokens`,
  );

  console.log("\nHebrew");
  console.log(`  baseline exact:           ${pct(h.hitTokens, h.totalTokens)}%`);
  console.log(
    `  + last segment only:      ${project(h, ["FIX_composite_use_last_segment"]).toFixed(1)}%`,
  );
  console.log(
    `  + last + suffix strip:    ${project(h, ["FIX_composite_use_last_segment", "FIX_strip_pronominal_suffix", "FIX_composite_partial_segment"]).toFixed(1)}%`,
  );
  console.log(
    `  + + proper name stubs:    ${project(h, ["FIX_composite_use_last_segment", "FIX_strip_pronominal_suffix", "FIX_composite_partial_segment", "FIX_proper_name_stub", "FIX_composite_use_first_segment"]).toFixed(1)}%`,
  );
  console.log(`  + all FIX_* :             ${project(h, hFix).toFixed(1)}%`);
  console.log(
    `  HARD remaining:           ${pct(h.buckets.get("HARD_hebrew")?.nTokens ?? 0, h.totalTokens)}% tokens`,
  );
  console.log(
    `  composite unresolved:     ${pct(h.buckets.get("FIX_composite_unresolved")?.nTokens ?? 0, h.totalTokens)}% tokens`,
  );

  console.log(`
=== Effort / impact guide ===
LOW effort, HIGH impact
  · Greek: strip trailing -S/-C/-ATT/-LG extras before lookup
  · Hebrew: split on "/", look up LAST content segment (the lexical word)
  · Hebrew: strip Sp3ms-style pronominal suffixes then lookup

MEDIUM effort
  · Hebrew proper-name stub (HNp) → generic STEP-like prose without table
  · Greek short function codes (PREP, CONJ) map to TEGMC keys if present

HARD / diminishing returns
  · Full multi-segment STEP for every prefix combo (HC/R/Td/…) — not in STEP tables
  · True 100% of unique *codes* is unrealistic; ~100% of *token instances*
    with a useful overlay (exact OR normalized OR stub) is the real target

Honest ceiling
  · Greek: ~99%+ of tokens with strip-extra + a few maps
  · Hebrew: mid–high 80s–90s% of tokens with composite-last + suffix strip + name stubs;
    remaining are rare morphology or multi-prefix chains with no STEP row
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
