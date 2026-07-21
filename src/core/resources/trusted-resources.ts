/**
 * Source-neutral, local-only trusted-resource contracts.
 *
 * Manifests contain factual catalog pointers and explicit Scripture evidence.
 * They intentionally have no body, description, artwork, embed, or network
 * fields. Core remains platform-agnostic (INV-18).
 */

import { compareVerses, parseBref, validateRef, type ParseResult } from "../reference/parser.js";
import type { BackboneData, CanonicalRef } from "../reference/types.js";

export const TRUSTED_RESOURCE_MANIFEST_SCHEMA = "pericope.trusted-resource-manifest" as const;
export const TRUSTED_RESOURCE_MANIFEST_VERSION = 1 as const;

export type TrustedResourceKind = "article" | "commentary" | "guide" | "podcast" | "video";
export type TrustedResourceMatchBasis = "publisher-catalog" | "publisher-scripture-tag" | "publisher-title";
export type TrustedResourceMatch = "exact-passage" | "overlap" | "same-chapter";

export interface TrustedResourceSourceV1 {
  id: string;
  name: string;
  homepageUrl: string;
  officialHosts: string[];
}

export interface TrustedResourceProvenanceV1 {
  publisher: string;
  reviewedAt: string;
  coverage: "reviewed-sample";
  permissions: "outbound-link-only";
  note?: string;
}

export interface TrustedResourceFactualMetadataV1 {
  author?: string;
  publishedAt?: string;
  durationMinutes?: number;
  language?: string;
  series?: string;
}

export interface TrustedResourceRecordV1 {
  id: string;
  sourceId: string;
  kind: TrustedResourceKind;
  title: string;
  officialUrl: string;
  brefs: string[];
  matchBasis: TrustedResourceMatchBasis;
  metadata?: TrustedResourceFactualMetadataV1;
}

export interface TrustedResourceManifestV1 {
  schema: typeof TRUSTED_RESOURCE_MANIFEST_SCHEMA;
  version: typeof TRUSTED_RESOURCE_MANIFEST_VERSION;
  source: TrustedResourceSourceV1;
  provenance: TrustedResourceProvenanceV1;
  capabilities: ["outbound-link"];
  records: TrustedResourceRecordV1[];
}

export interface TrustedResourceQuery {
  bref: string;
  limit?: number;
}

export interface RankedTrustedResource {
  source: TrustedResourceSourceV1;
  provenance: TrustedResourceProvenanceV1;
  record: TrustedResourceRecordV1;
  match: TrustedResourceMatch;
  score: number;
  matchedBref: string;
}

export interface TrustedResourceRefusal {
  code: "invalid-installed-manifest" | "invalid-query" | "read-failed";
  sourceId?: string;
  message: string;
}

const SOURCE_KEYS = ["id", "name", "homepageUrl", "officialHosts"] as const;
const PROVENANCE_KEYS = ["publisher", "reviewedAt", "coverage", "permissions", "note"] as const;
const RECORD_KEYS = ["id", "sourceId", "kind", "title", "officialUrl", "brefs", "matchBasis", "metadata"] as const;
const METADATA_KEYS = ["author", "publishedAt", "durationMinutes", "language", "series"] as const;
const KINDS = new Set<TrustedResourceKind>(["article", "commentary", "guide", "podcast", "video"]);
const MATCH_BASES = new Set<TrustedResourceMatchBasis>([
  "publisher-catalog",
  "publisher-scripture-tag",
  "publisher-title",
]);

export function validateTrustedResourceQuery(
  input: unknown,
  backbone: BackboneData,
): ParseResult<TrustedResourceQuery> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["bref", "limit"])) {
    return { ok: false, error: "Trusted-resource query has unknown or missing fields" };
  }
  if (typeof input["bref"] !== "string") return { ok: false, error: "Query bref must be a string" };
  const parsed = parseBref(input["bref"]);
  if (!parsed.ok) return parsed;
  const valid = validateRef(parsed.value, backbone);
  if (!valid.ok) return valid;
  if (parsed.value.tokenNarrowing) return { ok: false, error: "Resource queries must use verse-level brefs" };
  const limit = input["limit"];
  if (limit != null && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 20)) {
    return { ok: false, error: "Query limit must be an integer from 1 to 20" };
  }
  return { ok: true, value: { bref: input["bref"], ...(limit == null ? {} : { limit: limit as number }) } };
}

