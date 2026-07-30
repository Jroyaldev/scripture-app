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
  studyWorkspaceTabPromoteAvailability,
  studyWorkspaceTabType,
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
  onRenameGroup: (groupId: string, label: string) => Promise<boolean>;
  onMoveTab: (tabId: string, targetGroupId: string) => Promise<boolean>;
  onPromoteTab: (tabId: string) => Promise<boolean>;
  /**
   * The study a dragged tab is currently over, or null.
   *
   * The chips are the study line's, one row up and in another component, so
   * the strip reports what its own pointer is over and the line paints it. It
   * is deliberately NOT an intent: nothing is committed by hovering, so this
   * one callback is void where every mutation here returns an approval.
   */
  onTabDragOverStudy: (groupId: string | null) => void;
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
}

interface SelectTabOptions {
  closeOverflow?: boolean;
  moveFocus?: boolean;
}

interface CloseTabOptions extends SelectTabOptions {}

type WorkspaceContextTarget =
  | { kind: "tab"; tabId: string; groupId: string }
  | { kind: "empty" };

interface WorkspaceContextMenu {
  target: WorkspaceContextTarget;
  anchor: DOMRect;
}

interface WorkspaceDragState {
  tabId: string;
  groupId: string;
  insertionIndex: number;
  /** A study chip the pointer is over, which outranks the insertion slot. */
  studyId: string | null;
}

/**
 * The study chip under a dragged tab, if the pointer has left the strip for the
 * line above it.
 *
 * Hit-testing the document rather than listening for pointer events on the chip
 * is not a shortcut: the drag sets pointer capture on the tab so the gesture
 * survives leaving the strip, and a captured pointer sends its events to the
 * capturing element — the chips never see one. `elementFromPoint` asks the
 * question capture cannot answer, and asks it of the DOM the reader can see.
 *
 * A chip standing for the tab's OWN study is not a target: dropping a tab back
 * where it already is has no move to make, and lighting it would promise one.
 */
