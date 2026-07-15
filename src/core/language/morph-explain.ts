/**
 * Pastor-facing explanations of morph codes (Hebrew OSHB + Greek Robinson/MACULA).
 * Explains what the "little codes" mean — not sermon limits or theology.
 *
 * Two layers:
 *   A) labels (from morph-labels / hebrew-morph-labels)
 *   B) label → kind + meaning (this file)
 */

import { parseHebrewMorphCode } from "./hebrew-morph-labels.js";
import { morphFeatureLabels, parseMorphCode } from "./morph-labels.js";

/** Stable kind for chip styling, ordering, and max-visible prioritization. */
export type MorphPartKind =
  | "pos"
  | "stem"
  | "tense"
  | "voice"
  | "mood"
  | "person"
  | "number"
  | "gender"
  | "case"
  | "degree"
  | "state"
  | "other";

export type MorphPartExplain = {
  /** Short label shown as a chip (e.g. "qal", "future"). */
  label: string;
  /** One plain-English sentence for a non-specialist. */
  meaning: string;
  /** Feature family — drives order and chip style. */
  kind: MorphPartKind;
  /** True when meaning is a fallback (uncatalogued label). */
  unknown?: boolean;
};

export type MorphExplanation = {
  code: string;
  language: "hebrew" | "greek" | "unknown";
  /** One-line summary of the form. */
  summary: string;
  /** Ordered parts (POS first …). */
  parts: MorphPartExplain[];
};

/** Display priority for closed-state chip cap (lower = keep longer). */
const KIND_ORDER: MorphPartKind[] = [
  "pos",
  "stem",
  "tense",
  "voice",
  "mood",
  "person",
  "number",
  "gender",
  "case",
  "degree",
  "state",
  "other",
];

const KIND_RANK = Object.fromEntries(KIND_ORDER.map((k, i) => [k, i])) as Record<
  MorphPartKind,
  number
>;

/** Max grammar chips in the closed row (Strong's id is separate). */
export const MORPH_CHIP_VISIBLE_MAX = 5;

const POS_LABELS = new Set([
  "verb",
  "noun",
  "adjective",
  "adverb",
  "preposition",
  "conjunction",
  "pronoun",
  "particle",
  "suffix",
  "article",
  "interjection",
  "personal pronoun",
  "relative pronoun",
  "demonstrative pronoun",
  "interrogative/indefinite pronoun",
  "hebrew word",
  "aramaic word",
  "aramaic",
]);

const STEM_LABELS = new Set([
  "qal",
  "niphal",
  "piel",
  "pual",
  "hiphil",
  "hophal",
  "hithpael",
  "qal passive",
  "polel",
  "polal",
  "hithpolel",
  "poel",
  "poal",
  "palel",
  "pulal",
  "pilpel",
  "polpal",
  "hithpalpel",
  "nithpael",
  "pealal",
  "pilel",
  "hothpaal",
  "tiphil",
  "hishtaphel",
  "nithpalel",
  "nithpoel",
  "hithpoel",
]);

const TENSE_LABELS = new Set([
  "present",
  "imperfect",
  "future",
  "aorist",
  "perfect",
  "pluperfect",
  "sequential perfect",
  "sequential imperfect",
  "cohortative",
  "jussive",
  "participle active",
  "participle passive",
  "infinitive absolute",
  "infinitive construct",
]);

const VOICE_LABELS = new Set(["active", "middle", "passive", "middle or passive"]);

const MOOD_LABELS = new Set([
  "indicative",
  "imperative",
  "subjunctive",
  "optative",
  "infinitive",
  "participle",
]);

const PERSON_LABELS = new Set(["1st person", "2nd person", "3rd person"]);
const NUMBER_LABELS = new Set(["singular", "plural", "dual"]);
const GENDER_LABELS = new Set(["masculine", "feminine", "neuter", "common gender"]);
const CASE_LABELS = new Set([
  "nominative",
  "genitive",
  "dative",
  "accusative",
  "vocative",
]);
const DEGREE_LABELS = new Set(["comparative", "superlative"]);
const STATE_LABELS = new Set([
  "absolute",
  "construct",
  "determined",
  "common",
  "proper name",
  "gentilic",
]);

