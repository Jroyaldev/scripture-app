import type { AppTheme } from "./theme.js";

/**
 * Type-safe wrapper for the contextBridge API exposed by preload.
 * Provides typed access to all Electron IPC calls.
 */

declare global {
  interface Window {
    api: {
      library: {
        getPath(): Promise<string>;
        getInfo(): Promise<{ path: string; hasLibrary: boolean } | null>;
        revealInFinder(): Promise<{ ok: boolean; error?: string }>;
        init(path: string): Promise<{ ok: boolean; error?: string }>;
        rebuild(): Promise<{ ok: boolean; hash?: string; error?: string }>;
        getSummary(): Promise<LibrarySummary | null>;
        readAllNotes(): Promise<ParsedNoteData[]>;
        createNote(title: string, body: string, opts?: { type?: string; tags?: string[] }): Promise<{ ok: boolean; noteId?: string; id?: string; path?: string; error?: string }>;
        queryVerse(book: string, chapter: number, verse: number): Promise<QueryResult>;
        queryRange(startBook: string, startCh: number, startV: number, endBook: string, endCh: number, endV: number): Promise<QueryResult>;
        createHighlight(book: string, chapter: number, verseStart: number, verseEnd: number, color: string, packageId: string, charStart?: number | null, charEnd?: number | null): Promise<{ ok: boolean; highlightId?: string; changeId?: string; error?: string }>;
        eraseHighlightRange(book: string, chapter: number, verseStart: number, verseEnd: number, packageId: string, charStart?: number | null, charEnd?: number | null): Promise<{ ok: boolean; changeId?: string; error?: string }>;
        recolorHighlights(book: string, chapter: number, packageId: string, entityIds: string[], color: string): Promise<{ ok: boolean; changeId?: string; error?: string }>;
        deleteHighlights(book: string, chapter: number, packageId: string, entityIds: string[]): Promise<{ ok: boolean; changeId?: string; error?: string }>;
        undoHighlightChange(changeId: string): Promise<{ ok: boolean; error?: string }>;
        deleteHighlight(entityId: string, baseEventId: string): Promise<{ ok: boolean; error?: string }>;
        search(query: string): Promise<NoteSearchResult[]>;
        importVault(vaultPath: string): Promise<ImportResult>;
      };
      ref: {
        resolve(humanRef: string): Promise<RefParseResult>;
        parseBref(bref: string): Promise<RefParseResult>;
        toBref(ref: CanonicalRefData): Promise<string>;
        toDisplay(ref: CanonicalRefData): Promise<string>;
      };
      scripture: {
        getBackbone(): Promise<BackboneData>;
        getBookNames(): Promise<BookNameData>;
        getChapterText(packageId: string, book: string, chapter: number): Promise<ChapterData | null>;
        getCrossRefsForPassage(
          book: string,
          chapter: number,
          startVerse: number,
          endVerse: number,
          packageId: string,
        ): Promise<CrossReferenceResultData>;
      };
      language: {
        listPackages(): Promise<LanguagePackageSummary[]>;
        loadPackage(packageId: string): Promise<{ ok: boolean; packageId?: string; loaded?: boolean; error?: string }>;
        getVerseTokens(packageId: string, book: string, chapter: number, verse: number): Promise<LanguageToken[] | null>;
        getToken(packageId: string, tokenId: string): Promise<LanguageToken | null>;
        getTokenCard(
          packageId: string,
          tokenId: string,
          readingPackageId?: string,
        ): Promise<LanguageTokenCard | null>;
        hasReverseIndex(readingPackageId: string): Promise<boolean>;
        getLemmaInBook(packageId: string, book: string, lemma: string): Promise<LanguageToken[] | null>;
        getVerseMarks(packageId: string, book: string, chapter: number, verse: number): Promise<LanguageTokenMark[] | null>;
        getSyntaxForToken(packageId: string, book: string, tokenId: string): Promise<LanguageSyntaxHit | null>;
      };
      ai: {
        embedNotes(): Promise<{ ok: boolean; count?: number; error?: string }>;
        enrichNote(noteId: string): Promise<EnrichmentSuggestionsResult>;
        getEnrichment(noteId: string): Promise<EnrichmentSuggestionsResult>;
        enrichmentFeedback(opts: {
          noteId: string;
          refKey: string;
          action: "confirmed" | "dismissed";
          refDisplay?: string;
        }): Promise<{ ok: boolean; error?: string }>;
        unanchorRef(opts: { noteId: string; refKey: string; refDisplay: string }): Promise<{ ok: boolean; error?: string }>;
        semanticMargin(opts: {
          book: string;
          startChapter: number;
          startVerse: number;
          endChapter: number;
          endVerse: number;
          passageText: string;
        }): Promise<SemanticMarginResult | null>;
        pinClaim(claimId: string, assertion: string, userNote?: string): Promise<{ ok: boolean; factId?: string; error?: string }>;
        promoteOverlay(opts: {
          overlayId: string;
          book: string;
          chapter: number;
          verseStart: number;
          verseEnd: number;
          color: string;
        }): Promise<{ ok: boolean; highlightId?: string; error?: string }>;
        insertClaim(opts: {
          id: string;
          assertion: string;
          claimType: string;
          confidence: number;
          extractor: string;
          anchors: { book: string; chapter: number; verse: number }[];
          sources: { kind: string; ref: string }[];
        }): Promise<{ ok: boolean; error?: string }>;
        insertOverlay(opts: {
          id: string;
          book: string;
          chapter: number;
          verse: number;
          charStart: number;
          charEnd: number;
          reason: string;
          extractor: string;
        }): Promise<{ ok: boolean; error?: string }>;
        getBudgetEnvelope(): Promise<{ envelope: BudgetEnvelopeData; usage: { date: string; tokensUsed: number; spendUsd: number } } | null>;
        setBudgetEnvelope(opts: {
          backgroundAI: string;
          networkBackground: boolean;
          dailyTokenCeiling?: number;
        }): Promise<{ ok: boolean; error?: string }>;
        getJobs(): Promise<AIJobData[]>;
        getFacts(): Promise<FactData[]>;
      };
      dialog: {
        openDirectory(): Promise<string | null>;
      };
      settings: {
        get(): Promise<AppSettings>;
        set(partial: Partial<AppSettings>): Promise<AppSettings>;
      };
    };
  }
}

