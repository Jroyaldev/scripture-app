/**
 * Host loader for original-language packages (tokens.jsonl + manifest).
 * Node I/O lives here; query logic uses pure core indexes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildTokenIndex,
  buildGreekSemanticSenseOutline,
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
import { getSharedHebrewOrbitIndex } from "../core/language/hebrew-orbit-index.js";
import type { ReverseIndexLoader } from "./reverse-index-loader.js";
import { resolveReverseIndexPackage } from "../core/language/reverse-index.js";

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
  /** Short pastor-facing gloss; lexicon prose stays in Definition. */
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
  /**
   * Strong's dictionary definition (StrongsPlus etc.) — full entry behind chips.
   * Optional `deeper` = Thayer (Greek) or BDB (Hebrew) layered under Strong's
   * inside the same Definition expander (not a second row).
   */
  definition: {
    firstSense: string;
    full: string;
    xlit?: string;
    pronunciation?: string;
    source: string;
    id: string;
    deeper?: {
      firstSense: string;
      full: string;
      source: string;
      id: string;
      xlit?: string;
      senses?: Array<{ n: string; text: string; label?: string }>;
    } | null;
  } | null;
  /** Occurrence-tagged Greek semantic range from MACULA / MARBLE. */
  semanticSenses: ReturnType<typeof buildGreekSemanticSenseOutline>;
  /**
   * Reverse Rendering Orbit — English word → lemmas behind it (from the
   * reading package's reverse-index.json). Null when package lacks alignments
   * or the gloss has no reverse hits.
   */
  reverseOrbit: {
    englishWord: string;
    key: string;
    total: number;
    packageId: string;
    scopeHint: string;
    segments: Array<{
      label: string;
      count: number;
      share: number;
      isCurrent?: boolean;
      strongs: string | null;
      /** Lightweight definition for cross-testament bands (no verse token). */
      definition?: TokenCardDto["definition"];
    }>;
    source: "alignments";
  } | null;
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

type LexiconDefEntry = {
  firstSense: string;
  full: string;
  xlit?: string;
  pronunciation?: string;
  source: string;
  id: string;
  senses?: Array<{ n: string; text: string; label?: string }>;
};

type LexiconJsonFile = {
  entries?: Record<
    string,
    {
      id?: string;
      firstSense?: string;
      full?: string;
      xlit?: string;
      pronunciation?: string;
      source?: string;
      senses?: Array<{ n: string; text: string; label?: string }>;
    }
  >;
};

function loadLexiconMap(jsonText: string, defaultSource: string): Map<string, LexiconDefEntry> {
  const map = new Map<string, LexiconDefEntry>();
  const raw = JSON.parse(jsonText) as LexiconJsonFile;
  for (const [key, v] of Object.entries(raw.entries ?? {})) {
    if (!v?.full?.trim() || !v.firstSense?.trim()) continue;
    const id = (v.id ?? key).toUpperCase();
    if (!/^[HG]\d{1,5}$/.test(id)) continue;
    map.set(id, {
      id,
      firstSense: v.firstSense.trim(),
      full: v.full.trim(),
      ...(v.xlit ? { xlit: v.xlit } : {}),
      ...(v.pronunciation ? { pronunciation: v.pronunciation } : {}),
      ...(v.senses?.length ? { senses: v.senses } : {}),
      source: v.source?.trim() || defaultSource,
    });
  }
  return map;
}

function resolveStrongIds(
  strong: string | undefined | null,
  strongPrefixed: string | undefined | null,
): string[] {
  const candidates: string[] = [];
  if (strongPrefixed) candidates.push(strongPrefixed.toUpperCase().trim());
  if (strong) {
    const digits = String(strong).replace(/^[HG]/i, "").replace(/^0+/, "") || String(strong);
    if (strongPrefixed?.match(/^[HG]/i)) {
      candidates.push(`${strongPrefixed[0]!.toUpperCase()}${digits}`);
    } else {
      candidates.push(`H${digits}`, `G${digits}`);
    }
  }
  const out: string[] = [];
  for (const c of candidates) {
    out.push(c);
    const m = c.match(/^([HG])(\d+)$/);
    if (m) out.push(`${m[1]}${parseInt(m[2]!, 10)}`);
  }
  return [...new Set(out)];
}

