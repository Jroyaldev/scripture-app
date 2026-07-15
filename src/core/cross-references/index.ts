/**
 * Open cross-reference graph — pure, platform-agnostic query/ranking logic.
 *
 * The stored graph keeps every imported edge and its original score. Normal
 * presentation filters non-positive scores at query time; it never mutates the
 * installed reference artifact.
 */

import { isValidBookCode } from "../reference/backbone.js";
import { toBref, toDisplayString } from "../reference/parser.js";
import type {
  BookCode,
  BookNameMap,
  CanonicalRef,
  CanonicalVerse,
} from "../reference/types.js";

export const CROSS_REFERENCE_FORMAT_VERSION = 1 as const;
export const DEFAULT_VERSE_CROSS_REFERENCE_LIMIT = 10;
export const DEFAULT_PASSAGE_CROSS_REFERENCE_LIMIT = 8;

/** The source does not currently classify these. Kept for a future evidence layer. */
export type CrossReferenceRelationshipKind =
  | "quotation"
  | "parallel"
  | "theme"
  | "prophecy";

/** Compact on-disk/in-memory edge: normalized target range + source vote score. */
export type CrossReferenceEdge = readonly [target: string, score: number];

export type CrossReferenceMeta = {
  formatVersion: typeof CROSS_REFERENCE_FORMAT_VERSION;
  id: "openbible-cross-references";
  name: "OpenBible Cross References";
  source: string;
  sourceUrl: string;
  license: "CC-BY";
  licenseUrl: string;
  attribution: string;
  snapshotDate: string;
  rowCount: number;
  sourceVerseCount: number;
  sourceBookCount: number;
  targetRangeCount: number;
  scoreMin: number;
  scoreMax: number;
  scoreSum: number;
  rawSha256: string;
  normalizedSha256: string;
};

export type CrossReferenceData = {
  meta: CrossReferenceMeta;
  refs: Record<string, CrossReferenceEdge[]>;
};

