/**
 * Import STEPBible TIPNR → compact names index for the Living Margin.
 *
 *   npx tsx scripts/import-tipnr.ts
 *
 * Input:  data/scripture/names/TIPNR-STEPBible-CC-BY.txt
 * Output: data/scripture/names/tipnr-index.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const INPUT = resolve(ROOT, "data/scripture/names/TIPNR-STEPBible-CC-BY.txt");
const OUTPUT = resolve(ROOT, "data/scripture/names/tipnr-index.json");

/** Our app book codes ← TIPNR UBS-style abbreviations. */
const TIPNR_TO_APP: Record<string, string> = {
  Gen: "GEN", Exo: "EXO", Lev: "LEV", Num: "NUM", Deu: "DEU",
  Jos: "JOS", Jdg: "JDG", Rut: "RUT", "1Sa": "1SA", "2Sa": "2SA",
  "1Ki": "1KI", "2Ki": "2KI", "1Ch": "1CH", "2Ch": "2CH",
  Ezr: "EZR", Neh: "NEH", Est: "EST", Job: "JOB", Psa: "PSA",
  Pro: "PRO", Ecc: "ECC", Sng: "SNG", Isa: "ISA", Jer: "JER",
  Lam: "LAM", Ezk: "EZK", Dan: "DAN", Hos: "HOS", Jol: "JOL",
  Amo: "AMO", Oba: "OBA", Jon: "JON", Mic: "MIC", Nam: "NAH",
  Hab: "HAB", Zep: "ZEP", Hag: "HAG", Zec: "ZEC", Mal: "MAL",
  Mat: "MAT", Mrk: "MRK", Luk: "LUK", Jhn: "JHN", Act: "ACT",
  Rom: "ROM", "1Co": "1CO", "2Co": "2CO", Gal: "GAL", Eph: "EPH",
  Php: "PHP", Col: "COL", "1Th": "1TH", "2Th": "2TH",
  "1Ti": "1TI", "2Ti": "2TI", Tit: "TIT", Phm: "PHM", Heb: "HEB",
  Jas: "JAS", "1Pe": "1PE", "2Pe": "2PE", "1Jn": "1JN", "2Jn": "2JN",
  "3Jn": "3JN", Jud: "JUD", Rev: "REV",
};

export type TipnrEntity = {
  id: string;
  kind: "person" | "place" | "other";
  displayName: string;
  /** One-line pastor blurb */
  brief: string;
  /** Slightly longer when present */
  short?: string;
  uStrong: string;
  /** G2491 without disambiguation letter */
  baseStrong: string;
  /** First occurrence key APP.ch.v */
  firstRef?: string;
  /** Compact ref list for UI (capped) */
  refs: string[];
  refCount: number;
  gender?: string;
};

export type TipnrIndex = {
  version: 1;
  source: string;
  license: string;
  generatedAt: string;
  entityCount: number;
  entities: Record<string, TipnrEntity>;
  /** APP.ch.v → entity ids (may be multiple at a verse) */
  byRef: Record<string, string[]>;
  /** base Strong G2491 / H0175 → entity ids */
  byBaseStrong: Record<string, string[]>;
};

function baseStrong(s: string): string {
  const m = s.trim().match(/^([GH])(\d+)/i);
  if (!m) return s.trim().toUpperCase();
  return `${m[1]!.toUpperCase()}${m[2]!.padStart(4, "0").replace(/^0+(\d)/, "$1")}`
    .replace(/^([GH])0+(\d)/, "$1$2");
}

/** Normalize Strong for matching: G2491G → G2491, H0175 → H175 optional pad */
function normalizeStrongKey(s: string): string {
  const m = s.trim().match(/^([GH])0*(\d+)/i);
  if (!m) return s.trim().toUpperCase();
  return `${m[1]!.toUpperCase()}${m[2]}`;
}

