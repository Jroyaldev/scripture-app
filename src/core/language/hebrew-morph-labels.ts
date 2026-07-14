/**
 * Expand OSHB / Westminster-style Hebrew morph codes into English chips.
 * Deterministic tables only — not contextual interpretation.
 *
 * Codes look like: HR/Ncfsa, HVqp3ms, HC/Td/Ncbsa
 * Leading H = Hebrew (vs A Aramaic). Segments after that are separated by /.
 *
 * Spec: http://openscriptures.github.io/morphhb/parsing/HebrewMorphologyCodes.html
 */

import type { MorphFeatures } from "./types.js";

const POS: Record<string, string> = {
  A: "adjective",
  C: "conjunction",
  D: "adverb",
  N: "noun",
  P: "pronoun",
  R: "preposition",
  S: "suffix",
  T: "particle",
  V: "verb",
};

const STEM: Record<string, string> = {
  q: "qal",
  N: "niphal",
  p: "piel",
  P: "pual",
  h: "hiphil",
  H: "hophal",
  t: "hithpael",
  o: "polel",
  O: "polal",
  r: "hithpolel",
  m: "poel",
  M: "poal",
  k: "palel",
  K: "pulal",
  Q: "qal passive",
  l: "pilpel",
  L: "polpal",
  f: "hithpalpel",
  D: "nithpael",
  j: "pealal",
  i: "pilel",
  u: "hothpaal",
  c: "tiphil",
  v: "hishtaphel",
  w: "nithpalel",
  y: "nithpoel",
  z: "hithpoel",
};

const VERB_ASPECT: Record<string, string> = {
  p: "perfect",
  q: "sequential perfect",
  i: "imperfect",
  w: "sequential imperfect",
  h: "cohortative",
  j: "jussive",
  v: "imperative",
  r: "participle active",
  s: "participle passive",
  a: "infinitive absolute",
  c: "infinitive construct",
};

const PERSON: Record<string, string> = {
  "1": "1st person",
  "2": "2nd person",
  "3": "3rd person",
};

const GENDER: Record<string, string> = {
  m: "masculine",
  f: "feminine",
  b: "common gender",
  c: "common gender",
};

const NUMBER: Record<string, string> = {
  s: "singular",
  p: "plural",
  d: "dual",
};

const STATE: Record<string, string> = {
  a: "absolute",
  c: "construct",
  d: "determined",
};

const NOUN_TYPE: Record<string, string> = {
  c: "common",
  g: "gentilic",
  p: "proper name",
};

const ADJ_TYPE: Record<string, string> = {
  a: "adjective",
  c: "cardinal number",
  g: "gentilic",
  o: "ordinal number",
};

const PRON_TYPE: Record<string, string> = {
  d: "demonstrative",
  f: "indefinite",
  i: "interrogative",
  p: "personal",
  r: "relative",
};

const PARTICLE_TYPE: Record<string, string> = {
  a: "affirmation",
  d: "definite article",
  e: "exhortation",
  i: "interrogative",
  j: "interjection",
  m: "demonstrative",
  n: "negative",
  o: "object marker",
  r: "relative",
};

/**
 * Parse one OSHB morph code into MorphFeatures + ordered UI labels.
 */
export function parseHebrewMorphCode(code: string | undefined | null): {
  features: MorphFeatures;
  labels: string[];
} {
  if (!code || !code.trim()) return { features: {}, labels: [] };
  const raw = code.trim();
  const features: MorphFeatures = { code: raw };
  const labels: string[] = [];

  // Strip language prefix H (Hebrew) / A (Aramaic)
  let rest = raw;
  if (rest.startsWith("H") || rest.startsWith("A")) {
    if (rest.startsWith("A")) labels.push("aramaic");
    rest = rest.slice(1);
  }

  const segments = rest.split("/").filter(Boolean);
  for (const seg of segments) {
    parseSegment(seg, features, labels);
  }

  return { features, labels: dedupe(labels) };
}

function parseSegment(seg: string, features: MorphFeatures, labels: string[]): void {
  if (!seg) return;
  const pos = seg[0]!;
  const posLabel = POS[pos];
  if (!posLabel) {
    labels.push(seg);
    return;
  }
  if (!features.pos) features.pos = posLabel;
  // Don't repeat "noun" for every noun segment in a compound morph
  if (!labels.includes(posLabel)) labels.push(posLabel);

  const body = seg.slice(1);

  if (pos === "V") {
    // stem + aspect + person + gender + number  e.g. qp3ms, qw3ms, prfsa
    if (body.length >= 1) {
      const stem = STEM[body[0]!];
      if (stem) labels.push(stem);
    }
    if (body.length >= 2) {
      const aspect = VERB_ASPECT[body[1]!];
      if (aspect) {
        labels.push(aspect);
        features.tense = aspect; // rough slot for UI
      }
    }
    // remaining: person gender number for finite; gender number state for participles
    const tail = body.slice(2);
    applyPersonGenderNumber(tail, features, labels);
    return;
  }

  if (pos === "N") {
    // type + gender + number + state  e.g. cfsa, cmpa, cbsc
    if (body[0] && NOUN_TYPE[body[0]]) labels.push(NOUN_TYPE[body[0]]!);
    applyGenderNumberState(body.slice(1), features, labels);
    return;
  }

  if (pos === "A") {
    if (body[0] && ADJ_TYPE[body[0]]) labels.push(ADJ_TYPE[body[0]]!);
    applyGenderNumberState(body.slice(1), features, labels);
    return;
  }

  if (pos === "P") {
    if (body[0] && PRON_TYPE[body[0]]) labels.push(PRON_TYPE[body[0]]!);
    applyPersonGenderNumber(body.slice(1), features, labels);
    return;
  }

  if (pos === "S") {
    labels.push("suffix");
    applyPersonGenderNumber(body, features, labels);
    return;
  }

  if (pos === "T") {
    if (body[0] && PARTICLE_TYPE[body[0]]) labels.push(PARTICLE_TYPE[body[0]]!);
    return;
  }

  if (pos === "R") {
    // d = definite article attached (rare on prep type)
    if (body.includes("d")) labels.push("article");
    return;
  }

  // C conjunction, D adverb — often bare
}

function applyPersonGenderNumber(
  tail: string,
  features: MorphFeatures,
  labels: string[],
): void {
  for (const ch of tail) {
    if (PERSON[ch]) {
      features.person = PERSON[ch];
      labels.push(PERSON[ch]!);
    } else if (GENDER[ch]) {
      features.gender = GENDER[ch];
      labels.push(GENDER[ch]!);
    } else if (NUMBER[ch]) {
      features.number = NUMBER[ch];
      labels.push(NUMBER[ch]!);
    } else if (STATE[ch]) {
      labels.push(STATE[ch]!);
    }
  }
}

function applyGenderNumberState(
  tail: string,
  features: MorphFeatures,
  labels: string[],
): void {
  for (const ch of tail) {
    if (GENDER[ch]) {
      features.gender = GENDER[ch];
      labels.push(GENDER[ch]!);
    } else if (NUMBER[ch]) {
      features.number = NUMBER[ch];
      labels.push(NUMBER[ch]!);
    } else if (STATE[ch]) {
      labels.push(STATE[ch]!);
    }
  }
}

function dedupe(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(l);
  }
  return out;
}

/** Ordered labels for UI (uses parseHebrewMorphCode). */
export function hebrewMorphFeatureLabels(code: string | undefined | null): string[] {
  return parseHebrewMorphCode(code).labels;
}
