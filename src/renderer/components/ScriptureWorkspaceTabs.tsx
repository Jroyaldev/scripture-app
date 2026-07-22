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
  type WorkspaceCloseAvailability,
} from "../utils/studyWorkspace.js";
import type { WorkspacePersistenceStatus } from "../utils/workspacePersistence.js";
import { Popover } from "./Popover.js";

export type WorkspaceReorderPosition = "left" | "right" | "start" | "end";

export interface ScriptureWorkspaceTabsProps {
  workspace: StudyWorkspaceStateV2;
  bookNames: BookNameData;
  onSelect: (tabId: string) => Promise<boolean>;
  onClose: (tabId: string) => Promise<boolean>;
  onCloseGroup: (groupId: string) => Promise<boolean>;
  onToggleGroup: (groupId: string, collapsing: boolean) => Promise<boolean>;
  onRenameGroup: (groupId: string, label: string) => Promise<boolean>;
  onMoveTab: (tabId: string, targetGroupId: string) => Promise<boolean>;
  onReorderTab: (tabId: string, position: WorkspaceReorderPosition) => Promise<boolean>;
  onReorderGroup: (groupId: string, position: WorkspaceReorderPosition) => Promise<boolean>;
  onReopenRecent: () => Promise<boolean>;
  onNewResearch: () => void;
  persistenceStatus: WorkspacePersistenceStatus;
  onRetryPersistence: () => Promise<boolean>;
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

export function studyWorkspaceRovingTabId(
  visibleTabIds: readonly string[],
  activeTabId: string,
): string | null {
  if (visibleTabIds.includes(activeTabId)) return activeTabId;
  return visibleTabIds[0] ?? null;
}

export function studyWorkspaceSearchMatches(query: string, ...terms: string[]): boolean {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = terms.join(" ").toLocaleLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function studyWorkspaceCloseActionCopy(
  subject: string,
  availability: WorkspaceCloseAvailability,
): { ariaLabel: string; title: string } {
  const ariaLabel = `Close ${subject}`;
  if (availability !== "decision") return { ariaLabel, title: ariaLabel };
  return {
    ariaLabel: `${ariaLabel} (confirmation required)`,
    title: `Review what will close before closing ${subject}`,
  };
}

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

function ReorderOptions(): React.JSX.Element {
  return (
    <>
      <option value="">Order…</option>
      <option value="start">Move to first</option>
      <option value="left">Move earlier</option>
      <option value="right">Move later</option>
      <option value="end">Move to last</option>
    </>
  );
}

export function ScriptureWorkspaceTabs({
  workspace,
  bookNames,
  onSelect,
  onClose,
  onCloseGroup,
  onToggleGroup,
  onRenameGroup,
  onMoveTab,
  onReorderTab,
  onReorderGroup,
  onReopenRecent,
  onNewResearch,
  persistenceStatus,
  onRetryPersistence,
}: ScriptureWorkspaceTabsProps): React.JSX.Element {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<DOMRect | null>(null);
  const [overflowQuery, setOverflowQuery] = useState("");
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [groupMenuAnchor, setGroupMenuAnchor] = useState<DOMRect | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [hasMeasuredOverflow, setHasMeasuredOverflow] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const overflowSearchRef = useRef<HTMLInputElement>(null);
  const groupMenuButtonRef = useRef<HTMLButtonElement>(null);
  const groupRenameInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingWorkspaceIntentCountRef = useRef(0);

  const visibleTabIds = useMemo(() => visibleStudyWorkspaceTabIds(workspace), [workspace]);
  const visibleTabIdSet = useMemo(() => new Set(visibleTabIds), [visibleTabIds]);
  const rovingTabId = useMemo(
    () => studyWorkspaceRovingTabId(visibleTabIds, workspace.activeTabId),
    [visibleTabIds, workspace.activeTabId],
  );
  const groups = useMemo<WorkspaceTabGroup[]>(() => workspace.groups.map((group) => {
    const tabs = orderedStudyWorkspaceTabs(workspace, group.id);
    return {
      group,
      label: studyWorkspaceGroupLabel(workspace, group, bookNames),
      tabs,
      visibleTabs: tabs.filter((tab) => visibleTabIdSet.has(tab.id)),
    };
  }), [bookNames, visibleTabIdSet, workspace]);
  const activeGroup = useMemo(() => {
    const activeTab = workspace.tabsById[workspace.activeTabId];
    return activeTab ? groups.find(({ group }) => group.id === activeTab.groupId) ?? null : null;
  }, [groups, workspace.activeTabId, workspace.tabsById]);
  const activeGroupCloseAvailability = activeGroup
    ? studyWorkspaceGroupCloseAvailability(workspace, activeGroup.group.id)
    : "unavailable";
  const activeGroupCloseCopy = activeGroup
    ? studyWorkspaceCloseActionCopy(`study ${activeGroup.label}`, activeGroupCloseAvailability)
    : null;
  const filteredGroups = useMemo(() => groups.flatMap((entry) => {
    const groupMatches = studyWorkspaceSearchMatches(overflowQuery, entry.label);
    const tabs = groupMatches
      ? entry.tabs
      : entry.tabs.filter((tab) => studyWorkspaceSearchMatches(
          overflowQuery,
          entry.label,
          studyWorkspaceTabLabel(workspace, tab, bookNames),
        ));
    return tabs.length > 0 ? [{ ...entry, tabs }] : [];
  }), [bookNames, groups, overflowQuery, workspace]);
  const recentlyClosed = workspace.recentlyClosed.at(-1);
  const recentlyClosedLabel = useMemo(() => {
    if (!recentlyClosed) return null;
    if (recentlyClosed.kind === "tab") {
      return studyWorkspaceTabLabel(workspace, recentlyClosed.tab, bookNames);
    }
    const reopenedContext: StudyWorkspaceStateV2 = {
      ...workspace,
      tabsById: { ...workspace.tabsById, ...recentlyClosed.tabsById },
    };
    return studyWorkspaceGroupLabel(reopenedContext, recentlyClosed.group, bookNames);
  }, [bookNames, recentlyClosed, workspace]);

  const runApprovedIntent = useCallback(async (
    request: () => Promise<boolean>,
    commit: () => void,
  ): Promise<boolean> => {
    if (pendingWorkspaceIntentCountRef.current > 0) return false;
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

  const scheduleControlFocus = useCallback((
    requested: HTMLElement | null,
    fallback: React.RefObject<HTMLElement | null>,
  ): void => {
    window.requestAnimationFrame(() => {
      const target = requested?.isConnected ? requested : fallback.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }, []);

  const dismissOverflow = useCallback((): void => {
    setOverflowOpen(false);
    setRenameGroupId(null);
    scheduleControlFocus(overflowButtonRef.current, overflowButtonRef);
  }, [scheduleControlFocus]);

  const dismissGroupMenu = useCallback((): void => {
    setGroupMenuOpen(false);
    setRenameGroupId(null);
    scheduleControlFocus(groupMenuButtonRef.current, groupMenuButtonRef);
  }, [scheduleControlFocus]);

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
      setGroupMenuOpen(false);
      setRenameGroupId(null);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onCloseGroup, runApprovedIntent, scheduleCommittedTabFocus]);

  const toggleGroup = useCallback(async (
    groupId: string,
    collapsing: boolean,
    focusTarget?: HTMLElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onToggleGroup(groupId, collapsing),
    () => scheduleControlFocus(focusTarget ?? null, overflowSearchRef),
  ), [onToggleGroup, runApprovedIntent, scheduleControlFocus]);

  const handleRenameGroup = useCallback(async (groupId: string): Promise<boolean> => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return false;
    const approved = await runApprovedIntent(
      () => onRenameGroup(groupId, trimmed),
      () => scheduleControlFocus(
        groupRenameInputRef.current,
        overflowOpen ? overflowSearchRef : groupMenuButtonRef,
      ),
    );
    if (approved) setRenameGroupId(null);
    if (approved) setRenameDraft("");
    return approved;
  }, [onRenameGroup, overflowOpen, renameDraft, runApprovedIntent, scheduleControlFocus]);

  const handleMoveTab = useCallback(async (
    tabId: string,
    targetGroupId: string,
    focusTarget: HTMLElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onMoveTab(tabId, targetGroupId),
    () => scheduleControlFocus(focusTarget, overflowSearchRef),
  ), [onMoveTab, runApprovedIntent, scheduleControlFocus]);

  const handleReorderTab = useCallback(async (
    tabId: string,
    position: WorkspaceReorderPosition,
    focusTarget: HTMLElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onReorderTab(tabId, position),
    () => scheduleControlFocus(focusTarget, overflowSearchRef),
  ), [onReorderTab, runApprovedIntent, scheduleControlFocus]);

  const handleReorderGroup = useCallback(async (
    groupId: string,
    position: WorkspaceReorderPosition,
    focusTarget: HTMLElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onReorderGroup(groupId, position),
    () => scheduleControlFocus(focusTarget, overflowSearchRef),
  ), [onReorderGroup, runApprovedIntent, scheduleControlFocus]);

  const handleReopenRecent = useCallback(async (): Promise<boolean> => await runApprovedIntent(
    () => onReopenRecent(),
    () => {
      setOverflowOpen(false);
      setGroupMenuOpen(false);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onReopenRecent, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleTabAuxClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
    collapsedGroupId: string | null,
  ): Promise<void> => {
    if (event.button !== 1 || !canClose) return;
    event.preventDefault();
    if (collapsedGroupId) await handleCloseGroup(collapsedGroupId);
    else await handleCloseTab(tabId);
  };

  const handleTabKeyDown = async (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
    collapsedGroupId: string | null,
  ): Promise<void> => {
    if (canClose && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      if (collapsedGroupId) await handleCloseGroup(collapsedGroupId);
      else await handleCloseTab(tabId, { moveFocus: true });
      return;
    }
    if (visibleTabIds.length === 0) return;
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

  const deferMouseFocus = (event: React.MouseEvent<HTMLElement>): void => event.preventDefault();
  const totalTabs = Object.keys(workspace.tabsById).length;

  return (
    <nav
      className="scripture-workspace-bar"
      aria-label="Study workspace tabs"
      data-study-workspace-bar=""
      data-study-overflowing={hasMeasuredOverflow || undefined}
    >
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
        {groups.flatMap(({ group, label: groupLabel, visibleTabs }, groupIndex) => visibleTabs.map((tab, tabIndex) => {
          const label = studyWorkspaceTabLabel(workspace, tab, bookNames);
          const selected = workspace.activeTabId === tab.id;
          const roving = rovingTabId === tab.id;
          const collapsedProxy = group.collapsed;
          const visibleLabel = collapsedProxy ? groupLabel : label;
          const closeAvailability = collapsedProxy
            ? studyWorkspaceGroupCloseAvailability(workspace, group.id)
            : studyWorkspaceTabCloseAvailability(workspace, tab.id);
          const canClose = closeAvailability !== "unavailable";
          const closeCopy = studyWorkspaceCloseActionCopy(
            collapsedProxy ? `study ${groupLabel}` : label,
            closeAvailability,
          );
          const groupStart = tabIndex === 0 && groupIndex > 0;
          const expandedGroupLabel = !collapsedProxy && tabIndex === 0
            ? groupLabel
            : undefined;
          return (
            <div
              className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}${collapsedProxy ? " is-collapsed-proxy" : ""}`}
              role="presentation"
              key={tab.id}
              data-study-group-id={group.id}
              data-study-group-start={groupStart || undefined}
              data-study-group-label={expandedGroupLabel}
            >
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                id={`study-workspace-tab-${tab.id}`}
                className={`scripture-workspace-tab is-${tab.kind}`}
                role="tab"
                aria-label={collapsedProxy
                  ? `${groupLabel}, collapsed study with ${group.tabIds.length} tabs, opens ${label}${closeAvailability === "decision" ? ", closing requires confirmation" : ""}`
                  : `${label}, ${groupLabel}${closeAvailability === "decision" ? ", closing requires confirmation" : ""}`}
                aria-selected={selected}
                aria-controls="scripture-workspace-panel"
                aria-keyshortcuts={canClose ? "Delete" : undefined}
                tabIndex={roving ? 0 : -1}
                data-study-tab-id={tab.id}
                data-study-tab-kind={studyWorkspaceTabType(tab)}
                data-study-collapsed-proxy={collapsedProxy || undefined}
                title={collapsedProxy ? `${groupLabel} — ${group.tabIds.length} tabs` : `${label} — ${groupLabel}`}
                onMouseDown={deferMouseFocus}
                onClick={async (event) => {
                  if (event.target instanceof Element && event.target.closest("[data-workspace-tab-close]")) {
                    if (collapsedProxy) await handleCloseGroup(group.id);
                    else await handleCloseTab(tab.id, { moveFocus: true });
                    return;
                  }
                  await handleSelectTab(tab.id, { moveFocus: true });
                }}
                onAuxClick={(event) => handleTabAuxClick(event, tab.id, canClose, collapsedProxy ? group.id : null)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id, canClose, collapsedProxy ? group.id : null)}
              >
                <TabMark tab={tab} />
                <span className="scripture-workspace-tab-label">{visibleLabel}</span>
                {collapsedProxy && group.tabIds.length > 1 && (
                  <span className="scripture-workspace-tab-count" aria-hidden="true">{group.tabIds.length}</span>
                )}
                {canClose && (
                  <span
                    className="scripture-workspace-tab-close"
                    data-workspace-tab-close=""
                    data-study-close-availability={closeAvailability}
                    title={closeCopy.title}
                    aria-hidden="true"
                  >
                    <CloseGlyph />
                  </span>
                )}
              </button>
            </div>
          );
        }))}
      </div>

      <div className="scripture-workspace-actions" role="toolbar" aria-label="Study tab controls">
        <span
          className={`scripture-workspace-persistence is-${persistenceStatus.phase}`}
          data-study-persistence-status={persistenceStatus.phase}
          role="status"
          aria-live="polite"
        >
          {persistenceStatus.phase === "saving" ? "Saving…" : persistenceStatus.phase === "failed" ? (
            <button type="button" onClick={() => { void onRetryPersistence(); }}>
              Retry saving tabs
            </button>
          ) : <span className="sr-only">Tabs saved</span>}
        </span>
        {activeGroup && (
          <button
            ref={groupMenuButtonRef}
            type="button"
            className="scripture-workspace-active-group"
            data-study-active-group-manage=""
            data-study-group-id={activeGroup.group.id}
            aria-haspopup="dialog"
            aria-expanded={groupMenuOpen}
            onMouseDown={deferMouseFocus}
            onClick={() => {
              setOverflowOpen(false);
              setRenameGroupId(activeGroup.group.id);
              setRenameDraft(activeGroup.label);
              setGroupMenuAnchor(groupMenuButtonRef.current?.getBoundingClientRect() ?? null);
              setGroupMenuOpen(true);
            }}
            title={`Manage ${activeGroup.label}`}
          >
            <span>{activeGroup.label}</span>
            <small>{activeGroup.tabs.length}</small>
            <span className="scripture-workspace-caret" aria-hidden="true">⌄</span>
          </button>
        )}
        <button
          type="button"
          className="scripture-workspace-open"
          data-study-open=""
          data-study-open-tab=""
          onMouseDown={deferMouseFocus}
          onClick={onNewResearch}
          title="Open a new study tab"
        >
          <span aria-hidden="true">+</span><span>Open</span>
        </button>
        {recentlyClosed && (
          <button
            type="button"
            className="scripture-workspace-reopen"
            data-study-reopen-recent=""
            onMouseDown={deferMouseFocus}
            onClick={async () => { await handleReopenRecent(); }}
            aria-label={`Reopen ${recentlyClosedLabel ?? "recently closed study"}`}
            title={`Reopen ${recentlyClosedLabel ?? "recently closed study"}`}
          >
            <span aria-hidden="true">↶</span>
          </button>
        )}
        {(groups.length > 0 || hasMeasuredOverflow) && (
          <button
            ref={overflowButtonRef}
            type="button"
            className="scripture-workspace-overflow"
            data-study-all-tabs=""
            data-study-overflowing={hasMeasuredOverflow || undefined}
            onMouseDown={deferMouseFocus}
            onClick={() => {
              setGroupMenuOpen(false);
              setRenameGroupId(null);
              setOverflowQuery("");
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

      {groupMenuOpen && groupMenuAnchor && activeGroup && (
        <Popover
          anchorRect={groupMenuAnchor}
          onClose={dismissGroupMenu}
          width={300}
          maxHeight={440}
          className="scripture-workspace-group-popover"
          ariaLabel={`Manage ${activeGroup.label}`}
          initialFocusRef={groupRenameInputRef}
        >
          <div className="scripture-workspace-popover-heading">
            <div><strong>{activeGroup.label}</strong><span>{activeGroup.tabs.length} {activeGroup.tabs.length === 1 ? "tab" : "tabs"}</span></div>
            <span>Study group</span>
          </div>
          <form
            className="scripture-workspace-rename"
            data-study-group-rename=""
            onSubmit={async (event) => {
              event.preventDefault();
              await handleRenameGroup(activeGroup.group.id);
            }}
          >
            <label htmlFor={`study-group-rename-${activeGroup.group.id}`}>Study or question</label>
            <input
              ref={groupRenameInputRef}
              id={`study-group-rename-${activeGroup.group.id}`}
              value={renameGroupId === activeGroup.group.id ? renameDraft : activeGroup.label}
              maxLength={60}
              onChange={(event) => {
                setRenameGroupId(activeGroup.group.id);
                setRenameDraft(event.currentTarget.value);
              }}
              autoComplete="off"
            />
            <button type="submit" disabled={!renameDraft.trim() || renameDraft.trim() === activeGroup.label}>Save</button>
          </form>
          <div className="scripture-workspace-group-menu-actions">
            <label>
              <span className="sr-only">Order {activeGroup.label}</span>
              <select
                value=""
                data-study-group-reorder=""
                aria-label={`Change order of ${activeGroup.label}`}
                onChange={async (event) => {
                  const position = event.currentTarget.value as WorkspaceReorderPosition;
                  if (position) await handleReorderGroup(activeGroup.group.id, position, event.currentTarget);
                }}
              ><ReorderOptions /></select>
            </label>
            <button
              type="button"
              data-study-group-collapse=""
              aria-expanded={!activeGroup.group.collapsed}
              onMouseDown={deferMouseFocus}
              onClick={async (event) => { await toggleGroup(activeGroup.group.id, !activeGroup.group.collapsed, event.currentTarget); }}
            >{activeGroup.group.collapsed ? "Expand tabs" : "Collapse tabs"}</button>
            {activeGroupCloseAvailability !== "unavailable" && activeGroupCloseCopy && (
              <button
                type="button"
                className="is-danger"
                data-study-group-close=""
                data-study-close-availability={activeGroupCloseAvailability}
                onMouseDown={deferMouseFocus}
                onClick={async () => { await handleCloseGroup(activeGroup.group.id); }}
                aria-label={activeGroupCloseCopy.ariaLabel}
                title={activeGroupCloseCopy.title}
              >{activeGroupCloseAvailability === "decision" ? "Close study…" : "Close study"}</button>
            )}
          </div>
        </Popover>
      )}

      {overflowOpen && overflowAnchor && (
        <Popover
          id="study-workspace-all-tabs"
          anchorRect={overflowAnchor}
          onClose={dismissOverflow}
          width={440}
          maxHeight={560}
          className="scripture-workspace-overflow-popover"
          ariaLabel="All study tabs"
          initialFocusRef={overflowSearchRef}
        >
          <div className="scripture-workspace-overflow-head">
            <div><strong>All Tabs</strong><span>{totalTabs} open in {groups.length} {groups.length === 1 ? "study" : "studies"}</span></div>
            {recentlyClosed && (
              <button
                type="button"
                data-study-reopen-recent=""
                onMouseDown={deferMouseFocus}
                onClick={async () => { await handleReopenRecent(); }}
              >Reopen {recentlyClosedLabel ?? "recent"}</button>
            )}
          </div>
          <label className="scripture-workspace-search">
            <span className="sr-only">Search open study tabs</span>
            <span aria-hidden="true">⌕</span>
            <input
              ref={overflowSearchRef}
              type="search"
              value={overflowQuery}
              data-study-all-tabs-search=""
              onChange={(event) => setOverflowQuery(event.currentTarget.value)}
              placeholder="Find a chapter, person, place, or study…"
              autoComplete="off"
            />
          </label>
          <div className="scripture-workspace-overflow-list">
            {filteredGroups.map(({ group, label, tabs }) => {
              const groupCloseAvailability = studyWorkspaceGroupCloseAvailability(workspace, group.id);
              const canCloseGroup = groupCloseAvailability !== "unavailable";
              const groupCloseCopy = studyWorkspaceCloseActionCopy(`study ${label}`, groupCloseAvailability);
              const renaming = renameGroupId === group.id;
              return (
                <section className="scripture-workspace-overflow-group" aria-label={label} data-study-group-id={group.id} key={group.id}>
                  <header>
                    {renaming ? (
                      <form
                        className="scripture-workspace-inline-rename"
                        data-study-group-rename=""
                        onSubmit={async (event) => {
                          event.preventDefault();
                          await handleRenameGroup(group.id);
                        }}
                      >
                        <input
                          ref={groupRenameInputRef}
                          value={renameDraft}
                          maxLength={60}
                          aria-label={`Rename ${label}`}
                          onChange={(event) => setRenameDraft(event.currentTarget.value)}
                          autoComplete="off"
                        />
                        <button type="submit" disabled={!renameDraft.trim() || renameDraft.trim() === label}>Save</button>
                        <button type="button" onClick={() => setRenameGroupId(null)}>Cancel</button>
                      </form>
                    ) : (
                      <div className="scripture-workspace-group-title">
                        <strong>{label}</strong><span>{tabs.length}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameGroupId(group.id);
                            setRenameDraft(label);
                            window.requestAnimationFrame(() => groupRenameInputRef.current?.focus({ preventScroll: true }));
                          }}
                        >Rename</button>
                      </div>
                    )}
                    <div className="scripture-workspace-group-tools">
                      <label>
                        <span className="sr-only">Order {label}</span>
                        <select
                          value=""
                          data-study-group-reorder=""
                          aria-label={`Change order of ${label}`}
                          onChange={async (event) => {
                            const position = event.currentTarget.value as WorkspaceReorderPosition;
                            if (position) await handleReorderGroup(group.id, position, event.currentTarget);
                          }}
                        ><ReorderOptions /></select>
                      </label>
                      <button
                        type="button"
                        data-study-group-collapse=""
                        aria-expanded={!group.collapsed}
                        onMouseDown={deferMouseFocus}
                        onClick={async (event) => { await toggleGroup(group.id, !group.collapsed, event.currentTarget); }}
                      >{group.collapsed ? "Expand" : "Collapse"}</button>
                      {canCloseGroup && (
                        <button
                          type="button"
                          className="is-danger"
                          data-study-group-close=""
                          data-study-close-availability={groupCloseAvailability}
                          onMouseDown={deferMouseFocus}
                          onClick={async () => { await handleCloseGroup(group.id); }}
                          aria-label={groupCloseCopy.ariaLabel}
                          title={groupCloseCopy.title}
                        >{groupCloseAvailability === "decision" ? "Close…" : "Close"}</button>
                      )}
                    </div>
                  </header>
                  <div className="scripture-workspace-group-rows">
                    {tabs.map((tab) => {
                      const tabLabel = studyWorkspaceTabLabel(workspace, tab, bookNames);
                      const tabCloseAvailability = studyWorkspaceTabCloseAvailability(workspace, tab.id);
                      const canClose = tabCloseAvailability !== "unavailable";
                      const tabCloseCopy = studyWorkspaceCloseActionCopy(tabLabel, tabCloseAvailability);
                      return (
                        <div className="scripture-workspace-overflow-row" data-study-all-tabs-row="" data-study-tab-id={tab.id} key={tab.id}>
                          <button
                            type="button"
                            className={workspace.activeTabId === tab.id ? "is-active" : undefined}
                            onClick={async () => { await handleSelectTab(tab.id, { closeOverflow: true, moveFocus: true }); }}
                          >
                            <TabMark tab={tab} /><span>{tabLabel}</span>
                            {workspace.activeTabId === tab.id && <small>Current</small>}
                          </button>
                          <div className="scripture-workspace-row-tools">
                            <label>
                              <span className="sr-only">Reorder {tabLabel}</span>
                              <select
                                value=""
                                data-study-tab-reorder=""
                                aria-label={`Reorder ${tabLabel}`}
                                onChange={async (event) => {
                                  const position = event.currentTarget.value as WorkspaceReorderPosition;
                                  if (position) await handleReorderTab(tab.id, position, event.currentTarget);
                                }}
                              ><ReorderOptions /></select>
                            </label>
                            {groups.length > 1 && (
                              <label>
                                <span className="sr-only">Move {tabLabel} to another study</span>
                                <select
                                  value={group.id}
                                  data-study-tab-move=""
                                  aria-label={`Move ${tabLabel} to another study`}
                                  onChange={async (event) => {
                                    const targetGroupId = event.currentTarget.value;
                                    if (targetGroupId !== group.id) await handleMoveTab(tab.id, targetGroupId, event.currentTarget);
                                  }}
                                >
                                  <option value={group.id}>Move…</option>
                                  {groups.filter((entry) => entry.group.id !== group.id).map((entry) => (
                                    <option value={entry.group.id} key={entry.group.id}>{entry.label}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {canClose && (
                              <button
                                type="button"
                                data-study-close-availability={tabCloseAvailability}
                                aria-label={tabCloseCopy.ariaLabel}
                                title={tabCloseCopy.title}
                                onMouseDown={deferMouseFocus}
                                onClick={async () => { await handleCloseTab(tab.id, { closeOverflow: true, moveFocus: true }); }}
                              ><CloseGlyph /></button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {filteredGroups.length === 0 && (
              <div className="scripture-workspace-empty" data-study-empty-search="">
                <strong>No open tab matches</strong><span>Try a chapter, person, place, or study name.</span>
              </div>
            )}
          </div>
        </Popover>
      )}
    </nav>
  );
}