/**
 * Discovers and loads interlinear-data packages from one or more root dirs.
 * Search order: first matching package id wins (library artifacts before app data).
 */
export class TokenPackageLoader {
  private roots: string[];
  private cache = new Map<string, LoadedPackage>();
  /** Strong's number (digits) → English gloss (Hebrew). */
  private hebrewGloss = new Map<string, StrongGlossEntry>();
  /**
   * Strong's full definitions keyed H#### / G#### (StrongsPlus import).
   * Used for the language-margin Definition expander head.
   */
  private strongDefinitions = new Map<string, LexiconDefEntry>();
  /** Thayer (G####) — deeper block under Strong's for Greek. */
  private thayerDefinitions = new Map<string, LexiconDefEntry>();
  /** BDB (H####) — deeper block under Strong's for Hebrew. */
  private bdbDefinitions = new Map<string, LexiconDefEntry>();
  /** Optional: ensure STEP morph tables are loaded before card lookup. */
  private ensureStepMorph: (() => void) | null;
  /** Reverse index for aligned reading packages (bsb / akjv-strongs). */
  private reverseIndex: ReverseIndexLoader | null = null;

  constructor(
    packageRoots: string[],
    options?: {
      hebrewGlossJson?: string;
      strongDefinitionsJson?: string;
      thayerDefinitionsJson?: string;
      bdbDefinitionsJson?: string;
      ensureStepMorph?: () => void;
      reverseIndex?: ReverseIndexLoader;
    },
  ) {
    this.roots = packageRoots.filter((r) => r.length > 0);
    this.ensureStepMorph = options?.ensureStepMorph ?? null;
    this.reverseIndex = options?.reverseIndex ?? null;
    if (options?.hebrewGlossJson) {
      this.loadHebrewGlossJson(options.hebrewGlossJson);
    }
    if (options?.strongDefinitionsJson) {
      this.loadStrongDefinitionsJson(options.strongDefinitionsJson);
    }
    if (options?.thayerDefinitionsJson) {
      this.loadThayerDefinitionsJson(options.thayerDefinitionsJson);
    }
    if (options?.bdbDefinitionsJson) {
      this.loadBdbDefinitionsJson(options.bdbDefinitionsJson);
    }
  }

  setReverseIndexLoader(loader: ReverseIndexLoader | null): void {
    this.reverseIndex = loader;
  }

  /** Load OpenScriptures Strong's Hebrew compact gloss map (JSON text). */
  loadHebrewGlossJson(jsonText: string): number {
    this.hebrewGloss = parseStrongGlossJson(jsonText);
    return this.hebrewGloss.size;
  }

  /**
   * Load StrongsPlus-style definitions:
   * `{ meta, entries: { "H1": { id, firstSense, full, source, … } } }`.
   */
  loadStrongDefinitionsJson(jsonText: string): number {
    this.strongDefinitions = loadLexiconMap(jsonText, "Strong's");
    return this.strongDefinitions.size;
  }

  loadThayerDefinitionsJson(jsonText: string): number {
    this.thayerDefinitions = loadLexiconMap(jsonText, "Thayer");
    return this.thayerDefinitions.size;
  }

  loadBdbDefinitionsJson(jsonText: string): number {
    this.bdbDefinitions = loadLexiconMap(jsonText, "BDB");
    return this.bdbDefinitions.size;
  }

  private lookupInMap(
    map: Map<string, LexiconDefEntry>,
    strong: string | undefined | null,
    strongPrefixed: string | undefined | null,
  ): LexiconDefEntry | null {
    if (map.size === 0) return null;
    for (const c of resolveStrongIds(strong, strongPrefixed)) {
      const hit = map.get(c);
      if (hit) return hit;
    }
    return null;
  }

