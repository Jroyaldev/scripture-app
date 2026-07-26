/**
 * UBS semantic dictionaries — SDBH (Hebrew) and SDGNT (Greek New Testament).
 *
 * Pure parsing only. No Node imports (INV-18). Node I/O lives in
 * `scripts/import-ubs-dictionaries.ts`.
 *
 * Source: https://github.com/ubsicap/ubs-open-license, `dictionaries/`.
 * Licence: CC BY-SA 4.0 — see `UBS_SOURCES` for the verbatim attribution
 * strings, which this module treats as data and never paraphrases.
 *
 * ---------------------------------------------------------------------------
 * THE ONE FACT A CALLER MUST KNOW BEFORE USING THE `Domain` FIELDS
 * ---------------------------------------------------------------------------
 * SDGNT and SDBH both encode a semantic domain as a zero-padded digit string,
 * and they are NOT the same namespace.
 *
 *   - SDGNT's 93 top-level domains ARE the Louw-Nida domains, verbatim
 *     (`001` "Geographical Objects and Features" … `093` "Names of Persons
 *     and Places"), two levels deep (93 domains + 645 subdomains), and its
 *     `LEXEntryCode` IS the Louw-Nida reference (`53.89`, `93.4a`, `60.46`).
 *   - SDBH's tree is a different taxonomy with four top-level domains
 *     (`001` "Objects", `002` "Events", `003` "Referents", `004` "Markers"),
 *     up to five levels deep in 3-digit groups (`001002004` "Vegetation").
 *
 * Measured on the shipped files: 18 codes exist in both trees, and on ZERO of
 * them do the labels agree. Code `001002` is "Regions On the Earth" in SDBH
 * and "Regions Above the Earth" in SDGNT — a near-miss that reads as
 * plausible and is wrong. Code `004001` is "Affirmers" in SDBH and "Animals"
 * in SDGNT.
 *
 * Therefore every domain code in this module is carried as a
 * {@link UbsQualifiedDomainCode} — `"louw-nida:053005"`, `"sdbh:001002004"` —
 * and {@link qualifyUbsDomainCode} is the only way to make one. A bare digit
 * string is never a key. This is the same discipline as `strongs-key.ts`:
 * the failure mode is not an error, it is a silent merge.
 *
 * ---------------------------------------------------------------------------
 * WHAT JOINS TO WHAT
 * ---------------------------------------------------------------------------
 * Greek. `macula-greek-tsv.ts:237` already puts `louwNida` on 127,291 of
 * 137,779 tokens and `domain` on 127,292. Those values are SDGNT's own keys:
 * 7,002 of MACULA's 7,009 distinct atomic `louwNida` values are exact SDGNT
 * `LEXEntryCode`s (99.90% of values, 99.51% of occurrences), and 639 of 668
 * distinct MACULA `domain` codes are exact SDGNT `LEXSubDomains` codes. The
 * Greek join needs no key translation at all — see {@link parseLouwNidaCode}.
 *
 * Hebrew. SDBH keys to Strong's, 7,927 of 7,932 entries (99.94%) carrying at
 * least one `StrongCodes` value — but in a shape `strongs-key.ts` does not
 * accept as-is, and with a sense letter that is NOT interchangeable with
 * OSHB's. See {@link parseUbsStrongCode} and the measured numbers on
 * {@link UBS_HEBREW_JOIN}.
 */

import {
  canonicalStrongsKey,
  parseStrongsKey,
  type StrongsKeyResult,
} from "./strongs-key.js";
import { BOOK_CODES, type BookCode } from "../reference/types.js";

/* ========================================================================== *
 * Identity of the two dictionaries
 * ========================================================================== */

/** Which of the two UBS dictionaries a record came from. */
export type UbsDictionaryId = "sdbh" | "sdgnt";

/**
 * Which semantic-domain taxonomy a domain code belongs to.
 *
 * `louw-nida` is spelled out rather than called `sdgnt`, because the tree is
 * literally Louw-Nida's and a reader of the built index should be able to see
 * that without consulting this file.
 */
export type UbsDomainScheme = "sdbh" | "louw-nida";

/**
 * A domain code that carries its taxonomy. Never assemble one by hand —
 * {@link qualifyUbsDomainCode} is the constructor, and it validates.
 */
export type UbsQualifiedDomainCode = `sdbh:${string}` | `louw-nida:${string}`;

export const UBS_DOMAIN_SCHEME_OF: Readonly<Record<UbsDictionaryId, UbsDomainScheme>> = {
  sdbh: "sdbh",
  sdgnt: "louw-nida",
};

/**
 * Verbatim attribution, transcribed byte-for-byte from
 * `ubsicap/ubs-open-license` `README.md` (4,785 b), where each appears
 * parenthesised under its dictionary's heading. The same strings appear
 * again, identically, in `dictionaries/README.md` and in each dictionary's
 * own `README.md`.
 *
 * Two transcription hazards, both verified by codepoint and both preserved
 * here — do not "tidy" them, the licence asks for the notice as supplied:
 *
 *   - The Hebrew string contains a DOUBLE SPACE at offset 65, after
 *     `"© United Bible Societies, 2023."`.
 *   - The Greek string contains a SOFT HYPHEN, U+00AD, inside
 *     `"New Testa­ment"`.
 */
export const UBS_ATTRIBUTION: Readonly<Record<UbsDictionaryId, string>> = {
  sdbh:
    "UBS Dictionary of Biblical Hebrew © United Bible Societies, 2023.  " +
    "Adapted from Semantic Dictionary of Biblical Hebrew © 2000-2023 " +
    "United Bible Societies.",
  sdgnt:
    "UBS Dictionary of New Testament Greek, © United Bible Societies, 2023. " +
    "Adapted from Semantic Dictionary of Biblical Greek: © United Bible " +
    "Societies 2018-2023, which is adapted from Greek-English Lexicon of the " +
    "New Testa­ment: Based on Semantic Domains, Eds. J P Louw, Eugene " +
    "Albert Nida © United Bible Societies 1988, 1989.",
};

/** The licence both dictionaries ship under, as the repo states it. */
export const UBS_LICENSE = "CC BY-SA 4.0" as const;
export const UBS_LICENSE_URL = "http://creativecommons.org/licenses/by-sa/4.0/" as const;
export const UBS_SOURCE_REPO = "https://github.com/ubsicap/ubs-open-license" as const;

/**
 * Licence riders. CC BY-SA is not CC BY: recording these is not optional
 * paperwork, two of them change what a downstream artefact may contain.
 */
export const UBS_LICENSE_RIDERS: readonly string[] = [
  // 1. ShareAlike is the whole difference from the CC BY sources this repo
  //    already carries (TIPNR, TEGMC, TEHMC).
  "ShareAlike: CC BY-SA 4.0 §3(b) requires Adapted Material to be licensed " +
    "under CC BY-SA 4.0 or a Compatible Licence. A generated index derived " +
    "from these files is Adapted Material. Keep UBS-derived fields in their " +
    "own artefact rather than co-mingling them into a file that also carries " +
    "fields derived from a source whose licence forbids BY-SA redistribution " +
    "(e.g. any CC BY-NC source): BY-SA and BY-NC are not compatible in one " +
    "adaptation, and separate files avoid the question entirely.",
  // 2. The Greek notice is a chain of three attributions in one string.
  "The Greek attribution is a three-link chain and must be reproduced whole: " +
    "UBS 2023 → Semantic Dictionary of Biblical Greek (UBS 2018-2023) → " +
    "Louw & Nida, Greek-English Lexicon of the New Testament Based on " +
    "Semantic Domains (UBS 1988, 1989). Citing only \"UBS\" drops Louw and Nida.",
  // 3. A named third-party contribution inside the blanket licence.
  "dictionaries/greek/README.md records that the exhaustive Scripture " +
    "references for each Greek lexical meaning \"was created and kindly made " +
    "available by the Summer Institute of Linguistics (SIL)\". SIL is not " +
    "named in the attribution string; credit it wherever the reference lists " +
    "are surfaced.",
  // 4. A rider on a sibling directory, recorded because the top-level README
  //    otherwise reads as a blanket CC BY-SA over the whole repository.
  "The repository README states of the MARBLE image collection (a sibling " +
    "directory, NOT imported here): \"All will need to carry their original " +
    "© info when reused.\" The repo-wide CC BY-SA banner does not cover " +
    "those images. Do not import from images/ or flora-fauna-realia/ on the " +
    "strength of the top-level licence alone.",
  // 5. The coverage claim is stated twice, differently, in the same repo.
  "dictionaries/hebrew/README.md says SDBH covers \"around 90% of all words " +
    "found in the Old Testament\"; dictionaries/README.md's UPDATES section " +
    "says v0.9.2 is \"now at 99%\". Both are in-repo claims and they are not " +
    "the same number. See UBS_HEBREW_JOIN for what we measured.",
];

/** Per-dictionary provenance for the file this module was written against. */
export type UbsSourceDescriptor = {
  id: UbsDictionaryId;
  /** The dictionary's own abbreviation, as its README spells it. */
  abbreviation: "SDBH" | "SDGNT";
  /** Upstream filename, verbatim, including its upper-case `.JSON` suffix. */
  file: string;
  /** Upstream companion domain-tree filename. */
  domainFile: string;
  /** Version as it appears in the filename. */
  sourceVersion: string;
  /** Localization as it appears in the filename. */
  localization: string;
  domainScheme: UbsDomainScheme;
  license: typeof UBS_LICENSE;
  attribution: string;
};

export const UBS_SOURCES: Readonly<Record<UbsDictionaryId, UbsSourceDescriptor>> = {
  sdbh: {
    id: "sdbh",
    abbreviation: "SDBH",
    file: "UBSHebrewDic-v0.9.2-en.JSON",
    domainFile: "UBSHebrewDicLexicalDomains-v0.9.2-en.JSON",
    sourceVersion: "0.9.2",
    localization: "en",
    domainScheme: "sdbh",
    license: UBS_LICENSE,
    attribution: UBS_ATTRIBUTION.sdbh,
  },
  sdgnt: {
    id: "sdgnt",
    abbreviation: "SDGNT",
    file: "UBSGreekNTDic-v1.1-en.JSON",
    domainFile: "UBSGreekNTDicLexicalDomains-v1.1-en.JSON",
    sourceVersion: "1.1",
    localization: "en",
    domainScheme: "louw-nida",
    license: UBS_LICENSE,
    attribution: UBS_ATTRIBUTION.sdgnt,
  },
};

