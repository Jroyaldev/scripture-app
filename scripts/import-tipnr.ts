/**
 * Import STEPBible TIPNR → compact names index (all persons, places, other).
 *
 *   npx tsx scripts/import-tipnr.ts
 *
 * Records are separated by lines like:
 *   $========== PERSON(s)
 *   $========== PLACE
 *   $========== OTHER
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const INPUT = resolve(ROOT, "data/scripture/names/TIPNR-STEPBible-CC-BY.txt");
const OUTPUT = resolve(ROOT, "data/scripture/names/tipnr-index.json");

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
  brief: string;
  short?: string;
  uStrong: string;
  baseStrong: string;
  /** All Strong keys that refer to this individual (Heb + Grk forms). */
  strongs: string[];
  firstRef?: string;
  refs: string[];
  refCount: number;
  gender?: string;
};

export type TipnrIndex = {
  version: 2;
  source: string;
  license: string;
  generatedAt: string;
  entityCount: number;
  personCount: number;
  placeCount: number;
  otherCount: number;
  entities: Record<string, TipnrEntity>;
  byRef: Record<string, string[]>;
  byBaseStrong: Record<string, string[]>;
};

function normalizeStrongKey(s: string): string {
  const m = s.trim().match(/^([GH])0*(\d+)/i);
  if (!m) return s.trim().toUpperCase();
  return `${m[1]!.toUpperCase()}${m[2]}`;
}

function parseTipnrRefToken(tok: string): string | null {
  const m = tok.trim().match(/^(\d?[A-Za-z]{2,3})\.(\d+)\.(\d+)/);
  if (!m) return null;
  const book = TIPNR_TO_APP[m[1]!] ?? m[1]!.toUpperCase();
  return `${book}.${m[2]}.${m[3]}`;
}

/**
 * Expand "Mat.3.1; Mat.3.4; Exo.4.14ff; 5.1" style lists.
 * Store every distinct verse for byRef coverage (Jesus, David, Israel, …).
 */
function expandRefsField(field: string, max = 10_000): { refs: string[]; count: number } {
  const seen = new Set<string>();
  const refs: string[] = [];
  // Prefer fully expanded lists (many "Book.ch.v")
  const tokens = field.split(/[;]/).map((s) => s.trim()).filter(Boolean);
  let lastBook: string | null = null;
  for (const raw of tokens) {
    if (raw.startsWith("http")) continue;
    const t = raw.replace(/ff$/i, "").replace(/[ab]$/i, "").trim();
    // "4.12" continuation after Mat.3.1 style — attach last book
    let m = t.match(/^(\d?[A-Za-z]{2,3})\.(\d+)\.(\d+)/);
    if (m) {
      lastBook = m[1]!;
      const key = parseTipnrRefToken(`${m[1]}.${m[2]}.${m[3]}`);
      if (key && !seen.has(key)) {
        seen.add(key);
        if (refs.length < max) refs.push(key);
      }
      continue;
    }
    // ch.v only with remembered book
    m = t.match(/^(\d+)\.(\d+)/);
    if (m && lastBook) {
      const key = parseTipnrRefToken(`${lastBook}.${m[1]}.${m[2]}`);
      if (key && !seen.has(key)) {
        seen.add(key);
        if (refs.length < max) refs.push(key);
      }
    }
  }
  return { refs, count: seen.size };
}

function parseHeaderId(field0: string): {
  displayName: string;
  firstTipnr: string;
  uStrong: string;
  id: string;
} | null {
  const m = field0.match(/^([^@\t]+)@([^=\t]+)=([A-Za-z0-9]+)/);
  if (!m) return null;
  return {
    displayName: m[1]!.trim(),
    firstTipnr: m[2]!.trim(),
    uStrong: m[3]!.trim(),
    id: `${m[1]!.trim()}@${m[2]!.trim()}=${m[3]!.trim()}`,
  };
}

