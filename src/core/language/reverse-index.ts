/**
 * Reverse Rendering Orbit data — English word → Strong's lemmas behind it.
 *
 * Built offline from alignments.jsonl (BSB / AKJV+Strong's). Runtime only
 * loads reverse-index.json — never scans 31k JSONL lines.
 */

import type { OrbitSegment, RenderingOrbit } from "./rendering-orbit.js";

export type ReverseStrongCount = {
  /** Prefixed Strong's id: H157 / G25 */
  strongs: string;
  count: number;
};

export type ReverseIndexFile = {
  meta: {
    packageId: string;
    source: string;
    builtAt: string;
    /** Total alignment tokens counted (after normalize drop). */
    tokenCount: number;
    /** Distinct English keys. */
    wordCount: number;
    /** Distinct Strong's ids. */
    strongCount: number;
  };
  /** lowercase english → sorted by count desc */
  words: Record<string, ReverseStrongCount[]>;
};

const MAX_SEGMENTS = 8;

/**
 * Phrase alignments can attach a one-off helper Strong's number to a content
 * word. Keep that evidence in reverse-index.json, but omit it from the ring
 * only when it is both a singleton and below 1% of this word's alignments.
 */
export function filterReverseEntriesForOrbit(
  entries: readonly ReverseStrongCount[],
): ReverseStrongCount[] {
  const rawTotal = entries.reduce((sum, entry) => sum + entry.count, 0);
  if (rawTotal <= 0) return [];
  return entries.filter((entry) => !(entry.count <= 1 && entry.count / rawTotal < 0.01));
}

/**
 * Normalize an English alignment surface for reverse-index keys:
 * lowercase, strip punctuation, collapse whitespace. Keeps multi-word phrases.
 */