/**
 * Localizations published upstream, listed because the READMEs understate them.
 *
 * Both per-language READMEs claim "English, French, Spanish, and Chinese
 * (both traditional and simplified scripts)". Measured from the GitHub
 * contents API:
 *
 *   - Hebrew ships **pt** (Portuguese) too, and the Hebrew README's own
 *     abbreviation table lists seven Portuguese Bible versions — so pt is
 *     real, merely unannounced in the language sentence.
 *   - Greek ships Spanish TWICE under two suffixes, `-es` (15,919,266 b) and
 *     `-sp` (14,366,069 b), and Chinese twice under two schemes,
 *     `-zh-hans`/`-zh-hant` and `-zhs`/`-zht`. The pairs differ in size, so
 *     they are not copies. Prefer the `-es` / `-zh-han{s,t}` spellings, which
 *     are the ones the LexicalDomains companions also use.
 *   - Greek's newest files are `v1.1-en` and `v1.01-fr`; every other Greek
 *     localization is still at `v1.0`. Hebrew is uniformly `v0.9.2`.
 */
export const UBS_PUBLISHED_LOCALIZATIONS: Readonly<Record<UbsDictionaryId, readonly string[]>> = {
  sdbh: ["en", "es", "fr", "pt", "zh-hans", "zh-hant"],
  sdgnt: ["en", "es", "fr", "sp", "zh-hans", "zh-hant", "zhs", "zht"],
};

/* ========================================================================== *
 * Raw upstream shapes
 * ========================================================================== */

/** One localized sense body. Both dictionaries use the identical shape. */
export type RawUbsLexSense = {
  LanguageCode?: string | null;
  LastEdited?: string | null;
  LastEditedBy?: string | null;
  DefinitionLong?: string | null;
  DefinitionShort?: string | null;
  Glosses?: readonly string[] | null;
  Comments?: string | null;
};

export type RawUbsDomainRef = {
  DomainCode?: string | null;
  DomainSource?: string | null;
  DomainSourceCode?: string | null;
  Domain?: string | null;
};

export type RawUbsLexMeaning = {
  LEXID?: string | null;
  LEXIsBiblicalTerm?: string | null;
  /** SDGNT: the Louw-Nida reference. SDBH: always the empty string. */
  LEXEntryCode?: string | null;
  LEXIndent?: number | null;
  LEXDomains?: readonly RawUbsDomainRef[] | null;
  LEXSubDomains?: readonly RawUbsDomainRef[] | null;
  LEXCoreDomains?: readonly RawUbsDomainRef[] | null;
  LEXSenses?: readonly RawUbsLexSense[] | null;
  LEXReferences?: readonly string[] | null;
  LEXSynonyms?: readonly unknown[] | null;
  LEXAntonyms?: readonly unknown[] | null;
  LEXCollocations?: readonly unknown[] | null;
  LEXForms?: readonly unknown[] | null;
  LEXLinks?: readonly unknown[] | null;
  LEXCoordinates?: readonly unknown[] | null;
  LEXValencies?: readonly unknown[] | null;
  CONMeanings?: readonly unknown[] | null;
};

export type RawUbsBaseForm = {
  BaseFormID?: string | null;
  PartsOfSpeech?: readonly string[] | null;
  LEXMeanings?: readonly RawUbsLexMeaning[] | null;
  RelatedLemmas?: readonly unknown[] | null;
  MeaningsOfName?: readonly unknown[] | null;
};

export type RawUbsEntry = {
  MainId?: string | null;
  Lemma?: string | null;
  Version?: string | null;
  HasAramaic?: boolean | null;
  InLXX?: boolean | null;
  AlphaPos?: string | null;
  StrongCodes?: readonly string[] | null;
  Authors?: readonly string[] | null;
  AlternateLemmas?: readonly string[] | null;
  Notes?: readonly unknown[] | null;
  BaseForms?: readonly RawUbsBaseForm[] | null;
};

export type RawUbsDomainNode = {
  Code?: string | null;
  Level?: number | null;
  Prototype?: string | null;
  Reference?: string | null;
  HasSubDomains?: boolean | null;
  SemanticDomainLocalizations?: readonly {
    LanguageCode?: string | null;
    Label?: string | null;
    Description?: string | null;
    Opposite?: string | null;
    Comment?: string | null;
  }[] | null;
};

/* ========================================================================== *
 * Domain codes
 * ========================================================================== */

/**
 * SDBH's four top-level domains, and SDGNT's first four, side by side. Kept as
 * code so a test can assert the collision rather than trusting the comment.
 */
export const UBS_DOMAIN_SCHEME_HEADS: Readonly<Record<UbsDomainScheme, Readonly<Record<string, string>>>> = {
  sdbh: { "001": "Objects", "002": "Events", "003": "Referents", "004": "Markers" },
  "louw-nida": {
    "001": "Geographical Objects and Features",
    "002": "Natural Substances",
    "003": "Plants",
    "004": "Animals",
  },
};

/**
 * Build a namespaced domain code. Returns `null` for anything that is not a
 * run of digits in whole 3-digit groups, which is the only shape either tree
 * uses (SDBH 3/6/9/12/15, SDGNT 3/6).
 */
export function qualifyUbsDomainCode(
  scheme: UbsDomainScheme,
  code: unknown,
): UbsQualifiedDomainCode | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  if (trimmed.length % 3 !== 0) return null;
  if (scheme === "sdbh") return `sdbh:${trimmed}`;
  return `louw-nida:${trimmed}`;
}

/** Split a qualified code back into its parts. */
export function splitUbsDomainCode(
  qualified: unknown,
): { scheme: UbsDomainScheme; code: string } | null {
  if (typeof qualified !== "string") return null;
  const idx = qualified.indexOf(":");
  if (idx <= 0) return null;
  const scheme = qualified.slice(0, idx);
  const code = qualified.slice(idx + 1);
  if (scheme !== "sdbh" && scheme !== "louw-nida") return null;
  if (!/^\d+$/.test(code) || code.length % 3 !== 0) return null;
  return { scheme, code };
}

/** Ancestor chain of a domain code, outermost first, including itself. */
export function ubsDomainAncestry(qualified: unknown): UbsQualifiedDomainCode[] {
  const split = splitUbsDomainCode(qualified);
  if (!split) return [];
  const out: UbsQualifiedDomainCode[] = [];
  for (let end = 3; end <= split.code.length; end += 3) {
    const q = qualifyUbsDomainCode(split.scheme, split.code.slice(0, end));
    if (q) out.push(q);
  }
  return out;
}

/* ========================================================================== *
 * Louw-Nida entry codes (SDGNT only)
 * ========================================================================== */

/**
 * A parsed Louw-Nida reference: `53.89`, `93.4a`, `57.225`, `12.12`.
 *
 * The same syntax MACULA writes into `token.louwNida`. `domain` here is the
 * Louw-Nida domain number, which is also the SDGNT `LEXDomains` code once
 * zero-padded to three digits — hence {@link qualifiedDomain}.
 */
export type LouwNidaCode = {
  /** Normalised text: domain, `.`, entry, optional sense letter. */
  code: string;
  domain: number;
  entry: number;
  /** The trailing sense letter of a split Louw-Nida entry, e.g. `93.4a`. */
  sense?: string;
  /** `"louw-nida:053"` for `53.89`. */
  qualifiedDomain: UbsQualifiedDomainCode;
};

/**
 * Parse one Louw-Nida entry code. Rejects anything else, including a bare
 * domain number and a space-separated multi-value string — MACULA writes 841
 * tokens as `"10.24 33.19"` and those must be split by the caller with
 * {@link parseLouwNidaList}, not silently truncated.
 */
export function parseLouwNidaCode(raw: unknown): LouwNidaCode | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,3})\.(\d{1,4})([a-z])?$/);
  if (!m) return null;
  const domain = Number.parseInt(m[1] as string, 10);
  const entry = Number.parseInt(m[2] as string, 10);
  if (domain < 1 || domain > 93) return null;
  const qualifiedDomain = qualifyUbsDomainCode(
    "louw-nida",
    String(domain).padStart(3, "0"),
  );
  if (!qualifiedDomain) return null;
  const sense = m[3];
  const code = `${domain}.${entry}${sense ?? ""}`;
  return sense === undefined
    ? { code, domain, entry, qualifiedDomain }
    : { code, domain, entry, sense, qualifiedDomain };
}

/**
 * Parse a whitespace-separated list of Louw-Nida codes, the shape MACULA's
 * `token.louwNida` uses when one token carries several senses.
 * Returns the codes it recognised and the fragments it did not.
 */
export function parseLouwNidaList(
  raw: unknown,
): { codes: LouwNidaCode[]; unparsed: string[] } {
  if (typeof raw !== "string") return { codes: [], unparsed: [] };
  const codes: LouwNidaCode[] = [];
  const unparsed: string[] = [];
  for (const part of raw.trim().split(/\s+/)) {
    if (!part) continue;
    const parsed = parseLouwNidaCode(part);
    if (parsed) codes.push(parsed);
    else unparsed.push(part);
  }
  return { codes, unparsed };
}

/* ========================================================================== *
 * Strong's codes as SDBH / SDGNT write them
 * ========================================================================== */

/** Why a `StrongCodes` value could not be turned into one canonical key. */
export type UbsStrongCodeRejectionReason =
  /** Not a string. */
  | "not-a-string"
  /** Empty or whitespace only. SDBH ships 26 of these. */
  | "empty"
  /**
   * The field holds prose, not a code. SDBH ships the author name
   * `"Reinier de Blois"` in `StrongCodes` on three entries
   * (`בָּרוּר`, `רְחֹבֹת עִיר`, `תוהּ`) — the mirror image of the Strong's
   * codes `"H1305"` and `"A8429"` that leaked into `Authors`.
   */
  | "prose-not-a-code"
  /**
   * Digits with no sigil. SDBH ships two: `"2062"` (on `יֶקֶב־זְאֵב`, whose
   * other code is `H3342`) and `"6859"` (on `צְפַתָה`, its only code). Both
   * are Hebrew by context, but this module will not assume that for you —
   * pass `assumeTestament` if the caller is willing to.
   */
  | "bare-number"
  /** `strongs-key.ts` rejected it; its reason is carried through. */
  | "delegated-rejection";

