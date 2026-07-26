/**
 * Strong's key normalisation — the ONE place a Strong's number is parsed.
 *
 * Every importer, index builder and lookup that touches Strong's numbers must
 * come through here. Six ad-hoc normalisers already exist in this tree and no
 * two of them agree (see "Prior art" below); this module is the settled one.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CANONICAL FORM: unpadded, prefixed, suffix case preserved verbatim.
 *
 *     H175    G749    H1254A    H2148y    G0367I → G367I
 *
 * Three parts, each decided on measured evidence:
 *
 * 1. UNPADDED (`H175`, not `H0175`).
 *    Every artefact this repo already ships keys unpadded — `bdb-kjv.json`
 *    (`H1`…`H8674`), `strongs-plus.json` (`G1`/`H1`), `thayer.json` (`G1`),
 *    `strongs-hebrew-gloss.json` (bare `1`), `tipnr-index.json`'s
 *    `byBaseStrong` (`H175`, `G2`, `H5`), and both token packages
 *    (`token.strong: "175"`, `token.strongPrefixed: "H175"`). Padding is a
 *    property of upstream *files*, never of anything we store.
 *    Padding is also not consistent upstream, so there is no single padded
 *    form available to adopt: TIPNR writes `uStrong: "H0175"` and STEP writes
 *    `G0749` (4 wide) while unfoldingWord translationWords writes `G00080`
 *    (5 wide). Unpadded is the unique representative of the equivalence
 *    class; padded is one of at least two. Pad on the way out with
 *    `padStrongsKey()` when a specific upstream file demands it.
 *
 * 2. PREFIX RETAINED and upper-cased (`H`/`G`).
 *    A bare number is ambiguous across testaments *and* against
 *    Goodrick-Kohlenberger numbering (see `isGkNumber`). The H/G sigil is a
 *    testament marker, not data: its case carries no meaning, and every file
 *    we ship writes it upper-case, so it is normalised to upper-case.
 *
 * 3. SENSE SUFFIX PRESERVED VERBATIM — never case-folded.
 *    This is the load-bearing rule. Our own shipped `tipnr-index.json`
 *    contains, on one base, all of `H2148V` `H2148v` `H2148W` `H2148w`
 *    `H2148Y` `H2148y` `H2148Z` `H2148z`, and separately `H4918Z` +
 *    `H4918z` — five case-pairs that `.toUpperCase()` would silently merge
 *    into one sense. STEPBible exhausts `A`…`Z` and then continues into
 *    lower-case `a`…`z`, so suffix case is significant data.
 *    The one place case IS changed is the OSHB lemma dialect, and only
 *    there — see `parseOshbLemmaKey`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * It does not guess. Every input that cannot be resolved to exactly one key
 * returns a typed rejection with a reason, because the failure mode that
 * matters here is not an error — it is a silent *merge* of two senses, which
 * no "did we get a non-empty result?" test will catch.
 *
 * Prior art in this tree, all left untouched, none of it a superset of this:
 *   - `src/core/language/lexicon.ts:20`         digits-only; rejects suffixes
 *   - `src/core/language/reverse-index.ts:112`  anchored; rejects suffixes
 *   - `src/core/language/tipnr.ts:333`          unanchored; DROPS the suffix
 *   - `scripts/import-tipnr.ts:120`             same, duplicated
 *   - `src/host/macula-syntax-xml.ts:37`        strips trailing letters, and
 *                                              never strips padding (`H0749`
 *                                              survives because the leading
 *                                              character is `H`, not `0`)
 *   - `src/core/language/hebrew-orbit-index.ts:48`  strips `H` only, not `G`
 *   - `src/host/token-package-loader.ts:230`    builds a candidate list
 */

/** Testament sigil. `H` = Hebrew/Aramaic OT, `G` = Greek NT. */
export type StrongsTestament = "H" | "G";

/**
 * What kind of key was recognised.
 *
 * - `plain`          — `H175`, `G749`. One number, no sense suffix.
 * - `sense-suffixed` — `H1254A`, `G4245G`, `H2148y`. One number, one sense.
 * - `compound`       — `G1537+4053`. Several numbers joined; NOT one entry.
 */
