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
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseGroup: (groupKey: string) => void;
  onNewResearch: () => void;
}

interface ResearchTabGroup {
  key: string;
  label: string;
  tabs: ResearchWorkspaceTab[];
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

function ChevronGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="m3.25 1.75 3 3.25-3 3.25" />
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
    tabRefs.current.get(activeTabId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, visibleTabIds]);

  const closeOverflow = useCallback((): void => {
    setOverflowOpen(false);
    window.requestAnimationFrame(() => overflowButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tabId: string): void => {
    if ((event.key === "Delete" || event.key === "Backspace") && tabId !== SCRIPTURE_WORKSPACE_ID) {
      event.preventDefault();
      onClose(tabId);
      window.requestAnimationFrame(() => tabRefs.current.get(activeTabId)?.focus({ preventScroll: true }));
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
    onSelect(next);
    tabRefs.current.get(next)?.focus({ preventScroll: true });
  };

  const handleTabAuxClick = (event: React.MouseEvent<HTMLButtonElement>, tabId: string): void => {
    if (event.button !== 1 || tabId === SCRIPTURE_WORKSPACE_ID) return;
    event.preventDefault();
    onClose(tabId);
  };

  const toggleGroup = (group: ResearchTabGroup): void => {
    const collapsing = !collapsedGroups.has(group.key);
    if (collapsing && group.tabs.some((tab) => tab.id === activeTabId)) onSelect(SCRIPTURE_WORKSPACE_ID);
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group.key)) next.delete(group.key);
      else next.add(group.key);
      return next;
    });
  };

  const openOverflow = (): void => {
    setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
    setOverflowOpen(true);
  };
  const showOverflow = tabs.length > 5 || hasMeasuredOverflow;

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
          onClick={() => onSelect(SCRIPTURE_WORKSPACE_ID)}
          onKeyDown={(event) => handleTabKeyDown(event, SCRIPTURE_WORKSPACE_ID)}
        >
          <ScriptureGlyph />
          <span>Scripture</span>
        </button>

        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.key);
          return (
            <div className={`scripture-workspace-group${collapsed ? " is-collapsed" : ""}`} role="group" aria-label={`${group.label} research`} key={group.key}>
              <button
                type="button"
                className="scripture-workspace-group-toggle"
                aria-expanded={!collapsed}
                onClick={() => toggleGroup(group)}
                title={`${collapsed ? "Expand" : "Collapse"} ${group.label} research group`}
              >
                <span className="scripture-workspace-group-caret" aria-hidden="true"><ChevronGlyph /></span>
                <span>{group.label}</span>
                <span className="scripture-workspace-group-count">{group.tabs.length}</span>
              </button>
              {!collapsed && group.tabs.map((tab) => {
                const label = researchWorkspaceTabLabel(tab);
                const selected = activeTabId === tab.id;
                return (
                  <div className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}`} key={tab.id}>
                    <button
                      ref={(node) => {
                        if (node) tabRefs.current.set(tab.id, node);
                        else tabRefs.current.delete(tab.id);
                      }}
                      type="button"
                      id={`research-workspace-tab-${tab.id}`}
                      className="scripture-workspace-tab is-research"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="scripture-workspace-panel"
                      aria-keyshortcuts="Delete"
                      tabIndex={selected ? 0 : -1}
                      title={`${label} — ${group.label} research`}
                      onClick={() => onSelect(tab.id)}
                      onAuxClick={(event) => handleTabAuxClick(event, tab.id)}
                      onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                    >
                      <TabMark kind={researchWorkspaceTabKind(tab)} />
                      <span className="scripture-workspace-tab-label">{label}</span>
                    </button>
                    <button
                      type="button"
                      className="scripture-workspace-tab-close"
                      tabIndex={-1}
                      aria-label={`Close ${label} research`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(tab.id);
                      }}
                    >
                      <CloseGlyph />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="scripture-workspace-actions">
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
            title="All research tabs"
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
                  <button
                    type="button"
                    onClick={() => {
                      const activeInGroup = group.tabs.some((tab) => tab.id === activeTabId);
                      onCloseGroup(group.key);
                      setOverflowOpen(false);
                      window.requestAnimationFrame(() => {
                        const target = activeInGroup
                          ? tabRefs.current.get(SCRIPTURE_WORKSPACE_ID)
                          : tabRefs.current.get(activeTabId) ?? overflowButtonRef.current;
                        target?.focus({ preventScroll: true });
                      });
                    }}
                    aria-label={`Close ${group.label} group`}
                  >Close group</button>
                </header>
                {group.tabs.map((tab) => {
                  const label = researchWorkspaceTabLabel(tab);
                  return (
                    <div className="scripture-workspace-overflow-row" key={tab.id}>
                      <button
                        type="button"
                        className={activeTabId === tab.id ? "is-active" : undefined}
                        title={`${label} — ${group.label} research`}
                        onClick={() => {
                          setCollapsedGroups((current) => {
                            const next = new Set(current);
                            next.delete(group.key);
                            return next;
                          });
                          onSelect(tab.id);
                          setOverflowOpen(false);
                          window.requestAnimationFrame(() => tabRefs.current.get(tab.id)?.focus({ preventScroll: true }));
                        }}
                      >
                        <TabMark kind={researchWorkspaceTabKind(tab)} />
                        <span>{label}</span>
                        {activeTabId === tab.id && <small>Current</small>}
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${label} research`}
                        onClick={() => {
                          onClose(tab.id);
                          setOverflowOpen(false);
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