export type UbsStrongCodeParsed = {
  ok: true;
  /** Canonical key per `strongs-key.ts`: unpadded, sigil upper. `H32B`. */
  canonical: string;
  /** Canonical with the sense letter dropped. `H32`. */
  base: string;
  /**
   * The sense letter, upper-cased. See {@link UBS_HEBREW_JOIN} for why this
   * module upper-cases and why you should not join on it.
   */
  senseSuffix?: string;
  /**
   * True when the upstream sigil was `A`, i.e. SDBH marked the entry Aramaic.
   * The number is unchanged; only the sigil is rewritten to `H`.
   */
  aramaic: boolean;
  /**
   * `true` when the code names several Strong's numbers, either as an
   * embedded `+` (`"H0410+H1285"`, 6 occurrences) or because the caller
   * folded a multi-element `StrongCodes` array. A constituent claim is not
   * an identity claim — see {@link parseUbsStrongCodes}.
   */
  compound: boolean;
  /** Canonical components, present only when `compound`. */
  components?: string[];
};

export type UbsStrongCodeRejection = {
  ok: false;
  reason: UbsStrongCodeRejectionReason;
  input: string;
  detail: string;
  /** The verbatim `strongs-key.ts` rejection, when that is what happened. */
  delegated?: StrongsKeyResult;
};

export type UbsStrongCodeResult = UbsStrongCodeParsed | UbsStrongCodeRejection;

export type ParseUbsStrongCodeOptions = {
  /** Settle a sigil-less code such as SDBH's `"2062"`. Off by default. */
  assumeTestament?: "H" | "G";
};

/**
 * Parse one `StrongCodes` value.
 *
 * Shapes measured across both dictionaries, exhaustively:
 *
 *   SDBH, 9,079 occurrences / 8,976 distinct, on 7,927 of 7,932 entries
 *     `H####`        7,711     four-wide zero-padded Hebrew
 *     `A####`           634     ditto, sigil `A` for Aramaic
 *     `H####a`-`f`      676     lower-case sense letter
 *     `A####a`/`b`       21     ditto
 *     `H####+H####`       6     a multi-word lemma's constituents
 *     `""`               26     empty
 *     `Reinier de Blois`  3     an author name in the code field
 *     `####`              2     no sigil
 *
 *   SDGNT, 5,402 occurrences / 5,397 distinct, on 5,397 of 5,507 entries
 *     `G####`         5,223
 *     `G####a`          173
 *     `G####b`            6
 *
 * The `A` sigil is a language tag, not a separate numbering. Proved against
 * the `bdb-kjv.json` this repo already ships: SDBH gives `אֵב` the pair
 * `["H0003","A0004"]`, and BDB has `H3` = "freshness, fresh green, green
 * shoots, or greenery" (Hebrew) beside `H4` = "fruit, fresh, young, greening"
 * (the Aramaic homograph); likewise `A0069` ↔ BDB `H69` "stone" and `A0412` ↔
 * BDB `H412` "these". Strong's interleaves its Aramaic entries in the one
 * H1–H8674 series, so `A0004` means Strong's 4 and the correct rewrite is
 * `A` → `H` with the number untouched. On the 270 SDBH entries carrying both
 * sigils the A-number sits adjacent to the H-number in 254 cases (+1 on 229,
 * -1 on 25), which is what interleaving looks like.
 *
 * Three numbers carry both an `H` and an `A` code across different entries —
 * 3879, 6211, 8412 — and each looks like an upstream off-by-one:
 * `H3879 לֵוִי` beside `A3879 לֵוָי`, `H6211 עָשׁ` beside `A6211 עֲשַׂב`,
 * `H8412 תַּדְמֹר` beside `A8412 תְּדִיר`. This module does NOT merge them; the
 * importer records the clash so it stays visible.
 */
export function parseUbsStrongCode(
  raw: unknown,
  options: ParseUbsStrongCodeOptions = {},
): UbsStrongCodeResult {
  if (typeof raw !== "string") {
    return {
      ok: false,
      reason: "not-a-string",
      input: raw === null ? "null" : raw === undefined ? "undefined" : String(raw),
      detail: `Expected a string StrongCodes value, received ${raw === null ? "null" : typeof raw}.`,
    };
  }
  const s = raw.trim();
  if (!s) {
    return {
      ok: false,
      reason: "empty",
      input: raw,
      detail: "Empty StrongCodes value. SDBH ships 26 of these; skip, do not log as an error.",
    };
  }
  if (/[A-Za-z]{2}/.test(s) && /\s/.test(s)) {
    return {
      ok: false,
      reason: "prose-not-a-code",
      input: s,
      detail:
        `StrongCodes holds prose, not a code: ${JSON.stringify(s)}. ` +
        "SDBH leaks the author name into this field on three entries.",
    };
  }
  if (/^\d+$/.test(s)) {
    if (!options.assumeTestament) {
      return {
        ok: false,
        reason: "bare-number",
        input: s,
        detail:
          `StrongCodes value ${JSON.stringify(s)} has no testament sigil. ` +
          "SDBH ships two (2062, 6859). Pass assumeTestament to settle it.",
      };
    }
    return finish(`${options.assumeTestament}${s}`, s, false);
  }
  // A `+`-joined code is split HERE, not handed whole to `strongs-key.ts`.
  // That module rejects a compound whose component carries a sense letter
  // ("compounds are plain numbers only"), and SDBH ships exactly such a case:
  // `H1237+H0205a` on בִּקְעַת אָוֶן, "Valley of Aven" = H1237 בִּקְעָה +
  // H205a אָוֶן. Parsing each component on its own keeps the letter.
  if (s.includes("+")) {
    const parts = s.split("+").map((p) => p.trim()).filter((p) => p !== "");
    if (parts.length < 2) {
      return {
        ok: false,
        reason: "delegated-rejection",
        input: s,
        detail: `StrongCodes value ${JSON.stringify(s)} has a '+' but fewer than two components.`,
      };
    }
    const components: string[] = [];
    let anyAramaic = false;
    for (const part of parts) {
      const one = parseUbsStrongCode(part, options);
      if (!one.ok) {
        return {
          ok: false,
          reason: one.reason,
          input: s,
          detail: `Compound component ${JSON.stringify(part)} of ${JSON.stringify(s)}: ${one.detail}`,
          ...(one.delegated ? { delegated: one.delegated } : {}),
        };
      }
      if (one.aramaic) anyAramaic = true;
      components.push(one.canonical);
    }
    const canonical = components.join("+");
    return {
      ok: true,
      canonical,
      base: canonical,
      aramaic: anyAramaic,
      compound: true,
      components,
    };
  }
  // The `A` sigil is a language tag, not a numbering: rewrite it to `H`.
  const aramaic = /^A\d/.test(s);
  const rewritten = aramaic ? `H${s.slice(1)}` : s;
  return finish(rewritten, s, aramaic);
}

function finish(
  rewritten: string,
  input: string,
  aramaic: boolean,
): UbsStrongCodeResult {
  // UBS writes the homograph letter lower-case; STEP and this repo's
  // canonical form write it upper. `trustSuffixCase` is safe here for the
  // same measured reason `strongs-key.ts` gives for OSHB: UBS letters span
  // `a`-`f` only, nowhere near the `A`-`Z` exhaustion at which a lower-case
  // letter would mean a genuinely distinct 27th sense.
  const parsed = parseStrongsKey(rewritten, { trustSuffixCase: true });
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "delegated-rejection",
      input,
      detail: `strongs-key rejected ${JSON.stringify(rewritten)}: ${parsed.reason} — ${parsed.detail}`,
      delegated: parsed,
    };
  }
  const upper = parsed.senseSuffix ? parsed.senseSuffix.toUpperCase() : undefined;
  const canonical = upper ? `${parsed.base}${upper}` : parsed.canonical;
  const out: UbsStrongCodeParsed = {
    ok: true,
    canonical,
    base: parsed.base,
    aramaic,
    compound: parsed.kind === "compound",
  };
  if (upper !== undefined) out.senseSuffix = upper;
  if (parsed.components) out.components = [...parsed.components];
  return out;
}

/**
 * Fold a whole `StrongCodes` array into a primary claim plus constituents.
 *
 * A UBS entry lists MORE THAN ONE Strong's code for two different reasons and
 * the array does not distinguish them:
 *
 *   1. Homograph or cross-language pairing on one headword —
 *      `אֵב ["H0003","A0004"]`, `אֵל ["H0410","H0411","A0412","H0415","H0416"]`.
 *   2. Constituent listing on a MULTI-WORD headword —
 *      `אֶבֶן הָאֶזֶל ["H0068","H0237"]` is "Ebenezer", and `H0068` is only the
 *      word אֶבֶן inside it. The same idea is ALSO written as one `+`-joined
 *      string on six entries (`אֵל בְּרִית ["H0410+H1285"]`), so the two
 *      encodings coexist for the same relationship.
 *
 * Measured: 943 SDBH entries and 5 SDGNT entries carry more than one code;
 * 255 SDBH lemmas and 5 SDGNT lemmas contain a space or a maqqef. Sixty-seven
 * canonical Hebrew keys are claimed by more than one entry — `H68` by four
 * (`אֶבֶן` itself plus three place names built on it). A `byStrong` map that
 * ignored this would attach "Ebenezer" to every occurrence of the common noun
 * "stone".
 *
 * The rule adopted here, and it is a judgement not a measurement: an entry
 * whose lemma is multi-word makes only CONSTITUENT claims; every other entry
 * makes an IDENTITY claim on each code it lists.
 */
