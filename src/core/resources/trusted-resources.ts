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

export type TrustedResourceKind = "article" | "commentary" | "guide" | "podcast" | "sermon" | "video";
export type TrustedResourceMatchBasis = "publisher-catalog" | "publisher-scripture-tag" | "publisher-title";
export type TrustedResourceMatch = "exact-passage" | "overlap" | "same-chapter";

export interface TrustedResourceSourceV1 {
  id: string;
  name: string;
  homepageUrl: string;
  officialHosts: string[];
  /**
   * Hosts this source may stream audio from, when that is not where its pages
   * live — a podcast is usually served from a CDN. Stated separately from
   * officialHosts so that permission to publish a link never silently becomes
   * permission to fetch a file.
   */
  mediaHosts?: string[];
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
  /**
   * The publisher's own audio file, played unmodified and only when a reader
   * presses play. Not stored, not cached, not re-hosted. Absent unless the
   * source is approved for it — see docs/trusted-resource-permissions.md.
   */
  audioUrl?: string;
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
  /** The language the reader is reading in. Only ever breaks a tie. */
  preferLanguage?: string;
  /**
   * What the reader has muted in their library, permanently.
   *
   * One list, two forms: `publisher` silences a publisher entirely, and
   * `publisher:kind` silences one kind from one publisher. Two separate lists
   * could not say "Working Preacher's commentaries but not its podcasts", and
   * a reader who wants that is not asking for something exotic.
   */
  mutes?: string[];
}

/**
 * Everything the passage matched, and what was actually handed back.
 *
 * The group shows three cards, so without a total a reader cannot tell a
 * passage with three answers from one with ninety, and "see all" has nothing
 * honest to put on it. Hidden sources are counted separately: a reader who
 * turned a publisher off should be able to see that they did, rather than
 * wonder why a passage went quiet.
 */
export interface TrustedResourceMatches {
  resources: RankedTrustedResource[];
  total: number;
  hiddenCount: number;
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

const SOURCE_KEYS = ["id", "name", "homepageUrl", "officialHosts", "mediaHosts"] as const;
const PROVENANCE_KEYS = ["publisher", "reviewedAt", "coverage", "permissions", "note"] as const;
const RECORD_KEYS = ["id", "sourceId", "kind", "title", "officialUrl", "brefs", "matchBasis", "metadata", "audioUrl"] as const;
const METADATA_KEYS = ["author", "publishedAt", "durationMinutes", "language", "series"] as const;
const KINDS = new Set<TrustedResourceKind>(["article", "commentary", "guide", "podcast", "sermon", "video"]);
const MATCH_BASES = new Set<TrustedResourceMatchBasis>([
  "publisher-catalog",
  "publisher-scripture-tag",
  "publisher-title",
]);

export function validateTrustedResourceQuery(
  input: unknown,
  backbone: BackboneData,
): ParseResult<TrustedResourceQuery> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["bref", "limit", "preferLanguage", "mutes"])) {
    return { ok: false, error: "Trusted-resource query has unknown or missing fields" };
  }
  if (typeof input["bref"] !== "string") return { ok: false, error: "Query bref must be a string" };
  const parsed = parseBref(input["bref"]);
  if (!parsed.ok) return parsed;
  const valid = validateRef(parsed.value, backbone);
  if (!valid.ok) return valid;
  if (parsed.value.tokenNarrowing) return { ok: false, error: "Resource queries must use verse-level brefs" };
  const limit = input["limit"];
  /* 20 was a margin's worth. "All" has to be able to mean all, and Romans 8
     alone selects 22, so the ceiling is the ranking's own: enough that a reader
     asking for everything gets everything, bounded so a query cannot be asked
     to render a book. */
  if (limit != null && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
    return { ok: false, error: "Query limit must be an integer from 1 to 100" };
  }
  const preferLanguage = input["preferLanguage"];
  if (preferLanguage != null && (typeof preferLanguage !== "string" || !/^[a-z]{2,3}$/.test(preferLanguage))) {
    return { ok: false, error: "Query preferLanguage must be a short language code" };
  }
  const mutes = input["mutes"];
  if (mutes != null) {
    const wellFormed = Array.isArray(mutes) && mutes.every((rule) => {
      if (typeof rule !== "string" || !rule.trim()) return false;
      const [sourceId, kind, ...rest] = rule.split(":");
      if (rest.length > 0 || !sourceId) return false;
      return kind == null || KINDS.has(kind as TrustedResourceKind);
    });
    if (!wellFormed) return { ok: false, error: "Query mutes must be source ids or source:kind rules" };
  }
  return {
    ok: true,
    value: {
      bref: input["bref"],
      ...(limit == null ? {} : { limit: limit as number }),
      ...(preferLanguage == null ? {} : { preferLanguage: preferLanguage as string }),
      ...(mutes == null ? {} : { mutes: mutes as string[] }),
    },
  };
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
  return matchTrustedResources(manifests, query).resources;
}

