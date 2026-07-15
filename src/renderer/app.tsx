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
import { WritingSheet } from "./components/WritingSheet.js";
import { SearchView } from "./components/SearchView.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ToastProvider } from "./components/Toast.js";
import { Popover } from "./components/Popover.js";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import type { ReadingPrefs } from "./components/ReadingComfort.js";
import { isDarkTheme, type AppTheme } from "./theme.js";
import { safeCall } from "./utils/safeCall.js";
import "./styles.css";

type View = "scripture" | "write" | "search" | "notes" | "settings";
type LoadState =
  | { status: "loading" }
  | { status: "loaded"; backbone: BackboneData; bookNames: BookNameData; libraryPath: string }
  | { status: "error"; error: string }
  | { status: "first-run"; defaultPath: string };

function PanelToggleIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="12" rx="2.5" />
      <path d="M7.5 4v12" />
    </svg>
  );
}

function BookMarkIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5c2-.8 3.6-.8 6 .2v9c-2.4-1-4-1-6-.2z" />
      <path d="M16 5c-2-.8-3.6-.8-6 .2v9c2.4-1 4-1 6-.2z" />
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
  label: string;
  icon: React.JSX.Element;
  /** Keyboard digit shown in tooltip, e.g. "1" → "Read (1)" */
  shortcut?: string;
}