export function parseUbsStrongCodes(
  codes: readonly unknown[] | null | undefined,
  lemma: string,
  options: ParseUbsStrongCodeOptions = {},
): {
  identity: UbsStrongCodeParsed[];
  constituent: UbsStrongCodeParsed[];
  rejected: UbsStrongCodeRejection[];
} {
  const identity: UbsStrongCodeParsed[] = [];
  const constituent: UbsStrongCodeParsed[] = [];
  const rejected: UbsStrongCodeRejection[] = [];
  const multiWord = isMultiWordLemma(lemma);
  for (const raw of codes ?? []) {
    const r = parseUbsStrongCode(raw, options);
    if (!r.ok) {
      rejected.push(r);
      continue;
    }
    // A `+`-joined code is a constituent listing by construction, and so is
    // every code on a multi-word headword.
    if (r.compound || multiWord) constituent.push(r);
    else identity.push(r);
  }
  return { identity, constituent, rejected };
}

/**
 * True when a UBS lemma names more than one word. Covers the ASCII space, the
 * Hebrew maqqef U+05BE, and the hyphen/dash range — SDBH writes both
 * `אֵל בְּרִית` and `יָם־סוּף`.
 */
export function isMultiWordLemma(lemma: unknown): boolean {
  if (typeof lemma !== "string") return false;
  return /[\s־‐-―-]/.test(lemma.trim());
}

/* ========================================================================== *
 * The Hebrew join, measured
 * ========================================================================== */

/**
 * Everything a caller needs in order to decide whether a Hebrew join is
 * honest. Every field is a measurement taken against files in this repo, not
 * an estimate; the module exports it so a test can re-derive it.
 *
 * The headline: **join on the base, never on the sense letter.**
 */
export const UBS_HEBREW_JOIN = {
  /** `data/scripture/packages/oshb-wlc/tokens.jsonl`, all 306,774 tokens. */
  oshbTokensTotal: 306_774,
  /** Tokens carrying a Strong's number (the rest are prefix-only). */
  oshbTokensWithStrong: 300_797,
  /** Distinct unpadded Hebrew bases in OSHB. */
  oshbDistinctBases: 8_638,

  /** SDBH entries, and how many carry at least one `StrongCodes` value. */
  sdbhEntries: 7_932,
  sdbhEntriesWithStrongCode: 7_927,
  /** Distinct canonical keys after the `A`→`H` rewrite. */
  sdbhDistinctCanonicalKeys: 8_963,
  /** Distinct bases after dropping the sense letter. */
  sdbhDistinctBases: 8_590,

  /**
   * Base-only join. This is the number to quote: SDBH reaches 99.29% of the
   * Hebrew Strong's INVENTORY but only 87.61% of RUNNING TEXT, because the 61
   * numbers it lacks are among the commonest words in the OT.
   */
  baseJoinBasesMatched: 8_577,
  baseJoinBasePercent: 99.29,
  baseJoinTokensMatched: 263_541,
  baseJoinTokenPercent: 87.614,

  /**
   * Exact join on the sense letter, both sides upper-cased. Costs 12.582
   * percentage points against the base join — 37,845 tokens — because the two
   * projects letter homographs independently. Do not do this.
   */
  exactSuffixJoinTokensMatched: 225_696,
  exactSuffixJoinTokenPercent: 75.033,
  suffixInsistenceCostTokens: 37_845,

  /**
   * The letters themselves are the same `a`-`f` space and agree on which
   * letters exist for a base 95.14% of the time (176 of the 185 bases
   * lettered on both sides; 184 of 185 with OSHB's set a subset of SDBH's).
   * They still cannot be joined on, because the two sides letter DIFFERENT
   * bases: 355 bases are lettered only in OSHB and 144 only in SDBH.
   * `H1254` (בָּרָא) is `1254 a` / `1254 b` in OSHB and plain `H1254` in SDBH,
   * so an OSHB-side `H1254A` misses outright.
   */
  basesLetteredInBoth: 185,
  basesLetteredOshbOnly: 355,
  basesLetteredSdbhOnly: 144,
  letterSetsIdentical: 176,

  /**
   * The 61 Strong's bases SDBH v0.9.2 does not cover at all, ranked by OSHB
   * occurrences. Confirmed absent by canonical key AND by NFC lemma lookup
   * AND by raw substring grep — `H1961` does not appear anywhere in the file.
   * These are why the "99%" claim and the "87.6% of running text" measurement
   * are both true of the same data.
   */
  topUncoveredBases: [
    ["H5921", 5_781], ["H413", 5_516], ["H3605", 5_417], ["H3588", 4_488],
    ["H1961", 3_575], ["H6440", 2_127], ["H5414", 2_015], ["H4480", 1_230],
    ["H5973", 1_049], ["H2009", 843], ["H408", 725], ["H3541", 577],
  ] as ReadonlyArray<readonly [string, number]>,
  uncoveredBaseCount: 61,
  uncoveredTokenCount: 37_256,
} as const;

/**
 * The Greek join, measured. Nothing to translate: MACULA already carries
 * SDGNT's own keys.
 */
export const UBS_GREEK_JOIN = {
  maculaTokensTotal: 137_779,
  maculaTokensWithLouwNida: 127_291,
  maculaDistinctAtomicLouwNida: 7_009,
  sdgntDistinctEntryCodes: 7_102,
  /** Distinct MACULA `louwNida` values that are exact SDGNT `LEXEntryCode`s. */
  louwNidaValuesMatched: 7_002,
  louwNidaValuePercent: 99.9,
  louwNidaTokenOccurrencesMatched: 129_185,
  louwNidaTokenOccurrencePercent: 99.51,
  /** MACULA `domain` codes that are exact SDGNT `LEXSubDomains` codes. */
  maculaDistinctDomainCodes: 668,
  domainCodesMatchedAsSubdomain: 639,

  /**
   * The Strong's join is strictly WORSE than the Louw-Nida join for Greek:
   * 98.79% of bases but only 92.71% of occurrences. Four lemmas account for
   * 9,304 of the 10,047 missed occurrences, and the cause is not missing
   * data — SDGNT has all four, keyed to an OBLIQUE-case Strong's number:
   * `σύ`→`G4675` (σοῦ), `ἐγώ`→`G2257` (ἡμῶν), `εἰμί`→`G2258` (ἦν),
   * `οὗτος`→`G5023` (ταῦτα), where MACULA lemmatises to the nominative
   * `G4771`/`G1473`/`G1510`/`G3778`. Prefer `louwNida`; fall back to Strong's.
   */
  strongJoinBasesMatched: 5_285,
  strongJoinBasePercent: 98.79,
  strongJoinTokensMatched: 127_732,
  strongJoinTokenPercent: 92.708,
  strongJoinObliqueCaseMisses: [
    ["σύ", "G4675", "G4771", 2_892],
    ["ἐγώ", "G2257", "G1473", 2_567],
    ["εἰμί", "G2258", "G1510", 2_457],
    ["οὗτος", "G5023", "G3778", 1_388],
  ] as ReadonlyArray<readonly [string, string, string, number]>,
} as const;

/* ========================================================================== *
 * Scripture references
 * ========================================================================== */

/**
 * A decoded UBS reference.
 *
 * The encoding is `BBBCCCVVVSSWWW`, documented only in
 * `dictionaries/hebrew/README.md` — the Greek README omits it although the
 * Greek data uses the same encoding. `BBB` is the Paratext book number, which
 * for this canon is simply the 1-based index into `BOOK_CODES`
 * (001 GEN … 039 MAL, 040 MAT … 066 REV, and the data uses exactly 001-039
 * for Hebrew and 040-066 for Greek, with no gaps).
 *
 * `WWW` is the load-bearing subtlety. The README says "Words are counted
 * using even numbers only" and "Hebrew words that are written together are
 * still counted as separate words (בְּרֵאשִׁית is Genesis 1:1 consists of two
 * words)". So `WWW / 2` is a 1-based **morpheme** ordinal, not a token
 * ordinal.
 *
 * Verified end to end against the shipped OSHB package. SDBH's entry אֵב
 * (`H0003`, glosses "blossom", "flower") carries the reference
 * `02200601100016` = SNG 6:11, morpheme 8. Counting morphemes across
 * `oshb-wlc` SNG 6:11 — אֶל(1) גִּנַּת(2) אֱגוֹז(3) יָרַדְתִּי(4) לִ(5)/רְאוֹת(6)
 * בְּ(7)/אִבֵּי(8) — morpheme 8 is אִבֵּי, whose token is `lemma "b/3"`,
 * `strong "3"`. The README's own worked example agrees:
 * `00200300100012` = EXO 3:1, morpheme 6 = צֹאן, and the README calls it
 * "word element 6".
 *
 * The consequence for this repo: our tokens keep prefix morphemes glued
 * (`בְּ/רֵאשִׁית` is ONE token — `docs/step-word-card-parity.md` §2 field 40),
 * so `word` cannot address one of our tokens today. Verse-level joins work
 * now; word-level joins need field 40's package change first.
 */
export type UbsReference = {
  /** The 14 digits, footnote markers stripped. */
  packed: string;
  /** Paratext book number as it appeared, e.g. `"022"`. */
  bookNumber: string;
  book: BookCode;
  chapter: number;
  verse: number;
  /** Always 0 in this data; the README says segments are irrelevant for Hebrew. */
  segment: number;
  /** The raw even-numbered word field. */
  word: number;
  /** `word / 2`, the 1-based morpheme ordinal, or `null` when `word` is 0. */
  morpheme: number | null;
  /** `"SNG.6.11"` — the coordinate form the rest of this repo uses. */
  ref: string;
  /** True when `chapter` or `verse` is 0: a book- or chapter-level reference. */
  wholeUnit: boolean;
  /** Footnote ids found appended to the reference, e.g. `["001"]`. */
  footnotes: string[];
};

/**
 * Decode one `LEXReferences` value.
 *
 * Beyond the clean 14-digit form (258,116 Hebrew + 130,659 Greek), upstream
 * appends footnote markers INSIDE the reference string, which makes the field
 * variable-length: 2,694 Hebrew and 263 Greek values are 21 chars
 * (`00901201500040{N:001}`), plus `01300202400022!{N:001}` with a stray `!`,
 * `01100400700050{N:-033}` with a NEGATIVE footnote id,
 * `01804100700002{N:002}{N:003}` with two, and
 * `06300100300004({N:003})` parenthesised. All are handled; none is dropped
 * silently.
 */
