import type React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  AppSettings,
  BackboneData,
  BookNameData,
  ReadingSize,
  ReadingWidth,
  VerseNumberMode,
} from "./api.js";
import { ScripturePage } from "./components/ScripturePage.js";
import type { EntityResearchTrailEntry } from "./components/LivingMargin.js";
import { WritingSheet, type WritingDraft } from "./components/WritingSheet.js";
import { SearchView } from "./components/SearchView.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ToastProvider } from "./components/Toast.js";
import { Popover } from "./components/Popover.js";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import { PericopeMark } from "./components/PericopeMark.js";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay.js";
import type { ReadingPrefs } from "./components/ReadingComfort.js";
import { Tooltip } from "./components/Tooltip.js";
import {
  CommandPalette,
  type CommandPaletteAction,
  type CommandReadingContext,
} from "./components/CommandPalette.js";
import { isDarkTheme, type AppTheme } from "./theme.js";
import { safeCall } from "./utils/safeCall.js";
import {
  createNavigationHistory,
  type NavigationHistoryEntry,
  type NavigationHistoryState,
} from "./utils/navigationHistory.js";
import "./styles.css";

type View = "scripture" | "write" | "search" | "notes" | "settings";
type AuthoredMutationState = "idle" | "in-flight" | "recovery";
type LoadState =
  | { status: "loading" }
  | { status: "loaded"; backbone: BackboneData; bookNames: BookNameData; libraryPath: string }
  | { status: "error"; error: string }
  | { status: "first-run"; defaultPath: string };

const WRITING_DRAFT_STORAGE_KEY = "scripture.writing-draft";

function entityResearchOriginKey(origin: CommandReadingContext): string {
  return [
    origin.book,
    origin.chapter,
    origin.chapterEndVerse ?? "",
    origin.packageId,
    origin.verseStart ?? "",
    origin.verseEnd ?? "",
  ].join(":");
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

interface NavItemProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: React.JSX.Element;
  /** Keyboard digit shown in tooltip, e.g. "1" → "Read (1)" */
  shortcut?: string;
}

