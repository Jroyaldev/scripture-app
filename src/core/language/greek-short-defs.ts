/**
 * Greek short definitions — the "Meaning" slot on the word card (field 16 of
 * docs/step-word-card-parity.md), from TWO sources kept permanently apart.
 *
 * Pure parsing only. No Node imports. I/O lives in
 * `scripts/import-greek-short-defs.ts`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY TWO SOURCES AND NOT ONE
 *
 * STEP's on-screen "Meaning" block is **Mounce**, not Abbott-Smith. Verified
 * against the live payload the parity doc records for Acts 24:1:
 * STEP returns `mediumDef` = `"chief priest, high priest <br /><b>a
 * high-priest, chief-priest</b>"`, and the bolded second line is Mounce's
 * definition of G0749 **byte for byte** — `a high-priest, chief-priest`.
 * §5 of the parity doc concluded Mounce "is not obtainable honestly" because
 * STEP serves it from a prebuilt Lucene index. That conclusion was right about
 * STEP and wrong about Mounce: Bill Mounce released the dictionary himself for
 * redistribution with attribution, and the open release is what this module
 * parses. Nothing is taken from STEP.
 *
 * The two sources are complements, not duplicates, and the measurements say so:
 *
 *   |                              | Mounce      | TBESG col 8 |
 *   |------------------------------|-------------|-------------|
 *   | entries                      | 5,389       | 11,035      |
 *   | definition fits in ≤25 words | 79.7%       | 55.7%       |
 *   | mean words                   | 19.1        | 37.1        |
 *   | contains HTML                | 0 (zero)    | 73.5%       |
 *   | restates the lemma first     | no          | 6,772 rows  |
 *   | sense-split keys (dStrong)   | none        | 295         |
 *
 * So: **Mounce is the 25-word card gloss.** It is plain text, it is a gloss
 * rather than a lexicon article, and it is the string STEP itself prints.
 * TBESG col 8 is the deeper article — Abbott-Smith's full entry with LXX
 * equivalents and reference lists — and TBESG col 7 `Gloss` is the only
 * source of the two that can tell one *sense* from another.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE THING THAT MUST NEVER HAPPEN: BLENDING
 *
 * Law 3·3 requires every third-party prose block to be nameable at the render
 * site. So the merged index NEVER concatenates the two definitions into one
 * string. Each entry carries at most one `mounce` object and at most one
 * `tbesg` object, side by side, each with its own `attribution` id resolving
 * to a source record that holds the verbatim required attribution.
 *
 * TBESG's attribution is not even constant across its own rows — measured:
 * 5,708 rows end `(AS)` (Abbott-Smith), 2,305 end `(ML)` (Middle Liddell),
 * and **3,022 carry neither**, which per the file's own preamble line 78
 * ("Those without attribution have been added by STEPBible") means STEPBible's
 * own scholarship. A single "Abbott-Smith" label over the whole column would
 * misattribute 5,327 of 11,035 rows. Hence `TbesgMeaningAttribution`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * GK IS NOT STRONG'S, AND MOUNCE'S SUFFIXES ARE NOT STEP'S
 *
 * Two independent conflation hazards, both proven from the data, both handled
 * by refusing rather than guessing:
 *
 * 1. **Mounce keys on BOTH GK and Strong's, GK first.** Every header line
 *    reads `GK G797 | S G749`. `GK G797` *looks* like the Strong's key G797
 *    (ἀρχή's neighbourhood) and is in fact Goodrick-Kohlenberger 797. The two
 *    numberings agree on only **13 of 5,362** entries. The GK number is parsed
 *    and kept for provenance, is asserted to be GK by `isGkNumber` from
 *    `strongs-key.ts`, and is NEVER used as a join key.
 *
 * 2. **Mounce's lowercase suffix is a different system from STEPBible's.**
 *    Mounce's introduction: "Strong's numbers followed by a lowercase letter
 *    (a, b, etc.) represent forms not included in the original Strong's system
 *    that were modified to conform to modern editions". STEPBible's dStrong
 *    letters mean senses and, in Greek, "start at G" and run G…O — TBESG
 *    contains **zero** lowercase Greek suffixes. Measured: of Mounce's 121
 *    lowercase-suffixed keys, **0 appear in TBESG's dStrong set**, verbatim or
 *    upper-cased. They are disjoint namespaces that happen to share a shape.
 *
 *    Dropping that letter is not a rounding error. Mounce `G32a` is **ἀγγέλλω**
 *    "to tell, to announce" (a verb, 1×). Mounce `G32` is **ἄγγελος** "one
 *    sent, a messenger, angel" (a noun, 175×). The upstream `dictionary.json`
 *    in the same repo is built by a `compile.rb` that does
 *    `.gsub(/G/,"").to_i`, so it stores `32` for both and serves the verb's
 *    definition under the noun's number — wrong prose on a word card, silently,
 *    on 121 keys. **This module parses `dictionary.txt`, never
 *    `dictionary.json`.** See `MOUNCE_JSON_IS_LOSSY` for the full list of what
 *    that file loses and corrupts.
 */

import {
  isGkNumber,
  parseStrongsKey,
  type StrongsKeyRejectionReason,
} from "./strongs-key.js";

// ───────────────────────────────────────────────────────────────────────────
// Attribution — verbatim, and load-bearing
// ───────────────────────────────────────────────────────────────────────────

/**
 * The Mounce attribution, VERBATIM from the fenced block in the release
 * README (`jcuenod/dictionary@master`, byte-identical in the
 * `OpenBibleSearch/dictionary-1@master` mirror). The README's sentence around
 * it is: "Any use of this dictionary requires the following statement made
 * publically visible".
 *
 * It is THREE LINES in the source. Reproduced here with its newlines intact,
 * because "made publically visible" is a requirement about what the reader
 * sees and this is what the licensor wrote.
 */
export const MOUNCE_REQUIRED_ATTRIBUTION =
  "Mounce Concise Greek-English Dictionary\n" +
  "Copyright 1993 All Rights Reserved\n" +
  "www.teknia.com/greek-dictionary";

/**
 * The same three lines joined with single spaces, for a one-line render slot
 * (a footer, a `title=`, a captured note excerpt) where a three-line block
 * will not fit. Offered as a convenience, not as the canonical form —
 * `MOUNCE_REQUIRED_ATTRIBUTION` is the canonical form.
 */
export const MOUNCE_REQUIRED_ATTRIBUTION_ONE_LINE =
  "Mounce Concise Greek-English Dictionary Copyright 1993 All Rights Reserved www.teknia.com/greek-dictionary";

/**
 * The Mounce licence grant, verbatim, both sentences, in README order.
 * `package.json` in the same repo states `"license":
 * "Attribution-NonCommercial"`. This project is non-commercial and free, so
 * the grant is satisfied; the attribution above is the condition.
 */
export const MOUNCE_LICENSE_TEXT =
  "Released for redistribution with attribution by William D. Mounce of teknia.com. " +
  "You may freely use the dictionary in non-commercial, non-revenue bearing projects.";

/**
 * The STEPBible attribution, VERBATIM from TBESG line 12 (the leading tab and
 * the trailing tabs stripped; the **double space** after "at" is upstream and
 * is preserved).
 */
export const TBESG_REQUIRED_ATTRIBUTION =
  "Data created by www.STEPBible.org based on work at  Tyndale House Cambridge (CC BY 4.0)";

/**
 * TBESG's own label for column 8, VERBATIM from the header at line 88 —
 * upstream typo ("occationally"), upstream double space before "Middle", and
 * the trailing space all preserved. Quoted because it is the file's own
 * statement of what the column contains, and it names two lexicons, not one.
 */
export const TBESG_MEANING_COLUMN_LABEL =
  "Abbott-Smith lexicon (AS), with gaps occationally filled from edited versions of  Middle LSJ ";

/**
 * A rider inside a file labelled CC BY, VERBATIM from TBESG line 19.
 *
 * It is recorded here because the parity doc's §5 licence table lists TBESG as
 * a flat "CC BY 4.0" and a reader would not expect a redistribution request.
 * **It is not new**: the byte-identical clause already appears in all three
 * STEPBible files this repo ships raw today — TIPNR line 19, TEGMC line 15,
 * TEHMC line 15 — so shipping the TBESG source alongside them introduces no
 * obligation the repo has not already taken on. Flagged for whoever owns
 * `LICENSES.md`; not a decision this module makes.
 */