export function decodeUbsReference(raw: unknown): UbsReference | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const footnotes: string[] = [];
  const digits = s.replace(/\{N:(-?\d+)\}/g, (_m, id: string) => {
    footnotes.push(id);
    return "";
  }).replace(/[^0-9]/g, "");
  if (digits.length !== 14) return null;
  const bookNumber = digits.slice(0, 3);
  const bookIndex = Number.parseInt(bookNumber, 10) - 1;
  const book = BOOK_CODES[bookIndex];
  if (!book) return null;
  const chapter = Number.parseInt(digits.slice(3, 6), 10);
  const verse = Number.parseInt(digits.slice(6, 9), 10);
  const segment = Number.parseInt(digits.slice(9, 11), 10);
  const word = Number.parseInt(digits.slice(11, 14), 10);
  return {
    packed: digits,
    bookNumber,
    book,
    chapter,
    verse,
    segment,
    word,
    morpheme: word > 0 ? word / 2 : null,
    ref: `${book}.${chapter}.${verse}`,
    wholeUnit: chapter === 0 || verse === 0,
    footnotes,
  };
}

/* ========================================================================== *
 * Inline markup in the prose fields
 * ========================================================================== */

/** One inline marker lifted out of a definition, gloss note or comment. */
export type UbsInlineMarker =
  /** `{N:001}` — a footnote pointer into the entry's `Notes`. */
  | { kind: "footnote"; id: string; raw: string }
  /** `{L:Ahasuerus<SDBH:אֲחַשְׁוֵרֹושׁ>}` — a hyperlink to another entry. */
  | {
      kind: "link";
      text: string;
      dictionary: string;
      target: string;
      targetId?: string;
      /** Upstream wrote the angle brackets HTML-escaped. One SDBH link does. */
      htmlEscaped?: true;
      raw: string;
    }
  /** `{S:00200300100012}` — an encoded Scripture reference. */
  | { kind: "reference"; reference: UbsReference | null; packed: string; raw: string }
  /** `{A:NIV}` — a named text version or authority. */
  | { kind: "authority"; abbreviation: string; raw: string }
  /** `{D:93.32}` — a cross-reference to another Louw-Nida entry code. */
  | { kind: "domain-xref"; code: string; louwNida: LouwNidaCode | null; raw: string }
  /** A `{X:…}` shape this module does not know. Never dropped. */
  | { kind: "unknown"; tag: string; body: string; raw: string };

export type UbsProse = {
  /** The prose with every marker removed and whitespace tidied. */
  text: string;
  /** The prose exactly as upstream wrote it. */
  raw: string;
  markers: UbsInlineMarker[];
};

/**
 * Strip and classify the inline markers in one prose field.
 *
 * Only `dictionaries/hebrew/README.md` documents any of this, and it
 * documents four tags — `{N:}`, `{L:}`, `{S:}`, `{A:}`. Measured over both
 * dictionaries' English `DefinitionShort` / `DefinitionLong` / `Comments`:
 *
 *   SDBH (1,788,607 prose chars): `{L:}` 9,599 · `{A:}` 59 · `{N:}` 23 · `{S:}` 8
 *   SDGNT (1,854,659 prose chars): `{S:}` 3,348 · **`{D:}` 2,362** · `{L:}` 1,591 · `{N:}` 1,006
 *
 * `{D:93.32}` is the second-commonest marker in the Greek dictionary and is
 * documented NOWHERE in the repository. Its body is always a Louw-Nida entry
 * code, so it reads as a "see also" pointer between senses.
 *
 * The link body also differs by dictionary and neither README says so:
 * SDBH writes two fields, `{L:Ahasuerus<SDBH:אֲחַשְׁוֵרֹושׁ>}`, while SDGNT
 * writes three, `{L:ἀγάπη<SDBG:ἀγάπη:000000>}` — note the inner dictionary
 * tag is `SDBG`, not `SDGNT`.
 */
export function parseUbsProse(raw: unknown): UbsProse {
  if (typeof raw !== "string" || !raw) return { text: "", raw: typeof raw === "string" ? raw : "", markers: [] };
  const markers: UbsInlineMarker[] = [];
  const stripped = raw.replace(/\{([A-Za-z]):([^}]*)\}/g, (whole, tag: string, body: string) => {
    markers.push(classifyMarker(tag, body, whole));
    return "";
  });
  return {
    text: stripped.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim(),
    raw,
    markers,
  };
}

function classifyMarker(tag: string, body: string, raw: string): UbsInlineMarker {
  switch (tag) {
    case "N":
      return { kind: "footnote", id: body, raw };
    case "S": {
      const packed = body.replace(/[^0-9]/g, "");
      return { kind: "reference", reference: decodeUbsReference(packed), packed, raw };
    }
    case "A":
      return { kind: "authority", abbreviation: body.trim(), raw };
    case "D": {
      const code = body.trim();
      return { kind: "domain-xref", code, louwNida: parseLouwNidaCode(code), raw };
    }
    case "L": {
      // One SDBH link, on the entry צְדָד, ships its angle brackets
      // HTML-escaped: `{L:Israel&lt;SDBH:יִשְׂרָאֵל&gt;}`. Exactly one of 9,599.
      // Unescape so the link resolves; `htmlEscaped` keeps the defect visible
      // instead of hiding it behind a working link.
      const unescaped = body
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      const htmlEscaped = unescaped !== body;
      const m = unescaped.match(/^(.*?)<([^:>]+):([^>]*)>$/);
      if (!m) return { kind: "unknown", tag, body, raw };
      const parts = (m[3] as string).split(":");
      const target = parts[0] ?? "";
      const targetId = parts[1];
      const marker: UbsInlineMarker = {
        kind: "link",
        text: (m[1] as string).trim(),
        dictionary: m[2] as string,
        target,
        raw,
        ...(htmlEscaped ? { htmlEscaped: true } : {}),
      };
      return targetId === undefined ? marker : { ...marker, targetId };
    }
    default:
      return { kind: "unknown", tag, body, raw };
  }
}

/* ========================================================================== *
 * Normalised model
 * ========================================================================== */

/**
 * One lexical meaning — the unit that actually carries a semantic domain, a
 * definition, glosses and references. This is the row a word card would show.
 */
export type UbsMeaning = {
  /** `"sdgnt:001234001001000"` — dictionary plus upstream `LEXID`. */
  id: string;
  dictionary: UbsDictionaryId;
  /** The owning entry's id. */
  entryId: string;
  /** SDGNT only: the Louw-Nida reference. `undefined` for every SDBH meaning. */
  louwNida?: LouwNidaCode;
  /** Nesting depth upstream gives the meaning inside its base form. */
  indent: number;
  /** `"Y"` upstream; surfaced as a boolean where present. */
  biblicalTerm?: boolean;
  /** Top-level domains, namespaced. */
  domains: UbsQualifiedDomainCode[];
  /** SDGNT's second level. Empty for SDBH, which nests inside one code. */
  subDomains: UbsQualifiedDomainCode[];
  /** Domain labels as upstream printed them, parallel to `domains`. */
  domainLabels: string[];
  subDomainLabels: string[];
  definitionShort?: UbsProse;
  definitionLong?: UbsProse;
  comments?: UbsProse;
  glosses: string[];
  /** Decoded references. */
  references: UbsReference[];
  /** `LEXReferences` values this module could not decode. */
  unparsedReferences: string[];
  lastEdited?: string;
};

export type UbsEntry = {
  /** `"sdbh:000001000000000"` — dictionary plus upstream `MainId`. */
  id: string;
  dictionary: UbsDictionaryId;
  mainId: string;
  lemma: string;
  alphaPos?: string;
  hasAramaic: boolean;
  inLxx: boolean;
  multiWord: boolean;
  alternateLemmas: string[];
  partsOfSpeech: string[];
  /** Identity claims: canonical Strong's keys this entry IS. */
  strongKeys: string[];
  /** Constituent claims: keys this entry merely CONTAINS. */
  strongConstituents: string[];
  /** True when any code carried the `A` (Aramaic) sigil. */
  aramaicStrongCode: boolean;
  authors: string[];
  meaningIds: string[];
};

export type UbsDomainNode = {
  /** Namespaced code. */
  id: UbsQualifiedDomainCode;
  scheme: UbsDomainScheme;
  code: string;
  level: number;
  label: string;
  description?: string;
  comment?: string;
  prototype?: string;
  hasSubDomains: boolean;
  parent?: UbsQualifiedDomainCode;
};

/** Every problem the parse found, counted. A zero here is a claim. */
export type UbsParseDiagnostics = {
  entriesSeen: number;
  entriesWithoutStrongCode: number;
  meaningsSeen: number;
  meaningsWithoutSense: number;
  referencesSeen: number;
  referencesUndecodable: number;
  referenceFootnotesInline: number;
  strongCodesSeen: number;
  strongCodesRejected: Record<string, number>;
  strongCodeRejectionSamples: string[];
  aramaicSigilCodes: number;
  constituentClaims: number;
  /** Canonical keys claimed as an identity by more than one entry. */
  contestedIdentityKeys: string[];
  /** Numbers carrying both an `H` and an `A` code, i.e. upstream off-by-one. */
  aramaicHebrewNumberClashes: string[];
  inlineMarkerCounts: Record<string, number>;
  /** `{X:…}` tags this module does not model. Must stay empty. */
  unknownInlineTags: Record<string, number>;
  /** `{L:…}` markers whose angle brackets arrived HTML-escaped upstream. */
  htmlEscapedLinks: number;
  domainCodesNotInTree: string[];
  /** Localizations seen in `LEXSenses[].LanguageCode`. */
  senseLanguages: Record<string, number>;
};

export type UbsParsedDictionary = {
  dictionary: UbsDictionaryId;
  source: UbsSourceDescriptor;
  entries: UbsEntry[];
  meanings: UbsMeaning[];
  diagnostics: UbsParseDiagnostics;
};

