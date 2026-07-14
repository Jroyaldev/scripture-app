/**
 * Load compact MACULA syntax book JSON for syntax art.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SyntaxPackageIndex, SyntaxSentence } from "../core/language/syntax-tree.js";
import { sentenceForToken } from "../core/language/syntax-tree.js";

export type SyntaxHit = {
  sentence: SyntaxSentence;
  packageId: string;
  book: string;
  focusTokenId: string;
  attribution: string;
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

  /** List available books under first matching package folder. */
  listBooks(packageId = "macula-greek-nestle1904"): string[] {
    for (const root of this.roots) {
      const dir = join(root, packageId);
      if (!existsSync(dir)) continue;
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json") && f !== "manifest.json")
        .map((f) => f.replace(/\.json$/, ""));
    }
    return [];
  }

  loadBook(packageId: string, book: string): SyntaxPackageIndex | null {
    const key = `${packageId}/${book.toUpperCase()}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    for (const root of this.roots) {
      const path = join(root, packageId, `${book.toUpperCase()}.json`);
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
   * Resolve the syntactic sentence containing this MACULA token id.
   */
  getForToken(
    packageId: string,
    book: string,
    tokenId: string,
  ): SyntaxHit | null {
    // Syntax package id may differ from token package id
    const syntaxId =
      packageId.includes("macula-greek") || packageId === "macula-greek-nestle1904"
        ? "macula-greek-nestle1904"
        : packageId;
    const index = this.loadBook(syntaxId, book);
    if (!index) return null;
    const sentence = sentenceForToken(index, tokenId);
    if (!sentence) return null;
    return {
      sentence,
      packageId: syntaxId,
      book: book.toUpperCase(),
      focusTokenId: tokenId,
      attribution: index.source,
    };
  }
}