export function studyChipDropTargetId(
  element: Element | null,
  sourceGroupId: string,
): string | null {
  const chip = element?.closest("[data-study-line-chip]");
  const groupId = chip?.getAttribute("data-study-group-id") ?? null;
  return groupId && groupId !== sourceGroupId ? groupId : null;
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
  onRenameGroup,
  onMoveTab,
  onPromoteTab,
  onTabDragOverStudy,
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
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [hasMeasuredOverflow, setHasMeasuredOverflow] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  const [rovingFocusIntent, setRovingFocusIntent] = useState<{ id: string; nonce: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenu | null>(null);
  const [dragState, setDragState] = useState<WorkspaceDragState | null>(null);
  const [menu, setMenu] = useState<WorkspaceMenuState | null>(null);
  const [exitingTabs, setExitingTabs] = useState<ExitingTab[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const overflowSearchRef = useRef<HTMLInputElement>(null);
  const groupRenameInputRef = useRef<HTMLInputElement>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingWorkspaceIntentCountRef = useRef(0);
  const dragPointerRef = useRef<
    {
      x: number;
      y: number;
      tabId: string;
      groupId: string;
      started: boolean;
      insertionIndex: number;
      studyId: string | null;
    } | null
  >(null);
  const suppressTabClickRef = useRef(false);
  const rovingFocusNonceRef = useRef(0);
  // Symmetric exit motion: a closed tab leaves a decorative ghost that collapses
  // its width/opacity to mirror the 150ms entrance. Geometry is captured while
  // the tab still exists, so the ghost can be painted after React unmounts it.
  const tabGeometryRef = useRef<Map<string, TabExitGeometry>>(new Map());
  const prevRegisterTabIdsRef = useRef<string[]>([]);
  const prefersReducedMotionRef = useRef(false);

  /**
   * THE REGISTER IS ONE STUDY AT A TIME, 2026-07-30.
   *
   * The strip holds the tabs of the study the page is in, and nothing else.
   * There is no filter state anywhere and there is no "all studies" view: the
   * study line above names every study, and which one the strip is showing is
   * the same fact as which tab is active. Selection leads and the line follows
   * because there is nothing else it could do — a chip asks for a tab, the
   * active tab moves, and the row underneath is that tab's study by
   * construction. A refused selection is self-correcting for the same reason.
   *
   * `allGroups` is the whole workspace and every surface that has to reach a
   * study the strip is NOT showing asks for it by name: All Tabs and its
   * search, the "Move to study…" menus, the rename this component still owns.
   * A call site that wants the workspace and takes `groups` is a mistake you
   * can see, rather than a study that quietly disappears from a menu.
   */
  const allGroups = useMemo<WorkspaceTabGroup[]>(() => workspace.groups.map((group) => ({
    group,
    label: studyWorkspaceGroupLabel(workspace, group, bookNames),
    tabs: orderedStudyWorkspaceTabs(workspace, group.id),
  })), [bookNames, workspace]);
  const activeStudyId = workspace.tabsById[workspace.activeTabId]?.groupId ?? null;
  const groups = useMemo<WorkspaceTabGroup[]>(
    () => allGroups.filter(({ group }) => group.id === activeStudyId),
    [activeStudyId, allGroups],
  );
  /**
   * The tabs the strip is showing, in strip order — and every one of the
   * study's tabs, because nothing folds any more.
   *
   * Roving focus and the arrow keys read THIS. A roving stop naming a tab that
   * is not rendered leaves the tablist with no `tabIndex=0` element at all — it
   * drops out of the Tab order, which is an APG violation — and an arrow would
   * move focus to a tab `tabRefs` has no node for, so focus would die silently.
   */
  const stripTabIds = useMemo(
    () => groups.flatMap(({ tabs }) => tabs.map((tab) => tab.id)),
    [groups],
  );
  const registerTabIds = useMemo(() => studyWorkspaceRegisterTabIds(workspace), [workspace]);
  const stripTabIdSet = useMemo(() => new Set(stripTabIds), [stripTabIds]);
  const rovingTabId = useMemo(
    () => studyWorkspaceRovingTabId(stripTabIds, workspace.activeTabId),
    [stripTabIds, workspace.activeTabId],
  );
  // Manual activation: roving FOCUS may lead the active (aria-selected) tab, so
  // the single tabindex=0 stop follows the focused tab and only falls back to
  // the active tab once focus leaves or the selection commits.
  const effectiveRovingTabId = useMemo(
    () => (focusedTabId && stripTabIdSet.has(focusedTabId) ? focusedTabId : rovingTabId),
    [focusedTabId, rovingTabId, stripTabIdSet],
  );
  const filteredGroups = useMemo(() => allGroups.flatMap((entry) => {
    const groupMatches = studyWorkspaceSearchMatches(overflowQuery, entry.label);
    const tabs = groupMatches
      ? entry.tabs
      : entry.tabs.filter((tab) => studyWorkspaceSearchMatches(
          overflowQuery,
          entry.label,
          studyWorkspaceTabLabel(workspace, tab, bookNames),
        ));
    return tabs.length > 0 ? [{ ...entry, tabs }] : [];
  }), [allGroups, bookNames, overflowQuery, workspace]);
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

  /**
   * Focus after a commit, once React has caught up.
   *
   * `window.setTimeout(…, 0)` and not `requestAnimationFrame`, changed
   * 2026-07-30 for the same reason the roving stop was: a frame is a compositor
   * promise, and an occluded window throttles rAF to never — so the workspace
   * would commit a selection and simply not move focus, silently, with no
   * error anywhere. A task runs after React's commit whether or not anything is
   * being painted. `focusWorkspaceTabAfterCommit` in app.tsx has always used a
   * task for exactly this; these two are brought into line with it.
   */
  const scheduleCommittedTabFocus = useCallback((tabId: string | null, moveFocus: boolean): void => {
    window.setTimeout(() => {
      const requested = tabId ? tabRefs.current.get(tabId) : undefined;
      const selected = viewportRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      const target = requested?.isConnected ? requested : selected ?? overflowButtonRef.current;
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (moveFocus) target?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const scheduleControlFocus = useCallback((
    requested: HTMLElement | null,
    fallback: React.RefObject<HTMLElement | null>,
  ): void => {
    window.setTimeout(() => {
      const target = requested?.isConnected ? requested : fallback.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }, 0);
  }, []);

  const dismissOverflow = useCallback((): void => {
    setOverflowOpen(false);
    setRenameGroupId(null);
    scheduleControlFocus(overflowButtonRef.current, overflowButtonRef);
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
  /* Diffed against the WORKSPACE's tabs and not against the strip's. A tab that
     left the workspace is a close and gets its ghost; a tab that left the strip
     because the reader changed study is still open, and replaying a row of
     collapse-out animations every time a chip is pressed would turn a switch
     into a demolition. */
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const priorGeometry = tabGeometryRef.current;
    const currentIds = new Set(registerTabIds);
    if (!prefersReducedMotionRef.current && viewport) {
      const removed = prevRegisterTabIdsRef.current.filter((id) => !currentIds.has(id));
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
      for (const id of registerTabIds) {
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
    prevRegisterTabIdsRef.current = registerTabIds;
  }, [registerTabIds]);

  /**
   * Put focus on the tab the arrows just moved the roving stop to.
   *
   * This was `window.requestAnimationFrame(() => …focus())` in the keydown
   * handler, and it went out of step with the tabindex it belongs to on
   * 2026-07-30: an Electron window that is occluded throttles rAF to never, so
   * `setFocusedTabId` landed, the stop moved, and focus stayed where it was.
   * The arrows stopped working with no error anywhere — the exact failure a
   * roving tabindex cannot survive, because focus and the stop ARE the pattern.
   *
   * A layout effect gives the same "after the DOM has caught up" guarantee
   * without asking the compositor for anything. The nonce is what makes a
   * second arrow onto the same tab a second request; a bare id would look
   * unchanged and this would not re-run.
   */
  useLayoutEffect(() => {
    if (!rovingFocusIntent) return;
    tabRefs.current.get(rovingFocusIntent.id)?.focus({ preventScroll: true });
    setRovingFocusIntent(null);
  }, [rovingFocusIntent]);

  // Once a selection commits, roving focus rejoins the active tab.
  useEffect(() => {
    setFocusedTabId(null);
  }, [workspace.activeTabId]);

  useLayoutEffect(() => {
    if (pendingWorkspaceIntentCountRef.current > 0) return;
    scheduleCommittedTabFocus(workspace.activeTabId, false);
  }, [scheduleCommittedTabFocus, stripTabIds, workspace.activeTabId]);

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
      setRenameGroupId(null);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onCloseGroup, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleRenameGroup = useCallback(async (groupId: string): Promise<boolean> => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return false;
    const approved = await runApprovedIntent(
      () => onRenameGroup(groupId, trimmed),
      () => scheduleControlFocus(groupRenameInputRef.current, overflowSearchRef),
    );
    if (approved) setRenameGroupId(null);
    if (approved) setRenameDraft("");
    return approved;
  }, [onRenameGroup, renameDraft, runApprovedIntent, scheduleControlFocus]);

  const handleMoveTab = useCallback(async (
    tabId: string,
    targetGroupId: string,
    focusTarget: HTMLElement,
  ): Promise<boolean> => await runApprovedIntent(
    () => onMoveTab(tabId, targetGroupId),
    () => scheduleControlFocus(focusTarget, overflowSearchRef),
  ), [onMoveTab, runApprovedIntent, scheduleControlFocus]);

  const handlePromoteTab = useCallback(async (tabId: string): Promise<boolean> => await runApprovedIntent(
    () => onPromoteTab(tabId),
    // The promoted tab is the new study's founding member and the model
    // activates it, so focus follows the tab rather than staying in a menu
    // that has already closed.
    () => scheduleCommittedTabFocus(tabId, true),
  ), [onPromoteTab, runApprovedIntent, scheduleCommittedTabFocus]);

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
      scheduleCommittedTabFocus(null, true);
    },
  ), [onReopenRecent, runApprovedIntent, scheduleCommittedTabFocus]);

  const handleReopenRecentItem = useCallback(async (index: number): Promise<boolean> => await runApprovedIntent(
    () => onReopenRecentItem(index),
    () => {
      setOverflowOpen(false);
      scheduleCommittedTabFocus(null, true);
    },
  ), [onReopenRecentItem, runApprovedIntent, scheduleCommittedTabFocus]);

  const beginRenameFromContext = useCallback((groupId: string): void => {
    const entry = allGroups.find((candidate) => candidate.group.id === groupId);
    setContextMenu(null);
    setOverflowQuery("");
    setRenameGroupId(groupId);
    setRenameDraft(entry?.label ?? "");
    setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
    setOverflowOpen(true);
    window.setTimeout(() => groupRenameInputRef.current?.focus({ preventScroll: true }), 0);
  }, [allGroups]);

  const handleCloseOthers = useCallback(async (groupId: string, keepTabId: string): Promise<void> => {
    const entry = allGroups.find((candidate) => candidate.group.id === groupId);
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
  }, [allGroups, handleCloseTab, workspace]);

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
      studyId: null,
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
    // The line is one row up, and a drag that reaches it is asking for a study
    // rather than a slot. It outranks the insertion index because the two
    // answers cannot both be shown without the row claiming to do both.
    const studyId = studyChipDropTargetId(
      document.elementFromPoint(event.clientX, event.clientY),
      groupId,
    );
    if (studyId !== origin.studyId) onTabDragOverStudy(studyId);
    origin.studyId = studyId;
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    if (!entry) return;
    const orderedIds = entry.tabs.map((tab) => tab.id);
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
    setDragState({ tabId: origin.tabId, groupId, insertionIndex, studyId });
  };

  const handleTabPointerUp = async (
    event: React.PointerEvent<HTMLButtonElement>,
    tabId: string,
    groupId: string,
  ): Promise<void> => {
    const origin = dragPointerRef.current;
    dragPointerRef.current = null;
    setDragState(null);
    if (origin?.studyId) onTabDragOverStudy(null);
    if (!origin || !origin.started) return;
    suppressTabClickRef.current = true;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* release is best-effort */ }
    // A DROP ON A CHIP IS THE MOVE THE MENUS ALREADY MAKE — same mutation, same
    // confirmations, same refusals. The gesture is a second door onto
    // `onMoveTab`, never a second set of rules for changing a tab's study.
    if (origin.studyId) {
      await handleMoveTab(tabId, origin.studyId, event.currentTarget);
      return;
    }
    const entry = groups.find((candidate) => candidate.group.id === groupId);
    if (!entry) return;
    const orderedIds = entry.tabs.map((tab) => tab.id);
    const position = studyWorkspaceDragReorderPosition(orderedIds, tabId, origin.insertionIndex);
    if (position) await handleReorderTab(tabId, position, event.currentTarget);
  };

  const handleTabPointerCancel = (): void => {
    if (dragPointerRef.current?.studyId) onTabDragOverStudy(null);
    dragPointerRef.current = null;
    setDragState(null);
  };

  const handleTabAuxClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
  ): Promise<void> => {
    if (event.button !== 1) return;
    /* The collapsed-proxy guard went with the proxy on 2026-07-30. It read
         if (collapsedProxy) { event.preventDefault(); return; }
       and it existed because one tab could stand for a whole study, so
       middle-clicking it would have closed every tab in that study at once.
       Every tab in the strip is one tab again. */
    if (!canClose) return;
    event.preventDefault();
    await handleCloseTab(tabId, { moveFocus: true });
  };

  const handleTabKeyDown = async (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
    canClose: boolean,
  ): Promise<void> => {
    // Delete closes the tab. It used to close the whole STUDY when the focused
    // tab was a collapsed study's proxy; there are no proxies, so one key has
    // one meaning again.
    if (canClose && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      await handleCloseTab(tabId, { moveFocus: true });
      return;
    }
    // APG manual activation: Enter/Space commit the focused tab's transition —
    // and they are deliberately NOT handled here. This used to read
    //
    //   if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    //     event.preventDefault();
    //     await handleSelectTab(tabId, { moveFocus: true });
    //   }
    //
    // which is the same commit the tab's own onClick makes, minus the two
    // branches in front of it: collapse the study when the tab is already the
    // active one, and expand-then-select when it is a collapsed study's proxy.
    // `preventDefault` cancelled the button's synthesized click, so the keyboard
    // reached neither. Collapse and expand were pointer-only, and the strip's
    // only collapse gesture had no keyboard equivalent at all.
    //
    // A button already activates on Enter and Space. Leaving that alone routes
    // the keyboard through the one handler that knows all three cases, and the
    // `event.detail === 0` test there — which had nothing to distinguish while
    // this branch existed — is what tells it a keyboard sent the click, so
    // focus travels for the keyboard and stays put for the pointer. One commit
    // path, reached two ways.
    // The arrows travel what the strip is SHOWING. They used to travel the
    // model-wide visible list, which was the same list until the study line
    // began filtering the strip; after that an arrow could land on a tab in a
    // study that is not on screen, `tabRefs` would have no node for it, and
    // focus would leave the register without arriving anywhere.
    if (stripTabIds.length === 0) return;
    const current = Math.max(0, stripTabIds.indexOf(tabId));
    let index: number | null = null;
    if (event.key === "ArrowRight") index = (current + 1) % stripTabIds.length;
    else if (event.key === "ArrowLeft") index = (current - 1 + stripTabIds.length) % stripTabIds.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = stripTabIds.length - 1;
    if (index == null) return;
    event.preventDefault();
    const next = stripTabIds[index];
    if (!next) return;
    // Arrows move roving FOCUS only; aria-selected/activation is untouched.
    setFocusedTabId(next);
    rovingFocusNonceRef.current += 1;
    setRovingFocusIntent({ id: next, nonce: rovingFocusNonceRef.current });
  };

  const deferMouseFocus = (event: React.MouseEvent<HTMLElement>): void => event.preventDefault();

  const handleViewportDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element
      && event.target.closest("button, input, select, a, [role='tab']")) return;
    onNewResearch();
  };

  // Empty space only: a right-click that lands on a tab is that tab's own menu.
  // The guard used to name `[data-study-group-tab]` as well — the kicker, which
  // opened the group menu — and the kicker left the strip on 2026-07-29 without
  // taking its selector with it.
  const handleViewportContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element
      && event.target.closest("[data-study-tab-id]")) return;
    openContextMenu({ kind: "empty" }, event);
  };

  const totalTabs = Object.keys(workspace.tabsById).length;
  const atTabCapacity = totalTabs >= STUDY_WORKSPACE_TAB_LIMIT;
  const nearTabCapacity = totalTabs >= STUDY_WORKSPACE_TAB_LIMIT - CAPACITY_HINT_THRESHOLD;
  // The cap this control meets is STUDY_WORKSPACE_TAB_LIMIT, so the copy says
  // tabs. It said "studies" until 2026-07-30 — the wrong unit at the one moment
  // the number matters, telling a reader with two studies and sixty-four tabs
  // that all 64 of their studies were open and inviting them to close a study
  // to fix it. A limit stated in the wrong unit is worse than an unstated one.
  const openTooltip = atTabCapacity
    ? `All ${STUDY_WORKSPACE_TAB_LIMIT} tabs open — close one to open another`
    : nearTabCapacity
      ? `${totalTabs} of ${STUDY_WORKSPACE_TAB_LIMIT} tabs open`
      : "Open a new study tab";
  const contextGroupId = contextMenu && "groupId" in contextMenu.target
    ? contextMenu.target.groupId
    : null;
  const contextGroup = contextGroupId
    ? allGroups.find((entry) => entry.group.id === contextGroupId) ?? null
    : null;

  // The active tab flows into the page with a concave fillet, and claims the
  // page's top-LEFT corner outright when it is first in the register. That is
  // computed from the tab's INDEX, never from scroll position — a shape that
  // changes as you scroll stops reading as an object.
  //
  // Rev 05 §05·2 added a second condition and it is retired here, 2026-07-30,
  // with the device it was written for. It read `&& !leadKickered`, where
  // `leadKickered` was `!leadGroup.group.collapsed` — "is there a kicker in
  // front of the first tab" — because the section had put a study's label at
  // the head of the strip, and a first tab standing behind one does not reach
  // the page's corner and may not square it.
  //
  // The kicker left the strip on 2026-07-29 and this guard did not go with it,
  // so for the default state — one expanded study — `leadKickered` was true and
  // flush-start could never fire. The first tab stopped squaring the page's
  // corner and nobody could see why, because the expression named an object
  // that was no longer rendered. Nothing precedes the first tab now, so the
  // condition is the whole of what it always meant: the active tab is first.
  const activeRegisterIndex = stripTabIds.indexOf(workspace.activeTabId);
  const flushStart = activeRegisterIndex === 0;

  // There is deliberately no flush-END counterpart, and this is a ruling rather
  // than an omission. B·2 case 3 asked where the + PASSAGE affordance goes when
  // the last tab claims the page's top-right corner. The only answer that saved
  // the corner docked the whole register right and moved the actions cluster to
  // the left of the flush tab — which meant Open, All-tabs and the group control
  // changed position every time the selection moved to or from the last tab. The
  // owner ruled that cost too high: the far-left tab keeps its flush treatment,
  // the far-right case is given up, and the controls hold one position for every
  // selection. So the placement is constant, and the attribute stays in the DOM
  // to say out loud that it no longer varies.
  const actionsPlacement = "strip-end";

  /* THE +n COUNT IS RETIRED, 2026-07-30. B4 asked for it — "a +7 count opens
     the rest as a list" — and it was right while the strip was the whole
     workspace and "the rest" was one number with one meaning. It stopped being
     one number when the register became one study at a time: some of it was a
     scroll you could undo by panning, and the rest was other studies entirely.
     Scoping it to the visible study left a count of tabs that are two pixels
     off the edge of a row you can pan with a wheel, which is chrome reporting
     on chrome.
     What answers "where is the rest" now is the study line: every study named,
     with its own count in the chip's tooltip, one press away. This control goes
     back to being what it says — the door to the overview — and it says how
     many tabs are behind it in its accessible name. */
  const persistenceReason = studyWorkspacePersistenceReason(persistenceStatus.error);

  return (
    <nav
      className="scripture-workspace-bar"
      aria-label="Study workspace tabs"
      data-study-workspace-bar=""
      data-study-overflowing={hasMeasuredOverflow || undefined}
      data-flush-start={flushStart || undefined}
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
        {groups.flatMap(({ group, label: groupLabel, tabs }) => {
        /* THE STRIP IS ONE STUDY'S TABS, 2026-07-30, and this loop lost two
           devices on that date.

           THE GROUP HEAD went on 2026-07-29. Rev 05 §05·2 had retired the group
           bracket in favour of a slate-marked kicker at the head of a study's
           own members, IN the strip — "a label above the strip creates a second
           strip. It belongs in the strip, at the head of its members." Right
           about the second strip, wrong about the alternative: a label among the
           tabs spends horizontal space permanently on something a reader wants
           only when changing studies, and a strip truncates the name at exactly
           the moment the name is what is being read.

           THE COLLAPSED PROXY went with the ruling that the register holds one
           study at a time. A proxy tab was a whole study folded into a single
           tab so its siblings could get out of the row — and the row now holds
           one study's tabs by construction, so there is nothing for a fold to
           achieve and no second study in the row to fold away from. Everything
           that hung off it goes too: `data-study-collapsed-proxy`, the
           expand-then-select branch, press-the-active-tab-to-collapse, the
           proxy's group context menu, and the count badge it wore.

           That retires the collapse-parity claim made here on 2026-07-30 —
           "collapsing from the strip must have its inverse in the strip", which
           was true and is now moot, because neither half of the pair exists.
           `collapsed` is still in the model and still persisted; nothing reads
           it. The claim's replacement is simpler: there is no gesture in the
           strip that hides a tab, so there is no gesture that has to un-hide
           one.

           What is left is the study's members, in the study's own order. */
        return tabs.map((tab, tabIndex) => {
          const label = studyWorkspaceTabLabel(workspace, tab, bookNames);
          const labelParts = studyWorkspaceTabLabelParts(workspace, tab, bookNames);
          const selected = workspace.activeTabId === tab.id;
          const roving = effectiveRovingTabId === tab.id;
          const closeAvailability = studyWorkspaceTabCloseAvailability(workspace, tab.id);
          const canClose = closeAvailability !== "unavailable";
          const closeCopy = studyWorkspaceCloseActionCopy(label, closeAvailability);
          const dragging = dragState?.tabId === tab.id;
          // A drag over a study chip has left the row's question behind, so the
          // row stops answering it: one drop indicator at a time, and it is on
          // the surface the pointer is over.
          const overStudy = dragState?.studyId != null;
          const dropBefore = !overStudy
            && dragState?.groupId === group.id
            && dragState.insertionIndex === tabIndex;
          const dropAfter = !overStudy
            && dragState?.groupId === group.id
            && tabIndex === tabs.length - 1
            && dragState.insertionIndex >= tabs.length;
          return (
            <div
              className={`scripture-workspace-tab-wrap${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`}
              role="presentation"
              key={tab.id}
              data-study-group-id={group.id}
              data-study-drop={dropBefore ? "before" : dropAfter ? "after" : undefined}
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
                aria-label={`${label}, ${groupLabel}${closeAvailability === "decision" ? ", closing requires confirmation" : ""}`}
                aria-selected={selected}
                aria-controls="scripture-workspace-panel"
                aria-keyshortcuts={canClose ? "Delete" : undefined}
                tabIndex={roving ? 0 : -1}
                data-study-tab-id={tab.id}
                data-study-tab-kind={studyWorkspaceTabType(tab)}
                title={`${label} — ${groupLabel}`}
                onMouseDown={deferMouseFocus}
                onPointerDown={(event) => handleTabPointerDown(event, tab.id, group.id, true)}
                onPointerMove={(event) => handleTabPointerMove(event, group.id)}
                onPointerUp={(event) => handleTabPointerUp(event, tab.id, group.id)}
                onPointerCancel={handleTabPointerCancel}
                onClick={async (event) => {
                  // A pointer press must not draw a focus ring, and this one did.
                  // `deferMouseFocus` cancels the browser's own mousedown focus,
                  // so the programmatic focus below is the FIRST focus the tab
                  // ever receives — and Chromium marks a programmatic focus
                  // `:focus-visible` when no pointer focus preceded it. The ring
                  // was therefore correct CSS answering a wrong question.
                  //
                  // `event.detail === 0` is keyboard activation: Enter and Space
                  // synthesise a click with no click count, a pointer reports at
                  // least one. So focus travels for the keyboard, which needs it
                  // to keep the roving tabindex coherent, and stays where the
                  // reader put it for the pointer, which does not. Scrolling the
                  // tab into view is unconditional either way — that happens in
                  // `scheduleCommittedTabFocus` before the focus call it gates.
                  //
                  // Two branches stood in front of this one until 2026-07-30 —
                  // expand-then-select on a collapsed study's proxy, and
                  // press-the-tab-you-are-on to fold its study — and both went
                  // with the proxy. A tab press selects a tab. That is the whole
                  // of it, which is what the strip's one gesture should have
                  // been all along.
                  const byKeyboard = event.detail === 0;
                  if (suppressTabClickRef.current) {
                    suppressTabClickRef.current = false;
                    return;
                  }
                  if (event.target instanceof Element && event.target.closest("[data-workspace-tab-close]")) {
                    await handleCloseTab(tab.id, { moveFocus: true });
                    return;
                  }
                  await handleSelectTab(tab.id, { moveFocus: byKeyboard });
                }}
                onAuxClick={(event) => handleTabAuxClick(event, tab.id, canClose)}
                onContextMenu={(event) => openContextMenu(
                  { kind: "tab", tabId: tab.id, groupId: group.id },
                  event,
                )}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id, canClose)}
              >
                <TabMark tab={tab} />
                {labelParts ? (
                  <span className="scripture-workspace-tab-label">
                    <span className="scripture-workspace-tab-book">{labelParts.book}</span>
                    <span className="scripture-workspace-tab-chapter">{labelParts.chapter}</span>
                    {labelParts.qualifier && (
                      <span className="scripture-workspace-tab-qualifier">{labelParts.qualifier}</span>
                    )}
                  </span>
                ) : (
                  <span className="scripture-workspace-tab-label">{label}</span>
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
        });
        })}
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

      {/* The new-tab plus, against the last tab rather than across the bar.
          It used to sit inside the actions toolbar, which is on the far side of
          a border-left with the save status and the overflow menu — so the one
          control that makes a tab was grouped with the controls that report on
          them, and a reader looking where every browser puts it found nothing.
          Here it reads as the end of the row it extends. */}
      <Tooltip label={openTooltip}>
        <button
          type="button"
          className="scripture-workspace-open is-inline"
          data-study-open=""
          data-study-open-tab=""
          data-study-open-disabled={atTabCapacity || undefined}
          aria-disabled={atTabCapacity || undefined}
          aria-label="Open a new study tab"
          onMouseDown={deferMouseFocus}
          onClick={() => { if (!atTabCapacity) onNewResearch(); }}
        >
          <span aria-hidden="true"><PlusGlyph /></span>
        </button>
      </Tooltip>

      <div className="scripture-workspace-actions" role="toolbar" aria-label="Study tab controls">
        {/* This element is rendered in every phase and hidden by the sheet, not
            by the branch below. A live region has to exist before its content
            changes or the change is never announced, and this one used to be
            display:none between writes — created and destroyed with the very
            text it was supposed to be reporting. At rest it holds nothing: the
            settle is silent, so a write says one thing once, and success is the
            absence of the failure line. */}
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
          ) : null}
        </span>
        {/* THE STUDY'S NAME IS NOT HERE ANY MORE, 2026-07-30.
            A `.scripture-workspace-active-group` control stood in this slot: the
            current study's name, its tab count and a caret, opening a popover
            with rename, order, collapse and close. It was the last element in
            the strip that stood for a study, and it was the same defect
            ae49372 removed from among the tabs, moved to the cluster that
            reports on them — 132px capped, ellipsised, and truncating the name
            at exactly the moment the name is the thing being read.

            The study line names studies now: every study, not only the one you
            are in; whole names at 168px; and renaming in place on the chip
            rather than in a dialog over the page. Order and close are
            per-study in All Tabs, which is also the one place a reader can
            reach a study they are not in.

            What is left in this cluster is the save status and the overview —
            one control that REPORTS on tabs and one that opens the door to all
            of them, and nothing that names a study. */}
        {(allGroups.length > 0 || hasMeasuredOverflow) && (
          <Tooltip label="Every tab in every study">
            <button
              ref={overflowButtonRef}
              type="button"
              className="scripture-workspace-overflow"
              data-study-all-tabs=""
              data-study-overflowing={hasMeasuredOverflow || undefined}
              onMouseDown={deferMouseFocus}
              onClick={() => {
                setMenu(null);
                setRenameGroupId(null);
                setOverflowQuery("");
                setOverflowAnchor(overflowButtonRef.current?.getBoundingClientRect() ?? null);
                setOverflowOpen(true);
              }}
              aria-label={`Show all ${totalTabs} study tabs in ${allGroups.length} ${allGroups.length === 1 ? "study" : "studies"}`}
              aria-haspopup="dialog"
              aria-expanded={overflowOpen}
            >
              {/* THE QUIET DOOR, and one glyph in every state as of 2026-07-30.
                  It wore a `+n` count whenever the strip was not showing
                  everything, which was B4's "a +7 count opens the rest as a
                  list" — right while the strip WAS the workspace and "the rest"
                  was one number meaning one thing. The register holds one study
                  now, so the rest is mostly other studies, and those are named
                  on the line above with their own counts. What is left over is
                  a tab or two past the edge of a row you can pan with a wheel,
                  which is not worth a number. The count survives where a count
                  belongs: in this control's accessible name, and in each chip's
                  tooltip. */}
              <span aria-hidden="true"><OverflowGlyph /></span>
            </button>
          </Tooltip>
        )}
      </div>

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
            <div><strong>All Tabs</strong><span>{totalTabs} open in {allGroups.length} {allGroups.length === 1 ? "study" : "studies"}</span></div>
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
                            window.setTimeout(() => groupRenameInputRef.current?.focus({ preventScroll: true }), 0);
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
                      {/* COLLAPSE LEFT THIS ROW ON 2026-07-30, with the proxy
                          tab it produced. Folding a study was a way of getting
                          its tabs out of the strip; the strip holds one study's
                          tabs by construction now, so the toggle had nothing
                          left to change on screen — and a control whose only
                          effect is a field nobody reads is worse than a missing
                          one, because a reader presses it and concludes the app
                          is broken. `collapsed` stays in the model and stays
                          persisted, untouched. */}
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
                            {allGroups.length > 1 && (
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
                                    allGroups
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
              const promoteAvailability = studyWorkspaceTabPromoteAvailability(workspace, target.tabId);
              const moveTargets = allGroups.filter((entry) => entry.group.id !== target.groupId);
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
                  {/* THE TAB LEAVES — it is not copied, which is the whole
                      difference between this and Duplicate above it. The study
                      it founds is born holding this tab, the strip follows it
                      because the tab is activated, and its chip opens as a
                      field the way the study line's + does. Disabled when the
                      shape refuses it: an entity tab cannot found a study, and
                      a study's last passage cannot leave it. */}
                  <button
                    type="button"
                    role="menuitem"
                    data-study-context-promote=""
                    data-study-promote-availability={promoteAvailability}
                    disabled={promoteAvailability !== "direct"}
                    onMouseDown={deferMouseFocus}
                    onClick={async () => { setContextMenu(null); await handlePromoteTab(target.tabId); }}
                  >New study from this tab</button>
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
            {/* THE GROUP MENU IS GONE, 2026-07-30. It held Rename study, a
                Collapse/Expand toggle and Close study, and it was reachable
                from exactly one element: a collapsed study's proxy tab, which
                IS the study while it is folded. Nothing folds now, so the menu
                had no trigger. Rename study survives on the tab menu above and
                on the study's own chip; close is per-study in this popover's
                list; collapse is retired with the proxy. */}
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
