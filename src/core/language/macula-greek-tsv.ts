/**
 * Pure MACULA Greek Nestle1904 / SBLGNT TSV importer.
 * Pass file contents as a string — no Node I/O (INV-18).
 *
 * Source: https://github.com/Clear-Bible/macula-greek
 * Expected columns (tab-separated, header row required):
 *   xml:id, ref, role, class, type, english, mandarin, gloss, text, after,
 *   lemma, normalized, strong, morph, person, number, gender, case,
 *   tense, voice, mood, degree, domain, ln, frame, subjref, referent
 */

import { isValidBookCode } from "../reference/backbone.js";
import type { BookCode } from "../reference/types.js";
import { mergeMorphFeatures, parseMorphCode } from "./morph-labels.js";
import type {
  ParseMaculaGreekResult,
  TokenDatasetMeta,
  TokenRecord,
} from "./types.js";

export const MACULA_GREEK_NESTLE1904_META: TokenDatasetMeta = {
  id: "macula-greek-nestle1904",
  name: "MACULA Greek (Nestle 1904)",
  family: "macula-greek",
  edition: "Nestle1904",
  version: "unknown",
  language: "grc",
  license: {
    spdx: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    attributionText:
      "MACULA Greek Linguistic Datasets © Biblica, Inc / Clear Bible, available at https://github.com/Clear-Bible/macula-greek/, CC BY 4.0. Includes Nestle 1904 text and morphology; English glosses from the Berean Study Bible (public domain as of 2023 per MACULA license notes).",
  },
  sourceUrl: "https://github.com/Clear-Bible/macula-greek",
};

export const MACULA_GREEK_SBLGNT_META: TokenDatasetMeta = {
  ...MACULA_GREEK_NESTLE1904_META,
  id: "macula-greek-sblgnt",
  name: "MACULA Greek (SBLGNT)",
  edition: "SBLGNT",
  license: {
    spdx: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International (composite; see SBLGNT EULA for base text)",
    attributionText:
      "MACULA Greek Linguistic Datasets © Biblica, Inc / Clear Bible, https://github.com/Clear-Bible/macula-greek/, CC BY 4.0. SBLGNT base text subject to the SBLGNT EULA (https://sblgnt.com/license/).",
  },
};

/** MACULA book codes already match USFM for the NT; keep a small alias map. */
const BOOK_ALIASES: Record<string, BookCode> = {
  MAT: "MAT",
  MRK: "MRK",
  MAR: "MRK",
  LUK: "LUK",
  JHN: "JHN",
  JOH: "JHN",
  ACT: "ACT",
  ROM: "ROM",
  "1CO": "1CO",
  "2CO": "2CO",
  GAL: "GAL",
  EPH: "EPH",
  PHP: "PHP",
  PHI: "PHP",
  COL: "COL",
  "1TH": "1TH",
  "2TH": "2TH",
  "1TI": "1TI",
  "2TI": "2TI",
  TIT: "TIT",
  PHM: "PHM",
  HEB: "HEB",
  JAS: "JAS",
  JAM: "JAS",
  "1PE": "1PE",
  "2PE": "2PE",
  "1JN": "1JN",
  "2JN": "2JN",
  "3JN": "3JN",
  JUD: "JUD",
  JDE: "JUD",
  REV: "REV",
};

export type ParseMaculaGreekOptions = {
  /** Override dataset metadata (version tag, etc.). */
  dataset?: TokenDatasetMeta;
  /** Max warning messages to retain (default 50). */
  maxWarnings?: number;
};

/**
 * Parse a full MACULA Greek TSV document into TokenRecords.
 * Streaming-friendly alternative: {@link parseMaculaGreekTsvLine} + header map.
 */
