/**
 * TFLSJ — Translators Formatted full LSJ Bible lexicon (STEPBible, CC BY 4.0).
 *
 * Pure parsing only. No Node imports: the byte-range reads that make this
 * module worth having live in `scripts/import-lsj.ts` (build time) and in the
 * host loader (run time). This file knows the *format*, not the filesystem.
 *
 * ── Why an offset index and not one in-memory map ──────────────────────────
 * The two source files are 32,208,907 b of prose for 11,034 entries, and a
 * word card wants exactly one of them. `LsjSlice` records where a row starts
 * and how long it is, so a reader seeks and reads ~3.5 KB instead of parsing
 * 32 MB. `scripts/import-lsj.ts` reports the measured comparison.
 *
 * ── The one thing not to get wrong ─────────────────────────────────────────
 * LSJ prose and LSJ *bibliography* are different kinds of text, and the source
 * interleaves them:
 *
 *   <b>without weight,</b> [<a href="javascript:void(0)" title=" …refs… ">Refs 4th c.BC+</a>];
 *
 * The visible `Refs 4th c.BC+` is a summary label; the `title` is the actual
 * citation apparatus, which STEP shows only on hover. The `href` is a no-op —
 * rendering it as a link produces a dead link and feeding it to `innerHTML`
 * ships a `javascript:` URL. So `parseLsjMeaning` lifts every citation out of
 * the prose into `citations[]` and leaves a `{kind:"citation"}` placeholder
 * behind. Nothing is dropped; the two are merely separated, because the card
 * has to draw them differently.
 */

import { canonicalStrongsKey, padStrongsKey } from "./strongs-key.js";

/** Attribution required by the source, verbatim from its own licence block. */
export const LSJ_ATTRIBUTION =
  "STEPBible TFLSJ, CC BY 4.0, stepbible.org.";

/** SPDX identifier for the source licence. */
export const LSJ_LICENSE = "CC-BY-4.0";

/**
 * The upstream file names, as shipped. Note the double space after `TFLSJ`
 * in the first one — it is in the upstream name and the URL 404s without it.
 */
export const LSJ_SOURCE_FILES = [
  "TFLSJ  0-5624 - Translators Formatted full LSJ Bible lexicon - STEPBible.org CC BY.txt",
  "TFLSJ extra - Translators Formatted full LSJ Bible lexicon - STEPBible.org CC BY.txt",
] as const;

/** The 8 columns of a TFLSJ data row, in order. */
export const LSJ_COLUMNS = [
  "eStrong",
  "dStrong",
  "uStrong",
  "Greek",
  "Transliteration",
  "Morph",
  "Gloss",
  "LSJ Meaning",
] as const;

/** The header line that precedes the data rows in both files. */
export const LSJ_HEADER_PREFIX = "eStrong\tdStrong\tuStrong";

/**
 * The exact opening of every citation anchor — byte-identical in all 121,853
 * of them, verified across both files. The parse depends on that, so the
 * string is named rather than inlined.
 */
export const LSJ_CITATION_OPEN = '<a href="javascript:void(0)" title="';

/** Which of the two source files a slice points into. */
export type LsjSourceFile = 0 | 1;

/**
 * Where one entry lives. The unit is **bytes**, not characters: the file is
 * UTF-8 and full of Greek, so a character offset would not survive a seek.
 */
export type LsjSlice = {
  file: LsjSourceFile;
  /** Byte offset of the first byte of the row. */
  offset: number;
  /** Byte length of the row, excluding its line terminator. */
  length: number;
};

/** Relation phrase from column 2, after the `=`. Empty for a plain entry. */
export type LsjRelation =
  | ""
  | "the Greek of"
  | "a Form of"
  | "a Spelling of"
  | "a Meaning of"
  | "a Name of"
  | "a Combination of"
  | "a Group member of"
  | "a Part of";

/**
 * Who wrote the prose in column 8. Mutually exclusive — verified: of 11,034
 * rows, 10,337 carry no marker, 543 the Abbott-Smith fallback, 121 "Not in
 * LSJ", 33 "(Middle Liddel)", and no row carries two.
 */
