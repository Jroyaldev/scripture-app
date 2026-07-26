/**
 * People and place PROSE from three separately attributed sources, with a
 * granularity guard that makes the obvious mistake impossible.
 *
 * ─── The trap, measured on this machine ──────────────────────────────────────
 *
 * unfoldingWord translationWords is keyed by NAME. TIPNR is keyed by PERSON.
 * Joining them on the name is a category error at scale, and the numbers say so:
 *
 *   355 tW `bible/names` entries; 306 match a TIPNR displayName; those 306 hit
 *   685 DISTINCT TIPNR entities; 124 tW entries map to MORE THAN ONE entity;
 *   only 182 map 1:1. "azariah" alone covers 19 TIPNR persons, "shimei" 16,
 *   "hananiah" 15, "joel" 14.
 *
 * So a naive join attaches one paragraph to nineteen different people and is
 * wrong about eighteen of them. tW knows this about itself — `azariah.md` opens
 * "Azariah was the name of several men in the Old Testament."
 *
 * And the Strong's number cannot rescue it. All nineteen Azariahs carry
 * baseStrong H5838, because a Strong's number for a proper noun IS a name-level
 * key. Measured: adding the tW `Word Data` Strong's set to the join
 * disambiguates 8 of the 124 ambiguous names and leaves 116 ambiguous. There is
 * no key in translationWords that reaches an individual.
 *
 * ISBE is the one source that has the missing hook. It numbers homonymous
 * headwords in-place — AZARIAH runs `(1)` … `(23)`, each sub-entry anchored to a
 * verse — so a sub-entry can be bound to a specific TIPNR person BY REFERENCE.
 * Measured yield: 1,526 roster segments over 399 headwords, of which 1,160 bind
 * to exactly one TIPNR person (1,134 distinct persons, 375 names).
 *
 * ─── What this module therefore refuses to do ────────────────────────────────
 *
 * `ProseRecord` is a discriminated union, not a struct with a flag. A record is
 * either `granularity: "name"` — and then it carries the full list of entities
 * it covers and a `scopeLabel` that says so out loud — or `granularity:
 * "person"`, and then it carries the EVIDENCE that entitled the binding. There
 * is no third state and no way to relabel one as the other: `scopeProse` is the
 * only constructor, and `individualProse` is the only accessor that yields a
 * person-scoped record, and it throws `ProseGranularityError` on a name-scoped
 * one. A render site that wants to print "this person's story" has to call it,
 * and for Azariah it will throw rather than lie.
 *
 * Pure TypeScript (INV-18): no I/O, no Node imports, no host globals. Node-side
 * acquisition lives in `scripts/import-people-prose.ts`.
 */

import { canonicalStrongsKey } from "../language/strongs-key.js";

// ────────────────────────────────────────────────────────────────────────────
// Sources and attribution
// ────────────────────────────────────────────────────────────────────────────

/** The three corpora this module knows how to read. One file each on disk. */
export type ProseSourceId = "unfoldingword-tw" | "hitchcock" | "isbe";

/**
 * What granularity the SOURCE ITSELF can support — not what we would like.
 *
 * - `name-only`: the source writes about the name. Hitchcock is an etymology
 *   dictionary; "Aaron — a teacher; lofty; mountain of strength" is a fact about
 *   the word, and it is equally true of every bearer. Such a source can NEVER
 *   produce a person-scoped record, even for a name with a single bearer,
 *   because binding it would misrepresent what kind of claim it is.
 * - `name-and-individual`: the source's entries are about people, so a record
 *   may be person-scoped when the evidence supports it.
 */
export type SourceGranularity = "name-only" | "name-and-individual";

/**
 * Everything a render site needs to name a source and let a reader weight it.
 *
 * `date` is mandatory and visible by contract: "ISBE, 1915" tells a reader this
 * is pre-WWI scholarship, and "unfoldingWord, 2026" tells them it is not. A
 * block whose date cannot be stated does not render.
 */
export type ProseSourceAttribution = {
  sourceId: ProseSourceId;
  /** Corpus name as it is credited. */
  name: string;
  /** Short kicker for the provenance mark. */
  siglum: string;
  /** Visible date. Never empty. */
  date: string;
  /** How `date` was arrived at, so nothing is silently invented. */
  dateBasis: string;
  license: string;
  licenseUrl: string | null;
  /**
   * The attribution string required by the source, VERBATIM. For a public
   * domain source nothing is legally required; the string is then what the
   * source says about itself, and `attributionRequired` is false.
   */
  attributionText: string;
  attributionRequired: boolean;
  homeUrl: string | null;
  /**
   * Licence riders and conditions found in the source, quoted verbatim. A
   * blanket licence label at the top of a file does not mean there is no rider
   * further down.
   */
  riders: readonly string[];
  /**
   * True when the prose text we redistribute is byte-verbatim from the source.
   * CC BY-SA's trademark clause turns on exactly this.
   */
  proseUnmodified: boolean;
  /** Changes we made, for licences that require declaring them. */
  changes: readonly string[];
  granularity: SourceGranularity;
};

/**
 * unfoldingWord's LICENSE.md, quoted verbatim. Both paragraphs matter and they
 * point in opposite directions, so neither may be paraphrased: the first says an
 * UNMODIFIED copy must KEEP the trademark, the second says a MODIFIED copy must
 * REMOVE it, declare the changes, and use a different attribution string.
 */
export const UNFOLDINGWORD_TRADEMARK_RIDER =
  "unfoldingWord® is a registered trademark of unfoldingWord. Use of the unfoldingWord name or logo requires the written permission of unfoldingWord. Under the terms of the CC BY-SA license, you may copy and redistribute this unmodified work as long as you keep the unfoldingWord® trademark intact. If you modify a copy or translate this work, thereby creating a derivative work, you must remove the unfoldingWord® trademark.";

/** unfoldingWord's LICENSE.md, derivative-work paragraph, verbatim. */
export const UNFOLDINGWORD_DERIVATIVE_RIDER =
  "On the derivative work, you must indicate what changes you have made and attribute the work as follows: “The original work by unfoldingWord is available from [unfoldingword.org/utw](https://www.unfoldingword.org/utw)”. You must also make your derivative work available under the same license (CC BY-SA).";

/** The required attribution string itself, lifted verbatim out of that rider. */
export const UNFOLDINGWORD_ATTRIBUTION =
  "The original work by unfoldingWord is available from unfoldingword.org/utw";

/** Hitchcock's Sword module `About` field, verbatim, minus `\\par` breaks. */
export const HITCHCOCK_ABOUT =
  "HITCHCOCK'S BIBLE NAMES DICTIONARY This dictionary is from \"Hitchcock's New and Complete Analysis of the Holy Bible,\" published in the late 1800s. It contains well over 2,500 Bible and Bible-related proper names and their meanings which you can search using a word processor. Some Hebrew words of uncertain meaning have been left out. It is out of copyright, so feel free to copy and distribute it. I pray it will help in your study of God's Word. -- BRH";

