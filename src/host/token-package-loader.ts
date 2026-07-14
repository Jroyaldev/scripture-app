/**
 * Host loader for original-language packages (tokens.jsonl + manifest).
 * Node I/O lives here; query logic uses pure core indexes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildTokenIndex,
  explainMorphCode,
  getSharedStepMorphIndex,
  getSharedTipnrIndex,
  hebrewMorphFeatureLabels,
  lemmaOccurrencesInBook,
  lookupStrongGloss,
  marksForVerse,
  morphFeatureLabels,
  parseLanguagePackageManifest,
  parseStrongGlossJson,
  parseTokensJsonl,
  shortGlossLabel,
  tokenLooksLikeProperName,
  tokenNeighborhood,
  tokensForVerse,
  type LanguagePackageManifest,
  type MarkOptions,
  type MorphExplanation,
  type NameResolveHit,
  type StepMorphOverlay,
  type StrongGlossEntry,
  type TipnrEntity,
  type TokenIndex,
  type TokenMark,
  type TokenRecord,
} from "../core/language/index.js";
import {
  buildRenderingOrbit,
  isFunctionWordForOrbit,
  type RenderingOrbit,
} from "../core/language/rendering-orbit.js";

export type LanguagePackageSummary = {
  id: string;
  name: string;
  language: string;
  type: string;
  edition?: string;
  family?: string;
  datasetVersion?: string;
  tokenCount?: number;
  books?: string[];
  /** Absolute path to the package directory. */
  path: string;
  loaded: boolean;
};

/** Token as shown in the verse chip row (enriched for UI). */
export type VerseTokenDto = TokenRecord & {
  /** English short label for chip (Strong's or package gloss). */
  displayGloss: string | null;
  /** Full gloss for hover title. */
  hoverGloss: string | null;
  /** Surface without OSHB morpheme slashes (easier to scan). */
  displaySurface: string;
  /** 1-based order in the verse (reading order). */
  order: number;
};

export type TokenCardDto = {
  token: TokenRecord;
  displaySurface: string;
  /** Prefer lexicon gloss, then package gloss. */
  gloss: string | null;
  /** Where the gloss came from. */
  glossSource: "package" | "strongs-hebrew" | null;
  morphLabels: string[];
  /** Pastor-friendly breakdown of the morph code. */
  morphExplain: MorphExplanation | null;
  /**
   * Optional STEPBible TEGMC/TEHMC overlay for open-notes enrichment.
   * Null when code has no STEP hit or tables not loaded — chips still work.
   */
  stepMorph: StepMorphOverlay | null;
  /**
   * TIPNR individual when this token is a proper name we can resolve.
   * Disambiguated person/place — not “all Strong G2491 hits”.
   */
  nameEntity: {
    entity: TipnrEntity;
    match: NameResolveHit["match"];
    alternatives: TipnrEntity[];
  } | null;
  /**
   * Rendering Orbit — how this lemma is glossed across the package corpus.
   * Built from MACULA (etc.) gloss columns; open data, not a proprietary ring.
   */
  renderingOrbit: RenderingOrbit | null;
  lemmaFreq: {
    corpus: number;
    book: number;
    chapter: number;
  };
  neighborhood: {
    before: TokenRecord[];
    after: TokenRecord[];
  };
  occurrencesInBook: TokenRecord[];
  marks: TokenMark[];
};

type LoadedPackage = {
  manifest: LanguagePackageManifest;
  path: string;
  index: TokenIndex;
  tokens: TokenRecord[];
};

/**
 * Discovers and loads interlinear-data packages from one or more root dirs.
 * Search order: first matching package id wins (library artifacts before app data).
 */
export class TokenPackageLoader {
  private roots: string[];
  private cache = new Map<string, LoadedPackage>();
  /** Strong's number (digits) → English gloss (Hebrew). */
  private hebrewGloss = new Map<string, StrongGlossEntry>();
  /** Optional: ensure STEP morph tables are loaded before card lookup. */
  private ensureStepMorph: (() => void) | null;

  constructor(
    packageRoots: string[],
    options?: { hebrewGlossJson?: string; ensureStepMorph?: () => void },
  ) {
    this.roots = packageRoots.filter((r) => r.length > 0);
    this.ensureStepMorph = options?.ensureStepMorph ?? null;
    if (options?.hebrewGlossJson) {
      this.loadHebrewGlossJson(options.hebrewGlossJson);
    }
  }

  /** Load OpenScriptures Strong's Hebrew compact gloss map (JSON text). */
  loadHebrewGlossJson(jsonText: string): number {
    this.hebrewGloss = parseStrongGlossJson(jsonText);
    return this.hebrewGloss.size;
  }

  /** Replace search roots (e.g. after library path changes). Clears package cache only. */
  setRoots(packageRoots: string[]): void {
    this.roots = packageRoots.filter((r) => r.length > 0);
    this.cache.clear();
  }

