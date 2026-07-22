import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookNameData } from "../api.js";
import {
  researchOriginGroupKey,
  researchWorkspaceTabKind,
  researchWorkspaceTabLabel,
  SCRIPTURE_WORKSPACE_ID,
  type ResearchWorkspaceTab,
} from "../utils/researchWorkspace.js";
import { Popover } from "./Popover.js";

interface Props {
  tabs: readonly ResearchWorkspaceTab[];
  activeTabId: string;
  bookNames: BookNameData;
  onSelect: (tabId: string) => Promise<boolean>;
  onClose: (tabId: string) => Promise<boolean>;
  onCloseGroup: (groupKey: string) => Promise<boolean>;
  onToggleGroup: (groupKey: string, collapsing: boolean) => Promise<boolean>;
  onNewResearch: () => void;
}

interface ResearchTabGroup {
  key: string;
  label: string;
  tabs: ResearchWorkspaceTab[];
}

interface SelectTabOptions {
  expandGroupKey?: string;
  closeOverflow?: boolean;
  moveFocus?: boolean;
}

interface CloseTabOptions {
  closeOverflow?: boolean;
  moveFocus?: boolean;
}

function groupLabel(tab: ResearchWorkspaceTab, bookNames: BookNameData): string {
  const book = bookNames[tab.origin.book]?.[0] ?? tab.origin.book;
  return `${book} ${tab.origin.chapter}`;
}

function ScriptureGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2.5 4.2c2-.8 4-.6 6 .5v9.2c-2-1.1-4-1.3-6-.5zM15.5 4.2c-2-.8-4-.6-6 .5v9.2c2-1.1 4-1.3 6-.5z" />
    </svg>
  );
}

function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m4 4 6 6M10 4l-6 6" />
    </svg>
  );
}

/* Kind marks are quiet single-stroke glyphs at the same optical weight as the
   close/chevron marks — a hint of who or where, never an icon billboard. */
function PersonGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="3.8" r="2" />
      <path d="M2.1 10.3c.75-2.2 2.15-3.2 3.9-3.2s3.15 1 3.9 3.2" />
    </svg>
  );
}

function PlaceGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 10.6S2.8 7.1 2.8 4.8a3.2 3.2 0 1 1 6.4 0C9.2 7.1 6 10.6 6 10.6Z" />
      <circle cx="6" cy="4.8" r="1.05" />
    </svg>
  );
}

type ResearchTabKind = ReturnType<typeof researchWorkspaceTabKind>;

function TabMark({ kind }: { kind: ResearchTabKind }): React.JSX.Element {
  if (kind === "person") return <span className="scripture-workspace-tab-mark is-person" aria-hidden="true"><PersonGlyph /></span>;
  if (kind === "place") return <span className="scripture-workspace-tab-mark is-place" aria-hidden="true"><PlaceGlyph /></span>;
  return <span className="scripture-workspace-tab-mark" aria-hidden="true" />;
}

