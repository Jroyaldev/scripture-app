import type { AppMaterial, AppTheme } from "./theme.js";
import type { Transcript, TranscriptRefusal } from "../core/transcripts.js";
import type { ReferenceSet } from "../core/references.js";
import type { PassageMoment } from "../core/passage-index.js";
import type { EntityResearchData } from "../core/entities/place-research.js";
import type {
  ConnectionAnchorV2,
  ConnectionKind,
  ConnectionRecord,
} from "../core/annotations/types.js";
import type {
  CaptureOccurrenceSelectionResult,
  OccurrenceSelectionPiece,
} from "../core/annotations/occurrence-alignment.js";
import type {
  ConnectionPaintProjectionRequest,
  ConnectionPaintProjectionResponse,
} from "./utils/connectionPaint.js";
import type {
  RankedTrustedResource,
  TrustedResourceQuery,
  TrustedResourceRefusal,
} from "../core/resources/trusted-resources.js";
import type { StudyWorkspaceStateV2 } from "./utils/studyWorkspace.js";
export type { RankedTrustedResource } from "../core/resources/trusted-resources.js";

/** One publisher as the library matrix sees it, with the kinds it holds. */
export interface TrustedResourceCatalogueEntry {
  id: string;
  name: string;
  homepageUrl: string;
  records: number;
  muted: boolean;
  kinds: Array<{ kind: string; records: number; muted: boolean }>;
}
export type { EntityResearchData, EntityResearchLicensing } from "../core/entities/place-research.js";
export type { LicensedSource } from "../core/entities/licensed-source.js";
export type { ConnectionAnchor, ConnectionKind, ConnectionRecord } from "../core/annotations/types.js";

export type AppWindowCloseRequest = { requestId: string; source: "window" | "quit" };

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
        updateNote(id: string, title: string, body: string): Promise<{ ok: boolean; error?: string }>;
        deleteNote(id: string): Promise<{ ok: boolean; filename?: string; content?: string; error?: string }>;
        restoreNote(filename: string, content: string): Promise<{ ok: boolean; error?: string }>;
        queryVerse(book: string, chapter: number, verse: number): Promise<QueryResult>;
        queryRange(startBook: string, startCh: number, startV: number, endBook: string, endCh: number, endV: number): Promise<QueryResult>;
        createHighlight(book: string, chapter: number, verseStart: number, verseEnd: number, color: string, packageId: string, charStart?: number | null, charEnd?: number | null): Promise<{ ok: boolean; highlightId?: string; changeId?: string; error?: string }>;
        createConnection(kind: ConnectionKind, label: string, observation: string, anchors: ConnectionAnchorV2[], commandId: string): Promise<{ ok: boolean; connection?: ConnectionRecord; projection?: "current" | "rebuilt" | "pending"; error?: string; warning?: string }>;
        updateConnection(connectionId: string, kind: ConnectionKind, label: string, observation: string, anchors: ConnectionAnchorV2[], commandId: string, expectedBaseEventId: string): Promise<{ ok: boolean; connection?: ConnectionRecord; projection?: "current" | "rebuilt" | "pending"; conflict?: boolean; error?: string; warning?: string }>;
        deleteConnection(connectionId: string, commandId: string, expectedBaseEventId: string): Promise<{ ok: boolean; projection?: "current" | "rebuilt" | "pending"; conflict?: boolean; error?: string; warning?: string }>;
        captureConnectionSelection(
          packageId: string,
          selections: readonly OccurrenceSelectionPiece[],
        ): Promise<CaptureOccurrenceSelectionResult>;
        projectConnections(
          packageId: string,
          connections: readonly ConnectionPaintProjectionRequest[],
        ): Promise<ConnectionPaintProjectionResponse>;
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
        search(
          packageId: string,
          query: string,
          limit?: number,
          context?: { book?: string; chapter?: number },
        ): Promise<ScriptureSearchHitData[]>;
        getCrossRefsForPassage(
          book: string,
          chapter: number,
          startVerse: number,
          endVerse: number,
          packageId: string,
        ): Promise<CrossReferenceResultData>;
      };
      transcripts: {
        /* Absence is the ordinary answer, not a failure: most episodes have no
           transcript yet, and the player has to render that quietly. */
        load(recordId: string): Promise<
          | { ok: true; transcript: Transcript }
          | { ok: false; reason: TranscriptRefusal }
        >;
      };
      references: {
        /* Absence is ordinary — an episode may discuss no passage worth
           pointing at, which is a result rather than a fault. */
        load(recordId: string): Promise<
          | { ok: true; references: ReferenceSet }
          | { ok: false; reason: TranscriptRefusal }
        >;
      };
      passages: {
        /* Empty is the ordinary answer — most chapters have nobody teaching
           them, and that is not a failure to report. */
        moments(book: string, chapter: number): Promise<{ ok: true; moments: PassageMoment[] }>;
      };
      trustedResources: {
        query(query: TrustedResourceQuery): Promise<
          | {
              ok: true;
              resources: RankedTrustedResource[];
              total: number;
              hiddenCount: number;
            }
          | { ok: false; refusal: TrustedResourceRefusal }
        >;
        catalogue(): Promise<
          | { ok: true; sources: TrustedResourceCatalogueEntry[]; mutes: string[] }
          | { ok: false; refusal: TrustedResourceRefusal }
        >;
        openOfficial(sourceId: string, resourceId: string, url: string): Promise<{ ok: true }>;
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
        getEntitiesForRange(
          book: string,
          chapter: number,
          startVerse: number,
          endVerse: number,
        ): Promise<LanguageEntityRangeResult>;
        searchEntities(query: string, limit?: number): Promise<LanguageEntitySearchResult>;
        getEntityResearch(entityId: string): Promise<EntityResearchData | null>;
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
      system: {
        openExternalResearchUrl(url: string): Promise<{ ok: true }>;
      };
      appWindow: {
        onCloseRequested(listener: (request: AppWindowCloseRequest) => void): () => void;
        requestClose(): void;
        resolveCloseRequest(requestId: string, proceed: boolean): void;
      };
      settings: {
        get(): Promise<AppSettings>;
        set(partial: Partial<AppSettings>): Promise<AppSettings>;
      };
    };
  }
}