export type StrongsKeyKind = "plain" | "sense-suffixed" | "compound";

/** Why an input could not be resolved to exactly one Strong's key. */
export type StrongsKeyRejectionReason =
  /** Input was `null`, `undefined`, or not a string. */
  | "not-a-string"
  /** Input trimmed to nothing. */
  | "empty"
  /**
   * Input is a Goodrick-Kohlenberger number. GK is a SEPARATE numbering
   * system; `GK4472` is not `G4472`. Never coerced.
   */
  | "gk-numbering"
  /**
   * Bare digits with no testament sigil. Could be Hebrew, Greek, or GK.
   * Pass `assume: "H" | "G"` when the source file settles it.
   */
  | "ambiguous-bare-number"
  /**
   * An all-lower-case input carrying a suffix, e.g. `h1254a`. Because
   * STEPBible uses lower-case suffixes for real senses past `Z`, a
   * case-mangled input cannot be told from a genuine lower-case sense.
   * Pass `trustSuffixCase: true` if the source is known case-faithful.
   */
  | "ambiguous-suffix-case"
  /** A testament sigil or OSHB prefix chain with no number in it at all. */
  | "no-strongs-number"
  /**
   * The number is zero. This is a SENTINEL, not junk: `tipnr-index.json`
   * ships `uStrong: "H0000"` / `"G0000"` and `baseStrong: "H0"` / `"G0"` on
   * 13 entities, all named `Unnamed#N` (4 Hebrew at 1Ki.2.27, 9 Greek at
   * Mat.1.15), and `byBaseStrong` carries `H0` and `G0` as keys. They are
   * people with no Strong's number. Skip them; do not log them as errors.
   */
  | "zero-sentinel"
  /** More than 5 significant digits. */
  | "out-of-range"
  /** Two or more trailing letters, e.g. `G4245GG`. Senses take one letter. */
  | "malformed-suffix"
  /** Nothing in this module recognised the shape. */
  | "unparseable";

/** A successfully parsed key. */
export type StrongsKeyParsed = {
  ok: true;
  kind: StrongsKeyKind;
  /**
   * The canonical internal form. Unpadded, `H`/`G` upper-case, sense suffix
   * verbatim. For `compound`, the components joined with `+`, each
   * canonicalised (`G1537+G4053`) — a form that will correctly MISS a
   * single-entry lexicon rather than resolve to the wrong word.
   */
  canonical: string;
  /** Canonical form with any sense suffix dropped: `H1254A` → `H1254`. */
  base: string;
  testament: StrongsTestament;
  /** The number, suffix and padding removed. `H0175` → `175`. */
  number: number;
  /**
   * The sense letter exactly as it appeared, or `undefined` when plain.
   * Case is data. `H2148Y` and `H2148y` are different words.
   */
  senseSuffix?: string;
  /**
   * Canonical components, present only for `kind: "compound"`.
   * `G5228+1537+4053` → `["G5228", "G1537", "G4053"]`.
   */
  components?: string[];
  /**
   * OSHB prefix segments stripped from a lemma, outermost first.
   * `c/l/3722 a` → `["c", "l"]`. Not part of the key; kept so a caller can
   * see the morphemes it discarded.
   */
  oshbPrefixes?: string[];
  /**
   * The OSHB lemma carried a trailing `+` (`1177+`, `c/b/1024+`).
   * 801 of 306,774 shipped OSHB tokens, on 256 distinct bases; every
   * sampled case is one word of a multi-word proper noun (`1008+` = בֵּית
   * in בֵּית־אֵל). It is NOT a sense suffix and does not change the key.
   */
  oshbPlusMarked?: boolean;
  /**
   * The testament was inferred rather than read off the input — from an
   * `assume` option or from the Hebrew-only OSHB lemma dialect.
   */
  testamentInferred?: boolean;
};

/** A rejected input. Carries the reason, never a best guess. */
export type StrongsKeyRejection = {
  ok: false;
  reason: StrongsKeyRejectionReason;
  /** The input as received, stringified and trimmed where possible. */
  input: string;
  /** Human-readable explanation, safe to log or surface in an importer. */
  detail: string;
  /** Set only when `reason === "gk-numbering"` and digits were readable. */
  gkNumber?: number;
};

