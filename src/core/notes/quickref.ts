/**
 * Quick-capture scripture reference recognition — pure core (INV-18).
 * Task B3.6 Gate E0.
 *
 * The strict parser (parseScriptureRefs) reads formal citations
 * ("Acts 19:1-7"). Real quick capture writes `ps23`, `jn 3`, `1cor13:4`,
 * `gen 1.2`, `pslam 23`, `galations 2` — lowercase, compact, chapter-only,
 * dot-separated, misspelled. This module resolves those DETERMINISTICALLY,
 * with layered matching and conservative guards:
 *
 *   layer 1: exact book names/abbreviations (from book-names-en.json, case-
 *            insensitive, space-optional for numbered books)
 *   layer 2: curated misspellings map (editable word list)
 *   layer 3: Damerau-Levenshtein distance 1 against full book names (≥5 chars,
 *            unique resolution only)
 *
 * Guards (a wrong anchor is worse than a missed one):
 *   - fuzzy layers fire ONLY with adjacent chapter digits (regex-enforced)
 *   - ambiguous tokens (resolving to 2+ books) never match
 *   - chapter-only matches reject lowercase common English words ("act 2" of
 *     a play vs "Acts 2"; capitalized forms always accepted)
 *   - chapters/verses validate against the backbone
 */

import type { BackboneData, BookCode, BookNameMap, CanonicalRef } from "../reference/types.js";
import { isValidBookCode } from "../reference/backbone.js";
import { validateRef } from "../reference/parser.js";
import type { ScriptureRefMatch } from "./types.js";

/**
 * Common misspellings that are beyond edit-distance-1 of the canonical name.
 * Editable word list — extend freely; every entry is exact-match (lowercase).
 */
export const MISSPELLINGS: Record<string, string> = {
  phillipians: "PHP",
  philippians: "PHP",
  philipians: "PHP",
  collosians: "COL",
  colossions: "COL",
  corinthains: "CO?", // resolved with the 1/2 prefix at match time
  thessalonions: "TH?",
  habbakuk: "HAB",
  eclesiastes: "ECC",
  ecclesiastese: "ECC",
  revelations: "REV",
  pslams: "PSA",
  pslam: "PSA",
};

/**
 * English words that must not be treated as a book when written lowercase in
 * a chapter-only match ("act 2" of a play; "he 3"). Capitalized forms and
 * verse-bearing forms ("Act 2", "act 2:38") still resolve.
 */
const LOWERCASE_CHAPTER_ONLY_BLOCK = new Set([
  "is", "am", "an", "at", "on", "no", "so", "he", "me", "act", "job",
]);

type BookIndex = {
  /** lowercase name/abbrev (spaces removed) → USFM code; ambiguous names dropped */
  exact: Map<string, string>;
  /** full primary names (lowercase, spaces removed) → code, for edit-distance */
  fullNames: Map<string, string>;
};

const indexCache = new WeakMap<BookNameMap, BookIndex>();

export function buildBookIndex(bookNames: BookNameMap): BookIndex {
  const cached = indexCache.get(bookNames);
  if (cached) return cached;

  const counts = new Map<string, Set<string>>();
  for (const [code, names] of Object.entries(bookNames)) {
    for (const name of names ?? []) {
      const key = name.toLowerCase().replace(/\s+/g, "");
      const set = counts.get(key) ?? new Set<string>();
      set.add(code);
      counts.set(key, set);
    }
  }
  const exact = new Map<string, string>();
  for (const [key, codes] of counts) {
    if (codes.size === 1) exact.set(key, [...codes][0]!);
  }

  const fullNames = new Map<string, string>();
  for (const [code, names] of Object.entries(bookNames)) {
    const primary = names?.[0];
    if (primary && primary.length >= 5) {
      fullNames.set(primary.toLowerCase().replace(/\s+/g, ""), code);
    }
  }

  const index = { exact, fullNames };
  indexCache.set(bookNames, index);
  return index;
}

/** Damerau-Levenshtein distance capped at 2 (we only care about ≤1). */
export function damerauDistance1(a: string, b: string): boolean {
  if (a === b) return false; // exact handled elsewhere
  if (Math.abs(a.length - b.length) > 1) return false;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }
  return dp[a.length]![b.length]! <= 1;
}