export type ParseUbsDictionaryOptions = {
  /** Domain codes known to exist, for the referential-integrity check. */
  domainTree?: ReadonlySet<string>;
  /** Only keep senses in this language. Defaults to `"en"`. */
  language?: string;
  assumeTestament?: "H" | "G";
};

/**
 * Parse one whole UBS dictionary array into the normalised model.
 *
 * Throws on a non-array input rather than returning an empty result: a
 * silently empty parse is the exact false pass this repo's test conventions
 * forbid.
 */
export function parseUbsDictionary(
  dictionary: UbsDictionaryId,
  raw: unknown,
  options: ParseUbsDictionaryOptions = {},
): UbsParsedDictionary {
  if (!Array.isArray(raw)) {
    throw new Error(
      `parseUbsDictionary(${dictionary}): expected a top-level JSON array, received ${
        raw === null ? "null" : typeof raw
      }.`,
    );
  }
  const source = UBS_SOURCES[dictionary];
  const scheme = UBS_DOMAIN_SCHEME_OF[dictionary];
  const language = options.language ?? "en";
  const entries: UbsEntry[] = [];
  const meanings: UbsMeaning[] = [];
  const diag: UbsParseDiagnostics = {
    entriesSeen: 0,
    entriesWithoutStrongCode: 0,
    meaningsSeen: 0,
    meaningsWithoutSense: 0,
    referencesSeen: 0,
    referencesUndecodable: 0,
    referenceFootnotesInline: 0,
    strongCodesSeen: 0,
    strongCodesRejected: {},
    strongCodeRejectionSamples: [],
    aramaicSigilCodes: 0,
    constituentClaims: 0,
    contestedIdentityKeys: [],
    aramaicHebrewNumberClashes: [],
    inlineMarkerCounts: {},
    unknownInlineTags: {},
    htmlEscapedLinks: 0,
    domainCodesNotInTree: [],
    senseLanguages: {},
  };
  const identityOwners = new Map<string, Set<string>>();
  const hebrewNumbers = new Set<string>();
  const aramaicNumbers = new Set<string>();
  const badDomains = new Set<string>();

  const bump = (bag: Record<string, number>, key: string): void => {
    bag[key] = (bag[key] ?? 0) + 1;
  };
  const prose = (value: unknown): UbsProse | undefined => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const p = parseUbsProse(value);
    for (const m of p.markers) {
      bump(diag.inlineMarkerCounts, m.kind);
      if (m.kind === "unknown") bump(diag.unknownInlineTags, m.tag);
      if (m.kind === "link" && m.htmlEscaped) diag.htmlEscapedLinks += 1;
    }
    return p;
  };

  for (const rawEntry of raw as readonly RawUbsEntry[]) {
    diag.entriesSeen += 1;
    const mainId = typeof rawEntry.MainId === "string" ? rawEntry.MainId : "";
    const lemma = typeof rawEntry.Lemma === "string" ? rawEntry.Lemma : "";
    const entryId = `${dictionary}:${mainId}`;
    const codes = rawEntry.StrongCodes ?? [];
    diag.strongCodesSeen += codes.length;
    if (codes.length === 0) diag.entriesWithoutStrongCode += 1;
    const folded = parseUbsStrongCodes(codes, lemma, { ...(options.assumeTestament ? { assumeTestament: options.assumeTestament } : {}) });
    for (const r of folded.rejected) {
      bump(diag.strongCodesRejected, r.reason);
      if (diag.strongCodeRejectionSamples.length < 40) {
        diag.strongCodeRejectionSamples.push(`${entryId} ${r.reason} ${JSON.stringify(r.input)}`);
      }
    }
    let aramaicSeen = false;
    for (const r of [...folded.identity, ...folded.constituent]) {
      if (r.aramaic) {
        aramaicSeen = true;
        diag.aramaicSigilCodes += 1;
        aramaicNumbers.add(r.base);
      } else if (!r.compound) {
        hebrewNumbers.add(r.base);
      }
    }
    diag.constituentClaims += folded.constituent.length;
    for (const r of folded.identity) {
      let owners = identityOwners.get(r.canonical);
      if (!owners) {
        owners = new Set<string>();
        identityOwners.set(r.canonical, owners);
      }
      owners.add(entryId);
    }

    const meaningIds: string[] = [];
    for (const baseForm of rawEntry.BaseForms ?? []) {
      for (const lex of baseForm.LEXMeanings ?? []) {
        diag.meaningsSeen += 1;
        const lexId = typeof lex.LEXID === "string" ? lex.LEXID : `${mainId}#${diag.meaningsSeen}`;
        const meaningId = `${dictionary}:${lexId}`;
        const domains: UbsQualifiedDomainCode[] = [];
        const domainLabels: string[] = [];
        const subDomains: UbsQualifiedDomainCode[] = [];
        const subDomainLabels: string[] = [];
        for (const [key, codesOut, labelsOut] of [
          ["LEXDomains", domains, domainLabels],
          ["LEXSubDomains", subDomains, subDomainLabels],
        ] as const) {
          for (const d of (lex[key] ?? []) as readonly RawUbsDomainRef[]) {
            const q = qualifyUbsDomainCode(scheme, d.DomainCode);
            if (!q) continue;
            codesOut.push(q);
            labelsOut.push(typeof d.Domain === "string" ? d.Domain : "");
            if (options.domainTree && !options.domainTree.has(d.DomainCode as string)) {
              badDomains.add(`${scheme}:${d.DomainCode}`);
            }
          }
        }
        const sense =
          (lex.LEXSenses ?? []).find((s) => s.LanguageCode === language) ??
          (lex.LEXSenses ?? [])[0];
        if (!sense) diag.meaningsWithoutSense += 1;
        if (sense?.LanguageCode) bump(diag.senseLanguages, sense.LanguageCode);

        const references: UbsReference[] = [];
        const unparsedReferences: string[] = [];
        for (const r of lex.LEXReferences ?? []) {
          diag.referencesSeen += 1;
          if (typeof r === "string" && r.length !== 14) diag.referenceFootnotesInline += 1;
          const decoded = decodeUbsReference(r);
          if (decoded) references.push(decoded);
          else {
            diag.referencesUndecodable += 1;
            unparsedReferences.push(String(r));
          }
        }

        const louwNida = parseLouwNidaCode(lex.LEXEntryCode);
        const meaning: UbsMeaning = {
          id: meaningId,
          dictionary,
          entryId,
          indent: typeof lex.LEXIndent === "number" ? lex.LEXIndent : 0,
          domains,
          subDomains,
          domainLabels,
          subDomainLabels,
          glosses: (sense?.Glosses ?? []).filter((g): g is string => typeof g === "string" && g.trim() !== ""),
          references,
          unparsedReferences,
        };
        if (louwNida) meaning.louwNida = louwNida;
        if (lex.LEXIsBiblicalTerm) meaning.biblicalTerm = lex.LEXIsBiblicalTerm === "Y";
        const short = prose(sense?.DefinitionShort);
        if (short) meaning.definitionShort = short;
        const long = prose(sense?.DefinitionLong);
        if (long) meaning.definitionLong = long;
        const comments = prose(sense?.Comments);
        if (comments) meaning.comments = comments;
        if (sense?.LastEdited) meaning.lastEdited = sense.LastEdited;
        meanings.push(meaning);
        meaningIds.push(meaningId);
      }
    }

    const entry: UbsEntry = {
      id: entryId,
      dictionary,
      mainId,
      lemma,
      hasAramaic: rawEntry.HasAramaic === true,
      inLxx: rawEntry.InLXX === true,
      multiWord: isMultiWordLemma(lemma),
      alternateLemmas: (rawEntry.AlternateLemmas ?? []).filter((a): a is string => typeof a === "string"),
      partsOfSpeech: [
        ...new Set(
          (rawEntry.BaseForms ?? []).flatMap((b) =>
            (b.PartsOfSpeech ?? []).filter((p): p is string => typeof p === "string"),
          ),
        ),
      ],
      strongKeys: folded.identity.map((r) => r.canonical),
      strongConstituents: folded.constituent.flatMap((r) => r.components ?? [r.canonical]),
      aramaicStrongCode: aramaicSeen,
      authors: (rawEntry.Authors ?? []).filter((a): a is string => typeof a === "string" && a.trim() !== ""),
      meaningIds,
    };
    if (typeof rawEntry.AlphaPos === "string" && rawEntry.AlphaPos) entry.alphaPos = rawEntry.AlphaPos;
    entries.push(entry);
  }

  diag.contestedIdentityKeys = [...identityOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([key]) => key)
    .sort(compareCanonicalKey);
  diag.aramaicHebrewNumberClashes = [...aramaicNumbers]
    .filter((n) => hebrewNumbers.has(n))
    .sort(compareCanonicalKey);
  diag.domainCodesNotInTree = [...badDomains].sort();
  return { dictionary, source, entries, meanings, diagnostics: diag };
}

function compareCanonicalKey(a: string, b: string): number {
  const na = Number.parseInt(a.replace(/^[HG]/, ""), 10);
  const nb = Number.parseInt(b.replace(/^[HG]/, ""), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Parse a `…LexicalDomains…` companion file into a namespaced tree. */
export function parseUbsDomainTree(
  scheme: UbsDomainScheme,
  raw: unknown,
  language = "en",
): UbsDomainNode[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `parseUbsDomainTree(${scheme}): expected a top-level JSON array, received ${
        raw === null ? "null" : typeof raw
      }.`,
    );
  }
  const out: UbsDomainNode[] = [];
  for (const node of raw as readonly RawUbsDomainNode[]) {
    const id = qualifyUbsDomainCode(scheme, node.Code);
    if (!id) continue;
    const code = node.Code as string;
    const loc =
      (node.SemanticDomainLocalizations ?? []).find((l) => l.LanguageCode === language) ??
      (node.SemanticDomainLocalizations ?? [])[0];
    const parent = code.length > 3 ? qualifyUbsDomainCode(scheme, code.slice(0, code.length - 3)) : null;
    const built: UbsDomainNode = {
      id,
      scheme,
      code,
      level: typeof node.Level === "number" ? node.Level : code.length / 3,
      label: typeof loc?.Label === "string" ? loc.Label : "",
      hasSubDomains: node.HasSubDomains === true,
    };
    if (loc?.Description) built.description = loc.Description;
    if (loc?.Comment) built.comment = loc.Comment;
    if (node.Prototype) built.prototype = node.Prototype;
    if (parent) built.parent = parent;
    out.push(built);
  }
  return out;
}