export type CrossReferenceQuery = {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

export type CrossReferenceMatch = {
  sourceId: string;
  sourceName: string;
  targetKey: string;
  targetBref: string;
  targetDisplay: string;
  score: number;
  rankScore: number;
  supportingSourceCount: number;
  supportingSourceBrefs: string[];
  relationshipKinds: CrossReferenceRelationshipKind[];
  preview?: string;
};

export type CrossReferenceQueryResult = {
  scope: "verse" | "passage";
  sourceBref: string;
  totalCount: number;
  items: CrossReferenceMatch[];
  attribution: Pick<
    CrossReferenceMeta,
    "id" | "name" | "sourceUrl" | "license" | "licenseUrl" | "attribution" | "snapshotDate"
  >;
};

type AggregatedMatch = {
  targetKey: string;
  target: CanonicalRef;
  maxScore: number;
  scoreSum: number;
  sourceBrefs: Set<string>;
};

export function emptyCrossReferenceResult(
  query: CrossReferenceQuery,
  data?: CrossReferenceData | null,
): CrossReferenceQueryResult {
  return {
    scope: isSingleVerse(query) ? "verse" : "passage",
    sourceBref: queryToBref(query),
    totalCount: 0,
    items: [],
    attribution: data ? attributionFrom(data.meta) : {
      id: "openbible-cross-references",
      name: "OpenBible Cross References",
      sourceUrl: "https://www.openbible.info/labs/cross-references/",
      license: "CC-BY",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "OpenBible Cross References, CC-BY 4.0",
      snapshotDate: "",
    },
  };
}

/**
 * Rank an individual verse or aggregate a passage without discarding the
 * lower-ranked installed edges. Non-positive edges are hidden only here.
 */
export function queryCrossReferences(
  data: CrossReferenceData,
  query: CrossReferenceQuery,
  bookNames: BookNameMap,
  limit = isSingleVerse(query)
    ? DEFAULT_VERSE_CROSS_REFERENCE_LIMIT
    : DEFAULT_PASSAGE_CROSS_REFERENCE_LIMIT,
): CrossReferenceQueryResult {
  const base = emptyCrossReferenceResult(query, data);
  if (!isValidBookCode(query.book) || limit <= 0) return base;

  const aggregated = new Map<string, AggregatedMatch>();
  for (const source of iterateQueryVerses(query)) {
    const sourceKey = pointKey(source);
    const sourceBref = toBref({ version: "v1", start: source, end: source });
    for (const edge of data.refs[sourceKey] ?? []) {
      const [targetKey, score] = edge;
      // Presentation policy only. The installed corpus still retains the row.
      if (!Number.isFinite(score) || score <= 0) continue;
      const target = parseCrossReferenceKey(targetKey);
      if (!target || rangesOverlap(query, target)) continue;

      const current = aggregated.get(targetKey);
      if (current) {
        current.maxScore = Math.max(current.maxScore, score);
        current.scoreSum += score;
        current.sourceBrefs.add(sourceBref);
      } else {
        aggregated.set(targetKey, {
          targetKey,
          target,
          maxScore: score,
          scoreSum: score,
          sourceBrefs: new Set([sourceBref]),
        });
      }
    }
  }

  const ranked = [...aggregated.values()]
    .map((item): CrossReferenceMatch => {
      const supportingSourceBrefs = [...item.sourceBrefs];
      const supportingSourceCount = supportingSourceBrefs.length;
      // Votes rank relevance within a source verse. Passage support gets a
      // bounded, legible boost so repeated passage evidence matters without
      // pretending the crowd score is a theological confidence percentage.
      const rankScore = item.maxScore
        + Math.max(0, supportingSourceCount - 1) * 12
        + Math.log2(item.scoreSum + 1);
      return {
        sourceId: data.meta.id,
        sourceName: data.meta.name,
        targetKey: item.targetKey,
        targetBref: toBref(item.target),
        targetDisplay: toDisplayString(item.target, bookNames),
        score: item.maxScore,
        rankScore,
        supportingSourceCount,
        supportingSourceBrefs,
        // OpenBible provides no relationship taxonomy. Never infer one here.
        relationshipKinds: [],
      };
    })
    .sort((a, b) =>
      b.rankScore - a.rankScore
      || b.supportingSourceCount - a.supportingSourceCount
      || b.score - a.score
      || a.targetKey.localeCompare(b.targetKey),
    );

  return {
    ...base,
    totalCount: ranked.length,
    items: ranked.slice(0, Math.min(12, Math.max(1, Math.floor(limit)))),
  };
}

export function parseCrossReferenceKey(key: string): CanonicalRef | null {
  const [startText, endText, extra] = key.split("-");
  if (!startText || extra !== undefined) return null;
  const start = parsePointKey(startText);
  const end = endText ? parsePointKey(endText) : start;
  if (!start || !end) return null;
  return { version: "v1", start, end };
}

export function pointKey(point: CanonicalVerse): string {
  return `${point.book}.${point.chapter}.${point.verse}`;
}

function parsePointKey(key: string): CanonicalVerse | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  const [book, chapterText, verseText] = parts as [string, string, string];
  if (!isValidBookCode(book)) return null;
  const chapter = Number.parseInt(chapterText, 10);
  const verse = Number.parseInt(verseText, 10);
  if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(verse) || verse < 1) return null;
  return { book: book as BookCode, chapter, verse };
}

function* iterateQueryVerses(query: CrossReferenceQuery): Generator<CanonicalVerse> {
  if (!isValidBookCode(query.book)) return;
  for (let chapter = query.startChapter; chapter <= query.endChapter; chapter++) {
    const start = chapter === query.startChapter ? query.startVerse : 1;
    const end = chapter === query.endChapter ? query.endVerse : 200;
    for (let verse = start; verse <= end; verse++) {
      yield { book: query.book as BookCode, chapter, verse };
    }
  }
}

function isSingleVerse(query: CrossReferenceQuery): boolean {
  return query.startChapter === query.endChapter && query.startVerse === query.endVerse;
}

function queryToBref(query: CrossReferenceQuery): string {
  if (!isValidBookCode(query.book)) return "";
  const book = query.book as BookCode;
  return toBref({
    version: "v1",
    start: { book, chapter: query.startChapter, verse: query.startVerse },
    end: { book, chapter: query.endChapter, verse: query.endVerse },
  });
}

function rangesOverlap(query: CrossReferenceQuery, target: CanonicalRef): boolean {
  if (target.start.book !== query.book || target.end.book !== query.book) return false;
  const queryStart = query.startChapter * 1000 + query.startVerse;
  const queryEnd = query.endChapter * 1000 + query.endVerse;
  const targetStart = target.start.chapter * 1000 + target.start.verse;
  const targetEnd = target.end.chapter * 1000 + target.end.verse;
  return targetStart <= queryEnd && targetEnd >= queryStart;
}

function attributionFrom(meta: CrossReferenceMeta): CrossReferenceQueryResult["attribution"] {
  return {
    id: meta.id,
    name: meta.name,
    sourceUrl: meta.sourceUrl,
    license: meta.license,
    licenseUrl: meta.licenseUrl,
    attribution: meta.attribution,
    snapshotDate: meta.snapshotDate,
  };
}