export type LsjProvenance =
  /** Liddell-Scott-Jones 9th ed., as edited by Tyndale House. */
  | "lsj"
  /**
   * LSJ has no entry, so the row carries Abbott-Smith prose instead, with a
   * trailing "(From Abbott-Smith. LSJ has no entry)". These rows are NOT
   * empty — 543 of them, 102 to 1,436 chars, with real senses and scripture
   * references. Label them; do not discard them.
   */
  | "abbott-smith-fallback"
  /** Filled from Middle Liddell, marked "(Middle Liddel)" upstream (sic). */
  | "middle-liddell"
  /** A short editorial note stating the word is not in LSJ at all. */
  | "not-in-lsj"
  /** Column 8 is empty. 77 rows, all in the G21425+ range of the extra file. */
  | "empty";

/** Corpus named in a citation label. */
export type LsjCorpus = "LXX" | "NT";

/** Inline character styling carried by a text node. */
export type LsjEmphasis =
  | "bold"
  | "italic"
  | "underline"
  /**
   * A Tyndale-expanded grammatical term, written `_accusative_` upstream.
   * 13,525 spans, 13,093 of them inside citation apparatus.
   */
  | "grammar";

/**
 * One citation: the label the reader sees and the apparatus STEP hides behind
 * it. Both are kept. `apparatus` is verbatim so nothing is lost;
 * `apparatusText` is the same thing with markup resolved, for a tooltip.
 */
export type LsjCitation = {
  /** Visible label, verbatim: "Refs 5th c.BC+", "LXX+NT", "NT", "Refs". */
  label: string;
  /** The hidden bibliography, verbatim from the `title` attribute. */
  apparatus: string;
  /** `apparatus` with tags, entities and `_grammar_` markers resolved. */
  apparatusText: string;
  /** Corpora named in the label. */
  corpora: LsjCorpus[];
  /**
   * Centuries stated in the label, and their era. A label may state a span
   * ("5th-6th c.BC"), so this is a list and deliberately not reduced to a
   * single "earliest" — for BC the larger number is the earlier one, and
   * collapsing that silently would invent a fact.
   */
  dating: { centuries: number[]; era: "BC" | "AD"; uncertain: boolean } | null;
  /** Label ends with `+`, i.e. "and later". */
  openEnded: boolean;
  /**
   * The source wrapped the marker in `[ ]`. True for 121,824 of 121,853; the
   * brackets are the source's own delimiters, so they are removed from the
   * prose and recorded here rather than left to print mid-sentence.
   */
  bracketed: boolean;
  /**
   * Scripture references named inside the apparatus, verbatim, e.g.
   * "NT.Rev.1.8", "LXX.1Ki.21(20).23". Left unmapped on purpose: TFLSJ uses
   * its own book abbreviations and guessing the mapping links the wrong verse.
   */
  refs: string[];
  /**
   * The `<date>…<author>…</author></date>` inline form, which has no hover
   * text at all. 3 rows. Distinguished so a renderer does not promise a
   * tooltip that is empty.
   */
  inline: boolean;
  /**
   * The apparatus swallowed markup, which upstream means an unterminated
   * `title` attribute ate some definition prose. 1 row (G7417 in the extra
   * file). Flagged rather than silently reflowed.
   */
  suspect: boolean;
};

/** One node of definition prose, in reading order. */
export type LsjNode =
  /** Prose. `styles` is empty for unstyled text. */
  | { kind: "text"; text: string; styles: LsjEmphasis[] }
  /** A `<br />` / `<BR />` / `<br>` / `<lb />` line break. */
  | { kind: "break" }
  /**
   * A sense divider. Depth comes from the tag name (`<Level2>`), the label
   * from its content with the upstream `__` prefix removed ("II", "3", "B.II.1").
   * These are markers, not containers: the element wraps only the label, so a
   * sense runs until the next divider of the same or lower depth.
   */
  | { kind: "sense"; depth: number; label: string }
  /** A citation marker. `citation` indexes `LsjMeaning.citations`. */
  | { kind: "citation"; citation: number }
  /**
   * A scripture reference, `<ref='Exo.4.14'>Exo.4:14</ref>`. `ref` is the
   * machine form, `text` what the source printed. Not remapped to app book
   * ids here, for the reason given on `LsjCitation.refs`.
   */
  | { kind: "scriptureRef"; ref: string; text: string };