export function ScriptureWorkspaceTabs({
  tabs,
  activeTabId,
  bookNames,
  onSelect,
  onClose,
  onCloseGroup,
  onToggleGroup,
  onNewResearch,
}: Props): React.JSX.Element {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<DOMRect | null>(null);
  const [hasMeasuredOverflow, setHasMeasuredOverflow] = useState(false);
  const [scrollEdges, setScrollEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingWorkspaceIntentCountRef = useRef(0);

  const runApprovedIntent = useCallback(async (
    request: () => Promise<boolean>,
    commit: () => void,
  ): Promise<boolean> => {
    pendingWorkspaceIntentCountRef.current += 1;
    try {
      const approved = await request();
      if (!approved) return false;
      commit();
      return true;
    } catch {
      return false;
    } finally {
      pendingWorkspaceIntentCountRef.current = Math.max(0, pendingWorkspaceIntentCountRef.current - 1);
    }
  }, []);

  const scheduleCommittedTabFocus = useCallback((tabId: string | null, moveFocus: boolean): void => {
    window.requestAnimationFrame(() => {
      const requestedTab = tabId ? tabRefs.current.get(tabId) : undefined;
      const selectedTab = viewportRef.current?.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      );
      const target = requestedTab?.isConnected
        ? requestedTab
        : selectedTab ?? overflowButtonRef.current;
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (moveFocus) target?.focus({ preventScroll: true });
    });
  }, []);

  const groups = useMemo<ResearchTabGroup[]>(() => {
    const byKey = new Map<string, ResearchTabGroup>();
    for (const tab of tabs) {
      const key = researchOriginGroupKey(tab.origin);
      const existing = byKey.get(key);
      if (existing) existing.tabs.push(tab);
      else byKey.set(key, { key, label: groupLabel(tab, bookNames), tabs: [tab] });
    }
    return [...byKey.values()];
  }, [bookNames, tabs]);

  const visibleTabIds = useMemo(() => [
    SCRIPTURE_WORKSPACE_ID,
    ...groups.flatMap((group) => collapsedGroups.has(group.key) ? [] : group.tabs.map((tab) => tab.id)),
  ], [collapsedGroups, groups]);

  useLayoutEffect(() => {
    if (pendingWorkspaceIntentCountRef.current > 0) return;
    if (activeTabId === SCRIPTURE_WORKSPACE_ID) return;
    const activeGroup = groups.find((group) => group.tabs.some((tab) => tab.id === activeTabId));
    if (!activeGroup || !collapsedGroups.has(activeGroup.key)) return;
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.delete(activeGroup.key);
      return next;
    });
  }, [activeTabId, collapsedGroups, groups]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = (): void => {
      setHasMeasuredOverflow(viewport.scrollWidth > viewport.clientWidth + 2);
      setScrollEdges({
        left: viewport.scrollLeft > 2,
        right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    viewport.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, [groups, collapsedGroups]);

  useLayoutEffect(() => {
    if (pendingWorkspaceIntentCountRef.current > 0) return;
    scheduleCommittedTabFocus(activeTabId, false);
  }, [activeTabId, scheduleCommittedTabFocus, visibleTabIds]);

  const closeOverflow = useCallback((): void => {
    setOverflowOpen(false);
    window.requestAnimationFrame(() => overflowButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  const deferMouseFocus = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
  }, []);

  const handleSelectTab = useCallback(async (
    tabId: string,
    options: SelectTabOptions = {},
  ): Promise<boolean> => await runApprovedIntent(
    () => onSelect(tabId),
    () => {
      if (options.expandGroupKey) {
        setCollapsedGroups((current) => {
          if (!current.has(options.expandGroupKey!)) return current;
          const next = new Set(current);
          next.delete(options.expandGroupKey!);
          return next;
        });
      }
      if (options.closeOverflow) setOverflowOpen(false);
      scheduleCommittedTabFocus(tabId, options.moveFocus ?? false);
    },
  ), [onSelect, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleCloseTab = useCallback(async (
    tabId: string,
    options: CloseTabOptions = {},
  ): Promise<boolean> => await runApprovedIntent(
    () => onClose(tabId),
    () => {
      if (options.closeOverflow) setOverflowOpen(false);
      if (options.moveFocus) scheduleCommittedTabFocus(null, true);
    },
  ), [onClose, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleCloseGroup = useCallback(async (group: ResearchTabGroup): Promise<boolean> => await runApprovedIntent(
    () => onCloseGroup(group.key),
    () => {
      setOverflowOpen(false);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onCloseGroup, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleTabKeyDown = async (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ): Promise<void> => {
    if ((event.key === "Delete" || event.key === "Backspace") && tabId !== SCRIPTURE_WORKSPACE_ID) {
      event.preventDefault();
      await handleCloseTab(tabId, { moveFocus: true });
      return;
    }
    let index: number | null = null;
    const current = Math.max(0, visibleTabIds.indexOf(tabId));
    if (event.key === "ArrowRight") index = (current + 1) % visibleTabIds.length;
    else if (event.key === "ArrowLeft") index = (current - 1 + visibleTabIds.length) % visibleTabIds.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visibleTabIds.length - 1;
    if (index == null) return;
    event.preventDefault();
    const next = visibleTabIds[index]!;
    await handleSelectTab(next, { moveFocus: true });
  };

  const handleTabAuxClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    tabId: string,
  ): Promise<void> => {
    if (event.button !== 1 || tabId === SCRIPTURE_WORKSPACE_ID) return;
    event.preventDefault();
    await handleCloseTab(tabId);
  };

  const toggleGroup = async (
    group: ResearchTabGroup,
    focusTarget: HTMLButtonElement,
  ): Promise<void> => {
    const collapsing = !collapsedGroups.has(group.key);
    await runApprovedIntent(
      () => onToggleGroup(group.key, collapsing),
      () => {
        setCollapsedGroups((current) => {
          const next = new Set(current);
          if (collapsing) next.add(group.key);
          else next.delete(group.key);
          return next;
        });
        window.requestAnimationFrame(() => {
          if (focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
        });
      },
    );
  };

  const openOverflow = (): void => {
    setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
    setOverflowOpen(true);
  };
  const showOverflow = groups.length > 0 || hasMeasuredOverflow;

  return (
    <nav className="scripture-workspace-bar" aria-label="Scripture and research workspaces">
      <div
        className={[
          "scripture-workspace-viewport",
          scrollEdges.left ? "is-scrollable-left" : "",
          scrollEdges.right ? "is-scrollable-right" : "",
        ].filter(Boolean).join(" ")}
        ref={viewportRef}
        role="tablist" aria-label="Open workspaces"
      >
        <button
          ref={(node) => {
            if (node) tabRefs.current.set(SCRIPTURE_WORKSPACE_ID, node);
            else tabRefs.current.delete(SCRIPTURE_WORKSPACE_ID);
          }}
          type="button"
          id="scripture-workspace-tab"
          className="scripture-workspace-tab is-scripture"
          role="tab"
          aria-selected={activeTabId === SCRIPTURE_WORKSPACE_ID}
          aria-controls="scripture-workspace-panel"
          tabIndex={activeTabId === SCRIPTURE_WORKSPACE_ID ? 0 : -1}
          onMouseDown={deferMouseFocus}
          onClick={async () => {
            await handleSelectTab(SCRIPTURE_WORKSPACE_ID, { moveFocus: true });
          }}
          onKeyDown={(event) => handleTabKeyDown(event, SCRIPTURE_WORKSPACE_ID)}
        >
          <ScriptureGlyph />
          <span>Scripture</span>
        </button>

        {groups.flatMap((group) => collapsedGroups.has(group.key) ? [] : group.tabs.map((tab) => {
          const label = researchWorkspaceTabLabel(tab);
          const selected = activeTabId === tab.id;
          return (
            <div
              className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}`}
              role="presentation"
              key={tab.id}
            >
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                id={`research-workspace-tab-${tab.id}`}
                className="scripture-workspace-tab is-research"
                role="tab"
                aria-label={`${label}, ${group.label} research`}
                aria-selected={selected}
                aria-controls="scripture-workspace-panel"
                aria-keyshortcuts="Delete"
                tabIndex={selected ? 0 : -1}
                title={`${label} — ${group.label} research`}
                onMouseDown={deferMouseFocus}
                onClick={async (event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest("[data-workspace-tab-close]")) {
                    await handleCloseTab(tab.id, { moveFocus: true });
                    return;
                  }
                  await handleSelectTab(tab.id, { moveFocus: true });
                }}
                onAuxClick={(event) => handleTabAuxClick(event, tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              >
                <TabMark kind={researchWorkspaceTabKind(tab)} />
                <span className="scripture-workspace-tab-label">{label}</span>
                <span
                  className="scripture-workspace-tab-close"
                  data-workspace-tab-close=""
                  title={`Close ${label} research`}
                  aria-hidden="true"
                >
                  <CloseGlyph />
                </span>
              </button>
            </div>
          );
        }))}
      </div>

      <div className="scripture-workspace-actions" role="toolbar" aria-label="Workspace tab controls">
        <button type="button" className="scripture-workspace-new" onClick={onNewResearch} aria-label="Open a new research tab" title="New research">
          <span aria-hidden="true">+</span>
        </button>
        {showOverflow && (
          <button
            ref={overflowButtonRef}
            type="button"
            className="scripture-workspace-overflow"
            onClick={openOverflow}
            aria-label={`Show all ${tabs.length} research tabs`}
            aria-haspopup="dialog"
            aria-expanded={overflowOpen}
            title={hasMeasuredOverflow ? "All research tabs — more tabs off screen" : "All research tabs and groups"}
          >
            <span aria-hidden="true">•••</span>
          </button>
        )}
      </div>

      {overflowOpen && overflowAnchor && (
        <Popover
          anchorRect={overflowAnchor}
          onClose={closeOverflow}
          width={320}
          maxHeight={520}
          className="scripture-workspace-overflow-popover"
          ariaLabel="All research tabs"
        >
          <div className="scripture-workspace-overflow-head">
            <strong>Research tabs</strong>
            <span>{tabs.length} open</span>
          </div>
          <div className="scripture-workspace-overflow-list">
            {groups.map((group) => (
              <section className="scripture-workspace-overflow-group" aria-label={group.label} key={group.key}>
                <header>
                  <span>{group.label} · {group.tabs.length}</span>
                  <div>
                    <button
                      type="button"
                      aria-expanded={!collapsedGroups.has(group.key)}
                      onMouseDown={deferMouseFocus}
                      onClick={async (event) => {
                        const focusTarget = event.currentTarget;
                        await toggleGroup(group, focusTarget);
                      }}
                      aria-label={`${collapsedGroups.has(group.key) ? "Expand" : "Collapse"} ${group.label} group`}
                    >
                      {collapsedGroups.has(group.key) ? "Expand" : "Collapse"}
                    </button>
                    <button
                      type="button"
                      onMouseDown={deferMouseFocus}
                      onClick={async () => {
                        await handleCloseGroup(group);
                      }}
                      aria-label={`Close ${group.label} group`}
                    >Close group</button>
                  </div>
                </header>
                {group.tabs.map((tab) => {
                  const label = researchWorkspaceTabLabel(tab);
                  return (
                    <div className="scripture-workspace-overflow-row" key={tab.id}>
                      <button
                        type="button"
                        className={activeTabId === tab.id ? "is-active" : undefined}
                        title={`${label} — ${group.label} research`}
                        onMouseDown={deferMouseFocus}
                        onClick={async () => {
                          await handleSelectTab(tab.id, {
                            expandGroupKey: group.key,
                            closeOverflow: true,
                            moveFocus: true,
                          });
                        }}
                      >
                        <TabMark kind={researchWorkspaceTabKind(tab)} />
                        <span>{label}</span>
                        {activeTabId === tab.id && <small>Current</small>}
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${label} research`}
                        onMouseDown={deferMouseFocus}
                        onClick={async () => {
                          await handleCloseTab(tab.id, {
                            closeOverflow: true,
                            moveFocus: true,
                          });
                        }}
                      >
                        <CloseGlyph />
                      </button>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </Popover>
      )}
    </nav>
  );
}
