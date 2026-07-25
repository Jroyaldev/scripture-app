import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookNameData } from "../api.js";
import {
  orderedStudyWorkspaceTabs,
  STUDY_WORKSPACE_TAB_LIMIT,
  studyWorkspaceGroupCloseAvailability,
  studyWorkspaceGroupLabel,
  studyWorkspaceRegisterTabIds,
  studyWorkspaceTabCloseAvailability,
  studyWorkspaceTabLabel,
  studyWorkspaceTabLabelParts,
  studyWorkspaceTabOrdinal,
  studyWorkspaceTabType,
  visibleStudyWorkspaceTabIds,
  type StudyWorkspaceGroup,
  type StudyWorkspaceStateV2,
  type StudyWorkspaceTab,
  type WorkspaceCloseAvailability,
} from "../utils/studyWorkspace.js";
import type { WorkspacePersistenceStatus } from "../utils/workspacePersistence.js";
import { Popover } from "./Popover.js";
import { Tooltip } from "./Tooltip.js";

/** Warn on the `+` control once within this many tabs of the hard cap. */
const CAPACITY_HINT_THRESHOLD = 4;

export type WorkspaceReorderPosition = "left" | "right" | "start" | "end";

/** Pointer travel (px) before a press on a tab becomes a reorder drag. */
const DRAG_THRESHOLD_PX = 4;

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
  onReopenRecentItem: (index: number) => Promise<boolean>;
  onDuplicateTab: () => Promise<boolean>;
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

type WorkspaceContextTarget =
  | { kind: "tab"; tabId: string; groupId: string }
  | { kind: "group"; groupId: string }
  | { kind: "empty" };

interface WorkspaceContextMenu {
  target: WorkspaceContextTarget;
  anchor: DOMRect;
}

interface WorkspaceDragState {
  tabId: string;
  groupId: string;
  insertionIndex: number;
}

interface TabExitGeometry {
  label: string;
  kind: string;
  left: number;
  width: number;
}

interface ExitingTab extends TabExitGeometry {
  id: string;
}

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

/**
 * Why the workspace could not be saved, in four words.
 *
 * A persistence failure is stated, never dramatised: nothing closes, nothing
 * greys out, and the strip's baseline turns seal across its whole width. The
 * copy is capped at four words because a sentence here reads as an apology for
 * the passage you are looking at — and a failure to save the workspace must
 * never look like a failure to open a passage.
 */
const PERSISTENCE_FAILURE_REASONS: ReadonlyArray<{ match: RegExp; reason: string }> = [
  { match: /read[-\s]?only|EROFS|EACCES|EPERM/iu, reason: "Library is read only" },
  { match: /ENOSPC|no space|disk full|quota/iu, reason: "Disk has no room" },
  { match: /newer|conflict|revision|stale/iu, reason: "Another window saved first" },
  { match: /ENOENT|missing|not found/iu, reason: "Library file went missing" },
];

const PERSISTENCE_FAILURE_FALLBACK = "Library did not answer";