/** ISBE's Sword module `About` field, verbatim, minus `\\par` breaks. */
export const ISBE_ABOUT =
  "THE INTERNATIONAL STANDARD BIBLE ENCYCLOPEDIA James Orr, M.A., D.D. General Editor John L. Nuelsen, D.D., LL.D. Edgar Y. Mullins, D.D., LL.D. Assistant Editors Morris O. Evans, D.D., PhD. Managing Editor Melvin Grove Kyle, D.D., JJ.D. Revising Editor 1844-1913 ed.";

/**
 * The registry. Three rows, three files, three separate attributions. Nothing
 * in this module ever writes prose from two of them into one field — the
 * artefacts are one file per source and the record carries its `sourceId`.
 */
export const PROSE_SOURCES: Readonly<Record<ProseSourceId, ProseSourceAttribution>> = {
  "unfoldingword-tw": {
    sourceId: "unfoldingword-tw",
    name: "unfoldingWord® Translation Words",
    siglum: "UW TW",
    date: "2026",
    dateBasis:
      'manifest.yaml `dublin_core.issued` and `.modified` both read "2026-06-24"; `version` is "89". Measured, not inferred.',
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attributionText: UNFOLDINGWORD_ATTRIBUTION,
    attributionRequired: true,
    homeUrl: "https://www.unfoldingword.org/utw",
    riders: [UNFOLDINGWORD_TRADEMARK_RIDER, UNFOLDINGWORD_DERIVATIVE_RIDER],
    proseUnmodified: true,
    changes: [
      "Selected bible/names (355 files) and, separately, the 13 bible/kt files whose name matches a TIPNR entity; bible/other was not imported.",
      "Split each file at its markdown headings into definition / crossLinks / bibleReferences / wordData without altering the text inside any of them.",
      "Added a granularity scope and, where one bearer exists, a TIPNR entity id. No source sentence was edited, reflowed, or joined to another source.",
    ],
    granularity: "name-and-individual",
  },
  hitchcock: {
    sourceId: "hitchcock",
    name: "Hitchcock's Bible Names Dictionary",
    siglum: "HITCHCOCK",
    date: "1874",
    dateBasis:
      'INFERRED. The Sword module says only "published in the late 1800s" and gives no year; 1874 is the usual date given for Roswell D. Hitchcock\'s "New and Complete Analysis of the Holy Bible". The module\'s own words are kept verbatim in `about` so a reader can see we supplied the year.',
    license: "Public Domain",
    licenseUrl: null,
    attributionText:
      "Hitchcock's Bible Names Dictionary, from \"Hitchcock's New and Complete Analysis of the Holy Bible\" (late 1800s). Public domain. CrossWire Sword module \"Hitchcock\" version 2.0, text source CCEL.",
    attributionRequired: false,
    homeUrl: "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Hitchcock",
    riders: [
      "It is out of copyright, so feel free to copy and distribute it.",
      'Some Hebrew words of uncertain meaning have been left out. (Sword `About`: the dictionary is not a complete name inventory, so a missing name is not a data defect.)',
    ],
    proseUnmodified: true,
    changes: [
      "Read the published CrossWire Sword module with CrossWire's own mod2imp; kept each <def> string byte-verbatim.",
      "Recovered 7 secondary headwords that the module fused into another entry's body and that no key lookup could reach.",
      "Stripped one record's trailing editorial filler (\"There are no entries for W.\" etc. under VOPHSI), which is not part of any name's etymology.",
    ],
    granularity: "name-only",
  },
  isbe: {
    sourceId: "isbe",
    name: "International Standard Bible Encyclopedia",
    siglum: "ISBE",
    date: "1915",
    dateBasis:
      'INFERRED for the year, from the first edition\'s publication date, which is what the scholarship cites. The Sword module\'s own About field instead reads "1844-1913 ed."; those are General Editor James Orr\'s life dates, not an edition, and the module\'s literal string is kept verbatim in `about` rather than shown to a reader as a date.',
    license: "Public Domain",
    licenseUrl: null,
    attributionText:
      "International Standard Bible Encyclopedia (1915), James Orr, General Editor. Public domain. CrossWire Sword module \"ISBE\" version 2.2 (2009-09-07).",
    attributionRequired: false,
    homeUrl: "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=ISBE",
    riders: [
      'Sword conf History_2.2: "corrected an OCR error, numerous minor layout improvements" — the module is an OCR-derived text that has been proofread, not a keyed transcription. Treat a surprising spelling as possible OCR residue.',
      'Sword conf History_2.0: "updated crossreferencing, converted to TEI" — the TEI markup and the <ref> apparatus are the module maintainers\' work, not the 1915 book\'s.',
    ],
    proseUnmodified: true,
    changes: [
      "Read the published CrossWire Sword module with CrossWire's own mod2imp; kept each entry's TEI body byte-verbatim.",
      "Imported only the 2,591 entries whose headword or a semicolon-separated spelling variant matches a TIPNR entity name; the remaining 6,789 topical articles were not imported.",
      "Segmented homonym rosters at their own (N) paragraph markers and, where one TIPNR person's references matched, recorded that binding alongside the verbatim paragraph.",
    ],
    granularity: "name-and-individual",
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Name key
// ────────────────────────────────────────────────────────────────────────────

/**
 * The join key for a name, across all three sources and TIPNR.
 *
 * Lower case, and every character that is not `a-z0-9` removed. Chosen because
 * it is the form that reproduces the orchestrator's measurement exactly:
 * against TIPNR displayNames it gives 306 matched / 685 covered entities /
 * 124 ambiguous / 182 one-to-one, where plain lower-casing gives
 * 300 / 677 / 123 / 177. The six extra matches are names the three sources
 * punctuate differently — tW writes `abelbethmaacah`, TIPNR writes
 * `Abel-beth-maachah`, ISBE writes `ABEL-BETH-MAACAH`.
 *
 * This is deliberately lossy and is a LOOKUP key only. Display always uses the
 * source's own spelling, which every record carries in `block.headword`.
 */
export function proseNameKey(raw: string): string {
  return raw.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ────────────────────────────────────────────────────────────────────────────
// unfoldingWord Strong's numbers — a different padding from everyone else
// ────────────────────────────────────────────────────────────────────────────

/**
 * unfoldingWord's `Word Data` Strong's forms, measured over all 953 files of
 * `bible/{names,kt,other}` (7,098 tokens, 4,727 distinct):
 *
 *   Hebrew  `H` + exactly 4 digits, zero-padded.   2,768 distinct, always 4.
 *   Greek   `G` + exactly 5 digits.                1,959 distinct, always 5.
 *
 * The Greek form is NOT a 5-wide zero-pad. It is a 4-wide zero-padded Strong's
 * number followed by a 1-digit variant index: `G00020` is G2 (Ἀαρών), not G20.
 * Proof by resolution against the shipped `strongs-plus.json`: reading the first
 * four digits resolves 1,950 of 1,959 distinct tokens; reading all five as one
 * integer resolves 178. The nine remaining are extended numbers above Strong's
 * 5624 (G5910, G6020, G6035, G6041, G6048, G6050, G6066, G8590, G8630) and have
 * no Strong's entry by definition. The variant digit is `0` on 1,956 tokens and
 * `5` on three — G43195 in `other/beg.md`, G36095 in `other/household.md`,
 * G48525 in `other/profit.md` — and the bases G4319 "beg" and G3609
 * "(those) of the … house(-hold)" match those filenames, which is what settles
 * the reading.
 *
 * WHY THIS FUNCTION EXISTS RATHER THAN A CALL TO THE SHARED MODULE:
 * `canonicalStrongsKey("G00020")` returns `"G20"` and
 * `canonicalStrongsKey("G16480")` returns `"G16480"`. Both are silently wrong
 * for this corpus, because the shared parser has no way to know a trailing digit
 * is a variant index. Hebrew is safe there (`H0175` → `H175`). So the shared
 * module is used to CHECK the answer, never to produce it: this function
 * computes the base and then asserts the shared parser agrees on the already
 * unpadded form.
 */
export type UnfoldingWordStrongs = {
  /** Exactly as written in the file, e.g. `G00020`, `H0175`. */
  raw: string;
  /** Canonical unpadded base, agreeing with `canonicalStrongsKey`: `G2`, `H175`. */
  base: string;
  /** Greek only: the 5th digit. `0` means "no variant". */
  variant: string | null;
  testament: "H" | "G";
};

export function parseUnfoldingWordStrongs(raw: string): UnfoldingWordStrongs | null {
  const token = raw.trim();
  const hebrew = /^H(\d{4})$/.exec(token);
  if (hebrew) {
    const base = `H${Number(hebrew[1])}`;
    if (canonicalStrongsKey(base) !== base) return null;
    return { raw: token, base, variant: null, testament: "H" };
  }
  const greek = /^G(\d{4})(\d)$/.exec(token);
  if (greek) {
    const base = `G${Number(greek[1])}`;
    if (canonicalStrongsKey(base) !== base) return null;
    return { raw: token, base, variant: greek[2]!, testament: "G" };
  }
  return null;
}

/** Every Strong's token in a `## Word Data:` section, in file order. */
export function parseUnfoldingWordWordData(section: string): {
  parsed: UnfoldingWordStrongs[];
  unparsed: string[];
} {
  const parsed: UnfoldingWordStrongs[] = [];
  const unparsed: string[] = [];
  for (const token of section.match(/\b[HG]\d+[A-Za-z]*\b/g) ?? []) {
    const hit = parseUnfoldingWordStrongs(token);
    if (hit) parsed.push(hit);
    else unparsed.push(token);
  }
  return { parsed, unparsed };
}

// ────────────────────────────────────────────────────────────────────────────
// The granularity model
// ────────────────────────────────────────────────────────────────────────────

/** A block of prose exactly as its source wrote it. Never merged, never mixed. */
export type ProseBlock = {
  sourceId: ProseSourceId;
  /** How `text` is marked up, so a render site never guesses. */
  format: "markdown" | "plaintext" | "tei";
  /** Verbatim source text. */
  text: string;
  /** Stable id inside the source: tW filename, Sword key, Sword key + ordinal. */
  sourceEntryId: string;
  /** Headword as the SOURCE spells it. Display uses this, never the name key. */
  headword: string;
};

/** A TIPNR entity that bears a name. Everything the guard needs, nothing more. */
export type NameBearer = {
  entityId: string;
  kind: "person" | "place" | "other";
  displayName: string;
  refs: readonly string[];
};

/** Why we are entitled to say a block is about ONE individual. */
export type PersonBinding =
  | {
      kind: "sole-bearer";
      /** Always 1. Present so a reader of the artefact can check the claim. */
      bearerCount: 1;
    }
  | {
      kind: "isbe-subentry-reference";
      /** The `(N)` the source itself printed. */
      ordinal: number;
      /** References in that sub-entry that landed on exactly this entity. */
      evidenceRefs: readonly string[];
      /** How many entities bore the name. >1 is the interesting case. */
      bearerCount: number;
    };

/**
 * Prose about a NAME. Carries the entities it covers, so the count cannot be
 * lost, and a `scopeLabel` computed from that list, so a render site cannot
 * print the prose without printing the caveat.
 */
export type NameScopedProse = {
  granularity: "name";
  nameKey: string;
  /** The source's own spelling of the name. */
  displayTerm: string;
  /** Every TIPNR entity bearing this name. May be empty (name not in TIPNR). */
  coversEntityIds: readonly string[];
  /** e.g. "Shared by 19 people named Azariah". Never says "this person". */
  scopeLabel: string;
  /** Present when we tried to bind to an individual and could not. */
  unboundReason?: ProseUnboundReason;
  block: ProseBlock;
};

/** Prose about ONE individual, with the evidence that permitted the binding. */
export type PersonScopedProse = {
  granularity: "person";
  nameKey: string;
  displayTerm: string;
  entityId: string;
  boundBy: PersonBinding;
  block: ProseBlock;
};

export type ProseRecord = NameScopedProse | PersonScopedProse;

export type ProseUnboundReason =
  /** The source is an etymology of the name; there is no individual to bind. */
  | "source-is-name-level"
  /** This particular block covers the whole name, e.g. a whole ISBE article. */
  | "block-is-name-level"
  /** More than one TIPNR entity bears the name and the source gave no hook. */
  | "many-bearers-no-hook"
  /** The `(N)` marker covered several individuals, e.g. "(10 and 11)". */
  | "marker-covers-many-individuals"
  /** The sub-entry cited no verse we could parse. */
  | "no-reference-evidence"
  /** Its verses matched no bearer of this name. */
  | "reference-matches-no-bearer"
  /** Its verses matched more than one bearer. */
  | "reference-matches-many-bearers"
  /**
   * Two or more numbered sub-entries of the same article bound to the SAME
   * TIPNR entity. The source treats them as different individuals, so at most
   * one binding can be right and nothing in the data says which.
   */
  | "many-subentries-bind-to-same-bearer"
  /** TIPNR does not know this name at all. */
  | "name-not-in-tipnr";

export function isNameScoped(record: ProseRecord): record is NameScopedProse {
  return record.granularity === "name";
}

export function isPersonScoped(record: ProseRecord): record is PersonScopedProse {
  return record.granularity === "person";
}

/**
 * Thrown when name-scoped prose is asked to behave like a biography. This is
 * the whole point of the module: the failure mode we are defending against is
 * not an exception, it is a plausible-looking paragraph on the wrong person's
 * card, so the only safe design is one where the wrong thing throws.
 */
export class ProseGranularityError extends Error {
  readonly code = "prose-granularity";

  constructor(
    readonly record: NameScopedProse,
    context?: string,
  ) {
    const n = record.coversEntityIds.length;
    super(
      `${PROSE_SOURCES[record.block.sourceId].name} prose for "${record.displayTerm}" is scoped to the NAME` +
        ` and covers ${n} TIPNR ${n === 1 ? "entity" : "entities"}; it must not be presented as one individual's account` +
        (context ? ` (${context})` : "") +
        ". Render it under the name with its scopeLabel, or bind it to an individual with evidence first.",
    );
    this.name = "ProseGranularityError";
  }
}

/**
 * The ONLY way to obtain a person-scoped record from a `ProseRecord`. A render
 * site that wants to say "Azariah, son of Ahimaaz, was…" must come through
 * here, and for the tW paragraph on Azariah it throws.
 */
export function individualProse(record: ProseRecord, context?: string): PersonScopedProse {
  if (isPersonScoped(record)) return record;
  throw new ProseGranularityError(record, context);
}

/**
 * The label a name-scoped block must carry. Derived from the bearer list so it
 * cannot drift away from it, and worded so that it is never mistakable for a
 * claim about an individual.
 */
export function formatNameScopeLabel(displayTerm: string, bearers: readonly NameBearer[]): string {
  if (bearers.length === 0) return `About the name ${displayTerm}`;
  if (bearers.length === 1) return `About the name ${displayTerm}`;
  const counts = { person: 0, place: 0, other: 0 };
  for (const bearer of bearers) counts[bearer.kind] += 1;
  const parts: string[] = [];
  if (counts.person) parts.push(`${counts.person} ${counts.person === 1 ? "person" : "people"}`);
  if (counts.place) parts.push(`${counts.place} ${counts.place === 1 ? "place" : "places"}`);
  if (counts.other) parts.push(`${counts.other} other ${counts.other === 1 ? "entry" : "entries"}`);
  return `Shared by ${parts.join(" and ")} named ${displayTerm}`;
}

/** The evidence a source can offer for one individual, if it has any. */
export type IndividualHook = {
  /** The ordinals the source's own marker covered. More than one never binds. */
  ordinals: readonly number[];
  /** Canonical `BOOK.C.V` references cited inside that sub-entry. */
  refs: readonly string[];
};

/**
 * The only constructor for a `ProseRecord`. Everything about the decision is an
 * argument, so the decision is auditable, and every path that cannot prove an
 * individual returns a name-scoped record with a reason rather than guessing.
 */
export function scopeProse(input: {
  block: ProseBlock;
  displayTerm: string;
  bearers: readonly NameBearer[];
  /** Omit for sources that offer no per-individual evidence. */
  individualHook?: IndividualHook;
  /** Override the key derived from `displayTerm` (tW keys on its filename). */
  nameKey?: string;
  /**
   * Declare that THIS block is about the name whatever the bearer count, even
   * though its source can also speak about individuals. An ISBE article on a
   * homonym roster is the case: the article contains every bearer's paragraph,
   * so it is not one person's account even when only one bearer happens to
   * exist. Set it and the sole-bearer shortcut is not taken.
   */
  blockScope?: "name-by-construction";
}): ProseRecord {
  const { block, displayTerm, bearers, individualHook } = input;
  const nameKey = input.nameKey ?? proseNameKey(displayTerm);
  const source = PROSE_SOURCES[block.sourceId];
  const coversEntityIds = bearers.map((bearer) => bearer.entityId);
  const asName = (unboundReason: ProseUnboundReason): NameScopedProse => ({
    granularity: "name",
    nameKey,
    displayTerm,
    coversEntityIds,
    scopeLabel: formatNameScopeLabel(displayTerm, bearers),
    unboundReason,
    block,
  });

  // A name-level source can never bind, no matter how few bearers there are.
  // Hitchcock's "a teacher; lofty; mountain of strength" is a fact about the
  // word Aaron. Binding it to the man would change what kind of claim it is.
  if (source.granularity === "name-only") return asName("source-is-name-level");

  if (bearers.length === 0) return asName("name-not-in-tipnr");

  // A block the caller has declared to be about the name cannot bind, and the
  // reason recorded is the truthful one: it is about the name.
  if (input.blockScope === "name-by-construction") return asName("block-is-name-level");

  if (!individualHook) {
    if (bearers.length === 1) {
      return {
        granularity: "person",
        nameKey,
        displayTerm,
        entityId: bearers[0]!.entityId,
        boundBy: { kind: "sole-bearer", bearerCount: 1 },
        block,
      };
    }
    return asName("many-bearers-no-hook");
  }

  if (individualHook.ordinals.length !== 1) return asName("marker-covers-many-individuals");
  if (individualHook.refs.length === 0) return asName("no-reference-evidence");

  const cited = new Set(individualHook.refs);
  const matches = bearers
    .map((bearer) => ({
      bearer,
      hits: bearer.refs.filter((ref) => cited.has(ref)),
    }))
    .filter((candidate) => candidate.hits.length > 0);

  if (matches.length === 0) return asName("reference-matches-no-bearer");
  if (matches.length > 1) return asName("reference-matches-many-bearers");

  const only = matches[0]!;
  return {
    granularity: "person",
    nameKey,
    displayTerm,
    entityId: only.bearer.entityId,
    boundBy: {
      kind: "isbe-subentry-reference",
      ordinal: individualHook.ordinals[0]!,
      evidenceRefs: only.hits,
      bearerCount: bearers.length,
    },
    block,
  };
}

/** Turn a person-scoped record back into a name-scoped one, with a reason. */
export function demoteToNameScope(
  record: PersonScopedProse,
  bearers: readonly NameBearer[],
  unboundReason: ProseUnboundReason,
): NameScopedProse {
  return {
    granularity: "name",
    nameKey: record.nameKey,
    displayTerm: record.displayTerm,
    coversEntityIds: bearers.map((bearer) => bearer.entityId),
    scopeLabel: formatNameScopeLabel(record.displayTerm, bearers),
    unboundReason,
    block: record.block,
  };
}

/**
 * The trap in the other direction, and it is just as wrong.
 *
 * translationWords knows fewer individuals than TIPNR; ISBE sometimes knows
 * MORE. When ISBE's roster distinguishes two Abijahs and TIPNR carries one, both
 * sub-entries can satisfy the reference test against that one entity — and then
 * two different men's paragraphs both claim to be his. Measured on the shipped
 * data before this pass: 1,387 segments bound but only 1,321 distinct persons,
 * so 66 segments were second claims on an already-claimed person.
 *
 * Since the source's own numbering says they are different people, at most one
 * binding can be right and nothing in the data says which. Both are demoted.
 *
 * Run this over the WHOLE source, not one article at a time. ISBE splits long
 * homonyms across separate module entries (`GAD (1)` … `GAD (4)`, 278 such
 * headwords over 136 bases), so two sub-entries that collide can live in
 * different articles; a per-article pass leaves those behind. Measured: a
 * per-article pass got 1,387 bindings down to 1,267 over 1,266 persons, one
 * collision short.
 */
export function resolveSubEntryCollisions(
  records: readonly ProseRecord[],
  bearersByNameKey: ReadonlyMap<string, readonly NameBearer[]>,
): { records: ProseRecord[]; demoted: number; collidingEntityIds: string[] } {
  const claims = new Map<string, number>();
  for (const record of records) {
    if (!isPersonScoped(record)) continue;
    claims.set(record.entityId, (claims.get(record.entityId) ?? 0) + 1);
  }
  const contested = new Set([...claims].filter(([, n]) => n > 1).map(([id]) => id));
  if (contested.size === 0) return { records: [...records], demoted: 0, collidingEntityIds: [] };
  let demoted = 0;
  const out = records.map((record) => {
    if (!isPersonScoped(record) || !contested.has(record.entityId)) return record;
    demoted += 1;
    return demoteToNameScope(
      record,
      bearersByNameKey.get(record.nameKey) ?? [],
      "many-subentries-bind-to-same-bearer",
    );
  });
  return { records: out, demoted, collidingEntityIds: [...contested] };
}

/**
 * Re-check a finished set of records against the bearer table. This exists
 * because `scopeProse` can only guard the records that went through it, and a
 * hand-edited or hand-merged artefact would not have. Run it over anything that
 * came off disk.
 */
export type ProseGranularityViolation = {
  kind:
    | "person-scoped-without-evidence"
    | "person-scoped-evidence-does-not-hold"
    | "person-scoped-from-name-level-source"
    | "name-scoped-label-disagrees-with-coverage"
    | "name-scoped-coverage-disagrees-with-bearers";
  sourceEntryId: string;
  detail: string;
};

export function auditProseGranularity(
  records: readonly ProseRecord[],
  bearersByNameKey: ReadonlyMap<string, readonly NameBearer[]>,
): ProseGranularityViolation[] {
  const violations: ProseGranularityViolation[] = [];
  for (const record of records) {
    const bearers = bearersByNameKey.get(record.nameKey) ?? [];
    const source = PROSE_SOURCES[record.block.sourceId];
    if (isPersonScoped(record)) {
      if (source.granularity === "name-only") {
        violations.push({
          kind: "person-scoped-from-name-level-source",
          sourceEntryId: record.block.sourceEntryId,
          detail: `${source.name} is declared name-only but produced a person-scoped record for ${record.entityId}`,
        });
        continue;
      }
      const bearer = bearers.find((candidate) => candidate.entityId === record.entityId);
      if (!bearer) {
        violations.push({
          kind: "person-scoped-without-evidence",
          sourceEntryId: record.block.sourceEntryId,
          detail: `${record.entityId} does not bear the name "${record.nameKey}"`,
        });
        continue;
      }
      if (record.boundBy.kind === "sole-bearer") {
        if (bearers.length !== 1) {
          violations.push({
            kind: "person-scoped-evidence-does-not-hold",
            sourceEntryId: record.block.sourceEntryId,
            detail: `claimed sole bearer of "${record.nameKey}" but ${bearers.length} entities bear it`,
          });
        }
        continue;
      }
      const held = record.boundBy.evidenceRefs.filter((ref) => bearer.refs.includes(ref));
      if (held.length === 0 || record.boundBy.evidenceRefs.length === 0) {
        violations.push({
          kind: "person-scoped-evidence-does-not-hold",
          sourceEntryId: record.block.sourceEntryId,
          detail: `none of the evidence references [${record.boundBy.evidenceRefs.join(", ")}] appear in ${record.entityId}`,
        });
      }
      continue;
    }
    if (record.coversEntityIds.length !== bearers.length) {
      violations.push({
        kind: "name-scoped-coverage-disagrees-with-bearers",
        sourceEntryId: record.block.sourceEntryId,
        detail: `record covers ${record.coversEntityIds.length} entities, bearer table has ${bearers.length}`,
      });
    }
    if (record.scopeLabel !== formatNameScopeLabel(record.displayTerm, bearers)) {
      violations.push({
        kind: "name-scoped-label-disagrees-with-coverage",
        sourceEntryId: record.block.sourceEntryId,
        detail: `label "${record.scopeLabel}" is not the label its coverage produces`,
      });
    }
  }
  return violations;
}

// ────────────────────────────────────────────────────────────────────────────
// Source 1 — unfoldingWord translationWords markdown
// ────────────────────────────────────────────────────────────────────────────

/**
 * One `bible/names/*.md` file.
 *
 * Format, measured over all 953 files of `bible/{names,kt,other}`: a level-1
 * heading holding the display term, then level-2 sections. `## Definition:`
 * holds the prose. `(See also: …)` and `(Translation suggestions: …)` are
 * parenthesised lines inside it. `## Bible References:` is a bullet list of
 * `[Label](rc://en/tn/help/bok/cc/vv)` resource links. `## Examples from the
 * Bible stories:` appears on some entries and cites Open Bible Stories, not
 * scripture. `## Word Data:` is last and is present on 953 of 953 files.
 *
 * Every string here is a verbatim slice. Nothing is rewritten, because the
 * licence's trademark clause turns on the text being unmodified.
 */
export type TranslationWordsEntry = {
  /** File stem, e.g. `azariah`. The source's own stable id. */
  slug: string;
  /** Which directory it came from. */
  collection: "names" | "kt" | "other";
  /** The `# ` heading, verbatim. */
  headword: string;
  /** The `## Definition:` body, verbatim markdown, links intact. */
  definitionMarkdown: string;
  /** `(See also: …)` targets as written, e.g. `../names/babylon.md`. */
  crossLinks: readonly string[];
  /** `## Bible References:` entries as written. */
  bibleReferenceLinks: readonly string[];
  /** `## Word Data:` Strong's tokens. */
  strongs: readonly UnfoldingWordStrongs[];
  /** Tokens in Word Data we could not read. Non-empty is a defect to report. */
  unparsedStrongs: readonly string[];
  /** True when the entry says of itself that the name belonged to several people. */
  selfDeclaredMultiPerson: boolean;
};

const TW_MULTI_PERSON_PHRASES = [
  /\bwas the name of (?:several|two|three|four|five|many|at least)\b/i,
  /\bwere the names? of\b/i,
  /\bthere (?:were|are) (?:several|two|three|four|five|many)\b[^.]{0,40}\bnamed\b/i,
  /\bseveral (?:men|women|people|places|cities|towns)\b[^.]{0,30}\bnamed\b/i,
];

/**
 * Split a translationWords file at its level-2 headings. Done by scanning lines
 * rather than with one regular expression, because the "section runs to the next
 * heading or to end of file" idiom needs `\Z`, which JavaScript does not have,
 * and `$` under `m` silently means end-of-line instead — a rule that fails by
 * returning a truncated definition, not by erroring.
 */
export function translationWordsSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let label: string | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (label !== null) sections.set(label, buffer.join("\n").trim());
  };
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.+?)\s*:?\s*$/.exec(line);
    if (heading) {
      flush();
      label = heading[1]!.trim();
      buffer = [];
      continue;
    }
    if (label !== null) buffer.push(line);
  }
  flush();
  return sections;
}

