/** Pure Working Preacher metadata normalization and passage retrieval. No I/O. */

import { compareVerses, parseBref, toBref, validateRef, type ParseResult } from "../reference/parser.js";
import type { BackboneData, BookCode, BookNameMap, CanonicalRef } from "../reference/types.js";

export const WORKING_PREACHER_ARTIFACT_ID = "working-preacher-commentary-index" as const;
export const WORKING_PREACHER_ARTIFACT_VERSION = 1 as const;
export type WorkingPreacherLanguage = "en" | "es" | "unknown";
export type WorkingPreacherAvailability = "available" | "forthcoming";
export type WorkingPreacherMatchLevel = "exact-passage" | "overlapping-passage" | "same-chapter";

export interface WorkingPreacherResource {
  id: string;
  source: "working-preacher";
  sourceRecordId: number;
  kind: "commentary";
  title: string;
  url: string;
  publishedAt: string;
  modifiedAt?: string;
  language: WorkingPreacherLanguage;
  availability: WorkingPreacherAvailability;
  passageLabel: string;
  brefs: string[];
  matchBasis: "publisher-title";
  lectionary?: { system: string; occasion: string };
  description?: string;
  readMinutes?: number;
  artworkUrl?: string;
  author?: string;
}

export interface WorkingPreacherArtifact {
  meta: {
    id: typeof WORKING_PREACHER_ARTIFACT_ID;
    formatVersion: typeof WORKING_PREACHER_ARTIFACT_VERSION;
    source: "Working Preacher from Luther Seminary";
    sourceUrl: "https://www.workingpreacher.org/";
    apiUrl: "https://www.workingpreacher.org/wp-json/wp/v2/wkngp_commentaries";
    sourceRecordTotal?: number;
    sampledPages: number[];
  };
  resources: WorkingPreacherResource[];
  rejections: Array<{ sourceRecordId?: number; title?: string; reason: string }>;
}

export interface WorkingPreacherRankedResource {
  resource: WorkingPreacherResource;
  match: { level: WorkingPreacherMatchLevel; score: number; scopeBref: string; matchedBref: string; basis: "publisher-title" };
}

interface PublicApiRecord {
  id: number;
  date: string;
  modified?: string;
  link: string;
  title: string;
  description?: string;
  readMinutes?: number;
  artworkUrl?: string;
}

const SPANISH_BOOK_NAMES: Partial<Record<BookCode, string[]>> = {
  GEN: ["Génesis", "Genesis"], EXO: ["Éxodo", "Exodo"], LEV: ["Levítico", "Levitico"],
  NUM: ["Números", "Numeros"], DEU: ["Deuteronomio"], JOS: ["Josué", "Josue"], JDG: ["Jueces"], RUT: ["Rut"],
  "1SA": ["1 Samuel"], "2SA": ["2 Samuel"], "1KI": ["1 Reyes"], "2KI": ["2 Reyes"],
  "1CH": ["1 Crónicas", "1 Cronicas"], "2CH": ["2 Crónicas", "2 Cronicas"], EZR: ["Esdras"],
  NEH: ["Nehemías", "Nehemias"], EST: ["Ester"], JOB: ["Job"], PSA: ["Salmos", "Salmo"], PRO: ["Proverbios"],
  ECC: ["Eclesiastés", "Eclesiastes"], SNG: ["Cantares", "Cantar de los Cantares"], ISA: ["Isaías", "Isaias"],
  JER: ["Jeremías", "Jeremias"], LAM: ["Lamentaciones"], EZK: ["Ezequiel"], DAN: ["Daniel"], HOS: ["Oseas"],
  JOL: ["Joel"], AMO: ["Amós", "Amos"], OBA: ["Abdías", "Abdias"], JON: ["Jonás", "Jonas"], MIC: ["Miqueas"],
  NAH: ["Nahúm", "Nahum"], HAB: ["Habacuc"], ZEP: ["Sofonías", "Sofonias"], HAG: ["Hageo"],
  ZEC: ["Zacarías", "Zacarias"], MAL: ["Malaquías", "Malaquias"], MAT: ["Mateo", "San Mateo"],
  MRK: ["Marcos", "San Marcos"], LUK: ["Lucas", "San Lucas"], JHN: ["Juan", "San Juan"],
  ACT: ["Hechos", "Hechos de los Apóstoles", "Hechos de los Apostoles"], ROM: ["Romanos"],
  "1CO": ["1 Corintios"], "2CO": ["2 Corintios"], GAL: ["Gálatas", "Galatas"], EPH: ["Efesios"],
  PHP: ["Filipenses"], COL: ["Colosenses"], "1TH": ["1 Tesalonicenses"], "2TH": ["2 Tesalonicenses"],
  "1TI": ["1 Timoteo"], "2TI": ["2 Timoteo"], TIT: ["Tito"], PHM: ["Filemón", "Filemon"],
  HEB: ["Hebreos"], JAS: ["Santiago"], "1PE": ["1 Pedro"], "2PE": ["2 Pedro"],
  "1JN": ["1 Juan"], "2JN": ["2 Juan"], "3JN": ["3 Juan"], JUD: ["Judas"], REV: ["Apocalipsis"],
};