/** TIPNR machine id → readable label (Olives_Mount → Mount of Olives). */
function humanizeMachineName(raw: string): string {
  let s = raw
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d+)(?=\s|$)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const mount = s.match(/^(.+?)\s+Mount$/i);
  if (mount && !/^Mount\b/i.test(s)) {
    const base = mount[1]!.trim();
    s = /^Olives$/i.test(base) ? "Mount of Olives" : `Mount ${base}`;
  }
  const plains = s.match(/^(.+?)\s+Plains$/i);
  if (plains && !/^Plains\b/i.test(s)) {
    s = `Plains of ${plains[1]!.trim()}`;
  }
  return s;
}

/**
 * Prefer a human label for machine ids (Olives_Mount).
 * Leave clean names alone (Jesus stays “Jesus”, not “Jesus or Christ…”).
 */
function extractPrettyDisplayName(
  headerField0: string,
  uStrong: string,
  machineName: string,
  bodyLines: string[],
): string {
  const needsHumanize =
    machineName.includes("_") || /[a-z][A-Z]/.test(machineName);

  // Clean single-token names: keep as-is (avoid Total alias lists).
  if (!needsHumanize) return machineName;

  // 1) Text after Strong, before URL — places with map links
  //    e.g. =H2132GMount of Oliveshttps://…
  const eq = headerField0.indexOf(`=${uStrong}`);
  if (eq >= 0) {
    let rest = headerField0.slice(eq + 1 + uStrong.length);
    const http = rest.search(/https?:\/\//i);
    if (http >= 0) rest = rest.slice(0, http);
    rest = (rest.split(/[#<\t=]/)[0] ?? rest).trim();
    if (
      rest.length >= 2 &&
      rest.length <= 55 &&
      !/^(Man|Woman|King|Queen|Prophet|Priest|A |An |https)/i.test(rest) &&
      !/living at the time/i.test(rest) &&
      !/\bor\b|\//i.test(rest) &&
      /^[\p{L}0-9][\p{L}0-9\s'.\-–/()]*$/u.test(rest)
    ) {
      return rest;
    }
  }

  // 2) “– TotalMount of Olives H2132G…” / “– TotalMary MagdaleneG3137I…”
  for (const line of bodyLines) {
    if (!line.startsWith("– Total") && !line.startsWith("- Total")) continue;
    const body = line.replace(/^[-–]\s*Total\s*/i, "");
    const m = body.match(/^(.+?)\s*([GH]\d{1,5})/);
    if (!m) continue;
    const name = m[1]!.trim();
    if (
      name.length >= 2 &&
      name.length <= 60 &&
      !name.includes("@") &&
      !/\bor\b|\//i.test(name)
    ) {
      return name;
    }
  }

  // 3) Underscore / camelCase machine ids → spaces / Mount of …
  return humanizeMachineName(machineName);
}

/**
 * TIPNR prose uses nonstandard tags, e.g.
 *   <ref="Gen.2.8">Gen.2.8</ref>
 *   <ref="Genesis 2:8, 10">Genesis 2:8, 10</ref>
 *   <strong="H5731B">Eden</strong>
 * Keep the visible text; drop the markup so the margin card stays clean.
 */
function cleanTipnrProse(s: string): string {
  return s
    .replace(/<ref=["'][^"']*["']>([\s\S]*?)<\/ref>/gi, "$1")
    .replace(/<strong=["'][^"']*["']>([\s\S]*?)<\/strong>/gi, "$1")
    .replace(/<\/?ref\b[^>]*>/gi, "")
    .replace(/<\/?strong\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function kindFromMarker(marker: string): TipnrEntity["kind"] | null {
  const u = marker.toUpperCase().replace(/\s+/g, "");
  if (u.includes("PERSON")) return "person";
  if (u.includes("PLACE")) return "place";
  if (u.includes("OTHER")) return "other";
  return null;
}

function parseFile(text: string): TipnrIndex {
  const entities: Record<string, TipnrEntity> = {};
  const byRef: Record<string, string[]> = {};
  const byBaseStrong: Record<string, string[]> = {};

  // Split on $========== markers (each record or section header)
  const parts = text.split(/\n\$==========\s*/);
  // parts[0] is file header; subsequent start with PERSON(s)\nAaron@...

  for (const part of parts) {
    const trimmed = part.trimStart();
    if (!trimmed) continue;
    const nl = trimmed.indexOf("\n");
    const markerLine = (nl >= 0 ? trimmed.slice(0, nl) : trimmed).trim();
    const body = nl >= 0 ? trimmed.slice(nl + 1) : "";
    const kind = kindFromMarker(markerLine);
    if (!kind) continue;
    // Skip pure schema headers (no Name@=)
    if (!body.includes("@") || !/^[A-Za-z0-9].*@/.test(body.trimStart()) && !body.match(/^[^\n]+@/)) {
      // still try
    }

    const lines = body.split("\n");
    // Find first data header line with Name@ref=Strong
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (parseHeaderId((lines[i] ?? "").split("\t")[0] ?? "")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const headerFields = lines[headerIdx]!.split("\t");
    const header = parseHeaderId(headerFields[0] ?? "");
    if (!header) continue;

    let brief = "";
    let short = "";
    let refs: string[] = [];
    let refCount = 0;
    const strongs = new Set<string>([normalizeStrongKey(header.uStrong)]);
    const genderRaw = headerFields.find((f) => /^(Male|Female)/i.test(f.trim())) ?? "";
    const gender = genderRaw.trim() || undefined;

    const summaryField = headerFields.find((f) => f.includes("#A ") || f.startsWith("#"));
    if (summaryField) {
      brief = cleanTipnrProse(summaryField.replace(/^#/, "")).slice(0, 280);
    }

    for (const line of lines.slice(headerIdx + 1)) {
      if (line.startsWith("@Briefest=")) {
        if (!brief) brief = cleanTipnrProse(line.slice("@Briefest=".length));
      } else if (line.startsWith("@Brief=")) {
        const b = cleanTipnrProse(line.slice("@Brief=".length));
        if (b) brief = b;
      } else if (line.startsWith("@Short=")) {
        short = cleanTipnrProse(line.slice("@Short=".length));
      } else if (
        line.startsWith("– Named") ||
        line.startsWith("- Named") ||
        line.startsWith("– Greek") ||
        line.startsWith("- Greek") ||
        line.startsWith("– Aramaic") ||
        line.startsWith("– Spelled") ||
        line.startsWith("– Group")
      ) {
        const f = line.split("\t");
        // Capture dStrong from columns like G2491G«G2491=
        for (const col of f) {
          for (const sm of col.matchAll(/\b([GH]\d{1,5}[A-Za-z]?)\b/g)) {
            strongs.add(normalizeStrongKey(sm[1]!));
          }
          for (const sm2 of col.matchAll(/«([GH]\d+)/gi)) {
            strongs.add(normalizeStrongKey(sm2[1]!));
          }
          // STEP URLs embed full ref lists: reference=Mat.1.1;Mat.1.16;...
          if (col.includes("reference=")) {
            const q = col.match(/reference=([^&\s]+)/i);
            if (q?.[1]) {
              const expanded = expandRefsField(decodeURIComponent(q[1]).replace(/\|/g, ";"));
              if (expanded.refs.length > refs.length) {
                refs = expanded.refs;
                refCount = Math.max(refCount, expanded.count);
              }
            }
          }
        }
        const refField =
          f.find((x) => (x.match(/[A-Za-z]{3}\.\d+\.\d+/g) ?? []).length >= 2 && !x.startsWith("http")) ??
          f.find((x) => /[A-Za-z]{3}\.\d+\.\d+/.test(x) && !x.startsWith("http")) ??
          "";
        const expanded = expandRefsField(refField);
        if (expanded.refs.length > refs.length) {
          refs = expanded.refs;
          refCount = Math.max(refCount, expanded.count);
        } else if (expanded.count > refCount) {
          refCount = expanded.count;
        }
      } else if (line.startsWith("– Total") || line.startsWith("- Total")) {
        const f = line.split("\t");
        for (const col of f) {
          for (const m of col.matchAll(/\b([GH]\d{1,5}[A-Za-z]?)\b/g)) {
            strongs.add(normalizeStrongKey(m[1]!));
          }
        }
        // Prefer exhaustive Named/Greek URL lists; Total is often abbreviated (ff).
        if (refs.length < 20) {
          const refField = f.find((x) => /[A-Za-z]{3}\.\d+/.test(x)) ?? "";
          const expanded = expandRefsField(refField.replace(/ff/gi, ""));
          if (expanded.refs.length > refs.length) {
            refs = expanded.refs;
            refCount = Math.max(refCount, expanded.count);
          }
        }
      }
    }

    const firstTok = header.firstTipnr.split("-")[0] ?? "";
    const firstRef = parseTipnrRefToken(firstTok) ?? refs[0];
    if (refs.length === 0 && firstRef) {
      refs = [firstRef];
      refCount = 1;
    }
    brief = cleanTipnrProse(brief);
    short = cleanTipnrProse(short);
    const displayName = extractPrettyDisplayName(
      headerFields[0] ?? "",
      header.uStrong,
      header.displayName,
      lines.slice(headerIdx + 1),
    );
    if (!brief && short) brief = short.slice(0, 280);
    if (!brief) brief = displayName;

    const entity: TipnrEntity = {
      id: header.id,
      kind,
      displayName,
      brief: brief.slice(0, 320),
      short: short ? short.slice(0, 480) : undefined,
      uStrong: header.uStrong,
      baseStrong: normalizeStrongKey(header.uStrong),
      strongs: [...strongs],
      firstRef,
      refs,
      refCount: Math.max(refCount, refs.length),
      gender: gender && /^(Male|Female)/i.test(gender) ? gender : undefined,
    };

    // Prefer person/place over other if duplicate id race (shouldn't happen)
    if (entities[entity.id] && entities[entity.id]!.kind !== "other" && kind === "other") {
      continue;
    }
    entities[entity.id] = entity;

    const push = (map: Record<string, string[]>, key: string, id: string) => {
      if (!key) return;
      const arr = map[key] ?? [];
      if (!arr.includes(id)) arr.push(id);
      map[key] = arr;
    };

    for (const s of entity.strongs) push(byBaseStrong, s, entity.id);
    push(byBaseStrong, entity.baseStrong, entity.id);
    for (const r of entity.refs) push(byRef, r, entity.id);
    if (firstRef) push(byRef, firstRef, entity.id);
  }

  const list = Object.values(entities);
  return {
    version: 2,
    source: "STEPBible TIPNR",
    license: "CC BY 4.0",
    generatedAt: new Date().toISOString(),
    entityCount: list.length,
    personCount: list.filter((e) => e.kind === "person").length,
    placeCount: list.filter((e) => e.kind === "place").length,
    otherCount: list.filter((e) => e.kind === "other").length,
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
  const index = parseFile(readFileSync(INPUT, "utf8"));
  writeFileSync(OUTPUT, JSON.stringify(index));
  const sizeMb = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUTPUT}`);
  console.log(
    `  entities: ${index.entityCount} (person ${index.personCount}, place ${index.placeCount}, other ${index.otherCount})`,
  );
  console.log(`  byRef keys: ${Object.keys(index.byRef).length}`);
  console.log(`  byBaseStrong keys: ${Object.keys(index.byBaseStrong).length}`);
  console.log(`  size: ~${sizeMb} MB`);

  console.log("  MAT.1.1", index.byRef["MAT.1.1"]?.slice(0, 5));
  console.log("  MAT.3.1", index.byRef["MAT.3.1"]);
  console.log("  G11", index.byBaseStrong["G11"]?.slice(0, 3));
  console.log("  G1138", index.byBaseStrong["G1138"]?.slice(0, 3));
  console.log("  G2491", index.byBaseStrong["G2491"]);
}

main();