function parseTipnrRefToken(tok: string): string | null {
  // Mat.3.1 or Mat.3.1a or 1Co.13.8
  const m = tok.trim().match(/^(\d?[A-Za-z]{2,3})\.(\d+)\.(\d+)/);
  if (!m) return null;
  const book = TIPNR_TO_APP[m[1]!] ?? m[1]!.toUpperCase();
  return `${book}.${m[2]}.${m[3]}`;
}

function expandRefsField(field: string, max = 40): { refs: string[]; count: number } {
  // Full list often: Mat.3.1; Mat.3.4; ...
  const parts = field.split(/[;]/).map((s) => s.trim()).filter(Boolean);
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    // skip URLs
    if (p.startsWith("http")) continue;
    // strip trailing a/b markers Mat.3.1a
    const cleaned = p.replace(/[ab]$/, "");
    const key = parseTipnrRefToken(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (refs.length < max) refs.push(key);
  }
  return { refs, count: seen.size || refs.length };
}

function parseHeaderId(field0: string): {
  displayName: string;
  firstTipnr: string;
  uStrong: string;
  id: string;
} | null {
  // John@Mat.3.1-Act=G2491G
  const m = field0.match(/^([^@\t]+)@([^=\t]+)=([A-Za-z0-9]+)/);
  if (!m) return null;
  return {
    displayName: m[1]!.trim(),
    firstTipnr: m[2]!.trim(),
    uStrong: m[3]!.trim(),
    id: field0.trim(),
  };
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFile(text: string): TipnrIndex {
  const entities: Record<string, TipnrEntity> = {};
  const byRef: Record<string, string[]> = {};
  const byBaseStrong: Record<string, string[]> = {};

  // Split major sections
  const personStart = text.indexOf("$==========PERSON");
  const placeStart = text.indexOf("$==========PLACE");
  const otherStart = text.indexOf("$==========OTHER");

  type Sec = { kind: TipnrEntity["kind"]; body: string };
  const sections: Sec[] = [];
  if (personStart >= 0) {
    const end = placeStart >= 0 ? placeStart : otherStart >= 0 ? otherStart : text.length;
    sections.push({ kind: "person", body: text.slice(personStart, end) });
  }
  if (placeStart >= 0) {
    const end = otherStart >= 0 ? otherStart : text.length;
    sections.push({ kind: "place", body: text.slice(placeStart, end) });
  }
  if (otherStart >= 0) {
    sections.push({ kind: "other", body: text.slice(otherStart) });
  }

  for (const sec of sections) {
    // Records often start with Name@... on its own logical block; $ may separate
    const blocks = sec.body.split(/\n(?=[A-Za-z0-9][^@\n]{0,40}@)/);
    for (const block of blocks) {
      const lines = block.split("\n").filter((l) => l.length > 0);
      if (!lines[0]?.includes("@")) continue;
      const headerFields = lines[0]!.split("\t");
      const header = parseHeaderId(headerFields[0] ?? "");
      if (!header) continue;

      let brief = "";
      let short = "";
      let refs: string[] = [];
      let refCount = 0;
      const gender = (headerFields[9] ?? headerFields[8] ?? "").trim() || undefined;

      // Summary in header often field with #A prophet...
      const summaryField = headerFields.find((f) => f.includes("#A ") || f.startsWith("#"));
      if (summaryField) {
        brief = stripHtml(summaryField.replace(/^#/, "")).slice(0, 220);
      }

      for (const line of lines.slice(1)) {
        if (line.startsWith("@Briefest=")) {
          // keep if no better
          if (!brief) brief = line.slice("@Briefest=".length).trim();
        } else if (line.startsWith("@Brief=")) {
          brief = line.slice("@Brief=".length).trim() || brief;
        } else if (line.startsWith("@Short=")) {
          short = line.slice("@Short=".length).trim();
        } else if (line.startsWith("– Named") || line.startsWith("- Named") || line.includes("\tNamed\t") || line.startsWith("– Named\t") || line.startsWith("– Named")) {
          const f = line.split("\t");
          // refs often last wide field with Mat.3.1; Mat.3.4;
          const refField = f.find((x) => /\b[A-Za-z]{3}\.\d+\.\d+/.test(x) && x.includes(";"))
            ?? f[f.length - 1]
            ?? "";
          const expanded = expandRefsField(refField, 48);
          if (expanded.refs.length > refs.length) {
            refs = expanded.refs;
            refCount = expanded.count;
          }
        } else if (line.startsWith("– Total") || line.startsWith("- Total")) {
          const f = line.split("\t");
          const refField = f.find((x) => /[A-Za-z]{3}\.\d+/.test(x)) ?? "";
          // Total is often abbreviated; only use if we have no Named refs
          if (refs.length === 0) {
            const expanded = expandRefsField(refField.replace(/ff/g, ""), 24);
            refs = expanded.refs;
            refCount = Math.max(expanded.count, refCount);
          }
        }
      }

      // first ref from id
      const firstTok = header.firstTipnr.split("-")[0] ?? "";
      const firstRef = parseTipnrRefToken(firstTok) ?? refs[0];

      if (refs.length === 0 && firstRef) {
        refs = [firstRef];
        refCount = 1;
      }

      if (!brief && short) brief = short.slice(0, 220);
      if (!brief) brief = `${header.displayName} (${sec.kind})`;

      const entity: TipnrEntity = {
        id: header.id,
        kind: sec.kind,
        displayName: header.displayName,
        brief: brief.slice(0, 280),
        short: short ? short.slice(0, 400) : undefined,
        uStrong: header.uStrong,
        baseStrong: normalizeStrongKey(header.uStrong),
        firstRef,
        refs,
        refCount: refCount || refs.length,
        gender: gender && /^(Male|Female)/i.test(gender) ? gender : undefined,
      };

      entities[entity.id] = entity;

      const push = (map: Record<string, string[]>, key: string, id: string) => {
        if (!key) return;
        const arr = map[key] ?? [];
        if (!arr.includes(id)) arr.push(id);
        map[key] = arr;
      };

      push(byBaseStrong, entity.baseStrong, entity.id);
      for (const r of entity.refs) push(byRef, r, entity.id);
      if (firstRef) push(byRef, firstRef, entity.id);
    }
  }

  return {
    version: 1,
    source: "STEPBible TIPNR",
    license: "CC BY 4.0",
    generatedAt: new Date().toISOString(),
    entityCount: Object.keys(entities).length,
    entities,
    byRef,
    byBaseStrong,
  };
}

function main(): void {
  if (!existsSync(INPUT)) {
    console.error("Missing TIPNR file:", INPUT);
    process.exit(1);
  }
  console.log("Reading", INPUT);
  const text = readFileSync(INPUT, "utf8");
  const index = parseFile(text);
  writeFileSync(OUTPUT, JSON.stringify(index));
  const sizeMb = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  entities: ${index.entityCount}`);
  console.log(`  byRef keys: ${Object.keys(index.byRef).length}`);
  console.log(`  byBaseStrong keys: ${Object.keys(index.byBaseStrong).length}`);
  console.log(`  size: ~${sizeMb} MB`);

  // Sanity: John Baptist vs Apostle
  const jbn = Object.values(index.entities).filter((e) =>
    e.displayName === "John" && /Baptist|prophet who prepared/i.test(e.brief + (e.short ?? "")),
  );
  const jap = Object.values(index.entities).filter((e) =>
    e.displayName === "John" && /apostle|Zebedee/i.test(e.brief + (e.short ?? "")),
  );
  console.log("  sample John entities:", Object.values(index.entities).filter((e) => e.displayName === "John").length);
  console.log("  Baptist-ish:", jbn.slice(0, 2).map((e) => e.id));
  console.log("  Apostle-ish:", jap.slice(0, 2).map((e) => e.id));
  const mat31 = index.byRef["MAT.3.1"] ?? [];
  console.log("  MAT.3.1 →", mat31.map((id) => index.entities[id]?.displayName + " · " + index.entities[id]?.brief.slice(0, 50)));
}

main();