export function normalizeWorkingPreacherRecord(input: unknown, bookNames: BookNameMap, backbone: BackboneData): ParseResult<WorkingPreacherResource> {
  const record = readPublicApiRecord(input); if (!record.ok) return record;
  const passages = extractWorkingPreacherTitlePassages(record.value.title, bookNames, backbone); if (!passages.ok) return passages;
  const path = safeUrlPath(record.value.link); if (!path.ok) return path;
  const description = cleanText(record.value.description ?? "");
  const lectionary = readLectionary(path.value);
  return { ok: true, value: {
    id: `working-preacher:commentary:${record.value.id}`, source: "working-preacher", sourceRecordId: record.value.id,
    kind: "commentary", title: record.value.title, url: record.value.link, publishedAt: record.value.date,
    ...(record.value.modified ? { modifiedAt: record.value.modified } : {}),
    language: /^\s*comentario\b/i.test(record.value.title) ? "es" : "en",
    availability: /\b(forthcoming|próximamente|proximamente)\b/i.test(description) ? "forthcoming" : "available",
    passageLabel: passages.value.passageLabel, brefs: passages.value.brefs, matchBasis: "publisher-title",
    ...(lectionary ? { lectionary } : {}), ...(description ? { description } : {}),
    ...(record.value.readMinutes ? { readMinutes: record.value.readMinutes } : {}),
    ...(record.value.artworkUrl ? { artworkUrl: record.value.artworkUrl } : {}),
  } };
}