export function kindForMorphLabel(label: string): MorphPartKind {
  const l = label.trim().toLowerCase();
  if (POS_LABELS.has(l)) return "pos";
  if (STEM_LABELS.has(l)) return "stem";
  if (TENSE_LABELS.has(l)) return "tense";
  if (VOICE_LABELS.has(l)) return "voice";
  if (MOOD_LABELS.has(l)) return "mood";
  if (PERSON_LABELS.has(l)) return "person";
  if (NUMBER_LABELS.has(l)) return "number";
  if (GENDER_LABELS.has(l)) return "gender";
  if (CASE_LABELS.has(l)) return "case";
  if (DEGREE_LABELS.has(l)) return "degree";
  if (STATE_LABELS.has(l)) return "state";
  return "other";
}

/** Sort parts into the canonical closed-row order. */
export function orderMorphParts(parts: MorphPartExplain[]): MorphPartExplain[] {
  return [...parts].sort((a, b) => {
    const ra = KIND_RANK[a.kind] ?? 99;
    const rb = KIND_RANK[b.kind] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Which grammar chips to show closed (max N). Overflow count is parts.length - visible.
 * Prefer dropping lower-priority kinds first (other → degree → gender …) while keeping POS.
 */
export function visibleMorphParts(
  parts: MorphPartExplain[],
  max = MORPH_CHIP_VISIBLE_MAX,
): { visible: MorphPartExplain[]; overflow: number } {
  const ordered = orderMorphParts(parts);
  if (ordered.length <= max) return { visible: ordered, overflow: 0 };
  // Keep highest-priority kinds; drop from the end of the ordered list.
  const visible = ordered.slice(0, max);
  return { visible, overflow: ordered.length - max };
}

const HEBREW_MEANING: Record<string, string> = {
  verb: "This word is a verb — it describes an action or state.",
  noun: "This word is a noun — a person, place, thing, or idea.",
  adjective: "This word is an adjective — it describes a noun.",
  adverb: "This word is an adverb — it describes how or when something happens.",
  preposition: "This word is a preposition — it relates words (in, on, to, from, etc.).",
  conjunction: "This word is a conjunction — it joins clauses or words (and, but, that).",
  pronoun: "This word is a pronoun — it stands in for a person or thing.",
  particle: "This word is a particle — a small grammar word (the, not, object marker, etc.).",
  suffix: "A suffix is attached to the word (often “my/your/his” or a pronoun ending).",
  article: "Includes the definite article (“the”).",
  aramaic: "This form is Aramaic (not Hebrew), used in some OT passages.",

  qal: "Qal is the basic, simplest verb stem (the default form of the action).",
  niphal: "Niphal is often passive or reflexive (“was done” / “did to oneself”).",
  piel: "Piel often intensifies or makes the action more deliberate.",
  pual: "Pual is typically the passive partner of Piel (“was done intensively”).",
  hiphil: "Hiphil is often causative (“caused to…” / “made someone…”).",
  hophal: "Hophal is typically the passive of Hiphil (“was caused to…”).",
  hithpael: "Hithpael is often reflexive or reciprocal (“did to oneself” / “among themselves”).",
  "qal passive": "Qal passive marks the simple action as received rather than done.",
  polel: "Polel is a less common stem, often intensive or iterative.",
  polal: "Polal is typically the passive partner of Polel.",
  hithpolel: "Hithpolel is often reflexive of a Polel-type action.",
  poel: "Poel is a less common intensive or iterative stem.",
  poal: "Poal is typically the passive partner of Poel.",
  palel: "Palel is a rare intensive stem form.",
  pulal: "Pulal is typically the passive of Palel.",
  pilpel: "Pilpel often reduplicates the root for intensity or repetition.",
  polpal: "Polpal is a rare reduplicated passive-type stem.",
  hithpalpel: "Hithpalpel is often reflexive of a reduplicated stem.",
  nithpael: "Nithpael is a rare stem, often passive or reflexive in force.",
  pealal: "Pealal is a rare stem form (mostly late or specialized).",
  pilel: "Pilel is a rare intensive stem form.",
  hothpaal: "Hothpaal is a rare passive/reflexive stem form.",
  tiphil: "Tiphil is a rare causative-type stem.",
  hishtaphel: "Hishtaphel is a rare stem (e.g. some “bow down” forms).",
  nithpalel: "Nithpalel is a rare stem form.",
  nithpoel: "Nithpoel is a rare stem form.",
  hithpoel: "Hithpoel is a rare reflexive-type stem.",

  perfect:
    "Hebrew perfect often presents the action as a whole or complete (not automatically “past tense”).",
  "sequential perfect":
    "Sequential perfect (waw-consecutive perfect) often carries the story forward after an imperfect.",
  imperfect:
    "Hebrew imperfect often presents the action as open, ongoing, or incomplete (not automatically “future”).",
  "sequential imperfect":
    "Sequential imperfect (waw-consecutive) is very common in narrative: “and he did…”.",
  cohortative: "Cohortative is a first-person wish or resolve (“let me…” / “I will…”).",
  jussive: "Jussive is a third-person wish or soft command (“let him…” / “may it…”).",
  imperative: "Imperative is a direct command (“do this”).",
  "participle active": "Active participle often means ongoing action or the one who does the action.",
  "participle passive": "Passive participle often means a state resulting from an action (“written,” “blessed”).",
  "infinitive absolute": "Infinitive absolute often stresses or intensifies the idea of the verb.",
  "infinitive construct": "Infinitive construct is a verbal noun (“to do,” “doing,” “when doing”).",

  "1st person": "First person: the speaker (“I” / “we”).",
  "2nd person": "Second person: the one spoken to (“you”).",
  "3rd person": "Third person: someone spoken about (“he/she/they”).",
  masculine: "Masculine grammatical gender (not always about male people).",
  feminine: "Feminine grammatical gender (not always about female people).",
  "common gender": "Common gender: not specifically masculine or feminine in this form.",
  singular: "Singular: one.",
  plural: "Plural: more than one.",
  dual: "Dual: a pair (often body parts or natural pairs).",
  absolute: "Absolute state: the normal, freestanding form of a noun.",
  construct: "Construct state: “of” relationship (X of Y), tightly bound to the next word.",
  determined: "Determined: marked as definite (often with the article).",
  common: "Common noun (not a proper name).",
  "proper name": "Proper name (person, place, or titled entity).",
  gentilic: "Gentilic: names a people group (e.g. “Moabite”).",
};

const GREEK_MEANING: Record<string, string> = {
  verb: "This word is a verb — it describes an action or state.",
  noun: "This word is a noun — a person, place, thing, or idea.",
  adjective: "This word is an adjective — it describes a noun.",
  adverb: "This word is an adverb — it describes how or when something happens.",
  preposition: "This word is a preposition — it relates words (in, on, to, from, etc.).",
  conjunction: "This word is a conjunction — it joins clauses or words.",
  particle: "This word is a particle — a small grammar word.",
  article: "Definite article (“the”).",
  "personal pronoun": "Personal pronoun (I, you, he, she, we, they).",
  "relative pronoun": "Relative pronoun (“who,” “which,” “that”).",
  "demonstrative pronoun": "Demonstrative pronoun (“this,” “that,” “these,” “those”).",
  "interrogative/indefinite pronoun": "Interrogative or indefinite pronoun (“who?” / “someone”).",
  interjection: "Interjection — an exclamation.",
  "hebrew word": "This token is tagged as a Hebrew word in the Greek text stream.",
  "aramaic word": "This token is tagged as an Aramaic word in the Greek text stream.",

  present: "Present: the action is portrayed as ongoing or current (in context).",
  imperfect: "Imperfect: past action portrayed as ongoing or repeated.",
  future: "Future: the action is portrayed as yet to happen.",
  aorist: "Aorist: the action is often presented as a simple whole (not “once for all” by itself).",
  perfect: "Perfect: completed action with a result still in view.",
  pluperfect: "Pluperfect: completed action that was already finished before another past point.",

  active: "Active voice: the subject does the action.",
  middle: "Middle voice: the subject is involved in or affected by the action.",
  passive: "Passive voice: the subject receives the action.",
  "middle or passive": "Middle or passive: form does not clearly separate middle vs passive.",

  indicative: "Indicative mood: presents the action as a statement of fact (from the author’s viewpoint).",
  imperative: "Imperative mood: a command or strong request.",
  subjunctive: "Subjunctive mood: often possibility, purpose, or contingency.",
  optative: "Optative mood: often a wish or more remote possibility.",
  infinitive: "Infinitive: verbal noun (“to do,” “doing”).",
  participle: "Participle: verbal adjective (“doing,” “having done”).",

  "1st person": "First person: the speaker (“I” / “we”).",
  "2nd person": "Second person: the one spoken to (“you”).",
  "3rd person": "Third person: someone spoken about (“he/she/they”).",
  singular: "Singular: one.",
  plural: "Plural: more than one.",
  dual: "Dual: a pair (rare in NT Greek).",
  masculine: "Masculine grammatical gender.",
  feminine: "Feminine grammatical gender.",
  neuter: "Neuter grammatical gender.",
  nominative: "Nominative case: usually the subject of the clause.",
  genitive: "Genitive case: often “of,” possession, or relationship.",
  dative: "Dative case: often “to/for,” means, or location in a broad sense.",
  accusative: "Accusative case: usually the direct object.",
  vocative: "Vocative case: direct address (“O…!”).",
  comparative: "Comparative degree (“greater,” “more…”).",
  superlative: "Superlative degree (“greatest,” “most…”).",
};

/**
 * Explain a morph code in pastor-friendly English.
 */
export function explainMorphCode(
  code: string | undefined | null,
  hints?: { language?: "grc" | "hbo" | "other"; labels?: string[] },
): MorphExplanation | null {
  const raw = code?.trim() ?? "";

  const isHebrew =
    hints?.language === "hbo" ||
    /^[HA][A-Z]/.test(raw) ||
    (raw.includes("/") && /^[HA]/.test(raw));

  if (isHebrew) {
    const { labels } = parseHebrewMorphCode(raw || undefined);
    const use = hints?.labels?.length ? hints.labels : labels;
    if (!use.length && !raw) return null;
    const parts = orderMorphParts(labelsToParts(use, HEBREW_MEANING));
    return {
      code: raw,
      language: "hebrew",
      summary: summarize(parts, "Hebrew form"),
      parts,
    };
  }

  // Greek Robinson / MorphGNT style — prefer explicit labels when provided
  // (MACULA feature columns are richer than code-parse for edge codes).
  let labels = hints?.labels ?? [];
  if (!labels.length && raw) {
    const features = parseMorphCode(raw);
    labels = morphFeatureLabels(features);
  }
  if (!labels.length && !raw) return null;
  const parts = orderMorphParts(labelsToParts(labels, GREEK_MEANING));
  return {
    code: raw,
    language: "greek",
    summary: summarize(parts, "Greek form"),
    parts,
  };
}

function labelsToParts(
  labels: string[],
  table: Record<string, string>,
): MorphPartExplain[] {
  const parts: MorphPartExplain[] = [];
  const seen = new Set<string>();
  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = kindForMorphLabel(label);
    const known = table[label] ?? table[key];
    if (known) {
      parts.push({ label, meaning: known, kind });
    } else {
      parts.push({
        label,
        meaning: `Tagged “${label}” in the source morphology.`,
        kind,
        unknown: true,
      });
    }
  }
  return parts;
}

function summarize(parts: MorphPartExplain[], fallback: string): string {
  if (parts.length === 0) return fallback;
  return parts.map((p) => p.label).join(" · ");
}