export function matchTrustedResources(
  manifests: readonly TrustedResourceManifestV1[],
  query: TrustedResourceQuery,
): TrustedResourceMatches {
  const empty: TrustedResourceMatches = { resources: [], total: 0, hiddenCount: 0 };
  const parsedQuery = parseBref(query.bref);
  if (!parsedQuery.ok) return empty;
  let ranked: RankedTrustedResource[] = [];
  for (const manifest of manifests) {
    for (const record of manifest.records) {
      let best: { match: TrustedResourceMatch; score: number; matchedBref: string } | null = null;
      for (const { bref, ref } of parsedBrefsOf(record)) {
        const match = passageMatch(parsedQuery.value, ref);
        if (match && (!best || match.score > best.score)) best = { ...match, matchedBref: bref };
      }
      if (best) ranked.push({ source: manifest.source, provenance: manifest.provenance, record, ...best });
    }
  }
  const mutes = new Set(query.mutes ?? []);
  const isMuted = (sourceId: string, kind: string): boolean =>
    mutes.has(sourceId) || mutes.has(`${sourceId}:${kind}`);
  const isHidden = (entry: RankedTrustedResource): boolean =>
    isMuted(entry.source.id, entry.record.kind);

  /* Selection runs twice — over everything, and over what the reader left on —
     so "see all 16" and "96 hidden" are never quoted in different units. Both
     count cards the group could actually show, after the restatement guard has
     dropped a publisher's second copy of one answer. */
  const selectableAll = selectCards(ranked, query);
  const visible = mutes.size === 0
    ? selectableAll
    : selectCards(ranked.filter((entry) => !isHidden(entry)), query);

  return {
    resources: visible.slice(0, query.limit ?? 3),
    total: visible.length,
    hiddenCount: selectableAll.length - visible.length,
  };
}

/**
 * The cards a set of matches could put on screen, in order.
 *
 * Evidence first, then specificity, then the reader's language, then stable
 * ids. Breadth before depth: each source puts its best card forward before any
 * source takes a second, and a second slot must say something the first did not.
 */
function selectCards(
  ranked: readonly RankedTrustedResource[],
  query: TrustedResourceQuery,
): RankedTrustedResource[] {
  const wrongLanguage = (entry: RankedTrustedResource): number => {
    if (!query.preferLanguage) return 0;
    const language = entry.record.metadata?.language;
    return !language || language === query.preferLanguage ? 0 : 1;
  };

  const ordered = [...ranked].sort((left, right) => right.score - left.score
    || matchedSpan(left.matchedBref) - matchedSpan(right.matchedBref)
    || wrongLanguage(left) - wrongLanguage(right)
    || left.source.id.localeCompare(right.source.id)
    || left.record.id.localeCompare(right.record.id));

  const seen = new Set<string>();
  const firstPerSource = ordered.filter((entry) => {
    if (seen.has(entry.source.id)) return false;
    seen.add(entry.source.id);
    return true;
  });

  const spoken = new Set(firstPerSource.map(restatementKey));
  const remainder = ordered.filter((entry) => {
    if (firstPerSource.includes(entry)) return false;
    const key = restatementKey(entry);
    if (spoken.has(key)) return false;
    spoken.add(key);
    return true;
  });
  return [...firstPerSource, ...remainder];
}