/* ========================================================================== *
 * The built index
 * ========================================================================== */

export type UbsIndexSourceManifest = UbsSourceDescriptor & {
  sourceSha256: string;
  sourceBytes: number;
  domainSha256: string;
  domainBytes: number;
  entryCount: number;
  meaningCount: number;
  referenceCount: number;
  domainNodeCount: number;
  diagnostics: UbsParseDiagnostics;
};

/**
 * One entry as the built index stores it. Short keys and interned ids, for
 * one reason: the naive shape measured 102,757,374 bytes, against the 4,951,611
 * of `tipnr-index.json`. Use {@link readUbsEntry} rather than these keys.
 */
export type UbsCompactEntry = {
  /** Lemma. */
  l: string;
  /** Canonical Strong's keys this entry IS. */
  k?: string[];
  /** Canonical Strong's keys this entry merely CONTAINS. */
  c?: string[];
  /** Parts of speech, deduplicated across base forms. */
  p?: string[];
  /** Alternate lemmas. */
  a?: string[];
  /** Meaning indices, in upstream order. */
  m: number[];
  /** Flags: `A` any code carried the Aramaic sigil, `H` HasAramaic, `L` InLXX, `W` multi-word. */
  f?: string;
};

/** One inline marker, compactly. `[kind, primary, secondary?]`. */
export type UbsCompactMarker =
  | ["L", string, string]
  | ["D", string]
  | ["S", string]
  | ["A", string];

/** One lexical meaning as the built index stores it. See {@link readUbsMeaning}. */
export type UbsCompactMeaning = {
  /** Index into `entryIds`. */
  e: number;
  /** Louw-Nida entry code. SDGNT only. */
  ln?: string;
  /** Namespaced top-level domain codes. */
  d?: UbsQualifiedDomainCode[];
  /** Namespaced subdomain codes. SDGNT only. */
  s?: UbsQualifiedDomainCode[];
  /** `DefinitionShort`, inline markers stripped. */
  def?: string;
  /** `DefinitionLong`, inline markers stripped. */
  long?: string;
  /** `Comments`, inline markers stripped. */
  note?: string;
  /** Glosses. */
  g?: string[];
  /**
   * All Scripture references, as space-joined packed 14-digit strings.
   * Decode with {@link decodeUbsReference}; the labels are omitted because
   * they are wholly derivable and cost 74,794,528 bytes when stored.
   */
  r?: string;
  /** Inline markers worth navigating: links, `{D:}` xrefs, `{S:}` refs, `{A:}`. */
  x?: UbsCompactMarker[];
  /** `LEXIsBiblicalTerm === "Y"`. */
  bt?: 1;
  /** `LEXIndent`, omitted when 0. */
  in?: number;
};

export type UbsIndexFile = {
  version: 1;
  generatedAt: string;
  sourceRepo: typeof UBS_SOURCE_REPO;
  license: typeof UBS_LICENSE;
  licenseUrl: typeof UBS_LICENSE_URL;
  licenseRiders: readonly string[];
  attribution: Readonly<Record<UbsDictionaryId, string>>;
  /**
   * Stated in the file so no consumer has to rediscover it: the two
   * dictionaries' domain codes are different namespaces.
   */
  domainSchemeWarning: string;
  /** How to read the compact records, stated in the artefact itself. */
  readme: readonly string[];
  sources: UbsIndexSourceManifest[];
  domains: Record<string, UbsDomainNode>;
  /** `"sdbh:000001000000000"`, positionally parallel to `entries`. */
  entryIds: string[];
  entries: UbsCompactEntry[];
  /** `"sdbh:000001001001000"`, positionally parallel to `meanings`. */
  meaningIds: string[];
  meanings: UbsCompactMeaning[];
  /** Canonical Strong's key → entry indices that claim it as an identity. */
  byStrong: Record<string, number[]>;
  /** Canonical Strong's key → entry indices that merely contain it. */
  byStrongConstituent: Record<string, number[]>;
  /** Louw-Nida entry code → meaning indices. SDGNT only. */
  byLouwNida: Record<string, number[]>;
  /** Namespaced domain code → meaning indices, at the code's own depth. */
  byDomain: Record<string, number[]>;
  /** `"GEN.1.1"` → meaning indices citing that verse. */
  byRef: Record<string, number[]>;
  measurements: {
    hebrewJoin: typeof UBS_HEBREW_JOIN;
    greekJoin: typeof UBS_GREEK_JOIN;
  };
};

export const UBS_INDEX_README: readonly string[] = [
  "`entries` and `meanings` are positionally parallel to `entryIds` and " +
    "`meaningIds`; every by* map holds integer indices into those arrays. Ids " +
    "are \"<dictionary>:<upstream MainId or LEXID>\".",
  "Compact entry keys: l lemma, k identity Strong's keys, c constituent " +
    "Strong's keys, p parts of speech, a alternate lemmas, m meaning indices, " +
    "f flags (A=Aramaic sigil on a code, H=HasAramaic, L=InLXX, W=multi-word lemma).",
  "Compact meaning keys: e entry index, ln Louw-Nida entry code (SDGNT only), " +
    "d domains, s subdomains, def/long/note prose with inline markers stripped, " +
    "g glosses, r space-joined packed 14-digit references, x inline markers, " +
    "bt biblical term, in indent.",
  "`r` holds raw BBBCCCVVVSSWWW strings. Decode with decodeUbsReference in " +
    "src/core/language/ubs-semantic-dictionary.ts. WWW/2 is a MORPHEME ordinal, " +
    "not a token ordinal — Hebrew prefixes count as separate words upstream.",
  "Domain labels are not stored on meanings; resolve them through `domains`, " +
    "keyed by the same namespaced code.",
];

export const UBS_DOMAIN_SCHEME_WARNING =
  "Domain codes in this file are NAMESPACED (\"sdbh:001002004\", " +
  "\"louw-nida:053005\") because SDBH and SDGNT use different taxonomies " +
  "behind identical-looking digit strings. 18 codes exist in both trees and " +
  "on none of them do the labels agree: \"001002\" is \"Regions On the Earth\" " +
  "in SDBH and \"Regions Above the Earth\" in SDGNT. Never strip the prefix " +
  "and never compare a bare code across dictionaries.";

/**
 * Assemble the built index. Pure: the caller supplies already-parsed parts
 * and the file bytes' digests.
 *
 * Throws when any part is empty. Every count in the manifest is asserted
 * non-zero here, so a run that parsed nothing fails loudly instead of
 * writing a well-formed empty index.
 */
export function buildUbsIndex(input: {
  generatedAt: string;
  parts: readonly {
    parsed: UbsParsedDictionary;
    domainNodes: readonly UbsDomainNode[];
    sourceSha256: string;
    sourceBytes: number;
    domainSha256: string;
    domainBytes: number;
  }[];
}): UbsIndexFile {
  if (input.parts.length === 0) {
    throw new Error("buildUbsIndex: no dictionaries supplied.");
  }
  const sources: UbsIndexSourceManifest[] = [];
  const domains: Record<string, UbsDomainNode> = {};
  const entryIds: string[] = [];
  const entries: UbsCompactEntry[] = [];
  const meaningIds: string[] = [];
  const meanings: UbsCompactMeaning[] = [];
  const byStrong: Record<string, number[]> = {};
  const byStrongConstituent: Record<string, number[]> = {};
  const byLouwNida: Record<string, number[]> = {};
  const byDomain: Record<string, number[]> = {};
  const byRef: Record<string, number[]> = {};

  const push = (bag: Record<string, number[]>, key: string, value: number): void => {
    const list = bag[key];
    if (list) {
      if (list[list.length - 1] !== value) list.push(value);
    } else bag[key] = [value];
  };

  for (const part of input.parts) {
    const { parsed } = part;
    if (parsed.entries.length === 0) {
      throw new Error(`buildUbsIndex: ${parsed.dictionary} parsed 0 entries.`);
    }
    if (parsed.meanings.length === 0) {
      throw new Error(`buildUbsIndex: ${parsed.dictionary} parsed 0 meanings.`);
    }
    if (part.domainNodes.length === 0) {
      throw new Error(`buildUbsIndex: ${parsed.dictionary} parsed 0 domain nodes.`);
    }
    for (const node of part.domainNodes) domains[node.id] = node;

    // Intern entry ids first so a meaning can point at its entry by index.
    const entryIndexOf = new Map<string, number>();
    for (const entry of parsed.entries) {
      const at = entryIds.length;
      entryIndexOf.set(entry.id, at);
      entryIds.push(entry.id);
      const flags =
        (entry.aramaicStrongCode ? "A" : "") +
        (entry.hasAramaic ? "H" : "") +
        (entry.inLxx ? "L" : "") +
        (entry.multiWord ? "W" : "");
      const compact: UbsCompactEntry = { l: entry.lemma, m: [] };
      if (entry.strongKeys.length > 0) compact.k = entry.strongKeys;
      if (entry.strongConstituents.length > 0) compact.c = entry.strongConstituents;
      if (entry.partsOfSpeech.length > 0) compact.p = entry.partsOfSpeech;
      if (entry.alternateLemmas.length > 0) compact.a = entry.alternateLemmas;
      if (flags) compact.f = flags;
      entries.push(compact);
      for (const key of entry.strongKeys) push(byStrong, key, at);
      for (const key of entry.strongConstituents) push(byStrongConstituent, key, at);
    }

    let referenceCount = 0;
    for (const meaning of parsed.meanings) {
      const at = meanings.length;
      const entryIndex = entryIndexOf.get(meaning.entryId);
      if (entryIndex === undefined) {
        throw new Error(
          `buildUbsIndex: meaning ${meaning.id} points at unknown entry ${meaning.entryId}.`,
        );
      }
      meaningIds.push(meaning.id);
      const compact: UbsCompactMeaning = { e: entryIndex };
      if (meaning.louwNida) compact.ln = meaning.louwNida.code;
      if (meaning.domains.length > 0) compact.d = meaning.domains;
      if (meaning.subDomains.length > 0) compact.s = meaning.subDomains;
      if (meaning.definitionShort?.text) compact.def = meaning.definitionShort.text;
      if (meaning.definitionLong?.text) compact.long = meaning.definitionLong.text;
      if (meaning.comments?.text) compact.note = meaning.comments.text;
      if (meaning.glosses.length > 0) compact.g = meaning.glosses;
      if (meaning.references.length > 0) {
        compact.r = meaning.references.map((r) => r.packed).join(" ");
      }
      const markers = compactMarkers(meaning);
      if (markers.length > 0) compact.x = markers;
      if (meaning.biblicalTerm) compact.bt = 1;
      if (meaning.indent !== 0) compact.in = meaning.indent;
      meanings.push(compact);
      entries[entryIndex]!.m.push(at);
      if (meaning.louwNida) push(byLouwNida, meaning.louwNida.code, at);
      for (const d of meaning.domains) push(byDomain, d, at);
      for (const d of meaning.subDomains) push(byDomain, d, at);
      for (const ref of meaning.references) {
        referenceCount += 1;
        push(byRef, ref.ref, at);
      }
    }
    if (referenceCount === 0) {
      throw new Error(`buildUbsIndex: ${parsed.dictionary} decoded 0 references.`);
    }
    sources.push({
      ...parsed.source,
      sourceSha256: part.sourceSha256,
      sourceBytes: part.sourceBytes,
      domainSha256: part.domainSha256,
      domainBytes: part.domainBytes,
      entryCount: parsed.entries.length,
      meaningCount: parsed.meanings.length,
      referenceCount,
      domainNodeCount: part.domainNodes.length,
      diagnostics: parsed.diagnostics,
    });
  }
  if (Object.keys(byStrong).length === 0) {
    throw new Error("buildUbsIndex: byStrong is empty — the Strong's join produced nothing.");
  }
  if (Object.keys(byRef).length === 0) {
    throw new Error("buildUbsIndex: byRef is empty — no reference decoded to a verse.");
  }
  if (Object.keys(byLouwNida).length === 0) {
    throw new Error("buildUbsIndex: byLouwNida is empty — SDGNT's Louw-Nida keys did not survive.");
  }
  return {
    version: 1,
    generatedAt: input.generatedAt,
    sourceRepo: UBS_SOURCE_REPO,
    license: UBS_LICENSE,
    licenseUrl: UBS_LICENSE_URL,
    licenseRiders: UBS_LICENSE_RIDERS,
    attribution: UBS_ATTRIBUTION,
    domainSchemeWarning: UBS_DOMAIN_SCHEME_WARNING,
    readme: UBS_INDEX_README,
    sources,
    domains,
    entryIds,
    entries,
    meaningIds,
    meanings,
    byStrong,
    byStrongConstituent,
    byLouwNida,
    byDomain,
    byRef,
    measurements: { hebrewJoin: UBS_HEBREW_JOIN, greekJoin: UBS_GREEK_JOIN },
  };
}

