/**
 * Derived indexes over TokenRecord[] — fully regenerable (INV-2).
 */

import type { TokenIndex, TokenMark, TokenRecord } from "./types.js";

export function verseKey(book: string, chapter: number, verse: number): string {
  return `${book}.${chapter}.${verse}`;
}

export function bookLemmaKey(book: string, lemma: string): string {
  return `${book}|${lemma}`;
}

export function chapterLemmaKey(book: string, chapter: number, lemma: string): string {
  return `${book}.${chapter}|${lemma}`;
}

/** Build indexes from a flat token list (any order; verse lists are sorted by position). */
export function buildTokenIndex(tokens: readonly TokenRecord[], datasetId?: string): TokenIndex {
  const byId = new Map<string, TokenRecord>();
  const byVerse = new Map<string, TokenRecord[]>();
  const byLemma = new Map<string, string[]>();
  const byStrong = new Map<string, string[]>();
  const lemmaFreqCorpus = new Map<string, number>();
  const lemmaFreqBook = new Map<string, number>();
  const lemmaFreqChapter = new Map<string, number>();

  let resolvedDatasetId = datasetId ?? "";

  for (const t of tokens) {
    if (!resolvedDatasetId) resolvedDatasetId = t.datasetId;
    byId.set(t.id, t);

    const vk = verseKey(t.book, t.chapter, t.verse);
    const verseList = byVerse.get(vk);
    if (verseList) verseList.push(t);
    else byVerse.set(vk, [t]);

    if (t.lemma) {
      pushId(byLemma, t.lemma, t.id);
      bump(lemmaFreqCorpus, t.lemma);
      bump(lemmaFreqBook, bookLemmaKey(t.book, t.lemma));
      bump(lemmaFreqChapter, chapterLemmaKey(t.book, t.chapter, t.lemma));
    }
    if (t.strong) {
      pushId(byStrong, t.strong, t.id);
    }
  }

  for (const list of byVerse.values()) {
    list.sort((a, b) => a.position - b.position);
  }

  return {
    datasetId: resolvedDatasetId,
    byId,
    byVerse,
    byLemma,
    byStrong,
    lemmaFreqCorpus,
    lemmaFreqBook,
    lemmaFreqChapter,
  };
}

function pushId(map: Map<string, string[]>, key: string, id: string): void {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Tokens for a verse in position order. */
export function tokensForVerse(
  index: TokenIndex,
  book: string,
  chapter: number,
  verse: number,
): TokenRecord[] {
  return index.byVerse.get(verseKey(book, chapter, verse)) ?? [];
}

/** All tokens of a lemma in a book, in reading order (book/ch/v/pos). */
export function lemmaOccurrencesInBook(
  index: TokenIndex,
  book: string,
  lemma: string,
): TokenRecord[] {
  const ids = index.byLemma.get(lemma) ?? [];
  const out: TokenRecord[] = [];
  for (const id of ids) {
    const t = index.byId.get(id);
    if (t && t.book === book) out.push(t);
  }
  out.sort(compareReadingOrder);
  return out;
}

export function compareReadingOrder(a: TokenRecord, b: TokenRecord): number {
  if (a.book !== b.book) return a.book < b.book ? -1 : 1;
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  if (a.verse !== b.verse) return a.verse - b.verse;
  return a.position - b.position;
}

export type MarkOptions = {
  /** Same lemma within this many verses counts as repeat (default 5). */
  repeatVerseWindow?: number;
  /** Lemma corpus frequency at or below this is rare (default 5). */
  rareMaxCorpusFreq?: number;
};

/**
 * Data-only marks for a verse: repeat + rare.
 * (Alignment "diverge" needs multi-version spans — not available from MACULA alone.)
 */
export function marksForVerse(
  index: TokenIndex,
  book: string,
  chapter: number,
  verse: number,
  options: MarkOptions = {},
): TokenMark[] {
  const window = options.repeatVerseWindow ?? 5;
  const rareMax = options.rareMaxCorpusFreq ?? 5;
  const tokens = tokensForVerse(index, book, chapter, verse);
  const marks: TokenMark[] = [];

  for (const t of tokens) {
    if (!t.lemma) continue;

    const corpusFreq = index.lemmaFreqCorpus.get(t.lemma) ?? 0;
    if (corpusFreq > 0 && corpusFreq <= rareMax) {
      marks.push({
        tokenId: t.id,
        kind: "rare",
        reason: `lemma "${t.lemma}" occurs ${corpusFreq}× in corpus`,
      });
    }

    const nearby = countLemmaNear(index, t, window);
    if (nearby >= 2) {
      marks.push({
        tokenId: t.id,
        kind: "repeat",
        reason: `lemma "${t.lemma}" occurs ${nearby}× within ±${window} verses`,
      });
    }
  }

  return marks;
}

function countLemmaNear(index: TokenIndex, token: TokenRecord, window: number): number {
  if (!token.lemma) return 0;
  const ids = index.byLemma.get(token.lemma) ?? [];
  let n = 0;
  for (const id of ids) {
    const other = index.byId.get(id);
    if (!other || other.book !== token.book) continue;
    // Approximate verse distance: chapter*1000 + verse (good enough for NT epistles)
    const d =
      Math.abs(other.chapter * 1000 + other.verse - (token.chapter * 1000 + token.verse));
    if (d <= window) n++;
  }
  return n;
}

/** ±k neighbors of a token within the same verse (by position). */
export function tokenNeighborhood(
  index: TokenIndex,
  tokenId: string,
  radius = 2,
): { before: TokenRecord[]; focus: TokenRecord | null; after: TokenRecord[] } {
  const focus = index.byId.get(tokenId) ?? null;
  if (!focus) return { before: [], focus: null, after: [] };
  const verse = tokensForVerse(index, focus.book, focus.chapter, focus.verse);
  const i = verse.findIndex((t) => t.id === tokenId);
  if (i < 0) return { before: [], focus, after: [] };
  return {
    before: verse.slice(Math.max(0, i - radius), i),
    focus,
    after: verse.slice(i + 1, i + 1 + radius),
  };
}
