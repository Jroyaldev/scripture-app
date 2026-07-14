/**
 * Expand Greek morph codes / feature fields into UI-facing English labels.
 * Deterministic tables only — not contextual interpretation.
 */

import type { MorphFeatures } from "./types.js";

const TENSE: Record<string, string> = {
  P: "present",
  I: "imperfect",
  F: "future",
  A: "aorist",
  X: "perfect",
  Y: "pluperfect",
  present: "present",
  imperfect: "imperfect",
  future: "future",
  aorist: "aorist",
  perfect: "perfect",
  pluperfect: "pluperfect",
};

const VOICE: Record<string, string> = {
  A: "active",
  M: "middle",
  P: "passive",
  E: "middle or passive",
  active: "active",
  middle: "middle",
  passive: "passive",
};

const MOOD: Record<string, string> = {
  I: "indicative",
  D: "imperative",
  S: "subjunctive",
  O: "optative",
  N: "infinitive",
  P: "participle",
  indicative: "indicative",
  imperative: "imperative",
  subjunctive: "subjunctive",
  optative: "optative",
  infinitive: "infinitive",
  participle: "participle",
};

const CASE: Record<string, string> = {
  N: "nominative",
  G: "genitive",
  D: "dative",
  A: "accusative",
  V: "vocative",
  nominative: "nominative",
  genitive: "genitive",
  dative: "dative",
  accusative: "accusative",
  vocative: "vocative",
};

const NUMBER: Record<string, string> = {
  S: "singular",
  P: "plural",
  D: "dual",
  singular: "singular",
  plural: "plural",
  dual: "dual",
};

const GENDER: Record<string, string> = {
  M: "masculine",
  F: "feminine",
  N: "neuter",
  masculine: "masculine",
  feminine: "feminine",
  neuter: "neuter",
};

const PERSON: Record<string, string> = {
  "1": "1st person",
  "2": "2nd person",
  "3": "3rd person",
  first: "1st person",
  second: "2nd person",
  third: "3rd person",
};

const DEGREE: Record<string, string> = {
  C: "comparative",
  S: "superlative",
  comparative: "comparative",
  superlative: "superlative",
};

const POS_FROM_CODE: Record<string, string> = {
  "N-": "noun",
  "A-": "adjective",
  "V-": "verb",
  "C-": "conjunction",
  "D-": "adverb",
  "I-": "interjection",
  "P-": "preposition",
  "X-": "particle",
  RA: "article",
  RD: "demonstrative pronoun",
  RI: "interrogative/indefinite pronoun",
  RP: "personal pronoun",
  RR: "relative pronoun",
  T: "article",
  ADV: "adverb",
  CONJ: "conjunction",
  PREP: "preposition",
  PRT: "particle",
  INJ: "interjection",
  HEB: "hebrew word",
  ARAM: "aramaic word",
  N: "noun",
  A: "adjective",
  V: "verb",
  C: "conjunction",
  D: "adverb",
  P: "preposition",
  X: "particle",
};

/**
 * Parse a Robinson / MorphGNT-style code such as V-FPI-3P or N-NSF.
 * Returns partial MorphFeatures; unknown segments are ignored.
 */