export type StrongsKeyResult = StrongsKeyParsed | StrongsKeyRejection;

export type ParseStrongsKeyOptions = {
  /**
   * Settle a bare number's testament, e.g. when reading
   * `strongs-hebrew-gloss.json` whose keys are bare (`430`).
   * Marks the result `testamentInferred: true`.
   */
  assume?: StrongsTestament;
  /**
   * Accept an all-lower-case suffixed input at face value
   * (`h1254a` → `H1254a`). Off by default: see `ambiguous-suffix-case`.
   */
  trustSuffixCase?: boolean;
  /**
   * Accept the OSHB lemma dialect: `/`-separated prefix morphemes, a
   * space before the sense letter, and a lower-case sense letter that
   * means the upper-case STEP sense (`1254 a` → `H1254A`). Default `true`,
   * because the dialect is unambiguous — no other source we ingest puts a
   * space before the sense letter or slashes before the number.
   */
  allowOshbDialect?: boolean;
};

/**
 * Highest Strong's number we will accept syntactically. Five digits, matching
 * the four gates already in this tree (`token-package-loader.ts:209`,
 * `importer/strongs-plus.ts:67`, `importer/rtf.ts:53`,
 * `scripts/import-esword-dict.ts:98`, all `/^[HG]\d{1,5}$/`).
 * Real ranges are narrower — Hebrew 1–8674, Greek 1–5624 with a TFLSJ-extra
 * tail above 6000, and the OSHB/TAHOT function-morpheme pseudo-tags at
 * H9001–H9999 — but those are dataset facts, not syntax. See
 * `isFunctionMorphemePseudoTag` and `isPlausibleStrongsNumber`.
 */
const MAX_DIGITS = 5;

/** Hebrew entries in Strong's, and in the `bdb-kjv.json` we ship. */
const MAX_HEBREW = 8674;
/** Greek entries in Strong's proper. STEPBible's TFLSJ extra runs above 6000. */
const MAX_GREEK = 5624;

/**
 * OSHB lemma prefix morphemes, measured over all 306,774 shipped
 * `oshb-wlc` tokens: c 51,270 · d 24,060 · l 16,361 · b 14,469 · m 6,314 ·
 * k 2,964 · i 661 · s 142. No others occur.
 */
const OSHB_PREFIX_SEGMENTS = new Set(["b", "c", "d", "i", "k", "l", "m", "s"]);

/**
 * Goodrick-Kohlenberger, in every spelling seen in the wild. Mounce keys to
 * Strong's AND GK, and the two are unrelated numberings — GK 4472 is not
 * Strong's G4472. Detected before anything else, because `GK…` starts with
 * the Greek sigil and a naive parser will read it as one.
 */