export function validateTrustedResourceManifest(
  input: unknown,
  backbone: BackboneData,
): ParseResult<TrustedResourceManifestV1> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["schema", "version", "source", "provenance", "capabilities", "records"])) {
    return { ok: false, error: "Manifest has unknown or missing top-level fields" };
  }
  if (input["schema"] !== TRUSTED_RESOURCE_MANIFEST_SCHEMA || input["version"] !== TRUSTED_RESOURCE_MANIFEST_VERSION) {
    return { ok: false, error: "Unsupported trusted-resource manifest schema or version" };
  }
  const sourceResult = readSource(input["source"]);
  if (!sourceResult.ok) return sourceResult;
  const provenanceResult = readProvenance(input["provenance"]);
  if (!provenanceResult.ok) return provenanceResult;
  if (!Array.isArray(input["capabilities"]) || input["capabilities"].length !== 1 || input["capabilities"][0] !== "outbound-link") {
    return { ok: false, error: "Only the outbound-link capability is supported" };
  }
  if (!Array.isArray(input["records"])) return { ok: false, error: "Manifest records must be an array" };
  const records: TrustedResourceRecordV1[] = [];
  const ids = new Set<string>();
  for (const candidate of input["records"]) {
    const record = readRecord(candidate, sourceResult.value, backbone);
    if (!record.ok) return record;
    if (ids.has(record.value.id)) return { ok: false, error: `Duplicate resource id: ${record.value.id}` };
    ids.add(record.value.id);
    records.push(record.value);
  }
  return {
    ok: true,
    value: {
      schema: TRUSTED_RESOURCE_MANIFEST_SCHEMA,
      version: TRUSTED_RESOURCE_MANIFEST_VERSION,
      source: sourceResult.value,
      provenance: provenanceResult.value,
      capabilities: ["outbound-link"],
      records,
    },
  };
}

export function rankTrustedResources(
  manifests: readonly TrustedResourceManifestV1[],
  query: TrustedResourceQuery,
): RankedTrustedResource[] {
  const parsedQuery = parseBref(query.bref);
  if (!parsedQuery.ok) return [];
  const ranked: RankedTrustedResource[] = [];
  for (const manifest of manifests) {
    for (const record of manifest.records) {
      let best: { match: TrustedResourceMatch; score: number; matchedBref: string } | null = null;
      for (const bref of record.brefs) {
        const candidate = parseBref(bref);
        if (!candidate.ok) continue;
        const match = passageMatch(parsedQuery.value, candidate.value);
        if (match && (!best || match.score > best.score)) best = { ...match, matchedBref: bref };
      }
      if (best) ranked.push({ source: manifest.source, provenance: manifest.provenance, record, ...best });
    }
  }
  return ranked
    .sort((left, right) => right.score - left.score
      || left.source.id.localeCompare(right.source.id)
      || left.record.id.localeCompare(right.record.id))
    .slice(0, query.limit ?? 3);
}

export function isOfficialTrustedResourceUrl(url: string, officialHosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && officialHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function passageMatch(query: CanonicalRef, candidate: CanonicalRef): { match: TrustedResourceMatch; score: number } | null {
  if (sameVerse(query.start, candidate.start) && sameVerse(query.end, candidate.end)) {
    return { match: "exact-passage", score: 300 };
  }
  if (compareVerses(query.start, candidate.end) <= 0 && compareVerses(candidate.start, query.end) <= 0) {
    return { match: "overlap", score: 200 };
  }
  const queryChapters = new Set([`${query.start.book}.${query.start.chapter}`, `${query.end.book}.${query.end.chapter}`]);
  if (queryChapters.has(`${candidate.start.book}.${candidate.start.chapter}`)
    || queryChapters.has(`${candidate.end.book}.${candidate.end.chapter}`)) {
    return { match: "same-chapter", score: 100 };
  }
  return null;
}

function sameVerse(left: CanonicalRef["start"], right: CanonicalRef["start"]): boolean {
  return left.book === right.book && left.chapter === right.chapter && left.verse === right.verse;
}

function readSource(input: unknown): ParseResult<TrustedResourceSourceV1> {
  if (!isRecord(input) || !hasOnlyKeys(input, SOURCE_KEYS)) return { ok: false, error: "Invalid source identity" };
  const id = nonEmpty(input["id"], "source.id"); if (!id.ok) return id;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id.value)) return { ok: false, error: "source.id must be a stable lowercase slug" };
  const name = nonEmpty(input["name"], "source.name"); if (!name.ok) return name;
  const homepageUrl = nonEmpty(input["homepageUrl"], "source.homepageUrl"); if (!homepageUrl.ok) return homepageUrl;
  if (!Array.isArray(input["officialHosts"]) || input["officialHosts"].length === 0) return { ok: false, error: "source.officialHosts must not be empty" };
  const officialHosts = input["officialHosts"].map((host) => typeof host === "string" ? host.trim().toLowerCase() : "");
  if (officialHosts.some((host) => !host || host.includes("/") || host.includes(":"))) return { ok: false, error: "Invalid official host" };
  if (!isOfficialTrustedResourceUrl(homepageUrl.value, officialHosts)) return { ok: false, error: "Source homepage must use an official HTTPS host" };
  return { ok: true, value: { id: id.value, name: name.value, homepageUrl: homepageUrl.value, officialHosts } };
}