/** Column 8, parsed: prose separated from apparatus. */
export type LsjMeaning = {
  nodes: LsjNode[];
  citations: LsjCitation[];
  provenance: LsjProvenance;
  /** Deepest `<LevelN>` seen. 0 when the entry has no sense dividers. */
  maxSenseDepth: number;
};

/** One TFLSJ row, fully parsed. */
export type LsjEntry = {
  /**
   * Canonical join key from column 2 (`dStrong`) — unpadded, sigil upper,
   * sense suffix preserved: `G749`, `G3137G`. Column 2 is the key, not
   * column 1: they disagree on exactly one row (eStrong `G2495` /
   * dStrong `G2491K`, Ἰωνᾶς).
   */
  key: string;
  /** `key` zero-padded to 4 digits for upstream joins: `G0749`. */
  padded: string;
  /** Column 1, verbatim. */
  eStrong: string;
  /** Column 2's leading token, verbatim (still padded upstream). */
  dStrong: string;
  /**
   * Column 3. A cross-reference, not this entry's own key — it can name a
   * Hebrew number (233 rows) or a compound (`G3756 (G3361+G3756)`, 8 rows).
   */
  uStrong: string;
  /** Column 2's relation phrase, after the `=`. */
  relation: LsjRelation;
  /**
   * Column 4, the Greek lexical form, VERBATIM. Empty on 1 row (G2199H).
   *
   * Not normalised, because the shipped file is not normalised and this field
   * is what the source says. See `greekNormalized` before comparing it to
   * anything.
   */
  greek: string;
  /**
   * `greek` in NFC — the form to join or compare on.
   *
   * 9,666 of 11,034 rows (87.6%) write Greek in neither NFC nor NFD: they use
   * the "oxia" compatibility characters (U+1F71 ά, U+1F73 έ, U+1F75 ή,
   * U+1F77 ί, U+1F79 ό, U+1F7B ύ, U+1F7D ώ, U+1FD3 ΐ, U+1FE3 ΰ), which NFC
   * folds onto the "tonos" forms (U+03AC…). Our own Greek token package is
   * 100% NFC, so a lemma-string comparison against TFLSJ misses on 87.6% of
   * words unless one side is normalised. This is why the join is on Strong's
   * and not on the lemma; the normalised form is here for display and for any
   * caller that does want to compare strings.
   */
  greekNormalized: string;
  /** Column 5. Empty on 105 rows. */
  transliteration: string;
  /** Column 6, STEP's simple morph value. Empty on 1,264 rows. */
  morph: string;
  /** Column 7, the Tyndale one-word gloss. Empty on 1 row. */
  gloss: string;
  /** Column 8, parsed. */
  meaning: LsjMeaning;
};

/** A row split into columns, before the expensive column-8 parse. */
export type LsjRow = {
  key: string;
  columns: string[];
};

/** Per-file provenance recorded in the manifest. */
export type LsjSourceFileMeta = {
  id: LsjSourceFile;
  /** Path relative to the index, as shipped. */
  path: string;
  /** Upstream file name, verbatim, double space and all. */
  upstreamName: string;
  bytes: number;
  sha256: string;
  rowCount: number;
};

/** One shard of the offset table. */
export type LsjShardMeta = {
  /** Shard id: `floor(strongNumber / 1000)`. */
  id: number;
  path: string;
  entryCount: number;
  /** Inclusive numeric bounds of the Strong's numbers in this shard. */
  lowest: number;
  highest: number;
};

/**
 * The small file a reader loads first. Deliberately tiny — it names the
 * shards and the raw files and nothing else, so a cold word card pays a few
 * kilobytes, not megabytes.
 */
export type LsjIndexManifest = {
  version: 1;
  source: "STEPBible TFLSJ";
  license: "CC BY 4.0";
  attribution: string;
  generatedAt: string;
  files: LsjSourceFileMeta[];
  entryCount: number;
  shards: LsjShardMeta[];
  /**
   * Plain (unsuffixed) key → the canonical keys that share that base, in
   * source order. Lets `G3137` reach ἡ Μαρία's seven senses without a scan.
   * Only bases that actually split are listed: 186 in the main file, 2 in
   * the extra.
   */
  senseSiblings: Record<string, string[]>;
};