const GK_PATTERNS: readonly RegExp[] = [
  /^gk[\s:.#_-]*(\d+)$/i,
  /^g[\s]*[/\\][\s]*k[\s:.#_-]*(\d+)$/i,
  /^goodrick[\s_-]*kohlenberger[\s:.#_-]*(\d+)$/i,
  /^gk$/i,
];

function reject(
  reason: StrongsKeyRejectionReason,
  input: string,
  detail: string,
  gkNumber?: number,
): StrongsKeyRejection {
  return gkNumber === undefined
    ? { ok: false, reason, input, detail }
    : { ok: false, reason, input, detail, gkNumber };
}

/**
 * True when the input is a Goodrick-Kohlenberger number rather than a
 * Strong's number. Exported so an importer can route GK to a GK→Strong's
 * table instead of silently mis-keying it. No such table ships today.
 */
export function isGkNumber(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s) return false;
  return GK_PATTERNS.some((re) => re.test(s));
}

function matchGk(s: string): StrongsKeyRejection | null {
  for (const re of GK_PATTERNS) {
    const m = s.match(re);
    if (!m) continue;
    const digits = m[1];
    const detail =
      digits === undefined
        ? "Goodrick-Kohlenberger marker with no number. GK is a separate numbering system from Strong's."
        : `Goodrick-Kohlenberger ${digits} is not Strong's ${digits}. GK is a separate numbering system; no GK→Strong's table ships in this repo.`;
    return digits === undefined
      ? reject("gk-numbering", s, detail)
      : reject("gk-numbering", s, detail, Number.parseInt(digits, 10));
  }
  return null;
}

/**
 * Parse one Strong's key in any of the shapes this project ingests.
 *
 * Handles, in one call:
 *   plain            `G749`   `H175`   `g749`
 *   zero-padded      `G0749`  `H0054`  `G00080`
 *   sense-suffixed   `G4245G` `H1254A` `H7200N` `G0367I` `H2148y`
 *   OSHB lemma       `1254 a` `l/1254 b` `c/1254 a` `c/l/3722 a` `1177+`
 *   compound         `G1537+4053`  `5228+1537+4053`
 *
 * Rejects, with a reason and never a guess: empty and non-string input,
 * a bare sigil (`G`), out-of-range numbers (`H99999999`), multi-letter
 * suffixes (`G4245GG`), GK numbers (`GK4472`), bare numbers with no
 * testament, and case-mangled suffixed keys (`h1254a`).
 */
export function parseStrongsKey(
  raw: unknown,
  options: ParseStrongsKeyOptions = {},
): StrongsKeyResult {
  if (typeof raw !== "string") {
    return reject(
      "not-a-string",
      raw === null ? "null" : raw === undefined ? "undefined" : String(raw),
      `Expected a string Strong's key, received ${raw === null ? "null" : typeof raw}.`,
    );
  }

  const input = raw.trim();
  if (!input) {
    return reject("empty", input, "Empty or whitespace-only Strong's key.");
  }

  const gk = matchGk(input);
  if (gk) return gk;

  const allowOshb = options.allowOshbDialect !== false;

  // ── Prefix-only OSHB lemmas, with or without a slash ────────────────────
  // `l` (4,413 tokens), `b` (1,362), `c/l` (74), `m/l` (1) … 5,977 of the
  // 306,774 shipped oshb-wlc tokens are function morphemes with no Strong's
  // number at all, and 5,877 of those are a single letter with no slash.
  // They must reject with a reason that names the cause, not "unparseable".
  if (allowOshb && !/\d/.test(input)) {
    const segments = input.split("/").map((s) => s.trim());
    if (
      segments.length > 0 &&
      segments.every((s) => OSHB_PREFIX_SEGMENTS.has(s))
    ) {
      return reject(
        "no-strongs-number",
        input,
        `OSHB lemma "${input}" is prefix morphemes only (${segments.join(", ")}) and carries no Strong's number. ` +
          "These are function morphemes with no lexicon entry — 5,977 of 306,774 shipped oshb-wlc tokens.",
      );
    }
  }

  // ── Split off OSHB `/`-separated prefix morphemes ───────────────────────
  let body = input;
  let oshbPrefixes: string[] | undefined;
  if (input.includes("/")) {
    if (!allowOshb) {
      return reject(
        "unparseable",
        input,
        "Slash-separated OSHB lemma seen but allowOshbDialect is false.",
      );
    }
    const segments = input.split("/").map((s) => s.trim());
    let numberIdx = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/\d/.test(segments[i] ?? "")) {
        numberIdx = i;
        break;
      }
    }
    if (numberIdx < 0) {
      return reject(
        "no-strongs-number",
        input,
        `OSHB lemma "${input}" is prefix morphemes only (${segments.join(", ")}) and carries no Strong's number. ` +
          "These are function morphemes with no lexicon entry — 5,977 of 306,774 shipped oshb-wlc tokens.",
      );
    }
    const prefixes = segments.slice(0, numberIdx).filter((s) => s.length > 0);
    const unknown = prefixes.filter((p) => !OSHB_PREFIX_SEGMENTS.has(p));
    if (unknown.length > 0) {
      return reject(
        "unparseable",
        input,
        `Unrecognised OSHB prefix segment(s) ${unknown.map((u) => `"${u}"`).join(", ")} in "${input}". ` +
          `Known segments: ${[...OSHB_PREFIX_SEGMENTS].sort().join(", ")}.`,
      );
    }
    if (prefixes.length > 0) oshbPrefixes = prefixes;
    body = segments[numberIdx] ?? "";
    // Anything after the number-bearing segment is a trailing morpheme with
    // no number; the number-bearing segment is still the key.
  }

  // ── OSHB trailing `+` (compound proper-name marker, not a sense) ────────
  let oshbPlusMarked = false;
  if (/\+\s*$/.test(body)) {
    if (!allowOshb) {
      return reject(
        "unparseable",
        input,
        "Trailing '+' OSHB compound marker seen but allowOshbDialect is false.",
      );
    }
    oshbPlusMarked = true;
    body = body.replace(/\+\s*$/, "");
  }

  // A `/` prefix chain or a trailing `+` is itself proof of the OSHB lemma
  // dialect, which is Hebrew by construction — the oshb-wlc package is the
  // only source we ingest that writes either, and it is the Old Testament.
  const oshbEvidence = oshbPrefixes !== undefined || oshbPlusMarked;

  // ── Compound: several numbers joined by `+` (Greek `G1537+4053`) ────────
  const parsed = body.includes("+")
    ? parseCompound(input, body, options)
    : parseSingle(input, body, options, oshbEvidence);
  if (!parsed.ok) return parsed;
  if (oshbPrefixes) parsed.oshbPrefixes = oshbPrefixes;
  if (oshbPlusMarked) parsed.oshbPlusMarked = true;
  return parsed;
}

