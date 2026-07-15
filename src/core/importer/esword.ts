/**
 * e-Sword / MySword SQLite module reader.
 *
 * Two schema families (handoff 2026-07-14):
 *  - e-Sword Bible:     Bible(Book, Chapter, Verse, Scripture) + Details
 *  - e-Sword Dictionary: Dictionary(Topic, Definition) + Details  (.dctx)
 *  - e-Sword Lexicon:   Lexicon(Topic, Definition) + Details     (.lexi)
 *  - MySword dict:      dictionary(word, data) — deprioritized
 *
 * Book numbers are 1–66 Protestant/KJV order. Versification is KJV
 * (≈31,102 rows). Our backbone is slightly short (31,074) — Doctor reports
 * the delta; we still write every verse present in the module.
 */

import { DatabaseSync } from "node:sqlite";
import type { BackboneData } from "../reference/types.js";
import {
  parseEswordRtf,
  rtfToPlain,
  rtfToPlainWithStrongs,
  stripLightMarkup,
  type RtfHexEncoding,
  type StrongAlignmentToken,
} from "./rtf.js";

/** USFM codes in e-Sword / KJV book order (1-indexed Book column). */
export const ESWORD_BOOKS: readonly string[] = [
  "GEN",
  "EXO",
  "LEV",
  "NUM",
  "DEU",
  "JOS",
  "JDG",
  "RUT",
  "1SA",
  "2SA",
  "1KI",
  "2KI",
  "1CH",
  "2CH",
  "EZR",
  "NEH",
  "EST",
  "JOB",
  "PSA",
  "PRO",
  "ECC",
  "SNG",
  "ISA",
  "JER",
  "LAM",
  "EZK",
  "DAN",
  "HOS",
  "JOL",
  "AMO",
  "OBA",
  "JON",
  "MIC",
  "NAH",
  "HAB",
  "ZEP",
  "HAG",
  "ZEC",
  "MAL",
  "MAT",
  "MRK",
  "LUK",
  "JHN",
  "ACT",
  "ROM",
  "1CO",
  "2CO",
  "GAL",
  "EPH",
  "PHP",
  "COL",
  "1TH",
  "2TH",
  "1TI",
  "2TI",
  "TIT",
  "PHM",
  "HEB",
  "JAS",
  "1PE",
  "2PE",
  "1JN",
  "2JN",
  "3JN",
  "JUD",
  "REV",
] as const;

/** Classic KJV Protestant verse total (e-Sword full Bibles). */
export const KJV_VERSE_TOTAL = 31102;

export type EswordModuleKind = "bible" | "dictionary" | "lexicon" | "mysword-dictionary" | "unknown";

export type EswordDetails = Record<string, string | number | null>;

export type BibleVerseRow = {
  book: string;
  bookNum: number;
  chapter: number;
  verse: number;
  /** Plain reading text. */
  text: string;
  /** Present when captureAlignments was requested. */
  alignments?: StrongAlignmentToken[];
};

export type DictionaryEntry = {
  topic: string;
  definitionPlain: string;
  definitionRaw: string;
  format: "rtf" | "html" | "plain";
};

export type BibleDoctorReport = {
  totalRows: number;
  emptyRows: number;
  emptyRate: number;
  expectedKjvTotal: number;
  vsKjvDelta: number;
  backboneMismatches: Array<{
    book: string;
    chapter: number;
    moduleVerses: number;
    backboneVerses: number;
  }>;
  booksPresent: number;
  sample: Array<{ ref: string; text: string }>;
};

export function openEswordDb(filePath: string): DatabaseSync {
  return new DatabaseSync(filePath, { readOnly: true });
}

export function detectModuleKind(db: DatabaseSync): EswordModuleKind {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => String((r as { name: string }).name));
  const lower = new Set(tables.map((t) => t.toLowerCase()));
  if (lower.has("bible")) return "bible";
  if (lower.has("lexicon")) return "lexicon";
  if (lower.has("dictionary") && tables.some((t) => t === "Dictionary")) return "dictionary";
  if (lower.has("dictionary") && tables.some((t) => t === "dictionary")) return "mysword-dictionary";
  return "unknown";
}

export function readDetails(db: DatabaseSync): EswordDetails {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => String((r as { name: string }).name));
  const detailsName = tables.find((t) => t.toLowerCase() === "details");
  if (!detailsName) return {};
  const row = db.prepare(`SELECT * FROM "${detailsName}" LIMIT 1`).get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return {};
  const out: EswordDetails = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v == null ? null : typeof v === "number" ? v : String(v);
  }
  return out;
}

export type ReadBibleOptions = {
  /** Capture Strong's superscripts (AKJV+2). */
  captureAlignments?: boolean;
  /**
   * How to interpret Scripture cells:
   *  - auto: RTF if has `\`, else light HTML/plain
   *  - plain: strip light markup only (YLT)
   *  - rtf: full RTF path
   */
  mode?: "auto" | "plain" | "rtf";
};