/**
 * What would make a second card from one source a restatement of the first.
 *
 * Coordinates and kind, deliberately not title: the Spanish edition of a
 * commentary is titled differently and is still the same commentary, and two of
 * one publisher's commentaries on identical verses are two answers to a question
 * the reader has already been given an answer to. Either may be the better card
 * — but the slot it would take is the only one another publisher could have had.
 */
function restatementKey(entry: RankedTrustedResource): string {
  return `${entry.source.id}|${entry.matchedBref}|${entry.record.kind}`;
}

/**
 * A record's brefs, parsed once.
 *
 * The coordinates are already validated at load, so reparsing them on every
 * query is pure repetition — and it is repetition per record, which is the one
 * axis that grows without limit as catalogues are imported. Keyed on the record
 * object, so a manifest the host has cached keeps its parse, and a manifest
 * reloaded from a changed file gets fresh objects and parses again.
 */
const parsedBrefs = new WeakMap<TrustedResourceRecordV1, { bref: string; ref: CanonicalRef }[]>();

function parsedBrefsOf(record: TrustedResourceRecordV1): { bref: string; ref: CanonicalRef }[] {
  const hit = parsedBrefs.get(record);
  if (hit) return hit;
  const parsed: { bref: string; ref: CanonicalRef }[] = [];
  for (const bref of record.brefs) {
    const candidate = parseBref(bref);
    if (candidate.ok) parsed.push({ bref, ref: candidate.value });
  }
  parsedBrefs.set(record, parsed);
  return parsed;
}

/**
 * How much ground a matched coordinate covers, as a comparable magnitude.
 *
 * Match class alone cannot separate a whole-book guide from a commentary on
 * the six verses in front of the reader: read a chapter and both are merely
 * `overlap`, so the old id tie-break handed the featured slot to whichever
 * publisher sorted first, in every chapter of that book. Specificity is the
 * evidence the reader means: of two records with the same class, the one that
 * claims less ground claims it about this passage.
 *
 * This is an ordering proxy, not a verse count — it never leaves the parsed
 * coordinate, so it cannot disagree with a backbone it does not consult. 200
 * is above any chapter's verse count, which keeps chapters dominant over
 * verses; a cross-book span outranks every single-book one by construction.
 */
function matchedSpan(bref: string): number {
  const parsed = parseBref(bref);
  if (!parsed.ok) return Number.MAX_SAFE_INTEGER;
  const { start, end } = parsed.value;
  if (start.book !== end.book) return 1_000_000;
  return (end.chapter - start.chapter) * 200 + (end.verse - start.verse);
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
  const rawMediaHosts = input["mediaHosts"];
  let mediaHosts: string[] | undefined;
  if (rawMediaHosts != null) {
    if (!Array.isArray(rawMediaHosts) || rawMediaHosts.length === 0) return { ok: false, error: "source.mediaHosts must not be empty" };
    mediaHosts = rawMediaHosts.map((host) => typeof host === "string" ? host.trim().toLowerCase() : "");
    if (mediaHosts.some((host) => !host || host.includes("/") || host.includes(":"))) return { ok: false, error: "Invalid media host" };
  }
  return {
    ok: true,
    value: {
      id: id.value, name: name.value, homepageUrl: homepageUrl.value, officialHosts,
      ...(mediaHosts ? { mediaHosts } : {}),
    },
  };
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
  const rawAudio = input["audioUrl"];
  let audioUrl: string | undefined;
  if (rawAudio != null) {
    const parsed = optionalString(rawAudio, "record.audioUrl"); if (!parsed.ok) return parsed;
    audioUrl = parsed.value;
    /* Media hosts, not official hosts: a source that has not declared where its
       audio lives cannot carry any. */
    if (audioUrl && !isOfficialTrustedResourceUrl(audioUrl, source.mediaHosts ?? [])) {
      return { ok: false, error: `Record ${id.value} audio is not on a declared media host` };
    }
  }
  return { ok: true, value: { id: id.value, sourceId: source.id, kind: input["kind"] as TrustedResourceKind, title: title.value, officialUrl: officialUrl.value, brefs, matchBasis: input["matchBasis"] as TrustedResourceMatchBasis, ...(metadata.value ? { metadata: metadata.value } : {}), ...(audioUrl ? { audioUrl } : {}) } };
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
