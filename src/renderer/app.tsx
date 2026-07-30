import type React from "react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  AppSettings,
  BackboneData,
  BookNameData,
  ReadingSize,
  VerseNumberMode,
} from "./api.js";
import {
  ScripturePage,
  type KeptMarginReference,
  type StudyCanvasController,
} from "./components/ScripturePage.js";
import { layerStackIsEmpty } from "./layerStack.js";
import type {
  EntityResearchOpenOptions,
  EntityResearchTarget,
  EntityResearchTrailEntry,
} from "./components/LivingMargin.js";
import { WritingSheet, type WritingDraft } from "./components/WritingSheet.js";
import { SearchView } from "./components/SearchView.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ToastProvider, type ShowToast } from "./components/Toast.js";
import { Popover } from "./components/Popover.js";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import { PericopeMark } from "./components/PericopeMark.js";
import { PodcastPlayer } from "./components/PodcastPlayer.js";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay.js";
import { WorkspaceDecisionDialog } from "./components/WorkspaceDecisionDialog.js";
import type { ReadingPrefs } from "./components/ReadingComfort.js";
import { Tooltip } from "./components/Tooltip.js";
import {
  CommandPalette,
  type CommandPaletteAction,
  type CommandPaletteMode,
  type CommandPaletteTab,
  type CommandEntityTarget,
  type CommandReadingContext,
} from "./components/CommandPalette.js";
import { isDarkTheme, type AppTheme } from "./theme.js";
import { safeCall } from "./utils/safeCall.js";
import {
  activeStudyWorkspaceSession,
  activeStudyWorkspaceTab,
  branchEntityWorkspaceTab,
  closeStudyWorkspaceGroup,
  closeStudyWorkspaceTab,
  createStudyWorkspace,
  createStudyWorkspaceGroup,
  ENTITY_RESEARCH_TRAIL_LIMIT,
  navigateEntityWorkspaceTab,
  moveStudyWorkspaceTab,
  openEntityWorkspaceTab,
  openPassageWorkspaceTab,
  orderedStudyWorkspaceTabs,
  reopenClosedStudyItem,
  reopenClosedStudyItemAt,
  renameStudyWorkspaceGroup,
  reorderStudyWorkspaceGroup,
  reorderStudyWorkspaceTab,
  resolveStudyWorkspaceDecision,
  returnEntityWorkspaceToOrigin,
  selectStudyWorkspaceTab,
  studyWorkspaceGroupLabel,
  studyWorkspaceOrdinalTabId,
  studyWorkspaceTabCloseAvailability,
  studyWorkspaceTabLabelParts,
  truncateEntityResearchTrail,
  updateActiveStudyCanvasSession,
  updateEntityWorkspaceScrollTop,
  updateEntityWorkspaceTrail,
  studyWorkspaceStripTabIds,
  type PassageWorkspaceSession,
  type PassageViewState,
  type WorkspaceConfirmation,
  type WorkspaceDecision,
  type WorkspaceMutationOutcome,
  type StudyWorkspaceStateV2,
} from "./utils/studyWorkspace.js";
import { notifyWorkspaceCapacity } from "./utils/workspaceCapacityFeedback.js";
import {
  createWorkspacePersistenceController,
  decideStudyWorkspaceClose,
  isStudyWorkspaceSnapshotAcknowledged,
  type WorkspacePersistenceController,
  type WorkspacePersistenceStatus,
} from "./utils/workspacePersistence.js";
import {
  createWorkspaceTransitionCoordinator,
  type WorkspaceExitController,
  type WorkspaceTransitionCoordinator,
  type WorkspaceTransitionReason,
} from "./utils/workspaceTransition.js";
import "./styles.css";

/** The narrow shell's breakpoint, matching styles.css's @media (max-width: 979px). */
const NARROW_SHELL = "(max-width: 979px)";

type View = "scripture" | "write" | "search" | "notes" | "settings";
type AuthoredMutationState = "idle" | "in-flight" | "recovery";
type LoadState =
  | { status: "loading" }
  | { status: "loaded"; backbone: BackboneData; bookNames: BookNameData; libraryPath: string }
  | { status: "error"; error: string }
  | { status: "first-run"; defaultPath: string };
type EntityResearchFocusRequest = {
  ownerTabId: string;
  requestId: number;
};
type PendingWorkspaceDecision = {
  resolve: (decision: WorkspaceDecision) => void;
};
type WorkspaceReorderPosition = "left" | "right" | "start" | "end";

const WRITING_DRAFT_STORAGE_KEY = "scripture.writing-draft";

function compatibilityPassageView(origin: CommandReadingContext): PassageViewState {
  return {
    book: origin.book,
    chapter: origin.chapter,
    packageId: origin.packageId,
    ...(origin.verseStart !== undefined
      ? { verse: origin.verseStart, verseOffset: 0 }
      : {}),
    scrollTop: 0,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: {},
      wordsFollowingReading: true,
    },
  };
}

function recoverWritingDraft(): WritingDraft {
  try {
    const raw = localStorage.getItem(WRITING_DRAFT_STORAGE_KEY);
    if (!raw) return { title: "", body: "" };
    const value = JSON.parse(raw) as { title?: unknown; body?: unknown };
    if (typeof value.title !== "string" || typeof value.body !== "string") {
      return { title: "", body: "" };
    }
    return { title: value.title, body: value.body };
  } catch {
    return { title: "", body: "" };
  }
}

function PanelToggleIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="12" rx="2.5" />
      <path d="M7.5 4v12" />
    </svg>
  );
}

function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function ReadIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5c2.2-1 4.6-1 7 .3v11c-2.4-1.3-4.8-1.3-7-.3z" />
      <path d="M17 4.5c-2.2-1-4.6-1-7 .3v11c2.4-1.3 4.8-1.3 7-.3z" />
    </svg>
  );
}

function WriteIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14.5V17h2.5L15 8.5l-2.5-2.5L4 14.5Z" />
      <path d="M11.2 6.3l2.5 2.5" />
    </svg>
  );
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5l-4-4" />
    </svg>
  );
}

function NotesIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12M4 9h12M4 14h7.5" />
    </svg>
  );
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 5.5h4M9.5 5.5H17M3 10h8M13.5 10H17M3 14.5h6.5M12 14.5H17" />
      <circle cx="7" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Six lines, then the remainder as a count. The block never scrolls. */
const STUDY_BLOCK_LINE_CAP = 6;

/**
 * The rail's right-hand figure. Tabular mono with the locale's own thousands
 * separator, and a hard ceiling: past 9,999 the exact number stops being
 * something a rail can usefully carry, so it says "9,999+" and the column
 * keeps one width. Right-aligned to the 220px line, so the digits stack into a
 * column no matter the magnitude — the count is never allowed to push the
 * label, the label ellipses instead.
 */
function formatNavCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  const whole = Math.floor(count);
  return whole > 9999 ? `${(9999).toLocaleString()}+` : whole.toLocaleString();
}

interface NavItemProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: React.JSX.Element;
  /** Keyboard digit shown in tooltip, e.g. "1" → "Read (1)" */
  shortcut?: string;
  /**
   * The row's figure. A row without one leaves the column empty rather than
   * showing a zero: "nothing here yet" and "I have not counted" are different
   * statements, and only the first is worth a glyph.
   */
  count?: number;
  /**
   * A 5px seal dot that REPLACES the count — never joins it. Two numbers in
   * one row is a dashboard, not a rail.
   */
  unread?: boolean;
}