/** Type size, and with it the measure: the stylesheet couples 17/560, 19/660
 * and 22/780 so a size is always read at roughly 68 characters. A separate
 * `ReadingWidth` of narrow/medium/wide stood beside this until the coupling
 * took its CSS away and left it setting nothing. */
export type ReadingSize = "s" | "m" | "l";
export type VerseNumberMode = "always" | "faint" | "hover";
/**
 * Two surfaces, not four. Of the eight configurations the four surfaces
 * produced, two were re-implementations of the dock (rail·bottom shares the
 * dock's own bottom-inset rule; radial·sheet is a 2x46px grid with a help
 * card, which is the dock) and two could not work where they were offered:
 * rail·side padded the reading content by 92px, so the measure moved when a
 * tool appeared, and radial·wheel only labels its petals under a coarse
 * pointer — unlabelled on exactly the pointer devices that were offered it.
 *
 * Pointer gets the floating palette. Touch gets the bottom dock.
 */
export type MarkingSurface = "palette" | "dock";

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
  /** Material is orthogonal to the atmosphere: any theme, translucent or not. */
  material: AppMaterial;
  markingSurface: MarkingSurface;
  sidebarCollapsed: boolean;
  marginVisible: boolean;
  readingSize: ReadingSize;
  verseNumbers: VerseNumberMode;
  /**
   * What the reader muted, permanently: `publisher` or `publisher:kind`.
   * The main process applies it to every query.
   */
  resourceMutes: string[];
  recentPassages: RecentPassageSetting[];
  /** Where the reader last was — restored on launch. */
  lastRead: {
    book: string;
    chapter: number;
    packageId: string;
    /** Backward-compatible exact eye-line fields; absent means chapter top. */
    verse?: number;
    verseOffset?: number;
  } | null;
  /** Revisioned desktop workspace. Legacy settings remain Electron-only migration inputs. */
  studyWorkspace?: StudyWorkspaceStateV2 | null;
  studyWorkspaceRefusal?: "newer-version";
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
  connections: ConnectionRecord[];
  notes: NoteRecord[];
}

/** A noncanonical display heading: the editors' own subdivision of a chapter. */
export type ScriptureHeadingKind =
  | "section" | "major-section" | "description" | "speaker" | "acrostic";

export interface ScriptureHeading {
  /** The first canonical verse this heading governs. */
  beforeVerse: number;
  kind: ScriptureHeadingKind;
  level: number;
  text: string;
}

export interface ChapterData {
  verses: Array<{ verse: number; text: string }>;
  /**
   * Present where the package's source carried them — today BSB only, from
   * USFM \s/\ms/\d/\sp/\qa markers. Absent is normal, not an error.
   */
  headings?: ScriptureHeading[];
}

export interface ScriptureSearchHitData {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  order: number;
  score: number;
  matchKind: "phrase" | "all-terms" | "terms";
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
  /**
   * Who wrote `entity.brief` / `entity.short`. The words panel renders that
   * prose, and Rev 04 §4 forbids drawing licensed prose that cannot name its
   * source — so this travels with the hit rather than being assumed from the
   * shape of the type. Optional because an older host build may not send it,
   * and "absent" has to mean "unnameable", not "crash".
   */
  licensed?: LicensedSourceData | null;
};

/** Mirror of `LicensedSource` as it crosses IPC. */
export type LicensedSourceData = {
  siglum: string;
  name: string;
  license: string;
  href: string | null;
};

export type LanguageEntityRangeResult = {
  entities: LanguageNameEntity[];
  attribution: {
    name: string;
    license: string;
  };
  /** Names the `brief` on every entity above. Absent/null means the corpus
   *  could not be named, and Rev 04 §4 then forbids drawing that prose. */
  licensed?: LicensedSourceData | null;
};

export type LanguageEntitySearchResult = {
  entities: Array<{
    entity: LanguageNameEntity;
    match: "name" | "description";
    score: number;
  }>;
  attribution: {
    name: string;
    license: string;
  };
};