/** One shard file: canonical key → byte slice. */
export type LsjShardFile = {
  version: 1;
  id: number;
  /** Canonical key → slice. */
  slices: Record<string, LsjSlice>;
};

const RELATIONS: readonly LsjRelation[] = [
  "",
  "the Greek of",
  "a Form of",
  "a Spelling of",
  "a Meaning of",
  "a Name of",
  "a Combination of",
  "a Group member of",
  "a Part of",
];

/** Shard id for a Strong's number. Matches the source's own 0-5624 grouping. */
export function lsjShardIdForNumber(strongNumber: number): number {
  return Math.floor(strongNumber / 1000);
}

/**
 * Shard id for a canonical or padded key, or `null` when the key is not a
 * Greek Strong's number at all.
 */
export function lsjShardIdForKey(key: string): number | null {
  const match = /^[Gg]0*(\d+)/.exec(key.trim());
  if (!match?.[1]) return null;
  return lsjShardIdForNumber(Number(match[1]));
}

/**
 * Lookup keys to try for an incoming Strong's tag, most specific first.
 *
 * TFLSJ is keyed on the sense-disambiguated `dStrong`, but 5,601 of 5,709
 * main-file rows are unsuffixed, so a plain key lands correctly for most
 * words. When the plain key has no row of its own, the manifest's
 * `senseSiblings` supplies the senses to choose between rather than this
 * function guessing one.
 */
export function lsjLookupCandidates(rawKey: string): string[] {
  const canonical = canonicalStrongsKey(rawKey);
  if (!canonical) return [];
  const out = [canonical];
  const base = /^([Gg])0*(\d+)[A-Za-z]$/.exec(canonical);
  if (base?.[1] && base[2]) {
    const plain = `${base[1].toUpperCase()}${Number(base[2])}`;
    if (plain !== canonical) out.push(plain);
  }
  return out;
}

/**
 * Resolve a Strong's tag to a byte slice. Pure: it consults an already-loaded
 * shard and returns coordinates. The caller does the read.
 */
export function lookupLsjSlice(
  shard: LsjShardFile,
  rawKey: string,
): { key: string; slice: LsjSlice } | null {
  for (const candidate of lsjLookupCandidates(rawKey)) {
    const slice = shard.slices[candidate];
    if (slice) return { key: candidate, slice };
  }
  return null;
}

/** True for the header line that precedes the data rows. */
export function isLsjHeaderLine(line: string): boolean {
  return line.startsWith(LSJ_HEADER_PREFIX);
}

/**
 * True for a data row. The preamble is 60 lines of prose and a licence block,
 * then a header and a `====` rule; every data row begins with `G` and digits
 * in column 1, and nothing else in either file does.
 */
export function isLsjDataLine(line: string): boolean {
  const tab = line.indexOf("\t");
  if (tab <= 1) return false;
  return /^G\d+$/.test(line.slice(0, tab));
}

/** Split a data row into columns and canonicalise its key. Null if not a row. */
export function parseLsjRow(line: string): LsjRow | null {
  if (!isLsjDataLine(line)) return null;
  const columns = line.split("\t");
  if (columns.length < 8) return null;
  const key = canonicalStrongsKey(leadingStrongToken(columns[1] ?? ""));
  if (!key) return null;
  return { key, columns };
}

/** The `G0749` out of `G0749 = the Greek of`. */
function leadingStrongToken(dStrong: string): string {
  const match = /^\s*([GH]\d+[A-Za-z]?)/.exec(dStrong);
  return match?.[1] ?? "";
}

/** The relation phrase out of column 2, validated against the known set. */
export function parseLsjRelation(dStrong: string): LsjRelation {
  const match = /^\s*[GH]\d+[A-Za-z]?\s*=\s*([\s\S]*)$/.exec(dStrong);
  const phrase = (match?.[1] ?? "").trim();
  return RELATIONS.includes(phrase as LsjRelation) ? (phrase as LsjRelation) : "";
}

