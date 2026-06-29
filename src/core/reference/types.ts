/**
 * Core reference types — platform-agnostic, no Node/Electron imports (INV-18).
 * These types define the backbone coordinate system for Scripture references.
 */

/** USFM 3-letter uppercase book codes for the Protestant 66-book canon. */
export const BOOK_CODES = [
  "GEN", "EXO", "LEV", "NUM", "DEU",
  "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI",
  "1CH", "2CH", "EZR", "NEH", "EST",
  "JOB", "PSA", "PRO", "ECC", "SNG",
  "ISA", "JER", "LAM", "EZK", "DAN",
  "HOS", "JOL", "AMO", "OBA", "JON", "MIC",
  "NAH", "HAB", "ZEP", "HAG", "ZEC", "MAL",
  "MAT", "MRK", "LUK", "JHN", "ACT",
  "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL",
  "1TH", "2TH", "1TI", "2TI", "TIT", "PHM",
  "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN",
  "JUD", "REV",
] as const;

export type BookCode = typeof BOOK_CODES[number];

/** The in-memory structured form of a backbone reference. */
export type CanonicalRef = {
  version: "v1";
  start: CanonicalVerse;
  end: CanonicalVerse;
  tokenNarrowing?: TokenNarrowing;
};

export type CanonicalVerse = {
  book: BookCode;
  chapter: number;
  verse: number;
};

export type TokenNarrowing = {
  layer: string;
  tokenStart: string;
  tokenEnd: string;
};

/** Backbone data shape: book -> array of verse counts per chapter (1-indexed chapters). */
export type BackboneData = {
  version: "v1";
  psalmSuperscriptionPolicy: string;
  verseSplitMergePolicy: string;
  books: Record<string, BookData>;
};

export type BookData = {
  chapters: number[];
};

/** VersificationMap: sparse divergence list between a display system and the backbone. */
export type VersificationMap = {
  system: string;
  rules: VersificationRule[];
};

export type VersificationRule = {
  display: { book: string; chapter: number; verse: number };
  canonical: CanonicalVerse | { start: CanonicalVerse; end: CanonicalVerse };
  relation: "exact" | "merge" | "split" | "offset";
};

/** Scripture package manifest. */
export type ScripturePackage = {
  id: string;
  name: string;
  language: string;
  type: "translation" | "original" | "interlinear-data" | "alignment";
  versification: string;
  canonProfile: string;
  license: {
    spdx?: string;
    name: string;
    attributionText: string;
    permissions: {
      bundle: boolean;
      index: boolean;
      display: boolean;
      quoteInNotes: boolean;
      export: boolean;
      syncToOwnDevices: boolean;
    };
  };
};

/**
 * Display name mapping for book codes. Used for rendering, not stored on anchors (INV-5).
 * Locale-aware book name resolution lives in data, not hardcoded.
 */
export type BookNameMap = Record<string, string[]>;
