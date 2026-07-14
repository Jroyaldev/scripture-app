/**
 * Load compact MACULA syntax book JSON for structure charts.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SyntaxPackageIndex, SyntaxSentence } from "../core/language/syntax-tree.js";
import {
  findLeafTokenIdByStrong,
  firstLeafTokenId,
  sentenceForToken,
} from "../core/language/syntax-tree.js";

export type SyntaxHit = {
  sentence: SyntaxSentence;
  packageId: string;
  book: string;
  focusTokenId: string;
  attribution: string;
};

/** Optional context when token package ids ≠ MACULA syntax leaf ids (OSHB). */
export type SyntaxTokenContext = {
  chapter: number;
  verse: number;
  strong?: string | null;
  surface?: string | null;
};

export class SyntaxTreeLoader {
  private roots: string[];
  private cache = new Map<string, SyntaxPackageIndex>();

  constructor(syntaxRoots: string[]) {
    this.roots = syntaxRoots.filter((r) => r.length > 0);
  }

  setRoots(roots: string[]): void {
    this.roots = roots.filter((r) => r.length > 0);
    this.cache.clear();
  }

  /** Map interlinear package id → syntax data folder. */
  resolveSyntaxPackageId(packageId: string): string {
    if (
      packageId.includes("macula-greek") ||
      packageId === "macula-greek-nestle1904"
    ) {
      return "macula-greek-nestle1904";
    }
    if (
      packageId.includes("oshb") ||
      packageId.includes("macula-hebrew") ||
      packageId === "oshb-wlc"
    ) {
      return "macula-hebrew-wlc";
    }
    return packageId;
  }

  /** List available books under first matching package folder. */
  listBooks(packageId = "macula-greek-nestle1904"): string[] {
    const id = this.resolveSyntaxPackageId(packageId);
    for (const root of this.roots) {
      const dir = join(root, id);
      if (!existsSync(dir)) continue;
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json") && f !== "manifest.json")
        .map((f) => f.replace(/\.json$/, ""));
    }
    return [];
  }

  loadBook(packageId: string, book: string): SyntaxPackageIndex | null {
    const syntaxId = this.resolveSyntaxPackageId(packageId);
    const key = `${syntaxId}/${book.toUpperCase()}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    for (const root of this.roots) {
      const path = join(root, syntaxId, `${book.toUpperCase()}.json`);
      if (!existsSync(path)) continue;
      try {
        const index = JSON.parse(readFileSync(path, "utf8")) as SyntaxPackageIndex;
        this.cache.set(key, index);
        return index;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Resolve the syntactic sentence for a language token.
   * Greek MACULA: match leaf tokenId.
   * Hebrew OSHB: match sentence by verse, focus leaf by Strong’s.
   */
  getForToken(
    packageId: string,
    book: string,
    tokenId: string,
    ctx?: SyntaxTokenContext | null,
  ): SyntaxHit | null {
    const syntaxId = this.resolveSyntaxPackageId(packageId);
    const index = this.loadBook(syntaxId, book);
    if (!index) return null;

    let sentence = sentenceForToken(index, tokenId);
    if (!sentence && ctx) {
      sentence =
        index.sentences.find(
          (s) =>
            s.chapter === ctx.chapter &&
            ctx.verse >= s.verseStart &&
            ctx.verse <= s.verseEnd,
        ) ?? null;
    }
    if (!sentence) return null;

    let focusTokenId = tokenId;
    if (!sentence.tokenIds.includes(tokenId)) {
      const byStrong =
        ctx?.strong != null
          ? findLeafTokenIdByStrong(sentence.root, String(ctx.strong))
          : null;
      focusTokenId = byStrong ?? firstLeafTokenId(sentence.root) ?? sentence.tokenIds[0]!;
    }

    return {
      sentence,
      packageId: syntaxId,
      book: book.toUpperCase(),
      focusTokenId,
      attribution: index.source,
    };
  }
}