export function readBibleVerses(db: DatabaseSync, options: ReadBibleOptions = {}): BibleVerseRow[] {
  const mode = options.mode ?? "auto";
  const capture = options.captureAlignments === true;
  const rows = db
    .prepare("SELECT Book, Chapter, Verse, Scripture FROM Bible ORDER BY Book, Chapter, Verse")
    .all() as Array<{ Book: number | string; Chapter: number | string; Verse: number | string; Scripture: string | null }>;

  const out: BibleVerseRow[] = [];
  for (const r of rows) {
    const bookNum = Number(r.Book);
    const chapter = Number(r.Chapter);
    const verse = Number(r.Verse);
    const book = ESWORD_BOOKS[bookNum - 1];
    if (!book || !Number.isFinite(chapter) || !Number.isFinite(verse)) continue;

    const raw = r.Scripture ?? "";
    let text: string;
    let alignments: StrongAlignmentToken[] | undefined;

    if (mode === "plain" || (mode === "auto" && !raw.includes("\\"))) {
      text = stripLightMarkup(raw);
      if (capture && raw.includes("\\super")) {
        const parsed = rtfToPlainWithStrongs(raw);
        text = parsed.text || text;
        alignments = parsed.alignments;
      }
    } else {
      const parsed = capture ? rtfToPlainWithStrongs(raw) : { text: rtfToPlain(raw), alignments: [] as StrongAlignmentToken[] };
      text = parsed.text;
      if (capture) alignments = parsed.alignments;
    }

    out.push({
      book,
      bookNum,
      chapter,
      verse,
      text,
      ...(alignments && alignments.length > 0 ? { alignments } : {}),
    });
  }
  return out;
}

export function doctorBible(
  verses: BibleVerseRow[],
  backbone: BackboneData | null,
): BibleDoctorReport {
  const emptyRows = verses.filter((v) => !v.text.trim()).length;
  const byChapter = new Map<string, number>();
  for (const v of verses) {
    const key = `${v.book}:${v.chapter}`;
    byChapter.set(key, (byChapter.get(key) ?? 0) + 1);
  }

  const backboneMismatches: BibleDoctorReport["backboneMismatches"] = [];
  if (backbone) {
    for (const [book, info] of Object.entries(backbone.books)) {
      info.chapters.forEach((expected, idx) => {
        const chapter = idx + 1;
        const actual = byChapter.get(`${book}:${chapter}`) ?? 0;
        if (actual !== expected) {
          backboneMismatches.push({
            book,
            chapter,
            moduleVerses: actual,
            backboneVerses: expected,
          });
        }
      });
    }
  }

  const booksPresent = new Set(verses.map((v) => v.book)).size;
  const sampleRefs = [
    { book: "GEN", chapter: 1, verse: 1 },
    { book: "PSA", chapter: 23, verse: 1 },
    { book: "JHN", chapter: 3, verse: 16 },
    { book: "1CO", chapter: 16, verse: 24 },
  ];
  const sample: BibleDoctorReport["sample"] = [];
  for (const ref of sampleRefs) {
    const hit = verses.find(
      (v) => v.book === ref.book && v.chapter === ref.chapter && v.verse === ref.verse,
    );
    if (hit) {
      sample.push({
        ref: `${ref.book} ${ref.chapter}:${ref.verse}`,
        text: hit.text.slice(0, 120),
      });
    }
  }

  return {
    totalRows: verses.length,
    emptyRows,
    emptyRate: verses.length === 0 ? 0 : emptyRows / verses.length,
    expectedKjvTotal: KJV_VERSE_TOTAL,
    vsKjvDelta: verses.length - KJV_VERSE_TOTAL,
    backboneMismatches,
    booksPresent,
    sample,
  };
}

/**
 * Group plain verses into per-chapter chapter files:
 * `{ verses: [{ verse, text }] }`
 */
export function groupIntoChapters(
  verses: BibleVerseRow[],
): Map<string, Map<number, Array<{ verse: number; text: string }>>> {
  const books = new Map<string, Map<number, Array<{ verse: number; text: string }>>>();
  for (const v of verses) {
    if (!books.has(v.book)) books.set(v.book, new Map());
    const chMap = books.get(v.book)!;
    if (!chMap.has(v.chapter)) chMap.set(v.chapter, []);
    chMap.get(v.chapter)!.push({ verse: v.verse, text: v.text });
  }
  for (const chMap of books.values()) {
    for (const list of chMap.values()) {
      list.sort((a, b) => a.verse - b.verse);
    }
  }
  return books;
}

export type ReadDictionaryOptions = {
  /** Thayer Greek modules need CP1253 for `\'hh` runs. */
  hexEncoding?: RtfHexEncoding;
};

export function readDictionaryEntries(
  db: DatabaseSync,
  options: ReadDictionaryOptions = {},
): DictionaryEntry[] {
  const kind = detectModuleKind(db);
  let table: string;
  let topicCol: string;
  let defCol: string;
  if (kind === "lexicon") {
    table = "Lexicon";
    topicCol = "Topic";
    defCol = "Definition";
  } else if (kind === "dictionary") {
    table = "Dictionary";
    topicCol = "Topic";
    defCol = "Definition";
  } else if (kind === "mysword-dictionary") {
    table = "dictionary";
    topicCol = "word";
    defCol = "data";
  } else {
    throw new Error(`Not a dictionary/lexicon module (kind=${kind})`);
  }

  const rows = db.prepare(`SELECT "${topicCol}" AS topic, "${defCol}" AS def FROM "${table}"`).all() as Array<{
    topic: string;
    def: string | null;
  }>;

  const hexEncoding = options.hexEncoding;

  return rows.map((r) => {
    const raw = r.def ?? "";
    const format: DictionaryEntry["format"] = raw.includes("\\")
      ? "rtf"
      : /<\w[\s\S]*>/.test(raw)
        ? "html"
        : "plain";
    const plain =
      format === "rtf"
        ? parseEswordRtf(raw, { hexEncoding }).text
        : stripLightMarkup(raw);
    return {
      topic: String(r.topic).trim().toUpperCase(),
      definitionPlain: plain,
      definitionRaw: raw,
      format,
    };
  });
}

export function normalizeStrongTopic(topic: string): string | null {
  const t = topic.trim().toUpperCase();
  const m = t.match(/^([HG])0*(\d{1,5})$/);
  if (!m) return null;
  return `${m[1]}${parseInt(m[2]!, 10)}`;
}