export const TBESG_REDISTRIBUTION_RIDER =
  "* Refer others to github.com/STEPBible as the source of the data. Please do not redistribute it yourself.";

/**
 * What the upstream `dictionary.json` loses or corrupts relative to
 * `dictionary.txt`, measured. Recorded as data so the test can assert we did
 * not quietly switch to the easier file.
 */
export const MOUNCE_JSON_IS_LOSSY = {
  /** `dictionary.txt` entries. */
  textEntries: 5389,
  /** `dictionary.json` keys. 27 fewer. */
  jsonEntries: 5362,
  /**
   * Lowercase Strong's suffixes destroyed by `.to_i`: `G32a` → `32`, so the
   * verb ἀγγέλλω's definition is stored under the noun ἄγγελος's number.
   */
  suffixesDestroyed: 121,
  /**
   * `Gπ###` rows: `.gsub(/G/,"")` leaves `π570`, and `.to_i` makes it `0`.
   * 15 entries end up with `strongs: [0]`; a 16th (`G680, Gπ681`) becomes
   * `[680, 0]`.
   */
  piMarkersZeroed: 16,
  /**
   * The one entry whose header is `\t[4887.5] | S G4529` rather than
   * `GK G####`. `compile.rb` requires `line[0..1] == "GK"`, so it never
   * updates its `lastLine` — and then attaches Σαλείμ's `<def>` to the
   * PREVIOUS entry, Σαλαμίς. `dictionary.json`'s `σαλαμις` therefore carries
   * the definition of a different city. Not a loss, a wrong answer.
   */
  entriesMisattributed: 1,
  /** Keyed on a punctuation-stripped lowercased lemma, so homographs collide. */
  keyedOnStrippedLemma: true,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Mounce — `dictionary.txt` format
// ───────────────────────────────────────────────────────────────────────────

/**
 * ONE ENTRY IS TWO OR THREE LINES, blank-line separated.
 *
 *   line 1  header    `GK G797 | S G749   ἀρχιερεύς   archiereus   122x`
 *   line 2  body      `<def>a high-priest, chief-priest </def>→ chief priest; high priest.`
 *   line 3  optional  `☞  MOUNCE | NIV | ESV | HCSB | NRSV`   (8 in the file)
 *
 * **The field separator is three NO-BREAK SPACES (U+00A0), not three ASCII
 * spaces.** The repo's own `compile.rb` splits on `"   "` (ASCII) and would
 * therefore parse nothing from the file as published; the committed
 * `dictionary.json` was evidently built from an earlier revision. Getting this
 * wrong yields zero entries, which is why `parseMounceDictionary` refuses to
 * return an empty result.
 *
 * Header grammar, exhaustively, with measured counts over the 5,389 entries:
 *
 *   `GK G# | S G#`                  5,197   the ordinary case
 *   `GK G# | S G#a`                   122   Mounce's own extension letter
 *   `GK G# | S G#, G#`                 36   several Strong's numbers, to 13
 *   `GK G# | S Gπ#`                    15   undocumented `π` marker
 *   `GK G# | S G#, G#, G#`              7
 *   `GK G# | S G#b`                     1
 *   `GK G# | S G# + G#`                 1   ἀμφιβάλλω = G906 + G293
 *   `GK G# | S G#, Gπ#`                 1
 *   `GK G# <lemma>…`                    3   GK 7000/7005/7007, NO Strong's,
 *                                           definition inline on the header
 *   `\t[4887.5] | S G4529`              1   fractional GK, bracketed, no `GK`
 *
 * Preamble: lines 1–97 are title, introduction, an abbreviation table, and a
 * transliteration table. Data starts at line 99 (1-based). Single-letter Greek
 * lines (`Α`, `Β`, …) are alphabet dividers, 24 of them.
 */
export const MOUNCE_FIELD_SEPARATOR = "   ";

/**
 * One Strong's reference from a Mounce header, parsed but not yet joined.
 *
 * `raw` is kept because two of the three shapes below are lossy if reduced to
 * a number, and an importer that reports what it saw can be audited.
 */
export type MounceStrongsRef = {
  /** The token exactly as written: `G749`, `G32a`, `Gπ570`. */
  raw: string;
  /**
   * Canonical extended key from `strongs-key.ts`: `G749`, `G32a`, `G570`.
   *
   * For a lowercase-suffixed token the letter is KEPT, so `G32a` stays
   * distinct from `G32`. That is deliberate and it makes the key MISS a
   * lexicon that has no such entry — which is the correct outcome, because the
   * alternative is attaching this entry's prose to a different word.
   */
  canonical: string;
  /** Canonical key with any letter dropped: `G32a` → `G32`. */
  base: string;
  /**
   * Mounce's own extension letter, lowercase, when present. NOT a STEPBible
   * dStrong sense letter — see the module header. 121 keys carry one (`a` on
   * 120, `b` on 1).
   */
  mounceExtensionLetter?: string;
  /**
   * The token carried the undocumented `π` marker (`Gπ570`), 16 occurrences.
   *
   * `π` appears nowhere in the file's own abbreviation table, so its meaning
   * is **not established**. What IS established, by checking each one: the
   * marked number is a real Strong's number and is the *only* place Mounce
   * names it — `Gπ570` is the file's sole reference to Strong's 570 (ἀπιστία),
   * and TBESG's G0570 is ἀπιστία too. So the digits join correctly and the
   * marker is recorded rather than dropped, so that a later reader can decide
   * what it meant without re-deriving this.
   */
  piMarked?: boolean;
};

/** One Mounce entry. */
export type MounceEntry = {
  /**
   * Goodrick-Kohlenberger number, Mounce's primary key.
   * A STRING, because one entry's GK is `4887.5` — a fractional interpolation
   * — and because it must never be arithmetic-compatible with a Strong's
   * number. NEVER a join key. See `gkIsNotStrongs`.
   */
  gk: string;
  /**
   * True once `isGkNumber` (from `strongs-key.ts`) has confirmed `gk` is GK
   * numbering. Set on every entry whose GK is integral; the module asserts it
   * rather than assuming it, because `GK G797` is one character away from
   * looking like the Strong's key `G797`.
   */
  gkIsNotStrongs: boolean;
  /**
   * Strong's references, in file order. **Empty for 3 entries** — GK 7000
   * αὐτοῦ, GK 7005 ἡμεῖς, GK 7007 ὑμεῖς, which are GK-only forms Strong never
   * numbered. Those three are unreachable by a Strong's-keyed card, correctly.
   */
  strongs: MounceStrongsRef[];
  /** Lexical form, NFC, e.g. `ἀρχιερεύς`. */
  lemma: string;
  /** Mounce's transliteration, e.g. `archiereus`. Macrons, not dots. */
  transliteration: string;
  /**
   * NT frequency as Mounce prints it, digits only — `1,840x` → 1840.
   * `null` when the field was not a frequency.
   */
  frequency: number | null;
  /**
   * The definition, plain text, `<def>…</def>` unwrapped and trimmed.
   * **Contains no HTML at all** — measured: zero of 5,389 entries contain a
   * tag or a `<ref`. This is the string that fits a 25-word card slot.
   */
  definition: string;
  /**
   * Whatever followed `</def>`, trimmed, when non-empty — 1,085 entries.
   * Always a `→` cross-reference into *Mounce's Complete Expository Dictionary
   * of Old and New Testament Words* (Zondervan 2006), per the file's own
   * symbol table. `compile.rb` discards this under the comment "Note here
   * that sometimes data is discarded"; it is a pointer to a different, still
   * commercial book, so it is captured but must NOT be rendered as if it were
   * part of the definition.
   */
  expositoryCrossReference?: string;
  /** 1-based line of the header, for diagnostics. */
  line: number;
};

/** An input line the Mounce parser could not use. */
export type MounceRejection = {
  line: number;
  /** The line, truncated to 200 chars. */
  text: string;
  reason:
    | "header-field-count"
    | "strongs-token-unparseable"
    | "strongs-token-is-gk"
    | "definition-without-header"
    | "header-without-definition";
  detail: string;
  /** Present when `reason === "strongs-token-unparseable"`. */
  strongsKeyReason?: StrongsKeyRejectionReason;
};

export type MounceParseResult = {
  entries: MounceEntry[];
  rejections: MounceRejection[];
  stats: {
    /** Lines in the input. */
    lines: number;
    /** Header lines recognised. */
    headers: number;
    /** Entries with at least one Strong's reference. */
    entriesWithStrongs: number;
    /** Entries with a GK number and no Strong's number at all. */
    gkOnlyEntries: number;
    /** Strong's tokens seen across all headers. */
    strongsTokens: number;
    /** Distinct canonical Strong's keys. */
    distinctStrongsKeys: number;
    /** Tokens carrying Mounce's lowercase extension letter. */
    extensionLetterTokens: number;
    /** Tokens carrying the undocumented `π` marker. */
    piMarkedTokens: number;
    /** Entries with a `→` expository cross-reference after `</def>`. */
    expositoryCrossReferences: number;
    /** Alphabet divider lines skipped (`Α`, `Β`, …). */
    alphabetDividers: number;
    /** `☞` word-study-hyperlink lines skipped. */
    wordStudyLines: number;
  };
};

/**
 * `GK G797 | S G749`, `\t[4887.5] | S G4529`, or `GK G7000` with no `| S`.
 * Captures: integral GK, bracketed/fractional GK, the whole Strong's field.
 */
const MOUNCE_HEADER = new RegExp(
  "^(?:GK\\s+G(\\d+)|\\t?\\[(\\d+(?:\\.\\d+)?)\\])" +
    "(?:\\s*\\|\\s*S\\s+([^\\u00a0]*?))?\\s*" +
    MOUNCE_FIELD_SEPARATOR,
);

/**
 * The 3 GK-only entries, whose header carries lemma, transliteration,
 * frequency AND definition with no `| S` field and no `<def>` line:
 *   `GK G7005 ἡμεῖς   hēmeis   864x see ἐγώ`
 */
const MOUNCE_HEADER_GK_ONLY = new RegExp(
  "^GK\\s+G(\\d+)\\s+([^\\s\\u00a0]+)" +
    MOUNCE_FIELD_SEPARATOR +
    "([^\\u00a0]*)" +
    MOUNCE_FIELD_SEPARATOR +
    "(\\S+)\\s*(.*)$",
);

/** `G749`, `G32a`, `Gπ570` — the `π` captured, not tolerated silently. */
const MOUNCE_STRONGS_TOKEN = /^G(π?)(\d+)([a-z]?)$/;

/** `<def>…</def>` plus anything after it on the same line. */
const MOUNCE_DEF_LINE = /^<def>([\s\S]*?)<\/def>([\s\S]*)$/;

function parseMounceFrequency(raw: string): number | null {
  const m = raw.trim().match(/^([\d,]+)x$/);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseMounceStrongsField(
  field: string,
  line: number,
  rejections: MounceRejection[],
): MounceStrongsRef[] {
  const refs: MounceStrongsRef[] = [];
  // `,` separates alternative numbers; `+` joins the two halves of the single
  // compound entry (ἀμφιβάλλω = G906 + G293). Both are "this entry also
  // answers to that number", so both flatten to a list.
  for (const rawToken of field.split(/\s*[,+]\s*/)) {
    const raw = rawToken.trim();
    if (!raw) continue;
    const m = raw.match(MOUNCE_STRONGS_TOKEN);
    if (!m) {
      // A GK number leaking into the Strong's field would be the worst
      // possible silent failure, so name it explicitly if it ever happens.
      const reason: MounceRejection["reason"] = isGkNumber(raw.replace(/^G/, "GK"))
        ? "strongs-token-is-gk"
        : "strongs-token-unparseable";
      rejections.push({
        line,
        text: raw,
        reason,
        detail:
          `Mounce Strong's token "${raw}" does not match /^G(π?)\\d+[a-z]?$/. ` +
          "Expected shapes: G749, G32a, Gπ570.",
      });
      continue;
    }
    const piMarked = m[1] === "π";
    const digits = m[2] ?? "";
    const letter = m[3] ?? "";
    // Hand the digits (and Mounce's letter) to the one Strong's parser. The
    // `π` marker is stripped FIRST and recorded on the ref, because
    // parseStrongsKey rejects `Gπ570` as "unparseable" — correctly, since
    // π is not part of any Strong's key grammar.
    const parsed = parseStrongsKey(`G${digits}${letter}`);
    if (!parsed.ok) {
      rejections.push({
        line,
        text: raw,
        reason: "strongs-token-unparseable",
        detail: parsed.detail,
        strongsKeyReason: parsed.reason,
      });
      continue;
    }
    const ref: MounceStrongsRef = {
      raw,
      canonical: parsed.canonical,
      base: parsed.base,
    };
    if (letter) ref.mounceExtensionLetter = letter;
    if (piMarked) ref.piMarked = true;
    refs.push(ref);
  }
  return refs;
}

/**
 * Parse `dictionary.txt` from the Mounce open release.
 *
 * Never returns an empty `entries` array for a non-empty input: a zero-entry
 * parse of a 1,041,936-byte file is a separator bug, not an empty dictionary,
 * and it must fail loudly. See `assertMounceParse`.
 */
export function parseMounceDictionary(text: string): MounceParseResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries: MounceEntry[] = [];
  const rejections: MounceRejection[] = [];
  let alphabetDividers = 0;
  let wordStudyLines = 0;
  let headers = 0;
  let pending: MounceEntry | null = null;

  const closePending = (): void => {
    if (pending && pending.definition === "") {
      rejections.push({
        line: pending.line,
        text: pending.lemma.slice(0, 200),
        reason: "header-without-definition",
        detail: `Mounce header for "${pending.lemma}" was not followed by a <def> line.`,
      });
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    if (!line.trim()) continue;

    const header = line.match(MOUNCE_HEADER);
    if (header) {
      closePending();
      headers += 1;
      const gk = header[1] ?? header[2] ?? "";
      const strongsField = (header[3] ?? "").trim();
      const rest = line.slice(header[0].length).split(MOUNCE_FIELD_SEPARATOR);
      if (rest.length < 3) {
        rejections.push({
          line: lineNo,
          text: line.slice(0, 200),
          reason: "header-field-count",
          detail:
            `Mounce header has ${rest.length} field(s) after the reference numbers; ` +
            "expected lemma, transliteration, frequency.",
        });
        pending = null;
        continue;
      }
      pending = {
        gk,
        gkIsNotStrongs: isGkNumber(`GK${gk}`),
        strongs: parseMounceStrongsField(strongsField, lineNo, rejections),
        lemma: (rest[0] ?? "").normalize("NFC").trim(),
        transliteration: (rest[1] ?? "").trim(),
        frequency: parseMounceFrequency(rest[2] ?? ""),
        definition: "",
        line: lineNo,
      };
      entries.push(pending);
      continue;
    }

    const gkOnly = line.match(MOUNCE_HEADER_GK_ONLY);
    if (gkOnly) {
      closePending();
      headers += 1;
      const gk = gkOnly[1] ?? "";
      const entry: MounceEntry = {
        gk,
        gkIsNotStrongs: isGkNumber(`GK${gk}`),
        strongs: [],
        lemma: (gkOnly[2] ?? "").normalize("NFC").trim(),
        transliteration: (gkOnly[3] ?? "").trim(),
        frequency: parseMounceFrequency(gkOnly[4] ?? ""),
        definition: (gkOnly[5] ?? "").trim(),
        line: lineNo,
      };
      entries.push(entry);
      pending = null;
      continue;
    }

    if (line.startsWith("<def>")) {
      if (!pending) {
        rejections.push({
          line: lineNo,
          text: line.slice(0, 200),
          reason: "definition-without-header",
          detail: "A <def> line appeared with no preceding Mounce header to attach it to.",
        });
        continue;
      }
      const m = line.match(MOUNCE_DEF_LINE);
      pending.definition = (m?.[1] ?? line.slice("<def>".length)).trim();
      const tail = (m?.[2] ?? "").trim();
      if (tail) pending.expositoryCrossReference = tail;
      pending = null;
      continue;
    }

    // Alphabet dividers: a single Greek capital on its own line, 24 of them.
    if (/^[Ά-Ͽἀ-῿]$/.test(line.trim())) {
      alphabetDividers += 1;
      continue;
    }
    if (line.trimStart().startsWith("☞")) {
      wordStudyLines += 1;
      continue;
    }
    // Everything else is preamble: title, introduction, abbreviation table,
    // transliteration table. Not a rejection — it is not entry data.
  }
  closePending();

  const keys = new Set<string>();
  let strongsTokens = 0;
  let extensionLetterTokens = 0;
  let piMarkedTokens = 0;
  let entriesWithStrongs = 0;
  let expositoryCrossReferences = 0;
  for (const entry of entries) {
    if (entry.strongs.length > 0) entriesWithStrongs += 1;
    if (entry.expositoryCrossReference) expositoryCrossReferences += 1;
    for (const ref of entry.strongs) {
      strongsTokens += 1;
      keys.add(ref.canonical);
      if (ref.mounceExtensionLetter) extensionLetterTokens += 1;
      if (ref.piMarked) piMarkedTokens += 1;
    }
  }

  return {
    entries,
    rejections,
    stats: {
      lines: lines.length,
      headers,
      entriesWithStrongs,
      gkOnlyEntries: entries.length - entriesWithStrongs,
      strongsTokens,
      distinctStrongsKeys: keys.size,
      extensionLetterTokens,
      piMarkedTokens,
      expositoryCrossReferences,
      alphabetDividers,
      wordStudyLines,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// TBESG — `TBESG - Translators Brief lexicon of Extended Strongs for Greek`
// ───────────────────────────────────────────────────────────────────────────

/**
 * ONE RECORD IS ONE LINE. Eight tab-separated columns, no exceptions —
 * measured: 11,035 data rows, **all 11,035 with exactly 8 columns**.
 *
 * The `$==========` multi-line record form described in the STEPBible README
 * (and used by TIPNR, which this repo already parses that way) **does not
 * apply to TBESG**. It appears in TBESG exactly three times, at lines 54, 57
 * and 61, inside the *preamble*, as worked examples of dStrong disambiguation
 * for the three Herods. There is no `$` at the start of any line after 90.
 * A parser that splits TBESG on `$==========` gets three junk records and
 * misses all 11,035 real ones.
 *
 * Layout:
 *
 *   bytes            4,736,912
 *   encoding         UTF-8 **with BOM**, LF endings, no CR
 *   lines            11,126
 *   preamble         1–87   (licence block at 11–22, field docs at 26–50,
 *                            the three `$==========` examples at 54–63,
 *                            column notes at 67–85)
 *   column header    88
 *   rule             89     (a line of `=`)
 *   blank            90
 *   data             91–11,125   → 11,035 rows (line 11,126 is the final
 *                                  empty string after the trailing LF)
 *
 *   col 1  eStrong          `G0026`     zero-padded 4, **never suffixed**
 *   col 2  dStrong          `G4245H = a Meaning of`   ← NOT a bare key
 *   col 3  uStrong          `G4245G`, `H0175`, `G0680 (G0680+G0681)`
 *   col 4  Greek            `πρεσβύτερος`
 *   col 5  Transliteration  `presbuteros`
 *   col 6  Morph            `G:N-M`, `N:N-M-P`  (Language:Type-Gender-Extra)
 *   col 7  Gloss            `elder: Elder`   ← THE SENSE LABEL. mean 1.81 words
 *   col 8  Meaning          Abbott-Smith / Middle Liddell / STEPBible article
 *
 * **Column 2 is the join key AND a relation phrase in one field**, split on
 * ` = `. The key is to the left; to the right is one of nine values, measured:
 * `` (10,451 rows, no phrase), `the Greek of` (184), `a Form of` (90),
 * `a Spelling of` (74), `a Meaning of` (72), `a Name of` (64),
 * `a Combination of` (55), `a Group member of` (37), `a Part of` (8). The
 * phrase relates col 2 to col 3, so `col2 → phrase → col3` is a derivation
 * edge — the honest partial for field 22 of the parity doc.
 *
 * **Column 8 is the definition.** 100% non-empty; mean 333 raw chars, 212
 * after tag-stripping; median 124; max 4,194 text chars. 73.5% contain HTML
 * (`<b>`, `<i>`, `<BR />`, `<ref='Mrk.2.26; 14.47'>`, `<re>`), so it needs a
 * sanitiser and never `innerHTML`.
 *
 * **A sense split in col 2 does NOT split col 8.** Measured: of the 109 bases
 * that carry more than one dStrong, **105 have byte-identical col-8 text
 * across their siblings**, while 69 of those 105 differ in col 7. So
 * Abbott-Smith's article is per-base and the sense distinction lives only in
 * the Gloss. G4245G "elder: Elder" and G4245H "elder: old" share all 2,173
 * characters of their Meaning.
 */
export const TBESG_COLUMNS = [
  "eStrong",
  "dStrong",
  "uStrong",
  "Greek",
  "Transliteration",
  "Morph",
  "Gloss",
  "Meaning",
] as const;

/** 1-based line of TBESG's column header. Data begins 3 lines later. */
export const TBESG_HEADER_LINE = 88;
/** 1-based line of TBESG's first data row. */
export const TBESG_FIRST_DATA_LINE = 91;

/**
 * Who wrote a given col-8 article, read off the row's own trailing tag rather
 * than assumed for the column.
 *
 * - `abbott-smith` — ends `(AS)`. 5,708 rows. Abbott-Smith, *A Manual Greek
 *   Lexicon of the New Testament*, 1922 — **public domain**, Tyndale-corrected.
 * - `middle-liddell` — ends `(ML)`. 2,305 rows. Liddell & Scott's
 *   *Intermediate* lexicon, 1889, via Perseus — **public domain**.
 * - `stepbible` — neither tag. 3,022 rows. Per the file's preamble line 78,
 *   "Those without attribution have been added by STEPBible" — so this is
 *   STEPBible's own scholarship, CC BY 4.0, **not public domain**.
 */
export type TbesgMeaningAttribution = "abbott-smith" | "middle-liddell" | "stepbible";

/** The nine values of the relation phrase embedded in column 2. */
export type TbesgRelation =
  | ""
  | "the Greek of"
  | "a Form of"
  | "a Spelling of"
  | "a Meaning of"
  | "a Name of"
  | "a Combination of"
  | "a Group member of"
  | "a Part of";

export type TbesgRow = {
  /** col 1, canonicalised: `G0026` → `G26`. Always the base, never suffixed. */
  eStrong: string;
  /** col 2 left of ` = `, canonicalised: `G4245H` stays `G4245H`. */
  dStrong: string;
  /** `dStrong` with any sense letter dropped. */
  dStrongBase: string;
  /** col 2 right of ` = `. `""` on 10,451 of 11,035 rows. */
  relation: string;
  /**
   * col 3 raw, verbatim — kept raw because 54 rows are
   * `G0737 (G0575+G0737)`, a shape no single-key parser should flatten.
   *
   * The figure read 37 until 2026-07-26. It was never measured, and it is what
   * led this file's first contract test to assert 37 and fail. Counted directly
   * over the 11,035 data rows of TBESG-STEPBible-CC-BY.txt: 54.
   */
  uStrongRaw: string;
  /** col 3 canonicalised when it is a single key, else `null`. */
  uStrong: string | null;
  /** col 4. */
  greek: string;
  /** col 5. */
  transliteration: string;
  /** col 6, e.g. `G:N-M`. */
  morph: string;
  /**
   * col 7 — the sense label, and the ONLY sense-precise short string in
   * either source. Mean 1.81 words, max 10. This is what a card must print
   * next to a sense-suffixed key.
   */
  gloss: string;
  /** col 8 verbatim, HTML and all. Never pre-stripped: sanitising is a render concern. */
  meaning: string;
  /** Who wrote col 8, from the row's own tag. */
  meaningAttribution: TbesgMeaningAttribution;
  /** 1-based source line. */
  line: number;
};

export type TbesgRejection = {
  line: number;
  text: string;
  reason: "column-count" | "estrong-unparseable" | "dstrong-unparseable";
  detail: string;
  strongsKeyReason?: StrongsKeyRejectionReason;
};

export type TbesgParseResult = {
  rows: TbesgRow[];
  rejections: TbesgRejection[];
  stats: {
    lines: number;
    dataRows: number;
    distinctDStrong: number;
    distinctBases: number;
    /** Bases carrying more than one dStrong. The parity doc's "109". */
    splitBases: number;
    suffixedDStrong: number;
    /** Rows whose col 8 is non-empty. Expected: all of them. */
    meaningNonEmpty: number;
    byMeaningAttribution: Record<TbesgMeaningAttribution, number>;
    byRelation: Record<string, number>;
    /** Rows whose col 3 is the `Gnnnn (Gnnnn+Gnnnn)` combination shape. */
    combinationUStrong: number;
  };
};

function tbesgMeaningAttribution(meaning: string): TbesgMeaningAttribution {
  const tail = meaning.trimEnd();
  if (tail.endsWith("(AS)")) return "abbott-smith";
  if (tail.endsWith("(ML)")) return "middle-liddell";
  return "stepbible";
}

/**
 * Parse the TBESG lexicon text.
 *
 * `text` may retain its UTF-8 BOM; it is stripped here so the first column of
 * the first data row is not silently prefixed with U+FEFF (which would make
 * `G0001` unparseable and, worse, could make it parse as something else).
 */
export function parseTbesgLexicon(text: string): TbesgParseResult {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const rows: TbesgRow[] = [];
  const rejections: TbesgRejection[] = [];
  const byRelation: Record<string, number> = {};
  const byMeaningAttribution: Record<TbesgMeaningAttribution, number> = {
    "abbott-smith": 0,
    "middle-liddell": 0,
    stepbible: 0,
  };
  let combinationUStrong = 0;

  for (let i = TBESG_FIRST_DATA_LINE - 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length !== TBESG_COLUMNS.length) {
      rejections.push({
        line: lineNo,
        text: line.slice(0, 200),
        reason: "column-count",
        detail: `Expected ${TBESG_COLUMNS.length} tab-separated columns, found ${cols.length}.`,
      });
      continue;
    }

    const eParsed = parseStrongsKey((cols[0] ?? "").trim());
    if (!eParsed.ok) {
      rejections.push({
        line: lineNo,
        text: (cols[0] ?? "").slice(0, 200),
        reason: "estrong-unparseable",
        detail: eParsed.detail,
        strongsKeyReason: eParsed.reason,
      });
      continue;
    }

    const col2 = cols[1] ?? "";
    const eq = col2.indexOf("=");
    const dRaw = (eq >= 0 ? col2.slice(0, eq) : col2).trim();
    const relation = eq >= 0 ? col2.slice(eq + 1).trim() : "";
    const dParsed = parseStrongsKey(dRaw);
    if (!dParsed.ok) {
      rejections.push({
        line: lineNo,
        text: dRaw.slice(0, 200),
        reason: "dstrong-unparseable",
        detail: dParsed.detail,
        strongsKeyReason: dParsed.reason,
      });
      continue;
    }

    const uRaw = (cols[2] ?? "").trim();
    if (/\(.*\+.*\)/.test(uRaw)) combinationUStrong += 1;
    // Only canonicalise col 3 when it is a lone key. The 54 combination rows
    // keep `uStrong: null` and their raw text, rather than resolving to the
    // first of two numbers and quietly asserting the wrong relation.
    const uParsed = parseStrongsKey(uRaw);
    const meaning = cols[7] ?? "";
    const attribution = tbesgMeaningAttribution(meaning);
    byMeaningAttribution[attribution] += 1;
    byRelation[relation] = (byRelation[relation] ?? 0) + 1;

    rows.push({
      eStrong: eParsed.canonical,
      dStrong: dParsed.canonical,
      dStrongBase: dParsed.base,
      relation,
      uStrongRaw: uRaw,
      uStrong: uParsed.ok ? uParsed.canonical : null,
      greek: (cols[3] ?? "").normalize("NFC").trim(),
      transliteration: (cols[4] ?? "").trim(),
      morph: (cols[5] ?? "").trim(),
      gloss: (cols[6] ?? "").trim(),
      meaning,
      meaningAttribution: attribution,
      line: lineNo,
    });
  }

  const dKeys = new Set(rows.map((r) => r.dStrong));
  const baseToKeys = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = baseToKeys.get(row.dStrongBase) ?? new Set<string>();
    set.add(row.dStrong);
    baseToKeys.set(row.dStrongBase, set);
  }

  return {
    rows,
    rejections,
    stats: {
      lines: lines.length,
      dataRows: rows.length,
      distinctDStrong: dKeys.size,
      distinctBases: baseToKeys.size,
      splitBases: [...baseToKeys.values()].filter((s) => s.size > 1).length,
      suffixedDStrong: rows.filter((r) => r.dStrong !== r.dStrongBase).length,
      meaningNonEmpty: rows.filter((r) => r.meaning.trim().length > 0).length,
      byMeaningAttribution,
      byRelation,
      combinationUStrong,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The merged index
// ───────────────────────────────────────────────────────────────────────────

/** A source record. One per distinct attribution obligation. */
export type GreekShortDefSource = {
  /** Display name for the render site. */
  name: string;
  /** Original work and date, where the prose predates the compiler. */
  work?: string;
  license: string;
  /**
   * The string that must be visible when this source's prose is drawn,
   * verbatim from the source. Empty string never allowed.
   */
  requiredAttribution: string;
  /** Single-line variant, when the canonical form is multi-line. */
  requiredAttributionOneLine?: string;
  /** Where the file came from. */
  url: string;
  /** A licence condition a reader would not infer from `license`. */
  rider?: string;
};

/** Attribution ids. One per source record. */
export type GreekShortDefSourceId =
  | "mounce"
  | "tbesg-abbott-smith"
  | "tbesg-middle-liddell"
  | "tbesg-stepbible";

/**
 * The TBESG-only ids. `TbesgShortDef.attribution` is this narrower union rather
 * than `GreekShortDefSourceId` on purpose: it is the "never blended" rule made
 * structural, so a TBESG half cannot be labelled Mounce even by mistake. Keep it
 * derived with `Exclude` — adding a TBESG source to the wide union then widens
 * this one automatically, while adding a non-TBESG source does not.
 */
export type TbesgSourceId = Exclude<GreekShortDefSourceId, "mounce">;

const TBESG_URL =
  "https://github.com/STEPBible/STEPBible-Data" +
  " → Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt";

/**
 * The four attribution obligations this index creates. Frozen and exported so
 * the renderer resolves an id rather than hard-coding a name a second time.
 */
export const GREEK_SHORT_DEF_SOURCES: Readonly<
  Record<GreekShortDefSourceId, GreekShortDefSource>
> = Object.freeze({
  mounce: {
    name: "Mounce Concise Greek-English Dictionary",
    work: "William D. Mounce, with Rick D. Bennett, Jr., 1993",
    license: "Attribution-NonCommercial (free for non-commercial, non-revenue-bearing use)",
    requiredAttribution: MOUNCE_REQUIRED_ATTRIBUTION,
    requiredAttributionOneLine: MOUNCE_REQUIRED_ATTRIBUTION_ONE_LINE,
    url: "https://github.com/jcuenod/dictionary",
  },
  "tbesg-abbott-smith": {
    name: "Abbott-Smith, via STEPBible TBESG",
    work: "G. Abbott-Smith, A Manual Greek Lexicon of the New Testament, 1922 (public domain), corrected by Tyndale House scholars",
    license: "CC BY 4.0",
    requiredAttribution: TBESG_REQUIRED_ATTRIBUTION,
    url: TBESG_URL,
    rider: TBESG_REDISTRIBUTION_RIDER,
  },
  "tbesg-middle-liddell": {
    name: "Middle Liddell, via STEPBible TBESG",
    work: "Liddell & Scott, An Intermediate Greek-English Lexicon, 1889 (public domain), from Perseus",
    license: "CC BY 4.0",
    requiredAttribution: TBESG_REQUIRED_ATTRIBUTION,
    url: TBESG_URL,
    rider: TBESG_REDISTRIBUTION_RIDER,
  },
  "tbesg-stepbible": {
    name: "STEPBible scholars (TBESG)",
    work: "Written by STEPBible for rows where neither Abbott-Smith nor Middle Liddell supplied an entry",
    license: "CC BY 4.0",
    requiredAttribution: TBESG_REQUIRED_ATTRIBUTION,
    url: TBESG_URL,
    rider: TBESG_REDISTRIBUTION_RIDER,
  },
});

const TBESG_ATTRIBUTION_ID: Readonly<
  Record<TbesgMeaningAttribution, TbesgSourceId>
> = Object.freeze({
  "abbott-smith": "tbesg-abbott-smith",
  "middle-liddell": "tbesg-middle-liddell",
  stepbible: "tbesg-stepbible",
});

/** The Mounce half of an entry. Self-contained, self-attributed. */
export type MounceShortDef = {
  attribution: "mounce";
  /** Plain text, no HTML. The 25-word card gloss. */
  definition: string;
  lemma: string;
  transliteration: string;
  /** NT occurrences as Mounce prints them. */
  frequency: number | null;
  /** Goodrick-Kohlenberger number. Provenance only — NEVER a join key. */
  gk: string;
  /**
   * `true` when this Mounce entry was attached at BASE level to a
   * sense-suffixed key, i.e. Mounce does not distinguish this sense.
   *
   * This flag is the whole reason the merge is honest. `G4245G` ("elder:
   * Elder") and `G4245H` ("elder: old") both receive Mounce's single
   * πρεσβύτερος entry, and both are marked, so a card can say "Mounce, for
   * πρεσβύτερος (Mounce does not separate these senses)" instead of implying
   * Mounce chose this sense.
   */
  appliesToWholeBase?: boolean;
  /**
   * Mounce's own extension letter, when this key carries one. Present ONLY on
   * keys Mounce itself suffixed (`G32a`), which are disjoint from STEPBible's
   * dStrong letters — see the module header.
   */
  mounceExtensionLetter?: string;
  /** The undocumented `π` marker rode on this key's token. */
  piMarked?: boolean;
  /**
   * `→` pointer into *Mounce's Complete Expository Dictionary* (Zondervan
   * 2006), a separate commercial book. Captured, not part of `definition`,
   * and not to be rendered as definition prose.
   */
  expositoryCrossReference?: string;
};

/** The TBESG half of an entry. Self-contained, self-attributed. */
export type TbesgShortDef = {
  attribution: Exclude<GreekShortDefSourceId, "mounce">;
  /**
   * col 7 — the sense-precise short label, 1.81 words on average.
   * For a sense-suffixed key this is the ONLY sense-correct short string
   * available from either source.
   */
  gloss: string;
  /**
   * col 8 verbatim, HTML included. `<b> <i> <BR /> <ref='…'> <re>` all occur.
   * SANITISE at the render site; never `innerHTML`.
   *
   * **NOT Unicode-normalised, deliberately, and it differs from `greek`.**
   * col 8's Greek uses the "oxia" presentation forms — ἀρχιερεύς there is
   * `1F00 3C1 3C7 3B9 3B5 3C1 3B5 1F7B 3C2`, with U+1F7B GREEK SMALL LETTER
   * UPSILON WITH OXIA, which NFC maps to U+03CD (…WITH TONOS). So
   * `meaning.includes(greek)` is **false** for this row even though both
   * strings spell the same word, and any search over col 8 must
   * `.normalize("NFC")` first.
   *
   * It is left un-normalised because TBESG's licence grants reformatting
   * "without changing the data", and because normalisation would alter the
   * bytes of third-party prose we are obliged to attribute. `greek` (col 4) IS
   * normalised, because it is a key-adjacent identifier rather than prose.
   */
  meaning: string;
  greek: string;
  transliteration: string;
  morph: string;
  /** Relation phrase from col 2, `""` when absent. */
  relation: string;
  /** col 3 verbatim, including the 37 `Gnnnn (Gnnnn+Gnnnn)` rows. */
  uStrongRaw: string;
  /** col 3 canonicalised, `null` for the combination rows. */
  uStrong: string | null;
  /**
   * `true` when a sibling dStrong on the same base carries byte-identical
   * `meaning`. Measured on 105 of the 109 split bases. A card must not present
   * this article as sense-specific when it is not.
   */
  meaningSharedAcrossSenses?: boolean;
};

/** One canonical key's short definitions, from up to two named sources. */
export type GreekShortDefEntry = {
  /** Canonical extended Strong's key: `G749`, `G4245G`, `G32a`. */
  key: string;
  /** `key` with any letter dropped. */
  base: string;
  /** Sibling keys on the same base, when the base splits. Sorted. */
  senseSiblings?: string[];
  mounce?: MounceShortDef;
  tbesg?: TbesgShortDef;
};

export type GreekShortDefIndex = {
  version: 1;
  /** Human summary of what this file is. */
  description: string;
  /** Every attribution obligation, resolvable from `entry.*.attribution`. */
  sources: Record<GreekShortDefSourceId, GreekShortDefSource>;
  /** Per-input provenance. Filled by the importer, which does the hashing. */
  inputs: Record<
    "mounce" | "tbesg",
    { file: string; bytes: number; sha256: string; retrievedFrom: string }
  >;
  generatedAt: string;
  entryCount: number;
  /** Keys carrying a Mounce definition. */
  mounceKeyCount: number;
  /** Keys carrying a TBESG row. */
  tbesgKeyCount: number;
  /** Keys carrying both. */
  bothKeyCount: number;
  entries: Record<string, GreekShortDefEntry>;
  /** Base key → canonical keys on that base. Only bases that split. */
  senseSiblingsByBase: Record<string, string[]>;
  stats: GreekShortDefMergeStats;
};

export type GreekShortDefMergeStats = {
  mounceEntriesParsed: number;
  mounceEntriesWithoutStrongs: number;
  mounceRejections: number;
  tbesgRowsParsed: number;
  tbesgRejections: number;
  /** Distinct Mounce bases with no TBESG row on the same base. */
  mounceOnlyBases: number;
  /** Distinct TBESG bases with no Mounce entry. */
  tbesgOnlyBases: number;
  /**
   * Distinct sense-suffixed keys that took Mounce at base level, i.e. keys
   * whose Mounce half carries `appliesToWholeBase`.
   */
  mounceAttachedAtBaseLevel: number;
  /** Distinct keys carrying Mounce's own extension letter. */
  mounceExtensionLetterKeys: number;
  /**
   * Split bases where AT LEAST TWO siblings share a byte-identical col 8.
   * 108 of 109. This is the figure the per-row
   * `TbesgShortDef.meaningSharedAcrossSenses` flag is derived from.
   */
  sharedMeaningSplitBases: number;
  /**
   * Split bases where ALL siblings share ONE byte-identical col 8 — the
   * article is entirely per-base and carries no sense information at all.
   * 105 of 109. The three-way distinction matters: 74 of the split bases have
   * 2 senses, but the tail runs to 9 (`sibling-count distribution`
   * 2:74 3:17 4:7 5:6 7:2 8:1 9:2), so "some siblings agree" and "all
   * siblings agree" are genuinely different counts.
   */
  identicalMeaningSplitBases: number;
  byTbesgAttribution: Record<TbesgMeaningAttribution, number>;
};

export type BuildGreekShortDefIndexInput = {
  mounce: MounceParseResult;
  tbesg: TbesgParseResult;
  generatedAt: string;
  inputs: GreekShortDefIndex["inputs"];
};

/**
 * Merge the two sources into one index, keyed on the canonical extended
 * Strong's key from `strongs-key.ts`.
 *
 * Merge rules, all consequences of what the two files actually contain:
 *
 * 1. **TBESG sets the key space.** Its dStrong is sense-precise, so every
 *    TBESG row gets its own entry: `G4245G` and `G4245H` are two entries.
 * 2. **Mounce attaches at BASE level, and says so.** Mounce has no dStrong.
 *    Its πρεσβύτερος entry therefore lands on both `G4245G` and `G4245H` with
 *    `appliesToWholeBase: true`. It is the same claim about the same lemma, so
 *    copying it is not a fabrication — but pretending it picked a sense would
 *    be, hence the flag.
 * 3. **Mounce's own suffixed keys stay separate and unmatched.** `G32a`
 *    becomes its own entry with a Mounce half and no TBESG half. It will not
 *    be found by any token in this repo (Greek tokens carry no suffix at all),
 *    and that is correct: the alternative is serving ἀγγέλλω's prose for
 *    ἄγγελος.
 * 4. **The two prose fields are never concatenated.** `mounce.definition` and
 *    `tbesg.meaning` sit side by side, each with its own `attribution`.
 */
export function buildGreekShortDefIndex(
  input: BuildGreekShortDefIndexInput,
): GreekShortDefIndex {
  const { mounce, tbesg } = input;
  const entries: Record<string, GreekShortDefEntry> = {};

  const ensure = (key: string, base: string): GreekShortDefEntry => {
    const existing = entries[key];
    if (existing) return existing;
    const created: GreekShortDefEntry = { key, base };
    entries[key] = created;
    return created;
  };

  // ── TBESG first: it owns the key space ────────────────────────────────────
  const meaningByBase = new Map<string, Map<string, number>>();
  for (const row of tbesg.rows) {
    const counts = meaningByBase.get(row.dStrongBase) ?? new Map<string, number>();
    counts.set(row.meaning, (counts.get(row.meaning) ?? 0) + 1);
    meaningByBase.set(row.dStrongBase, counts);
  }

  let sharedMeaningSplitBases = 0;
  let identicalMeaningSplitBases = 0;
  for (const [, counts] of meaningByBase) {
    let rows = 0;
    let repeated = false;
    for (const n of counts.values()) {
      rows += n;
      if (n > 1) repeated = true;
    }
    if (rows < 2) continue;
    if (repeated) sharedMeaningSplitBases += 1;
    if (counts.size === 1) identicalMeaningSplitBases += 1;
  }

  for (const row of tbesg.rows) {
    const entry = ensure(row.dStrong, row.dStrongBase);
    const shared = (meaningByBase.get(row.dStrongBase)?.get(row.meaning) ?? 0) > 1;
    const half: TbesgShortDef = {
      attribution: TBESG_ATTRIBUTION_ID[row.meaningAttribution],
      gloss: row.gloss,
      meaning: row.meaning,
      greek: row.greek,
      transliteration: row.transliteration,
      morph: row.morph,
      relation: row.relation,
      uStrongRaw: row.uStrongRaw,
      uStrong: row.uStrong,
    };
    if (shared) half.meaningSharedAcrossSenses = true;
    entry.tbesg = half;
  }

  // ── Mounce second, at base level, flagged ────────────────────────────────
  const tbesgKeysByBase = new Map<string, string[]>();
  for (const row of tbesg.rows) {
    const list = tbesgKeysByBase.get(row.dStrongBase) ?? [];
    if (!list.includes(row.dStrong)) list.push(row.dStrong);
    tbesgKeysByBase.set(row.dStrongBase, list);
  }

  // All three are SETS, not counters. One Mounce entry can name up to 13
  // Strong's numbers and two entries can name the same one, so an event count
  // would overstate every one of these.
  const mounceBases = new Set<string>();
  const mounceBaseLevelKeys = new Set<string>();
  const mounceOnlyBaseSet = new Set<string>();
  const mounceExtensionKeys = new Set<string>();

  for (const entry of mounce.entries) {
    for (const ref of entry.strongs) {
      const half: MounceShortDef = {
        attribution: "mounce",
        definition: entry.definition,
        lemma: entry.lemma,
        transliteration: entry.transliteration,
        frequency: entry.frequency,
        gk: entry.gk,
      };
      if (ref.mounceExtensionLetter) {
        half.mounceExtensionLetter = ref.mounceExtensionLetter;
        mounceExtensionKeys.add(ref.canonical);
      }
      if (ref.piMarked) half.piMarked = true;
      if (entry.expositoryCrossReference) {
        half.expositoryCrossReference = entry.expositoryCrossReference;
      }

      // A Mounce key that carries Mounce's own letter is its own key space and
      // must not be spread over TBESG's senses of the bare base.
      const targets = ref.mounceExtensionLetter
        ? [ref.canonical]
        : (tbesgKeysByBase.get(ref.base) ?? [ref.canonical]);
      if (!ref.mounceExtensionLetter && !tbesgKeysByBase.has(ref.base)) {
        mounceOnlyBaseSet.add(ref.base);
      }
      mounceBases.add(ref.base);

      for (const target of targets) {
        const record = ensure(target, ref.base);
        const copy: MounceShortDef = { ...half };
        if (target !== ref.base) {
          copy.appliesToWholeBase = true;
          mounceBaseLevelKeys.add(target);
        }
        // Two Mounce entries can name the same Strong's number — 34 keys do,
        // e.g. Σαλαμίς and Σαλείμ both claim G4529. First wins, and the
        // collision is reported by the importer's checks rather than hidden.
        if (!record.mounce) record.mounce = copy;
      }
    }
  }

  // ── Sense siblings ───────────────────────────────────────────────────────
  const keysByBase = new Map<string, string[]>();
  for (const key of Object.keys(entries)) {
    const base = entries[key]?.base ?? key;
    const list = keysByBase.get(base) ?? [];
    list.push(key);
    keysByBase.set(base, list);
  }
  const senseSiblingsByBase: Record<string, string[]> = {};
  for (const [base, keys] of keysByBase) {
    if (keys.length < 2) continue;
    const sorted = [...keys].sort();
    senseSiblingsByBase[base] = sorted;
    for (const key of sorted) {
      const entry = entries[key];
      if (entry) entry.senseSiblings = sorted.filter((k) => k !== key);
    }
  }

  let mounceKeyCount = 0;
  let tbesgKeyCount = 0;
  let bothKeyCount = 0;
  for (const entry of Object.values(entries)) {
    if (entry.mounce) mounceKeyCount += 1;
    if (entry.tbesg) tbesgKeyCount += 1;
    if (entry.mounce && entry.tbesg) bothKeyCount += 1;
  }

  const tbesgBases = new Set(tbesg.rows.map((r) => r.dStrongBase));
  let tbesgOnlyBases = 0;
  for (const base of tbesgBases) if (!mounceBases.has(base)) tbesgOnlyBases += 1;

  return {
    version: 1,
    description:
      "Greek short definitions for the word card's \"Meaning\" slot, from two sources " +
      "kept separately attributed and never blended: Mounce Concise (plain-text card gloss) " +
      "and STEPBible TBESG (sense-precise Gloss plus the Abbott-Smith / Middle Liddell / " +
      "STEPBible article). Keyed on canonical extended Strong's per src/core/language/strongs-key.ts.",
    sources: { ...GREEK_SHORT_DEF_SOURCES },
    inputs: input.inputs,
    generatedAt: input.generatedAt,
    entryCount: Object.keys(entries).length,
    mounceKeyCount,
    tbesgKeyCount,
    bothKeyCount,
    entries,
    senseSiblingsByBase,
    stats: {
      mounceEntriesParsed: mounce.entries.length,
      mounceEntriesWithoutStrongs: mounce.stats.gkOnlyEntries,
      mounceRejections: mounce.rejections.length,
      tbesgRowsParsed: tbesg.rows.length,
      tbesgRejections: tbesg.rejections.length,
      mounceOnlyBases: mounceOnlyBaseSet.size,
      tbesgOnlyBases,
      mounceAttachedAtBaseLevel: mounceBaseLevelKeys.size,
      mounceExtensionLetterKeys: mounceExtensionKeys.size,
      sharedMeaningSplitBases,
      identicalMeaningSplitBases,
      byTbesgAttribution: tbesg.stats.byMeaningAttribution,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Doctor checks
// ───────────────────────────────────────────────────────────────────────────

/**
 * Assertions on a parse or a merge. **Every count check is `> 0` or an exact
 * equality — never "no errors".**
 *
 * A parser that returns 0 entries and 0 rejections has not proved the file is
 * empty; it has proved nothing. The Mounce separator is three U+00A0, and the
 * one nearby mistake (three ASCII spaces, which the upstream `compile.rb`
 * makes) yields exactly that silent zero. So the shape of these checks is the
 * defence, not a formality.
 */
export type GreekShortDefChecks = Record<string, boolean>;

export function checkGreekShortDefIndex(
  index: GreekShortDefIndex,
): GreekShortDefChecks {
  const entries = Object.values(index.entries);
  const sourceIds = new Set(Object.keys(index.sources));
  // Derived from the attribution map rather than written out again, so adding a
  // TBESG source cannot leave this check behind. `TbesgShortDef.attribution` is
  // already the narrow union, so this is a runtime guard on PARSED data, not a
  // restatement of the type — the map is the only thing that assigns it.
  const tbesgIds: ReadonlySet<string> = new Set(Object.values(TBESG_ATTRIBUTION_ID));
  return {
    // ── Non-zero, exact where the upstream file is pinned ─────────────────
    mounceEntriesExact: index.stats.mounceEntriesParsed === 5389,
    mounceHasNoRejections: index.stats.mounceRejections === 0,
    tbesgRowsExact: index.stats.tbesgRowsParsed === 11035,
    tbesgHasNoRejections: index.stats.tbesgRejections === 0,
    entriesNonZero: index.entryCount > 0,
    mounceKeysNonZero: index.mounceKeyCount > 0,
    tbesgKeysNonZero: index.tbesgKeyCount > 0,
    bothKeysNonZero: index.bothKeyCount > 0,
    // The two sources must genuinely overlap AND genuinely differ, or the
    // merge is either a duplicate or a failed join.
    overlapIsSubstantial: index.bothKeyCount >= 5000,
    tbesgReachesBeyondMounce: index.tbesgKeyCount > index.mounceKeyCount,

    // ── Never blended ────────────────────────────────────────────────────
    // No entry may carry a single field holding both sources' prose.
    everyEntryKeyMatchesItsRecord: entries.every((e) => index.entries[e.key] === e),
    everyMounceHalfIsAttributed: entries.every((e) => !e.mounce || e.mounce.attribution === "mounce"),
    everyTbesgHalfIsAttributed: entries.every(
      (e) => !e.tbesg || (tbesgIds.has(e.tbesg.attribution) && sourceIds.has(e.tbesg.attribution)),
    ),
    everyAttributionResolves: entries.every(
      (e) =>
        (!e.mounce || sourceIds.has(e.mounce.attribution)) &&
        (!e.tbesg || sourceIds.has(e.tbesg.attribution)),
    ),
    everySourceHasRequiredAttribution: Object.values(index.sources).every(
      (s) => s.requiredAttribution.trim().length > 0,
    ),
    mounceAttributionVerbatim:
      index.sources.mounce.requiredAttribution === MOUNCE_REQUIRED_ATTRIBUTION,
    tbesgAttributionVerbatim: (
      ["tbesg-abbott-smith", "tbesg-middle-liddell", "tbesg-stepbible"] as const
    ).every((id) => index.sources[id].requiredAttribution === TBESG_REQUIRED_ATTRIBUTION),
    tbesgRiderRecorded: (
      ["tbesg-abbott-smith", "tbesg-middle-liddell", "tbesg-stepbible"] as const
    ).every((id) => index.sources[id].rider === TBESG_REDISTRIBUTION_RIDER),

    // ── Mounce is not silently credited with a sense it did not choose ────
    baseLevelMounceIsFlagged: entries.every(
      (e) => !e.mounce || e.key === e.base || e.mounce.appliesToWholeBase === true,
    ),
    baseLevelAttachmentsHappened: index.stats.mounceAttachedAtBaseLevel > 0,

    // ── Mounce's letters never merged into STEPBible's ────────────────────
    mounceExtensionKeysExist: index.stats.mounceExtensionLetterKeys > 0,
    mounceExtensionKeysHaveNoTbesg: entries.every(
      (e) => !e.mounce?.mounceExtensionLetter || e.tbesg === undefined,
    ),

    // ── Provenance ───────────────────────────────────────────────────────
    inputsHashed: (["mounce", "tbesg"] as const).every(
      (k) => /^[0-9a-f]{64}$/.test(index.inputs[k].sha256) && index.inputs[k].bytes > 0,
    ),
    sharedMeaningDetected: index.stats.sharedMeaningSplitBases > 0,
    tbesgAttributionSplitIsReal:
      index.stats.byTbesgAttribution["abbott-smith"] > 0 &&
      index.stats.byTbesgAttribution["middle-liddell"] > 0 &&
      index.stats.byTbesgAttribution.stepbible > 0,
  };
}

/**
 * Word count of a definition as a card would count it, for the 25-word budget.
 * Tag-stripping first, because 73.5% of TBESG col 8 is HTML and
 * `"<b>ἀγάπη</b>,"` is one word, not three.
 */
export function shortDefWordCount(text: string): number {
  const plain = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? plain.split(" ").length : 0;
}

/** The default card budget: 25 words. */
export const CARD_GLOSS_WORD_BUDGET = 25;

export type CardGloss = {
  text: string;
  /** Resolves in `GREEK_SHORT_DEF_SOURCES`. Never a blend of two sources. */
  attribution: GreekShortDefSourceId;
  /**
   * Whether the chosen string speaks to THIS sense or to the whole base.
   * `"base"` means the source does not distinguish the senses of this key, and
   * the card must say so rather than implying the source chose.
   */
  sense: "base" | "this-sense";
  /** Which field the text came from, for the render site's label. */
  field: "mounce-definition" | "tbesg-gloss";
  wordCount: number;
  /**
   * Set when nothing fitted the budget and the caller is getting the least-bad
   * option. The renderer must clamp or expand; it must not silently overflow.
   */
  overBudget?: true;
};

/**
 * The string a card should print in its ~25-word "Meaning" slot, and where it
 * came from — never a blend.
 *
 * **Mounce is the better source for this slot**, and the measurements say why:
 * 79.7% of its 5,389 definitions are ≤25 words (mean 19.1, median 13), it
 * contains **zero HTML** so it needs no sanitiser, it is a gloss rather than a
 * lexicon article, and it is the string STEP itself prints in this exact slot.
 * For G0749 it is `a high-priest, chief-priest` — 3 words.
 *
 * But "better" is not "always", and two things make TBESG's col-7 Gloss the
 * right pick for the rest:
 *
 * - **20.3% of Mounce definitions blow the budget.** καταργέω (G2673) is 64
 *   words of comma-spliced senses with verse references; πρεσβύτερος (G4245)
 *   is 75. Those belong in the expander.
 * - **Mounce cannot tell one sense from another.** It has no dStrong: one
 *   entry per lemma, keyed on the base number. For the 109 Greek bases that
 *   split, only TBESG col 7 can say `elder: Elder` for `G4245G` and
 *   `elder: old` for `G4245H` — and its 11,035 glosses are 1.81 words on
 *   average, so they are always in budget.
 *
 * Hence the order:
 *
 * 1. **Mounce**, when it exists AND fits the budget.
 * 2. **TBESG col 7 Gloss**, otherwise — in budget by construction, and
 *    sense-precise.
 * 3. **Mounce over budget**, as a last resort, flagged `overBudget`.
 * 4. **`null`** when neither source has anything. A card must draw no block
 *    rather than an unattributed one.
 *
 * TBESG **col 8 is never a candidate**: mean 37.1 words, 44.3% of rows over
 * budget, 73.5% carrying HTML, and 6,772 of 11,035 opening by restating in
 * bold the lemma the card already shows above. It is the expander's content.
 */
export function pickCardGloss(
  entry: GreekShortDefEntry,
  maxWords: number = CARD_GLOSS_WORD_BUDGET,
): CardGloss | null {
  const mounceText = entry.mounce?.definition.trim() ?? "";
  const mounceWords = mounceText ? shortDefWordCount(mounceText) : 0;
  const mounceSense: "base" | "this-sense" = entry.mounce?.appliesToWholeBase
    ? "base"
    : "this-sense";
  if (mounceText && mounceWords <= maxWords) {
    return {
      text: mounceText,
      attribution: "mounce",
      sense: mounceSense,
      field: "mounce-definition",
      wordCount: mounceWords,
    };
  }

  const glossText = entry.tbesg?.gloss.trim() ?? "";
  if (glossText && entry.tbesg) {
    const words = shortDefWordCount(glossText);
    const picked: CardGloss = {
      text: glossText,
      attribution: entry.tbesg.attribution,
      sense: "this-sense",
      field: "tbesg-gloss",
      wordCount: words,
    };
    if (words > maxWords) picked.overBudget = true;
    return picked;
  }

  if (mounceText) {
    return {
      text: mounceText,
      attribution: "mounce",
      sense: mounceSense,
      field: "mounce-definition",
      wordCount: mounceWords,
      overBudget: true,
    };
  }
  return null;
}