export function parseMorphCode(code: string | undefined | null): MorphFeatures {
  if (!code || !code.trim()) return {};
  const raw = code.trim().toUpperCase();
  const features: MorphFeatures = { code: code.trim() };

  // POS prefix: "V-", "N-", "RA", "ADV-", "T-", etc.
  const posMatch = raw.match(/^([A-Z]{1,4})-?/);
  if (posMatch?.[1]) {
    const key = posMatch[1];
    const withDash = `${key}-`;
    features.pos = POS_FROM_CODE[withDash] ?? POS_FROM_CODE[key] ?? key.toLowerCase();
  }

  // Verb style: V-FPI-3P, also second aorist V-2ADI-3S (optional "2" prefix on tense)
  // Voice may be A/M/P or D (middle/deponent in some Robinson dumps)
  const verb = raw.match(
    /^V-(?:2)?([A-Z])([A-Z])([A-Z])(?:-([123])([SPD])([MFN])?([NGDAV])?)?/,
  );
  if (verb) {
    features.pos = "verb";
    if (verb[1]) features.tense = TENSE[verb[1]] ?? verb[1];
    // D ≈ middle in several NT morph dumps
    const voiceKey = verb[2] === "D" ? "M" : verb[2];
    if (voiceKey) features.voice = VOICE[voiceKey] ?? verb[2];
    if (verb[3]) features.mood = MOOD[verb[3]] ?? verb[3];
    if (verb[4]) features.person = PERSON[verb[4]] ?? verb[4];
    if (verb[5]) features.number = NUMBER[verb[5]] ?? verb[5];
    if (verb[6]) features.gender = GENDER[verb[6]] ?? verb[6];
    if (verb[7]) features.case = CASE[verb[7]] ?? verb[7];
    return features;
  }

  // Nominal style: N-NSF, A-APM, T-NSF, RA----NSF- (MorphGNT padded)
  const nominal = raw.match(/^[A-Z]{1,2}-*([NGDAV])([SP])([MFN])([CS])?/);
  if (nominal) {
    if (nominal[1]) features.case = CASE[nominal[1]] ?? nominal[1];
    if (nominal[2]) features.number = NUMBER[nominal[2]] ?? nominal[2];
    if (nominal[3]) features.gender = GENDER[nominal[3]] ?? nominal[3];
    if (nominal[4]) features.degree = DEGREE[nominal[4]] ?? nominal[4];
    return features;
  }

  // MorphGNT padded: N- ----NSF-
  const padded = raw.match(/^[A-Z-]{2}\s*-*([NGDAV-])([SP-])([MFN-])/);
  if (padded) {
    if (padded[1] && padded[1] !== "-") features.case = CASE[padded[1]];
    if (padded[2] && padded[2] !== "-") features.number = NUMBER[padded[2]];
    if (padded[3] && padded[3] !== "-") features.gender = GENDER[padded[3]];
  }

  return features;
}

/** Merge MACULA explicit feature columns over code-derived features. */
export function mergeMorphFeatures(
  fromCode: MorphFeatures,
  columns: Partial<MorphFeatures>,
): MorphFeatures {
  return {
    ...fromCode,
    pos: columns.pos || fromCode.pos,
    person: mapPerson(columns.person) || fromCode.person,
    number: mapLookup(columns.number, NUMBER) || fromCode.number,
    gender: mapLookup(columns.gender, GENDER) || fromCode.gender,
    case: mapLookup(columns.case, CASE) || fromCode.case,
    tense: mapLookup(columns.tense, TENSE) || fromCode.tense,
    voice: mapLookup(columns.voice, VOICE) || fromCode.voice,
    mood: mapLookup(columns.mood, MOOD) || fromCode.mood,
    degree: mapLookup(columns.degree, DEGREE) || fromCode.degree,
    code: columns.code || fromCode.code,
  };
}

function mapLookup(value: string | undefined, table: Record<string, string>): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return table[v] ?? table[v.toLowerCase()] ?? v.toLowerCase();
}

function mapPerson(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "1" || v.startsWith("1") || v.includes("first")) return "1st person";
  if (v === "2" || v.startsWith("2") || v.includes("second")) return "2nd person";
  if (v === "3" || v.startsWith("3") || v.includes("third")) return "3rd person";
  return PERSON[v] ?? value;
}

/**
 * Ordered English labels for UI chips (stable, sentence-case words).
 * Omits empty fields; does not invent interpretation.
 */
export function morphFeatureLabels(morph: MorphFeatures): string[] {
  const order: Array<keyof MorphFeatures> = [
    "pos",
    "tense",
    "voice",
    "mood",
    "person",
    "number",
    "gender",
    "case",
    "degree",
  ];
  const out: string[] = [];
  for (const key of order) {
    const v = morph[key];
    if (typeof v === "string" && v.length > 0 && key !== "code") {
      out.push(v);
    }
  }
  return out;
}