/** Full parse of one data row, column 8 included. */
export function parseLsjEntry(line: string): LsjEntry | null {
  const row = parseLsjRow(line);
  if (!row) return null;
  const { columns } = row;
  const padded = padStrongsKey(row.key, 4) ?? row.key;
  return {
    key: row.key,
    padded,
    eStrong: (columns[0] ?? "").trim(),
    dStrong: leadingStrongToken(columns[1] ?? ""),
    uStrong: (columns[2] ?? "").trim(),
    relation: parseLsjRelation(columns[1] ?? ""),
    greek: (columns[3] ?? "").trim(),
    greekNormalized: (columns[3] ?? "").trim().normalize("NFC"),
    transliteration: (columns[4] ?? "").trim(),
    morph: (columns[5] ?? "").trim(),
    gloss: (columns[6] ?? "").trim(),
    meaning: parseLsjMeaning(columns[7] ?? ""),
  };
}

/** Which lexicon wrote this prose. Markers are mutually exclusive upstream. */
export function detectLsjProvenance(html: string): LsjProvenance {
  if (html.trim() === "") return "empty";
  if (html.includes("(From Abbott-Smith. LSJ has no entry)")) {
    return "abbott-smith-fallback";
  }
  if (html.includes("(Middle Liddel)")) return "middle-liddell";
  if (/Not in LSJ/.test(html)) return "not-in-lsj";
  return "lsj";
}

const ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ["&nbsp;", " "],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&amp;", "&"],
];

function decodeEntities(text: string): string {
  let out = text;
  for (const [from, to] of ENTITIES) out = out.split(from).join(to);
  return out;
}

/**
 * Resolve markup inside a citation apparatus to plain text. The apparatus is
 * kept verbatim as well; this is the tooltip-ready form.
 */
