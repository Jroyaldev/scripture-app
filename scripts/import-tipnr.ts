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

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BackboneData } from "../src/core/reference/types.js";
import type {
  TipnrEntity,
  TipnrIndexFile,
  TipnrParatextReference,
  TipnrPersonProfile,
  TipnrPersonRelationship,
  TipnrRelationshipKind,
  TipnrTranslation,
  TipnrTranslationVariant,
} from "../src/core/language/tipnr.js";
import {
  KJV_EPISTLE_SUBSCRIPTION_REFS,
  isKjvEpistleSubscriptionRef,
} from "../src/core/language/tipnr-subscriptions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const INPUT = resolve(ROOT, "data/scripture/names/TIPNR-STEPBible-CC-BY.txt");
const OUTPUT = resolve(ROOT, "data/scripture/names/tipnr-index.json");
const DOCTOR_OUTPUT = resolve(ROOT, "data/scripture/names/tipnr-doctor-report.json");
const BACKBONE_INPUT = resolve(ROOT, "data/scripture/backbone.json");
const ALIGNMENTS_INPUT = resolve(ROOT, "data/scripture/packages/akjv-strongs/alignments.jsonl");
const AKJV_TEXT_DIRECTORY = resolve(ROOT, "data/scripture/text/akjv-strongs");
const PLACE_OUTPUT = resolve(ROOT, "data/scripture/places/openbible-places.json");
const PLACE_DOCTOR_OUTPUT = resolve(ROOT, "data/scripture/places/doctor-report.json");
const TIPNR_SNAPSHOT_DATE = "2026-07-14";

// Two confirmed TIPNR coordinate typos. Keep the correction list explicit so
// the Doctor can report source drift instead of silently accepting bad verses.
const SOURCE_REFERENCE_CORRECTIONS: Readonly<Record<string, string>> = {
  "PSA.68.36": "PSA.68.35",
  "MAT.15.42": "MAT.12.12",
};

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

export type TipnrIndex = Omit<TipnrIndexFile, "version" | "personCount" | "placeCount" | "otherCount" | "byParatextRef"> & {
  version: 4;
  personCount: number;
  placeCount: number;
  otherCount: number;
  byParatextRef: Record<string, string[]>;
  sourceSha256: string;
  referenceModel: {
    canonical: "refs + byRef";
    translationVariants: "translationVariants";
    editionParatext: "paratextRefs + byParatextRef";
    kjvSubscriptionCoordinates: readonly string[];
  };
};

type ParsedReference = {
  ref: string;
  translation: "LXX" | null;
};

type SourceRow = {
  significance: string;
  label: string;
  refs: ParsedReference[];
  strongs: string[];
  translationForms: Array<{ form: string; translations: TipnrTranslation[] }>;
};

type AlignmentRow = {
  book: string;
  chapter: number;
  verse: number;
  tokens: Array<{ strongs?: string[] }>;
};

type RawPersonProfile = {
  description: string;
  parents: string;
  siblings: string;
  partners: string;
  offspring: string;
  affiliation: string;
};