export function parseTranslationWordsEntry(
  slug: string,
  collection: "names" | "kt" | "other",
  markdown: string,
): TranslationWordsEntry | null {
  const headword = /^#\s+(.+?)\s*$/m.exec(markdown)?.[1];
  if (!headword) return null;

  const sections = translationWordsSections(markdown);
  const definitionMarkdown = sections.get("Definition") ?? "";
  const { parsed, unparsed } = parseUnfoldingWordWordData(sections.get("Word Data") ?? "");

  // `(See also: …)` is one line and its body is full of markdown links, so the
  // closing paren of the line cannot be found by scanning for the first `)`.
  const crossLinks: string[] = [];
  for (const line of definitionMarkdown.split("\n")) {
    if (!/^\(See also:/.test(line.trim())) continue;
    for (const match of line.matchAll(/\]\(([^)]+)\)/g)) crossLinks.push(match[1]!);
  }

  const bibleReferenceLinks: string[] = [];
  for (const match of (sections.get("Bible References") ?? "").matchAll(/\]\(([^)]+)\)/g)) {
    bibleReferenceLinks.push(match[1]!);
  }

  return {
    slug,
    collection,
    headword,
    definitionMarkdown,
    crossLinks,
    bibleReferenceLinks,
    strongs: parsed,
    unparsedStrongs: unparsed,
    selfDeclaredMultiPerson: TW_MULTI_PERSON_PHRASES.some((re) => re.test(definitionMarkdown)),
  };
}

