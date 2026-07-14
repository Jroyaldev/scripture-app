/**
 * Build Strong → English gloss histogram from MACULA Hebrew syntax leaves.
 *
 * Adapter for Rendering Orbit when OSHB has no per-token glosses:
 * same job as Greek lemma→gloss spectrum, keyed by Strong’s.
 *
 *   npm run build:hebrew-orbit
 *   # or after import:
 *   npx tsx scripts/build-hebrew-orbit-index.ts
 *
 * Input:  data/scripture/syntax/macula-hebrew-wlc/*.json
 * Output: data/scripture/lexicons/hebrew-strong-orbit.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeOrbitGloss,
  formatOrbitLabel,
} from "../src/core/language/rendering-orbit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const INPUT = resolve(ROOT, "data/scripture/syntax/macula-hebrew-wlc");
const OUTPUT = resolve(ROOT, "data/scripture/lexicons/hebrew-strong-orbit.json");

type Leaf = { strong?: string; gloss?: string };
type SyntaxNode = Leaf & { tokenId?: string; children?: SyntaxNode[] };
type BookIndex = { sentences?: { root: SyntaxNode }[] };

function walk(n: SyntaxNode, into: Map<string, Map<string, number>>): void {
  if (n.tokenId && n.strong) {
    const strong = String(n.strong).replace(/^[Hh]/, "").replace(/^0+/, "") || String(n.strong);
    const g = normalizeOrbitGloss(n.gloss);
    if (g) {
      if (!into.has(strong)) into.set(strong, new Map());
      const m = into.get(strong)!;
      m.set(g, (m.get(g) ?? 0) + 1);
    }
  }
  for (const c of n.children ?? []) walk(c, into);
}

function main(): void {
  if (!existsSync(INPUT)) {
    console.error("Missing Hebrew syntax dir:", INPUT);
    console.error("Run: npm run import:macula-hebrew-syntax -- --input …/WLC/nodes");
    process.exit(1);
  }

  const byStrong = new Map<string, Map<string, number>>();
  const files = readdirSync(INPUT).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(INPUT, f), "utf8")) as BookIndex;
    for (const s of j.sentences ?? []) walk(s.root, byStrong);
  }

  const MAX = 8;
  const orbits: Record<
    string,
    { total: number; segments: { label: string; count: number; share: number }[] }
  > = {};

  for (const [strong, counts] of byStrong) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = sorted.slice(0, MAX);
    const used = top.reduce((s, [, c]) => s + c, 0);
    const rest = total - used;
    const segments = top.map(([label, count]) => ({
      label: formatOrbitLabel(label),
      count,
      share: count / total,
    }));
    if (rest > 0) {
      segments.push({
        label: `Other (${sorted.length - top.length})`,
        count: rest,
        share: rest / total,
      });
    }
    orbits[strong] = { total, segments };
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const payload = {
    version: 1,
    source: "MACULA Hebrew WLC syntax leaves (english/gloss)",
    license: "CC BY 4.0",
    generatedAt: new Date().toISOString(),
    strongCount: Object.keys(orbits).length,
    orbits,
  };
  writeFileSync(OUTPUT, JSON.stringify(payload));
  const mb = (Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  strong keys: ${payload.strongCount}, ~${mb} MB`);
  // spot checks
  for (const s of ["1254", "430", "776", "7225"]) {
    const o = orbits[s];
    console.log(
      `  H${s}:`,
      o ? o.segments.map((x) => `${x.label}:${Math.round(x.share * 100)}%`).join(" | ") : "—",
    );
  }
}

main();