  listPackages(): LanguagePackageSummary[] {
    const byId = new Map<string, LanguagePackageSummary>();

    for (const root of this.roots) {
      if (!existsSync(root)) continue;
      let entries: string[];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const name of entries) {
        const dir = join(root, name);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        const manifestPath = join(dir, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(manifestPath, "utf8"));
        } catch {
          continue;
        }
        const manifest = parseLanguagePackageManifest(raw);
        if (!manifest) continue;
        if (manifest.type !== "interlinear-data") continue;
        if (byId.has(manifest.id)) continue; // first root wins

        byId.set(manifest.id, {
          id: manifest.id,
          name: manifest.name,
          language: manifest.language,
          type: manifest.type,
          edition: manifest.edition,
          family: manifest.family,
          datasetVersion: manifest.datasetVersion,
          tokenCount: manifest.tokenCount,
          books: manifest.books,
          path: dir,
          loaded: this.cache.has(manifest.id),
        });
      }
    }

    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Load package into memory (idempotent). Returns false if not found / invalid.
   */
  load(packageId: string): boolean {
    if (this.cache.has(packageId)) return true;
    const found = this.findPackageDir(packageId);
    if (!found) return false;

    const { dir, manifest } = found;
    const tokensPath = join(dir, "tokens.jsonl");
    if (!existsSync(tokensPath)) return false;

    let content: string;
    try {
      content = readFileSync(tokensPath, "utf8");
    } catch {
      return false;
    }

    const parsed = parseTokensJsonl(content, { expectedDatasetId: manifest.id });
    if (parsed.tokens.length === 0) return false;

    const index = buildTokenIndex(parsed.tokens, manifest.id);
    this.cache.set(packageId, {
      manifest,
      path: dir,
      index,
      tokens: parsed.tokens,
    });
    return true;
  }

  unload(packageId: string): void {
    this.cache.delete(packageId);
  }

  isLoaded(packageId: string): boolean {
    return this.cache.has(packageId);
  }

  getManifest(packageId: string): LanguagePackageManifest | null {
    if (!this.load(packageId)) return null;
    return this.cache.get(packageId)?.manifest ?? null;
  }

  getVerseTokens(
    packageId: string,
    book: string,
    chapter: number,
    verse: number,
  ): VerseTokenDto[] | null {
    if (!this.load(packageId)) return null;
    const pkg = this.cache.get(packageId)!;
    const tokens = tokensForVerse(pkg.index, book, chapter, verse);
    return tokens.map((t, i) => this.enrichVerseToken(t, i + 1));
  }

  private enrichVerseToken(token: TokenRecord, order: number): VerseTokenDto {
    const resolved = this.resolveGloss(token);
    return {
      ...token,
      // Prefer short English on the token itself so older UI still works
      gloss: token.gloss ?? resolved.full ?? undefined,
      displayGloss: resolved.short,
      hoverGloss: resolved.full,
      displaySurface: displaySurface(token.surface),
      order,
    };
  }

  private resolveGloss(token: TokenRecord): {
    full: string | null;
    short: string | null;
    source: TokenCardDto["glossSource"];
  } {
    if (token.gloss?.trim()) {
      const full = token.gloss.trim();
      // Package/interlinear glosses are already short — don't over-trim
      const short =
        shortGlossLabel(full, 4) ??
        (full.length > 28 ? `${full.slice(0, 25).trim()}…` : full);
      return { full, short, source: "package" };
    }
    if (token.strong) {
      const entry = lookupStrongGloss(this.hebrewGloss, token.strong);
      if (entry?.gloss) {
        return {
          full: entry.gloss,
          short: shortGlossLabel(entry.gloss, 3, entry.short) ?? entry.short ?? null,
          source: "strongs-hebrew",
        };
      }
    }
    return { full: null, short: null, source: null };
  }

  getToken(packageId: string, tokenId: string): TokenRecord | null {
    if (!this.load(packageId)) return null;
    return this.cache.get(packageId)!.index.byId.get(tokenId) ?? null;
  }

  getLemmaInBook(packageId: string, book: string, lemma: string): TokenRecord[] | null {
    if (!this.load(packageId)) return null;
    return lemmaOccurrencesInBook(this.cache.get(packageId)!.index, book, lemma);
  }

  getMarksForVerse(
    packageId: string,
    book: string,
    chapter: number,
    verse: number,
    options?: MarkOptions,
  ): TokenMark[] | null {
    if (!this.load(packageId)) return null;
    return marksForVerse(this.cache.get(packageId)!.index, book, chapter, verse, options);
  }

  getNeighborhood(
    packageId: string,
    tokenId: string,
    radius = 2,
  ): { before: TokenRecord[]; focus: TokenRecord | null; after: TokenRecord[] } | null {
    if (!this.load(packageId)) return null;
    return tokenNeighborhood(this.cache.get(packageId)!.index, tokenId, radius);
  }

  /**
   * Ready-made payload for a language card UI.
   */
  getTokenCard(
    packageId: string,
    tokenId: string,
    options?: MarkOptions,
  ): TokenCardDto | null {
    if (!this.load(packageId)) return null;
    const pkg = this.cache.get(packageId)!;
    const token = pkg.index.byId.get(tokenId);
    if (!token) return null;

    const lemma = token.lemma ?? "";
    const corpus = lemma ? (pkg.index.lemmaFreqCorpus.get(lemma) ?? 0) : 0;
    const book = lemma
      ? (pkg.index.lemmaFreqBook.get(`${token.book}|${lemma}`) ?? 0)
      : 0;
    const chapter = lemma
      ? (pkg.index.lemmaFreqChapter.get(`${token.book}.${token.chapter}|${lemma}`) ?? 0)
      : 0;

    const nb = tokenNeighborhood(pkg.index, tokenId, 2);
    const occurrences = lemma
      ? lemmaOccurrencesInBook(pkg.index, token.book, lemma)
      : [];
    const marks = marksForVerse(pkg.index, token.book, token.chapter, token.verse, options).filter(
      (m) => m.tokenId === tokenId,
    );

    const isHebrew =
      token.morphCode?.startsWith("H") ||
      token.morphCode?.startsWith("A") ||
      token.strongPrefixed?.startsWith("H");

    const morphLabels = isHebrew
      ? hebrewMorphFeatureLabels(token.morphCode)
      : morphFeatureLabels(token.morph);

    const morphExplain = explainMorphCode(token.morphCode, {
      language: isHebrew ? "hbo" : "grc",
      labels: morphLabels,
    });

    // Approach A: STEP prose overlay only — never replaces chips.
    // Self-heal if main forgot to load tables (or loaded before files existed).
    this.ensureStepMorph?.();
    const stepMorph = getSharedStepMorphIndex().lookup(token.morphCode);

    const resolved = this.resolveGloss(token);

    let nameEntity: TokenCardDto["nameEntity"] = null;
    if (tokenLooksLikeProperName(token)) {
      const tipnr = getSharedTipnrIndex();
      if (tipnr.loaded) {
        const hit = tipnr.resolve({
          book: token.book,
          chapter: token.chapter,
          verse: token.verse,
          strong: token.strongPrefixed ?? token.strong,
          nameHint: resolved.full ?? token.gloss ?? undefined,
        });
        if (hit) {
          nameEntity = {
            entity: hit.entity,
            match: hit.match,
            alternatives: hit.alternatives.slice(0, 4),
          };
        }
      }
    }

    // Rendering Orbit: how THIS lemma is rendered in English (not helpers,
    // not other lemmas). Logos-style job; open gloss data.
    let renderingOrbit: RenderingOrbit | null = null;
    if (lemma && !isFunctionWordForOrbit(token)) {
      const ids = pkg.index.byLemma.get(lemma) ?? [];
      renderingOrbit = buildRenderingOrbit({
        lemma,
        strongPrefixed: token.strongPrefixed,
        lemmaCount: corpus,
        tokenIds: ids,
        glossForId: (id) => {
          const t = pkg.index.byId.get(id);
          return t?.gloss ?? null;
        },
        currentGloss: token.gloss ?? resolved.full,
        suppressAsFunction: false,
      });
      // Hebrew packages often lack per-token glosses — use Strong's once.
      if (!renderingOrbit && resolved.full) {
        renderingOrbit = buildRenderingOrbit({
          lemma,
          strongPrefixed: token.strongPrefixed,
          lemmaCount: corpus || 1,
          tokenIds: [tokenId],
          glossForId: () => resolved.full,
          currentGloss: resolved.full,
        });
      }
    }

    return {
      token,
      displaySurface: displaySurface(token.surface),
      gloss: resolved.full,
      glossSource: resolved.source,
      morphLabels,
      morphExplain,
      stepMorph,
      nameEntity,
      renderingOrbit,
      lemmaFreq: { corpus, book, chapter },
      neighborhood: { before: nb.before, after: nb.after },
      occurrencesInBook: occurrences,
      marks,
    };
  }

  private findPackageDir(
    packageId: string,
  ): { dir: string; manifest: LanguagePackageManifest } | null {
    for (const root of this.roots) {
      const dir = join(root, packageId);
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
        const manifest = parseLanguagePackageManifest(raw);
        if (!manifest || manifest.type !== "interlinear-data") continue;
        // Directory name is the package id the app requests.
        return { dir, manifest };
      } catch {
        continue;
      }
    }
    return null;
  }
}

/** OSHB marks morpheme breaks with "/"; strip for display scanning. */
function displaySurface(surface: string): string {
  return surface.replace(/\//g, "");
}