export function translationWordsBlock(entry: TranslationWordsEntry): ProseBlock {
  return {
    sourceId: "unfoldingword-tw",
    format: "markdown",
    text: entry.definitionMarkdown,
    sourceEntryId: `${entry.collection}/${entry.slug}`,
    headword: entry.headword,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Source 2 — Hitchcock, from the CrossWire Sword module
// ────────────────────────────────────────────────────────────────────────────

/**
 * Hitchcock as CrossWire's `mod2imp` dumps it. Records are separated by a line
 * beginning `$$$` carrying the upper-cased lookup key; the body is TEI:
 *
 *   $$$AARON
 *   <entryFree n="Aaron"> <def>a teacher; lofty; mountain of strength</def>
 *    </entryFree>
 *
 * Measured over the whole module: 2,616 records, 2,612 distinct keys, 2,625
 * `<def>` blocks, and exactly four tags in the file — `entryFree`, `def` and
 * their closers — with one attribute, `n`. Mean definition length 22.2
 * characters; the etymology senses are separated by `;`.
 *
 * Three defects are handled rather than absorbed:
 *
 * 1. Four keys are duplicated — ABEL, ELI, NOAH, RAHAB — carrying genuinely
 *    different etymologies of names that collide in English transliteration
 *    ("a city; mourning" vs "vanity; breath; vapor"). Both are kept, ordinalled.
 * 2. Nine records hold two `<def>` blocks. In seven of them the second belongs
 *    to a DIFFERENT headword that sits as bare text between the two — Aijeleth-
 *    Shahar, Caleb-Ephratah, El-elohe-Israel, Pahath-Moab, Perez-Uzza,
 *    "Phalti Palti", "Shiloh (name of a city)". Those seven names are
 *    unreachable by key lookup in the module as published; they are recovered
 *    here. The other two, AHIHUD and IBNEIAH, really do have two senses.
 * 3. VOPHSI's body trails "There are no entries for W." / "X." / "Y." — an
 *    editorial note that would otherwise become part of Vophsi's etymology.
 */
export type HitchcockEntry = {
  /** The module's own upper-case lookup key, or the recovered headword. */
  key: string;
  /** Headword as spelled for display, from `n=` or from the recovered text. */
  headword: string;
  /** The `<def>` string, verbatim. */
  definition: string;
  /** 1-based position among entries sharing `key`. */
  ordinal: number;
  /** How many entries share `key`. >1 means the English spelling is a homonym. */
  ordinalCount: number;
  /** True when the headword had to be recovered from between two `<def>`s. */
  recoveredHeadword: boolean;
  /** Editorial text dropped from the body, verbatim, so nothing vanishes silently. */
  droppedEditorialText?: string;
};

const HITCHCOCK_EDITORIAL_FILLER = /\s*There are no entries for [A-Z]\.\s*/g;

export function parseHitchcockImp(imp: string): {
  entries: HitchcockEntry[];
  malformedRecords: string[];
} {
  const entries: Omit<HitchcockEntry, "ordinal" | "ordinalCount">[] = [];
  const malformedRecords: string[] = [];

  for (const record of splitImpRecords(imp)) {
    const primaryHeadword = /<entryFree\b[^>]*\bn="([^"]*)"/.exec(record.body)?.[1];
    if (!primaryHeadword) {
      malformedRecords.push(record.key);
      continue;
    }
    const inner = /<entryFree\b[^>]*>([\s\S]*)<\/entryFree>/.exec(record.body)?.[1];
    if (inner === undefined) {
      malformedRecords.push(record.key);
      continue;
    }

    // Walk the body: every <def> belongs to the nearest preceding headword,
    // which is `n=` for the first and bare text for any later one.
    const parts = [...inner.matchAll(/<def>([\s\S]*?)<\/def>/g)];
    if (parts.length === 0) {
      malformedRecords.push(record.key);
      continue;
    }
    let cursor = 0;
    let headword = primaryHeadword;
    let index = 0;
    for (const part of parts) {
      const between = inner.slice(cursor, part.index);
      cursor = part.index + part[0].length;
      let recovered = false;
      if (index > 0) {
        const label = stripHitchcockFiller(between).trim();
        if (label) {
          headword = label;
          recovered = true;
        }
      }
      const definition = part[1]!.trim();
      if (!definition) {
        malformedRecords.push(`${record.key}#${index + 1}`);
        index += 1;
        continue;
      }
      const tail = index === parts.length - 1 ? inner.slice(cursor) : "";
      const dropped = tail.match(HITCHCOCK_EDITORIAL_FILLER)?.join("").trim();
      entries.push({
        key: recovered ? headword.toUpperCase() : record.key,
        headword,
        definition,
        recoveredHeadword: recovered,
        ...(dropped ? { droppedEditorialText: dropped } : {}),
      });
      index += 1;
    }
  }

  const perKey = new Map<string, number>();
  for (const entry of entries) perKey.set(entry.key, (perKey.get(entry.key) ?? 0) + 1);
  const seen = new Map<string, number>();
  const withOrdinals = entries.map((entry) => {
    const n = (seen.get(entry.key) ?? 0) + 1;
    seen.set(entry.key, n);
    return { ...entry, ordinal: n, ordinalCount: perKey.get(entry.key)! };
  });
  return { entries: withOrdinals, malformedRecords };
}