export function extractWorkingPreacherTitlePassages(title: string, bookNames: BookNameMap, backbone: BackboneData): ParseResult<{ passageLabel: string; brefs: string[] }> {
  const cleaned = cleanText(title).replace(/[–—−]/g, "-");
  const matches = matchBooks(cleaned, bookNames);
  if (matches.length === 0) return { ok: false, error: "Title has no recognized Scripture book" };
  const refs: CanonicalRef[] = [];
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
    const match = matches[matchIndex]!;
    const next = matches[matchIndex + 1];
    const expression = cleaned.slice(match.index + match.name.length, next?.index ?? cleaned.length).replace(/^\s*[;,&/]\s*|\s*[;,&/]\s*$/g, "").trim();
    if (!expression) return { ok: false, error: "Title has a book but no passage coordinate" };
    let currentChapter: number | undefined;
    const pattern = /(?:(\d+)\s*:\s*)?(\d+)[a-c]?(?:\s*-\s*(?:(\d+)\s*:\s*)?(\d+)[a-c]?)?/gi;
    for (const coordinate of expression.matchAll(pattern)) {
      if (coordinate[1] != null) currentChapter = Number.parseInt(coordinate[1], 10);
      if (currentChapter == null) {
        const chapter = Number.parseInt(coordinate[2]!, 10);
        const maxVerse = backbone.books[match.code]?.chapters[chapter - 1];
        if (maxVerse == null) return { ok: false, error: `Chapter ${chapter} is outside the backbone` };
        refs.push({ version: "v1", start: { book: match.code, chapter, verse: 1 }, end: { book: match.code, chapter, verse: maxVerse } });
        currentChapter = chapter;
        continue;
      }
      const startVerse = Number.parseInt(coordinate[2]!, 10);
      const endChapter = coordinate[3] == null ? currentChapter : Number.parseInt(coordinate[3], 10);
      const endVerse = coordinate[4] == null ? startVerse : Number.parseInt(coordinate[4], 10);
      refs.push({ version: "v1", start: { book: match.code, chapter: currentChapter, verse: startVerse }, end: { book: match.code, chapter: endChapter, verse: endVerse } });
    }
  }
  if (refs.length === 0) return { ok: false, error: "Title has no parseable passage coordinate" };
  const brefs: string[] = [];
  for (const ref of refs) {
    const valid = validateRef(ref, backbone); if (!valid.ok) return valid;
    const bref = toBref(valid.value); if (!brefs.includes(bref)) brefs.push(bref);
  }
  return { ok: true, value: { passageLabel: cleaned.slice(matches[0]!.index).trim(), brefs } };
}

export function rankWorkingPreacherResources(resources: WorkingPreacherResource[], scopeBref: string, limit = 10): ParseResult<WorkingPreacherRankedResource[]> {
  const scope = parseBref(scopeBref); if (!scope.ok) return scope;
  if (scope.value.tokenNarrowing) return { ok: false, error: "Working Preacher matching requires a translation-free verse scope" };
  if (!Number.isInteger(limit) || limit < 1) return { ok: false, error: "Limit must be a positive integer" };
  const ranked: WorkingPreacherRankedResource[] = [];
  for (const resource of resources) {
    let best: WorkingPreacherRankedResource | undefined;
    for (const candidateBref of resource.brefs) {
      const candidate = parseBref(candidateBref); if (!candidate.ok || candidate.value.tokenNarrowing) continue;
      const match = scoreMatch(scope.value, candidate.value); if (!match) continue;
      const value: WorkingPreacherRankedResource = { resource, match: { ...match, scopeBref, matchedBref: candidateBref, basis: "publisher-title" } };
      if (!best || value.match.score > best.match.score) best = value;
    }
    if (best) ranked.push(best);
  }
  ranked.sort((left, right) => right.match.score - left.match.score || right.resource.publishedAt.localeCompare(left.resource.publishedAt) || left.resource.id.localeCompare(right.resource.id));
  return { ok: true, value: ranked.slice(0, limit) };
}

export function extractWorkingPreacherAuthorFromHtml(html: string): string | undefined {
  const match = html.match(/card--author-small[\s\S]{0,4000}?<div class="card__title">[\s\S]{0,600}?<h4>([\s\S]*?)<\/h4>/i);
  return cleanText(match?.[1] ?? "") || undefined;
}

