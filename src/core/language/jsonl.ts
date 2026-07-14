/**
 * Pure JSONL helpers for TokenRecord packages (INV-18 — no Node I/O).
 */

import type { TokenRecord } from "./types.js";

export type ParseTokensJsonlResult = {
  tokens: TokenRecord[];
  stats: { lines: number; parsed: number; skipped: number };
  warnings: string[];
};

/**
 * Parse a tokens.jsonl document (one TokenRecord JSON object per non-empty line).
 */
export function parseTokensJsonl(
  content: string,
  options: { maxWarnings?: number; expectedDatasetId?: string } = {},
): ParseTokensJsonlResult {
  const maxWarnings = options.maxWarnings ?? 50;
  const lines = content.split(/\r?\n/);
  const tokens: TokenRecord[] = [];
  const warnings: string[] = [];
  let lineCount = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    lineCount++;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped++;
      if (warnings.length < maxWarnings) {
        warnings.push(`line ${i + 1}: invalid JSON`);
      }
      continue;
    }
    const token = coerceTokenRecord(raw);
    if (!token) {
      skipped++;
      if (warnings.length < maxWarnings) {
        warnings.push(`line ${i + 1}: not a TokenRecord`);
      }
      continue;
    }
    if (options.expectedDatasetId && token.datasetId !== options.expectedDatasetId) {
      // still accept; warn once-ish
      if (warnings.length < maxWarnings) {
        warnings.push(
          `line ${i + 1}: datasetId "${token.datasetId}" ≠ expected "${options.expectedDatasetId}"`,
        );
      }
    }
    tokens.push(token);
  }

  return {
    tokens,
    stats: { lines: lineCount, parsed: tokens.length, skipped },
    warnings,
  };
}

/** Minimal structural check — keeps loaders honest without a full schema lib. */
export function coerceTokenRecord(raw: unknown): TokenRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.datasetId !== "string" || !o.datasetId) return null;
  if (typeof o.book !== "string" || !o.book) return null;
  if (typeof o.chapter !== "number" || !Number.isFinite(o.chapter)) return null;
  if (typeof o.verse !== "number" || !Number.isFinite(o.verse)) return null;
  if (typeof o.position !== "number" || !Number.isFinite(o.position)) return null;
  if (typeof o.surface !== "string") return null;
  if (!o.morph || typeof o.morph !== "object") return null;

  return {
    id: o.id,
    datasetId: o.datasetId,
    book: o.book as TokenRecord["book"],
    chapter: o.chapter,
    verse: o.verse,
    position: o.position,
    surface: o.surface,
    after: typeof o.after === "string" ? o.after : undefined,
    normalized: typeof o.normalized === "string" ? o.normalized : undefined,
    lemma: typeof o.lemma === "string" ? o.lemma : undefined,
    strong: typeof o.strong === "string" ? o.strong : undefined,
    strongPrefixed: typeof o.strongPrefixed === "string" ? o.strongPrefixed : undefined,
    morphCode: typeof o.morphCode === "string" ? o.morphCode : undefined,
    morph: o.morph as TokenRecord["morph"],
    gloss: typeof o.gloss === "string" ? o.gloss : undefined,
    louwNida: typeof o.louwNida === "string" ? o.louwNida : undefined,
    domain: typeof o.domain === "string" ? o.domain : undefined,
    role: typeof o.role === "string" ? o.role : undefined,
    wordClass: typeof o.wordClass === "string" ? o.wordClass : undefined,
    wordType: typeof o.wordType === "string" ? o.wordType : undefined,
  };
}

/** Installed package manifest shape written by import-macula-greek.ts */
export type LanguagePackageManifest = {
  id: string;
  name: string;
  language: string;
  type: "interlinear-data" | string;
  formatVersion: number;
  edition?: string;
  family?: string;
  datasetVersion?: string;
  tokenCount?: number;
  books?: string[];
  license?: {
    spdx?: string | null;
    name?: string;
    attributionText?: string;
  };
  source?: string;
  sourceNote?: string;
};

export function parseLanguagePackageManifest(raw: unknown): LanguagePackageManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.name !== "string" || !o.name) return null;
  if (typeof o.type !== "string") return null;
  if (typeof o.formatVersion !== "number") return null;
  return {
    id: o.id,
    name: o.name,
    language: typeof o.language === "string" ? o.language : "other",
    type: o.type,
    formatVersion: o.formatVersion,
    edition: typeof o.edition === "string" ? o.edition : undefined,
    family: typeof o.family === "string" ? o.family : undefined,
    datasetVersion: typeof o.datasetVersion === "string" ? o.datasetVersion : undefined,
    tokenCount: typeof o.tokenCount === "number" ? o.tokenCount : undefined,
    books: Array.isArray(o.books) ? o.books.filter((b): b is string => typeof b === "string") : undefined,
    license:
      o.license && typeof o.license === "object"
        ? (o.license as LanguagePackageManifest["license"])
        : undefined,
    source: typeof o.source === "string" ? o.source : undefined,
    sourceNote: typeof o.sourceNote === "string" ? o.sourceNote : undefined,
  };
}