function stripHitchcockFiller(text: string): string {
  return text.replace(HITCHCOCK_EDITORIAL_FILLER, " ");
}

export function hitchcockBlock(entry: HitchcockEntry): ProseBlock {
  return {
    sourceId: "hitchcock",
    format: "plaintext",
    text: entry.definition,
    sourceEntryId: entry.ordinalCount > 1 ? `${entry.key}#${entry.ordinal}` : entry.key,
    headword: entry.headword,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Source 3 — ISBE, from the CrossWire Sword module
// ────────────────────────────────────────────────────────────────────────────

/**
 * ISBE as `mod2imp` dumps it. 9,380 records, one `<entryFree n="…">` each.
 *
 * Complete tag and attribute census of the whole module — there is nothing else
 * in the file, so a sanitiser has a closed list to work from:
 *
 *   <entryFree n="…">          9,380   the entry, `n` is the display headword
 *   <p>…</p>                  66,477   paragraphs; every entry has at least one
 *   <ref osisRef="Bible:…">   93,162   scripture reference
 *   <ref target="ISBE:…">      6,079   cross-reference to another ISBE headword
 *   <hi rend="bold|underline|italic">  1,176 (450 / 370 / 356)
 *   <lb/>                          3
 *
 * XML escapes present: `&gt;` ×12 and `&amp;` ×1. No `&lt;`, no `<a>`, no
 * `javascript:`. `osisRef` uses the 66 canonical OSIS book ids and nothing else;
 * ranges are written `Bible:2Chr.15.1-2Chr.15.8`. `target` is always `ISBE:` +
 * a headword.
 *
 * Two headword conventions matter for lookup:
 *
 * - 278 keys end in `(N)` — `GAD (1)`…`GAD (4)`, `ZECHARIAH (1)`. That is a
 *   headword-level homonym split across 136 bases (135 of them with more than
 *   one part; only BILHAN has a lone `(1)`).
 * - 1,459 keys contain `;` or `,`. Semicolon separates spelling variants of one
 *   headword and each variant is an alias — `ABIA; ABIAH`. A comma marks an
 *   inverted topical phrase and is NOT an alias — `ABOMINATION, BIRDS OF`.
 *
 * The module's key is the uppercased `n=`; they differ on only 3 of 9,380
 * records, all case-only (`BILL, BOND, etc.`, `JUNIAS; JUNlA`, `MAINSAlL`).
 * Display therefore uses `n=`.
 */
export type IsbeEntry = {
  /** The module's own lookup key, verbatim. */
  key: string;
  /** `n=` — the display headword. */
  headword: string;
  /** The `<entryFree>` inner body, verbatim TEI. */
  teiBody: string;
  /** `(N)` stripped off the key, if the key carried one. */
  headwordOrdinal: number | null;
  /** Lookup aliases: the key minus `(N)`, split on `;`. Never split on `,`. */
  aliases: readonly string[];
  /** `BOOK.C.V` references anywhere in the entry. */
  refs: readonly string[];
  /** `ISBE:` cross-reference targets. */
  crossRefs: readonly string[];
};

/** One `(N)` paragraph of a homonym roster. */
export type IsbeRosterSegment = {
  /** Ordinals the marker covered. `(10 and 11)` gives [10, 11]. */
  ordinals: readonly number[];
  /** The marker as printed, e.g. `10 and 11`. */
  markerText: string;
  /** The `<p>` element, verbatim TEI. */
  teiParagraph: string;
  /** `BOOK.C.V` references inside this paragraph only. */
  refs: readonly string[];
};

export function parseIsbeImp(imp: string, osisToCanonical: OsisResolver): {
  entries: IsbeEntry[];
  malformedRecords: string[];
} {
  const entries: IsbeEntry[] = [];
  const malformedRecords: string[] = [];
  for (const record of splitImpRecords(imp)) {
    const headword = /<entryFree\b[^>]*\bn="([^"]*)"/.exec(record.body)?.[1];
    const teiBody = /<entryFree\b[^>]*>([\s\S]*)<\/entryFree>/.exec(record.body)?.[1];
    if (!headword || teiBody === undefined) {
      malformedRecords.push(record.key);
      continue;
    }
    const stripped = record.key.replace(/\s*\((\d+)\)\s*$/, "");
    const ordinalText = /\((\d+)\)\s*$/.exec(record.key)?.[1];
    const aliases = (stripped.includes(";") || !stripped.includes(",")
      ? stripped.split(";")
      : [stripped]
    )
      .map((part) => part.trim())
      .filter(Boolean);
    entries.push({
      key: record.key,
      headword,
      teiBody: teiBody.trim(),
      headwordOrdinal: ordinalText ? Number(ordinalText) : null,
      aliases,
      refs: isbeRefs(teiBody, osisToCanonical),
      crossRefs: [...teiBody.matchAll(/target="ISBE:([^"]*)"/g)].map((m) => m[1]!),
    });
  }
  return { entries, malformedRecords };
}