type RelationshipResolutionIssue = {
  sourceId: string;
  kind: TipnrRelationshipKind;
  sourceValue: string;
  normalizedTarget: string;
  candidates: string[];
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
 * Expand TIPNR's compact reference grammar while retaining LXX provenance.
 * Examples:
 *   2Co.1.1,23; 13.13,14 → 2CO.1.1, 2CO.1.23, 2CO.13.13, 2CO.13.14
 *   LXX.Est.3.1           → EST.3.1 tagged LXX
 *
 * Bare chapter and `ff` abbreviations in Total rows are intentionally not
 * invented. Canonical coverage comes from the exhaustive structured subrows.
 */
export function expandTipnrRefsField(field: string, max = 10_000): ParsedReference[] {
  const seen = new Set<string>();
  const refs: ParsedReference[] = [];
  let lastBook: string | null = null;
  let lastChapter: number | null = null;
  let lastTranslation: "LXX" | null = null;

  const add = (
    book: string,
    chapter: number,
    startVerse: number,
    endVerse: number,
    translation: "LXX" | null,
  ): void => {
    if (endVerse < startVerse || endVerse - startVerse > 200) return;
    for (let verse = startVerse; verse <= endVerse; verse += 1) {
      const ref = parseTipnrRefToken(`${book}.${chapter}.${verse}`);
      if (!ref) continue;
      const identity = `${translation ?? "CANON"}:${ref}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (refs.length < max) refs.push({ ref, translation });
    }
  };

  for (const rawClause of field.split(";")) {
    let clause = rawClause.trim().replace(/^\[\s*/, "").replace(/\s*\]$/, "");
    if (!clause || clause.startsWith("http")) continue;
    const lxx = /^LXX\./i.test(clause);
    if (lxx) clause = clause.replace(/^LXX\./i, "");
    const translation = lxx ? "LXX" : lastTranslation;
    const commaParts = clause.split(",").map((part) => part.trim()).filter(Boolean);
    if (commaParts.length === 0) continue;

    const first = commaParts.shift()!.replace(/ff$/i, "").replace(/[ab]$/i, "");
    let firstMatch = first.match(/^(\d?[A-Za-z]{2,3})\.(\d+)\.(\d+)(?:[-–](\d+))?/);
    if (firstMatch) {
      lastBook = firstMatch[1]!;
      lastChapter = Number(firstMatch[2]);
      lastTranslation = lxx ? "LXX" : null;
      add(
        lastBook,
        lastChapter,
        Number(firstMatch[3]),
        Number(firstMatch[4] ?? firstMatch[3]),
        lastTranslation,
      );
    } else {
      firstMatch = first.match(/^(\d+)\.(\d+)(?:[-–](\d+))?/);
      if (firstMatch && lastBook) {
        lastChapter = Number(firstMatch[1]);
        if (lxx) lastTranslation = "LXX";
        add(
          lastBook,
          lastChapter,
          Number(firstMatch[2]),
          Number(firstMatch[3] ?? firstMatch[2]),
          translation,
        );
      } else {
        continue;
      }
    }

    for (const rawContinuation of commaParts) {
      if (!lastBook || lastChapter == null) break;
      const continuation = rawContinuation.replace(/ff$/i, "").replace(/[ab]$/i, "");
      const match = continuation.match(/^(\d+)(?:[-–](\d+))?/);
      if (!match) continue;
      add(
        lastBook,
        lastChapter,
        Number(match[1]),
        Number(match[2] ?? match[1]),
        lastTranslation,
      );
    }
  }
  return refs;
}

function extractUrlReferences(value: string): ParsedReference[] {
  const match = value.match(/reference=([^&\s]+)/i);
  if (!match?.[1]) return [];
  return expandTipnrRefsField(decodeURIComponent(match[1]).replace(/\|/g, ";"));
}

function parseTranslationForms(
  label: string,
  significance: string,
): Array<{ form: string; translations: TipnrTranslation[] }> {
  const cleaned = cleanTipnrProse(label);
  if (/^LXX addition$/i.test(significance)) {
    return cleaned ? [{ form: cleaned.replace(/\s*\(LXX\)\s*$/i, ""), translations: ["LXX"] }] : [];
  }

  const forms: Array<{ form: string; translations: TipnrTranslation[] }> = [];
  for (const segment of cleaned.split(";")) {
    const match = segment.trim().match(/^(.*?)\s*=\s*([A-Za-z]+(?:\s*,\s*[A-Za-z]+)*)(?:\s*\([^)]*\))?$/i);
    if (!match) continue;
    const form = match[1]!.trim();
    if (!form || /^\[\s*\]$/.test(form)) continue;
    const translations = match[2]!
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value): value is Exclude<TipnrTranslation, "LXX"> => (
        value === "ESV" || value === "KJV" || value === "NIV"
      ));
    if (translations.length === 0) continue;
    forms.push({ form, translations: [...new Set(translations)] });
  }
  return forms;
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
    // TIPNR's generated summaries systematically close a nonexistent
    // parenthesis after their first-reference link. Remove only that exact
    // line-ending artifact before stripping the source tags.
    .replace(/<\/ref>\s*\)(?=\s*(?:<br\s*\/?>|$))/gi, "</ref>")
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
  // TIPNR has ten records under PERSON+PLACE, but their header type and field
  // schema are explicitly Place. Treating PERSON as the first substring made
  // them people and exposed map URLs as family data.
  if (u.includes("PERSON+PLACE")) return "place";
  if (u.includes("PERSON")) return "person";
  if (u.includes("PLACE")) return "place";
  if (u.includes("OTHER")) return "other";
  return null;
}

function parsePersonDescription(description: string): Pick<TipnrPersonProfile, "role" | "era"> {
  const rules: RegExp[] = [
    /^(.*?)\s+living at the time before\s+(.+)$/i,
    /^(.*?)\s+living at the time of\s+(.+)$/i,
    /^(.*?)\s+living before\s+(.+)$/i,
    /^(.*?)\s+at the time of\s+(.+)$/i,
  ];
  for (const rule of rules) {
    const match = description.match(rule);
    if (!match) continue;
    const role = match[1]!.trim();
    const eraValue = match[2]!.trim();
    const before = /living (?:at the time )?before/i.test(description);
    return {
      role: role || description,
      ...(eraValue ? { era: before ? `Before ${eraValue.replace(/^the\s+/i, "")}` : eraValue } : {}),
    };
  }
  return { role: description };
}

function splitRelationshipValues(value: string, kind: TipnrRelationshipKind): string[] {
  const separator = kind === "parent" ? /\s*\+\s*/ : /\s*,\s*/;
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

function normalizeRelationshipTarget(value: string): { target: string; uncertain: boolean } {
  let target = value.trim();
  let uncertain = false;
  for (;;) {
    const qualifier = target.match(/\s*\(([^()]*)\)\s*$/);
    if (!qualifier) break;
    if (qualifier[1]?.includes("?")) uncertain = true;
    target = target.slice(0, qualifier.index).trim();
  }
  return { target, uncertain };
}

function applyPersonProfiles(
  entities: Record<string, TipnrEntity>,
  rawProfiles: Map<string, RawPersonProfile>,
): {
  sourceRelationshipCount: number;
  resolvedRelationshipCount: number;
  uncertainRelationshipCount: number;
  unresolved: RelationshipResolutionIssue[];
  ambiguous: RelationshipResolutionIssue[];
  duplicateRelationships: Array<{ sourceId: string; kind: TipnrRelationshipKind; targetId: string }>;
} {
  const exact = new Map(Object.values(entities).map((entity) => [entity.id, entity]));
  const byPrefix = new Map<string, TipnrEntity[]>();
  for (const entity of Object.values(entities)) {
    const prefix = entity.id.slice(0, entity.id.lastIndexOf("="));
    const candidates = byPrefix.get(prefix) ?? [];
    candidates.push(entity);
    byPrefix.set(prefix, candidates);
  }

  let sourceRelationshipCount = 0;
  let resolvedRelationshipCount = 0;
  let uncertainRelationshipCount = 0;
  const unresolved: RelationshipResolutionIssue[] = [];
  const ambiguous: RelationshipResolutionIssue[] = [];
  const duplicateRelationships: Array<{ sourceId: string; kind: TipnrRelationshipKind; targetId: string }> = [];
  const fields: Array<[TipnrRelationshipKind, keyof Pick<RawPersonProfile, "parents" | "siblings" | "partners" | "offspring">]> = [
    ["parent", "parents"],
    ["sibling", "siblings"],
    ["partner", "partners"],
    ["offspring", "offspring"],
  ];

  for (const [sourceId, raw] of rawProfiles) {
    const source = entities[sourceId];
    if (!source || source.kind !== "person") continue;
    const parsedDescription = parsePersonDescription(raw.description);
    const relationships: TipnrPersonRelationship[] = [];
    const seen = new Set<string>();

    for (const [kind, field] of fields) {
      for (const sourceValue of splitRelationshipValues(raw[field], kind)) {
        sourceRelationshipCount += 1;
        const normalized = normalizeRelationshipTarget(sourceValue);
        const exactTarget = exact.get(normalized.target);
        const candidates = exactTarget ? [exactTarget] : (byPrefix.get(normalized.target) ?? []);
        if (candidates.length !== 1) {
          const issue = {
            sourceId,
            kind,
            sourceValue,
            normalizedTarget: normalized.target,
            candidates: candidates.map((candidate) => candidate.id),
          };
          (candidates.length === 0 ? unresolved : ambiguous).push(issue);
          continue;
        }
        const target = candidates[0]!;
        const identity = `${kind}\u0000${target.id}`;
        if (seen.has(identity)) {
          duplicateRelationships.push({ sourceId, kind, targetId: target.id });
          continue;
        }
        seen.add(identity);
        resolvedRelationshipCount += 1;
        if (normalized.uncertain) uncertainRelationshipCount += 1;
        relationships.push({
          kind,
          targetId: target.id,
          displayName: target.displayName,
          ...(normalized.uncertain ? { uncertain: true } : {}),
        });
      }
    }

    source.person = {
      description: raw.description,
      ...parsedDescription,
      ...((raw.affiliation && raw.affiliation !== ">") ? { affiliation: raw.affiliation } : {}),
      relationships,
    };
  }

  return {
    sourceRelationshipCount,
    resolvedRelationshipCount,
    uncertainRelationshipCount,
    unresolved,
    ambiguous,
    duplicateRelationships,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function addStrongKeys(columns: string[], target: Set<string>): string[] {
  const rowStrongSet = new Set<string>();
  for (const column of columns) {
    for (const match of column.matchAll(/\b([GH]\d{1,5}[A-Za-z]?)\b/g)) {
      const normalized = normalizeStrongKey(match[1]!);
      target.add(normalized);
      rowStrongSet.add(normalized);
    }
    for (const match of column.matchAll(/«([GH]\d+)/gi)) {
      const normalized = normalizeStrongKey(match[1]!);
      target.add(normalized);
      rowStrongSet.add(normalized);
    }
  }
  return [...rowStrongSet];
}

function pushUnique(map: Record<string, string[]>, key: string, id: string): void {
  if (!key) return;
  const values = map[key] ?? [];
  if (!values.includes(id)) values.push(id);
  map[key] = values;
}

function validCoordinate(backbone: BackboneData, ref: string): boolean {
  const match = ref.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const chapters = backbone.books[match[1]!]?.chapters;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  return !!chapters
    && chapter >= 1
    && chapter <= chapters.length
    && verse >= 1
    && verse <= (chapters[chapter - 1] ?? 0);
}

export function loadCanonicalAlignmentEvidence(jsonl: string): Map<string, Set<string>> {
  const evidence = new Map<string, Set<string>>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as AlignmentRow;
    const ref = `${row.book}.${row.chapter}.${row.verse}`;
    const strongs = evidence.get(ref) ?? new Set<string>();
    for (const token of row.tokens) {
      for (const strong of token.strongs ?? []) strongs.add(normalizeStrongKey(strong));
    }
    evidence.set(ref, strongs);
  }
  return evidence;
}

export function detectKjvEpistleSubscriptions(backbone: BackboneData): string[] {
  const refs: string[] = [];
  const subscriptionLead = /\bAmen\.\s+(?:Written\b|The (?:first|second) epistle\b|The first to\b|To the\b|It was written\b)/i;
  for (const [book, data] of Object.entries(backbone.books)) {
    for (let chapter = 1; chapter <= data.chapters.length; chapter += 1) {
      const path = resolve(AKJV_TEXT_DIRECTORY, book, `${chapter}.json`);
      const chapterData = JSON.parse(readFileSync(path, "utf8")) as {
        verses: Array<{ verse: number; text: string }>;
      };
      for (const verse of chapterData.verses) {
        if (subscriptionLead.test(verse.text)) refs.push(`${book}.${chapter}.${verse.verse}`);
      }
    }
  }
  return refs;
}

export function parseTipnrFile(
  text: string,
  backbone: BackboneData,
  canonicalEvidence: Map<string, Set<string>>,
  detectedSubscriptionCoordinates: readonly string[] = KJV_EPISTLE_SUBSCRIPTION_REFS,
): { index: TipnrIndex; doctor: Record<string, unknown> } {
  const entities: Record<string, TipnrEntity> = {};
  const rawPersonProfiles = new Map<string, RawPersonProfile>();
  const duplicateEntityIds: string[] = [];
  const invalidCoordinates = new Set<string>();
  const sourceCorrectionsUsed = new Set<string>();
  const unparsedReferenceRows: Array<{ entityId: string; significance: string; value: string }> = [];
  const sourceEdges = new Set<string>();
  const preservedSourceEdges = new Set<string>();
  const canonicalSubscriptionEvidence = new Set<string>();
  let structuredRowsSeen = 0;
  let structuredRowsWithReferences = 0;
  let structuredRowsParsed = 0;
  let structuredRowsWithoutReferences = 0;
  let translationRowsSeen = 0;
  let translationRowsPreserved = 0;
  let totalRows = 0;

  for (const part of text.split(/\r?\n\$==========\s*/)) {
    const trimmed = part.trimStart();
    if (!trimmed) continue;
    const newline = trimmed.indexOf("\n");
    const markerLine = (newline >= 0 ? trimmed.slice(0, newline) : trimmed).trim();
    const body = newline >= 0 ? trimmed.slice(newline + 1) : "";
    const kind = kindFromMarker(markerLine);
    if (!kind) continue;

    const lines = body.split(/\r?\n/);
    const headerIdx = lines.findIndex((line) => line.trim().length > 0);
    if (headerIdx < 0) continue;
    const headerFields = lines[headerIdx]!.split("\t");
    const header = parseHeaderId(headerFields[0] ?? "");
    // This excludes the three schema/example sections before the real records.
    if (!header) continue;

    let brief = "";
    let short = "";
    const strongs = new Set<string>([normalizeStrongKey(header.uStrong)]);
    const genderRaw = headerFields.find((field) => /^(Male|Female)/i.test(field.trim())) ?? "";
    const gender = genderRaw.trim() || undefined;
    const summaryField = headerFields.find((field) => field.includes("#A ") || field.startsWith("#"));
    if (summaryField) brief = cleanTipnrProse(summaryField.replace(/^#/, "")).slice(0, 280);
    const headerType = (headerFields[8] ?? "").trim();
    if (kind === "person" && /^(Male|Female|Group)$/i.test(headerType)) {
      rawPersonProfiles.set(header.id, {
        description: cleanTipnrProse(headerFields[1] ?? ""),
        parents: (headerFields[2] ?? "").trim(),
        siblings: (headerFields[3] ?? "").trim(),
        partners: (headerFields[4] ?? "").trim(),
        offspring: (headerFields[5] ?? "").trim(),
        affiliation: cleanTipnrProse(headerFields[6] ?? ""),
      });
    }

    const sourceRows: SourceRow[] = [];
    for (const line of lines.slice(headerIdx + 1)) {
      if (line.startsWith("@Briefest=")) {
        if (!brief) brief = cleanTipnrProse(line.slice("@Briefest=".length));
        continue;
      }
      if (line.startsWith("@Brief=")) {
        const value = cleanTipnrProse(line.slice("@Brief=".length));
        if (value) brief = value;
        continue;
      }
      if (line.startsWith("@Short=")) {
        short = cleanTipnrProse(line.slice("@Short=".length));
        continue;
      }
      if (!/^[–-]\s/.test(line)) continue;

      const fields = line.split("\t");
      const significance = (fields[0] ?? "").replace(/^[–-]\s*/, "").trim();
      if (!significance || significance === "Significance") continue;
      const rowStrongKeys = addStrongKeys(fields, strongs);
      if (significance === "Total") {
        totalRows += 1;
        continue;
      }

      structuredRowsSeen += 1;
      const rawReferenceField = fields[5] ?? "";
      const rawUrlField = fields[4] ?? "";
      const hasReferenceText = /(?:LXX\.)?\d?[A-Za-z]{2,3}\.\d+\.\d+/.test(rawReferenceField)
        || /reference=/.test(rawUrlField);
      if (!hasReferenceText) {
        structuredRowsWithoutReferences += 1;
        continue;
      }
      structuredRowsWithReferences += 1;

      const rowReferenceMap = new Map<string, ParsedReference>();
      const expanded = [
        ...expandTipnrRefsField(rawReferenceField),
        ...extractUrlReferences(rawUrlField),
      ];
      for (const parsed of expanded) {
        const correctedRef = SOURCE_REFERENCE_CORRECTIONS[parsed.ref] ?? parsed.ref;
        if (correctedRef !== parsed.ref) sourceCorrectionsUsed.add(`${parsed.ref} -> ${correctedRef}`);
        const normalized = {
          ...parsed,
          ref: correctedRef,
          ...(/^LXX addition$/i.test(significance) ? { translation: "LXX" as const } : {}),
        };
        rowReferenceMap.set(`${normalized.translation ?? "CANON"}:${normalized.ref}`, normalized);
      }
      const refs = [...rowReferenceMap.values()];
      if (refs.length === 0) {
        unparsedReferenceRows.push({ entityId: header.id, significance, value: rawReferenceField || rawUrlField });
        continue;
      }
      structuredRowsParsed += 1;

      const label = cleanTipnrProse(fields[3] ?? "");
      const translationForms = parseTranslationForms(label, significance);
      const translationAware = translationForms.length > 0 || /=\s*(?:ESV|KJV|NIV)\b/i.test(label);
      if (translationAware) {
        translationRowsSeen += 1;
        if (translationForms.length > 0) translationRowsPreserved += 1;
      }
      sourceRows.push({
        significance,
        label,
        refs,
        strongs: rowStrongKeys,
        translationForms,
      });
    }

    const canonicalRefs: string[] = [];
    const canonicalRefSet = new Set<string>();
    const sourceRefSet = new Set<string>();
    const paratextByRef = new Map<string, {
      forms: Set<string>;
      strongs: Set<string>;
    }>();
    const variants = new Map<string, {
      significance: string;
      form: string;
      translations: TipnrTranslation[];
      refs: Set<string>;
    }>();

    for (const row of sourceRows) {
      for (const form of row.translationForms) {
        const key = `${row.significance}\u0000${form.form}\u0000${form.translations.join(",")}`;
        const variant = variants.get(key) ?? {
          significance: row.significance,
          form: form.form,
          translations: form.translations,
          refs: new Set<string>(),
        };
        for (const parsed of row.refs) variant.refs.add(parsed.ref);
        variants.set(key, variant);
      }

      for (const parsed of row.refs) {
        const sourceIdentity = `${header.id}\u0000${parsed.translation ?? "CANON"}\u0000${parsed.ref}`;
        sourceEdges.add(sourceIdentity);
        sourceRefSet.add(`${parsed.translation ?? "CANON"}:${parsed.ref}`);
        if (!validCoordinate(backbone, parsed.ref)) invalidCoordinates.add(parsed.ref);

        if (parsed.translation === "LXX") {
          if (row.translationForms.some((form) => form.translations.includes("LXX"))) {
            preservedSourceEdges.add(sourceIdentity);
          }
          continue;
        }

        const alignmentStrongs = canonicalEvidence.get(parsed.ref) ?? new Set<string>();
        const hasCanonicalEvidence = row.strongs.some((strong) => alignmentStrongs.has(strong));
        if (isKjvEpistleSubscriptionRef(parsed.ref) && !hasCanonicalEvidence) {
          const paratext = paratextByRef.get(parsed.ref) ?? {
            forms: new Set<string>(),
            strongs: new Set<string>(),
          };
          const kjvForms = row.translationForms
            .filter((form) => form.translations.includes("KJV"))
            .map((form) => form.form);
          for (const form of kjvForms.length > 0 ? kjvForms : [row.label]) {
            if (form.trim()) paratext.forms.add(form.trim());
          }
          for (const strong of row.strongs) paratext.strongs.add(strong);
          paratextByRef.set(parsed.ref, paratext);
          preservedSourceEdges.add(sourceIdentity);
          continue;
        }

        if (!canonicalRefSet.has(parsed.ref)) {
          canonicalRefSet.add(parsed.ref);
          canonicalRefs.push(parsed.ref);
        }
        if (isKjvEpistleSubscriptionRef(parsed.ref)) {
          canonicalSubscriptionEvidence.add(`${header.id}\u0000${parsed.ref}`);
        }
        preservedSourceEdges.add(sourceIdentity);
      }
    }

    const translationVariants: TipnrTranslationVariant[] = [...variants.values()].map((variant) => ({
      significance: variant.significance,
      form: variant.form,
      translations: variant.translations,
      refs: [...variant.refs],
    }));
    const paratextRefs: TipnrParatextReference[] = [...paratextByRef].map(([ref, value]) => ({
      ref,
      source: "KJV epistle subscription",
      translations: ["KJV"],
      forms: [...value.forms],
      strongs: [...value.strongs],
    }));

    const headerFirstRef = parseTipnrRefToken(header.firstTipnr.split("-")[0] ?? "");
    const firstRef = headerFirstRef && canonicalRefSet.has(headerFirstRef)
      ? headerFirstRef
      : canonicalRefs[0];
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
      refs: canonicalRefs,
      refCount: canonicalRefs.length,
      sourceRefCount: sourceRefSet.size,
      translationVariants: translationVariants.length > 0 ? translationVariants : undefined,
      paratextRefs: paratextRefs.length > 0 ? paratextRefs : undefined,
      gender: gender && /^(Male|Female)/i.test(gender) ? gender : undefined,
    };

    if (entities[entity.id]) duplicateEntityIds.push(entity.id);
    entities[entity.id] = entity;
  }

  const personRelationships = applyPersonProfiles(entities, rawPersonProfiles);

  const byRef: Record<string, string[]> = {};
  const byParatextRef: Record<string, string[]> = Object.fromEntries(
    KJV_EPISTLE_SUBSCRIPTION_REFS.map((ref) => [ref, []]),
  );
  const byBaseStrong: Record<string, string[]> = {};
  for (const entity of Object.values(entities)) {
    for (const strong of entity.strongs ?? []) pushUnique(byBaseStrong, strong, entity.id);
    pushUnique(byBaseStrong, entity.baseStrong, entity.id);
    for (const ref of entity.refs) pushUnique(byRef, ref, entity.id);
    for (const ref of entity.paratextRefs ?? []) pushUnique(byParatextRef, ref.ref, entity.id);
  }

  const list = Object.values(entities);
  const index: TipnrIndex = {
    version: 4,
    source: "STEPBible TIPNR",
    license: "CC BY 4.0",
    // A source-snapshot timestamp keeps Derived regeneration byte-stable (INV-2).
    generatedAt: `${TIPNR_SNAPSHOT_DATE}T00:00:00.000Z`,
    sourceSha256: sha256(text),
    referenceModel: {
      canonical: "refs + byRef",
      translationVariants: "translationVariants",
      editionParatext: "paratextRefs + byParatextRef",
      kjvSubscriptionCoordinates: KJV_EPISTLE_SUBSCRIPTION_REFS,
    },
    entityCount: list.length,
    personCount: list.filter((entity) => entity.kind === "person").length,
    placeCount: list.filter((entity) => entity.kind === "place").length,
    otherCount: list.filter((entity) => entity.kind === "other").length,
    entities,
    byRef,
    byParatextRef,
    byBaseStrong,
  };

  const paratextCoordinates = new Set(Object.keys(byParatextRef));
  const normalSubscriptionEdges = KJV_EPISTLE_SUBSCRIPTION_REFS.flatMap((ref) =>
    (byRef[ref] ?? []).map((id) => `${id}\u0000${ref}`));
  const normalSubscriptionEdgesWithoutEvidence = normalSubscriptionEdges
    .filter((edge) => !canonicalSubscriptionEvidence.has(edge));
  const uniqueCanonicalRefs = list.every((entity) => new Set(entity.refs).size === entity.refs.length);
  const uniqueParatextRefs = list.every((entity) => {
    const refs = (entity.paratextRefs ?? []).map((entry) => entry.ref);
    return new Set(refs).size === refs.length;
  });
  const checks = {
    sourceLicense: /STEPBible\.org CC BY/i.test(text.slice(0, 400)),
    expectedCoverage: list.length >= 4_200 && structuredRowsParsed >= 5_800,
    uniqueEntityIds: duplicateEntityIds.length === 0,
    totalRowCoverage: totalRows === list.length,
    allStructuredReferenceRowsParsed:
      structuredRowsParsed === structuredRowsWithReferences && unparsedReferenceRows.length === 0,
    translationProvenancePreserved:
      translationRowsSeen === translationRowsPreserved && translationRowsPreserved >= 800,
    validCoordinates: invalidCoordinates.size === 0,
    sourceCorrectionsPinned:
      sourceCorrectionsUsed.size === Object.keys(SOURCE_REFERENCE_CORRECTIONS).length,
    sourceReferencesPreserved:
      sourceEdges.size === preservedSourceEdges.size
      && [...sourceEdges].every((edge) => preservedSourceEdges.has(edge)),
    uniqueCanonicalRefs,
    uniqueParatextRefs,
    subscriptionCoordinatesComplete:
      paratextCoordinates.size === KJV_EPISTLE_SUBSCRIPTION_REFS.length
      && KJV_EPISTLE_SUBSCRIPTION_REFS.every((ref) => paratextCoordinates.has(ref)),
    paratextCoordinatesRestricted:
      [...paratextCoordinates].every((ref) => isKjvEpistleSubscriptionRef(ref)),
    akjvSubscriptionScanMatchesPinnedCoordinates:
      JSON.stringify(detectedSubscriptionCoordinates) === JSON.stringify(KJV_EPISTLE_SUBSCRIPTION_REFS),
    normalSubscriptionEdgesHaveCanonicalEvidence: normalSubscriptionEdgesWithoutEvidence.length === 0,
    personProfilesComplete:
      rawPersonProfiles.size >= 3_100
      && rawPersonProfiles.size === list.filter((entity) => entity.kind === "person").length
      && [...rawPersonProfiles.keys()].every((id) => entities[id]?.person != null),
    personRelationshipsResolved:
      personRelationships.sourceRelationshipCount === personRelationships.resolvedRelationshipCount
      && personRelationships.unresolved.length === 0
      && personRelationships.ambiguous.length === 0,
    personRelationshipsUnique: personRelationships.duplicateRelationships.length === 0,
    personRelationshipTargetsExist: list.every((entity) => (
      entity.person?.relationships.every((relationship) => entities[relationship.targetId] != null) ?? true
    )),
    personSchemaDoesNotLeakIntoOtherKinds: list.every((entity) => (
      entity.kind === "person" ? entity.person != null : entity.person == null
    )),
  };
  const doctor = {
    status: Object.values(checks).every(Boolean) ? "healthy" : "unhealthy",
    source: {
      name: "STEPBible TIPNR",
      url: "https://github.com/STEPBible/STEPBible-Data",
      license: "CC BY 4.0",
      snapshotDate: TIPNR_SNAPSHOT_DATE,
      rawSha256: index.sourceSha256,
    },
    coverage: {
      entityCount: list.length,
      personCount: index.personCount,
      placeCount: index.placeCount,
      otherCount: index.otherCount,
      structuredRowsSeen,
      structuredRowsWithReferences,
      structuredRowsParsed,
      structuredRowsWithoutReferences,
      translationRowsPreserved,
      sourceReferenceEdges: sourceEdges.size,
      canonicalReferenceEdges: Object.values(byRef).reduce((sum, ids) => sum + ids.length, 0),
      paratextReferenceEdges: Object.values(byParatextRef).reduce((sum, ids) => sum + ids.length, 0),
      subscriptionCoordinateCount: paratextCoordinates.size,
      personProfileCount: rawPersonProfiles.size,
      sourcePersonRelationshipCount: personRelationships.sourceRelationshipCount,
      resolvedPersonRelationshipCount: personRelationships.resolvedRelationshipCount,
      uncertainPersonRelationshipCount: personRelationships.uncertainRelationshipCount,
    },
    checks,
    subscriptions: {
      coordinates: KJV_EPISTLE_SUBSCRIPTION_REFS,
      detectedInAkjv: detectedSubscriptionCoordinates,
      normalEdgesWithCanonicalEvidence: normalSubscriptionEdges.length,
      normalEdgesWithoutCanonicalEvidence: normalSubscriptionEdgesWithoutEvidence,
      paratextEdgesByCoordinate: Object.fromEntries(
        KJV_EPISTLE_SUBSCRIPTION_REFS.map((ref) => [ref, byParatextRef[ref]?.length ?? 0]),
      ),
    },
    review: {
      duplicateEntityIds,
      invalidCoordinates: [...invalidCoordinates],
      sourceCorrections: [...sourceCorrectionsUsed],
      unparsedReferenceRows,
      unresolvedPersonRelationships: personRelationships.unresolved,
      ambiguousPersonRelationships: personRelationships.ambiguous,
      duplicatePersonRelationships: personRelationships.duplicateRelationships,
    },
    artifact: {
      formatVersion: index.version,
      normalizedSha256: sha256(JSON.stringify(index)),
    },
  };
  return { index, doctor };
}

type PlaceArtifactForSync = {
  places: Record<string, { refs: string[] }>;
};

function syncDependentPlaceReferences(index: TipnrIndex): {
  placeCount: number;
  normalizedSha256: string;
} {
  if (!existsSync(PLACE_OUTPUT) || !existsSync(PLACE_DOCTOR_OUTPUT)) {
    throw new Error("Dependent OpenBible place artifact or Doctor report is missing");
  }
  const artifact = JSON.parse(readFileSync(PLACE_OUTPUT, "utf8")) as PlaceArtifactForSync;
  for (const [id, place] of Object.entries(artifact.places)) {
    const entity = index.entities[id];
    if (!entity || entity.kind !== "place") {
      throw new Error(`OpenBible place artifact has no TIPNR place identity: ${id}`);
    }
    place.refs = [...entity.refs];
  }
  const normalized = `${JSON.stringify(artifact)}\n`;
  writeFileSync(PLACE_OUTPUT, normalized);

  const doctor = JSON.parse(readFileSync(PLACE_DOCTOR_OUTPUT, "utf8")) as {
    status: string;
    checks: Record<string, boolean>;
    normalizedSha256: string;
    tipnrReferenceSync?: Record<string, unknown>;
  };
  const parity = Object.entries(artifact.places).every(([id, place]) => {
    const refs = index.entities[id]?.refs ?? [];
    return JSON.stringify(place.refs) === JSON.stringify(refs);
  });
  doctor.checks.tipnrReferenceParity = parity;
  doctor.normalizedSha256 = sha256(normalized);
  doctor.tipnrReferenceSync = {
    tipnrFormatVersion: index.version,
    tipnrSourceSha256: index.sourceSha256,
    placeCount: Object.keys(artifact.places).length,
  };
  doctor.status = Object.values(doctor.checks).every(Boolean) ? "healthy" : "unhealthy";
  writeFileSync(PLACE_DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);
  if (!parity || doctor.status !== "healthy") {
    throw new Error("Dependent OpenBible place references failed TIPNR parity");
  }
  return {
    placeCount: Object.keys(artifact.places).length,
    normalizedSha256: doctor.normalizedSha256,
  };
}

function main(): void {
  for (const path of [INPUT, BACKBONE_INPUT, ALIGNMENTS_INPUT, AKJV_TEXT_DIRECTORY]) {
    if (!existsSync(path)) throw new Error(`Missing TIPNR import dependency: ${path}`);
  }
  console.log("Reading", INPUT);
  const source = readFileSync(INPUT, "utf8");
  const backbone = JSON.parse(readFileSync(BACKBONE_INPUT, "utf8")) as BackboneData;
  const evidence = loadCanonicalAlignmentEvidence(readFileSync(ALIGNMENTS_INPUT, "utf8"));
  const detectedSubscriptions = detectKjvEpistleSubscriptions(backbone);
  const { index, doctor } = parseTipnrFile(source, backbone, evidence, detectedSubscriptions);
  if (doctor.status !== "healthy") {
    writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);
    throw new Error(`TIPNR Doctor refused import: ${JSON.stringify((doctor as { checks: unknown }).checks)}`);
  }
  const normalized = JSON.stringify(index);
  writeFileSync(OUTPUT, normalized);
  const placeSync = syncDependentPlaceReferences(index);
  const doctorWithPlaceSync = {
    ...doctor,
    checks: {
      ...(doctor as { checks: Record<string, boolean> }).checks,
      dependentPlaceRefsSynced: placeSync.placeCount > 0,
    },
    dependentArtifacts: {
      openBiblePlaceCount: placeSync.placeCount,
      openBiblePlaceSha256: placeSync.normalizedSha256,
    },
  };
  writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctorWithPlaceSync, null, 2)}\n`);
  const sizeMb = (Buffer.byteLength(normalized) / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUTPUT}`);
  console.log(
    `  entities: ${index.entityCount} (person ${index.personCount}, place ${index.placeCount}, other ${index.otherCount})`,
  );
  console.log(`  byRef keys: ${Object.keys(index.byRef).length}`);
  console.log(`  byParatextRef keys: ${Object.keys(index.byParatextRef).length}`);
  console.log(`  byBaseStrong keys: ${Object.keys(index.byBaseStrong).length}`);
  console.log(`  dependent places synced: ${placeSync.placeCount}`);
  console.log(`  Doctor: ${DOCTOR_OUTPUT}`);
  console.log(`  size: ~${sizeMb} MB`);

  console.log("  MAT.1.1", index.byRef["MAT.1.1"]?.slice(0, 5));
  console.log("  MAT.3.1", index.byRef["MAT.3.1"]);
  console.log("  G11", index.byBaseStrong["G11"]?.slice(0, 3));
  console.log("  G1138", index.byBaseStrong["G1138"]?.slice(0, 3));
  console.log("  G2491", index.byBaseStrong["G2491"]);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