function NavItem({
  active,
  onClick,
  disabled = false,
  label,
  icon,
  shortcut,
  count,
  unread = false,
}: NavItemProps): React.JSX.Element {
  const figure = unread ? null : count === undefined ? null : formatNavCount(count);
  // Collapsed, the row is an icon and a tooltip. The tooltip carries the label
  // AND its figure — the same two pieces the expanded row shows — so nothing
  // is lost by collapsing. aria-label overrides the row's own children for the
  // accessible name, so the figure has to be spelled out here or it is silent.
  const tip = [
    shortcut ? `${label} (${shortcut})` : label,
    unread ? "unread" : figure,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={tip}
      aria-label={tip}
      aria-keyshortcuts={shortcut}
      aria-current={active ? "page" : undefined}
    >
      {/* Rev 05 §05·3 · the icon rides a 32px tile rather than sitting straight
          in the row. The tile is what carries the rail's one vertical axis:
          12px of inset, 32px of tile, and the same two numbers at 232 as at 56,
          so collapsing the rail hides labels without moving a single icon. */}
      <span className="nav-tile" aria-hidden="true">{icon}</span>
      <span className="nav-label">{label}</span>
      {unread ? (
        <span className="nav-unread" aria-hidden="true" />
      ) : figure !== null ? (
        <span className="nav-count" aria-hidden="true">{figure}</span>
      ) : shortcut ? (
        <span className="nav-shortcut" aria-hidden="true">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("scripture");
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [navigateRef, setNavigateRef] = useState<{
    ownerTabId: string;
    book: string;
    chapter: number;
    verse?: number;
    endVerse?: number;
    preapproved: true;
  } | null>(null);
  const [writingDraft, setWritingDraft] = useState<WritingDraft>(recoverWritingDraft);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandInitialTab, setCommandInitialTab] = useState<CommandPaletteTab>("intelligence");
  const [commandMode, setCommandMode] = useState<CommandPaletteMode>("search");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [workspaceDecisionConfirmation, setWorkspaceDecisionConfirmation] = useState<WorkspaceConfirmation | null>(null);
  const pendingWorkspaceDecisionRef = useRef<PendingWorkspaceDecision | null>(null);
  /* A study that has just been made and is waiting to be named. The nonce is
     what makes a second study of the same name-in-waiting a second invitation
     rather than a no-op, and it is why this is a request and not a flag. */
  const [studyNamingRequest, setStudyNamingRequest] = useState<{ groupId: string; nonce: number } | null>(null);
  const studyNamingNonceRef = useRef(0);
  const workspaceShowToastRef = useRef<ShowToast | null>(null);
  const registerWorkspaceShowToast = useCallback((showToast: ShowToast | null): void => {
    workspaceShowToastRef.current = showToast;
  }, []);
  const [readingContext, setReadingContext] = useState<CommandReadingContext>({
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
  });
  const [commandContext, setCommandContext] = useState<CommandReadingContext>({
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
  });
  // `undefined` means settings have not resolved yet. No default workspace is
  // constructed until the newer-version refusal gate has been evaluated.
  const [studyWorkspace, setStudyWorkspace] = useState<StudyWorkspaceStateV2 | null>();
  const studyWorkspaceRef = useRef<StudyWorkspaceStateV2 | null | undefined>(undefined);
  const workspacePersistenceRef = useRef<WorkspacePersistenceController | null>(null);
  const [workspacePersistenceStatus, setWorkspacePersistenceStatus] = useState<WorkspacePersistenceStatus>({
    phase: "idle",
    acknowledgedRevision: 0,
    pendingRevision: null,
  });
  const studyWorkspaceRefusalRef = useRef<"newer-version" | null>(null);
  const [entityResearchFocusRequest, setEntityResearchFocusRequest] = useState<EntityResearchFocusRequest | null>(null);
  const entityResearchFocusRequestIdRef = useRef(0);
  const activeWorkspaceTab = studyWorkspace ? activeStudyWorkspaceTab(studyWorkspace) : null;
  const activeWorkspaceSession = studyWorkspace ? activeStudyWorkspaceSession(studyWorkspace) : null;
  const activeEntityTab = activeWorkspaceTab?.kind === "entity" ? activeWorkspaceTab : null;
  const activeEntityId = activeEntityTab?.entityId ?? null;
  const activeEntityDisplayName = activeEntityTab?.trail.at(-1)?.displayName ?? activeEntityId;
  const activeEntityKind = activeEntityTab?.entityKind ?? null;
  const activeEntityNonce = activeEntityTab?.nonce ?? null;
  const activeEntityOriginBook = activeEntityTab?.origin.book ?? null;
  const activeEntityOriginChapter = activeEntityTab?.origin.chapter ?? null;
  const activeEntityOriginPackageId = activeEntityTab?.origin.packageId ?? null;
  const activeEntityOriginVerseStart = activeEntityTab?.originRange?.start ?? null;
  const activeEntityOriginVerseEnd = activeEntityTab?.originRange?.end ?? null;
  const entityIntent = useMemo(() => {
    if (activeEntityId === null
      || activeEntityDisplayName === null
      || activeEntityKind === null
      || activeEntityNonce === null
      || activeEntityOriginBook === null
      || activeEntityOriginChapter === null
      || activeEntityOriginPackageId === null) {
      return null;
    }
    return {
      id: activeEntityId,
      displayName: activeEntityDisplayName,
      kind: activeEntityKind,
      nonce: activeEntityNonce,
      origin: {
        book: activeEntityOriginBook,
        chapter: activeEntityOriginChapter,
        packageId: activeEntityOriginPackageId,
        ...(activeEntityOriginVerseStart !== null
          ? {
              verseStart: activeEntityOriginVerseStart,
              verseEnd: activeEntityOriginVerseEnd ?? activeEntityOriginVerseStart,
            }
          : {}),
      },
    };
  }, [
    activeEntityId,
    activeEntityDisplayName,
    activeEntityKind,
    activeEntityNonce,
    activeEntityOriginBook,
    activeEntityOriginChapter,
    activeEntityOriginPackageId,
    activeEntityOriginVerseStart,
    activeEntityOriginVerseEnd,
  ]);
  const activeScope = activeWorkspaceSession?.current.margin.scope;
  const keptBook = activeScope?.kind === "kept" ? activeScope.book : null;
  const keptChapter = activeScope?.kind === "kept" ? activeScope.chapter : null;
  const keptVerse = activeScope?.kind === "kept" ? activeScope.verse : null;
  const keptEndVerse = activeScope?.kind === "kept" ? activeScope.endVerse : undefined;
  const keptLabel = activeScope?.kind === "kept" ? activeScope.label : undefined;
  const keptContext: KeptMarginReference | null = useMemo(() => (
    keptBook === null || keptChapter === null || keptVerse === null
      ? null
      : {
          book: keptBook,
          chapter: keptChapter,
          verse: keptVerse,
          ...(keptEndVerse !== undefined ? { endVerse: keptEndVerse } : {}),
          ...(keptLabel !== undefined ? { label: keptLabel } : {}),
        }
  ), [keptBook, keptChapter, keptVerse, keptEndVerse, keptLabel]);
  const [workspaceIntent, setWorkspaceIntent] = useState<{
    query?: string;
    noteId?: string;
    nonce: number;
  }>({ nonce: 0 });
  const [marginVisible, setMarginVisible] = useState(() => {
    return localStorage.getItem("marginVisible") !== "false";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /**
   * The collapse is a desktop preference, and below the narrow shell's
   * breakpoint it has no control that can undo it: the rail is a bottom bar
   * there and `.sidebar-header` — which holds the only collapse button — is
   * `display: none`. A reader who collapsed the rail on a desktop therefore
   * opened the app on a phone to an unlabelled icon bar with no way back, which
   * §H2 forbids in as many words: an unlabelled icon bar is a memory test.
   *
   * Three CSS rules also lost to `.sidebar.collapsed` on specificity inside the
   * narrow-shell media query — the labels' `opacity`/`max-width`, the row's
   * `gap`, and the unread dot's position — because specificity ignores media
   * queries, so the narrow shell could not win them back from a cascade fight
   * it was never in. Withholding the class is the fix for all three at once:
   * there is nothing to out-specify.
   *
   * The SETTING is untouched, only its effect while there is no room to honour
   * it — the same shape as MarkingSurface's narrow-shell override — so widening
   * the window restores the reader's own choice.
   */
  const [narrowShell, setNarrowShell] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_SHELL).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW_SHELL);
    const sync = (): void => setNarrowShell(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  /*
   * @quire trigger · taxonomy · which reserve closes when the rail and the panel
   * cannot both be paid for.
   *
   * rev05-canon measured the built sheet at both rail widths: page top 54 in all
   * 28 combinations, page left 80 collapsed and 256 expanded, measure block 416
   * wherever the block canon holds. The frame table needs no row for the expanded
   * rail — the switch reads the paper through a container query, so rail width
   * just narrows the paper the way the panel does. Both widths stay: Rev 04 §6
   * prints "Collapsed 56px, expanded 232px" as approved, §8 does not supersede
   * it, and Rev 05's footer supersedes exactly two things, neither of them this.
   *
   * The cost lands here rather than on the grid. Expanded rail AND panel open
   * gives the paper 516 / 596 / 644 at 1200 / 1280 / 1328 against a 692 measure
   * block, so the measure yields to 484 / 564 / 612. The page's own padding
   * yields first and reaches 0 before the measure gives, so that is the floor of
   * the stated order — §05·4's ladder has no rung left, the margin has already
   * closed into the panel, and the next concession is H's at 980.
   *
   * NOT ANSWERED HERE, deliberately. 280px of rail plus two 380 reserves does not
   * fit a 1328 window, and the language does not say which reserve should have
   * closed. Choosing one is widening the nearest slot, which §9 names as the
   * thing not to do. The two candidate answers — auto-collapse the rail while
   * both reserves are open below ~1440, or fold this into §05·7's already-open
   * 1200–1279 question — are one expression apart, and this is the expression:
   * the rail already knows `marginVisible`, so the guard would read
   * `sidebarCollapsed || (marginVisible && bothReservesDoNotFit)` on the same
   * shape as the narrow-shell override above, leaving the setting untouched.
   * Until it is ruled on, the shipped behaviour is the stated order's own
   * outcome: the measure yields, and nothing collapses under the reader.
   */
  const collapsedRail = sidebarCollapsed && !narrowShell;
  const [theme, setTheme] = useState<AppSettings["theme"]>("light");
  const [material, setMaterial] = useState<AppSettings["material"]>("solid");
  const [markingSurface, setMarkingSurface] = useState<AppSettings["markingSurface"]>("palette");
  const [readingSize, setReadingSize] = useState<ReadingSize>("m");
  const [verseNumbers, setVerseNumbers] = useState<VerseNumberMode>("always");
  const [focusMode, setFocusMode] = useState(false);
  const [authoredMutationState, setAuthoredMutationState] = useState<AuthoredMutationState>("idle");
  const authoredMutationStateRef = useRef<AuthoredMutationState>("idle");
  const scriptureExitControllerRef = useRef<WorkspaceExitController | null>(null);
  const studyCanvasControllerRef = useRef<StudyCanvasController | null>(null);
  const canvasOwnerTabIdRef = useRef<string | null>(null);
  const workspaceTransitionCoordinatorRef = useRef<WorkspaceTransitionCoordinator | null>(null);
  if (workspaceTransitionCoordinatorRef.current === null) {
    workspaceTransitionCoordinatorRef.current = createWorkspaceTransitionCoordinator(() => {
      const controller = scriptureExitControllerRef.current;
      return controller ? [controller] : [];
    });
  }
  /** Margin visibility before focus mode — restored on exit. */
  const preFocusMargin = useRef(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [libraryPopoverOpen, setLibraryPopoverOpen] = useState(false);
  const [libraryAction, setLibraryAction] = useState<"reveal" | "switch" | null>(null);
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const [libraryAnchorRect, setLibraryAnchorRect] = useState<DOMRect | null>(null);
  const settingsLoaded = useRef(false);
  const entityReturnFocusRef = useRef<HTMLElement | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [studyWorkspaceRefusal, setStudyWorkspaceRefusal] = useState<"newer-version" | null>(null);
  // Tracks which persisted settings the user has already changed via the UI
  // before the initial settings.get() resolved. The load effect must not
  // clobber a setting the user has touched in the interim (see the
  // settings-load effect below for the race this guards against).
  const userDirtySettings = useRef({ sidebarCollapsed: false, marginVisible: false, theme: false, material: false, markingSurface: false });

  const captureCurrentStudyWorkspace = useCallback((): boolean => {
    const workspaceBeforeFlush = studyWorkspaceRef.current;
    if (workspaceBeforeFlush === undefined) {
      return studyWorkspaceRefusalRef.current === "newer-version";
    }
    if (workspaceBeforeFlush === null) return true;

    const controller = studyCanvasControllerRef.current;
    if (!controller) return true;
    // The Living Margin samples native scroll on a short delay. Structural
    // transitions (including programmatic tab selection and native close)
    // must synchronously publish that sample before we read the owner state.
    controller.flushPendingMarginScroll();
    const current = studyWorkspaceRef.current;
    if (!current) return false;
    const captured = controller.captureCurrent();
    if (!captured) return false;

    const ownerId = current.activeTabId;
    if (captured.ownerTabId !== canvasOwnerTabIdRef.current) return false;
    if (captured.ownerTabId !== ownerId) return false;
    if (!current.tabsById[captured.ownerTabId]) return false;

    const next = updateActiveStudyCanvasSession(current, captured.ownerTabId, (session) => ({
      ...session,
      current: captured.entry,
    }));
    canvasOwnerTabIdRef.current = next.activeTabId;
    studyWorkspaceRef.current = next;
    setStudyWorkspace(next);
    workspacePersistenceRef.current?.publishView(next);
    return true;
  }, []);

  const runWorkspaceTransition = useCallback(async (
    reason: WorkspaceTransitionReason,
    commit: () => void | Promise<void>,
  ): Promise<boolean> => workspaceTransitionCoordinatorRef.current!.run(reason, async () => {
    if (!captureCurrentStudyWorkspace()) throw new Error("Study canvas capture failed");
    await commit();
  }), [captureCurrentStudyWorkspace]);

  const handleStudyCanvasControllerChange = useCallback((
    controller: StudyCanvasController | null,
  ): void => {
    studyCanvasControllerRef.current = controller;
  }, []);

  const handleWorkspaceExitControllerChange = useCallback((
    controller: WorkspaceExitController | null,
  ): void => {
    scriptureExitControllerRef.current = controller;
  }, []);

  const commitStudyWorkspace = useCallback((
    update: (current: StudyWorkspaceStateV2 | null) => StudyWorkspaceStateV2 | null,
  ): void => {
    const current = studyWorkspaceRef.current;
    if (current === undefined) return;
    const next = update(current);
    if (next === current) return;
    canvasOwnerTabIdRef.current = next?.activeTabId ?? null;
    studyWorkspaceRef.current = next;
    setStudyWorkspace(next);
    if (next && workspacePersistenceRef.current) {
      void workspacePersistenceRef.current.persistStructure(next);
    }
  }, []);

  const publishStudyWorkspaceView = useCallback((
    update: (current: StudyWorkspaceStateV2) => StudyWorkspaceStateV2,
  ): void => {
    const current = studyWorkspaceRef.current;
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    canvasOwnerTabIdRef.current = next.activeTabId;
    studyWorkspaceRef.current = next;
    setStudyWorkspace(next);
    workspacePersistenceRef.current?.publishView(next);
  }, []);

  const retryWorkspacePersistence = useCallback((): Promise<boolean> => (
    workspacePersistenceRef.current?.retry() ?? Promise.resolve(false)
  ), []);

  const handleCanvasSessionEntryChange = useCallback((
    ownerTabId: string,
    entry: PassageViewState,
  ): void => {
    publishStudyWorkspaceView((current) => updateActiveStudyCanvasSession(
      current,
      ownerTabId,
      (session) => ({ ...session, current: entry }),
    ));
  }, [publishStudyWorkspaceView]);

  const handleCanvasNavigationHistoryChange = useCallback((
    ownerTabId: string,
    history: PassageWorkspaceSession["history"],
  ): void => {
    publishStudyWorkspaceView((current) => updateActiveStudyCanvasSession(
      current,
      ownerTabId,
      (session) => ({ ...session, history }),
    ));
  }, [publishStudyWorkspaceView]);

  const handleResearchScrollTopChange = useCallback((
    ownerTabId: string,
    scrollTop: number,
  ): void => {
    publishStudyWorkspaceView((current) => (
      current.activeTabId === ownerTabId
        ? updateEntityWorkspaceScrollTop(current, ownerTabId, scrollTop)
        : current
    ));
  }, [publishStudyWorkspaceView]);

  const loadData = useCallback(async () => {
    setLoadState({ status: "loading" });
    const splashHold = new Promise<void>((resolve) => setTimeout(resolve, 2400));

    const [backboneRes, bookNamesRes, pathRes, infoRes] = await Promise.all([
      safeCall(() => window.api.scripture.getBackbone()),
      safeCall(() => window.api.scripture.getBookNames()),
      safeCall(() => window.api.library.getPath()),
      safeCall(() => window.api.library.getInfo()),
    ]);

    if (!backboneRes.ok) {
      setLoadState({ status: "error", error: `Failed to load backbone: ${backboneRes.error}` });
      return;
    }
    if (!bookNamesRes.ok) {
      setLoadState({ status: "error", error: `Failed to load book names: ${bookNamesRes.error}` });
      return;
    }

    if (infoRes.ok && infoRes.value && infoRes.value.hasLibrary === false) {
      await splashHold;
      setLoadState({ status: "first-run", defaultPath: infoRes.value.path });
      return;
    }

    const libraryPath = pathRes.ok ? pathRes.value : "Unknown";
    await splashHold;
    setLoadState({
      status: "loaded",
      backbone: backboneRes.value,
      bookNames: bookNamesRes.value,
      libraryPath,
    });
  }, []);

  const handleLibraryConfirmed = useCallback(
    async (chosenPath: string) => {
      const result = await safeCall(() => window.api.library.init(chosenPath));
      if (result.ok) {
        if (result.value.ok) {
          await loadData();
          return result.value;
        }
        return result.value;
      }
      return { ok: false, error: result.error };
    },
    [loadData],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // The full Write surface is intentionally recoverable across renderer or
  // app restarts. This is a local draft only; it never writes Substrate until
  // the user explicitly saves through WritingSheet (INV-1).
  useEffect(() => {
    try {
      if (writingDraft.title.trim() || writingDraft.body.trim()) {
        localStorage.setItem(WRITING_DRAFT_STORAGE_KEY, JSON.stringify(writingDraft));
      } else {
        localStorage.removeItem(WRITING_DRAFT_STORAGE_KEY);
      }
    } catch {
      // A locked-down profile may deny storage. Keep the live draft usable.
    }
  }, [writingDraft]);

  // Initialize sidebarCollapsed / marginVisible / theme from
  // persisted settings. Fall back to the existing localStorage-based
  // marginVisible init on failure.
  //
  // NOTE: window.api.settings.get() is an async IPC round-trip. If the user
  // toggles a setting via the UI before this promise resolves, we must NOT
  // let the stale persisted value stomp their change when it finally lands.
  // We guard against that per-setting via userDirtySettings, populated by
  // the toggle handlers (see toggleSidebarCollapsed / toggleMargin /
  // toggleTheme) *synchronously* at click time — not inside this callback,
  // since by the time this callback runs it's already too late to know
  // whether a click happened during the window it was in flight.
  useEffect(() => {
    let cancelled = false;
    let unsubscribePersistence: (() => void) | null = null;
    safeCall(() => window.api.settings.get()).then((res) => {
      if (cancelled) return;
      if (res.ok && res.value.studyWorkspaceRefusal === "newer-version") {
        // INV-17: do not construct, migrate, or persist any workspace state
        // when the saved format is newer than this app understands.
        studyWorkspaceRefusalRef.current = "newer-version";
        setStudyWorkspaceRefusal("newer-version");
        return;
      }
      const loadedWorkspace = res.ok ? res.value.studyWorkspace ?? null : null;
      const resolvedWorkspace = loadedWorkspace ?? createStudyWorkspace(
        compatibilityPassageView({ book: "ACT", chapter: 19, packageId: "bsb" }),
        { groupId: "study-default", passageTabId: "passage-default" },
      );
      canvasOwnerTabIdRef.current = resolvedWorkspace.activeTabId;
      studyWorkspaceRef.current = resolvedWorkspace;
      setStudyWorkspace(resolvedWorkspace);
      if (res.ok) {
        const persistence = createWorkspacePersistenceController({
          debounceMs: 220,
          async write(workspace) {
            const persisted = await window.api.settings.set({ studyWorkspace: workspace });
            if (persisted.studyWorkspaceRefusal) throw new Error("Workspace version refused");
            if (!isStudyWorkspaceSnapshotAcknowledged(workspace, persisted.studyWorkspace)) throw new Error("Workspace write not acknowledged");
          },
        });
        workspacePersistenceRef.current = persistence;
        unsubscribePersistence = persistence.subscribe(setWorkspacePersistenceStatus);
      }
      settingsLoaded.current = true;
      if (res.ok) {
        if (!userDirtySettings.current.sidebarCollapsed) {
          setSidebarCollapsed(res.value.sidebarCollapsed);
        }
        if (!userDirtySettings.current.marginVisible) {
          setMarginVisible(res.value.marginVisible);
        }
        if (!userDirtySettings.current.theme) {
          setTheme(res.value.theme);
          setMaterial(res.value.material ?? "solid");
        }
        if (!userDirtySettings.current.markingSurface) {
          setMarkingSurface(res.value.markingSurface ?? "palette");
        }
        if (res.value.readingSize) setReadingSize(res.value.readingSize);
        if (res.value.verseNumbers) setVerseNumbers(res.value.verseNumbers);
      }
      // A setting changed while the IPC read was in flight has already run
      // its persist effect once and returned early. This state transition
      // deliberately re-runs every persist effect with the live UI values.
      setSettingsReady(true);
    });
    return () => {
      cancelled = true;
      unsubscribePersistence?.();
      workspacePersistenceRef.current?.dispose();
      workspacePersistenceRef.current = null;
    };
  }, []);

  // Persist sidebarCollapsed / marginVisible / theme whenever they change (fire-and-forget).
  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ sidebarCollapsed }));
  }, [settingsReady, sidebarCollapsed]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ marginVisible }));
  }, [settingsReady, marginVisible]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ theme }));
  }, [settingsReady, theme]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ material }));
  }, [settingsReady, material]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ markingSurface }));
  }, [settingsReady, markingSurface]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ readingSize, verseNumbers }));
  }, [settingsReady, readingSize, verseNumbers]);

  const changeKeptContext = useCallback((next: KeptMarginReference | null): void => {
    commitStudyWorkspace((current) => {
      let workspace = current;
      if (!workspace) {
        if (!next) return current;
        workspace = createStudyWorkspace(compatibilityPassageView(readingContext), {
          groupId: `study-group-${crypto.randomUUID()}`,
          passageTabId: `study-passage-${crypto.randomUUID()}`,
        });
      }
      const ownerId = workspace.activeTabId;
      return updateActiveStudyCanvasSession(workspace, ownerId, (session) => ({
        ...session,
        current: {
          ...session.current,
          margin: {
            ...session.current.margin,
            scope: next ? { kind: "kept", ...next } : null,
          },
        },
      }));
    });
  }, [commitStudyWorkspace, readingContext]);

  const handleAuthoredMutationStateChange = useCallback((state: AuthoredMutationState): void => {
    authoredMutationStateRef.current = state;
    if (state !== "idle") {
      userDirtySettings.current.marginVisible = true;
      preFocusMargin.current = true;
      setFocusMode(false);
      setMarginVisible(true);
    }
    setAuthoredMutationState(state);
  }, []);

  const changeView = useCallback(async (
    next: View,
    onProceed?: () => void,
  ): Promise<boolean> => {
    if (viewRef.current === next && !onProceed) return true;
    return runWorkspaceTransition("view-change", () => {
      onProceed?.();
      viewRef.current = next;
      setView(next);
    });
  }, [runWorkspaceTransition]);

  useEffect(() => window.api.appWindow.onCloseRequested((request) => {
    void (async () => {
      let proceed = false;
      try {
        proceed = await runWorkspaceTransition("window-close", async () => {
          const workspaceClose = decideStudyWorkspaceClose(
            studyWorkspaceRef.current,
            studyWorkspaceRefusalRef.current,
          );
          if (workspaceClose.kind === "approve") return;
          if (workspaceClose.kind === "veto") throw new Error("Workspace is not ready to close");
          const persistence = workspacePersistenceRef.current;
          if (!persistence) throw new Error("Workspace persistence is unavailable");
          const flushed = await persistence.flush(workspaceClose.workspace);
          if (!flushed) throw new Error("Workspace flush was not acknowledged");
        });
      } finally {
        window.api.appWindow.resolveCloseRequest(request.requestId, proceed);
      }
    })();
  }), [runWorkspaceTransition]);

  const handleCreateNoteFromPassage = (prefillBody?: string) => {
    void changeView("write", () => {
      if (!prefillBody) return;
      setWritingDraft((current) => ({
        ...current,
        body: current.body.trim()
          ? `${current.body.trimEnd()}\n\n${prefillBody}`
          : prefillBody,
      }));
    });
  };

  const handleNavigateToRef = useCallback((
    book: string,
    chapter: number,
    verse?: number,
    endVerse?: number,
  ): Promise<boolean> => {
    const ownerTabId = studyWorkspaceRef.current?.activeTabId;
    if (!ownerTabId) return Promise.resolve(false);
    const reason: WorkspaceTransitionReason = viewRef.current === "scripture"
      ? "chapter-change"
      : "view-change";
    return runWorkspaceTransition(reason, () => {
      viewRef.current = "scripture";
      setView("scripture");
      setNavigateRef({ ownerTabId, book, chapter, verse, endVerse, preapproved: true });
    });
  }, [runWorkspaceTransition]);
  const consumeNavigateRef = useCallback(() => setNavigateRef(null), []);

  const handleReadingContextChange = useCallback((next: CommandReadingContext) => {
    setReadingContext((current) => (
      current.book === next.book
      && current.chapter === next.chapter
      && current.chapterEndVerse === next.chapterEndVerse
      && current.packageId === next.packageId
      && current.verseStart === next.verseStart
      && current.verseEnd === next.verseEnd
        ? current
        : next
    ));
  }, []);

  const openCommandPalette = useCallback(() => {
    setCommandContext(readingContext);
    setCommandMode("search");
    setCommandInitialTab("intelligence");
    setCommandOpen(true);
  }, [readingContext]);
  const openStudyTabCommandPalette = useCallback(() => {
    setCommandContext(readingContext);
    setCommandMode("open-study-tab");
    setCommandInitialTab("intelligence");
    setCommandOpen(true);
  }, [readingContext]);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);
  const closeShortcutsOverlay = useCallback(() => setShortcutsOpen(false), []);
  const requestWorkspaceDecision = useCallback((
    confirmation: WorkspaceConfirmation,
  ): Promise<WorkspaceDecision> => new Promise((resolve) => {
    pendingWorkspaceDecisionRef.current?.resolve("cancel");
    pendingWorkspaceDecisionRef.current = { resolve };
    setWorkspaceDecisionConfirmation(confirmation);
  }), []);
  const settleWorkspaceDecision = useCallback((decision: WorkspaceDecision): void => {
    const pending = pendingWorkspaceDecisionRef.current;
    pendingWorkspaceDecisionRef.current = null;
    setWorkspaceDecisionConfirmation(null);
    pending?.resolve(decision);
  }, []);

  useEffect(() => () => {
    pendingWorkspaceDecisionRef.current?.resolve("cancel");
    pendingWorkspaceDecisionRef.current = null;
  }, []);

  const focusWorkspaceTabAfterCommit = useCallback((tabId: string): void => {
    window.setTimeout(() => {
      if (studyWorkspaceRef.current?.activeTabId !== tabId) return;
      document.getElementById(`study-workspace-tab-${tabId}`)?.focus({ preventScroll: true });
    }, 0);
  }, []);

  /**
   * Invite the reader to name the study they have just made.
   *
   * This used to reach into the DOM: `querySelector('[data-study-active-group-manage]')`
   * and a synthetic `.click()` on the strip's Manage control, which opened a
   * dialog over the page to ask for four words. That control left the strip on
   * 2026-07-30 with the rest of the study's identity, and a handshake made of a
   * selector is the wrong shape anyway — it fails silently when the element it
   * names is renamed, which is exactly what happened to the QA gate's own copy
   * of the same trick.
   *
   * The invitation is a request now, carried as state to the study line, which
   * turns the new study's chip into its own field. The guard is unchanged and
   * still matters: a naming step that arrives after the reader has already
   * moved somewhere else must not seize their focus.
   */
  const openWorkspaceGroupNamingAfterCommit = useCallback((groupId: string): void => {
    window.setTimeout(() => {
      const current = studyWorkspaceRef.current;
      if (current?.tabsById[current.activeTabId]?.groupId !== groupId) return;
      studyNamingNonceRef.current += 1;
      setStudyNamingRequest({ groupId, nonce: studyNamingNonceRef.current });
    }, 0);
  }, []);

  const openPassageTab = useCallback((target: {
    book: string;
    chapter: number;
    verse?: number;
    endVerse?: number;
    packageId: string;
  }, options?: {
    source?: "chapter-step" | "passage-picker" | "verse-peek";
    focusDestination?: boolean;
  }): Promise<boolean> => {
    let accepted = false;
    let openedTabId: string | null = null;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    return runWorkspaceTransition("tab-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const result = openPassageWorkspaceTab(current, {
          id: `study-passage-${crypto.randomUUID()}`,
          sourceTabId: current.activeTabId,
          view: compatibilityPassageView({
            book: target.book,
            chapter: target.chapter,
            packageId: target.packageId,
            ...(target.verse !== undefined
              ? { verseStart: target.verse, verseEnd: target.endVerse ?? target.verse }
              : {}),
          }),
        });
        outcome = result.outcome;
        accepted = result.outcome === "opened" || result.outcome === "focused";
        openedTabId = accepted ? result.state.activeTabId : null;
        return accepted ? result.state : current;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
      if (!accepted) return;
      viewRef.current = "scripture";
      setView("scripture");
    }).then((proceed) => {
      if (
        proceed
        && accepted
        && openedTabId
        && (options?.source === undefined || options?.focusDestination)
      ) {
        focusWorkspaceTabAfterCommit(openedTabId);
      }
      return proceed && accepted;
    });
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, runWorkspaceTransition]);

  const duplicateActivePassageTab = useCallback((): Promise<boolean> => {
    let accepted = false;
    let openedTabId: string | null = null;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    return runWorkspaceTransition("tab-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const session = activeStudyWorkspaceSession(current);
        if (!session) return current;
        const result = openPassageWorkspaceTab(current, {
          id: `study-passage-${crypto.randomUUID()}`,
          sourceTabId: current.activeTabId,
          view: session.current,
          duplicate: true,
        });
        outcome = result.outcome;
        accepted = result.outcome === "opened";
        openedTabId = accepted ? result.state.activeTabId : null;
        return accepted ? result.state : current;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
      if (!accepted) return;
      viewRef.current = "scripture";
      setView("scripture");
    }).then((proceed) => {
      if (proceed && accepted && openedTabId) focusWorkspaceTabAfterCommit(openedTabId);
      return proceed && accepted;
    });
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, runWorkspaceTransition]);

  const startStudyFromCurrentCanvas = useCallback((): Promise<boolean> => {
    let accepted = false;
    let openedTabId: string | null = null;
    let openedGroupId: string | null = null;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    return runWorkspaceTransition("group-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const session = activeStudyWorkspaceSession(current);
        if (!session) return current;
        const result = createStudyWorkspaceGroup(current, {
          id: `study-group-${crypto.randomUUID()}`,
          passageTabId: `study-passage-${crypto.randomUUID()}`,
          view: session.current,
        });
        outcome = result.outcome;
        accepted = result.outcome === "opened";
        openedTabId = accepted ? result.state.activeTabId : null;
        openedGroupId = accepted ? result.state.tabsById[result.state.activeTabId]?.groupId ?? null : null;
        return accepted ? result.state : current;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
      if (!accepted) return;
      viewRef.current = "scripture";
      setView("scripture");
    }).then((proceed) => {
      if (proceed && accepted && openedTabId && openedGroupId) {
        focusWorkspaceTabAfterCommit(openedTabId);
        openWorkspaceGroupNamingAfterCommit(openedGroupId);
      }
      return proceed && accepted;
    });
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, openWorkspaceGroupNamingAfterCommit, runWorkspaceTransition]);

  const openEntityResearchAt = useCallback((
    target: EntityResearchTarget,
    origin: CommandReadingContext,
    mode: "tab" | "navigate" = "tab",
    options?: EntityResearchOpenOptions,
    requestFocus = true,
  ): Promise<boolean> => {
    const active = document.activeElement;
    const returnFocus = active instanceof HTMLElement && active !== document.body
      ? active
      : null;
    const nonce = Date.now();
    let openedOwnerTabId: string | null = null;
    let applied = false;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    return runWorkspaceTransition("tab-change", () => {
      commitStudyWorkspace((current) => {
        let workspace = current ?? createStudyWorkspace(compatibilityPassageView(origin), {
          groupId: `study-group-${crypto.randomUUID()}`,
          passageTabId: `study-passage-${crypto.randomUUID()}`,
        });
        const activeTab = workspace.tabsById[workspace.activeTabId];
        if (mode === "navigate" && activeTab?.kind === "entity") {
          openedOwnerTabId = activeTab.id;
          let navigableWorkspace = workspace;
          let trailTarget: EntityResearchTrailEntry = {
            id: target.id,
            displayName: target.displayName,
            kind: target.kind,
          };
          if (options?.trailIndex !== undefined) {
            const trailIndex = options.trailIndex;
            const existingTarget = activeTab.trail[trailIndex];
            if (!existingTarget || existingTarget.id !== target.id) {
              throw new Error("Entity trail target is stale");
            }
            trailTarget = existingTarget;
            navigableWorkspace = updateEntityWorkspaceTrail(
              workspace,
              activeTab.id,
              (trail) => truncateEntityResearchTrail(trail, trailIndex),
            );
          }
          const navigated = navigateEntityWorkspaceTab(navigableWorkspace, activeTab.id, trailTarget, nonce);
          applied = navigated !== workspace;
          return navigated;
        }
        if (options?.trailIndex !== undefined) throw new Error("Entity trail owner is unavailable");
        const sourceTabId = workspace.activeTabId;
        const resolvedSource = workspace.tabsById[sourceTabId];
        const entityOrigin = resolvedSource?.kind === "passage"
          ? resolvedSource.session.current
          : resolvedSource?.canvas.current ?? compatibilityPassageView(origin);
        const entityTabId = `research-${crypto.randomUUID()}`;
        const opened = openEntityWorkspaceTab(workspace, {
          id: entityTabId,
          sourceTabId,
          entityId: target.id,
          displayName: target.displayName,
          entityKind: target.kind,
          nonce,
          origin: entityOrigin,
          ...(origin.verseStart !== undefined
            ? { originRange: { start: origin.verseStart, end: origin.verseEnd ?? origin.verseStart } }
            : {}),
          returnPassageTabId: sourceTabId,
        });
        outcome = opened.outcome;
        applied = opened.outcome === "opened" || opened.outcome === "focused";
        openedOwnerTabId = applied ? opened.state.activeTabId : null;
        return applied ? opened.state : workspace;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
      if (!activeEntityId) entityReturnFocusRef.current = returnFocus;
      viewRef.current = "scripture";
      setView("scripture");
      setFocusMode(false);
      userDirtySettings.current.marginVisible = true;
      setMarginVisible(true);
    }).then((proceed) => {
      if (requestFocus
        && proceed
        && openedOwnerTabId !== null
        && studyWorkspaceRef.current?.activeTabId === openedOwnerTabId) {
        entityResearchFocusRequestIdRef.current += 1;
        setEntityResearchFocusRequest({
          ownerTabId: openedOwnerTabId,
          requestId: entityResearchFocusRequestIdRef.current,
        });
      } else if (!requestFocus && proceed && openedOwnerTabId !== null) {
        window.setTimeout(() => {
          document.getElementById(`study-workspace-tab-${openedOwnerTabId}`)?.focus({ preventScroll: true });
        }, 0);
      }
      return proceed && applied;
    });
  }, [activeEntityId, commitStudyWorkspace, runWorkspaceTransition]);
  const openEntityResearch = useCallback((
    target: EntityResearchTarget,
    origin?: CommandReadingContext,
  ): Promise<boolean> => {
    return openEntityResearchAt(target, origin ?? readingContext, "tab", undefined, true);
  }, [openEntityResearchAt, readingContext]);
  const drillEntityResearch = useCallback((
    target: EntityResearchTarget,
    options?: EntityResearchOpenOptions,
  ): Promise<boolean> => {
    return openEntityResearchAt(target, readingContext, "navigate", options, true);
  }, [openEntityResearchAt, readingContext]);
  const openCommandEntityResearch = useCallback((target: CommandEntityTarget): Promise<boolean> => {
    return openEntityResearchAt(target, commandContext, "tab", undefined, false);
  }, [commandContext, openEntityResearchAt]);
  const branchEntityResearch = useCallback((target: EntityResearchTarget): Promise<boolean> => {
    const nonce = Date.now();
    let openedOwnerTabId: string | null = null;
    let accepted = false;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    return runWorkspaceTransition("tab-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const source = current.tabsById[current.activeTabId];
        if (source?.kind !== "entity") return current;
        const result = branchEntityWorkspaceTab(current, {
          id: `research-${crypto.randomUUID()}`,
          sourceTabId: source.id,
          entry: target,
          nonce,
        });
        outcome = result.outcome;
        accepted = result.outcome === "opened";
        openedOwnerTabId = accepted ? result.state.activeTabId : null;
        return accepted ? result.state : current;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
      if (!accepted) return;
      viewRef.current = "scripture";
      setView("scripture");
      setFocusMode(false);
      userDirtySettings.current.marginVisible = true;
      setMarginVisible(true);
    }).then((proceed) => {
      if (proceed && openedOwnerTabId && studyWorkspaceRef.current?.activeTabId === openedOwnerTabId) {
        entityResearchFocusRequestIdRef.current += 1;
        setEntityResearchFocusRequest({
          ownerTabId: openedOwnerTabId,
          requestId: entityResearchFocusRequestIdRef.current,
        });
      }
      return proceed && accepted;
    });
  }, [commitStudyWorkspace, runWorkspaceTransition]);
  const returnEntityOrigin = useCallback((): Promise<boolean> => {
    let accepted = false;
    let returnedTabId: string | null = null;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    return runWorkspaceTransition("tab-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const entity = current.tabsById[current.activeTabId];
        if (entity?.kind !== "entity") return current;
        const result = returnEntityWorkspaceToOrigin(current, { entityTabId: entity.id });
        outcome = result.outcome;
        accepted = result.outcome === "opened" || result.outcome === "focused";
        returnedTabId = accepted ? result.state.activeTabId : null;
        return accepted ? result.state : current;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
      if (!accepted) return;
      viewRef.current = "scripture";
      setView("scripture");
    }).then((proceed) => {
      if (proceed && accepted && returnedTabId) focusWorkspaceTabAfterCommit(returnedTabId);
      return proceed && accepted;
    });
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, runWorkspaceTransition]);
  const selectWorkspaceTab = useCallback(async (tabId: string): Promise<boolean> => {
    setEntityResearchFocusRequest(null);
    const current = studyWorkspaceRef.current;
    if (current && tabId === current.activeTabId && viewRef.current === "scripture") {
      return true;
    }
    const proceed = await runWorkspaceTransition("tab-change", () => {
      commitStudyWorkspace((workspace) => {
        if (!workspace) return workspace;
        return selectStudyWorkspaceTab(workspace, tabId);
      });
      viewRef.current = "scripture";
      setView("scripture");
    });
    if (proceed && studyWorkspaceRef.current?.tabsById[tabId]?.kind === "entity") {
      setFocusMode(false);
      userDirtySettings.current.marginVisible = true;
      setMarginVisible(true);
    }
    return proceed;
  }, [commitStudyWorkspace, runWorkspaceTransition]);
  const handleEntityResearchFocusRequestHandled = useCallback((
    ownerTabId: string,
    requestId: number,
  ): void => {
    setEntityResearchFocusRequest((current) => (
      current?.ownerTabId === ownerTabId && current.requestId === requestId ? null : current
    ));
  }, []);
  const closeResearchTab = useCallback(async (tabId: string): Promise<boolean> => {
    const target = entityReturnFocusRef.current;
    let focusTabId = studyWorkspaceRef.current?.activeTabId ?? null;
    let hasResearchAfterClose = false;
    let applied = false;
    const proceed = await runWorkspaceTransition("tab-close", async () => {
      const snapshot = studyWorkspaceRef.current;
      if (!snapshot) return;
      const requested = closeStudyWorkspaceTab(snapshot, tabId);
      let result = requested;
      if (requested.outcome === "needs-confirmation") {
        const decision = await requestWorkspaceDecision(requested.confirmation);
        const latest = studyWorkspaceRef.current;
        if (!latest) return;
        result = resolveStudyWorkspaceDecision(latest, requested.confirmation, decision);
      }
      const current = studyWorkspaceRef.current;
      if (!current || result.state === current) return;
      applied = true;
      hasResearchAfterClose = Object.values(result.state.tabsById).some((tab) => tab.kind === "entity");
      focusTabId = result.state.activeTabId;
      commitStudyWorkspace((latest) => latest === current ? result.state : latest);
    });
    if (!proceed || !applied) return false;
    if (focusTabId) focusWorkspaceTabAfterCommit(focusTabId);
    window.setTimeout(() => {
      const workspaceTab = focusTabId
        ? document.getElementById(`study-workspace-tab-${focusTabId}`)
        : null;
      if (!(workspaceTab instanceof HTMLElement) && !hasResearchAfterClose && target?.isConnected) target.focus();
      if (!hasResearchAfterClose) entityReturnFocusRef.current = null;
    }, 0);
    return true;
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, requestWorkspaceDecision, runWorkspaceTransition]);
  const closeEntityResearch = useCallback((): Promise<boolean> => {
    const current = studyWorkspaceRef.current;
    if (!current || current.tabsById[current.activeTabId]?.kind !== "entity") return Promise.resolve(false);
    return closeResearchTab(current.activeTabId);
  }, [closeResearchTab]);
  const closeWorkspaceGroup = useCallback(async (groupId: string): Promise<boolean> => {
    let applied = false;
    let focusTabId: string | null = null;
    const proceed = await runWorkspaceTransition("group-change", async () => {
      const snapshot = studyWorkspaceRef.current;
      if (!snapshot) return;
      const requested = closeStudyWorkspaceGroup(snapshot, groupId);
      let result = requested;
      if (requested.outcome === "needs-confirmation") {
        const decision = await requestWorkspaceDecision(requested.confirmation);
        const latest = studyWorkspaceRef.current;
        if (!latest) return;
        result = resolveStudyWorkspaceDecision(latest, requested.confirmation, decision);
      }
      const current = studyWorkspaceRef.current;
      if (!current || result.state === current) return;
      applied = true;
      focusTabId = result.state.activeTabId;
      commitStudyWorkspace((latest) => latest === current ? result.state : latest);
    });
    if (proceed && applied && focusTabId) focusWorkspaceTabAfterCommit(focusTabId);
    return proceed && applied;
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, requestWorkspaceDecision, runWorkspaceTransition]);
  /* `toggleWorkspaceGroup` stood here and is retired 2026-07-30 with the
     collapse gesture itself. Folding a study got its tabs out of the strip; the
     strip holds one study's tabs by construction now, so the toggle had nothing
     left to change on screen and every surface that offered it was offering a
     control whose only effect was a field nobody reads. `collapsed` stays in
     StudyWorkspaceStateV2 and stays persisted — the model and the Electron
     validator are untouched, and a workspace saved with a folded study still
     round-trips — and `toggleStudyWorkspaceGroup` stays in the model with the
     exclusivity ruling it carries, unread. */
  const renameWorkspaceGroup = useCallback((groupId: string, label: string): Promise<boolean> => {
    const value = label.trim();
    if (!value) return Promise.resolve(false);
    let applied = false;
    return runWorkspaceTransition("group-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const next = renameStudyWorkspaceGroup(current, groupId, value);
        applied = next !== current;
        return next;
      });
    }).then((proceed) => proceed && applied);
  }, [commitStudyWorkspace, runWorkspaceTransition]);
  const reorderWorkspaceTab = useCallback((
    tabId: string,
    position: WorkspaceReorderPosition,
  ): Promise<boolean> => {
    let applied = false;
    return runWorkspaceTransition("group-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const next = reorderStudyWorkspaceTab(current, { tabId, position });
        applied = next !== current;
        return next;
      });
    }).then((proceed) => proceed && applied);
  }, [commitStudyWorkspace, runWorkspaceTransition]);
  const reorderWorkspaceGroup = useCallback((
    groupId: string,
    position: WorkspaceReorderPosition,
  ): Promise<boolean> => {
    let applied = false;
    return runWorkspaceTransition("group-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const next = reorderStudyWorkspaceGroup(current, { groupId, position });
        applied = next !== current;
        return next;
      });
    }).then((proceed) => proceed && applied);
  }, [commitStudyWorkspace, runWorkspaceTransition]);
  const moveWorkspaceTab = useCallback(async (
    tabId: string,
    targetGroupId: string,
  ): Promise<boolean> => {
    let applied = false;
    const proceed = await runWorkspaceTransition("group-change", async () => {
      const snapshot = studyWorkspaceRef.current;
      if (!snapshot) return;
      const requested = moveStudyWorkspaceTab(snapshot, { tabId, targetGroupId });
      let result = requested;
      if (requested.outcome === "needs-confirmation") {
        const decision = await requestWorkspaceDecision(requested.confirmation);
        const latest = studyWorkspaceRef.current;
        if (!latest) return;
        result = resolveStudyWorkspaceDecision(latest, requested.confirmation, decision);
      }
      notifyWorkspaceCapacity(result.outcome, workspaceShowToastRef.current);
      const current = studyWorkspaceRef.current;
      if (!current || result.state === current) return;
      applied = true;
      commitStudyWorkspace((latest) => latest === current ? result.state : latest);
    });
    return proceed && applied;
  }, [commitStudyWorkspace, requestWorkspaceDecision, runWorkspaceTransition]);
  const reopenRecentWorkspaceItem = useCallback(async (index?: number): Promise<boolean> => {
    let applied = false;
    let focusTabId: string | null = null;
    let outcome: WorkspaceMutationOutcome = "unchanged";
    const proceed = await runWorkspaceTransition("group-change", () => {
      commitStudyWorkspace((current) => {
        if (!current) return current;
        const result = index === undefined
          ? reopenClosedStudyItem(current)
          : reopenClosedStudyItemAt(current, index);
        outcome = result.outcome;
        if (result.state === current) return current;
        applied = true;
        focusTabId = result.state.activeTabId;
        return result.state;
      });
      notifyWorkspaceCapacity(outcome, workspaceShowToastRef.current);
    });
    if (proceed && applied && focusTabId) focusWorkspaceTabAfterCommit(focusTabId);
    return proceed && applied;
  }, [commitStudyWorkspace, focusWorkspaceTabAfterCommit, runWorkspaceTransition]);
  const updateEntityResearchTrail = useCallback((
    ownerTabId: string,
    update: (current: readonly EntityResearchTrailEntry[]) => EntityResearchTrailEntry[],
  ): void => {
    commitStudyWorkspace((current) => {
      if (!current || current.activeTabId !== ownerTabId) return current;
      return updateEntityWorkspaceTrail(current, ownerTabId, (trail) => (
        update(trail).slice(-ENTITY_RESEARCH_TRAIL_LIMIT)
      ));
    });
  }, [commitStudyWorkspace]);

  const globalShortcutBlocked = useCallback((event: KeyboardEvent): boolean => {
    if (event.defaultPrevented) return true;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.matches("input, textarea, select") || target?.isContentEditable) return true;
    if (authoredMutationStateRef.current !== "idle") return true;
    if (!layerStackIsEmpty()) return true;
    // Layer registration happens in an effect. Keep the DOM fallback so a
    // shortcut dispatched during the first rendered frame of a dialog or
    // popover cannot slip through before that effect runs.
    return document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"], .command-palette-root') != null;
  }, []);

  useEffect(() => {
    const handleStudyWorkspaceShortcut = (event: KeyboardEvent): void => {
      if (viewRef.current !== "scripture") return;
      if (globalShortcutBlocked(event)) return;
      const current = studyWorkspaceRef.current;
      if (!current) return;

      // Ctrl+Tab is intentionally cross-platform. Command+Tab belongs to the
      // macOS app switcher and must never be advertised or intercepted here.
      // Cycling walks what the strip SHOWS — the active study's tabs. It walked
      // the whole workspace's visible list until 2026-07-30, which was the same
      // list while the strip held every study; the register is one study at a
      // time now, and a cycle that leaves the row you are looking at is a jump
      // rather than a cycle. Crossing studies is the study line's, the overview's
      // and reopen's.
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        const tabIds = studyWorkspaceStripTabIds(current);
        if (tabIds.length < 2) return;
        const currentIndex = Math.max(0, tabIds.indexOf(current.activeTabId));
        const direction = event.shiftKey ? -1 : 1;
        const nextTabId = tabIds[(currentIndex + direction + tabIds.length) % tabIds.length];
        if (!nextTabId) return;
        event.preventDefault();
        event.stopPropagation();
        void selectWorkspaceTab(nextTabId).then((approved) => {
          if (approved) focusWorkspaceTabAfterCommit(nextTabId);
        });
        return;
      }

      // Command-digit jumps to a tab by its place in the strip — the active
      // study's run — which is also where the number is shown, in All Tabs.
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
        && /^[1-9]$/u.test(event.key)) {
        const tabId = studyWorkspaceOrdinalTabId(current, Number(event.key));
        if (!tabId) return;
        event.preventDefault();
        event.stopPropagation();
        void selectWorkspaceTab(tabId).then((approved) => {
          if (approved) focusWorkspaceTabAfterCommit(tabId);
        });
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "w" && !event.shiftKey) {
        if (studyWorkspaceTabCloseAvailability(current, current.activeTabId) === "unavailable") return;
        event.preventDefault();
        event.stopPropagation();
        void closeResearchTab(current.activeTabId);
        return;
      }
      if (key === "t" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void reopenRecentWorkspaceItem();
      }
    };
    window.addEventListener("keydown", handleStudyWorkspaceShortcut, true);
    return () => window.removeEventListener("keydown", handleStudyWorkspaceShortcut, true);
  }, [closeResearchTab, focusWorkspaceTabAfterCommit, globalShortcutBlocked, reopenRecentWorkspaceItem, selectWorkspaceTab]);

  const toggleSidebarCollapsed = () => {
    userDirtySettings.current.sidebarCollapsed = true;
    setSidebarCollapsed((prev) => !prev);
  };

  const toggleLibraryPopover = () => {
    if (!libraryPopoverOpen && libraryTriggerRef.current) {
      setLibraryAnchorRect(libraryTriggerRef.current.getBoundingClientRect());
      setLibraryActionError(null);
    }
    setLibraryPopoverOpen((prev) => !prev);
  };

  const closeLibraryPopover = () => {
    setLibraryPopoverOpen(false);
  };

  /* The margin can send a reader straight to the publishers it is showing them,
     which is the only settings page that answers the question the chips raise. */
  const [settingsSection, setSettingsSection] = useState<"library" | "resources">("library");
  const openResourceSettings = () => {
    setSettingsSection("resources");
    void changeView("settings");
  };

  const handleManageInSettings = () => {
    setSettingsSection("library");
    void changeView("settings", () => {
      setLibraryPopoverOpen(false);
    });
  };

  const revealLibrary = async (): Promise<void> => {
    setLibraryAction("reveal");
    setLibraryActionError(null);
    const result = await safeCall(() => window.api.library.revealInFinder());
    setLibraryAction(null);
    if (!result.ok || !result.value.ok) {
      setLibraryActionError(
        result.ok ? (result.value.error ?? "Could not reveal the library.") : result.error,
      );
      return;
    }
    closeLibraryPopover();
  };

  const switchLibrary = async (): Promise<void> => {
    setLibraryAction("switch");
    setLibraryActionError(null);
    const picked = await safeCall(() => window.api.dialog.openDirectory());
    if (!picked.ok) {
      setLibraryAction(null);
      setLibraryActionError(picked.error);
      return;
    }
    const chosen = picked.value;
    if (!chosen || chosen === libraryPath) {
      setLibraryAction(null);
      return;
    }
    let switchError: string | null = null;
    const proceed = await runWorkspaceTransition("library-change", async () => {
      const workspace = studyWorkspaceRef.current;
      if (workspace) {
        const persistence = workspacePersistenceRef.current;
        if (!persistence || !await persistence.flush(workspace)) {
          switchError = "Could not save the current study before switching libraries.";
          throw new Error(switchError);
        }
      }
      const result = await safeCall(() => window.api.library.init(chosen));
      if (!result.ok || !result.value.ok) {
        switchError = result.ok ? (result.value.error ?? "Switch failed.") : result.error;
        throw new Error(switchError);
      }
    });
    setLibraryAction(null);
    if (switchError) {
      setLibraryActionError(switchError);
      return;
    }
    if (proceed) window.location.reload();
  };

  const toggleMargin = () => {
    if (marginVisible && authoredMutationStateRef.current !== "idle") return;
    userDirtySettings.current.marginVisible = true;
    setMarginVisible((prev) => !prev);
  };

  // Opening an authored connection is an explicit request for its inspector.
  // Keep this idempotent (unlike the toolbar toggle), and leave Focus mode so
  // the Living Margin cannot remain suppressed behind a selected route.
  const ensureMarginVisible = useCallback(() => {
    userDirtySettings.current.marginVisible = true;
    preFocusMargin.current = true;
    setFocusMode(false);
    setMarginVisible(true);
  }, []);

  const toggleTheme = (nextTheme: AppTheme) => {
    userDirtySettings.current.theme = true;
    setTheme(() => nextTheme);
  };

  const changeMaterial = (next: AppSettings["material"]) => {
    userDirtySettings.current.material = true;
    setMaterial(() => next);
  };

  const changeMarkingSurface = (nextSurface: AppSettings["markingSurface"]): void => {
    userDirtySettings.current.markingSurface = true;
    setMarkingSurface(nextSurface);
  };

  const handleReadingPrefsChange = useCallback((partial: Partial<ReadingPrefs>) => {
    if (partial.readingSize) setReadingSize(partial.readingSize);
    if (partial.verseNumbers) setVerseNumbers(partial.verseNumbers);
  }, []);

  const toggleFocusMode = useCallback(() => {
    if (!focusMode && authoredMutationStateRef.current !== "idle") return;
    setFocusMode((prev) => {
      if (!prev) {
        preFocusMargin.current = marginVisible;
        userDirtySettings.current.marginVisible = true;
        setMarginVisible(false);
        return true;
      }
      userDirtySettings.current.marginVisible = true;
      setMarginVisible(preFocusMargin.current);
      return false;
    });
  }, [focusMode, marginVisible]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== "k") return;
      if (globalShortcutBlocked(event)) return;
      event.preventDefault();
      openCommandPalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globalShortcutBlocked, openCommandPalette]);

  useEffect(() => {
    const openShortcutsOverlay = (event: KeyboardEvent): void => {
      const shortcutKey = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (!shortcutKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (globalShortcutBlocked(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", openShortcutsOverlay, true);
    return () => window.removeEventListener("keydown", openShortcutsOverlay, true);
  }, [globalShortcutBlocked]);

  useEffect(() => {
    const cyclePanes = (event: KeyboardEvent): void => {
      if (event.key !== "F6" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (globalShortcutBlocked(event)) return;

      const panes: Array<{ root: HTMLElement; target: HTMLElement }> = [];
      const addPane = (root: HTMLElement | null, target: HTMLElement | null): void => {
        if (root && target) panes.push({ root, target });
      };
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      addPane(sidebar, sidebar?.querySelector<HTMLElement>('.nav-item[aria-current="page"], .nav-item:not([disabled])') ?? null);
      const topbar = document.querySelector<HTMLElement>(".scripture-topbar");
      addPane(topbar, topbar?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? null);
      const canvas = document.querySelector<HTMLElement>(".scripture-content");
      addPane(canvas, canvas?.querySelector<HTMLElement>('.verse-line[aria-pressed="true"], .verse-line') ?? null);
      const margin = document.querySelector<HTMLElement>(".living-margin");
      addPane(margin, margin?.querySelector<HTMLElement>('.margin-tab[aria-selected="true"], #living-margin-title, #entity-research-title') ?? null);
      // The podcast dock joins the rotation while it exists, and leaves with it.
      // A floating surface that never dismisses needs a way in that is not the
      // pointer, and this is the app's existing way in — no new binding, and
      // nothing to learn that a reader does not already know.
      const player = document.querySelector<HTMLElement>(".podcast-dock");
      addPane(player, player?.querySelector<HTMLElement>(".podcast-transport-play") ?? null);
      if (panes.length === 0) return;

      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const currentIndex = active == null ? -1 : panes.findIndex((pane) => pane.root.contains(active));
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = currentIndex < 0
        ? (event.shiftKey ? panes.length - 1 : 0)
        : (currentIndex + delta + panes.length) % panes.length;
      event.preventDefault();
      event.stopPropagation();
      panes[nextIndex]?.target.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", cyclePanes, true);
    return () => window.removeEventListener("keydown", cyclePanes, true);
  }, [globalShortcutBlocked]);

  // Global keyboard: view digits 1–4, F = focus mode, Esc exits focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (globalShortcutBlocked(e)) return;

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (e.key === "Escape" && focusMode) {
        // Escape belongs to the topmost registered layer first — a chooser,
        // a retained selected shape, or any other floating surface consumes
        // it before Focus mode may exit.
        if (!layerStackIsEmpty()) return;
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      const map: Record<string, View> = {
        "1": "scripture",
        "2": "write",
        "3": "notes",
        "4": "search",
        "5": "settings",
      };
      const next = map[e.key];
      if (next) {
        e.preventDefault();
        if (next !== "scripture" && authoredMutationStateRef.current !== "idle") return;
        void changeView(next).then((changed) => {
          if (changed && focusMode) toggleFocusMode();
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeView, focusMode, globalShortcutBlocked, toggleFocusMode]);

  const shellClass = [
    "app-shell",
    `theme-${theme}`,
    isDarkTheme(theme) ? "dark" : "",
    material === "translucent" ? "material-translucent" : "",
    focusMode ? "focus-mode" : "",
    `reading-size-${readingSize}`,
    `verse-nums-${verseNumbers}`,
  ]
    .filter(Boolean)
    .join(" ");
  const floatingMaterialClass = [
    `theme-${theme}`,
    isDarkTheme(theme) ? "dark" : "",
    material === "translucent" ? "material-translucent" : "",
  ].filter(Boolean).join(" ");

  if (studyWorkspaceRefusal === "newer-version") {
    return (
      <div className={`${shellClass} error-screen`} role="alert">
        <div className="error-content">
          <h1 className="error-title">Workspace update required</h1>
          <p className="error-msg">
            This library workspace was created by a newer version of Pericope.
            Update Pericope to open it safely; your saved workspace has not been changed.
          </p>
        </div>
      </div>
    );
  }

  if (loadState.status === "loading" || !studyWorkspace || !activeWorkspaceTab || !activeWorkspaceSession) {
    return (
      <div className={`${shellClass} loading-screen`}>
        <div className="loading-content">
          <div className="loading-brand-mark"><PericopeMark size={34} /></div>
          <h1 className="loading-title">Pericope</h1>
          <div className="loading-spinner" />
          <p className="loading-text">Loading library...</p>
        </div>
      </div>
    );
  }

  if (loadState.status === "first-run") {
    return (
      <WelcomeScreen
        defaultPath={loadState.defaultPath}
        onConfirm={handleLibraryConfirmed}
        shellClass={shellClass}
      />
    );
  }

  if (loadState.status === "error") {
    return (
      <div className={`${shellClass} error-screen`}>
        <div className="error-content">
          <h1 className="error-title">Failed to Load</h1>
          <p className="error-msg">{loadState.error}</p>
          <button className="btn-primary" onClick={() => void loadData()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { backbone, bookNames, libraryPath } = loadState;
  const libraryName = libraryPath.split("/").pop() ?? libraryPath;
  const avatarInitial = libraryName.charAt(0).toUpperCase() || "?";
  const contextLabel = `${bookNames[readingContext.book]?.[0] ?? readingContext.book} ${readingContext.chapter}${
    readingContext.verseStart ? `:${readingContext.verseStart}${
      readingContext.verseEnd && readingContext.verseEnd !== readingContext.verseStart ? `–${readingContext.verseEnd}` : ""
    }` : ""
  }`;
  const activeStudyGroup = studyWorkspace.groups.find((group) => group.id === activeWorkspaceTab.groupId);
  const activeStudyLabel = activeStudyGroup
    ? studyWorkspaceGroupLabel(studyWorkspace, activeStudyGroup, bookNames)
    : "Current study";

  // The rail's study block. It may only show what is already open, and it may
  // not be a second way to navigate — so it reads the register it is
  // describing and renders it as prose: no buttons, no hover, no reordering,
  // no close affordances. Passages only; an entity tab is a research detour,
  // not a passage in the study.
  //
  // One passage open is not a study, so the block does not render at all until
  // there are two. Six lines, then the remainder as a count; it never scrolls.
  const studyBlockPassages = activeStudyGroup
    ? orderedStudyWorkspaceTabs(studyWorkspace, activeStudyGroup.id).filter(
        (tab) => tab.kind === "passage",
      )
    : [];
  // Named groups lend the block their name; an automatic group has no name of
  // its own to lend, only the reference of its home tab, which is already on
  // screen in the register and would read here as a duplicate.
  const studyBlockKicker = activeStudyGroup?.label.kind === "custom"
    ? activeStudyGroup.label.value
    : "This study";
  const studyBlockLines = studyBlockPassages.slice(0, STUDY_BLOCK_LINE_CAP).map((tab) => {
    const parts = studyWorkspaceTabLabelParts(studyWorkspace, tab, bookNames);
    return {
      id: tab.id,
      reference: parts ? `${parts.book} ${parts.chapter}` : tab.id,
      current: tab.id === studyWorkspace.activeTabId,
    };
  });
  const studyBlockOverflow = studyBlockPassages.length - studyBlockLines.length;

  /* THE RAIL'S STUDY SWITCHER IS GONE, 2026-07-30, one day after it arrived.
     It derived a row per study here and rendered a `.rail-studies` list below,
     and it went whole rather than in patches because it carried five defects
     and every one of them was the shape of the thing rather than a slip:

     — Two studies read "This study" twice. The label fell back to that string
       for any group without a custom name, and an automatic group is the
       DEFAULT: starting a study from the canvas names it later, if at all. So
       the switcher only rendered from two studies — the exact state in which
       its rows were indistinguishable — while every other surface in the app
       used the derived reference, "Acts 19".
     — The current row was a dead button. It selected the tab already active,
       which early-returns, under a pointer cursor and a hover fill.
     — The others landed on `tabs[0]` while the comment three lines above
       promised "the tab it was last on". `group.lastActiveTabId` is
       maintained and was never read.
     — Below 980px the rail is a 56px bottom bar and the switcher was not in
       the list of things that go, so a vertical list of studies survived as a
       flex sibling of the nav, taking width from five icons.
     — It stacked a second 9px kicker on the study block's, and when the study
       was named the two repeated each other verbatim.

     The block below stays exactly as it was: it reports what is open in the
     current study and is explicitly not a way to navigate. Switching studies
     belongs to the study line, which lands next. */

  const commandActions: CommandPaletteAction[] = [
    {
      id: "new-note",
      title: `New note for ${contextLabel}`,
      detail: "Open a local Markdown draft",
      keywords: ["write", "capture", "observation"],
    },
    {
      id: "toggle-study",
      title: marginVisible && !focusMode ? "Hide Study" : "Show Study",
      detail: "Toggle the Study panel",
      keywords: ["margin", "panel", "references", "language"],
    },
    {
      id: "toggle-focus",
      title: focusMode ? "Exit focus" : "Focus on reading",
      detail: focusMode ? "Restore the full study desk" : "Hide navigation and study chrome",
      keywords: ["reader", "distraction", "mode"],
    },
    {
      id: "open-notes",
      title: "Open My notes",
      detail: "Browse My notes",
      keywords: ["library", "notebook"],
    },
    {
      id: "search-notes",
      title: "Search all notes",
      detail: "Open the complete note search workspace",
      keywords: ["find", "library", "text"],
    },
    {
      id: "open-settings",
      title: "Open Settings",
      detail: "Library, reading, intelligence, and import",
      keywords: ["preferences", "theme", "package"],
    },
  ];

  const runCommandAction = (id: string): Promise<boolean> => {
    if (id === "new-note") {
      return changeView("write", () => {
        setWritingDraft((current) => current.title.trim() || current.body.trim()
          ? current
          : { title: contextLabel, body: "" });
      });
    }
    if (id === "toggle-study") {
      return runWorkspaceTransition("view-change", () => {
        if (focusMode) toggleFocusMode();
        if (!marginVisible) toggleMargin();
        else if (!focusMode) toggleMargin();
      });
    }
    if (id === "toggle-focus") {
      return runWorkspaceTransition("view-change", toggleFocusMode);
    }
    if (id === "open-notes") {
      return changeView("notes", () => setWorkspaceIntent({ nonce: Date.now() }));
    }
    if (id === "search-notes") {
      return changeView("search", () => setWorkspaceIntent({ query: "", nonce: Date.now() }));
    }
    if (id === "open-settings") return changeView("settings");
    return Promise.resolve(false);
  };

  const libraryPopover = libraryPopoverOpen && (
    <Popover
      anchorRect={libraryAnchorRect}
      onClose={closeLibraryPopover}
      width={280}
      className="library-popover"
      ariaLabel="Library menu"
    >
      <div className="library-popover-kicker">Current library</div>
      <div className="library-popover-name">{libraryName}</div>
      <div className="library-popover-path" title={libraryPath}>{libraryPath}</div>
      <div className="library-popover-section-label">Installed Scripture</div>
      <div className="package-chip-row">
        <div className="package-chip">
          <span className="package-chip-name">WEB</span>
        </div>
        <div className="package-chip">
          <span className="package-chip-name">KJV</span>
        </div>
      </div>
      <button
        type="button"
        className="control-menu-item library-popover-settings"
        onClick={() => void revealLibrary()}
        disabled={libraryAction !== null}
        aria-busy={libraryAction === "reveal"}
      >
        {libraryAction === "reveal" ? "Opening in Finder…" : "Reveal in Finder"}
      </button>
      <button
        type="button"
        className="control-menu-item library-popover-settings"
        onClick={() => void switchLibrary()}
        disabled={libraryAction !== null}
        aria-busy={libraryAction === "switch"}
      >
        {libraryAction === "switch" ? "Choosing library…" : "Switch Library…"}
      </button>
      <button
        type="button"
        className="control-menu-item library-popover-settings"
        onClick={handleManageInSettings}
        disabled={libraryAction !== null}
      >
        Manage in Settings →
      </button>
      {libraryActionError ? (
        <p className="library-popover-error" role="alert">{libraryActionError}</p>
      ) : null}
    </Popover>
  );

  return (
    <ErrorBoundary>
      <ToastProvider
        materialClassName={floatingMaterialClass}
        onShowToastReady={registerWorkspaceShowToast}
      >
        <div className={shellClass} data-theme={theme}>
          <nav
              className={`sidebar${collapsedRail ? " collapsed" : ""}`}
              aria-label="Primary navigation"
            >
            {/* Rev 05 §05·5 retired the focus-mode grab handle. "No stub, no
                handle. The rail returns on ⌘\ or on the pointer entering the
                56px ground band; nothing is drawn to advertise it. An
                affordance drawn permanently in the calmest mode is the one
                thing focus cannot afford." The band is the affordance now, and
                focus stays reachable by ⌘\, Escape, the header's FOCUS
                instrument and the command palette — so nothing is stranded by
                drawing nothing. The rows below stay mounted and simply go to
                zero opacity, which is also what keeps a keyboard user's Tab
                able to float the rail back through :focus-within. */}
              <div className="sidebar-header">
                <div className="brand-row" aria-label="Pericope">
                  <div className="brand-mark">
                    <PericopeMark size={16} />
                  </div>
                  <div className="brand-word">Pericope</div>
                </div>
                <Tooltip label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
                  <button
                    type="button"
                    className="sidebar-collapse-btn"
                    onClick={toggleSidebarCollapsed}
                    aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    aria-expanded={!sidebarCollapsed}
                  >
                    <PanelToggleIcon />
                  </button>
                </Tooltip>
              </div>
              <div className="sidebar-nav">
                <NavItem active={view === "scripture"} onClick={() => { void changeView("scripture"); }} label="Read" icon={<ReadIcon />} shortcut="1" />
                <NavItem active={view === "write"} onClick={() => { void changeView("write"); }} disabled={authoredMutationState !== "idle"} label="Write" icon={<WriteIcon />} shortcut="2" />
                <NavItem active={view === "notes"} onClick={() => { void changeView("notes"); }} disabled={authoredMutationState !== "idle"} label="Notes" icon={<NotesIcon />} shortcut="3" />
                <NavItem active={view === "search"} onClick={() => { void changeView("search"); }} disabled={authoredMutationState !== "idle"} label="Search" icon={<SearchIcon />} shortcut="4" />
                {/* Five rows, one uninterrupted run on the 32+2 rhythm. The
                    divider that used to sit here was a line doing a job the
                    system does with interval, and it cost 29px that landed on
                    no row boundary — the one thing the rail's grid cannot
                    absorb. Settings reads as the last row because it is last,
                    which is how the other four read as an order too. */}
                <NavItem active={view === "settings"} onClick={() => { void changeView("settings"); }} disabled={authoredMutationState !== "idle"} label="Settings" icon={<SettingsIcon />} shortcut="5" />
              </div>
              {authoredMutationState !== "idle" && (
                <p className="rail-held" role="status">
                  {authoredMutationState === "recovery"
                    ? "Recovering a write · navigation held"
                    : "Writing a connection · navigation held"}
                </p>
              )}
              {/* The `.rail-studies` switcher stood here for a day and is gone;
                  the derivation it read carries the reasons. Nothing in the
                  rail navigates now, which is the rule the block below has
                  always been under. */}
              {studyBlockPassages.length >= 2 && (
                <section className="rail-study" aria-label={studyBlockKicker}>
                  <p className="rail-study-kicker">{studyBlockKicker}</p>
                  <ul className="rail-study-list">
                    {studyBlockLines.map((line) => (
                      <li
                        key={line.id}
                        className={`rail-study-line${line.current ? " is-current" : ""}`}
                      >
                        <span className="rail-study-ref">{line.reference}</span>
                      </li>
                    ))}
                  </ul>
                  {studyBlockOverflow > 0 && (
                    <p className="rail-study-more">{`+${studyBlockOverflow} more`}</p>
                  )}
                </section>
              )}
              <div className="sidebar-spacer" />
              <div className="sidebar-footer">
                <button
                  type="button"
                  ref={libraryTriggerRef}
                  className={`library-switcher${aiBusy ? " analyzing" : ""}`}
                  onClick={toggleLibraryPopover}
                  title={`${libraryName} — library menu`}
                  aria-label={`Library: ${libraryName}`}
                  aria-haspopup="dialog"
                  aria-expanded={libraryPopoverOpen}
                >
                  <span className={`footer-avatar${aiBusy ? " analyzing" : ""}`} aria-hidden="true">
                    {avatarInitial}
                  </span>
                  <span className="footer-lib-text">
                    <span className="footer-lib-name" title={libraryPath}>{libraryName}</span>
                    <span className={`footer-ai-status${aiBusy ? " analyzing" : " idle"}`} aria-live="polite">
                      <i className="footer-ai-dot" aria-hidden="true" />
                      {aiBusy ? "Studying passage…" : "Local library"}
                    </span>
                  </span>
                  <span className={`footer-chevron${libraryPopoverOpen ? " open" : ""}`} aria-hidden="true">
                    <ChevronDownIcon />
                  </span>
                </button>
              </div>
              {libraryPopover}
          </nav>
          <div className="main-content">
            {view === "scripture" && (
              <ScripturePage
                onOpenResourceSettings={openResourceSettings}
                backbone={backbone}
                bookNames={bookNames}
                navigateRef={navigateRef}
                onNavigateRefConsumed={consumeNavigateRef}
                sessionOwnerTabId={activeWorkspaceTab.id}
                navigationHistory={activeWorkspaceSession.history}
                onNavigationHistoryChange={handleCanvasNavigationHistoryChange}
                sessionEntry={activeWorkspaceSession.current}
                onSessionEntryChange={handleCanvasSessionEntryChange}
                onOpenCommandPalette={openCommandPalette}
                onOpenResearchPalette={openStudyTabCommandPalette}
                onOpenPassageTab={openPassageTab}
                onReadingContextChange={handleReadingContextChange}
                onCreateNote={handleCreateNoteFromPassage}
                marginVisible={marginVisible && !focusMode}
                onAiBusyChange={setAiBusy}
                theme={theme}
                onThemeChange={toggleTheme}
                material={material}
                onMaterialChange={changeMaterial}
                markingSurface={markingSurface}
                onToggleMargin={toggleMargin}
                onEnsureMarginVisible={ensureMarginVisible}
                readingSize={readingSize}
                verseNumbers={verseNumbers}
                onReadingPrefsChange={handleReadingPrefsChange}
                focusMode={focusMode}
                onToggleFocus={toggleFocusMode}
                onAuthoredMutationStateChange={handleAuthoredMutationStateChange}
                onStudyCanvasControllerChange={handleStudyCanvasControllerChange}
                onWorkspaceExitControllerChange={handleWorkspaceExitControllerChange}
                onRequestWorkspaceTransition={runWorkspaceTransition}
                studyWorkspace={studyWorkspace}
                activeWorkspaceKind={activeWorkspaceTab.kind}
                onWorkspaceTabSelect={selectWorkspaceTab}
                onWorkspaceTabClose={closeResearchTab}
                onWorkspaceGroupClose={closeWorkspaceGroup}
                onWorkspaceGroupRename={renameWorkspaceGroup}
                onWorkspaceTabMove={moveWorkspaceTab}
                onWorkspaceTabReorder={reorderWorkspaceTab}
                onWorkspaceGroupReorder={reorderWorkspaceGroup}
                onWorkspaceRecentReopen={reopenRecentWorkspaceItem}
                onWorkspaceTabDuplicate={duplicateActivePassageTab}
                onStartStudy={startStudyFromCurrentCanvas}
                studyNamingRequest={studyNamingRequest}
                workspacePersistenceStatus={workspacePersistenceStatus}
                onRetryWorkspacePersistence={retryWorkspacePersistence}
                researchScrollTop={activeEntityTab?.scrollTop}
                onResearchScrollTopChange={handleResearchScrollTopChange}
                entityResearchFocusRequest={
                  entityResearchFocusRequest?.ownerTabId === activeWorkspaceTab.id
                    ? entityResearchFocusRequest.requestId
                    : null
                }
                onEntityResearchFocusRequestHandled={handleEntityResearchFocusRequestHandled}
                entityIntent={entityIntent}
                onOpenEntity={openEntityResearch}
                onDrillEntity={drillEntityResearch}
                onBranchEntity={branchEntityResearch}
                onReturnEntityOrigin={returnEntityOrigin}
                onCloseEntity={closeEntityResearch}
                entityTrail={activeEntityTab?.trail ?? []}
                onEntityTrailChange={updateEntityResearchTrail}
                keptContext={keptContext}
                onKeptContextChange={changeKeptContext}
              />
            )}
            {view === "write" && (
              <WritingSheet
                draft={writingDraft}
                onDraftChange={setWritingDraft}
                onSaved={() => setWritingDraft({ title: "", body: "" })}
              />
            )}
            {view === "search" && (
              <SearchView
                mode="search"
                onNavigate={handleNavigateToRef}
                onWrite={() => { void changeView("write"); }}
                initialQuery={workspaceIntent.query}
                intentNonce={workspaceIntent.nonce}
              />
            )}
            {view === "notes" && (
              <SearchView
                mode="notes"
                onNavigate={handleNavigateToRef}
                onWrite={() => { void changeView("write"); }}
                initialNoteId={workspaceIntent.noteId}
                intentNonce={workspaceIntent.nonce}
              />
            )}
            {view === "settings" && (
              <SettingsPage
                initialSection={settingsSection}
                key={settingsSection}
                libraryPath={libraryPath}
                readingSize={readingSize}
                verseNumbers={verseNumbers}
                onReadingPrefsChange={handleReadingPrefsChange}
                theme={theme}
                onThemeChange={toggleTheme}
                material={material}
                onMaterialChange={changeMaterial}
                markingSurface={markingSurface}
                onMarkingSurfaceChange={changeMarkingSurface}
              />
            )}
          </div>
          <CommandPalette
            open={commandOpen}
            initialTab={commandInitialTab}
            mode={commandMode}
            studyLabel={activeStudyLabel}
            onClose={closeCommandPalette}
            theme={theme}
            backbone={backbone}
            bookNames={bookNames}
            context={commandContext}
            actions={commandActions}
            onNavigate={handleNavigateToRef}
            onOpenPassage={(book, chapter, verse, endVerse) => openPassageTab({
              book,
              chapter,
              verse,
              endVerse,
              packageId: commandContext.packageId,
            })}
            onDuplicatePassage={duplicateActivePassageTab}
            onStartStudy={startStudyFromCurrentCanvas}
            onOpenNote={(noteId) => changeView("notes", () => setWorkspaceIntent({ noteId, nonce: Date.now() }))}
            onOpenEntity={openCommandEntityResearch}
            onSearchNotes={(query) => changeView("search", () => setWorkspaceIntent({ query, nonce: Date.now() }))}
            onRunAction={runCommandAction}
          />
          {/* The podcast transport, mounted where nothing a reader does inside a
              passage can take it away: the panel it is started from remounts on
              every study tab, and the view under it unmounts on every 1–5. An
              episode has to outlive both, so the element lives here and the
              dock draws itself only once something is playing. */}
          <PodcastPlayer bookNames={bookNames} onNavigate={handleNavigateToRef} />
          {shortcutsOpen && <ShortcutsOverlay onClose={closeShortcutsOverlay} />}
          {workspaceDecisionConfirmation && (
            <WorkspaceDecisionDialog
              confirmation={workspaceDecisionConfirmation}
              onDecide={settleWorkspaceDecision}
            />
          )}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