/**
 * Segment a homonym roster.
 *
 * A candidate segment is a `<p>` whose visible text opens with a parenthesised
 * numeric marker. Measured over the module: 10,986 `<p>` blocks open with a
 * plain `(N)`, 10 with a comma list, 1 with `(N and M)`, 1 with a range; 2,234
 * open with a letter `(a)` and 475 with something non-numeric — those are
 * outline markers, not individuals, and are not segments.
 *
 * `(N)` numbering is NOT exclusively a homonym roster. It is also ordinary
 * outline numbering inside long topical articles: GENEALOGY has 134 numbered
 * paragraphs, JESUS CHRIST 95, GOD 88, SACRIFICE 88. The discriminator used
 * here is that a roster's ordinals form exactly 1…N with no gaps and no
 * repeats — measured, 1,209 of the 1,612 multi-segment entries have that shape
 * and 403 do not (367 by repeats, 26 by gaps, 10 by not starting at 1). That is
 * still not sufficient on its own: MOABITE STONE (34), THORNS THISTLES ETC.
 * (21), FIRE (16), COMPANY (15), BROTHER (14), WELL (14) all have roster shape
 * and no individuals in them. The sufficient condition is the caller's, and it
 * is a conjunction: roster shape AND the headword names TIPNR entities AND the
 * segment's own references land on exactly one of them. That last test is what
 * actually binds, and it is why "GENEALOGY" and "FIRE" can never bind.
 */
