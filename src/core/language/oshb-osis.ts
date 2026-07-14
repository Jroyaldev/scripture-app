/**
 * Pure OSHB OSIS importer (WLC + lemma/morph tags).
 * Pass each book XML file as a string — no Node I/O (INV-18).
 *
 * Source: https://github.com/openscriptures/morphhb (wlc/*.xml)
 * Word tags: <w lemma="b/7225" morph="HR/Ncfsa" id="01xeN">בְּ/רֵאשִׁ֖ית</w>
 */

import { isValidBookCode } from "../reference/backbone.js";
import type { BookCode } from "../reference/types.js";
import { parseHebrewMorphCode } from "./hebrew-morph-labels.js";
import type { TokenDatasetMeta, TokenRecord } from "./types.js";

export const OSHB_WLC_META: TokenDatasetMeta = {
  id: "oshb-wlc",
  name: "Open Scriptures Hebrew Bible (WLC)",
  family: "oshb",
  edition: "WLC",
  version: "unknown",
  language: "hbo",
  license: {
    spdx: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International (morph/lemma); WLC text public domain",
    attributionText:
      "Open Scriptures Hebrew Bible morphology data, CC BY 4.0, https://hb.openscriptures.org / https://github.com/openscriptures/morphhb. Westminster Leningrad Codex text, public domain.",
  },
  sourceUrl: "https://github.com/openscriptures/morphhb",
};

/** OSHB OSIS book id → USFM */
const OSIS_TO_USFM: Record<string, BookCode> = {
  Gen: "GEN",
  Exod: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deut: "DEU",
  Josh: "JOS",
  Judg: "JDG",
  Ruth: "RUT",
  "1Sam": "1SA",
  "2Sam": "2SA",
  "1Kgs": "1KI",
  "2Kgs": "2KI",
  "1Chr": "1CH",
  "2Chr": "2CH",
  Ezra: "EZR",
  Neh: "NEH",
  Esth: "EST",
  Job: "JOB",
  Ps: "PSA",
  Prov: "PRO",
  Eccl: "ECC",
  Song: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezek: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obad: "OBA",
  Jonah: "JON",
  Mic: "MIC",
  Nah: "NAH",
  Hab: "HAB",
  Zeph: "ZEP",
  Hag: "HAG",
  Zech: "ZEC",
  Mal: "MAL",
};

export type ParseOshbResult = {
  tokens: TokenRecord[];
  dataset: TokenDatasetMeta;
  stats: {
    words: number;
    parsed: number;
    skipped: number;
    books: string[];
  };
  warnings: string[];
};

export type ParseOshbOptions = {
  dataset?: TokenDatasetMeta;
  maxWarnings?: number;
};

/**
 * Parse one OSHB book OSIS XML document into TokenRecords.
 */
export function parseOshbOsisBook(
  xml: string,
  options: ParseOshbOptions = {},
): ParseOshbResult {
  const dataset = options.dataset ?? OSHB_WLC_META;
  const maxWarnings = options.maxWarnings ?? 50;
  const warnings: string[] = [];
  const tokens: TokenRecord[] = [];
  const books = new Set<string>();

  // Verse blocks: <verse osisID="Gen.1.1"> ... </verse>
  const verseRe = /<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi;
  let verseMatch: RegExpExecArray | null;
  let words = 0;
  let skipped = 0;

  while ((verseMatch = verseRe.exec(xml)) !== null) {
    const verseAttrs = verseMatch[1] ?? "";
    const verseBody = verseMatch[2] ?? "";
    const osisID = attr(verseAttrs, "osisID");
    if (!osisID) {
      skipped++;
      continue;
    }
    const loc = parseOsisVerseId(osisID);
    if (!loc) {
      if (warnings.length < maxWarnings) warnings.push(`bad osisID "${osisID}"`);
      skipped++;
      continue;
    }

    let position = 0;
    const wRe = /<w\b([^>]*)>([^<]*)<\/w>/gi;
    let wMatch: RegExpExecArray | null;
    while ((wMatch = wRe.exec(verseBody)) !== null) {
      words++;
      position++;
      const wAttrs = wMatch[1] ?? "";
      const surface = decodeXml((wMatch[2] ?? "").trim());
      if (!surface) {
        skipped++;
        continue;
      }

      const id = attr(wAttrs, "id") || `${loc.book}.${loc.chapter}.${loc.verse}.${position}`;
      const lemmaRaw = attr(wAttrs, "lemma");
      const morphCode = attr(wAttrs, "morph") || undefined;
      const { strong, lemmaKey } = parseOshbLemma(lemmaRaw);
      const { features } = parseHebrewMorphCode(morphCode);

      const token: TokenRecord = {
        id,
        datasetId: dataset.id,
        book: loc.book,
        chapter: loc.chapter,
        verse: loc.verse,
        position,
        surface,
        lemma: lemmaKey,
        strong,
        strongPrefixed: strong ? `H${strong}` : undefined,
        morphCode,
        morph: features,
        wordClass: features.pos,
      };
      tokens.push(token);
      books.add(loc.book);
    }
  }

  return {
    tokens,
    dataset,
    stats: {
      words,
      parsed: tokens.length,
      skipped,
      books: [...books].sort(),
    },
    warnings,
  };
}

/**
 * Parse many book XML strings (e.g. all of wlc/).
 */
export function parseOshbOsisBooks(
  booksXml: ReadonlyArray<{ name: string; xml: string }>,
  options: ParseOshbOptions = {},
): ParseOshbResult {
  const dataset = options.dataset ?? OSHB_WLC_META;
  const all: TokenRecord[] = [];
  const books = new Set<string>();
  let words = 0;
  let skipped = 0;
  const warnings: string[] = [];
  const maxWarnings = options.maxWarnings ?? 50;

  for (const { name, xml } of booksXml) {
    const result = parseOshbOsisBook(xml, { ...options, dataset, maxWarnings });
    all.push(...result.tokens);
    words += result.stats.words;
    skipped += result.stats.skipped;
    for (const b of result.stats.books) books.add(b);
    for (const w of result.warnings) {
      if (warnings.length < maxWarnings) warnings.push(`${name}: ${w}`);
    }
  }

  return {
    tokens: all,
    dataset,
    stats: {
      words,
      parsed: all.length,
      skipped,
      books: [...books].sort(),
    },
    warnings,
  };
}

export function parseOsisVerseId(
  osisID: string,
): { book: BookCode; chapter: number; verse: number } | null {
  // Gen.1.1 or 1Sam.2.3
  const m = osisID.trim().match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const usfm = OSIS_TO_USFM[m[1]!];
  if (!usfm || !isValidBookCode(usfm)) return null;
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  if (!Number.isFinite(chapter) || !Number.isFinite(verse) || chapter < 1 || verse < 1) {
    return null;
  }
  return { book: usfm, chapter, verse };
}

/**
 * OSHB lemma: "b/7225", "c/d/776", "1254 a", "430"
 * Strong's = last integer segment; lemma key keeps full string for indexing.
 */
export function parseOshbLemma(raw: string | null): {
  strong?: string;
  lemmaKey?: string;
} {
  if (!raw) return {};
  const lemmaKey = raw.trim();
  if (!lemmaKey) return {};
  // strip homograph letter suffix "1254 a" → 1254
  const parts = lemmaKey.split("/");
  let strong: string | undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!.trim();
    const m = p.match(/^(\d+)/);
    if (m) {
      strong = m[1];
      break;
    }
  }
  return { strong, lemmaKey };
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = attrs.match(re);
  return m?.[1] ?? null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function osisBookIds(): string[] {
  return Object.keys(OSIS_TO_USFM);
}