function readProvenance(input: unknown): ParseResult<TrustedResourceProvenanceV1> {
  if (!isRecord(input) || !hasOnlyKeys(input, PROVENANCE_KEYS)) return { ok: false, error: "Invalid manifest provenance" };
  const publisher = nonEmpty(input["publisher"], "provenance.publisher"); if (!publisher.ok) return publisher;
  const reviewedAt = nonEmpty(input["reviewedAt"], "provenance.reviewedAt"); if (!reviewedAt.ok) return reviewedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt.value)) return { ok: false, error: "provenance.reviewedAt must be YYYY-MM-DD" };
  if (input["coverage"] !== "reviewed-sample" || input["permissions"] !== "outbound-link-only") {
    return { ok: false, error: "Manifest must declare reviewed-sample, outbound-link-only provenance" };
  }
  const note = optionalString(input["note"], "provenance.note"); if (!note.ok) return note;
  return { ok: true, value: { publisher: publisher.value, reviewedAt: reviewedAt.value, coverage: "reviewed-sample", permissions: "outbound-link-only", ...(note.value ? { note: note.value } : {}) } };
}

function readRecord(input: unknown, source: TrustedResourceSourceV1, backbone: BackboneData): ParseResult<TrustedResourceRecordV1> {
  if (!isRecord(input) || !hasOnlyKeys(input, RECORD_KEYS)) return { ok: false, error: "Invalid resource record fields" };
  const id = nonEmpty(input["id"], "record.id"); if (!id.ok) return id;
  if (input["sourceId"] !== source.id) return { ok: false, error: `Record ${id.value} has the wrong sourceId` };
  if (!KINDS.has(input["kind"] as TrustedResourceKind)) return { ok: false, error: `Record ${id.value} has an unsupported kind` };
  const title = nonEmpty(input["title"], "record.title"); if (!title.ok) return title;
  const officialUrl = nonEmpty(input["officialUrl"], "record.officialUrl"); if (!officialUrl.ok) return officialUrl;
  if (!isOfficialTrustedResourceUrl(officialUrl.value, source.officialHosts)) return { ok: false, error: `Record ${id.value} URL is not on an official host` };
  if (!MATCH_BASES.has(input["matchBasis"] as TrustedResourceMatchBasis)) return { ok: false, error: `Record ${id.value} has an unsupported match basis` };
  if (!Array.isArray(input["brefs"]) || input["brefs"].length === 0) return { ok: false, error: `Record ${id.value} requires explicit brefs` };
  const brefs: string[] = [];
  for (const value of input["brefs"]) {
    if (typeof value !== "string") return { ok: false, error: `Record ${id.value} has a non-string bref` };
    const parsed = parseBref(value); if (!parsed.ok) return parsed;
    if (parsed.value.tokenNarrowing) return { ok: false, error: `Record ${id.value} brefs must be verse-level` };
    const valid = validateRef(parsed.value, backbone); if (!valid.ok) return valid;
    brefs.push(value);
  }
  const metadata = readMetadata(input["metadata"]); if (!metadata.ok) return metadata;
  return { ok: true, value: { id: id.value, sourceId: source.id, kind: input["kind"] as TrustedResourceKind, title: title.value, officialUrl: officialUrl.value, brefs, matchBasis: input["matchBasis"] as TrustedResourceMatchBasis, ...(metadata.value ? { metadata: metadata.value } : {}) } };
}

function readMetadata(input: unknown): ParseResult<TrustedResourceFactualMetadataV1 | undefined> {
  if (input == null) return { ok: true, value: undefined };
  if (!isRecord(input) || !hasOnlyKeys(input, METADATA_KEYS)) return { ok: false, error: "Invalid factual metadata" };
  const author = optionalString(input["author"], "metadata.author"); if (!author.ok) return author;
  const publishedAt = optionalString(input["publishedAt"], "metadata.publishedAt"); if (!publishedAt.ok) return publishedAt;
  const language = optionalString(input["language"], "metadata.language"); if (!language.ok) return language;
  const series = optionalString(input["series"], "metadata.series"); if (!series.ok) return series;
  const duration = input["durationMinutes"];
  if (duration != null && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0)) return { ok: false, error: "metadata.durationMinutes must be positive" };
  return { ok: true, value: { ...(author.value ? { author: author.value } : {}), ...(publishedAt.value ? { publishedAt: publishedAt.value } : {}), ...(duration == null ? {} : { durationMinutes: duration }), ...(language.value ? { language: language.value } : {}), ...(series.value ? { series: series.value } : {}) } };
}

function nonEmpty(input: unknown, field: string): ParseResult<string> {
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: `${field} must be a non-empty string` };
  return { ok: true, value: input.trim() };
}

function optionalString(input: unknown, field: string): ParseResult<string | undefined> {
  if (input == null) return { ok: true, value: undefined };
  return nonEmpty(input, field);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}