export function studyWorkspacePersistenceReason(error?: string): string {
  if (!error) return PERSISTENCE_FAILURE_FALLBACK;
  return PERSISTENCE_FAILURE_REASONS.find(({ match }) => match.test(error))?.reason
    ?? PERSISTENCE_FAILURE_FALLBACK;
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

/**
 * Map a pointer drag inside one study to a legal `onReorderTab` position.
 *
 * The reorder model only exposes coarse single-step and end-stop moves
 * (`start`/`left`/`right`/`end`) and never crosses group boundaries, so a drag
 * is resolved against the ordering of the dragged tab's own group. `insertionIndex`
 * is the slot (0..length) the drop indicator sits in; the source's own removal is
 * accounted for before choosing a direction. Returns `null` for a no-op drop.
 */
export function studyWorkspaceDragReorderPosition(
  orderedGroupTabIds: readonly string[],
  draggedTabId: string,
  insertionIndex: number,
): WorkspaceReorderPosition | null {
  const current = orderedGroupTabIds.indexOf(draggedTabId);
  if (current < 0) return null;
  const lastIndex = orderedGroupTabIds.length - 1;
  // Removing the dragged tab shifts every later slot back by one.
  let destination = insertionIndex > current ? insertionIndex - 1 : insertionIndex;
  destination = Math.max(0, Math.min(lastIndex, destination));
  if (destination === current) return null;
  if (destination <= 0) return "start";
  if (destination >= lastIndex) return "end";
  return destination < current ? "left" : "right";
}

/**
 * Translate a wheel event into a horizontal scroll delta for the tab strip.
 * Only predominantly-vertical wheels over an overflowing strip are captured;
 * everything else (no overflow, horizontal intent, or zero travel) is ignored
 * so trackpad horizontal scrolling and non-overflow strips behave natively.
 */
export function studyWorkspaceWheelScrollDelta(
  deltaX: number,
  deltaY: number,
  canScrollHorizontally: boolean,
): number | null {
  if (!canScrollHorizontally) return null;
  if (deltaY === 0 || Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return deltaY;
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

// Shared stroke-SVG control glyphs. All follow the PassageGlyph/CloseGlyph
// convention (consistent viewBox, currentColor stroke, no fill, round caps)
// and are styled through `.scripture-workspace-glyph`.
function CaretGlyph(): React.JSX.Element {
  return <svg className="scripture-workspace-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" /></svg>;
}

function PlusGlyph(): React.JSX.Element {
  return <svg className="scripture-workspace-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>;
}

function OverflowGlyph(): React.JSX.Element {
  // Round caps on zero-length segments render as three even dots.
  return <svg className="scripture-workspace-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h.01M8 8h.01M12 8h.01" /></svg>;
}

function SearchGlyph(): React.JSX.Element {
  return <svg className="scripture-workspace-glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4" /><path d="m10.2 10.2 3.3 3.3" /></svg>;
}

function ReopenGlyph(): React.JSX.Element {
  return <svg className="scripture-workspace-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4.5 3.2 7.3 6 10.1" /><path d="M3.2 7.3h6.3a3.4 3.4 0 0 1 0 6.8H6.6" /></svg>;
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

interface WorkspaceMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  run: () => void | Promise<unknown>;
}

interface WorkspaceMenuState {
  id: string;
  anchor: DOMRect;
  trigger: HTMLElement;
  ariaLabel: string;
  items: WorkspaceMenuItem[];
}

const REORDER_MENU_LABELS: ReadonlyArray<{ position: WorkspaceReorderPosition; label: string }> = [
  { position: "start", label: "Move to first" },
  { position: "left", label: "Move earlier" },
  { position: "right", label: "Move later" },
  { position: "end", label: "Move to last" },
];

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
  onReopenRecentItem,
  onDuplicateTab,
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
  // How many tabs are wholly inside the strip right now. Everything else in the
  // register — scrolled past the cut, or folded inside a collapsed study — is
  // "the rest", and the overflow control counts it as +n.
  const [tabsInStrip, setTabsInStrip] = useState<number | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenu | null>(null);
  const [dragState, setDragState] = useState<WorkspaceDragState | null>(null);
  const [menu, setMenu] = useState<WorkspaceMenuState | null>(null);
  const [exitingTabs, setExitingTabs] = useState<ExitingTab[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const overflowSearchRef = useRef<HTMLInputElement>(null);
  const groupMenuButtonRef = useRef<HTMLButtonElement>(null);
  const groupRenameInputRef = useRef<HTMLInputElement>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingWorkspaceIntentCountRef = useRef(0);
  const dragPointerRef = useRef<
    { x: number; y: number; tabId: string; groupId: string; started: boolean; insertionIndex: number } | null
  >(null);
  const suppressTabClickRef = useRef(false);
  // Symmetric exit motion: a closed tab leaves a decorative ghost that collapses
  // its width/opacity to mirror the 150ms entrance. Geometry is captured while
  // the tab still exists, so the ghost can be painted after React unmounts it.
  const tabGeometryRef = useRef<Map<string, TabExitGeometry>>(new Map());
  const prevVisibleTabIdsRef = useRef<string[]>([]);
  const prefersReducedMotionRef = useRef(false);

  const visibleTabIds = useMemo(() => visibleStudyWorkspaceTabIds(workspace), [workspace]);
  const visibleTabIdSet = useMemo(() => new Set(visibleTabIds), [visibleTabIds]);
  const rovingTabId = useMemo(
    () => studyWorkspaceRovingTabId(visibleTabIds, workspace.activeTabId),
    [visibleTabIds, workspace.activeTabId],
  );
  // Manual activation: roving FOCUS may lead the active (aria-selected) tab, so
  // the single tabindex=0 stop follows the focused tab and only falls back to
  // the active tab once focus leaves or the selection commits.
  const effectiveRovingTabId = useMemo(
    () => (focusedTabId && visibleTabIdSet.has(focusedTabId) ? focusedTabId : rovingTabId),
    [focusedTabId, rovingTabId, visibleTabIdSet],
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
  // Newest first for the recovery list; each entry keeps its true index for reopen.
  const recentlyClosedList = useMemo(
    () => workspace.recentlyClosed
      .map((item, index) => ({ item, index }))
      .reverse(),
    [workspace.recentlyClosed],
  );
  const recentlyClosedItemLabel = useCallback((item: typeof workspace.recentlyClosed[number]): string => {
    if (item.kind === "tab") return studyWorkspaceTabLabel(workspace, item.tab, bookNames);
    const context: StudyWorkspaceStateV2 = {
      ...workspace,
      tabsById: { ...workspace.tabsById, ...item.tabsById },
    };
    return studyWorkspaceGroupLabel(context, item.group, bookNames);
  }, [bookNames, workspace]);

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

  const dismissContextMenu = useCallback((): void => {
    setContextMenu(null);
    scheduleControlFocus(contextTriggerRef.current, overflowButtonRef);
  }, [scheduleControlFocus]);

  const openMenu = useCallback((
    id: string,
    trigger: HTMLElement,
    ariaLabel: string,
    items: WorkspaceMenuItem[],
  ): void => {
    setMenu({ id, trigger, ariaLabel, items, anchor: trigger.getBoundingClientRect() });
  }, []);

  const dismissMenu = useCallback((): void => {
    setMenu((current) => {
      if (current) scheduleControlFocus(current.trigger, overflowButtonRef);
      return null;
    });
  }, [scheduleControlFocus]);

  const runMenuItem = useCallback(async (item: WorkspaceMenuItem): Promise<void> => {
    if (item.disabled) return;
    setMenu(null);
    await item.run();
  }, []);

  const openContextMenu = useCallback((
    target: WorkspaceContextTarget,
    event: React.MouseEvent<HTMLElement>,
  ): void => {
    event.preventDefault();
    setMenu(null);
    setOverflowOpen(false);
    setGroupMenuOpen(false);
    contextTriggerRef.current = event.currentTarget;
    setContextMenu({ target, anchor: new DOMRect(event.clientX, event.clientY, 0, 0) });
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
      const box = viewport.getBoundingClientRect();
      let shown = 0;
      for (const node of tabRefs.current.values()) {
        if (!node.isConnected) continue;
        const rect = node.getBoundingClientRect();
        // A tab clipped by the 36px edge fade is not readable, so it is not shown.
        if (rect.left >= box.left - 1 && rect.right <= box.right + 1) shown += 1;
      }
      setTabsInStrip(shown);
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

  // A vertical wheel over an overflowing strip pans it horizontally. Bound as a
  // non-passive native listener so preventDefault actually suppresses the page.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent): void => {
      const canScrollHorizontally = viewport.scrollWidth > viewport.clientWidth + 1;
      const delta = studyWorkspaceWheelScrollDelta(event.deltaX, event.deltaY, canScrollHorizontally);
      if (delta == null) return;
      viewport.scrollLeft += delta;
      event.preventDefault();
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotionRef.current = query.matches;
    const onChange = (): void => { prefersReducedMotionRef.current = query.matches; };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Track tab geometry each commit so a removed tab can be replayed as a
  // collapsing ghost. Runs in layout phase: the diff uses the geometry captured
  // on the previous commit (still valid for the just-removed tab), then records
  // fresh geometry for the surviving tabs.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const priorGeometry = tabGeometryRef.current;
    const currentIds = new Set(visibleTabIds);
    if (!prefersReducedMotionRef.current && viewport) {
      const removed = prevVisibleTabIdsRef.current.filter((id) => !currentIds.has(id));
      const ghosts: ExitingTab[] = [];
      for (const id of removed) {
        const geometry = priorGeometry.get(id);
        if (geometry) ghosts.push({ id, ...geometry });
      }
      if (ghosts.length > 0) {
        setExitingTabs((current) => [
          ...current.filter((ghost) => !currentIds.has(ghost.id) && !ghosts.some((g) => g.id === ghost.id)),
          ...ghosts,
        ]);
      }
    }
    const nextGeometry = new Map<string, TabExitGeometry>();
    if (viewport) {
      const viewportRect = viewport.getBoundingClientRect();
      for (const id of visibleTabIds) {
        const node = tabRefs.current.get(id);
        if (!node) continue;
        const wrap = (node.closest(".scripture-workspace-tab-wrap") as HTMLElement | null) ?? node;
        const rect = wrap.getBoundingClientRect();
        nextGeometry.set(id, {
          label: node.querySelector(".scripture-workspace-tab-label")?.textContent ?? "",
          kind: node.dataset.studyTabKind ?? "",
          left: rect.left - viewportRect.left + viewport.scrollLeft,
          width: rect.width,
        });
      }
    }
    tabGeometryRef.current = nextGeometry;
    prevVisibleTabIdsRef.current = visibleTabIds;
  }, [visibleTabIds]);

  // Once a selection commits, roving focus rejoins the active tab.
  useEffect(() => {
    setFocusedTabId(null);
  }, [workspace.activeTabId]);

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

  const handleReopenRecentItem = useCallback(async (index: number): Promise<boolean> => await runApprovedIntent(
    () => onReopenRecentItem(index),
    () => {
      setOverflowOpen(false);
      setGroupMenuOpen(false);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onReopenRecentItem, runApprovedIntent, scheduleCommittedTabFocus]);

  const beginRenameFromContext = useCallback((groupId: string): void => {
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    setContextMenu(null);
    setGroupMenuOpen(false);
    setOverflowQuery("");
    setRenameGroupId(groupId);
    setRenameDraft(entry?.label ?? "");
    setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
    setOverflowOpen(true);
    window.requestAnimationFrame(() => groupRenameInputRef.current?.focus({ preventScroll: true }));
  }, [groups]);

  const handleCloseOthers = useCallback(async (groupId: string, keepTabId: string): Promise<void> => {
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    if (!entry) return;
    const targets = entry.tabs
      .filter((tab) => tab.id !== keepTabId
        && studyWorkspaceTabCloseAvailability(workspace, tab.id) !== "unavailable")
      .map((tab) => tab.id);
    for (const id of targets) {
      // Each sibling close is its own approved intent; stop if one is refused.
      const closed = await handleCloseTab(id);
      if (!closed) break;
    }
  }, [groups, handleCloseTab, workspace]);

  const handleDuplicateTab = useCallback(async (tabId: string): Promise<void> => {
    if (workspace.activeTabId !== tabId) {
      const selected = await handleSelectTab(tabId);
      if (!selected) return;
    }
    await onDuplicateTab();
  }, [handleSelectTab, onDuplicateTab, workspace.activeTabId]);

  const handleTabPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    tabId: string,
    groupId: string,
    draggable: boolean,
  ): void => {
    if (!draggable || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("[data-workspace-tab-close]")) return;
    dragPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      tabId,
      groupId,
      started: false,
      insertionIndex: 0,
    };
  };

  const handleTabPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
    groupId: string,
  ): void => {
    const origin = dragPointerRef.current;
    if (!origin || origin.groupId !== groupId) return;
    if (!origin.started) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
      origin.started = true;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
    }
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    if (!entry) return;
    const orderedIds = entry.visibleTabs.map((tab) => tab.id);
    let insertionIndex = orderedIds.length;
    for (let index = 0; index < orderedIds.length; index += 1) {
      const node = tabRefs.current.get(orderedIds[index]);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) {
        insertionIndex = index;
        break;
      }
    }
    origin.insertionIndex = insertionIndex;
    setDragState({ tabId: origin.tabId, groupId, insertionIndex });
  };

  const handleTabPointerUp = async (
    event: React.PointerEvent<HTMLButtonElement>,
    tabId: string,
    groupId: string,
  ): Promise<void> => {
    const origin = dragPointerRef.current;
    dragPointerRef.current = null;
    setDragState(null);
    if (!origin || !origin.started) return;
    suppressTabClickRef.current = true;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* release is best-effort */ }
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    if (!entry) return;
    const orderedIds = entry.visibleTabs.map((tab) => tab.id);
    const position = studyWorkspaceDragReorderPosition(orderedIds, tabId, origin.insertionIndex);
    if (position) await handleReorderTab(tabId, position, event.currentTarget);
  };

  const handleTabPointerCancel = (): void => {
    dragPointerRef.current = null;
    setDragState(null);
  };

  const handleTabAuxClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
    collapsedProxy: boolean,
  ): Promise<void> => {
    if (event.button !== 1) return;
    // A collapsed study's proxy stands in for many tabs; middle-clicking it must
    // never close the whole study. Individual tabs keep middle-click-to-close.
    if (collapsedProxy) {
      event.preventDefault();
      return;
    }
    if (!canClose) return;
    event.preventDefault();
    await handleCloseTab(tabId, { moveFocus: true });
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
    // APG manual activation: Enter/Space commit the focused tab's transition.
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      await handleSelectTab(tabId, { moveFocus: true });
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
    if (!next) return;
    // Arrows move roving FOCUS only; aria-selected/activation is untouched.
    setFocusedTabId(next);
    window.requestAnimationFrame(() => tabRefs.current.get(next)?.focus({ preventScroll: true }));
  };

  const deferMouseFocus = (event: React.MouseEvent<HTMLElement>): void => event.preventDefault();

  const handleViewportDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element
      && event.target.closest("button, input, select, a, [role='tab']")) return;
    onNewResearch();
  };

  const handleViewportContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element
      && event.target.closest("[data-study-tab-id], [data-study-group-tab]")) return;
    openContextMenu({ kind: "empty" }, event);
  };

  const totalTabs = Object.keys(workspace.tabsById).length;
  const atTabCapacity = totalTabs >= STUDY_WORKSPACE_TAB_LIMIT;
  const nearTabCapacity = totalTabs >= STUDY_WORKSPACE_TAB_LIMIT - CAPACITY_HINT_THRESHOLD;
  const openTooltip = atTabCapacity
    ? `All ${STUDY_WORKSPACE_TAB_LIMIT} studies open — close one to open another`
    : nearTabCapacity
      ? `${totalTabs} of ${STUDY_WORKSPACE_TAB_LIMIT} studies open`
      : "Open a new study tab";
  const contextGroupId = contextMenu && "groupId" in contextMenu.target
    ? contextMenu.target.groupId
    : null;
  const contextGroup = contextGroupId
    ? groups.find((entry) => entry.group.id === contextGroupId) ?? null
    : null;

  // The active tab flows into the page with a concave fillet, and claims the
  // page's corner outright when it is first or last in the register. Which of
  // those applies is computed from the tab's INDEX, never from scroll
  // position — a shape that changes as you scroll stops reading as an object.
  const registerTabIds = groups.flatMap(({ visibleTabs }) => visibleTabs.map((tab) => tab.id));
  const activeRegisterIndex = registerTabIds.indexOf(workspace.activeTabId);
  const flushStart = activeRegisterIndex === 0;
  // One tab is both first and last, and a 104px tab cannot supply both of the
  // page's top corners. It takes the left one — case 2's payoff, with the other
  // tabs merely absent — and its right fillet joins it to the page as usual.
  const flushEnd = activeRegisterIndex >= 0 && activeRegisterIndex === registerTabIds.length - 1
    && !flushStart;

  // B·2 case 3 left this open: a flush-right tab claims the page's top-right
  // corner, so nothing may sit to its right — and the study's own two answers
  // ("left of the flush tab", "permanently left of the first tab") are the same
  // answer once the register docks to the end that owns the corner. So when the
  // last tab is active the whole run slides right to meet the page's edge and
  // the controls take the space it leaves, immediately to its left. The other
  // options each kill one of the two flush cases the study calls the payoff.
  const actionsPlacement = flushEnd ? "before-flush-tab" : "strip-end";

  // "The rest": everything the strip is not showing — scrolled past the 36px
  // cut, or folded inside a collapsed study. The overflow control counts it.
  const registerSize = studyWorkspaceRegisterTabIds(workspace).length;
  const hiddenTabCount = tabsInStrip === null ? 0 : Math.max(0, registerSize - tabsInStrip);
  const persistenceReason = studyWorkspacePersistenceReason(persistenceStatus.error);

  return (
    <nav
      className="scripture-workspace-bar"
      aria-label="Study workspace tabs"
      data-study-workspace-bar=""
      data-study-overflowing={hasMeasuredOverflow || undefined}
      data-flush-start={flushStart || undefined}
      data-flush-end={flushEnd || undefined}
      data-study-actions={actionsPlacement}
      data-study-persistence={persistenceStatus.phase}
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
        onDoubleClick={handleViewportDoubleClick}
        onContextMenu={handleViewportContextMenu}
      >
        {groups.flatMap(({ group, label: groupLabel, visibleTabs }, groupIndex) => visibleTabs.map((tab, tabIndex) => {
          const label = studyWorkspaceTabLabel(workspace, tab, bookNames);
          const labelParts = studyWorkspaceTabLabelParts(workspace, tab, bookNames);
          const selected = workspace.activeTabId === tab.id;
          const roving = effectiveRovingTabId === tab.id;
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
          // B3: the bracket is "1px over the members, ending at the last one".
          // A rule that spans several members cannot belong to any one of them,
          // and the members have to stay direct children of the strip so drag
          // and drop keeps one flat index space — so each member carries its own
          // segment and the group's span is the sum of them. The last member is
          // marked because that is the only place the rule is allowed to stop.
          const bracketed = !collapsedProxy;
          const groupEnd = bracketed && tabIndex === visibleTabs.length - 1;
          const dragging = dragState?.tabId === tab.id;
          const dropBefore = dragState?.groupId === group.id && dragState.insertionIndex === tabIndex;
          const dropAfter = dragState?.groupId === group.id
            && tabIndex === visibleTabs.length - 1
            && dragState.insertionIndex >= visibleTabs.length;
          return (
            <div
              className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}${collapsedProxy ? " is-collapsed-proxy" : ""}${dragging ? " is-dragging" : ""}`}
              role="presentation"
              key={tab.id}
              data-study-group-id={group.id}
              data-study-group-start={groupStart || undefined}
              data-study-group-bracket={bracketed || undefined}
              data-study-group-end={groupEnd || undefined}
              // B3: a study with no active tab drops its bracket to 72% —
              // present, receded. Never a second ink, only less of the one. The
              // flag sits on the wrap because the rule and the label are two
              // elements and they have to recede together.
              data-study-group-active={bracketed ? activeGroup?.group.id === group.id : undefined}
              data-study-drop={dropBefore ? "before" : dropAfter ? "after" : undefined}
            >
              {bracketed && tabIndex > 0 && (
                <span className="scripture-workspace-group-rule" aria-hidden="true" />
              )}
              {expandedGroupLabel !== undefined && (
                <button
                  type="button"
                  className="scripture-workspace-group-tab"
                  data-study-group-tab=""
                  data-study-group-id={group.id}
                  data-study-group-active={activeGroup?.group.id === group.id}
                  tabIndex={-1}
                  title={expandedGroupLabel}
                  aria-label={`Collapse study ${expandedGroupLabel}`}
                  onMouseDown={deferMouseFocus}
                  onClick={async (event) => { await toggleGroup(group.id, true, event.currentTarget); }}
                  onContextMenu={(event) => openContextMenu({ kind: "group", groupId: group.id }, event)}
                ><span>{expandedGroupLabel}</span></button>
              )}
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
                onPointerDown={(event) => handleTabPointerDown(event, tab.id, group.id, !collapsedProxy)}
                onPointerMove={(event) => handleTabPointerMove(event, group.id)}
                onPointerUp={(event) => handleTabPointerUp(event, tab.id, group.id)}
                onPointerCancel={handleTabPointerCancel}
                onClick={async (event) => {
                  if (suppressTabClickRef.current) {
                    suppressTabClickRef.current = false;
                    return;
                  }
                  if (event.target instanceof Element && event.target.closest("[data-workspace-tab-close]")) {
                    if (collapsedProxy) await handleCloseGroup(group.id);
                    else await handleCloseTab(tab.id, { moveFocus: true });
                    return;
                  }
                  await handleSelectTab(tab.id, { moveFocus: true });
                }}
                onAuxClick={(event) => handleTabAuxClick(event, tab.id, canClose, collapsedProxy)}
                onContextMenu={(event) => openContextMenu(
                  collapsedProxy
                    ? { kind: "group", groupId: group.id }
                    : { kind: "tab", tabId: tab.id, groupId: group.id },
                  event,
                )}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id, canClose, collapsedProxy ? group.id : null)}
              >
                <TabMark tab={tab} />
                {labelParts && !collapsedProxy ? (
                  <span className="scripture-workspace-tab-label">
                    <span className="scripture-workspace-tab-book">{labelParts.book}</span>
                    <span className="scripture-workspace-tab-chapter">{labelParts.chapter}</span>
                    {labelParts.qualifier && (
                      <span className="scripture-workspace-tab-qualifier">{labelParts.qualifier}</span>
                    )}
                  </span>
                ) : (
                  <span className="scripture-workspace-tab-label">{visibleLabel}</span>
                )}
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
        {exitingTabs.map((ghost) => (
          <div
            key={`exit-${ghost.id}`}
            className="scripture-workspace-tab-exit"
            data-study-tab-exit=""
            aria-hidden="true"
            style={{ left: ghost.left, width: ghost.width }}
            onAnimationEnd={() => setExitingTabs((current) => current.filter((entry) => entry.id !== ghost.id))}
          >
            <span
              className={`scripture-workspace-tab-mark${ghost.kind === "passage" || ghost.kind === "person" || ghost.kind === "place" ? ` is-${ghost.kind}` : ""}`}
              aria-hidden="true"
            />
            <span className="scripture-workspace-tab-label">{ghost.label}</span>
          </div>
        ))}
      </div>

      <div className="scripture-workspace-actions" role="toolbar" aria-label="Study tab controls">
        <span
          className={`scripture-workspace-persistence is-${persistenceStatus.phase}`}
          data-study-persistence-status={persistenceStatus.phase}
          role="status"
          aria-live="polite"
        >
          {persistenceStatus.phase === "saving" ? "Saving…" : persistenceStatus.phase === "failed" ? (
            <>
              {/* Four words for the reason, then the retry beside it. Nothing
                  closes and nothing greys out: the seal baseline under the whole
                  strip already says the workspace did not save. */}
              <span className="scripture-workspace-persistence-reason" data-study-persistence-reason="">
                {persistenceReason}
              </span>
              <button
                type="button"
                aria-label={`Retry saving tabs — ${persistenceReason}`}
                onClick={() => { void onRetryPersistence(); }}
              >
                Retry
              </button>
            </>
          ) : <span className="sr-only">Tabs saved</span>}
        </span>
        {activeGroup && (
          <Tooltip label={`Manage ${activeGroup.label}`}>
            <button
              ref={groupMenuButtonRef}
              type="button"
              className="scripture-workspace-active-group"
              data-study-active-group-manage=""
              data-study-group-id={activeGroup.group.id}
              aria-haspopup="dialog"
              aria-expanded={groupMenuOpen}
              aria-label={`Manage ${activeGroup.label}`}
              onMouseDown={deferMouseFocus}
              onClick={() => {
                setMenu(null);
                setOverflowOpen(false);
                setRenameGroupId(activeGroup.group.id);
                setRenameDraft(activeGroup.label);
                setGroupMenuAnchor(groupMenuButtonRef.current?.getBoundingClientRect() ?? null);
                setGroupMenuOpen(true);
              }}
            >
              <span>{activeGroup.label}</span>
              <small>{activeGroup.tabs.length}</small>
              <span className="scripture-workspace-caret" aria-hidden="true"><CaretGlyph /></span>
            </button>
          </Tooltip>
        )}
        <Tooltip label={openTooltip}>
          <button
            type="button"
            className="scripture-workspace-open"
            data-study-open=""
            data-study-open-tab=""
            data-study-open-disabled={atTabCapacity || undefined}
            aria-disabled={atTabCapacity || undefined}
            aria-label="Open a new study tab"
            onMouseDown={deferMouseFocus}
            onClick={() => { if (!atTabCapacity) onNewResearch(); }}
          >
            <span aria-hidden="true"><PlusGlyph /></span><span>Open</span>
          </button>
        </Tooltip>
        {(groups.length > 0 || hasMeasuredOverflow) && (
          <Tooltip label="All study tabs and groups">
            <button
              ref={overflowButtonRef}
              type="button"
              className="scripture-workspace-overflow"
              data-study-all-tabs=""
              data-study-overflowing={hasMeasuredOverflow || undefined}
              onMouseDown={deferMouseFocus}
              onClick={() => {
                setMenu(null);
                setGroupMenuOpen(false);
                setRenameGroupId(null);
                setOverflowQuery("");
                setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
                setOverflowOpen(true);
              }}
              aria-label={hiddenTabCount > 0
                ? `Show all ${totalTabs} study tabs — ${hiddenTabCount} not in the strip`
                : `Show all ${totalTabs} study tabs`}
              aria-haspopup="dialog"
              aria-expanded={overflowOpen}
            >
              {/* Never squeeze: the strip scrolls and the remainder is counted.
                  A count you can act on beats an icon that only means "more". */}
              {hiddenTabCount > 0 ? (
                <>
                  <span className="scripture-workspace-overflow-count">{`+${hiddenTabCount}`}</span>
                  <span aria-hidden="true"><CaretGlyph /></span>
                </>
              ) : <span aria-hidden="true"><OverflowGlyph /></span>}
            </button>
          </Tooltip>
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
            <button
              type="button"
              className="scripture-workspace-menu-trigger"
              data-study-group-reorder=""
              aria-haspopup="menu"
              aria-expanded={menu?.id === "group-reorder-active"}
              aria-label={`Change order of ${activeGroup.label}`}
              onMouseDown={deferMouseFocus}
              onClick={(event) => {
                const trigger = event.currentTarget;
                openMenu(
                  "group-reorder-active",
                  trigger,
                  `Change order of ${activeGroup.label}`,
                  REORDER_MENU_LABELS.map(({ position, label }) => ({
                    key: position,
                    label,
                    run: () => handleReorderGroup(activeGroup.group.id, position, trigger),
                  })),
                );
              }}
            ><span>Order</span><CaretGlyph /></button>
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
            <span className="scripture-workspace-search-icon" aria-hidden="true"><SearchGlyph /></span>
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
                      <button
                        type="button"
                        className="scripture-workspace-menu-trigger"
                        data-study-group-reorder=""
                        aria-haspopup="menu"
                        aria-expanded={menu?.id === `group-reorder-${group.id}`}
                        aria-label={`Change order of ${label}`}
                        onMouseDown={deferMouseFocus}
                        onClick={(event) => {
                          const trigger = event.currentTarget;
                          openMenu(
                            `group-reorder-${group.id}`,
                            trigger,
                            `Change order of ${label}`,
                            REORDER_MENU_LABELS.map(({ position, label: itemLabel }) => ({
                              key: position,
                              label: itemLabel,
                              run: () => handleReorderGroup(group.id, position, trigger),
                            })),
                          );
                        }}
                      ><span>Order</span><CaretGlyph /></button>
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
                      // ⌘1–9 counts across the whole register including collapsed
                      // studies, and the numbers live here — never on the tabs. A
                      // strip of shortcut hints is chrome about chrome.
                      const ordinal = studyWorkspaceTabOrdinal(workspace, tab.id);
                      return (
                        <div className="scripture-workspace-overflow-row" data-study-all-tabs-row="" data-study-tab-id={tab.id} key={tab.id}>
                          <button
                            type="button"
                            className={workspace.activeTabId === tab.id ? "is-active" : undefined}
                            onClick={async () => { await handleSelectTab(tab.id, { closeOverflow: true, moveFocus: true }); }}
                          >
                            <TabMark tab={tab} /><span>{tabLabel}</span>
                            {workspace.activeTabId === tab.id && <small>Current</small>}
                            {ordinal !== null && (
                              <kbd
                                className="scripture-workspace-overflow-shortcut"
                                data-study-tab-ordinal={ordinal}
                              >{`⌘${ordinal}`}</kbd>
                            )}
                          </button>
                          <div className="scripture-workspace-row-tools">
                            <button
                              type="button"
                              className="scripture-workspace-menu-trigger"
                              data-study-tab-reorder=""
                              aria-haspopup="menu"
                              aria-expanded={menu?.id === `tab-reorder-${tab.id}`}
                              aria-label={`Reorder ${tabLabel}`}
                              onMouseDown={deferMouseFocus}
                              onClick={(event) => {
                                const trigger = event.currentTarget;
                                openMenu(
                                  `tab-reorder-${tab.id}`,
                                  trigger,
                                  `Reorder ${tabLabel}`,
                                  REORDER_MENU_LABELS.map(({ position, label: itemLabel }) => ({
                                    key: position,
                                    label: itemLabel,
                                    run: () => handleReorderTab(tab.id, position, trigger),
                                  })),
                                );
                              }}
                            ><span>Order</span><CaretGlyph /></button>
                            {groups.length > 1 && (
                              <button
                                type="button"
                                className="scripture-workspace-menu-trigger"
                                data-study-tab-move=""
                                aria-haspopup="menu"
                                aria-expanded={menu?.id === `tab-move-${tab.id}`}
                                aria-label={`Move ${tabLabel} to another study`}
                                onMouseDown={deferMouseFocus}
                                onClick={(event) => {
                                  const trigger = event.currentTarget;
                                  openMenu(
                                    `tab-move-${tab.id}`,
                                    trigger,
                                    `Move ${tabLabel} to another study`,
                                    groups
                                      .filter((entry) => entry.group.id !== group.id)
                                      .map((entry) => ({
                                        key: entry.group.id,
                                        label: entry.label,
                                        run: () => handleMoveTab(tab.id, entry.group.id, trigger),
                                      })),
                                  );
                                }}
                              ><span>Move</span><CaretGlyph /></button>
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
          {recentlyClosedList.length > 0 && (
            <div className="scripture-workspace-recent-list" data-study-recent-list="">
              <span className="scripture-workspace-recent-heading">Recently closed</span>
              {recentlyClosedList.map(({ item, index }) => (
                <button
                  type="button"
                  key={`${item.kind}-${index}`}
                  data-study-recent-item=""
                  onMouseDown={deferMouseFocus}
                  onClick={async () => { await handleReopenRecentItem(index); }}
                >
                  <span aria-hidden="true"><ReopenGlyph /></span>
                  <span>{recentlyClosedItemLabel(item)}</span>
                  <small>{item.kind === "group" ? "Study" : "Tab"}</small>
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}

      {contextMenu && (
        <Popover
          anchorRect={contextMenu.anchor}
          onClose={dismissContextMenu}
          width={244}
          maxHeight={360}
          className="scripture-workspace-context-popover"
          ariaLabel="Tab actions"
        >
          <div
            className="scripture-workspace-context-menu"
            role="menu"
            data-study-context-menu={contextMenu.target.kind}
          >
            {contextMenu.target.kind === "tab" && (() => {
              const target = contextMenu.target;
              const otherCount = contextGroup
                ? contextGroup.tabs.filter((tab) => tab.id !== target.tabId
                    && studyWorkspaceTabCloseAvailability(workspace, tab.id) !== "unavailable").length
                : 0;
              const tabCloseAvailability = studyWorkspaceTabCloseAvailability(workspace, target.tabId);
              const moveTargets = groups.filter((entry) => entry.group.id !== target.groupId);
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-study-context-close=""
                    disabled={tabCloseAvailability === "unavailable"}
                    onMouseDown={deferMouseFocus}
                    onClick={async () => { setContextMenu(null); await handleCloseTab(target.tabId, { moveFocus: true }); }}
                  >Close</button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={otherCount === 0}
                    onMouseDown={deferMouseFocus}
                    onClick={async () => { setContextMenu(null); await handleCloseOthers(target.groupId, target.tabId); }}
                  >Close others in this study</button>
                  <button
                    type="button"
                    role="menuitem"
                    data-study-context-duplicate=""
                    onMouseDown={deferMouseFocus}
                    onClick={async () => { setContextMenu(null); await handleDuplicateTab(target.tabId); }}
                  >Duplicate tab</button>
                  {moveTargets.length > 0 && (
                    <div className="scripture-workspace-context-submenu" role="group" aria-label="Move to study">
                      <span>Move to study…</span>
                      {moveTargets.map((entry) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={entry.group.id}
                          data-study-context-move=""
                          onMouseDown={deferMouseFocus}
                          onClick={async (event) => {
                            const trigger = event.currentTarget;
                            setContextMenu(null);
                            await handleMoveTab(target.tabId, entry.group.id, trigger);
                          }}
                        >{entry.label}</button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={deferMouseFocus}
                    onClick={() => beginRenameFromContext(target.groupId)}
                  >Rename study</button>
                </>
              );
            })()}
            {contextMenu.target.kind === "group" && (() => {
              const target = contextMenu.target;
              const groupCloseAvailability = studyWorkspaceGroupCloseAvailability(workspace, target.groupId);
              const collapsed = contextGroup?.group.collapsed ?? false;
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={deferMouseFocus}
                    onClick={() => beginRenameFromContext(target.groupId)}
                  >Rename study</button>
                  <button
                    type="button"
                    role="menuitem"
                    data-study-context-collapse=""
                    aria-expanded={!collapsed}
                    onMouseDown={deferMouseFocus}
                    onClick={async (event) => {
                      const trigger = event.currentTarget;
                      setContextMenu(null);
                      await toggleGroup(target.groupId, !collapsed, trigger);
                    }}
                  >{collapsed ? "Expand study" : "Collapse study"}</button>
                  {groupCloseAvailability !== "unavailable" && (
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      data-study-context-close-group=""
                      onMouseDown={deferMouseFocus}
                      onClick={async () => { setContextMenu(null); await handleCloseGroup(target.groupId); }}
                    >{groupCloseAvailability === "decision" ? "Close study…" : "Close study"}</button>
                  )}
                </>
              );
            })()}
            {contextMenu.target.kind === "empty" && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  data-study-context-open=""
                  onMouseDown={deferMouseFocus}
                  onClick={() => { setContextMenu(null); onNewResearch(); }}
                >Open new tab</button>
                <button
                  type="button"
                  role="menuitem"
                  data-study-context-reopen=""
                  disabled={!recentlyClosed}
                  onMouseDown={deferMouseFocus}
                  onClick={async () => { setContextMenu(null); await handleReopenRecent(); }}
                >Reopen closed tab</button>
              </>
            )}
          </div>
        </Popover>
      )}

      {menu && (
        <Popover
          anchorRect={menu.anchor}
          onClose={dismissMenu}
          width={196}
          maxHeight={320}
          className="scripture-workspace-menu-popover"
          ariaLabel={menu.ariaLabel}
        >
          <div
            className="scripture-workspace-menu"
            role="menu"
            aria-label={menu.ariaLabel}
            data-study-workspace-menu=""
            onKeyDown={(event) => {
              const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not([disabled])',
              )];
              if (items.length === 0) return;
              const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
              let next: number | null = null;
              if (event.key === "ArrowDown") next = (currentIndex + 1) % items.length;
              else if (event.key === "ArrowUp") next = (currentIndex - 1 + items.length) % items.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = items.length - 1;
              if (next == null) return;
              event.preventDefault();
              items[next]?.focus({ preventScroll: true });
            }}
          >
            {menu.items.length === 0 ? (
              <span className="scripture-workspace-menu-empty">No other studies</span>
            ) : menu.items.map((item) => (
              <button
                type="button"
                role="menuitem"
                key={item.key}
                disabled={item.disabled}
                data-study-menu-item={item.key}
                onMouseDown={deferMouseFocus}
                onClick={() => { void runMenuItem(item); }}
              >{item.label}</button>
            ))}
          </div>
        </Popover>
      )}
    </nav>
  );
}