export type ResolvedBook = { code: string; layer: "exact" | "misspelling" | "fuzzy" };

/**
 * Resolve a book token (optionally digit-prefixed, e.g. "1"+"cor") to a USFM
 * code, or null. Deterministic; ambiguity always loses.
 */
export function resolveBookToken(
  numPrefix: string | undefined,
  word: string,
  bookNames: BookNameMap,
): ResolvedBook | null {
  const index = buildBookIndex(bookNames);
  const lower = word.toLowerCase();
  const key = numPrefix ? `${numPrefix}${lower}` : lower;

  const exact = index.exact.get(key);
  if (exact) return { code: exact, layer: "exact" };

  const misspelled = MISSPELLINGS[lower];
  if (misspelled) {
    // Entries ending in "?" need the numeric prefix to disambiguate (1CO/2CO).
    if (misspelled.endsWith("?")) {
      if (!numPrefix) return null;
      return { code: `${numPrefix}${misspelled.slice(0, -1)}`, layer: "misspelling" };
    }
    if (numPrefix) return null; // "1 habbakuk" is nonsense — reject
    return { code: misspelled, layer: "misspelling" };
  }

  // Fuzzy: distance-1 against full names, unique resolution only, token ≥5.
  if (key.length >= 5) {
    let match: string | null = null;
    for (const [name, code] of index.fullNames) {
      if (damerauDistance1(key, name)) {
        if (match && match !== code) return null; // ambiguous
        match = code;
      }
    }
    if (match) return { code: match, layer: "fuzzy" };
  }

  return null;
}

/**
 * Scan body text for quick-capture references. Returns validated matches;
 * intended to run AFTER the strict pass with a shared dedupe set.
 */
export function parseQuickRefs(
  body: string,
  bookNames: BookNameMap,
  backbone: BackboneData,
  seen: Set<string>,
): ScriptureRefMatch[] {
  const refs: ScriptureRefMatch[] = [];
  // (1|2|3)? word .? space? chapter ( [:.] verse ( - (chapter:)? verse )? )?
  const pattern =
    /\b([123])?\s?([A-Za-z]{2,14})\.?\s?(\d{1,3})(?:[:.](\d{1,3})(?:\s*[-\u2013\u2014]\s*(?:(\d{1,3})[:.])?(\d{1,3}))?)?\b/g;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    const [raw, numPrefix, word, chStr, vStr, endChStr, endVStr] = m;
    const resolved = resolveBookToken(numPrefix, word!, bookNames);
    if (!resolved) continue;

    const hasVerse = vStr !== undefined;
    if (!hasVerse) {
      // Chapter-only guard: lowercase common English words never match.
      if (LOWERCASE_CHAPTER_ONLY_BLOCK.has(word!.toLowerCase()) && word![0] === word![0]!.toLowerCase()) {
        continue;
      }
    }

    if (!isValidBookCode(resolved.code)) continue;
    const book: BookCode = resolved.code;
    const chapter = parseInt(chStr!, 10);
    const verseCount = backbone.books[book]?.chapters[chapter - 1];
    if (verseCount === undefined) continue;

    let ref: CanonicalRef;
    if (hasVerse) {
      const startVerse = parseInt(vStr!, 10);
      const endChapter = endChStr !== undefined ? parseInt(endChStr, 10) : chapter;
      const endVerse = endVStr !== undefined ? parseInt(endVStr, 10) : startVerse;
      ref = {
        version: "v1",
        start: { book, chapter, verse: startVerse },
        end: { book, chapter: endChapter, verse: endVerse },
      };
    } else {
      // Chapter-only → anchor the whole chapter.
      ref = {
        version: "v1",
        start: { book, chapter, verse: 1 },
        end: { book, chapter, verse: verseCount },
      };
    }

    const validated = validateRef(ref, backbone);
    if (!validated.ok) continue;

    const key = `${ref.start.book}.${ref.start.chapter}.${ref.start.verse}-${ref.end.book}.${ref.end.chapter}.${ref.end.verse}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ raw: raw!.trim(), ref });
  }

  return refs;
}