function parseCompound(
  input: string,
  body: string,
  options: ParseStrongsKeyOptions,
): StrongsKeyResult {
  const rawParts = body.split("+").map((p) => p.trim());
  if (rawParts.some((p) => p.length === 0)) {
    return reject(
      "unparseable",
      input,
      `Compound Strong's key "${input}" has an empty component.`,
    );
  }
  // Only the first part carries a sigil in the shipped form (`G1537+4053`).
  const head = parseSingle(input, rawParts[0] ?? "", options);
  if (!head.ok) return head;
  const components: string[] = [head.canonical];
  for (const part of rawParts.slice(1)) {
    const tail = parseSingle(input, part, {
      ...options,
      assume: head.testament,
    });
    if (!tail.ok) return tail;
    if (tail.senseSuffix !== undefined) {
      return reject(
        "unparseable",
        input,
        `Compound component "${part}" carries a sense suffix; compounds are plain numbers only.`,
      );
    }
    components.push(tail.canonical);
  }
  const canonical = components.join("+");
  const result: StrongsKeyParsed = {
    ok: true,
    kind: "compound",
    canonical,
    base: canonical,
    testament: head.testament,
    number: head.number,
    components,
  };
  if (head.testamentInferred) result.testamentInferred = true;
  return result;
}

function parseSingle(
  input: string,
  body: string,
  options: ParseStrongsKeyOptions,
  /**
   * The caller already saw OSHB lemma syntax around this body — a `/` prefix
   * chain or a trailing `+`. Settles the testament as Hebrew for a body that
   * would otherwise be a bare, ambiguous number.
   */
  oshbEvidence = false,
): StrongsKeyResult {
  // Permissive shape match, then validate each part so the rejection reason
  // is precise rather than a blanket "unparseable".
  //   sigil?  whitespace?  padding  digits  whitespace?  letters?
  const m = body.match(/^([HGhg])?\s*(0*)(\d*)\s*([A-Za-z]*)$/);
  if (!m) {
    return reject(
      "unparseable",
      input,
      `"${input}" is not a Strong's key: expected an optional H/G sigil, digits, and at most one sense letter.`,
    );
  }
  const sigilRaw = m[1];
  const padding = m[2] ?? "";
  const digits = m[3] ?? "";
  const suffix = m[4] ?? "";

  if (!digits) {
    if (padding) {
      // All zeros: `H0`, `H0000`, `G0`. TIPNR's "unnamed person" sentinel.
      return reject(
        "zero-sentinel",
        input,
        `"${input}" resolves to 0. Strong's numbers start at 1; tipnr-index.json uses ` +
          "H0000/G0000 and H0/G0 as an unnamed-person sentinel on 13 entities. Skip, do not error.",
      );
    }
    if (sigilRaw) {
      return reject(
        "no-strongs-number",
        input,
        `"${input}" is a bare ${sigilRaw.toUpperCase()} sigil with no number.`,
      );
    }
    return reject(
      "unparseable",
      input,
      `"${input}" contains no Strong's number.`,
    );
  }

  if (digits.length > MAX_DIGITS) {
    return reject(
      "out-of-range",
      input,
      `"${input}" has ${digits.length} significant digits; Strong's numbers are at most ${MAX_DIGITS} ` +
        `(Hebrew tops out at ${MAX_HEBREW}, Greek at ${MAX_GREEK} plus a TFLSJ-extra tail).`,
    );
  }

  const number = Number.parseInt(digits, 10);
  if (!Number.isFinite(number) || number < 1) {
    return reject(
      "zero-sentinel",
      input,
      `"${input}" resolves to ${number}; Strong's numbers start at 1.`,
    );
  }

  if (suffix.length > 1) {
    return reject(
      "malformed-suffix",
      input,
      `"${input}" has a ${suffix.length}-letter tail "${suffix}"; a sense suffix is exactly one letter.`,
    );
  }

  // ── Testament ──────────────────────────────────────────────────────────
  let testament: StrongsTestament;
  let testamentInferred = false;
  if (sigilRaw) {
    testament = sigilRaw.toUpperCase() === "H" ? "H" : "G";
  } else if (options.assume) {
    testament = options.assume;
    testamentInferred = true;
  } else if (
    options.allowOshbDialect !== false &&
    (oshbEvidence || isOshbShaped(body))
  ) {
    // `1254 a`, `c/d/6336`, `1177+` — a space before the sense letter, a slash
    // prefix chain, or a trailing `+` occurs in exactly one source we ingest,
    // oshb-wlc, which is Hebrew by construction. INFERRED, not read.
    testament = "H";
    testamentInferred = true;
  } else {
    return reject(
      "ambiguous-bare-number",
      input,
      `"${input}" is a bare number with no H/G sigil. It could be Hebrew, Greek, or a ` +
        "Goodrick-Kohlenberger number. Pass { assume: \"H\" } or { assume: \"G\" } when the source file settles it.",
    );
  }

  // ── Sense suffix, and the case question ────────────────────────────────
  let senseSuffix: string | undefined;
  if (suffix) {
    const oshbSpaced = !sigilRaw && isOshbShaped(body);
    if (oshbSpaced) {
      // OSHB writes the sense letter lower-case and, measured over all
      // 306,774 shipped tokens, only ever reaches `f` — letters a–f, at most
      // 6 distinct on one base (base 5526). STEP writes the same low senses
      // upper-case (`H1254A` == OSHB `1254 a`). Promoting is therefore safe:
      // OSHB never approaches the A–Z exhaustion at which a lower-case letter
      // becomes a distinct 27th sense.
      senseSuffix = suffix.toUpperCase();
    } else if (sigilRaw && sigilRaw === sigilRaw.toLowerCase() && suffix === suffix.toLowerCase()) {
      // `h1254a`. The sigil proves the input was lower-cased somewhere, so a
      // lower-case suffix cannot be told from a genuine post-Z sense.
      if (!options.trustSuffixCase) {
        return reject(
          "ambiguous-suffix-case",
          input,
          `"${input}" is all lower-case and carries a suffix, so it could mean ` +
            `"${testament}${number}${suffix.toUpperCase()}" or "${testament}${number}${suffix}" — ` +
            "STEPBible uses lower-case suffixes for real senses past Z, and tipnr-index.json ships both " +
            "H2148Y and H2148y. Pass { trustSuffixCase: true } only if the source is known case-faithful.",
        );
      }
      senseSuffix = suffix;
    } else {
      // Case is trustworthy: preserve it verbatim.
      senseSuffix = suffix;
    }
  }

  const base = `${testament}${number}`;
  const canonical = senseSuffix === undefined ? base : `${base}${senseSuffix}`;
  const result: StrongsKeyParsed = {
    ok: true,
    kind: senseSuffix === undefined ? "plain" : "sense-suffixed",
    canonical,
    base,
    testament,
    number,
  };
  if (senseSuffix !== undefined) result.senseSuffix = senseSuffix;
  if (testamentInferred) result.testamentInferred = true;
  return result;
}