  private lookupDefinition(
    strong: string | undefined | null,
    strongPrefixed: string | undefined | null,
  ): TokenCardDto["definition"] {
    const head = this.lookupInMap(this.strongDefinitions, strong, strongPrefixed);
    if (!head) return null;

    const ids = resolveStrongIds(strong, strongPrefixed);
    const isGreek = ids.some((id) => id.startsWith("G")) || strongPrefixed?.toUpperCase().startsWith("G");
    const isHebrew = ids.some((id) => id.startsWith("H")) || strongPrefixed?.toUpperCase().startsWith("H");

    let deeper: LexiconDefEntry | null = null;
    if (isGreek) deeper = this.lookupInMap(this.thayerDefinitions, strong, strongPrefixed);
    else if (isHebrew) deeper = this.lookupInMap(this.bdbDefinitions, strong, strongPrefixed);

    return {
      firstSense: head.firstSense,
      full: head.full,
      ...(head.xlit ? { xlit: head.xlit } : {}),
      ...(head.pronunciation ? { pronunciation: head.pronunciation } : {}),
      source: head.source,
      id: head.id,
      deeper: deeper
        ? {
            firstSense: deeper.firstSense,
            full: deeper.full,
            source: deeper.source,
            id: deeper.id,
            ...(deeper.xlit ? { xlit: deeper.xlit } : {}),
            ...(deeper.senses?.length ? { senses: deeper.senses } : {}),
          }
        : null,
    };
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
   * @param options.readingPackageId — scripture package for reverse orbit (bsb / akjv-strongs).
   */
  getTokenCard(
    packageId: string,
    tokenId: string,
    options?: MarkOptions & { readingPackageId?: string },
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
    const definition = this.lookupDefinition(token.strong, token.strongPrefixed);
    const semanticSenses = isHebrew || !lemma
      ? null
      : buildGreekSemanticSenseOutline({
          tokens: (pkg.index.byLemma.get(lemma) ?? []).flatMap((id) => {
            const occurrence = pkg.index.byId.get(id);
            return occurrence ? [occurrence] : [];
          }),
          focus: token,
        });

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

    // Rendering Orbit: lemma/Strong → English spectrum.
    // Greek: MACULA package glosses per lemma.
    // Hebrew: prefer MACULA-Hebrew gloss histogram adapter (multi-band);
    // fallback Strong’s single-band if adapter missing.
    let renderingOrbit: RenderingOrbit | null = null;
    if (!isFunctionWordForOrbit(token)) {
      const displayLemma =
        lemma && !/^[\d\s/a-z]+$/i.test(lemma)
          ? lemma
          : token.surface || lemma || token.strong || "?";

      if (isHebrew && token.strong) {
        const hebOrbit = getSharedHebrewOrbitIndex().resolve({
          strong: token.strong,
          strongPrefixed: token.strongPrefixed,
          lemma: displayLemma,
          surface: token.surface,
          currentGloss: resolved.short ?? resolved.full,
        });
        if (hebOrbit) renderingOrbit = hebOrbit;
      }

      if (!renderingOrbit) {
        const ids =
          isHebrew && token.strong
            ? (pkg.index.byStrong.get(token.strong) ?? [])
            : lemma
              ? (pkg.index.byLemma.get(lemma) ?? [])
              : [];
        const groupCount =
          isHebrew && token.strong ? ids.length : corpus || ids.length;

        if (ids.length > 0) {
          renderingOrbit = buildRenderingOrbit({
            lemma: displayLemma,
            strongPrefixed: token.strongPrefixed,
            lemmaCount: groupCount,
            tokenIds: ids,
            glossForId: (id) => {
              const t = pkg.index.byId.get(id);
              if (t?.gloss?.trim()) return t.gloss;
              if (t?.strong) {
                const e = lookupStrongGloss(this.hebrewGloss, t.strong);
                return e?.short ?? e?.gloss ?? null;
              }
              return null;
            },
            currentGloss: token.gloss ?? resolved.full ?? resolved.short,
          });
        }
        if (!renderingOrbit && (resolved.full || resolved.short)) {
          renderingOrbit = buildRenderingOrbit({
            lemma: displayLemma,
            strongPrefixed: token.strongPrefixed,
            lemmaCount: groupCount || 1,
            tokenIds: [tokenId],
            glossForId: () => resolved.full ?? resolved.short,
            currentGloss: resolved.full ?? resolved.short,
          });
        }
      }
    }

    // Reverse orbit: English → lemmas. BSB is the canonical reverse source for
    // every reading translation; akjv-strongs only when it's the active reader.
    // Pill never vanishes just because the pastor switched WEB/YLT/KJV.
    let reverseOrbit: TokenCardDto["reverseOrbit"] = null;
    if (this.reverseIndex) {
      const reversePkg = resolveReverseIndexPackage(options?.readingPackageId);
      if (this.reverseIndex.hasIndex(reversePkg)) {
        const glossForReverse =
          resolved.short ?? resolved.full ?? token.gloss ?? null;
        const prefer: "G" | "H" = isHebrew ? "H" : "G";
        const raw =
          this.reverseIndex.resolveOrbit({
            packageId: reversePkg,
            gloss: glossForReverse,
            displayWord: resolved.short ?? glossForReverse,
            currentStrong: token.strongPrefixed ?? token.strong,
            preferTestament: prefer,
            labelForStrong: (s) => this.labelForStrong(s, pkg),
          }) ?? null;
        if (raw) {
          reverseOrbit = {
            ...raw,
            segments: raw.segments.map((seg) => {
              if (!seg.strongs) return seg;
              const def = this.lookupDefinition(seg.strongs.slice(1), seg.strongs);
              return def ? { ...seg, definition: def } : seg;
            }),
          };
        }
      }
    }

    return {
      token,
      displaySurface: displaySurface(token.surface),
      gloss: resolved.short ?? resolved.full,
      glossSource: resolved.source,
      morphLabels,
      morphExplain,
      stepMorph,
      nameEntity,
      renderingOrbit,
      definition,
      semanticSenses,
      reverseOrbit,
      lemmaFreq: { corpus, book, chapter },
      neighborhood: { before: nb.before, after: nb.after },
      occurrencesInBook: occurrences,
      marks,
    };
  }

  /**
   * Display label for a reverse-ring segment:
   *  1. Same-language package lemma/surface (prefix-safe)
   *  2. Thayer Greek head (G####) / OpenScriptures Hebrew lemma (H####)
   *  3. xlit fallback — never raw Strong's id when a lemma exists
   */
  private labelForStrong(strongs: string, pkg: LoadedPackage): string {
    const isHeb = strongs.startsWith("H");
    const isGrk = strongs.startsWith("G");
    const digits = strongs.replace(/^[HG]/i, "");
    const pkgLang = (pkg.manifest.language ?? "").toLowerCase();
    const pkgIsHeb =
      pkgLang === "hbo" || pkg.manifest.id.includes("oshb") || pkg.manifest.id.includes("hebrew");
    const pkgIsGrk =
      pkgLang === "grc" || pkg.manifest.id.includes("macula") || pkg.manifest.id.includes("greek");

    if ((isHeb && pkgIsHeb) || (isGrk && pkgIsGrk)) {
      const ids = pkg.index.byStrong.get(digits) ?? [];
      for (const id of ids.slice(0, 12)) {
        const t = pkg.index.byId.get(id);
        if (t?.strongPrefixed && !t.strongPrefixed.toUpperCase().startsWith(strongs[0]!)) {
          continue;
        }
        const lem = t?.lemma?.trim();
        if (lem && !/^[\d\s/a-z]+$/i.test(lem) && lem.length <= 24) return lem;
        const surf = t?.surface?.replace(/\//g, "").trim();
        if (
          surf &&
          /[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF]/.test(surf) &&
          surf.length <= 24
        ) {
          return surf;
        }
      }
    }

    // Hebrew rung (mirrors Thayer for Greek): OpenScriptures Strong's Hebrew gloss map.
    if (isHeb) {
      const heb = lookupStrongGloss(this.hebrewGloss, digits);
      if (heb?.lemma?.trim()) return heb.lemma.trim();
      if (heb?.xlit?.trim()) return heb.xlit.trim();
      const bdb = this.bdbDefinitions.get(strongs);
      if (bdb?.xlit?.trim()) return bdb.xlit.trim();
    }

    if (isGrk) {
      const th = this.thayerDefinitions.get(strongs);
      if (th?.full) {
        const m = th.full.match(
          /^([\u0370-\u03FF\u1F00-\u1FFF][\u0370-\u03FF\u1F00-\u1FFF\u0300-\u036f]*)/,
        );
        if (m) return m[1]!;
      }
    }

    const def = this.strongDefinitions.get(strongs);
    if (def?.xlit && def.xlit.length <= 24) return def.xlit;
    // Last resort: still better than bare id when we have a firstSense headword.
    if (def?.firstSense) {
      const head = def.firstSense.split(/[,;(]/)[0]?.trim();
      if (head && head.length <= 20 && !/^[HG]\d+$/i.test(head)) return head;
    }
    return strongs;
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