/**
 * Keep the inline markers a reader can act on — cross-entry links, `{D:}`
 * Louw-Nida cross-references, `{S:}` embedded references, `{A:}` version
 * citations — and drop `{N:}` footnote pointers, whose `Notes` payload this
 * index does not carry, so the pointer would dangle.
 */
function compactMarkers(meaning: UbsMeaning): UbsCompactMarker[] {
  const out: UbsCompactMarker[] = [];
  const seen = new Set<string>();
  for (const prose of [meaning.definitionShort, meaning.definitionLong, meaning.comments]) {
    for (const m of prose?.markers ?? []) {
      let tuple: UbsCompactMarker | null = null;
      if (m.kind === "link") tuple = ["L", m.text, m.target];
      else if (m.kind === "domain-xref") tuple = ["D", m.code];
      else if (m.kind === "reference") tuple = ["S", m.packed];
      else if (m.kind === "authority") tuple = ["A", m.abbreviation];
      if (!tuple) continue;
      const key = tuple.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tuple);
    }
  }
  return out;
}

/* ========================================================================== *
 * Lookup helpers over a built index
 * ========================================================================== */

/** A meaning read back out of the compact index, with its ids restored. */
export type UbsMeaningView = {
  index: number;
  id: string;
  dictionary: UbsDictionaryId;
  entryIndex: number;
  entryId: string;
  lemma: string;
  louwNida?: LouwNidaCode;
  domains: UbsQualifiedDomainCode[];
  subDomains: UbsQualifiedDomainCode[];
  glosses: string[];
  definitionShort?: string;
  definitionLong?: string;
  comments?: string;
  references: UbsReference[];
  markers: UbsCompactMarker[];
  biblicalTerm: boolean;
  indent: number;
};

/** An entry read back out of the compact index. */
export type UbsEntryView = {
  index: number;
  id: string;
  dictionary: UbsDictionaryId;
  lemma: string;
  strongKeys: string[];
  strongConstituents: string[];
  partsOfSpeech: string[];
  alternateLemmas: string[];
  aramaicStrongCode: boolean;
  hasAramaic: boolean;
  inLxx: boolean;
  multiWord: boolean;
  meaningIndices: number[];
};

function dictionaryOfId(id: string): UbsDictionaryId {
  return id.startsWith("sdgnt:") ? "sdgnt" : "sdbh";
}

/** Expand one compact entry. Returns `null` when the index is out of range. */
export function readUbsEntry(
  index: Pick<UbsIndexFile, "entries" | "entryIds">,
  at: number,
): UbsEntryView | null {
  const compact = index.entries[at];
  const id = index.entryIds[at];
  if (!compact || id === undefined) return null;
  const flags = compact.f ?? "";
  return {
    index: at,
    id,
    dictionary: dictionaryOfId(id),
    lemma: compact.l,
    strongKeys: compact.k ?? [],
    strongConstituents: compact.c ?? [],
    partsOfSpeech: compact.p ?? [],
    alternateLemmas: compact.a ?? [],
    aramaicStrongCode: flags.includes("A"),
    hasAramaic: flags.includes("H"),
    inLxx: flags.includes("L"),
    multiWord: flags.includes("W"),
    meaningIndices: compact.m,
  };
}

/** Expand one compact meaning, decoding its packed references. */
export function readUbsMeaning(
  index: Pick<UbsIndexFile, "meanings" | "meaningIds" | "entries" | "entryIds">,
  at: number,
): UbsMeaningView | null {
  const compact = index.meanings[at];
  const id = index.meaningIds[at];
  if (!compact || id === undefined) return null;
  const entryId = index.entryIds[compact.e];
  const references: UbsReference[] = [];
  for (const packed of (compact.r ?? "").split(" ")) {
    if (!packed) continue;
    const decoded = decodeUbsReference(packed);
    if (decoded) references.push(decoded);
  }
  const view: UbsMeaningView = {
    index: at,
    id,
    dictionary: dictionaryOfId(id),
    entryIndex: compact.e,
    entryId: entryId ?? "",
    lemma: index.entries[compact.e]?.l ?? "",
    domains: compact.d ?? [],
    subDomains: compact.s ?? [],
    glosses: compact.g ?? [],
    references,
    markers: compact.x ?? [],
    biblicalTerm: compact.bt === 1,
    indent: compact.in ?? 0,
  };
  const ln = parseLouwNidaCode(compact.ln);
  if (ln) view.louwNida = ln;
  if (compact.def) view.definitionShort = compact.def;
  if (compact.long) view.definitionLong = compact.long;
  if (compact.note) view.comments = compact.note;
  return view;
}

/**
 * Resolve a Strong's key to UBS entries, base-first.
 *
 * Tries the canonical key as given, then its base. The order matters and the
 * fallback is not optional: insisting on the sense letter costs 12.582
 * percentage points of Hebrew running text (see {@link UBS_HEBREW_JOIN}).
 */
export function lookupUbsByStrong(
  index: Pick<UbsIndexFile, "byStrong" | "entries" | "entryIds">,
  rawKey: unknown,
): { matchedKey: string; matchedOn: "canonical" | "base"; entries: UbsEntryView[] } | null {
  const canonical = canonicalStrongsKey(rawKey, { trustSuffixCase: true });
  if (!canonical) return null;
  const read = (key: string, matchedOn: "canonical" | "base") => {
    const hits = index.byStrong[key];
    if (!hits || hits.length === 0) return null;
    const views = hits
      .map((at) => readUbsEntry(index, at))
      .filter((e): e is UbsEntryView => e !== null);
    return views.length > 0 ? { matchedKey: key, matchedOn, entries: views } : null;
  };
  const exact = read(canonical, "canonical");
  if (exact) return exact;
  const base = canonical.replace(/[A-Za-z]$/, "");
  if (base === canonical) return null;
  return read(base, "base");
}

/**
 * Resolve a MACULA `token.louwNida` value to SDGNT meanings.
 *
 * Handles the space-separated multi-value form. Returns one group per code so
 * a caller can show "this token sits in two domains" rather than picking one.
 */
export function lookupUbsByLouwNida(
  index: Pick<UbsIndexFile, "byLouwNida" | "meanings" | "meaningIds" | "entries" | "entryIds">,
  rawValue: unknown,
): { code: LouwNidaCode; meanings: UbsMeaningView[] }[] {
  const { codes } = parseLouwNidaList(rawValue);
  const out: { code: LouwNidaCode; meanings: UbsMeaningView[] }[] = [];
  for (const code of codes) {
    const hits = index.byLouwNida[code.code] ?? [];
    out.push({
      code,
      meanings: hits
        .map((at) => readUbsMeaning(index, at))
        .filter((m): m is UbsMeaningView => m !== null),
    });
  }
  return out;
}

/** Render a domain node's full path, outermost first: `"Objects › Flora › Vegetation"`. */
export function ubsDomainPath(
  domains: Readonly<Record<string, UbsDomainNode>>,
  qualified: unknown,
): string[] {
  return ubsDomainAncestry(qualified)
    .map((id) => domains[id]?.label)
    .filter((label): label is string => typeof label === "string" && label !== "");
}