/**
 * True for the OSHB lemma dialect *within one segment*: digits followed by
 * whitespace and a single sense letter (`1254 a`), or bare digits reached via
 * a `/` prefix chain. Deliberately narrow — a bare `1254` is NOT OSHB-shaped
 * and stays ambiguous.
 */
function isOshbShaped(body: string): boolean {
  return /^\d+\s+[A-Za-z]$/.test(body.trim());
}

/**
 * The canonical internal form, or `null` if the input cannot be resolved.
 * Convenience over `parseStrongsKey` for call sites that only need the string
 * and will treat every failure the same way.
 *
 * Prefer `parseStrongsKey` in importers: the reason is the whole point there.
 */
export function canonicalStrongsKey(
  raw: unknown,
  options?: ParseStrongsKeyOptions,
): string | null {
  const parsed = parseStrongsKey(raw, options);
  return parsed.ok ? parsed.canonical : null;
}

/**
 * The canonical form with any sense suffix dropped: `H1254A` → `H1254`.
 * This is the key to join against `bdb-kjv.json`, `strongs-plus.json`,
 * `thayer.json` and `tipnr-index.json`'s `byBaseStrong`, none of which
 * carry senses.
 */
export function baseStrongsKey(
  raw: unknown,
  options?: ParseStrongsKeyOptions,
): string | null {
  const parsed = parseStrongsKey(raw, options);
  return parsed.ok ? parsed.base : null;
}