export type ReadingSize = "s" | "m" | "l";
export type ReadingWidth = "narrow" | "medium" | "wide";
export type VerseNumberMode = "always" | "faint" | "hover";
/** Sidebar layout lab modes — switch while testing chrome density. */
export type SidebarStyle = "original" | "compact" | "rail";

/** One stop in the passage-picker recents list. */
export interface RecentPassageSetting {
  book: string;
  chapter: number;
  verse?: number;
  packageId: string;
  visitedAt: number;
}

export interface AppSettings {
  theme: AppTheme;
  sidebarCollapsed: boolean;
  marginVisible: boolean;
  readingSize: ReadingSize;
  readingWidth: ReadingWidth;
  verseNumbers: VerseNumberMode;
  sidebarStyle: SidebarStyle;
  recentPassages: RecentPassageSetting[];
  /** Where the reader last was — restored on launch. */
  lastRead: { book: string; chapter: number; packageId: string } | null;
}

export interface LibrarySummary {
  notesFound: number;
  anchorsFound: number;
  highlightsFound: number;
  errors: string[];
}

export interface ParsedNoteData {
  frontmatter: {
    id: string;
    title: string;
    created: string;
    modified: string;
    type?: string;
    tags?: string[];
  };
  body: string;
  scriptureRefs: Array<{
    raw: string;
    bref: string;
  }>;
}

export interface NoteSearchResult {
  id: string;
  title: string;
  body_text: string;
}

export interface AnchorRecord {
  id: number;
  entity_id: string;
  note_id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
}

export interface HighlightRecord {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  package: string;
  char_start: number | null;
  char_end: number | null;
  color: string;
  kind: string;
  note_id: string | null;
  deleted: number;
}

export interface NoteRecord {
  id: string;
  title: string;
  body_text: string;
  created: string;
  modified: string;
}

export interface QueryResult {
  anchors: AnchorRecord[];
  highlights: HighlightRecord[];
  notes: NoteRecord[];
}

export interface ChapterData {
  verses: Array<{ verse: number; text: string }>;
}

export interface BackboneData {
  version: string;
  books: Record<string, { chapters: number[] }>;
}

export interface BookNameData {
  [bookCode: string]: string[];
}

export interface RefParseResult {
  ok: boolean;
  bref?: string;
  display?: string;
  error?: string;
}

