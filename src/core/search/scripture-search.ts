/**
 * Deterministic lexical Scripture search.
 *
 * This deliberately does not claim semantic similarity. It ranks exact
 * references elsewhere in the renderer, then phrases, complete term matches,
 * ordered proximity, and light English inflection matches here. The host owns
 * corpus I/O; this module remains pure platform-agnostic TypeScript (INV-18).
 */

export interface ScriptureSearchDocument {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  /** Stable canonical order supplied by the host. */
  order: number;
}

export type ScriptureSearchMatchKind = "phrase" | "all-terms" | "terms";

export interface ScriptureSearchHit extends ScriptureSearchDocument {
  score: number;
  matchKind: ScriptureSearchMatchKind;
}

export interface ScriptureSearchOptions {
  limit?: number;
  currentBook?: string;
  currentChapter?: number;
}

const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "bible", "can", "could", "did", "do",
  "does", "find", "for", "from", "give", "i", "in", "is", "it", "me",
  "of", "on", "or", "passage", "passages", "please", "said", "say", "says",
  "scripture", "show", "that", "the", "to", "verse", "verses", "was", "were",
  "what", "when", "where", "which", "who", "with", "would",
]);

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lightStem(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) {
    const base = token.slice(0, -3);
    return base.endsWith(base.at(-1) ?? " ") ? base.slice(0, -1) : base;
  }
  if (token.length > 4 && token.endsWith("ied")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("eth")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("est")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function queryTerms(query: string): string[] {
  const words = normalize(query).split(" ").filter(Boolean);
  const meaningful = words.filter((word) => !QUERY_STOP_WORDS.has(word));
  return [...new Set(meaningful.length > 0 ? meaningful : words)];
}

function tokenMatchScore(queryToken: string, documentToken: string): number {
  if (queryToken === documentToken) return 24;
  const queryStem = lightStem(queryToken);
  const documentStem = lightStem(documentToken);
  if (queryStem.length >= 3 && queryStem === documentStem) return 17;
  if (
    Math.min(queryToken.length, documentToken.length) >= 4
    && (documentToken.startsWith(queryToken) || queryToken.startsWith(documentToken))
  ) return 10;
  return 0;
}

function orderedProximity(positions: number[]): number {
  if (positions.length < 2 || positions.some((position) => position < 0)) return 0;
  for (let index = 1; index < positions.length; index += 1) {
    if ((positions[index] ?? 0) <= (positions[index - 1] ?? 0)) return 0;
  }
  const span = (positions.at(-1) ?? 0) - (positions[0] ?? 0);
  return Math.max(3, 24 - Math.max(0, span - positions.length + 1) * 3);
}

export function searchScriptureDocuments(
  documents: readonly ScriptureSearchDocument[],
  query: string,
  options: ScriptureSearchOptions = {},
): ScriptureSearchHit[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const minimumMatches = Math.max(1, Math.ceil(terms.length * 0.6));
  const hits: ScriptureSearchHit[] = [];

  for (const document of documents) {
    const normalizedText = normalize(document.text);
    const tokens = normalizedText.split(" ").filter(Boolean);
    const exactPhrase = normalizedQuery.length >= 3 && normalizedText.includes(normalizedQuery);
    const positions: number[] = [];
    let score = exactPhrase ? 140 + Math.min(40, terms.length * 6) : 0;
    let matched = 0;

    for (const term of terms) {
      let bestScore = 0;
      let bestPosition = -1;
      for (let index = 0; index < tokens.length; index += 1) {
        const candidateScore = tokenMatchScore(term, tokens[index] ?? "");
        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestPosition = index;
          if (bestScore === 24) break;
        }
      }
      positions.push(bestPosition);
      if (bestScore > 0) {
        matched += 1;
        score += bestScore;
      }
    }

    if (!exactPhrase && matched < minimumMatches) continue;
    const allTerms = matched === terms.length;
    if (allTerms) score += 38 + orderedProximity(positions);
    score += (matched / terms.length) * 12;
    // Reading context is only a tie-breaker. It can never make a weaker
    // textual result outrank an exact phrase or complete term match.
    if (document.book === options.currentBook) score += 0.7;
    if (document.book === options.currentBook && document.chapter === options.currentChapter) score += 0.2;

    hits.push({
      ...document,
      score,
      matchKind: exactPhrase ? "phrase" : allTerms ? "all-terms" : "terms",
    });
  }

  return hits
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, Math.max(1, options.limit ?? 20));
}