/**
 * True when the input resolves to a sense-disambiguated key — STEP's
 * `G4245G`, `H1254A`, `H7200N`, and OSHB's `1254 a`.
 * False for plain keys, compounds, and anything unparseable.
 */
export function isSenseSuffixedStrongsKey(
  raw: unknown,
  options?: ParseStrongsKeyOptions,
): boolean {
  const parsed = parseStrongsKey(raw, options);
  return parsed.ok && parsed.kind === "sense-suffixed";
}

/**
 * The sense letter, case preserved, or `null` when the key is plain or
 * unparseable. `H2148y` → `"y"`, and that is NOT the same sense as `"Y"`.
 */
export function senseSuffixOf(
  raw: unknown,
  options?: ParseStrongsKeyOptions,
): string | null {
  const parsed = parseStrongsKey(raw, options);
  return parsed.ok ? (parsed.senseSuffix ?? null) : null;
}

/**
 * Zero-pad for an *upstream* join, undoing decision 1 on the way out.
 * `H175` → `H0175` (TIPNR `uStrong`, STEP), width 5 → `H00175`
 * (unfoldingWord translationWords). The sense suffix rides along:
 * `H1254A` → `H1254A` at width 4.
 *
 * Never store the result. It exists so `TokenCard.strongPadded` (§3 of
 * docs/step-word-card-parity.md, tagged `[NOW·DERIVE]`) can be derived.
 */
export function padStrongsKey(
  raw: unknown,
  width = 4,
  options?: ParseStrongsKeyOptions,
): string | null {
  const parsed = parseStrongsKey(raw, options);
  if (!parsed.ok || parsed.kind === "compound") return null;
  const digits = String(parsed.number).padStart(width, "0");
  return `${parsed.testament}${digits}${parsed.senseSuffix ?? ""}`;
}

/**
 * True when two inputs share a base number and testament, whatever their
 * padding, sigil case or sense. `H0175` and `H175` and `H175A` all agree.
 * False if either side fails to parse — never true by accident.
 */
export function sameStrongsBase(
  a: unknown,
  b: unknown,
  options?: ParseStrongsKeyOptions,
): boolean {
  const left = baseStrongsKey(a, options);
  if (left === null) return false;
  return left === baseStrongsKey(b, options);
}