export function segmentIsbeRoster(
  teiBody: string,
  osisToCanonical: OsisResolver,
): { segments: IsbeRosterSegment[]; hasRosterShape: boolean } {
  const segments: IsbeRosterSegment[] = [];
  for (const paragraph of teiBody.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const visible = stripTeiTags(paragraph[1]!).trim();
    const marker = /^\(([^)]{1,24})\)/.exec(visible)?.[1];
    if (!marker) continue;
    const ordinals = parseIsbeOrdinals(marker);
    if (!ordinals) continue;
    segments.push({
      ordinals,
      markerText: marker.trim(),
      teiParagraph: paragraph[0],
      refs: isbeRefs(paragraph[1]!, osisToCanonical),
    });
  }
  const flat = segments.flatMap((segment) => segment.ordinals);
  const hasRosterShape =
    segments.length >= 2 && flat.every((value, index) => value === index + 1);
  return { segments, hasRosterShape };
}

/**
 * Read an ISBE homonym marker. Handles every numeric form the module actually
 * uses: `3`, `10 and 11`, `2, 3`, `4-6`. Returns null for anything else, which
 * includes the letter and roman-numeral outline markers.
 */
export function parseIsbeOrdinals(marker: string): number[] | null {
  const text = marker.trim();
  if (/^\d+$/.test(text)) return [Number(text)];
  const and = /^(\d+)\s+and\s+(\d+)$/i.exec(text);
  if (and) return [Number(and[1]), Number(and[2])];
  if (/^\d+(\s*,\s*\d+)+$/.test(text)) return text.split(",").map((part) => Number(part.trim()));
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(text);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (to < from || to - from > 50) return null;
    const out: number[] = [];
    for (let value = from; value <= to; value += 1) out.push(value);
    return out;
  }
  return null;
}