export function lsjApparatusToText(apparatus: string): string {
  return decodeEntities(apparatus)
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/_([^_\n]{1,60})_/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Parse a citation label such as "LXX+5th-6th c.BC+" into its parts. */
export function parseLsjCitationLabel(label: string): {
  corpora: LsjCorpus[];
  dating: LsjCitation["dating"];
  openEnded: boolean;
} {
  const corpora: LsjCorpus[] = [];
  if (/\bLXX\b/.test(label)) corpora.push("LXX");
  if (/\bNT\b/.test(label)) corpora.push("NT");

  // One regex for the whole dating expression, because the centuries and the
  // era are one grammatical unit: "5th c.BC", "5th-6th c.BC", "5th/4th c.BC".
  let dating: LsjCitation["dating"] = null;
  const match =
    /(\d+)(?:st|nd|rd|th)?(?:\s*[-–/]\s*(\d+)(?:st|nd|rd|th)?)?\s*c\.(BC|AD)/.exec(label);
  if (match?.[3] === "BC" || match?.[3] === "AD") {
    const centuries = [match[1], match[2]]
      .filter((value): value is string => value !== undefined)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    dating = { centuries, era: match[3], uncertain: label.includes("?") };
  }
  return { corpora, dating, openEnded: label.trimEnd().endsWith("+") };
}

type Scanner = {
  nodes: LsjNode[];
  citations: LsjCitation[];
  styles: LsjEmphasis[];
  maxSenseDepth: number;
};

function pushText(state: Scanner, raw: string): void {
  if (raw === "") return;
  const decoded = decodeEntities(raw);
  // `_term_` is a Tyndale expansion marker, not prose punctuation. Split on it
  // so the marker becomes a style rather than printing as underscores.
  const parts = decoded.split(/_([^_\n]{1,60})_/g);
  for (let i = 0; i < parts.length; i += 1) {
    const chunk = parts[i];
    if (chunk === undefined || chunk === "") continue;
    const isGrammar = i % 2 === 1;
    const styles = isGrammar ? [...state.styles, "grammar" as const] : [...state.styles];
    state.nodes.push({ kind: "text", text: chunk, styles });
  }
}

/** Drop a trailing `[` from the prose when it is the source's own delimiter. */
function stripTrailingBracket(state: Scanner): boolean {
  const last = state.nodes[state.nodes.length - 1];
  if (!last || last.kind !== "text" || !last.text.endsWith("[")) return false;
  const trimmed = last.text.slice(0, -1);
  if (trimmed === "") state.nodes.pop();
  else state.nodes[state.nodes.length - 1] = { ...last, text: trimmed };
  return true;
}

/**
 * Parse column 8, separating definition prose from citation apparatus.
 *
 * Single pass, no HTML library, because the input is not well-formed HTML and
 * a forgiving parser would guess differently than the source intends:
 *   · `title` values contain `<b>`/`<i>` and therefore `>` (5 anchors), so
 *     `<a[^>]*>` cannot match an anchor. The scan keys on `LSJ_CITATION_OPEN`
 *     and terminates the attribute on `">` — verified to find all 121,853
 *     anchors, with no title containing a straight double quote.
 *   · `<Level1>` sometimes opens and never closes (4 rows), so levels are
 *     read as markers, never paired.
 *   · `<span class=hiunderline>` is unquoted and unclosed (2 rows); unknown
 *     tags are dropped and their content kept.
 */
export function parseLsjMeaning(html: string): LsjMeaning {
  const provenance = detectLsjProvenance(html);
  const state: Scanner = { nodes: [], citations: [], styles: [], maxSenseDepth: 0 };
  let i = 0;
  let pending = "";

  const flush = (): void => {
    pushText(state, pending);
    pending = "";
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      pending += html.slice(i);
      break;
    }
    pending += html.slice(i, lt);

    // ── citation anchor ───────────────────────────────────────────────────
    if (html.startsWith(LSJ_CITATION_OPEN, lt)) {
      const valueStart = lt + LSJ_CITATION_OPEN.length;
      const valueEnd = html.indexOf('">', valueStart);
      if (valueEnd < 0) {
        // Cannot happen in either shipped file; keep the text rather than lose it.
        pending += html.slice(lt);
        break;
      }
      const apparatus = html.slice(valueStart, valueEnd);
      const closeTag = html.indexOf("</a>", valueEnd + 2);
      const labelEnd = closeTag < 0 ? html.length : closeTag;
      const label = html.slice(valueEnd + 2, labelEnd);

      flush();
      const bracketOpen = stripTrailingBracket(state);
      let after = closeTag < 0 ? html.length : closeTag + 4;
      const bracketClose = html[after] === "]";
      if (bracketOpen && bracketClose) after += 1;
      else if (bracketOpen && !bracketClose) {
        // Only one side present: put the literal `[` back, it belongs to prose.
        state.nodes.push({ kind: "text", text: "[", styles: [...state.styles] });
      }

      const parsedLabel = parseLsjCitationLabel(label);
      state.nodes.push({ kind: "citation", citation: state.citations.length });
      state.citations.push({
        label: label.trim(),
        apparatus,
        apparatusText: lsjApparatusToText(apparatus),
        corpora: parsedLabel.corpora,
        dating: parsedLabel.dating,
        openEnded: parsedLabel.openEnded,
        bracketed: bracketOpen && bracketClose,
        refs: extractLsjApparatusRefs(apparatus),
        inline: false,
        suspect: /<\/a>|<\/ref>/.test(apparatus),
      });
      i = after;
      continue;
    }

    // ── scripture reference ───────────────────────────────────────────────
    const refOpen = /^<ref\s*=\s*(['"])([^'"]*)\1\s*>/.exec(html.slice(lt, lt + 200));
    if (refOpen?.[2] !== undefined) {
      const bodyStart = lt + refOpen[0].length;
      const bodyEnd = html.indexOf("</ref>", bodyStart);
      const end = bodyEnd < 0 ? html.length : bodyEnd;
      flush();
      state.nodes.push({
        kind: "scriptureRef",
        ref: refOpen[2].trim(),
        text: decodeEntities(html.slice(bodyStart, end)).replace(/<[^>]*>/g, "").trim(),
      });
      i = bodyEnd < 0 ? end : bodyEnd + "</ref>".length;
      continue;
    }

    // ── the inline <date>…<author>…</author></date> citation form ─────────
    if (/^<date[\s>]/i.test(html.slice(lt, lt + 6))) {
      const end = html.toLowerCase().indexOf("</date>", lt);
      const stop = end < 0 ? html.length : end;
      const inner = html.slice(html.indexOf(">", lt) + 1, stop);
      flush();
      const bracketOpen = stripTrailingBracket(state);
      let after = end < 0 ? stop : stop + "</date>".length;
      const bracketClose = html[after] === "]";
      if (bracketOpen && bracketClose) after += 1;
      const author = /<author>([\s\S]*?)<\/author>/i.exec(inner)?.[1] ?? "";
      state.nodes.push({ kind: "citation", citation: state.citations.length });
      state.citations.push({
        label: lsjApparatusToText(inner.replace(/<author>[\s\S]*?<\/author>/i, "")),
        apparatus: inner,
        apparatusText: lsjApparatusToText(inner),
        corpora: [],
        dating: null,
        openEnded: false,
        bracketed: bracketOpen && bracketClose,
        refs: extractLsjApparatusRefs(author),
        inline: true,
        suspect: false,
      });
      i = after;
      continue;
    }

    // ── generic tag ───────────────────────────────────────────────────────
    const gt = html.indexOf(">", lt);
    if (gt < 0) {
      pending += html.slice(lt);
      break;
    }
    const rawTag = html.slice(lt + 1, gt);
    const closing = rawTag.startsWith("/");
    const name = (/^\/?\s*([A-Za-z][A-Za-z0-9]*)/.exec(rawTag)?.[1] ?? "").toLowerCase();

    switch (name) {
      case "b":
      case "i":
      case "u": {
        flush();
        const style: LsjEmphasis =
          name === "b" ? "bold" : name === "i" ? "italic" : "underline";
        if (closing) {
          const at = state.styles.lastIndexOf(style);
          if (at >= 0) state.styles.splice(at, 1);
        } else {
          state.styles.push(style);
        }
        break;
      }
      case "br":
      case "lb": {
        flush();
        state.nodes.push({ kind: "break" });
        break;
      }
      case "level1":
      case "level2":
      case "level3":
      case "level4":
      case "level5": {
        if (closing) break;
        flush();
        const depth = Number(name.slice("level".length));
        const close = html.indexOf(`</${rawTag}>`, gt + 1);
        // The element wraps only the label, and 4 rows open it with no close.
        const labelEnd = close < 0 ? gt + 1 : close;
        const label = html
          .slice(gt + 1, labelEnd)
          .replace(/<[^>]*>/g, "")
          .replace(/^_+/, "")
          .trim();
        state.nodes.push({ kind: "sense", depth, label });
        state.maxSenseDepth = Math.max(state.maxSenseDepth, depth);
        i = close < 0 ? gt + 1 : close + rawTag.length + 3;
        continue;
      }
      default:
        // Unknown or stray tag (`<span class=hiunderline>`, a lone `</a>`):
        // drop the tag, keep whatever follows.
        flush();
        break;
    }
    i = gt + 1;
  }

  flush();
  return {
    nodes: state.nodes,
    citations: state.citations,
    provenance,
    maxSenseDepth: state.maxSenseDepth,
  };
}

/**
 * Scripture references named inside a citation apparatus, verbatim.
 * Matches the `NT.Book.C.V` / `LXX.Book.C.V` form the apparatus uses,
 * including LXX's dual chapter numbering (`LXX.1Ki.21(20).23`).
 */
export function extractLsjApparatusRefs(apparatus: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern = /\b(NT|LXX)\.([1-4]?[A-Za-z]{2,5})\.(\d+(?:\(\d+\))?)\.(\d+)/g;
  for (const match of apparatus.matchAll(pattern)) {
    const ref = match[0];
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

/**
 * The definition as plain text, citations omitted. For capture-to-note and
 * for search. Citation apparatus is deliberately not interleaved: it is a
 * different kind of text and the caller decides whether to show it.
 */
export function lsjMeaningToText(meaning: LsjMeaning): string {
  let out = "";
  for (const node of meaning.nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "break":
        out += "\n";
        break;
      case "sense":
        out += `\n${node.label} `;
        break;
      case "scriptureRef":
        out += node.text;
        break;
      case "citation":
        break;
    }
  }
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * True when the entry has no LSJ prose worth opening a panel for. Note this
 * is NOT the Abbott-Smith fallback: those 543 rows carry real content and
 * only need a different byline.
 */
export function isLsjEntryEmpty(entry: LsjEntry): boolean {
  return entry.meaning.provenance === "empty" || lsjMeaningToText(entry.meaning) === "";
}