export function parseMaculaGreekTsv(
  content: string,
  options: ParseMaculaGreekOptions = {},
): ParseMaculaGreekResult {
  const dataset = options.dataset ?? MACULA_GREEK_NESTLE1904_META;
  const maxWarnings = options.maxWarnings ?? 50;
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const tokens: TokenRecord[] = [];
  const books = new Set<string>();

  if (lines.length === 0 || !lines[0]?.trim()) {
    return {
      tokens: [],
      dataset,
      stats: { rows: 0, parsed: 0, skipped: 0, books: [] },
      warnings: ["empty input"],
    };
  }

  const header = splitTsvLine(lines[0]!);
  const col = buildColumnIndex(header);
  if (col["xml:id"] === undefined || col.ref === undefined || col.text === undefined) {
    return {
      tokens: [],
      dataset,
      stats: { rows: 0, parsed: 0, skipped: 0, books: [] },
      warnings: [
        `missing required columns (need xml:id, ref, text); got: ${header.join(", ")}`,
      ],
    };
  }

  let rows = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    rows++;
    const record = parseMaculaGreekTsvLine(line, col, dataset.id, (msg) => {
      if (warnings.length < maxWarnings) warnings.push(`line ${i + 1}: ${msg}`);
    });
    if (!record) {
      skipped++;
      continue;
    }
    tokens.push(record);
    books.add(record.book);
  }

  return {
    tokens,
    dataset,
    stats: {
      rows,
      parsed: tokens.length,
      skipped,
      books: [...books].sort(),
    },
    warnings,
  };
}

export type ColumnIndex = Record<string, number>;

export function buildColumnIndex(header: string[]): ColumnIndex {
  const col: ColumnIndex = {};
  for (let i = 0; i < header.length; i++) {
    const name = header[i]?.trim();
    if (name) col[name] = i;
  }
  return col;
}

/**
 * Parse one data row given a header column index.
 * Returns null if the row cannot produce a valid token.
 */
export function parseMaculaGreekTsvLine(
  line: string,
  col: ColumnIndex,
  datasetId: string,
  onWarning?: (message: string) => void,
): TokenRecord | null {
  const cells = splitTsvLine(line);
  const get = (name: string): string => {
    const idx = col[name];
    if (idx === undefined) return "";
    return cells[idx] ?? "";
  };

  const id = get("xml:id").trim();
  const ref = get("ref").trim();
  const surface = get("text");
  if (!id || !ref || !surface) {
    onWarning?.("missing xml:id, ref, or text");
    return null;
  }

  const parsedRef = parseMaculaRef(ref);
  if (!parsedRef) {
    onWarning?.(`unparseable ref "${ref}"`);
    return null;
  }

  const morphCode = emptyToUndef(get("morph"));
  const fromCode = parseMorphCode(morphCode);
  const morph = mergeMorphFeatures(fromCode, {
    pos: emptyToUndef(get("class")),
    person: emptyToUndef(get("person")),
    number: emptyToUndef(get("number")),
    gender: emptyToUndef(get("gender")),
    case: emptyToUndef(get("case")),
    tense: emptyToUndef(get("tense")),
    voice: emptyToUndef(get("voice")),
    mood: emptyToUndef(get("mood")),
    degree: emptyToUndef(get("degree")),
    code: morphCode,
  });

  const strongRaw = emptyToUndef(get("strong"));
  const strong = strongRaw ? strongRaw.replace(/^[GgHh]/, "") : undefined;

  return {
    id,
    datasetId,
    book: parsedRef.book,
    chapter: parsedRef.chapter,
    verse: parsedRef.verse,
    position: parsedRef.position,
    surface,
    after: emptyToUndef(get("after")),
    normalized: emptyToUndef(get("normalized")),
    lemma: emptyToUndef(get("lemma")),
    strong,
    strongPrefixed: strong ? `G${strong}` : undefined,
    morphCode,
    morph,
    gloss: emptyToUndef(get("gloss")),
    louwNida: emptyToUndef(get("ln")),
    domain: emptyToUndef(get("domain")),
    role: emptyToUndef(get("role")),
    wordClass: emptyToUndef(get("class")),
    wordType: emptyToUndef(get("type")),
  };
}

/** Parse MACULA ref like `1CO 13:8!8` or `MAT 1:1!1`. */
export function parseMaculaRef(
  ref: string,
): { book: BookCode; chapter: number; verse: number; position: number } | null {
  const m = ref.trim().match(/^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)!(\d+)$/);
  if (!m) return null;
  const rawBook = m[1]!.toUpperCase();
  const book = BOOK_ALIASES[rawBook] ?? (isValidBookCode(rawBook) ? (rawBook as BookCode) : null);
  if (!book) return null;
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  const position = Number(m[4]);
  if (!Number.isFinite(chapter) || !Number.isFinite(verse) || !Number.isFinite(position)) {
    return null;
  }
  if (chapter < 1 || verse < 1 || position < 1) return null;
  return { book, chapter, verse, position };
}

export function splitTsvLine(line: string): string[] {
  // MACULA TSV does not quote fields; tabs are delimiters only.
  return line.split("\t");
}

function emptyToUndef(value: string): string | undefined {
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}
