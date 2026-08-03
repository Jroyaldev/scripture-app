import type React from "react";
import { Fragment, useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import type {
  BackboneData,
  BookNameData,
  ChapterData,
  CrossReferenceResultData,
  HighlightRecord,
  MarkingSurface as MarkingSurfaceId,
  QueryResult,
  ReadingSize,
  SemanticMarginResult,
  VerseNumberMode,
} from "../api.js";
import {
  LivingMargin,
  type EntityResearchOpenOptions,
  type EntityResearchTarget,
  type EntityResearchTrailEntry,
  type LivingMarginCaptureRequest,
  type LivingMarginScrollController,
} from "./LivingMargin.js";
import type { MarginWorkspace } from "../utils/marginWorkspace.js";
import type {
  PassageViewState,
  StudyWorkspaceStateV2,
} from "../utils/studyWorkspace.js";
import type {
  ConnectionDraftExitController,
} from "../utils/connectionDraftLifecycle.js";
import type {
  WorkspaceExitController,
  WorkspaceTransitionReason,
} from "../utils/workspaceTransition.js";
import type { WorkspacePersistenceStatus } from "../utils/workspacePersistence.js";
import { useToast } from "./Toast.js";
import { safeCall } from "../utils/safeCall.js";
import { parsePassage } from "../utils/parsePassage.js";
import { rangeToVerseCharOffsets } from "../utils/rangeToCharOffsets.js";
import { nextVerseSelection } from "../utils/verseSelection.js";
import { scopeHighlightsToPackage } from "../utils/highlightPackageScope.js";
import { Popover } from "./Popover.js";
import { ScriptureWorkspaceTabs } from "./ScriptureWorkspaceTabs.js";
import { StudyControl } from "./StudyControl.js";
import { HighlightUnderlay, FADE_MS, SWEEP_MS } from "./HighlightUnderlay.js";
import {
  MarkingSurface,
  type ConnectionExtensionRequest,
  type ConnectionDraftModel,
  type MarkingSelectionCapture,
  type MarkingSelectionModel,
} from "./MarkingSurface.js";
import {
  ConnectionUnderlay,
  type ConnectionWordHit,
  type ConnectionWordHitTest,
} from "./ConnectionUnderlay.js";
import { ConnectionCard, type ConnectionCardRecovery } from "./ConnectionCard.js";
import { isTopLayer, layerStackIsEmpty, useLayer } from "../layerStack.js";
import { leastScrollForMembers, memberSpan } from "../utils/connectionAttendScroll.js";
import { phraseCount, relationshipLabel } from "../utils/relationshipVocabulary.js";
import { ReadingComfort, type ReadingPrefs } from "./ReadingComfort.js";
import { ThemePicker } from "./ThemePicker.js";
import { Tooltip } from "./Tooltip.js";
import type { AppMaterial, AppTheme } from "../theme.js";
import { NoteCapture, type NoteCaptureDraft } from "./NoteCapture.js";
import type { PeekTarget, VersePeekOpenOptions } from "./VersePeek.js";
import {
  formatRecentLabel,
  normalizeRecents,
  pushRecent,
  removeRecent,
  type RecentPassage,
} from "../utils/recentPassages.js";
import { isHighlightOverlap, type HighlightRange } from "../../core/events/highlightOverlap.js";
import { resolveBlobExtent, buildSegments, isAdjacent } from "../../core/events/highlightAdjacency.js";
import type {
  ConnectionAnchor,
  ConnectionAnchorV2,
  ConnectionKind,
  ConnectionRecord,
  ConnectionRecordV2,
} from "../../core/annotations/types.js";
import type { OccurrenceSelectionPiece } from "../../core/annotations/occurrence-alignment.js";
import { canonicalConnectionAnchors } from "../../core/annotations/connection-order.js";
import type {
  ConnectionPaintAnchor,
  ConnectionPaintProjection,
} from "../utils/connectionPaint.js";
import {
  connectionRecordVersion,
  isConnectionProjectionPending,
  needsLocalConnectionReconciliation,
  reconcileCreatedConnection,
  reconcileDeletedConnection,
  reconcileUpdatedConnection,
  type ConnectionMutationUiOutcome,
  type MarginReloadStatus,
} from "../utils/connectionMutationReconciliation.js";
import {
  orderConnectionWordHits,
  resolveReadingPointerIntent,
} from "../utils/readingInteraction.js";
import { parseConnectionTickMemberIds } from "../utils/connectionRowLayout.js";
import { passageTabOpenIntent } from "../utils/passageTabIntent.js";
import {
  backNavigationHistory,
  forwardNavigationHistory,
  pushNavigationHistory,
  type NavigationHistoryState,
  type NavigationMarginScope,
  type NavigationMarginTab,
} from "../utils/navigationHistory.js";

export interface MarginCaptureContext {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  packageId: string;
}

/** Build an editable draft whose source and study origin remain visible. */
export function buildMarginCaptureDraft(
  capture: LivingMarginCaptureRequest,
  context: MarginCaptureContext,
): NoteCaptureDraft {
  const excerpt = capture.excerpt.trim();
  const quoteBlock = excerpt
    ? excerpt.split(/\n+/).map((line) => `> ${line}`).join("\n")
    : "";
  const attribution = `— Source: ${capture.sourceAttribution} · ${capture.reference} · captured while studying ${capture.frozenOrigin}`;
  const studyReference = capture.frozenOrigin.replace(/:\d+(?:[–-]\d+)?$/, "");
  return {
    title: `${capture.reference} — from ${studyReference} study`,
    passageRef: capture.reference,
    quote: "",
    bodyPrefill: quoteBlock ? `${quoteBlock}\n\n${attribution}` : attribution,
    originLabel: capture.originLabel,
    ...context,
  };
}

export interface PinnedRange {
  start: number;
  end: number;
}

export interface KeptMarginReference {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  label?: string;
}

export type MarginSubject = {
  kind: "selection" | "kept" | "following";
  book: string;
  chapter: number;
  verse: number;
  endVerse: number;
};

export function resolveMarginSubject(input: {
  canvasBook: string;
  canvasChapter: number;
  canvasChapterEndVerse: number;
  nearVerse: number | null;
  selection: PinnedRange | null;
  kept: KeptMarginReference | null;
}): MarginSubject {
  if (input.selection) {
    return { kind: "selection", book: input.canvasBook, chapter: input.canvasChapter, verse: input.selection.start, endVerse: input.selection.end };
  }
  if (input.kept) {
    return {
      kind: "kept",
      book: input.kept.book,
      chapter: input.kept.chapter,
      verse: input.kept.verse,
      endVerse: input.kept.endVerse ?? input.kept.verse,
    };
  }
  const verse = input.nearVerse ?? 1;
  return {
    kind: "following",
    book: input.canvasBook,
    chapter: input.canvasChapter,
    verse,
    endVerse: input.nearVerse == null ? input.canvasChapterEndVerse : verse,
  };
}

export function supersedeKeptReference(
  kept: KeptMarginReference | null,
  selectionBook: string,
  selectionChapter: number,
): KeptMarginReference | null {
  return kept?.book === selectionBook && kept.chapter === selectionChapter ? null : kept;
}

interface TranslationViewport {
  packageId: string;
  verse: number | null;
  verseOffset: number;
  scrollTop: number;
}

interface CapturedViewport {
  verse: number | null;
  verseOffset: number;
  scrollTop: number;
}

interface SavedViewportTarget extends CapturedViewport {
  book: string;
  chapter: number;
  packageId: string;
  requestId: number;
}

interface GoToOptions {
  focusHeading?: boolean;
  preapproved?: boolean;
  recordRecent?: boolean;
  rangeEnd?: number;
  historyMode?: "push" | "traverse";
  history?: NavigationHistoryState<PassageViewState>;
  packageId?: string;
  restoreEntry?: PassageViewState;
}

export interface RestoredPassageSelection {
  phrase: HighlightRange | null;
  verses: number[];
  anchor: number | null;
}

/**
 * Rebuild the selection model from one durable passage snapshot. Exact,
 * package-local pieces take precedence over their coarse margin envelope;
 * the envelope exists for Study scope and must not widen a phrase back to
 * whole verses during relaunch, history traversal, or an owner switch.
 */
export function restorePassageSelection(entry: PassageViewState): RestoredPassageSelection {
  const pieces = entry.selection?.packageId === entry.packageId
    ? [...entry.selection.pieces].sort((left, right) => left.verse - right.verse)
    : [];
  const firstPiece = pieces[0];
  const lastPiece = pieces.at(-1);
  if (firstPiece && lastPiece) {
    return {
      phrase: {
        verseStart: firstPiece.verse,
        verseEnd: lastPiece.verse,
        charStart: firstPiece.charStart,
        charEnd: lastPiece.charEnd,
      },
      verses: [],
      anchor: firstPiece.verse,
    };
  }

  const scope = entry.margin.scope;
  if (scope?.kind !== "selection") {
    return { phrase: null, verses: [], anchor: null };
  }
  return {
    phrase: null,
    verses: Array.from(
      { length: Math.max(1, scope.end - scope.start + 1) },
      (_, index) => scope.start + index,
    ),
    anchor: scope.start,
  };
}

export interface PassageRestoreCandidate {
  ownerTabId: string;
  entry: PassageViewState;
}

export interface PassageRestoreContext {
  ownerTabId: string;
  book: string;
  chapter: number;
  packageId: string;
}

/**
 * Return a controlled selection snapshot only for the workspace and rendered
 * text that scheduled it. Matching coordinates alone are insufficient because
 * duplicate passage tabs may retain different exact phrases.
 */
export function passageRestoreEntryForContext(
  candidate: PassageRestoreCandidate | null,
  context: PassageRestoreContext,
): PassageViewState | null {
  if (
    candidate?.ownerTabId !== context.ownerTabId
    || candidate.entry.book !== context.book
    || candidate.entry.chapter !== context.chapter
    || candidate.entry.packageId !== context.packageId
  ) return null;
  return candidate.entry;
}

/** Build the controlled snapshot for a deliberate, non-history navigation. */
export function freshPassageNavigationEntry(
  current: PassageViewState,
  target: {
    book: string;
    chapter: number;
    packageId: string;
    verse?: number;
    rangeEnd?: number;
  },
): PassageViewState {
  const endVerse = target.verse == null
    ? undefined
    : Math.max(target.verse, target.rangeEnd ?? target.verse);
  const keptScope = current.margin.scope?.kind === "kept"
    ? current.margin.scope
    : null;
  return {
    book: target.book,
    chapter: target.chapter,
    packageId: target.packageId,
    ...(target.verse != null
      ? { verse: target.verse, verseOffset: 0, scrollTop: 0 }
      : { scrollTop: 0 }),
    margin: {
      activeTab: current.margin.activeTab,
      scope: target.verse != null
        ? { kind: "selection", start: target.verse, end: endVerse! }
        : keptScope,
      scrollTopByTab: {},
      ...(target.verse != null ? { wordsVerse: target.verse } : {}),
      wordsFollowingReading: true,
    },
  };
}

interface ReferenceViewportTarget {
  book: string;
  chapter: number;
  verse: number;
  requestId: number;
}

interface MarkingSelectionSnapshot {
  contextKey: string;
  generation: number;
  phrase: HighlightRange | null;
  verses: Set<number>;
  verseAnchor: number | null;
}

interface ConnectionWordChooserState {
  anchorRect: DOMRect;
  hits: readonly ConnectionWordHit[];
  /** Present only when a grouped margin tick owns this chooser. */
  aggregateMemberIds?: readonly string[];
}

function findConnectionTickControl(connectionId: string): HTMLButtonElement | null {
  const direct = document.querySelector<HTMLButtonElement>(
    `[data-connection-tick="${CSS.escape(connectionId)}"]`,
  );
  if (direct) return direct;
  return [...document.querySelectorAll<HTMLButtonElement>("[data-connection-tick-members]")]
    .find((button) => parseConnectionTickMemberIds(button.dataset.connectionTickMembers)
      .includes(connectionId)) ?? null;
}

/* H·2 — the reading canvas' touch grammar.
 *
 * The reach test decides what needs a gesture at all: if reaching an element is
 * the only way to do something, it is in the wrong place. Below 720px the
 * chapter arrows are gone from the header, so the horizontal swipe is not a
 * shortcut for them — it is the only way to move by chapter, and it has to be
 * as dependable as the button was.
 *
 * None of these gestures is destructive. A swipe moves, scrolls or extends;
 * nothing is deleted, dismissed or archived by dragging, and every removal
 * stays an explicit tap on a named action. */

/** A drag is horizontal only once it is unambiguously not a scroll. */
const PAGE_SWIPE_AXIS_LOCK = 12;
/** Travel that commits a chapter step: a deliberate throw, not a twitch. */
const PAGE_SWIPE_COMMIT_TRAVEL = 56;
/** Damping on the page's follow, and on the shorter one it gives at an edge. */
const PAGE_SWIPE_FOLLOW_RATIO = 0.42;
const PAGE_SWIPE_EDGE_RATIO = 0.16;
const PAGE_SWIPE_EDGE_TRAVEL = 14;
/**
 * The OS back gesture owns the left 20px of the window, and that strip overlaps
 * the 24px verse gutter. A drag beginning inside it belongs to the platform —
 * taking it would make Back stop working, which is the one convention §3 says
 * to match rather than override.
 */
const BACK_GESTURE_STRIP = 20;

type MarginReloadOutcome =
  | { status: "applied"; value: QueryResult }
  | { status: Exclude<MarginReloadStatus, "applied"> };

export interface StudyCanvasCapture {
  ownerTabId: string;
  entry: PassageViewState;
}

export interface StudyCanvasController {
  flushPendingMarginScroll(): void;
  captureCurrent(): StudyCanvasCapture | null;
}

interface Props {
  backbone: BackboneData;
  bookNames: BookNameData;
  navigateRef: { ownerTabId: string; book: string; chapter: number; verse?: number; endVerse?: number; preapproved: true } | null;
  onNavigateRefConsumed?: () => void;
  sessionOwnerTabId: string;
  sessionEntry: PassageViewState;
  navigationHistory: NavigationHistoryState<PassageViewState>;
  onNavigationHistoryChange: (
    ownerTabId: string,
    history: NavigationHistoryState<PassageViewState>,
  ) => void;
  onSessionEntryChange: (ownerTabId: string, entry: PassageViewState) => void;
  onOpenCommandPalette?: () => void;
  onOpenResourceSettings?: () => void;
  onOpenResearchPalette?: () => void;
  onOpenPassageTab?: (target: {
    book: string;
    chapter: number;
    verse?: number;
    endVerse?: number;
    packageId: string;
  }, options?: {
    source?: "chapter-step" | "passage-picker" | "verse-peek";
    focusDestination?: boolean;
  }) => Promise<boolean>;
  onReadingContextChange?: (context: {
    book: string;
    chapter: number;
    chapterEndVerse?: number;
    packageId: string;
    verseStart?: number;
    verseEnd?: number;
  }) => void;
  onCreateNote: (prefillBody?: string) => void;
  marginVisible: boolean;
  onAiBusyChange?: (busy: boolean) => void;
  /** Lifted to App, consistent with marginVisible; ScripturePage never owns theme state itself. */
  theme?: AppTheme;
  onThemeChange?: (theme: AppTheme) => void;
  material?: AppMaterial;
  onMaterialChange?: (material: AppMaterial) => void;
  markingSurface?: MarkingSurfaceId;
  /** Lifted to App, same pattern as onThemeChange; ScripturePage never owns marginVisible itself. */
  onToggleMargin?: () => void;
  /** Idempotently reveal Living Margin, leaving Focus mode when necessary. */
  onEnsureMarginVisible?: () => void;
  /** Fired whenever the pinned (selected) verse range changes; null when nothing is selected. */
  onPinnedRangeChange?: (range: PinnedRange | null) => void;
  readingSize?: ReadingSize;
  verseNumbers?: VerseNumberMode;
  onReadingPrefsChange?: (partial: Partial<ReadingPrefs>) => void;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  onAuthoredMutationStateChange?: (state: "idle" | "in-flight" | "recovery") => void;
  onConnectionDraftExitControllerChange?: (controller: ConnectionDraftExitController | null) => void;
  onStudyCanvasControllerChange?: (controller: StudyCanvasController | null) => void;
  onWorkspaceExitControllerChange?: (controller: WorkspaceExitController | null) => void;
  onRequestWorkspaceTransition: (
    reason: WorkspaceTransitionReason,
    commit: () => void | Promise<void>,
  ) => Promise<boolean>;
  studyWorkspace: StudyWorkspaceStateV2;
  activeWorkspaceKind: "passage" | "entity";
  onWorkspaceTabSelect?: (tabId: string) => Promise<boolean>;
  onWorkspaceTabClose?: (tabId: string) => Promise<boolean>;
  onWorkspaceGroupClose?: (groupId: string) => Promise<boolean>;
  onWorkspaceGroupRename?: (groupId: string, label: string) => Promise<boolean>;
  onWorkspaceTabMove?: (tabId: string, targetGroupId: string) => Promise<boolean>;
  onWorkspaceTabPromote?: (tabId: string) => Promise<boolean>;
  onWorkspaceTabReorder?: (
    tabId: string,
    position: "left" | "right" | "start" | "end",
  ) => Promise<boolean>;
  onWorkspaceGroupReorder?: (
    groupId: string,
    position: "left" | "right" | "start" | "end",
  ) => Promise<boolean>;
  onWorkspaceRecentReopen?: (index?: number) => Promise<boolean>;
  onWorkspaceTabDuplicate?: () => Promise<boolean>;
  onStartStudy?: () => Promise<boolean>;
  /** A study just created and waiting for the reader to name it on its chip. */
  studyNamingRequest?: { groupId: string; nonce: number } | null;
  workspacePersistenceStatus: WorkspacePersistenceStatus;
  onRetryWorkspacePersistence: () => Promise<boolean>;
  researchScrollTop?: number;
  onResearchScrollTopChange?: (ownerTabId: string, scrollTop: number) => void;
  entityResearchFocusRequest?: number | null;
  onEntityResearchFocusRequestHandled?: (ownerTabId: string, requestId: number) => void;
  entityIntent?: {
    id: string;
    displayName: string;
    kind: "person" | "place" | "other";
    nonce: number;
    origin: { book: string; chapter: number; chapterEndVerse?: number; packageId: string; verseStart?: number; verseEnd?: number };
  } | null;
  onOpenEntity?: (target: EntityResearchTarget) => Promise<boolean>;
  onDrillEntity?: (target: EntityResearchTarget, options?: EntityResearchOpenOptions) => Promise<boolean>;
  onBranchEntity?: (target: EntityResearchTarget) => Promise<boolean>;
  onReturnEntityOrigin?: () => Promise<boolean>;
  onCloseEntity?: () => Promise<boolean>;
  entityTrail?: readonly EntityResearchTrailEntry[];
  onEntityTrailChange?: (
    ownerTabId: string,
    update: (current: readonly EntityResearchTrailEntry[]) => EntityResearchTrailEntry[],
  ) => void;
  keptContext?: KeptMarginReference | null;
  onKeptContextChange?: (kept: KeptMarginReference | null) => void;
}

const OT_BOOKS = [
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
  "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
  "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAH","HAB","ZEP",
  "HAG","ZEC","MAL",
];
const NT_BOOKS = [
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
  "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
  "2PE","1JN","2JN","3JN","JUD","REV",
];

const TRANSLATIONS = [
  { code: "bsb", name: "Berean Standard Bible" },
  { code: "web", name: "World English Bible" },
  { code: "kjv", name: "King James Version" },
  { code: "ylt", name: "Young's Literal Translation (1898)" },
  { code: "akjv-strongs", name: "AKJV + Strong's" },
];

const EMPTY_CONNECTION_PAINT_PROJECTIONS: ReadonlyMap<string, ConnectionPaintProjection> = new Map();
const EMPTY_MARGIN_DATA: QueryResult = {
  anchors: [],
  highlights: [],
  connections: [],
  notes: [],
};
const EMPTY_CHAPTER_VERSE_TEXT = new Map<number, string>();

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function BackChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 5l-5 5 5 5" />
    </svg>
  );
}

function ChapterArrowIcon({ direction }: { direction: "previous" | "next" }): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "previous" ? "M12.5 5.5 8 10l4.5 4.5" : "M7.5 5.5 12 10l-4.5 4.5"} />
    </svg>
  );
}

function ReadingCanvasLoading({ passage }: { passage: string }): React.JSX.Element {
  return (
    <div className="reading-state reading-loading" role="status" aria-live="polite">
      <span className="sr-only">Loading {passage}</span>
      <div className="reading-skeleton" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className="reading-skeleton-line" />
        ))}
      </div>
    </div>
  );
}

function ReadingCanvasError({
  passage,
  error,
  onRetry,
}: {
  passage: string;
  error: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <section className="reading-state reading-state-message" role="alert" aria-labelledby="chapter-error-title" data-study-passage-fallback="">
      <span className="reading-state-kicker">Text unavailable</span>
      <h2 id="chapter-error-title">We couldn&apos;t open {passage}.</h2>
      <p>Try again, or choose another installed Bible text from the toolbar.</p>
      <button type="button" className="reading-state-action" onClick={onRetry}>Try again</button>
      <details className="reading-state-details">
        <summary>Technical details</summary>
        <code>{error}</code>
      </details>
    </section>
  );
}

function ReadingCanvasEmpty({ passage, onRetry }: { passage: string; onRetry: () => void }): React.JSX.Element {
  return (
    <section className="reading-state reading-state-message" role="status" aria-labelledby="chapter-empty-title" data-study-passage-fallback="">
      <span className="reading-state-kicker">No verses in this text</span>
      <h2 id="chapter-empty-title">{passage} is empty here.</h2>
      <p>Choose another installed Bible text from the toolbar, or check this text again.</p>
      <button type="button" className="reading-state-action" onClick={onRetry}>Check again</button>
    </section>
  );
}

function SearchIconSmall(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5l-4-4" />
    </svg>
  );
}