export interface CanonicalRefData {
  version: string;
  start: { book: string; chapter: number; verse: number };
  end: { book: string; chapter: number; verse: number };
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  linksMapped: number;
  errors: string[];
}

export interface EnrichmentSuggestionsResult {
  ok?: boolean;
  error?: string;
  enriched: boolean;
  noScriptureIntent: boolean;
  suggestions: { refKey: string; display: string; bref: string; healed: boolean }[];
}

export interface SemanticNoteReasonData {
  kind: "reference" | "phrase" | "semantic" | "theme";
  label: string;
}

export interface SemanticNoteData {
  noteId: string;
  title: string;
  snippet: string;
  similarity: number;
  reasons: SemanticNoteReasonData[];
}

export interface ThreadData {
  id: string;
  label: string;
  noteIds: string[];
  summary: string;
  extractor: string;
  created: string;
}

export interface ClaimData {
  id: string;
  assertion: string;
  claimType: string;
  confidence: number;
  extractor: string;
  created: string;
  status: string;
  anchors: { book: string; chapter: number; verse: number }[];
  sources: { kind: string; ref: string; quote?: string }[];
}

export interface OverlayData {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  charStart: number;
  charEnd: number;
  reason: string;
  extractor: string;
}

export interface SuggestedCrossRefData {
  targetBref: string;
  targetDisplay: string;
  reason: string;
  confidence: number;
}

export interface CrossReferenceMatchData {
  sourceId: string;
  sourceName: string;
  targetKey: string;
  targetBref: string;
  targetDisplay: string;
  score: number;
  rankScore: number;
  supportingSourceCount: number;
  supportingSourceBrefs: string[];
  relationshipKinds: Array<"quotation" | "parallel" | "theme" | "prophecy">;
  preview?: string;
}

export interface CrossReferenceResultData {
  scope: "verse" | "passage";
  sourceBref: string;
  totalCount: number;
  items: CrossReferenceMatchData[];
  attribution: {
    id: string;
    name: string;
    sourceUrl: string;
    license: string;
    licenseUrl: string;
    attribution: string;
    snapshotDate: string;
  };
}

export interface SemanticMarginResult {
  semanticNotes: SemanticNoteData[];
  threads: ThreadData[];
  claims: ClaimData[];
  overlays: OverlayData[];
  suggestedCrossRefs: SuggestedCrossRefData[];
}

export interface BudgetEnvelopeData {
  backgroundAI: string;
  dailyTokenCeiling?: number;
  dailySpendCeilingUsd?: number;
  networkBackground: boolean;
  perPluginOverrides?: Record<string, Partial<BudgetEnvelopeData>>;
}

export interface AIJobData {
  id: string;
  kind: string;
  status: string;
  created: string;
  finished: string | null;
  tokensUsed: number;
  error: string | null;
}

export interface FactData {
  id: string;
  assertion: string;
  from_claim: string | null;
  user_note: string | null;
  deleted: number;
}

/** Original-language package discovered on disk (type interlinear-data). */
export interface LanguagePackageSummary {
  id: string;
  name: string;
  language: string;
  type: string;
  edition?: string;
  family?: string;
  datasetVersion?: string;
  tokenCount?: number;
  books?: string[];
  path: string;
  loaded: boolean;
}

export interface LanguageToken {
  id: string;
  datasetId: string;
  book: string;
  chapter: number;
  verse: number;
  position: number;
  surface: string;
  after?: string;
  normalized?: string;
  lemma?: string;
  strong?: string;
  strongPrefixed?: string;
  morphCode?: string;
  morph: Record<string, string | undefined>;
  gloss?: string;
  louwNida?: string;
  semanticSenses?: Array<{
    id: string;
    label: string;
    domain?: string;
  }>;
  domain?: string;
  role?: string;
  wordClass?: string;
  wordType?: string;
  /** Host-enriched for chip UI */
  displayGloss?: string | null;
  hoverGloss?: string | null;
  displaySurface?: string;
  order?: number;
}

export interface LanguageTokenMark {
  tokenId: string;
  kind: "repeat" | "rare";
  reason: string;
}

export type LanguageMorphPartKind =
  | "pos"
  | "stem"
  | "tense"
  | "voice"
  | "mood"
  | "person"
  | "number"
  | "gender"
  | "case"
  | "degree"
  | "state"
  | "other";

export interface LanguageMorphPart {
  label: string;
  meaning: string;
  kind?: LanguageMorphPartKind;
  /** True when meaning is a fallback (uncatalogued label). */
  unknown?: boolean;
}