/**
 * The OSHB lemma dialect, with the prefix morphemes reported rather than
 * silently dropped. `oshb-osis.ts:242-250` keeps the whole lemma string in
 * `token.lemma` and throws the sense letter away when deriving
 * `token.strong`; this reads the same string and keeps the letter.
 *
 *   `1254 a`      → { canonical: "H1254A", base: "H1254" }
 *   `l/1254 b`    → { canonical: "H1254B", oshbPrefixes: ["l"] }
 *   `c/l/3722 a`  → { canonical: "H3722A", oshbPrefixes: ["c", "l"] }
 *   `1177+`       → { canonical: "H1177", oshbPlusMarked: true }
 *   `l`           → rejection "no-strongs-number"
 *
 * Measured over all 306,774 shipped `oshb-wlc` tokens: 59,282 (19.3%) carry
 * a sense letter, on 540 distinct bases, 535 of which show more than one
 * letter. 5,977 tokens are prefix-only and have no number at all.
 */
export function parseOshbLemmaKey(lemma: unknown): StrongsKeyResult {
  return parseStrongsKey(lemma, {
    assume: "H",
    allowOshbDialect: true,
  });
}

/**
 * True for the H9001–H9999 function-morpheme pseudo-tags (`H9003` = the
 * prefix ב, `H9009` = the article, `H9020` = 1cs suffix). STEP splits Hebrew
 * prefixes into separately glossed words this way; §3 notes such tokens have
 * no lexicon entry at all, so a card must not draw a lexicon block for them.
 *
 * Forward-looking: our shipped `oshb-wlc` package contains ZERO of these —
 * measured, max `token.strong` is 8674 — because we keep morphemes glued
 * (field 40). They arrive only with STEPBible TAHOT.
 */
export function isFunctionMorphemePseudoTag(
  raw: unknown,
  options?: ParseStrongsKeyOptions,
): boolean {
  const parsed = parseStrongsKey(raw, options);
  return (
    parsed.ok &&
    parsed.testament === "H" &&
    parsed.number >= 9001 &&
    parsed.number <= 9999
  );
}

/**
 * True when the number falls inside the published Strong's range for its
 * testament — Hebrew 1–8674, Greek 1–5624 — or in the Hebrew pseudo-tag
 * block. A number that parses but fails this is syntactically fine and
 * lexically suspect; an importer should count and report those rather than
 * drop them silently.
 */
export function isPlausibleStrongsNumber(
  raw: unknown,
  options?: ParseStrongsKeyOptions,
): boolean {
  const parsed = parseStrongsKey(raw, options);
  if (!parsed.ok) return false;
  if (parsed.testament === "H") {
    return (
      (parsed.number >= 1 && parsed.number <= MAX_HEBREW) ||
      (parsed.number >= 9001 && parsed.number <= 9999)
    );
  }
  return parsed.number >= 1 && parsed.number <= MAX_GREEK;
}

/**
 * Sort comparator for canonical keys: testament, then number, then sense
 * suffix with upper-case before lower-case so `H2148Z` precedes `H2148a`
 * (STEPBible's own ordering — lower-case continues where `Z` ran out).
 * Unparseable inputs sort last, stably by string.
 */
export function compareStrongsKeys(a: unknown, b: unknown): number {
  const left = parseStrongsKey(a);
  const right = parseStrongsKey(b);
  if (!left.ok || !right.ok) {
    if (left.ok) return -1;
    if (right.ok) return 1;
    return String(a).localeCompare(String(b));
  }
  if (left.testament !== right.testament) return left.testament === "H" ? -1 : 1;
  if (left.number !== right.number) return left.number - right.number;
  const ls = left.senseSuffix ?? "";
  const rs = right.senseSuffix ?? "";
  if (ls === rs) return 0;
  if (!ls) return -1;
  if (!rs) return 1;
  const lLower = ls === ls.toLowerCase();
  const rLower = rs === rs.toLowerCase();
  if (lLower !== rLower) return lLower ? 1 : -1;
  return ls < rs ? -1 : 1;
}

/**
 * The bounds this module enforces, exposed so a test or an importer can assert
 * against them instead of hard-coding a second copy.
 */
export const strongsKeyBounds = {
  maxDigits: MAX_DIGITS,
  maxHebrew: MAX_HEBREW,
  maxGreek: MAX_GREEK,
  oshbPrefixSegments: OSHB_PREFIX_SEGMENTS as ReadonlySet<string>,
} as const;