export function validateWorkingPreacherArtifact(input: unknown): ParseResult<WorkingPreacherArtifact> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["meta", "resources", "rejections"])) return { ok: false, error: "Invalid Working Preacher artifact envelope" };
  const meta = input["meta"];
  if (!isRecord(meta) || !hasOnlyKeys(meta, ["id", "formatVersion", "source", "sourceUrl", "apiUrl", "sourceRecordTotal", "sampledPages"])) return { ok: false, error: "Invalid Working Preacher artifact metadata" };
  if (meta["id"] !== WORKING_PREACHER_ARTIFACT_ID || meta["formatVersion"] !== WORKING_PREACHER_ARTIFACT_VERSION) return { ok: false, error: "Unsupported Working Preacher artifact version" };
  if (meta["source"] !== "Working Preacher from Luther Seminary" || meta["sourceUrl"] !== "https://www.workingpreacher.org/" || meta["apiUrl"] !== "https://www.workingpreacher.org/wp-json/wp/v2/wkngp_commentaries") return { ok: false, error: "Working Preacher artifact source identity changed" };
  if (meta["sourceRecordTotal"] != null && (!Number.isInteger(meta["sourceRecordTotal"]) || Number(meta["sourceRecordTotal"]) < 0)) return { ok: false, error: "Invalid source record total" };
  if (!Array.isArray(meta["sampledPages"]) || !meta["sampledPages"].every((page) => Number.isInteger(page) && Number(page) > 0)) return { ok: false, error: "Invalid sampled page list" };
  if (!Array.isArray(input["resources"]) || !Array.isArray(input["rejections"])) return { ok: false, error: "Artifact resources and rejections must be arrays" };
  for (const resource of input["resources"]) { const checked = validateResource(resource); if (!checked.ok) return checked; }
  for (const rejection of input["rejections"]) if (!isRecord(rejection) || !hasOnlyKeys(rejection, ["sourceRecordId", "title", "reason"]) || typeof rejection["reason"] !== "string") return { ok: false, error: "Invalid rejection record" };
  return { ok: true, value: input as unknown as WorkingPreacherArtifact };
}

function scoreMatch(scope: CanonicalRef, candidate: CanonicalRef): { level: WorkingPreacherMatchLevel; score: number } | undefined {
  if (scope.start.book !== candidate.start.book || scope.end.book !== candidate.end.book) return undefined;
  if (compareVerses(scope.start, candidate.start) === 0 && compareVerses(scope.end, candidate.end) === 0) return { level: "exact-passage", score: 300 };
  const overlaps = compareVerses(scope.start, candidate.end) <= 0 && compareVerses(candidate.start, scope.end) <= 0;
  if (overlaps) {
    const candidateContains = compareVerses(candidate.start, scope.start) <= 0 && compareVerses(candidate.end, scope.end) >= 0;
    const scopeContains = compareVerses(scope.start, candidate.start) <= 0 && compareVerses(scope.end, candidate.end) >= 0;
    return { level: "overlapping-passage", score: candidateContains ? 250 : scopeContains ? 240 : 220 };
  }
  return scope.start.chapter === candidate.start.chapter || scope.start.chapter === candidate.end.chapter
    ? { level: "same-chapter", score: 100 } : undefined;
}

function readPublicApiRecord(input: unknown): ParseResult<PublicApiRecord> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["id", "date", "modified", "link", "title", "yoast_head_json"])) return { ok: false, error: "Working Preacher record contains unsupported fields" };
  if (!Number.isInteger(input["id"]) || Number(input["id"]) < 1) return { ok: false, error: "Record id must be a positive integer" };
  if (typeof input["date"] !== "string" || !input["date"].trim()) return { ok: false, error: "Record date must be a string" };
  if (typeof input["link"] !== "string" || !input["link"].trim()) return { ok: false, error: "Record link must be a string" };
  const title = input["title"];
  if (!isRecord(title) || !hasOnlyKeys(title, ["rendered"]) || typeof title["rendered"] !== "string") return { ok: false, error: "Record title must contain rendered text" };
  if (input["modified"] != null && typeof input["modified"] !== "string") return { ok: false, error: "Record modified must be a string" };
  const yoast = readYoast(input["yoast_head_json"]); if (!yoast.ok) return yoast;
  return { ok: true, value: { id: Number(input["id"]), date: input["date"], link: input["link"], title: cleanText(title["rendered"]), ...(typeof input["modified"] === "string" ? { modified: input["modified"] } : {}), ...yoast.value } };
}

