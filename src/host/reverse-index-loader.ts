/**
 * Loads precomputed reverse-index.json for aligned reading packages
 * (bsb, akjv-strongs). Pure lookup — no JSONL scan at runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReverseOrbitDetailed,
  englishKeysFromGloss,
  normalizeEnglishWord,
  type ReverseIndexFile,
  type ReverseOrbit,
  type ReverseStrongCount,
} from "../core/language/reverse-index.js";

export class ReverseIndexLoader {
  private roots: string[];
  private cache = new Map<string, ReverseIndexFile | null>();

  constructor(packageRoots: string[]) {
    this.roots = packageRoots.filter((r) => r.length > 0);
  }

  setRoots(packageRoots: string[]): void {
    this.roots = packageRoots.filter((r) => r.length > 0);
    this.cache.clear();
  }

  hasIndex(packageId: string): boolean {
    return this.load(packageId) != null;
  }

  load(packageId: string): ReverseIndexFile | null {
    if (this.cache.has(packageId)) return this.cache.get(packageId) ?? null;
    let found: ReverseIndexFile | null = null;
    for (const root of this.roots) {
      const path = join(root, packageId, "reverse-index.json");
      if (!existsSync(path)) continue;
      try {
        found = JSON.parse(readFileSync(path, "utf8")) as ReverseIndexFile;
        break;
      } catch {
        found = null;
      }
    }
    this.cache.set(packageId, found);
    return found;
  }

  lookup(packageId: string, english: string): ReverseStrongCount[] | null {
    const file = this.load(packageId);
    if (!file) return null;
    const key = normalizeEnglishWord(english);
    if (!key) return null;
    return file.words[key] ?? null;
  }

  /**
   * Resolve reverse orbit for a gloss, trying full phrase then content words.
   */
  resolveOrbit(opts: {
    packageId: string;
    gloss: string | null | undefined;
    displayWord?: string | null;
    currentStrong?: string | null;
    /** NT → "G", OT → "H" — same-testament bands lead. */
    preferTestament?: "G" | "H" | null;
    labelForStrong: (strongs: string) => string;
  }): ReverseOrbit | null {
    const file = this.load(opts.packageId);
    if (!file) return null;

    const candidates = [
      ...(opts.displayWord ? englishKeysFromGloss(opts.displayWord) : []),
      ...englishKeysFromGloss(opts.gloss),
    ];
    // de-dupe preserving order
    const seen = new Set<string>();
    const keys = candidates.filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    for (const key of keys) {
      const entries = file.words[key];
      if (!entries?.length) continue;
      const orbit = buildReverseOrbitDetailed({
        englishWord: opts.displayWord?.trim() || key,
        key,
        packageId: opts.packageId,
        entries,
        currentStrong: opts.currentStrong,
        preferTestament: opts.preferTestament ?? null,
        labelForStrong: opts.labelForStrong,
      });
      if (orbit) return orbit;
    }
    return null;
  }
}

let shared: ReverseIndexLoader | null = null;

export function getSharedReverseIndexLoader(roots?: string[]): ReverseIndexLoader {
  if (!shared) {
    shared = new ReverseIndexLoader(roots ?? []);
  } else if (roots) {
    shared.setRoots(roots);
  }
  return shared;
}