export function normalizeEnglishWord(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    // Keep letters, numbers, apostrophes inside words, spaces.
    .replace(/[^a-z0-9\s'’]/g, " ")
    .replace(/['’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type AlignmentTokenIn = {
  word: string;
  strongs: string[];
};

export type AlignmentVerseIn = {
  book: string;
  chapter: number;
  verse: number;
  tokens: AlignmentTokenIn[];
};

/**
 * Accumulate reverse counts from alignment verse rows.
 * Returns the words map + total tokens counted.
 */
export function accumulateReverseIndex(
  verses: Iterable<AlignmentVerseIn>,
): { words: Map<string, Map<string, number>>; tokenCount: number } {
  const words = new Map<string, Map<string, number>>();
  let tokenCount = 0;

  for (const verse of verses) {
    for (const tok of verse.tokens ?? []) {
      const key = normalizeEnglishWord(tok.word);
      if (!key || key.length < 2) continue;
      // Drop pure function noise that never deserves a ring.
      if (STOP.has(key)) continue;

      const strongs = (tok.strongs ?? [])
        .map((s) => normalizeStrong(s))
        .filter((s): s is string => !!s);
      if (strongs.length === 0) continue;

      // Count each strong once per token (multi-strong rare).
      let map = words.get(key);
      if (!map) {
        map = new Map();
        words.set(key, map);
      }
      for (const s of strongs) {
        map.set(s, (map.get(s) ?? 0) + 1);
        tokenCount++;
      }
    }
  }

  return { words, tokenCount };
}

function normalizeStrong(raw: string): string | null {
  const m = String(raw).trim().toUpperCase().match(/^([HG])0*(\d{1,5})$/);
  if (!m) return null;
  return `${m[1]}${parseInt(m[2]!, 10)}`;
}

/** Tiny stop list — reverse ring is for content English, not "the/and/of". */
const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "that",
  "this",
  "these",
  "those",
  "it",
  "he",
  "she",
  "they",
  "we",
  "you",
  "i",
  "his",
  "her",
  "their",
  "our",
  "your",
  "my",
  "not",
  "but",
  "if",
  "so",
  "than",
  "then",
  "also",
  "into",
  "upon",
  "over",
  "under",
  "out",
  "up",
  "down",
  "all",
  "no",
  "nor",
  "yes",
]);

export function finalizeReverseIndex(
  packageId: string,
  source: string,
  words: Map<string, Map<string, number>>,
  tokenCount: number,
): ReverseIndexFile {
  const out: Record<string, ReverseStrongCount[]> = {};
  const strongSet = new Set<string>();
  for (const [word, map] of words) {
    const list: ReverseStrongCount[] = [...map.entries()]
      .map(([strongs, count]) => {
        strongSet.add(strongs);
        return { strongs, count };
      })
      .sort((a, b) => b.count - a.count || a.strongs.localeCompare(b.strongs));
    out[word] = list;
  }
  return {
    meta: {
      packageId,
      source,
      builtAt: new Date().toISOString(),
      tokenCount,
      wordCount: Object.keys(out).length,
      strongCount: strongSet.size,
    },
    words: out,
  };
}

/** Top-N English words by total hits (for Doctor). */
export function topWords(
  file: ReverseIndexFile,
  n = 20,
): Array<{ word: string; total: number; strongs: ReverseStrongCount[] }> {
  return Object.entries(file.words)
    .map(([word, strongs]) => ({
      word,
      total: strongs.reduce((s, x) => s + x.count, 0),
      strongs,
    }))
    .sort((a, b) => b.total - a.total || a.word.localeCompare(b.word))
    .slice(0, n);
}

/**
 * Build a RenderingOrbit payload for the reverse ring (English hub → lemmas).
 * `labelForStrong` supplies original-language / xlit labels for legend rows.
 */
export function buildReverseOrbit(opts: {
  englishWord: string;
  entries: ReverseStrongCount[];
  currentStrong?: string | null;
  labelForStrong: (strongs: string) => string;
}): RenderingOrbit | null {
  const entries = filterReverseEntriesForOrbit(opts.entries);
  if (!entries.length) return null;

  const total = entries.reduce((s, e) => s + e.count, 0);
  if (total <= 0) return null;

  const current = opts.currentStrong
    ? normalizeStrong(opts.currentStrong)
    : null;

  // Collapse rare tail into "other" like forward orbit.
  let working = [...entries].sort((a, b) => b.count - a.count);
  if (working.length > MAX_SEGMENTS) {
    const head = working.slice(0, MAX_SEGMENTS - 1);
    const tail = working.slice(MAX_SEGMENTS - 1);
    const otherCount = tail.reduce((s, e) => s + e.count, 0);
    working = [...head, { strongs: "OTHER", count: otherCount }];
  }

  const segments: OrbitSegment[] = working.map((e) => {
    const label =
      e.strongs === "OTHER" ? "other" : opts.labelForStrong(e.strongs) || e.strongs;
    return {
      label,
      count: e.count,
      share: e.count / total,
      isCurrent: current != null && e.strongs === current ? true : undefined,
      // Stash strongs on label side-channel via object — extend carefully.
    };
  });

  // Attach strongs ids for UI jump — keep parallel array in meta via segment label map.
  // Consumers use buildReverseOrbitDetailed for strongs keys.

  return {
    lemma: opts.englishWord,
    total,
    lemmaCount: total,
    segments,
    source: "package-gloss",
    kind: "content",
  };
}

export type ReverseOrbitSegment = OrbitSegment & {
  /** Strong's id for this band; null for "other". */
  strongs: string | null;
};

export type ReverseOrbit = {
  /** English hub word (display casing). */
  englishWord: string;
  /** Normalized key used for lookup. */
  key: string;
  total: number;
  segments: ReverseOrbitSegment[];
  /** Reading package that supplied the index (bsb / akjv-strongs). */
  packageId: string;
  source: "alignments";
  /** Hub meta — scope of the reverse counts (e.g. "whole Bible · BSB"). */
  scopeHint: string;
};

/** Human label for reverse-index package id. */
export function reverseSourceLabel(packageId: string): string {
  if (packageId === "bsb") return "BSB";
  if (packageId === "akjv-strongs") return "AKJV";
  return packageId.toUpperCase();
}

/**
 * Which reverse-index package to query for a reading translation.
 * BSB is the canonical backbone; AKJV only when actively reading AKJV+Strong's.
 */
export function resolveReverseIndexPackage(readingPackageId?: string | null): string {
  if (readingPackageId === "akjv-strongs") return "akjv-strongs";
  return "bsb";
}

/**
 * Full reverse orbit with Strong's ids on each segment (for jump-to-lemma).
 * Same-testament bands (preferTestament G|H) lead, then by count.
 */
export function buildReverseOrbitDetailed(opts: {
  englishWord: string;
  key: string;
  packageId: string;
  entries: ReverseStrongCount[];
  currentStrong?: string | null;
  /** When studying NT, pass "G"; OT, "H" — same-testament bands sort first. */
  preferTestament?: "G" | "H" | null;
  labelForStrong: (strongs: string) => string;
}): ReverseOrbit | null {
  const entries = filterReverseEntriesForOrbit(opts.entries);
  if (!entries.length) return null;
  const total = entries.reduce((s, e) => s + e.count, 0);
  if (total <= 0) return null;

  const current = opts.currentStrong
    ? normalizeStrong(opts.currentStrong)
    : null;
  const prefer = opts.preferTestament ?? null;

  const rank = (strongs: string): number => {
    if (!prefer || strongs === "OTHER") return 1;
    return strongs.startsWith(prefer) ? 0 : 1;
  };

  let working = [...entries].sort(
    (a, b) => rank(a.strongs) - rank(b.strongs) || b.count - a.count || a.strongs.localeCompare(b.strongs),
  );
  if (working.length > MAX_SEGMENTS) {
    const head = working.slice(0, MAX_SEGMENTS - 1);
    const tail = working.slice(MAX_SEGMENTS - 1);
    const otherCount = tail.reduce((s, e) => s + e.count, 0);
    working = [...head, { strongs: "OTHER", count: otherCount }];
  }

  const otherN = working.find((e) => e.strongs === "OTHER")
    ? entries.length - (working.length - 1)
    : 0;

  const segments: ReverseOrbitSegment[] = working.map((e) => {
    const isOther = e.strongs === "OTHER";
    return {
      label: isOther
        ? `Other (${otherN || "…"})`
        : opts.labelForStrong(e.strongs) || e.strongs,
      count: e.count,
      share: e.count / total,
      isCurrent: !isOther && current != null && e.strongs === current ? true : undefined,
      strongs: isOther ? null : e.strongs,
    };
  });

  return {
    englishWord: opts.englishWord,
    key: opts.key,
    total,
    segments,
    packageId: opts.packageId,
    source: "alignments",
    scopeHint: `whole Bible · ${reverseSourceLabel(opts.packageId)}`,
  };
}

/** Candidate English keys from a token's gloss / surface for reverse lookup. */
export function englishKeysFromGloss(gloss: string | null | undefined): string[] {
  if (!gloss?.trim()) return [];
  const full = normalizeEnglishWord(gloss);
  if (!full) return [];
  const keys = [full];
  // Also try significant single words (skip stopwords).
  for (const w of full.split(" ")) {
    if (w.length >= 3 && !STOP.has(w) && !keys.includes(w)) keys.push(w);
  }
  return keys;
}