function NavItem({ active, onClick, label, icon, shortcut }: NavItemProps): React.JSX.Element {
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
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
  const [navigateRef, setNavigateRef] = useState<{ book: string; chapter: number } | null>(null);
  const [editNoteBody, setEditNoteBody] = useState<string>("");
  const [marginVisible, setMarginVisible] = useState(() => {
    return localStorage.getItem("marginVisible") !== "false";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<AppSettings["theme"]>("light");
  const [readingSize, setReadingSize] = useState<ReadingSize>("m");
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>("medium");
  const [verseNumbers, setVerseNumbers] = useState<VerseNumberMode>("always");
  const [focusMode, setFocusMode] = useState(false);
  /** Margin visibility before focus mode — restored on exit. */
  const preFocusMargin = useRef(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [libraryPopoverOpen, setLibraryPopoverOpen] = useState(false);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const [libraryAnchorRect, setLibraryAnchorRect] = useState<DOMRect | null>(null);
  const settingsLoaded = useRef(false);
  // Tracks which persisted settings the user has already changed via the UI
  // before the initial settings.get() resolved. The load effect must not
  // clobber a setting the user has touched in the interim (see the
  // settings-load effect below for the race this guards against).
  const userDirtySettings = useRef({ sidebarCollapsed: false, marginVisible: false, theme: false });

  const loadData = useCallback(async () => {
    setLoadState({ status: "loading" });

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
      setLoadState({ status: "first-run", defaultPath: infoRes.value.path });
      return;
    }

    const libraryPath = pathRes.ok ? pathRes.value : "Unknown";
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
        if (res.value.readingSize) setReadingSize(res.value.readingSize);
        if (res.value.readingWidth) setReadingWidth(res.value.readingWidth);
        if (res.value.verseNumbers) setVerseNumbers(res.value.verseNumbers);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist sidebarCollapsed / marginVisible / theme whenever they change (fire-and-forget).
  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ sidebarCollapsed }));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ marginVisible }));
  }, [marginVisible]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ theme }));
  }, [theme]);

  useEffect(() => {
    if (!settingsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ readingSize, readingWidth, verseNumbers }));
  }, [readingSize, readingWidth, verseNumbers]);

  const handleCreateNoteFromPassage = (prefillBody?: string) => {
    setEditNoteBody(prefillBody ?? "");
    setView("write");
  };

  const handleNavigateToRef = (book: string, chapter: number) => {
    setNavigateRef({ book, chapter });
    setView("scripture");
  };

  const toggleSidebarCollapsed = () => {
    userDirtySettings.current.sidebarCollapsed = true;
    setSidebarCollapsed((prev) => !prev);
  };

  const toggleLibraryPopover = () => {
    if (!libraryPopoverOpen && libraryTriggerRef.current) {
      setLibraryAnchorRect(libraryTriggerRef.current.getBoundingClientRect());
    }
    setLibraryPopoverOpen((prev) => !prev);
  };

  const closeLibraryPopover = () => {
    setLibraryPopoverOpen(false);
  };

  const handleManageInSettings = () => {
    setLibraryPopoverOpen(false);
    setView("settings");
  };

  const toggleMargin = () => {
    userDirtySettings.current.marginVisible = true;
    setMarginVisible((prev) => !prev);
  };

  const toggleTheme = (nextTheme: AppTheme) => {
    userDirtySettings.current.theme = true;
    setTheme(() => nextTheme);
  };

  const handleReadingPrefsChange = useCallback((partial: Partial<ReadingPrefs>) => {
    if (partial.readingSize) setReadingSize(partial.readingSize);
    if (partial.readingWidth) setReadingWidth(partial.readingWidth);
    if (partial.verseNumbers) setVerseNumbers(partial.verseNumbers);
  }, []);

  const toggleFocusMode = useCallback(() => {
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
  }, [marginVisible]);

  // Global keyboard: view digits 1–4, F = focus mode, Esc exits focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        if (focusMode) toggleFocusMode();
        setView(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, toggleFocusMode]);

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
          <h1 className="loading-title">Scripture Library</h1>
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
        onClick={async () => {
          closeLibraryPopover();
          const res = await window.api.library.revealInFinder();
          if (!res.ok) alert(`Could not reveal library: ${res.error}`);
        }}
      >
        Reveal in Finder
      </button>
      <button
        type="button"
        className="control-menu-item library-popover-settings"
        onClick={async () => {
          closeLibraryPopover();
          const chosen = await window.api.dialog.openDirectory();
          if (!chosen || chosen === libraryPath) return;
          const res = await window.api.library.init(chosen);
          if (res.ok) window.location.reload();
          else alert(`Switch failed: ${res.error}`);
        }}
      >
        Switch Library…
      </button>
      <button type="button" className="control-menu-item library-popover-settings" onClick={handleManageInSettings}>
        Manage in Settings →
      </button>
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
              <button
                className="sidebar-collapse-btn"
                onClick={toggleSidebarCollapsed}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!sidebarCollapsed}
              >
                <PanelToggleIcon />
              </button>
              <div className="sidebar-header">
                <div className="brand-row" aria-label="Scripture">
                  <div className="brand-mark">
                    <BookMarkIcon />
                  </div>
                  <div className="brand-word">Scripture</div>
                </div>
              </div>
              <div className="sidebar-nav">
                <NavItem active={view === "scripture"} onClick={() => setView("scripture")} label="Read" icon={<ReadIcon />} shortcut="1" />
                <NavItem active={view === "write"} onClick={() => setView("write")} label="Write" icon={<WriteIcon />} shortcut="2" />
                <NavItem active={view === "notes"} onClick={() => setView("notes")} label="Notes" icon={<NotesIcon />} shortcut="3" />
                <NavItem active={view === "search"} onClick={() => setView("search")} label="Search" icon={<SearchIcon />} shortcut="4" />
                <div className="nav-divider" />
                <NavItem active={view === "settings"} onClick={() => setView("settings")} label="Settings" icon={<SettingsIcon />} shortcut="5" />
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
                onCreateNote={handleCreateNoteFromPassage}
                marginVisible={marginVisible && !focusMode}
                onAiBusyChange={setAiBusy}
                theme={theme}
                onThemeChange={toggleTheme}
                onToggleMargin={toggleMargin}
                readingSize={readingSize}
                readingWidth={readingWidth}
                verseNumbers={verseNumbers}
                onReadingPrefsChange={handleReadingPrefsChange}
                focusMode={focusMode}
                onToggleFocus={toggleFocusMode}
              />
            )}
            {view === "write" && (
              <WritingSheet prefillBody={editNoteBody} onSaved={() => setEditNoteBody("")} />
            )}
            {view === "search" && <SearchView onNavigate={handleNavigateToRef} />}
            {view === "notes" && <SearchView onNavigate={handleNavigateToRef} showAll />}
            {view === "settings" && (
              <SettingsPage
                libraryPath={libraryPath}
                readingSize={readingSize}
                readingWidth={readingWidth}
                verseNumbers={verseNumbers}
                onReadingPrefsChange={handleReadingPrefsChange}
                theme={theme}
                onThemeChange={toggleTheme}
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
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