export function ScripturePage({
  backbone,
  bookNames,
  navigateRef,
  onNavigateRefConsumed,
  sessionOwnerTabId,
  navigationHistory,
  onNavigationHistoryChange,
  sessionEntry,
  onSessionEntryChange,
  onOpenCommandPalette,
  onOpenResourceSettings,
  onOpenResearchPalette,
  onOpenPassageTab,
  onReadingContextChange,
  onCreateNote: _onCreateNote,
  marginVisible,
  onAiBusyChange,
  theme = "light",
  onThemeChange,
  material,
  onMaterialChange,
  markingSurface = "palette",
  onToggleMargin,
  onEnsureMarginVisible,
  onPinnedRangeChange,
  readingSize = "m",
  verseNumbers = "always",
  onReadingPrefsChange,
  focusMode = false,
  onToggleFocus,
  onAuthoredMutationStateChange,
  onConnectionDraftExitControllerChange,
  onStudyCanvasControllerChange,
  onWorkspaceExitControllerChange,
  onRequestWorkspaceTransition,
  studyWorkspace,
  activeWorkspaceKind,
  onWorkspaceTabSelect,
  onWorkspaceTabClose,
  onWorkspaceGroupClose,
  onWorkspaceGroupRename,
  onWorkspaceTabMove,
  onWorkspaceTabPromote,
  onWorkspaceTabReorder,
  onWorkspaceGroupReorder,
  onWorkspaceRecentReopen,
  onWorkspaceTabDuplicate,
  onStartStudy,
  studyNamingRequest = null,
  workspacePersistenceStatus,
  onRetryWorkspacePersistence,
  researchScrollTop,
  onResearchScrollTopChange,
  entityResearchFocusRequest,
  onEntityResearchFocusRequestHandled,
  entityIntent,
  onOpenEntity,
  onDrillEntity,
  onBranchEntity,
  onReturnEntityOrigin,
  onCloseEntity,
  entityTrail,
  onEntityTrailChange,
  keptContext = null,
  onKeptContextChange,
}: Props): React.JSX.Element {
  // Selection notes use the in-place NoteCapture slide-over (stay on Read).
  // Parent still supplies onCreateNote for a future “open full Write” path.
  void _onCreateNote;
  const [book, setBook] = useState(sessionEntry.book);
  const [chapter, setChapter] = useState(sessionEntry.chapter);
  const [packageId, setPackageId] = useState(sessionEntry.packageId);
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [selectedVerses, setSelectedVerses] = useState<Set<number>>(
    () => new Set(restorePassageSelection(sessionEntry).verses),
  );
  const [marginTab, setMarginTab] = useState<NavigationMarginTab>(
    sessionEntry.margin.activeTab,
  );
  // Initial mount is itself one controlled snapshot restore. Subsequent owner,
  // history, and fresh-navigation commits advance this token so LivingMargin
  // can restore an intentional zero scroll without confusing it with a live
  // scope transition.
  const [sessionRestoreNonce, setSessionRestoreNonce] = useState(1);
  /* The study a tab is being dragged over, which is the one fact the two rows
     of the register have to share.
     The drag belongs to the strip — it owns the pointer, the tab and the
     mutation — and the chip that has to signal is the line's, one row up.
     Neither can see the other, so the page holds the fact between them: the
     strip reports what its pointer is over, the line paints it. It is not
     `studyFilterId` returning under another name; nothing about which study
     the strip SHOWS is stored here, and this is null except while a pointer is
     actually down on a tab. */
  const [tabDropStudyId, setTabDropStudyId] = useState<string | null>(null);
  /* AND WHETHER A DRAG IS HAPPENING AT ALL, which the fact above cannot answer.
     Null there means "over no study", and that is true both mid-drag and when
     there is no drag — but the study control's list has to be OPEN for the
     length of a drag, because its rows are the only study targets on screen now
     that the chips are gone. Two booleans rather than one tri-state: they answer
     different questions and the strip reports them at different moments. */
  const [tabDragActive, setTabDragActive] = useState(false);
  const marginWorkspace: MarginWorkspace = activeWorkspaceKind === "entity" ? "research" : "study";
  const [marginData, setMarginData] = useState<QueryResult>(EMPTY_MARGIN_DATA);
  const [marginDataChapterKey, setMarginDataChapterKey] = useState<string | null>(null);
  const marginRequestSequenceRef = useRef(0);
  const [crossRefs, setCrossRefs] = useState<CrossReferenceResultData | null>(null);
  const [keptSubjectState, setKeptSubjectState] = useState<{
    key: string;
    marginData: QueryResult;
    crossRefs: CrossReferenceResultData | null;
    chapterVerseText: Map<number, string>;
  } | null>(null);
  const [semanticData, setSemanticData] = useState<SemanticMarginResult | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);

  const [showHighlightPalette, setShowHighlightPalette] = useState(false);
  const [selectionNonce, setSelectionNonce] = useState(0);
  const selectionGenerationRef = useRef(0);
  const [selectionCapture, setSelectionCapture] = useState<{
    nonce: number;
    contextKey: string;
    capture: MarkingSelectionCapture;
  } | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  // Escape can arrive after the selected-shape DOM has disappeared but before
  // React has cleaned up the capture listener from the prior render. Keep the
  // listener's ownership check synchronous so that next Escape can reach App
  // and exit Focus mode instead of being swallowed by a stale closure.
  const selectedConnectionIdRef = useRef<string | null>(selectedConnectionId);
  selectedConnectionIdRef.current = selectedConnectionId;
  // When Focus mode unmounts the margin (and with it the inspector card),
  // this page takes over the selected shape's "connection-focus" layer so the
  // first Escape still dismisses the shape before App exits Focus mode.
  const connectionFocusFallbackLayerRef = useLayer(
    selectedConnectionId != null && focusMode ? "connection-focus" : null,
  );
  const [connectionCardRecovery, setConnectionCardRecovery] = useState<ConnectionCardRecovery | null>(null);
  const connectionCardRecoveryRef = useRef<ConnectionCardRecovery | null>(connectionCardRecovery);
  connectionCardRecoveryRef.current = connectionCardRecovery;
  const [connectionWordChooser, setConnectionWordChooser] = useState<ConnectionWordChooserState | null>(null);
  const [connectionInspectorFocusRequest, setConnectionInspectorFocusRequest] = useState(0);
  const connectionWordHitTestRef = useRef<ConnectionWordHitTest | null>(null);
  const connectionWordChooserOriginRef = useRef<HTMLElement | null>(null);
  const connectionWordChooserFirstChoiceRef = useRef<HTMLButtonElement | null>(null);
  const connectionWordChooserFocusFrameRef = useRef<number | null>(null);
  const visibleConnectionByIdRef = useRef<ReadonlyMap<string, ConnectionRecord>>(new Map());
  // User-held relationships are ordered independently from the one focused
  // relationship. Do not conflate this with ConnectionUnderlay's `.held`
  // planner state, which means a route needs more physical space.
  const [heldConnectionIds, setHeldConnectionIds] = useState<string[]>([]);
  const heldConnectionIdsRef = useRef<string[]>([]);
  const [connectionExtension, setConnectionExtension] = useState<ConnectionExtensionRequest | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraftModel | null>(null);
  const connectionDraftExitControllerRef = useRef<ConnectionDraftExitController | null>(null);
  const noteExitControllerRef = useRef<WorkspaceExitController | null>(null);
  const markingExitControllerRef = useRef<WorkspaceExitController | null>(null);
  const cardExitControllerRef = useRef<WorkspaceExitController | null>(null);
  const [markingMutationState, setMarkingMutationState] = useState<"idle" | "in-flight" | "recovery">("idle");
  const [cardMutationState, setCardMutationState] = useState<"idle" | "in-flight" | "recovery">("idle");
  const markingMutationStateRef = useRef(markingMutationState);
  const cardMutationStateRef = useRef(cardMutationState);
  const [connectionPaintState, setConnectionPaintState] = useState<{
    requestKey: string;
    projections: ReadonlyMap<string, ConnectionPaintProjection>;
  } | null>(null);
  const connectionPaintRequestRef = useRef(0);
  const connectionExtensionNonce = useRef(0);
  const readingFocusFrameRef = useRef<number | null>(null);
  // x is the palette's horizontal CENTER (it's centered over the selection
  // via a CSS transform, not left-aligned); y is the anchor edge — the
  // selection's top when opening above (the common case) or its bottom when
  // flipped below for lack of room.
  const [palettePos, setPalettePos] = useState({
    x: 0,
    y: 0,
    flipped: false,
    anchorBox: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  // Record ids of a just-created highlight — drives the left-to-right sweep-in
  // animation on the new blob. Keyed by highlight id (not verse number) so a
  // sweep can never leak onto a neighboring untouched highlight that happens
  // to share a verse. Cleared by handleHighlight's timer after the animation,
  // and on chapter change (below).
  const [animateIds, setAnimateIds] = useState<Set<string>>(new Set());
  // Record ids of a highlight mid-deletion — drives the fade-out on the blob.
  // Populated by handleDeleteHighlight, which deliberately keeps the highlight
  // in marginData for FADE_MS after issuing the delete so the blob has
  // something to fade from instead of just vanishing. Cleared once that timer
  // fires (and on chapter change, below).
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  // A sub-verse (word/phrase) selection produced by dragging across text —
  // mutually exclusive with selectedVerses (setting one clears the other).
  // charStart/charEnd are half-open string offsets into the verse's text, or
  // null when the selection reaches that side of the verse's true boundary
  // (see rangeToVerseCharOffsets — this null-normalization is what lets the
  // selection bridge into an adjacent same-color verse like a whole-verse
  // highlight would).
  const [phraseSelection, setPhraseSelection] = useState<HighlightRange | null>(
    () => restorePassageSelection(sessionEntry).phrase,
  );
  // Set on a mouseup that completed a real drag-selection, consumed by the
  // click handler that fires immediately after, so drag-residue clicks don't
  // collapse the phrase selection back to a whole-verse one.
  const suppressNextClickRef = useRef(false);
  const suppressNextClickTimerRef = useRef<number | null>(null);
  // A native selection may begin over Scripture and end in the gutter. The
  // completed gesture still belongs to the reading surface even when mouseup
  // no longer bubbles through `.verse-text`.
  const textSelectionGestureRef = useRef(false);
  // Whole-verse range selections are always contiguous. Shift extends from
  // this stable anchor; Command/Control-click intentionally behaves like a
  // normal click until discontiguous groups have an honest persistence model.
  const verseSelectionAnchorRef = useRef<number | null>(
    restorePassageSelection(sessionEntry).anchor,
  );
  const [retryToken, setRetryToken] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // H·2 — the canvas answers a coarse pointer with gestures a thumb can reach.
  // The test is the POINTER, not the window: a tablet held in two hands has the
  // same problem a phone has, and a mouse on a narrow window does not.
  const [coarsePointer, setCoarsePointer] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(any-pointer: coarse)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const syncCanvasPointerMode = (): void => setCoarsePointer(media.matches);
    syncCanvasPointerMode();
    media.addEventListener("change", syncCanvasPointerMode);
    return () => media.removeEventListener("change", syncCanvasPointerMode);
  }, []);
  // A horizontal page swipe and a horizontal text-selection drag want the same
  // movement. The selection wins: once one exists the swipe is SUSPENDED until
  // it clears, so dragging a platform handle can never carry the reader off the
  // text they are selecting.
  const pageSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    axis: "undecided" | "horizontal";
    follow: boolean;
  } | null>(null);
  const pageSwipeSettleRef = useRef<number | null>(null);
  const lastCanvasPointerTypeRef = useRef<string>("mouse");
  // The gutter mark is the range control — dragging one of its two grips moves
  // that edge by whole verses while the opposite edge stays the anchor.
  const verseRangeDragRef = useRef<{ pointerId: number; fixedVerse: number } | null>(null);
  // A long-press replaces the verse range with the platform's own word
  // selection; clearing that selection restores the range it replaced. The two
  // models never coexist, and neither silently eats the other.
  const versesBeforeWordSelectionRef = useRef<Set<number> | null>(null);
  const committedTouchSelectionRef = useRef<string | null>(null);
  const selectedVersesRef = useRef(selectedVerses);
  selectedVersesRef.current = selectedVerses;
  const phraseSelectionRef = useRef(phraseSelection);
  phraseSelectionRef.current = phraseSelection;
  // Read by the grip drag, which must not be rebuilt mid-gesture by the very
  // state it is changing.
  const chapterDataRef = useRef(chapterData);
  chapterDataRef.current = chapterData;

  const handleConnectionDraftExitControllerChange = useCallback((
    controller: ConnectionDraftExitController | null,
  ): void => {
    connectionDraftExitControllerRef.current = controller;
    markingExitControllerRef.current = controller;
    onConnectionDraftExitControllerChange?.(controller);
  }, [onConnectionDraftExitControllerChange]);

  const handleNoteExitControllerChange = useCallback((
    controller: WorkspaceExitController | null,
  ): void => {
    noteExitControllerRef.current = controller;
  }, []);

  const handleCardExitControllerChange = useCallback((
    controller: WorkspaceExitController | null,
  ): void => {
    cardExitControllerRef.current = controller;
  }, []);

  const suppressTrailingDragClick = useCallback((): void => {
    suppressNextClickRef.current = true;
    if (suppressNextClickTimerRef.current != null) {
      window.clearTimeout(suppressNextClickTimerRef.current);
    }
    // Native click dispatch follows mouseup before zero-delay timers. This
    // consumes only that gesture's residue; an outside release cannot poison
    // the user's next deliberate Scripture click.
    suppressNextClickTimerRef.current = window.setTimeout(() => {
      suppressNextClickTimerRef.current = null;
      suppressNextClickRef.current = false;
    }, 0);
  }, []);

  useEffect(() => () => {
    if (suppressNextClickTimerRef.current != null) {
      window.clearTimeout(suppressNextClickTimerRef.current);
      suppressNextClickTimerRef.current = null;
    }
  }, []);

  const advanceSelectionGeneration = useCallback((): void => {
    // A newly explicit selection supersedes any deferred focus return owned by
    // the selection that just closed. Without cancelling this frame, a resize
    // or a stale placement pass can let the old callback run after the new
    // tray opens and steal focus back from its first command.
    if (readingFocusFrameRef.current != null) {
      window.cancelAnimationFrame(readingFocusFrameRef.current);
      readingFocusFrameRef.current = null;
    }
    const next = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = next;
    setSelectionNonce(next);
  }, []);

  const applyPassageSelectionRestore = useCallback((entry: PassageViewState): void => {
    const restored = restorePassageSelection(entry);
    setPhraseSelection(restored.phrase ? { ...restored.phrase } : null);
    setSelectedVerses(new Set(restored.verses));
    verseSelectionAnchorRef.current = restored.anchor;
  }, []);

  const closeConnectionWordChooser = useCallback((restoreFocus = false): void => {
    if (connectionWordChooserFocusFrameRef.current != null) {
      window.cancelAnimationFrame(connectionWordChooserFocusFrameRef.current);
      connectionWordChooserFocusFrameRef.current = null;
    }
    const origin = connectionWordChooserOriginRef.current;
    connectionWordChooserOriginRef.current = null;
    setConnectionWordChooser(null);
    if (!restoreFocus || !origin) return;
    connectionWordChooserFocusFrameRef.current = window.requestAnimationFrame(() => {
      connectionWordChooserFocusFrameRef.current = null;
      if (origin.isConnected) origin.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => () => {
    if (connectionWordChooserFocusFrameRef.current != null) {
      window.cancelAnimationFrame(connectionWordChooserFocusFrameRef.current);
      connectionWordChooserFocusFrameRef.current = null;
    }
  }, []);

  // Passage picker popover state
  const [passageOpen, setPassageOpen] = useState(false);
  const [passageView, setPassageView] = useState<"chapters" | "books">("chapters");
  const [bookQuery, setBookQuery] = useState("");
  const [browseBook, setBrowseBook] = useState(book);
  const passageBtnRef = useRef<HTMLButtonElement>(null);
  const passageShouldReturnFocus = useRef(false);
  const [passageAnchor, setPassageAnchor] = useState<DOMRect | null>(null);
  const bookSearchRef = useRef<HTMLInputElement>(null);
  const [recents, setRecents] = useState<RecentPassage[]>([]);
  const recentsLoaded = useRef(false);
  // Gate for persisting/restoring the last-read passage: restore happens once
  // settings resolve; persistence only starts after that so the boot default
  // can never clobber the stored position. userNavigatedRef records that the
  // reader moved on their own before settings resolved (their choice wins).
  const lastReadLoaded = useRef(false);
  const userNavigatedRef = useRef(false);

  // Note capture slide-over (stays on Read — does not switch to Write tab)
  const [noteDraft, setNoteDraft] = useState<NoteCaptureDraft | null>(null);

  // Version picker popover state
  const [versionOpen, setVersionOpen] = useState(false);
  const versionBtnRef = useRef<HTMLButtonElement>(null);
  const versionShouldReturnFocus = useRef(false);
  const [versionAnchor, setVersionAnchor] = useState<DOMRect | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBounds, setStageBounds] = useState({ left: 0, top: 58, width: 900, height: 700, bottom: 758 });
  const pendingTranslationViewportRef = useRef<TranslationViewport | null>(null);
  const savedViewportRequestRef = useRef(
    sessionEntry.scrollTop != null || (sessionEntry.verse != null && sessionEntry.verseOffset != null) ? 1 : 0,
  );
  const [savedViewportTarget, setSavedViewportTarget] = useState<SavedViewportTarget | null>(() => (
    sessionEntry.scrollTop != null || (sessionEntry.verse != null && sessionEntry.verseOffset != null)
      ? {
          book: sessionEntry.book,
          chapter: sessionEntry.chapter,
          packageId: sessionEntry.packageId,
          verse: sessionEntry.verse ?? null,
          verseOffset: sessionEntry.verseOffset ?? 0,
          scrollTop: sessionEntry.scrollTop ?? 0,
          requestId: 1,
        }
      : null
  ));
  const [referenceViewportTarget, setReferenceViewportTarget] = useState<ReferenceViewportTarget | null>(null);
  const referenceViewportRequestRef = useRef(0);
  const navigationHistoryRef = useRef(navigationHistory);
  const sessionEntryRef = useRef<PassageViewState>(sessionEntry);
  const sessionOwnerTabIdRef = useRef(sessionOwnerTabId);
  const livingMarginScrollControllerRef = useRef<LivingMarginScrollController | null>(null);
  sessionOwnerTabIdRef.current = sessionOwnerTabId;
  navigationHistoryRef.current = navigationHistory;
  sessionEntryRef.current = sessionEntry;
  const [restoredSessionOwnerTabId, setRestoredSessionOwnerTabId] = useState(sessionOwnerTabId);
  const pendingPassageRestoreRef = useRef<PassageRestoreCandidate | null>({
    ownerTabId: sessionOwnerTabId,
    entry: sessionEntry,
  });
  const loadedChapterKeyRef = useRef<string | null>(null);
  const failedChapterKeyRef = useRef<string | null>(null);
  const lastLoadedChapterVerseTextRef = useRef<{
    book: string;
    chapter: number;
    packageId: string;
    verses: Map<number, string>;
  } | null>(null);
  const chapterHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusChapterHeading = useRef(false);
  // The .verse-text container — the SVG highlight underlay is positioned
  // absolutely inside it (behind the verse rows). Measured each pass so the
  // blobs track reflow on resize, font load, and margin toggle.
  const verseTextRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const handleMarkingMutationStateChange = useCallback((state: "idle" | "in-flight" | "recovery"): void => {
    markingMutationStateRef.current = state;
    if (state !== "idle") {
      userNavigatedRef.current = true;
      onAuthoredMutationStateChange?.(state);
    }
    setMarkingMutationState(state);
  }, [onAuthoredMutationStateChange]);
  const handleCardMutationStateChange = useCallback((state: "idle" | "in-flight" | "recovery"): void => {
    cardMutationStateRef.current = state;
    if (state !== "idle") {
      userNavigatedRef.current = true;
      onAuthoredMutationStateChange?.(state);
    }
    setCardMutationState(state);
  }, [onAuthoredMutationStateChange]);
  const connectionNavigationLocked = markingMutationState !== "idle"
    || cardMutationState !== "idle"
    || connectionCardRecovery != null;
  useEffect(() => {
    const state = connectionCardRecovery != null
      || markingMutationState === "recovery"
      || cardMutationState === "recovery"
      ? "recovery"
      : markingMutationState === "in-flight" || cardMutationState === "in-flight"
        ? "in-flight"
        : "idle";
    onAuthoredMutationStateChange?.(state);
  }, [cardMutationState, connectionCardRecovery, markingMutationState, onAuthoredMutationStateChange]);
  const requireSafeConnectionNavigation = useCallback((): boolean => {
    const markingState = markingMutationStateRef.current;
    const cardState = cardMutationStateRef.current;
    if (markingState === "idle" && cardState === "idle" && connectionCardRecoveryRef.current == null) return true;
    showToast(
      markingState === "in-flight" || cardState === "in-flight"
        ? "Finishing the current authored change · navigation will be available when it settles."
        : "Recovery required · retry the exact connection command before leaving this text.",
      undefined,
      undefined,
      { tone: "warning", durationMs: 7_000 },
    );
    return false;
  }, [showToast]);

  const workspaceExitController = useMemo<WorkspaceExitController>(() => ({
    requestExit: async (reason) => {
      // Mutation settlement and recovery are not decisions. Fail closed before
      // revealing any dirty-form prompt so the reader never resolves a note or
      // card only to discover that a command still owns the canvas.
      if (!requireSafeConnectionNavigation()) return false;
      const ownerSnapshot = [noteExitControllerRef.current, markingExitControllerRef.current, cardExitControllerRef.current];
      for (const owner of ownerSnapshot) {
        if (!owner) continue;
        try {
          if (!await owner.requestExit(reason)) return false;
        } catch {
          return false;
        }
      }
      return true;
    },
  }), [requireSafeConnectionNavigation]);

  useEffect(() => {
    onWorkspaceExitControllerChange?.(workspaceExitController);
    return () => onWorkspaceExitControllerChange?.(null);
  }, [onWorkspaceExitControllerChange, workspaceExitController]);

  const requestWorkspaceTransition = useCallback(async (
    reason: WorkspaceTransitionReason,
    commit: () => void | Promise<void>,
  ): Promise<boolean> => {
    try {
      return await onRequestWorkspaceTransition(reason, commit);
    } catch {
      return false;
    }
  }, [onRequestWorkspaceTransition]);

  // Verse nearest the reading eye-line — ambient Living Margin only.
  // Frozen while the pointer is over the margin or language study has locked
  // a verse (so side-panel clicks never "click out" to a different scroll position).
  const [nearVerse, setNearVerse] = useState<number | null>(null);
  // The Living Margin follows a settled eye-line, not the raw scroll
  // position. Verse-to-verse drift inside one chapter re-scopes the panel at
  // most once per pause; a book/chapter move drops back to chapter scope in
  // the same render, so no stale cross-chapter pairing can ever fetch.
  const scopeKey = `${sessionOwnerTabId}:${book}:${chapter}`;
  const [settledScope, setSettledScope] = useState<{ key: string; verse: number | null }>({ key: scopeKey, verse: null });
  if (settledScope.key !== scopeKey) {
    setSettledScope({ key: scopeKey, verse: null });
  }
  const settledNearVerse = settledScope.key === scopeKey ? settledScope.verse : null;
  useEffect(() => {
    if (nearVerse === settledNearVerse) return undefined;
    const timer = window.setTimeout(() => setSettledScope({ key: scopeKey, verse: nearVerse }), 240);
    return () => window.clearTimeout(timer);
  }, [nearVerse, settledNearVerse, scopeKey]);
  const verseRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Translation switches, relaunch restore, and canvas history all share one
  // exact eye-line model: nearest verse plus its pixel offset in the viewport.
  const captureReadingViewport = useCallback((): CapturedViewport | null => {
    const root = contentRef.current;
    if (!root) return null;
    const rootRect = root.getBoundingClientRect();
    const eyeY = rootRect.top + rootRect.height * 0.32;
    let anchorVerse: number | null = null;
    let anchorOffset = 0;
    let bestDistance = Infinity;
    for (const [verse, row] of verseRowRefs.current) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom < rootRect.top || rect.top > rootRect.bottom) continue;
      const distance = Math.abs((rect.top + rect.bottom) / 2 - eyeY);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      anchorVerse = verse;
      anchorOffset = rect.top - rootRect.top;
    }
    return { verse: anchorVerse, verseOffset: anchorOffset, scrollTop: root.scrollTop };
  }, []);

  const restoreReadingViewport = useCallback((viewport: CapturedViewport): void => {
    const root = contentRef.current;
    if (!root) return;
    root.scrollTop = viewport.scrollTop;
    if (viewport.verse != null) {
      const row = verseRowRefs.current.get(viewport.verse);
      if (row) {
        const currentOffset = row.getBoundingClientRect().top - root.getBoundingClientRect().top;
        root.scrollTop = Math.max(0, root.scrollTop + currentOffset - viewport.verseOffset);
      }
    }
    setScrolled(root.scrollTop > 0);
  }, []);

  // A workspace owner switch is a controlled restore, even when both tabs
  // happen to show the same chapter and package. Using only book/chapter as an
  // effect key leaks selection, lens, and scroll state between duplicate tabs.
  useLayoutEffect(() => {
    if (restoredSessionOwnerTabId === sessionOwnerTabId) return;
    pendingPassageRestoreRef.current = {
      ownerTabId: sessionOwnerTabId,
      entry: sessionEntry,
    };
    setRestoredSessionOwnerTabId(sessionOwnerTabId);
    setSessionRestoreNonce((current) => current + 1);
    advanceSelectionGeneration();
    setBook(sessionEntry.book);
    setChapter(sessionEntry.chapter);
    setPackageId(sessionEntry.packageId);
    setMarginTab(sessionEntry.margin.activeTab);
    applyPassageSelectionRestore(sessionEntry);

    setShowHighlightPalette(false);
    setSelectionCapture(null);
    heldConnectionIdsRef.current = [];
    setHeldConnectionIds([]);
    setSelectedConnectionId(null);
    closeConnectionWordChooser(false);
    setConnectionExtension(null);
    setConnectionDraft(null);
    if (suppressNextClickTimerRef.current != null) {
      window.clearTimeout(suppressNextClickTimerRef.current);
      suppressNextClickTimerRef.current = null;
    }
    suppressNextClickRef.current = false;
    textSelectionGestureRef.current = false;
    setNearVerse(null);
    setSettledScope({
      key: `${sessionOwnerTabId}:${sessionEntry.book}:${sessionEntry.chapter}`,
      verse: null,
    });
    setReferenceViewportTarget(null);
    setSavedViewportTarget({
      book: sessionEntry.book,
      chapter: sessionEntry.chapter,
      packageId: sessionEntry.packageId,
      verse: sessionEntry.verse ?? null,
      verseOffset: sessionEntry.verseOffset ?? 0,
      scrollTop: sessionEntry.scrollTop ?? 0,
      requestId: ++savedViewportRequestRef.current,
    });
  }, [
    advanceSelectionGeneration,
    applyPassageSelectionRestore,
    book,
    chapter,
    closeConnectionWordChooser,
    packageId,
    restoredSessionOwnerTabId,
    sessionEntry,
    sessionOwnerTabId,
  ]);

  // Invalidate every owner-sensitive request generation before downstream
  // effects start work for the new tab. LivingMargin itself is keyed by this
  // owner below, so its shared VersePeek controller unmounts, clearing open /
  // close timers and making it impossible for tab A's Keep action to land in B.
  useEffect(() => {
    marginRequestSequenceRef.current += 1;
    connectionPaintRequestRef.current += 1;
    referenceViewportRequestRef.current += 1;
  }, [sessionOwnerTabId]);
  const marginActiveRef = useRef(false);
  const readingFocusContextRef = useRef({
    book,
    chapter,
    nearVerse: null as number | null,
    firstVerse: null as number | null,
  });
  readingFocusContextRef.current = {
    book,
    chapter,
    nearVerse,
    firstVerse: chapterData?.verses[0]?.verse ?? null,
  };

  // Full verse text for the current chapter, keyed by verse number — passed
  // down to the Living Margin for pinned-passage quotes and the passage-
  // scoped AI insight call, and used below to normalize highlight char
  // bounds against each verse's true length.
  const chapterVerseText = useMemo<Map<number, string>>(() => {
    const m = new Map<number, string>();
    for (const v of chapterData?.verses ?? []) m.set(v.verse, v.text);
    return m;
  }, [chapterData]);

  // Keep the last complete quote map available across the one empty render
  // used to swap translation packages. The reading canvas still clears so
  // package-specific highlight offsets can never touch old prose; only the
  // already-selected quotation in the Living Margin receives this fallback.
  useLayoutEffect(() => {
    if (chapterVerseText.size === 0) return;
    lastLoadedChapterVerseTextRef.current = {
      book,
      chapter,
      packageId,
      verses: chapterVerseText,
    };
  }, [book, chapter, packageId, chapterVerseText]);

  const displayChapterVerseText = useMemo<Map<number, string>>(() => {
    if (chapterVerseText.size > 0) return chapterVerseText;
    const previous = lastLoadedChapterVerseTextRef.current;
    const translationPending = pendingTranslationViewportRef.current?.packageId === packageId && !chapterError;
    if (translationPending && previous?.book === book && previous.chapter === chapter) {
      return previous.verses;
    }
    return chapterVerseText;
  }, [book, chapter, packageId, chapterError, chapterVerseText]);

  // Results are chapter-scoped. Suppress the previous chapter immediately
  // when navigation changes context; an interrupted or failed query must
  // never leave old authored connections clickable in Living Margin.
  const visibleMarginData = marginDataChapterKey === `${sessionOwnerTabId}:${book}:${chapter}`
    ? marginData
    : EMPTY_MARGIN_DATA;
  const visibleConnectionById = useMemo<ReadonlyMap<string, ConnectionRecord>>(
    () => new Map(visibleMarginData.connections.map((connection) => [connection.id, connection])),
    [visibleMarginData.connections],
  );
  visibleConnectionByIdRef.current = visibleConnectionById;

  // Highlight character offsets are translation-specific. queryRange returns
  // every package for the canonical verse range, but all rendering, selection,
  // recolor, removal, and ambient-annotation logic must operate on only the
  // active text package. Whole-verse records stay package-scoped too so a
  // later phrase edit cannot accidentally merge cross-translation entities.
  const packageHighlights = useMemo(
    () => scopeHighlightsToPackage(visibleMarginData.highlights, packageId),
    [packageId, visibleMarginData.highlights],
  );

  // Highlight records, with char_start/char_end normalized to `null` (the
  // "unbounded" sentinel whole-verse highlights already use) whenever a
  // char-scoped record actually reaches its verse's true start (0) or end
  // (the verse's full text length). This isn't cosmetic: the blob-adjacency
  // logic (highlightAdjacency.ts) looks for that null sentinel specifically
  // to decide whether a highlight bridges into an adjacent same-color verse.
  // New phrase selections are already normalized at creation time
  // (rangeToVerseCharOffsets), but highlights created before that fix shipped
  // — or restored from an older snapshot — still have a literal number
  // (e.g. char_end: 78 where the verse is exactly 78 characters) instead of
  // null, which would otherwise silently fail to bridge even though there's
  // no actual gap of unhighlighted text. Normalizing here, at the one shared
  // read point every adjacency-sensitive consumer (the renderer, and the
  // recolor/remove blob-extent walk) draws from, fixes old data too, with no
  // migration step.
  const normalizedHighlights = useMemo<HighlightRecord[]>(() => {
    if (chapterVerseText.size === 0) return packageHighlights;
    return packageHighlights.map((h) => {
      if (h.char_start == null && h.char_end == null) return h;
      const endText = chapterVerseText.get(h.verse_end);
      const charStart = h.char_start === 0 ? null : h.char_start;
      const charEnd = h.char_end != null && endText != null && h.char_end >= endText.length ? null : h.char_end;
      if (charStart === h.char_start && charEnd === h.char_end) return h;
      return { ...h, char_start: charStart, char_end: charEnd };
    });
  }, [packageHighlights, chapterVerseText]);

  // Notes and anchors use canonical scripture coordinates and remain shared
  // across translations. Only the highlight collection is package-specific.
  // Passing this scoped view to Living Margin keeps its counts, swatches, and
  // remove/recolor actions aligned with the layer visible on the page.
  const packageMarginData = useMemo<QueryResult>(() => ({
    ...visibleMarginData,
    highlights: normalizedHighlights,
  }), [normalizedHighlights, visibleMarginData]);

  /**
   * Verses this reader has written a note against — the gutter's "has your
   * note" state, said with a 4px dot and nothing else.
   *
   * The predicate is the Living Margin's own (findNoteForRange): an anchor in
   * this chapter whose span covers the verse, AND a note record actually
   * present for it. Anchors alone would let a dangling anchor claim a note the
   * reader cannot open.
   */
  const versesWithNotes = useMemo<ReadonlySet<number>>(() => {
    const noteIds = new Set(visibleMarginData.notes.map((note) => note.id));
    const verses = new Set<number>();
    for (const anchor of visibleMarginData.anchors) {
      if (anchor.chapter !== chapter || !noteIds.has(anchor.note_id)) continue;
      for (let verse = anchor.verse_start; verse <= anchor.verse_end; verse += 1) verses.add(verse);
    }
    return verses;
  }, [chapter, visibleMarginData.anchors, visibleMarginData.notes]);

  /**
   * True while this chapter's apparatus — notes, anchors, highlights,
   * connections — is still in flight. The chapter text and the apparatus are
   * two separate queries fired from two separate effects, and the text
   * routinely lands first, so there is a real window in which a rendered verse
   * cannot yet say whether it carries a note.
   *
   * The gutter says so: a 14px seal rule where the number goes. The CSS holds
   * it back for 260ms so the usual sub-frame gap never blinks.
   */
  const apparatusLoading = marginDataChapterKey !== `${sessionOwnerTabId}:${book}:${chapter}`;

  const selectedConnection = useMemo(() => {
    if (connectionCardRecovery) {
      const commandConnection = connectionCardRecovery.kind === "update"
        ? connectionCardRecovery.command.next
        : connectionCardRecovery.command.connection;
      const visible = visibleMarginData.connections.find((connection) => connection.id === commandConnection.id);
      if (!visible) return connectionCardRecovery.visibleConnection;
      if (connectionCardRecovery.kind === "delete") return visible;
      const visibleVersion = connectionRecordVersion(visible);
      // Keep an unconfirmed draft visible while the read model still exposes
      // its exact base. A genuinely newer query version always wins.
      return visibleVersion === connectionCardRecovery.command.expectedBaseEventId
        ? connectionCardRecovery.command.next
        : visible;
    }
    return visibleMarginData.connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  }, [connectionCardRecovery, selectedConnectionId, visibleMarginData.connections]);
  const visibleHeldConnectionIds = useMemo(() => {
    const available = new Set(visibleMarginData.connections.map((connection) => connection.id));
    return heldConnectionIds.filter((connectionId) => available.has(connectionId));
  }, [heldConnectionIds, visibleMarginData.connections]);

  const connectionPaintRequestKey = useMemo(() => JSON.stringify([
    sessionOwnerTabId,
    book,
    chapter,
    packageId,
    ...visibleMarginData.connections.map((connection) => [connection.id, connection.activeEventId]),
  ]), [book, chapter, packageId, sessionOwnerTabId, visibleMarginData.connections]);
  const currentConnectionPaintProjections = connectionPaintState?.requestKey === connectionPaintRequestKey
    ? connectionPaintState.projections
    : EMPTY_CONNECTION_PAINT_PROJECTIONS;

  useEffect(() => {
    const requestKey = connectionPaintRequestKey;
    const connectionRequests = visibleMarginData.connections.map((connection) => ({
      connectionId: connection.id,
      expectedActiveEventId: connection.activeEventId,
    }));
    const expectedVersions = new Map(
      connectionRequests.map((request) => [request.connectionId, request.expectedActiveEventId]),
    );
    const request = ++connectionPaintRequestRef.current;
    if (connectionRequests.length === 0) {
      setConnectionPaintState({ requestKey, projections: EMPTY_CONNECTION_PAINT_PROJECTIONS });
      return;
    }
    let cancelled = false;
    void safeCall(() => window.api.library.projectConnections(packageId, connectionRequests)).then((result) => {
      if (
        cancelled
        || request !== connectionPaintRequestRef.current
      ) return;
      if (!result.ok || !result.value.ok || result.value.packageId !== packageId) {
        setConnectionPaintState({ requestKey, projections: EMPTY_CONNECTION_PAINT_PROJECTIONS });
        return;
      }
      const projections = new Map<string, ConnectionPaintProjection>();
      for (const projection of result.value.projections) {
        const expectedVersion = expectedVersions.get(projection.connectionId);
        if (!expectedVersion) continue;
        if (projection.status !== "unavailable" && projection.sourceActiveEventId !== expectedVersion) {
          projections.set(projection.connectionId, {
            ...projection,
            status: "unavailable",
            anchors: [],
            error: {
              code: "connection-version-mismatch",
              message: "The connection changed while its wording was being resolved.",
            },
          });
          continue;
        }
        projections.set(projection.connectionId, projection);
      }
      setConnectionPaintState({ requestKey, projections });
    });
    return () => {
      cancelled = true;
    };
  }, [connectionPaintRequestKey, packageId, visibleMarginData.connections]);

  // Verse numbers whose highlight coverage reaches both sides of a verse
  // boundary — backs the "cont-below"/"cont-above" row classes
  // below, which collapse the visual gap between two consecutive verse rows.
  // This MUST use the same char-aware isAdjacent predicate the SVG underlay
  // uses, not a plain "do these two verses happen to show the same color"
  // check: two same-color highlights can be genuinely separate blobs (e.g. a
  // whole verse followed by a next-verse phrase that doesn't start at char
  // 0), and collapsing the row gap between them would visually press two
  // distinct, separately-rounded shapes together — the same class of bug the
  // isAdjacent fix above was for, one layer up in the CSS.
  /**
   * The pericope folds for this chapter, keyed by the verse each one opens.
   *
   * A pericope is a fold, not a heading — it marks where the editors judged
   * one unit of thought to end and the next to begin. Four things get filtered
   * out, each for its own reason:
   *
   * - `beforeVerse === 1` is a chapter-opening title, not an internal break.
   *   A fold there would collide with the chapter head above it.
   * - `acrostic` is a Hebrew letter glyph, not a title. In Psalm 119 every
   *   stanza emits both the letter and its transliteration at the same verse,
   *   so admitting them would stack duplicate folds down the whole psalm.
   * - `description` is a psalm superscription and belongs to the text.
   * - `major-section` is a book-level division, above this scale entirely.
   *
   * Where a level-1 and a level-2 heading land on the same verse (Genesis 1
   * nests "The First Day" under "The Creation"), the shallower one wins: one
   * fold per break, because the mark says "a seam is here", not how deep it is.
   */
  const pericopeFolds = useMemo<Map<number, string>>(() => {
    const folds = new Map<number, { level: number; text: string }>();
    for (const heading of chapterData?.headings ?? []) {
      if (heading.kind !== "section" || heading.beforeVerse <= 1) continue;
      const existing = folds.get(heading.beforeVerse);
      if (existing && existing.level <= heading.level) continue;
      folds.set(heading.beforeVerse, { level: heading.level, text: heading.text });
    }
    return new Map([...folds].map(([verse, fold]) => [verse, fold.text]));
  }, [chapterData]);

  const verseBridges = useMemo<Set<number>>(() => {
    const bridges = new Set<number>();
    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    const segments = buildSegments(activeHere);
    for (const a of segments) {
      for (const b of segments) {
        if (b.verse === a.verse + 1 && isAdjacent(a, b)) {
          bridges.add(a.verse);
        }
      }
    }
    return bridges;
  }, [normalizedHighlights, book, chapter]);

  // The book+chapter actually on screen right now, kept in sync every
  // render. reloadMarginHighlights (fired from highlight create/delete/undo)
  // reads this to detect when its own fetch has become stale — e.g. the user
  // navigated to a different chapter while a highlight action's confirmation
  // fetch, or the delete fade-out's 320ms delay, was still in flight. Without
  // this check, that late response would silently overwrite the correctly-
  // loaded data for whatever chapter is actually showing with old data for
  // wherever the user used to be.
  const currentChapterKeyRef = useRef(`${sessionOwnerTabId}:${book}:${chapter}`);
  const currentMarkingContextKeyRef = useRef(`${sessionOwnerTabId}:${book}:${chapter}:${packageId}`);
  currentChapterKeyRef.current = `${sessionOwnerTabId}:${book}:${chapter}`;
  currentMarkingContextKeyRef.current = `${sessionOwnerTabId}:${book}:${chapter}:${packageId}`;

  // Load chapter text
  useEffect(() => {
    let cancelled = false;
    const loadKey = `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`;
    loadedChapterKeyRef.current = null;
    failedChapterKeyRef.current = null;
    setChapterData(null);
    setChapterError(null);
    safeCall(() => window.api.scripture.getChapterText(packageId, book, chapter)).then((res) => {
      if (cancelled) return;
      if (res.ok && res.value) {
        loadedChapterKeyRef.current = loadKey;
        setChapterData(res.value);
      } else {
        failedChapterKeyRef.current = loadKey;
        setChapterError(
          res.ok
            ? "This installed Bible text does not include the requested chapter."
            : res.error,
        );
      }
    });
    return () => { cancelled = true; };
  }, [book, chapter, packageId, retryToken, sessionOwnerTabId]);

  // Translation text reflows, so preserving raw scrollTop alone is not
  // enough. Restore the verse nearest the reading eye-line to the exact same
  // visual offset after the new package has rendered. useLayoutEffect keeps
  // the temporary loading collapse from flashing the chapter start.
  useLayoutEffect(() => {
    const pending = pendingTranslationViewportRef.current;
    const root = contentRef.current;
    if (!pending || pending.packageId !== packageId || !chapterData || !root) return;
    restoreReadingViewport(pending);
    pendingTranslationViewportRef.current = null;
  }, [chapterData, packageId, restoreReadingViewport]);

  useLayoutEffect(() => {
    const target = savedViewportTarget;
    if (!target || !chapterData || !contentRef.current) return;
    if (target.book !== book || target.chapter !== chapter || target.packageId !== packageId) return;
    if (loadedChapterKeyRef.current !== `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`) return;
    restoreReadingViewport(target);
    setSavedViewportTarget((current) => (
      current?.requestId === target.requestId ? null : current
    ));
  }, [book, chapter, chapterData, packageId, restoreReadingViewport, savedViewportTarget, sessionOwnerTabId]);

  useLayoutEffect(() => {
    const pending = pendingPassageRestoreRef.current;
    if (!pending || !chapterData) return;
    if (pending.ownerTabId !== sessionOwnerTabId) return;
    if (
      pending.entry.book !== book
      || pending.entry.chapter !== chapter
      || pending.entry.packageId !== packageId
      || loadedChapterKeyRef.current !== `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`
    ) return;
    pendingPassageRestoreRef.current = null;
  }, [book, chapter, chapterData, packageId, sessionOwnerTabId]);

  // A verse reference is both a canonical selection and a reading-location
  // request. Selection can be committed before a new chapter's text exists,
  // so wait for the exact requested chapter to render, then place its first
  // selected verse near the same 28% eye-line used by ambient reading. This
  // also handles a reference within the chapter already on screen. Focus
  // deliberately stays on the invoking reference in the Living Margin.
  useLayoutEffect(() => {
    const target = referenceViewportTarget;
    const root = contentRef.current;
    if (!target || !root || !chapterData) return;
    if (target.book !== book || target.chapter !== chapter) return;
    if (loadedChapterKeyRef.current !== `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`) return;

    const row = verseRowRefs.current.get(target.verse);
    if (!row) return;
    const rootRect = root.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const readingEyeLine = rootRect.height * 0.28;
    root.scrollTop = Math.max(0, root.scrollTop + rowRect.top - rootRect.top - readingEyeLine);
    setScrolled(root.scrollTop > 0);
    setReferenceViewportTarget((current) => (
      current?.requestId === target.requestId ? null : current
    ));
  }, [book, chapter, chapterData, packageId, referenceViewportTarget, sessionOwnerTabId]);

  // Phase 1: Load deterministic margin data (fast)
  useEffect(() => {
    let cancelled = false;
    const requestSequence = ++marginRequestSequenceRef.current;
    const requestChapterKey = `${sessionOwnerTabId}:${book}:${chapter}`;
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) {
      setMarginData(EMPTY_MARGIN_DATA);
      setMarginDataChapterKey(requestChapterKey);
      setCrossRefs(null);
      return () => {
        cancelled = true;
      };
    }

    // Keep verse highlight classes current even when the Living Margin is hidden.
    safeCall(() => window.api.library.queryRange(book, chapter, 1, book, chapter, verseCount)).then((res) => {
      if (
        !cancelled
        && requestSequence === marginRequestSequenceRef.current
        && res.ok
      ) {
        setMarginData(res.value);
        setMarginDataChapterKey(requestChapterKey);
      }
    });

    if (!marginVisible) {
      setCrossRefs(null);
      return () => {
        cancelled = true;
      };
    }

    return () => {
      cancelled = true;
    };
  }, [book, chapter, backbone, marginVisible, sessionOwnerTabId]);

  // Phase 2: Load semantic margin (slow, non-blocking)
  useEffect(() => {
    let cancelled = false;
    if (!marginVisible) {
      setSemanticLoading(false);
      setSemanticData(null);
      return () => {
        cancelled = true;
      };
    }

    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0 || !chapterData) return () => { cancelled = true; };

    setSemanticData(null);
    const passageText = chapterData.verses.map((v) => v.text).join(" ");
    if (!passageText) {
      setSemanticLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSemanticLoading(true);
      safeCall(() => window.api.ai.semanticMargin({
        book,
        startChapter: chapter,
        startVerse: 1,
        endChapter: chapter,
        endVerse: verseCount,
        passageText,
      })).then((res) => {
        if (cancelled) return;
        setSemanticData(res.ok ? res.value : null);
        setSemanticLoading(false);
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [book, chapter, backbone, chapterData, marginVisible, sessionOwnerTabId]);

  // Notify the host shell whenever the AI-busy state changes (drives the
  // sidebar footer's "Analyzing passage..." indicator).
  useEffect(() => {
    onAiBusyChange?.(semanticLoading);
  }, [semanticLoading, onAiBusyChange]);

  const bookData = backbone.books[book];
  const chapterCount = bookData?.chapters.length ?? 0;
  const displayBookName = bookNames[book]?.[0] ?? book;

  // Load recents once. The active V2 workspace session is the sole restore
  // authority; lastRead is only a write mirror for older integrations and
  // must never overwrite a controlled tab owner.
  useEffect(() => {
    let cancelled = false;
    safeCall(() => window.api.settings.get()).then((res) => {
      if (cancelled || !res.ok) return;
      setRecents(normalizeRecents(res.value.recentPassages));
      recentsLoaded.current = true;
      lastReadLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist recents after the initial load (never write empty defaults over disk).
  useEffect(() => {
    if (!recentsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ recentPassages: recents }));
  }, [recents]);

  const recordRecent = useCallback(
    (b: string, c: number, verse?: number, pkg: string = packageId) => {
      setRecents((prev) =>
        pushRecent(prev, {
          book: b,
          chapter: c,
          verse,
          packageId: pkg,
          visitedAt: Date.now(),
        }),
      );
    },
    [packageId],
  );

  const captureMarginScope = useCallback((): NavigationMarginScope => {
    if (phraseSelection) {
      return { kind: "selection", start: phraseSelection.verseStart, end: phraseSelection.verseEnd };
    }
    const selected = [...selectedVerses].sort((left, right) => left - right);
    if (selected.length > 0) return { kind: "selection", start: selected[0]!, end: selected.at(-1)! };
    return keptContext ? { kind: "kept", ...keptContext } : null;
  }, [keptContext, phraseSelection, selectedVerses]);

  const captureNavigationEntry = useCallback((): PassageViewState => {
    const loadedKey = `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`;
    if (loadedChapterKeyRef.current !== loadedKey) {
      return sessionEntryRef.current;
    }
    const viewport = captureReadingViewport();
    const selection = phraseSelection
      ? {
          packageId,
          pieces: Array.from(
            { length: phraseSelection.verseEnd - phraseSelection.verseStart + 1 },
            (_, index) => {
              const verse = phraseSelection.verseStart + index;
              return {
                verse,
                charStart: verse === phraseSelection.verseStart ? phraseSelection.charStart : null,
                charEnd: verse === phraseSelection.verseEnd ? phraseSelection.charEnd : null,
              };
            },
          ),
        }
      : undefined;
    return {
      book,
      chapter,
      packageId,
      ...(viewport?.verse != null ? { verse: viewport.verse, verseOffset: viewport.verseOffset } : {}),
      ...(viewport ? { scrollTop: viewport.scrollTop } : {}),
      ...(selection ? { selection } : {}),
      margin: {
        ...sessionEntryRef.current.margin,
        activeTab: marginTab,
        scope: captureMarginScope(),
        scrollTopByTab: { ...sessionEntryRef.current.margin.scrollTopByTab },
      },
    };
  }, [book, captureMarginScope, captureReadingViewport, chapter, marginTab, packageId, phraseSelection, sessionOwnerTabId]);

  const captureCurrentStudyCanvasRef = useRef<() => StudyCanvasCapture | null>(() => null);
  captureCurrentStudyCanvasRef.current = () => {
    if (restoredSessionOwnerTabId !== sessionOwnerTabId) return null;
    if (book !== sessionEntry.book || chapter !== sessionEntry.chapter || packageId !== sessionEntry.packageId) {
      return null;
    }
    const chapterKey = `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`;
    if (chapterError && failedChapterKeyRef.current === chapterKey) {
      return { ownerTabId: sessionOwnerTabId, entry: sessionEntryRef.current };
    }
    if (!chapterData || loadedChapterKeyRef.current !== chapterKey) return null;
    return { ownerTabId: sessionOwnerTabId, entry: captureNavigationEntry() };
  };
  const handleLivingMarginScrollControllerChange = useCallback((
    ownerTabId: string,
    controller: LivingMarginScrollController | null,
  ): void => {
    if (ownerTabId !== sessionOwnerTabIdRef.current) return;
    if (controller === null) {
      if (livingMarginScrollControllerRef.current?.ownerTabId === ownerTabId) {
        livingMarginScrollControllerRef.current = null;
      }
      return;
    }
    livingMarginScrollControllerRef.current = controller;
  }, []);
  const studyCanvasController = useMemo<StudyCanvasController>(() => ({
    flushPendingMarginScroll: () => livingMarginScrollControllerRef.current?.flushPendingScroll(),
    captureCurrent: () => captureCurrentStudyCanvasRef.current(),
  }), []);
  useEffect(() => {
    onStudyCanvasControllerChange?.(studyCanvasController);
    return () => onStudyCanvasControllerChange?.(null);
  }, [onStudyCanvasControllerChange, studyCanvasController]);

  const commitNavigationHistory = useCallback((
    next: NavigationHistoryState<PassageViewState>,
  ): void => {
    if (sessionOwnerTabIdRef.current !== sessionOwnerTabId) return;
    navigationHistoryRef.current = next;
    onNavigationHistoryChange(sessionOwnerTabId, next);
  }, [onNavigationHistoryChange, sessionOwnerTabId]);

  // Atomic navigation: the durable target snapshot is prepared before the
  // canvas coordinates change. Chapter/package reset effects then restore
  // that exact snapshot instead of reconstructing it from a coarse verse
  // range. This is what lets Back/Forward recover phrase offsets and every
  // controlled Study field while ordinary navigation starts a fresh subject.
  const goTo = useCallback(
    async (b: string, c: number, verse?: number, opts?: GoToOptions): Promise<boolean> => {
      const requestedOwnerTabId = sessionOwnerTabId;
      const targetPackageId = opts?.restoreEntry?.packageId ?? opts?.packageId ?? packageId;
      let navigationCommitted = false;
      const performNavigation = (): void => {
        if (sessionOwnerTabIdRef.current !== requestedOwnerTabId) return;
        let currentEntry: PassageViewState;
        if (opts?.historyMode === "traverse") {
          currentEntry = captureNavigationEntry();
          if (opts.history) commitNavigationHistory(opts.history);
        } else {
          commitNavigationHistory(pushNavigationHistory(
            navigationHistoryRef.current,
            currentEntry = captureNavigationEntry(),
          ));
        }
        const targetEntry = opts?.restoreEntry ?? freshPassageNavigationEntry(currentEntry, {
          book: b,
          chapter: c,
          packageId: targetPackageId,
          ...(verse != null ? { verse } : {}),
          ...(opts?.rangeEnd != null ? { rangeEnd: opts.rangeEnd } : {}),
        });
        navigationCommitted = true;
        userNavigatedRef.current = true;
        const changesRenderedText = targetEntry.book !== book
          || targetEntry.chapter !== chapter
          || targetEntry.packageId !== packageId;
        pendingPassageRestoreRef.current = changesRenderedText
          ? { ownerTabId: requestedOwnerTabId, entry: targetEntry }
          : null;
        sessionEntryRef.current = targetEntry;
        onSessionEntryChange(requestedOwnerTabId, targetEntry);
        setSessionRestoreNonce((current) => current + 1);
        setMarginTab(targetEntry.margin.activeTab);
        applyPassageSelectionRestore(targetEntry);
        const restoredScope = opts?.restoreEntry?.margin.scope;
        if (restoredScope?.kind === "kept") {
          onKeptContextChange?.({
            book: restoredScope.book,
            chapter: restoredScope.chapter,
            verse: restoredScope.verse,
            ...(restoredScope.endVerse != null ? { endVerse: restoredScope.endVerse } : {}),
            ...(restoredScope.label ? { label: restoredScope.label } : {}),
          });
        }
        setSavedViewportTarget(opts?.restoreEntry ? {
          book: targetEntry.book,
          chapter: targetEntry.chapter,
          packageId: targetEntry.packageId,
          verse: targetEntry.verse ?? null,
          verseOffset: targetEntry.verseOffset ?? 0,
          scrollTop: targetEntry.scrollTop ?? 0,
          requestId: ++savedViewportRequestRef.current,
        } : null);
        if (targetPackageId !== packageId) {
          setChapterData(null);
          setChapterError(null);
          setShowHighlightPalette(false);
          setPackageId(targetPackageId);
        }
        if (opts?.focusHeading) shouldFocusChapterHeading.current = true;
        if (opts?.restoreEntry) {
          setReferenceViewportTarget(null);
        } else {
          setReferenceViewportTarget(verse == null
            ? null
            : {
                book: b,
                chapter: c,
                verse,
                requestId: ++referenceViewportRequestRef.current,
              });
        }
        setBook(b);
        setChapter(c);
        setShowHighlightPalette(false);
        if (opts?.recordRecent !== false) {
          recordRecent(b, c, verse, targetPackageId);
        }
      };
      const changesTranslation = targetPackageId !== packageId;
      const changesChapter = b !== book || c !== chapter;
      if (changesTranslation || changesChapter) {
        if (opts?.preapproved) {
          performNavigation();
          return navigationCommitted;
        }
        const approved = await requestWorkspaceTransition(
          changesTranslation ? "translation-change" : "chapter-change",
          performNavigation,
        );
        return approved && navigationCommitted;
      }
      if (!changesTranslation && !changesChapter && !opts?.preapproved && !requireSafeConnectionNavigation()) return false;
      performNavigation();
      return navigationCommitted;
    },
    [applyPassageSelectionRestore, book, captureNavigationEntry, chapter, commitNavigationHistory, onKeptContextChange, onSessionEntryChange, packageId, recordRecent, requestWorkspaceTransition, requireSafeConnectionNavigation, sessionOwnerTabId],
  );

  const openPassageTab = useCallback(async (
    target: {
      book: string;
      chapter: number;
      verse?: number;
      endVerse?: number;
      packageId?: string;
    },
    source: "chapter-step" | "passage-picker" | "verse-peek",
    options?: VersePeekOpenOptions,
  ): Promise<boolean> => {
    if (!onOpenPassageTab) return false;
    try {
      return await onOpenPassageTab({
        ...target,
        packageId: target.packageId ?? packageId,
      }, { source, focusDestination: options?.focusDestination });
    } catch {
      return false;
    }
  }, [onOpenPassageTab, packageId]);

  const navigateBack = useCallback((): void => {
    const move = backNavigationHistory(navigationHistoryRef.current, captureNavigationEntry());
    if (!move.target) return;
    void goTo(move.target.book, move.target.chapter, undefined, {
      historyMode: "traverse",
      history: move.history,
      recordRecent: false,
      restoreEntry: move.target,
    });
  }, [captureNavigationEntry, goTo]);

  const navigateForward = useCallback((): void => {
    const move = forwardNavigationHistory(navigationHistoryRef.current, captureNavigationEntry());
    if (!move.target) return;
    void goTo(move.target.book, move.target.chapter, undefined, {
      historyMode: "traverse",
      history: move.history,
      recordRecent: false,
      restoreEntry: move.target,
    });
  }, [captureNavigationEntry, goTo]);

  useEffect(() => {
    if (!navigateRef) return;
    if (navigateRef.ownerTabId !== sessionOwnerTabId) {
      onNavigateRefConsumed?.();
      return;
    }
    void goTo(navigateRef.book, navigateRef.chapter, navigateRef.verse, {
      rangeEnd: navigateRef.endVerse,
      preapproved: navigateRef.preapproved,
    }).then((proceed) => {
      if (proceed) onNavigateRefConsumed?.();
    });
    // A navigation request is an edge-triggered object from App. Depending on
    // goTo here would replay that old request after an internal chapter turn,
    // because goTo intentionally changes with the current book/chapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateRef, sessionOwnerTabId]);

  const publishSessionEntry = useCallback((): PassageViewState | null => {
    if (!chapterData || loadedChapterKeyRef.current !== `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`) return null;
    if (restoredSessionOwnerTabId !== sessionOwnerTabId) return null;
    const entry = captureNavigationEntry();
    sessionEntryRef.current = entry;
    onSessionEntryChange(sessionOwnerTabId, entry);
    return entry;
  }, [book, captureNavigationEntry, chapter, chapterData, onSessionEntryChange, packageId, restoredSessionOwnerTabId, sessionOwnerTabId]);

  const publishMarginSessionChange = useCallback((
    ownerTabId: string,
    update: (current: PassageViewState["margin"]) => PassageViewState["margin"],
  ): void => {
    if (ownerTabId !== sessionOwnerTabId || restoredSessionOwnerTabId !== sessionOwnerTabId) return;
    const currentEntry = loadedChapterKeyRef.current === `${sessionOwnerTabId}:${packageId}:${book}:${chapter}`
      ? captureNavigationEntry()
      : sessionEntryRef.current;
    const nextEntry: PassageViewState = {
      ...currentEntry,
      margin: update(currentEntry.margin),
    };
    sessionEntryRef.current = nextEntry;
    setMarginTab(nextEntry.margin.activeTab);
    onSessionEntryChange(ownerTabId, nextEntry);
  }, [book, captureNavigationEntry, chapter, onSessionEntryChange, packageId, restoredSessionOwnerTabId, sessionOwnerTabId]);

  const persistCurrentReadingPosition = useCallback((): void => {
    const entry = publishSessionEntry();
    if (!entry || !lastReadLoaded.current) return;
    void safeCall(() => window.api.settings.set({
      lastRead: {
        book: entry.book,
        chapter: entry.chapter,
        packageId: entry.packageId,
        ...(entry.verse != null && entry.verseOffset != null
          ? { verse: entry.verse, verseOffset: entry.verseOffset }
          : {}),
      },
    }));
  }, [publishSessionEntry]);
  const persistCurrentReadingPositionRef = useRef(persistCurrentReadingPosition);
  useEffect(() => {
    persistCurrentReadingPositionRef.current = persistCurrentReadingPosition;
  }, [persistCurrentReadingPosition]);

  useEffect(() => {
    if (!chapterData || savedViewportTarget || referenceViewportTarget) return;
    const timer = window.setTimeout(persistCurrentReadingPosition, 0);
    return () => window.clearTimeout(timer);
  }, [chapterData, persistCurrentReadingPosition, referenceViewportTarget, savedViewportTarget]);

  useEffect(() => {
    publishSessionEntry();
  }, [marginTab, phraseSelection, publishSessionEntry, selectedVerses]);

  useEffect(() => {
    if (!onReadingContextChange) return;
    const selected = [...selectedVerses].sort((left, right) => left - right);
    onReadingContextChange({
      book,
      chapter,
      chapterEndVerse: backbone.books[book]?.chapters[chapter - 1],
      packageId,
      verseStart: selected[0],
      verseEnd: selected.at(-1),
    });
  }, [book, chapter, onReadingContextChange, packageId, selectedVerses]);

  // Cross-reference click-through. Canonical bref targets preserve same-
  // chapter destination ranges as a pinned selection; note-derived display
  // strings retain the existing passage-parser fallback.
  const handleNavigateToRef = useCallback((ref: string) => {
    const canonical = /^bref:v1\/([1-3A-Z]{3})\.(\d+)\.(\d+)(?:-([1-3A-Z]{3})\.(\d+)\.(\d+))?$/.exec(ref);
    if (canonical) {
      const [, startBook, startChapterText, startVerseText, endBook, endChapterText, endVerseText] = canonical;
      const startChapter = Number(startChapterText);
      const startVerse = Number(startVerseText);
      const sameChapterRangeEnd = endBook === startBook && Number(endChapterText) === startChapter
        ? Number(endVerseText)
        : undefined;
      void goTo(startBook!, startChapter, startVerse, { rangeEnd: sameChapterRangeEnd });
      return;
    }
    let result = parsePassage(ref, bookNames, backbone);
    if (!result.ok) {
      const stripped = ref.replace(/[-–]\s*\d+\s*$/, "");
      if (stripped !== ref) result = parsePassage(stripped, bookNames, backbone);
    }
    if (!result.ok) return;
    void goTo(result.value.book, result.value.chapter, result.value.verse);
  }, [bookNames, backbone, goTo]);

  // Scroll shadow: add a class to the topbar once the reading column has
  // scrolled past its top, removing it once scrolled back to the top.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let settleTimer = 0;
    const handler = () => {
      setScrolled(el.scrollTop > 0);
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        persistCurrentReadingPositionRef.current();
      }, 220);
    };
    setScrolled(el.scrollTop > 0);
    el.addEventListener("scroll", handler);
    return () => {
      el.removeEventListener("scroll", handler);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [sessionOwnerTabId]);

  // A chapter is a new reading surface, not the continuation of the previous
  // scroll position. Translation changes are deliberately excluded: they
  // restore the current reading anchor in the layout effect above.
  useEffect(() => {
    pendingTranslationViewportRef.current = null;
    if (!savedViewportTarget && contentRef.current) {
      contentRef.current.scrollTop = 0;
      setScrolled(false);
    }
    if (!shouldFocusChapterHeading.current) return;
    shouldFocusChapterHeading.current = false;
    chapterHeadingRef.current?.focus();
  // savedViewportTarget is intentionally read only for the chapter transition
  // that scheduled it; clearing the one-shot target must not reset scroll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter]);

  // Keep the passage-picker's book-browsing view in sync with the current book.
  useEffect(() => {
    setBrowseBook(book);
  }, [book]);

  const closePassagePopover = useCallback(() => {
    passageShouldReturnFocus.current = true;
    setPassageOpen(false);
    setPassageView("chapters");
    setBookQuery("");
  }, []);

  const openChapterStepInTab = useCallback((targetChapter: number): void => {
    void openPassageTab({ book, chapter: targetChapter, packageId }, "chapter-step");
  }, [book, openPassageTab, packageId]);

  const handlePreviousChapterClick = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    if (chapter <= 1) return;
    if (passageTabOpenIntent(event)) {
      event.preventDefault();
      openChapterStepInTab(chapter - 1);
      return;
    }
    void goTo(book, chapter - 1, undefined, { recordRecent: false });
  }, [book, chapter, goTo, openChapterStepInTab]);

  const handleNextChapterClick = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    if (chapter >= chapterCount) return;
    if (passageTabOpenIntent(event)) {
      event.preventDefault();
      openChapterStepInTab(chapter + 1);
      return;
    }
    void goTo(book, chapter + 1, undefined, { recordRecent: false });
  }, [book, chapter, chapterCount, goTo, openChapterStepInTab]);

  const handlePreviousChapterAuxClick = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 1 || chapter <= 1) return;
    event.preventDefault();
    openChapterStepInTab(chapter - 1);
  }, [chapter, openChapterStepInTab]);

  const handleNextChapterAuxClick = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 1 || chapter >= chapterCount) return;
    event.preventDefault();
    openChapterStepInTab(chapter + 1);
  }, [chapter, chapterCount, openChapterStepInTab]);

  const activatePassagePickerTarget = useCallback((
    target: {
      book: string;
      chapter: number;
      verse?: number;
      packageId?: string;
    },
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    if (passageTabOpenIntent(event)) {
      event.preventDefault();
      void openPassageTab(target, "passage-picker").then((opened) => {
        if (opened) closePassagePopover();
      });
      return;
    }
    void goTo(target.book, target.chapter, target.verse, {
      packageId: target.packageId,
    }).then((proceed) => {
      if (proceed) closePassagePopover();
    });
  }, [closePassagePopover, goTo, openPassageTab]);

  useEffect(() => {
    if (passageOpen || !passageShouldReturnFocus.current) return;
    passageShouldReturnFocus.current = false;
    passageBtnRef.current?.focus();
  }, [passageOpen]);

  const openPassagePopover = () => {
    if (passageBtnRef.current) setPassageAnchor(passageBtnRef.current.getBoundingClientRect());
    setPassageView("chapters");
    setBrowseBook(book);
    setPassageOpen(true);
  };

  const openBooksView = () => {
    setPassageView("books");
    setBookQuery("");
  };

  // Autofocus the book search input whenever the books view opens.
  useEffect(() => {
    if (passageOpen && passageView === "books") {
      bookSearchRef.current?.focus();
    }
  }, [passageOpen, passageView]);

  const handleBookPick = (b: string) => {
    // Chosen behavior (Part A): a book click switches back to the chapter
    // grid for that book rather than navigating immediately — see openIssues.
    setBrowseBook(b);
    setPassageView("chapters");
  };

  const closeVersionPopover = useCallback(() => {
    versionShouldReturnFocus.current = true;
    setVersionOpen(false);
  }, []);

  useEffect(() => {
    if (versionOpen || !versionShouldReturnFocus.current) return;
    versionShouldReturnFocus.current = false;
    versionBtnRef.current?.focus();
  }, [versionOpen]);

  const openVersionPopover = () => {
    if (versionBtnRef.current) setVersionAnchor(versionBtnRef.current.getBoundingClientRect());
    setVersionOpen(true);
  };

  const captureTranslationViewport = useCallback((nextPackageId: string): void => {
    const viewport = captureReadingViewport();
    if (!viewport) return;
    pendingTranslationViewportRef.current = { packageId: nextPackageId, ...viewport };
  }, [captureReadingViewport]);

  // Book search: full names, aliases, codes (ACT), compact abbreviations (1co, rev).
  const matchesQuery = (code: string) => {
    const q = bookQuery.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return true;
    if (code.toLowerCase().includes(q)) return true;
    const names = bookNames[code] ?? [];
    for (const name of names) {
      const n = name.toLowerCase();
      if (n.includes(bookQuery.trim().toLowerCase())) return true;
      const compact = n.replace(/[\s.]+/g, "");
      if (compact.includes(q) || compact.startsWith(q)) return true;
      // Leading initials: "1 Corinthians" → "1c", "song of songs" → "sos"
      const initials = n
        .split(/[\s.]+/)
        .filter(Boolean)
        .map((w, i) => (i === 0 && /^\d/.test(w) ? w : w[0] ?? ""))
        .join("");
      if (initials.startsWith(q) || initials === q) return true;
    }
    return false;
  };
  const filteredOt = OT_BOOKS.filter(matchesQuery);
  const filteredNt = NT_BOOKS.filter(matchesQuery);
  const browseBookName = bookNames[browseBook]?.[0] ?? browseBook;

  // Derived pinned whole-verse envelope. Precise phrase selections keep their
  // nearby floating toolbar even when the margin is open, so the margin does
  // not duplicate controls for a character range it cannot display exactly.
  const pinnedRange = useMemo<PinnedRange | null>(() => {
    if (selectedVerses.size === 0) return null;
    const vals = [...selectedVerses];
    return { start: Math.min(...vals), end: Math.max(...vals) };
  }, [selectedVerses]);
  const pinnedRangeRef = useRef(pinnedRange);
  pinnedRangeRef.current = pinnedRange;

  useEffect(() => {
    onPinnedRangeChange?.(pinnedRange);
  }, [pinnedRange, onPinnedRangeChange]);

  useEffect(() => {
    if (!pinnedRange || !keptContext || !onKeptContextChange) return;
    const next = supersedeKeptReference(keptContext, book, chapter);
    if (next !== keptContext) onKeptContextChange(next);
  }, [book, chapter, keptContext, onKeptContextChange, pinnedRange]);

  const canvasChapterEndVerse = backbone.books[book]?.chapters[chapter - 1] ?? 1;
  const marginSubject = useMemo(() => resolveMarginSubject({
    canvasBook: book,
    canvasChapter: chapter,
    canvasChapterEndVerse,
    nearVerse: settledNearVerse,
    selection: pinnedRange,
    // A kept comparison is a Study subject. Entity Research always describes
    // the entity tab's actual independent canvas and immutable provenance.
    kept: activeWorkspaceKind === "entity" ? null : keptContext,
  }), [activeWorkspaceKind, book, canvasChapterEndVerse, chapter, keptContext, settledNearVerse, pinnedRange]);
  const keptSubjectKey = marginSubject.kind === "kept"
    ? `${sessionOwnerTabId}:${packageId}:${marginSubject.book}:${marginSubject.chapter}:${marginSubject.verse}-${marginSubject.endVerse}`
    : null;

  useEffect(() => {
    if (!marginVisible || !keptSubjectKey || marginSubject.kind !== "kept") {
      setKeptSubjectState(null);
      return;
    }
    let cancelled = false;
    setKeptSubjectState(null);
    const { book: subjectBook, chapter: subjectChapter, verse, endVerse } = marginSubject;
    void Promise.all([
      safeCall(() => window.api.library.queryRange(
        subjectBook, subjectChapter, verse, subjectBook, subjectChapter, endVerse,
      )),
      safeCall(() => window.api.scripture.getCrossRefsForPassage(
        subjectBook, subjectChapter, verse, endVerse, packageId,
      )),
      safeCall(() => window.api.scripture.getChapterText(packageId, subjectBook, subjectChapter)),
    ]).then(([marginResult, crossRefResult, textResult]) => {
      if (cancelled) return;
      const textMap = new Map<number, string>();
      if (textResult.ok && textResult.value) {
        for (const item of textResult.value.verses) textMap.set(item.verse, item.text);
      }
      setKeptSubjectState({
        key: keptSubjectKey,
        marginData: marginResult.ok
          ? {
              ...marginResult.value,
              highlights: scopeHighlightsToPackage(marginResult.value.highlights, packageId),
            }
          : EMPTY_MARGIN_DATA,
        crossRefs: crossRefResult.ok ? crossRefResult.value : null,
        chapterVerseText: textMap,
      });
    });
    return () => { cancelled = true; };
  }, [keptSubjectKey, marginSubject, marginVisible, packageId]);

  const resolvedKeptState = keptSubjectState?.key === keptSubjectKey ? keptSubjectState : null;
  const subjectMarginData = marginSubject.kind === "kept"
    ? resolvedKeptState?.marginData ?? EMPTY_MARGIN_DATA
    : packageMarginData;
  const subjectCrossRefs = marginSubject.kind === "kept"
    ? resolvedKeptState?.crossRefs ?? null
    : crossRefs;
  const subjectChapterVerseText = marginSubject.kind === "kept"
    ? resolvedKeptState?.chapterVerseText ?? EMPTY_CHAPTER_VERSE_TEXT
    : chapterVerseText;

  // Cross-references follow the actual reading scope: exact verse when the
  // eye-line is ambient, selected range when pinned, full chapter only for the
  // overview. Passage aggregation and top-N ranking happen in pure core code.
  // Stale-while-revalidate: the previous result stays on screen while the
  // next scope resolves, so reading never flashes a false empty state.
  useEffect(() => {
    setCrossRefs(null);
  }, [book, chapter, packageId, sessionOwnerTabId]);
  useEffect(() => {
    if (!marginVisible) {
      setCrossRefs(null);
      return;
    }
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) {
      setCrossRefs(null);
      return;
    }
    const startVerse = pinnedRange?.start ?? settledNearVerse ?? 1;
    const endVerse = pinnedRange?.end ?? settledNearVerse ?? verseCount;
    let cancelled = false;
    safeCall(() => window.api.scripture.getCrossRefsForPassage(
      book,
      chapter,
      startVerse,
      endVerse,
      packageId,
    )).then((result) => {
      if (!cancelled && result.ok) setCrossRefs(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [backbone, book, chapter, marginVisible, settledNearVerse, packageId, pinnedRange, sessionOwnerTabId]);

  // Reload margin data after highlight changes
  const reloadMarginHighlights = useCallback(async (options?: {
    preserveConnection?: ConnectionRecord;
  }): Promise<MarginReloadOutcome> => {
    const requestSequence = ++marginRequestSequenceRef.current;
    const requestOwnerTabId = sessionOwnerTabId;
    const requestBook = book;
    const requestChapter = chapter;
    const verseCount = backbone.books[requestBook]?.chapters[requestChapter - 1] ?? 0;
    if (verseCount === 0) return { status: "failed" };
    const res = await safeCall(() =>
      window.api.library.queryRange(requestBook, requestChapter, 1, requestBook, requestChapter, verseCount),
    );
    // The user may have navigated to a different chapter while this fetch
    // was in flight (this function is called from highlight create/delete/
    // undo handlers, including from a 320ms-delayed timeout for the delete
    // fade-out and from undo toasts that can be clicked long after
    // navigating away) — bail rather than clobber the current chapter's
    // already-correct data with a stale response for the one we left.
    if (
      currentChapterKeyRef.current !== `${requestOwnerTabId}:${requestBook}:${requestChapter}`
      || requestSequence !== marginRequestSequenceRef.current
    ) return { status: "superseded" };
    if (!res.ok) return { status: "failed" };
    const nextValue = options?.preserveConnection
      ? {
          ...res.value,
          connections: reconcileCreatedConnection(
            res.value.connections,
            options.preserveConnection,
          ),
        }
      : res.value;
    setMarginData((prev) => {
      // Skip the update — and the fresh-object identity churn it would
      // otherwise cause on every consumer keyed on marginData.highlights,
      // notably the highlight underlay's re-measure — when the refetched
      // data is identical to what's already showing. This fires on every
      // highlight create/delete/undo, often when nothing about this
      // chapter's OTHER highlights actually changed.
      if (JSON.stringify(prev) === JSON.stringify(nextValue)) return prev;
      return nextValue;
    });
    setMarginDataChapterKey(`${requestOwnerTabId}:${requestBook}:${requestChapter}`);
    return { status: "applied", value: nextValue };
  }, [book, chapter, backbone, sessionOwnerTabId]);

  // Click-outside to dismiss palette.
  // CRITICAL: clicks inside the Living Margin are language-study interactions
  // (lemma chips, form/STEP expand). Treating them as "outside" used to clear
  // the verse pin → ambient eye-line retook the margin (often Acts 19:10) and
  // felt like a click-off. Margin clicks only hide the floating toolbar.
  useEffect(() => {
    if (!showHighlightPalette) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const el = target instanceof Element ? target : target.parentElement;
      if (el?.closest(".marking-floating-host, .marking-dock-host")) return;
      // The version picker changes how this same canonical selection is
      // rendered; opening or choosing from it must not behave like clicking
      // away from the selection. Its panel is portaled to document.body, so
      // protect both the trigger group and the floating panel explicitly.
      if (el?.closest(".living-margin, .version-picker-group, .version-picker-popover")) {
        setShowHighlightPalette(false);
        return;
      }

      setShowHighlightPalette(false);
      setSelectedVerses(new Set());
      setPhraseSelection(null);
      verseSelectionAnchorRef.current = null;
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHighlightPalette]);

  // Escape dismisses palette chrome; keeps verse pin so study can continue.
  useEffect(() => {
    if (!showHighlightPalette) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Focus mode has already unmounted this palette chrome. Its retained
      // state is not an active Escape owner; after a selected Shape is
      // dismissed, the next Escape belongs to App's Focus-mode exit.
      if (focusMode) return;
      // Every mounted layer outranks this legacy fallback; it owns Escape
      // only when the shared registry is completely empty.
      if (!layerStackIsEmpty()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setShowHighlightPalette(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusMode, showHighlightPalette]);

  const canvasShortcutBlocked = useCallback((event: KeyboardEvent): boolean => {
    if (event.defaultPrevented) return true;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.matches("input, textarea, select") || target?.isContentEditable) return true;
    if (!layerStackIsEmpty()) return true;
    // Cover the render-to-layer-registration frame for portaled surfaces.
    if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"], .command-palette-root')) return true;
    if (!requireSafeConnectionNavigation()) return true;
    return false;
  }, [requireSafeConnectionNavigation]);

  // Browser-style canvas history yields to editors and modal dialogs.
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented
        || !event.altKey
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      if (document.querySelector('[data-floating-layer="dialog"]')) return;
      if (canvasShortcutBlocked(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft") navigateBack();
      else navigateForward();
    };
    window.addEventListener("keydown", handleHistoryShortcut, true);
    return () => window.removeEventListener("keydown", handleHistoryShortcut, true);
  }, [canvasShortcutBlocked, navigateBack, navigateForward]);

  // Keyboard navigation: prev/next chapter
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const target = e.target instanceof Element ? e.target : null;
      const plainReadingArrow = !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && !e.shiftKey
        && Boolean(target?.closest(".verse-line"));
      const appArrow = e.metaKey || e.ctrlKey;
      if ((plainReadingArrow || appArrow) && e.key === "ArrowLeft") {
        if (canvasShortcutBlocked(e)) return;
        e.preventDefault();
        if (chapter > 1) {
          void goTo(book, chapter - 1, undefined, { recordRecent: false });
        }
      } else if ((plainReadingArrow || appArrow) && e.key === "ArrowRight") {
        if (canvasShortcutBlocked(e)) return;
        e.preventDefault();
        if (chapter < chapterCount) {
          void goTo(book, chapter + 1, undefined, { recordRecent: false });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [book, canvasShortcutBlocked, chapter, chapterCount, goTo]);

  // The marking surfaces are sized against the actual reading stage, not the
  // window. Sidebar collapse, Living Margin, reading measure, and focus mode
  // can all change this rectangle without a viewport resize.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = (): void => {
      const rect = stage.getBoundingClientRect();
      setStageBounds((current) => {
        const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom };
        return current.left === next.left && current.top === next.top && current.width === next.width
          && current.height === next.height && current.bottom === next.bottom ? current : next;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // ── H·2 · horizontal·page — a swipe across the passage moves by chapter ──
  //
  // The page follows the finger while the gesture is live and settles in 180ms
  // when it is let go, so a swipe that does not commit says so by returning the
  // text rather than by doing nothing. The travel is damped and clamped: this
  // is a hint that the page can move, not a carousel.
  const clearPageSwipeTravel = useCallback((settle: boolean): void => {
    const content = contentRef.current;
    if (pageSwipeSettleRef.current != null) {
      window.clearTimeout(pageSwipeSettleRef.current);
      pageSwipeSettleRef.current = null;
    }
    if (!content) return;
    content.style.setProperty("--page-swipe-dx", "0px");
    if (!settle) {
      delete content.dataset.pageSwipe;
      return;
    }
    content.dataset.pageSwipe = "settling";
    pageSwipeSettleRef.current = window.setTimeout(() => {
      pageSwipeSettleRef.current = null;
      const settled = contentRef.current;
      if (settled) delete settled.dataset.pageSwipe;
    }, 180);
  }, []);

  useEffect(() => () => {
    if (pageSwipeSettleRef.current != null) {
      window.clearTimeout(pageSwipeSettleRef.current);
      pageSwipeSettleRef.current = null;
    }
  }, []);

  // A committed swipe is a chapter change like any other, so the page it lands
  // on must not still be carrying the last one's travel.
  useEffect(() => {
    pageSwipeRef.current = null;
    clearPageSwipeTravel(false);
  }, [book, chapter, clearPageSwipeTravel]);

  const handlePagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    lastCanvasPointerTypeRef.current = event.pointerType;
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    if (pageSwipeRef.current) return;
    // A grip drag is tracked on the window rather than through pointer capture,
    // because extending the range re-renders the grip into a different row. So
    // the grip's own element stops seeing the pointer partway through, and a
    // finger that lands on the page while an edge is moving would otherwise
    // start a chapter turn underneath it. The range owns the gesture until it
    // is let go — and a misfired chapter turn loses the reader's place.
    if (verseRangeDragRef.current) return;
    if (event.clientX <= BACK_GESTURE_STRIP) return;
    const target = event.target instanceof Element ? event.target : null;
    // Controls own their own gestures, and the gutter grips own the vertical
    // one. Neither may be read as a page swipe that happened to start on them.
    if (target?.closest("button, a, input, textarea, select, [data-verse-range-grip]")) return;
    // Suspended while a word selection exists.
    if (phraseSelection || !(window.getSelection()?.isCollapsed ?? true)) return;
    pageSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: "undecided",
      follow: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  }, [phraseSelection]);

  const handlePagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (swipe.axis === "undecided") {
      // Vertical wins ties. Scrolling the passage is the commoner intent and
      // the one the platform already owns; this handler never preventDefaults,
      // so a scroll that starts here keeps working exactly as it did.
      if (Math.abs(dy) >= PAGE_SWIPE_AXIS_LOCK && Math.abs(dy) >= Math.abs(dx)) {
        pageSwipeRef.current = null;
        return;
      }
      if (Math.abs(dx) < PAGE_SWIPE_AXIS_LOCK) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        pageSwipeRef.current = null;
        return;
      }
      swipe.axis = "horizontal";
    }
    if (!swipe.follow) return;
    const content = contentRef.current;
    if (!content) return;
    // At the first or last chapter there is nothing that way. The page still
    // answers, with a shorter throw that snaps back — the honest way to say
    // "nothing is over there" without refusing to move at all. Elsewhere the
    // page reaches its full travel exactly as the gesture reaches the distance
    // that would commit it, so the movement itself is the threshold.
    const atEdge = (dx > 0 && chapter <= 1) || (dx < 0 && chapter >= chapterCount);
    const travel = Math.sign(dx) * Math.min(
      Math.abs(dx) * (atEdge ? PAGE_SWIPE_EDGE_RATIO : PAGE_SWIPE_FOLLOW_RATIO),
      atEdge ? PAGE_SWIPE_EDGE_TRAVEL : PAGE_SWIPE_COMMIT_TRAVEL * PAGE_SWIPE_FOLLOW_RATIO,
    );
    content.dataset.pageSwipe = "tracking";
    content.style.setProperty("--page-swipe-dx", `${travel.toFixed(2)}px`);
  }, [chapter, chapterCount]);

  const handlePagePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    pageSwipeRef.current = null;
    clearPageSwipeTravel(swipe.axis === "horizontal");
    if (swipe.axis !== "horizontal") return;
    const dx = event.clientX - swipe.startX;
    if (Math.abs(dx) < PAGE_SWIPE_COMMIT_TRAVEL) return;
    // The gesture may have produced a selection on its way; if it did, the
    // selection owns it.
    if (phraseSelection || !(window.getSelection()?.isCollapsed ?? true)) return;
    if (!requireSafeConnectionNavigation()) return;
    if (dx > 0) {
      if (chapter > 1) void goTo(book, chapter - 1, undefined, { recordRecent: false });
    } else if (chapter < chapterCount) {
      void goTo(book, chapter + 1, undefined, { recordRecent: false });
    }
  }, [book, chapter, chapterCount, clearPageSwipeTravel, goTo, phraseSelection, requireSafeConnectionNavigation]);

  const handlePagePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const swipe = pageSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    pageSwipeRef.current = null;
    clearPageSwipeTravel(true);
  }, [clearPageSwipeTravel]);

  // ── H·2 · vertical·gutter — the mark's two grips extend the verse range ──
  //
  // The indicator becomes the control: no new element appears, the existing
  // 2px seal simply grows a grip at each end of the selected run. The grips
  // start at x = 20 so the OS back-gesture strip keeps the first 20px of the
  // gutter; the mark itself stays at x = 0, read and never grabbed.
  const verseAtClientY = useCallback((clientY: number): number | null => {
    let nearest: { verse: number; distance: number } | null = null;
    for (const [verse, row] of verseRowRefs.current) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return verse;
      const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
      if (!nearest || distance < nearest.distance) nearest = { verse, distance };
    }
    return nearest?.verse ?? null;
  }, []);

  const [verseRangeDragging, setVerseRangeDragging] = useState(false);

  const beginVerseRangeDrag = useCallback((
    edge: "start" | "end",
    event: React.PointerEvent<HTMLSpanElement>,
  ): void => {
    const range = pinnedRangeRef.current;
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    verseRangeDragRef.current = {
      pointerId: event.pointerId,
      fixedVerse: edge === "start" ? range.end : range.start,
    };
    setVerseRangeDragging(true);
  }, []);

  // The gesture is tracked on the window rather than through pointer capture
  // on the grip, because the grip MOVES: extending the range past a verse
  // boundary re-renders it into a different row, and a captured element that
  // unmounts drops the drag halfway.
  useEffect(() => {
    if (!verseRangeDragging) return;
    const extend = (event: PointerEvent): void => {
      const drag = verseRangeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const verse = verseAtClientY(event.clientY);
      if (verse == null) return;
      const first = Math.min(verse, drag.fixedVerse);
      const last = Math.max(verse, drag.fixedVerse);
      verseSelectionAnchorRef.current = drag.fixedVerse;
      setSelectedVerses((current) => {
        const next = new Set<number>();
        for (const item of chapterDataRef.current?.verses ?? []) {
          if (item.verse >= first && item.verse <= last) next.add(item.verse);
        }
        if (next.size === current.size && [...next].every((item) => current.has(item))) return current;
        return next;
      });
    };
    const finish = (event: PointerEvent): void => {
      const drag = verseRangeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      verseRangeDragRef.current = null;
      setVerseRangeDragging(false);
      // One generation per completed gesture: the range moved once, not once
      // per frame, so the marking surfaces see a single settled selection.
      advanceSelectionGeneration();
      onEnsureMarginVisible?.();
    };
    window.addEventListener("pointermove", extend);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", extend);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [advanceSelectionGeneration, onEnsureMarginVisible, verseAtClientY, verseRangeDragging]);

  // Positions the floating highlight palette over the actual selection —
  // not a single clicked row's far edge, which is what this used to key off
  // (a verse row spans nearly the full reading column, so anchoring to its
  // *right* edge routinely put the palette way off to the right of where the
  // user actually clicked, and off-screen entirely on a wide window with the
  // margin closed). This centers over the full selected range and clamps to
  // the viewport, flipping below the selection when there isn't room above.
  // Shared positioner: given a viewport-relative bounding box of whatever the
  // palette should point at (a set of verse rows, or a phrase selection's
  // rects), center over it, clamp to the viewport, and flip below when there
  // isn't room above.
  const positionPaletteForBox = useCallback((
    box: { top: number; bottom: number; left: number; right: number },
  ) => {
    const centerX = (box.left + box.right) / 2;
    // The surface receives source geometry only, and measures its own rendered
    // footprint against the reading stage. A second set of synthetic size
    // estimates here would be a guess competing with a measurement.
    const next = {
      x: centerX,
      y: box.top - 10,
      flipped: false,
      anchorBox: { ...box },
    };
    setPalettePos((current) => {
      const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.1;
      const sameBox = (
        a: { top: number; bottom: number; left: number; right: number },
        b: { top: number; bottom: number; left: number; right: number },
      ): boolean => close(a.top, b.top) && close(a.bottom, b.bottom) && close(a.left, b.left) && close(a.right, b.right);
      return close(current.x, next.x)
        && close(current.y, next.y)
        && current.flipped === next.flipped
        && sameBox(current.anchorBox, next.anchorBox)
        ? current
        : next;
    });
  }, []);

  // Positions the floating highlight palette over the actual selection —
  // not a single clicked row's far edge, which is what this used to key off
  // (a verse row spans nearly the full reading column, so anchoring to its
  // *right* edge routinely put the palette way off to the right of where the
  // user actually clicked, and off-screen entirely on a wide window with the
  // margin closed).
  const positionPalette = useCallback((selection: Set<number>) => {
    const rects = [...selection]
      .map((v) => verseRowRefs.current.get(v))
      .filter((el): el is HTMLDivElement => !!el)
      .map((el) => el.getBoundingClientRect());
    if (rects.length === 0) return;
    positionPaletteForBox({
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
    });
  }, [positionPaletteForBox]);

  // Locate the DOM node + offset for a character offset into a verse span,
  // walking all text nodes (robust to future markup splitting the span).
  const locateCharOffset = useCallback((span: HTMLElement, charOffset: number): { node: Node; offset: number } | null => {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (acc + len >= charOffset) return { node, offset: charOffset - acc };
      acc += len;
      node = walker.nextNode();
    }
    return null;
  }, []);

  // Rebuild a DOM Range for a stored phrase selection (used to reposition its
  // palette on resize, where the original native Range is long gone).
  const buildPhraseRange = useCallback((sel: HighlightRange): Range | null => {
    const startSpan = verseRowRefs.current.get(sel.verseStart)?.querySelector<HTMLElement>(".verse-text-span");
    const endSpan = verseRowRefs.current.get(sel.verseEnd)?.querySelector<HTMLElement>(".verse-text-span");
    if (!startSpan || !endSpan) return null;
    const endTotal = endSpan.textContent?.length ?? 0;
    const s = locateCharOffset(startSpan, sel.charStart ?? 0);
    const e = locateCharOffset(endSpan, sel.charEnd ?? endTotal);
    if (!s || !e) return null;
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return range;
  }, [locateCharOffset]);

  const positionPaletteForRange = useCallback((range: Range) => {
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) return;
    positionPaletteForBox({
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
    });
  }, [positionPaletteForBox]);

  const verseSpanForNode = useCallback((node: Node, container: HTMLElement): HTMLElement | null => {
    let current: Node | null = node;
    while (current && current !== container) {
      if (current instanceof HTMLElement && current.classList.contains("verse-text-span")) return current;
      current = current.parentNode;
    }
    return null;
  }, []);

  const verseNumberForSpan = useCallback((span: HTMLElement): number | null => {
    const value = Number(span.closest<HTMLElement>(".verse-line[data-verse]")?.dataset.verse);
    return Number.isFinite(value) ? value : null;
  }, []);

  // A completed native drag becomes one exact continuous highlight range. The
  // first and last verse retain character offsets; every verse between them is
  // implicitly covered in full by the shared range model.
  const handleTextMouseUp = useCallback(async (): Promise<void> => {
    const ownerContextKey = currentMarkingContextKeyRef.current;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const container = verseTextRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    const startSpan = verseSpanForNode(range.startContainer, container);
    const endSpan = verseSpanForNode(range.endContainer, container);
    if (!startSpan || !endSpan) return;
    const verseStart = verseNumberForSpan(startSpan);
    const verseEnd = verseNumberForSpan(endSpan);
    if (verseStart == null || verseEnd == null || verseEnd < verseStart) return;

    let charStart: number | null;
    let charEnd: number | null;
    if (startSpan === endSpan) {
      const offsets = rangeToVerseCharOffsets(range, startSpan);
      if (!offsets) return;
      charStart = offsets.start;
      charEnd = offsets.end;
    } else {
      const first = document.createRange();
      first.selectNodeContents(startSpan);
      first.setStart(range.startContainer, range.startOffset);
      const firstOffsets = rangeToVerseCharOffsets(first, startSpan);

      const last = document.createRange();
      last.selectNodeContents(endSpan);
      last.setEnd(range.endContainer, range.endOffset);
      const lastOffsets = rangeToVerseCharOffsets(last, endSpan);
      if (!firstOffsets || !lastOffsets) return;
      charStart = firstOffsets.start;
      charEnd = lastOffsets.end;
    }

    // Snapshot native geometry before any marking mutation changes selection.
    const rangeRects = Array.from(range.getClientRects());
    if (rangeRects.length === 0) return;
    const phraseSelection = { verseStart, verseEnd, charStart, charEnd };
    const paletteBox = {
      top: Math.min(...rangeRects.map((rect) => rect.top)),
      bottom: Math.max(...rangeRects.map((rect) => rect.bottom)),
      left: Math.min(...rangeRects.map((rect) => rect.left)),
      right: Math.max(...rangeRects.map((rect) => rect.right)),
    };

    // Suppression must be armed synchronously during mouseup: the native click
    // follows immediately and belongs to this drag, not a whole-verse action.
    suppressTrailingDragClick();
    if (currentMarkingContextKeyRef.current !== ownerContextKey) return;

    // A completed drag owns this gesture. It may replace an idle connection
    // focus, but it must never strand an authored command that is settling or
    // waiting for explicit recovery.
    if (!requireSafeConnectionNavigation()) {
      window.getSelection()?.removeAllRanges();
      return;
    }

    closeConnectionWordChooser(false);
    setSelectedConnectionId(null);
    verseSelectionAnchorRef.current = null;
    setSelectedVerses(new Set());
    setPhraseSelection(phraseSelection);
    advanceSelectionGeneration();
    positionPaletteForBox(paletteBox);
    setShowHighlightPalette(true);
  }, [advanceSelectionGeneration, closeConnectionWordChooser, positionPaletteForBox, requireSafeConnectionNavigation, suppressTrailingDragClick, verseNumberForSpan, verseSpanForNode]);

  // Commit by gesture origin, not release target. This keeps a real drag that
  // ends in loom air or the page gutter from silently degrading into nothing.
  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent): void => {
      const target = event.target instanceof Element
        ? event.target
        : event.target instanceof Node ? event.target.parentElement : null;
      textSelectionGestureRef.current = event.button === 0
        && target?.closest(".verse-text-span") != null
        && verseTextRef.current?.contains(target) === true;
      if (textSelectionGestureRef.current) suppressNextClickRef.current = false;
    };
    const handleDocumentMouseUp = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      if (!textSelectionGestureRef.current) return;
      textSelectionGestureRef.current = false;
      void handleTextMouseUp();
    };
    const cancelTextSelectionGesture = (): void => {
      textSelectionGestureRef.current = false;
    };
    document.addEventListener("mousedown", handleDocumentMouseDown, true);
    document.addEventListener("mouseup", handleDocumentMouseUp);
    document.addEventListener("pointercancel", cancelTextSelectionGesture);
    window.addEventListener("blur", cancelTextSelectionGesture);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
      document.removeEventListener("pointercancel", cancelTextSelectionGesture);
      window.removeEventListener("blur", cancelTextSelectionGesture);
    };
  }, [handleTextMouseUp]);

  // Re-anchor the palette on window resize AND on scroll — its position is
  // computed from viewport-relative rects at the moment it opens, which go
  // stale the instant the window (or the margin toggling) changes the layout,
  // and the toolbar is position:fixed, so scrolling the reading column used
  // to leave it hanging in mid-air over unrelated text. The scroll listener
  // is capture-phase so it hears the inner .scripture-content scroller.
  // Handles both a whole-verse selection and a phrase selection (rebuilding
  // the phrase's range from its stored offsets).
  useEffect(() => {
    if (markingSurface === "dock") return;
    if (!showHighlightPalette) return;
    if (selectedVerses.size === 0 && !phraseSelection) return;
    let frame = 0;
    const handler = () => {
      if (phraseSelection) {
        const range = buildPhraseRange(phraseSelection);
        if (range) positionPaletteForRange(range);
      } else {
        positionPalette(selectedVerses);
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        handler();
      });
    };
    handler();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) schedule();
    });
    document.fonts?.addEventListener("loadingdone", schedule);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.fonts?.removeEventListener("loadingdone", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [
    buildPhraseRange,
    phraseSelection,
    markingSurface,
    positionPalette,
    positionPaletteForRange,
    selectedVerses,
    showHighlightPalette,
    stageBounds.height,
    stageBounds.left,
    stageBounds.top,
    stageBounds.width,
  ]);

  // ── H·2 · long-press — word selection is the platform's, the row is ours ──
  //
  // A long-press on touch produces a native selection with the platform's own
  // handles, and §3 says to match that convention rather than this language:
  // selection handles are muscle memory. So nothing here draws or moves a
  // handle. What is missing on touch is the COMMIT — there is no mouseup that
  // ends the gesture, because dragging a handle is not a drag of the mouse — so
  // the settled selection is what commits, through the same path the pointer
  // drag uses.
  //
  // The two selection models never coexist. A long-press inside a verse range
  // replaces it (handleTextMouseUp empties `selectedVerses`), and clearing the
  // word selection restores the range it replaced rather than leaving the
  // reader with nothing selected at all.
  useEffect(() => {
    if (!coarsePointer) return;
    let settleTimer = 0;
    const commitSettledSelection = (): void => {
      settleTimer = 0;
      const container = verseTextRef.current;
      const selection = window.getSelection();
      const live = selection != null
        && selection.rangeCount > 0
        && !selection.isCollapsed
        && container != null
        && container.contains(selection.getRangeAt(0).commonAncestorContainer);

      if (!live) {
        const restored = versesBeforeWordSelectionRef.current;
        versesBeforeWordSelectionRef.current = null;
        committedTouchSelectionRef.current = null;
        // Only the word model may hand the range back. If a tap has already
        // taken ownership, its whole-verse selection is the current truth and
        // restoring over it would undo the reader's last deliberate act.
        if (!restored || restored.size === 0 || phraseSelectionRef.current == null) return;
        setShowHighlightPalette(false);
        setPhraseSelection(null);
        setSelectedVerses(new Set(restored));
        verseSelectionAnchorRef.current = Math.min(...restored);
        advanceSelectionGeneration();
        return;
      }

      // A pointer drag already commits through document mouseup. This path is
      // for the gesture that has no mouseup of its own.
      if (lastCanvasPointerTypeRef.current === "mouse") return;
      const range = selection.getRangeAt(0);
      const signature = `${range.startOffset}:${range.endOffset}:${selection.toString()}`;
      if (committedTouchSelectionRef.current === signature) return;
      committedTouchSelectionRef.current = signature;
      if (versesBeforeWordSelectionRef.current == null) {
        versesBeforeWordSelectionRef.current = new Set(selectedVersesRef.current);
      }
      void handleTextMouseUp();
    };
    // Dragging a handle fires this continuously. Only the settled selection is
    // a decision; every frame before it is the reader still choosing.
    const scheduleSelectionCommit = (): void => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(commitSettledSelection, 150);
    };
    document.addEventListener("selectionchange", scheduleSelectionCommit);
    return () => {
      document.removeEventListener("selectionchange", scheduleSelectionCommit);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [advanceSelectionGeneration, coarsePointer, handleTextMouseUp]);

  const undoHighlightChange = (changeId: string) => {
    void safeCall(() => window.api.library.undoHighlightChange(changeId)).then(async (result) => {
      if (!result.ok || !result.value.ok) {
        showToast(result.ok ? result.value.error ?? "Undo failed" : result.error, undefined, undefined, { tone: "error" });
      }
      await reloadMarginHighlights();
    });
  };

  const captureMarkingSelection = (): MarkingSelectionSnapshot => ({
    contextKey: currentMarkingContextKeyRef.current,
    generation: selectionGenerationRef.current,
    phrase: phraseSelection ? { ...phraseSelection } : null,
    verses: new Set(selectedVerses),
    verseAnchor: verseSelectionAnchorRef.current,
  });

  const restoreMarkingSelection = (snapshot: MarkingSelectionSnapshot): void => {
    // Never restore package-specific character offsets into a chapter or
    // translation the user navigated to while persistence was in flight.
    if (
      currentMarkingContextKeyRef.current !== snapshot.contextKey
      || selectionGenerationRef.current !== snapshot.generation
    ) return;
    // A failed async marking write returns ownership to the restored surface.
    // Cancel the reading-focus frame requested while the selection was hidden,
    // otherwise a throttled rAF can land after the surface has restored its
    // first command and steal focus back to the verse.
    if (readingFocusFrameRef.current != null) {
      window.cancelAnimationFrame(readingFocusFrameRef.current);
      readingFocusFrameRef.current = null;
    }
    setPhraseSelection(snapshot.phrase ? { ...snapshot.phrase } : null);
    setSelectedVerses(new Set(snapshot.verses));
    verseSelectionAnchorRef.current = snapshot.verseAnchor;
    setShowHighlightPalette(true);
  };

  const handleHighlight = async (color: string): Promise<boolean> => {
    // A phrase drag is a PRECISE gesture — it applies the color to exactly its
    // character range and trims whatever it overlaps (standard highlighter
    // behavior). A whole-verse click is a COARSE gesture — it operates on the
    // whole visual blob (recolor/remove the passage as one unit). This is the
    // clean split: honor the granularity the user selected at.
    const selectionSnapshot = captureMarkingSelection();
    const isPhrase = selectionSnapshot.phrase != null;
    const target: HighlightRange | null = selectionSnapshot.phrase
      ? selectionSnapshot.phrase
      : (() => {
          const sorted = [...selectedVerses].sort((a, b) => a - b);
          if (sorted.length === 0) return null;
          return { verseStart: sorted[0]!, verseEnd: sorted[sorted.length - 1]!, charStart: null as number | null, charEnd: null as number | null };
        })();
    if (!target) return false;

    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    const touched = activeHere.filter((h) => isHighlightOverlap(h, target));

    setShowHighlightPalette(false);
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;

    // Whole-blob recolor only applies to a SINGLE-verse click landing on an
    // existing highlight ("I clicked into this blob to manage it"). A genuine
    // multi-verse range selection (shift-click spanning several verses) means
    // "highlight exactly this range" — it must always create over the FULL
    // selected range below, even if verse one of the range already happened to
    // carry some other highlight. Treating any touched record as "recolor
    // that blob using ITS OWN extent" (as this used to, unconditionally) threw
    // away the rest of a multi-verse selection whenever its first verse
    // collided with something pre-existing — only that one verse ever got the
    // new color; the verses after it were silently skipped.
    const isSingleVerseClick = !isPhrase && selectedVerses.size === 1;

    if (isSingleVerseClick && touched.length > 0) {
      // Single-verse click landing on an existing highlight: recolor the full
      // connected visual blob(s) in place. One grouped IPC gives the edit one
      // exact before/after snapshot and therefore one safe Undo token.
      const blobIds = new Set<string>();
      for (const t of touched) for (const id of resolveBlobExtent(activeHere, t.id)) blobIds.add(id);
      const blobRecords = activeHere.filter((h) => blobIds.has(h.id));
      if (blobRecords.every((h) => h.color === color)) return true; // already this color

      const recolor = await safeCall(() => window.api.library.recolorHighlights(
        book, chapter, packageId, [...blobIds], color,
      ));
      if (recolor.ok && recolor.value.ok) {
        if (recolor.value.changeId) showToast("Highlight color changed", "Undo", () => undoHighlightChange(recolor.value.changeId!));
      } else {
        showToast(recolor.ok ? recolor.value.error ?? "Failed to recolor highlight" : recolor.error, undefined, undefined, { tone: "error" });
      }
      await reloadMarginHighlights();
      const ok = recolor.ok && recolor.value.ok;
      if (!ok) restoreMarkingSelection(selectionSnapshot);
      return ok;
    }

    // CREATE path: a fresh highlight, a phrase applied over existing text, or
    // a genuine multi-verse range selection. Always creates over the user's
    // FULL selected range (target.verseStart..verseEnd) — never just whatever
    // happened to already be highlighted within it. The backend supersedes
    // anything underneath by subtracting this exact endpoint-aware range;
    // unaffected characters and outer verses survive as remainders. Optimistic
    // render + sweep only when
    // there's no overlap at all (a clean fresh highlight) — otherwise the
    // optimistic add would flash both the new and the not-yet-resolved old
    // highlight until the reload corrects it.
    const optimistic = touched.length === 0;
    if (optimistic) {
      setMarginData((prev) => ({
        ...prev,
        highlights: [
          ...prev.highlights,
          {
            id: "temp", book, chapter,
            verse_start: target.verseStart, verse_end: target.verseEnd,
            package: packageId, char_start: target.charStart, char_end: target.charEnd,
            color, kind: "highlight", note_id: null, deleted: 0,
          },
        ],
      }));
      setAnimateIds(new Set(["temp"]));
    }

    const res = await safeCall(() => window.api.library.createHighlight(
      book, chapter, target.verseStart, target.verseEnd, color, packageId, target.charStart, target.charEnd,
    ));

    if (res.ok && res.value.ok) {
      const hlId = res.value.highlightId ?? "";
      // Transfer the sweep token from the optimistic temp id to the real id so
      // the sweep survives the reload's id swap instead of being cut off.
      setAnimateIds(new Set([hlId]));
      if (res.value.changeId) showToast("Highlight created", "Undo", () => undoHighlightChange(res.value.changeId!));
      await reloadMarginHighlights();
      // Clear this id after the sweep would have finished so a later unrelated
      // re-measure (resize, other edits) doesn't replay it.
      const sweepContextKey = selectionSnapshot.contextKey;
      window.setTimeout(() => {
        if (currentMarkingContextKeyRef.current !== sweepContextKey) return;
        setAnimateIds((prev) => {
          if (!prev.has(hlId)) return prev;
          const next = new Set(prev);
          next.delete(hlId);
          return next;
        });
      }, SWEEP_MS);
      return true;
    } else {
      showToast("Failed to create highlight", undefined, undefined, { tone: "error" });
      setAnimateIds(new Set());
      await reloadMarginHighlights(); // Revert optimistic update
      restoreMarkingSelection(selectionSnapshot);
      return false;
    }
  };

  const handleDeleteHighlights = async (entityIds: string[]): Promise<boolean> => {
    const requestKey = `${sessionOwnerTabId}:${book}:${chapter}`;
    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    // Whole-verse/pinned removal is deliberately coarse: every explicitly
    // touched connected blob is one perceived highlight unit.
    const blobIdSet = new Set<string>();
    for (const entityId of entityIds) {
      for (const id of resolveBlobExtent(activeHere, entityId)) blobIdSet.add(id);
    }
    const blobIds = [...blobIdSet];
    const targets = activeHere.filter((h) => blobIds.includes(h.id));
    if (targets.length === 0) return false;

    // Fade every record in the blob at once. marginData still holds them, so
    // the underlay keeps rendering their blob (now fading) instead of it
    // vanishing instantly.
    setFadingIds((prev) => new Set([...prev, ...blobIds]));
    const clearFading = () => {
      setFadingIds((prev) => {
        const next = new Set(prev);
        for (const id of blobIds) next.delete(id);
        return next;
      });
    };

    const result = await safeCall(() => window.api.library.deleteHighlights(
      book, chapter, packageId, blobIds,
    ));
    if (result.ok && result.value.ok) {
      if (result.value.changeId) {
        showToast(targets.length === 1 ? "Highlight removed" : `${targets.length} highlights removed`, "Undo", () => {
          undoHighlightChange(result.value.changeId!);
        });
      }
      // Let the fade-out play (styles.css .hl-fade-out, FADE_MS) before the
      // records leave local data. Critically, AWAIT the reload before clearing
      // the fade flags: if the flags cleared while marginData still held the
      // records, the underlay would recompute them as fully-opaque live
      // highlights and the blob would snap back from faded to solid — the
      // "still showing after delete" bug. Reload-first guarantees the records
      // are already gone (no blob built for them) before we touch the flags.
      window.setTimeout(() => {
        void (async () => {
          await reloadMarginHighlights();
          if (currentChapterKeyRef.current === requestKey) clearFading();
        })();
      }, FADE_MS);
      return true;
    } else {
      showToast(result.ok ? result.value.error ?? "Failed to remove highlight" : result.error, undefined, undefined, { tone: "error" });
      clearFading();
      return false;
    }
  };

  const handleRemoveSelection = async (): Promise<boolean> => {
    const selectionSnapshot = captureMarkingSelection();
    const phrase = selectionSnapshot.phrase;
    const touched = touchedHighlights();
    setShowHighlightPalette(false);
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;

    if (phrase) {
      const result = await safeCall(() => window.api.library.eraseHighlightRange(
        book,
        chapter,
        phrase.verseStart,
        phrase.verseEnd,
        packageId,
        phrase.charStart,
        phrase.charEnd,
      ));
      if (result.ok && result.value.ok) {
        if (result.value.changeId) showToast("Removed from highlight", "Undo", () => undoHighlightChange(result.value.changeId!));
      } else {
        showToast(result.ok ? result.value.error ?? "Failed to remove selection" : result.error, undefined, undefined, { tone: "error" });
      }
      await reloadMarginHighlights();
      const ok = result.ok && result.value.ok;
      if (!ok) restoreMarkingSelection(selectionSnapshot);
      return ok;
    }

    const ok = await handleDeleteHighlights(touched.map((highlight) => highlight.id));
    if (!ok) restoreMarkingSelection(selectionSnapshot);
    return ok;
  };

  const handleNoteFromSelection = () => {
    let verseStart: number;
    let verseEnd: number;
    let phraseQuote: string | null = null;

    if (phraseSelection) {
      verseStart = phraseSelection.verseStart;
      verseEnd = phraseSelection.verseEnd;
      // Preserve the exact selected phrase across verse boundaries. The first
      // and last offsets belong to their respective endpoint verses; interior
      // verses remain complete.
      phraseQuote = [...chapterVerseText.entries()]
        .filter(([verse]) => verse >= verseStart && verse <= verseEnd)
        .sort((a, b) => a[0] - b[0])
        .map(([verse, text]) => {
          let fragment = text;
          if (verse === verseStart && phraseSelection.charStart != null) {
            fragment = fragment.slice(phraseSelection.charStart);
          }
          if (verse === verseEnd && phraseSelection.charEnd != null) {
            const end = verse === verseStart && phraseSelection.charStart != null
              ? phraseSelection.charEnd - phraseSelection.charStart
              : phraseSelection.charEnd;
            fragment = fragment.slice(0, Math.max(0, end));
          }
          return fragment;
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    } else if (selectedVerses.size > 0) {
      const sorted = [...selectedVerses].sort((a, b) => a - b);
      verseStart = sorted[0]!;
      verseEnd = sorted[sorted.length - 1]!;
    } else {
      return;
    }

    const rangeStr =
      verseStart === verseEnd
        ? `${displayBookName} ${chapter}:${verseStart}`
        : `${displayBookName} ${chapter}:${verseStart}–${verseEnd}`;

    const quote =
      phraseQuote ??
      [...chapterVerseText.entries()]
        .filter(([v]) => v >= verseStart && v <= verseEnd)
        .sort((a, b) => a[0] - b[0])
        .map(([v, t]) => (verseStart === verseEnd ? t : `${v} ${t}`))
        .join("\n");

    setNoteDraft({
      title: rangeStr,
      passageRef: rangeStr,
      quote,
      book,
      chapter,
      verseStart,
      verseEnd,
      packageId,
    });
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;
    setShowHighlightPalette(false);
  };

  const handleMarginCapture = useCallback((capture: LivingMarginCaptureRequest): void => {
    setNoteDraft(buildMarginCaptureDraft(capture, {
      book: marginSubject.book,
      chapter: marginSubject.chapter,
      verseStart: marginSubject.verse,
      verseEnd: marginSubject.endVerse,
      packageId,
    }));
  }, [marginSubject, packageId]);

  const handleAmbientKeptChange = useCallback((keep: boolean): void => {
    if (!onKeptContextChange) return;
    if (!keep) {
      onKeptContextChange(null);
      return;
    }
    if (settledNearVerse == null) return;
    const bookLabel = bookNames[book]?.[0] ?? book;
    onKeptContextChange({
      book,
      chapter,
      verse: settledNearVerse,
      label: `${bookLabel} ${chapter}:${settledNearVerse}`,
    });
  }, [book, bookNames, chapter, onKeptContextChange, settledNearVerse]);

  const handleKeepPeekReference = useCallback((reference: PeekTarget): void => {
    onKeptContextChange?.({
      book: reference.book,
      chapter: reference.chapter,
      verse: reference.verse,
      ...(reference.endVerse != null ? { endVerse: reference.endVerse } : {}),
      label: reference.label,
    });
  }, [onKeptContextChange]);

  const handleOpenPeekPassageTab = useCallback((
    reference: PeekTarget,
    options?: VersePeekOpenOptions,
  ): Promise<boolean> => (
    openPassageTab(reference, "verse-peek", options)
  ), [openPassageTab]);

  const handleOpenMarginEntity = useCallback((
    target: EntityResearchTarget,
  ): Promise<boolean> => {
    if (!onOpenEntity) return Promise.resolve(false);
    return onOpenEntity(target);
  }, [onOpenEntity]);

  const handleNoteCaptureSaved = useCallback(
    ({ title }: { noteId: string; title: string }) => {
      setNoteDraft(null);
      showToast(`Saved “${title}”`, undefined, undefined, { tone: "success" });
      // Refresh margin so the new note can appear if it anchors to this chapter.
      void reloadMarginHighlights();
    },
    [showToast, reloadMarginHighlights],
  );

  // Every highlight lookup below uses the already package-scoped normalized
  // records and filters by book+chapter, not just verse
  // number. Without it, if marginData ever briefly holds a stale response
  // from a different chapter (a race — see reloadMarginHighlights and the
  // currentChapterKeyRef guard), a highlight from that other chapter would
  // render as if it belonged to whatever verse number it happens to share
  // with the chapter actually on screen. Chapters routinely share verse
  // numbers (most start at 1), so this isn't a hypothetical edge case.
  const getHighlightClass = (verse: number): string => {
    const colors = new Set(normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter && verse >= h.verse_start && verse <= h.verse_end,
    ).map((highlight) => highlight.color));
    if (colors.size === 0) return "";
    if (colors.size === 1) return `hl-${[...colors][0]}`;
    return "hl-mixed";
  };

  // Records the current selection (phrase or whole-verse) actually overlaps —
  // char-aware for a phrase selection. Backs both the palette's "remove" state
  // and the whole-blob remove action.
  const touchedHighlights = useCallback((): HighlightRecord[] => {
    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    if (phraseSelection) {
      return activeHere.filter((h) => isHighlightOverlap(h, {
        verseStart: phraseSelection.verseStart, verseEnd: phraseSelection.verseEnd,
        charStart: phraseSelection.charStart, charEnd: phraseSelection.charEnd,
      }));
    }
    return activeHere.filter((h) => [...selectedVerses].some((v) => v >= h.verse_start && v <= h.verse_end));
  }, [normalizedHighlights, book, chapter, phraseSelection, selectedVerses]);

  const selectedHighlightRecords = touchedHighlights();
  const selectedHighlightColors = [...new Set(selectedHighlightRecords.map((highlight) => highlight.color))];
  const selectedHighlightColor = selectedHighlightColors.length === 1 ? selectedHighlightColors[0]! : null;
  const mixedSelectionColors = selectedHighlightColors.length > 1;
  const hasExistingHighlight = (selectedVerses.size > 0 || phraseSelection != null) && selectedHighlightRecords.length > 0;
  const multiVerseSelect = selectedVerses.size > 1;
  // The grips exist only where a finger is the pointer, and only while the
  // whole-verse model owns the selection. A word selection has the platform's
  // own handles, and two sets of handles over one passage is how a reader stops
  // trusting either.
  const verseRangeGrips = coarsePointer && phraseSelection == null ? pinnedRange : null;

  const selectionRangeLabel = useMemo(() => {
    if (phraseSelection) {
      if (phraseSelection.verseStart === phraseSelection.verseEnd) {
        return `${displayBookName} ${chapter}:${phraseSelection.verseStart}`;
      }
      return `${displayBookName} ${chapter}:${phraseSelection.verseStart}–${phraseSelection.verseEnd}`;
    }
    if (selectedVerses.size === 0) return "";
    const sorted = [...selectedVerses].sort((a, b) => a - b);
    if (sorted.length === 1) return `${displayBookName} ${chapter}:${sorted[0]}`;
    return `${displayBookName} ${chapter}:${sorted[0]}–${sorted[sorted.length - 1]}`;
  }, [phraseSelection, selectedVerses, displayBookName, chapter]);

  // Keep the renderer-only exact fragments stable while the floating surface
  // repositions. Palette geometry changes on scroll/resize, but the selected
  // words do not; rebuilding these anchors would unnecessarily invalidate the
  // underlay's transient selection record and its measured paint.
  const markingSelectionPaintAnchors = useMemo<readonly ConnectionPaintAnchor[]>(() => {
    // selectedVerses is also the Living Margin's Study scope. Only an
    // explicit marking session (a real drag, or the keyboard M command) may
    // enter exact-capture/auto-apply paths.
    if (!showHighlightPalette) return [];
    let verseStart: number;
    let verseEnd: number;
    let charStart: number | null = null;
    let charEnd: number | null = null;
    if (phraseSelection) {
      verseStart = phraseSelection.verseStart;
      verseEnd = phraseSelection.verseEnd;
      charStart = phraseSelection.charStart;
      charEnd = phraseSelection.charEnd;
    } else if (selectedVerses.size > 0) {
      const sorted = [...selectedVerses].sort((a, b) => a - b);
      verseStart = sorted[0]!;
      verseEnd = sorted[sorted.length - 1]!;
    } else {
      return [];
    }

    const paintAnchors: ConnectionPaintAnchor[] = [];
    for (let verse = verseStart; verse <= verseEnd; verse += 1) {
      const text = chapterVerseText.get(verse);
      if (text == null) continue;
      const fragmentStart = phraseSelection && verse === verseStart ? charStart ?? 0 : 0;
      const fragmentEnd = phraseSelection && verse === verseEnd ? charEnd ?? text.length : text.length;
      if (fragmentEnd <= fragmentStart) continue;
      paintAnchors.push({
        book: book as ConnectionPaintAnchor["book"],
        chapter,
        verse_start: verse,
        verse_end: verse,
        fragments: [{
          verse,
          char_start: fragmentStart,
          char_end: fragmentEnd,
          quote: text.slice(fragmentStart, fragmentEnd),
        }],
      });
    }
    return paintAnchors;
  }, [book, chapter, chapterVerseText, packageId, phraseSelection, selectedVerses, showHighlightPalette]);

  const markingSelectionPieces = useMemo<readonly OccurrenceSelectionPiece[]>(() => (
    markingSelectionPaintAnchors.flatMap((anchor) => anchor.fragments.map((fragment) => ({
      book: anchor.book,
      chapter: anchor.chapter,
      verse: fragment.verse,
      char_start: fragment.char_start,
      char_end: fragment.char_end,
      quote: fragment.quote,
    })))
  ), [markingSelectionPaintAnchors]);

  useEffect(() => {
    const contextKey = `${sessionOwnerTabId}:${book}:${chapter}:${packageId}`;
    const nonce = selectionNonce;
    if (markingSelectionPieces.length === 0) {
      setSelectionCapture(null);
      return;
    }
    let cancelled = false;
    setSelectionCapture({ nonce, contextKey, capture: { status: "pending" } });
    void safeCall(() => window.api.library.captureConnectionSelection(
      packageId,
      markingSelectionPieces,
    )).then((result) => {
      if (
        cancelled
        || selectionGenerationRef.current !== nonce
        || currentMarkingContextKeyRef.current !== contextKey
      ) return;
      if (!result.ok) {
        setSelectionCapture({
          nonce,
          contextKey,
          capture: {
            status: "refused",
            message: "Exact connection capture is unavailable. Highlights and notes still work for these words.",
          },
        });
        return;
      }
      if (!result.value.ok) {
        setSelectionCapture({
          nonce,
          contextKey,
          capture: {
            status: "refused",
            message: `${result.value.error.message} Highlights and notes still remain available.`,
          },
        });
        return;
      }
      // A settled capture means the canonical unit is wider than the words the
      // reader dragged over (a Hebrew word carrying its article, say). Carry
      // the settled fragments so the surface can hold and show exactly what
      // the anchor holds instead of the raw drag. Render evidence only — it is
      // never persisted with the anchor.
      const settled = result.value.settled ?? null;
      const settledPaintAnchors: ConnectionPaintAnchor[] = [];
      for (const fragment of settled ?? []) {
        settledPaintAnchors.push({
          book: result.value.anchor.book,
          chapter: result.value.anchor.chapter,
          verse_start: fragment.verse,
          verse_end: fragment.verse,
          fragments: [{
            verse: fragment.verse,
            char_start: fragment.char_start,
            char_end: fragment.char_end,
            quote: fragment.quote,
          }],
        });
      }
      setSelectionCapture({
        nonce,
        contextKey,
        capture: settledPaintAnchors.length > 0
          ? { status: "exact", anchor: result.value.anchor, settledPaintAnchors }
          : { status: "exact", anchor: result.value.anchor },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [book, chapter, markingSelectionPieces, packageId, selectionNonce, sessionOwnerTabId]);

  const markingSelection = useMemo<MarkingSelectionModel | null>(() => {
    if (!showHighlightPalette) return null;
    let verseStart: number;
    let verseEnd: number;
    let charStart: number | null = null;
    let charEnd: number | null = null;
    if (phraseSelection) {
      verseStart = phraseSelection.verseStart;
      verseEnd = phraseSelection.verseEnd;
      charStart = phraseSelection.charStart;
      charEnd = phraseSelection.charEnd;
    } else if (selectedVerses.size > 0) {
      const sorted = [...selectedVerses].sort((a, b) => a - b);
      verseStart = sorted[0]!;
      verseEnd = sorted[sorted.length - 1]!;
    } else {
      return null;
    }

    const quote = [...chapterVerseText.entries()]
      .filter(([verse]) => verse >= verseStart && verse <= verseEnd)
      .sort((a, b) => a[0] - b[0])
      .map(([verse, text]) => {
        let fragment = text;
        if (phraseSelection && verse === verseStart && charStart != null) fragment = fragment.slice(charStart);
        if (phraseSelection && verse === verseEnd && charEnd != null) {
          const end = verse === verseStart && charStart != null ? charEnd - charStart : charEnd;
          fragment = fragment.slice(0, Math.max(0, end));
        }
        return fragment;
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const contextKey = `${sessionOwnerTabId}:${book}:${chapter}:${packageId}`;
    const capture = selectionCapture?.nonce === selectionNonce
      && selectionCapture.contextKey === contextKey
      ? selectionCapture.capture
      : { status: "pending" as const };
    return {
      nonce: selectionNonce,
      rangeLabel: selectionRangeLabel,
      quote,
      activeColor: selectedHighlightColor,
      mixedColors: mixedSelectionColors,
      hasExistingHighlight,
      phraseMode: phraseSelection != null,
      position: palettePos,
      capture,
      paintAnchors: markingSelectionPaintAnchors,
    };
  }, [
    book,
    chapter,
    chapterVerseText,
    hasExistingHighlight,
    markingSelectionPaintAnchors,
    mixedSelectionColors,
    packageId,
    palettePos,
    phraseSelection,
    selectedHighlightColor,
    selectedVerses,
    sessionOwnerTabId,
    selectionCapture,
    selectionNonce,
    selectionRangeLabel,
    showHighlightPalette,
  ]);

  const hasMarkingSelection = markingSelection != null;
  const markingSelectionEmphasis = useMemo(() => (
    showHighlightPalette && hasMarkingSelection
      ? {
          nonce: selectionNonce,
          anchors: markingSelectionPaintAnchors,
        }
      : null
  ), [hasMarkingSelection, markingSelectionPaintAnchors, selectionNonce, showHighlightPalette]);

  // Ambient margin follows the verse nearest the reading eye-line — but never
  // while the pastor is working in the margin (pointer) or has locked a study
  // verse. Otherwise a click on Greek chips feels like "click out" and the
  // panel jumps to wherever the page is scrolled (often not verse 1).
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !chapterData) {
      setNearVerse(null);
      return;
    }

    let scrollTimer = 0;
    const update = () => {
      // Pointer enter/leave is the fast path, while :hover is the recovery
      // path when the panel remounts under a stationary pointer. Without the
      // reconciliation, a stale `true` can freeze ambient context after the
      // pointer has visibly returned to Scripture.
      const marginHasPointer = document.querySelector(".living-margin")?.matches(":hover") ?? false;
      if (marginActiveRef.current && marginHasPointer) return;
      marginActiveRef.current = false;
      // The top of a chapter is its deliberate overview state. Once the
      // reader moves into the text, the margin follows the eye-line; returning
      // to the top restores chapter context instead of pretending the first
      // visible verse is an explicit selection.
      if (root.scrollTop < 72) {
        setNearVerse((previous) => (previous == null ? previous : null));
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const eyeY = rootRect.top + rootRect.height * 0.32;
      let best: number | null = null;
      let bestDist = Infinity;
      for (const [verseNum, el] of verseRowRefs.current) {
        const r = el.getBoundingClientRect();
        if (r.bottom < rootRect.top + 8 || r.top > rootRect.bottom - 8) continue;
        const mid = (r.top + r.bottom) / 2;
        const dist = Math.abs(mid - eyeY);
        if (dist < bestDist) {
          bestDist = dist;
          best = verseNum;
        }
      }
      setNearVerse((prev) => (prev === best ? prev : best));
    };

    const onScroll = () => {
      // Update the first movement immediately, then coalesce the rest with a
      // short trailing pass. This remains responsive when Chromium throttles
      // animation frames for an obscured desktop window and avoids measuring
      // every verse on every raw trackpad event.
      if (scrollTimer === 0) update();
      else window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrollTimer = 0;
        update();
      }, 48);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();

    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (scrollTimer) window.clearTimeout(scrollTimer);
    };
  }, [chapterData, book, chapter, sessionOwnerTabId]);

  /** Pointer entered/left the Living Margin chrome. */
  const handleMarginActiveChange = useCallback((active: boolean) => {
    marginActiveRef.current = active;
  }, []);

  /** Keep the currently engaged word card aligned with the visible scope. */
  const handleStudyVerse = useCallback((v: number) => {
    setNearVerse(v);
  }, []);

  const handleClearMarginSelection = useCallback((expectedNonce?: number) => {
    if (expectedNonce != null && selectionGenerationRef.current !== expectedNonce) return;
    window.getSelection()?.removeAllRanges();
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;
    setShowHighlightPalette(false);
  }, []);

  const scheduleVerseFocus = useCallback((targetVerse: number, expectedNonce?: number): void => {
    if (readingFocusFrameRef.current != null) {
      window.cancelAnimationFrame(readingFocusFrameRef.current);
    }
    const ownerContextKey = currentMarkingContextKeyRef.current;
    readingFocusFrameRef.current = window.requestAnimationFrame(() => {
      readingFocusFrameRef.current = null;
      if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
      if (expectedNonce != null && selectionGenerationRef.current !== expectedNonce) return;
      verseRowRefs.current.get(targetVerse)?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => () => {
    if (readingFocusFrameRef.current != null) {
      window.cancelAnimationFrame(readingFocusFrameRef.current);
      readingFocusFrameRef.current = null;
    }
  }, []);

  const handleRequestReadingFocus = useCallback((
    anchors: readonly (ConnectionAnchor | ConnectionPaintAnchor)[] = [],
    expectedNonce?: number,
  ): void => {
    const context = readingFocusContextRef.current;
    const localAnchor = anchors.find((anchor) =>
      anchor.book === context.book && anchor.chapter === context.chapter);
    const targetVerse = localAnchor?.verse_start ?? context.nearVerse ?? context.firstVerse;
    if (targetVerse == null) return;
    scheduleVerseFocus(targetVerse, expectedNonce);
  }, [scheduleVerseFocus]);

  const handleDismissMarkingSurface = useCallback(() => {
    const targetVerse = phraseSelection?.verseStart
      ?? [...selectedVerses].sort((left, right) => left - right)[0]
      ?? null;
    setShowHighlightPalette(false);
    // Keep the internal Study/phrase scope, but release the browser-native
    // Range. Otherwise the next deliberate click on connected words can be
    // misread as another completed drag and reopen marking instead of opening
    // the relationship it hit.
    window.getSelection()?.removeAllRanges();
    if (targetVerse == null) return;
    scheduleVerseFocus(targetVerse, selectionGenerationRef.current);
  }, [phraseSelection, scheduleVerseFocus, selectedVerses]);

  const replaceHeldConnectionIds = useCallback((next: string[]): void => {
    heldConnectionIdsRef.current = next;
    setHeldConnectionIds(next);
  }, []);

  const handleConnectionCardRecoveryChange = useCallback((
    ownerConnectionId: string,
    nextRecovery: ConnectionCardRecovery | null,
  ): void => {
    setConnectionCardRecovery((current) => {
      let resolved = current;
      if (nextRecovery) {
        const nextOwner = nextRecovery.kind === "update"
          ? nextRecovery.command.next.id
          : nextRecovery.command.connection.id;
        resolved = nextOwner === ownerConnectionId ? nextRecovery : current;
      } else if (!current) {
        resolved = null;
      } else {
        const currentOwner = current.kind === "update"
          ? current.command.next.id
          : current.command.connection.id;
        resolved = currentOwner === ownerConnectionId ? null : current;
      }
      connectionCardRecoveryRef.current = resolved;
      return resolved;
    });
    if (!nextRecovery) return;
    if (!heldConnectionIdsRef.current.includes(ownerConnectionId)) {
      replaceHeldConnectionIds([...heldConnectionIdsRef.current, ownerConnectionId]);
    }
    setSelectedConnectionId(ownerConnectionId);
    onEnsureMarginVisible?.();
  }, [onEnsureMarginVisible, replaceHeldConnectionIds]);

  // queryRange is authoritative for which relationships are available on the
  // current reading surface. Reconcile the durable result back into both the
  // ordered state and its event-handler ref so a delete/reload can never leave
  // a ghost pressed tick or an inspector focused on a missing relationship.
  useEffect(() => {
    const available = new Set(visibleMarginData.connections.map((connection) => connection.id));
    const next = heldConnectionIdsRef.current.filter((connectionId) => available.has(connectionId));
    heldConnectionIdsRef.current = next;
    setHeldConnectionIds((current) => (
      current.length === next.length && current.every((connectionId, index) => connectionId === next[index])
        ? current
        : next
    ));
    setSelectedConnectionId((current) => (
      current == null
        ? null
        : next.includes(current) ? current : (next.at(-1) ?? null)
    ));
  }, [visibleMarginData.connections]);

  // The chooser is a transient projection of the current query, never an
  // authority that can resurrect a relationship removed by a later fold.
  // Refresh surviving rows to the latest record and close when none remain.
  useEffect(() => {
    if (!connectionWordChooser) return;
    const hits = connectionWordChooser.hits.flatMap((hit) => {
      const connection = visibleConnectionById.get(hit.connection.id);
      return connection ? [{ ...hit, connection }] : [];
    });
    if (hits.length === 0) {
      closeConnectionWordChooser(false);
      return;
    }
    const unchanged = hits.length === connectionWordChooser.hits.length
      && hits.every((hit, index) => hit.connection === connectionWordChooser.hits[index]?.connection);
    if (!unchanged) {
      setConnectionWordChooser({ ...connectionWordChooser, hits });
    }
  }, [closeConnectionWordChooser, connectionWordChooser, visibleConnectionById]);

  const releaseHeldConnection = useCallback((connectionId: string, restoreFocus = false): void => {
    const ownerContextKey = currentMarkingContextKeyRef.current;
    const next = heldConnectionIdsRef.current.filter((candidate) => candidate !== connectionId);
    replaceHeldConnectionIds(next);
    // A delete/update can resolve after the reader has focused a newer held
    // relationship. Only choose a fallback when the released id still owns
    // focus; releasing a nonfocused companion must not steal the newer card.
    setSelectedConnectionId((current) => (
      current === connectionId ? (next.at(-1) ?? null) : current
    ));
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => {
      if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
      findConnectionTickControl(connectionId)?.focus({ preventScroll: true });
    });
  }, [replaceHeldConnectionIds]);

  const requestScriptureWorkspaceAttention = useCallback(async (): Promise<boolean> => {
    // The active tab owns this canvas, including entity tabs. Canvas study
    // interactions must not implicitly close Research or jump to its return
    // passage; explicit tab selection remains the only workspace transfer.
    return true;
  }, []);

  /**
   * Rev 04 §5: "Attending happens three ways and is one behaviour: clicking a
   * member, its gutter tick, or its row in the Connections tab. All three
   * scroll the least distance that brings every member into view."
   *
   * So the scroll lives here, in the one function all three paths already call,
   * rather than beside any one of them. The Connections tab used to own a
   * bespoke version that centred the single member nearest the eye-line, which
   * was neither least-distance nor shared; it is gone.
   */
  const scrollAttendedConnectionIntoView = useCallback((
    connection: ConnectionRecord,
    ownerContextKey: string | null,
  ): void => {
    const verses = new Set<number>();
    for (const anchor of canonicalConnectionAnchors(connection)) {
      if (anchor.book !== book || anchor.chapter !== chapter) continue;
      for (let verse = anchor.verse_start; verse <= anchor.verse_end; verse += 1) verses.add(verse);
    }
    if (verses.size === 0) return;
    window.requestAnimationFrame(() => {
      if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
      const root = contentRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const span = memberSpan([...verses].flatMap((verse) => {
        const row = verseRowRefs.current.get(verse);
        if (!row) return [];
        const rect = row.getBoundingClientRect();
        return [{
          top: rect.top - rootRect.top + root.scrollTop,
          bottom: rect.bottom - rootRect.top + root.scrollTop,
        }];
      }));
      if (!span) return;
      const next = leastScrollForMembers({
        scrollTop: root.scrollTop,
        viewportHeight: root.clientHeight,
        spanTop: span.top,
        spanBottom: span.bottom,
        maxScrollTop: root.scrollHeight - root.clientHeight,
      });
      if (Math.abs(next - root.scrollTop) < 1) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.scrollTo({ top: next, behavior: reducedMotion ? "auto" : "smooth" });
    });
  }, [book, chapter]);

  const handleSelectConnection = useCallback(async (
    connection: ConnectionRecord | null,
    focusInspector = false,
  ): Promise<boolean> => {
    const ownerContextKey = currentMarkingContextKeyRef.current;
    const visibleConnection = connection == null
      ? null
      : visibleConnectionByIdRef.current.get(connection.id) ?? null;
    if (connection != null && visibleConnection == null) {
      closeConnectionWordChooser(false);
      return false;
    }
    if (!requireSafeConnectionNavigation()) {
      return false;
    }
    if (visibleConnection && !await requestScriptureWorkspaceAttention()) {
      return false;
    }
    if (currentMarkingContextKeyRef.current !== ownerContextKey) return false;
    // Opening or closing the relationship inspector is a newer focus transfer.
    // A late failed highlight write must not resurrect an older palette over it.
    advanceSelectionGeneration();
    closeConnectionWordChooser(false);
    if (visibleConnection) {
      if (!heldConnectionIdsRef.current.includes(visibleConnection.id)) {
        replaceHeldConnectionIds([...heldConnectionIdsRef.current, visibleConnection.id]);
      }
      setSelectedConnectionId(visibleConnection.id);
      if (focusInspector) {
        setConnectionInspectorFocusRequest((request) => request + 1);
      }
      onEnsureMarginVisible?.();
      scrollAttendedConnectionIntoView(visibleConnection, ownerContextKey);
    } else if (selectedConnectionId) {
      releaseHeldConnection(selectedConnectionId);
    }
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;
    setShowHighlightPalette(false);
    return true;
  }, [advanceSelectionGeneration, closeConnectionWordChooser, onEnsureMarginVisible, releaseHeldConnection, replaceHeldConnectionIds, requestScriptureWorkspaceAttention, requireSafeConnectionNavigation, scrollAttendedConnectionIntoView, selectedConnectionId]);

  // The Connections tab's row is the third way to attend, and Rev 04 makes the
  // three one behaviour — so this is now nothing but the shared one.
  const handleSelectAuthoredConnection = useCallback(async (
    connection: ConnectionRecord,
    focusInspector = false,
  ): Promise<void> => {
    await handleSelectConnection(connection, focusInspector);
  }, [handleSelectConnection]);

  const handleChooseConnections = useCallback(async (
    connections: readonly ConnectionRecord[],
    anchorRect: DOMRect,
    origin: HTMLButtonElement,
  ): Promise<void> => {
    const ownerContextKey = currentMarkingContextKeyRef.current;
    if (!requireSafeConnectionNavigation()) {
      return;
    }
    const hits = orderConnectionWordHits(
      connections.flatMap((connection) => {
        const current = visibleConnectionByIdRef.current.get(connection.id);
        return current
          ? [{ id: current.id, value: { connection: current, area: 0 }, area: 0 }]
          : [];
      }),
      selectedConnectionId,
      heldConnectionIdsRef.current,
    ).map((candidate) => candidate.value);
    if (hits.length === 0) return;
    if (!await requestScriptureWorkspaceAttention()) return;
    if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
    connectionWordChooserOriginRef.current = origin;
    setConnectionWordChooser({
      anchorRect,
      hits,
      aggregateMemberIds: connections.map((connection) => connection.id),
    });
  }, [requestScriptureWorkspaceAttention, requireSafeConnectionNavigation, selectedConnectionId]);

  /**
   * Hide the visible relationship shape without mutating durable data or the
   * ordered held comparison set. This is intentionally distinct from the
   * card/tick Release action, which removes one held id and may focus the
   * previous companion.
   */
  const handleDismissConnectionFocus = useCallback((restoreFocus = false): boolean => {
    const connectionId = selectedConnectionIdRef.current;
    closeConnectionWordChooser(false);
    if (!connectionId) return true;
    if (!requireSafeConnectionNavigation()) {
      onEnsureMarginVisible?.();
      return false;
    }
    advanceSelectionGeneration();
    selectedConnectionIdRef.current = null;
    setSelectedConnectionId(null);
    if (restoreFocus) {
      const ownerContextKey = currentMarkingContextKeyRef.current;
      window.requestAnimationFrame(() => {
        if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
        findConnectionTickControl(connectionId)?.focus({ preventScroll: true });
      });
    }
    return true;
  }, [advanceSelectionGeneration, closeConnectionWordChooser, onEnsureMarginVisible, requireSafeConnectionNavigation]);

  // The card normally owns a local Escape ladder for dirty fields and delete
  // confirmation. Focus mode intentionally unmounts that card while leaving
  // the selected reading shape visible, so ScripturePage owns the hidden-card
  // fallback before App can interpret the same Escape as "exit Focus mode."
  // Ownership comes from the shared layer registry: this fallback registers
  // the same "connection-focus" rank the visible card would, and fires only
  // when nothing above it (chooser, dialog, marking session) is open.
  useEffect(() => {
    if (!selectedConnectionId) return;
    const handleSelectedConnectionEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!selectedConnectionIdRef.current) return;
      if (!isTopLayer(connectionFocusFallbackLayerRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handleDismissConnectionFocus(true);
    };
    window.addEventListener("keydown", handleSelectedConnectionEscape, true);
    return () => window.removeEventListener("keydown", handleSelectedConnectionEscape, true);
  }, [handleDismissConnectionFocus, selectedConnectionId]);

  const handleConnectionWordChooserKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".connection-word-choice")];
    if (choices.length === 0) return;
    const activeIndex = choices.findIndex((choice) => choice === document.activeElement);
    let targetIndex: number | null = null;
    if (event.key === "ArrowDown") targetIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % choices.length;
    if (event.key === "ArrowUp") targetIndex = activeIndex <= 0 ? choices.length - 1 : activeIndex - 1;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = choices.length - 1;
    if (targetIndex != null) {
      event.preventDefault();
      event.stopPropagation();
      const target = choices[targetIndex];
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const activeChoice = document.activeElement instanceof HTMLButtonElement
      && document.activeElement.classList.contains("connection-word-choice")
      ? document.activeElement
      : null;
    if (!activeChoice) return;
    event.preventDefault();
    event.stopPropagation();
    activeChoice.click();
  }, []);

  const selectStudyScope = useCallback(async (verse: number, extend: boolean): Promise<boolean> => {
    const ownerContextKey = currentMarkingContextKeyRef.current;
    if (currentMarkingContextKeyRef.current !== ownerContextKey) return false;
    if (!handleDismissConnectionFocus()) return false;
    setPhraseSelection(null);
    setShowHighlightPalette(false);
    window.getSelection()?.removeAllRanges();
    const result = nextVerseSelection(
      selectedVerses,
      verseSelectionAnchorRef.current,
      verse,
      extend,
    );
    verseSelectionAnchorRef.current = result.anchor;
    setSelectedVerses(result.selection);
    advanceSelectionGeneration();
    // The active tab owns the reading canvas. In an entity tab this updates
    // that tab's Study subject without silently closing the research return point.
    onEnsureMarginVisible?.();
    return true;
  }, [advanceSelectionGeneration, handleDismissConnectionFocus, onEnsureMarginVisible, selectedVerses]);

  const handleVerseClick = useCallback(async (verse: number, event: React.MouseEvent<HTMLDivElement>): Promise<void> => {
    const ownerContextKey = currentMarkingContextKeyRef.current;
    // A drag-selection's trailing click is residue — mouseup already created
    // the exact marking selection. Consuming it also prevents a connected
    // phrase beneath the drag endpoint from stealing the gesture.
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    const nativeSelection = window.getSelection();
    const nativeSelectionCollapsed = nativeSelection?.isCollapsed ?? true;
    const unmodified = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    const hits = nativeSelectionCollapsed && unmodified
      ? (connectionWordHitTestRef.current?.(event.clientX, event.clientY) ?? [])
      : [];
    const intent = resolveReadingPointerIntent({
      nativeSelectionCollapsed,
      connectionHitCount: hits.length,
      insideVerse: true,
    });

    if (intent === "marking-selection") return;
    if (intent === "connection") {
      event.stopPropagation();
      const ordered = orderConnectionWordHits(
        hits.map((hit) => ({ id: hit.connection.id, value: hit, area: hit.area })),
        selectedConnectionId,
        heldConnectionIdsRef.current,
      ).map((candidate) => candidate.value);
      if (ordered.length === 1) {
        void handleSelectConnection(ordered[0]!.connection);
        return;
      }
      if (ordered.length === 0) return;
      if (!requireSafeConnectionNavigation()) return;
      const origin = event.currentTarget;
      const anchorRect = new DOMRect(event.clientX, event.clientY, 1, 1);
      void requestScriptureWorkspaceAttention().then((proceed) => {
        if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
        if (!proceed) return;
        connectionWordChooserOriginRef.current = origin;
        setConnectionWordChooser({ anchorRect, hits: ordered });
      });
      return;
    }

    if (!await selectStudyScope(verse, event.shiftKey)) return;
  }, [handleSelectConnection, requestScriptureWorkspaceAttention, requireSafeConnectionNavigation, selectStudyScope, selectedConnectionId]);

  const handleVerseKeyDown = useCallback(async (verse: number, event: React.KeyboardEvent<HTMLDivElement>): Promise<void> => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      const verses = chapterData?.verses ?? [];
      const index = verses.findIndex((item) => item.verse === verse);
      let targetVerse: number | null = null;
      if (event.key === "ArrowUp" && index > 0) targetVerse = verses[index - 1]!.verse;
      if (event.key === "ArrowDown" && index >= 0 && index < verses.length - 1) targetVerse = verses[index + 1]!.verse;
      if (event.key === "Home" && verses.length > 0) targetVerse = verses[0]!.verse;
      if (event.key === "End" && verses.length > 0) targetVerse = verses[verses.length - 1]!.verse;
      if (targetVerse != null) {
        event.preventDefault();
        verseRowRefs.current.get(targetVerse)?.focus();
        return;
      }
    }

    // M is the deliberate keyboard equivalent of dragging a whole verse.
    // Enter/Space remain the ordinary Study action and can never trigger a
    // carried dock authoring tool.
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      const ownerContextKey = currentMarkingContextKeyRef.current;
      if (currentMarkingContextKeyRef.current !== ownerContextKey) return;
      if (!handleDismissConnectionFocus()) return;
      const next = new Set([verse]);
      closeConnectionWordChooser(false);
      setPhraseSelection(null);
      verseSelectionAnchorRef.current = verse;
      setSelectedVerses(next);
      advanceSelectionGeneration();
      positionPalette(next);
      setShowHighlightPalette(true);
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    await selectStudyScope(verse, event.shiftKey);
  }, [advanceSelectionGeneration, chapterData, closeConnectionWordChooser, handleDismissConnectionFocus, positionPalette, selectStudyScope]);

  // Connection focus is a temporary reading lens. A completed primary click
  // outside its own controls hides the bracket/card while preserving the
  // ordered held comparisons. Verse rows resolve this themselves so one click
  // can dismiss and select Study without a fallback-route flash.
  useEffect(() => {
    if (!selectedConnectionId) return;
    const handleOutsideClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      // A dirty card owns its exit decision. Unmounting it during the native
      // click bubble would strand the async workspace coordinator before it
      // can present Save, Discard, or Keep editing.
      if (document.querySelector('.connection-card[data-dirty="true"]')) return;
      const target = event.target instanceof Element
        ? event.target
        : event.target instanceof Node ? event.target.parentElement : null;
      if (!target) return;
      if (target.closest([
        ".verse-line",
        ".connection-card",
        ".connection-route-hit",
        "[data-connection-tick]",
        ".connection-word-chooser",
        ".marking-floating-host",
            ".marking-dock-host",
        "[data-study-workspace-bar]",
        "[data-floating-layer]",
        ".popover-scrim",
      ].join(", "))) return;
      // A higher layer owns its own click-away sequence. Do not let the click
      // that closes it leak through and dismiss the relationship beneath it.
      if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"]')) return;
      handleDismissConnectionFocus();
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [handleDismissConnectionFocus, selectedConnectionId]);

  const handleCreateConnection = useCallback(async (
    kind: ConnectionKind,
    anchors: ConnectionAnchorV2[],
    label: string,
    observation: string,
    commandId: string,
    isRecovery = false,
  ): Promise<ConnectionMutationUiOutcome> => {
    const result = await safeCall(() => window.api.library.createConnection(
      kind,
      label,
      observation,
      anchors,
      commandId,
    ));
    if (!result.ok || !result.value.ok) {
      // The authoring surface owns this recoverable state and the exact Retry
      // command. A second transient message would outlive that state and could
      // contradict the eventual idempotent success.
      return "failed";
    }
    const reload = await reloadMarginHighlights({ preserveConnection: result.value.connection });
    if (
      needsLocalConnectionReconciliation(reload.status, result.value)
      && !isRecovery
      && result.value.connection
      && currentChapterKeyRef.current === `${sessionOwnerTabId}:${book}:${chapter}`
    ) {
      setMarginData((current) => ({
        ...current,
        connections: reconcileCreatedConnection(current.connections, result.value.connection!),
      }));
    }
    if (isConnectionProjectionPending(result.value)) {
      return "committed-pending";
    }
    showToast(`${label} saved`, undefined, undefined, { tone: "success" });
    return "complete";
  }, [book, chapter, reloadMarginHighlights, sessionOwnerTabId, showToast]);

  const handleUpdateConnection = useCallback(async (
    connectionId: string,
    kind: ConnectionKind,
    anchors: ConnectionAnchorV2[],
    label: string,
    observation: string,
    commandId: string,
    expectedBaseEventId: string,
  ): Promise<ConnectionMutationUiOutcome> => {
    const result = await safeCall(() => window.api.library.updateConnection(
      connectionId,
      kind,
      label,
      observation,
      anchors,
      commandId,
      expectedBaseEventId,
    ));
    if (!result.ok || !result.value.ok) {
      if (result.ok && result.value.conflict) {
        const conflictReload = await reloadMarginHighlights({
          preserveConnection: visibleMarginData.connections.find((connection) => connection.id === connectionId),
        });
        showToast(
          conflictReload.status === "applied"
            ? "This connection changed elsewhere. Its current authored version was reloaded; review it before editing again."
            : conflictReload.status === "superseded"
              ? "This connection changed elsewhere. A newer reading request now owns the view; no edit was applied."
              : "This connection changed elsewhere. No edit was applied, but its current version could not be reloaded yet.",
          undefined,
          undefined,
          { tone: "warning", durationMs: 8_000 },
        );
        return "conflict";
      }
      return "failed";
    }
    const reload = await reloadMarginHighlights({ preserveConnection: result.value.connection });
    if (
      reload.status !== "superseded"
      && result.value.connection
      && currentChapterKeyRef.current === `${sessionOwnerTabId}:${book}:${chapter}`
    ) {
      setMarginData((current) => ({
        ...current,
        connections: reconcileUpdatedConnection(
          current.connections,
          result.value.connection!,
          expectedBaseEventId,
        ),
      }));
    }
    if (isConnectionProjectionPending(result.value)) {
      return "committed-pending";
    }
    showToast("Connection updated", undefined, undefined, { tone: "success" });
    return "complete";
  }, [book, chapter, reloadMarginHighlights, sessionOwnerTabId, showToast, visibleMarginData.connections]);

  const focusLivingMarginHeading = useCallback((): void => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#living-margin-title")?.focus({ preventScroll: true });
    });
  }, []);

  const handleDeleteConnection = useCallback(async (
    connection: ConnectionRecord,
    commandId: string,
    expectedBaseEventId = connection.activeEventId,
  ): Promise<ConnectionMutationUiOutcome> => {
    const result = await safeCall(() => window.api.library.deleteConnection(
      connection.id,
      commandId,
      expectedBaseEventId,
    ));
    if (!result.ok || !result.value.ok) {
      if (result.ok && result.value.conflict) {
        const conflictReload = await reloadMarginHighlights({ preserveConnection: connection });
        showToast(
          conflictReload.status === "applied"
            ? "This connection changed elsewhere. Its current authored version was reloaded; review it before deleting."
            : conflictReload.status === "superseded"
              ? "This connection changed elsewhere. A newer reading request now owns the view; nothing was deleted."
              : "This connection changed elsewhere. Nothing was deleted, but its current version could not be reloaded yet.",
          undefined,
          undefined,
          { tone: "warning", durationMs: 8_000 },
        );
        return "conflict";
      }
      return "failed";
    }
    const projectionPending = isConnectionProjectionPending(result.value);
    const reload = await reloadMarginHighlights(
      projectionPending ? { preserveConnection: connection } : undefined,
    );
    // Keep the card and its exact command mounted while Derived recovery is
    // pending. Removing it here would discard the only safe Retry identity.
    if (
      !projectionPending
      && reload.status !== "superseded"
      && currentChapterKeyRef.current === `${sessionOwnerTabId}:${book}:${chapter}`
    ) {
      setMarginData((current) => ({
        ...current,
        connections: reconcileDeletedConnection(
          current.connections,
          connection.id,
          expectedBaseEventId,
        ),
      }));
    }
    if (projectionPending) {
      return "committed-pending";
    }
    releaseHeldConnection(connection.id);
    focusLivingMarginHeading();
    showToast("Connection deleted", undefined, undefined, { tone: "success" });
    return "complete";
  }, [book, chapter, focusLivingMarginHeading, releaseHeldConnection, reloadMarginHighlights, sessionOwnerTabId, showToast]);

  const handleCloseConnection = useCallback((restoreFocus = false): void => {
    const connectionId = selectedConnectionId;
    if (!connectionId) return;
    releaseHeldConnection(connectionId, restoreFocus);
  }, [releaseHeldConnection, selectedConnectionId]);

  const handleExtendConnection = useCallback((connection: ConnectionRecordV2): void => {
    const paintAnchors = currentConnectionPaintProjections.get(connection.id)?.anchors ?? [];
    setConnectionExtension({
      nonce: ++connectionExtensionNonce.current,
      contextKey: currentMarkingContextKeyRef.current,
      connection,
      paintAnchors,
    });
    releaseHeldConnection(connection.id);
    showToast("Select words to add, then finish the connection.");
  }, [currentConnectionPaintProjections, releaseHeldConnection, showToast]);

  const handleNoteFromConnection = useCallback((connection: ConnectionRecord): void => {
    const localAnchors = connection.anchors.filter((anchor) => anchor.book === book && anchor.chapter === chapter);
    const first = localAnchors[0] ?? connection.anchors[0];
    if (!first) return;
    const last = localAnchors.at(-1) ?? first;
    const passageRef = connection.anchors.map((anchor) => {
      const bookName = bookNames[anchor.book]?.[0] ?? anchor.book;
      const verse = anchor.verse_start === anchor.verse_end
        ? `${anchor.verse_start}`
        : `${anchor.verse_start}–${anchor.verse_end}`;
      return `${bookName} ${anchor.chapter}:${verse}`;
    }).join(" · ");
    const paintAnchors = currentConnectionPaintProjections.get(connection.id)?.anchors ?? [];
    const quote = connection.anchors.map((anchor, index) => {
      const ref = `${anchor.book} ${anchor.chapter}:${anchor.verse_start}${anchor.verse_end === anchor.verse_start ? "" : `–${anchor.verse_end}`}`;
      const projectedQuote = paintAnchors[index]?.fragments
        .map((fragment) => fragment.quote)
        .join(" ")
        .trim();
      const locatorQuote = anchor.render_locator?.package === packageId
        ? anchor.render_locator.quote
        : null;
      return `${ref} — ${projectedQuote || locatorQuote || "Exact wording unavailable in this translation"}`;
    }).join("\n");
    setNoteDraft({
      title: connection.label,
      passageRef,
      quote,
      book: first.book,
      chapter: first.chapter,
      verseStart: first.verse_start,
      verseEnd: last.book === first.book && last.chapter === first.chapter ? last.verse_end : first.verse_end,
      packageId,
    });
  }, [book, bookNames, chapter, currentConnectionPaintProjections, packageId]);

  const handleJumpToConnectionAnchor = useCallback((anchor: ConnectionAnchor): void => {
    const end = anchor.verse_end === anchor.verse_start
      ? ""
      : `-${anchor.book}.${anchor.chapter}.${anchor.verse_end}`;
    handleNavigateToRef(`bref:v1/${anchor.book}.${anchor.chapter}.${anchor.verse_start}${end}`);
  }, [handleNavigateToRef]);

  // Reset nearVerse immediately on chapter/book change, together with every
  // owner-sensitive canvas state that cannot leak into the next text. An
  // intentional target snapshot (history restore or fresh reference jump)
  // restores its exact selection after that cleanup.
  useEffect(() => {
    advanceSelectionGeneration();
    setNearVerse(null);
    marginActiveRef.current = false;
    setShowHighlightPalette(false);
    setAnimateIds(new Set());
    setFadingIds(new Set());
    setPhraseSelection(null);
    heldConnectionIdsRef.current = [];
    setHeldConnectionIds([]);
    setSelectedConnectionId(null);
    closeConnectionWordChooser(false);
    setConnectionExtension(null);
    const restoreEntry = passageRestoreEntryForContext(
      pendingPassageRestoreRef.current,
      { ownerTabId: sessionOwnerTabId, book, chapter, packageId },
    );
    if (restoreEntry) {
      applyPassageSelectionRestore(restoreEntry);
    } else {
      setSelectedVerses(new Set());
      verseSelectionAnchorRef.current = null;
    }
  }, [advanceSelectionGeneration, applyPassageSelectionRestore, book, chapter, closeConnectionWordChooser, packageId, sessionOwnerTabId]);

  /* THERE IS NO FILTER STATE, 2026-07-30, and this is where it was.
     A `studyFilterId` lived here for a few hours, with a follow effect keyed on
     the active tab having moved, so that a chip could narrow the strip and a
     Ctrl+Tab across studies could widen it back. Both went with the "All" view:
     the strip shows the study the page is in, full stop, so which study it
     shows is `workspace.tabsById[activeTabId].groupId` — already persisted,
     already restored, already correct on launch, and incapable of disagreeing
     with the page. Selection leads and the line follows because there is
     nothing left in between them to get out of step.

     Nothing goes in this place. If a future surface needs to show a study the
     page is not in, it is a list, not a state on this component. */

  // Phrase offsets and highlight animations belong to one translation's text
  // shape, so they cannot survive a package change. Whole-verse selection and
  // its canonical anchor do survive: those coordinates are translation-free.
  useEffect(() => {
    advanceSelectionGeneration();
    setNearVerse(null);
    marginActiveRef.current = false;
    suppressNextClickRef.current = false;
    // A range captured before a long-press belongs to the text that was on
    // screen. It cannot be handed back into a different chapter or edition.
    versesBeforeWordSelectionRef.current = null;
    committedTouchSelectionRef.current = null;
    setShowHighlightPalette(false);
    setAnimateIds(new Set());
    setFadingIds(new Set());
    const restoreEntry = passageRestoreEntryForContext(
      pendingPassageRestoreRef.current,
      { ownerTabId: sessionOwnerTabId, book, chapter, packageId },
    );
    if (restoreEntry) {
      applyPassageSelectionRestore(restoreEntry);
    } else {
      setPhraseSelection(null);
    }
    closeConnectionWordChooser(false);
    setConnectionExtension(null);
  }, [advanceSelectionGeneration, applyPassageSelectionRestore, book, chapter, closeConnectionWordChooser, packageId, sessionOwnerTabId]);

  return (
    <div className="scripture-page">

      {/* THE DRAG BAND, AND NOTHING ELSE · restored 2026-08-03.
          Rev 05 §05·2's own words for this row, given back to it. It held a row
          of study chips for one wave, and that cost three things at once: with
          the rail collapsed to 56 the window's own buttons were drawn over the
          first chip, the band could not be grabbed because everything standing
          in it opts out of the drag region, and in fullscreen the row lay flush
          against the screen's top edge where the menu bar drops. The studies are
          one row down now — see StudyControl, passed into the strip below — and
          what is left here is what the frame reserved in the first place.

          It keeps its height, so --frame-top is the same 54 it has always been
          and tests/quire-frame-top-edge-contract holds unchanged. Empty is the
          POINT rather than an oversight: in fullscreen the revealed menu bar now
          lands on 24px of chrome carrying nothing, and a reader reaching for the
          window can grab it anywhere along the page's whole width. */}
      {!focusMode && <div className="scripture-study-line" data-study-drag-band="" />}

      {!focusMode && (
        <ScriptureWorkspaceTabs
          workspace={studyWorkspace}
          bookNames={bookNames}
          onSelect={(tabId) => onWorkspaceTabSelect?.(tabId) ?? Promise.resolve(false)}
          onClose={(tabId) => onWorkspaceTabClose?.(tabId) ?? Promise.resolve(false)}
          onCloseGroup={(groupId) => onWorkspaceGroupClose?.(groupId) ?? Promise.resolve(false)}
          onRenameGroup={(groupId, label) => (
            onWorkspaceGroupRename?.(groupId, label) ?? Promise.resolve(false)
          )}
          onMoveTab={(tabId, targetGroupId) => (
            onWorkspaceTabMove?.(tabId, targetGroupId) ?? Promise.resolve(false)
          )}
          onPromoteTab={(tabId) => onWorkspaceTabPromote?.(tabId) ?? Promise.resolve(false)}
          onTabDragOverStudy={setTabDropStudyId}
          onTabDragActive={setTabDragActive}
          studies={(
            <StudyControl
              workspace={studyWorkspace}
              bookNames={bookNames}
              onSelectTab={(tabId) => onWorkspaceTabSelect?.(tabId) ?? Promise.resolve(false)}
              onRenameStudy={(groupId, label) => (
                onWorkspaceGroupRename?.(groupId, label) ?? Promise.resolve(false)
              )}
              onCloseStudy={(groupId) => onWorkspaceGroupClose?.(groupId) ?? Promise.resolve(false)}
              onStartStudy={() => onStartStudy?.() ?? Promise.resolve(false)}
              onNewTab={() => (onOpenResearchPalette ?? onOpenCommandPalette)?.()}
              namingRequest={studyNamingRequest}
              tabDragActive={tabDragActive}
              dropTargetStudyId={tabDropStudyId}
            />
          )}
          onReorderTab={(tabId, position) => (
            onWorkspaceTabReorder?.(tabId, position) ?? Promise.resolve(false)
          )}
          onReorderGroup={(groupId, position) => (
            onWorkspaceGroupReorder?.(groupId, position) ?? Promise.resolve(false)
          )}
          onReopenRecent={() => onWorkspaceRecentReopen?.() ?? Promise.resolve(false)}
          onReopenRecentItem={(index) => onWorkspaceRecentReopen?.(index) ?? Promise.resolve(false)}
          onDuplicateTab={() => onWorkspaceTabDuplicate?.() ?? Promise.resolve(false)}
          onNewResearch={() => (onOpenResearchPalette ?? onOpenCommandPalette)?.()}
          persistenceStatus={workspacePersistenceStatus}
          onRetryPersistence={onRetryWorkspacePersistence}
        />
      )}

      <div
        id="scripture-workspace-panel"
        className="scripture-body"
        role="tabpanel"
        aria-labelledby={`study-workspace-tab-${studyWorkspace.activeTabId}`}
        data-study-canvas-owner={restoredSessionOwnerTabId === sessionOwnerTabId ? sessionOwnerTabId : undefined}
      >
      <div className="scripture-reading-stage" ref={stageRef}>
      <div
        className="scripture-content"
        ref={contentRef}
        onPointerDown={handlePagePointerDown}
        onPointerMove={handlePagePointerMove}
        onPointerUp={handlePagePointerUp}
        onPointerCancel={handlePagePointerCancel}
      >
      
      <header className={`scripture-topbar${scrolled ? " scrolled" : ""}`} role="toolbar" aria-label="Reading toolbar">
        <div className="topbar-navigation">
        <div className="canvas-history-arrows" role="group" aria-label="Reading history">
          <Tooltip label="Back" shortcut="Alt+←">
            <button
              type="button"
              className="nav-arrow history-nav-arrow"
              onClick={navigateBack}
              disabled={navigationHistory.back.length === 0 || connectionNavigationLocked}
              aria-label="Back"
              aria-keyshortcuts="Alt+ArrowLeft"
            >
              <ChapterArrowIcon direction="previous" />
            </button>
          </Tooltip>
          <Tooltip label="Forward" shortcut="Alt+→">
            <button
              type="button"
              className="nav-arrow history-nav-arrow"
              onClick={navigateForward}
              disabled={navigationHistory.forward.length === 0 || connectionNavigationLocked}
              aria-label="Forward"
              aria-keyshortcuts="Alt+ArrowRight"
            >
              <ChapterArrowIcon direction="next" />
            </button>
          </Tooltip>
        </div>
        <div className="passage-picker-group" aria-label="Chapter navigation">
          <button
            ref={passageBtnRef}
            type="button"
            className={`passage-picker-btn${passageOpen ? " open" : ""}`}
            onClick={openPassagePopover}
            title="Choose passage"
            aria-label={`Choose passage. Current passage: ${displayBookName} ${chapter}`}
            aria-haspopup="dialog"
            aria-expanded={passageOpen}
            disabled={connectionNavigationLocked}
          >
            <span className="passage-picker-book">{displayBookName}</span>{" "}
            <span className="passage-picker-chapter">{chapter}</span>
            <ChevronIcon />
          </button>
          {/* Drawn in §E beside the reference and never rendered until now. It
              is the answer to "how far through this book am I", which the
              chapter arrows ask on every press, and chapterCount was already
              computed for exactly those arrows. It sits outside the picker
              button so pressing the reference still means "choose a passage"
              rather than "choose a passage, of 28". */}
          {chapterCount > 0 && (
            <span className="passage-chapter-count">of {chapterCount}</span>
          )}
          <div className="chapter-nav-arrows" role="group" aria-label="Move by chapter">
            <Tooltip label="Previous chapter" shortcut="⌘←">
              <button
                type="button"
                className="nav-arrow"
                onClick={handlePreviousChapterClick}
                onAuxClick={handlePreviousChapterAuxClick}
                disabled={chapter <= 1 || connectionNavigationLocked}
                aria-label="Previous chapter"
                aria-description="Command- or Control-click, or middle-click, to open in a new tab"
                data-open-passage-tab-on-modifier="previous"
              >
                <ChapterArrowIcon direction="previous" />
              </button>
            </Tooltip>
            <Tooltip label="Next chapter" shortcut="⌘→">
              <button
                type="button"
                className="nav-arrow"
                onClick={handleNextChapterClick}
                onAuxClick={handleNextChapterAuxClick}
                disabled={chapter >= chapterCount || connectionNavigationLocked}
                aria-label="Next chapter"
                aria-description="Command- or Control-click, or middle-click, to open in a new tab"
                data-open-passage-tab-on-modifier="next"
              >
                <ChapterArrowIcon direction="next" />
              </button>
            </Tooltip>
          </div>

          {passageOpen && (
            <Popover
              anchorRect={passageAnchor}
              onClose={closePassagePopover}
              width={340}
              className="passage-picker-popover"
              ariaLabel="Choose passage"
            >
              {passageView === "chapters" && (
                <>
                  {recents.length > 0 && (
                    <div className="picker-recents">
                      <div className="picker-recents-head">
                        <span className="picker-recents-label">Recent</span>
                      </div>
                      <div className="picker-recents-row" role="list">
                        {recents.map((r) => {
                          const label = formatRecentLabel(r, bookNames);
                          const isHere = r.book === book && r.chapter === chapter;
                          return (
                            <div key={`${r.book}:${r.chapter}`} className="picker-recent-chip-wrap" role="listitem">
                              <button
                                type="button"
                                className={`picker-recent-chip${isHere ? " active" : ""}`}
                                onClick={(event) => activatePassagePickerTarget({
                                  book: r.book,
                                  chapter: r.chapter,
                                  ...(r.verse != null ? { verse: r.verse } : {}),
                                  packageId: r.packageId,
                                }, event)}
                                onAuxClick={(event) => {
                                  if (event.button !== 1) return;
                                  activatePassagePickerTarget({
                                    book: r.book,
                                    chapter: r.chapter,
                                    ...(r.verse != null ? { verse: r.verse } : {}),
                                    packageId: r.packageId,
                                  }, event);
                                }}
                                title={label}
                                aria-description="Command- or Control-click, or middle-click, to open in a new tab"
                                aria-current={isHere ? "page" : undefined}
                              >
                                <span className="picker-recent-ref">{label}</span>
                                <span className="picker-recent-pkg">{r.packageId.toUpperCase()}</span>
                              </button>
                              <button
                                type="button"
                                className="picker-recent-dismiss"
                                title="Remove from recent"
                                aria-label={`Remove ${label} from recent`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRecents((prev) => removeRecent(prev, r));
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="picker-title-row">
                    <div className="picker-title">
                      <span className="picker-title-book">{browseBookName}</span>
                      <span className="picker-title-sep" aria-hidden="true">·</span>
                      <span className="picker-title-meta">chapters</span>
                    </div>
                    <button type="button" className="picker-title-action" onClick={openBooksView}>
                      All books
                      <span className="picker-title-action-chev" aria-hidden="true">›</span>
                    </button>
                  </div>

                  <div className="chapter-grid">
                    {Array.from({ length: backbone.books[browseBook]?.chapters.length ?? 0 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`chapter-grid-num${browseBook === book && chapter === n ? " active" : ""}`}
                        onClick={(event) => activatePassagePickerTarget({ book: browseBook, chapter: n }, event)}
                        onAuxClick={(event) => {
                          if (event.button !== 1) return;
                          activatePassagePickerTarget({ book: browseBook, chapter: n }, event);
                        }}
                        aria-label={`Go to ${browseBookName} ${n}`}
                        aria-description="Command- or Control-click, or middle-click, to open in a new tab"
                        aria-current={browseBook === book && chapter === n ? "page" : undefined}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {passageView === "books" && (
                <>
                  <div className="picker-title-row">
                    <button type="button" className="picker-back" onClick={() => setPassageView("chapters")}>
                      <BackChevronIcon />
                      <span>{browseBookName}</span>
                    </button>
                    <div className="picker-title picker-title-books">
                      <span className="picker-title-meta">Books</span>
                    </div>
                  </div>
                  <div className="popover-search">
                    <SearchIconSmall />
                    <input
                      ref={bookSearchRef}
                      type="text"
                      placeholder="Search books (1co, ps, rev…)"
                      value={bookQuery}
                      onChange={(e) => setBookQuery(e.target.value)}
                      aria-label="Search Bible books"
                    />
                  </div>
                  <div className="popover-scroll">
                    {filteredOt.length > 0 && (
                      <>
                        <div className="popover-group-label">Old Testament</div>
                        <div className="book-grid">
                          {filteredOt.map((b) => (
                            <button
                              key={b}
                              className={`book-grid-item${b === browseBook ? " active" : ""}`}
                              onClick={() => handleBookPick(b)}
                            >
                              {bookNames[b]?.[0] ?? b}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {filteredNt.length > 0 && (
                      <>
                        <div className="popover-group-label">New Testament</div>
                        <div className="book-grid">
                          {filteredNt.map((b) => (
                            <button
                              key={b}
                              className={`book-grid-item${b === browseBook ? " active" : ""}`}
                              onClick={() => handleBookPick(b)}
                            >
                              {bookNames[b]?.[0] ?? b}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {filteredOt.length === 0 && filteredNt.length === 0 && (
                      <div className="popover-no-match">No books match your search.</div>
                    )}
                  </div>
                </>
              )}
            </Popover>
          )}
        </div>

        {/* §E draws no field in this band at all — quire-f keeps a trigger for
            the palette and nothing else — so the search is a word standing
            beside the other words. What was here was a 190px box with a border
            on all four sides and a tint of its own, which made it the only
            enclosure and the only third plane in the one band that is supposed
            to stay silent. It was also a button dressed as an input, promising
            a cursor it never gave you.

            The class list is deliberately unchanged: three contract tests name
            `passage-jump command-palette-trigger` and the palette's own QA
            tours click it by the second class. Only the drawing of it moves.
            The label span is renamed because its old class belongs to the
            palette's rules, which are not ours to restyle. */}
        <button
          type="button"
          className="passage-jump command-palette-trigger"
          onClick={onOpenCommandPalette}
          aria-label="Search Scripture, notes, people, places, and actions"
          aria-haspopup="dialog"
        >
          <span className="passage-jump-label">Search</span>
          <kbd className="passage-jump-shortcut" aria-hidden="true">⌘K</kbd>
        </button>
        </div>

        <div className="topbar-spacer" />

        {/* §E: five instruments, in one fixed order — translation, comfort,
            margin, focus, theme — each the word for what it operates, in mono
            at 9.5px. Each renders only when its handler exists, and because
            the cluster is a single flex row an absent one leaves no gap: the
            header loses instruments without losing shape. The order is the
            contract, so a new instrument goes at its place in it or nowhere. */}
        <div className="topbar-tools" aria-label="Reading tools">
          <div className="version-picker-group">
            {/* The visible text is a three-letter code, which is why this one
                keeps an aria-label naming the translation in full — the other
                instruments are already words and need no translation of their
                own. The chevron goes: a word with a caret beside it is the
                header explaining twice that pressing things opens things. */}
            <button
              ref={versionBtnRef}
              type="button"
              className="topbar-instrument"
              data-instrument="translation"
              onClick={openVersionPopover}
              aria-label={`Choose Bible translation. Current translation: ${packageId.toUpperCase()}`}
              aria-haspopup="dialog"
              aria-expanded={versionOpen}
              disabled={connectionNavigationLocked}
            >
              {packageId.toUpperCase()}
            </button>
            {versionOpen && (
              <Popover
                anchorRect={versionAnchor}
                onClose={closeVersionPopover}
                width={280}
                className="version-picker-popover"
                ariaLabel="Choose Bible translation"
              >
                <div className="picker-menu-heading">
                  <span>Bible text</span>
                  <small>Notes stay anchored when the translation changes.</small>
                </div>
                {TRANSLATIONS.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    className={`control-menu-item version-picker-item${t.code === packageId ? " active" : ""}`}
                    onClick={() => {
                      const changeTranslation = (): void => {
                        captureTranslationViewport(t.code);
                        // Clear the old translation's DOM in the same approved
                        // commit as the package switch so package-specific paint
                        // can never appear over the previous text.
                        setChapterData(null);
                        setChapterError(null);
                        setShowHighlightPalette(false);
                        setPhraseSelection(null);
                        setPackageId(t.code);
                        closeVersionPopover();
                      };
                      if (t.code !== packageId) {
                        void requestWorkspaceTransition("translation-change", changeTranslation);
                      } else {
                        closeVersionPopover();
                      }
                    }}
                    aria-pressed={t.code === packageId}
                  >
                    <span className="version-picker-code">{t.code.toUpperCase()}</span>
                    <span className="version-picker-name">{t.name}</span>
                    {t.code === packageId && <CheckIcon />}
                  </button>
                ))}
              </Popover>
            )}
          </div>

          {onReadingPrefsChange && (
            <ReadingComfort
              prefs={{ readingSize, verseNumbers }}
              onChange={onReadingPrefsChange}
            />
          )}

          {/* No tooltip, and the accessible name no longer flips between "Show
              Study" and "Hide Study": the word stays put and aria-pressed
              carries the state, which is the same decision the underline makes
              visually. A name that changes as you press it is a second, quieter
              reflow. */}
          {onToggleMargin && !focusMode && (
            <button
              type="button"
              className="topbar-instrument"
              data-instrument="margin"
              onClick={() => {
                if (requireSafeConnectionNavigation()) onToggleMargin();
              }}
              disabled={connectionNavigationLocked}
              aria-pressed={marginVisible}
            >
              Margin
            </button>
          )}

          {/* The F shortcut lived in a tooltip that is now gone, so it is
              declared where it belongs: aria-keyshortcuts states it to assistive
              technology instead of to a hover. */}
          {onToggleFocus && (
            <button
              type="button"
              className="topbar-instrument"
              data-instrument="focus"
              onClick={() => {
                if (requireSafeConnectionNavigation()) onToggleFocus();
              }}
              aria-pressed={focusMode}
              aria-keyshortcuts="f"
            >
              Focus
            </button>
          )}

          {onThemeChange && (
            <ThemePicker
              theme={theme}
              onChange={onThemeChange}
              material={material}
              {...(onMaterialChange ? { onMaterialChange } : {})}
            />
          )}
        </div>
      </header>
        <article className="scripture-inner" aria-labelledby="reading-chapter-title">
          <div className="chapter-header">
            <h1 id="reading-chapter-title" className="chapter-title" ref={chapterHeadingRef} tabIndex={-1}>
              <span className="book-name">{displayBookName}</span>
              {" "}
              <span className="chapter-number">{chapter}</span>
            </h1>
          </div>

          <div
            className={[
              "verse-text",
              multiVerseSelect || mixedSelectionColors ? "has-multi-select" : "",
              pinnedRange ? "has-pin" : "",
            ].filter(Boolean).join(" ")}
            ref={verseTextRef}
            aria-busy={!chapterData && !chapterError}
          >
            <HighlightUnderlay
              containerRef={verseTextRef}
              verseRowRefs={verseRowRefs}
              highlights={normalizedHighlights}
              book={book}
              chapter={chapter}
              animateIds={animateIds}
              fadingIds={fadingIds}
              themeToken={theme}
              pinRange={pinnedRange}
            />
            <ConnectionUnderlay
              containerRef={verseTextRef}
              verseRowRefs={verseRowRefs}
              connections={visibleMarginData.connections}
              paintProjections={currentConnectionPaintProjections}
              draftConnection={connectionDraft?.contextKey === `${sessionOwnerTabId}:${book}:${chapter}:${packageId}` ? connectionDraft : null}
              selectionEmphasis={markingSelectionEmphasis}
              book={book}
              chapter={chapter}
              packageId={packageId}
              contentRevision={chapterData}
              themeToken={theme}
              focusMode={focusMode}
              selectedConnectionId={selectedConnectionId}
              heldConnectionIds={visibleHeldConnectionIds}
              openTickGroupMemberIds={connectionWordChooser?.aggregateMemberIds ?? null}
              onSelectConnection={handleSelectConnection}
              onDismissFocus={() => { handleDismissConnectionFocus(false); }}
              onChooseConnections={handleChooseConnections}
              wordHitTestRef={connectionWordHitTestRef}
            />
            {chapterData?.verses.map((v, idx) => {
              const prevV = chapterData.verses[idx - 1];
              const contAbove = !!prevV && verseBridges.has(prevV.verse);
              const contBelow = verseBridges.has(v.verse);
              const isSelected = selectedVerses.has(v.verse);
              const hasNote = versesWithNotes.has(v.verse);
              const rowClasses = [
                "verse-line",
                isSelected ? "selected" : "",
                isSelected && multiVerseSelect ? "multi-select" : "",
                isSelected && mixedSelectionColors ? "mixed-select" : "",
                getHighlightClass(v.verse),
                contAbove ? "cont-above" : "",
                contBelow ? "cont-below" : "",
                hasNote ? "has-note" : "",
                apparatusLoading ? "apparatus-loading" : "",
              ].filter(Boolean).join(" ");
              const textClasses = [
                "verse-text-span",
                contAbove ? "cont-above" : "",
                contBelow ? "cont-below" : "",
              ].filter(Boolean).join(" ");
              const fold = pericopeFolds.get(v.verse);
              const row = (
                <div
                  key={v.verse}
                  data-verse={v.verse}
                  className={rowClasses}
                  role="button"
                  tabIndex={0}
                  aria-label={`${displayBookName} ${chapter}:${v.verse}. ${v.text}${isSelected ? ". Selected" : ""}`}
                  aria-pressed={isSelected}
                  aria-keyshortcuts="Enter Space M"
                  onClick={(e) => { void handleVerseClick(v.verse, e); }}
                  onKeyDown={(e) => handleVerseKeyDown(v.verse, e)}
                  ref={(el) => {
                    if (el) verseRowRefs.current.set(v.verse, el);
                    else verseRowRefs.current.delete(v.verse);
                  }}
                >
                  {/* The gutter's two remaining states. Both are absolutely
                      positioned inside the reserved 32px track, so neither can
                      widen it and neither is a grid item — the passage cannot
                      reflow when either turns on. */}
                  {hasNote && <span className="verse-note-dot" aria-hidden="true" />}
                  {apparatusLoading && <span className="verse-apparatus-tick" aria-hidden="true" />}
                  <span className="verse-num">{v.verse}</span>
                  <span className={textClasses}>{v.text}</span>
                  {/* The grips are the mark, grown. They are aria-hidden and
                      unfocusable on purpose: they duplicate a path a keyboard
                      already has (Shift with Enter or Space extends the range
                      from the anchor), so exposing them would give a screen
                      reader two controls for one act. */}
                  {verseRangeGrips?.start === v.verse && (
                    <span
                      className="verse-range-grip"
                      data-verse-range-grip="start"
                      aria-hidden="true"
                      onPointerDown={(e) => beginVerseRangeDrag("start", e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  {verseRangeGrips?.end === v.verse && (
                    <span
                      className="verse-range-grip"
                      data-verse-range-grip="end"
                      aria-hidden="true"
                      onPointerDown={(e) => beginVerseRangeDrag("end", e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              );
              if (!fold) return row;
              // The fold is a sibling row, deliberately NOT registered in
              // verseRowRefs: the highlight and connection underlays measure
              // off that map, and a non-verse row in it would shift their
              // geometry.
              return (
                <Fragment key={`fold-${v.verse}`}>
                  <div className="pericope-fold">
                    <span className="pericope-fold-rule" aria-hidden="true" />
                    <h3 className="pericope-fold-title">{fold}</h3>
                  </div>
                  {row}
                </Fragment>
              );
            })}

            {!chapterData && !chapterError && (
              <ReadingCanvasLoading passage={`${displayBookName} ${chapter}`} />
            )}

            {chapterError && (
              <ReadingCanvasError
                passage={`${displayBookName} ${chapter}`}
                error={chapterError}
                onRetry={() => setRetryToken((token) => token + 1)}
              />
            )}

            {chapterData && chapterData.verses.length === 0 && (
              <ReadingCanvasEmpty
                passage={`${displayBookName} ${chapter}`}
                onRetry={() => setRetryToken((token) => token + 1)}
              />
            )}

          </div>

          {chapterData && chapterData.verses.length > 0 && (
            <footer className="chapter-end">
              <span className="chapter-end-label">End of {displayBookName} {chapter}</span>
              {chapter < chapterCount && (
                <button
                  type="button"
                  className="chapter-continue"
                  onClick={() => {
                    void goTo(book, chapter + 1, undefined, {
                      focusHeading: true,
                      recordRecent: false,
                    });
                  }}
                  aria-label={`Continue to ${displayBookName} ${chapter + 1}`}
                  disabled={connectionNavigationLocked}
                >
                  <span>Continue to {displayBookName} {chapter + 1}</span>
                  <ChapterArrowIcon direction="next" />
                </button>
              )}
            </footer>
          )}
        </article>
      </div>

      <MarkingSurface
        surface={markingSurface}
        theme={theme}
        focusMode={focusMode}
        contextKey={`${sessionOwnerTabId}:${book}:${chapter}:${packageId}`}
        stageBounds={stageBounds}
        selection={showHighlightPalette ? markingSelection : null}
        extensionRequest={connectionExtension}
        onSetColor={handleHighlight}
        onNote={handleNoteFromSelection}
        onRemove={handleRemoveSelection}
        onDismissSelection={handleDismissMarkingSurface}
        onClearSelection={handleClearMarginSelection}
        onRequestReadingFocus={handleRequestReadingFocus}
        onConnectionDraftChange={setConnectionDraft}
        onDraftExitControllerChange={handleConnectionDraftExitControllerChange}
        onMutationStateChange={handleMarkingMutationStateChange}
        onCreateConnection={handleCreateConnection}
        onUpdateConnection={handleUpdateConnection}
      />
      {connectionWordChooser && (
        <Popover
          id="connection-word-chooser"
          anchorRect={connectionWordChooser.anchorRect}
          onClose={() => closeConnectionWordChooser(true)}
          width={300}
          maxHeight={520}
          boundaryRect={stageBounds}
          className="connection-word-chooser"
          ariaLabel="Connections at these words"
          modal
          initialFocusRef={connectionWordChooserFirstChoiceRef}
        >
          <header className="connection-word-chooser-head">
            <div>
              <span>Shared phrases</span>
              <strong>{connectionWordChooser.hits.length} relationships</strong>
            </div>
            <button
              type="button"
              onClick={() => closeConnectionWordChooser(true)}
              aria-label="Close connection chooser"
            >Close</button>
          </header>
          <div className="connection-word-choices" role="list" onKeyDown={handleConnectionWordChooserKeyDown}>
            {connectionWordChooser.hits.map((hit, index) => {
              const kindLabel = relationshipLabel(hit.connection.kind);
              return (
                <div key={hit.connection.id} role="listitem">
                  <button
                    ref={index === 0 ? connectionWordChooserFirstChoiceRef : undefined}
                    type="button"
                    className="connection-word-choice"
                    data-connection-id={hit.connection.id}
                    aria-current={selectedConnectionId === hit.connection.id || undefined}
                    onClick={(event) => {
                      const focusInspector = event.detail === 0;
                      void handleSelectConnection(hit.connection, focusInspector);
                    }}
                  >
                    <span>{hit.connection.label.trim() || kindLabel}</span>
                    <small>{kindLabel} · {phraseCount(hit.connection.anchors.length)}</small>
                  </button>
                </div>
              );
            })}
          </div>
        </Popover>
      )}
      </div>

      {marginVisible && !focusMode && (
        <LivingMargin
          onOpenResourceSettings={onOpenResourceSettings}
          key={sessionOwnerTabId}
          book={marginSubject.book}
          chapter={marginSubject.chapter}
          packageId={packageId}
          marginData={subjectMarginData}
          crossRefs={subjectCrossRefs}
          bookNames={bookNames}
          semanticData={marginSubject.kind === "kept" ? null : semanticData}
          semanticLoading={marginSubject.kind === "kept" ? false : semanticLoading}
          chapterVerseText={subjectChapterVerseText}
          displayChapterVerseText={marginSubject.kind === "kept" ? subjectChapterVerseText : displayChapterVerseText}
          chapterTextLoading={marginSubject.kind === "kept" ? resolvedKeptState == null : !chapterData && !chapterError}
          pinnedRange={marginSubject.kind === "selection" ? pinnedRange : null}
          nearVerse={marginSubject.kind === "selection"
            ? null
            : marginSubject.kind === "kept"
              ? marginSubject.verse
              : settledNearVerse}
          onNavigateToRef={handleNavigateToRef}
          onKeepReference={handleKeepPeekReference}
          onOpenPassageTab={handleOpenPeekPassageTab}
          onPinClaim={async (claimId, assertion) => {
            const result = await safeCall(() => window.api.ai.pinClaim(claimId, assertion));
            return result.ok && result.value.ok;
          }}
          onCreateNote={handleNoteFromSelection}
          onCapture={handleMarginCapture}
          onRemoveHighlights={(entityIds) => void handleDeleteHighlights(entityIds)}
          onStudyVerse={marginSubject.kind === "kept" ? undefined : handleStudyVerse}
          onMarginActiveChange={handleMarginActiveChange}
          ambientKept={marginSubject.kind === "kept"}
          onAmbientKeptChange={handleAmbientKeptChange}
          onClearSelection={handleClearMarginSelection}
          sessionOwnerTabId={sessionOwnerTabId}
          sessionRestoreNonce={sessionRestoreNonce}
          marginSession={sessionEntry.margin}
          onMarginSessionChange={publishMarginSessionChange}
          workspace={marginWorkspace}
          researchScrollTop={researchScrollTop}
          onResearchScrollTopChange={onResearchScrollTopChange}
          onScrollControllerChange={handleLivingMarginScrollControllerChange}
          entityResearchFocusRequest={entityResearchFocusRequest}
          onEntityResearchFocusRequestHandled={onEntityResearchFocusRequestHandled}
          entityIntent={entityIntent}
          onOpenEntity={handleOpenMarginEntity}
          onDrillEntity={onDrillEntity}
          onBranchEntity={onBranchEntity}
          onReturnEntityOrigin={onReturnEntityOrigin}
          onCloseEntity={onCloseEntity}
          entityTrail={entityTrail}
          onEntityTrailChange={onEntityTrailChange}
          authoredConnections={subjectMarginData.connections}
          connectionPaintProjections={currentConnectionPaintProjections}
          selectedAuthoredConnectionId={selectedConnectionId}
          onSelectAuthoredConnection={handleSelectAuthoredConnection}
          connectionInspectorFocusRequest={connectionInspectorFocusRequest}
          connectionInspector={selectedConnection ? (
            <ConnectionCard
              key={selectedConnection.id}
              connection={selectedConnection}
              paintAnchors={currentConnectionPaintProjections.get(selectedConnection.id)?.anchors ?? []}
              bookNames={bookNames}
              book={book}
              chapter={chapter}
              packageId={packageId}
              otherHeldCount={Math.max(0, visibleHeldConnectionIds.length - 1)}
              onClose={handleCloseConnection}
              onDismiss={handleDismissConnectionFocus}
              onJump={handleJumpToConnectionAnchor}
              onNote={handleNoteFromConnection}
              onExtend={handleExtendConnection}
              onUpdate={(connection, commandId, expectedBaseEventId) => handleUpdateConnection(
                connection.id,
                connection.kind,
                connection.anchors,
                connection.label,
                connection.observation,
                commandId,
                expectedBaseEventId,
              )}
              onDelete={handleDeleteConnection}
              onRefresh={() => { void reloadMarginHighlights(); }}
              recovery={connectionCardRecovery}
              onRecoveryChange={(recovery) => {
                handleConnectionCardRecoveryChange(selectedConnection.id, recovery);
              }}
              onMutationStateChange={handleCardMutationStateChange}
              onExitControllerChange={handleCardExitControllerChange}
            />
          ) : null}
        />
      )}
      </div>

      {noteDraft && (
        <NoteCapture
          draft={noteDraft}
          onClose={() => setNoteDraft(null)}
          onSaved={handleNoteCaptureSaved}
          onExitControllerChange={handleNoteExitControllerChange}
        />
      )}
    </div>
  );
}