function NavItem({ active, onClick, disabled = false, label, icon, shortcut }: NavItemProps): React.JSX.Element {
  const tip = shortcut ? `${label} (${shortcut})` : label;
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
      {icon}
      <span className="nav-label">{label}</span>
      {shortcut && <span className="nav-shortcut" aria-hidden="true">{shortcut}</span>}
    </button>
  );
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("scripture");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [navigateRef, setNavigateRef] = useState<{
    book: string;
    chapter: number;
    verse?: number;
    endVerse?: number;
  } | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>(
    createNavigationHistory,
  );
  const [canvasSessionEntry, setCanvasSessionEntry] = useState<NavigationHistoryEntry | null>(null);
  const [writingDraft, setWritingDraft] = useState<WritingDraft>(recoverWritingDraft);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  const [entityIntent, setEntityIntent] = useState<{
    id: string;
    nonce: number;
    origin: CommandReadingContext;
  } | null>(null);
  const [entityResearchSession, setEntityResearchSession] = useState<{
    origin: CommandReadingContext | null;
    trail: EntityResearchTrailEntry[];
  }>({ origin: null, trail: [] });
  const [keptContext, setKeptContext] = useState<NonNullable<AppSettings["keptContext"]> | null>(null);
  const [workspaceIntent, setWorkspaceIntent] = useState<{
    query?: string;
    noteId?: string;
    nonce: number;
  }>({ nonce: 0 });
  const [marginVisible, setMarginVisible] = useState(() => {
    return localStorage.getItem("marginVisible") !== "false";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<AppSettings["theme"]>("light");
  const [markingSurface, setMarkingSurface] = useState<AppSettings["markingSurface"]>("palette");
  const [readingSize, setReadingSize] = useState<ReadingSize>("m");
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>("medium");
  const [verseNumbers, setVerseNumbers] = useState<VerseNumberMode>("always");
  const [focusMode, setFocusMode] = useState(false);
  const [authoredMutationState, setAuthoredMutationState] = useState<AuthoredMutationState>("idle");
  const authoredMutationStateRef = useRef<AuthoredMutationState>("idle");
  /** Margin visibility before focus mode — restored on exit. */
  const preFocusMargin = useRef(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [libraryPopoverOpen, setLibraryPopoverOpen] = useState(false);
  const [libraryAction, setLibraryAction] = useState<"reveal" | "switch" | null>(null);
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const [libraryAnchorRect, setLibraryAnchorRect] = useState<DOMRect | null>(null);
  const settingsLoaded = useRef(false);
  const keptContextDirtyRef = useRef(false);
  const entityReturnFocusRef = useRef<HTMLElement | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  // Tracks which persisted settings the user has already changed via the UI
  // before the initial settings.get() resolved. The load effect must not
  // clobber a setting the user has touched in the interim (see the
  // settings-load effect below for the race this guards against).
  const userDirtySettings = useRef({ sidebarCollapsed: false, marginVisible: false, theme: false, markingSurface: false });

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
    safeCall(() => window.api.settings.get()).then((res) => {
      if (cancelled) return;
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
        }
        if (!userDirtySettings.current.markingSurface) {
          setMarkingSurface(res.value.markingSurface ?? "palette");
        }
        if (res.value.readingSize) setReadingSize(res.value.readingSize);
        if (res.value.readingWidth) setReadingWidth(res.value.readingWidth);
        if (res.value.verseNumbers) setVerseNumbers(res.value.verseNumbers);
        if (res.value.researchSession) {
          setEntityResearchSession(res.value.researchSession);
        }
        if (!keptContextDirtyRef.current) setKeptContext(res.value.keptContext ?? null);
      }
      // A setting changed while the IPC read was in flight has already run
      // its persist effect once and returned early. This state transition
      // deliberately re-runs every persist effect with the live UI values.
      setSettingsReady(true);
    });
    return () => {
      cancelled = true;
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
    void safeCall(() => window.api.settings.set({ markingSurface }));
  }, [settingsReady, markingSurface]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ readingSize, readingWidth, verseNumbers }));
  }, [settingsReady, readingSize, readingWidth, verseNumbers]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({
      researchSession: entityResearchSession.origin
        ? { origin: entityResearchSession.origin, trail: entityResearchSession.trail }
        : null,
    }));
  }, [entityResearchSession, settingsReady]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ keptContext }));
  }, [keptContext, settingsReady]);

  const changeKeptContext = useCallback((next: NonNullable<AppSettings["keptContext"]> | null): void => {
    keptContextDirtyRef.current = true;
    setKeptContext(next);
  }, []);

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

  const changeView = useCallback((next: View): boolean => {
    if (next !== "scripture" && authoredMutationStateRef.current !== "idle") return false;
    setView(next);
    return true;
  }, []);

  const handleCreateNoteFromPassage = (prefillBody?: string) => {
    if (prefillBody) {
      setWritingDraft((current) => ({
        ...current,
        body: current.body.trim()
          ? `${current.body.trimEnd()}\n\n${prefillBody}`
          : prefillBody,
      }));
    }
    changeView("write");
  };

  const handleNavigateToRef = useCallback((
    book: string,
    chapter: number,
    verse?: number,
    endVerse?: number,
  ) => {
    if (authoredMutationStateRef.current !== "idle") return;
    setNavigateRef({ book, chapter, verse, endVerse });
    changeView("scripture");
  }, [changeView]);
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
    setCommandOpen(true);
  }, [readingContext]);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);
  const closeShortcutsOverlay = useCallback(() => setShortcutsOpen(false), []);

  const openEntityResearchAt = useCallback((entityId: string, origin: CommandReadingContext) => {
    if (authoredMutationStateRef.current !== "idle") return;
    if (!entityIntent) {
      const active = document.activeElement;
      entityReturnFocusRef.current = active instanceof HTMLElement && active !== document.body
        ? active
        : null;
    }
    const resumesSession = entityResearchSession.origin != null
      && entityResearchOriginKey(entityResearchSession.origin) === entityResearchOriginKey(origin);
    const frozenOrigin = resumesSession ? entityResearchSession.origin! : origin;
    if (!resumesSession) setEntityResearchSession({ origin, trail: [] });
    setEntityIntent({ id: entityId, nonce: Date.now(), origin: frozenOrigin });
    changeView("scripture");
    setFocusMode(false);
    userDirtySettings.current.marginVisible = true;
    setMarginVisible(true);
  }, [changeView, entityIntent, entityResearchSession]);
  const openEntityResearch = useCallback((entityId: string, origin?: CommandReadingContext) => {
    openEntityResearchAt(entityId, origin ?? readingContext);
  }, [openEntityResearchAt, readingContext]);
  const openCommandEntityResearch = useCallback((entityId: string) => {
    openEntityResearchAt(entityId, commandContext);
  }, [commandContext, openEntityResearchAt]);
  const closeEntityResearch = useCallback(() => {
    const target = entityReturnFocusRef.current;
    setEntityIntent(null);
    window.setTimeout(() => {
      if (target?.isConnected) target.focus();
      else document.querySelector<HTMLElement>("#living-margin-title")?.focus();
      entityReturnFocusRef.current = null;
    }, 0);
  }, []);
  const updateEntityResearchTrail = useCallback((
    update: (current: readonly EntityResearchTrailEntry[]) => EntityResearchTrailEntry[],
  ): void => {
    setEntityResearchSession((current) => ({
      origin: current.origin,
      trail: update(current.trail),
    }));
  }, []);

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

  const handleManageInSettings = () => {
    setLibraryPopoverOpen(false);
    changeView("settings");
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
    if (authoredMutationStateRef.current !== "idle") {
      setLibraryActionError("Finish or recover the current authored change before switching libraries.");
      return;
    }
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
    const result = await safeCall(() => window.api.library.init(chosen));
    if (!result.ok || !result.value.ok) {
      setLibraryAction(null);
      setLibraryActionError(
        result.ok ? (result.value.error ?? "Switch failed.") : result.error,
      );
      return;
    }
    window.location.reload();
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

  const changeMarkingSurface = (nextSurface: AppSettings["markingSurface"]): void => {
    userDirtySettings.current.markingSurface = true;
    setMarkingSurface(nextSurface);
  };

  const handleReadingPrefsChange = useCallback((partial: Partial<ReadingPrefs>) => {
    if (partial.readingSize) setReadingSize(partial.readingSize);
    if (partial.readingWidth) setReadingWidth(partial.readingWidth);
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
      event.preventDefault();
      openCommandPalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommandPalette]);

  useEffect(() => {
    const openShortcutsOverlay = (event: KeyboardEvent): void => {
      const shortcutKey = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (!shortcutKey || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      if (document.querySelector('[data-floating-layer="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", openShortcutsOverlay, true);
    return () => window.removeEventListener("keydown", openShortcutsOverlay, true);
  }, []);

  useEffect(() => {
    const cyclePanes = (event: KeyboardEvent): void => {
      if (event.key !== "F6" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"], .command-palette-root')) return;

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
  }, []);

  // Global keyboard: view digits 1–4, F = focus mode, Esc exits focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (e.key === "Escape" && focusMode) {
        // Escape belongs to the topmost dialog/popover first. In particular,
        // closing an exact-word chooser must not also exit Focus mode.
        if (document.querySelector(
          '[data-floating-layer="dialog"], [data-floating-layer="popover"], .command-palette-root, .connection-card',
        )) return;
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
        if (focusMode) toggleFocusMode();
        changeView(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeView, focusMode, toggleFocusMode]);

  const shellClass = [
    "app-shell",
    `theme-${theme}`,
    isDarkTheme(theme) ? "dark" : "",
    focusMode ? "focus-mode" : "",
    `reading-size-${readingSize}`,
    `reading-width-${readingWidth}`,
    `verse-nums-${verseNumbers}`,
  ]
    .filter(Boolean)
    .join(" ");
  const floatingMaterialClass = [
    `theme-${theme}`,
    isDarkTheme(theme) ? "dark" : "",
  ].filter(Boolean).join(" ");

  if (loadState.status === "loading") {
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
      detail: "Toggle the Living Margin",
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

  const runCommandAction = (id: string): void => {
    if (id === "new-note") {
      setWritingDraft((current) => current.title.trim() || current.body.trim()
        ? current
        : { title: contextLabel, body: "" });
      changeView("write");
    } else if (id === "toggle-study") {
      if (focusMode) toggleFocusMode();
      if (!marginVisible) toggleMargin();
      else if (!focusMode) toggleMargin();
    } else if (id === "toggle-focus") {
      toggleFocusMode();
    } else if (id === "open-notes") {
      setWorkspaceIntent({ nonce: Date.now() });
      changeView("notes");
    } else if (id === "search-notes") {
      setWorkspaceIntent({ query: "", nonce: Date.now() });
      changeView("search");
    } else if (id === "open-settings") {
      changeView("settings");
    }
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
      <ToastProvider materialClassName={floatingMaterialClass}>
        <div className={shellClass} data-theme={theme}>
          {!focusMode && (
            <nav
              className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}
              aria-label="Primary navigation"
            >
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
                <NavItem active={view === "scripture"} onClick={() => { changeView("scripture"); }} label="Read" icon={<ReadIcon />} shortcut="1" />
                <NavItem active={view === "write"} onClick={() => { changeView("write"); }} disabled={authoredMutationState !== "idle"} label="Write" icon={<WriteIcon />} shortcut="2" />
                <NavItem active={view === "notes"} onClick={() => { changeView("notes"); }} disabled={authoredMutationState !== "idle"} label="My notes" icon={<NotesIcon />} shortcut="3" />
                <NavItem active={view === "search"} onClick={() => { changeView("search"); }} disabled={authoredMutationState !== "idle"} label="Search" icon={<SearchIcon />} shortcut="4" />
                <div className="nav-divider" />
                <NavItem active={view === "settings"} onClick={() => { changeView("settings"); }} disabled={authoredMutationState !== "idle"} label="Settings" icon={<SettingsIcon />} shortcut="5" />
              </div>
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
          )}
          <div className="main-content">
            {view === "scripture" && (
              <ScripturePage
                backbone={backbone}
                bookNames={bookNames}
                navigateRef={navigateRef}
                onNavigateRefConsumed={consumeNavigateRef}
                navigationHistory={navigationHistory}
                onNavigationHistoryChange={setNavigationHistory}
                sessionEntry={canvasSessionEntry}
                onSessionEntryChange={setCanvasSessionEntry}
                onOpenCommandPalette={openCommandPalette}
                onReadingContextChange={handleReadingContextChange}
                onCreateNote={handleCreateNoteFromPassage}
                marginVisible={marginVisible && !focusMode}
                onAiBusyChange={setAiBusy}
                theme={theme}
                onThemeChange={toggleTheme}
                markingSurface={markingSurface}
                onToggleMargin={toggleMargin}
                onEnsureMarginVisible={ensureMarginVisible}
                readingSize={readingSize}
                readingWidth={readingWidth}
                verseNumbers={verseNumbers}
                onReadingPrefsChange={handleReadingPrefsChange}
                focusMode={focusMode}
                onToggleFocus={toggleFocusMode}
                onAuthoredMutationStateChange={handleAuthoredMutationStateChange}
                entityIntent={entityIntent}
                onOpenEntity={openEntityResearch}
                onCloseEntity={closeEntityResearch}
                entityTrail={entityResearchSession.trail}
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
                onWrite={() => { changeView("write"); }}
                initialQuery={workspaceIntent.query}
                intentNonce={workspaceIntent.nonce}
              />
            )}
            {view === "notes" && (
              <SearchView
                mode="notes"
                onNavigate={handleNavigateToRef}
                onWrite={() => { changeView("write"); }}
                initialNoteId={workspaceIntent.noteId}
                intentNonce={workspaceIntent.nonce}
              />
            )}
            {view === "settings" && (
              <SettingsPage
                libraryPath={libraryPath}
                readingSize={readingSize}
                readingWidth={readingWidth}
                verseNumbers={verseNumbers}
                onReadingPrefsChange={handleReadingPrefsChange}
                theme={theme}
                onThemeChange={toggleTheme}
                markingSurface={markingSurface}
                onMarkingSurfaceChange={changeMarkingSurface}
              />
            )}
          </div>
          {focusMode && (
            <button
              type="button"
              className="focus-exit-chip"
              onClick={toggleFocusMode}
              title="Exit focus mode (Esc or F)"
            >
              Exit focus
            </button>
          )}
          <CommandPalette
            open={commandOpen}
            onClose={closeCommandPalette}
            theme={theme}
            backbone={backbone}
            bookNames={bookNames}
            context={commandContext}
            actions={commandActions}
            onNavigate={handleNavigateToRef}
            onOpenNote={(noteId) => {
              setWorkspaceIntent({ noteId, nonce: Date.now() });
              changeView("notes");
            }}
            onOpenEntity={openCommandEntityResearch}
            onSearchNotes={(query) => {
              setWorkspaceIntent({ query, nonce: Date.now() });
              changeView("search");
            }}
            onRunAction={runCommandAction}
          />
          {shortcutsOpen && <ShortcutsOverlay onClose={closeShortcutsOverlay} />}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
