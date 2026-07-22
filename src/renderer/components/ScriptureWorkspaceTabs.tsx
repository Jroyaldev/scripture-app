import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookNameData } from "../api.js";
import {
  orderedStudyWorkspaceTabs,
  studyWorkspaceGroupCloseAvailability,
  studyWorkspaceGroupLabel,
  studyWorkspaceTabCloseAvailability,
  studyWorkspaceTabLabel,
  studyWorkspaceTabType,
  visibleStudyWorkspaceTabIds,
  type StudyWorkspaceGroup,
  type StudyWorkspaceStateV2,
  type StudyWorkspaceTab,
} from "../utils/studyWorkspace.js";
import { Popover } from "./Popover.js";

interface Props {
  workspace: StudyWorkspaceStateV2;
  bookNames: BookNameData;
  onSelect: (tabId: string) => Promise<boolean>;
  onClose: (tabId: string) => Promise<boolean>;
  onCloseGroup: (groupId: string) => Promise<boolean>;
  onToggleGroup: (groupId: string, collapsing: boolean) => Promise<boolean>;
  onNewResearch: () => void;
}

interface WorkspaceTabGroup {
  group: StudyWorkspaceGroup;
  label: string;
  tabs: StudyWorkspaceTab[];
  visibleTabs: StudyWorkspaceTab[];
}

interface SelectTabOptions {
  closeOverflow?: boolean;
  moveFocus?: boolean;
}

interface CloseTabOptions extends SelectTabOptions {}

function PassageGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2.5 4.2c2-.8 4-.6 6 .5v9.2c-2-1.1-4-1.3-6-.5zM15.5 4.2c-2-.8-4-.6-6 .5v9.2c2-1.1 4-1.3 6-.5z" />
    </svg>
  );
}

function CloseGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m4 4 6 6M10 4l-6 6" /></svg>;
}

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

function TabMark({ tab }: { tab: StudyWorkspaceTab }): React.JSX.Element {
  const kind = studyWorkspaceTabType(tab);
  if (kind === "passage") return <span className="scripture-workspace-tab-mark is-passage" aria-hidden="true"><PassageGlyph /></span>;
  if (kind === "person") return <span className="scripture-workspace-tab-mark is-person" aria-hidden="true"><PersonGlyph /></span>;
  if (kind === "place") return <span className="scripture-workspace-tab-mark is-place" aria-hidden="true"><PlaceGlyph /></span>;
  return <span className="scripture-workspace-tab-mark" aria-hidden="true" />;
}

