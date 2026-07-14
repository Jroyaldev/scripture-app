/**
 * Original-language token model — data layer only (no interpretive judgments).
 * Platform-agnostic (INV-18).
 */

import type { BookCode } from "../reference/types.js";

/** Provenance for a token batch (dataset + edition + license). */
export type TokenDatasetMeta = {
  /** Stable package id, e.g. "macula-greek-nestle1904". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Dataset family. */
  family: "macula-greek" | "macula-hebrew" | "morphgnt" | "oshb" | "stepbible" | "other";
  /** Base text edition, e.g. "Nestle1904", "SBLGNT", "WLC". */
  edition: string;
  /** Dataset release / git tag if known. */
  version: string;
  language: "grc" | "hbo" | "other";
  license: {
    spdx?: string;
    name: string;
    attributionText: string;
  };
  /** Optional remote source URL. */
  sourceUrl?: string;
};

/**
 * Morphological features expanded from a morph code (or MACULA feature columns).
 * All fields optional — morphology is partial for particles, punctuation, etc.
 */
export type MorphFeatures = {
  pos?: string;
  person?: string;
  number?: string;
  gender?: string;
  case?: string;
  tense?: string;
  voice?: string;
  mood?: string;
  degree?: string;
  /** Original morph code when available (e.g. V-FPI-3P). */
  code?: string;
};

/**
 * One surface token in an original-language text.
 * Deterministic / source-derived — not a linguistic judgment.
 */
export type TokenRecord = {
  /** Stable id from source dataset (e.g. MACULA xml:id n46013008008). */
  id: string;
  /** Dataset this token came from. */
  datasetId: string;
  book: BookCode;
  chapter: number;
  verse: number;
  /** 1-based position within the verse (source ordering). */
  position: number;
  /** Surface form as printed (may include accents/breathing). */
  surface: string;
  /** Trailing whitespace / punctuation attached after the word, if any. */
  after?: string;
  /** Normalized orthography when provided. */
  normalized?: string;
  /** Lemma (dictionary form). */
  lemma?: string;
  /** Strong's number as string digits (no G/H prefix). */
  strong?: string;
  /** Strong's with traditional prefix when known (G2673 / H1234). */
  strongPrefixed?: string;
  /** Raw morph code from source. */
  morphCode?: string;
  /** Expanded morph features for UI chips. */
  morph: MorphFeatures;
  /**
   * Default gloss from the dataset (e.g. Berean interlinear gloss).
   * UI MUST treat this as non-authoritative range/gloss, not "force".
   */
  gloss?: string;
  /** Louw-Nida domain id when present. */
  louwNida?: string;
  /** Domain code when present (dataset-specific). */
  domain?: string;
  /** Syntactic role label when present (e.g. MACULA role). */
  role?: string;
  /** Word class when present (noun, verb, …). */
  wordClass?: string;
  /** Subtype (common, proper, …). */
  wordType?: string;
};

/** Indexes derived from TokenRecord[] — fully regenerable (INV-2). */
export type TokenIndex = {
  datasetId: string;
  /** token id → record */
  byId: Map<string, TokenRecord>;
  /** "BOOK.chapter.verse" → tokens in position order */
  byVerse: Map<string, TokenRecord[]>;
  /** lemma → token ids (corpus-wide) */
  byLemma: Map<string, string[]>;
  /** strong digits → token ids */
  byStrong: Map<string, string[]>;
  /** lemma → count in whole corpus */
  lemmaFreqCorpus: Map<string, number>;
  /** "BOOK|lemma" → count in book */
  lemmaFreqBook: Map<string, number>;
  /** "BOOK.chapter|lemma" → count in chapter */
  lemmaFreqChapter: Map<string, number>;
};

export type ParseMaculaGreekResult = {
  tokens: TokenRecord[];
  dataset: TokenDatasetMeta;
  stats: {
    rows: number;
    parsed: number;
    skipped: number;
    books: string[];
  };
  /** Non-fatal row issues (unknown book, bad ref, …). */
  warnings: string[];
};

/** Mark signals computable from indexes alone (no editorial judgment). */
export type TokenMarkKind = "repeat" | "rare";

export type TokenMark = {
  tokenId: string;
  kind: TokenMarkKind;
  /** Human-readable reason derived from counts. */
  reason: string;
};