function readYoast(input: unknown): ParseResult<Pick<PublicApiRecord, "description" | "readMinutes" | "artworkUrl">> {
  if (input == null) return { ok: true, value: {} };
  if (!isRecord(input)) return { ok: false, error: "yoast_head_json must be an object" };
  const value: Pick<PublicApiRecord, "description" | "readMinutes" | "artworkUrl"> = {};
  if (typeof input["description"] === "string") value.description = input["description"];
  if (Array.isArray(input["og_image"])) { const image = input["og_image"].find((item) => isRecord(item) && typeof item["url"] === "string"); if (isRecord(image) && typeof image["url"] === "string") value.artworkUrl = image["url"]; }
  const misc = input["twitter_misc"];
  if (isRecord(misc) && typeof misc["Est. reading time"] === "string") { const match = misc["Est. reading time"].match(/(\d+)/); if (match) value.readMinutes = Number.parseInt(match[1]!, 10); }
  return { ok: true, value };
}

function matchBooks(value: string, bookNames: BookNameMap): Array<{ code: BookCode; name: string; index: number }> {
  const candidates: Array<{ code: BookCode; name: string }> = [];
  for (const [code, names] of Object.entries(bookNames)) for (const name of [...names, ...(SPANISH_BOOK_NAMES[code as BookCode] ?? [])]) candidates.push({ code: code as BookCode, name });
  candidates.sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name));
  const folded = fold(value); const matches: Array<{ code: BookCode; name: string; index: number }> = []; let offset = 0;
  while (offset < value.length) {
    let best: { code: BookCode; name: string; index: number } | undefined;
    for (const candidate of candidates) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(fold(candidate.name))}(?=\\s|\\d|$)`, "iu");
      const found = pattern.exec(folded.slice(offset)); if (!found) continue;
      const index = offset + found.index + found[1]!.length;
      if (!best || index < best.index || (index === best.index && candidate.name.length > best.name.length)) best = { ...candidate, index };
    }
    if (!best) break; matches.push(best); offset = best.index + best.name.length;
  }
  return matches;
}

function validateResource(input: unknown): ParseResult<WorkingPreacherResource> {
  const keys = ["id", "source", "sourceRecordId", "kind", "title", "url", "publishedAt", "modifiedAt", "language", "availability", "passageLabel", "brefs", "matchBasis", "lectionary", "description", "readMinutes", "artworkUrl", "author"];
  if (!isRecord(input) || !hasOnlyKeys(input, keys) || typeof input["id"] !== "string" || input["source"] !== "working-preacher" || !Number.isInteger(input["sourceRecordId"]) || input["kind"] !== "commentary" || typeof input["title"] !== "string" || typeof input["url"] !== "string" || typeof input["publishedAt"] !== "string" || !["en", "es", "unknown"].includes(String(input["language"])) || !["available", "forthcoming"].includes(String(input["availability"])) || typeof input["passageLabel"] !== "string" || input["matchBasis"] !== "publisher-title" || !Array.isArray(input["brefs"]) || input["brefs"].length === 0) return { ok: false, error: "Working Preacher resource has invalid required fields" };
  if (input["brefs"].some((bref) => typeof bref !== "string" || !parseBref(bref).ok || bref.includes("@"))) return { ok: false, error: "Working Preacher resource has an invalid translation-free bref" };
  return { ok: true, value: input as unknown as WorkingPreacherResource };
}

function readLectionary(path: string): WorkingPreacherResource["lectionary"] | undefined { const segments = path.split("/").filter(Boolean); const index = segments.indexOf("commentaries"); const system = segments[index + 1]; const occasion = segments[index + 2]; return index >= 0 && system && occasion ? { system, occasion } : undefined; }
function safeUrlPath(value: string): ParseResult<string> { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.workingpreacher.org" ? { ok: true, value: url.pathname } : { ok: false, error: "Resource URL must use the Working Preacher HTTPS origin" }; } catch { return { ok: false, error: "Resource URL is invalid" }; } }
function cleanText(value: string): string { return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#(?:x27|39);|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim(); }
function fold(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isRecord(input: unknown): input is Record<string, unknown> { return typeof input === "object" && input !== null && !Array.isArray(input); }
function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(input).every((key) => allowed.includes(key)); }