export interface LanguageMorphExplain {
  code: string;
  language: "hebrew" | "greek" | "unknown";
  summary: string;
  parts: LanguageMorphPart[];
}

/** STEPBible open-notes overlay (Approach A) — never replaces chips. */
export interface LanguageStepMorph {
  code: string;
  phrase: string;
  explanation: string;
  example: string;
  source: "STEPBible TEGMC" | "STEPBible TEHMC";
}

export interface LanguageOrbitSegment {
  label: string;
  count: number;
  share: number;
  isCurrent?: boolean;
}

/** Rendering Orbit — lemma gloss spectrum (open package data). */
export interface LanguageRenderingOrbit {
  lemma: string;
  strongPrefixed?: string;
  total: number;
  lemmaCount: number;
  segments: LanguageOrbitSegment[];
  source: "package-gloss" | "strongs-only";
  /** content rings only; function lemmas are omitted from the card. */
  kind?: "content" | "function";
}

/** Lexicon definition payload (Strong's head + optional Thayer/BDB deeper). */
export interface LanguageDefinition {
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
}

export interface LanguageSemanticSenseOutline {
  source: "MACULA / MARBLE";
  total: number;
  hiddenCount: number;
  taggedOccurrences: number;
  totalOccurrences: number;
  senses: Array<{
    rank: number;
    ids: string[];
    label: string;
    domain?: string;
    count: number;
    current: boolean;
    examples: string[];
  }>;
}

/** Reverse orbit — English word → original-language lemmas (from alignments). */
export interface LanguageReverseOrbit {
  englishWord: string;
  key: string;
  total: number;
  packageId: string;
  source: "alignments";
  /** Hub meta, e.g. "whole Bible". */
  scopeHint?: string;
  segments: Array<
    LanguageOrbitSegment & {
      strongs: string | null;
      definition?: LanguageDefinition | null;
    }
  >;
}

export interface LanguageSyntaxNode {
  id: string;
  cat: string;
  rule?: string;
  clType?: string;
  tokenId?: string;
  surface?: string;
  gloss?: string;
  lemma?: string;
  children?: LanguageSyntaxNode[];
}

export interface LanguageSyntaxSentence {
  id: string;
  refLabel: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  tokenIds: string[];
  root: LanguageSyntaxNode;
}

export interface LanguageSyntaxHit {
  sentence: LanguageSyntaxSentence;
  packageId: string;
  book: string;
  focusTokenId: string;
  attribution: string;
}

export interface LanguageTokenCard {
  token: LanguageToken;
  displaySurface?: string;
  /** Short pastor-facing gloss; lexicon prose stays in Definition. */
  gloss: string | null;
  glossSource: "package" | "strongs-hebrew" | null;
  morphLabels: string[];
  morphExplain: LanguageMorphExplain | null;
  /** Present only when morphCode hits STEP tables. */
  stepMorph?: LanguageStepMorph | null;
  /** TIPNR individual (person/place) when resolvable — not all same-Strong hits. */
  nameEntity?: LanguageNameEntityHit | null;
  /** Rendering Orbit when lemma has corpus glosses. */
  renderingOrbit?: LanguageRenderingOrbit | null;
  /** Strong's dictionary definition for the Definition expander (+ optional deeper Thayer/BDB). */
  definition?: LanguageDefinition | null;
  /** Context-tagged Greek senses; Thayer remains Definition prose only. */
  semanticSenses?: LanguageSemanticSenseOutline | null;
  /** Reverse orbit: English → lemmas (when reading package has alignments). */
  reverseOrbit?: LanguageReverseOrbit | null;
  lemmaFreq: { corpus: number; book: number; chapter: number };
  neighborhood: { before: LanguageToken[]; after: LanguageToken[] };
  occurrencesInBook: LanguageToken[];
  marks: LanguageTokenMark[];
}

export type LanguageNameEntity = {
  id: string;
  kind: "person" | "place" | "other";
  displayName: string;
  brief: string;
  short?: string;
  uStrong: string;
  baseStrong: string;
  firstRef?: string;
  refs: string[];
  refCount: number;
  gender?: string;
};

export type LanguageNameEntityHit = {
  entity: LanguageNameEntity;
  match: "ref+strong" | "ref" | "strong+name" | "strong";
  alternatives: LanguageNameEntity[];
};