export function ScriptureWorkspaceTabs({
  workspace,
  bookNames,
  onSelect,
  onClose,
  onCloseGroup,
  onToggleGroup,
  onNewResearch,
}: Props): React.JSX.Element {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<DOMRect | null>(null);
  const [hasMeasuredOverflow, setHasMeasuredOverflow] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingWorkspaceIntentCountRef = useRef(0);

  const visibleTabIds = useMemo(() => visibleStudyWorkspaceTabIds(workspace), [workspace]);
  const visibleTabIdSet = useMemo(() => new Set(visibleTabIds), [visibleTabIds]);
  const groups = useMemo<WorkspaceTabGroup[]>(() => workspace.groups.map((group) => {
    const tabs = orderedStudyWorkspaceTabs(workspace, group.id);
    return {
      group,
      label: studyWorkspaceGroupLabel(workspace, group, bookNames),
      tabs,
      visibleTabs: tabs.filter((tab) => visibleTabIdSet.has(tab.id)),
    };
  }), [bookNames, visibleTabIdSet, workspace]);

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
      const requested = tabId ? tabRefs.current.get(tabId) : undefined;
      const selected = viewportRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      const target = requested?.isConnected ? requested : selected ?? overflowButtonRef.current;
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (moveFocus) target?.focus({ preventScroll: true });
    });
  }, []);

  const dismissOverflow = useCallback((): void => {
    setOverflowOpen(false);
    window.requestAnimationFrame(() => {
      const trigger = overflowButtonRef.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }, []);

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
  }, [groups]);

  useLayoutEffect(() => {
    if (pendingWorkspaceIntentCountRef.current > 0) return;
    scheduleCommittedTabFocus(workspace.activeTabId, false);
  }, [scheduleCommittedTabFocus, visibleTabIds, workspace.activeTabId]);

  const handleSelectTab = useCallback(async (
    tabId: string,
    options: SelectTabOptions = {},
  ): Promise<boolean> => await runApprovedIntent(
    () => onSelect(tabId),
    () => {
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
        scheduleCommittedTabFocus(null, options.moveFocus ?? false);
      },
    ), [onClose, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleCloseGroup = useCallback(async (groupId: string): Promise<boolean> => await runApprovedIntent(
    () => onCloseGroup(groupId),
    () => {
      setOverflowOpen(false);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onCloseGroup, runApprovedIntent, scheduleCommittedTabFocus]);

  const toggleGroup = useCallback(async (
    groupId: string,
    collapsing: boolean,
    focusTarget?: HTMLButtonElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onToggleGroup(groupId, collapsing),
    () => window.requestAnimationFrame(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    }),
  ), [onToggleGroup, runApprovedIntent]);

  const handleTabAuxClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
  ): Promise<void> => {
    if (event.button !== 1 || !canClose) return;
    event.preventDefault();
    await handleCloseTab(tabId);
  };

  const handleTabKeyDown = async (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
  ): Promise<void> => {
    if (canClose && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      await handleCloseTab(tabId, { moveFocus: true });
      return;
    }
    const current = Math.max(0, visibleTabIds.indexOf(tabId));
    let index: number | null = null;
    if (event.key === "ArrowRight") index = (current + 1) % visibleTabIds.length;
    else if (event.key === "ArrowLeft") index = (current - 1 + visibleTabIds.length) % visibleTabIds.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visibleTabIds.length - 1;
    if (index == null) return;
    event.preventDefault();
    const next = visibleTabIds[index];
    if (next) await handleSelectTab(next, { moveFocus: true });
  };

  const deferMouseFocus = (event: React.MouseEvent<HTMLButtonElement>): void => event.preventDefault();
  const totalTabs = Object.keys(workspace.tabsById).length;

  return (
    <nav className="scripture-workspace-bar" aria-label="Study workspace tabs" data-study-workspace-bar="">
      <div
        ref={viewportRef}
        className={[
          "scripture-workspace-viewport",
          scrollEdges.left ? "is-scrollable-left" : "",
          scrollEdges.right ? "is-scrollable-right" : "",
        ].filter(Boolean).join(" ")}
        role="tablist"
        aria-label="Open study tabs"
      >
        {groups.flatMap(({ group, label: groupLabel, visibleTabs }) => visibleTabs.map((tab) => {
          const label = studyWorkspaceTabLabel(workspace, tab, bookNames);
          const selected = workspace.activeTabId === tab.id;
          const collapsedProxy = group.collapsed;
          const canClose = studyWorkspaceTabCloseAvailability(workspace, tab.id) === "direct";
          return (
            <div className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}${collapsedProxy ? " is-collapsed-proxy" : ""}`} role="presentation" key={tab.id}>
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                id={`study-workspace-tab-${tab.id}`}
                className={`scripture-workspace-tab is-${tab.kind}`}
                role="tab"
                aria-label={`${label}, ${groupLabel}`}
                aria-selected={selected}
                aria-controls="scripture-workspace-panel"
                aria-keyshortcuts={canClose ? "Delete" : undefined}
                tabIndex={selected ? 0 : -1}
                data-study-tab-id={tab.id}
                data-study-tab-kind={studyWorkspaceTabType(tab)}
                data-study-collapsed-proxy={collapsedProxy || undefined}
                title={`${label} — ${groupLabel}`}
                onMouseDown={deferMouseFocus}
                onClick={async (event) => {
                  if (event.target instanceof Element && event.target.closest("[data-workspace-tab-close]")) {
                    await handleCloseTab(tab.id, { moveFocus: true });
                    return;
                  }
                  await handleSelectTab(tab.id, { moveFocus: true });
                }}
                onAuxClick={(event) => handleTabAuxClick(event, tab.id, canClose)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id, canClose)}
              >
                <TabMark tab={tab} />
                <span className="scripture-workspace-tab-label">{label}</span>
                {canClose && (
                  <span className="scripture-workspace-tab-close" data-workspace-tab-close="" aria-hidden="true">
                    <CloseGlyph />
                  </span>
                )}
              </button>
            </div>
          );
        }))}
      </div>

      <div className="scripture-workspace-actions" role="toolbar" aria-label="Study tab controls">
        {groups.map(({ group, label, tabs }) => (
          <button
            key={group.id}
            type="button"
            className="scripture-workspace-group-toggle"
            data-study-group-id={group.id}
            aria-expanded={!group.collapsed}
            onMouseDown={deferMouseFocus}
            onClick={async (event) => { await toggleGroup(group.id, !group.collapsed, event.currentTarget); }}
            title={`${group.collapsed ? "Expand" : "Collapse"} ${label}`}
          >
            <span>{label}</span><small>{tabs.length}</small>
          </button>
        ))}
        <button type="button" className="scripture-workspace-new" onClick={onNewResearch} aria-label="Open a new study tab" title="New study tab">
          <span aria-hidden="true">+</span>
        </button>
        {(groups.length > 0 || hasMeasuredOverflow) && (
          <button
            ref={overflowButtonRef}
            type="button"
            className="scripture-workspace-overflow"
            data-study-all-tabs=""
            onClick={() => {
              setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
              setOverflowOpen(true);
            }}
            aria-label={`Show all ${totalTabs} study tabs`}
            aria-haspopup="dialog"
            aria-expanded={overflowOpen}
            title="All study tabs and groups"
          ><span aria-hidden="true">•••</span></button>
        )}
      </div>

      {overflowOpen && overflowAnchor && (
        <Popover
          anchorRect={overflowAnchor}
          onClose={dismissOverflow}
          width={340}
          maxHeight={520}
          className="scripture-workspace-overflow-popover"
          ariaLabel="All study tabs"
        >
          <div className="scripture-workspace-overflow-head"><strong>Study tabs</strong><span>{totalTabs} open</span></div>
          <div className="scripture-workspace-overflow-list">
            {groups.map(({ group, label, tabs }) => {
              const canCloseGroup = studyWorkspaceGroupCloseAvailability(workspace, group.id) === "direct";
              return (
                <section className="scripture-workspace-overflow-group" aria-label={label} key={group.id}>
                  <header>
                    <span>{label} · {tabs.length}</span>
                    <div>
                      <button type="button" aria-expanded={!group.collapsed} onMouseDown={deferMouseFocus} onClick={async (event) => { await toggleGroup(group.id, !group.collapsed, event.currentTarget); }}>
                        {group.collapsed ? "Expand" : "Collapse"}
                      </button>
                      {canCloseGroup && (
                        <button type="button" onMouseDown={deferMouseFocus} onClick={async () => { await handleCloseGroup(group.id); }}>Close group</button>
                      )}
                    </div>
                  </header>
                  {tabs.map((tab) => {
                    const tabLabel = studyWorkspaceTabLabel(workspace, tab, bookNames);
                    const canClose = studyWorkspaceTabCloseAvailability(workspace, tab.id) === "direct";
                    return (
                      <div className="scripture-workspace-overflow-row" data-study-all-tabs-row="" key={tab.id}>
                        <button
                          type="button"
                          className={workspace.activeTabId === tab.id ? "is-active" : undefined}
                          onClick={async () => { await handleSelectTab(tab.id, { closeOverflow: true, moveFocus: true }); }}
                        >
                          <TabMark tab={tab} /><span>{tabLabel}</span>
                          {workspace.activeTabId === tab.id && <small>Current</small>}
                        </button>
                        {canClose && (
                          <button type="button" aria-label={`Close ${tabLabel}`} onMouseDown={deferMouseFocus} onClick={async () => { await handleCloseTab(tab.id, { closeOverflow: true, moveFocus: true }); }}><CloseGlyph /></button>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </Popover>
      )}
    </nav>
  );
}