export function isbeArticleBlock(entry: IsbeEntry): ProseBlock {
  return {
    sourceId: "isbe",
    format: "tei",
    text: entry.teiBody,
    sourceEntryId: entry.key,
    headword: entry.headword,
  };
}

export function isbeSegmentBlock(entry: IsbeEntry, segment: IsbeRosterSegment): ProseBlock {
  return {
    sourceId: "isbe",
    format: "tei",
    text: segment.teiParagraph,
    sourceEntryId: `${entry.key}#${segment.ordinals.join("+")}`,
    headword: entry.headword,
  };
}

/** Remove TEI tags to get the visible text. The tag list is closed and censused. */
export function stripTeiTags(tei: string): string {
  return tei
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Resolve an OSIS verse id to this app's `BOOK.C.V`. Injected rather than
 * imported so this module stays free of the OSHB importer's book table while
 * still using it: `scripts/import-people-prose.ts` passes
 * `parseOsisVerseId` from `src/core/language/oshb-osis.ts`.
 */
export type OsisResolver = (osisId: string) => { book: string; chapter: number; verse: number } | null;

/**
 * Every `BOOK.C.V` an `osisRef` names.
 *
 * A single verse gives one ref. A range gives both endpoints, plus every verse
 * between them when the endpoints share a book and chapter — which is the only
 * case that can be expanded without a versification map. Widening the set can
 * only ever make a binding LESS likely to be unique, so an over-broad range
 * fails safe: it turns a bind into `reference-matches-many-bearers`.
 */
export function isbeRefs(tei: string, resolve: OsisResolver): string[] {
  const out = new Set<string>();
  for (const match of tei.matchAll(/osisRef="([^"]*)"/g)) {
    const value = match[1]!.replace(/^Bible:/, "");
    const endpoints = value
      .split(/[-–]/)
      .map((part) => resolve(part.trim()))
      .filter((parsed): parsed is { book: string; chapter: number; verse: number } => parsed !== null);
    if (endpoints.length === 0) continue;
    for (const endpoint of endpoints) out.add(`${endpoint.book}.${endpoint.chapter}.${endpoint.verse}`);
    if (endpoints.length === 2) {
      const [from, to] = endpoints as [
        { book: string; chapter: number; verse: number },
        { book: string; chapter: number; verse: number },
      ];
      if (from.book === to.book && from.chapter === to.chapter && to.verse >= from.verse) {
        for (let verse = from.verse; verse <= to.verse; verse += 1) {
          out.add(`${from.book}.${from.chapter}.${verse}`);
        }
      }
    }
  }
  return [...out];
}

// ────────────────────────────────────────────────────────────────────────────
// IMP record splitting, shared by the two Sword sources
// ────────────────────────────────────────────────────────────────────────────

/**
 * CrossWire's IMP interchange format: each record starts at a line beginning
 * `$$$` whose remainder is the key, and runs to the next such line.
 */
export function splitImpRecords(imp: string): Array<{ key: string; body: string }> {
  const records: Array<{ key: string; body: string }> = [];
  const lines = imp.split("\n");
  let key: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (key !== null) records.push({ key, body: body.join("\n") });
  };
  for (const line of lines) {
    if (line.startsWith("$$$")) {
      flush();
      key = line.slice(3).trim();
      body = [];
      continue;
    }
    if (key !== null) body.push(line);
  }
  flush();
  return records.filter((record) => record.key.length > 0);
}

// ────────────────────────────────────────────────────────────────────────────
// The artefact on disk
// ────────────────────────────────────────────────────────────────────────────

/**
 * One file per source, so separate attribution is a property of the layout and
 * not of anyone's discipline. There is no field anywhere in this shape that two
 * sources can both write into.
 */
export type PeopleProseArtifact = {
  formatVersion: 1;
  sourceId: ProseSourceId;
  attribution: ProseSourceAttribution;
  provenance: {
    /** Where it came from. */
    upstream: string;
    /** The raw file we ship, relative to the artefact. */
    rawFile: string;
    /** sha256 of that raw file. */
    sourceSha256: string;
    /** Upstream commit, Sword module version, or both. */
    upstreamVersion: string;
    /** sha256 of the intermediate we parsed, when the raw is an archive. */
    intermediateSha256?: string;
    /** Verbatim `About` text from the source, for the record. */
    about?: string;
    retrievedAt: string;
  };
  generatedAt: string;
  /** The TIPNR artefact this was scoped against. A rebuild of TIPNR invalidates it. */
  tipnr: { source: string; license: string; sourceSha256: string; entityCount: number };
  counts: Record<string, number>;
  /** Name-scoped prose. A name may hold more than one block (Hitchcock ABEL). */
  byNameKey: Record<string, NameScopedProse[]>;
  /** Person-scoped prose, keyed by TIPNR entity id. */
  byEntityId: Record<string, PersonScopedProse[]>;
};

/** Build the bearer table the guard needs from a TIPNR index's entities. */
export function bearersByName(
  entities: Readonly<Record<string, { kind: string; displayName: string; refs: readonly string[] }>>,
): Map<string, NameBearer[]> {
  const table = new Map<string, NameBearer[]>();
  for (const [entityId, entity] of Object.entries(entities)) {
    const kind = entity.kind === "person" || entity.kind === "place" ? entity.kind : "other";
    const key = proseNameKey(entity.displayName);
    if (!key) continue;
    const bucket = table.get(key);
    const bearer: NameBearer = { entityId, kind, displayName: entity.displayName, refs: entity.refs };
    if (bucket) bucket.push(bearer);
    else table.set(key, [bearer]);
  }
  for (const bucket of table.values()) bucket.sort((a, b) => a.entityId.localeCompare(b.entityId));
  return table;
}

/** Sort a finished set of records into the artefact's two maps. */
export function collectProseRecords(records: readonly ProseRecord[]): {
  byNameKey: Record<string, NameScopedProse[]>;
  byEntityId: Record<string, PersonScopedProse[]>;
} {
  const byNameKey: Record<string, NameScopedProse[]> = {};
  const byEntityId: Record<string, PersonScopedProse[]> = {};
  for (const record of records) {
    if (isPersonScoped(record)) {
      (byEntityId[record.entityId] ??= []).push(record);
      continue;
    }
    (byNameKey[record.nameKey] ??= []).push(record);
  }
  return { byNameKey, byEntityId };
}

/**
 * Read a whole artefact back as a flat record list, for auditing. Deliberately
 * does not trust the file: the records go straight back through
 * `auditProseGranularity` in the test.
 */
export function artifactRecords(artifact: PeopleProseArtifact): ProseRecord[] {
  return [
    ...Object.values(artifact.byNameKey).flat(),
    ...Object.values(artifact.byEntityId).flat(),
  ];
}
